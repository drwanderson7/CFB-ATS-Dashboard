import fs from "node:fs";
import vm from "node:vm";
const src=fs.readFileSync(new URL("../app/js/cfbd-insights.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../app/index.html",import.meta.url),"utf8");
const board=fs.readFileSync(new URL("../app/js/board.js",import.meta.url),"utf8");
const picks=fs.readFileSync(new URL("../app/js/picks.js",import.meta.url),"utf8");
const record=fs.readFileSync(new URL("../app/js/record.js",import.meta.url),"utf8");
const store=new Map();
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const ctx={
 console,
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
 setInterval:()=>123,clearInterval:()=>{},
 document:{visibilityState:"visible",getElementById:()=>null},
 apiFetch:async()=>({ok:false}),
 teamLogos:[{id:333,school:"Alabama"},{id:2633,school:"Tennessee"}],
 cfbdGames:[],logosMeta:{season:2026},
 teamMatch:(a,b)=>norm(a)===norm(b),
 cfbdTeamForName:name=>null,
 recordNumber:v=>(v==null||v===""||!Number.isFinite(Number(v)))?null:Number(v),
 round1:v=>Math.round(v*10)/10,
 fmt:v=>{const n=Number(v);return n>0?`+${n}`:`${n}`;},
 esc:s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"),
 kickStr:()=>"Sat 11:00 AM",
 renderPicksDetail:()=>{},renderSnapshot:()=>{},renderRecord:()=>{},renderBoard:()=>{},
 games:[],predByKey:{},
};
vm.createContext(ctx);vm.runInContext(src,ctx);
vm.runInContext(`cfbdScoreboard=[{id:401,status:"in_progress",period:3,clock:"8:24",startDate:"2026-09-05T16:00:00Z",homeTeam:{id:333,name:"Alabama",points:17},awayTeam:{id:2633,name:"Tennessee",points:13}}]`,ctx);
const failures=[];let total=0;function check(n,c){total++;console.log(`[${c?"PASS":"FAIL"}] ${n}`);if(!c)failures.push(n);}
const pick={cfbdGameId:401,cfbdPickedTeamId:333,team:"Alabama",side:"home",line:-6.5,matchup:"Tennessee @ Alabama"};
const sg=ctx.cfbdScoreboardGameFor(pick);
check("scoreboard match prefers canonical CFBD game id",sg&&sg.id===401);
const status=ctx.cfbdPickScoreStatus(pick,sg);
check("live ATS status computes current cover margin from picked side",status.coverMargin===-2.5&&status.result===null);
const liveHtml=ctx.cfbdPickStatusHTML(pick,null);
check("My Picks status reports LIVE and ATS position",liveHtml.includes("LIVE")&&liveHtml.includes("Behind ATS by 2.5"));
vm.runInContext(`cfbdScoreboard[0].status="completed";cfbdScoreboard[0].homeTeam.points=31;cfbdScoreboard[0].awayTeam.points=20`,ctx);
const finalStatus=ctx.cfbdPickScoreStatus(pick,ctx.cfbdScoreboardGameFor(pick));
check("completed score produces ATS W/L/P",finalStatus.result==="W"&&finalStatus.coverMargin===4.5);
vm.runInContext(`cfbdRatings=[
 {year:2026,team:"Alabama",core:{overall:18,throughWeek:4},sp:{rating:20.1,ranking:3},fpi:{fpi:19.3},elo:{elo:1912},srs:{rating:17.4,ranking:4}},
 {year:2026,team:"Tennessee",core:{overall:12,throughWeek:4},sp:{rating:14.2,ranking:12},fpi:{fpi:13.1},elo:{elo:1810},srs:{rating:11.8,ranking:15}}
]`,ctx);
const ratingsHtml=ctx.cfbdRatingsPanelHTML({away:"Tennessee",home:"Alabama",cfbdAwayTeamId:2633,cfbdHomeTeamId:333});
check("rating panel surfaces all five CFBD rating systems",["CORE","SP+","FPI","Elo","SRS"].every(x=>ratingsHtml.includes(x)));
check("rating panel explicitly says ratings do not affect Model #",ratingsHtml.includes("not part of Model #"));
check("rating panel includes both matchup teams",ratingsHtml.includes("Tennessee")&&ratingsHtml.includes("Alabama"));
check("Snapshot detail renderer calls CFBD ratings panel",board.includes('cfbdRatingsPanelHTML(g)'));

