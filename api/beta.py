"""PickGauge first-party beta analytics + feedback endpoint.

POST /api/beta
  {"type":"event","event":"app_open","properties":{...}}
  {"type":"feedback","category":"bug","message":"...","tab":"board","device":"mobile"}

GET /api/beta?view=summary&days=30
GET /api/beta?view=feedback&days=30&limit=100
  Admin-only via the existing PICKGAUGE_ADMIN_UIDS Clerk-user allowlist.

Analytics is deliberately aggregate-first: no raw event stream is stored.
Daily hashes contain event counts/dimensions and a HyperLogLog stores a
SHA-256 pseudonymous user token solely for daily unique-user counts. Feedback
is stored separately in per-day Redis lists with a 400-day TTL.
"""
from http.server import BaseHTTPRequestHandler
import datetime
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
import jwt
from jwt import PyJWKClient

GENERIC_SERVER_ERROR = "Something went wrong processing that request — try again shortly."
MAX_BODY_BYTES = 8 * 1024
MAX_FEEDBACK_CHARS = 2000
RETENTION_SECONDS = 400 * 24 * 60 * 60
MAX_SUMMARY_DAYS = 90
MAX_FEEDBACK_RESULTS = 200

ALLOWED_EVENTS = {
    "app_open",
    "tab_view",
    "odds_refresh",
    "predictions_load",
    "powers_pdf_import",
    "pool_import",
    "my_numbers_manual",
    "my_numbers_csv_import",
    "snapshot_export",
    "pick_set",
    "entry_submitted",
    "feedback_submitted",
}
ALLOWED_CATEGORIES = {"bug", "idea", "confusing", "other"}
ALLOWED_TABS = {"snapshot", "board", "picks", "pools", "record", "account", "settings", "help"}
ALLOWED_DEVICES = {"mobile", "desktop"}
ALLOWED_CONTEXTS = {"overall", "pool"}
ALLOWED_SOURCES = {"button", "cache", "server", "pdf", "paste", "csv", "manual", "review"}

_CLERK_JWKS_URL = os.environ.get("CLERK_JWKS_URL")
_jwks_client = None
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


def _log_server_error(context, exc):
    """Keep raw exception detail server-side in Vercel logs only."""
    print(f"[api/beta.py] {context}: {exc}", file=sys.stderr)


def is_admin(uid):
    allowed = os.environ.get("PICKGAUGE_ADMIN_UIDS", "")
    admin_ids = {u.strip() for u in allowed.split(",") if u.strip()}
    return uid in admin_ids


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


