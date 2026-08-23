"""
Vercel Python serverless function: GET /api/fetch_odds

Server-side proxy for The Odds API's NCAAF spreads, AND the sole writer of
the shared odds fields in Redis (lastGames/lastRefresh/reqLeft/booksSeen) --
see "why this writes shared state itself" below.

Behaviour:
  - Calls The Odds API server-to-server (browser->API direct calls can fail
    outright on CORS/ad-blockers/network filters with no useful error).
  - Extracts EVERY bookmaker's home-team line per game (not just one), so
    the shared cache can serve each person's own book/consensus preference
    without a second network call. See "sportsbook fix" below.
  - On success, merges the result into its own dedicated shared Redis key
    (server-owned write -- see SHARED_ODDS_KEY below and api/state.py's
    module docstring for why this is no longer the same key predictions
    and pool-publishing write to) and also returns it in the response so
    the caller doesn't need a second round-trip to see it.

WHY THIS WRITES SHARED STATE ITSELF (not the browser): the old design had
the browser fetch odds, reduce them to one number using ITS OWN sportsbook
preference, and then POST that resolved number into the shared bucket for
everyone. That meant whichever person happened to trigger a refresh decided
which book's line every other signed-in person saw for the next 30 minutes,
with no indication anything book-specific had happened. Storing every
book's line here (not a pre-resolved one) and having the server itself own
the shared write means: (a) the shared bucket is always market data, never
"whatever the last refresher's Settings said", and (b) two people can pick
different books and both see the right number from the same fetch --
index.html resolves state.book against the stored `books` dict at render
time now, not at fetch time.

API KEY: no longer accepted via a `?key=` query-string parameter -- a
credential in a URL can end up in server logs, browser history, and
analytics. A personal per-device key (if someone wants to use their own
instead of the shared ODDS_API_KEY) is now sent as the `X-Odds-Api-Key`
request header instead.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
import jwt
from jwt import PyJWKClient

# See api/state.py's own GENERIC_SERVER_ERROR/_log_server_error() comment
# for the full reasoning -- a raw exception string in the HTTP response
# can leak internal detail; the real text goes to Vercel's function logs
# (stderr) only, duplicated per-file same as verify_user().
GENERIC_SERVER_ERROR = "Something went wrong processing that request — try again shortly."


def _log_server_error(context, exc):
    print(f"[api/fetch_odds.py] {context}: {exc}", file=sys.stderr)

ODDS_SPORT = "americanfootball_ncaaf"
# Own dedicated key -- was "edge_board_shared" (one blob shared with
# fetch_predictions.py's predictions/predMeta AND state.py's sharedPools).
# A get-then-set race on that combined key could silently clobber whichever
# domain's write landed second. Splitting into per-domain keys removes that
# specific cross-domain race entirely, not just shrinks it -- this file can
# no longer touch predictions or sharedPools even if it wanted to, they're
# not on this key. See api/state.py's module docstring for the full picture.
SHARED_ODDS_KEY = "edge_board_shared_odds"
SHARED_ODDS_FIELDS = ("lastGames", "lastRefresh", "reqLeft", "booksSeen", "preKickLines")


def build_url(api_key, cfrom=None, cto=None):
    params = {
        "regions": "us",
        "markets": "spreads",
        "oddsFormat": "american",
        "apiKey": api_key,
    }
    if cfrom:
        params["commenceTimeFrom"] = cfrom
    if cto:
        params["commenceTimeTo"] = cto
    return f"https://api.the-odds-api.com/v4/sports/{ODDS_SPORT}/odds?{urllib.parse.urlencode(params)}"


def fetch_odds(api_key, cfrom=None, cto=None):
    """Returns (status, body_bytes, requests_remaining)."""
    req = urllib.request.Request(
        build_url(api_key, cfrom, cto),
        headers={"User-Agent": "Mozilla/5.0 (PickGauge odds proxy)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, res.read(), res.headers.get("x-requests-remaining")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("x-requests-remaining")


def _spread_home(book, home_team):
    for m in (book.get("markets") or []):
        if m.get("key") != "spreads":
            continue
        for o in (m.get("outcomes") or []):
            if o.get("name") == home_team and o.get("point") is not None:
                return o["point"]
    return None


PRE_KICK_RETENTION_DAYS = 35


def _parse_iso_utc(value):
    """Best-effort ISO-8601 parser normalized to aware UTC."""
    if not value:
        return None
    try:
        import datetime
        dt = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt.astimezone(datetime.timezone.utc)
    except (TypeError, ValueError):
        return None


def merge_pre_kick_lines(previous, games, observed_at, retention_days=PRE_KICK_RETENTION_DAYS):
    """Return the shared last-pre-kick market history after one odds pull.

    `lastGames` is intentionally a replace-only snapshot of what The Odds API
    currently lists. That means a game can disappear shortly after kickoff,
    which made it impossible to reconstruct a genuine closing line later when
    the user archives the week. This separate map survives that disappearance.

    Each bookmaker is updated only while the server-observed fetch time is
    strictly BEFORE kickoff. Once kickoff passes, that bookmaker's last
    pre-kick observation is frozen. Records are retained for five weeks so a
    user can archive a prior week late without letting this shared cache grow
    without bound for the full history of the product.
    """
    import datetime
    observed_dt = _parse_iso_utc(observed_at)
    out = {}
    if isinstance(previous, dict):
        for key, rec in previous.items():
            if not isinstance(rec, dict):
                continue
            commence_dt = _parse_iso_utc(rec.get("commence"))
            if observed_dt and commence_dt and commence_dt < observed_dt - datetime.timedelta(days=retention_days):
                continue
            out[str(key)] = dict(rec)

    if not observed_dt:
        return out

    for g in games or []:
        if not isinstance(g, dict):
            continue
        commence_dt = _parse_iso_utc(g.get("commence"))
        if not commence_dt or observed_dt >= commence_dt:
            continue  # never let an in-game/post-game quote overwrite the close
        books_now = g.get("books") or {}
        if not isinstance(books_now, dict) or not books_now:
            continue
        key = str(g.get("id") or f'{g.get("away", "")} @ {g.get("home", "")} | {g.get("commence", "")}')
        old = out.get(key) if isinstance(out.get(key), dict) else {}
        books = dict(old.get("books") or {})
        book_observed = dict(old.get("bookObservedAt") or {})
        for book, line in books_now.items():
            if line is None:
                continue
            books[str(book)] = line
            book_observed[str(book)] = observed_at
        out[key] = {
            "id": g.get("id"),
            "away": g.get("away"),
            "home": g.get("home"),
            "commence": g.get("commence"),
            "books": books,
            "bookObservedAt": book_observed,
            "observedAt": observed_at,
        }
    return out


def extract_games(events):
    """Turns The Odds API's raw event list into the shape the board and
    index.html's client-side resolver expect: every bookmaker's home-line
    kept (not reduced to one number), plus the set of book keys seen.
    Mirrors what index.html's old parseOdds()/homeLine() used to do
    client-side, now done once, server-side, for everyone.

    Also carries through The Odds API's own event `id` -- a stable
    32-character identifier, confirmed via Odds API's own docs to be
    shared across /odds and /scores for the same real-world game (the
    /scores endpoint accepts filtering by eventIds obtained from /odds,
    which only works if they're the same ID space). This flows through
    to index.html as `providerGameId` on each game/pick and lets grading
    match a pick to its final score directly instead of relying solely on
    parsing the stored matchup string and team-name matching -- see
    grade_picks.py's find_final_score() for where this is actually used,
    with team-name matching kept as the fallback for picks made before
    this existed."""
    games = []
    books_seen = set()
    for ev in events or []:
        home, away = ev.get("home_team"), ev.get("away_team")
        if not home or not away:
            continue
        books = {}
        for bk in (ev.get("bookmakers") or []):
            key = bk.get("key")
            if not key:
                continue
            line = _spread_home(bk, home)
            if line is not None:
                books[key] = line
                books_seen.add(key)
        if not books:
            continue
        games.append({
            "id": ev.get("id"),
            "away": away,
            "home": home,
            "commence": ev.get("commence_time"),
            "books": books,
        })
    return games, books_seen


# ---------------------------------------------------------------------------
# Access gate -- verified Clerk session token. This exact verify_user()
# function is duplicated in every api/*.py file (Vercel deploys each as an
# isolated function, no shared imports across files) -- api/state.py is the
# source-of-truth copy; keep this one in sync with it (tests/test_auth_sync.py
# checks for drift automatically).
# ---------------------------------------------------------------------------
_CLERK_JWKS_URL = os.environ.get("CLERK_JWKS_URL")
_jwks_client = None


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None and _CLERK_JWKS_URL:
        _jwks_client = PyJWKClient(_CLERK_JWKS_URL)
    return _jwks_client


def verify_user(handler):
    auth = handler.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    client = _get_jwks_client()
    if not client:
        return None
    try:
        signing_key = client.get_signing_key_from_jwt(token)
        payload = jwt.decode(token, signing_key.key, algorithms=["RS256"], options={"verify_aud": False})
        return payload.get("sub")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Shared-bucket write -- own dedicated key now (see SHARED_ODDS_KEY above),
# so a get-then-set here can only ever race against ANOTHER odds refresh,
# never against predictions or pool-publishing writes -- those are
# different keys entirely now. The one thing this still needs to read
# before writing is `booksSeen`, an accumulating set across refreshes
# (not a full replace) -- worst case on a same-key race, one refresh's
# addition to that set is briefly lost, which self-heals on the very next
# refresh since it's reporting "books seen so far," not point-in-time
# critical data. That's a fundamentally different risk level than the old
# combined key, where losing a write meant losing an entire OTHER domain's
# data (odds vs. predictions) with no self-healing at all.
# ---------------------------------------------------------------------------
def _kv_creds():
    url = (
        os.environ.get("KV_REST_API_URL")
        or os.environ.get("UPSTASH_REDIS_REST_URL")
        or os.environ.get("STORAGE_KV_REST_API_URL")
    )
    token = (
        os.environ.get("KV_REST_API_TOKEN")
        or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
        or os.environ.get("STORAGE_KV_REST_API_TOKEN")
    )
    return url, token


def _kv_get(key):
    base, token = _kv_creds()
    if not base or not token:
        return None
    req = urllib.request.Request(
        f"{base}/get/{urllib.parse.quote(key, safe='')}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode()).get("result")


def _kv_set(key, value_str):
    base, token = _kv_creds()
    if not base or not token:
        return False
    req = urllib.request.Request(
        f"{base}/set/{urllib.parse.quote(key, safe='')}",
        data=value_str.encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "text/plain"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        json.loads(res.read().decode())
        return True


# Rate-limit primitive duplicated from api/state.py for the same reason
# verify_user()/_kv_get()/_kv_set() are -- no shared imports across Vercel
# functions (see that file's docstring). See api/state.py's own comment
# on RATE_LIMIT_SCRIPT for the fixed-window design and why it fails open.
RATE_LIMIT_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if count > tonumber(ARGV[1]) then
  return 1
else
  return 0
end
"""


def _kv_eval(script, keys, args):
    base, token = _kv_creds()
    if not base or not token:
        return None
    body = json.dumps(["EVAL", script, len(keys), *keys, *args])
    req = urllib.request.Request(
        base,
        data=body.encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode()).get("result")


def rate_limited(uid, bucket, limit, window_seconds):
    try:
        result = _kv_eval(RATE_LIMIT_SCRIPT, [f"ratelimit:{bucket}:{uid}"], [str(limit), str(window_seconds)])
        return result == 1
    except Exception:
        return False


# Reads the shared odds cache and returns a response body in the SAME
# shape do_GET's real upstream-success path returns, IF it's younger than
# SHARED_FRESH_MINUTES and has at least one game -- otherwise returns
# None so the caller falls through to a real upstream fetch. Kept as its
# own function (rather than inlined in do_GET) so it's independently
# testable: this is the actual decision logic the freshness gate hinges
# on, not just plumbing.
SHARED_FRESH_MINUTES = 30

# --- Usage-protection fix: the shared ODDS_API_KEY is now Drew's own,
# real-money-funded key, and it's the DEFAULT for every signed-in person
# (no personal key required -- see the module docstring and the FAQ copy
# in app/index.html). That's the whole point ("baked into the tool for
# all users"), but it also means quota protection matters far more than
# when each person had their own separate budget. Two real gaps existed
# before this fix, both specific to the shared-key path (a personal key
# is that person's own budget and is unaffected by either):
#
#   1. THUNDERING HERD: the per-user cooldown a few lines below only
#      throttles the SAME person re-asking quickly. It does nothing when
#      many DIFFERENT signed-in people all see "the shared cache just
#      went stale" in the same instant (e.g. everyone's tab happens to
#      poll right as a kickoff-driven freshness window tightens) --
#      each of them independently decides upstream is warranted, and all
#      of them fire real API calls at once. GLOBAL_UPSTREAM_MIN_SECONDS
#      below bounds the ACTUAL upstream call rate system-wide, regardless
#      of how many different people are asking.
#   2. QUOTA EXHAUSTION: nothing previously stopped the shared key's
#      monthly quota from being spent down to zero by ordinary usage,
#      which would silently break live odds for EVERY signed-in person at
#      once with no warning. SHARED_QUOTA_FLOOR below refuses to spend
#      any more of the shared quota once the last known remaining-calls
#      count (already tracked via the provider's own x-requests-remaining
#      header, see merge_shared_odds()) drops too low, serving stale
#      cached data instead of a real call.
GLOBAL_UPSTREAM_MIN_SECONDS = 5
SHARED_QUOTA_FLOOR = 50
# Outer bound for serving shared odds regardless of the normal freshness
# window (used only when the global lock above defers this request to
# someone else's in-flight fetch, or the quota floor blocks a real call).
# A real network line can move a lot in 6 hours -- this is deliberately
# much looser than the normal freshness window, but still bounded, so a
# genuinely dead cache (Redis outage, first request ever) falls through
# to demo data client-side rather than serving something truly ancient.
STALE_ODDS_MAX_MINUTES = 60 * 6


def odds_fresh_minutes(games, now=None):
    """Dynamic shared-cache window: conserve quota early in the week,
    tighten automatically as the nearest posted kickoff approaches.
    """
    import datetime
    now = now or datetime.datetime.now(datetime.timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=datetime.timezone.utc)
    nearest = None
    for g in games or []:
        if not isinstance(g, dict):
            continue
        kick = _parse_iso_utc(g.get("commence"))
        if not kick or kick <= now:
            continue
        mins = (kick - now).total_seconds() / 60
        nearest = mins if nearest is None else min(nearest, mins)
    if nearest is not None and nearest <= 60:
        return 5
    if nearest is not None and nearest <= 6 * 60:
        return 10
    if nearest is not None and nearest <= 24 * 60:
        return 15
    return SHARED_FRESH_MINUTES


def _parse_shared_odds_blob(raw):
    """Pure parse of the shared-cache blob -> (current_dict, age_minutes)
    or None on any malformed/missing/empty input. Shared by the normal
    freshness-gated read, the any-age stale fallback, and the quota-floor
    peek below so all three agree on what counts as a valid cached blob."""
    if not raw:
        return None
    try:
        current = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(current, dict) or not current.get("lastGames"):
        return None
    updated_at = current.get("sharedUpdatedAt")
    if not updated_at:
        return None
    try:
        import datetime
        ts = datetime.datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        age_minutes = (datetime.datetime.now(datetime.timezone.utc) - ts).total_seconds() / 60
    except (ValueError, TypeError):
        return None
    return current, age_minutes


def _shared_odds_response(current):
    return {
        "games": current["lastGames"],
        "lastRefresh": current.get("lastRefresh"),
        "reqLeft": current.get("reqLeft"),
        "booksSeen": current.get("booksSeen") or [],
        "preKickLines": current.get("preKickLines") or {},
    }


def _fresh_shared_odds():
    parsed = _parse_shared_odds_blob(_kv_get(SHARED_ODDS_KEY))
    if parsed is None:
        return None
    current, age_minutes = parsed
    if age_minutes >= odds_fresh_minutes(current.get("lastGames") or []):
        return None
    return _shared_odds_response(current)


# Usage-protection fix (gap 1 above): used ONLY when the global upstream
# lock defers this request to whichever request is already covering this
# window -- ignores the normal freshness window entirely (that window
# exists to conserve quota, not to describe whether slightly-older data is
# still usable) and instead applies the much looser STALE_ODDS_MAX_MINUTES
# bound.
def _stale_shared_odds_any_age():
    parsed = _parse_shared_odds_blob(_kv_get(SHARED_ODDS_KEY))
    if parsed is None:
        return None
    current, age_minutes = parsed
    if age_minutes >= STALE_ODDS_MAX_MINUTES:
        return None
    return _shared_odds_response(current)


# Usage-protection fix (gap 2 above): peeks at the last known remaining-
# calls count WITHOUT the freshness gate (a quota-floor check has to work
# even when the cache is stale -- that's exactly when a real call is
# about to be spent). Returns None (never blocks) if there's no reliable
# reading yet, e.g. the very first request ever, or the provider hasn't
# returned the header -- refusing to serve on missing data would be worse
# than the exhaustion risk this exists to prevent.
def _shared_reqLeft():
    parsed = _parse_shared_odds_blob(_kv_get(SHARED_ODDS_KEY))
    if parsed is None:
        return None
    current, _age_minutes = parsed
    val = current.get("reqLeft")
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def merge_shared_odds(games, last_refresh, requests_remaining, books_seen):
    base, token = _kv_creds()
    if not base or not token:
        return False  # sync not configured -- odds still returned to the caller directly
    raw = _kv_get(SHARED_ODDS_KEY)
    try:
        current = json.loads(raw) if raw else {}
        if not isinstance(current, dict):
            current = {}
    except (TypeError, json.JSONDecodeError):
        current = {}
    current["lastGames"] = games
    current["lastRefresh"] = last_refresh
    if requests_remaining is not None:
        current["reqLeft"] = requests_remaining
    current["booksSeen"] = sorted(set(current.get("booksSeen") or []) | books_seen)
    current["preKickLines"] = merge_pre_kick_lines(current.get("preKickLines") or {}, games, last_refresh)
    import datetime
    current["sharedUpdatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    _kv_set(SHARED_ODDS_KEY, json.dumps(current))
    return True


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return

        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        personal_key = (self.headers.get("X-Odds-Api-Key") or "").strip()
        api_key = (personal_key or os.environ.get("ODDS_API_KEY") or "").strip()
        if not api_key:
            self._respond(401, {"message": "No Odds API key provided. Add one in Settings, or set ODDS_API_KEY."})
            return

        # Server-side freshness gate -- the client already avoids calling
        # this endpoint at all when its own local copy is under
        # SHARED_FRESH_MINUTES old, but that's purely a courtesy: nothing
        # stops a signed-in person from hitting this endpoint directly and
        # repeatedly, burning through the SHARED key's paid quota on
        # everyone's behalf. Only applies when using the shared
        # ODDS_API_KEY -- a personal key is that person's own budget, not
        # the pool's, so it skips this gate (the per-user cooldown below
        # still applies to both).
        if not personal_key:
            cached = _fresh_shared_odds()
            if cached is not None:
                self._respond(200, cached)
                return

            # Usage-protection fix, gap 1 (thundering herd): a GLOBAL fixed-
            # window lock, not per-user -- bounds how often this process
            # actually reaches upstream on the shared key's behalf,
            # regardless of how many different signed-in people asked in
            # the same instant. Whoever loses the race gets served
            # whatever's cached (even a few seconds stale) instead of also
            # spending a real call.
            if rate_limited("__global__", "odds_upstream_shared", 1, GLOBAL_UPSTREAM_MIN_SECONDS):
                fallback = _stale_shared_odds_any_age()
                if fallback is not None:
                    self._respond(200, fallback)
                    return
                self._respond(429, {"error": "Live odds are updating — try again in a few seconds."})
                return

            # Usage-protection fix, gap 2 (quota exhaustion): refuse to
            # spend any more of the SHARED key's quota once it's running
            # low, rather than silently running Drew's own paid plan to
            # zero and breaking live odds for every signed-in person at
            # once. A personal key is unaffected -- that's the person's own
            # budget, not the shared pool's.
            known_left = _shared_reqLeft()
            if known_left is not None and known_left < SHARED_QUOTA_FLOOR:
                fallback = _stale_shared_odds_any_age()
                if fallback is not None:
                    self._respond(200, fallback)
                    return
                self._respond(429, {"error": "Shared live odds are temporarily paused to protect the shared quota. Add your own personal API key in Settings to bypass this, or try again later."})
                return

        # Per-user cooldown on actually reaching upstream, regardless of
        # whether the freshness gate above applied -- guards against a
        # burst of near-simultaneous requests (e.g. several rapid clicks,
        # or a script loop) all arriving right as the shared cache goes
        # stale and all deciding upstream is warranted.
        if rate_limited(uid, "odds_refresh", 1, 30):
            self._respond(429, {"error": "Too many refresh attempts — please wait a bit before trying again."})
            return

        try:
            status, body, remaining = fetch_odds(
                api_key,
                (params.get("from", [None])[0] or None),
                (params.get("to", [None])[0] or None),
            )
        except urllib.error.URLError as e:
            _log_server_error("fetch_odds do_GET (upstream unreachable)", e)
            self._respond(502, {"error": "Couldn't reach the odds service — try again shortly."})
            return
        except Exception as e:
            _log_server_error("fetch_odds do_GET", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})
            return

        if status != 200:
            # Preserve the actionable status classes the client understands,
            # but never relay the odds provider's raw response body. The raw
            # upstream payload is outside our control and can contain provider
            # diagnostics that do not belong in the PickGauge UI.
            _log_server_error(f"fetch_odds do_GET (upstream HTTP {status})", RuntimeError(f"odds upstream status {status}"))
            headers = {"x-requests-remaining": remaining} if remaining is not None else None
            if status in (401, 403):
                # Feature-key failures use `message` so api-client.js treats
                # this as a key problem, not an expired Clerk session.
                self._respond(401, {"message": "Odds service rejected the API key."}, extra_headers=headers)
            elif status == 429:
                self._respond(429, {"error": "Odds service rate limit reached — try again later."}, extra_headers=headers)
            else:
                self._respond(502, {"error": "Odds service request failed — try again shortly."}, extra_headers=headers)
            return

        try:
            events = json.loads(body)
        except json.JSONDecodeError:
            self._respond(502, {"error": "Odds API returned an unexpected body."})
            return

        games, books_seen = extract_games(events)
        import datetime
        last_refresh = datetime.datetime.now(datetime.timezone.utc).isoformat()
        shared_persisted = False
        try:
            shared_persisted = bool(merge_shared_odds(games, last_refresh, remaining, books_seen))
        except Exception:
            pass  # shared-cache write is best-effort; the response below still succeeds

        self._respond(200, {
            "games": games,
            "lastRefresh": last_refresh,
            "reqLeft": remaining,
            "booksSeen": sorted(books_seen),
            # Current-refresh delta for the browser's local fallback path if
            # Redis is unavailable. A normal shared pull returns the full
            # retained map from the cache instead.
            "preKickLines": merge_pre_kick_lines({}, games, last_refresh),
            "sharedPersisted": shared_persisted,
        }, extra_headers={"x-requests-remaining": remaining} if remaining is not None else None)

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Odds-Api-Key")
        self.send_header("Access-Control-Expose-Headers", "x-requests-remaining")

    def _respond(self, status, data, extra_headers=None):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