// --- Matchup Intelligence v1 -------------------------------------------
// cfbdMatchupAdvantage() is the pure comparison function -- tested
// directly, separate from its own HTML renderer, same split the rest of
// this project uses for model/logic vs HTML-string builders.
const bamaOff={offense:{ppa:0.38,successRate:0.50,explosiveness:1.30,rushingPlays:{successRate:0.55},passingPlays:{successRate:0.45}}};
const volsDef={defense:{ppa:0.05,successRate:0.35,explosiveness:1.05,rushingPlays:{successRate:0.32},passingPlays:{successRate:0.37}}};
const adv=ctx.cfbdMatchupAdvantage(bamaOff,volsDef);
check("cfbdMatchupAdvantage returns all 5 tracked metrics when both sides have full data",adv.length===5);
const successRow=adv.find(r=>r.key==="successRate");
check("cfbdMatchupAdvantage: a clearly higher offense successRate than what the defense allows favors the OFFENSE",
  successRow&&successRow.offVal===0.50&&successRow.defVal===0.35&&successRow.favors==="offense");
const rushRow=adv.find(r=>r.key==="rushSuccessRate");
check("cfbdMatchupAdvantage: rushing success pulled from the nested rushingPlays.successRate split, not a top-level field",
  rushRow&&rushRow.offVal===0.55&&rushRow.defVal===0.32);

// A near-equal matchup (tiny real difference) should read as "even," not
// falsely favor either side -- this is the noise-threshold behavior.
const evenOff={offense:{ppa:0.20,successRate:0.40,explosiveness:1.10}};
const evenDef={defense:{ppa:0.19,successRate:0.395,explosiveness:1.09}};
const evenAdv=ctx.cfbdMatchupAdvantage(evenOff,evenDef);
check("cfbdMatchupAdvantage: a difference within the noise threshold reads as 'even', not a false advantage",
  evenAdv.find(r=>r.key==="successRate").favors==="even");

// Missing offense/defense data must degrade to an empty comparison, not throw.
check("cfbdMatchupAdvantage returns [] when the offense side has no data at all",
  ctx.cfbdMatchupAdvantage(null,volsDef).length===0);
check("cfbdMatchupAdvantage returns [] when the defense side has no data at all",
  ctx.cfbdMatchupAdvantage(bamaOff,null).length===0);

// REAL BUG, found and fixed after this shipped: a genuinely empty (but
// successfully fetched) CFBD result showed NOTHING at all, with zero
// explanation -- which is exactly what caused real production confusion
// (CFBD legitimately returns 200 with body [] in the preseason, before any
// games have been played, since /stats/season/advanced computes CUMULATIVE
// season stats from games actually played). Panel must now distinguish
// "never fetched yet" (stay silent, same as before) from "fetched
// successfully, genuinely nothing there" (say so).
check("matchup panel: before any fetch has ever completed (cfbdAdvancedMeta still null), stays silent -- same as ratings before their own first load",
  vm.runInContext("cfbdAdvanced.length",ctx)===0 && vm.runInContext("cfbdAdvancedMeta",ctx)===null && ctx.cfbdMatchupPanelHTML({away:"A",home:"B"})==="");
vm.runInContext(`cfbdAdvancedMeta={year:2026,fetchedAt:"2026-08-19T12:00:00Z",source:"live"}`,ctx);
const emptySeasonHtml=ctx.cfbdMatchupPanelHTML({away:"A",home:"B"});
check("matchup panel: AFTER a successful fetch that genuinely returned nothing (cfbdAdvancedMeta set, cfbdAdvanced still []), explains why instead of silently showing nothing",
  emptySeasonHtml!=="" && emptySeasonHtml.includes("Not available yet this season"));
