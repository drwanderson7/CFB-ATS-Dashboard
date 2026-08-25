"""
Vercel serverless proxy for CFBD live scoreboard + power ratings.

GET /api/fetch_cfbd?view=scoreboard
  - proxies CFBD /scoreboard (FBS by default)
  - shared Redis cache, 60-second freshness
  - returns canonical CFBD game/team IDs, live/final scores, period/clock,
    possession/situation, TV, and the provider's small betting/weather block

GET /api/fetch_cfbd?view=ratings&year=2026
  - fetches CFBD CORE, SP+, SRS, Elo, and FPI ratings
  - merges them by canonical CFBD team name
  - shared Redis cache, 6-hour freshness
  - partial provider failures are reported in `unavailable` rather than
    failing the whole response; ratings are informational only in the client

GET /api/fetch_cfbd?view=advanced&year=2026
  - fetches CFBD's season advanced team stats (`/stats/season/advanced`):
    PPA/play, success rate, explosiveness, and the standard-downs/passing-
    downs and rushing/passing splits, for BOTH offense and defense per team,
    plus defensive havoc rate
  - shared Redis cache, 6-hour freshness (same as ratings -- a season-level
    aggregate, not something that changes mid-week)
  - the server returns raw per-team offense/defense splits only; the CLIENT
    computes the actual "Team A offense vs Team B defense" comparison for a
    specific matchup (cfbdMatchupPanelHTML() in app/js/cfbd-insights.js),
    same division of responsibility as ratings (server: per-team data,
    client: per-game comparison)
  - Matchup Intelligence v1 (CURRENT_STATE.md). Context only, like ratings --
    does NOT feed Model #, Edge, Cover %, EV, or Model Agreement.
  - CAVEAT, PARTIALLY RESOLVED: field-name assumptions below
    (ppa/successRate/explosiveness/stuffRate/lineYards/standardDowns/
    passingDowns/rushingPlays/passingPlays/havoc) are CFBD's documented
    advanced-stats schema, trimmed defensively (every access is
    dict.get()-based, so an unexpectedly-missing/renamed field degrades to
    null/"—" in the UI rather than throwing) -- still not confirmed against
    a POPULATED response, since 2026 preseason has zero games played and
    CFBD correctly returns `[]` (see _handle_advanced()'s own comment for
    the real bug this caused and its fix). Re-check field names once real
    2026 games have been played and this array is non-empty.

GET /api/fetch_cfbd?view=boxscore&id=401403910
  - fetches CFBD's real, officially-documented advanced postgame box score
    (`/game/box/advanced?id=...`) for ONE completed game, keyed by the
    canonical cfbdGameId already frozen onto graded picks (cfbdPickIdentity()
    in app/js/pdf-import.js -- see closeWeek() in app/js/record.js for where
    it gets copied into the archived snapshot). Also fetches `/games/teams`
    for the same game id, for turnovers specifically (see caveat below).
  - shared Redis cache, 24-hour freshness -- deliberately longer than
    ratings/advanced (6h): a FINISHED game's box score is immutable, this
    isn't "how fresh is this" the way a season-in-progress aggregate is,
    it's "has this ever been fetched before."
  - Results detail ("why did this pick win or lose" -- CURRENT_STATE.md's
    Advanced postgame box-score analysis). Context only, like ratings/
    Matchup Intelligence -- does NOT feed Model #, Edge, Cover %, EV, or
    Model Agreement, and never touches the W/L/P grade itself (that's
    already decided by api/grade_picks.py or a manual override before this
    is ever fetched).
  - VERIFICATION NOTE, meaningfully stronger than Matchup Intelligence v1's:
    this endpoint's exact response shape (gameInfo/teams.successRates/
    teams.ppa/teams.explosiveness/teams.scoringOpportunities/teams.havoc/
    teams.rushing, each a per-team array) was checked against CFBD's own
    LIVE, current API reference (api.collegefootballdata.com/api/games,
    fetched directly while building this) with a full real example
    response, not just generic/remembered field-name knowledge -- this is
    the actual documented schema, not an assumption. It's also
    independently smoke-testable RIGHT NOW, unlike Matchup Intelligence:
    /game/box/advanced is keyed by a specific completed game, not "this
    season so far," so a real PAST game (e.g. a 2025 gameId) already has
    real data to check this against even before 2026 games are played.
  - ONE genuine remaining gap: turnovers. `/game/box/advanced` has no
    turnover field at all -- confirmed by reading its full documented
    schema, not assumed missing. Turnovers instead comes from a SECOND
    call, `/games/teams`, whose per-team stats are a flexible
    {category, stat} list with no fixed schema in CFBD's own docs. A
    "turnovers" category is confirmed to exist there by a well-established
    third-party CFBD wrapper (the cfbfastR R package explicitly documents
    a "Team turnovers" field sourced from this endpoint) -- but the EXACT
    string CFBD uses for that category was not independently confirmed
    against a live response in this environment. _extract_turnovers()
    below searches case-insensitively for it and degrades to null (shown
    as "—" client-side) rather than guessing wrong silently, but this
    specific piece still needs a real request to fully confirm.

GET /api/fetch_cfbd?view=lines&id=401403910
  - fetches CFBD's real, officially-documented historical betting lines
    (`/lines?gameId=...`) for ONE game, keyed by the same canonical
    cfbdGameId used everywhere else in this file. Returns every provider
    CFBD tracked for that game (DraftKings, consensus, etc.) plus a
    "preferred" pick (consensus first, else whichever provider came back
    first) -- the actual comparison math (against our OWN retained
    pre-kick line, home vs. picked-side conversion) happens client-side
    in cfbdLineComparisonHTML() (app/js/cfbd-insights.js), not here; this
    endpoint just returns CFBD's raw historical data, trimmed.
  - shared Redis cache, 24-hour freshness, same "finished game data is
    immutable" reasoning as boxscore above.
  - Results detail, alongside the postgame box score -- lets someone
    check CFBD's own independent historical record of the closing line
    against what PickGauge itself retained at pre-kick (CURRENT_STATE.md's
    Historical CFBD betting-line integration). Context/validation only --
    does NOT feed Model #, Edge, Cover %, EV, Model Agreement, OR the
    archived pick's own `closingLine`/CLV fields. Backfilling missing
    closingLine values from this data (for picks made before pre-kick
    retention existed) is explicitly a LATER, separate decision -- this
    ships as a side-by-side comparison a person reads, not something that
    writes into the grading/CLV pipeline. That's a real, higher-stakes
    change (CFBD data starting to silently influence displayed CLV
    numbers) that deserves its own explicit go-ahead, not something to
    bundle into a display feature.
  - VERIFICATION NOTE, same rigor as boxscore above: response shape
    (id/season/week/homeTeam/awayTeam/lines[] with provider/spread/
    spreadOpen/overUnder/homeMoneyline/awayMoneyline per entry) was
    checked against CFBD's own LIVE, current API reference
    (api.collegefootballdata.com/api/betting, fetched directly while
    building this), not assumed. The home-team-perspective SIGN
    CONVENTION (negative = home favored, matching every other system in
    this app already) was independently confirmed against a real
    third-party site that explicitly documents pulling from this exact
    CFBD feed -- not assumed from the schema alone, since a 0-valued
    example response can't reveal a sign convention. Also independently
    smoke-testable right now against any real past completed game, same
    as boxscore.

CFBD_API_KEY stays server-side. Clerk auth and Redis helpers intentionally
mirror the project's other isolated Vercel Python functions.
"""
from http.server import BaseHTTPRequestHandler
import concurrent.futures
import datetime
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import jwt
from jwt import PyJWKClient

