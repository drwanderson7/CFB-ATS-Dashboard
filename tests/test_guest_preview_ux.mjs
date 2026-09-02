import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const guest=fs.readFileSync(path.join(ROOT,'app/js/guest-snapshot.js'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'app/index.html'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'app/css/app.css'),'utf8');
const pred=fs.readFileSync(path.join(ROOT,'app/js/prediction-tracker.js'),'utf8');
const board=fs.readFileSync(path.join(ROOT,'app/js/board.js'),'utf8');
const picks=fs.readFileSync(path.join(ROOT,'app/js/picks.js'),'utf8');
const init=fs.readFileSync(path.join(ROOT,'app/js/init.js'),'utf8');

assert.match(html,/id="guestPreviewBanner"/,'public preview needs deliberate guest framing');
assert.match(html,/Public preview · SP\+ model/,'guest framing must name SP+');
assert.match(html,/id="guestBackPreviewBtn"/,'auth gate must offer back to public preview');
assert.match(guest,/function guestBackToPreview\(\)/,'guest back action must be implemented');

assert.match(guest,/function _guestWirePublicSnapshotControls\(\)/,'guest must bind safe public controls');
assert.match(guest,/state\.snapRankByCover=\(b\.dataset\.score==="1"\)/,'Raw Edge/Cover toggle must work without auth');
assert.match(guest,/if\(f==="mine"\|\|f==="shortlist"\) return;/,'account filters must remain excluded');
assert.doesNotMatch(
  guest,
  /#scoreToggle \.toggle-btn,#snapFilterPills \.pill-btn/,
  'safe display controls must not be routed to sign-in'
);

assert.match(css,/guest-mode #snapFilterPills \[data-filter="mine"\]/,'My picks filter should be hidden for guest');
assert.match(css,/guest-mode #snapFilterPills \[data-filter="shortlist"\]/,'Shortlisted filter should be hidden for guest');
assert.match(css,/guest-mode #reqLeftRow/,'guest should not see provider calls-left chrome');

assert.match(guest,/_guestOriginalSnapFilter=state\.snapFilter/,'guest must snapshot signed-in filter preference');
assert.match(guest,/_guestOriginalSnapRankByCover=state\.snapRankByCover/,'guest must snapshot signed-in rank preference');
assert.match(guest,/state\.snapFilter="all"/,'guest should always start from public All filter');
assert.match(guest,/state\.snapFilter=_guestOriginalSnapFilter/,'guest must restore filter after sign-in');
assert.match(guest,/state\.snapRankByCover=_guestOriginalSnapRankByCover/,'guest must restore rank after sign-in');

assert.match(guest,/guestRequireSignIn\(b\.dataset\.tab\|\|null\)/,'locked nav should preserve requested destination');
assert.match(init,/guestConsumePendingTab/,'real auth flow should consume guest destination');
assert.match(init,/if\(pending&&typeof switchTab==="function"\) switchTab\(pending\)/,'post-auth should route to requested tab');

assert.doesNotMatch(html,/~40 computer prediction systems/,'sign-in copy must not advertise stale ~40 count');
assert.doesNotMatch(html,/all ~40 prediction systems/,'Snapshot CTA must not advertise stale ~40 count');
assert.match(html,/17 curated computer prediction systems/,'sign-in copy should state curated 17');
assert.match(pred,/★ Top 7/,'current Top 7 badge should be present in the Prediction Systems panel');

assert.doesNotMatch(html,/Picking for/,'Help should not reference removed Picking for control');
assert.doesNotMatch(board,/Picking for/,'setup checklist should not reference removed Picking for control');
assert.doesNotMatch(html,/Star games/,'My Picks intro should describe current pick interaction');
assert.doesNotMatch(picks,/Star games/,'empty entry copy should describe current pick interaction');

console.log('Guest preview + first-use UX contract tests passed');