check("matchup panel: the empty-season explanation still carries the Matchup Intelligence label and context-only note, same as the populated panel",
  emptySeasonHtml.includes("Matchup Intelligence") && emptySeasonHtml.includes("not part of Model #"));
vm.runInContext(`cfbdAdvancedMeta=null`,ctx); // reset for the populated-data tests below

vm.runInContext(`cfbdAdvanced=[
 {team:"Alabama",offense:{ppa:0.38,successRate:0.50,explosiveness:1.30,rushingPlays:{successRate:0.55},passingPlays:{successRate:0.45}},
  defense:{ppa:0.05,successRate:0.33,explosiveness:1.0,rushingPlays:{successRate:0.30},passingPlays:{successRate:0.36},havoc:{total:0.22}}},
 {team:"Tennessee",offense:{ppa:0.22,successRate:0.41,explosiveness:1.05,rushingPlays:{successRate:0.44},passingPlays:{successRate:0.38}},
  defense:{ppa:0.05,successRate:0.35,explosiveness:1.05,rushingPlays:{successRate:0.32},passingPlays:{successRate:0.37},havoc:{total:0.14}}}
]`,ctx);
const matchupHtml=ctx.cfbdMatchupPanelHTML({away:"Tennessee",home:"Alabama",cfbdAwayTeamId:2633,cfbdHomeTeamId:333});
check("matchup panel is labeled Matchup Intelligence and marked context-only, same convention as the ratings panel",
  matchupHtml.includes("Matchup Intelligence")&&matchupHtml.includes("not part of Model #"));
check("matchup panel shows BOTH offense-vs-defense directions (away off vs home def, AND home off vs away def)",
  matchupHtml.includes("Tennessee offense")&&matchupHtml.includes("Alabama defense")
  &&matchupHtml.includes("Alabama offense")&&matchupHtml.includes("Tennessee defense"));
check("matchup panel includes the standalone havoc comparison row",matchupHtml.includes("Havoc rate"));
check("matchup panel highlights the stronger side's number, same '.stronger' visual convention as the ratings panel",
  matchupHtml.includes("stronger"));
check("matchup panel returns empty string when there's no advanced-stats data at all for either team",
  ctx.cfbdMatchupPanelHTML({away:"Nowhere State",home:"Neverland U"})==="");
check("Snapshot detail renderer calls the matchup panel",board.includes('cfbdMatchupPanelHTML(g)'));

check("My Picks renderer calls CFBD live status",picks.includes('cfbdPickStatusHTML(p,live)'));
check("CFBD insights script is shipped in app HTML",html.includes('/app/js/cfbd-insights.js'));

// --- Advanced postgame box-score analysis -------------------------------
// cfbdPostgamePanelHTML() is a pure HTML-string builder from an already-
// trimmed box score object (mirrors the server's real, live-doc-verified
// shape -- see api/fetch_cfbd.py's trim_box_score()), independently
// testable without any network/fetch involved.
const realBox={
  gameInfo:{homeTeam:"Alabama",awayTeam:"Tennessee",homePoints:31,awayPoints:20,homeWinner:true},
  teams:{
    Alabama:{successRate:0.51,ppa:0.29,explosiveness:1.4,pointsPerOpportunity:4.8,havoc:0.22,turnovers:1},
    Tennessee:{successRate:0.38,ppa:0.12,explosiveness:1.1,pointsPerOpportunity:3.1,havoc:0.14,turnovers:3},
  },
};
const postgameHtml=ctx.cfbdPostgamePanelHTML(realBox,"Tennessee","Alabama");
check("postgame panel is labeled 'why this game went the way it did' and marked context-only, never affects the grade",
  postgameHtml.includes("Why this game went the way it did") && postgameHtml.includes("never affects the grade"));
