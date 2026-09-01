import fs from 'node:fs';
import assert from 'node:assert/strict';

const js=fs.readFileSync(new URL('../app/js/survivor-integration.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/survivor-integration.css',import.meta.url),'utf8');

assert.match(css,/\.survivor-board\{max-height:70vh;overflow:auto/);
assert.match(css,/\.survivor-board th\{position:sticky;top:0/);
assert.match(css,/\.survivor-board \.survivor-team-col\{width:136px;min-width:136px/);
assert.match(css,/-webkit-line-clamp:2/);
assert.match(css,/\.survivor-game-cell\{width:112px;min-height:56px/);

assert.match(js,/function pgSurvivorDuplicateEntry\(/);
assert.match(js,/function pgSurvivorMoveEntry\(/);
assert.match(js,/async function pgSurvivorDeleteEntry\(/);
assert.match(js,/pgConfirm\(\{/);
assert.match(js,/data-survivor-entry-duplicate/);
assert.match(js,/data-survivor-entry-move/);
assert.match(js,/data-survivor-entry-delete/);
assert.match(js,/p\.entries\.splice\(from,1\)/);
assert.match(js,/JSON\.parse\(JSON\.stringify\(source\.picks\|\|\{\}\)\)/);

assert.match(js,/Used \/ reserved teams/);
assert.match(js,/Reserved/);
assert.match(js,/Teams listed here cannot be selected again in this entry/);
assert.match(css,/\.survivor-used-week/);
assert.match(css,/\.survivor-used-result\.win/);
assert.match(css,/\.survivor-used-result\.loss/);

console.log('Survivor P2 #13-15 UX tests passed');
