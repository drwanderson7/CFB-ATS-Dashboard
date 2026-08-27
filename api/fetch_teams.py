"""
Vercel Python serverless function: GET /api/fetch_teams

Server-side proxy for PickGauge's canonical CollegeFootballData identity layer.
It fetches BOTH the FBS team directory and the current season game schedule,
then trims them to the stable IDs/names/conference fields the browser needs.
The browser still uses the team rows for logos, but the important purpose now
is to give every runtime game a CFBD game id plus canonical home/away team ids.

The response is shared reference data, not private user state. A Redis cache
keeps repeated signed-in clients from spending CFBD API calls on the same
season schedule; a stale cached copy is preferred to losing identity entirely
if CFBD is temporarily unavailable.

Why server-side: CFBD requires the key in an Authorization header, which means
it can't be a plain browser fetch without exposing the key in every request
anyway -- routing it through here keeps the key server-side, consistent with
how ODDS_API_KEY is handled, and sidesteps any CORS behavior on their end.

Response shape (trimmed from CFBD's larger payloads):
  {
    "season": 2026,
    "fetchedAt": "...Z",
    "teams": [{"id":194,"school":"Ohio State",...}],
    "games": [{"id":4017...,"homeId":194,"awayId":..., ...}],
    "count": <team count>,
    "gameCount": <game count>,
    "source": "live" | "cache" | "stale"
  }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.parse
import urllib.request
import urllib.error
import jwt
from jwt import PyJWKClient

# See api/state.py's own GENERIC_SERVER_ERROR/_log_server_error() comment.
GENERIC_SERVER_ERROR = "Something went wrong processing that request — try again shortly."


def _log_server_error(context, exc):
    print(f"[api/fetch_teams.py] {context}: {exc}", file=sys.stderr)

CFBD_BASE_URL = "https://api.collegefootballdata.com"
CFBD_IDENTITY_CACHE_PREFIX = "pickgauge_cfbd_identity"
CFBD_IDENTITY_FRESH_SECONDS = 6 * 60 * 60


def _cfbd_get(api_key, path, params=None):
    qs = urllib.parse.urlencode(params or {})
    url = f"{CFBD_BASE_URL}{path}" + (f"?{qs}" if qs else "")
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (PickGauge teams proxy)",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.status, res.read()


def fetch_identity(api_key, season):
    # /teams/fbs is the current v2 endpoint for the canonical FBS directory.
    # /games carries stable game/homeId/awayId values even for an FBS-vs-FCS
    # matchup, so the schedule can identify an opponent that is not itself in
    # the FBS-only team directory.
    _, teams_body = _cfbd_get(api_key, "/teams/fbs", {"year": season})
    _, games_body = _cfbd_get(api_key, "/games", {
        "year": season, "seasonType": "both", "classification": "fbs"
    })
    return teams_body, games_body


def trim_teams(raw_json):
    teams = json.loads(raw_json)
    out = []
    for t in teams:
        school = t.get("school")
        team_id = t.get("id")
        if not school or team_id is None:
            continue
        logos = t.get("logos") or []
        out.append({
            "id": team_id,
            "school": school,
            "abbreviation": t.get("abbreviation"),
            "alternateNames": t.get("alternateNames") or [],
            "conference": t.get("conference"),
            "division": t.get("division"),
            "classification": t.get("classification"),
            "logo": logos[0] if logos else None,
        })
    return out


def trim_games(raw_json):
    games = json.loads(raw_json)
    out = []
    for g in games:
        game_id = g.get("id")
        home_id, away_id = g.get("homeId"), g.get("awayId")
        home, away = g.get("homeTeam"), g.get("awayTeam")
        if game_id is None or home_id is None or away_id is None or not home or not away:
            continue
        out.append({
            "id": game_id,
            "season": g.get("season"),
            "week": g.get("week"),
            "seasonType": g.get("seasonType"),
            "startDate": g.get("startDate"),
            "homeId": home_id,
            "homeTeam": home,
            "homeConference": g.get("homeConference"),
            "homeClassification": g.get("homeClassification"),
            "awayId": away_id,
            "awayTeam": away,
            "awayConference": g.get("awayConference"),
            "awayClassification": g.get("awayClassification"),
            # Real HFA bug fix: SP+/CORE-derived spreads (app/js/cfbd-insights.js
            # cfbdDerivedSpread()) apply a flat 2.6pt home-field constant to every
            # game unless this flag says otherwise. Without it, a neutral-site
            # game (bowl, Mercedes-Benz Stadium, etc.) silently handed whichever
            # team CFBD calls "home" a false 2.6pt edge in the composite.
            "neutralSite": bool(g.get("neutralSite")),
        })
    return out


def build_identity_payload(teams_body, games_body, season, fetched_at, source="live"):
    teams = trim_teams(teams_body)
    games = trim_games(games_body)
    return {
        "season": season, "fetchedAt": fetched_at, "teams": teams, "games": games,
        "count": len(teams), "gameCount": len(games), "source": source,
    }


def _fetch_logo_data_url(url):
    """Fetch one trusted CFBD-provided team logo server-side and return a
    browser-safe data URL. URLs come ONLY from the cached CFBD team directory,
    never from a user-supplied URL, so this cannot become a generic SSRF proxy.
    Keep the per-logo cap conservative: team marks are tiny and a giant payload
    should fail closed rather than balloon a social-export response.
    """
    if not url or not isinstance(url, str) or not url.startswith(("https://", "http://")):
        return None
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (PickGauge social export)"})
    try:
        with urllib.request.urlopen(req, timeout=8) as res:
            content_type = (res.headers.get("Content-Type") or "image/png").split(";", 1)[0].strip().lower()
            if not content_type.startswith("image/"):
                return None
            data = res.read(600_001)
            if not data or len(data) > 600_000:
                return None
            return f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}"
    except Exception:
        return None


def build_social_logo_payload(identity_payload, requested_ids):
    """Return {logos:{teamId:dataUrl|null}} for up to 10 team ids.

    Canvas cannot reliably rasterize the cross-origin CFBD/ESPN logo URLs even
    when the regular <img> elements display them fine. Social export asks this
    same-origin authenticated endpoint for data URLs instead, which keeps the
    final canvas origin-clean and lets PNG export include the real team marks.
    """
    ids=[]
    for raw in requested_ids or []:
        s=str(raw).strip()
        if not s or s in ids:
            continue
        if not s.isdigit():
            continue
        ids.append(s)
        if len(ids)>=10:
            break
    by_id={str(t.get("id")):t for t in (identity_payload or {}).get("teams",[]) if t.get("id") is not None}
    out={s:None for s in ids}
    jobs={}
    with ThreadPoolExecutor(max_workers=min(8,max(1,len(ids)))) as ex:
        for s in ids:
            row=by_id.get(s)
            # CFBD team ids are the ESPN team identifiers used by the CDN.
            # /teams/fbs intentionally omits FCS schools, so a schedule-only
            # opponent such as North Dakota State still gets a real logo here.
            url=(row or {}).get("logo") or f"https://a.espncdn.com/i/teamlogos/ncaa/500/{s}.png"
            jobs[ex.submit(_fetch_logo_data_url,url)]=s
        for fut in as_completed(jobs):
            s=jobs[fut]
            try:
                out[s]=fut.result()
            except Exception:
                out[s]=None
    return {"logos":out}


def _identity_is_fresh(payload, now_dt):
    import datetime
    if not isinstance(payload, dict) or not payload.get("fetchedAt"):
        return False
    try:
        fetched = datetime.datetime.fromisoformat(str(payload["fetchedAt"]).replace("Z", "+00:00"))
        if fetched.tzinfo is None:
            fetched = fetched.replace(tzinfo=datetime.timezone.utc)
        return (now_dt - fetched.astimezone(datetime.timezone.utc)).total_seconds() < CFBD_IDENTITY_FRESH_SECONDS
    except (TypeError, ValueError):
        return False


# ---------------------------------------------------------------------------
# Access gate -- verified Clerk session token. This exact verify_user()
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
# comment on RATE_LIMIT_SCRIPT for the fixed-window design and why it
# fails open. No shared imports across Vercel functions (same reasoning
# as verify_user()'s own duplication above). This file also uses Redis for the shared CFBD identity cache; the rate-limit
# key is independent of that cache and remains only a backstop against a
# scripted loop.
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


def _kv_set(key, value_str):
    base, token = _kv_creds()
    if not base or not token:
        return False
    req = urllib.request.Request(
        f"{base}/set/{urllib.parse.quote(key, safe='')}",
        data=value_str.encode(),
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
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        try:
            season = int((params.get("year") or ["2026"])[0])
        except (TypeError, ValueError):
            self._respond(400, {"error": "Invalid season year."})
            return
        if season < 2000 or season > 2100:
            self._respond(400, {"error": "Invalid season year."})
            return

        logo_ids=[]
        raw_logo_ids=(params.get("logoIds") or [""])[0]
        if raw_logo_ids:
            logo_ids=[x.strip() for x in raw_logo_ids.split(",") if x.strip()]
            if len(logo_ids)>10 or any(not x.isdigit() for x in logo_ids):
                self._respond(400, {"error": "logoIds must contain at most 10 numeric CFBD team ids."})
                return

        bucket="social_logo_fetch" if logo_ids else "teams_fetch"
        limit=20 if logo_ids else 5
        if rate_limited(uid, bucket, limit, 60):
            self._respond(429, {"error": "Too many requests — please wait a bit before trying again."})
            return

        api_key = (self.headers.get("X-Cfbd-Api-Key") or os.environ.get("CFBD_API_KEY") or "").strip()
        # Social-logo rasterization can resolve directly from canonical CFBD/ESPN
        # team ids and therefore must not require a separate CFBD API-key call.
        # Normal identity refreshes still require the key exactly as before.
        if not api_key and not logo_ids:
            self._respond(401, {"message": "No CFBD API key configured. Set CFBD_API_KEY in Vercel, or send X-Cfbd-Api-Key."})
            return

        import datetime
        now_dt = datetime.datetime.now(datetime.timezone.utc)
        cache_key = f"{CFBD_IDENTITY_CACHE_PREFIX}:{season}"
        cached = None
        try:
            raw_cached = _kv_get(cache_key)
            if raw_cached:
                cached = json.loads(raw_cached)
        except Exception as e:
            _log_server_error("fetch_teams do_GET (identity cache read)", e)

        # Social graphic export only needs the team-logo URLs. A stale identity
        # map is perfectly fine for this purpose (team IDs/logo URLs are stable),
        # so prefer any cache copy and avoid spending a CFBD API call merely to
        # rasterize a graphic.
        if logo_ids:
            self._respond(200, build_social_logo_payload(cached or {}, logo_ids))
            return

        if _identity_is_fresh(cached, now_dt):
            cached = dict(cached)
            cached["source"] = "cache"
            self._respond(200, cached)
            return

        try:
            teams_body, games_body = fetch_identity(api_key, season)
            fetched_at = now_dt.isoformat().replace("+00:00", "Z")
            payload = build_identity_payload(teams_body, games_body, season, fetched_at, "live")
            try:
                _kv_set(cache_key, json.dumps(payload))
            except Exception as e:
                _log_server_error("fetch_teams do_GET (identity cache write)", e)
            if logo_ids:
                self._respond(200, build_social_logo_payload(payload, logo_ids))
            else:
                self._respond(200, payload)
            return
        except urllib.error.HTTPError as e:
            _log_server_error(f"fetch_teams do_GET (CFBD HTTP {e.code})", e)
            # A stale identity map is much safer than falling back to fragile
            # names during a temporary provider outage. Never use it for an
            # auth failure, though: a rejected key should remain visible.
            if cached and e.code not in (401, 403):
                stale = dict(cached); stale["source"] = "stale"
                self._respond(200, stale)
                return
            if e.code in (401, 403):
                self._respond(401, {"message": "CFBD rejected the API key."})
            elif e.code == 429:
                self._respond(429, {"error": "CFBD rate limit reached — try again later."})
            else:
                self._respond(502, {"error": "CFBD request failed — try again shortly."})
            return
        except urllib.error.URLError as e:
            _log_server_error("fetch_teams do_GET (upstream unreachable)", e)
            if cached:
                stale = dict(cached); stale["source"] = "stale"
                self._respond(200, stale)
            else:
                self._respond(502, {"error": "Couldn't reach CFBD — try again shortly."})
            return
        except Exception as e:
            _log_server_error("fetch_teams do_GET", e)
            if cached:
                stale = dict(cached); stale["source"] = "stale"
                self._respond(200, stale)
            else:
                self._respond(500, {"error": GENERIC_SERVER_ERROR})
            return

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Cfbd-Api-Key")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Cache-Control", "private, no-store, max-age=0")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