GENERIC_SERVER_ERROR = "Something went wrong processing that request — try again shortly."
CFBD_BASE_URL = "https://api.collegefootballdata.com"
SCOREBOARD_CACHE_KEY = "pickgauge_cfbd_scoreboard_v1"
RATINGS_CACHE_PREFIX = "pickgauge_cfbd_ratings_v1"
ADVANCED_CACHE_PREFIX = "pickgauge_cfbd_advanced_v1"
BOXSCORE_CACHE_PREFIX = "pickgauge_cfbd_boxscore_v1"
SCOREBOARD_FRESH_SECONDS = 60
RATINGS_FRESH_SECONDS = 6 * 60 * 60
ADVANCED_FRESH_SECONDS = 6 * 60 * 60
# Deliberately longer than ratings/advanced (6h) -- a finished game's box
# score is immutable once final, so "freshness" here really just means
# "has this specific game ever been fetched before," not "how in-date is
# this season aggregate." 24h keeps a hot cache warm across a normal
# viewing session without needing a separate "never expires" cache
# convention this codebase doesn't otherwise use.
BOXSCORE_FRESH_SECONDS = 24 * 60 * 60
LINES_CACHE_PREFIX = "pickgauge_cfbd_lines_v1"
# Same reasoning as BOXSCORE_FRESH_SECONDS -- a finished game's historical
# closing line is immutable, so this is "has this game ever been fetched,"
# not a real freshness window.
LINES_FRESH_SECONDS = 24 * 60 * 60


