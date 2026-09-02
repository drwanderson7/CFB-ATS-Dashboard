"""
Vercel Python serverless function: GET /api/public_snapshot?view=odds|predictions|ratings

Public, UNAUTHENTICATED counterpart to fetch_odds.py / fetch_predictions.py /
fetch_cfbd.py's ratings view, built specifically to power the logged-out
Snapshot preview (no Clerk session required).

WHAT THIS IS: a deliberately narrow public window into PickGauge's shared
Redis caches. Ratings/predictions remain read-only cache views. Odds are
different: the logged-out Snapshot cannot function without a market line,
and the original implementation accidentally required a signed-in user to
have refreshed that shared cache recently. When the shared odds cache is
missing/stale, this endpoint may now perform ONE globally-cooldown-protected
refresh with the server-owned ODDS_API_KEY, persist that same shared market
snapshot, and serve it to the guest. Anonymous traffic therefore cannot
turn into one paid provider request per visitor: a Redis global cooldown,
provider-quota floor, normal cache freshness gate, and bounded stale fallback
protect the shared key. CFBD and prediction data are still never fetched
upstream from this public function.

WHY A SEPARATE FILE, NOT A NEW `public=1` BRANCH ON THE EXISTING THREE
ENDPOINTS: those three files gate everything on verify_user() as their
very first line, and their whole request-handling shape (personal-key
headers, per-user rate limiting, upstream retry/fallback) assumes an
authenticated caller. Bolting the guest flow directly onto the authenticated handlers would widen
their auth assumptions. This dedicated endpoint keeps the anonymous surface
explicit: only the odds view has a tightly guarded shared-key warm path;
ratings/predictions remain cache-only and no per-user state is reachable.
Same "no shared imports between serverless functions" constraint as every
other file here -- helpers below are intentionally duplicated, not imported.

WHAT'S DELIBERATELY TRIMMED vs. the authenticated responses, since this
data is now reachable by anyone on the internet, not just a signed-in
person:
  - odds: `reqLeft` (Drew's paid Odds API quota remaining) is omitted --
    no reason to expose usage/budget info publicly. `preKickLines` is
    also omitted -- it's pick-grading/CLV infrastructure, not something
    the logged-out preview renders.
  - predictions: this legacy public view remains filtered to `sag` only.
    The current guest Snapshot does NOT call it: the guest model is SP+-only,
    derived from the public ratings view. Keeping this view narrow avoids
    exposing the full aggregated prediction dataset if it is reused later.
  - ratings: each team's rating block is filtered down to ONLY `sp`
    (needed client-side for the existing `cfbdDerivedSpread()` SP+
    derivation) -- core/srs/elo/fpi are dropped, since those aren't part
    of the logged-out default and there's no reason to publish CFBD data
    this app doesn't even use in that view.

RATE LIMITING: normal requests are limited per request IP. In addition, the
odds self-warm has a separate GLOBAL Redis cooldown shared by every visitor.
That second limiter is the cost-control boundary: 1,000 anonymous visitors
arriving together can still produce at most one eligible shared-key warm
attempt during the cooldown window.

CACHING: unlike authenticated per-user endpoints, this response is identical
for anonymous callers and is CDN-cacheable. Fresh ready data gets 60 seconds;
not-ready/stale fallback responses get only 15 seconds so a successful warm
becomes visible quickly instead of being hidden behind a minute-long negative
cache.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import datetime
import urllib.parse
import urllib.request
import urllib.error

GENERIC_SERVER_ERROR = "Something went wrong processing that request — try again shortly."


def _log_server_error(context, exc):
    print(f"[api/public_snapshot.py] {context}: {exc}", file=sys.stderr)


# Same dedicated per-domain shared keys fetch_odds.py / fetch_predictions.py
# / fetch_cfbd.py own. Ratings/predictions are read-only here. The odds key
# may be updated only by the guarded public self-warm path below.
SHARED_ODDS_KEY = "edge_board_shared_odds"
SHARED_PREDICTIONS_KEY = "edge_board_shared_predictions"
RATINGS_CACHE_PREFIX = "pickgauge_cfbd_ratings_v1"

# Legacy predictions-view allowlist. The active logged-out Snapshot uses
# SP+ ONLY and therefore calls only odds + ratings; it does not request this
# predictions view. Keep the legacy view narrow if it is reused later.
PUBLIC_PREDICTION_SYSTEMS = ("sag",)

# Data older than these is treated as not-ready rather than served stale --
# a logged-out visitor has no refresh control and no context for "why does
# this look old," so a clear "check back soon" is more honest than quietly
# serving hours-old lines. Per-domain, NOT one shared value -- a real
# production gap (Aug 31, Drew): a single flat cutoff here was TIGHTER
# than the underlying server-side cache policy for ratings
# (api/fetch_cfbd.py's RATINGS_FRESH_SECONDS = 6 hours), which meant
# ratings data that was still perfectly valid and being served to
# signed-in users could get rejected here as "not ready" purely because
# this file's own cutoff was stricter than the data it was reading.
# Each cutoff below is set to roughly match (with a little slack) the
# real freshness policy of the cache it reads, not an arbitrary shared
# number.
MAX_AGE_MINUTES_ODDS = 360         # Real second instance of the same mistake ratings had (Aug 31, Drew): this was originally anchored to fetch_odds.py's SHARED_FRESH_MINUTES (30min, the "should we spend a real paid Odds API call" threshold) instead of that file's own worst-case "is this data still usable at all" bound, STALE_ODDS_MAX_MINUTES (6h) -- confirmed live: ratings at 201min old was genuinely fine once its own cutoff was fixed the same way, and odds was almost certainly sitting in the same multi-hour-but-still-real state, not actually empty.
MAX_AGE_MINUTES_PREDICTIONS = 60 * 24 * 7  # matches predictions' own real worst-case usability bound, STALE_FALLBACK_MAX_MINUTES in api/fetch_predictions.py (a week) -- same "anchor to the real bound, not a guess" fix as ODDS/RATINGS above. This view isn't currently called by the guest UI (SP+-only composite doesn't need it), kept correct regardless so it doesn't become the next version of this same bug if it's ever wired up.
MAX_AGE_MINUTES_RATINGS = 420      # ratings' real server policy (api/fetch_cfbd.py) is 6h (360min); slack to 7h so this cutoff is never the reason a still-valid cache gets rejected

# Guest Snapshot self-warm. The original public endpoint only READ the odds
# cache, so a quiet period with no signed-in line refresh could leave every
# new visitor on "Live data is warming up" forever. The public path may
# now refresh ONLY the shared market cache, with system-wide protections.
ODDS_SPORT = "americanfootball_ncaaf"
PUBLIC_ODDS_WARM_COOLDOWN_SECONDS = 5 * 60
PUBLIC_ODDS_QUOTA_FLOOR = 50
PUBLIC_ODDS_STALE_FALLBACK_MINUTES = 24 * 60
PUBLIC_ODDS_FETCH_TIMEOUT_SECONDS = 8
PUBLIC_KV_TIMEOUT_SECONDS = 3
PRE_KICK_RETENTION_DAYS = 35


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _age_minutes(iso_ts):
    if not iso_ts:
        return None
    try:
        ts = datetime.datetime.fromisoformat(str(iso_ts).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=datetime.timezone.utc)
        return (_now() - ts.astimezone(datetime.timezone.utc)).total_seconds() / 60
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Redis REST helpers -- duplicated per this project's no-shared-imports
# convention (see api/state.py's module docstring for the full reasoning).
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


def _kv_get_raw(key):
    base, token = _kv_creds()
    if not base or not token:
        return None
    req = urllib.request.Request(
        f"{base}/get/{urllib.parse.quote(key, safe='')}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=PUBLIC_KV_TIMEOUT_SECONDS) as res:
        return json.loads(res.read().decode()).get("result")


def _kv_get_json(key):
    raw = _kv_get_raw(key)
    if not raw:
        return None
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, json.JSONDecodeError):
        return None


def _kv_set_json(key, value):
    """Best-effort shared-cache write used only by the guarded odds warm."""
    base, token = _kv_creds()
    if not base or not token:
        return False
    req = urllib.request.Request(
        f"{base}/set/{urllib.parse.quote(key, safe='')}",
        data=json.dumps(value).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "text/plain"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=PUBLIC_KV_TIMEOUT_SECONDS) as res:
        json.loads(res.read().decode())
        return True


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
    with urllib.request.urlopen(req, timeout=PUBLIC_KV_TIMEOUT_SECONDS) as res:
        return json.loads(res.read().decode()).get("result")


def rate_limited(bucket_key, limit, window_seconds):
    """Fails OPEN (not rate-limited) if Redis/eval itself is unreachable --
    same fail-open reasoning as every other rate_limited() copy in this
    codebase: a Redis hiccup should degrade this endpoint to "no extra
    throttling this instant," not take the public preview down entirely."""
    try:
        result = _kv_eval(RATE_LIMIT_SCRIPT, [f"ratelimit:public_snapshot:{bucket_key}"], [str(limit), str(window_seconds)])
        return result == 1
    except Exception:
        return False


