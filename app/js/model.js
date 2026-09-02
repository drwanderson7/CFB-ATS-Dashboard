// --- Composite probability model -----------------------------------------
// The actual math core: weighted model average (BP/Comp/prediction-tracker
// systems/Vegas), key-number proximity scoring, the fitted cover-margin
// probability table, edge computation, and closing-line-value math. Split
// out of app/index.html into its own file deliberately -- unlike the pure
// static data already split into app/data/*.js, this is the part of the
// app with real intellectual property (the fitted weights, the bucketed
// cover table lookup, the CLV/alignment logic), the part most likely to
// get read and reviewed carefully on its own, and the reason to isolate it
// FIRST before splitting anything else.
//
// Still loaded as a plain <script src="/app/js/model.js"> tag, not an ES
// module -- every function here becomes an ordinary global, exactly as if
// it were still declared inline. That matters for a few real external
// references this file makes that are NOT self-contained:
//   - `state` (state.weights, state.strongThresh, state.goodThresh) --
//     defined in the main inline script.
//   - `inputsFor()` / `predsFor()` -- also defined in the main inline
//     script (BP/Comp inputs and prediction-tracker numbers per game key).
//   - `round1()` -- general numeric-rounding utility, defined in the main
//     inline script.
//   - `BUCKETED_COVER_TABLE` -- defined in app/data/cover-table.js.
// None of these are referenced at the TOP LEVEL of this file (only inside
// function bodies, resolved lazily at call time), so load order relative
// to the main script doesn't actually matter for correctness -- by the
// time any of these functions is actually CALLED (well after every
// <script> tag on the page has finished loading), every one of those
// globals already exists. This file is placed alongside the app/data/*.js
// <script> tags, before the main inline script, purely for readability
// (keep every non-inline script together in one place), not because it
// has to be.
// Bump when the model math/data semantics change in a way that would make
// historical pick snapshots analytically different from current ones.
// v4 (Sept 1 2026, Option 2/"My Blend"): myNumber() -- and therefore Edge/
// Cover %/CLV/sort/every pick snapshot -- now returns a blend of PickGauge
// Model # and any weighted comparison systems when myBlendActive(), not
// always the pure PickGauge number. A pick made under v3 with the identical
// game/weights could compute a different myNumber() under v4 purely because
// this code path exists now, even with no blend actually configured at the
// time -- the CONDITION for divergence changed, which is what this version
// exists to flag, not just whether any single historical value moved.
//
// v5 (Sept 2, 2026): fixed a real bug where myBlendActive()/myBlendNumber()
// never checked BP or Comp at all -- only Vegas and prediction-tracker
// systems (see enabledSystemsOrdered()) could ever activate or contribute
// to a blend. Checking BP/Comp and giving them real weights right there in
// the grid silently had zero effect on Model #; the board just kept
// showing pure PickGauge with no error or missing-data indicator. Any pick
// made under v4 with BP/Comp checked+weighted could have used a materially
// different (wrong -- pure PickGauge instead of the intended blend) number
// than a v5 build recomputing the same inputs would produce today.
const MODEL_VERSION=5;

// PickGauge Model # is a standalone model mode. Its internal five-model +
// market recipe is intentionally independent from state.enabledSystems, which
// now represents only individually enabled comparison/custom systems.
function isPickGaugeModelActive(){
  return !!(state&&state.pickGaugeModelEnabled);
}

// The PickGauge recipe explicitly uses the "Vegas / updated line." Overall-board
// games already keep the current market in g.vegas. In a locked pool g.vegas
// intentionally becomes the pool's locked reference line, while g.liveVegas
// retains the current market for CLV. For PickGauge Model # we therefore use
// g.liveVegas post-lock; if it is unavailable, the branded model is incomplete
// rather than quietly substituting the stale locked number. Missing predictive
// model feeds are handled separately by pickGaugeModelCoverage()/Number().
function pickGaugeModelMarketLine(g){
  if(!g) return null;
  if(g.poolLocked) return (g.liveVegas!=null&&!isNaN(g.liveVegas))?Number(g.liveVegas):null;
  return (g.vegas!=null&&!isNaN(g.vegas))?Number(g.vegas):null;
}