def _log_server_error(context, exc):
    print(f"[api/fetch_cfbd.py] {context}: {exc}", file=sys.stderr)


def _cfbd_get(api_key, path, params=None):
    qs = urllib.parse.urlencode(params or {})
    url = f"{CFBD_BASE_URL}{path}" + (f"?{qs}" if qs else "")
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "PickGauge CFBD proxy",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode())


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _is_fresh(payload, seconds, now=None):
    if not isinstance(payload, dict) or not payload.get("fetchedAt"):
        return False
    now = now or datetime.datetime.now(datetime.timezone.utc)
    try:
        dt = datetime.datetime.fromisoformat(str(payload["fetchedAt"]).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return (now - dt.astimezone(datetime.timezone.utc)).total_seconds() < seconds
    except (TypeError, ValueError):
        return False


def _team_block(team):
    team = team or {}
    return {
        "id": team.get("id"),
        "name": team.get("name"),
        "conference": team.get("conference"),
        "classification": team.get("classification"),
        "points": team.get("points"),
        "lineScores": team.get("lineScores") or [],
        "winProbability": team.get("winProbability"),
    }


def trim_scoreboard(rows):
    out = []
    for g in rows or []:
        if g.get("id") is None:
            continue
        out.append({
            "id": g.get("id"),
            "startDate": g.get("startDate"),
            "startTimeTBD": bool(g.get("startTimeTBD")),
            "tv": g.get("tv"),
            "neutralSite": bool(g.get("neutralSite")),
            "conferenceGame": bool(g.get("conferenceGame")),
            "status": g.get("status"),
            "period": g.get("period"),
            "clock": g.get("clock"),
            "situation": g.get("situation"),
            "possession": g.get("possession"),
            "lastPlay": g.get("lastPlay"),
            "venue": g.get("venue") or {},
            "homeTeam": _team_block(g.get("homeTeam")),
            "awayTeam": _team_block(g.get("awayTeam")),
            "weather": g.get("weather") or {},
            "betting": g.get("betting") or {},
        })
    return out


def _latest_core(rows):
    """CORE may expose multiple through-week snapshots. Keep the latest per team."""
    latest = {}
    for r in rows or []:
        team = r.get("team")
        if not team:
            continue
        week = r.get("throughWeek")
        prev = latest.get(team)
        if prev is None or (week is not None and (prev.get("throughWeek") is None or week > prev.get("throughWeek"))):
            latest[team] = r
    return latest


def _index_by_team(rows):
    return {r.get("team"): r for r in (rows or []) if r.get("team")}


def merge_ratings(payloads, year):
    core = _latest_core(payloads.get("core") or [])
    sp = _index_by_team(payloads.get("sp") or [])
    srs = _index_by_team(payloads.get("srs") or [])
    elo = _index_by_team(payloads.get("elo") or [])
    fpi = _index_by_team(payloads.get("fpi") or [])
    names = sorted(set(core) | set(sp) | set(srs) | set(elo) | set(fpi))
    out = []
    for team in names:
        c, s, sr, e, f = core.get(team) or {}, sp.get(team) or {}, srs.get(team) or {}, elo.get(team) or {}, fpi.get(team) or {}
        conference = c.get("conference") or s.get("conference") or sr.get("conference") or e.get("conference") or f.get("conference")
        out.append({
            "year": year,
            "team": team,
            "conference": conference,
            "core": ({
                "overall": c.get("overall"),
                "offense": c.get("offense"),
                "defense": c.get("defense"),
                "throughWeek": c.get("throughWeek"),
                "throughSeasonType": c.get("throughSeasonType"),
                "modelVersion": c.get("modelVersion"),
            } if c else None),
            "sp": ({
                "rating": s.get("rating"),
                "ranking": s.get("ranking"),
                "sos": s.get("sos"),
                "offense": (s.get("offense") or {}).get("rating"),
                "defense": (s.get("defense") or {}).get("rating"),
                "specialTeams": (s.get("specialTeams") or {}).get("rating"),
            } if s else None),
            "srs": ({"rating": sr.get("rating"), "ranking": sr.get("ranking")} if sr else None),
            "elo": ({"elo": e.get("elo")} if e else None),
            "fpi": ({
                "fpi": f.get("fpi"),
                "offense": (f.get("efficiencies") or {}).get("offense"),
                "defense": (f.get("efficiencies") or {}).get("defense"),
                "overall": (f.get("efficiencies") or {}).get("overall"),
            } if f else None),
        })
    return out


def fetch_ratings(api_key, year):
    endpoints = {
        "core": ("/ratings/core", {"year": year}),
        "sp": ("/ratings/sp", {"year": year}),
        "srs": ("/ratings/srs", {"year": year}),
        "elo": ("/ratings/elo", {"year": year}),
        "fpi": ("/ratings/fpi", {"year": year}),
    }
    data, unavailable = {}, []

    # These rating feeds are independent. Fetch them concurrently so a cold
    # six-hour cache refresh costs roughly one upstream round trip instead of
    # five serial round trips. Partial failures remain isolated per system.
    def fetch_one(item):
        name, (path, params) = item
        try:
            return name, _cfbd_get(api_key, path, params), None
        except urllib.error.HTTPError as exc:
            _log_server_error(f"ratings {name} HTTP {exc.code}", exc)
            return name, None, exc.code
        except urllib.error.URLError as exc:
            _log_server_error(f"ratings {name} unreachable", exc)
            return name, None, 502

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(endpoints)) as pool:
        for name, rows, status in pool.map(fetch_one, endpoints.items()):
            if status is None:
                data[name] = rows
            else:
                unavailable.append({"rating": name, "status": status})
    return data, unavailable


