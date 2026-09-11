import fs from 'node:fs';
import assert from 'node:assert/strict';

// Sept 11, 2026: Drew's report -- "the survivor page has way too much stuff
// before the actual season board." Three changes, on top of the same-day
// removal of the "Best pair this week" card (covered by
// test_survivor_p2_ux.mjs's doesNotMatch checks):
//   1. The 4-step wizard (#survivorJourney) is onboarding scaffolding --
//      hide it entirely once there's nothing left outstanding (picks saved
//      for the focused week), not a standing fixture that repeats what the
//      pool/week selectors and Weekly Snapshot's own status already show.
//   2. The "Week N saved ✓ / Review Season Plan →" banner
//      (#survivorWorkflow) was fully redundant with Weekly Snapshot's own
//      status line -- removed outright, with the "Review Season Plan" link
//      folded into Weekly Snapshot's own header instead of dropped.
//   3. The "Data ready" status bar collapsed from 3 rows (state, a separate
//      stats row, a separate fetch-button row) to one line -- the granular
//      numbers and full fetch-status sentence moved into the existing
//      (already-collapsed) Technical details expander rather than removed.

const js = fs.readFileSync(new URL('../app/js/survivor-integration.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../app/css/survivor-integration.css', import.meta.url), 'utf8');

function check(label, cond) {
  if (!cond) { console.error(`FAIL: ${label}`); process.exitCode = 1; }
  else console.log(`[PASS] ${label}`);
}

// 1. Journey wizard hides once picks are done for the focused week.
check(
  "pgSurvivorRenderJourney() hides entirely once hasData && picksDone",
  /if\(hasData&&picksDone\)\{el\.innerHTML='';return;\}/.test(js)
);

// 2. The old saved-banner function/container/call are gone; the link moved.
check(
  "pgSurvivorRenderWorkflow() (the old saved-banner renderer) no longer exists",
  !/function pgSurvivorRenderWorkflow\(\)/.test(js)
);
check(
  "#survivorWorkflow container no longer exists",
  !/survivorWorkflow/.test(js)
);
check(
  "'Review Season Plan' link now renders inside Weekly Snapshot's own header, gated on the fully-saved ('set') status",
  /s\.status\.key==='set'\?'<button type="button" class="btn-link-sm" data-survivor-view="plan">Review Season Plan/.test(js)
);
check(
  "dead .survivor-workflow CSS removed",
  !/\.survivor-workflow\{/.test(css)
);

// 3. Health bar collapsed to one line; granular stats relocated, not lost.
check(
  "pgSurvivorRenderHealth()'s default strip has no separate stats row/fetch row -- state, summary, and the Fetch button share one .survivor-health-strip",
  /<div class="survivor-health-strip">\s*<span class="survivor-health-state\$\{healthy\?' ready':' warning'\}">\$\{esc\(state\)\}<\/span>\s*<span class="survivor-health-summary">\$\{esc\(summary\)\}<\/span>\s*<button type="button" class="btn-link-sm" data-survivor-fetch-results/.test(js)
);
check(
  "the granular Schedule/Win-probabilities/Results numbers still exist, now inside Technical details",
  /<small>Schedule<\/small>/.test(js) && /<small>Win probabilities<\/small>/.test(js) && /<small>Results check<\/small>/.test(js)
);
check(
  "the full fetch-status sentence is still rendered somewhere (moved into Technical details, not deleted)",
  /survivor-health-fetch-status\$\{fetchStatusClass/.test(js)
);

console.log('');
if (process.exitCode) {
  console.log('Survivor P3 declutter tests FAILED');
  process.exit(1);
}
console.log('Survivor P3 declutter tests passed');