function pickGaugeModelValues(g){
  if(!g) return null;
  const preds=predsFor(g.key)||{};
  return {
    teamrank:preds.teamrank,
    sagpred:preds.sagpred,
    cfbdsp:preds.cfbdsp,
    wayward:preds.wayward,
    vegas:pickGaugeModelMarketLine(g),
    sag:preds.sag,
  };
}
function pickGaugeModelMissingInputs(g){
  const vals=pickGaugeModelValues(g);
  if(!vals) return Object.keys(PICKGAUGE_MODEL_PRESET.weights);
  return Object.keys(PICKGAUGE_MODEL_PRESET.weights).filter(code=>{
    const v=vals[code];
    return v==null||v===""||isNaN(v);
  });
}
// Coverage guard for the standalone PickGauge number. Vegas is always required,
// while the predictive-model side may run with 3, 4, or all 5 feeds. This keeps
// the branded number usable early in a week/season before every publisher posts
// without allowing it to collapse into a one- or two-model blend.
function pickGaugeModelCoverage(g){
  const vals=pickGaugeModelValues(g)||{};
  const availableModels=PICKGAUGE_MODEL_PRESET.systems.filter(code=>{
    const v=vals[code];
    return v!=null&&v!==""&&!isNaN(v);
  });
  const missingModels=PICKGAUGE_MODEL_PRESET.systems.filter(code=>!availableModels.includes(code));
  const marketAvailable=vals.vegas!=null&&vals.vegas!==""&&!isNaN(vals.vegas);
  return {availableModels,missingModels,modelCount:availableModels.length,totalModels:PICKGAUGE_MODEL_PRESET.systems.length,marketAvailable};
}
function pickGaugeModelNumber(g){
  const vals=pickGaugeModelValues(g);
  if(!vals) return null;
  const coverage=pickGaugeModelCoverage(g);
  if(!coverage.marketAvailable||coverage.modelCount<3) return null;

  // Keep Vegas at its intended fixed share. Whenever one or two predictive
  // models are missing, redistribute only the missing MODEL weight
  // proportionally across whichever predictive models are available. This
  // preserves the market's influence while dynamically honoring the original
  // relative model weights. With all five models present, this collapses
  // exactly to the original fixed recipe.
  const vegasWeight=Number(PICKGAUGE_MODEL_PRESET.weights.vegas)||0;
  const modelWeightTarget=100-vegasWeight;
  const availableBaseWeight=coverage.availableModels.reduce((sum,code)=>sum+(Number(PICKGAUGE_MODEL_PRESET.weights[code])||0),0);
  if(availableBaseWeight<=0) return null;
  let num=Number(vals.vegas)*vegasWeight;
  coverage.availableModels.forEach(code=>{
    const baseWeight=Number(PICKGAUGE_MODEL_PRESET.weights[code])||0;
    const effectiveWeight=modelWeightTarget*(baseWeight/availableBaseWeight);
    num+=Number(vals[code])*effectiveWeight;
  });
  return num/100;
}

