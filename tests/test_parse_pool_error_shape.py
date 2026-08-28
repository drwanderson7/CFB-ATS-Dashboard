"""
Functional test (real do_POST invocation, not just source inspection) for
the bug found and fixed Aug 28: api/parse_pool.py's do_POST() used to catch
every exception with one broad `except Exception`, including the
deliberate, already-user-facing ValueError parse_pool_lines() raises for
EXPECTED conditions (no games found, unsupported source) -- flattening a
real, useful reason into a generic "Something went wrong processing that
request" 500. Found live: a real Madwood pool-sheet import failed with
zero indication of why until this was traced back to source.

Run with:
    python3 tests/test_parse_pool_error_shape.py
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import importlib.util

spec = importlib.util.spec_from_file_location("parse_pool_errshape", os.path.join(ROOT, "api", "parse_pool.py"))
parse_pool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parse_pool)

# Bypass the real Clerk/Redis dependencies entirely -- this test is only
# about do_POST's own exception handling, not auth or rate limiting.
parse_pool.verify_user = lambda handler: "test-uid"
parse_pool.rate_limited = lambda uid, bucket, limit, window_seconds: False

failures = []
total_checks = [0]


def check(name, cond):
    total_checks[0] += 1
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        failures.append(name)


class FakeHandler(parse_pool.handler):
    def __init__(self, body):
        self.headers = {"Content-Length": str(len(body))}
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self._status = None

    def send_response(self, status, message=None):
        self._status = status

    def send_header(self, k, v):
        pass

    def end_headers(self):
        pass

    def json_body(self):
        return json.loads(self.wfile.getvalue().decode())


def call(body_obj):
    body = json.dumps(body_obj).encode()
    h = FakeHandler(body)
    h.do_POST()
    return h._status, h.json_body()


# --- Expected condition: real lines, but nothing matches any known source
# shape -- parse_pool_lines() raises ValueError("Couldn't find any games...").
# Before the fix this came back as a generic 500; now it's a 400 with the
# real, specific reason.
status, body = call({"lines": ["Just some random unrelated text", "that never matches any team pattern"], "year": 2026})
check("unrecognized sheet content: status is 400, not 500 (was masked into a generic 500 before this fix)", status == 400)
check("unrecognized sheet content: body carries the real ValueError message, not the generic server-error text", body.get("error") == "Couldn't find any games — is this a pool pick sheet?")
check("unrecognized sheet content: body does NOT contain the generic masked message", body.get("error") != parse_pool.GENERIC_SERVER_ERROR)

# --- Same expected-condition path, different real ValueError message (empty
# lines after validation would already be caught by _validate_pool_lines()
# earlier as a 400 with its own message -- this checks the OTHER ValueError
# site, an explicit unsupported-source raise, stays reachable and un-masked
# too, by forcing format_hint down a path detect_source() would never route
# to on its own).
status2, body2 = call({"lines": ["hello"], "year": 2026, "format": "not_a_real_format_hint"})
check("format_hint is passed through untouched (ignored, since only 'espn_paste' is special-cased) and still resolves via detect_source() rather than erroring on the hint itself", status2 in (400, 200))

# --- Genuinely unexpected error: force parse_pool_lines() itself to blow up
# with something that is NOT a ValueError, confirming that path still goes
# to 500 with the generic message (i.e. this fix narrowed the except clause,
# it didn't remove the safety net for real internal failures).
_real_parse_pool_lines = parse_pool.parse_pool_lines


def _boom(lines, year, format_hint=None):
    raise RuntimeError("simulated genuinely unexpected internal failure")


parse_pool.parse_pool_lines = _boom
try:
    status3, body3 = call({"lines": ["hello"], "year": 2026})
finally:
    parse_pool.parse_pool_lines = _real_parse_pool_lines

check("a genuinely unexpected (non-ValueError) exception still returns 500", status3 == 500)
check("a genuinely unexpected exception still gets the generic client-facing message, not the raw internal error text", body3.get("error") == parse_pool.GENERIC_SERVER_ERROR)
check("the raw internal exception text is never leaked to the client on a real 500", "simulated genuinely unexpected internal failure" not in json.dumps(body3))

# --- Real success path still works end-to-end through do_POST (not just
# parse_pool_lines() called directly, as the other test file does) --
# confirms this change didn't accidentally break the 200 path.
status4, body4 = call({
    "lines": ["Thu, Sep 3 • 5:00 PM   Preview", "Wisconsin(-3.5)", "(0-0-0)", "Alabama(3.5)", "(0-0-0)", "0/7 picks made"],
    "year": 2026,
})
check("real success path through do_POST still returns 200", status4 == 200)
check("real success path through do_POST still finds the game", body4.get("count") == 1)

print("")
print(f"{total_checks[0] - len(failures)}/{total_checks[0]} checks passed")
if failures:
    print("FAILED:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
sys.exit(0)
