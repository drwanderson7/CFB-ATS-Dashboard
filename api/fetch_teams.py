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

CFBD_TEAMS_URL = "https://api.collegefootballdata.com/teams?classification=fbs"


def fetch_teams(api_key):
    req = urllib.request.Request(
        CFBD_TEAMS_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (EdgeBoard teams proxy)",
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
# Optional access gate -- identical to the other functions.
# ---------------------------------------------------------------------------
def _authorized(handler):
    secret = os.environ.get("APP_SECRET")
    if not secret:
        return True
    if handler.headers.get("X-Edge-Key") == secret:
        return True
    cron = os.environ.get("CRON_SECRET")
    auth = handler.headers.get("Authorization") or ""
    if cron and auth == f"Bearer {cron}":
        return True
    return False


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if not _authorized(self):
            self._respond(401, {"error": "Unauthorized — set the sync passphrase in Settings."})
            return

        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        api_key = (params.get("key", [None])[0] or os.environ.get("CFBD_API_KEY") or "").strip()
        if not api_key:
            self._respond(401, {"message": "No CFBD API key configured. Set CFBD_API_KEY in Vercel, or pass ?key=."})
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Edge-Key")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
