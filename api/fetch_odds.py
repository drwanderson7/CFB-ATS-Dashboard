"""
Vercel Python serverless function: GET /api/fetch_odds

Server-side proxy for The Odds API's NCAAF spreads. The app used to call
api.the-odds-api.com directly from the browser, but a direct browser->API
request can fail outright ("Failed to fetch" / "network error") when CORS,
an ad/privacy blocker, or a network filter gets in the way -- and the browser
reports nothing useful about which. Routing the call through this function
(server-to-server) removes that entire class of failure, exactly like
parse_pdf.py and fetch_predictions.py already do for their sources.

Behaviour is a thin relay so the existing browser logic keeps working unchanged:
  - Same JSON body The Odds API returns (an array of events) on success, so the
    frontend's parseOdds() needs no changes.
  - The upstream HTTP status is mirrored, so the app's own checks for 401
    (bad key) and 429 (out of calls) still fire.
  - The `x-requests-remaining` header is passed through, so the "calls left"
    meter stays accurate.

API key: taken from the `key` query param (the browser's device-local key, kept
per-device as before), falling back to an ODDS_API_KEY environment variable if
the query param is absent -- so a deployment can also work without anyone pasting
a key, using the same server-side secret the grading cron already uses.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.parse
import urllib.request
import urllib.error

ODDS_SPORT = "americanfootball_ncaaf"


def build_url(api_key):
    q = urllib.parse.urlencode({
        "regions": "us",
        "markets": "spreads",
        "oddsFormat": "american",
        "apiKey": api_key,
    })
    return f"https://api.the-odds-api.com/v4/sports/{ODDS_SPORT}/odds?{q}"


def fetch_odds(api_key):
    """Returns (status, body_bytes, requests_remaining). Mirrors upstream
    status even for 401/429 so the browser can react the same way it did when
    it called the API directly."""
    req = urllib.request.Request(
        build_url(api_key),
        headers={"User-Agent": "Mozilla/5.0 (EdgeBoard odds proxy)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, res.read(), res.headers.get("x-requests-remaining")
    except urllib.error.HTTPError as e:
        # 401 (bad key), 429 (quota), 422 (bad params), etc. still carry a body
        # and often the remaining-requests header -- relay them intact.
        return e.code, e.read(), e.headers.get("x-requests-remaining")


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
        api_key = (params.get("key", [None])[0] or os.environ.get("ODDS_API_KEY") or "").strip()
        if not api_key:
            self._respond(401, {"message": "No Odds API key provided. Add one in Settings, or set ODDS_API_KEY."})
            return

        try:
            status, body, remaining = fetch_odds(api_key)
        except urllib.error.URLError as e:
            self._respond(502, {"error": "Couldn't reach the odds service: " + str(e)})
            return
        except Exception as e:
            self._respond(500, {"error": str(e)})
            return

        # Relay upstream status + body verbatim; parseOdds() reads the array,
        # and the app's 401/429 checks key off this status.
        self.send_response(status)
        self._cors()
        if remaining is not None:
            self.send_header("x-requests-remaining", remaining)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Edge-Key")
        # let same-origin JS read the quota header (harmless if same-origin)
        self.send_header("Access-Control-Expose-Headers", "x-requests-remaining")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
