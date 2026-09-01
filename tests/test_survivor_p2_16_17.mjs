import fs from 'node:fs';
import assert from 'node:assert/strict';

const js=fs.readFileSync(new URL('../app/js/survivor-integration.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/survivor-integration.css',import.meta.url),'utf8');

// #16 weekly summary card.
assert.match(js,/id="survivorWeeklySummary"/);
assert.match(js,/function pgSurvivorWeeklySummaryData\(/);
assert.match(js,/function pgSurvivorRenderWeeklySummary\(/);
assert.match(js,/Weekly snapshot/);
assert.match(js,/Best path this week/);
assert.match(js,/Used so far/);
assert.match(js,/Next-week pressure/);
assert.match(js,/Share card excludes your private entry name/);
assert.match(js,/pgSurvivorRenderWeeklySummary\(\);pgSurvivorRenderBoard\(\)/);

// #17 export/share.
assert.match(js,/function pgSurvivorBuildWeeklyShareBlob\(/);
assert.match(js,/const W=1200,H=675/);
assert.match(js,/snapshotDrawBrand/);
assert.match(js,/snapshotLoadImage/);
assert.match(js,/navigator\.share/);
assert.match(js,/data-survivor-export-weekly/);
assert.match(js,/data-survivor-share-weekly/);
assert.match(js,/pickgauge_survivor_\$\{pool\.id\}_week_\$\{week\}\.png/);
assert.match(js,/Survivor pool strategy · model probabilities are estimates/);

assert.match(css,/P2 Survivor weekly summary \+ share card/);
assert.match(css,/\.survivor-week-summary-grid/);
assert.match(css,/\.survivor-summary-pick/);

console.log('Survivor P2 #16-17 tests passed');
