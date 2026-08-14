// --- Tab switching + full re-render -------------------------------------
// Split out of app/index.html as part of the JS-splitting pass. Covers:
// switchTab() (shows the right panel, re-renders whatever that tab needs
// fresh -- Snapshot/My Picks/Results each have their own re-render on
// entry since they're not kept live-updated while hidden), the mobile
// nav-tabs horizontal-scroll edge-fade hint
// (updateNavTabsScrollHint()/initNavTabsScrollHint()), and syncAll() (the
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
function switchTab(name){
  document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  document.querySelectorAll(".icon-nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("active",p.id==="tab-"+name));
  renderContextBar(); // always visible regardless of tab -- keep it fresh on every switch
  if(name==="snapshot"){ renderSnapshot(); }
  if(name==="picks"){ renderEntries(); renderPicksDetail(); }
  if(name==="record"){ renderRecord(); }
}
// Mobile nav.tabs overflows and scrolls horizontally (see the mobile media
// query) with no native indicator that Settings/Help are off-screen to the
// right -- someone can miss two whole tabs and never know it. Toggles a
// left/right edge fade (see .tabs-wrap::before/::after) based on actual
// scroll position, not just "is it wider than the viewport" -- so the
// fade correctly disappears once you've scrolled all the way to an edge
// instead of hinting at content that isn't there.
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
  renderEntrySelect(); renderBoard(); renderEntries(); renderPicksDetail();
}
