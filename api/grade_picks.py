"""
Vercel Python serverless function: GET /api/grade_picks

Auto-grades ungraded picks in the Record tab's history using final scores
from The Odds API. Designed to be triggered two ways:

  1. Vercel Cron (see the "crons" entry in vercel.json) -- runs once a day
     on the Hobby plan. Vercel sends an Authorization: Bearer $CRON_SECRET
     header on real cron invocations; this function does NOT require that
     header to be present, since it's also meant to be triggered manually
     from the app's "Check results now" button. Grading is idempotent and
     non-destructive (it only fills in results that are currently null),
     so allowing manual triggers from the browser carries no real risk.

  2. A manual fetch() from the app itself (Record tab -> "Check results
     now" button), for testing or for checking sooner than the daily
     schedule would.

Requires two environment variables, set in the Vercel dashboard:
  - KV_REST_API_URL / KV_REST_API_TOKEN  (already needed by api/state.py)
  - ODDS_API_KEY  -- a personal free-tier key from the-odds-api.com.
    This is intentionally SEPARATE from the API key stored in the app's
    browser localStorage: that one is per-device and never leaves the
    browser, while this one lives server-side as a secret so the cron
    job (which has no browser attached) can use it.

How grading works:
  - Pulls every pick across every history week with result == null.
  - Calls /v4/sports/americanfootball_ncaaf/scores once (daysFrom=3),
    a single request regardless of how many picks are pending.
  - Matches each pick's matchup to a completed game by team name.
  - Computes ATS result directly from final score + the spread the
    picked team got, independent of home/away side.
  - Writes any newly-graded results back to the same KV key api/state.py
    uses, so the change is visible next time any device syncs.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import urllib.request
import urllib.error

STATE_KEY = "edge_board_state"
ODDS_SPORT = "americanfootball_ncaaf"

TEAM_ALIAS = {
    "miamifl": "miamiflorida", "miamiflorida": "miamiflorida", "miami": "miamiflorida",
    "miamioh": "miamiohio", "miamiohio": "miamiohio",
    "olemiss": "olemiss", "mississippi": "olemiss",
    "southernmiss": "southernmississippi", "southernmississippi": "southernmississippi",
    "ullafayette": "louisiana", "louisianalafayette": "louisiana",
    "ulmonroe": "louisianamonroe",
    "appstate": "appalachianstate", "appalachianst": "appalachianstate",
}
MASCOT_RE = re.compile(
    r"(ducks|buckeyes|tigers|wildcats|huskies|cajuns|warhawks|aztecs|bulldogs|"
    r"bears|eagles|cougars|cardinals|gators|volunteers|sooners|longhorns|aggies|"
    r"rebels|hawkeyes|hokies|deacons|seminoles|cyclones|jayhawks|bobcats|"
    r"chippewas|broncos|wolfpack|panthers|mountaineers|gophers|spartans|"
    r"wolverines|knights|bearcats|owls|hurricanes|trojans|sundevils|cornhuskers|"
    r"mustangs|hoosiers|razorbacks|gamecocks|terrapins|badgers|utes|beavers|"
    r"rams|lobos|falcons|crimsontide|hornedfrogs|yellowjackets|bluedevils|"
    r"tarheels|commodores|cavaliers|minutemen|redhawks|midshipmen|blackknights)$"
)


def norm_team(s):
    n = (s or "").lower().replace("&", "and")
    n = re.sub(r"[^a-z0-9]", "", n)
    n = MASCOT_RE.sub("", n)
    return TEAM_ALIAS.get(n, n)


def team_match(a, b):
    A, B = norm_team(a), norm_team(b)
    if not A or not B:
        return False
    if A == B:
        return True
    if A.endswith("state") != B.endswith("state"):
        return False
    s, l = (A, B) if len(A) < len(B) else (B, A)
    return len(s) >= 3 and l.startswith(s)


def grade(picked_score, opp_score, line):
    """line is the spread from the PICKED team's own perspective --
    negative if that team was favored. Works identically regardless
    of whether the pick was the home or away side."""
    covering_margin = (picked_score - opp_score) + line
    if covering_margin > 0:
        return "W"
    if covering_margin < 0:
        return "L"
    return "P"


def _kv_creds():
    return os.environ.get("KV_REST_API_URL"), os.environ.get("KV_REST_API_TOKEN")


def kv_get_state():
    base, token = _kv_creds()
    if not base or not token:
        return None
    req = urllib.request.Request(
        f"{base}/get/{STATE_KEY}", headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.loads(res.read().decode())
        raw = data.get("result")
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return None


def kv_set_state(state_obj):
    base, token = _kv_creds()
    if not base or not token:
        return False
    body = json.dumps(state_obj)
    req = urllib.request.Request(
        f"{base}/set/{STATE_KEY}",
        data=body.encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "text/plain"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        json.loads(res.read().decode())
        return True


def fetch_scores(api_key):
    url = (
        f"https://api.the-odds-api.com/v4/sports/{ODDS_SPORT}/scores/"
        f"?daysFrom=3&apiKey={api_key}"
    )
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode())


def score_lookup(scores_payload):
    """Returns a list of {away, home, away_score, home_score} for completed
    games only, ready for fuzzy team-name matching."""
    out = []
    for ev in scores_payload or []:
        if not ev.get("completed"):
            continue
        home, away = ev.get("home_team"), ev.get("away_team")
        scores = {s["name"]: s.get("score") for s in (ev.get("scores") or [])}
        home_score = scores.get(home)
        away_score = scores.get(away)
        if home_score is None or away_score is None:
            continue
        try:
            out.append({
                "away": away, "home": home,
                "away_score": int(away_score), "home_score": int(home_score),
            })
        except (TypeError, ValueError):
            continue
    return out


def find_final_score(matchup, scored_games):
    """matchup is the stored 'Away @ Home' string. Returns the matching
    completed game's score dict, or None if not found / not final yet."""
    if " @ " not in matchup:
        return None
    away_name, home_name = matchup.split(" @ ", 1)
    for g in scored_games:
        if team_match(away_name, g["away"]) and team_match(home_name, g["home"]):
            return g
    return None