def client_ip(handler):
    fwd = handler.headers.get("x-forwarded-for") or handler.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip()
    return "__unknown__"


# ---------------------------------------------------------------------------
# Public odds self-warm helpers
# ---------------------------------------------------------------------------
def _parse_iso_utc(value):
    if not value:
        return None
    try:
        dt = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt.astimezone(datetime.timezone.utc)
    except (TypeError, ValueError):
        return None


def _spread_home(book, home_team):
    for market in book.get("markets") or []:
        if market.get("key") != "spreads":
            continue
        for outcome in market.get("outcomes") or []:
            if outcome.get("name") == home_team and outcome.get("point") is not None:
                return outcome["point"]
    return None


def _extract_odds_games(events):
    games = []
    books_seen = set()
    for ev in events or []:
        home, away = ev.get("home_team"), ev.get("away_team")
        if not home or not away:
            continue
        books = {}
        for book in ev.get("bookmakers") or []:
            key = book.get("key")
            if not key:
                continue
            line = _spread_home(book, home)
            if line is not None:
                books[key] = line
                books_seen.add(key)
        if not books:
            continue
        game = {
            "id": ev.get("id"),
            "away": away,
            "home": home,
            "commence": ev.get("commence_time"),
            "books": books,
        }
        if ev.get("away_rotation") is not None:
            game["awayRotation"] = ev["away_rotation"]
        if ev.get("home_rotation") is not None:
            game["homeRotation"] = ev["home_rotation"]
        games.append(game)
    return games, books_seen