check("postgame panel includes both teams' actual numbers",
  postgameHtml.includes("51.0%") && postgameHtml.includes("38.0%")); // successRate, pct-formatted
check("postgame panel includes turnovers as its own row",postgameHtml.includes("Turnovers"));
check("postgame panel highlights the stronger side per metric (more success rate = better)",
  postgameHtml.includes("stronger"));

// Turnovers specifically: FEWER is better, the opposite direction from
// every other metric on this panel -- Tennessee has MORE turnovers (3 vs
// 1) but should NOT be shown as "stronger" for that row; Alabama (fewer)
// should be. Verified by checking the row's own highlight placement, not
// just that "stronger" appears somewhere in the whole panel.
const turnoverRowMatch=postgameHtml.match(/<div class="cfbd-matchup-row cols-3">\s*<span class="metric">Turnovers<\/span>[\s\S]*?<\/div>/);
check("postgame panel: for turnovers specifically, the LOWER count (Alabama, 1) is highlighted as stronger, not Tennessee's higher count",
  turnoverRowMatch && /<span class="val stronger">1<\/span>/.test(turnoverRowMatch[0]) && !/<span class="val stronger">3<\/span>/.test(turnoverRowMatch[0]));

check("postgame panel returns empty string when neither team has any box-score data",
  ctx.cfbdPostgamePanelHTML({teams:{}},"Nowhere State","Neverland U")==="");
check("postgame panel returns empty string for a null box score (never fetched / fetch failed)",
  ctx.cfbdPostgamePanelHTML(null,"A","B")==="");

// A team with SOME but not all fields populated (e.g. turnovers came back
// null from the best-effort second call) must still render the fields
// that DO exist, not blank the whole panel over one missing metric.
const partialBox={teams:{Alabama:{successRate:0.51,ppa:null,turnovers:null},Tennessee:{successRate:0.38}}};
const partialHtml=ctx.cfbdPostgamePanelHTML(partialBox,"Tennessee","Alabama");
check("postgame panel still renders rows that DO have data even when other metrics are null for both teams",
  partialHtml.includes("Success rate") && partialHtml.includes("51.0%"));

// --- fetchCfbdBoxScore(): lazy, cached, one game at a time ---------------
let apiCalls=[];
ctx.apiFetch=async(url)=>{
  apiCalls.push(url);
  return {ok:true,body:{gameId:401,teams:{Alabama:{successRate:0.5}},fetchedAt:"2026-08-19T12:00:00Z",source:"live"}};
};
vm.runInContext(`cfbdBoxScores={}`,ctx);
const fetched=await ctx.fetchCfbdBoxScore(401);
check("fetchCfbdBoxScore(): fetches and returns the box score body",fetched&&fetched.teams.Alabama.successRate===0.5);
check("fetchCfbdBoxScore(): hits the correct endpoint with the game id",apiCalls[0]==="/api/fetch_cfbd?view=boxscore&id=401");
apiCalls=[];
const fetchedAgain=await ctx.fetchCfbdBoxScore(401);
check("fetchCfbdBoxScore(): a second call for the SAME game id uses the in-memory cache, doesn't re-fetch",
  fetchedAgain===fetched && apiCalls.length===0);

ctx.apiFetch=async()=>({ok:false,error:"CFBD unavailable"});
vm.runInContext(`cfbdBoxScores={}`,ctx);
const failedFetch=await ctx.fetchCfbdBoxScore(999);
check("fetchCfbdBoxScore(): a failed request returns null, doesn't throw",failedFetch===null);
check("fetchCfbdBoxScore(): a null gameId returns null immediately, never calls apiFetch",
  await ctx.fetchCfbdBoxScore(null)===null);

// --- SP+/CORE as real Model # inputs --------------------------------------
// cfbdDerivedSpread() is the pure conversion function -- tested directly
// against the exact real HFA constant Drew confirmed (2.6, sourced from
// real research: see PRED_SYSTEMS' own comment in app/data/pred-systems.js
// for the full citation trail), independent of any fetch/DOM.
check("cfbdDerivedSpread(): equal ratings -> spread is exactly -HFA (home favored by the home-field constant alone, nothing else separates them)",
  ctx.cfbdDerivedSpread(20,20)===-2.6);
