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
const MODEL_VERSION=1;

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
// rather than quietly substituting the stale locked number.
function pickGaugeModelMarketLine(g){
  if(!g) return null;
  if(g.poolLocked) return (g.liveVegas!=null&&!isNaN(g.liveVegas))?Number(g.liveVegas):null;
  return (g.vegas!=null&&!isNaN(g.vegas))?Number(g.vegas):null;
}

function pickGaugeModelValues(g){
  if(!g) return null;
  const preds=predsFor(g.key)||{};
  return {
    sag:preds.sag,
    sagpred:preds.sagpred,
    dokter:preds.dokter,
    cfbdsp:preds.cfbdsp,
    vegas:pickGaugeModelMarketLine(g),
    big200:preds.big200,
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
function pickGaugeModelNumber(g){
  const vals=pickGaugeModelValues(g);
  if(!vals||pickGaugeModelMissingInputs(g).length) return null;
  let num=0;
  Object.entries(PICKGAUGE_MODEL_PRESET.weights).forEach(([code,w])=>{ num+=Number(vals[code])*w; });
  return num/100;
}

function weightOf(key){
  const w=state.weights?state.weights[key]:undefined;
  // Every input defaults to 1 (equal weighting) EXCEPT Vegas, which
  // defaults to 0 -- unlike BP/Comp/each prediction system, Vegas is
  // always structurally included in the weighted average (see
  // weightedModel()'s includeVegas -- there's no checkbox that excludes
  // it the way enabledSystems does for everything else), so its WEIGHT is
  // the only lever that controls whether it actually affects Model #.
  // Defaulting that lever to 1 meant Model # silently baked the market
  // itself into "your model" for anyone who hadn't touched this box --
  // including brand-new users who'd never consciously chosen that. A
  // weight of 0 means Vegas still shows in the Input Weights row (always
  // visible, per the UI split from BP/Comp -- see renderSystemsSettings())
  // and remains one edit away from contributing, but Model # now reflects
  // your own inputs alone until you explicitly raise it above 0.
  if(w==null||w==="") return key==="vegas" ? 0 : 1;
  const n=Number(w);
  if(isNaN(n)) return key==="vegas" ? 0 : 1;
  return Math.max(0,n);
}
// Weighted mean of the model inputs for a game. includeVegas=false gives the
// "raw" (Vegas-excluded) number. Returns null if nothing carries weight.
function weightedModel(g, includeVegas){
  const key=typeof g==="string"?g:g.key;
  const game=typeof g==="string"?games.find(x=>x.key===g):g;
  // PickGauge Model # is a branded, fixed 100% recipe. Do NOT fall through to
  // the generic weighted-average behavior here: that behavior intentionally
  // re-normalizes around missing inputs, which would make the advertised
  // fixed internal percentages untrue for that game. PickGauge Model #
  // instead stays blank until all six ingredients are present.
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
  if(includeVegas && game && game.vegas!=null){ const w=weightOf("vegas"); num+=w*Number(game.vegas); den+=w; }
  if(den<=0) return null;
  return num/den;
}
function myNumber(g){
  const m=weightedModel(g,true);
  return m==null?null:round1(m);
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
      const names={sag:"Sagarin Ratings",sagpred:"Sagarin Predictor",dokter:"Dokter Entropy",cfbdsp:"SP+",vegas:"updated Vegas line",big200:"Big 200"};
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
