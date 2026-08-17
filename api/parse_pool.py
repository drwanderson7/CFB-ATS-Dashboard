"""
Vercel Python serverless function: POST /api/parse_pool

Parses a pool pick-sheet into the week's slate as JSON. Two sources are
supported by design:

  - Splash Sports  (splashsports.com)  -- implemented, layout confirmed from a
    real Week-1 2026 export.
  - OfficeFootballPool (OFP)           -- stubbed; will be added once a real
    export is available. detect_source() routes to the right parser.

INPUT SHAPE -- text lines, not a raw PDF file.
A Splash export is a screenshot-style PDF: ~230 lines of real text plus dozens
of jersey-icon images, which routinely pushes the file past 20MB. Vercel's
serverless functions have a hard 4.5MB request body limit on every plan (an
AWS API Gateway limit Vercel sits on top of) -- not configurable in
vercel.json, and a 24MB pick sheet blew through it by 5x, so every import
failed with 413 Content Too Large. The images were never needed for parsing:
extracting text in the BROWSER first (via pdf.js) and sending only that text
shrinks the request from ~23MB to ~5KB, comfortably under the limit, and is
the actual fix -- not a bigger limit, which doesn't exist to raise.

So this endpoint takes JSON: {"lines": [...text lines in reading order...],
"year": 2026}. It never touches pdfplumber or raw PDF bytes; text extraction
already happened client-side.

Splash export layout (clean text layer, one game per block):
    Thu, Sep 3 • 5:00 PM   Preview
    <Away Team>(<spread or TBD>)
    (0-0-0)
    <Home Team>(<spread or TBD>)
    (0-0-0)
Before the Wednesday spread lock every line reads "(TBD)"; after lock the number
appears in that slot. The footer "N/M picks made" gives the pool's pick limit.

Team names are sometimes truncated with an ellipsis in the export
("Eastern Michig…"); we return them verbatim and let the app prefix-match.

Response:
  {
    "source": "splash",
    "pickLimit": 7,                # from "0/7 picks made", or null
    "count": 43,
    "games": [
      {"away","home","commence","line","awaySpread","homeSpread"}, ...
    ]
  }
line is the home-perspective spread once locked (else null). awaySpread/homeSpread
keep the raw per-team values for when the sign convention is confirmed post-lock.
"""
from http.server import BaseHTTPRequestHandler
import json, re, os
import urllib.request
import jwt
from jwt import PyJWKClient

MONTHS = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,
          "Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}

# "Thu, Sep 3 • 5:00 PM" (the bullet may come through as • or similar)
HDR_RE = re.compile(r"^[A-Z][a-z]{2},\s+([A-Z][a-z]{2})\s+(\d{1,2})\s*[•·・]\s*(\d{1,2}):(\d{2})\s*([AP]M)")
# "Team Name(TBD)" or "Team Name(-3.5)" / "(+7)" ; excludes the "(0-0-0)" record line
TEAM_RE = re.compile(r"^(.*?)\((TBD|pk|PK|[-+]?\d+(?:\.\d+)?)\)\s*$")
RECORD_RE = re.compile(r"^\(\d+-\d+-\d+\)$")
# "0/7 picks made" -- confirmed against a real Splash export, so this is primary.
PICKS_RE = re.compile(r"(\d+)\s*/\s*(\d+)\s+picks\s+made", re.I)
# Not every Splash pool is pick-7, and this app must never assume it is. Splash
# pools with a different pick count almost certainly phrase this line
# differently (a plausible guess: "3 of 10 picks", "Picks: 0/10") -- this
# fallback is UNVERIFIED (no real non-pick-7 sample has been seen yet). If
# neither pattern matches, pick_limit comes back None and the app ASKS the
# user rather than silently defaulting to 7 -- that's the real safety net,
# not this regex's coverage.
PICKS_RE_ALT = re.compile(r"(\d+)\s+of\s+(\d+)\s+picks", re.I)