function weightOf(key){
  const w=state.weights?state.weights[key]:undefined;
  // Every input defaults to 1 (equal weighting), except "pickgauge" (My
  // Blend's own weight for the pure PickGauge Model # number, see
  // myBlendNumber() below), which defaults to 3 -- so a newly-enabled
  // comparison system TILTS the blend rather than instantly diluting the
  // branded number 50/50 the moment someone checks one box. Matches how
  // the feature was pitched -- "enable another system too, but just at a
  // lower weight" -- as a sensible starting point rather than requiring
  // every user's first move to be manually cranking PickGauge's own
  // weight up.
  //
  // Vegas used to be a special third case, permanently structurally
  // included at a default weight of 0 (an "always there, opt IN by
  // raising the number" design) rather than gated by a checkbox like
  // every other input. Sept 2, 2026 (Drew's explicit request): Vegas is
  // now a real checkbox in the systems grid (`vegas`, see
  // renderSystemsSettings()) exactly like BP/Comp/every comparison
  // system, in BOTH the fully-custom Model # and My Blend. With inclusion
  // now an explicit, deliberate action (checking the box) -- not an
  // easy-to-miss weight box the market was already quietly sitting in --
  // checking it and having it do nothing until you ALSO hunt down a
  // separate number field would just be confusing. So it now defaults to
  // 1 like everything else once checked. Pre-existing accounts that had
  // already set a real nonzero Vegas weight under the old mechanic are
  // migrated forward (see normalizeState()'s `_vegasCheckboxMigrated`
  // block, app/js/main.js) so their Model # doesn't silently change the
  // moment this ships.
  if(w==null||w==="") return key==="pickgauge" ? 3 : 1;
  const n=Number(w);
  if(isNaN(n)) return key==="pickgauge" ? 3 : 1;
  return Math.max(0,n);
}
// Weighted mean of the model inputs for a game. includeVegas=false gives the
// "raw" (Vegas-excluded) number. Returns null if nothing carries weight.
function weightedModel(g, includeVegas){
  const key=typeof g==="string"?g:g.key;
  const game=typeof g==="string"?games.find(x=>x.key===g):g;
  // PickGauge Model # owns its missing-input policy instead of falling through
  // to the generic custom-model normalizer. Its market share stays fixed; one
  // or two missing predictive feeds are rebalanced only across the available
  // predictive models, while fewer than 3/5 models (or missing Vegas) leave it
  // unavailable.
  if(includeVegas&&isPickGaugeModelActive()) return pickGaugeModelNumber(game);
  let num=0, den=0;
  const inp=inputsFor(key); // [BP, Comp]
  const enabledCore=new Set(state.enabledSystems);
  [["bp",inp[0]],["comp",inp[1]]].forEach(([k,v])=>{
    if(!enabledCore.has(k)) return;
    if(v!=null&&v!==""&&!isNaN(v)){ const w=weightOf(k); num+=w*Number(v); den+=w; }
  });
  const preds=predsFor(key);
  enabledSystemsOrdered().forEach(c=>{
    const v=preds[c];
    if(v!=null&&v!==""&&!isNaN(v)){ const w=weightOf(c); num+=w*Number(v); den+=w; }
  });
  // Vegas -- Sept 2, 2026: now checkbox-gated (enabledCore.has("vegas"))
  // instead of structurally always-considered-but-zero-weighted. Uses the
  // same lock-aware market line PickGauge's own recipe uses
  // (pickGaugeModelMarketLine() -- current live line normally, the pool's
  // locked reference line's live-line counterpart post-lock), so "Vegas"
  // means the same market number everywhere it's used in the app, not
  // just the pre-lock case the old raw `game.vegas` read covered.
  if(includeVegas && enabledCore.has("vegas")){
    const line=pickGaugeModelMarketLine(game);
    if(line!=null){ const w=weightOf("vegas"); num+=w*Number(line); den+=w; }
  }
  if(den<=0) return null;
  return num/den;
}
function myNumber(g){
  if(myBlendActive()){
    const blend=myBlendNumber(g);
    return blend==null?null:round1(blend);
  }
  const m=weightedModel(g,true);
  return m==null?null:round1(m);
}
// --- My Blend (Option 2, Sept 1 2026) --------------------------------------
// The problem this solves: with standalone PickGauge Model # active, any
// comparison system a user separately enables is READ-ONLY -- it renders as
// its own column purely for the user to eyeball, but structurally cannot
// influence Edge, Cover %, CLV, or the pick recommendation, because
// weightedModel() short-circuits straight to pickGaugeModelNumber() and
// never looks at state.enabledSystems at all. A user who wants "mostly
// PickGauge, but let TeamRankings.com nudge it a little" has no way to do
// that.
//
// Deliberately NOT done by changing what pickGaugeModelNumber() returns, or
// what the "PickGauge Model #" column displays -- that number stays exactly
// the fixed, branded recipe it always was (see PICKGAUGE_MODEL_PRESET's own
// header comment: proprietary weights stay hidden, this is the one thing
// about it users don't get to touch). Instead, myNumber() -- the function
// Edge/Cover %/CLV/sort/My Picks all actually key off -- becomes blend-
// aware: when a blend is genuinely active, it returns the blend; otherwise
// (the common case: PickGauge on, no comparison systems enabled) it's
// byte-for-byte the same pure PickGauge number as before, unchanged
// behavior for anyone who's never touched a comparison-system checkbox.
// The board surfaces this explicitly via a separate "My Blend" column
// (app/js/board.js) rather than silently swapping what "PickGauge Model #"
// itself shows.
//
// A blend is "active" only when there's genuinely something to blend --
// PickGauge on AND at least one comparison system (BP, Comp, Vegas, or any
// prediction-tracker system) carries positive weight. Toggling PickGauge on
// with nothing else enabled (or every comparison system's weight dragged to
// 0) is NOT a blend; it's just PickGauge alone, and myNumber() falls
// straight through to the unmodified path above.
//
// BUG FIXED Sept 2, 2026 (Drew's report: "when i enable BP and COMP and set
// weighting it doesnt show me my total model # it still only shows
// pickgauge model #"): this used to only look at enabledSystemsOrdered()
// (which deliberately EXCLUDES "bp"/"comp"/"vegas" -- see that function's
// own comment in main.js, they're handled specially because they aren't
// predictiontracker system codes) plus a separate vegas-specific check.
// BP and Comp were never checked at all, so checking their boxes and
// setting real weights right there in the grid had zero effect on whether
// a blend was considered active -- the board just silently kept showing
// pure PickGauge Model # with no visible sign anything was wrong (no
// error, no missing-data note -- BP/Comp still rendered fine as their own
// read-only comparison columns, which is exactly why this was easy to
// miss). Now checks bp/comp the same explicit way vegas already is.
function myBlendActive(){
  const enabledCore=new Set(state.enabledSystems);
  return isPickGaugeModelActive()&&(
    enabledSystemsOrdered().some(c=>weightOf(c)>0)
    || (enabledCore.has("vegas")&&weightOf("vegas")>0)
    || (enabledCore.has("bp")&&weightOf("bp")>0)
    || (enabledCore.has("comp")&&weightOf("comp")>0)
  );
}
// Weighted average of the pure PickGauge Model # number (its own weight,
// default 3 -- see weightOf()), BP and Comp's raw values (Sept 2, 2026 fix,
// same checkbox+weight gate weightedModel()'s DIY path already uses), each
// enabled prediction-tracker comparison system's raw value (its own weight,
// default 1), and -- since Sept 2, 2026 (Drew's explicit request) -- Vegas
// itself, if its own checkbox is on, using the same checkbox+weight pattern
// as every comparison system.
//
// Vegas can be counted twice in total if a user deliberately checks its box
// here: once already baked into the fixed PickGauge recipe at its own
// proprietary ~19% share, once again as this extra, separately-weighted
// blend term. That's a deliberate reversal of this function's original
// Sept 1, 2026 design (which refused to add a second Vegas term
// specifically to avoid that double-count) -- Drew's Sept 2 call was that
// users should be able to lean further into the market if they want to,
// not that the tool should silently prevent it on their behalf. Uses the
// same lock-aware market line PickGauge's own recipe uses
// (pickGaugeModelMarketLine()) rather than raw g.vegas, so "Vegas" means
// the same thing in both places for the same game.
function myBlendNumber(g){
  if(!myBlendActive()) return null;
  const pg=pickGaugeModelNumber(g);
  if(pg==null) return null;
  let num=0,den=0;
  const pgWeight=weightOf("pickgauge");
  if(pgWeight>0){ num+=pgWeight*pg; den+=pgWeight; }
  const enabledCore=new Set(state.enabledSystems);
  const inp=inputsFor(g.key); // [BP, Comp]
  [["bp",inp[0]],["comp",inp[1]]].forEach(([k,v])=>{
    if(!enabledCore.has(k)) return;
    if(v!=null&&v!==""&&!isNaN(v)){
      const w=weightOf(k);
      if(w>0){ num+=w*Number(v); den+=w; }
    }
  });
  const preds=predsFor(g.key);
  enabledSystemsOrdered().forEach(c=>{
    const v=preds[c];
    if(v!=null&&v!==""&&!isNaN(v)){
      const w=weightOf(c);
      if(w>0){ num+=w*Number(v); den+=w; }
    }
  });
  if(enabledCore.has("vegas")){
    const line=pickGaugeModelMarketLine(g);
    if(line!=null){
      const w=weightOf("vegas");
      if(w>0){ num+=w*Number(line); den+=w; }
    }
  }
  if(den<=0) return null;
  return num/den;
}
// What the "PickGauge Model #" / "Model #" COLUMN itself displays -- always
// the pure recipe number when PickGauge is active, NEVER the blend, even
// while myNumber() (Edge/Cover %/CLV/sort) is using the blend. This is the
// one function board.js/snapshot-export.js should call for that specific
// column; everything else keeps calling myNumber() as before.
function modelColumnDisplayNumber(g){
  if(isPickGaugeModelActive()){ const pg=pickGaugeModelNumber(g); return pg==null?null:round1(pg); }
  return myNumber(g);
}
// Transparent model-consensus signal: how many ENABLED, positively weighted
// non-market inputs favor a given side ATS against the same reference line
// used by Edge. Vegas itself is deliberately excluded -- this answers
// "how many models agree?", not "how many inputs including the market?".
// Exact model=line ties stay in the denominator but do not count as agreement
// for either side, so 8/11 really means eight of eleven loaded contributors.
function modelAgreement(g,targetSide){
  if(!g||g.vegas==null) return null;
  const V=Number(g.vegas);
  const vals=[];
  const pgActive=(typeof isPickGaugeModelActive==="function")&&isPickGaugeModelActive();
  if(pgActive){
    // Agreement for PickGauge Model # follows the five predictive-model
    // ingredients behind the standalone number. Vegas is intentionally not
    // counted as a "model" here, matching the existing agreement definition.
    const pg=pickGaugeModelValues(g)||{};
    PICKGAUGE_MODEL_PRESET.systems.forEach(code=>{
      const v=pg[code];
      if(v!=null&&v!==""&&!isNaN(v)) vals.push({code,value:Number(v)});
    });
  }else{
    const enabled=new Set(state.enabledSystems||[]);
    const inp=inputsFor(g.key)||[];
    [["bp",inp[0]],["comp",inp[1]]].forEach(([code,v])=>{
      if(!enabled.has(code)||weightOf(code)<=0) return;
      if(v!=null&&v!==""&&!isNaN(v)) vals.push({code,value:Number(v)});
    });
    const preds=predsFor(g.key)||{};
    enabledSystemsOrdered().forEach(code=>{
      const v=preds[code];
      if(weightOf(code)<=0) return;
      if(v!=null&&v!==""&&!isNaN(v)) vals.push({code,value:Number(v)});
    });
  }
  if(!vals.length) return null;

  let side=targetSide||null;
  if(side!=="home"&&side!=="away"){
    const M=myNumber(g);
    if(M==null||M===V) side=null;
    else side=M<V?"home":"away";
  }
  let home=0,away=0,neutral=0;
  vals.forEach(x=>{
    if(x.value<V) home++;
    else if(x.value>V) away++;
    else neutral++;
  });
  const agree=side==="home"?home:side==="away"?away:0;
  const oppose=side==="home"?away:side==="away"?home:0;
  return {side,agree,oppose,neutral,total:vals.length,pct:vals.length?agree/vals.length:0,inputs:vals};
}
// edge from home-line convention: vegas home line V, my home line M
// --- Edge significance: raw points aren't uniformly meaningful. Two smooth-
// formula attempts were tried and both rejected as misleading:
//   - A constant-variance win-probability model is translation-invariant --
//     it gave the IDENTICAL win% for a 1pt edge on a 4pt spread as on a 21pt
//     spread (verified). Pushing the assumption hard still barely moved the
//     number (52.5% -> 50.9%) -- not a tunable-parameter problem, structural.
//   - Percent-of-spread (edge / market line) blows up near a pick'em game
//     (1pt/1pt=100%, 1pt/0.5pt=200%, 1pt/0pt=divide-by-zero).
// Landed on a KEY NUMBER score instead: football scoring is discrete (3, 7,
// 10...), which is what actually drives "a point matters more here." First
// version only checked EXACT crossings, which meant an edge sitting fully
// inside the dense 3-7 zone (say -4 to -6) without touching either boundary
// scored zero -- same as a blowout, which missed the point. Rewritten to
// score PROXIMITY, not just crossings: a key number contributes full weight
// if the edge range contains it, and a fading partial weight for KEY_BAND
// points beyond that, then zero. Still structurally avoids both prior
// failures -- bounded (finite sum of capped contributions, can't blow up)
// and NOT translation-invariant (blowout ranges are genuinely far from every
// key number, so nothing contributes).
//
// KEY_NUMBER_WEIGHTS are fitted to real NCAAF margin data: 5,705 FBS-vs-FBS
// games, 2018-2025 regular season (source: collegefootballdata.com /games).
// Weight = |margin| frequency (%) scaled so margin=3 lands at 9, matching
// the original illustrative scale so KEY_BAND/tier thresholds still apply.
// Note: 21 replaces 6 from the old illustrative set -- 21 is genuinely more
// common (3.79% of games) than 6 (3.19%) in the real data, likely reflecting
// how often college blowouts land on multiples of 7 (three-score margins).
const KEY_NUMBER_WEIGHTS={3:9,7:7.47,10:4.05,14:3.65,21:3.31,17:3.27,4:3.14};
const KEY_NUMBERS=Object.keys(KEY_NUMBER_WEIGHTS).map(Number);
const KEY_BAND=1.5; // points beyond an exact crossing where partial credit fades to 0

