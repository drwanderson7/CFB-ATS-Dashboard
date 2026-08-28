import assert from 'node:assert/strict';
import handler from '../api/survivor-data.js';

const originalFetch = global.fetch;
const originalKey = process.env.CFBD_API_KEY;
process.env.CFBD_API_KEY = 'test-key';
global.fetch = async input => {
  const url = new URL(String(input));
  let payload = [];
  if (url.pathname === '/games') payload = [{ id:1, season:2026, week:1, homeTeam:'Alabama', awayTeam:'East Carolina', completed:true, homePoints:42, awayPoints:7, startDate:'2026-09-01T16:00:00Z', neutralSite:false }];
  if (url.pathname === '/ratings/sp') payload = [{team:'Alabama',rating:20},{team:'East Carolina',rating:-10}];
  return { ok:true, status:200, json:async()=>payload, text:async()=>JSON.stringify(payload) };
};

async function call(fresh) {
  let body, status, cache;
  await handler(
    { query:{year:'2026',pool:'sec',...(fresh?{fresh:'1'}:{})} },
    { setHeader(name,value){ if(name.toLowerCase()==='cache-control') cache=value; }, status(code){status=code; return this;}, json(value){body=value; return this;} }
  );
  return {body,status,cache};
}

const normal = await call(false);
assert.equal(normal.status, 200);
assert.match(normal.cache, /s-maxage=120/);
assert.equal(normal.body.results.source, 'CFBD /games');
assert.equal(normal.body.matchups.find(m=>m.team==='Alabama').teamPoints, 42);
assert.equal(normal.body.matchups.find(m=>m.team==='Alabama').opponentPoints, 7);

const fresh = await call(true);
assert.match(fresh.cache, /no-store/);
assert.equal(fresh.body.results.manualRefreshBypassesCache, true);

global.fetch = originalFetch;
if (originalKey === undefined) delete process.env.CFBD_API_KEY; else process.env.CFBD_API_KEY = originalKey;
console.log('results API/cache tests passed');