def _advanced_splits(block):
    """One offense-or-defense-standard/passing-downs/rushing/passing split.
    Every access is .get()-based on purpose -- see this file's module
    docstring caveat on why (unverified live field names)."""
    block = block or {}
    return {
        "ppa": block.get("ppa"),
        "successRate": block.get("successRate"),
        "explosiveness": block.get("explosiveness"),
    }


def trim_advanced_team(row):
    """Trims one CFBD /stats/season/advanced row down to exactly what
    Matchup Intelligence v1 displays -- PPA/success rate/explosiveness for
    the team overall plus its standard-downs/passing-downs/rushing/passing
    splits, on BOTH offense and defense, plus defensive havoc. Everything
    else CFBD returns (down/distance breakdowns beyond this, garbage-time
    filtering flags, etc.) is deliberately left out -- not fed anywhere,
    not worth the payload size. Defensive throughout (row.get()/block.get()
    everywhere, never direct key access) so a missing or CFBD-renamed field
    degrades to null instead of throwing -- important here specifically
    since this endpoint's exact response shape hasn't been confirmed
    against live CFBD data yet (see module docstring)."""
    row = row or {}
    off = row.get("offense") or {}
    dfn = row.get("defense") or {}
    havoc = dfn.get("havoc") or {}

    def _side(block):
        return {
            **_advanced_splits(block),
            "stuffRate": block.get("stuffRate"),
            "lineYards": block.get("lineYards"),
            "standardDowns": _advanced_splits(block.get("standardDowns")),
            "passingDowns": _advanced_splits(block.get("passingDowns")),
            "rushingPlays": _advanced_splits(block.get("rushingPlays")),
            "passingPlays": _advanced_splits(block.get("passingPlays")),
        }

    return {
        "team": row.get("team"),
        "conference": row.get("conference"),
        "offense": _side(off),
        "defense": {
            **_side(dfn),
            "havoc": {
                "total": havoc.get("total"),
                "frontSeven": havoc.get("frontSeven"),
                "db": havoc.get("db"),
            },
        },
    }


def fetch_advanced_stats(api_key, year):
    rows = _cfbd_get(api_key, "/stats/season/advanced", {"year": year})
    return [trim_advanced_team(r) for r in (rows or []) if r.get("team")]


