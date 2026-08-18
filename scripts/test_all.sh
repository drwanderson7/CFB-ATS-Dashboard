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
#   scripts/test_all.sh --fast   # skip test_e2e_ui_behaviors.py, the one
#                                 # real-browser test -- by far the
#                                 # slowest file here since it's the only
#                                 # one driving actual Chromium rather
#                                 # than a plain vm/interpreter context.
#                                 # Useful for a quick local sanity check;
#                                 # CI always runs the full set.

set -uo pipefail
cd "$(dirname "$0")/.."

FAST=0
if [[ "${1:-}" == "--fast" ]]; then
  FAST=1
  echo "(--fast: skipping test_e2e_ui_behaviors.py)"
fi

PY_TESTS=(
  tests/test_state.py
  tests/test_auth_sync.py
  tests/test_grading.py
  tests/test_pool_parsing.py
  tests/test_team_match_parity.py
  tests/test_error_shapes.py
  tests/test_rate_limits.py
  tests/test_vercel_headers.py
  tests/test_no_raw_exceptions_in_500s.py
)
if [[ "$FAST" -eq 0 ]]; then
  PY_TESTS+=(tests/test_e2e_ui_behaviors.py)
fi

JS_TESTS=(
  tests/test_client_logic.mjs
  tests/test_context_bar_logic.mjs
  tests/test_mypicks_logic.mjs
  tests/test_pdf_error_handling.mjs
  tests/test_pools_page_logic.mjs
  tests/test_script_paths.mjs
  tests/test_snapshot_logic.mjs
  tests/test_shortlist_logic.mjs
  tests/test_weekly_setup_logic.mjs
  tests/test_archive_line_integrity.mjs
)

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
