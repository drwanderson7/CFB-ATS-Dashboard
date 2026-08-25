"""
Vercel Python serverless function: POST /api/parse_pdf
Accepts a multipart/form-data PDF upload, returns JSON array of CFB games.
Each game: {away, home, bp, comp, homeVegas}
All spreads in home-team perspective (negative = home favored).
"""
from http.server import BaseHTTPRequestHandler
import json, re, io, os, sys
import urllib.request
import jwt
from jwt import PyJWKClient
from collections import defaultdict
import pdfplumber

# See api/state.py's own GENERIC_SERVER_ERROR/_log_server_error() comment.
GENERIC_SERVER_ERROR = "Something went wrong processing that request — try again shortly."


def _log_server_error(context, exc):
    print(f"[api/parse_pdf.py] {context}: {exc}", file=sys.stderr)


def parse_pdf_bytes(pdf_bytes: bytes) -> list:
    pdf = pdfplumber.open(io.BytesIO(pdf_bytes))

    def get_rows(page):
        h = page.height
        words = page.extract_words(keep_blank_chars=False)
        buckets = defaultdict(list)
        for w in words:
            y = round(h - w["top"])
            buckets[y].append(w)
        return {y: sorted(v, key=lambda x: x["x0"]) for y, v in buckets.items()}

    def nearest(row, target_x, tol=20):
        best, bd = None, 9999
        for w in row:
            d = abs(w["x0"] - target_x)
            if d < bd:
                bd, best = d, w
        return best["text"] if best and bd < tol else None

    def p_num(t):
        if t is None:
            return None
        t = str(t).strip().replace("+", "")
        if re.match(r"^pk", t, re.I):
            return 0.0
        try:
            return float(t)
        except ValueError:
            return None

    TV = {"ESPN","ESPN2","ESPN+","ESPNU","CBSSN","FS1","SECN","SECN+",
          "ACCN","BTN","TNT","CW","FOX","CBS","ABC","NBC","Prime"}

    # Page 2: schedule — Current@226.4, BP@273.4 (left); Current@502, BP@549 (right)
    BLOCKS2 = [
        {"lo": 0,   "hi": 300, "rX": 36.4,  "tlo": 50,  "thi": 145, "curX": 226.4, "bpX": 273.4},
        {"lo": 300, "hi": 620, "rX": 312.0, "tlo": 326, "thi": 420, "curX": 502.0, "bpX": 549.0},
    ]
    m2 = {}
    # Page positions used to be hardcoded (index 1 and 5). If Powers ever adds
    # or removes a page, that silently parsed the wrong pages -- or raised
    # IndexError on a shorter PDF. Locate them by their column headers instead,
    # falling back to the historical positions.
    def _find_page(*needles, fallback):
        for i, pg in enumerate(pdf.pages):
            t = pg.extract_text() or ""
            if all(n in t for n in needles):
                return i
        return fallback

    sched_idx = _find_page("Current", "BP", fallback=1)
    comp_idx = _find_page("Comp", "Diff", fallback=5)
    if sched_idx >= len(pdf.pages) or comp_idx >= len(pdf.pages):
        raise ValueError("This PDF doesn't look like a Powers newsletter (missing schedule/computer pages).")

    for _y, row in get_rows(pdf.pages[sched_idx]).items():
        for b in BLOCKS2:
            r = [w for w in row if b["lo"] <= w["x0"] < b["hi"]]
            if not r:
                continue
            rot_w = min(r, key=lambda w: abs(w["x0"] - b["rX"]))
            if abs(rot_w["x0"] - b["rX"]) > 5 or not re.match(r"^\d{3}$", rot_w["text"]):
                continue
            rot = int(rot_w["text"])
            team = " ".join(
                w["text"] for w in r
                if b["tlo"] <= w["x0"] < b["thi"]
                and re.search(r"[a-z]", w["text"], re.I)
                and w["text"] not in TV
                and ":" not in w["text"]
            )
            m2[rot] = {"team": team.strip(), "cur": p_num(nearest(r, b["curX"])), "bp": p_num(nearest(r, b["bpX"]))}

    # Page 6: computer lines — Comp@157 (left), Comp@338.8 (right)
    BLOCKS6 = [
        {"lo": 0,   "hi": 215, "rX": 36.0,  "compX": 157.0},
        {"lo": 215, "hi": 410, "rX": 217.8, "compX": 338.8},
    ]
    m6 = {}
    for _y, row in get_rows(pdf.pages[comp_idx]).items():
        for b in BLOCKS6:
            r = [w for w in row if b["lo"] <= w["x0"] < b["hi"]]
            if not r:
                continue
            rot_w = min(r, key=lambda w: abs(w["x0"] - b["rX"]))
            if abs(rot_w["x0"] - b["rX"]) > 5 or not re.match(r"^\d{3}$", rot_w["text"]):
                continue
            rot = int(rot_w["text"])
            comp = p_num(nearest(r, b["compX"]))
            if comp is not None:
                m6[rot] = {"comp": comp}

    # Pair games — CFB only (rot < 261), odd=away, even=home
    games = []
    for r in sorted(m2):
        if r >= 261 or r % 2 != 1 or r + 1 not in m2:
            continue
        a, h = m2[r], m2[r + 1]
        a_spread = a["cur"] is not None and a["cur"] <= 0.5
        h_spread = h["cur"] is not None and h["cur"] <= 0.5
        home_bp = home_vegas = None
        if a_spread and not h_spread:
            home_bp    = -a["bp"]  if a["bp"]  is not None else None
            home_vegas = -a["cur"] if a["cur"] is not None else None
        elif h_spread and not a_spread:
            home_bp    = h["bp"]
            home_vegas = h["cur"]
        elif a["cur"] is not None and h["cur"] is not None:
            if a["cur"] < h["cur"]:
                home_bp    = -a["bp"]  if a["bp"]  is not None else None
                home_vegas = -a["cur"]
            else:
                home_bp    = h["bp"]
                home_vegas = h["cur"]
        comp = m6.get(r + 1, {}).get("comp")
        # A garbled row in the PDF text layer can yield a wild BP number. Drop
        # it rather than poison the average -- but FLAG it, so an empty BP cell
        # caused by this guard is distinguishable from one the PDF never had.
        bp_suspect = False
        if home_bp is not None and comp is not None and abs(home_bp - comp) > 14:
            home_bp = None
            bp_suspect = True
        games.append({"away": a["team"], "home": h["team"],
                      "bp": home_bp, "comp": comp, "homeVegas": home_vegas,
                      "bpSuspect": bp_suspect})
    return games