def kv_command(*parts):
    base, token = _kv_creds()
    if not base or not token:
        return None
    req = urllib.request.Request(
        base,
        data=json.dumps(list(parts)).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.loads(res.read().decode())
        return data.get("result")


def kv_eval(script, keys, args):
    return kv_command("EVAL", script, len(keys), *keys, *args)


RATE_LIMIT_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if count > tonumber(ARGV[1]) then return 1 else return 0 end
"""

ANALYTICS_SCRIPT = """
redis.call('HINCRBY', KEYS[1], 'event:' .. ARGV[1], 1)
for i=2,#ARGV-2,2 do
  if ARGV[i] ~= '' and ARGV[i+1] ~= '' then
    redis.call('HINCRBY', KEYS[1], 'event:' .. ARGV[1] .. '|' .. ARGV[i] .. ':' .. ARGV[i+1], 1)
  end
end
redis.call('PFADD', KEYS[2], ARGV[#ARGV-1])
redis.call('EXPIRE', KEYS[1], ARGV[#ARGV])
redis.call('EXPIRE', KEYS[2], ARGV[#ARGV])
return 1
"""

FEEDBACK_SCRIPT = """
redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, 199)
redis.call('EXPIRE', KEYS[1], ARGV[2])
return redis.call('LLEN', KEYS[1])
"""

SUMMARY_SCRIPT = """
local uu = {}
for i=2,#KEYS,2 do table.insert(uu, KEYS[i]) end
local range_unique = 0
if #uu > 0 then range_unique = redis.call('PFCOUNT', unpack(uu)) end
local out = {range_unique}
for i=1,#KEYS,2 do
  local day = ARGV[(i+1)/2]
  local unique = redis.call('PFCOUNT', KEYS[i+1])
  local vals = redis.call('HGETALL', KEYS[i])
  table.insert(out, day)
  table.insert(out, unique)
  table.insert(out, vals)
end
return out
"""

FEEDBACK_READ_SCRIPT = """
local out = {}
local remaining = tonumber(ARGV[1])
for i=1,#KEYS do
  if remaining <= 0 then break end
  local vals = redis.call('LRANGE', KEYS[i], 0, remaining-1)
  for _,v in ipairs(vals) do
    table.insert(out, v)
    remaining = remaining - 1
    if remaining <= 0 then break end
  end
end
return out
"""


def rate_limited(uid, bucket, limit, window_seconds):
    try:
        token = hashlib.sha256(uid.encode()).hexdigest()[:24]
        return kv_eval(RATE_LIMIT_SCRIPT, [f"ratelimit:beta:{bucket}:{token}"], [str(limit), str(window_seconds)]) == 1
    except Exception:
        return False


def _utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


def _date_keys(prefix, days):
    today = _utc_now().date()
    return [f"{prefix}:{today-datetime.timedelta(days=i)}" for i in range(days)]


def _parse_int(value, default, lo, hi):
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    return max(lo, min(hi, n))


def _safe_props(raw):
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    tab = str(raw.get("tab") or "").strip().lower()
    device = str(raw.get("device") or "").strip().lower()
    context = str(raw.get("context") or "").strip().lower()
    source = str(raw.get("source") or "").strip().lower()
    if tab in ALLOWED_TABS:
        out["tab"] = tab
    if device in ALLOWED_DEVICES:
        out["device"] = device
    if context in ALLOWED_CONTEXTS:
        out["context"] = context
    if source in ALLOWED_SOURCES:
        out["source"] = source
    return out


def _track_event(uid, event, props):
    now = _utc_now()
    day = now.date().isoformat()
    user_token = hashlib.sha256(uid.encode()).hexdigest()
    safe = _safe_props(props)
    argv = [event]
    for key in ("tab", "device", "context", "source"):
        argv.extend([key, safe.get(key, "")])
    argv.extend([user_token, str(RETENTION_SECONDS)])
    return kv_eval(
        ANALYTICS_SCRIPT,
        [f"beta:analytics:{day}", f"beta:analytics:uu:{day}"],
        argv,
    )


def _store_feedback(uid, body):
    category = str(body.get("category") or "").strip().lower()
    message = str(body.get("message") or "").strip()
    if category not in ALLOWED_CATEGORIES:
        return None, "Choose a valid feedback category."
    if len(message) < 3:
        return None, "Feedback is too short."
    if len(message) > MAX_FEEDBACK_CHARS:
        return None, f"Feedback is too long — maximum {MAX_FEEDBACK_CHARS} characters."
    props = _safe_props(body)
    now = _utc_now()
    record = {
        "id": hashlib.sha256(f"{uid}:{now.isoformat()}:{message}".encode()).hexdigest()[:16],
        "createdAt": now.isoformat(),
        "user": hashlib.sha256(uid.encode()).hexdigest()[:16],
        "category": category,
        "message": message,
        "tab": props.get("tab"),
        "device": props.get("device"),
        "context": props.get("context"),
    }
    key = f"beta:feedback:{now.date().isoformat()}"
    stored = kv_eval(FEEDBACK_SCRIPT, [key], [json.dumps(record, separators=(",", ":")), str(RETENTION_SECONDS)])
    if stored is None:
        return None, "Feedback storage is temporarily unavailable — please try again."
    try:
        _track_event(uid, "feedback_submitted", props)
    except Exception:
        # The explicit feedback is already safely stored. A non-critical
        # aggregate analytics increment must never turn that success into a
        # false 500 response for the person who submitted it.
        pass
    return record["id"], None


def _analytics_summary(days):
    dates = [(_utc_now().date() - datetime.timedelta(days=i)).isoformat() for i in range(days)]
    keys = []
    for day in dates:
        keys.extend([f"beta:analytics:{day}", f"beta:analytics:uu:{day}"])
    raw = kv_eval(SUMMARY_SCRIPT, keys, dates) or []
    range_unique = 0
    if raw:
        try:
            range_unique = int(raw[0] or 0)
        except (TypeError, ValueError):
            range_unique = 0
        raw = raw[1:]
    day_rows = []
    totals = {}
    total_unique_daily = 0
    for i in range(0, len(raw), 3):
        try:
            day, unique, flat = raw[i], int(raw[i+1] or 0), raw[i+2] or []
        except (IndexError, TypeError, ValueError):
            continue
        counts = {}
        for j in range(0, len(flat), 2):
            if j + 1 >= len(flat):
                break
            try:
                counts[str(flat[j])] = int(flat[j+1])
            except (TypeError, ValueError):
                continue
        for k, v in counts.items():
            if "|" not in k:
                totals[k] = totals.get(k, 0) + v
        total_unique_daily += unique
        day_rows.append({"date": day, "uniqueUsers": unique, "counts": counts})
    return {"days": day_rows, "totals": totals, "uniqueUsers": range_unique, "sumDailyUniqueUsers": total_unique_daily}


def _feedback_list(days, limit):
    keys = _date_keys("beta:feedback", days)
    raw = kv_eval(FEEDBACK_READ_SCRIPT, keys, [str(limit)]) or []
    out = []
    for item in raw:
        try:
            obj = json.loads(item)
            if isinstance(obj, dict):
                out.append(obj)
        except (TypeError, json.JSONDecodeError):
            continue
    out.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return out[:limit]


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
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        if length > MAX_BODY_BYTES:
            self._respond(413, {"error": "Request body too large."})
            return
        try:
            raw = self.rfile.read(length)
            if len(raw) > MAX_BODY_BYTES:
                self._respond(413, {"error": "Request body too large."})
                return
            body = json.loads(raw.decode())
            if not isinstance(body, dict):
                raise ValueError("not object")
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
            self._respond(400, {"error": "Body was not valid JSON."})
            return

        kind = str(body.get("type") or "").strip().lower()
        try:
            if kind == "event":
                if rate_limited(uid, "event", 180, 60):
                    self._respond(429, {"error": "Too many analytics events — please slow down."})
                    return
                event = str(body.get("event") or "").strip().lower()
                if event not in ALLOWED_EVENTS:
                    self._respond(400, {"error": "Unknown analytics event."})
                    return
                _track_event(uid, event, body.get("properties"))
                self._respond(200, {"ok": True})
                return
            if kind == "feedback":
                if rate_limited(uid, "feedback", 5, 3600):
                    self._respond(429, {"error": "Too many feedback submissions — please wait before sending another."})
                    return
                feedback_id, error = _store_feedback(uid, body)
                if error:
                    self._respond(400, {"error": error})
                    return
                self._respond(200, {"ok": True, "id": feedback_id})
                return
            self._respond(400, {"error": "Unknown beta request type."})
        except urllib.error.URLError as e:
            _log_server_error("beta POST - Redis unavailable", e)
            self._respond(503, {"error": "Beta feedback service is temporarily unavailable."})
        except Exception as e:
            _log_server_error("beta POST", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

    def do_GET(self):
        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return
        if not is_admin(uid):
            self._respond(403, {"error": "Admin access required."})
            return
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        view = (params.get("view", ["summary"])[0] or "summary").strip().lower()
        days = _parse_int(params.get("days", [30])[0], 30, 1, MAX_SUMMARY_DAYS)
        try:
            if view == "summary":
                self._respond(200, _analytics_summary(days))
                return
            if view == "feedback":
                limit = _parse_int(params.get("limit", [100])[0], 100, 1, MAX_FEEDBACK_RESULTS)
                self._respond(200, {"feedback": _feedback_list(days, limit)})
                return
            self._respond(400, {"error": "Unknown admin view. Use summary or feedback."})
        except urllib.error.URLError as e:
            _log_server_error("beta GET - Redis unavailable", e)
            self._respond(503, {"error": "Beta analytics service is temporarily unavailable."})
        except Exception as e:
            _log_server_error("beta GET", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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
