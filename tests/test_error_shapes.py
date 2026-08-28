"""
Pins down the ONE convention app/js/api-client.js's classifyApiError()
depends on to tell a real Clerk-auth failure apart from a missing/
rejected feature-specific key (Odds API, CFBD) when both use status 401:

    - a genuine auth failure always responds  {"error": "..."}
    - a missing/rejected feature key always responds  {"message": "..."}
    - the two keys are never both present, and never absent, on a 401

Before apiFetch() existed, every call site guessed what a 401 meant from
the status code alone, and at least one (refreshLines()) guessed wrong --
see the header comment in app/js/api-client.js. That fix is only as safe
as this convention staying true across all 9 authenticated api/*.py files; this test
fails loudly if a future edit breaks it (same reasoning as
test_auth_sync.py's verify_user() drift check and
test_team_match_parity.py's TEAM_ALIAS drift check).

Run with:
    python3 tests/test_error_shapes.py
"""
import ast
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(ROOT, "api")
API_CLIENT_JS = os.path.join(ROOT, "app", "js", "api-client.js")

CANONICAL_AUTH_MESSAGE = "Unauthorized — please sign in again."

FILES = [
    "state.py",
    "fetch_odds.py",
    "fetch_predictions.py",
    "fetch_teams.py",
    "fetch_cfbd.py",
    "parse_pdf.py",
    "parse_pool.py",
    "grade_picks.py",
    "beta.py",
]

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


def find_401_respond_bodies(path):
    """Returns a list of dicts (as plain Python dicts) passed as the body
    argument to every self._respond(401, {...}) call in the file. Skips
    (rather than fails) any call whose body isn't a literal dict --
    none currently are, but a non-literal would just mean this static
    check can't see it, not that the file is wrong."""
    with open(path) as f:
        tree = ast.parse(f.read(), filename=path)
    bodies = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "_respond"):
            continue
        if len(node.args) < 2:
            continue
        status_node, body_node = node.args[0], node.args[1]
        try:
            status = ast.literal_eval(status_node)
        except Exception:
            continue
        if status != 401:
            continue
        try:
            body = ast.literal_eval(body_node)
        except Exception:
            continue
        if isinstance(body, dict):
            bodies.append(body)
    return bodies


any_401_seen = False
for fname in FILES:
    path = os.path.join(API_DIR, fname)
    bodies = find_401_respond_bodies(path)
    for body in bodies:
        any_401_seen = True
        has_error = "error" in body
        has_message = "message" in body
        check(f"{fname}: a 401 body has exactly one of error/message (never both, never neither) — {body}",
              has_error != has_message)
        if has_error:
            check(f"{fname}: a 401 'error' body uses the exact canonical auth-expired text",
                  body["error"] == CANONICAL_AUTH_MESSAGE)

check("at least one 401 response was found across all files (sanity check the scan itself isn't silently vacuous)",
      any_401_seen)

# The frontend's own fallback string (used only if a 401 body has neither
# key -- shouldn't happen per the checks above, but classifyApiError()
# still needs a sane default) should match the same canonical text, so a
# future wording change to one side doesn't silently drift from the other.
with open(API_CLIENT_JS) as f:
    js_src = f.read()
check("app/js/api-client.js's AUTH_EXPIRED_MESSAGE constant matches the canonical backend auth-expired text",
      f'"{CANONICAL_AUTH_MESSAGE}"' in js_src)

print(f"\n{'All ' + str(total) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(total) + ' checks FAILED:'}")
for f_ in failures:
    print(" -", f_)
if failures:
    raise SystemExit(1)
