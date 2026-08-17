// --- Prediction tracker: fetch + weighting UI -----------------------------
// Split out of app/index.html as part of the JS-splitting pass. Covers:
// pulling thepredictiontracker.com's CSV through the serverless proxy
// (fetchPredictions() -- same freshness-window-reuse pattern as
// refreshLines() in app/js/odds.js: check the shared tier first, skip the
// real fetch if someone already loaded within the window), and the
// Prediction Systems settings panel (renderSystemsSettings() -- the
// checklist of ~40 systems plus BP/Comp/Vegas core weights,
// setWeight()/bindWeightInput() for the per-system weight boxes,
// systemsPresentThisWeek() to dim systems the current week's CSV didn't
// carry, updateSystemsCount() for the small "N on" / "last loaded" status
// line).
//
// Loaded as a plain <script src="/app/js/prediction-tracker.js"> tag,
// same as the other split files -- an ordinary global scope, not a
// module. Real external references this file makes that are NOT self-
// contained (all resolved lazily inside function bodies, never at top-
// level, so script load order relative to the rest of the page doesn't
// matter for correctness -- same reasoning as the other split files'
// header comments):
//   - `state`, `games` -- global app state and the current week's game
//     list (main inline script).
//   - `PRED_SYSTEMS`/`TOP_SYSTEM_RANKS` -- app/data/pred-systems.js /
//     main inline script (TOP_SYSTEM_RANKS is a small backtest-ranking
//     table, still inline).
//   - `pullTier()` -- cross-device shared-tier sync (main inline script).
//   - `apiFetch()` -- classified fetch wrapper (app/js/api-client.js).
//   - `minsAgo()`/`SHARED_FRESH_MINUTES` -- freshness-window helpers
//     (main inline script).
//   - `applyPredictions()`/`lastPredUnmatched` -- app/js/pdf-import.js.
//   - `renderBoard()` -- app/js/board.js.
//   - `weightOf()` -- app/js/model.js.
//   - `inputsFor()`/`esc()` -- general utilities (main inline script).
//   - `save()` -- persistence (main inline script).
async function fetchPredictions(){
  const st=document.getElementById('predStatus');
  const btn=document.getElementById('loadPredsBtn');
  if(st){ st.style.color='var(--muted)'; st.textContent='loading predictions…'; }
  if(btn) btn.disabled=true;
  try{
    // Freshness guard: pull the shared tier first and skip the real fetch
    // if someone already loaded predictions within the freshness window
    // (see SHARED_FRESH_MINUTES, still in app/index.html's main inline
    // script).
    await pullTier("shared",true);
    const freshAge=minsAgo(state.predMeta&&state.predMeta.fetchedAt);
    if(freshAge!=null&&freshAge<SHARED_FRESH_MINUTES&&Array.isArray(state.predictions)&&state.predictions.length){
      const matched=applyPredictions();
      renderBoard(); renderSystemsSettings();
      if(st){ st.style.color='var(--muted)'; st.textContent=`Using recent data from ${freshAge}m ago · ${matched} matched to board`; }
      if(btn) btn.disabled=false;
      return;
    }
    const result=await apiFetch('/api/fetch_predictions',{});
    if(!result.ok) throw new Error(result.error);
    const data=result.body;
    if(!Array.isArray(data.games)||!data.games.length) throw new Error(data.message||'No prediction rows returned');
    // api/fetch_predictions.py already wrote predictions/predMeta into the
    // shared bucket itself -- adopt that persisted copy rather than
    // building/pushing our own (a generic shared POST is rejected now, see
    // api/state.py).
    await pullTier("shared",true);
    const matched=applyPredictions();
    renderBoard(); renderSystemsSettings();
    if(st){
      const unm=lastPredUnmatched.length;
      const noneOn=state.enabledSystems.length===0;
      st.style.color=matched>0?'var(--green-text)':'var(--amber)';
      st.textContent=`loaded ${data.count} games · ${matched} matched to board`
        +(unm?` · ${unm} unmatched (see console)`:'')
        +(noneOn?' · open ⚙ Prediction systems to enable & show columns':'');
    }
  }catch(err){
    if(st){ st.style.color='var(--red-text)'; st.textContent='predictions failed: '+err.message; }
    console.error(err);
  }finally{
    if(btn) btn.disabled=false;
  }
}
// Settings checklist. Systems present in this week's fetch are enabled-able and
// live; ones the CSV didn't carry this week are shown dimmed but still toggleable
// (they just won't contribute until a fetch includes them).
function systemsPresentThisWeek(){
  const present=new Set();
  (state.predictions||[]).forEach(p=>Object.keys(p.systems||{}).forEach(c=>present.add(c)));
  return present;
}
function setWeight(key, raw){
  if(!state.weights) state.weights={};
  const v=parseFloat(raw);
  // "Matches this key's own default -> don't bother storing it" is a
  // sparse-storage optimization, not a behavior change -- but the default
  // isn't a universal 1 anymore (see weightOf()): Vegas defaults to 0,
  // everything else still defaults to 1. Comparing against a hardcoded 1
  // here would silently DELETE a user's explicit "1" for Vegas -- exactly
  // the input this exists to let them set -- and revert it right back to
  // 0 the moment they typed the value they actually wanted.
  const dflt=(key==="vegas")?0:1;
  if(raw===""||isNaN(v)||v===dflt){ delete state.weights[key]; }
  else { state.weights[key]=Math.max(0,v); }
  save(); renderBoard();
}
function bindWeightInput(el){
  el.onchange=()=>{ setWeight(el.dataset.w, el.value); el.value=(weightOf(el.dataset.w)); };
}
function renderSystemsSettings(){
  // core-input weight boxes (BP/Comp/Vegas) -- just (re)fill values
  document.querySelectorAll('.core-weights .weight-inp').forEach(el=>{ el.value=weightOf(el.dataset.w); bindWeightInput(el); });
  const enabledCore=new Set(state.enabledSystems);
  // BP and Comp's weight boxes only matter when the matching checkbox
  // below is actually on -- weightedModel() skips both entirely otherwise
  // (see the enabledCore.has(k) gate there), so showing a weight input
  // for an input that isn't counted in Model # right now was pure
  // clutter, and looked like it was doing something it wasn't. Vegas has
  // no such checkbox anywhere in this panel -- there's no code path that
  // ever excludes it from weightedModel() the way enabledSystems does for
  // everything else -- so its weight box stays permanently visible rather
  // than being hidden behind a toggle that doesn't exist. Its default
  // WEIGHT is 0 though (see weightOf()), not 1 like everything else -- so
  // "always visible" no longer means "always affects Model #" the way it
  // used to; it just means the lever that controls that is always
  // reachable, one edit away.
  const cwBp=document.getElementById("cwBp"); if(cwBp) cwBp.style.display=enabledCore.has("bp")?"":"none";
  const cwComp=document.getElementById("cwComp"); if(cwComp) cwComp.style.display=enabledCore.has("comp")?"":"none";
  const wrap=document.getElementById("systemsList");
  if(!wrap) return;
  const present=systemsPresentThisWeek();
  const enabled=enabledCore;
  const knownCodes=PRED_SYSTEMS.map(s=>s.code);
  const extras=[...present].filter(c=>!knownCodes.includes(c)).sort();
  const all=[...PRED_SYSTEMS, ...extras.map(c=>({code:c,name:c}))];
  const core=[{code:"bp",name:"BP (Brad Powers line)"},{code:"comp",name:"Comp (computer line)"}];
  wrap.innerHTML=[...core,...all].map(s=>{
    const on=enabled.has(s.code);
    const isCore=s.code==="bp"||s.code==="comp";
    const idx=s.code==="bp"?0:1;
    const has=isCore?games.some(g=>{const v=inputsFor(g.key)[idx]; return v!=null&&v!=="";}):present.has(s.code);
    const dim=(!has&&(isCore||state.predictions))?'opacity:.5;':'';
    const badge=has?'<span class="sys-live">●</span>':(isCore?'<span class="sys-off">no PDF data</span>':(state.predictions?'<span class="sys-off">no data</span>':''));
    // weight box shown only when the system is enabled (it doesn't count otherwise)
    const wbox=on?`<input type="number" class="weight-inp sys-weight" data-w="${esc(s.code)}" step="0.5" min="0" inputmode="decimal" title="weight for ${esc(s.name)}" value="${weightOf(s.code)}">`:'';
    const top=TOP_SYSTEM_RANKS[s.code];
    const star=top?`<span class="sys-top" title="Top 10 performer -- #${top.rank} of ~40 in your 2-year backtest (composite ${top.composite}, lower=better; 40% ATS% / 30% MAE / 30% |Bias|)">★ Top 10</span>`:'';
    return `<div class="sys-item" style="${dim}">
      <label class="sys-check"><input type="checkbox" data-sys="${esc(s.code)}" ${on?'checked':''}>${star}<span class="sys-name">${esc(s.name)}</span></label>
      <span class="sys-right">${wbox}${badge}</span>
    </div>`;
  }).join("");
  wrap.querySelectorAll("[data-sys]").forEach(cb=>cb.onchange=()=>{
    const code=cb.dataset.sys;
    const set=new Set(state.enabledSystems);
    if(cb.checked) set.add(code); else set.delete(code);
    state.enabledSystems=[...set];
    save(); renderSystemsSettings(); renderBoard(); updateSystemsCount();
  });
  wrap.querySelectorAll(".sys-weight").forEach(bindWeightInput);
  updateSystemsCount();
}
function updateSystemsCount(){
  const el=document.getElementById("systemsCount");
  if(el) el.textContent=state.enabledSystems.length+" on";
  const meta=document.getElementById("predMetaLine");
  if(meta){
    meta.textContent=state.predMeta&&state.predMeta.fetchedAt
      ? `Last loaded ${new Date(state.predMeta.fetchedAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} · ${state.predMeta.count} games`
      : "Not loaded yet.";
  }
}
