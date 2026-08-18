// Runtime tests for the Pools tab's logic in app/js/pool-contexts.js:
// poolLockStatusLabel() (pure), poolRowHTML() (pure string-building), and
// the state-mutating archivePool()/unarchivePool()/deletePoolById()/
// createEmptyPool(). Run with:
//
//     node tests/test_pools_page_logic.mjs
//
// Extracts the ACTUAL functions from app/js/pool-contexts.js, not a
// hand-copied reimplementation that could silently drift, per this
// project's established pattern (see test_context_bar_logic.mjs).
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/js/pool-contexts.js", import.meta.url), "utf8");

function extractFunction(name, source) {
  const startMarker = `function ${name}(`;
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find function ${name}()`);
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

// --- poolLockStatusLabel(): pure, no stubs needed -------------------------
{
  const code = extractFunction("poolLockStatusLabel", src);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  check("poolLockStatusLabel: no games -> 'no games imported yet'",
    ctx.poolLockStatusLabel({ games: [] }) === "no games imported yet");
  check("poolLockStatusLabel: missing games array entirely -> same as empty, doesn't throw",
    ctx.poolLockStatusLabel({}) === "no games imported yet");
  check("poolLockStatusLabel: all games have a line -> 'lines locked'",
    ctx.poolLockStatusLabel({ games: [{ line: -3 }, { line: 1.5 }] }) === "lines locked");
  check("poolLockStatusLabel: no games have a line -> 'lines provisional'",
    ctx.poolLockStatusLabel({ games: [{ line: null }, { line: null }] }) === "lines provisional");
  check("poolLockStatusLabel: a genuine mix -> exact fraction, not rounded to all-or-nothing",
    ctx.poolLockStatusLabel({ games: [{ line: -3 }, { line: null }, { line: null }] }) === "1/3 lines locked");
}

// --- poolRowHTML(): pure string-building ----------------------------------
{
  const code = extractFunction("poolRowHTML", src) + "\n"
    + extractFunction("poolLockStatusLabel", src) + "\n"
    + "function esc(s){ return String(s==null?'':s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c])); }";
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  const activePool = { id: "p1", name: "My Pool", weekLabel: "Week 3", pickLimit: 7,
    games: [{ line: -3 }], entries: [{ id: "e1" }] };
  const activeHTML = ctx.poolRowHTML(activePool, false);
  check("poolRowHTML (active): shows an 'archive' action",
    activeHTML.includes("data-archive=\"p1\""));
  check("poolRowHTML (active): shows a plain 'delete' action, not 'delete permanently'",
    activeHTML.includes("data-delete=\"p1\"") && !activeHTML.includes("delete permanently"));
  check("poolRowHTML (active): does NOT show an 'unarchive' action",
    !activeHTML.includes("data-unarchive"));
  check("poolRowHTML (active): shows a per-pool import-sheet file input",
    activeHTML.includes(`data-import="p1"`));
  check("poolRowHTML: escapes the pool name (no raw HTML injection from a pool named with a tag)",
    ctx.poolRowHTML({ id:"x", name:"<script>bad</script>", games:[], entries:[] }, false).includes("&lt;script&gt;"));

  // "paste picks" only works for ESPN's plain-text export shape (see the
  // comment above poolRowHTML() in pool-contexts.js) -- a real bug this
  // pins down: the button used to show unconditionally on every pool row,
  // including Splash pools it can never work for.
  const espnPool = { id: "p3", name: "ESPN pool", source: "espn", weekLabel: "", pickLimit: 10, games: [], entries: [] };
  const splashPool = { id: "p4", name: "Splash pool", source: "splash", weekLabel: "", pickLimit: 7, games: [], entries: [] };
  const freshPool = { id: "p5", name: "Fresh pool", source: "manual", weekLabel: "", pickLimit: 7, games: [], entries: [] };
  check("poolRowHTML: an ESPN-sourced pool shows the 'paste picks' action",
    ctx.poolRowHTML(espnPool, false).includes(`data-pastetoggle="p3"`));
  check("poolRowHTML: a Splash-sourced pool does NOT show 'paste picks' (known format mismatch)",
    !ctx.poolRowHTML(splashPool, false).includes("data-pastetoggle"));
  check("poolRowHTML: a Splash-sourced pool does NOT render the paste textarea box either",
    !ctx.poolRowHTML(splashPool, false).includes("poolPasteBox_p4"));
  check("poolRowHTML: a brand-new pool with no determined source yet ('manual') STILL shows 'paste picks' — otherwise it would be unreachable, since nothing else ever sets source to 'espn' first",
    ctx.poolRowHTML(freshPool, false).includes(`data-pastetoggle="p5"`));
  check("poolRowHTML (archived): does NOT show 'paste picks' either way (archived pools aren't actively managed)",
    !ctx.poolRowHTML(espnPool, true).includes("data-pastetoggle"));

  // Tiered dropdown structure: "view" + "Import ▾" always visible; the
  // rare/admin/destructive actions (edit pick limit, share, archive,
  // delete) collapse into a "⋮ More" dropdown, matched to its trigger by a
  // shared id (poolMenu_<id>_more / data-pooltrigger="<id>_more").
  check("poolRowHTML (active): 'view' stays a plain always-visible action, not inside a dropdown",
    activeHTML.includes(`data-view="p1"`) && !/pool-menu-dropdown[^>]*>[\s\S]*data-view="p1"/.test(activeHTML));
  check("poolRowHTML (active): has an Import trigger wired to a matching dropdown id",
    activeHTML.includes(`data-pooltrigger="p1_import"`) && activeHTML.includes(`id="poolMenu_p1_import"`));
  check("poolRowHTML (active): has a More trigger wired to a matching dropdown id",
    activeHTML.includes(`data-pooltrigger="p1_more"`) && activeHTML.includes(`id="poolMenu_p1_more"`));
  check("poolRowHTML (active): edit pick limit/share/archive/delete all live inside the More dropdown (between its open and close tags)",
    (() => {
      const start = activeHTML.indexOf(`id="poolMenu_p1_more"`);
      const afterStart = activeHTML.slice(start);
      const end = afterStart.indexOf("</div>", afterStart.indexOf(">"));
      const moreMenuHTML = afterStart.slice(0, end);
      return ["data-editlimit=\"p1\"", "data-share=\"p1\"", "data-archive=\"p1\"", "data-delete=\"p1\""]
        .every(attr => moreMenuHTML.includes(attr));
    })());
  check("poolRowHTML (active): delete carries the 'danger' styling class inside the More menu",
    /class="pool-menu-item danger"[^>]*data-delete="p1"/.test(activeHTML));
  check("poolRowHTML (archived): does NOT render any Import/More dropdown triggers (still flat unarchive/delete)",
    !ctx.poolRowHTML(activePool, true).includes("data-pooltrigger"));

  const archivedHTML = ctx.poolRowHTML(activePool, true);
  check("poolRowHTML (archived): shows 'unarchive' and 'delete permanently', NOT 'archive'",
    archivedHTML.includes("data-unarchive=\"p1\"") && archivedHTML.includes("delete permanently") && !archivedHTML.includes("data-archive="));
  check("poolRowHTML (archived): does NOT offer an import-sheet control (archived pools aren't actively managed)",
    !archivedHTML.includes("data-import"));

  const emptyPool = { id: "p2", name: "Empty", weekLabel: "", pickLimit: 5, games: [], entries: [] };
  check("poolRowHTML: an empty pool's status reads 'no games imported yet', not a crash on 0/0",
    ctx.poolRowHTML(emptyPool, false).includes("no games imported yet"));
  check("poolRowHTML: correct entry-count pluralization (0 entries)",
    ctx.poolRowHTML(emptyPool, false).includes("0 entries"));
  check("poolRowHTML: correct entry-count pluralization (1 entry, not 1 entries)",
    ctx.poolRowHTML(activePool, false).includes("1 entry") && !ctx.poolRowHTML(activePool, false).includes("1 entries"));

  check("poolRowHTML (active): shows an 'edit pick limit' action",
    activeHTML.includes(`data-editlimit="p1"`));
  check("poolRowHTML (active): shows a 'share for testing' action",
    activeHTML.includes(`data-share="p1"`));
  check("poolRowHTML (archived): does NOT show edit-limit or share actions (not actively managed)",
    !archivedHTML.includes("data-editlimit") && !archivedHTML.includes("data-share"));

  const poolNoHistory = { id: "p3", name: "No History", weekLabel: "Week 1", pickLimit: 7, games: [], entries: [], history: [] };
  check("poolRowHTML: a pool with no week history shows no history section at all (not an empty '(0)')",
    !ctx.poolRowHTML(poolNoHistory, false).includes("Week history"));

  const poolWithHistory = { id: "p4", name: "Has History", weekLabel: "Week 5", pickLimit: 7, games: [], entries: [],
    history: [
      { id: "h1", label: "Week 3", closedAt: "2026-09-15T12:00:00Z", entries: [{ entryId: "e1" }, { entryId: "e2" }] },
      { id: "h2", label: "Week 4", closedAt: null, entries: [] },
    ] };
  const historyHTML = ctx.poolRowHTML(poolWithHistory, false);
  check("poolRowHTML: a pool WITH history shows the count in the summary",
    historyHTML.includes("Week history (2)"));
  check("poolRowHTML: each history week's label appears",
    historyHTML.includes("Week 3") && historyHTML.includes("Week 4"));
  check("poolRowHTML: a history week with no closedAt doesn't crash or show 'closed null'",
    !historyHTML.includes("closed null") && !historyHTML.includes("Invalid Date"));
  check("poolRowHTML: history entry count is shown per week (2 entries for Week 3)",
    historyHTML.includes("2 entries"));
  check("poolRowHTML: offers a 'View in Results' handoff rather than re-implementing restore/grading here",
    historyHTML.includes(`data-viewresults="p4"`));
  check("poolRowHTML: archived pools never show a history section (not actively managed)",
    !ctx.poolRowHTML(poolWithHistory, true).includes("Week history"));
}

// --- editPoolPickLimit(): state mutation ----------------------------------
{
  const code = extractFunction("editPoolPickLimit", src);

  function makeCtx(pools, promptReturns, alertCalls) {
    const ctx = {
      state: { pools },
      prompt: () => promptReturns,
      alert: (msg) => alertCalls.push(msg),
      save: () => {},
      renderContextAll: () => {},
      renderPoolsPage: () => {},
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return ctx;
  }

  {
    const pools = [{ id: "p1", name: "A", pickLimit: 7 }];
    const ctx = makeCtx(pools, "10", []);
    ctx.editPoolPickLimit("p1");
    check("editPoolPickLimit: a valid new limit is actually applied",
      ctx.state.pools[0].pickLimit === 10);
  }
  {
    const pools = [{ id: "p1", name: "A", pickLimit: 7 }];
    const alerts = [];
    const ctx = makeCtx(pools, "0", alerts);
    ctx.editPoolPickLimit("p1");
    check("editPoolPickLimit: an invalid limit (0) is rejected, original value untouched",
      ctx.state.pools[0].pickLimit === 7 && alerts.length === 1);
  }
  {
    const pools = [{ id: "p1", name: "A", pickLimit: 7 }];
    const alerts = [];
    const ctx = makeCtx(pools, "not a number", alerts);
    ctx.editPoolPickLimit("p1");
    check("editPoolPickLimit: non-numeric input is rejected, original value untouched",
      ctx.state.pools[0].pickLimit === 7 && alerts.length === 1);
  }
  {
    const pools = [{ id: "p1", name: "A", pickLimit: 7 }];
    const ctx = makeCtx(pools, null, []); // user cancels the prompt
    ctx.editPoolPickLimit("p1");
    check("editPoolPickLimit: cancelling the prompt leaves the limit untouched",
      ctx.state.pools[0].pickLimit === 7);
  }
  {
    const ctx = makeCtx([{ id: "p1", name: "A", pickLimit: 7 }], "10", []);
    ctx.editPoolPickLimit("nonexistent");
    check("editPoolPickLimit: an unknown pool id is a safe no-op, doesn't throw",
      ctx.state.pools[0].pickLimit === 7);
  }
}

// --- archivePool()/unarchivePool()/deletePoolById(): state mutation ------
{
  const code = extractFunction("archivePool", src) + "\n"
    + extractFunction("unarchivePool", src) + "\n"
    + extractFunction("deletePoolById", src);

  function makeCtx(pools, activeContext, confirmReturns = true) {
    const doc = {
      getElementById: () => ({ style: {}, textContent: "" }),
    };
    const ctx = {
      state: { pools, activeContext },
      document: doc,
      confirm: () => confirmReturns,
      save: () => {},
      renderContextAll: () => {},
      renderPoolsPage: () => {},
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return ctx;
  }

  // archivePool
  {
    const pools = [{ id: "p1", name: "A" }, { id: "p2", name: "B" }];
    const ctx = makeCtx(pools, "p1");
    ctx.archivePool("p1");
    check("archivePool: sets archived=true on the target pool",
      ctx.state.pools.find(p => p.id === "p1").archived === true);
    check("archivePool: does NOT touch other pools",
      !ctx.state.pools.find(p => p.id === "p2").archived);
    check("archivePool: if the archived pool was the active context, falls back to overall",
      ctx.state.activeContext === "overall");
  }
  {
    const pools = [{ id: "p1", name: "A" }];
    const ctx = makeCtx(pools, "overall"); // not the active one
    ctx.archivePool("p1");
    check("archivePool: does NOT change activeContext if the archived pool wasn't active",
      ctx.state.activeContext === "overall");
  }
  {
    const ctx = makeCtx([{ id: "p1", name: "A" }], "overall");
    ctx.archivePool("nonexistent");
    check("archivePool: an unknown pool id is a safe no-op, doesn't throw",
      ctx.state.pools.length === 1 && !ctx.state.pools[0].archived);
  }

  // unarchivePool
  {
    const pools = [{ id: "p1", name: "A", archived: true }];
    const ctx = makeCtx(pools, "overall");
    ctx.unarchivePool("p1");
    check("unarchivePool: removes the archived flag entirely (not just sets it false)",
      !("archived" in ctx.state.pools[0]));
  }

  // deletePoolById
  {
    const pools = [{ id: "p1", name: "A" }, { id: "p2", name: "B" }];
    const ctx = makeCtx(pools, "p1", true); // confirm() -> true
    ctx.deletePoolById("p1");
    check("deletePoolById: with confirm accepted, the pool is actually removed from state.pools",
      ctx.state.pools.length === 1 && ctx.state.pools[0].id === "p2");
    check("deletePoolById: if the deleted pool was active, falls back to overall",
      ctx.state.activeContext === "overall");
  }
  {
    const pools = [{ id: "p1", name: "A" }];
    const ctx = makeCtx(pools, "overall", false); // confirm() -> false (user cancels)
    ctx.deletePoolById("p1");
    check("deletePoolById: if confirm() is declined, the pool is NOT removed",
      ctx.state.pools.length === 1);
  }
  {
    const ctx = makeCtx([{ id: "p1", name: "A" }], "overall", true);
    ctx.deletePoolById("nonexistent");
    check("deletePoolById: an unknown pool id is a safe no-op, doesn't throw",
      ctx.state.pools.length === 1);
  }
}

// --- Top-level "Import a pool sheet" card (Pools tab) ---------------------
// Structural checks, not full execution: importPool()/importPoolFromText()'s
// real behavior (parsing, pool creation/merge) is already covered by
// test_pool_parsing.py + this file's poolRowHTML checks above, and fully
// mocking the async chain here (pdf.js, apiFetch, applyParsedPoolData) for
// marginal extra coverage isn't worth the scaffolding. What IS worth
// pinning down: the wiring itself isn't silently broken -- the HTML ids
// actually exist, init.js actually wires them up (and to a NEW pool, not
// accidentally reusing some stale target), and pool-contexts.js's functions
// actually accept and use the statusElId parameter this wiring depends on.
// Same "would a renamed/removed id silently break this" reasoning as
// test_script_paths.mjs elsewhere in this suite.
{
  const htmlSrc = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
  const initSrc = fs.readFileSync(new URL("../app/js/init.js", import.meta.url), "utf8");

  const requiredIds = ["poolsTopImportFile", "poolsTopPasteText", "poolsTopPasteBtn", "poolsTopImportStatus"];
  for (const id of requiredIds) {
    check(`app/index.html defines #${id} (top-level import card)`,
      htmlSrc.includes(`id="${id}"`));
    check(`app/js/init.js references #${id} (wiring isn't orphaned)`,
      initSrc.includes(id));
  }

  check("init.js wires the top-level PDF input to importPool() with targetPoolId=null (creates a NEW pool, doesn't silently target an existing one)",
    /importPool\(\s*f\s*,\s*null\s*,\s*["']poolsTopImportStatus["']\s*\)/.test(initSrc));
  check("init.js wires the top-level paste button to importPoolFromText() with targetPoolId=null and the top-level status id",
    /importPoolFromText\(\s*text\s*,\s*null\s*,\s*["']poolsTopImportStatus["']\s*\)/.test(initSrc));

  check("pool-contexts.js's importPool() accepts a statusElId param and defaults to \"poolStatus\" when omitted",
    /async function importPool\(file,\s*targetPoolId,\s*statusElId\)\{[\s\S]{0,120}getElementById\(statusElId\|\|"poolStatus"\)/.test(src));
  check("pool-contexts.js's importPoolFromText() accepts a statusElId param and defaults to \"poolStatus\" when omitted",
    /async function importPoolFromText\(text,\s*targetPoolId,\s*statusElId\)\{[\s\S]{0,120}getElementById\(statusElId\|\|"poolStatus"\)/.test(src));

  // The per-pool-row callers (existing behavior) must keep working
  // unchanged -- they call these two functions with only 2 args, relying
  // on the "poolStatus" default rather than passing a 3rd arg explicitly.
  check("existing per-pool-row import-sheet wiring still calls importPool() with exactly 2 args (unchanged default behavior)",
    /importPool\(f,\s*inp\.dataset\.import\)/.test(src));
  check("existing per-pool-row paste wiring still calls importPoolFromText() with exactly 2 args (unchanged default behavior)",
    /importPoolFromText\(text,\s*id\)/.test(src));
}

// --- Pool-row "Import ▾" / "⋮ More" dropdown wiring -----------------------
// Same "structural, not full DOM execution" reasoning as the section above:
// closeAllPoolMenus()/initPoolMenus() actually toggling .open in a real
// browser is exercised by manual/Playwright verification, not a jsdom-free
// vm context here. What's worth pinning down at this level: the functions
// exist with the right shape, initPoolMenus() is actually called once at
// startup (an unwired function is as broken as a missing one), and it uses
// composedPath() rather than a plain .contains() check -- the SAME bug
// class initContextBar()'s own comment documents fixing for the Context
// Bar dropdown (a click on a menu item can detach the trigger from the DOM,
// via renderPoolsPage(), before a .contains()-based check would run).
{
  const initSrc = fs.readFileSync(new URL("../app/js/init.js", import.meta.url), "utf8");

  check("pool-contexts.js defines closeAllPoolMenus()",
    /function closeAllPoolMenus\(\)/.test(src));
  check("closeAllPoolMenus() removes the 'open' class from every open pool-menu dropdown",
    /closeAllPoolMenus\(\)\{[\s\S]{0,200}querySelectorAll\(["']\.pool-menu-dropdown\.open["']\)[\s\S]{0,80}classList\.remove\(["']open["']\)/.test(src));
  check("pool-contexts.js defines initPoolMenus()",
    /function initPoolMenus\(\)/.test(src));
  check("initPoolMenus() uses composedPath(), not a plain .contains() check (same DOM-detach bug class as the Context Bar's own dropdown)",
    /function initPoolMenus\(\)\{[\s\S]{0,400}composedPath/.test(src));
  check("init.js actually calls initPoolMenus() once at startup, not just referenced in a comment (an unwired function is as broken as a missing one)",
    initSrc.split("\n").some(line => /\binitPoolMenus\(\)/.test(line) && !line.trim().startsWith("//")));
  check("wirePoolRowActions() wires [data-pooltrigger] to toggle its matching dropdown by id (poolMenu_<key>)",
    /data-pooltrigger[^)]*\)\.forEach\(b=>b\.onclick=\(\)=>\{[\s\S]{0,120}getElementById\(["']poolMenu_["']\+b\.dataset\.pooltrigger\)/.test(src));
}

console.log(failures.length ? `\n${failures.length} of ${total} checks FAILED:` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);