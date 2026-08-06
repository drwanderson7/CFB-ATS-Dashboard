"""
Vercel Python serverless function: GET /api/grade_picks

Auto-grades ungraded picks in every user's Record/history using final scores
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

UPDATED for the shared/private storage split (see api/state.py): picks and
history are PRIVATE per person now, not one shared blob. This fetches final
scores ONCE (same cost regardless of how many people use the app), then
grades EVERY user's private key against that single scores pull -- so a
20-person deployment still costs one Odds API call per grading run, not 20.

Requires the same env vars as before:
  - KV_REST_API_URL / KV_REST_API_TOKEN  (already needed by api/state.py)
  - ODDS_API_KEY  -- server-side secret, separate from any device's local key.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

USER_KEY_PREFIX = "edge_board_user_"
ODDS_SPORT = "americanfootball_ncaaf"

# Team-name matching, kept deliberately identical in behaviour to the
# browser-side matcher in index.html. Works on TOKENS rather than a smashed
# string plus a hand-maintained mascot list -- that list could never be
# complete ("Kent State Golden Flashes" defeated it). Rule: one name's
# tokens must prefix the other's, and the leftover must not contain a token
# that changes school identity.
TEAM_ALIAS = {
    "olemiss": "olemiss", "mississippi": "olemiss",
    "miami": "miamiflorida", "miamifl": "miamiflorida", "miamiflorida": "miamiflorida",
    "miamioh": "miamiohio", "miamiohio": "miamiohio",
    "southernmiss": "southernmississippi", "southernmississippi": "southernmississippi",
    "ullafayette": "louisiana", "louisianalafayette": "louisiana",
    "ulmonroe": "louisianamonroe", "louisianamonroe": "louisianamonroe",
    "appstate": "appalachianstate", "appalachianst": "appalachianstate",
}
SIGNIFICANT_TOKENS = {
    "state", "st", "tech", "am", "southern", "northern", "eastern",
    "western", "central", "international", "atlantic", "ohio", "oh",
    "monroe", "lafayette", "birmingham",
}


def team_tokens(s):
    s = (s or "").lower().replace("&", "")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return [t for t in s.split() if t]


def _alias_of(toks):
    return TEAM_ALIAS.get("".join(toks))


def _prefix_ok(whole, toks):
    w = "".join(whole)
    for i in range(1, len(toks) + 1):
        if "".join(toks[:i]) == w:
            return not any(t in SIGNIFICANT_TOKENS for t in toks[i:])
    return False


def team_match(a, b):
    A, B = team_tokens(a), team_tokens(b)
    if not A or not B:
        return False
    aa, ba = _alias_of(A), _alias_of(B)
    if aa and ba:
        return aa == ba
    if aa or ba:
        target = aa or ba
        other = B if aa else A
        for i in range(1, len(other) + 1):
            pre = other[:i]
            if (_alias_of(pre) or "".join(pre)) == target:
                return not any(t in SIGNIFICANT_TOKENS for t in other[i:])
        return False
    return _prefix_ok(A, B) or _prefix_ok(B, A)


def grade(picked_score, opp_score, line):
    covering_margin = (picked_score - opp_score) + line
    if covering_margin > 0:
        return "W"
    if covering_margin < 0:
        return "L"
    return "P"


def _kv_creds():
    # See the matching comment in api/state.py -- checks legacy KV_REST_API_*,
    # Upstash's own UPSTASH_REDIS_REST_*, and Vercel Storage-tab's
    # STORAGE_KV_REST_API_* naming, since different connection paths have
    # been observed injecting different names.
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


def kv_keys(pattern):
    """Lists Redis keys matching a pattern via Upstash's REST KEYS command.
    Fine at the scale this app runs at (tens of users, not thousands) --
    KEYS is O(N) over the whole keyspace, which would be a bad idea on a
    huge shared Redis instance but isn't a concern here."""
    base, token = _kv_creds()
    if not base or not token:
        return []
    req = urllib.request.Request(
        f"{base}/keys/{urllib.parse.quote(pattern, safe='*')}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.loads(res.read().decode())
        return data.get("result") or []


def kv_get(key):
    base, token = _kv_creds()
    if not base or not token:
        return None
    req = urllib.request.Request(
        f"{base}/get/{urllib.parse.quote(key, safe='')}",
        headers={"Authorization": f"Bearer {token}"},
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


def kv_set(key, obj):
    base, token = _kv_creds()
    if not base or not token:
        return False
    body = json.dumps(obj)
    req = urllib.request.Request(
        f"{base}/set/{urllib.parse.quote(key, safe='')}",
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
    if " @ " not in matchup:
        return None
    away_name, home_name = matchup.split(" @ ", 1)
    for g in scored_games:
        if team_match(away_name, g["away"]) and team_match(home_name, g["home"]):
            return g
    return None


def grade_all_pending(state_obj, scored_games):
    """Grades one user's state object in place. Returns (graded, checked)."""
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


# ---------------------------------------------------------------------------
# Access gate -- identical pattern to the other functions.
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
    def do_GET(self):
        if not _authorized(self):
            self._respond(401, {"error": "Unauthorized — set the sync passphrase in Settings."})
            return
        try:
            odds_key = os.environ.get("ODDS_API_KEY")
            user_keys = kv_keys(USER_KEY_PREFIX + "*")

            if not user_keys:
                self._respond(200, {"graded": 0, "checked": 0, "users": 0, "message": "No synced users yet."})
                return

            # Figure out if there's anything to grade at all before spending
            # the one Odds API call this run gets.
            pending_total = 0
            user_states = {}
            for key in user_keys:
                obj = kv_get(key)
                if not obj:
                    continue
                user_states[key] = obj
                pending_total += sum(
                    1
                    for wk in obj.get("history") or []
                    for ent in wk.get("entries") or []
                    for pk in ent.get("picks") or []
                    if pk.get("result") is None
                )

            if pending_total == 0:
                self._respond(200, {"graded": 0, "checked": 0, "users": len(user_states), "message": "Nothing to grade."})
                return

            if not odds_key:
                self._respond(200, {
                    "graded": 0, "checked": pending_total, "users": len(user_states),
                    "message": "ODDS_API_KEY not set -- add it in Vercel project settings to enable auto-grading.",
                })
                return

            scores_payload = fetch_scores(odds_key)
            scored_games = score_lookup(scores_payload)

            total_graded = 0
            total_checked = 0
            users_updated = 0
            now_iso = datetime.now(timezone.utc).isoformat()
            for key, obj in user_states.items():
                graded, checked = grade_all_pending(obj, scored_games)
                total_graded += graded
                total_checked += checked
                if graded:
                    # Each user's OWN privateUpdatedAt, not a shared clock --
                    # their device compares this against its local copy the
                    # same way it does for any other private-tier change.
                    obj["privateUpdatedAt"] = now_iso
                    kv_set(key, obj)
                    users_updated += 1

            self._respond(200, {
                "graded": total_graded, "checked": total_checked,
                "users": len(user_states), "users_updated": users_updated,
                "message": f"Graded {total_graded} of {total_checked} pending pick(s) across {len(user_states)} user(s)." if total_graded
                           else f"Checked {total_checked} pending pick(s) across {len(user_states)} user(s); none had final scores available yet.",
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