def _merge_pre_kick_lines(previous, games, observed_at):
    observed_dt = _parse_iso_utc(observed_at)
    out = {}
    if isinstance(previous, dict):
        for key, rec in previous.items():
            if not isinstance(rec, dict):
                continue
            commence_dt = _parse_iso_utc(rec.get("commence"))
            if observed_dt and commence_dt and commence_dt < observed_dt - datetime.timedelta(days=PRE_KICK_RETENTION_DAYS):
                continue
            out[str(key)] = dict(rec)
    if not observed_dt:
        return out
    for game in games or []:
        commence_dt = _parse_iso_utc(game.get("commence"))
        if not commence_dt or observed_dt >= commence_dt:
            continue
        books_now = game.get("books") or {}
        if not books_now:
            continue
        key = str(game.get("id") or f'{game.get("away", "")} @ {game.get("home", "")} | {game.get("commence", "")}')
        old = out.get(key) if isinstance(out.get(key), dict) else {}
        books = dict(old.get("books") or {})
        book_observed = dict(old.get("bookObservedAt") or {})
        for book, line in books_now.items():
            if line is None:
                continue
            books[str(book)] = line
            book_observed[str(book)] = observed_at
        out[key] = {
            "id": game.get("id"), "away": game.get("away"), "home": game.get("home"),
            "commence": game.get("commence"), "books": books,
            "bookObservedAt": book_observed, "observedAt": observed_at,
        }
    return out


def _odds_api_url(api_key):
    params = {
        "regions": "us",
        "markets": "spreads",
        "oddsFormat": "american",
        "includeRotationNumbers": "true",
        "apiKey": api_key,
    }
    return f"https://api.the-odds-api.com/v4/sports/{ODDS_SPORT}/odds?{urllib.parse.urlencode(params)}"


