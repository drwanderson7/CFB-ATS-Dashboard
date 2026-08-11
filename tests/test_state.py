"""
Runtime tests for api/state.py -- executed against a real instance of the
handler class with a mocked Redis backend and mocked send_response/
send_header/end_headers (so we don't need a real socket), not just a
syntax check. Run with:

    python3 tests/test_state.py

Covers:
  - User A can no longer claim User B's legacy bucket by guessing/knowing
    User B's old handle (Priority 1 item #1).
  - A generic POST to scope=shared is rejected, not silently accepted
    (Priority 1 item #2).
  - A stale private-tier write (wrong expectedRevision) is rejected with
    409 instead of overwriting a newer server write (Priority 5 item #7).
"""
import importlib.util
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

spec = importlib.util.spec_from_file_location("state_api", os.path.join(ROOT, "api", "state.py"))
state_api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state_api)

failures = []
total_checks = [0]


def check(name, cond):
    total_checks[0] += 1
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        failures.append(name)


# ---------------------------------------------------------------------------
# Fake Redis: in-memory dict standing in for Upstash's REST API, and a fake
# request handler that skips BaseHTTPRequestHandler's real socket machinery
# but still runs the module's actual do_GET/do_POST/_claim_legacy/etc code.
# ---------------------------------------------------------------------------
FAKE_KV = {}


def fake_kv_get(key):
    return FAKE_KV.get(key)


def fake_kv_set(key, value_str):
    FAKE_KV[key] = value_str
    return True


state_api.kv_get = fake_kv_get
state_api.kv_set = fake_kv_set


class FakeHandler(state_api.handler):
    def __init__(self, method, path, headers=None, body=b""):
        self.path = path
        self.headers = headers or {}
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self._status = None
        self._resp_headers = {}

    def send_response(self, status, message=None):
        self._status = status

    def send_header(self, k, v):
        self._resp_headers[k] = v

    def end_headers(self):
        pass

    def json_body(self):
        return json.loads(self.wfile.getvalue().decode())


def call(method, path, headers=None, body_obj=None):
    body = json.dumps(body_obj).encode() if body_obj is not None else b""
    h = dict(headers or {})
    h.setdefault("Content-Length", str(len(body)))
    fh = FakeHandler(method, path, h, body)
    if method == "GET":
        fh.do_GET()
    else:
        fh.do_POST()
    return fh._status, fh.json_body()


AUTH_A = {"Authorization": "Bearer token-for-A"}
AUTH_B = {"Authorization": "Bearer token-for-B"}

# verify_user() checks a real JWT against Clerk's JWKS -- not meaningful to
# exercise here without live Clerk keys, so stub it to simulate "A" and "B"
# each being a genuinely distinct, verified user (which is the actual
# precondition these tests care about: given two DIFFERENT verified users,
# does the endpoint still let one touch the other's data).
_orig_verify = state_api.verify_user


def fake_verify_user(handler):
    auth = handler.headers.get("Authorization", "")
    if auth == "Bearer token-for-A":
        return "user_A"
    if auth == "Bearer token-for-B":
        return "user_B"
    return None


state_api.verify_user = fake_verify_user
state_api.handler.__module__  # no-op, just touching the class


# ---------------------------------------------------------------------------
# 1. Legacy claim: User B seeds an old-style bucket under a self-chosen
#    handle ("bobs_old_handle"). User A, fully authenticated as a DIFFERENT
#    real account, tries to claim it.
# ---------------------------------------------------------------------------
FAKE_KV.clear()
FAKE_KV["edge_board_user_bobs_old_handle"] = json.dumps({"picks": ["USER B's REAL PRIVATE DATA"]})

os.environ.pop("MIGRATION_ADMIN_SECRET", None)
status, body = call("POST", "/api/state?action=claim_legacy&legacy_id=bobs_old_handle", AUTH_A)
check("claim_legacy with no admin secret configured is refused (disabled by default)", status == 403)

os.environ["MIGRATION_ADMIN_SECRET"] = "real-secret-only-drew-knows"
status, body = call("POST", "/api/state?action=claim_legacy&legacy_id=bobs_old_handle", AUTH_A)
check("claim_legacy without the X-Migration-Secret header is refused even with a valid Clerk token", status == 403)
check("User A's bucket was NOT populated with User B's data", "edge_board_user_user_A" not in FAKE_KV)

status, body = call(
    "POST", "/api/state?action=claim_legacy&legacy_id=bobs_old_handle",
    {**AUTH_A, "X-Migration-Secret": "wrong-guess"},
)
check("claim_legacy with a wrong migration secret is refused", status == 403)

status, body = call(
    "POST", "/api/state?action=claim_legacy&legacy_id=bobs_old_handle",
    {**AUTH_A, "X-Migration-Secret": "real-secret-only-drew-knows"},
)
check("claim_legacy with the CORRECT admin secret succeeds (migration still possible when intended)", status == 200)
check(
    "...and only after the admin secret is supplied does the data move",
    json.loads(FAKE_KV["edge_board_user_user_A"])["picks"] == ["USER B's REAL PRIVATE DATA"],
)


