import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const file=new URL('../app/js/survivor-data-adapter.js',import.meta.url);
const source=fs.readFileSync(file,'utf8');
const context=vm.createContext({
  console,Math,Date,Number,String,Array,Object,Set,Map,JSON,
  window:{PickGaugeSurvivorCore:{}},
  localStorage:{getItem(){return null},setItem(){}},
  cfbdGames:[],cfbdRatings:[],cfbdScoreboard:[],games:[],
  teamMatch:(a,b)=>String(a).toLowerCase()===String(b).toLowerCase(),
});
vm.runInContext(source,context,{filename:'survivor-data-adapter.js'});
const run=expr=>vm.runInContext(expr,context);

assert.equal(run(`pgsNormalizeWpRow({game_id:11,home_win_probability:.78}).homeWinProbability`),.78);
assert.equal(run(`pgsNormalizeWpRow({gameId:12,homeWinProbability:.63}).gameId`),'12');
assert.equal(run(`pgsNormalizeWpRow({game_id:13,home_win_probability:null})`),null);
assert.equal(run(`pgsNormalizeWpRow({game_id:13,home_win_probability:false})`),null);
assert.equal(run(`pgsNormalizeLineRow({id:11,lines:[{provider:'Book',spread:-6.5},{provider:'consensus',spread:-7.5}]}).homeSpread`),-7.5);
assert.equal(run(`pgsNormalizeLineRow({gameId:12,lines:[{provider:'Book',spread:3}] }).homeSpread`),3);

run(`pgsReadEnrichmentPayload({year:2026,pregame:[],lines:[{id:88,lines:[{provider:'consensus',spread:-3}]}],unavailable:['pregame']},2026)`);
assert.equal(run(`pgSurvivorEnrichment.status`),'degraded');
assert.ok(run(`pgSurvivorEnrichment.warning`).includes('pregame'));

run(`pgsReadEnrichmentPayload({year:2026,pregame:[{game_id:99,home_win_probability:.8}],lines:[{id:99,lines:[{provider:'consensus',spread:-7}]}]},2026)`);
assert.equal(run(`pgsDirectWpForCanonical({id:99}).homeWinProbability`),.8);
assert.equal(run(`pgsSeasonLineForCanonical({id:99}).homeSpread`),-7);

// Priority regression: direct WP must beat SP+, which must beat line.
context.cfbdRatings=[{team:'Home',sp:{rating:10}},{team:'Away',sp:{rating:9}}];
context.cfbdGames=[{id:99,season:2026,week:1,startDate:null,homeId:1,awayId:2,homeTeam:'Home',awayTeam:'Away',homeConference:'SEC',awayConference:'SEC',neutralSite:false,completed:false}];
const direct=run(`pgsSelectableSide(cfbdGames[0],1,true,'sec')`);
assert.equal(direct.probabilitySourceShort,'WP');
assert.equal(direct.winProbability,.8);

run(`pgsReadEnrichmentPayload({year:2026,pregame:[],lines:[{id:99,lines:[{provider:'consensus',spread:-14}]}]},2026)`);
const sp=run(`pgsSelectableSide(cfbdGames[0],1,true,'sec')`);
assert.equal(sp.probabilitySourceShort,'SP+');

context.cfbdRatings=[];
const line=run(`pgsSelectableSide(cfbdGames[0],1,true,'sec')`);
assert.equal(line.probabilitySourceShort,'Line');
assert.ok(line.winProbability>0.5);
console.log('client enrichment tests passed');
