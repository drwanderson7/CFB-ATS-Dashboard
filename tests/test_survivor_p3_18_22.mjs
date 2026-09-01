import fs from 'node:fs';
import assert from 'node:assert/strict';

const js=fs.readFileSync(new URL('../app/js/survivor-integration.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/survivor-integration.css',import.meta.url),'utf8');

// #18 results/history dashboard
assert.match(js,/data-survivor-view="history"/);
assert.match(js,/function pgSurvivorEntryStats\(/);
assert.match(js,/function pgSurvivorRenderHistory\(/);
assert.match(js,/Results \+ strategy history/);
assert.match(js,/Avg selected WP/);

// #19 recommendation history: record, freeze past weeks, and don't fake history
assert.match(js,/p\.recommendationHistory=/);
assert.match(js,/function pgSurvivorMaybeRecordRecommendation\(/);
assert.match(js,/if\(existing&&Number\(week\)<Number\(actual\)\)return/);
assert.match(js,/Not recorded/);
assert.match(js,/intentionally not backfilled with current model data/i);

// selection-time probability metadata
assert.match(js,/pickMeta/);
assert.match(js,/selectedAt:new Date\(\)\.toISOString\(\)/);
assert.match(js,/pgSurvivorRecordPickMeta\(entry,m\)/);

// #20 entry comparison -- now real tables, not cards (Drew's direct
// feedback: "it doesnt show it in table form and it isnt very visual")
assert.match(js,/Entry comparison/);
assert.match(js,/function pgSurvivorEntryPlanFor\(/);
assert.match(js,/function pgSurvivorEntryFutureAssets\(/);
assert.match(js,/function pgSurvivorEntryComparisonStatsTableHTML\(/);
assert.match(js,/function pgSurvivorPickGridTableHTML\(/);
assert.match(js,/Projected survival/);
assert.match(js,/4★\+ left/);

// #21 strategy indicators
assert.match(js,/function pgSurvivorStrategyIndicator\(/);
assert.match(js,/SAFE TO BURN/);
assert.match(js,/SAVE FOR W/);
assert.match(js,/PAIR FRIENDLY/);
assert.match(js,/pgSurvivorStrategyBadgeHTML\(m\)/);

// #22 sharing variants
assert.match(js,/function pgSurvivorBuildStrategyShareBlob\(/);
assert.match(js,/function pgSurvivorChooseShareCard\(/);
assert.match(js,/PickGauge Best Path/);
assert.match(js,/Week Results/);
assert.match(js,/My Picks/);

assert.match(css,/P3 Survivor results\/history \+ entry comparison \+ strategy indicators/);
assert.match(css,/\.survivor-history-table/);
assert.match(css,/\.survivor-compare-table/);
assert.match(css,/\.survivor-pick-grid-table/);
assert.match(css,/\.survivor-strategy-badge/);

console.log('Survivor P3 #18-22 tests passed');