# --- Postgame box score (/game/box/advanced) -------------------------------
def trim_box_score(raw):
    """Trims CFBD's real, officially-documented /game/box/advanced response
    (see module docstring for the live-doc verification this was checked
    against) down to one flat per-team dict -- the SAME "team": {...}
    shape trim_advanced_team() produces for season stats, so the client's
    display helpers (_cfbdAdvDisplay() etc.) work identically for both.
    The raw response splits each metric into its OWN array
    (successRates/ppa/explosiveness/scoringOpportunities/havoc/rushing),
    each entry tagged by team name -- this regroups all of them by team
    into one object per team instead. Defensive throughout (every access
    is .get()-based) even though this schema IS confirmed live, since a
    provider can still change field names over time without warning."""
    raw = raw or {}
    game_info = raw.get("gameInfo") or {}
    teams_raw = raw.get("teams") or {}
    out = {}

    def _entry(name):
        return out.setdefault(name, {})

    for row in (teams_raw.get("successRates") or []):
        name = row.get("team")
        if not name:
            continue
        _entry(name)["successRate"] = (row.get("overall") or {}).get("total")
    for row in (teams_raw.get("ppa") or []):
        name = row.get("team")
        if not name:
            continue
        _entry(name)["ppa"] = (row.get("overall") or {}).get("total")
    for row in (teams_raw.get("explosiveness") or []):
        name = row.get("team")
        if not name:
            continue
        _entry(name)["explosiveness"] = (row.get("overall") or {}).get("total")
    for row in (teams_raw.get("scoringOpportunities") or []):
        name = row.get("team")
        if not name:
            continue
        e = _entry(name)
        e["scoringOpportunities"] = row.get("opportunities")
        e["pointsPerOpportunity"] = row.get("pointsPerOpportunity")
    for row in (teams_raw.get("havoc") or []):
        name = row.get("team")
        if not name:
            continue
        _entry(name)["havoc"] = row.get("total")
    for row in (teams_raw.get("rushing") or []):
        name = row.get("team")
        if not name:
            continue
        e = _entry(name)
        e["lineYards"] = row.get("lineYards")
        e["stuffRate"] = row.get("stuffRate")
        e["powerSuccess"] = row.get("powerSuccess")

    return {
        "gameInfo": {
            "homeTeam": game_info.get("homeTeam"),
            "awayTeam": game_info.get("awayTeam"),
            "homePoints": game_info.get("homePoints"),
            "awayPoints": game_info.get("awayPoints"),
            "homeWinner": game_info.get("homeWinner"),
        },
        "teams": out,
    }


def _extract_turnovers(game_team_stats_row):
    """`row` is one team's entry from GameTeamStats.teams -- a flexible
    {category, stat} list (see module docstring's caveat on why the exact
    category string isn't independently confirmed here). Case-insensitive
    match, degrades to None (never guesses/coerces a wrong stat) if not
    found."""
    for stat in ((game_team_stats_row or {}).get("stats") or []):
        category = str(stat.get("category") or "").strip().lower()
        if category == "turnovers":
            try:
                return int(stat.get("stat"))
            except (TypeError, ValueError):
                return None
    return None


def fetch_box_score(api_key, game_id):
    raw = _cfbd_get(api_key, "/game/box/advanced", {"id": game_id})
    trimmed = trim_box_score(raw)
    # Turnovers is a best-effort SECOND call -- if it fails outright, the
    # box score itself (the confirmed, primary data) is still worth
    # returning rather than failing the whole request over one optional field.
    try:
        team_stats_rows = _cfbd_get(api_key, "/games/teams", {"id": game_id})
    except Exception:
        team_stats_rows = None
    if isinstance(team_stats_rows, list) and team_stats_rows:
        for row in (team_stats_rows[0].get("teams") or []):
            name = row.get("team")
            if name and name in trimmed["teams"]:
                trimmed["teams"][name]["turnovers"] = _extract_turnovers(row)
    return trimmed


# --- Historical betting lines (/lines) --------------------------------
def trim_lines(raw):
    """Trims CFBD's real, officially-documented /lines response (see module
    docstring) down to the game's identity plus every provider's line,
    unchanged -- the "which provider is preferred" choice happens
    client-side (cfbdLineComparisonHTML(), app/js/cfbd-insights.js) so the
    UI can show every tracked book if it ever wants to, not just one.
    `raw` is the /lines endpoint's own response: a LIST (even when queried
    by a specific gameId, CFBD still returns an array), so this takes the
    first entry. Defensive throughout even though this schema IS
    confirmed live, same reasoning as trim_box_score. Deliberately does
    NOT include its own "gameId" key -- _handle_lines() below already
    carries the actually-REQUESTED id explicitly; including a second one
    here (from CFBD's own response) would risk it silently overwriting
    the requested id via dict-spread ordering, especially in the
    empty-fallback case where there'd be nothing real to put there."""
    if not isinstance(raw, list) or not raw:
        return {"homeTeam": None, "awayTeam": None, "lines": []}
    game = raw[0] or {}
    lines = []
    for row in (game.get("lines") or []):
        lines.append({
            "provider": row.get("provider"),
            "spread": row.get("spread"),
            "spreadOpen": row.get("spreadOpen"),
            "overUnder": row.get("overUnder"),
            "overUnderOpen": row.get("overUnderOpen"),
        })
    return {
        "homeTeam": game.get("homeTeam"),
        "awayTeam": game.get("awayTeam"),
        "lines": lines,
    }


