"""
Vercel Python serverless function: GET /api/public_snapshot?view=odds|predictions|ratings

Public, UNAUTHENTICATED counterpart to fetch_odds.py / fetch_predictions.py /
fetch_cfbd.py's ratings view, built specifically to power the logged-out
Snapshot preview (no Clerk session required).

WHAT THIS IS: a deliberately narrow, READ-ONLY public window into
PickGauge's shared Redis caches (odds, predictions, ratings). Nothing here
calls an upstream provider. Odds in particular come only from a signed-in
person's Refresh lines click (api/fetch_odds.py, Oct 26, 2026); the preview
serves the latest shared copy with its lastRefresh time, marked stale past
MAX_AGE_MINUTES_ODDS and withheld past PUBLIC_ODDS_MAX_SERVE_MINUTES. (An
earlier version could "self-warm" the shared odds cache with the server's
ODDS_API_KEY when it was stale; that automatic spend is gone.)

WHY A SEPARATE FILE, NOT A NEW `public=1` BRANCH ON THE EXISTING THREE
ENDPOINTS: those three files gate everything on verify_user() as their
very first line, and their whole request-handling shape (personal-key
headers, per-user rate limiting, upstream retry/fallback) assumes an
authenticated caller. Bolting the guest flow directly onto the authenticated handlers would widen
their auth assumptions. This dedicated endpoint keeps the anonymous surface
explicit: every view is cache-only and no per-user state is reachable.
Same "no shared imports between serverless functions" constraint as every
other file here -- helpers below are intentionally duplicated, not imported.

WHAT'S DELIBERATELY TRIMMED vs. the authenticated responses, since this
data is now reachable by anyone on the internet, not just a signed-in
person:
  - odds: `reqLeft` (Drew's paid Odds API quota remaining) is omitted --
    no reason to expose usage/budget info publicly. `preKickLines` is
    also omitted -- it's pick-grading/CLV infrastructure, not something
    the logged-out preview renders.
  - predictions: filtered to `sag` + `wayward` (Sept 8, 2026, revised
    again the same day): the guest Snapshot's default composite is now
    "the REAL, unmodified PickGauge Model # (same 3-of-5-system floor as
    a signed-in account, no exception) whenever the game's public data
    happens to clear it, else SP+ alone" (see
    app/js/guest-snapshot.js's own header comment and
    app/js/model.js's pickGaugeModelNumber()/myNumber() for the exact
    logic). An earlier version of this same day's fix instead LOWERED
    the floor to 2 for guests, using just `sag` here -- reverted because
    it could compute a genuinely different number than a signed-in
    account looking at the identical game (Drew's report: same market,
    same minute, two different Model # numbers). Exposing a second
    tracker system here gives a guest a real shot at the UNCHANGED
    3-system floor instead. `sag` (12%) and `wayward` (15%) are the two
    LOWEST-weighted of the five real inputs (PICKGAUGE_MODEL_PRESET;
    TeamRankings is 20%, Sagarin Predictor 18%), chosen to give away the
    least signal while still clearing the floor alongside SP+ for most
    games. Widen further only with a real reason -- every system added
    here is more of the paid/scraped aggregated dataset visible without
    signing in.
  - ratings: each team's rating block is filtered down to ONLY `sp`
    (needed client-side for the existing `cfbdDerivedSpread()` SP+
    derivation) -- core/srs/elo/fpi are dropped, since those aren't part
    of the logged-out default and there's no reason to publish CFBD data
    this app doesn't even use in that view.

RATE LIMITING: requests are limited per request IP.

CACHING: unlike authenticated per-user endpoints, this response is identical
for anonymous callers and is CDN-cacheable. Fresh ready data gets 60 seconds;
not-ready/stale responses get only 15 seconds so a fresh signed-in refresh
becomes visible quickly instead of being hidden behind a minute-long cache.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import datetime
import urllib.parse
import urllib.request
import urllib.error

GENERIC_SERVER_ERROR = "Something went wrong processing that request — try again shortly."


def _log_server_error(context, exc):
    print(f"[api/public_snapshot.py] {context}: {exc}", file=sys.stderr)


# Same dedicated per-domain shared keys fetch_odds.py / fetch_predictions.py
# / fetch_cfbd.py own. All three are read-only here (the odds self-warm was
# removed Oct 26, 2026 -- lines only come from a signed-in Refresh lines click).
SHARED_ODDS_KEY = "edge_board_shared_odds"
SHARED_PREDICTIONS_KEY = "edge_board_shared_predictions"
RATINGS_CACHE_PREFIX = "pickgauge_cfbd_ratings_v1"

# Sept 8, 2026 (Drew's explicit follow-up call, revised from the original
# single-system version): the guest Snapshot's PickGauge Model # must be
# byte-for-byte the SAME recipe a signed-in account gets -- no relaxed/
# lowered completeness floor for guests (see model.js's
# pickGaugeModelNumber()'s own comment on why that changed). That means a
# guest needs a genuine shot at reaching the real 3-of-5-system floor, not
# just "sag alone" (1 system) -- so a second tracker system, Waywardtrends,
# is exposed here too. sag(12%) + wayward(15%) are the two LOWEST-weighted
# of the five real inputs (PICKGAUGE_MODEL_PRESET; TeamRankings is 20%,
# Sagarin Predictor 18%), chosen specifically to give away the least
# signal while still clearing the floor alongside SP+ (from the public
# ratings view) for most games. Widen further only with a real reason --
# every system added here is more of the paid/scraped aggregated dataset
# visible without signing in.
PUBLIC_PREDICTION_SYSTEMS = ("sag", "wayward")

# Data older than these is treated as not-ready rather than served stale --
# a logged-out visitor has no refresh control and no context for "why does
# this look old," so a clear "check back soon" is more honest than quietly
# serving hours-old lines. Per-domain, NOT one shared value -- a real
# production gap (Aug 31, Drew): a single flat cutoff here was TIGHTER
# than the underlying server-side cache policy for ratings
# (api/fetch_cfbd.py's RATINGS_FRESH_SECONDS = 6 hours), which meant
# ratings data that was still perfectly valid and being served to
# signed-in users could get rejected here as "not ready" purely because
# this file's own cutoff was stricter than the data it was reading.
# Each cutoff below is set to roughly match (with a little slack) the
# real freshness policy of the cache it reads, not an arbitrary shared
# number.
MAX_AGE_MINUTES_ODDS = 360         # Real second instance of the same mistake ratings had (Aug 31, Drew): this was originally anchored to fetch_odds.py's SHARED_FRESH_MINUTES (30min, the "should we spend a real paid Odds API call" threshold) instead of that file's own worst-case "is this data still usable at all" bound, STALE_ODDS_MAX_MINUTES (6h) -- confirmed live: ratings at 201min old was genuinely fine once its own cutoff was fixed the same way, and odds was almost certainly sitting in the same multi-hour-but-still-real state, not actually empty.
MAX_AGE_MINUTES_PREDICTIONS = 60 * 24 * 7  # matches predictions' own real worst-case usability bound, STALE_FALLBACK_MAX_MINUTES in api/fetch_predictions.py (a week) -- same "anchor to the real bound, not a guess" fix as ODDS/RATINGS above. This view isn't currently called by the guest UI (SP+-only composite doesn't need it), kept correct regardless so it doesn't become the next version of this same bug if it's ever wired up.
MAX_AGE_MINUTES_RATINGS = 420      # ratings' real server policy (api/fetch_cfbd.py) is 6h (360min); slack to 7h so this cutoff is never the reason a still-valid cache gets rejected

# Lines only refresh on a signed-in click now (Oct 26, 2026), so the shared
# copy can legitimately be days old; the preview shows it with its time.
PUBLIC_ODDS_MAX_SERVE_MINUTES = 7 * 24 * 60
PUBLIC_KV_TIMEOUT_SECONDS = 3


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _age_minutes(iso_ts):
    if not iso_ts:
        return None
    try:
        ts = datetime.datetime.fromisoformat(str(iso_ts).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=datetime.timezone.utc)
        return (_now() - ts.astimezone(datetime.timezone.utc)).total_seconds() / 60
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Redis REST helpers -- duplicated per this project's no-shared-imports
# convention (see api/state.py's module docstring for the full reasoning).
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


def _kv_get_raw(key):
    base, token = _kv_creds()
    if not base or not token:
        return None
    req = urllib.request.Request(
        f"{base}/get/{urllib.parse.quote(key, safe='')}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=PUBLIC_KV_TIMEOUT_SECONDS) as res:
        return json.loads(res.read().decode()).get("result")


def _kv_get_json(key):
    raw = _kv_get_raw(key)
    if not raw:
        return None
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, json.JSONDecodeError):
        return None


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
    with urllib.request.urlopen(req, timeout=PUBLIC_KV_TIMEOUT_SECONDS) as res:
        return json.loads(res.read().decode()).get("result")


def rate_limited(bucket_key, limit, window_seconds):
    """Fails OPEN (not rate-limited) if Redis/eval itself is unreachable --
    same fail-open reasoning as every other rate_limited() copy in this
    codebase: a Redis hiccup should degrade this endpoint to "no extra
    throttling this instant," not take the public preview down entirely."""
    try:
        result = _kv_eval(RATE_LIMIT_SCRIPT, [f"ratelimit:public_snapshot:{bucket_key}"], [str(limit), str(window_seconds)])
        return result == 1
    except Exception:
        return False


