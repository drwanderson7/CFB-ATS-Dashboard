import fs from "node:fs";
import assert from "node:assert/strict";

const integration=fs.readFileSync(new URL("../app/js/survivor-integration.js",import.meta.url),"utf8");
const adapter=fs.readFileSync(new URL("../app/js/survivor-data-adapter.js",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../app/css/survivor-integration.css",import.meta.url),"utf8");
const main=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");

assert.match(integration,/function pgSurvivorPersist\(\)\{save\(\);\}/);
assert.match(main,/s\.survivor=/);
assert.doesNotMatch(main.match(/const SHARED_FIELDS=\[[^\]]+\]/)?.[0]||"",/survivor/);

assert.match(adapter,/PickGauge shared CFBD identity/);
assert.match(adapter,/\/api\/fetch_cfbd\?view=survivor/);
assert.doesNotMatch(adapter,/survivor-api|cfb-survivor.*vercel|standalone.*\/api\//i);

assert.match(integration,/sec:\{id:'sec'.*picksPerWeek:1.*expected:106/);
assert.match(integration,/bigten:\{id:'bigten'.*picksPerWeek:1.*expected:122/);
assert.match(integration,/kelly:\{id:'kelly'.*picksPerWeek:2.*expected:321/);

for(const token of [
  'id="survivorPoolSelect"',
  "data-survivor-view",
  'id="survivorWeekSelect"',
  "data-survivor-pick-game",
  "data-survivor-remove-week"
]) assert.ok(integration.includes(token),`missing ${token}`);

assert.match(css,/@media\s*\(max-width:\s*760px\)/);
assert.match(css,/survivor-board/);
assert.match(css,/overflow-x:auto|overflow:auto/);
assert.match(css,/@media\s*\(max-width:\s*430px\)/);

console.log("Survivor launch acceptance contract passed");
