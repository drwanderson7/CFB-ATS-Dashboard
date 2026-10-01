#!/usr/bin/env bash
# Rebuilds app/dist/* from the source files. Run after ANY change to app/js,
# app/data, app/css or app/survivor-core, then commit app/dist with the change.
# (tests/test_bundle_in_sync.mjs fails if you forget.)
set -euo pipefail
cd "$(dirname "$0")/build"
[ -d node_modules/esbuild ] || npm install --no-audit --no-fund --silent
node build.mjs