def client_ip(handler):
    fwd = handler.headers.get("x-forwarded-for") or handler.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip()
    return "__unknown__"


# ---------------------------------------------------------------------------
# Public odds view (shared cache only)
# ---------------------------------------------------------------------------
def _odds_cache_record():
    current = _kv_get_json(SHARED_ODDS_KEY)
    if not isinstance(current, dict) or not current.get("lastGames"):
        return None, None
    age = _age_minutes(current.get("sharedUpdatedAt"))
    return current, age


def _public_odds_body(current, age, stale=False, source="cache"):
    return {
        "ready": True,
        "games": current["lastGames"],
        "lastRefresh": current.get("lastRefresh"),
        "booksSeen": current.get("booksSeen") or [],
        "asOfMinutes": round(age or 0),
        "stale": bool(stale),
        "source": source,
    }


# ---------------------------------------------------------------------------
# View builders -- each reads one shared cache and trims it down to the
# public/default-composite shape described in the module docstring.
# ---------------------------------------------------------------------------
def build_odds_view():
    """Serve the latest SHARED odds, never The Odds API (Oct 26, 2026).

    Lines only come from The Odds API when a signed-in person clicks Refresh
    lines (api/fetch_odds.py). The guest preview shows whatever that shared
    copy is, with its lastRefresh time (the page labels it "Lines updated
    ..."), marked stale past MAX_AGE_MINUTES_ODDS and not served at all past
    PUBLIC_ODDS_MAX_SERVE_MINUTES.
    """
    current, age = _odds_cache_record()
    if current is None or age is None or age >= PUBLIC_ODDS_MAX_SERVE_MINUTES:
        return {"ready": False, "reason": "odds-cache-empty"}
    stale = age >= MAX_AGE_MINUTES_ODDS
    return _public_odds_body(current, age, stale=stale, source="stale-cache" if stale else "cache")


