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
import urllib.parse
import urllib.request
import urllib.error
import jwt
from jwt import PyJWKClient

ODDS_SPORT = "americanfootball_ncaaf"
# Own dedicated key -- was "edge_board_shared" (one blob shared with
# fetch_predictions.py's predictions/predMeta AND state.py's sharedPools).
# A get-then-set race on that combined key could silently clobber whichever
# domain's write landed second. Splitting into per-domain keys removes that
# specific cross-domain race entirely, not just shrinks it -- this file can
# no longer touch predictions or sharedPools even if it wanted to, they're
# not on this key. See api/state.py's module docstring for the full picture.
SHARED_ODDS_KEY = "edge_board_shared_odds"
SHARED_ODDS_FIELDS = ("lastGames", "lastRefresh", "reqLeft", "booksSeen")


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


def merge_shared_odds(games, last_refresh, requests_remaining, books_seen):
    base, token = _kv_creds()
    if not base or not token:
        return  # sync not configured -- odds still returned to the caller directly
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
    import datetime
    current["sharedUpdatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    _kv_set(SHARED_ODDS_KEY, json.dumps(current))


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if not verify_user(self):
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return

        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        api_key = (self.headers.get("X-Odds-Api-Key") or os.environ.get("ODDS_API_KEY") or "").strip()
        if not api_key:
            self._respond(401, {"message": "No Odds API key provided. Add one in Settings, or set ODDS_API_KEY."})
            return

        try:
            status, body, remaining = fetch_odds(
                api_key,
                (params.get("from", [None])[0] or None),
                (params.get("to", [None])[0] or None),
            )
        except urllib.error.URLError as e:
            self._respond(502, {"error": "Couldn't reach the odds service: " + str(e)})
            return
        except Exception as e:
            self._respond(500, {"error": str(e)})
            return

        if status != 200:
            # Relay upstream status+body verbatim for 401/429/etc -- the app's
            # existing checks key off this status.
            self.send_response(status)
            self._cors()
            if remaining is not None:
                self.send_header("x-requests-remaining", remaining)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)
            return

        try:
            events = json.loads(body)
        except json.JSONDecodeError:
            self._respond(502, {"error": "Odds API returned an unexpected body."})
            return

        games, books_seen = extract_games(events)
        import datetime
        last_refresh = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            merge_shared_odds(games, last_refresh, remaining, books_seen)
        except Exception:
            pass  # shared-cache write is best-effort; the response below still succeeds

        self._respond(200, {
            "games": games,
            "lastRefresh": last_refresh,
            "reqLeft": remaining,
            "booksSeen": sorted(books_seen),
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
