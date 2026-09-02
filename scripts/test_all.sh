#!/usr/bin/env bash
# Runs the full automated test suite: every numbered test_*.py and
# test_*.mjs file in tests/, python first then node, none of them
# fail-fast against each other (a broken file doesn't hide failures in
# the rest -- every file still runs, and the exit code is nonzero if ANY
# of them failed).
#
# Deliberately skips every underscore-prefixed file in tests/ -- those
# are NOT part of the regression suite:
#   - tests/_team_match_js_runner.mjs is an internal helper shelled out
#     to BY test_team_match_parity.py, not a standalone check() emitter.
#   - tests/_e2e_common.py is the shared harness (Clerk mock, static-file
#     server, browser launch) every tests/test_e2e_*.py file imports --
#     also not a standalone check() emitter.
#   - tests/_render_*.py are one-off Playwright verification scripts run
#     by hand during a working session, not permanent coverage.
#   - tests/_live_cas_concurrency_test.py hits a REAL production URL with
#     a REAL Clerk session token and makes REAL writes against Upstash --
#     it must never run automatically in CI (no live credentials exist
#     there, and even if they did, this isn't a repeatable regression
#     check, it's a manual one-off live-infrastructure test).
#
# Usage:
#   scripts/test_all.sh          # run everything (what CI runs)
#   scripts/test_all.sh --fast   # skip the 7 tests/test_e2e_*.py files --
#                                 # real-browser tests, by far the slowest
#                                 # files here since they're the only ones
#                                 # driving actual Chromium rather than a
#                                 # plain vm/interpreter context. Each
#                                 # covers one independent scenario (split
#                                 # out of one large test_e2e_ui_behaviors.py,
#                                 # Sept 1 2026, TODO #26, so a crash in one
#                                 # scenario can't hide failures in another).
#                                 # Useful for a quick local sanity check;
#                                 # CI always runs the full set.

set -uo pipefail
cd "$(dirname "$0")/.."

FAST=0
if [[ "${1:-}" == "--fast" ]]; then
  FAST=1
  echo "(--fast: skipping the 7 tests/test_e2e_*.py real-browser files)"
fi

# Discover every permanent numbered test automatically so adding a new
# test_*.py/.mjs file cannot silently leave it out of CI. Underscore-prefixed
# helpers/manual scripts remain excluded by the glob itself.
mapfile -t PY_TESTS < <(find tests -maxdepth 1 -type f -name 'test_*.py' | sort)
mapfile -t JS_TESTS < <(find tests -maxdepth 1 -type f -name 'test_*.mjs' | sort)
if [[ "$FAST" -eq 1 ]]; then
  FAST_PY=()
  for f in "${PY_TESTS[@]}"; do
    [[ "$f" == tests/test_e2e_*.py ]] || FAST_PY+=("$f")
  done
  PY_TESTS=("${FAST_PY[@]}")
fi

PASS=0
FAIL=0
FAILED_FILES=()

run_one() {
  echo ""
  echo "=== $* ==="
  if "$@"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILED_FILES+=("$*")
  fi
}

for f in "${PY_TESTS[@]}"; do
  run_one python3 "$f"
done

for f in "${JS_TESTS[@]}"; do
  run_one node "$f"
done

echo ""
echo "======================================"
echo "  $PASS file(s) passed, $FAIL file(s) failed"
echo "======================================"
if [[ $FAIL -gt 0 ]]; then
  echo "Failed:"
  for f in "${FAILED_FILES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
exit 0
