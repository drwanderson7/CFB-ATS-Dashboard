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
import threading
import datetime

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
FAKE_KV_LOCK = threading.Lock()


def fake_kv_get(key):
    return FAKE_KV.get(key)


def fake_kv_set(key, value_str):
    FAKE_KV[key] = value_str
    return True


def fake_kv_delete(key):
    FAKE_KV.pop(key, None)
    return True


def fake_kv_eval(script, keys, args):
    """Replicates CAS_SCRIPT's exact semantics against FAKE_KV, guarded by
    a real lock so genuinely concurrent callers (real Python threads, not
    just two sequential calls) get the same mutual-exclusion guarantee a
    real Redis EVAL provides server-side. This is what makes the
    concurrent-write test below a real test of the CAS *logic* under
    contention, not just a restatement of "call it twice in a row" --
    though it's still a mocked backend, not literally Upstash's Lua
    engine; see handoff.md for that caveat stated plainly."""
    key = keys[0]
    expected_rev = int(args[0])
    new_body_json = args[1]
    with FAKE_KV_LOCK:
        current_raw = FAKE_KV.get(key)
        current_rev = 0
        if current_raw:
            try:
                decoded = json.loads(current_raw)
                current_rev = decoded.get("_rev", 0)
            except (TypeError, json.JSONDecodeError):
                current_rev = 0
        if current_rev != expected_rev:
            return ["conflict", current_rev, current_raw or ""]
        FAKE_KV[key] = new_body_json
        return ["ok", expected_rev + 1, ""]


state_api.kv_get = fake_kv_get
state_api.kv_set = fake_kv_set
state_api.kv_delete = fake_kv_delete
state_api.kv_eval = fake_kv_eval


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

# --- is_admin(): reads PICKGAUGE_ADMIN_UIDS from the REAL environment,
# tested directly (before any monkeypatching of is_admin itself below)
# to prove the actual env-var parsing works, not just that some fake
# always says yes/no. ---
_orig_admin_env = os.environ.get("PICKGAUGE_ADMIN_UIDS")
try:
    os.environ["PICKGAUGE_ADMIN_UIDS"] = "user_A, user_C"
    check("is_admin: a uid in the comma-separated list is admin", state_api.is_admin("user_A") is True)
    check("is_admin: whitespace around a uid in the list is trimmed", state_api.is_admin("user_C") is True)
    check("is_admin: a uid NOT in the list is not admin", state_api.is_admin("user_B") is False)
    os.environ["PICKGAUGE_ADMIN_UIDS"] = ""
    check("is_admin: empty env var -> nobody is admin (fails toward nobody, not everybody)", state_api.is_admin("user_A") is False)
    del os.environ["PICKGAUGE_ADMIN_UIDS"]
    check("is_admin: unset env var -> nobody is admin (same safe default as empty)", state_api.is_admin("user_A") is False)
finally:
    if _orig_admin_env is None:
        os.environ.pop("PICKGAUGE_ADMIN_UIDS", None)
    else:
        os.environ["PICKGAUGE_ADMIN_UIDS"] = _orig_admin_env

# --- GET scope=user includes "isAdmin", reflecting is_admin(uid) for the
# CALLER specifically -- this is what the frontend (isAdminUser, set from
# pullTier() in app/js/sync.js) uses to hide pool-template publishing for
# non-admins instead of showing it and letting them discover the 403 by
# clicking it (see poolRowHTML()'s own comment in app/js/pool-contexts.js).
# Tested here, before the broad is_admin=lambda... monkeypatch just below
# unifies both test users into "admin" for the rest of this file's
# (unrelated) publish_pool tests. ---
os.environ["PICKGAUGE_ADMIN_UIDS"] = "user_A"
try:
    status, body = call("GET", "/api/state?scope=user", AUTH_A)
    check("GET scope=user: an admin user's response includes isAdmin=true",
          status == 200 and body.get("isAdmin") is True)
    status, body = call("GET", "/api/state?scope=user", AUTH_B)
    check("GET scope=user: a non-admin user's response includes isAdmin=false, not omitted or true",
          status == 200 and body.get("isAdmin") is False)
