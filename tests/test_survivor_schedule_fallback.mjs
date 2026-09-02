import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../app/js/survivor-data-adapter.js',import.meta.url),'utf8');
const context=vm.createContext({
  console,Math,Date,Number,String,Array,Object,Set,Map,JSON,
  window:{PickGaugeSurvivorCore:{
    manifest:{schedules:{bigten:{applyExport:'applyBigTenPoolSchedule'}}},
    schedules:{bigten:{applyBigTenPoolSchedule(games){return {games,missing:[]};}}}
  }},
  localStorage:{getItem(){return null},setItem(){}},
  cfbdGames:[],cfbdRatings:[],cfbdScoreboard:[],games:[],teamLogos:[],
  teamMatch:(a,b)=>String(a).toLowerCase()===String(b).toLowerCase(),
});
vm.runInContext(source,context,{filename:'survivor-data-adapter.js'});
const run=expr=>vm.runInContext(expr,context);

// Build 121 canonical Big Ten candidates that deliberately omit UMass @ Rutgers.
context.cfbdGames=Array.from({length:121},(_,i)=>({
  id:i+1,season:2026,week:(i%13)+1,startDate:null,
  homeId:1000+i,awayId:2000+i,homeTeam:`Home${i}`,awayTeam:`Away${i}`,
  homeConference:'Big Ten',awayConference:null,neutralSite:false,completed:false
}));
context.cfbdRatings=[
  {team:'Rutgers',sp:{rating:12}},
  {team:'UMass',sp:{rating:-8}},
];

const candidates=run(`pgsCandidateCanonicalGames('bigten',2026)`);
assert.equal(candidates.length,122,'verified upstream omission should be supplemented');
const fallback=run(`pgSurvivorCandidateGames.find(g=>g.syntheticScheduleFallback===true)`);
assert.ok(fallback);
assert.equal(fallback.awayTeam,'UMass');
assert.equal(fallback.homeTeam,'Rutgers');
assert.equal(fallback.week,1);
assert.equal(fallback.startDate,'2026-09-03T22:00:00Z');
assert.equal(fallback.canonicalCfbdMatched,false);

const rutgers=run(`pgsSelectableSide(pgSurvivorCandidateGames.find(g=>g.syntheticScheduleFallback===true),1,true,'bigten')`);
assert.equal(rutgers.probabilitySourceShort,'SP+','schedule fallback should still model from shared team ratings');
assert.ok(rutgers.winProbability>0.5);
assert.equal(rutgers.scheduleFallback,true);
assert.equal(rutgers.completed,false);

const data=run(`buildPickGaugeSurvivorData('bigten')`);
assert.equal(data.schedule.matched,122);
assert.equal(data.schedule.expected,122);
assert.equal(data.schedule.authoritativeComplete,true);
assert.equal(data.schedule.canonicalMatched,121);
assert.equal(data.schedule.upstreamFallbackCount,1);
assert.equal(data.schedule.upstreamFallbacks[0].awayTeam,'UMass');
assert.equal(data.schedule.upstreamFallbacks[0].homeTeam,'Rutgers');

// If CFBD later adds the real game, it must supersede the supplement without duplication.
context.cfbdGames.push({
  id:9999,season:2026,week:1,startDate:'2026-09-03T22:00:00Z',
  homeId:9,awayId:8,homeTeam:'Rutgers',awayTeam:'UMass',
  homeConference:'Big Ten',awayConference:'Mid-American',neutralSite:false,completed:false
});
const refreshed=run(`pgsCandidateCanonicalGames('bigten',2026)`);
assert.equal(refreshed.filter(g=>String(g.homeTeam)==='Rutgers'&&String(g.awayTeam)==='UMass').length,1);
assert.notEqual(refreshed.find(g=>String(g.homeTeam)==='Rutgers'&&String(g.awayTeam)==='UMass').syntheticScheduleFallback,true);
assert.equal(run(`pgSurvivorCandidateGames.some(g=>g.syntheticScheduleFallback===true)`),false);

// Regression: the real BIGTEN_POOL_SCHEDULE_2026 matcher (not the passthrough
// mock above) must line up the pool listing's "UMass" against CFBD's actual
// canonical spelling "Massachusetts" for the Week 1 game, or the game
// silently drops into `missing` even when a real CFBD row exists and no
// synthetic fallback gets added to cover the gap. This is the exact bug
// reported 2026-09-02 ("Rutgers at home vs UMass is missing from week 1 of
// big ten survivor board"), caused by a stale alias table in
// data/bigten-pool-schedule-2026.js that didn't know umass===massachusetts.
{
  const { applyBigTenPoolSchedule } = await import('../app/survivor-core/data/bigten-pool-schedule-2026.js');
  const cfbdStyleGames = [
    // CFBD's actual `school` value for this opponent is "Massachusetts".
    { id: 30001, homeTeam: 'Rutgers', awayTeam: 'Massachusetts', week: 1 },
  ];
  const result = applyBigTenPoolSchedule(cfbdStyleGames, 2026);
  const week1 = result.games.filter(g => g.week === 1);
  assert.ok(
    week1.some(g => g.homeTeam === 'Rutgers' && g.awayTeam === 'Massachusetts'),
    'Rutgers vs Massachusetts (CFBD spelling of UMass) must match the Week 1 "UMass" pool slot'
  );
  assert.ok(
    !result.missing.some(slot => slot.week === 1 && slot.teams.includes('UMass')),
    'the Week 1 UMass @ Rutgers slot must not be reported as missing when the real CFBD game is present'
  );
}

console.log('schedule fallback tests passed');