// Proximity-weighted key-number score for the range between two home-
// perspective lines (checks both +K and -K so it works whichever side is
// favored). Returns the total score and the list of numbers that actually
// contributed a meaningful amount, for display.
function keyNumberScore(a,b){
  const lo=Math.min(a,b), hi=Math.max(a,b);
  let score=0;
  const contributors=[]; // {num, pct} for numbers contributing >=50% weight
  KEY_NUMBERS.forEach(k=>{
    const w=KEY_NUMBER_WEIGHTS[k];
    [k,-k].forEach(signed=>{
      const dist=(signed>=lo&&signed<=hi)?0:Math.min(Math.abs(signed-lo),Math.abs(signed-hi));
      const proximity=Math.max(0,1-dist/KEY_BAND);
      if(proximity<=0) return;
      score+=w*proximity;
      if(proximity>=0.5) contributors.push({num:k,pct:proximity});
    });
  });
  contributors.sort((x,y)=>(KEY_NUMBER_WEIGHTS[y.num]*y.pct)-(KEY_NUMBER_WEIGHTS[x.num]*x.pct));
  return {score:round1(score), numbers:[...new Set(contributors.map(c=>c.num))]};
}
// Bucket a bounded proximity score into a discrete tier. Deliberately
// conservative: a score near 0 returns tier "none" -- no fake signal
// manufactured for an edge nowhere near any key number.
function keyNumberTier(score){
  if(score>=8) return "major";
  if(score>=4) return "moderate";
  if(score>=0.5) return "minor";
  return "none";
}
function edgeOf(g){
  const M=myNumber(g);
  if(M==null||g.vegas==null) return null;
  const V=g.vegas;
  const pts=round1(Math.abs(V-M));
  const prob=probabilityCoverForGame(M,V);
  // Exact agreement with the market is not a lean. Previously M===V fell
  // through to the else-branch and confidently recommended the away side
  // on a 0.0 edge.
  if(pts===0) return {pts:0,side:null,team:null,line:null,keyNumbers:[],keyTier:"none",keyScore:0,prob};
  let side,team,line;
  if(M<V){ side="home"; team=g.home; line=V; }      // model favors home more -> take home at home line
  else   { side="away"; team=g.away; line=-V; }       // take away at away line
  const {score,numbers}=keyNumberScore(M,V);
  return {pts,side,team,line,keyNumbers:numbers,keyTier:keyNumberTier(score),keyScore:score,prob};
}
function edgeClass(pts){
  if(pts>=Number(state.strongThresh)) return "gd";
  if(pts>=Number(state.goodThresh)) return "g";
  return "r";
}
// Plain-language tier for an edge, so a lean's STRENGTH is stated in words
// rather than left to background color alone. Snapshot's Top Opportunities
// cards have labelled their tiers this way since they shipped; the Edge
// Board originally only carried the color, which meant a 0.3-point edge and
// a 3.0-point edge rendered as structurally identical rows -- same bold team
// name, same layout, same "EDGE — PICK" column heading -- distinguishable
// only by a red-vs-green background. That reads as "here is your pick for
// every game," which overstates a sub-threshold lean and is exactly the kind
// of unsupported-confidence claim this product deliberately avoids
// elsewhere. Shared here (next to edgeClass(), whose thresholds it mirrors)
// so Board and Snapshot can never drift to two different vocabularies for
// the same number -- snapshot-export.js previously carried its own inline
// copy of this ternary.
function edgeTierLabel(pts){
  const cls=edgeClass(pts);
  return cls==="gd"?"Strong":cls==="g"?"Good":"Slim";
}
// edgeOf() returns null for two genuinely different reasons, and a single
// generic "enter lines" message doesn't tell them apart -- a game with no
// live Vegas line yet reads very differently from a game where Vegas IS
// posted but every model input (BP/Comp, every prediction system) is
// still empty, which needs a different action (load predictions, or type
// BP/Comp in by hand) rather than just waiting on a refresh.
function edgeEmptyHTML(g){
  if(g.vegas==null) return `<span class="note">no line yet</span>`;
  if(isPickGaugeModelActive()){
    const missing=pickGaugeModelMissingInputs(g);
    if(missing.length){
      const names={teamrank:"TeamRankings.com",vegas:"Vegas Live #",sagpred:"Sagarin Points",cfbdsp:"SP+",wayward:"Waywardtrends",sag:"Sagarin Ratings"};
      const detail=missing.map(c=>names[c]||c).join(", ");
      return `<span class="note" title="Missing: ${esc(detail)}">PickGauge Model # incomplete</span>`;
    }
  }
  return `<span class="note">no model inputs</span>`;
}


