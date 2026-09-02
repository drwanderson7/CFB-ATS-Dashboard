import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const src=fs.readFileSync(path.join(ROOT,'app/js/guest-snapshot.js'),'utf8');
const api=fs.readFileSync(path.join(ROOT,'api/public_snapshot.py'),'utf8');
const vercel=JSON.parse(fs.readFileSync(path.join(ROOT,'vercel.json'),'utf8'));

assert.match(src,/public_snapshot\?view=odds\$\{retrySuffix\}/,'guest must request public odds');
assert.match(src,/view=ratings&year=/,'guest must request public SP+ ratings');
assert.doesNotMatch(src,/_guestFetchJson\([^\n]*view=predictions/,'active guest flow must not require prediction CSV');
assert.match(src,/state\.enabledSystems=\["cfbdsp"\]/,'guest model must be SP+ only');
assert.match(src,/if\(!oddsReady\|\|!ratingsReady\)/,'guest must require both market + SP+ before rendering edges');
assert.match(src,/odds-warm-in-progress/,'guest must auto-retry when another visitor is warming shared odds');
assert.match(src,/_retry=\$\{Date\.now\(\)\}/,'guest retry must bypass a cached not-ready response');
assert.match(src,/applyCfbdDerivedPredictions\(\)/,'guest must derive model numbers through existing SP+ path');
assert.match(api,/def _warm_public_odds\(\):/,'public API must be able to self-warm stale odds');
assert.match(api,/__global_odds_warm__/,'anonymous odds warm must have system-wide cooldown');
assert.match(api,/PUBLIC_ODDS_QUOTA_FLOOR/,'anonymous odds warm must respect shared quota floor');
assert.ok((vercel.functions?.['api/public_snapshot.py']?.maxDuration||0)>=15,'public_snapshot runtime must accommodate guarded upstream warm');

console.log('Guest Snapshot public-preview contract tests passed');
