import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
assert.match(workflow, /npm ci/);
assert.match(workflow, /npm run check\b/);
assert.match(workflow, /playwright install --with-deps chromium/);
assert.match(workflow, /npm run check:browser/);
assert.match(workflow, /pull_request:/);
console.log('CI workflow tests passed');