def fetch_historical_lines(api_key, game_id):
    raw = _cfbd_get(api_key, "/lines", {"gameId": game_id})
    return trim_lines(raw)


# ------------------------- Clerk auth ------------------------------------
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
# cross-origin/session misuse. NOTE: azp is only enforced when the claim
# is PRESENT on the token -- this project hasn't yet inspected a real
# production-issued Clerk token to confirm azp is always populated for
# this app's specific sign-in flow, so an absent claim is not treated as
# a failure here (a wrong guess on that would silently break every
# authenticated request in production, with no way to catch it before a
# live deploy). Once that's confirmed against a real token, this should
# be tightened to fail-closed on a missing azp too.
_ALLOWED_AZP = {"https://pickgauge.com"}


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None and _CLERK_JWKS_URL:
        _jwks_client = PyJWKClient(_CLERK_JWKS_URL)
    return _jwks_client


def verify_user(handler):
    """Returns the verified Clerk user ID from the Authorization header, or
    None if the token is missing, malformed, expired, signed with a key
    that doesn't match Clerk's published JWKS (i.e. forged), issued by a
    different issuer than this app's own Clerk instance, or (when the
    claim is present) authorized for a different application origin."""
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
        if azp is not None and azp not in _ALLOWED_AZP:
            return None
        return payload.get("sub")
    except Exception:
        return None


# ------------------------- Redis + rate limit ----------------------------
def _kv_creds():
    url = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("STORAGE_KV_REST_API_URL")
    token = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("STORAGE_KV_REST_API_TOKEN")
    return url, token


def _kv_get(key):
    base, token = _kv_creds()
    if not base or not token:
        return None
    req = urllib.request.Request(f"{base}/get/{urllib.parse.quote(key, safe='')}", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=10) as res:
        raw = json.loads(res.read().decode()).get("result")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None


