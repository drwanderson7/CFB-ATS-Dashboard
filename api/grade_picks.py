"""
Vercel Python serverless function: GET /api/grade_picks

Auto-grades ungraded picks in every user's Record/history. Canonical picks use
CollegeFootballData final scores by stable `cfbdGameId`; The Odds API remains
a compatibility fallback for older picks that predate CFBD identity. Designed
to be triggered two ways:

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

Requires:
  - KV_REST_API_URL / KV_REST_API_TOKEN  (already needed by api/state.py)
  - CFBD_API_KEY -- primary final-score source for canonical picks
  - ODDS_API_KEY -- legacy fallback for picks without CFBD identity
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import re
import urllib.parse
import urllib.request
import urllib.error
import jwt
from jwt import PyJWKClient
from datetime import datetime, timezone

# See api/state.py's own GENERIC_SERVER_ERROR/_log_server_error() comment.
GENERIC_SERVER_ERROR = "Something went wrong processing that request — try again shortly."


def _log_server_error(context, exc):
    print(f"[api/grade_picks.py] {context}: {exc}", file=sys.stderr)

USER_KEY_PREFIX = "edge_board_user_"
ODDS_SPORT = "americanfootball_ncaaf"
CFBD_BASE_URL = "https://api.collegefootballdata.com"
CFBD_SCORE_CACHE_PREFIX = "pickgauge_cfbd_final_scores_v1"
CFBD_SCORE_FRESH_SECONDS = 5 * 60

# Team-name matching, kept deliberately identical in behaviour to the
# browser-side matcher in app/data/team-alias.js (was inline in index.html
# itself until a data-extraction pass moved it to its own file -- same
# content, same sync obligation, just a different path). Works on TOKENS
# rather than a smashed string plus a hand-maintained mascot list -- that
# list could never be complete ("Kent State Golden Flashes" defeated it).
# Rule: one name's tokens must prefix the other's, and the leftover must
# not contain a token that changes school identity.
TEAM_ALIAS = {
    "olemiss": "olemiss", "mississippi": "olemiss",
    "miami": "miamiflorida", "miamifl": "miamiflorida", "miamiflorida": "miamiflorida",
    "miamioh": "miamiohio", "miamiohio": "miamiohio",
    "southernmiss": "southernmississippi", "southernmississippi": "southernmississippi",
    "ullafayette": "louisiana", "louisianalafayette": "louisiana",
    "ulmonroe": "louisianamonroe", "louisianamonroe": "louisianamonroe",
    "appstate": "appalachianstate", "appalachianst": "appalachianstate",
    # Kept in sync with app/data/team-alias.js's TEAM_ALIAS -- these two
    # were added there (Prediction Tracker naming dialect / UMass short
    # form) but never ported here, a real drift caught by collision-testing
    # this file's team_match against the JS copy over the full 138-team
    # FBS roster.
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


def kv_eval(script, keys, args):
    """Atomic Lua EVAL via Upstash's REST API -- see api/state.py's copy
    of this function for the full explanation of why grading needs this
    instead of a plain get-then-set pair."""
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
        data = json.loads(res.read().decode())
        return data.get("result")


CAS_SCRIPT = """
local current = redis.call('GET', KEYS[1])
local current_rev = 0
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and decoded and decoded['_rev'] then current_rev = decoded['_rev'] end
end
local expected_rev = tonumber(ARGV[1])
if current_rev ~= expected_rev then
  return {'conflict', current_rev, current or ''}
end
redis.call('SET', KEYS[1], ARGV[2])
return {'ok', expected_rev + 1, ''}
"""


def cas_write(key, expected_rev, new_body_without_rev):
    """Same atomic compare-and-set as api/state.py's copy -- see there for
    the full docstring."""
    new_body = dict(new_body_without_rev)
    new_body["_rev"] = expected_rev + 1
    result = kv_eval(CAS_SCRIPT, [key], [str(expected_rev), json.dumps(new_body)])
    if not result or len(result) < 3:
        return None, None, None
    status, revision, current_raw = result[0], result[1], result[2]
    if status == "ok":
        return "ok", revision, None
    current = None
    if current_raw:
        try:
            current = json.loads(current_raw)
        except (TypeError, json.JSONDecodeError):
            current = None
    return "conflict", revision, current


def fetch_scores(api_key):
    """Legacy The Odds API score fetch. Kept only for pre-CFBD picks."""
    url = (
        f"https://api.the-odds-api.com/v4/sports/{ODDS_SPORT}/scores/"
        f"?daysFrom=7&apiKey={api_key}"
    )
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode())


def fetch_cfbd_scores(api_key, year):
    params = urllib.parse.urlencode({"year": year, "seasonType": "both", "classification": "fbs"})
    req = urllib.request.Request(
        f"{CFBD_BASE_URL}/games?{params}",
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json", "User-Agent": "PickGauge grader"},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode())


def score_lookup(scores_payload):
    """Normalize legacy Odds API scores into the grader's common shape."""
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
                "id": ev.get("id"), "provider_id": ev.get("id"), "cfbd_id": None,
                "away": away, "home": home,
                "away_id": None, "home_id": None,
                "away_score": int(away_score), "home_score": int(home_score),
                "source": "odds",
            })
        except (TypeError, ValueError):
            continue
    return out