def _spread(raw):
    if raw is None:
        return None
    raw = raw.strip()
    if raw.upper() in ("TBD",):
        return None
    if raw.lower() == "pk":
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return None


def _commence(mon_abbr, day, hour, minute, ampm, year):
    m = MONTHS.get(mon_abbr)
    if not m:
        return None
    h = int(hour) % 12
    if ampm.upper() == "PM":
        h += 12
    return f"{year:04d}-{m:02d}-{int(day):02d}T{h:02d}:{int(minute):02d}:00"


def parse_splash(lines, year):
    games = []
    cur = None            # current kickoff ISO
    pending = []          # [(name, spread_raw)] collected under current header
    pick_limit = None

    def flush():
        if len(pending) >= 2:
            (aw, aw_s), (hm, hm_s) = pending[0], pending[1]
            home_line = _spread(hm_s)  # home-perspective slot (sign confirmed post-lock)
            games.append({
                "away": aw, "home": hm, "commence": cur,
                "line": home_line,
                "awaySpread": _spread(aw_s), "homeSpread": _spread(hm_s),
            })

    for ln in lines:
        pm = PICKS_RE.search(ln) or PICKS_RE_ALT.search(ln)
        if pm:
            pick_limit = int(pm.group(2))
            continue
        h = HDR_RE.match(ln)
        if h:
            flush()
            pending = []
            cur = _commence(h.group(1), h.group(2), h.group(3), h.group(4), h.group(5), year)
            continue
        if RECORD_RE.match(ln):
            continue
        t = TEAM_RE.match(ln)
        if t:
            name = t.group(1).strip()
            if name and "picks made" not in name.lower():
                pending.append((name, t.group(2)))
    flush()

    # de-dupe (a repeated block shouldn't double a game)
    seen, uniq = set(), []
    for g in games:
        k = (g["away"].lower(), g["home"].lower(), g["commence"])
        if k in seen:
            continue
        seen.add(k); uniq.append(g)
    return {"source": "splash", "pickLimit": pick_limit, "count": len(uniq), "games": uniq}


def detect_source(lines):
    blob = "\n".join(lines).lower()
    if "picks made" in blob or "spread locks" in blob:
        return "splash"
    # OFP detection to be added with a real sample
    return "splash"  # default; only Splash is implemented


def parse_pool_lines(lines, year):
    """lines: list[str], already text-extracted client-side (see module docstring
    for why -- avoids the 4.5MB serverless body limit that a raw pick-sheet PDF,
    padded with jersey icons, routinely blows past)."""
    lines = [str(l).strip() for l in (lines or []) if str(l).strip()]
    if not lines:
        raise ValueError("No text lines received.")
    src = detect_source(lines)
    if src == "splash":
        res = parse_splash(lines, year)
    else:
        raise ValueError(f"Unsupported pool source: {src}")
    if not res["games"]:
        raise ValueError("Couldn't find any games — is this a pool pick sheet?")
    return res


# ---------------------------------------------------------------------------
# Access gate -- verified Clerk session token. This exact verify_user()
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


# Rate-limit primitive duplicated from api/state.py -- see that file's
# comment on RATE_LIMIT_SCRIPT for the fixed-window design and why it
# fails open. No shared imports across Vercel functions (same reasoning
# as verify_user()'s own duplication above).
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
        self.send_response(200); self._cors(); self.end_headers()

    def do_POST(self):
        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return
        if rate_limited(uid, "parse_pool", 10, 60):
            self._respond(429, {"error": "Too many requests — please wait a bit before trying again."})
            return
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._respond(400, {"error": "Expected JSON body with a 'lines' array (text already extracted client-side)."})
            return
        lines = body.get("lines")
        try:
            year = int(body.get("year"))
        except (TypeError, ValueError):
            from datetime import datetime, timezone
            year = datetime.now(timezone.utc).year
        try:
            self._respond(200, parse_pool_lines(lines, year))
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status); self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers(); self.wfile.write(body)