def _fetch_live_odds(api_key):
    req = urllib.request.Request(
        _odds_api_url(api_key),
        headers={"User-Agent": "Mozilla/5.0 (PickGauge public preview warmer)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=PUBLIC_ODDS_FETCH_TIMEOUT_SECONDS) as res:
            return res.status, res.read(), res.headers.get("x-requests-remaining")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), exc.headers.get("x-requests-remaining")


def _odds_cache_record():
    current = _kv_get_json(SHARED_ODDS_KEY)
    if not isinstance(current, dict) or not current.get("lastGames"):
        return None, None
    age = _age_minutes(current.get("sharedUpdatedAt"))
    return current, age


def _public_odds_body(current, age, stale=False, source="cache"):
    return {
        "ready": True,
        "games": current["lastGames"],
        "lastRefresh": current.get("lastRefresh"),
        "booksSeen": current.get("booksSeen") or [],
        "asOfMinutes": round(age or 0),
        "stale": bool(stale),
        "source": source,
    }


def _merge_public_odds_cache(games, refreshed_at, requests_remaining, books_seen):
    current = _kv_get_json(SHARED_ODDS_KEY)
    if not isinstance(current, dict):
        current = {}
    else:
        current = dict(current)
    current["lastGames"] = games
    current["lastRefresh"] = refreshed_at
    if requests_remaining is not None:
        current["reqLeft"] = requests_remaining
    current["booksSeen"] = sorted(set(current.get("booksSeen") or []) | set(books_seen or []))
    current["preKickLines"] = _merge_pre_kick_lines(current.get("preKickLines") or {}, games, refreshed_at)
    current["sharedUpdatedAt"] = _now().isoformat()
    _kv_set_json(SHARED_ODDS_KEY, current)
    return current


def _warm_public_odds():
    """Return a usable public odds body, warming the shared cache if needed.

    Safety invariant: all anonymous callers share ONE Redis cooldown bucket,
    so traffic volume cannot scale paid upstream calls linearly. A known low
    provider quota blocks the warm and falls back to bounded recent cache.
    """
    current, age = _odds_cache_record()
    stale_body = None
    if current is not None and age is not None and age < PUBLIC_ODDS_STALE_FALLBACK_MINUTES:
        stale_body = _public_odds_body(current, age, stale=True, source="stale-cache")

    api_key = (os.environ.get("ODDS_API_KEY") or "").strip()
    if not api_key:
        return stale_body or {"ready": False, "reason": "odds-cache-empty"}

    known_left = None
    if current is not None:
        try:
            known_left = int(current.get("reqLeft")) if current.get("reqLeft") is not None else None
        except (TypeError, ValueError):
            known_left = None
    if known_left is not None and known_left < PUBLIC_ODDS_QUOTA_FLOOR:
        return stale_body or {"ready": False, "reason": "shared-quota-protected"}

    # One system-wide warm attempt per five minutes, regardless of IP count.
    if rate_limited("__global_odds_warm__", 1, PUBLIC_ODDS_WARM_COOLDOWN_SECONDS):
        return stale_body or {"ready": False, "reason": "odds-warm-in-progress"}

    try:
        status, raw_body, remaining = _fetch_live_odds(api_key)
        if status != 200:
            _log_server_error("public odds warm", RuntimeError(f"odds upstream status {status}"))
            return stale_body or {"ready": False, "reason": "odds-upstream-unavailable"}
        events = json.loads(raw_body)
        games, books_seen = _extract_odds_games(events)
        if not games:
            return stale_body or {"ready": False, "reason": "odds-upstream-empty"}
        refreshed_at = _now().isoformat()
        try:
            merged = _merge_public_odds_cache(games, refreshed_at, remaining, books_seen)
        except Exception as exc:
            # A Redis write failure should not throw away a perfectly valid
            # provider response for the visitor who paid the latency cost.
            _log_server_error("public odds warm cache write", exc)
            merged = {
                "lastGames": games, "lastRefresh": refreshed_at,
                "booksSeen": sorted(books_seen), "sharedUpdatedAt": refreshed_at,
            }
        return _public_odds_body(merged, 0, stale=False, source="live-warm")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        _log_server_error("public odds warm", exc)
        return stale_body or {"ready": False, "reason": "odds-upstream-unavailable"}
    except Exception as exc:
        _log_server_error("public odds warm unexpected", exc)
        return stale_body or {"ready": False, "reason": "odds-warm-failed"}


# ---------------------------------------------------------------------------
# View builders -- each reads one shared cache and trims it down to the
# public/default-composite shape described in the module docstring.
# ---------------------------------------------------------------------------
def build_odds_view():
    current, age = _odds_cache_record()
    if current is not None and age is not None and age < MAX_AGE_MINUTES_ODDS:
        return _public_odds_body(current, age, stale=False, source="cache")
    return _warm_public_odds()


def _trim_prediction_systems(games):
    out = []
    for g in games or []:
        if not isinstance(g, dict):
            continue
        systems = g.get("systems") or {}
        trimmed = {k: v for k, v in systems.items() if k in PUBLIC_PREDICTION_SYSTEMS}
        if not trimmed:
            continue
        out.append({"home": g.get("home"), "road": g.get("road"), "systems": trimmed})
    return out


def build_predictions_view():
    current = _kv_get_json(SHARED_PREDICTIONS_KEY)
    if not isinstance(current, dict) or not current.get("predictions"):
        return {"ready": False}
    age = _age_minutes(current.get("sharedUpdatedAt"))
    if age is None or age >= MAX_AGE_MINUTES_PREDICTIONS:
        return {"ready": False}
    games = _trim_prediction_systems(current["predictions"])
    if not games:
        return {"ready": False}
    return {
        "ready": True,
        "games": games,
        "systems": list(PUBLIC_PREDICTION_SYSTEMS),
        "count": len(games),
        "fetchedAt": (current.get("predMeta") or {}).get("fetchedAt"),
        "asOfMinutes": round(age),
    }


def _trim_rating(entry):
    if not isinstance(entry, dict):
        return None
    sp = entry.get("sp")
    if not sp:
        return None
    return {"team": entry.get("team"), "conference": entry.get("conference"), "sp": sp}


def build_ratings_view(year):
    cache_key = f"{RATINGS_CACHE_PREFIX}:{year}"
    current = _kv_get_json(cache_key)
    if not isinstance(current, dict) or not current.get("ratings"):
        return {"ready": False}
    age = _age_minutes(current.get("fetchedAt"))
    if age is None or age >= MAX_AGE_MINUTES_RATINGS:
        return {"ready": False}
    trimmed = [r for r in (_trim_rating(e) for e in current["ratings"]) if r]
    if not trimmed:
        return {"ready": False}
    return {
        "ready": True,
        "year": year,
        "ratings": trimmed,
        "asOfMinutes": round(age),
    }


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        view = (params.get("view", [""])[0] or "").strip().lower()
        if view not in ("odds", "predictions", "ratings"):
            self._respond(400, {"error": "view must be one of: odds, predictions, ratings"})
            return

        # Generous per-IP request window. Actual paid odds refreshes are
        # separately bounded by _warm_public_odds()'s GLOBAL cooldown +
        # quota floor, so rotating caller IPs cannot scale upstream spend.
        if rate_limited(client_ip(self), 60, 60):
            self._respond(429, {"ready": False, "error": "Too many requests — please slow down."})
            return

        try:
            if view == "odds":
                body = build_odds_view()
            elif view == "predictions":
                body = build_predictions_view()
            else:
                year = params.get("year", [None])[0]
                try:
                    year = int(year) if year else _now().year
                except (TypeError, ValueError):
                    year = _now().year
                body = build_ratings_view(year)
        except Exception as e:
            _log_server_error(f"do_GET view={view}", e)
            self._respond(500, {"ready": False, "error": GENERIC_SERVER_ERROR})
            return

        self._respond(200, body)

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        # Public/anonymous and identical across callers. Keep healthy data
        # cached for a minute, but negative/stale responses only 15 seconds
        # so a just-completed self-warm is not masked by CDN negative cache.
        cache_seconds = 60 if data.get("ready") and not data.get("stale") else 15
        self.send_header("Cache-Control", f"public, max-age={cache_seconds}, s-maxage={cache_seconds}")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