def parse_multipart(body: bytes, content_type: str):
    """Extract the first file from a multipart/form-data body."""
    boundary = None
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part[len("boundary="):].strip('"')
    if not boundary:
        return None
    sep = ("--" + boundary).encode()
    parts = body.split(sep)
    for part in parts[1:]:
        if b"\r\n\r\n" not in part:
            continue
        header_block, _, data = part.partition(b"\r\n\r\n")
        # Each part is terminated by exactly "\r\n" right before the next
        # boundary marker (already removed by the split above). Strip only
        # that literal 2-byte suffix -- NOT bytes.rstrip(), which treats its
        # argument as a set of characters to trim and can eat into the
        # tail of legitimate binary PDF content.
        if data.endswith(b"\r\n"):
            data = data[:-2]
        if b"filename" in header_block:
            return data
    return None


# ---------------------------------------------------------------------------
# Optional access gate.
#
# These endpoints are reachable by anyone who knows the deployment URL. Without
# a gate, /api/state in particular hands over (GET) or overwrites (POST) the
# entire pick history to any caller, and the wildcard CORS header let any
# website do it silently from inside your browser.
#
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


# Vercel's serverless functions already hard-cap request bodies at 4.5MB
# platform-side (see api/parse_pool.py's own module docstring for where
# that number comes from and why it isn't configurable) -- anything bigger
# never reaches this code at all. MAX_PDF_BODY_BYTES matches that same
# number anyway rather than skipping our own check: Vercel's platform-level
# rejection is an opaque generic error page, not a clean app JSON response,
# and this is also the only guard left standing if that platform limit is
# ever raised or changed. A real Powers newsletter PDF is a few hundred KB;
# this is nowhere close to pinching a legitimate upload.
MAX_PDF_BODY_BYTES = 4_500_000


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return
        if rate_limited(uid, "parse_pdf", 10, 60):
            self._respond(429, {"error": "Too many requests — please wait a bit before trying again."})
            return
        ct = self.headers.get("Content-Type", "")
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        if length > MAX_PDF_BODY_BYTES:
            self._respond(413, {"error": f"PDF too large ({length} bytes) -- the limit is {MAX_PDF_BODY_BYTES} bytes."})
            return
        body = self.rfile.read(length)
        if len(body) > MAX_PDF_BODY_BYTES:
            self._respond(413, {"error": f"PDF too large ({len(body)} bytes) -- the limit is {MAX_PDF_BODY_BYTES} bytes."})
            return

        if "multipart/form-data" in ct:
            pdf_bytes = parse_multipart(body, ct)
        else:
            pdf_bytes = body  # raw PDF body fallback

        if not pdf_bytes:
            self._respond(400, {"error": "No PDF received"})
            return

        try:
            games = parse_pdf_bytes(pdf_bytes)
            self._respond(200, games)
        except Exception as e:
            _log_server_error("parse_pdf do_POST", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

    def _cors(self):
        # no wildcard CORS: the app is same-origin, only third parties needed it
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