finally:
    os.environ.pop("PICKGAUGE_ADMIN_UIDS", None)

# For the rest of this file's PRE-EXISTING publish_pool tests below
# (ownership, atomic CAS, concurrent-publish race) -- none of which are
# actually about the admin gate itself -- both test users are treated as
# admins, so those tests stay isolated from this orthogonal concern. The
# admin gate's own actual enforcement gets its own dedicated section
# further down, with a deliberately stricter admin set.
state_api.is_admin = lambda uid: uid in ("user_A", "user_B")


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
# 3. Atomic compare-and-set: missing revision is rejected, stale write is
#    rejected with 409, and -- the actual point of this round of fixes --
#    genuinely CONCURRENT writes (real threads, not sequential calls) are
#    correctly serialized by the atomic CAS, not just detected after the
#    fact by a check that could itself race.
# ---------------------------------------------------------------------------
FAKE_KV.clear()
status, body = call("POST", "/api/state?scope=user", AUTH_A, {"picks": ["no revision supplied"]})
check("write with NO expectedRevision at all is rejected (428) -- Priority 2's actual fix, not just documented as required", status == 428)
check("...and nothing got written", "edge_board_user_user_A" not in FAKE_KV)

status, body = call("POST", "/api/state?scope=user&expectedRevision=0", AUTH_A, {"picks": ["first write, revision 0"]})
check("first-ever write for a new user succeeds with expectedRevision=0", status == 200 and body.get("revision") == 1)

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
      (body.get("state") or {}).get("picks") == ["device 2's newer write"])

status, _ = call("GET", "/api/state?scope=user", AUTH_A)
final = FAKE_KV.get("edge_board_user_user_A")
check(
    "server data still reflects device 2's write, NOT the rejected stale overwrite",
    json.loads(final)["picks"] == ["device 2's newer write"],
)

# ---------------------------------------------------------------------------
# 3b. GENUINE concurrent writes -- real threads, both racing to write at the
# SAME expected revision at (as close as this process can get to) the same
# moment. The old sequential test above proves stale-after-the-fact writes
# get rejected; it does NOT prove two simultaneous writers can't both slip
# through, which is the actual TOCTOU race this round's fix closes. This is
# the acceptance test the handoff explicitly required: "Do not accept a
# sequential simulation as sufficient proof."
# ---------------------------------------------------------------------------
FAKE_KV.clear()
call("POST", "/api/state?scope=user&expectedRevision=0", AUTH_A, {"picks": ["seed"]})
# Both threads believe the current revision is 1 (what the seed write
# returned) and race to write against that SAME expected revision.
concurrent_results = [None, None]
barrier = threading.Barrier(2)

def _racer(i, label):
    barrier.wait()  # both threads hit the actual write at the same instant
    status, body = call("POST", "/api/state?scope=user&expectedRevision=1", AUTH_A, {"picks": [label]})
    concurrent_results[i] = (status, body)

t1 = threading.Thread(target=_racer, args=(0, "racer A"))
t2 = threading.Thread(target=_racer, args=(1, "racer B"))
t1.start(); t2.start()
t1.join(); t2.join()

statuses = sorted(r[0] for r in concurrent_results)
check("exactly one concurrent writer succeeds (200) and exactly one conflicts (409)", statuses == [200, 409])

winner_body = next(r[1] for r in concurrent_results if r[0] == 200)
check("the winning write's reported revision is 2 (incremented exactly once, not twice)", winner_body.get("revision") == 2)

final_stored = json.loads(FAKE_KV["edge_board_user_user_A"])
check("final stored revision is exactly 2 -- no double-increment, no lost update silently landing at the wrong revision", final_stored.get("_rev") == 2)
winner_label = "racer A" if concurrent_results[0][0] == 200 else "racer B"
check("final stored content exactly matches the winning writer's payload (the loser's write did not partially apply)",
      final_stored.get("picks") == [winner_label])


