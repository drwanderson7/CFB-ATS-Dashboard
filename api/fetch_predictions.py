"""
Vercel Python serverless function: GET /api/fetch_predictions

Fetches thepredictiontracker.com's weekly college-football CSV, returns it as
JSON, AND writes it into its own dedicated shared Redis key (server-owned
write -- see api/state.py's docstring for why the browser no longer POSTs
shared data directly, and for why this uses its own key rather than one
combined blob shared with fetch_odds.py and pool publishing).

Response shape (unchanged core fields, new ones added -- see below):
  {
    "games":   [ {"home": "...", "road": "...", "systems": {"sag": -3.5, ...}}, ... ],
    "systems": ["sag", "fpi", "donchess", ...],
    "count":   <number of games>,
    "duplicateCount": <matchups seen twice in this CSV pull and dropped>,
    "warnings": [ "<human-readable data-quality note>", ... ],   # empty list if nothing looks wrong -- see detect_schema_drift()
    "usingStaleFallback": true,        # ONLY present when serving a stale-if-error fallback
    "staleAgeMinutes": 187,            # ONLY present alongside usingStaleFallback
    "message": "Prediction source temporarily unavailable. Using the last successful predictions from 3 hours ago.",
  }

Reliability notes (see detect_schema_drift()/_stale_shared_predictions()/
write_weekly_snapshot() below for the real logic):
  - A live upstream fetch failure (or a genuinely empty CSV) now falls back
    to the last known-good shared-cache copy, up to STALE_FALLBACK_MAX_MINUTES
    old, rather than hard-erroring whenever a perfectly usable recent copy
    already exists.
  - Every successful fetch is also archived into an immutable-per-week
    snapshot (SNAPSHOT_KEY_PREFIX + ISO year/week) for future model-
    calibration research, independent of the single rolling shared-cache slot.
  - Each successful fetch is compared against the previous known-good one;
    a sharp drop in game/system count, a previously-tracked core system
    disappearing, or an unusual spike in duplicate matchups surfaces as a
    `warnings` entry rather than passing through silently.
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
    duplicate_count = 0
    for row in reader:
        home = (row.get("home") or "").strip()
        road = (row.get("road") or "").strip()
        if not home or not road:
            continue
        sig = (home.lower(), road.lower())
        if sig in seen_matchups:
            # Real data-quality signal, not just a silent de-dupe: kept
            # separately from `games` so detect_schema_drift() below can
            # flag an unusual spike (the CSV suddenly listing a matchup
            # multiple times, per ChatGPT's own audit) instead of this
            # being invisible.
            duplicate_count += 1
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
        "duplicateCount": duplicate_count,
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
_ALLOWED_AZP = {"https://pickgauge.com", "https://www.pickgauge.com"}
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


# TTL-capable SET for the immutable weekly snapshots below -- reuses the
# same generic-command REST call shape _kv_eval() already uses in this
# file (a raw ["CMD", ...] array to the base URL) rather than adding a
# second, differently-shaped Redis client convention.
def _kv_set_ex(key, value_str, ex_seconds):
    base, token = _kv_creds()
    if not base or not token:
        return False
    body = json.dumps(["SET", key, value_str, "EX", str(ex_seconds)])
    req = urllib.request.Request(
        base,
        data=body.encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        json.loads(res.read().decode())
        return True


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

# Real reliability gap fix: thepredictiontracker.com's weekly computer
# predictions do NOT change every few minutes the way live sportsbook
# odds do, so treating "past SHARED_FRESH_MINUTES" identically to "no data
# exists at all" was too aggressive -- an upstream outage turned into a
# hard error for the person, even though a merely-stale-but-still-useful
# copy was sitting right there in Redis. This cap is deliberately much
# looser: it's the outer bound for STALE-IF-ERROR fallback specifically
# (only used once a live re-fetch has already failed), not the normal
# freshness window. Beyond a week old, a "last known good" CSV is more
# likely to actively mislead (bye weeks, roster/ranking drift, a whole
# missed slate) than to help, so the endpoint surfaces a real error
# instead of silently serving month-old numbers as if they were current.
STALE_FALLBACK_MAX_MINUTES = 60 * 24 * 7


def _parse_shared_predictions_blob(raw):
    """Pure parse of the shared-cache blob -> (games, fetched_at, updated_at,
    age_minutes) or None on any malformed/missing/unparseable input. Shared
    by both the normal freshness-gated read and the stale-if-error fallback
    below so the two never drift on what counts as a valid cached blob."""
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
    fetched_at = (current.get("predMeta") or {}).get("fetchedAt")
    return games, fetched_at, updated_at, age_minutes


def _games_to_response(games, fetched_at, extra=None):
    systems_seen = set()
    for g in games:
        systems_seen.update((g.get("systems") or {}).keys())
    out = {
        "games": games,
        "systems": sorted(systems_seen),
        "count": len(games),
        "fetchedAt": fetched_at,
        "sharedPersisted": True,
    }
    if extra:
        out.update(extra)
    return out


def _fresh_shared_predictions():
    parsed = _parse_shared_predictions_blob(_kv_get(SHARED_PREDICTIONS_KEY))
    if parsed is None:
        return None
    games, fetched_at, _updated_at, age_minutes = parsed
    if age_minutes >= SHARED_FRESH_MINUTES:
        return None
    return _games_to_response(games, fetched_at)


# Real reliability gap fix: stale-if-error. Only ever called from do_GET's
# exception/empty-result handling below, i.e. AFTER a real re-fetch attempt
# has already failed -- never as a substitute for a normal fresh/refresh
# cycle. Ignores SHARED_FRESH_MINUTES entirely (that gate exists to avoid
# hammering the upstream CSV unnecessarily, not to describe whether old
# data is still USABLE) and instead applies the much looser
# STALE_FALLBACK_MAX_MINUTES bound.
def _stale_shared_predictions():
    parsed = _parse_shared_predictions_blob(_kv_get(SHARED_PREDICTIONS_KEY))
    if parsed is None:
        return None
    games, fetched_at, _updated_at, age_minutes = parsed
    if age_minutes >= STALE_FALLBACK_MAX_MINUTES:
        return None
    return _games_to_response(games, fetched_at, {
        "usingStaleFallback": True,
        "staleAgeMinutes": round(age_minutes),
        "message": (
            "Prediction source temporarily unavailable. Using the last "
            f"successful predictions from {_relative_age_phrase(age_minutes)}."
        ),
    })


# Deliberately relative ("3 hours ago"), not a formatted clock time -- the
# server has no idea what timezone the person is in, and a bare UTC
# timestamp reads as more precise/authoritative than it should for a
# fallback notice. Takes age in minutes directly (both call sites above
# already compute it) rather than re-deriving it from a timestamp.
def _relative_age_phrase(age_minutes):
    m = max(0, round(age_minutes))
    if m < 1:
        return "under a minute ago"
    if m < 60:
        return f"{m} minute{'s' if m != 1 else ''} ago"
    hours = round(m / 60)
    if hours < 24:
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    days = round(m / (60 * 24))
    return f"{days} day{'s' if days != 1 else ''} ago"


def write_shared_predictions(games, count, fetched_at=None):
    base, token = _kv_creds()
    if not base or not token:
        return False
    fetched_at = fetched_at or datetime.datetime.now(datetime.timezone.utc).isoformat()
    payload = {
        "predictions": games,
        "predMeta": {
            "fetchedAt": fetched_at,
            "count": count,
        },
        "sharedUpdatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    _kv_set(SHARED_PREDICTIONS_KEY, json.dumps(payload))
    return True


# --- Immutable weekly snapshots -------------------------------------------
# Real reliability/reproducibility gap fix: SHARED_PREDICTIONS_KEY above is
# a single rolling slot -- every fetch overwrites it, so last Tuesday's
# predictions for a given week are gone forever the moment this week's
# first fetch lands. That makes future model-calibration research (see
# CURRENT_STATE.md's Probability Edge Phase 2) impossible to do properly:
# there'd be no way to go back and see what a system actually predicted at
# the time, only what it predicts NOW if re-queried.
#
# Keyed by ISO calendar week (SNAPSHOT_KEY_PREFIX + "{isoyear}:W{isoweek}"),
# not the app's own per-pool currentWeekIndex() (app/js/board.js) -- that
# index is derived per-user from THEIR OWN schedule/pool data and isn't a
# stable, single global "current CFB week" this server-side endpoint could
# reference without a cross-service CFBD call. ISO week is a real
# tradeoff: it won't always line up exactly with the CFB week label people
# see in the app UI (e.g. a Tuesday-vs-Wednesday CSV pull near a week
# boundary could occasionally land in a different ISO week than the CFB
# week it's actually predicting). That's an acceptable cost for a
# reproducibility archive -- what matters for later research is that each
# snapshot is stable, uniquely keyed, and never silently overwritten by a
# DIFFERENT week's data, not that the label matches the app's own week
# numbering exactly. Overwritten repeatedly THROUGH a given week as the
# predictions genuinely refine (that's normal and desired -- Friday's
# sharper numbers should replace Tuesday's rougher ones for that same
# week), then left untouched forever once the week has passed.
SNAPSHOT_KEY_PREFIX = "predictions_snapshot:"
# ~26 weeks (a full season plus buffer), not indefinite -- keeps Redis from
# accumulating an ever-growing, never-pruned history. Long enough for every
# snapshot from one real season to still be there for post-season research.
SNAPSHOT_TTL_SECONDS = 60 * 60 * 24 * 7 * 26


def _iso_week_key(dt):
    iso_year, iso_week, _iso_weekday = dt.isocalendar()
    return f"{SNAPSHOT_KEY_PREFIX}{iso_year}:W{iso_week:02d}"


def write_weekly_snapshot(games, systems, fetched_at, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    key = _iso_week_key(now)
    payload = {
        "predictions": games,
        "systems": systems,
        "count": len(games),
        "fetchedAt": fetched_at,
        "snapshotWrittenAt": now.isoformat(),
    }
    try:
        return bool(_kv_set_ex(key, json.dumps(payload), SNAPSHOT_TTL_SECONDS))
    except Exception:
        return False  # best-effort, same convention as write_shared_predictions' caller


# --- Schema-drift / data-quality alarms ------------------------------------
# Real reliability gap fix: if thepredictiontracker.com's CSV shape changes
# out from under this app (column renamed, Sagarin suddenly missing, the
# site returns a near-empty file), the OLD behavior was to silently accept
# whatever came back -- a genuinely broken scrape and a genuinely light
# bye-heavy week looked identical to the person using the app. This never
# BLOCKS serving the data (a real light week is possible and shouldn't be
# treated as an error), it only attaches honest warnings so a real problem
# doesn't pass unnoticed on a Saturday morning.
#
# CORE_SYSTEMS_TO_WATCH: Sagarin Points/Ratings and Dokter Entropy are
# PickGauge's own confirmed top two-season ATS performers (see
# CURRENT_STATE.md) -- if any of these were present in the last known-good
# fetch and silently vanish from a new one, that's specifically worth
# flagging over an arbitrary/unranked system going missing.
CORE_SYSTEMS_TO_WATCH = {"sag", "sagp", "dent"}
# Below this fraction of the previous known-good count/system-count, flag
# a warning rather than silently trusting the new number. Deliberately
# loose (not a tight statistical bound) -- this is a smell test for "did
# the scrape actually break", not a claim about what a normal week-to-week
# swing should look like.
DRIFT_COUNT_RATIO = 0.25
DRIFT_SYSTEMS_RATIO = 0.5
# Below this baseline size, relative-drop comparisons are too noisy to be
# meaningful (e.g. a real 3-game baseline dropping to 1 game is not a
# useful "75% drop" signal) -- skip the ratio checks entirely below this
# floor rather than generate false alarms off a tiny baseline.
DRIFT_MIN_BASELINE_COUNT = 10
DRIFT_MIN_BASELINE_SYSTEMS = 5


def detect_schema_drift(data, baseline, duplicate_count=0):
    """Pure comparison, no fetch/DOM -- data is this fetch's already-parsed
    {"games","systems","count"}-shaped dict (parse_csv_text()'s own
    output), baseline is the last known-good fetch in the same shape (or
    None if there isn't one yet, e.g. the very first fetch ever). Returns a
    list of human-readable warning strings, empty if nothing looks wrong."""
    warnings = []
    new_count = data.get("count", 0)
    new_systems = set(data.get("systems") or [])

    if baseline:
        base_count = baseline.get("count", 0)
        base_systems = set(baseline.get("systems") or [])
        if base_count >= DRIFT_MIN_BASELINE_COUNT and new_count < base_count * DRIFT_COUNT_RATIO:
            warnings.append(
                f"Game count dropped sharply: {base_count} \u2192 {new_count}. "
                "This may be a genuinely light week, or a broken upstream fetch -- worth a manual check."
            )
        if len(base_systems) >= DRIFT_MIN_BASELINE_SYSTEMS and len(new_systems) < len(base_systems) * DRIFT_SYSTEMS_RATIO:
            warnings.append(
                f"Prediction system count dropped sharply: {len(base_systems)} \u2192 {len(new_systems)}."
            )
        missing_core = sorted((base_systems & CORE_SYSTEMS_TO_WATCH) - new_systems)
        if missing_core:
            warnings.append(
                f"Previously-tracked core system(s) missing from this fetch: {', '.join(missing_core)}."
            )

    if duplicate_count and new_count and duplicate_count >= max(3, round(new_count * 0.1)):
        warnings.append(
            f"{duplicate_count} duplicate matchup(s) were detected and dropped from this fetch -- "
            "worth checking the source CSV directly if this keeps happening."
        )

    return warnings


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
                # Real reliability gap fix: this used to hard-stop here with
                # an empty result even if a perfectly good previous fetch
                # was sitting in the shared cache -- stale-if-error applies
                # just as much to "the CSV came back genuinely empty" as it
                # does to a network failure below.
                fallback = _stale_shared_predictions()
                if fallback is not None:
                    self._respond(200, fallback)
                    return
                self._respond(200, {
                    "games": [], "systems": [], "count": 0,
                    "message": "No games in this week's prediction file yet.",
                })
                return
            # Baseline read BEFORE write_shared_predictions() below
            # overwrites SHARED_PREDICTIONS_KEY -- this is specifically the
            # PREVIOUS known-good fetch, not this one, so detect_schema_drift()
            # has something real to compare against. Best-effort: a baseline
            # read failure must never block serving this fetch's own data.
            baseline = None
            try:
                parsed_prev = _parse_shared_predictions_blob(_kv_get(SHARED_PREDICTIONS_KEY))
                if parsed_prev is not None:
                    prev_games, _prev_fetched_at, _prev_updated_at, _prev_age = parsed_prev
                    prev_systems = set()
                    for g in prev_games:
                        prev_systems.update((g.get("systems") or {}).keys())
                    baseline = {"count": len(prev_games), "systems": sorted(prev_systems)}
            except Exception:
                pass
            warnings = detect_schema_drift(data, baseline, data.get("duplicateCount", 0))

            fetched_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
            shared_persisted = False
            try:
                shared_persisted = bool(write_shared_predictions(data["games"], data["count"], fetched_at))
            except Exception:
                pass  # shared-cache write is best-effort; response below still succeeds
            try:
                write_weekly_snapshot(data["games"], data["systems"], fetched_at)
            except Exception:
                pass  # snapshot write is best-effort too; never blocks the live response
            response = dict(data)
            response["fetchedAt"] = fetched_at
            response["sharedPersisted"] = shared_persisted
            response["warnings"] = warnings
            self._respond(200, response)
        except urllib.error.URLError as e:
            _log_server_error("fetch_predictions do_GET (upstream unreachable)", e)
            # Real reliability gap fix: stale-if-error. A live upstream
            # outage no longer means a hard error for the person if a
            # recent-enough successful fetch already exists -- only fails
            # all the way through to a real error once there's genuinely
            # nothing usable to fall back to.
            fallback = _stale_shared_predictions()
            if fallback is not None:
                self._respond(200, fallback)
                return
            self._respond(502, {"error": "Couldn't reach the prediction source — try again shortly."})
        except Exception as e:
            _log_server_error("fetch_predictions do_GET", e)
            fallback = _stale_shared_predictions()
            if fallback is not None:
                self._respond(200, fallback)
                return
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
