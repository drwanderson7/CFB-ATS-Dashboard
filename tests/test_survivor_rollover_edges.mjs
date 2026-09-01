import fs from "node:fs";
import assert from "node:assert/strict";

const source=fs.readFileSync(new URL("../app/survivor-core/js/results.js",import.meta.url),"utf8");
const mod=await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const {weekLifecycle,deriveCurrentPoolWeek,pickResultFor,evaluateEntryStatus}=mod;

const t=Date.parse("2026-09-10T18:00:00Z");
const game=(week,id,start,completed=false,team="A",opponent="B",teamPoints=null,opponentPoints=null)=>({
  week,gameId:id,startDate:start,completed,team,opponent,teamPoints,opponentPoints
});
const bothSides=(week,id,start,completed=false,aPts=null,bPts=null)=>[
  game(week,id,start,completed,"A","B",aPts,bPts),
  game(week,id,start,completed,"B","A",bPts,aPts)
];

let rows=[
  ...bothSides(1,1,"2026-09-03T18:00:00Z",true,31,10),
  ...bothSides(2,2,"2026-09-12T18:00:00Z",false)
];
assert.equal(deriveCurrentPoolWeek(rows,[1,2],t),2,"completed week should advance");

rows=[
  ...bothSides(1,1,"2026-09-10T16:00:00Z",true,28,14),
  ...bothSides(1,2,"2026-09-10T17:00:00Z",false),
  ...bothSides(2,3,"2026-09-17T17:00:00Z",false)
];
assert.equal(weekLifecycle(rows,1,t).state,"active");
assert.equal(deriveCurrentPoolWeek(rows,[1,2],t),1,"recent unfinished game should hold week");

const muchLater=Date.parse("2026-09-12T02:01:00Z");
assert.equal(weekLifecycle(rows,1,muchLater,30).state,"stale-incomplete");
assert.equal(deriveCurrentPoolWeek(rows,[1,2],muchLater,30),2,"stale incomplete week should eventually advance");

rows=[
  ...bothSides(1,7,"2026-09-14T23:00:00Z",false),
  ...bothSides(2,8,"2026-09-18T23:00:00Z",false)
];
assert.equal(weekLifecycle(rows,1,t,30).state,"upcoming");
assert.equal(deriveCurrentPoolWeek(rows,[1,2],t,30),1,"postponed game should follow moved kickoff");

rows=bothSides(1,1,"2026-09-10T16:00:00Z",true,24,17);
assert.equal(pickResultFor(rows,1,"A",t).status,"win");
assert.equal(pickResultFor(rows,1,"B",t).status,"loss");

rows=bothSides(1,1,"2026-09-10T16:00:00Z",false,14,10);
assert.equal(pickResultFor(rows,1,"A",t).status,"awaiting");
assert.equal(pickResultFor(rows,1,"Missing Team",t).status,"data-issue");

rows=[
  ...bothSides(1,1,"2026-09-03T16:00:00Z",true,24,17),
  ...bothSides(2,2,"2026-09-17T16:00:00Z",false)
];
let status=evaluateEntryStatus(rows,{"1":["A"]},[1,2],2,t,30,2);
assert.equal(status.status,"missing-pick");
assert.deepEqual(status.missingPastWeeks,[1]);
assert.equal(status.missingPickSlots,1);

rows=bothSides(2,2,"2026-09-12T16:00:00Z",false);
status=evaluateEntryStatus(rows,{"2":["A"]},[2],2,t,30,2);
assert.equal(status.status,"pick-needed");
assert.match(status.detail,/1 of 2/);

status=evaluateEntryStatus(rows,{"2":["Ghost"]},[2],2,t,30,1);
assert.equal(status.status,"data-issue");

rows=[
  ...bothSides(1,1,"2026-09-03T16:00:00Z",true,30,10),
  ...bothSides(2,2,"2026-09-10T16:00:00Z",true,27,20),
];
status=evaluateEntryStatus(rows,{"1":"A","2":"A"},[1,2],2,Date.parse("2026-09-11T20:00:00Z"),30,1);
assert.equal(status.status,"survived");
assert.equal(status.seasonSurvived,true);

status=evaluateEntryStatus(rows,{"1":"B","2":"A"},[1,2],2,Date.parse("2026-09-11T20:00:00Z"),30,1);
assert.equal(status.status,"eliminated");
assert.equal(status.eliminatedWeek,1);

console.log("Survivor rollover/result edge tests passed");