# ---------------------------------------------------------------------------
# 4. publish_pool now lives on its own dedicated key (SHARED_POOLS_KEY),
#    never the legacy combined key or the odds/predictions keys -- and uses
#    real atomic CAS (not a plain get-then-set) so two concurrent publishes
#    can't silently drop one.
# ---------------------------------------------------------------------------
FAKE_KV.clear()
FAKE_KV["edge_board_shared_odds"] = json.dumps({"lastGames": ["real odds data"]})
status, body = call(
    "POST", "/api/state?action=publish_pool", AUTH_A,
    {"id": "pool123", "name": "Test Pool", "games": [], "pickLimit": 7},
)
check("publish_pool succeeds", status == 200)
check("publish_pool did not touch the odds key at all",
      json.loads(FAKE_KV["edge_board_shared_odds"])["lastGames"] == ["real odds data"])
pools_after = json.loads(FAKE_KV["edge_board_shared_pools"])
check("publish_pool wrote to its own dedicated key, not the legacy combined one",
      "edge_board_shared" not in FAKE_KV)
check("publish_pool added the pool to sharedPools", any(p["id"] == "pool123" for p in pools_after["sharedPools"]))

# Ownership: User B must NOT be able to overwrite User A's already-published
# pool just by reusing its id -- an earlier version of this endpoint had no
# such check at all (its own docstring incorrectly claimed otherwise).
status, body = call(
    "POST", "/api/state?action=publish_pool", AUTH_B,
    {"id": "pool123", "name": "Hijacked by B", "games": [], "pickLimit": 7},
)
check("User B cannot overwrite User A's published pool (403)", status == 403)
pools_after_hijack_attempt = json.loads(FAKE_KV["edge_board_shared_pools"])
still_a = next(p for p in pools_after_hijack_attempt["sharedPools"] if p["id"] == "pool123")
check("...and the pool's content is unchanged", still_a["name"] == "Test Pool" and still_a["publishedBy"] == "user_A")

# The original publisher CAN still update their own pool.
status, body = call(
    "POST", "/api/state?action=publish_pool", AUTH_A,
    {"id": "pool123", "name": "Test Pool Updated", "games": [], "pickLimit": 7},
)
check("User A (the original publisher) can still update their own pool", status == 200)
pools_after_real_update = json.loads(FAKE_KV["edge_board_shared_pools"])
updated = next(p for p in pools_after_real_update["sharedPools"] if p["id"] == "pool123")
check("...and the update actually applied", updated["name"] == "Test Pool Updated")

# One-time template lifecycle: the original publisher can remove the shared
# catalog entry, another admin cannot remove someone else's, and removal is
# idempotent. This never touches anyone's private/local copies.
status, body = call(
    "POST", "/api/state?action=unpublish_pool", AUTH_B,
    {"id": "pool123"},
)
check("User B cannot unpublish User A's template (403)", status == 403)
check("failed unpublish leaves the template in shared state",
      any(p["id"] == "pool123" for p in json.loads(FAKE_KV["edge_board_shared_pools"])["sharedPools"]))
status, body = call(
    "POST", "/api/state?action=unpublish_pool", AUTH_A,
    {"id": "pool123"},
)
check("original publisher can unpublish their own template", status == 200 and body.get("removed") is True)
check("successful unpublish removes only that catalog template",
      not any(p.get("id") == "pool123" for p in json.loads(FAKE_KV["edge_board_shared_pools"])["sharedPools"]))
status, body = call(
    "POST", "/api/state?action=unpublish_pool", AUTH_A,
    {"id": "pool123"},
)
check("unpublishing an already-absent template is idempotent", status == 200 and body.get("removed") is False)

# ---------------------------------------------------------------------------
# 4a. The admin gate itself, end to end through the real do_POST handler --
# not just calling is_admin() directly (already covered above), but
# proving a genuinely non-admin user gets a real 403 from the actual
# request path, and that request never touches the shared pools key at
# all (no partial/rejected-but-still-written state).
# ---------------------------------------------------------------------------
FAKE_KV.clear()
state_api.is_admin = lambda uid: uid == "user_A"  # deliberately stricter than the file-wide default above

status, body = call(
    "POST", "/api/state?action=publish_pool", AUTH_B,
    {"id": "poolAdminTest", "name": "Should Be Rejected", "games": [], "pickLimit": 7},
)
check("admin gate: a non-admin user's publish_pool is rejected with 403", status == 403)
check("admin gate: the 403 body explains why, not a generic/empty message",
      isinstance(body.get("error"), str) and len(body["error"]) > 0)
