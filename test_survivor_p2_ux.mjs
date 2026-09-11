import fs from 'node:fs';
import assert from 'node:assert/strict';

const js=fs.readFileSync(new URL('../app/js/survivor-integration.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/survivor-integration.css',import.meta.url),'utf8');

assert.match(js,/Technical details/);
assert.match(js,/best available probability source/i);
assert.match(js,/direct CFBD Pregame WP first, then SP\+, then a line-derived fallback/i);

assert.match(js,/Higher stars = more reason to save this team for later/);
assert.match(js,/Future Value shows how useful a team is likely to be later/i);
assert.match(js,/Very valuable later — save if you can/);
assert.match(js,/Little modeled future value — good candidate to spend now/);

assert.match(css,/P2 Survivor explanation\/data-health\/Future Value UX/);
assert.match(css,/\.survivor-health-details/);
assert.match(css,/\.survivor-fv-legend/);

// "Best pair this week" card and its "Explain this pair" toggle were removed
// Sept 11, 2026 (Drew: redundant with Weekly Snapshot, which already shows
// the same recommended pair/probabilities/plan survival). Confirms the
// removal is clean -- no dead container, render call, or click handler left
// behind, not just that the old assertions were deleted from this file.
assert.doesNotMatch(js,/survivorHero/);
assert.doesNotMatch(js,/survivorWhy/);
assert.doesNotMatch(js,/pgSurvivorRenderHero/);
assert.doesNotMatch(js,/pgSurvivorRenderWhy/);
assert.doesNotMatch(js,/pgSurvivorDecisionSummary/);
assert.doesNotMatch(css,/survivor-decision-card/);
assert.doesNotMatch(css,/survivor-why-/);

console.log('Survivor P2 UX tests passed');
