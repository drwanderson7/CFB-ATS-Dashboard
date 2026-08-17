"""
Vercel Python serverless function: GET /api/fetch_predictions

Fetches thepredictiontracker.com's weekly college-football CSV, returns it as
JSON, AND writes it into its own dedicated shared Redis key (server-owned
write -- see api/state.py's docstring for why the browser no longer POSTs
shared data directly, and for why this uses its own key rather than one
combined blob shared with fetch_odds.py and pool publishing).

Response shape (unchanged):
  {
    "games":   [ {"home": "...", "road": "...", "systems": {"sag": -3.5, ...}}, ... ],
    "systems": ["sag", "fpi", "donchess", ...],
    "count":   <number of games>
  }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import csv
import io
import datetime
import urllib.request
import urllib.error
import urllib.parse
import jwt
from jwt import PyJWKClient

# See api/state.py's own GENERIC_SERVER_ERROR/_log_server_error() comment.
GENERIC_SERVER_ERROR = "Something went wrong processing that request — try again shortly."


def _log_server_error(context, exc):
    print(f"[api/fetch_predictions.py] {context}: {exc}", file=sys.stderr)

CSV_URL = "https://www.thepredictiontracker.com/ncaapredictions.csv"
# Own dedicated key -- was "edge_board_shared" (one blob shared with
# fetch_odds.py's lastGames/lastRefresh/etc AND state.py's sharedPools).
# That meant a get-then-set race here could silently clobber odds data
# that landed in the gap, and vice versa -- two independent writers doing
# unprotected read-modify-write on the same key with no coordination
# between them. Splitting into per-domain keys doesn't just shrink the
# race window, it removes this specific cross-domain race entirely: this
# file can now never touch anything fetch_odds.py or state.py's pool
# publishing wrote, because it never reads or writes their key at all.
# See api/state.py's module docstring for the full picture and the
# migration fallback that reads the old combined key once during cutover.
SHARED_PREDICTIONS_KEY = "edge_board_shared_predictions"

# Columns that are NOT individual prediction systems: market lines, the site's
# own aggregates, probabilities, and structural columns.
META_COLUMNS = {
    "lineopen", "line", "linemidweek",
    "lineround", "lineavg", "linestd", "linemedian",
    "lineca",
    "phcover", "phwin",
    "neutral", "road", "home",
}


def parse_csv_text(text):
    reader = csv.DictReader(io.StringIO(text))
    games = []
    systems_seen = set()
    seen_matchups = set()
    for row in reader:
        home = (row.get("home") or "").strip()
        road = (row.get("road") or "").strip()
        if not home or not road:
            continue
        sig = (home.lower(), road.lower())
        if sig in seen_matchups:
            continue
        seen_matchups.add(sig)

        systems = {}
        for col, val in row.items():
            if not col or col in META_COLUMNS or not col.startswith("line"):
                continue
            val = (val or "").strip()
            if val == "":
                continue
            try:
                num = float(val)
            except ValueError:
                continue
            code = col[4:]
            systems[code] = -num
            systems_seen.add(code)

        def _num(v):
            v = (v or "").strip()
            try:
                return -float(v)
            except ValueError:
                return None
        home_vegas = _num(row.get("line"))
        if home_vegas is None:
            home_vegas = _num(row.get("lineopen"))

        if systems or home_vegas is not None:
            games.append({"home": home, "road": road,
                          "systems": systems, "homeVegas": home_vegas})

    return {
        "games": games,
        "systems": sorted(systems_seen),
        "count": len(games),
    }


def fetch_csv():
    req = urllib.request.Request(
        CSV_URL,
        headers={"User-Agent": "Mozilla/5.0 (PickGauge prediction sync)"},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1", errors="replace")


# ---------------------------------------------------------------------------
# Access gate -- verified Clerk session token. Duplicated across api/*.py
# (see api/state.py docstring for why); tests/test_auth_sync.py checks for
# drift automatically.
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
# Shared-bucket write -- own dedicated key now (see SHARED_PREDICTIONS_KEY
# above), so this is a plain SET, not a get-modify-set. Every field this
# writes (predictions, predMeta, sharedUpdatedAt) is a full replace of this
# key's own data, not a merge against something else might have written --
# there's nothing else's data on this key to accidentally preserve or lose.
# _kv_set duplicated from api/state.py for the same reason verify_user() is
# (see that file's docstring -- no shared imports across Vercel functions).
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


def _kv_set(key, value_str):
    base, token = _kv_creds()
    if not base or not token:
        return False
    req = urllib.request.Request(
        f"{base}/set/{key}",
        data=value_str.encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "text/plain"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        json.loads(res.read().decode())
        return True


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


# Rate-limit primitive duplicated from api/state.py -- see that file's
# comment on RATE_LIMIT_SCRIPT for the fixed-window design and why it
# fails open. No shared imports across Vercel functions (same reasoning
# as verify_user()'s own duplication, see this file's module docstring).
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


# Same freshness-gate idea as api/fetch_odds.py's _fresh_shared_odds() --
# the client already skips calling this endpoint when its local copy is
# recent (see SHARED_FRESH_MINUTES in app/index.html's main inline
# script), but that's client-side courtesy only. Reconstructs the
# {"games","systems","count"} shape do_GET's real-fetch path returns from
# the cached blob (which stores games under "predictions", not "games" --
# see write_shared_predictions() below), or returns None if the cache is
# missing/stale/empty so the caller falls through to a real CSV fetch.
SHARED_FRESH_MINUTES = 30


def _fresh_shared_predictions():
    raw = _kv_get(SHARED_PREDICTIONS_KEY)
    if not raw:
        return None
    try:
        current = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    games = current.get("predictions") if isinstance(current, dict) else None
    if not games:
        return None
    updated_at = current.get("sharedUpdatedAt")
    if not updated_at:
        return None
    try:
        ts = datetime.datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        age_minutes = (datetime.datetime.now(datetime.timezone.utc) - ts).total_seconds() / 60
    except (ValueError, TypeError):
        return None
    if age_minutes >= SHARED_FRESH_MINUTES:
        return None
    systems_seen = set()
    for g in games:
        systems_seen.update((g.get("systems") or {}).keys())
    return {"games": games, "systems": sorted(systems_seen), "count": len(games)}


def write_shared_predictions(games, count):
    base, token = _kv_creds()
    if not base or not token:
        return
    payload = {
        "predictions": games,
        "predMeta": {
            "fetchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "count": count,
        },
        "sharedUpdatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    _kv_set(SHARED_PREDICTIONS_KEY, json.dumps(payload))


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
        cached = _fresh_shared_predictions()
        if cached is not None:
            self._respond(200, cached)
            return
        if rate_limited(uid, "predictions_refresh", 1, 30):
            self._respond(429, {"error": "Too many refresh attempts — please wait a bit before trying again."})
            return
        try:
            text = fetch_csv()
            data = parse_csv_text(text)
            if not data["count"]:
                self._respond(200, {
                    "games": [], "systems": [], "count": 0,
                    "message": "No games in this week's prediction file yet.",
                })
                return
            try:
                write_shared_predictions(data["games"], data["count"])
            except Exception:
                pass  # shared-cache write is best-effort; response below still succeeds
            self._respond(200, data)
        except urllib.error.URLError as e:
            self._respond(502, {"error": "Couldn't reach the prediction source: " + str(e)})
        except Exception as e:
            _log_server_error("fetch_predictions do_GET", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