check("admin gate: the rejected pool was never actually written to KV",
      "edge_board_shared_pools" not in FAKE_KV)
status, body = call(
    "POST", "/api/state?action=unpublish_pool", AUTH_B,
    {"id": "anything"},
)
check("admin gate: a non-admin user's unpublish_pool is also rejected with 403", status == 403)

status, body = call(
    "POST", "/api/state?action=publish_pool", AUTH_A,
    {"id": "poolAdminTest", "name": "Should Succeed", "games": [], "pickLimit": 7},
)
check("admin gate: an actual admin's publish_pool still succeeds", status == 200)

state_api.is_admin = lambda uid: uid in ("user_A", "user_B")  # restore for the rest of this file

# The actual race this whole change exists to fix: two DIFFERENT pools
# published concurrently must both survive, not have one silently dropped
# by the other's read-modify-write landing in between. Real Python threads
# (not just two sequential calls), same pattern as the private-state
# concurrent-write test below -- exercises fake_kv_eval's real lock, not
# just "call it twice in a row and hope."
FAKE_KV.clear()
pool_c_result, pool_d_result = {}, {}


def _publish(auth, pool_id, name, result_slot):
    status, body = call(
        "POST", "/api/state?action=publish_pool", auth,
        {"id": pool_id, "name": name, "games": [], "pickLimit": 7},
    )
    result_slot["status"] = status


t1 = threading.Thread(target=_publish, args=(AUTH_A, "poolC", "Pool C", pool_c_result))
t2 = threading.Thread(target=_publish, args=(AUTH_B, "poolD", "Pool D", pool_d_result))
t1.start(); t2.start()
t1.join(); t2.join()
check("concurrent publish of pool C succeeded (not silently dropped)", pool_c_result.get("status") == 200)
check("concurrent publish of pool D succeeded (not silently dropped)", pool_d_result.get("status") == 200)
pools_after_race = json.loads(FAKE_KV["edge_board_shared_pools"])["sharedPools"]
check("BOTH concurrently-published pools survived (this is the actual race the fix closes)",
      {p["id"] for p in pools_after_race} == {"poolC", "poolD"})


# ---------------------------------------------------------------------------
# 4b. GET scope=shared merges the three per-domain keys into one flat
#    object (index.html's SHARED_FIELDS expects everything in one place),
#    and falls back to the legacy combined key for any field not yet
#    present under its new key -- so a fresh deploy doesn't blank out
#    whatever was already cached under the old key before this split.
# ---------------------------------------------------------------------------
FAKE_KV.clear()
FAKE_KV["edge_board_shared_odds"] = json.dumps({"lastGames": ["new-key odds"], "lastRefresh": "2026-08-01T00:00:00Z"})
FAKE_KV["edge_board_shared_pools"] = json.dumps({"sharedPools": [{"id": "poolX"}]})
# predictions key deliberately absent -- must fall back to the legacy key
FAKE_KV["edge_board_shared"] = json.dumps({"predictions": ["legacy-key predictions"], "predMeta": {"count": 1}})
status, body = call("GET", "/api/state?scope=shared", AUTH_A)
merged = body["state"]
check("GET scope=shared: odds came from the new dedicated key", merged.get("lastGames") == ["new-key odds"])
check("GET scope=shared: pools came from the new dedicated key",
      merged.get("sharedPools") == [{"id": "poolX"}])
check("GET scope=shared: predictions fell back to the legacy combined key (migration case)",
      merged.get("predictions") == ["legacy-key predictions"])
check("GET scope=shared: never writes anything back to the legacy key on a read",
      json.loads(FAKE_KV["edge_board_shared"]).get("predictions") == ["legacy-key predictions"])


