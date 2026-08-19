"""
Runtime + structural tests for the request/body size limits added to
api/state.py (private-state size, pool name/game count, pick limit range,
entry name), api/parse_pool.py (pool-sheet "lines" body), and
api/parse_pdf.py (raw PDF body). Run with:

    python3 tests/test_request_size_limits.py

Two kinds of checks, deliberately kept separate:

  1. The pure validation functions (_validate_private_state(),
     _validate_pool_lines()) are executed directly, per this project's
     established pattern (see test_grading.py) -- real inputs in, real
     outputs checked, not just "the function exists."
  2. The Content-Length/actual-bytes-read guards in each file's do_POST
     are structural (does the code check length against the right
     constant, BEFORE reading the body where possible) -- same reasoning
     as test_error_shapes.py's AST-based checks elsewhere in this suite:
     actually spinning up BaseHTTPRequestHandler instances just to send a
     large body is a lot of scaffolding for what's fundamentally "is this
     comparison here at all," and the pure-function tests above already
     prove the validation LOGIC itself is correct.
"""
import ast
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(ROOT, "api")
sys.path.insert(0, ROOT)

failures = []
total_checks = [0]


def check(name, cond):
    total_checks[0] += 1
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        failures.append(name)


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(API_DIR, filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


state_api = load_module("state_api_sizelimits", "state.py")
pool_api = load_module("pool_api_sizelimits", "parse_pool.py")


# ---------------------------------------------------------------------------
# 1a. state.py::_validate_private_state()
# ---------------------------------------------------------------------------
check("_validate_private_state(): a body with no 'pools' key at all is fine (not every write touches pools)",
      state_api._validate_private_state({}) is None)
check("_validate_private_state(): pools=None is fine (same as absent)",
      state_api._validate_private_state({"pools": None}) is None)
check("_validate_private_state(): pools not a list is rejected",
      state_api._validate_private_state({"pools": "not a list"}) is not None)
check("_validate_private_state(): an empty pools list is fine",
      state_api._validate_private_state({"pools": []}) is None)

VALID_POOL = {
    "name": "My Pool", "pickLimit": 7,
    "games": [{"away": "A", "home": "B"}],
    "entries": [{"id": "e1", "name": "Entry 1"}],
}
check("_validate_private_state(): one normal, well-formed pool passes",
      state_api._validate_private_state({"pools": [VALID_POOL]}) is None)

# Too many pools
too_many_pools = [dict(VALID_POOL) for _ in range(state_api.MAX_POOLS + 1)]
check(f"_validate_private_state(): {state_api.MAX_POOLS + 1} pools (over MAX_POOLS) is rejected",
      state_api._validate_private_state({"pools": too_many_pools}) is not None)
check(f"_validate_private_state(): exactly MAX_POOLS pools is still allowed (boundary, not off-by-one)",
      state_api._validate_private_state({"pools": [dict(VALID_POOL) for _ in range(state_api.MAX_POOLS)]}) is None)

# Pool name length
long_name_pool = dict(VALID_POOL, name="x" * (state_api.MAX_POOL_NAME_LEN + 1))
check("_validate_private_state(): a pool name over MAX_POOL_NAME_LEN is rejected",
      state_api._validate_private_state({"pools": [long_name_pool]}) is not None)
ok_name_pool = dict(VALID_POOL, name="x" * state_api.MAX_POOL_NAME_LEN)
check("_validate_private_state(): a pool name at exactly MAX_POOL_NAME_LEN is still allowed",
      state_api._validate_private_state({"pools": [ok_name_pool]}) is None)

# Pick limit range
check("_validate_private_state(): pickLimit=0 (below MIN_PICK_LIMIT) is rejected",
      state_api._validate_private_state({"pools": [dict(VALID_POOL, pickLimit=0)]}) is not None)
check("_validate_private_state(): pickLimit above MAX_PICK_LIMIT is rejected",
      state_api._validate_private_state({"pools": [dict(VALID_POOL, pickLimit=state_api.MAX_PICK_LIMIT + 1)]}) is not None)
check("_validate_private_state(): pickLimit at exactly MAX_PICK_LIMIT is still allowed",
      state_api._validate_private_state({"pools": [dict(VALID_POOL, pickLimit=state_api.MAX_PICK_LIMIT)]}) is None)
check("_validate_private_state(): pickLimit at exactly MIN_PICK_LIMIT is still allowed",
      state_api._validate_private_state({"pools": [dict(VALID_POOL, pickLimit=state_api.MIN_PICK_LIMIT)]}) is None)
check("_validate_private_state(): a non-numeric pickLimit is rejected, not silently coerced",
      state_api._validate_private_state({"pools": [dict(VALID_POOL, pickLimit="lots")]}) is not None)
check("_validate_private_state(): pickLimit absent entirely is fine (not every pool write touches it)",
      state_api._validate_private_state({"pools": [dict(VALID_POOL, pickLimit=None)]}) is None)

# Games per pool
too_many_games_pool = dict(VALID_POOL, games=[{"away": "A", "home": "B"}] * (state_api.MAX_GAMES_PER_POOL + 1))
check("_validate_private_state(): too many games in one pool is rejected",
      state_api._validate_private_state({"pools": [too_many_games_pool]}) is not None)
ok_games_pool = dict(VALID_POOL, games=[{"away": "A", "home": "B"}] * state_api.MAX_GAMES_PER_POOL)
check("_validate_private_state(): exactly MAX_GAMES_PER_POOL games is still allowed",
      state_api._validate_private_state({"pools": [ok_games_pool]}) is None)

# Entries per pool + entry name length
too_many_entries_pool = dict(VALID_POOL, entries=[{"id": f"e{i}", "name": "E"} for i in range(state_api.MAX_ENTRIES_PER_POOL + 1)])
check("_validate_private_state(): too many entries in one pool is rejected",
      state_api._validate_private_state({"pools": [too_many_entries_pool]}) is not None)
long_entry_name_pool = dict(VALID_POOL, entries=[{"id": "e1", "name": "x" * (state_api.MAX_ENTRY_NAME_LEN + 1)}])
check("_validate_private_state(): an entry name over MAX_ENTRY_NAME_LEN is rejected",
      state_api._validate_private_state({"pools": [long_entry_name_pool]}) is not None)
ok_entry_name_pool = dict(VALID_POOL, entries=[{"id": "e1", "name": "x" * state_api.MAX_ENTRY_NAME_LEN}])
check("_validate_private_state(): an entry name at exactly MAX_ENTRY_NAME_LEN is still allowed",
      state_api._validate_private_state({"pools": [ok_entry_name_pool]}) is None)

# Malformed shapes don't crash
check("_validate_private_state(): a pool that isn't a dict is rejected, doesn't throw",
      state_api._validate_private_state({"pools": ["not a dict"]}) is not None)
check("_validate_private_state(): pool.games not a list is rejected, doesn't throw",
      state_api._validate_private_state({"pools": [dict(VALID_POOL, games="not a list")]}) is not None)
check("_validate_private_state(): pool.entries not a list is rejected, doesn't throw",
      state_api._validate_private_state({"pools": [dict(VALID_POOL, entries="not a list")]}) is not None)
check("_validate_private_state(): an entry that isn't a dict is rejected, doesn't throw",
      state_api._validate_private_state({"pools": [dict(VALID_POOL, entries=["not a dict"])]}) is not None)

# Error messages are client-safe and name what's actually wrong (not a
# generic "invalid" -- these are the person's own values, safe to echo).
err = state_api._validate_private_state({"pools": [dict(VALID_POOL, pickLimit=999)]})
check("_validate_private_state(): the pickLimit error message names the actual bad value",
      err is not None and "999" in err)

# ---------------------------------------------------------------------------
# 1b. state.py's MAX_* constants are sane relative to each other
# ---------------------------------------------------------------------------
check("MIN_PICK_LIMIT < MAX_PICK_LIMIT", state_api.MIN_PICK_LIMIT < state_api.MAX_PICK_LIMIT)
check("MAX_STATE_BYTES is generous enough for a real multi-pool season (well over 100KB)",
      state_api.MAX_STATE_BYTES > 100_000)


# ---------------------------------------------------------------------------
# 2. parse_pool.py::_validate_pool_lines()
# ---------------------------------------------------------------------------
check("_validate_pool_lines(): a normal small lines list passes",
      pool_api._validate_pool_lines(["Team A", "+3.5", "0-0", "40% Picked"]) is None)
check("_validate_pool_lines(): an empty list passes here (parse_pool_lines()'s OWN 'no games found' check handles that case)",
      pool_api._validate_pool_lines([]) is None)
check("_validate_pool_lines(): not a list at all is rejected",
      pool_api._validate_pool_lines("just a string") is not None)
check("_validate_pool_lines(): not a list (a dict) is rejected",
      pool_api._validate_pool_lines({"lines": ["x"]}) is not None)

too_many_lines = ["x"] * (pool_api.MAX_LINES_COUNT + 1)
check(f"_validate_pool_lines(): {pool_api.MAX_LINES_COUNT + 1} lines (over MAX_LINES_COUNT) is rejected",
      pool_api._validate_pool_lines(too_many_lines) is not None)
check("_validate_pool_lines(): exactly MAX_LINES_COUNT lines is still allowed",
      pool_api._validate_pool_lines(["x"] * pool_api.MAX_LINES_COUNT) is None)

too_long_line = ["x" * (pool_api.MAX_LINE_LENGTH + 1)]
check("_validate_pool_lines(): a single line over MAX_LINE_LENGTH is rejected",
      pool_api._validate_pool_lines(too_long_line) is not None)
check("_validate_pool_lines(): a single line at exactly MAX_LINE_LENGTH is still allowed",
      pool_api._validate_pool_lines(["x" * pool_api.MAX_LINE_LENGTH]) is None)
check("_validate_pool_lines(): a non-string item in the list doesn't crash the length check (just skipped, not a false accept/reject)",
      pool_api._validate_pool_lines([123, None, "ok"]) is None)


# ---------------------------------------------------------------------------
# 3. Structural checks: each do_POST actually enforces its size limit
# BEFORE trusting the body, on the wire (Content-Length) and again on the
# real bytes read (a mismatched/understated header shouldn't be a bypass).
# ---------------------------------------------------------------------------
def read_source(fname):
    with open(os.path.join(API_DIR, fname)) as f:
        return f.read()


CHECKS = [
    ("state.py", "MAX_STATE_BYTES", "_post_user_state"),
    ("parse_pool.py", "MAX_POOL_BODY_BYTES", "do_POST"),
    ("parse_pdf.py", "MAX_PDF_BODY_BYTES", "do_POST"),
]

for fname, const_name, fn_name in CHECKS:
    src = read_source(fname)
    tree = ast.parse(src, filename=fname)

    has_const = any(
        isinstance(n, ast.Assign) and len(n.targets) == 1
        and isinstance(n.targets[0], ast.Name) and n.targets[0].id == const_name
        for n in ast.walk(tree)
    )
    check(f"{fname} defines {const_name}", has_const)

    fn_node = next((n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == fn_name), None)
    check(f"{fname}::{fn_name} exists", fn_node is not None)
    if fn_node is None:
        continue
    fn_src = ast.get_source_segment(src, fn_node) or ""

    check(f"{fname}::{fn_name} compares the CLAIMED Content-Length against {const_name} (fast rejection before reading a large body)",
          f"length > {const_name}" in fn_src or f"{const_name} <" in fn_src)
    check(f"{fname}::{fn_name} also compares the ACTUAL bytes read against {const_name} (Content-Length header isn't trusted blindly)",
          fn_src.count(const_name) >= 2)
    check(f"{fname}::{fn_name} responds 413 when the limit is exceeded (correct status code for 'too large', not 400)",
          "413" in fn_src)

# state.py additionally must actually CALL _validate_private_state() from
# within _post_user_state() -- an unwired validator is as broken as a
# missing one (same reasoning as the pool-menu wiring checks elsewhere in
# this suite).
state_src = read_source("state.py")
check("state.py::_post_user_state actually calls _validate_private_state() (not just defined, but wired in)",
      "_validate_private_state(body)" in state_src)

# parse_pool.py likewise must actually call _validate_pool_lines().
pool_src = read_source("parse_pool.py")
check("parse_pool.py::do_POST actually calls _validate_pool_lines() (not just defined, but wired in)",
      "_validate_pool_lines(lines)" in pool_src)


print(f"\n{'All ' + str(total_checks[0]) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(total_checks[0]) + ' checks FAILED:'}")
for f_ in failures:
    print(" -", f_)
if failures:
    raise SystemExit(1)
