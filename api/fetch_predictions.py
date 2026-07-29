"""
Vercel Python serverless function: GET /api/fetch_predictions

Fetches thepredictiontracker.com's weekly college-football CSV and returns it as
JSON. The CSV carries one row per game and one column per computer prediction
system (~40 of them), every line already in HOME-team perspective -- the same
convention the board and parse_pdf.py use, so no sign-flipping is needed here.

Why server-side: the CSV host sends no CORS headers, so the browser can't fetch
it directly. This mirrors api/parse_pdf.py -- the browser hands the work to a
function and gets clean JSON back.

Response shape:
  {
    "games":   [ {"home": "...", "road": "...", "systems": {"sag": -3.5, ...}}, ... ],
    "systems": ["sag", "fpi", "donchess", ...],   # union of codes present this week
    "count":   <number of games>
  }

Each key in a game's "systems" dict is the CSV column name with the leading
"line" stripped ("linesag" -> "sag"), matching the codes the frontend toggles.

Nothing here decides which systems get used -- that's the user's per-device/synced
toggle set in the app. This endpoint just returns everything the CSV offers.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import csv
import io
import urllib.request
import urllib.error

CSV_URL = "https://www.thepredictiontracker.com/ncaapredictions.csv"

# Columns that are NOT individual prediction systems: market lines, the site's
# own aggregates, probabilities, and structural columns. These never appear as
# toggleable "systems" -- Vegas comes from The Odds API, and averaging the
# site's own average back into your average would double-count.
META_COLUMNS = {
    "lineopen", "line", "linemidweek",       # market: opening / current / midweek
    "lineround", "lineavg", "linestd", "linemedian",  # site aggregates
    "lineca",                                 # "computer adjusted line" (aggregate)
    "phcover", "phwin",                       # probabilities, not spreads
    "neutral", "road", "home",                # structural
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
        # The CSV occasionally repeats a game row verbatim; keep the first.
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
            code = col[4:]  # drop the "line" prefix -> short toggle code
            systems[code] = num
            systems_seen.add(code)

        if systems:
            games.append({"home": home, "road": road, "systems": systems})

    return {
        "games": games,
        "systems": sorted(systems_seen),
        "count": len(games),
    }


def fetch_csv():
    # A plain urlopen sometimes gets a bot-block; send a normal UA.
    req = urllib.request.Request(
        CSV_URL,
        headers={"User-Agent": "Mozilla/5.0 (EdgeBoard prediction sync)"},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read()
    # The file is plain ASCII/latin-1; decode leniently.
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1", errors="replace")


# ---------------------------------------------------------------------------
# Optional access gate -- identical to the other functions. If APP_SECRET isn't
# set, this is open (same as before); set it to require the passphrase.
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
        try:
            text = fetch_csv()
            data = parse_csv_text(text)
            if not data["count"]:
                self._respond(200, {
                    "games": [], "systems": [], "count": 0,
                    "message": "No games in this week's prediction file yet.",
                })
                return
            self._respond(200, data)
        except urllib.error.URLError as e:
            self._respond(502, {"error": "Couldn't reach the prediction source: " + str(e)})
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
