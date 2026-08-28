// Runtime tests for "Select games manually" -- the feature that lets a
// pool with no supported-site parser (not Splash/ESPN/OFP -- a pool on
// some other site, a paper sheet, a group text) still get a real game
// list: pick games straight from the already-loaded live odds slate and
// set the pool's own locked spread by hand, plus a free-text fallback for
// a game the live feed doesn't track at all.
//
// Extracts the ACTUAL functions from app/js/pool-contexts.js and executes
// them in Node with targeted (not generic) DOM fakes -- built to match
// exactly the selector patterns this code actually calls, same pragmatic
// approach as test_backup_restore_logic.mjs/test_delete_account_data_logic.mjs
// rather than a full CSS-selector engine this project doesn't otherwise need.
//
// Run with:
//     node tests/test_pool_manual_games_logic.mjs
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/js/pool-contexts.js", import.meta.url), "utf8");

function extractFunction(name, source) {
  const asyncMarker = `async function ${name}(`;
  const plainMarker = `function ${name}(`;
  let start = source.indexOf(asyncMarker);
  if (start === -1) {
    start = source.indexOf(plainMarker);
    if (start === -1) throw new Error(`Could not find function ${name}()`);
  }
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

// --- poolManualGamesForWeek(): pure filter/sort, tested directly ---------
{
  const code = extractFunction("poolManualGamesForWeek", src)
    + "\nfunction windowForWeek(idx){ const from=idx*1000; return {from, to:from+1000, idx}; }"
    + "\nfunction inWeek(commence,win){ if(!win) return true; if(!commence) return false; const t=Date.parse(commence); return !isNaN(t)&&t>=win.from&&t<win.to; }";
  const ctx = {
    state: { lastGames: [
      { away: "B", home: "Y", commence: new Date(1500).toISOString() }, // week 1, later kickoff
      { away: "A", home: "X", commence: new Date(1000).toISOString() }, // week 1, earlier kickoff
      { away: "C", home: "Z", commence: new Date(2500).toISOString() }, // week 2
    ] },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const wk1 = ctx.poolManualGamesForWeek(1);
  check("poolManualGamesForWeek(): only returns games whose kickoff falls in the requested week's window",
    wk1.length === 2 && wk1.every(g => g.away === "A" || g.away === "B"));
  check("poolManualGamesForWeek(): sorted by kickoff time, earliest first (not left in state.lastGames' original order)",
    wk1[0].away === "A" && wk1[1].away === "B");
  const wk2 = ctx.poolManualGamesForWeek(2);
  check("poolManualGamesForWeek(): a different week returns a different, correctly-filtered set",
    wk2.length === 1 && wk2[0].away === "C");
  const wkEmpty = ctx.poolManualGamesForWeek(99);
  check("poolManualGamesForWeek(): an empty week (nothing loaded) returns [], not a throw",
    Array.isArray(wkEmpty) && wkEmpty.length === 0);
}

// --- wirePoolManualBox()'s save handler: the real behavior to protect ----
// Targeted fake DOM: a "box" element whose querySelector/querySelectorAll
// are hand-implemented for exactly the handful of selector shapes this
// code actually uses (data-manual-check:checked, data-manual-line-for,
// data-manual-save/cancel/week-prev/week-next/add-custom/remove-custom) --
// not a generic engine, matching this project's existing pragmatic mocking
// style for DOM-dependent logic.
function makeFakeCheckbox(key, away, home, commence, checked) {
  return { dataset: { manualCheck: key, manualAway: away, manualHome: home, manualCommence: commence || "" }, checked };
}
function makeFakeBox(checkboxes, lineInputs) {
  const controls = {}; // selector-key -> fake element with a settable onclick
  const box = {
    _checkboxes: checkboxes,
    _lineInputs: lineInputs,
    style: {},
    querySelectorAll(sel) {
      if (sel === "[data-manual-check]:checked") return this._checkboxes.filter(cb => cb.checked);
      if (sel === "[data-manual-remove-custom]") return controls.removeCustomButtons || [];
      return [];
    },
    querySelector(sel) {
      const lineMatch = sel.match(/data-manual-line-for="([^"]+)"/);
      if (lineMatch) return this._lineInputs[lineMatch[1]] || null;
      if (sel.includes("data-manual-save")) return controls.save || (controls.save = {});
      if (sel.includes("data-manual-cancel")) return controls.cancel || (controls.cancel = {});
      if (sel.includes("data-manual-week-prev")) return controls.weekPrev || (controls.weekPrev = {});
      if (sel.includes("data-manual-week-next")) return controls.weekNext || (controls.weekNext = {});
      if (sel.includes("data-manual-add-custom")) return controls.addCustom || (controls.addCustom = {});
      return null;
    },
    _controls: controls,
  };
  return box;
}

function makeCtx({ checkboxes = [], lineInputs = {}, customGames = [], customAwayVal = "", customHomeVal = "", customLineVal = "" } = {}) {
  const box = makeFakeBox(checkboxes, lineInputs);
  const elements = {
    poolManualCustomAway_p1: { value: customAwayVal },
    poolManualCustomHome_p1: { value: customHomeVal },
    poolManualCustomLine_p1: { value: customLineVal },
    poolStatus: { className: "", textContent: "" },
  };
  const applyCalls = [];
  const alertCalls = [];
  const ctx = {
    document: {
      getElementById: (id) => (id === "poolManualBox_p1" ? box : (elements[id] || null)),
    },
    CSS: { escape: (s) => String(s) }, // no-op stub -- this test isn't validating CSS.escape() itself (a browser builtin), just that the real code round-trips a key through it consistently
    poolManualState: { p1: { weekIdx: 3, customGames } },
    applyParsedPoolData: async (data, poolId, statusEl) => { applyCalls.push({ data, poolId, statusEl }); },
    pgAlert: async (opts) => { alertCalls.push(opts); },
    renderPoolManualBox: () => { ctx.renderCalled = (ctx.renderCalled || 0) + 1; },
    esc: (s) => String(s ?? ""),
  };
  ctx.box = box;
  ctx.applyCalls = applyCalls;
  ctx.alertCalls = alertCalls;
  vm.createContext(ctx);
  vm.runInContext(extractFunction("wirePoolManualBox", src), ctx);
  ctx.wirePoolManualBox("p1");
  return ctx;
}

// Happy path: two checked games (one with its prefilled Vegas line left
// alone, one with the spread EDITED by hand) plus one custom game, all
// three should end up in the saved games array.
{
  const ctx = makeCtx({
    checkboxes: [
      makeFakeCheckbox("a@x", "A", "X", "2026-09-05T17:00:00Z", true),
      makeFakeCheckbox("b@y", "B", "Y", "2026-09-05T20:00:00Z", true),
      makeFakeCheckbox("c@z", "C", "Z", "2026-09-05T23:00:00Z", false), // NOT checked -- must be excluded
    ],
    lineInputs: { "a@x": { value: "-3.5" }, "b@y": { value: "7" } }, // "7" simulates an edited-by-hand value
    customGames: [{ away: "D", home: "W", line: -14 }],
  });
  await ctx.box._controls.save.onclick();
  check("save: calls applyParsedPoolData() exactly once", ctx.applyCalls.length === 1);
  const sent = ctx.applyCalls[0];
  check("save: targets the correct pool id (reuses the SAME merge/archive pipeline as PDF/paste import, not a new pool-mutation path)",
    sent.poolId === "p1");
  check("save: source is 'manual'", sent.data.source === "manual");
  check("save: pickLimit is null (leaves the pool's EXISTING pick limit untouched, same as re-importing a real sheet does)",
    sent.data.pickLimit === null);
  check("save: includes both CHECKED games, excludes the unchecked one",
    sent.data.games.some(g => g.away === "A" && g.home === "X") &&
    sent.data.games.some(g => g.away === "B" && g.home === "Y") &&
    !sent.data.games.some(g => g.away === "C"));
  check("save: respects the EDITED spread value from the line input, not just whatever was prefilled",
    sent.data.games.find(g => g.away === "B").line === 7);
  check("save: includes the custom (free-text) game too",
    sent.data.games.some(g => g.away === "D" && g.home === "W" && g.line === -14));
  check("save: total count matches games.length (2 checked + 1 custom = 3)",
    sent.data.games.length === 3 && sent.data.count === 3);
  check("save: closes the box and clears its per-pool state afterward",
    ctx.box.style.display === "none");
}

// Nothing checked and no custom games -- must refuse with a clear message,
// never call applyParsedPoolData() with an empty games array.
{
  const ctx = makeCtx({ checkboxes: [makeFakeCheckbox("a@x", "A", "X", "", false)], customGames: [] });
  await ctx.box._controls.save.onclick();
  check("save: an empty selection (nothing checked, no custom games) never calls applyParsedPoolData()",
    ctx.applyCalls.length === 0);
  check("save: an empty selection shows a real alert explaining why, not a silent no-op",
    ctx.alertCalls.length === 1 && /at least one/i.test(ctx.alertCalls[0].message));
}

// A checked game with its line input CLEARED (blank) -- must come through
// as null, not NaN or a coerced 0, same "don't fabricate a number" rule
// this project applies everywhere else.
{
  const ctx = makeCtx({
    checkboxes: [makeFakeCheckbox("a@x", "A", "X", "", true)],
    lineInputs: { "a@x": { value: "" } },
  });
  await ctx.box._controls.save.onclick();
  const g = ctx.applyCalls[0].data.games[0];
  check("save: a blank/cleared spread input comes through as null, never NaN or a fabricated 0",
    g.line === null);
}

// "+ add game" custom-entry handler: real validation (both team names
// required), and the added game shows up for the NEXT save.
{
  const ctx = makeCtx({ customAwayVal: "", customHomeVal: "Home Only" });
  await ctx.box._controls.addCustom.onclick();
  check("add-custom: refuses when the away team is blank, even if home is filled in",
    ctx.alertCalls.length === 1 && ctx.poolManualState.p1.customGames.length === 0);
}
{
  const ctx = makeCtx({ customAwayVal: "Away U", customHomeVal: "Home U", customLineVal: "-6.5" });
  await ctx.box._controls.addCustom.onclick();
  check("add-custom: a valid away+home (with a spread) gets pushed into this pool's customGames state",
    ctx.poolManualState.p1.customGames.length === 1 &&
    ctx.poolManualState.p1.customGames[0].away === "Away U" &&
    ctx.poolManualState.p1.customGames[0].line === -6.5);
  check("add-custom: triggers a re-render so the newly-added game actually shows up in the list",
    ctx.renderCalled === 1);
}
{
  const ctx = makeCtx({ customAwayVal: "Away U", customHomeVal: "Home U", customLineVal: "" });
  await ctx.box._controls.addCustom.onclick();
  check("add-custom: a blank spread on a custom game is allowed (null, not required) -- team names are the only hard requirement",
    ctx.poolManualState.p1.customGames.length === 1 && ctx.poolManualState.p1.customGames[0].line === null);
}

// Week navigation: prev/next just adjust weekIdx and re-render -- no
// re-fetch, no data loss for anything already checked (that state lives
// in the DOM, which a re-render for THIS pool's box will rebuild fresh,
// same as switching weeks on the real Board itself doesn't try to
// preserve unrelated in-progress edits).
{
  const ctx = makeCtx({});
  ctx.box._controls.weekNext.onclick();
  check("week-next: increments weekIdx", ctx.poolManualState.p1.weekIdx === 4);
  ctx.box._controls.weekPrev.onclick();
  ctx.box._controls.weekPrev.onclick();
  check("week-prev: decrements weekIdx (net: +1 then -1 then -1 from 3 = 2)", ctx.poolManualState.p1.weekIdx === 2);
  check("week navigation triggers a re-render each time", ctx.renderCalled >= 3);
}

// --- Structural: wiring/menu-item existence, entry point ------------------
check("poolRowHTML() adds a 'Select games manually' menu item inside the Import ▾ dropdown, for every source (not gated to manual-only pools -- a Splash pool might still be missing one game the sheet didn't include)",
  /data-manualtoggle="\$\{p\.id\}"/.test(src) && !/p\.source===["']manual["']\?.*data-manualtoggle/.test(src));
check("the box's markup is NOT rendered for archived pools (matches the existing paste-box/import-menu gating)",
  /\$\{isArchived\?""\s*:\s*`\s*<div class="pool-manual-box"/.test(src));
check("wirePoolRowActions() wires [data-manualtoggle] to togglePoolManualBox()",
  /\[data-manualtoggle\]"\)\.forEach\(b=>b\.onclick=\(\)=>\{\s*\n\s*togglePoolManualBox\(b\.dataset\.manualtoggle\);/.test(src));
check("togglePoolManualBox() calls closeAllPoolMenus() (same dropdown-closing convention as paste/edit/archive), so it doesn't sit open on top of the box that just appeared",
  /function togglePoolManualBox\(poolId\)\{[\s\S]{0,300}closeAllPoolMenus\(\)/.test(src));
check("save handler actually hides the box (box.style.display=\"none\") after a successful save",
  /await applyParsedPoolData\(\{source:"manual"[\s\S]{0,150}box\.style\.display="none"/.test(src));

console.log(failures.length ? `\n${failures.length} of ${total} FAILURE(S):` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);