# ---------------------------------------------------------------------------
# 2. Generic shared-blob POST is rejected.
# ---------------------------------------------------------------------------
FAKE_KV.clear()
status, body = call("POST", "/api/state?scope=shared", AUTH_A, {"lastGames": ["fabricated by a client"]})
check("generic POST scope=shared is rejected (410), not silently written", status == 410)
check("shared bucket was not created by the rejected write", "edge_board_shared" not in FAKE_KV)


# ---------------------------------------------------------------------------
# 3. Optimistic concurrency: stale write is rejected with 409.
# ---------------------------------------------------------------------------
FAKE_KV.clear()
status, body = call("POST", "/api/state?scope=user", AUTH_A, {"picks": ["first write, no prior revision"]})
check("first-ever write for a new user succeeds without expectedRevision", status == 200 and body.get("revision") == 1)

# Device 1 pulls (revision 1), then Device 2 pushes a change (revision 2)
# before Device 1 gets a chance to push its own stale copy.
status, body = call(
    "POST", "/api/state?scope=user&expectedRevision=1", AUTH_A,
    {"picks": ["device 2's newer write"]},
)
check("second write with correct expectedRevision=1 succeeds -> revision 2", status == 200 and body.get("revision") == 2)

# Device 1, unaware of Device 2's write, now tries to push its own stale
# copy still claiming expectedRevision=1.
status, body = call(
    "POST", "/api/state?scope=user&expectedRevision=1", AUTH_A,
    {"picks": ["device 1's STALE write -- should NOT land"]},
)
check("stale write (expectedRevision=1, server is now at 2) is rejected with 409", status == 409)
check("409 response includes the current server state so the client can reconcile",
      body.get("state", {}).get("picks") == ["device 2's newer write"])

status, _ = call("GET", "/api/state?scope=user", AUTH_A)
final = FAKE_KV.get("edge_board_user_user_A")
check(
    "server data still reflects device 2's write, NOT the rejected stale overwrite",
    json.loads(final)["picks"] == ["device 2's newer write"],
)


# ---------------------------------------------------------------------------
# 4. publish_pool only ever touches sharedPools, never other shared fields.
# ---------------------------------------------------------------------------
FAKE_KV.clear()
FAKE_KV["edge_board_shared"] = json.dumps({"lastGames": ["real odds data"], "sharedPools": []})
status, body = call(
    "POST", "/api/state?action=publish_pool", AUTH_A,
    {"id": "pool123", "name": "Test Pool", "games": [], "pickLimit": 7},
)
check("publish_pool succeeds", status == 200)
shared_after = json.loads(FAKE_KV["edge_board_shared"])
check("publish_pool did not touch lastGames", shared_after["lastGames"] == ["real odds data"])
check("publish_pool added the pool to sharedPools", any(p["id"] == "pool123" for p in shared_after["sharedPools"]))

# Ownership: User B must NOT be able to overwrite User A's already-published
# pool just by reusing its id -- an earlier version of this endpoint had no
# such check at all (its own docstring incorrectly claimed otherwise).
status, body = call(
    "POST", "/api/state?action=publish_pool", AUTH_B,
    {"id": "pool123", "name": "Hijacked by B", "games": [], "pickLimit": 7},
)
check("User B cannot overwrite User A's published pool (403)", status == 403)
shared_after_hijack_attempt = json.loads(FAKE_KV["edge_board_shared"])
still_a = next(p for p in shared_after_hijack_attempt["sharedPools"] if p["id"] == "pool123")
check("...and the pool's content is unchanged", still_a["name"] == "Test Pool" and still_a["publishedBy"] == "user_A")

# The original publisher CAN still update their own pool.
status, body = call(
    "POST", "/api/state?action=publish_pool", AUTH_A,
    {"id": "pool123", "name": "Test Pool Updated", "games": [], "pickLimit": 7},
)
check("User A (the original publisher) can still update their own pool", status == 200)
shared_after_real_update = json.loads(FAKE_KV["edge_board_shared"])
updated = next(p for p in shared_after_real_update["sharedPools"] if p["id"] == "pool123")
check("...and the update actually applied", updated["name"] == "Test Pool Updated")


# ---------------------------------------------------------------------------
# 5. clear_predictions was removed entirely -- it used to let any signed-in
#    user wipe shared predictions for every other user.
# ---------------------------------------------------------------------------
FAKE_KV.clear()
FAKE_KV["edge_board_shared"] = json.dumps({"predictions": ["real prediction data"], "predMeta": {"count": 5}})
status, body = call("POST", "/api/state?action=clear_predictions", AUTH_A)
check("clear_predictions is gone (410), not silently accepted", status == 410)
shared_untouched = json.loads(FAKE_KV["edge_board_shared"])
check("...and shared predictions are untouched", shared_untouched["predictions"] == ["real prediction data"])


state_api.verify_user = _orig_verify

if failures:
    print(f"\n{len(failures)} of {total_checks[0]} FAILURE(S): {failures}")
    sys.exit(1)
print(f"\nAll {total_checks[0]} checks passed.")
