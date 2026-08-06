"""
Vercel Python serverless function: GET/POST /api/state

Cross-device sync for Edge Board, split into two storage tiers so this can
support multiple people without them overwriting each other's picks:

  scope=shared  -> one fixed key, same data for everyone (Vegas lines pull,
                   predictiontracker.com rows, related fetch metadata).
                   Redistributing someone's PAID Powers PDF numbers to other
                   people would be a licensing problem (flagged in project
                   notes) -- PDF-derived BP/Comp numbers are NOT in this tier,
                   they live in each person's private state instead.

  scope=user&id=X -> one key per person (picks, entries, pools, PDF-derived
                   inputs, model weights/thresholds, everything else). `id`
                   is a self-chosen handle, not a real login -- see below.

Both scopes still require the same APP_SECRET passphrase to reach at all
(the auth gate is unchanged). `id` just namespaces which private bucket a
request reads/writes -- it is NOT itself a security boundary. Anyone who
has the shared passphrase could still read/write any `id`'s bucket by typing
a different id. That's an accepted tradeoff for "20 trusted pool
participants who all got the same passphrase from the person running this,"
not a general multi-tenant auth system. If that ever needs to change, this
is the file that would grow real per-user credentials.

Backed by Upstash Redis (see _kv_creds below for the env var names).
GET  -> {"state": <saved object for this scope, or null>}
POST -> body is the full state JSON for that scope; stored as-is.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import urllib.parse
import urllib.request
import urllib.error

SHARED_KEY = "edge_board_shared"
USER_KEY_PREFIX = "edge_board_user_"
# Handles are cosmetic namespacing, not credentials -- but still worth a
# tight allowlist so a stray character can't produce a weird Redis key.
ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,40}$")


def _kv_creds():
    # Vercel's native "KV" product is retired -- storage is now provisioned
    # via an Upstash Redis integration through the Marketplace. Depending on
    # how it was installed, it may inject either the legacy KV_REST_API_*
    # names (kept for backward compatibility) or Upstash's own
    # UPSTASH_REDIS_REST_* names. Check both rather than assume one.
    url = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
    token = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    return url, token


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
        return data.get("result")


def kv_set(key, value_str: str) -> bool:
    base, token = _kv_creds()
    if not base or not token:
        return False
    req = urllib.request.Request(
        f"{base}/set/{urllib.parse.quote(key, safe='')}",
        data=value_str.encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "text/plain",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        json.loads(res.read().decode())
        return True


def _resolve_key(params):
    """Returns (redis_key, error_response) for the requested scope."""
    scope = (params.get("scope", ["user"])[0] or "user").strip()
    if scope == "shared":
        return SHARED_KEY, None
    if scope == "user":
        uid = (params.get("id", [None])[0] or "").strip()
        if not uid:
            return None, {"error": "scope=user requires an id (your device's handle, set in Settings)."}
        if not ID_RE.match(uid):
            return None, {"error": "id may only contain letters, numbers, - and _, up to 40 characters."}
        return USER_KEY_PREFIX + uid, None
    return None, {"error": f"Unknown scope '{scope}'. Use 'shared' or 'user'."}


# ---------------------------------------------------------------------------
# Access gate -- identical pattern to the other functions. Gates BOTH scopes
# equally; scope=user's `id` is namespacing, not an independent credential.
# ---------------------------------------------------------------------------
def _authorized(handler):
    secret = os.environ.get("APP_SECRET")
    if not secret:
        return True  # not configured -> open, same as before
    if handler.headers.get("X-Edge-Key") == secret:
        return True
    cron = os.environ.get("CRON_SECRET")
    auth = handler.headers.get("Authorization") or ""
    if cron and auth == f"Bearer {cron}":
        return True
    return False


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if not _authorized(self):
            self._respond(401, {"error": "Unauthorized — set the sync passphrase in Settings."})
            return
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        key, err = _resolve_key(params)
        if err:
            self._respond(400, err)
            return
        try:
            raw = kv_get(key)
            if raw is None:
                self._respond(200, {"state": None})
                return
            try:
                parsed = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                parsed = raw
            self._respond(200, {"state": parsed})
        except urllib.error.URLError as e:
            self._respond(500, {"error": "KV unreachable: " + str(e)})
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def do_POST(self):
        if not _authorized(self):
            self._respond(401, {"error": "Unauthorized — set the sync passphrase in Settings."})
            return
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        key, err = _resolve_key(params)
        if err:
            self._respond(400, err)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode()
            json.loads(body)  # validate before storing
            ok = kv_set(key, body)
            if not ok:
                self._respond(500, {"error": "KV not configured (missing env vars)"})
                return
            self._respond(200, {"ok": True})
        except json.JSONDecodeError:
            self._respond(400, {"error": "Body was not valid JSON"})
        except urllib.error.URLError as e:
            self._respond(500, {"error": "KV unreachable: " + str(e)})
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Edge-Key")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