# ---------------------------------------------------------------------------
# 4c. sharedUpdatedAt regression test (v18) -- a real bug found in a v17
#    ChatGPT audit: _get_shared_state() never returned a top-level
#    sharedUpdatedAt at all, even though fetch_odds.py/fetch_predictions.py
#    both stamp their own writes with one. app/js/sync.js's non-forced pull
#    does `if (!force && remoteTime <= localTime) return false` -- with
#    remote.sharedUpdatedAt always missing (-> 0) and a fresh device's
#    local timestamp also unset (-> 0), that's always `0 <= 0`, so the
#    automatic startup pull (init.js's `pullState(false)`) silently adopted
#    NOTHING, on every page load, not just a fresh browser's first visit.
#    A forced pull (refresh-lines/load-predictions/import-pool) worked
#    fine because force bypasses the timestamp check entirely -- exactly
#    why this went unnoticed.
#
#    The actual bug was entirely server-side: sync.js's comparison logic
#    was always correct GIVEN an accurate remote.sharedUpdatedAt, so the
#    regression coverage that matters is here, confirming the server now
#    sends one -- not a client-side test, since nothing client-side needed
#    to change.
# ---------------------------------------------------------------------------
FAKE_KV.clear()
FAKE_KV["edge_board_shared_odds"] = json.dumps(
    {"lastGames": ["odds"], "sharedUpdatedAt": "2026-08-10T12:00:00+00:00"})
FAKE_KV["edge_board_shared_predictions"] = json.dumps(
    {"predictions": ["preds"], "sharedUpdatedAt": "2026-08-12T09:30:00+00:00"})  # newest of the three
FAKE_KV["edge_board_shared_pools"] = json.dumps(
    {"sharedPools": [{"id": "poolY"}], "sharedUpdatedAt": "2026-08-11T18:00:00+00:00"})
status, body = call("GET", "/api/state?scope=shared", AUTH_A)
merged = body["state"]
check("GET scope=shared: sharedUpdatedAt is present at all (this was the actual bug -- it used to be silently absent)",
      "sharedUpdatedAt" in merged)
check("GET scope=shared: sharedUpdatedAt is the NEWEST of the three domains' own timestamps, not just one of them",
      merged.get("sharedUpdatedAt") == "2026-08-12T09:30:00+00:00")

# The exact scenario the bug report described: a device with NO local
# timestamp yet (a genuinely fresh browser, or any device before this fix
# shipped) must now see a real, non-zero remote timestamp -- reproducing
# sync.js's own comparison (remoteTime <= localTime) directly here rather
# than just checking the field exists, since "the field is present" and
# "the field would actually cause the client to adopt the data" are two
# different claims and the bug was specifically about the second one.
remote_time = datetime.datetime.fromisoformat(merged["sharedUpdatedAt"]).timestamp() * 1000
local_time = 0  # fresh device, matches state.sharedUpdatedAt's `null` -> 0 fallback in sync.js
check("Fresh-device regression: remoteTime > localTime, so sync.js's `!force && remoteTime<=localTime` guard no longer blocks the adopt",
      remote_time > local_time)

# And confirm the OTHER half of the fix: pool publishing now stamps its
# own sharedUpdatedAt too (it didn't before -- a pool-only update used to
# leave the merged sharedUpdatedAt exactly as stale/absent as ever).
FAKE_KV.clear()
status, body = call("POST", "/api/state?action=publish_pool", AUTH_A,
                     {"id": "poolZ", "name": "Test Pool", "games": []})
check("publish_pool succeeded", status == 200)
pools_blob = json.loads(FAKE_KV["edge_board_shared_pools"])
check("publish_pool now stamps sharedUpdatedAt on its own write (previously absent entirely)",
      bool(pools_blob.get("sharedUpdatedAt")))


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


# ---------------------------------------------------------------------------
# 6. action=delete_account_data -- the self-serve "delete my data" action.
#    Requires {"confirmDelete": true}, deletes the caller's own private key
#    outright, and cleans up any shared pools THEY published (leaving
#    other people's shared pools untouched).
# ---------------------------------------------------------------------------
FAKE_KV.clear()
FAKE_KV["edge_board_user_user_A"] = json.dumps({"entries": [{"id": "e1"}], "_rev": 3})
FAKE_KV["edge_board_user_user_B"] = json.dumps({"entries": [{"id": "e2"}], "_rev": 1})

status, body = call("POST", "/api/state?action=delete_account_data", AUTH_A, {})
check("delete_account_data: a request with NO confirmDelete flag is rejected with 400",
      status == 400)
