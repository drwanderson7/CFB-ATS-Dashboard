"""
Vercel Python serverless function: GET /api/fetch_teams

Server-side proxy for CollegeFootballData.com's /teams endpoint, used only to
get each FBS team's logo URL for the board. Mirrors fetch_odds.py's pattern
(auth gate, CORS, thin server-side transform) but CFBD uses Bearer-token auth
in a header rather than an API-key query param, so the upstream call looks a
bit different.

Why server-side: CFBD requires the key in an Authorization header, which means
it can't be a plain browser fetch without exposing the key in every request
anyway -- routing it through here keeps the key server-side, consistent with
how ODDS_API_KEY is handled, and sidesteps any CORS behavior on their end.

Response shape (trimmed from CFBD's much larger per-team payload -- colors,
mascot, venue info, etc. aren't needed here, so they're dropped server-side
rather than relayed):
  {
    "teams": [ {"school": "Ohio State", "logo": "https://..."}, ... ],
    "count": <number of teams>
  }

Logos don't change mid-season, so the client is expected to fetch this once
and cache the result (see fetchTeamLogos() in index.html), not on every load.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.parse
import urllib.request
import urllib.error
import jwt
from jwt import PyJWKClient

CFBD_TEAMS_URL = "https://api.collegefootballdata.com/teams?classification=fbs"


def fetch_teams(api_key):
    req = urllib.request.Request(
        CFBD_TEAMS_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (PickGauge teams proxy)",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.status, res.read()


def trim(raw_json):
    """Keep only {school, logo} per team, and only teams that actually have a
    logo -- a missing logo is a null-safe non-match on the client, not worth
    carrying the row for."""
    teams = json.loads(raw_json)
    out = []
    for t in teams:
        school = t.get("school")
        logos = t.get("logos") or []
        if school and logos:
            out.append({"school": school, "logo": logos[0]})
    return out


# ---------------------------------------------------------------------------
# Access gate -- verified Clerk session token. This exact verify_user()
# function is duplicated in every api/*.py file (Vercel deploys each as an
# isolated function, no shared imports across files) -- api/state.py is the
# source-of-truth copy; keep this one in sync with it.
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


# Rate-limit primitive duplicated from api/state.py -- see that file's
# comment on RATE_LIMIT_SCRIPT for the fixed-window design and why it
# fails open. No shared imports across Vercel functions (same reasoning
# as verify_user()'s own duplication above). This file doesn't otherwise
# touch Redis at all -- logos are looked up live from CFBD and cached
# client-side for ~60 days (see this file's module docstring) -- so this
# is purely a backstop against a scripted loop, not a freshness gate like
# fetch_odds.py/fetch_predictions.py have.
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
        if rate_limited(uid, "teams_fetch", 5, 60):
            self._respond(429, {"error": "Too many requests — please wait a bit before trying again."})
            return

        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        api_key = (self.headers.get("X-Cfbd-Api-Key") or os.environ.get("CFBD_API_KEY") or "").strip()
        if not api_key:
            self._respond(401, {"message": "No CFBD API key configured. Set CFBD_API_KEY in Vercel, or send X-Cfbd-Api-Key."})
            return

        try:
            status, body = fetch_teams(api_key)
        except urllib.error.HTTPError as e:
            self._respond(e.code, {"error": f"CFBD returned {e.code}: {e.read().decode(errors='replace')}"})
            return
        except urllib.error.URLError as e:
            self._respond(502, {"error": "Couldn't reach CFBD: " + str(e)})
            return
        except Exception as e:
            self._respond(500, {"error": str(e)})
            return

        try:
            teams = trim(body)
        except Exception as e:
            self._respond(502, {"error": "CFBD response wasn't the expected shape: " + str(e)})
            return

        self._respond(status, {"teams": teams, "count": len(teams)})

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
