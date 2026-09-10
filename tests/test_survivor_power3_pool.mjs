import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const integration=fs.readFileSync(new URL('../app/js/survivor-integration.js', import.meta.url),'utf8');
assert.match(integration,/power3:\{id:'power3',name:'KellyCFB Week 2',[^\n]*picksPerWeek:2,startWeek:2,endWeek:13\}/,'Power3 built-in pool must start Week 2, require two picks, and end before championship week');
assert.match(integration,/KellyCFB Week 2 · 2 picks\/week/,'Power3 format must be available when creating a Survivor pool');
assert.match(integration,/power3:'2 picks\/week · SEC, Big Ten or Big 12 games · FBS only · no reuse · no conference championships'/,'Power3 rules should be visible in the Survivor context');
assert.match(integration,/You cannot select both sides of the same game/,'Two-pick pools must prevent impossible opposite-side selections');

const adapter=fs.readFileSync(new URL('../app/js/survivor-data-adapter.js', import.meta.url),'utf8');
const context={console,window:{},globalThis:null}; context.globalThis=context;
vm.createContext(context);
vm.runInContext(adapter+`\nglobalThis.__applyPower3=pgsApplyPower3Schedule;`,context);

const game=(id,week,homeConference,awayConference,homeClassification='fbs',awayClassification='fbs',seasonType='regular')=>({
  id,season:2026,week,seasonType,
  homeTeam:`H${id}`,awayTeam:`A${id}`,
  homeConference,awayConference,homeClassification,awayClassification
});
const candidates=[
  game(1,2,'Big Ten','Independent'),       // eligible non-conference FBS opponent
  game(2,2,'SEC','ACC'),                   // eligible via SEC
  game(3,3,'Big 12','Mountain West'),      // eligible via Big 12
  game(4,2,'SEC','Southern','fbs','fcs'),   // FCS opponent excluded
  game(5,2,'ACC','ACC'),                   // no included conference
  game(6,14,'Big Ten','SEC'),              // conference championship slate excluded
  game(7,13,'Big 12','SEC'),               // final regular-season slate included
  game(8,10,'SEC','Big Ten','fbs','fbs','postseason'), // postseason excluded
];
const out=context.__applyPower3(candidates,2026);
assert.deepEqual(Array.from(out.games, g=>g.id),[1,2,3,7]);
assert.deepEqual(Array.from(out.missing),[]);
console.log('KellyCFB Week 2 Survivor rules OK');
