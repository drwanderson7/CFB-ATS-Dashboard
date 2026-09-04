// --- Tab switching + full re-render -------------------------------------
// Split out of app/index.html as part of the JS-splitting pass. Covers:
// switchTab() (shows the right panel, re-renders whatever that tab needs
// fresh -- Snapshot/My Picks/Results each have their own re-render on
// entry since they're not kept live-updated while hidden), the mobile nav
// hamburger dropdown (updateNavHamburgerLabel()/closeNavHamburger()/
// initNavHamburger()) that REPLACED the old horizontal-scroll nav.tabs on
// mobile, the horizontal-scroll edge-fade hint that mechanism used to rely
// on (updateNavTabsScrollHint()/initNavTabsScrollHint() -- now a desktop-
// width fallback only, see its own comment below), and syncAll() (the
// "re-render everything" call used after a bulk data change like an
// import or a cross-device pull, as opposed to switchTab()'s
// current-tab-only re-render).
//
// Loaded as a plain <script src="/app/js/tabs.js"> tag, same as the
// other split files -- an ordinary global scope, not a module. Real
// external references this file makes that are NOT self-contained (all
// resolved lazily inside function bodies, never at top-level, so script
// load order relative to the rest of the page doesn't matter for
// correctness -- same reasoning as the other split files' header
// comments):
//   - `renderContextBar()` -- Context Bar re-render (main inline script).
//   - `renderSnapshot()`/`renderBoard()` -- app/js/board.js.
//   - `renderEntries()`/`renderEntrySelect()`/`renderPicksDetail()` --
//     app/js/picks.js.
//   - `renderRecord()` -- app/js/record.js.
const PICK_BOARD_VIEWS=new Set(["board","picks","pools"]);
let pickBoardView="board";

function pickBoardViewMeta(view){
  if(view==="picks") return {title:"My Picks",sub:"Review each ATS entry's picks, completion status, and weekly submission."};
  if(view==="pools") return {title:"Pool Settings",sub:"Create ATS pools, import weekly sheets, and manage contest setup."};
  return {title:"This Week",sub:"Analyze this week's slate and build your ATS card."};
}
function renderPickBoardShell(topTab){
  const shell=document.getElementById("pickBoardShell");
  if(!shell) return;
  const show=topTab==="pickboard";
  shell.style.display=show?"flex":"none";
  if(!show) return;
  const meta=pickBoardViewMeta(pickBoardView);
  const title=document.getElementById("pickBoardViewTitle");
  const sub=document.getElementById("pickBoardViewSub");
  if(title) title.textContent=meta.title;
  if(sub) sub.textContent=meta.sub;
  shell.querySelectorAll("[data-pickboard-view]").forEach(b=>{
    const active=b.dataset.pickboardView===pickBoardView;
    b.classList.toggle("active",active);
    b.setAttribute("aria-current",active?"page":"false");
  });
}

function renderPickBoardWorkflow(){
  const el=document.getElementById("pickBoardWorkflow");
  if(!el)return;
  if(pickBoardView!=="board"){el.style.display="none";el.innerHTML="";return;}
  const pool=typeof currentPool==="function"?currentPool():null;
  const entry=typeof activeEntry==="function"?activeEntry():null;
  const pickCount=entry&&entry.picks?Object.keys(entry.picks).length:0;
  const limit=typeof pickLimit==="function"?pickLimit():7;
  let title="This week";
  let detail="Use the Overall board for research, or create a pool to track locked contest lines and picks.";
  let action="Open Pool Settings →", target="pools", tone="info";
  if(pool){
    const hasGames=!!(pool.games&&pool.games.length);
    if(!hasGames){
      title=`${pool.name||"Pool"} · weekly sheet needed`;
      detail="Import or enter this week's contest lines before building your card.";
      action="Update weekly sheet →"; target="pools"; tone="warn";
    }else if(!entry){
      title=`${pool.name||"Pool"} · add an entry`;
      detail="Create or select an entry before making picks.";
      action="Manage entries →"; target="picks"; tone="warn";
    }else if(pickCount<limit){
      title=`${pool.name||"Pool"} · ${pickCount}/${limit} picks`;
      detail=pickCount?`Keep building ${entry.name||"this entry"}; your locked pool lines are loaded.`:`${entry.name||"This entry"} is ready for picks against the pool's locked lines.`;
      action=pickCount?"Review My Picks →":"Start with the board below"; target=pickCount?"picks":""; tone="progress";
    }else{
      title=`${pool.name||"Pool"} · card complete`;
      detail=`${entry.name||"Entry"} has all ${limit} required picks. Review the card before the contest locks.`;
      action="Review My Picks →"; target="picks"; tone="ready";
    }
  }
  el.style.display="flex";
  el.className=`pickboard-workflow ${tone}`;
  el.innerHTML=`<span><b>${esc(title)}</b><small>${esc(detail)}</small></span>${target?`<button type="button" class="btn-link-sm" data-pickboard-next="${target}">${esc(action)}</button>`:`<em>${esc(action)}</em>`}`;
  const btn=el.querySelector("[data-pickboard-next]");
  if(btn)btn.onclick=()=>switchPickBoardView(btn.dataset.pickboardNext);
}

