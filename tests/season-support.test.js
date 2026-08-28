import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_SURVIVOR_SEASON,
  SUPPORTED_SURVIVOR_SEASONS,
  isSupportedSurvivorSeason,
  normalizeSurvivorSeason
} from '../data/survivor-config.js';
import { buildDemoData } from '../js/demo-data.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.equal(DEFAULT_SURVIVOR_SEASON, 2026);
assert.deepEqual([...SUPPORTED_SURVIVOR_SEASONS], [2026]);
assert.equal(isSupportedSurvivorSeason(2026), true);
assert.equal(isSupportedSurvivorSeason(2025), false);
assert.equal(normalizeSurvivorSeason(2025), 2026, 'unsupported persisted season values must migrate to 2026');

assert.match(html, /<option value="2026">2026<\/option>/, 'the supported 2026 season should remain visible');
assert.doesNotMatch(html, /value="2025"/, 'unsupported 2025 mode must not be exposed in the UI');
assert.match(html, /id="seasonSelect"[^>]*disabled/, 'single supported season control should not imply other seasons are selectable');

assert.doesNotThrow(() => buildDemoData(2026, 'sec'));
assert.throws(
  () => buildDemoData(2025, 'sec'),
  /only supports the 2026 authoritative Splash survivor schedule/i,
  'demo mode must fail closed for an unsupported season instead of generating a generic schedule'
);

console.log('season support tests passed');
