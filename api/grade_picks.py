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
import jwt
from jwt import PyJWKClient
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
    # Kept in sync with index.html's TEAM_ALIAS -- these two were added there
    # (Prediction Tracker naming dialect / UMass short form) but never ported
    # here, a real drift caught by collision-testing this file's team_match
    # against the JS copy over the full 138-team FBS roster.
    "miamifla": "miamiflorida",
    "umass": "massachusetts", "massachusetts": "massachusetts",
}
SIGNIFICANT_TOKENS = {
    "state", "st", "tech", "am", "southern", "northern", "eastern",
    "western", "central", "international", "atlantic", "ohio", "oh",
    "monroe", "lafayette", "birmingham",
    # Kept in sync with index.html -- found via collision-testing against
    # real CFBD alternateNames (Texas vs Texas-El Paso/Texas-San Antonio/
    # Texas Christian, Nevada vs Nevada-Las Vegas, Florida vs Florida Intl).
    "christian", "intl", "las", "vegas", "el", "paso", "san", "antonio",
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
    """Lists Redis keys matching a pattern via Upstash's REST SCAN command.
    KEYS blocks the whole Redis instance for the duration of the scan --
    harmless at a handful of users, but SCAN (cursor-based, incremental)
    costs nothing extra here and removes the need to revisit this later if
    the user count ever grows past "tens." Loops until the cursor returns
    to 0, same end result as KEYS but non-blocking server-side."""
    base, token = _kv_creds()
    if not base or not token:
        return []
    # Upstash's REST API takes command args as path segments (REST_URL/CMD/arg1/arg2/..),
    # not query params -- SCAN cursor MATCH pattern COUNT count becomes:
    #   /scan/{cursor}/match/{pattern}/count/{count}
    keys = []
    cursor = "0"
    while True:
        req = urllib.request.Request(
            f"{base}/scan/{cursor}/match/{urllib.parse.quote(pattern, safe='*')}/count/100",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            data = json.loads(res.read().decode())
        result = data.get("result") or [None, []]
        cursor, batch = result[0], (result[1] or [])
        keys.extend(batch)
        if cursor == "0" or cursor is None:
            break
    return keys


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
    # daysFrom=7 (was 3): a missed/delayed cron run, or picks archived a few
    # days late, used to fall outside the window and stay ungraded forever
    # since nothing ever re-checked them. 7 is The Odds API's practical
    # max for this endpoint's usefulness and comfortably covers a missed day
    # or two without adding a second API call.
    url = (
        f"https://api.the-odds-api.com/v4/sports/{ODDS_SPORT}/scores/"
        f"?daysFrom=7&apiKey={api_key}"
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


def _grade_history(history, scored_games):
    """Grades ONE history array (a list of {entries:[{picks:[...]}]} weeks)
    in place. Returns (graded, checked). This is the one reusable grading
    routine -- see grade_all_pending() below for why it now gets called
    once per history array instead of just the top-level board history."""
    graded = 0
    checked = 0
    for wk in history or []:
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


def grade_all_pending(state_obj, scored_games):
    """Grades one user's state object in place. Returns (graded, checked).

    BUG FIXED: this used to grade ONLY state_obj["history"] -- the
    overall/no-pool board's archived weeks. But archived picks made inside
    a pool context are saved under state_obj["pools"][i]["history"] instead
    (see index.html's activeHistory(): `p ? p.history : state.history`).
    Since pools are the primary real-usage path (Splash imports, pool
    tracking), this meant picks made in a pool -- almost all real picks --
    were structurally invisible to both the nightly cron and the manual
    "Grade now" button and would sit "pending" forever. Now every history
    array (the top-level one, plus each pool's own) goes through the same
    _grade_history() routine."""
    graded, checked = _grade_history(state_obj.get("history"), scored_games)
    for pool in state_obj.get("pools") or []:
        p_graded, p_checked = _grade_history(pool.get("history"), scored_games)
        graded += p_graded
        checked += p_checked
    return graded, checked


# ---------------------------------------------------------------------------
# Access gate -- this endpoint is hit two different ways: Vercel's own Cron
# scheduler (vercel.json), which authenticates with a raw CRON_SECRET bearer
# token per Vercel's convention, and manually from the app by a signed-in
# person clicking "Grade now" -- which needs real Clerk JWT verification,
# same as every other endpoint. Accept either. This exact verify_user()
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


def _pending_count(obj):
    """Counts ungraded picks across BOTH the top-level history and every
    pool's history -- mirrors _grade_history's traversal. The old version
    of this only checked state_obj["history"], which meant a user with
    ONLY pool picks pending (the common case) could report pending_total=0
    and skip grading entirely before ever spending the Odds API call."""
    def _count(history):
        return sum(
            1
            for wk in history or []
            for ent in wk.get("entries") or []
            for pk in ent.get("picks") or []
            if pk.get("result") is None
        )
    total = _count(obj.get("history"))
    for pool in obj.get("pools") or []:
        total += _count(pool.get("history"))
    return total


def _auth_mode(handler):
    """Returns ('cron', None), ('user', <clerk_uid>), or (None, None).
    'cron' -> Vercel's own scheduler (CRON_SECRET bearer token) -- may
              grade every account, exactly as before.
    'user' -> a real signed-in person clicking "Grade now" in the app --
              may ONLY grade their own account. Previously any signed-in
              user hitting this endpoint could enumerate and mutate every
              other user's picks; that's closed now."""
    uid = verify_user(handler)
    if uid:
        return "user", uid
    cron = os.environ.get("CRON_SECRET")
    auth = handler.headers.get("Authorization") or ""
    if cron and auth == f"Bearer {cron}":
        return "cron", None
    return None, None


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        mode, uid = _auth_mode(self)
        if not mode:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return
        try:
            odds_key = os.environ.get("ODDS_API_KEY")
            if mode == "cron":
                user_keys = kv_keys(USER_KEY_PREFIX + "*")
            else:
                # Browser-triggered "Grade now": only this person's own key,
                # never every user's.
                user_keys = [USER_KEY_PREFIX + uid]

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
                pending_total += _pending_count(obj)

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
                    # Bump the same _rev counter api/state.py's optimistic
                    # concurrency check uses -- otherwise a device that was
                    # mid-sync when grading ran could POST with a now-stale
                    # expectedRevision that still matches and overwrite the
                    # results this just wrote.
                    obj["_rev"] = (obj.get("_rev") or 0) + 1
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
