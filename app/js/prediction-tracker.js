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
function adoptPredictionsResponseLocally(data){
  if(!data||!Array.isArray(data.games)) return false;
  state.predictions=data.games;
  state.predMeta={fetchedAt:data.fetchedAt||new Date().toISOString(),count:data.count!=null?data.count:data.games.length};
  return true;
}

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
    if(!result.ok){
      const msg=result.kind==="rate_limit"?"Loaded too recently — the shared predictions are already current, try again in a bit.":result.error;
      throw new Error(msg);
    }
    const data=result.body;
    if(!Array.isArray(data.games)||!data.games.length) throw new Error(data.message||'No prediction rows returned');
    // api/fetch_predictions.py already wrote predictions/predMeta into the
    // shared bucket itself -- adopt that persisted copy rather than
    // building/pushing our own (a generic shared POST is rejected now, see
    // api/state.py).
    const sharedPulled=await pullTier("shared",true);
    // Same resilience rule as odds: if the upstream fetch succeeded but the
    // shared cache write (or our follow-up shared-state read) did not, use
    // the fresh endpoint response locally instead of silently reverting to
    // stale shared data. sharedUpdatedAt intentionally remains untouched.
    if(data.sharedPersisted===false || !sharedPulled || !Array.isArray(state.predictions) || !state.predMeta || state.predMeta.fetchedAt!==data.fetchedAt){
      adoptPredictionsResponseLocally(data);
    }
    const matched=applyPredictions();
    renderBoard(); renderSystemsSettings();
    // Real reliability gap fix: the server can now legitimately return 200
    // with real (if stale) data even when the LIVE upstream fetch failed
    // (api/fetch_predictions.py's stale-if-error fallback) or when it
    // detected a real data-quality problem worth a manual look (schema-
    // drift `warnings`, e.g. a sharp game-count drop or a core system
    // vanishing). Neither of those is the normal green "all good" case,
    // but neither is a hard failure either -- surfaced as amber, distinct
    // from both.
    if(st){
      const unm=lastPredUnmatched.length;
      const pgOn=(typeof isPickGaugeModelActive==="function")&&isPickGaugeModelActive();
      const noneOn=!pgOn&&state.enabledSystems.length===0;
      const hasWarnings=Array.isArray(data.warnings)&&data.warnings.length>0;
      if(data.usingStaleFallback){
        st.style.color='var(--amber)';
        st.textContent=`${data.message||'Using last successful predictions (source unavailable).'} · ${matched} matched to board`;
        console.warn('[predictions] stale fallback served:',data.message);
      }else{
        st.style.color=matched>0?(hasWarnings?'var(--amber)':'var(--green-text)'):'var(--amber)';
        st.textContent=`loaded ${data.count} games · ${matched} matched to board`
          +(unm?` · ${unm} unmatched (see console)`:'')
          +(hasWarnings?` · ${data.warnings.length} data-quality warning${data.warnings.length===1?'':'s'} (see console)`:'')
          +(noneOn?' · open ⚙ Prediction systems to enable & show columns':'');
      }
      if(hasWarnings) data.warnings.forEach(w=>console.warn('[predictions] data-quality warning:',w));
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
// One-click PickGauge Model # mode. Enabling it clears the currently selected
// custom/comparison systems so the board immediately presents one standalone
// PickGauge Model # column. The five internal recipe models are NOT written to
// enabledSystems, so they never appear as columns merely because PickGauge is
// on. Afterward, a user may manually enable any individual system below as a
// separate comparison column without changing the PickGauge calculation.
function applyPickGaugeModelPreset(){
  const turningOn=!isPickGaugeModelActive();
  state.pickGaugeModelEnabled=turningOn;
  if(turningOn) state.enabledSystems=[];
  save();
  renderSystemsSettings();
  renderBoard();
  updateSystemsCount();
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
// Ephemeral UI state, same pattern as boardExpandedKeys/
// recordExpandedBoxScores elsewhere this session -- NOT saved/synced,
// resets on reload. Whether the Prediction Systems checklist is currently
// showing everything ingestible (44 systems) or just Drew's curated
// FEATURED_SYSTEM_CODES subset (20).
let systemsShowAll=false;
function renderSystemsSettings(){
  const pgActive=(typeof isPickGaugeModelActive==="function")&&isPickGaugeModelActive();
  // PickGauge Model # is a standalone proprietary blend. While it is active,
  // custom numeric weights are irrelevant to the displayed PickGauge number,
  // so keep them hidden. Individually toggled systems below remain available
  // as comparison columns only; the five internal recipe inputs are not
  // auto-enabled in this checklist.
  const coreWeights=document.getElementById('coreWeights');
  if(coreWeights) coreWeights.style.display=pgActive?"none":"";
  if(!pgActive){
    document.querySelectorAll('.core-weights .weight-inp').forEach(el=>{ el.value=weightOf(el.dataset.w); bindWeightInput(el); });
  }
  const pgBtn=document.getElementById("pickGaugeModelBtn");
  if(pgBtn){
    pgBtn.classList.toggle("active",pgActive);
    pgBtn.setAttribute("aria-pressed",pgActive?"true":"false");
    pgBtn.title=pgActive
      ?"PickGauge Model # active — proprietary blend of five selected prediction models plus the current Vegas line."
      :"Apply PickGauge Model # — proprietary blend of five selected prediction models plus the current Vegas line.";
  }
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
  // By default, only Drew's own curated subset shows as a checkbox (see
  // FEATURED_SYSTEM_CODES, app/data/pred-systems.js) -- everything else
  // still gets ingested/still counts toward Model # if it's already
  // enabled, it's just not offered as something new to turn on unless
  // "Show all" is toggled. The `enabled.has(s.code)` escape hatch is
  // deliberate: a system enabled from BEFORE this change (or one only
  // present because the real sheet has it) must never become an
  // invisible-but-active toggle with no visible checkbox to turn it back
  // off -- that would be far more confusing than just showing one extra
  // row.
  const featuredSet=(typeof FEATURED_SYSTEM_CODES!=="undefined")?FEATURED_SYSTEM_CODES:null;
  const visibleAll=all.filter(s=>!featuredSet||featuredSet.has(s.code)||enabled.has(s.code)||systemsShowAll);
  const hiddenCount=all.length-visibleAll.length;
  const core=[
    {code:"bp",name:"BP (Brad Powers line)"},
    // Import Powers PDF lives HERE now -- as its own grid cell immediately
    // after BP's checklist item, not a separate button up in the
    // core-weights box (see app/index.html's INPUT WEIGHTS box, which no
    // longer has it). Handled as a special-cased non-checkbox item in the
    // .map() below rather than a real system, since it isn't one.
    {code:"__import_pdf__"},
    {code:"comp",name:"Comp (computer line)"},
  ];
  wrap.innerHTML=[...core,...visibleAll].map(s=>{
    if(s.code==="__import_pdf__"){
      return `<div class="sys-item sys-item-action">
        <label class="btn btn-secondary" id="pdfImportLabel" style="cursor:pointer;padding:4px 9px;font-size:12.5px;">⬆ Import Powers PDF<input type="file" id="pdfFile" accept="application/pdf" style="display:none;"></label>
        <span id="pdfStatus" class="mono-sm"></span>
      </div>`;
    }
    const on=enabled.has(s.code);
    const isCore=s.code==="bp"||s.code==="comp";
    const idx=s.code==="bp"?0:1;
    const has=isCore?games.some(g=>{const v=inputsFor(g.key)[idx]; return v!=null&&v!=="";}):present.has(s.code);
    const dim=(!has&&(isCore||state.predictions))?'opacity:.5;':'';
    const badge=has?'<span class="sys-live">●</span>':(isCore?'<span class="sys-off">no PDF data</span>':(state.predictions?'<span class="sys-off">no data</span>':''));
    // Custom Model # exposes editable weights. While standalone PickGauge
    // Model # is active, any checked systems are comparison columns only, so
    // numeric custom weights stay hidden until PickGauge mode is turned off.
    const wbox=(on&&!pgActive)?`<input type="number" class="weight-inp sys-weight" data-w="${esc(s.code)}" step="0.5" min="0" inputmode="decimal" title="weight for ${esc(s.name)}" value="${weightOf(s.code)}">`:'';
    const top=TOP_SYSTEM_RANKS[s.code];
    const topDetail=top
      ?(top.composite==null
        ?`#${top.rank} of ~40 in your 2-year backtest (40% ATS% / 30% MAE / 30% |Bias|; composite score not retained in the source handoff)`
        :`#${top.rank} of ~40 in your 2-year backtest (composite ${top.composite}, lower=better; 40% ATS% / 30% MAE / 30% |Bias|)`)
      :"";
    const star=top?`<span class="sys-top" title="Top 10 performer -- ${topDetail}">★ Top 10</span>`:'';
    return `<div class="sys-item" style="${dim}">
      <label class="sys-check"><input type="checkbox" data-sys="${esc(s.code)}" ${on?'checked':''}>${star}<span class="sys-name">${esc(s.name)}</span></label>
      <span class="sys-right">${wbox}${badge}</span>
    </div>`;
  }).join("")
  // Spans the grid's full width (systems-grid uses auto-fill columns, so
  // grid-column:1/-1 reaches across whatever the current column count
  // happens to be, same technique already used for this grid's own
  // empty-state rows) rather than becoming just another cell alongside
  // the checkboxes it's controlling visibility of.
  + `<button class="sys-showall-toggle" data-sys-showall-toggle="1" style="grid-column:1/-1;">${systemsShowAll?"▴ Show only the curated systems":`▾ Show all ${all.length} available systems${hiddenCount?` (${hiddenCount} more)`:''}`}</button>`;
  wrap.querySelectorAll("[data-sys]").forEach(cb=>cb.onchange=()=>{
    const code=cb.dataset.sys;
    const set=new Set(state.enabledSystems);
    if(cb.checked) set.add(code); else set.delete(code);
    state.enabledSystems=[...set];
    save(); renderSystemsSettings(); renderBoard(); updateSystemsCount();
  });
  const showAllBtn=wrap.querySelector("[data-sys-showall-toggle]");
  if(showAllBtn) showAllBtn.onclick=()=>{ systemsShowAll=!systemsShowAll; renderSystemsSettings(); };
  wrap.querySelectorAll(".sys-weight").forEach(bindWeightInput);
  // #pdfFile now lives INSIDE this grid (see the __import_pdf__ cell above),
  // so it -- and its onchange handler -- gets destroyed and recreated on
  // every single call to this function (every checkbox toggle, weight
  // change, predictions load). Re-bind every time, same reasoning as the
  // [data-sys]/.sys-weight rebinds just above: a stale handler on an
  // orphaned old element is as good as no handler at all. This replaces
  // the ONE-TIME binding init.js used to do (removed there -- that ran
  // before this function's first-ever call within init(), so #pdfFile
  // didn't exist in the DOM yet at that point once the static markup
  // moved here, and would have thrown).
  const pdfFileEl=document.getElementById("pdfFile");
  if(pdfFileEl) pdfFileEl.onchange=e=>{ if(e.target.files[0]){ importPowers(e.target.files[0]); e.target.value=""; } };
  updateSystemsCount();
}
function updateSystemsCount(){
  const el=document.getElementById("systemsCount");
  if(el){
    const n=state.enabledSystems.length;
    el.textContent=isPickGaugeModelActive()
      ?(`PickGauge Model #${n?` + ${n} comparison${n===1?"":"s"}`:""}`)
      :(n+" on");
  }
  const meta=document.getElementById("predMetaLine");
  if(meta){
    meta.textContent=state.predMeta&&state.predMeta.fetchedAt
      ? `Last loaded ${new Date(state.predMeta.fetchedAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} · ${state.predMeta.count} games`
      : "Not loaded yet.";
  }
}
