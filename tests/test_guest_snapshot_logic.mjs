import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const src=fs.readFileSync(path.join(ROOT,'app/js/guest-snapshot.js'),'utf8');
const api=fs.readFileSync(path.join(ROOT,'api/public_snapshot.py'),'utf8');
const vercel=JSON.parse(fs.readFileSync(path.join(ROOT,'vercel.json'),'utf8'));

assert.match(src,/public_snapshot\?view=odds\$\{retrySuffix\}/,'guest must request public odds');
assert.match(src,/view=ratings&year=/,'guest must request public SP+ ratings');
// Sept 8, 2026 (Drew's explicit follow-up call): the guest composite tries
// the real PickGauge Model # first (needs sag from the public predictions
// view + SP+ from ratings to clear a relaxed 2-system floor -- see
// app/js/model.js's pickGaugeModelNumber()/myNumber()), falling back to
// SP+ alone only per-game. This REVERSES the original launch version's
// "active guest flow must not require prediction CSV" contract -- it now
// deliberately does, as a soft/non-blocking dependency (see the next
// assertion: it must NOT be in the odds/ratings hard-readiness gate).
assert.match(src,/_guestFetchJson\(`\/api\/public_snapshot\?view=predictions/,'guest must request the public sag predictions view to attempt the real PickGauge Model #');
assert.doesNotMatch(src,/if\(!oddsReady\|\|!ratingsReady\|\|!predsReady\)/,'predictions must stay a SOFT dependency -- an unready/unavailable predictions fetch must never block the guest preview from loading, only fall back to SP+ alone per game');
assert.match(src,/applyPredictions\(\)/,'guest must reuse the same applyPredictions() the authenticated tracker-CSV path uses (no duplicated parallel matching logic)');
assert.match(src,/state\.pickGaugeModelEnabled=true/,'guest must activate the real PickGauge Model # composite path');
assert.match(src,/state\.guestModelRelaxedCoverage=true/,'guest must set the relaxed-coverage flag model.js checks before lowering its 3-system floor to 2');
assert.match(src,/state\.enabledSystems=\["cfbdsp"\]/,'guest fallback composite (used per-game when even the relaxed PickGauge Model # floor is not cleared) must still be SP+ alone');
assert.match(src,/if\(!oddsReady\|\|!ratingsReady\)/,'guest must require both market + SP+ ratings before rendering edges (predictions genuinely optional, see above)');
assert.match(src,/odds-warm-in-progress/,'guest must auto-retry when another visitor is warming shared odds');
assert.match(src,/_retry=\$\{Date\.now\(\)\}/,'guest retry must bypass a cached not-ready response');
assert.match(src,/applyCfbdDerivedPredictions\(\)/,'guest must still derive cfbdsp/cfbdcore through the existing SP+ path when predictions are not ready');
// Guest-only state must be fully undone on real sign-in -- guestTeardown()
// is the ONE place that happens (see app/js/guest-snapshot.js's own
// header comment on why nothing here may leak into a real account).
assert.match(src,/_guestOriginalPickGaugeModelEnabled=!!state\.pickGaugeModelEnabled/,'guestTeardown() needs the REAL prior value snapshotted, not just an assumed false, in case a returning signed-out user had already turned PickGauge Model # on for real');
assert.match(src,/state\.pickGaugeModelEnabled=_guestOriginalPickGaugeModelEnabled/,'guestTeardown() must restore pickGaugeModelEnabled to whatever it really was before guest mode touched it');
assert.match(src,/state\.guestModelRelaxedCoverage=false/,'guestTeardown() must clear the relaxed-coverage flag -- a real signed-in account must never keep the guest-only 2-system floor');
assert.match(api,/def _warm_public_odds\(\):/,'public API must be able to self-warm stale odds');
assert.match(api,/__global_odds_warm__/,'anonymous odds warm must have system-wide cooldown');
assert.match(api,/PUBLIC_ODDS_QUOTA_FLOOR/,'anonymous odds warm must respect shared quota floor');
assert.ok((vercel.functions?.['api/public_snapshot.py']?.maxDuration||0)>=15,'public_snapshot runtime must accommodate guarded upstream warm');

console.log('Guest Snapshot public-preview contract tests passed');