function switchPickBoardView(view){
  if(!PICK_BOARD_VIEWS.has(view)) view="board";
  pickBoardView=view;
  switchTab("pickboard");
}
function initPickBoardNav(){
  document.querySelectorAll("[data-pickboard-view]").forEach(b=>{
    b.onclick=()=>switchPickBoardView(b.dataset.pickboardView);
  });
}

function switchTab(name){
  // board/picks/pools remain the internal implementation ids used across
  // the mature ATS codebase, but user-facing navigation now groups them
  // under one top-level Pick Board destination. Keeping these aliases means
  // every existing deep-link/call site (Snapshot -> board, Results -> picks,
  // setup CTA -> pools) lands in the correct Pick Board subview without a
  // risky repo-wide rename.
  if(PICK_BOARD_VIEWS.has(name)){ pickBoardView=name; name="pickboard"; }
  if(name==="pickboard"&&!PICK_BOARD_VIEWS.has(pickBoardView)) pickBoardView="board";
  const panelName=name==="pickboard"?pickBoardView:name;

  document.querySelectorAll("nav.tabs button").forEach(b=>{
    const active=b.dataset.tab===name;
    b.classList.toggle("active",active);
    b.setAttribute("aria-current",active?"page":"false");
  });
  document.querySelectorAll(".icon-nav-btn").forEach(b=>{
    const active=b.dataset.tab===name;
    b.classList.toggle("active",active);
    b.setAttribute("aria-current",active?"page":"false");
  });
  document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("active",p.id==="tab-"+panelName));
  renderPickBoardShell(name);
  renderPickBoardWorkflow();
  updateNavHamburgerLabel(name);
  closeNavHamburger(); // picking any tab (mobile dropdown or desktop icon-nav) closes the mobile menu if it was open
  document.body.classList.toggle("survivor-tab-active",name==="survivor");
  document.body.classList.toggle("pickboard-tab-active",name==="pickboard");

  if(name!=="survivor"){
    renderContextBar();
    renderSetupStatus();
  }else if(typeof renderSurvivorShell==="function"){
    renderSurvivorShell();
  }
  if(name==="confidence"&&typeof renderConfidenceTab==="function"){ renderConfidenceTab(); }
  if(name==="snapshot"){ renderSnapshot(); if(typeof trackBetaSnapshotView==="function") trackBetaSnapshotView(); }
  if(panelName==="picks"){ renderEntries(); renderPicksDetail(); }
  if(name==="record"){ renderRecord(); }
  if(panelName==="pools"){ renderPoolsPage(); }
  if(name==="account"&&typeof renderBetaAdminPanel==="function") renderBetaAdminPanel(false);
  if(typeof trackBetaEvent==="function") trackBetaEvent("tab_view",{tab:name,subview:name==="pickboard"?panelName:null,source:"button"});
}
// Keeps the mobile hamburger trigger's own label ("☰ Snapshot") in sync
// with whichever view is actually active -- checks nav.tabs' 5 main tabs
// first (their visible button text IS the label), then falls back to
// .icon-nav's Account/Settings/Help controls. Those carry a visible desktop
// .icon-nav-label plus a title fallback; mobile hides the label visually but
// leaves it in the DOM, so the same source works at every width. A name
// matching neither (shouldn't happen, but not
// worth throwing over) leaves the label as whatever it last was.
function updateNavHamburgerLabel(name){
  const lbl=document.getElementById("navHamburgerLabel");
  if(!lbl) return;
  const navBtn=document.querySelector(`nav.tabs button[data-tab="${name}"]`);
  if(navBtn){ lbl.textContent=navBtn.textContent; return; }
  const iconBtn=document.querySelector(`.icon-nav-btn[data-tab="${name}"]`);
  if(iconBtn){
    const text=iconBtn.querySelector(".icon-nav-label");
    const label=(text&&text.textContent?text.textContent.trim():"")||iconBtn.title||"";
    if(label) lbl.textContent=label;
  }
}
// Mobile nav hamburger: opens/closes the vertical dropdown version of
// nav.tabs (see the .tabs-wrap.open CSS in the mobile media query) --
// SAME buttons as desktop's horizontal row, just restyled, not a
// duplicated menu that could drift out of sync with the real tab list.
// Open/close/click-outside follows the exact same pattern already
// established twice elsewhere in this app (Context Bar's
// openContextSwitcher()/closeContextSwitcher(), Pools row's
// closeAllPoolMenus()/initPoolMenus()) -- composedPath(), not
// element.contains(e.target), for the same reason documented on both of
// those: a tab click can synchronously re-render its own panel as part of
// handling ITS OWN click, which can detach the originating button from the
// document before this bubble-phase listener runs; composedPath() reports
// the dispatch path captured at the moment the click happened, so a
// since-detached button still correctly shows up as "inside the wrap."
function closeNavHamburger(){
  const wrap=document.getElementById("tabsWrap");
  const btn=document.getElementById("navHamburger");
  if(wrap) wrap.classList.remove("open");
  if(btn) btn.setAttribute("aria-expanded","false");
}
function initNavHamburger(){
  const btn=document.getElementById("navHamburger");
  const wrap=document.getElementById("tabsWrap");
  if(!btn||!wrap) return;
  btn.onclick=()=>{
    const isOpen=wrap.classList.contains("open");
    if(isOpen){ closeNavHamburger(); return; }
    wrap.classList.add("open");
    btn.setAttribute("aria-expanded","true");
  };
  document.addEventListener("click",(e)=>{
    const path=(typeof e.composedPath==="function")?e.composedPath():null;
    const inside=path?path.includes(wrap):wrap.contains(e.target);
    if(!inside) closeNavHamburger();
  });
}
// Edge-fade hint for nav.tabs' horizontal row. This USED to be the whole
// mobile-overflow story (scroll to see more); it's now a desktop-width
// fallback only -- on mobile, nav.tabs is hidden entirely behind the
// hamburger dropdown above (a vertical list has nothing to scroll or
// fade), so this listener simply never has anything to do there. Left
// running rather than conditionally disabled: harmless no-op wherever
// nav.tabs isn't overflowing horizontally (which is every width except a
// rare in-between case this exists to catch -- see its own CSS comment).
function updateNavTabsScrollHint(){
  const nav=document.getElementById("navTabs");
  const wrap=nav&&nav.parentElement;
  if(!nav||!wrap) return;
  const max=nav.scrollWidth-nav.clientWidth;
  wrap.classList.toggle("can-scroll-left", nav.scrollLeft>2);
  wrap.classList.toggle("can-scroll-right", nav.scrollLeft<max-2);
}
function initNavTabsScrollHint(){
  const nav=document.getElementById("navTabs");
  if(!nav) return;
  nav.addEventListener("scroll",updateNavTabsScrollHint,{passive:true});
  window.addEventListener("resize",updateNavTabsScrollHint);
  updateNavTabsScrollHint();
}
function syncAll(){
  renderEntrySelect(); renderBoard(); renderEntries(); renderPicksDetail(); renderPickBoardWorkflow();
  // survivor-sync-refresh: account pulls can update entries/picks too.
  if(document.getElementById("tab-survivor")?.classList.contains("active")&&typeof renderSurvivorShell==="function") renderSurvivorShell();
  if(document.getElementById("tab-confidence")?.classList.contains("active")&&typeof renderConfidenceTab==="function") renderConfidenceTab();
}