def _trim_prediction_systems(games):
    out = []
    for g in games or []:
        if not isinstance(g, dict):
            continue
        systems = g.get("systems") or {}
        trimmed = {k: v for k, v in systems.items() if k in PUBLIC_PREDICTION_SYSTEMS}
        if not trimmed:
            continue
        out.append({"home": g.get("home"), "road": g.get("road"), "systems": trimmed})
    return out


def build_predictions_view():
    current = _kv_get_json(SHARED_PREDICTIONS_KEY)
    if not isinstance(current, dict) or not current.get("predictions"):
        return {"ready": False}
    age = _age_minutes(current.get("sharedUpdatedAt"))
    if age is None or age >= MAX_AGE_MINUTES_PREDICTIONS:
        return {"ready": False}
    games = _trim_prediction_systems(current["predictions"])
    if not games:
        return {"ready": False}
    return {
        "ready": True,
        "games": games,
        "systems": list(PUBLIC_PREDICTION_SYSTEMS),
        "count": len(games),
        "fetchedAt": (current.get("predMeta") or {}).get("fetchedAt"),
        "asOfMinutes": round(age),
    }


def _trim_rating(entry):
    if not isinstance(entry, dict):
        return None
    sp = entry.get("sp")
    if not sp:
        return None
    return {"team": entry.get("team"), "conference": entry.get("conference"), "sp": sp}


def build_ratings_view(year):
    cache_key = f"{RATINGS_CACHE_PREFIX}:{year}"
    current = _kv_get_json(cache_key)
    if not isinstance(current, dict) or not current.get("ratings"):
        return {"ready": False}
    age = _age_minutes(current.get("fetchedAt"))
    if age is None or age >= MAX_AGE_MINUTES_RATINGS:
        return {"ready": False}
    trimmed = [r for r in (_trim_rating(e) for e in current["ratings"]) if r]
    if not trimmed:
        return {"ready": False}
    return {
        "ready": True,
        "year": year,
        "ratings": trimmed,
        "asOfMinutes": round(age),
    }


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        view = (params.get("view", [""])[0] or "").strip().lower()
        if view not in ("odds", "predictions", "ratings"):
            self._respond(400, {"error": "view must be one of: odds, predictions, ratings"})
            return

        # Generous per-IP request window. Every view is a shared-cache read;
        # nothing here calls a paid upstream provider.
        if rate_limited(client_ip(self), 60, 60):
            self._respond(429, {"ready": False, "error": "Too many requests — please slow down."})
            return

        try:
            if view == "odds":
                body = build_odds_view()
            elif view == "predictions":
                body = build_predictions_view()
            else:
                year = params.get("year", [None])[0]
                try:
                    year = int(year) if year else _now().year
                except (TypeError, ValueError):
                    year = _now().year
                body = build_ratings_view(year)
        except Exception as e:
            _log_server_error(f"do_GET view={view}", e)
            self._respond(500, {"ready": False, "error": GENERIC_SERVER_ERROR})
            return

        self._respond(200, body)

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        # Public/anonymous and identical across callers. Keep healthy data
        # cached for a minute, but negative/stale responses only 15 seconds
        # so a just-completed signed-in refresh is not masked by CDN cache.
        cache_seconds = 60 if data.get("ready") and not data.get("stale") else 15
        self.send_header("Cache-Control", f"public, max-age={cache_seconds}, s-maxage={cache_seconds}")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