check("cfbdDerivedSpread(): a much stronger AWAY team can still show the home team favored, if the rating gap is smaller than HFA (away 21 vs home 20 -> spread -1.6, home still 'favored' by the math)",
  ctx.cfbdDerivedSpread(21,20)===-1.6);
check("cfbdDerivedSpread(): a large away rating advantage flips the spread to favor the away team (positive, home-team-spread convention)",
  ctx.cfbdDerivedSpread(30,20)===7.4); // 30-20-2.6=7.4
check("cfbdDerivedSpread(): returns null when the away rating is missing, never fabricates a number from one side alone",
  ctx.cfbdDerivedSpread(null,20)===null);
check("cfbdDerivedSpread(): returns null when the home rating is missing",
  ctx.cfbdDerivedSpread(20,null)===null);
check("cfbdDerivedSpread(): returns null when both are missing",
  ctx.cfbdDerivedSpread(null,null)===null);

// applyCfbdDerivedPredictions(): the integration -- real ratings data,
// real games array, writes into predByKey WITHOUT clobbering whatever
// applyPredictions() (app/js/pdf-import.js) already put there for the
// same game.
vm.runInContext(`cfbdRatings=[
  {team:"Alabama",sp:{rating:24.1},core:{overall:18.0}},
  {team:"Tennessee",sp:{rating:15.3},core:{overall:12.5}}
]`,ctx);
vm.runInContext(`games=[{key:"tennessee@alabama",away:"Tennessee",home:"Alabama"}]`,ctx);
vm.runInContext(`predByKey={"tennessee@alabama":{sag:-7.5}}`,ctx); // simulates a real predictiontracker.com system already present
ctx.applyCfbdDerivedPredictions();
const pbk=vm.runInContext("predByKey",ctx);
check("applyCfbdDerivedPredictions(): writes cfbdsp using SP+ ratings for both teams",
  Math.abs(pbk["tennessee@alabama"].cfbdsp-(15.3-24.1-2.6))<1e-9);
check("applyCfbdDerivedPredictions(): writes cfbdcore using CORE ratings for both teams",
  Math.abs(pbk["tennessee@alabama"].cfbdcore-(12.5-18.0-2.6))<1e-9);
check("applyCfbdDerivedPredictions(): does NOT clobber a predictiontracker.com system already written for this game (sag survives)",
  pbk["tennessee@alabama"].sag===-7.5);

// A team missing from cfbdRatings entirely (e.g. an FCS opponent CFBD
// doesn't rate) -- must not throw, and must not write a fabricated number
// for the metric that has no real data.
vm.runInContext(`cfbdRatings=[{team:"Alabama",sp:{rating:24.1},core:{overall:18.0}}]`,ctx); // Tennessee missing entirely
vm.runInContext(`games=[{key:"tennessee@alabama",away:"Tennessee",home:"Alabama"}]`,ctx);
vm.runInContext(`predByKey={}`,ctx);
ctx.applyCfbdDerivedPredictions();
const pbk2=vm.runInContext("predByKey",ctx);
check("applyCfbdDerivedPredictions(): a team missing from cfbdRatings entirely -> no cfbdsp/cfbdcore written for that game (not a fabricated one-sided guess)",
  !pbk2["tennessee@alabama"] || (pbk2["tennessee@alabama"].cfbdsp===undefined && pbk2["tennessee@alabama"].cfbdcore===undefined));

// No ratings loaded at all yet (e.g. called before the first fetch
// completes) -- a safe no-op, not a throw.
vm.runInContext(`cfbdRatings=[]`,ctx);
vm.runInContext(`games=[{key:"a@b",away:"A",home:"B"}]`,ctx);
vm.runInContext(`predByKey={}`,ctx);
let threwOnEmptyRatings=false;
try{ ctx.applyCfbdDerivedPredictions(); }catch(e){ threwOnEmptyRatings=true; }
check("applyCfbdDerivedPredictions(): no ratings loaded yet -> safe no-op, doesn't throw",
  !threwOnEmptyRatings);

