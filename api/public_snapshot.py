"""
Vercel Python serverless function: GET /api/public_snapshot?view=odds|predictions|ratings

Public, UNAUTHENTICATED counterpart to fetch_odds.py / fetch_predictions.py /
fetch_cfbd.py's ratings view, built specifically to power the logged-out
Snapshot preview (no Clerk session required).

WHAT THIS IS: a read-only window into the three shared Redis caches those
authenticated endpoints already write on every signed-in user's normal
usage. This file NEVER calls any upstream provider itself (not The Odds
API, not thepredictiontracker.com, not CFBD) -- it only ever reads
SHARED_ODDS_KEY / SHARED_PREDICTIONS_KEY / the CFBD ratings cache that a
signed-in request already populated. That keeps this endpoint's cost at
"one Redis GET," regardless of how much anonymous traffic it gets, and
means it can never spend any of Drew's paid upstream quota on its own.
If a cache is empty or the process has never had a signed-in user populate
it yet (e.g. very first deploy of a new season), the relevant view responds
with `{"ready": false}` rather than fabricating placeholder data -- the
client is expected to show a "check back soon" state, not demo/fake games.

WHY A SEPARATE FILE, NOT A NEW `public=1` BRANCH ON THE EXISTING THREE
ENDPOINTS: those three files gate everything on verify_user() as their
very first line, and their whole request-handling shape (personal-key
headers, per-user rate limiting, upstream retry/fallback) assumes an
authenticated caller. Bolting an unauthenticated path onto them risks a
future edit accidentally widening what an anonymous caller can trigger
(e.g. a real upstream fetch). A dedicated, deliberately narrow, read-only
file makes "this can never touch upstream or any per-user data" true by
construction, not by a conditional that has to be maintained correctly
forever. Same "no shared imports between serverless functions" constraint
as every other file here -- helpers below are intentionally duplicated,
not imported.

WHAT'S DELIBERATELY TRIMMED vs. the authenticated responses, since this
data is now reachable by anyone on the internet, not just a signed-in
person:
  - odds: `reqLeft` (Drew's paid Odds API quota remaining) is omitted --
    no reason to expose usage/budget info publicly. `preKickLines` is
    also omitted -- it's pick-grading/CLV infrastructure, not something
    the logged-out preview renders.
  - predictions: each game's `systems` dict is filtered down to ONLY
    `sag` (Sagarin Rating) -- the logged-out preview's fixed default
    composite is Sagarin + SP+ (see CURRENT_STATE.md's "New-account
    default systems" entry), matching the app's own new-signed-in-user
    default rather than exposing the full ~40-system aggregated dataset
    thepredictiontracker.com's CSV provides. `systems` list in the
    response is hardcoded to `["sag"]` for the same reason.
  - ratings: each team's rating block is filtered down to ONLY `sp`
    (needed client-side for the existing `cfbdDerivedSpread()` SP+
    derivation) -- core/srs/elo/fpi are dropped, since those aren't part
    of the logged-out default and there's no reason to publish CFBD data
    this app doesn't even use in that view.

RATE LIMITING: per-request-IP (not per-uid -- there is no uid here),
generous but real, purely to keep a scripted hammer from spamming Redis
GETs. Uses Vercel's `x-forwarded-for` header for the caller's IP; falls
back to a single shared bucket if that header is ever absent (should not
happen on Vercel, but fails toward "still rate limited" rather than
"unlimited" if it does).

CACHING: unlike every other endpoint in this codebase (`private,
no-store` -- correct for authenticated per-user data), this response is
identical for every anonymous caller and cheap to recompute, so it sends
a real `public, max-age=60` so a CDN/browser can absorb a traffic spike
(e.g. a busy tweet) without every hit reaching this function at all.
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
# / fetch_cfbd.py already own and write on real signed-in usage. This file
# never writes any of them.
SHARED_ODDS_KEY = "edge_board_shared_odds"
SHARED_PREDICTIONS_KEY = "edge_board_shared_predictions"
RATINGS_CACHE_PREFIX = "pickgauge_cfbd_ratings_v1"

# Default composite for the logged-out preview -- matches this app's own
# real new-signed-in-account default (`sag` + `cfbdsp`, see
# CURRENT_STATE.md's Aug 26 "New-account default systems" entry). `cfbdsp`
# isn't a predictions-CSV system code at all -- it's derived client-side
# from the `sp` rating below via the existing cfbdDerivedSpread() -- so
# only `sag` needs filtering out of the predictions payload.
PUBLIC_PREDICTION_SYSTEMS = ("sag",)

# Data older than this is treated as not-ready rather than served stale --
# a logged-out visitor has no refresh control and no context for "why does
# this look old," so a clear "check back soon" is more honest than quietly
# serving hours-old lines. Deliberately looser than the authenticated
# SHARED_FRESH_MINUTES windows those endpoints use for their OWN refresh
# decisions -- this endpoint never triggers a refresh itself, it just
# decides whether to show what's already there.
MAX_AGE_MINUTES = 180


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
    with urllib.request.urlopen(req, timeout=10) as res:
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
    with urllib.request.urlopen(req, timeout=10) as res:
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
# View builders -- each reads one shared cache and trims it down to the
# public/default-composite shape described in the module docstring.
# ---------------------------------------------------------------------------
def build_odds_view():
    current = _kv_get_json(SHARED_ODDS_KEY)
    if not isinstance(current, dict) or not current.get("lastGames"):
        return {"ready": False}
    age = _age_minutes(current.get("sharedUpdatedAt"))
    if age is None or age >= MAX_AGE_MINUTES:
        return {"ready": False}
    return {
        "ready": True,
        "games": current["lastGames"],
        "lastRefresh": current.get("lastRefresh"),
        "booksSeen": current.get("booksSeen") or [],
        "asOfMinutes": round(age),
    }


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
    if age is None or age >= MAX_AGE_MINUTES:
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
    if age is None or age >= MAX_AGE_MINUTES:
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

        # Generous per-IP window: this is pure Redis-GET cost, not upstream
        # spend, so the goal is only to blunt a scripted hammer, not to
        # meaningfully throttle real visitors loading a page.
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
        # Public/anonymous, identical response for every caller, cheap to
        # recompute -- unlike every authenticated endpoint's
        # `private, no-store`, a real CDN/browser cache is exactly what we
        # want here so a traffic spike doesn't hit this function at all.
        self.send_header("Cache-Control", "public, max-age=60, s-maxage=60")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
