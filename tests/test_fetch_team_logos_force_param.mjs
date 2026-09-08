import fs from 'node:fs';
import assert from 'node:assert/strict';

// The other half of the Sept 4 2026 force-refresh fix: api/fetch_teams.py
// now honors force=1 (see tests/test_fetch_teams_force_refresh.py), but
// that's useless unless the browser actually sends it. fetchTeamLogos(true)
// used to only skip its OWN local 12h cache check -- the request it then
// sent was identical to a normal call, so the server's 6h cache kept
// serving stale data back regardless. This checks the actual request URL
// construction, not just that a "force" parameter exists somewhere.

const source = fs.readFileSync(new URL('../app/js/pdf-import.js', import.meta.url), 'utf8');

const fnMatch = source.match(/async function fetchTeamLogos\(force\)\{[\s\S]*?\n\}/);
assert.ok(fnMatch, 'fetchTeamLogos(force) function body should be present');
const fn = fnMatch[0];

assert.match(
  fn,
  /const url='\/api\/fetch_teams\?year='\+encodeURIComponent\(seasonYear\(\)\)\+\(force\?'&force=1':''\);/,
  'fetchTeamLogos(true) must append &force=1 to the actual request URL, not just skip its own local cache check'
);
assert.match(fn, /await apiFetch\(url,\{\}\)/, 'the constructed url (with force=1 when applicable) must be the one actually fetched');

console.log('fetchTeamLogos force=1 request-construction test passed');