// --- PRED_SYSTEMS / PRED_SHORT wiring (structural) --------------------
const predSystemsSrc=fs.readFileSync(new URL("../app/data/pred-systems.js",import.meta.url),"utf8");
check("PRED_SYSTEMS includes cfbdsp so it shows up in the Prediction Systems checklist grid like every other system",
  /\{code:"cfbdsp",\s*name:"SP\+ \(CFBD, derived\)"\}/.test(predSystemsSrc));
check("PRED_SYSTEMS includes cfbdcore",
  /\{code:"cfbdcore",\s*name:"CORE \(CFBD, derived\)"\}/.test(predSystemsSrc));
check("app/index.html's PRED_SHORT gives cfbdsp/cfbdcore real short labels for the Board's column header, not just a truncated raw code",
  /cfbdsp:"SP\+"/.test(html) && /cfbdcore:"CORE"/.test(html));

// --- applyPredictions() wiring (structural, app/js/pdf-import.js) ------
const pdfImportSrc=fs.readFileSync(new URL("../app/js/pdf-import.js",import.meta.url),"utf8");
check("applyPredictions() routes ALL of its exit points (both early returns and normal completion) through _finishApplyPredictions(), so SP+/CORE recompute on every call site that already calls applyPredictions() -- not just the ones someone remembers to update",
  (pdfImportSrc.match(/return _finishApplyPredictions\(/g)||[]).length===3);
check("_finishApplyPredictions() actually calls applyCfbdDerivedPredictions()",
  /function _finishApplyPredictions\(matchedCount\)\{[\s\S]{0,120}applyCfbdDerivedPredictions\(\)/.test(pdfImportSrc));

// --- _cfbdRenderConsumers() wiring (structural) -------------------------
check("_cfbdRenderConsumers() recomputes derived predictions before re-rendering anything (ratings can arrive after the page's first applyPredictions() already ran)",
  /function _cfbdRenderConsumers\(\)\{[\s\S]{0,400}applyCfbdDerivedPredictions\(\)/.test(src));
check("_cfbdRenderConsumers() now also re-renders the Edge Board (previously missing -- Model #/Edge/Cover % on Board would only go stale-until-next-unrelated-render once ratings loaded)",
  /if\(document\.getElementById\("boardBody"\)\) renderBoard\(\);/.test(src));

// --- app/js/record.js wiring (structural) --------------------------------
check("record.js only shows the 'Why?' toggle for a GRADED pick (result set) with a real CFBD identity frozen on it",
  /canShowWhy=!!\(p\.result *&& *p\.cfbdGameId!=null *&& *p\.cfbdAwaySchool *&& *p\.cfbdHomeSchool\)/.test(record));
check("record.js tracks expanded box-score panels OUTSIDE renderRecord() (module-level Set), so a re-render doesn't collapse an already-open panel",
  /let recordExpandedBoxScores=new Set\(\)/.test(record));
check("record.js's 'Why?' click handler calls fetchCfbdBoxScore() with the pick's frozen game id",
  /fetchCfbdBoxScore\(b\.dataset\.gameid\)/.test(record));
check("record.js's 'Why?' click handler renders via cfbdPostgamePanelHTML(), passing the frozen away/home school names",
  /cfbdPostgamePanelHTML\(box,b\.dataset\.away,b\.dataset\.home\)/.test(record));
check("record.js patches only the ONE panel that was clicked (querySelector on the specific whyKey), not a blind full re-render after the fetch resolves",
  /wrap\.querySelector\(`\[data-why-panel="\$\{CSS\.escape\(whyKey\)\}"\]`\)/.test(record));

if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}console.log(`\nAll ${total} checks passed.`);