def score_lookup_cfbd(games_payload):
    """Normalize completed CFBD /games rows. Exact CFBD IDs are authoritative."""
    out = []
    for g in games_payload or []:
        if not g.get("completed"):
            continue
        hp, ap = g.get("homePoints"), g.get("awayPoints")
        if hp is None or ap is None or g.get("id") is None:
            continue
        try:
            out.append({
                "id": g.get("id"), "provider_id": None, "cfbd_id": g.get("id"),
                "away": g.get("awayTeam"), "home": g.get("homeTeam"),
                "away_id": g.get("awayId"), "home_id": g.get("homeId"),
                "away_score": int(ap), "home_score": int(hp),
                "source": "cfbd",
            })
        except (TypeError, ValueError):
            continue
    return out


def _cache_fresh(payload, seconds=CFBD_SCORE_FRESH_SECONDS):
    if not isinstance(payload, dict) or not payload.get("fetchedAt"):
        return False
    try:
        dt = datetime.fromisoformat(str(payload["fetchedAt"]).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() < seconds
    except (TypeError, ValueError):
        return False


def cfbd_scores_for_year(api_key, year):
    """Five-minute shared cache so manual checks do not repeatedly pull a full season."""
    cache_key = f"{CFBD_SCORE_CACHE_PREFIX}:{year}"
    cached = kv_get(cache_key)
    if _cache_fresh(cached):
        return cached.get("games") or [], "cache"
    try:
        rows = score_lookup_cfbd(fetch_cfbd_scores(api_key, year))
        payload = {"fetchedAt": datetime.now(timezone.utc).isoformat(), "games": rows}
        try:
            kv_set(cache_key, payload)
        except Exception as exc:
            _log_server_error("CFBD score cache write", exc)
        return rows, "live"
    except (urllib.error.HTTPError, urllib.error.URLError):
        if cached and isinstance(cached.get("games"), list):
            return cached["games"], "stale"
        raise


def find_final_score(pick, scored_games):
    """Resolve by canonical CFBD game ID first, then Odds provider ID, then names.
    A raw matchup string remains accepted for backward-compatible tests/helpers.
    """
    if isinstance(pick, dict):
        cfbd_id = pick.get("cfbdGameId")
        provider_id = pick.get("providerGameId")
        matchup = pick.get("matchup")
    else:
        cfbd_id = None
        provider_id = None
        matchup = pick

    if cfbd_id is not None:
        for g in scored_games:
            if g.get("cfbd_id") is not None and str(g["cfbd_id"]) == str(cfbd_id):
                return g
    if provider_id:
        for g in scored_games:
            if g.get("provider_id") and g["provider_id"] == provider_id:
                return g
    if not matchup or " @ " not in matchup:
        return None
    away_name, home_name = matchup.split(" @ ", 1)
    for g in scored_games:
        if team_match(away_name, g.get("away")) and team_match(home_name, g.get("home")):
            return g
    return None


def _picked_scores(pick, game):
    """Orient a final score to the picked team, preferring canonical team ID."""
    picked_id = pick.get("cfbdPickedTeamId")
    if picked_id is not None:
        if game.get("home_id") is not None and str(picked_id) == str(game["home_id"]):
            return game["home_score"], game["away_score"]
        if game.get("away_id") is not None and str(picked_id) == str(game["away_id"]):
            return game["away_score"], game["home_score"]
    picked_team = pick.get("team") or ""
    if team_match(picked_team, game.get("home")):
        return game["home_score"], game["away_score"]
    if team_match(picked_team, game.get("away")):
        return game["away_score"], game["home_score"]
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
                g = find_final_score(pk, scored_games)
                if not g:
                    continue
                line = pk.get("line")
                if line is None:
                    continue
                oriented = _picked_scores(pk, g)
                if not oriented:
                    continue
                picked_score, opp_score = oriented
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

# Clerk's token issuer is deterministically the same Frontend API domain
# used for the JWKS URL, without the well-known suffix -- derived here,
# not guessed, so this stays correct automatically if CLERK_JWKS_URL is
# ever repointed (e.g. a future custom-domain change).
_CLERK_ISSUER = _CLERK_JWKS_URL.rsplit("/.well-known/jwks.json", 1)[0] if _CLERK_JWKS_URL else None

# Origins this app's own frontend is actually served from. Clerk's own
# guidance is to restrict a token's azp (authorized party) to known
# application origins, since accepting any azp exposes the app to
# cross-origin/session misuse.
#
# CONFIRMED against a real production Clerk token (Aug 26, decoded via
# jwt.io from window.Clerk.session.getToken() on live pickgauge.com):
# azp IS reliably populated -- "https://www.pickgauge.com" for a
# www-origin sign-in -- and the token had NO aud claim at all (Clerk
# simply doesn't issue one for this app's session tokens, confirming
# decode_kwargs's verify_aud=False below is correct behavior, not an
# unverified guess). Since azp's presence is now confirmed rather than
# assumed, a MISSING azp is fail-closed (rejected) below -- previously
# it was fail-open specifically because a wrong guess here would have
# silently broken every authenticated request in production with no way
# to catch it before a live deploy; that risk no longer applies now that
# a real token has actually been inspected.
#
# ADDED cfb-ats-dashboard.vercel.app (Aug 27): production auth moved off
# the clerk.pickgauge.com custom domain permanently (Drew's explicit
# call, since pickgauge.com itself is network-blocked on Drew's own work
# network -- categorized Gambling by Cisco Talos/Palo Alto/Fortinet) onto
# Clerk's Development instance. Drew confirmed cfb-ats-dashboard.
# vercel.app is now a real, permanent, first-class entry point for this
# app going forward (alongside pickgauge.com itself), not just a
# temporary testing URL -- so it's hardcoded here as a first-class
# origin, same as the other two, rather than left as a PICKGAUGE_
# ALLOWED_AZP env-var step someone could forget to set in production.
_ALLOWED_AZP = {"https://pickgauge.com", "https://www.pickgauge.com", "https://cfb-ats-dashboard.vercel.app"}
_ALLOWED_AZP.update(x.strip() for x in os.environ.get("PICKGAUGE_ALLOWED_AZP", "").split(",") if x.strip())


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None and _CLERK_JWKS_URL:
        _jwks_client = PyJWKClient(_CLERK_JWKS_URL)
    return _jwks_client


def verify_user(handler):
    """Returns the verified Clerk user ID from the Authorization header, or
    None if the token is missing, malformed, expired, signed with a key
    that doesn't match Clerk's published JWKS (i.e. forged), issued by a
    different issuer than this app's own Clerk instance, or authorized
    for a different (or missing) application origin."""
    auth = handler.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    client = _get_jwks_client()
    if not client:
        return None
    try:
        signing_key = client.get_signing_key_from_jwt(token)
        decode_kwargs = {"algorithms": ["RS256"], "options": {"verify_aud": False}}
        if _CLERK_ISSUER:
            decode_kwargs["issuer"] = _CLERK_ISSUER
        payload = jwt.decode(token, signing_key.key, **decode_kwargs)
        azp = payload.get("azp")
        if azp not in _ALLOWED_AZP:
            return None
        return payload.get("sub")
    except Exception:
        return None


# Rate-limit primitive duplicated from api/state.py -- see that file's
# comment on RATE_LIMIT_SCRIPT for the fixed-window design and why it fails
# open. No shared imports across Vercel functions (same reasoning as
# verify_user()'s own duplication above). Reuses this file's OWN _kv_creds()
# (already defined above, near kv_keys()/kv_get() for grading) rather than a
# second copy -- unlike most of the other api/*.py files, grade_picks.py
# already had Redis-credential access for its own (non-rate-limit) reasons.
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


def grade_and_write_user(key, scored_games, now_iso, max_retries=3):
    """Grades and atomically writes ONE user's state. Fixes the race the
    old version had: that version read every user's state ONCE at the top
    of the request, graded that snapshot, and wrote it back later with a
    manually-incremented _rev -- if the person added or changed a pick in
    between (perfectly normal; grading can take a few seconds), the write
    could silently overwrite their edit, since nothing re-checked whether
    the state had moved before writing.

    Now: read fresh, grade, atomic CAS-write (see cas_write in
    api/state.py's docstring for what makes this actually atomic, not
    just re-checked). On a conflict (someone else -- typically the
    person's own other device, or the person themselves -- wrote in the
    meantime), re-read the NEW current state and grade THAT instead of
    reapplying the stale result, up to max_retries times. grade_all_pending
    only ever touches picks with result=None, so recomputing from a fresh
    copy on every attempt is always safe -- never a duplicate or partial
    grade, just the correct grade applied to whatever the latest state
    actually is.

    Returns (graded, checked, written: bool).
    """
    for _attempt in range(max_retries):
        obj = kv_get(key)
        if not obj:
            return 0, 0, False
        current_rev = obj.get("_rev") or 0
        graded, checked = grade_all_pending(obj, scored_games)
        if not graded:
            return 0, checked, False  # nothing changed -- no write needed at all
        obj["privateUpdatedAt"] = now_iso
        obj.pop("_rev", None)  # cas_write assigns the new one
        status, _new_rev, _current = cas_write(key, current_rev, obj)
        if status == "ok":
            return graded, checked, True
        # status == "conflict": someone else wrote since we read -- loop
        # and grade the NEW current state from scratch, don't just retry
        # writing the same (now-stale) grading result.
    return 0, 0, False  # exhausted retries -- next cron run will catch any still-ungraded picks


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


def _pending_requirements(obj):
    """Return ({CFBD seasons}, has_legacy_pending) for one private state."""
    years, legacy = set(), False
    def scan(history):
        nonlocal legacy
        for wk in history or []:
            for ent in wk.get("entries") or []:
                for pk in ent.get("picks") or []:
                    if pk.get("result") is not None:
                        continue
                    if pk.get("cfbdGameId") is not None and pk.get("cfbdSeason") is not None:
                        try:
                            years.add(int(pk.get("cfbdSeason")))
                        except (TypeError, ValueError):
                            legacy = True
                    else:
                        legacy = True
    scan(obj.get("history"))
    for pool in obj.get("pools") or []:
        scan(pool.get("history"))
    return years, legacy


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
        # Only the manual "Check results now" browser trigger is rate-limited
        # here -- cron (mode=="cron") is Vercel's own scheduler hitting this
        # once a day via CRON_SECRET, not a person who could spam a button.
        # Same limit/window as the other manual "hits a paid external API"
        # refresh buttons (fetch_odds.py/fetch_predictions.py's
        # odds_refresh/predictions_refresh), since this one also spends the
        # same Odds API call when there's anything pending to grade.
        if mode == "user" and rate_limited(uid, "grade_picks", 1, 30):
            self._respond(429, {"error": "Too many requests — please wait a bit before trying again."})
            return
        try:
            odds_key = os.environ.get("ODDS_API_KEY")
            cfbd_key = os.environ.get("CFBD_API_KEY")
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

            # Pull canonical CFBD finals once per needed season. Only spend
            # The Odds API scores call when at least one pending pick is legacy
            # (no canonical game/season identity), or when CFBD is unavailable.
            years = set()
            has_legacy = False
            for obj in user_states.values():
                y, legacy = _pending_requirements(obj)
                years.update(y); has_legacy = has_legacy or legacy

            scored_games = []
            cfbd_failed = False
            if years and cfbd_key:
                for year in sorted(years):
                    try:
                        rows, _source = cfbd_scores_for_year(cfbd_key, year)
                        scored_games.extend(rows)
                    except (urllib.error.HTTPError, urllib.error.URLError) as exc:
                        cfbd_failed = True
                        _log_server_error(f"CFBD final scores {year}", exc)
            elif years:
                cfbd_failed = True

            need_odds = has_legacy or cfbd_failed
            if need_odds and odds_key:
                scored_games.extend(score_lookup(fetch_scores(odds_key)))

            if not scored_games and not cfbd_key and not odds_key:
                self._respond(200, {
                    "graded": 0, "checked": pending_total, "users": len(user_states),
                    "message": "No score provider is configured. Set CFBD_API_KEY (preferred) or ODDS_API_KEY in Vercel.",
                })
                return

            total_graded = 0
            total_checked = 0
            users_updated = 0
            now_iso = datetime.now(timezone.utc).isoformat()
            for key in user_states:
                graded, checked, written = grade_and_write_user(key, scored_games, now_iso)
                total_graded += graded
                total_checked += checked
                if written:
                    users_updated += 1

            self._respond(200, {
                "graded": total_graded, "checked": total_checked,
                "users": len(user_states), "users_updated": users_updated,
                "message": f"Graded {total_graded} of {total_checked} pending pick(s) across {len(user_states)} user(s)." if total_graded
                           else f"Checked {total_checked} pending pick(s) across {len(user_states)} user(s); none had final scores available yet.",
            })
        except urllib.error.URLError as e:
            _log_server_error("grade_picks do_GET (upstream unreachable)", e)
            self._respond(502, {"error": "Network error reaching KV or a score provider — try again shortly."})
        except Exception as e:
            _log_server_error("grade_picks do_GET", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

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
        self.send_header("Cache-Control", "private, no-store, max-age=0")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
