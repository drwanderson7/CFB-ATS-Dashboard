"""
Pins three things down across every api/*.py file:

  1. No self._respond(500, {...}) call embeds a raw exception (str(e) or
     similar) anywhere in its body -- a 500 should NEVER carry internal
     detail (URL structure, env var names, third-party response bodies)
     back to the client. The real exception text is only allowed to go
     to _log_server_error() (stderr / Vercel function logs).
  2. GENERIC_SERVER_ERROR is byte-identical across all 9 files that
     define it, same drift-protection reasoning as CAS_SCRIPT/
     RATE_LIMIT_SCRIPT/AUTH_EXPIRED_MESSAGE elsewhere in this suite.
  3. Same no-raw-exception rule as #1, now extended to 502 responses too
     (fetch_odds.py, fetch_predictions.py, fetch_teams.py, fetch_cfbd.py,
     grade_picks.py -- protected upstream paths that previously risked
     returning raw urllib/provider details to the browser. This was
     explicitly out of scope in an earlier pass (a 502's str(e) was judged
     lower-sensitivity than a 500's -- describes a third-party
     connectivity failure, not internal app/env detail) but that judgment
     call has since been revisited: every one of those paths now uses a
     static, still-descriptive message and logs the real exception via
     _log_server_error() instead, exactly like the 500 pattern. Raw
     THIRD-PARTY HTTP response bodies are also redacted now; that separate
     invariant lives in tests/test_upstream_error_redaction.py.

Run with:
    python3 tests/test_no_raw_exceptions_in_500s.py
"""
import ast
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(ROOT, "api")

FILES = [
    "state.py",
    "fetch_odds.py",
    "fetch_predictions.py",
    "fetch_teams.py",
    "fetch_cfbd.py",
    "grade_picks.py",
    "parse_pdf.py",
    "parse_pool.py",
    "beta.py",
]

failures = []
total = [0]


def check(name, cond):
    total[0] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


def get_const_string(tree, const_name):
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == const_name:
            try:
                return ast.literal_eval(node.value)
            except Exception:
                return None
    return None


def find_respond_calls(tree, status_code):
    """Returns every self._respond(status_code, {...}) Call node in the file."""
    calls = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "_respond"):
            continue
        if len(node.args) < 2:
            continue
        try:
            status = ast.literal_eval(node.args[0])
        except Exception:
            continue
        if status == status_code:
            calls.append(node)
    return calls


def call_embeds_a_name(call_node, forbidden_names):
    """True if the call's body argument (2nd arg) references any of
    `forbidden_names` (e.g. the exception variable `e`) ANYWHERE in its
    subtree -- catches both str(e) and messier constructions like
    "prefix: " + str(e) without needing to match the exact old pattern."""
    body_arg = call_node.args[1]
    for node in ast.walk(body_arg):
        if isinstance(node, ast.Name) and node.id in forbidden_names:
            return True
    return False


EXCEPTION_NAMES = {"e", "exc", "exception", "err"}
ref_message = None
for fname in FILES:
    path = os.path.join(API_DIR, fname)
    with open(path) as f:
        src = f.read()
    tree = ast.parse(src, filename=path)

    msg = get_const_string(tree, "GENERIC_SERVER_ERROR")
    check(f"{fname} defines GENERIC_SERVER_ERROR", msg is not None)
    if fname == FILES[0]:
        ref_message = msg
    else:
        check(f"{fname}::GENERIC_SERVER_ERROR matches {FILES[0]} (source of truth)", msg == ref_message)

    check(f"{fname} defines _log_server_error()",
          any(isinstance(n, ast.FunctionDef) and n.name == "_log_server_error" for n in ast.walk(tree)))

    calls_500 = find_respond_calls(tree, 500)
    check(f"{fname}: at least one 500 response exists (sanity check the scan isn't vacuous)",
          len(calls_500) > 0)
    for i, call in enumerate(calls_500):
        # The exception variable in every except-block here is named `e`
        # (checked, consistent across all 9 files) -- flag a 500 body
        # that references it anywhere, not just the exact old str(e) text.
        check(f"{fname}: 500 response #{i+1} (line {call.lineno}) does not embed the raw exception",
              not call_embeds_a_name(call, EXCEPTION_NAMES))

    # 502s only exist in the 4 files that call an upstream network service
    # (state.py, parse_pdf.py, parse_pool.py never do) -- no vacuous-scan
    # sanity check here, since a 0-count is the CORRECT answer for those 3.
    calls_502 = find_respond_calls(tree, 502)
    for i, call in enumerate(calls_502):
        check(f"{fname}: 502 response #{i+1} (line {call.lineno}) does not embed the raw exception",
              not call_embeds_a_name(call, EXCEPTION_NAMES))

print(f"\n{'All ' + str(total[0]) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(total[0]) + ' checks FAILED:'}")
for f_ in failures:
    print(" -", f_)
if failures:
    raise SystemExit(1)