// --- Probability Edge -------------------------------------------------
// Built from real CFBD data: 5,705 FBS-vs-FBS games, 2018-2025 regular
// season (source: collegefootballdata.com /games and /lines, consensus
// line preferred, Bovada/teamrankings as fallback). For each historical
// game: cover_margin = (homeScore-awayScore) - bookMargin, where
// bookMargin = -spread (positive = home favored). Bucketed by |spread|.
// Empirically std(cover_margin) is ~15.3-15.7 across all buckets (flat,
// not increasing with spread size) and mean stays within ~1pt of zero in
// every bucket -- consistent with an efficient closing line. Buckets kept
// anyway since the key-number SHAPE of the distribution can still differ
// even when spread/std don't, and to leave room for later refinement.
// BUCKETED_COVER_TABLE now lives in app/data/cover-table.js (loaded via <script> above) -- see that file for the full table and its provenance.
const BREAKEVEN_WINPCT=0.5238; // -110 vig breakeven
function bucketForSpread(absV){
  for(const label in BUCKETED_COVER_TABLE){
    const b=BUCKETED_COVER_TABLE[label];
    if(absV>=b.range[0]&&absV<=b.range[1]) return b;
  }
  const labels=Object.keys(BUCKETED_COVER_TABLE);
  return BUCKETED_COVER_TABLE[labels[labels.length-1]];
}
// P(model's side covers V), plus EV at -110. M,V in this app's home-team
// spread convention (negative = home favored) -- same convention as
// myNumber()/g.vegas throughout the rest of the file.
function probabilityCoverForGame(M,V){
  if(M==null||V==null) return null;
  const bucket=bucketForSpread(Math.abs(V));
  const modelEdge=V-M; // positive = model favors home more than the book does
  const side=M<V?"home":(M>V?"away":null);
  if(side==null) return {pCover:0.5,probEdge:0.5-BREAKEVEN_WINPCT,ev:0.5*0.9091-0.5,side:null,bucketRange:bucket.range};
  // pCover/pPush/pLoss computed explicitly and separately -- a push (the
  // shifted cover-margin lands exactly on 0) is neither a win nor a loss,
  // it refunds the stake, so it must contribute 0 to EV. The old formula
  // (`pCover*0.9091-(1-pCover)`) implicitly treated (1-pCover) as pure
  // loss, which silently folded push probability into the loss term and
  // made EV look worse than it actually is on integer-spread games where
  // pushes are possible (half-point lines have pPush=0, so this bug was
  // invisible there -- exactly why it went unnoticed).
  // A push against a real final score (always an integer margin) is only
  // structurally possible when V itself is a whole number -- a half-point
  // line like -7.5 can never exactly tie. Without this guard, the loop
  // below could register spurious "push" mass whenever some OTHER
  // historical game in the same bucket (whose own original line happened
  // to be a different decimal) had a cm value that exactly canceled
  // modelEdge -- a bucket-mixing artifact of the empirical table, not a
  // real push probability for this specific query.
  const pushPossible=Number.isInteger(V);
  let pCover=0,pPush=0;
  for(const cmStr in bucket.freq){
    const cm=Number(cmStr);
    const shifted=cm+modelEdge;
    if(pushPossible&&shifted===0){ pPush+=bucket.freq[cmStr]; continue; }
    if(side==="home"&&shifted>0) pCover+=bucket.freq[cmStr];
    if(side==="away"&&shifted<0) pCover+=bucket.freq[cmStr];
  }
  const pLoss=Math.max(0,1-pCover-pPush);
  const ev=pCover*0.9091-pLoss;
  return {pCover,pPush,pLoss,probEdge:pCover-BREAKEVEN_WINPCT,ev,side,bucketRange:bucket.range};
}
// Closing Line Value: how far the live market has moved since a pool's line
// locked. Only meaningful for a pool game that's actually locked and has a
// live-odds match to compare against.
//
// g.lockedLine and g.liveVegas are both in HOME-team perspective (negative =
// home favored) -- same convention as everywhere else in the app.
//
// raw = liveVegas - lockedLine: positive means the home team's number has
// drifted toward the underdog since lock (home team looks worse now than when
// the line locked); negative means it's drifted toward the home team.
//
// If a pick exists, CLV is converted to that pick's OWN perspective and
// signed so POSITIVE = favorable (industry-standard "beat the closing line" --
// the number you locked was better than where the market ended up), matching
// how grade_picks.py already treats "line" as the picked team's own-perspective
// spread. Derivation: for the home side, favorable = locked line was HIGHER
// (a smaller favorite / bigger underdog number) than where it is now, i.e.
// (lockedLine - liveVegas) > 0. For the away side the same movement means the
// opposite, so the sign flips.
function clvOf(g, pickedSide){
  if(g.lockedLine==null || g.liveVegas==null) return null;
  const raw=round1(g.liveVegas - g.lockedLine); // home-perspective market movement since lock
  if(!pickedSide) return {raw, forPick:null};
  const forPick=round1((pickedSide==="home"?1:-1) * (g.lockedLine - g.liveVegas));
  return {raw, forPick};
}
// Does the market's movement since lock (locked -> live) point the SAME direction
// as the model's remaining disagreement with the current market (live -> My#)?
// Both in home-team perspective. Independent of whether a pick has been made --
// this flags a game as worth a look, not just confirms one already picked.
// Example: JMU locked -6.5, live -9 (market has been sliding toward JMU), model
// says -18.5 (still further toward JMU than even the new live number) -> aligned.
// Returns a nonzero direction when aligned, 0 when not (including "flat" cases
// with no real movement on one side), or null if any input is missing.
function clvAlignment(g){
  const mn=myNumber(g);
  if(g.lockedLine==null||g.liveVegas==null||mn==null) return null;
  const clvDir=Math.sign(round1(g.liveVegas-g.lockedLine));
  const modelDir=Math.sign(round1(mn-g.liveVegas));
  if(clvDir===0||modelDir===0) return 0;
  return clvDir===modelDir?clvDir:0;
}