def _kv_set(key, obj):
    base, token = _kv_creds()
    if not base or not token:
        return False
    req = urllib.request.Request(
        f"{base}/set/{urllib.parse.quote(key, safe='')}",
        data=json.dumps(obj).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "text/plain"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        json.loads(res.read().decode())
    return True


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
    req = urllib.request.Request(base, data=body.encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode()).get("result")


def rate_limited(uid, bucket, limit, window_seconds):
    try:
        return _kv_eval(RATE_LIMIT_SCRIPT, [f"ratelimit:{bucket}:{uid}"], [str(limit), str(window_seconds)]) == 1
    except Exception:
        return False


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return
        if rate_limited(uid, "cfbd_insights", 12, 60):
            self._respond(429, {"error": "Too many CFBD refreshes — please wait a bit."})
            return

        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        view = (params.get("view") or ["scoreboard"])[0].lower()
        force = (params.get("force") or ["0"])[0] == "1"
        key = (os.environ.get("CFBD_API_KEY") or "").strip()
        if not key:
            self._respond(401, {"message": "CFBD_API_KEY is not configured in Vercel."})
            return

        try:
            if view == "scoreboard":
                self._handle_scoreboard(key, force)
                return
            if view == "ratings":
                try:
                    year = int((params.get("year") or [str(datetime.datetime.now().year)])[0])
                except (TypeError, ValueError):
                    self._respond(400, {"error": "Invalid season year."})
                    return
                if year < 2000 or year > 2100:
                    self._respond(400, {"error": "Invalid season year."})
                    return
                self._handle_ratings(key, year, force)
                return
            if view == "advanced":
                try:
                    year = int((params.get("year") or [str(datetime.datetime.now().year)])[0])
                except (TypeError, ValueError):
                    self._respond(400, {"error": "Invalid season year."})
                    return
                if year < 2000 or year > 2100:
                    self._respond(400, {"error": "Invalid season year."})
                    return
                self._handle_advanced(key, year, force)
                return
            if view == "boxscore":
                try:
                    game_id = int((params.get("id") or [""])[0])
                except (TypeError, ValueError):
                    self._respond(400, {"error": "A valid game id is required."})
                    return
                self._handle_boxscore(key, game_id, force)
                return
            if view == "lines":
                try:
                    game_id = int((params.get("id") or [""])[0])
                except (TypeError, ValueError):
                    self._respond(400, {"error": "A valid game id is required."})
                    return
                self._handle_lines(key, game_id, force)
                return
            self._respond(400, {"error": "Unknown CFBD view."})
        except urllib.error.HTTPError as exc:
            # Read CFBD's own response body for the SERVER LOG only -- never
            # forwarded to the browser (this project never returns raw
            # upstream error text to the client, same redaction discipline
            # as every other api/*.py file). Added specifically because a
            # real 401/403 investigation (Matchup Intelligence v1's
            # /stats/season/advanced) showed this file previously logged
            # only the exception object, not CFBD's actual explanation --
            # which meant a 401 (bad/missing key) and a 403 (key fine, not
            # authorized for THIS endpoint) were indistinguishable from the
            # logs alone, and neither told us WHY. exc.read() can only be
            # called once and only while the error is still "live," so it
            # has to happen here, not by re-deriving it later.
            try:
                cfbd_body = exc.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                cfbd_body = "(could not read CFBD response body)"
            _log_server_error(f"do_GET upstream HTTP {exc.code} on view={view}: {cfbd_body}", exc)
            if exc.code in (401, 403):
                self._respond(401, {"message": "CFBD rejected the API key or this endpoint is unavailable on the current CFBD tier."})
            elif exc.code == 429:
                self._respond(429, {"error": "CFBD rate limit reached — try again later."})
            else:
                self._respond(502, {"error": "CFBD request failed — try again shortly."})
        except urllib.error.URLError as exc:
            _log_server_error("do_GET upstream unreachable", exc)
            self._respond(502, {"error": "Couldn't reach CFBD — try again shortly."})
        except Exception as exc:
            _log_server_error("do_GET", exc)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

    def _handle_scoreboard(self, key, force):
        cached = None
        try:
            cached = _kv_get(SCOREBOARD_CACHE_KEY)
        except Exception as exc:
            _log_server_error("scoreboard cache read", exc)
        if not force and _is_fresh(cached, SCOREBOARD_FRESH_SECONDS):
            body = dict(cached); body["source"] = "cache"
            self._respond(200, body); return
        try:
            rows = _cfbd_get(key, "/scoreboard", {"classification": "fbs"})
            payload = {"fetchedAt": _now_iso(), "source": "live", "games": trim_scoreboard(rows)}
            try:
                _kv_set(SCOREBOARD_CACHE_KEY, payload)
            except Exception as exc:
                _log_server_error("scoreboard cache write", exc)
            self._respond(200, payload)
        except (urllib.error.HTTPError, urllib.error.URLError):
            if cached:
                body = dict(cached); body["source"] = "stale"
                self._respond(200, body)
                return
            raise

    def _handle_ratings(self, key, year, force):
        cache_key = f"{RATINGS_CACHE_PREFIX}:{year}"
        cached = None
        try:
            cached = _kv_get(cache_key)
        except Exception as exc:
            _log_server_error("ratings cache read", exc)
        if not force and _is_fresh(cached, RATINGS_FRESH_SECONDS):
            body = dict(cached); body["source"] = "cache"
            self._respond(200, body); return
        data, unavailable = fetch_ratings(key, year)
        ratings = merge_ratings(data, year)
        if not ratings and cached:
            body = dict(cached); body["source"] = "stale"
            self._respond(200, body); return
        if not ratings:
            self._respond(502, {"error": "No CFBD rating systems were available."}); return
        payload = {"year": year, "fetchedAt": _now_iso(), "source": "live", "ratings": ratings, "unavailable": unavailable}
        # Only store a complete snapshot for the long 6h cache. A partial
        # response is still useful now, but retry on the next request so a
        # transient single-rating outage doesn't get frozen for six hours.
        if not unavailable:
            try:
                _kv_set(cache_key, payload)
            except Exception as exc:
                _log_server_error("ratings cache write", exc)
        self._respond(200, payload)

    def _handle_advanced(self, key, year, force):
        cache_key = f"{ADVANCED_CACHE_PREFIX}:{year}"
        cached = None
        try:
            cached = _kv_get(cache_key)
        except Exception as exc:
            _log_server_error("advanced-stats cache read", exc)
        if not force and _is_fresh(cached, ADVANCED_FRESH_SECONDS):
            body = dict(cached); body["source"] = "cache"
            self._respond(200, body); return
        try:
            teams = fetch_advanced_stats(key, year)
        except (urllib.error.HTTPError, urllib.error.URLError):
            if cached:
                body = dict(cached); body["source"] = "stale"
                self._respond(200, body)
                return
            raise
        # An empty `teams` list here is a LEGITIMATE, expected CFBD response,
        # not a failure -- confirmed against a real request (year=2026,
        # August, zero games played yet): CFBD returns 200 with body `[]`,
        # not an error, because /stats/season/advanced computes CUMULATIVE
        # season stats from games actually played, and there's nothing to
        # aggregate yet in the preseason. The OLD code here treated any
        # empty result as an upstream failure and threw a 502 -- which is
        # exactly what broke Matchup Intelligence v1 the first time anyone
        # actually loaded it in preseason: CFBD never rejected anything, our
        # own code manufactured an error out of a normal "no data yet"
        # response. Cache and return it like any other successful result;
        # the client already renders an empty state gracefully for this
        # (cfbdMatchupPanelHTML() in app/js/cfbd-insights.js) once real
        # season data starts showing up (after Week 0/1 games), the next
        # 6-hour cache refresh will pick it up naturally.
        payload = {"year": year, "fetchedAt": _now_iso(), "source": "live", "teams": teams}
        try:
            _kv_set(cache_key, payload)
        except Exception as exc:
            _log_server_error("advanced-stats cache write", exc)
        self._respond(200, payload)

    def _handle_boxscore(self, key, game_id, force):
        cache_key = f"{BOXSCORE_CACHE_PREFIX}:{game_id}"
        cached = None
        try:
            cached = _kv_get(cache_key)
        except Exception as exc:
            _log_server_error("boxscore cache read", exc)
        if not force and _is_fresh(cached, BOXSCORE_FRESH_SECONDS):
            body = dict(cached); body["source"] = "cache"
            self._respond(200, body); return
        try:
            box = fetch_box_score(key, game_id)
        except (urllib.error.HTTPError, urllib.error.URLError):
            if cached:
                body = dict(cached); body["source"] = "stale"
                self._respond(200, body)
                return
            raise
        # An empty `teams` dict here means CFBD genuinely has nothing for
        # this game id (e.g. the game hasn't been played/finalized yet, or
        # advanced stats simply weren't tracked for it -- some lower-
        # profile/non-FBS games lack full play-by-play coverage). Same
        # "empty is a valid answer, not a failure" reasoning as
        # _handle_advanced()'s own fix -- cache and return it rather than
        # manufacturing a 502 out of a legitimate "nothing here" response.
        # The client already renders nothing for an empty box score
        # (cfbdPostgamePanelHTML() in app/js/cfbd-insights.js).
        payload = {"gameId": game_id, "fetchedAt": _now_iso(), "source": "live", **box}
        try:
            _kv_set(cache_key, payload)
        except Exception as exc:
            _log_server_error("boxscore cache write", exc)
        self._respond(200, payload)

    def _handle_lines(self, key, game_id, force):
        cache_key = f"{LINES_CACHE_PREFIX}:{game_id}"
        cached = None
        try:
            cached = _kv_get(cache_key)
        except Exception as exc:
            _log_server_error("lines cache read", exc)
        if not force and _is_fresh(cached, LINES_FRESH_SECONDS):
            body = dict(cached); body["source"] = "cache"
            self._respond(200, body); return
        try:
            lines = fetch_historical_lines(key, game_id)
        except (urllib.error.HTTPError, urllib.error.URLError):
            if cached:
                body = dict(cached); body["source"] = "stale"
                self._respond(200, body)
                return
            raise
        # An empty `lines` list is a legitimate answer, same "empty is
        # valid, not a failure" lesson applied proactively here from the
        # start (see boxscore's own comment above for the production
        # incident that taught this the hard way for Matchup Intelligence):
        # not every game has tracked betting lines -- lower-profile
        # matchups, FCS opponents, and some early-season games can
        # genuinely have zero coverage. Cache and return it as-is; the
        # client renders nothing for an empty result
        # (cfbdLineComparisonHTML() in app/js/cfbd-insights.js).
        payload = {"gameId": game_id, "fetchedAt": _now_iso(), "source": "live", **lines}
        try:
            _kv_set(cache_key, payload)
        except Exception as exc:
            _log_server_error("lines cache write", exc)
        self._respond(200, payload)

    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

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
