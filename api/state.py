"""
Vercel Python serverless function: GET/POST /api/state

Cross-device sync for Edge Board, split into two storage tiers so this can
support multiple people without them overwriting each other's picks:

  scope=shared  -> one fixed key, same data for everyone (Vegas lines pull,
                   predictiontracker.com rows, related fetch metadata,
                   published test pools). Redistributing someone's PAID
                   Powers PDF numbers to other people would be a licensing
                   problem (flagged in project notes) -- PDF-derived
                   BP/Comp numbers are NOT in this tier, they live in each
                   person's private state instead.

  scope=user    -> one key per person (picks, entries, pools, PDF-derived
                   inputs, model weights/thresholds, everything else).

AUTH: every request must carry a real, verified Clerk session token as
`Authorization: Bearer <token>`, checked against Clerk's public signing key
(RS256, fetched from CLERK_JWKS_URL and cached). The verified token's own
`sub` claim IS the private-tier key -- there's no client-supplied `id`
parameter. A forged or mistyped token is simply rejected.

SHARED-TIER WRITES (rewritten): a generic "POST scope=shared, body=anything"
used to exist, which meant ANY signed-in person could overwrite the one
global bucket everyone reads -- by accident (a stale/buggy client), or on
purpose. That's gone. The shared tier is now server-owned:
  - fetch_odds.py and fetch_predictions.py write their own slice of the
    shared bucket themselves, server-side, right after a successful fetch
    (see merge_shared() below) -- the browser never gets to POST that data.
  - The two remaining legitimate client-initiated shared writes (publishing
    a pool for "share for testing", and clearing shared prediction data)
    go through narrow, explicit `action=` endpoints below that can only
    touch their own named field(s) of the shared bucket, never the whole
    thing.
  - GET scope=shared is still open to any signed-in user (read-only).

PRIVATE-TIER CONCURRENCY (new): private writes now carry a revision number.
A POST must include `expectedRevision` matching what the server currently
has, or it's rejected with 409 (see _post_user_state) instead of silently
overwriting a newer write from another device with a stale one.

LEGACY MIGRATION (tightened): `claim_legacy` used to accept any `legacy_id`
from any signed-in user with no proof they owned that old handle -- since
the old system was just a self-typed, unverified handle, this meant User A
could type User B's old handle and pull User B's private data into their
own account. It's now gated behind a second, server-only secret
(MIGRATION_ADMIN_SECRET) that isn't the person's own Clerk token, so a
regular signed-in user can no longer self-serve someone else's bucket.

This exact verify_user() function is duplicated in every api/*.py file --
Vercel's Python runtime does not reliably support importing a sibling
module across these isolated functions (confirmed non-viable without a
live redeploy to test against, so not changed here -- see HANDOFF for the
tradeoff). api/state.py is the source-of-truth copy; a checked-in test
(tests/test_auth_sync.py) diffs this function's source against the other
six files and fails if they drift, replacing "keep them in sync by hand"
with something that actually catches drift.

Backed by Upstash Redis (see _kv_creds below for the env var names).
GET  -> {"state": <saved object for this scope, or null>, "revision": <int, scope=user only>}
POST -> body is the state JSON for that scope (scope=user requires
        ?expectedRevision=<int> and returns 409 on conflict).
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

# Fields on the shared bucket that server-side fetchers own and merge into
# independently (see merge_shared). Kept here so the publish_pool /
# clear_predictions actions below know exactly which fields they're allowed
# to touch, and never anything outside that list.
SHARED_ODDS_FIELDS = ("lastGames", "lastRefresh", "reqLeft", "booksSeen")
SHARED_PRED_FIELDS = ("predictions", "predMeta")

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


def _get_json(key):
    raw = kv_get(key)
    if raw is None:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except (TypeError, json.JSONDecodeError):
        return None


def merge_shared(field_names, values):
    """Read-modify-write ONLY the given field names into the shared bucket,
    leaving every other field (including other people's published test
    pools) untouched. Used by fetch_odds.py / fetch_predictions.py
    (server-owned writes) and by the narrow action= endpoints below --
    never by a generic client-supplied blob. Returns the merged bucket."""
    current = _get_json(SHARED_KEY) or {}
    for name, value in zip(field_names, values):
        current[name] = value
    kv_set(SHARED_KEY, json.dumps(current))
    return current


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
        scope = (params.get("scope", ["user"])[0] or "user").strip()
        if scope == "shared":
            obj = _get_json(SHARED_KEY)
            self._respond(200, {"state": obj})
            return
        if scope == "user":
            key = USER_KEY_PREFIX + uid
            obj = _get_json(key)
            rev = (obj or {}).get("_rev", 0)
            self._respond(200, {"state": obj, "revision": rev})
            return
        self._respond(400, {"error": f"Unknown scope '{scope}'. Use 'shared' or 'user'."})

    def do_POST(self):
        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        action = (params.get("action", [""])[0] or "").strip()

        if action == "claim_legacy":
            self._claim_legacy(params)
            return
        if action == "publish_pool":
            self._publish_pool(uid)
            return
        if action == "clear_predictions":
            merge_shared(SHARED_PRED_FIELDS, (None, None))
            self._respond(200, {"ok": True})
            return

        scope = (params.get("scope", ["user"])[0] or "user").strip()
        if scope == "shared":
            # Generic client writes to the shared blob are no longer
            # accepted -- see module docstring. Anything legitimate that
            # used to go through here now has its own action= above, or is
            # written server-side by fetch_odds.py / fetch_predictions.py.
            self._respond(
                410,
                {"error": "Direct shared-state writes have been removed. "
                          "Use action=publish_pool or action=clear_predictions, "
                          "or refresh lines/predictions (the server writes shared "
                          "data itself now)."},
            )
            return
        if scope != "user":
            self._respond(400, {"error": f"Unknown scope '{scope}'. Use 'shared' or 'user'."})
            return

        self._post_user_state(uid, params)

    def _post_user_state(self, uid, params):
        key = USER_KEY_PREFIX + uid
        try:
            length = int(self.headers.get("Content-Length", 0))
            body_raw = self.rfile.read(length).decode()
            body = json.loads(body_raw)
            if not isinstance(body, dict):
                self._respond(400, {"error": "Body must be a JSON object."})
                return
        except json.JSONDecodeError:
            self._respond(400, {"error": "Body was not valid JSON"})
            return

        try:
            current = _get_json(key)
            current_rev = (current or {}).get("_rev", 0)

            expected_raw = (params.get("expectedRevision", [None])[0])
            if expected_raw is not None:
                try:
                    expected_rev = int(expected_raw)
                except ValueError:
                    self._respond(400, {"error": "expectedRevision must be an integer."})
                    return
                if expected_rev != current_rev:
                    # Someone else's write landed since this client last
                    # pulled. Reject instead of silently clobbering it --
                    # the client is expected to pull the latest state and
                    # either merge or inform the person, then retry.
                    self._respond(409, {
                        "error": "conflict",
                        "message": "Your data changed on another device since you last synced.",
                        "serverRevision": current_rev,
                        "state": current,
                    })
                    return
            # No expectedRevision supplied at all = first-ever write for a
            # brand-new user (nothing to conflict with) -- allowed through.

            new_rev = current_rev + 1
            body["_rev"] = new_rev
            ok = kv_set(key, json.dumps(body))
            if not ok:
                self._respond(500, {"error": "KV not configured (missing env vars)"})
                return
            self._respond(200, {"ok": True, "revision": new_rev})
        except urllib.error.URLError as e:
            self._respond(500, {"error": "KV unreachable: " + str(e)})
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _publish_pool(self, uid):
        """Adds/updates ONE pool's structure (games, locked lines, name,
        pick limit -- never entries/picks) in the shared bucket's
        sharedPools list. Only ever touches sharedPools, and only the
        single pool object in the request body -- never a full-bucket
        replace, so this can't be used to clobber odds/predictions or
        someone else's published pool."""
        try:
            length = int(self.headers.get("Content-Length", 0))
            body_raw = self.rfile.read(length).decode()
            pool = json.loads(body_raw)
            if not isinstance(pool, dict) or not pool.get("id"):
                self._respond(400, {"error": "Body must be a pool object with an 'id'."})
                return
            # Strip anything that isn't structure -- defense in depth even
            # though the client isn't supposed to send entries/picks here.
            safe_pool = {
                "id": pool.get("id"),
                "name": pool.get("name"),
                "games": pool.get("games"),
                "weekLabel": pool.get("weekLabel"),
                "pickLimit": pool.get("pickLimit"),
                "source": pool.get("source"),
                "publishedBy": uid,
                "publishedAt": pool.get("publishedAt"),
            }
            current = _get_json(SHARED_KEY) or {}
            pools = current.get("sharedPools") or []
            pools = [p for p in pools if p.get("id") != safe_pool["id"]]
            pools.append(safe_pool)
            current["sharedPools"] = pools
            kv_set(SHARED_KEY, json.dumps(current))
            self._respond(200, {"ok": True})
        except json.JSONDecodeError:
            self._respond(400, {"error": "Body was not valid JSON"})
        except urllib.error.URLError as e:
            self._respond(500, {"error": "KV unreachable: " + str(e)})
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _claim_legacy(self, params):
        """One-time migration for people who used the old passphrase+handle
        system before real accounts existed: copies their old
        edge_board_user_{legacy_id} bucket into their new verified
        edge_board_user_{uid} bucket.

        SECURITY: this now requires MIGRATION_ADMIN_SECRET as a SEPARATE
        header (X-Migration-Secret) from the person's own Clerk token. The
        old handle was never a real credential, so knowing it (or guessing
        a common one) proved nothing about ownership -- any signed-in user
        could otherwise pull ANY other person's private legacy bucket into
        their own account. If MIGRATION_ADMIN_SECRET isn't set in Vercel,
        this endpoint is fully disabled (safe default). Run migrations for
        the handful of real legacy users by sharing that secret with
        yourself only, or by curling this endpoint on their behalf.
        """
        admin_secret = os.environ.get("MIGRATION_ADMIN_SECRET")
        if not admin_secret:
            self._respond(403, {"error": "Legacy migration is disabled (MIGRATION_ADMIN_SECRET not set)."})
            return
        supplied = self.headers.get("X-Migration-Secret", "")
        if supplied != admin_secret:
            self._respond(403, {"error": "Invalid or missing X-Migration-Secret header."})
            return

        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return

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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Migration-Secret")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
