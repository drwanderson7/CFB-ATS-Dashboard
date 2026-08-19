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
function switchTab(name){
  document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  document.querySelectorAll(".icon-nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("active",p.id==="tab-"+name));
  updateNavHamburgerLabel(name);
  closeNavHamburger(); // picking any tab (mobile dropdown or desktop icon-nav) closes the mobile menu if it was open
  renderContextBar(); // always visible regardless of tab -- keep it fresh on every switch
  renderSetupStatus(); // same reasoning -- also shared across tabs, and (like renderContextBar())
  // needs to react to a tab switch itself, not just whatever action happened to trigger it last
  if(name==="snapshot"){ renderSnapshot(); }
  if(name==="picks"){ renderEntries(); renderPicksDetail(); }
  if(name==="record"){ renderRecord(); }
  if(name==="pools"){ renderPoolsPage(); }
}
// Keeps the mobile hamburger trigger's own label ("☰ Snapshot") in sync
// with whichever view is actually active -- checks nav.tabs' 5 main tabs
// first (their visible button text IS the label), then falls back to
// .icon-nav's 3 buttons (Account/Settings/Help -- those buttons only show
// an emoji/symbol as their own text, so their `title` attribute is the
// real label instead). A name matching neither (shouldn't happen, but not
// worth throwing over) leaves the label as whatever it last was.
function updateNavHamburgerLabel(name){
  const lbl=document.getElementById("navHamburgerLabel");
  if(!lbl) return;
  const navBtn=document.querySelector(`nav.tabs button[data-tab="${name}"]`);
  if(navBtn){ lbl.textContent=navBtn.textContent; return; }
  const iconBtn=document.querySelector(`.icon-nav-btn[data-tab="${name}"]`);
  if(iconBtn&&iconBtn.title){ lbl.textContent=iconBtn.title; }
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
  renderEntrySelect(); renderBoard(); renderEntries(); renderPicksDetail();
}
