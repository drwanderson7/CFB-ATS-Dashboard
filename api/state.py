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

  scope=user    -> one key per person (picks, entries, pools, PDF-derived
                   inputs, model weights/thresholds, everything else).

AUTH (rewritten): every request must carry a real, verified Clerk session
token as `Authorization: Bearer <token>`, checked against Clerk's public
signing key (RS256, fetched from CLERK_JWKS_URL and cached). The verified
token's own `sub` claim IS the private-tier key -- there's no client-supplied
`id` parameter anymore. This replaces the old scheme (one shared APP_SECRET
passphrase plus a self-typed "handle" that was just namespacing, not a real
credential) specifically because a typo in that handle silently landed
someone in an empty bucket with zero warning -- a real incident, not a
hypothetical. A forged or mistyped token is simply rejected; there is no
string a person can mistype their way into someone else's data with anymore.

This exact verify_user() function is duplicated in every api/*.py file --
Vercel deploys each as an isolated function with no shared imports across
files, so this file is the source-of-truth copy; keep all others in sync
with it the same way teamMatch() is kept in sync between index.html and
grade_picks.py elsewhere in this project.

Backed by Upstash Redis (see _kv_creds below for the env var names).
GET  -> {"state": <saved object for this scope, or null>}
POST -> body is the full state JSON for that scope; stored as-is.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.parse
import urllib.request
import urllib.error
import jwt
from jwt import PyJWKClient

SHARED_KEY = "edge_board_shared"
USER_KEY_PREFIX = "edge_board_user_"

_CLERK_JWKS_URL = os.environ.get("CLERK_JWKS_URL")
_jwks_client = None


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None and _CLERK_JWKS_URL:
        _jwks_client = PyJWKClient(_CLERK_JWKS_URL)
    return _jwks_client


def verify_user(handler):
    """Returns the verified Clerk user ID from the Authorization header, or
    None if the token is missing, malformed, expired, or signed with a key
    that doesn't match Clerk's published JWKS (i.e. forged)."""
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


def _kv_creds():
    # Vercel's native "KV" product is retired -- storage is now provisioned
    # via an Upstash Redis integration through the Marketplace. Depending on
    # how it was installed, it may inject the legacy KV_REST_API_* names,
    # Upstash's own UPSTASH_REDIS_REST_* names, or -- as seen when connecting
    # via Vercel's Storage tab with a custom store name -- names prefixed
    # with that store's name (e.g. STORAGE_KV_REST_API_URL). Check all three
    # rather than assume one.
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


def _resolve_key(params, verified_uid):
    """Returns (redis_key, error_response) for the requested scope. `id` is
    no longer accepted as a query param for scope=user -- the verified
    token's own subject IS the key, closing off the old typo/impersonation
    failure mode entirely."""
    scope = (params.get("scope", ["user"])[0] or "user").strip()
    if scope == "shared":
        return SHARED_KEY, None
    if scope == "user":
        return USER_KEY_PREFIX + verified_uid, None
    return None, {"error": f"Unknown scope '{scope}'. Use 'shared' or 'user'."}


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
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        key, err = _resolve_key(params, uid)
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
        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        action = (params.get("action", [""])[0] or "").strip()
        if action == "claim_legacy":
            self._claim_legacy(params, uid)
            return
        key, err = _resolve_key(params, uid)
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

    def _claim_legacy(self, params, uid):
        """One-time migration for people who used the old passphrase+handle
        system before real accounts existed: copies their old
        edge_board_user_{legacy_id} bucket into their new verified
        edge_board_user_{uid} bucket. Refuses to run if the new bucket
        already has real data, unless force=1 -- this is what stops it from
        silently clobbering a real account's data if run twice by accident."""
        legacy_id = (params.get("legacy_id", [""])[0] or "").strip()
        force = (params.get("force", [""])[0] or "") == "1"
        if not legacy_id:
            self._respond(400, {"error": "legacy_id is required."})
            return
        try:
            new_key = USER_KEY_PREFIX + uid
            existing = kv_get(new_key)
            if existing and not force:
                self._respond(409, {"error": "Your account already has data. Pass force=1 to overwrite it with the legacy handle's data anyway."})
                return
            legacy_raw = kv_get(USER_KEY_PREFIX + legacy_id)
            if legacy_raw is None:
                self._respond(404, {"error": f"No data found under the handle '{legacy_id}'."})
                return
            ok = kv_set(new_key, legacy_raw)
            if not ok:
                self._respond(500, {"error": "KV not configured (missing env vars)"})
                return
            self._respond(200, {"ok": True, "migrated_from": legacy_id})
        except urllib.error.URLError as e:
            self._respond(500, {"error": "KV unreachable: " + str(e)})
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
