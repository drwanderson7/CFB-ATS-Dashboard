"""
Vercel Python serverless function: GET/POST /api/state

Cross-device sync for Edge Board. Backed by Vercel KV (Upstash Redis under
the hood). Requires KV_REST_API_URL and KV_REST_API_TOKEN env vars, which
Vercel sets automatically once you connect a KV store to this project
(Vercel dashboard -> Storage -> Create Database -> KV -> Connect Project).

If those env vars aren't set yet, this function degrades gracefully:
GET returns {"state": null} and POST returns a 500 with a clear message,
so the app keeps working locally (localStorage only) until KV is connected.

GET  -> {"state": <last saved state object, or null>}
POST -> body is the full state JSON; stored as-is under one fixed key.
        This is a single-user personal tool, so no auth/user separation.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.request
import urllib.error

STATE_KEY = "edge_board_state"


def _kv_creds():
    # Vercel's native "KV" product is retired -- storage is now provisioned
    # via an Upstash Redis integration through the Marketplace. Depending on
    # how it was installed, it may inject either the legacy KV_REST_API_*
    # names (kept for backward compatibility) or Upstash's own
    # UPSTASH_REDIS_REST_* names. Check both rather than assume one.
    url = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
    token = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    return url, token


def kv_get():
    base, token = _kv_creds()
    if not base or not token:
        return None
    req = urllib.request.Request(
        f"{base}/get/{STATE_KEY}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.loads(res.read().decode())
        return data.get("result")


def kv_set(value_str: str) -> bool:
    base, token = _kv_creds()
    if not base or not token:
        return False
    req = urllib.request.Request(
        f"{base}/set/{STATE_KEY}",
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


# ---------------------------------------------------------------------------
# Optional access gate.
#
# These endpoints are reachable by anyone who knows the deployment URL. Without
# a gate, /api/state in particular hands over (GET) or overwrites (POST) the
# entire pick history to any caller, and the wildcard CORS header let any
# website do it silently from inside your browser.
#
# Set an APP_SECRET environment variable in the Vercel dashboard to require a
# passphrase (entered once per device under Settings). If APP_SECRET is NOT
# set, everything behaves exactly as before -- so deploying this change never
# breaks a working install; you opt in when you're ready.
# ---------------------------------------------------------------------------
def _authorized(handler):
    secret = os.environ.get("APP_SECRET")
    if not secret:
        return True  # not configured -> open, same as before
    if handler.headers.get("X-Edge-Key") == secret:
        return True
    # Vercel Cron cannot send a custom header; it sends the CRON_SECRET bearer.
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
        try:
            raw = kv_get()
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
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode()
            json.loads(body)  # validate before storing
            ok = kv_set(body)
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
        # no wildcard CORS: the app is same-origin, only third parties needed it
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
