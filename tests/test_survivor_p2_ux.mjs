import fs from 'node:fs';
import assert from 'node:assert/strict';

const js=fs.readFileSync(new URL('../app/js/survivor-integration.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/survivor-integration.css',import.meta.url),'utf8');

assert.match(js,/function pgSurvivorDecisionSummary\(/);
assert.match(js,/Why this exact path/);
assert.match(js,/not simply the two highest win probabilities/i);
assert.match(js,/exact season optimizer drives the recommendation/i);

assert.match(js,/Technical details/);
assert.match(js,/best available probability source/i);
assert.match(js,/direct CFBD Pregame WP first, then SP\+, then a line-derived fallback/i);

assert.match(js,/Higher stars = more reason to save this team for later/);
assert.match(js,/Future Value shows how useful a team is likely to be later/i);
assert.match(js,/Very valuable later — save if you can/);
assert.match(js,/Little modeled future value — good candidate to spend now/);

assert.match(css,/P2 Survivor explanation\/data-health\/Future Value UX/);
assert.match(css,/\.survivor-health-details/);
assert.match(css,/\.survivor-why-summary/);
assert.match(css,/\.survivor-fv-legend/);

console.log('Survivor P2 UX tests passed');