check("delete_account_data: rejecting a missing confirmDelete leaves the private key untouched",
      "edge_board_user_user_A" in FAKE_KV)

status, body = call("POST", "/api/state?action=delete_account_data", AUTH_A, {"confirmDelete": False})
check("delete_account_data: confirmDelete=false (not literally true) is also rejected -- not just 'any truthy value'",
      status == 400)

status, body = call("POST", "/api/state?action=delete_account_data", AUTH_A, {"confirmDelete": True})
check("delete_account_data: a confirmed delete succeeds (200)", status == 200)
check("delete_account_data: the response reports success", body.get("ok") is True)
check("delete_account_data: the caller's OWN private key is actually gone from KV afterward",
      "edge_board_user_user_A" not in FAKE_KV)
check("delete_account_data: a DIFFERENT user's private key is completely untouched",
      "edge_board_user_user_B" in FAKE_KV and json.loads(FAKE_KV["edge_board_user_user_B"])["entries"] == [{"id": "e2"}])

# Shared-pool cleanup: user_A published two pools, user_B published one.
# Deleting user_A's data should remove exactly their two, leaving user_B's
# alone -- not a blanket wipe of the shared list.
FAKE_KV.clear()
FAKE_KV["edge_board_user_user_A"] = json.dumps({"entries": [], "_rev": 0})
FAKE_KV["edge_board_shared_pools"] = json.dumps({
    "sharedPools": [
        {"id": "poolA1", "publishedBy": "user_A", "name": "A's first pool"},
        {"id": "poolA2", "publishedBy": "user_A", "name": "A's second pool"},
        {"id": "poolB1", "publishedBy": "user_B", "name": "B's pool"},
    ],
    "_rev": 5,
})
status, body = call("POST", "/api/state?action=delete_account_data", AUTH_A, {"confirmDelete": True})
check("delete_account_data: succeeds when the account also has published shared pools", status == 200)
remaining_pools = json.loads(FAKE_KV["edge_board_shared_pools"])["sharedPools"]
check("delete_account_data: removes ALL of the deleted account's own published pools (both of user_A's)",
      not any(p.get("publishedBy") == "user_A" for p in remaining_pools))
check("delete_account_data: does NOT touch a DIFFERENT user's published pool",
      any(p.get("id") == "poolB1" for p in remaining_pools))
check("delete_account_data: the success message mentions how many shared pool(s) were also removed",
      "2 shared pool(s)" in (body.get("message") or ""))

# A user with no published pools at all -- the shared-pools cleanup step
# must be a clean no-op, not an error or an accidental wipe.
FAKE_KV.clear()
FAKE_KV["edge_board_user_user_A"] = json.dumps({"entries": [], "_rev": 0})
FAKE_KV["edge_board_shared_pools"] = json.dumps({
    "sharedPools": [{"id": "poolB1", "publishedBy": "user_B", "name": "B's pool"}],
    "_rev": 2,
})
status, body = call("POST", "/api/state?action=delete_account_data", AUTH_A, {"confirmDelete": True})
check("delete_account_data: a user with no published pools still succeeds cleanly", status == 200)
check("delete_account_data: the message does NOT falsely claim any shared pools were removed",
      "shared pool(s)" not in (body.get("message") or ""))
remaining_pools2 = json.loads(FAKE_KV["edge_board_shared_pools"])["sharedPools"]
check("delete_account_data: another user's pool is untouched when the deleting account had none of its own",
      any(p.get("id") == "poolB1" for p in remaining_pools2))

# Deleting an account that has no private key at all yet (e.g. never
# synced) must not error -- kv_delete on an already-absent key is a safe
# no-op in real Redis too.
FAKE_KV.clear()
status, body = call("POST", "/api/state?action=delete_account_data", AUTH_A, {"confirmDelete": True})
check("delete_account_data: deleting an account with no existing private key at all doesn't error",
      status == 200)


state_api.verify_user = _orig_verify

if failures:
    print(f"\n{len(failures)} of {total_checks[0]} FAILURE(S): {failures}")
    sys.exit(1)
print(f"\nAll {total_checks[0]} checks passed.")