def grade_all_pending(state_obj, scored_games):
    graded = 0
    checked = 0
    for wk in state_obj.get("history") or []:
        for ent in wk.get("entries") or []:
            for pk in ent.get("picks") or []:
                if pk.get("result") is not None:
                    continue
                checked += 1
                matchup = pk.get("matchup") or ""
                g = find_final_score(matchup, scored_games)
                if not g:
                    continue
                away_name, home_name = matchup.split(" @ ", 1)
                picked_team = pk.get("team") or ""
                line = pk.get("line")
                if line is None:
                    continue
                if team_match(picked_team, g["home"]):
                    picked_score, opp_score = g["home_score"], g["away_score"]
                elif team_match(picked_team, g["away"]):
                    picked_score, opp_score = g["away_score"], g["home_score"]
                else:
                    continue
                pk["result"] = grade(picked_score, opp_score, line)
                graded += 1
    return graded, checked


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            odds_key = os.environ.get("ODDS_API_KEY")
            state_obj = kv_get_state()

            if state_obj is None:
                self._respond(200, {"graded": 0, "checked": 0, "message": "No synced data yet."})
                return

            pending = sum(
                1
                for wk in state_obj.get("history") or []
                for ent in wk.get("entries") or []
                for pk in ent.get("picks") or []
                if pk.get("result") is None
            )
            if pending == 0:
                self._respond(200, {"graded": 0, "checked": 0, "message": "Nothing to grade."})
                return

            if not odds_key:
                self._respond(200, {
                    "graded": 0, "checked": pending,
                    "message": "ODDS_API_KEY not set -- add it in Vercel project settings to enable auto-grading.",
                })
                return

            scores_payload = fetch_scores(odds_key)
            scored_games = score_lookup(scores_payload)
            graded, checked = grade_all_pending(state_obj, scored_games)

            if graded:
                kv_set_state(state_obj)

            self._respond(200, {
                "graded": graded, "checked": checked,
                "message": f"Graded {graded} of {checked} pending pick(s)." if graded
                           else f"Checked {checked} pending pick(s); none had final scores available yet.",
            })
        except urllib.error.URLError as e:
            self._respond(502, {"error": "Network error reaching KV or Odds API: " + str(e)})
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
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
