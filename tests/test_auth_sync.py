"""
Catches drift between the 7 duplicated verify_user()/JWKS-client copies
across api/*.py.

WHY DUPLICATED INSTEAD OF A SHARED MODULE: Vercel's Python runtime bundles
each api/*.py as an isolated function; importing a sibling module (even
with the documented underscore-prefix workaround, e.g. api/_auth.py) has
real, reported failure modes in production that can't be verified without
a live deploy to test against, and this project has no path to test a
Vercel deploy from this environment. Given that, changing the import
structure carries real risk of silently breaking every endpoint in
production for a benefit (fewer lines of duplicated code) that a good
drift check gets most of the way to anyway. So: keep the duplication,
but stop relying on "remember to update all 7 files" -- this test fails
loudly if they ever diverge, the same way the project already
collision-tests teamMatch()/TEAM_ALIAS drift between index.html and
grade_picks.py.

If a future session gets the chance to verify a real Vercel deploy with a
shared api/_auth.py module, revisit this -- but don't flip it without that
verification.

Run with:
    python3 tests/test_auth_sync.py
"""
import ast
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(ROOT, "api")

FILES = [
    "state.py",      # source-of-truth copy
    "fetch_odds.py",
    "fetch_predictions.py",
    "fetch_teams.py",
    "parse_pdf.py",
    "parse_pool.py",
    "grade_picks.py",
]

FUNCS_TO_CHECK = ["verify_user", "_get_jwks_client"]

failures = []
total_checks = [0]


def check(name, cond):
    total_checks[0] += 1
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        failures.append(name)


def get_func_source(path, func_name):
    with open(path) as f:
        tree = ast.parse(f.read(), filename=path)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == func_name:
            body = node.body
            # Strip a leading docstring -- state.py's copy has one for
            # readability, the duplicates don't need to; that's a
            # documentation difference, not a logic drift, and shouldn't
            # fail this check.
            if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) and isinstance(body[0].value.value, str):
                body = body[1:]
            # Normalize: dump the AST structure rather than raw text, so
            # comment/whitespace differences (which are fine) don't cause
            # false positives -- only real logic differences should fail.
            return ast.dump(ast.Module(body=body, type_ignores=[]), annotate_fields=False)
    return None


source_path = os.path.join(API_DIR, FILES[0])
for func_name in FUNCS_TO_CHECK:
    reference = get_func_source(source_path, func_name)
    check(f"{FILES[0]} defines {func_name}()", reference is not None)
    for fname in FILES[1:]:
        path = os.path.join(API_DIR, fname)
        actual = get_func_source(path, func_name)
        check(f"{fname}::{func_name}() matches api/state.py (source of truth)", actual == reference)

if failures:
    print(f"\n{len(failures)} of {total_checks[0]} FAILURE(S): {failures}")
    print("\nOne or more api/*.py files have drifted from api/state.py's verify_user()/")
    print("_get_jwks_client(). Update the drifted file(s) to match api/state.py exactly.")
    sys.exit(1)
print(f"\nAll {total_checks[0]} checks passed -- all 7 files' auth code is in sync.")
