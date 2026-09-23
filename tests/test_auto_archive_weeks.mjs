// Regression tests for the automatic weekly archive (Sept 23, 2026).
//
// Grading (api/grade_picks.py) only reads ARCHIVED history, so before this
// a person who never pressed "Archive picks & start new week" never had a
// single pick graded. autoArchiveFinishedWeeks() (app/js/record.js) now
// moves each context's picks to Results once that week is genuinely over.
// These tests run the REAL functions extracted from app/js/record.js and
// app/js/board.js (same extractFunction() convention as the other vm
// tests), not hand-copied reimplementations.
//
// Run with:
//     node tests/test_auto_archive_weeks.mjs
import fs from "node:fs";
import vm from "node:vm";

const recordSrc = fs.readFileSync(new URL("../app/js/record.js", import.meta.url), "utf8");
const boardSrc = fs.readFileSync(new URL("../app/js/board.js", import.meta.url), "utf8");
const oddsSrc = fs.readFileSync(new URL("../app/js/odds.js", import.meta.url), "utf8");
const modelSrc = fs.readFileSync(new URL("../app/js/model.js", import.meta.url), "utf8");
const poolSrc = fs.readFileSync(new URL("../app/js/pool-contexts.js", import.meta.url), "utf8");
const picksSrc = fs.readFileSync(new URL("../app/js/picks.js", import.meta.url), "utf8");
const initSrc = fs.readFileSync(new URL("../app/js/init.js", import.meta.url), "utf8");
const mainSrc = fs.readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const htmlSrc = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

function extractFunction(name, source) {
  const asyncMarker = `async function ${name}(`;
  let start = source.indexOf(asyncMarker);
  if (start === -1) start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Could not find function ${name}()`);
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}
function extractConst(name, source) {
  const m = source.match(new RegExp(`const ${name}=[^;]+;`));
  if (!m) throw new Error(`Could not find const ${name}`);
  return m[0];
}

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

const calendarCode = [
  extractConst("WEEK_MS", boardSrc),
  extractConst("SEASON_WEEK1_TUESDAY", boardSrc),
  ...["week1StartMs", "localMidnight", "weekIndexOf", "windowForWeek", "weekLabel", "inWeek"].map((n) => extractFunction(n, boardSrc)),
].join("\n");
const archiveCode = [
  extractConst("AUTO_ARCHIVE_GRACE_MS", recordSrc),
  ...["autoArchiveDecision", "pickKickoffIso", "archiveLiveGameFor", "archivedPickRecord",
      "archiveContextWeek", "autoArchiveFinishedWeeks", "restoreWeek"].map((n) => extractFunction(n, recordSrc)),
  extractFunction("clvOf", modelSrc),
  extractFunction("resolveVegasLine", oddsSrc),
  extractFunction("resolvePreKickRecordLine", oddsSrc),
  extractFunction("preKickRecordForPick", oddsSrc),
  "function round1(n){ return Math.round(n*10)/10; }",
  "function mkey(a,h){ return String(a).toLowerCase()+'@'+String(h).toLowerCase(); }",
].join("\n");

const H = 60 * 60 * 1000;
// Week 4 of 2026 = Tue Sep 22 - Mon Sep 28 (board.js calendar).
const THU = "2026-09-24T23:30:00Z";
const SAT_NOON = "2026-09-26T16:00:00Z";
const SAT_NIGHT = "2026-09-27T02:30:00Z";
const MON = "2026-09-28T23:30:00Z"; // Monday-night game, Mon Sep 28 in both UTC and US zones
const ms = (iso) => Date.parse(iso);

function makeCtx({ state, games = [], currentPool = null, signedIn = true }) {
  const calls = { save: 0, syncAll: 0, renders: 0, notice: null, switchTab: null };
  const ctx = {
    window: { Clerk: signedIn ? { user: { id: "u" } } : {} },
    state,
    games,
    currentPool: () => currentPool,
    activeEntries: () => (currentPool ? currentPool.entries : state.entries),
    activeHistory: () => (currentPool ? currentPool.history : state.history),
    teamMatchTrunc: (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase(),
    uid: (() => { let n = 0; return () => `id${n++}`; })(),
    esc: (x) => String(x),
    save: () => { calls.save++; },
    syncAll: () => { calls.syncAll++; },
    buildGames() {}, applyTeamLogos() {}, migrateGameKeys() {}, applyPdfData() {}, applyPredictions() {}, sortGames() {},
    renderBoard: () => { calls.renders++; }, renderEntries() {}, renderPicksDetail() {}, renderRecord() {},
    showAutoArchiveNotice: (closed) => { calls.notice = closed; },
    pgConfirm: async () => true,
    switchTab: (t) => { calls.switchTab = t; },
    sideOfArchived: (p) => p.side,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(calendarCode, ctx);
  vm.runInContext(archiveCode, ctx);
  // Keep the test's stub notice (the real one touches the DOM).
  ctx.showAutoArchiveNotice = (closed) => { calls.notice = closed; };
  vm.runInContext("showAutoArchiveNotice=this.showAutoArchiveNotice;", ctx);
  ctx.__calls = calls;
  return ctx;
}
const decide = (kicks, known, now, hold) => {
  const ctx = makeCtx({ state: {} });
  return ctx.autoArchiveDecision(kicks, known, now, hold);
};

// --- Pure decision rules -----------------------------------------------------
{
  const known = [THU, SAT_NOON, SAT_NIGHT];
  const d = decide([THU], known, ms(THU) + 6 * H, null);
  check("REGRESSION GUARD: a Thursday pick does NOT archive while Saturday games in the same week are still upcoming (no split week)",
    !d.archive && d.reason === "week-still-open");
}
{
  const d = decide([THU, SAT_NOON], [THU, SAT_NOON, SAT_NIGHT], ms(SAT_NOON) + 2 * H, null);
  check("waits while the latest picked game is still inside the post-kickoff grace window", !d.archive && d.reason === "games-in-progress");
}
{
  const d = decide([THU, SAT_NOON], [THU, SAT_NOON, SAT_NIGHT], ms(SAT_NIGHT) + 6 * H, null);
  check("archives once every picked game is well past kickoff and no game in that week is still upcoming", d.archive === true);
  check("archive label is the CFB calendar week of the picks (Week 4)", d.label === "Week 4" && d.week === 4);
}
{
  const d = decide([SAT_NOON], [SAT_NOON, MON], ms(SAT_NOON) + 8 * H, null);
  check("a still-upcoming later game in the same Tue-Mon week holds the archive open", !d.archive && d.reason === "week-still-open");
}
{
  const d = decide([SAT_NOON, null], [SAT_NOON], ms(SAT_NOON) + 48 * H, null);
  check("any pick with an unknown kickoff blocks auto-archive (left for the manual button, never guessed)", !d.archive && d.reason === "unknown-kickoff");
}
{
  const d = decide([], [], Date.now(), null);
  check("no picks -> nothing to archive", !d.archive && d.reason === "no-picks");
}
{
  const d = decide([SAT_NOON], [SAT_NOON], ms(SAT_NOON) + 48 * H, 4);
  check("a restore-hold for Week 4 prevents re-archiving that restored week", !d.archive && d.reason === "restored");
  const d2 = decide(["2026-10-03T16:00:00Z"], [], ms("2026-10-03T16:00:00Z") + 48 * H, 4);
  check("the Week 4 hold does NOT block a later week (Week 5) from archiving", d2.archive === true && d2.label === "Week 5");
}
{
  const d = decide([SAT_NOON], [SAT_NOON, "2026-10-03T16:00:00Z"], ms(SAT_NOON) + 8 * H, null);
  check("upcoming games from NEXT week never hold the finished week open", d.archive === true);
}

// --- End-to-end sweep over every context -------------------------------------
function freshState(now) {
  return {
    lastGames: [
      { id: "g1", away: "Houston", home: "Arizona State", commence: SAT_NOON },
      { id: "g9", away: "Iowa", home: "Ohio State", commence: "2026-10-03T16:00:00Z" },
    ],
    preKickLines: {}, book: "consensus", history: [], autoArchiveHold: {},
    entries: [{ id: "e1", name: "Entry 1", submittedAt: "2026-09-25T00:00:00Z", picks: {
      "houston@arizona state": { side: "home", team: "Arizona State", line: -2, matchup: "Houston @ Arizona State", providerGameId: "g1", commenceAtPick: SAT_NOON, cfbdGameId: 777 },
    } }],
    pools: [{ id: "pA", name: "Madwood", history: [], games: [
      { away: "SMU", home: "Wake Forest", commence: SAT_NIGHT, line: 3 },
    ], entries: [
      { id: "pe1", name: "Madwood 1", picks: {
        // Legacy pick saved before commenceAtPick existed: kickoff resolves
        // from the pool's own imported slate instead.
        "smu@wake forest": { side: "away", team: "SMU", line: -3, matchup: "SMU @ Wake Forest", cfbdGameId: 555 },
      } },
      { id: "pe2", name: "Madwood 2", picks: {} },
    ] },
    { id: "pB", name: "Next week pool", history: [], games: [], entries: [
      { id: "pbe", name: "B1", picks: { "iowa@ohio state": { side: "home", team: "Ohio State", line: -10, matchup: "Iowa @ Ohio State", commenceAtPick: "2026-10-03T16:00:00Z" } } },
    ] }],
  };
}
{
  const now = ms(SAT_NIGHT) + 8 * H;
  const state = freshState(now);
  const ctx = makeCtx({ state, games: [] });
  const closed = ctx.autoArchiveFinishedWeeks(now);
  check("sweep archives BOTH finished contexts (No Pool + Madwood), not just the one being viewed", closed.length === 2);
  check("No Pool picks cleared from the board after auto-archive", Object.keys(state.entries[0].picks).length === 0);
  check("auto-archive clears submittedAt, exactly like the manual archive", state.entries[0].submittedAt === undefined);
  const rec = state.history[0];
  check("No Pool history record is labeled Week 4 and flagged autoArchived", rec && rec.label === "Week 4" && rec.autoArchived === true && rec.cfbWeek === 4);
  const p = rec.entries[0].picks[0];
  check("archived pick keeps the PICK-time line (-2) that grading reads", p.line === -2);
  check("archived pick keeps its frozen CFBD identity even though no live board object was available", p.cfbdGameId === 777 && p.providerGameId === "g1");
  check("archived pick is ungraded (result:null) so the nightly grader picks it up", p.result === null);
  const pool = state.pools[0];
  check("pool context archives into the POOL's own history (where grade_picks.py already looks)", pool.history.length === 1 && pool.history[0].entries[0].picks[0].team === "SMU");
  check("legacy pick with no commenceAtPick still resolved its kickoff from the pool's imported slate", pool.history[0].entries[0].picks[0].cfbdGameId === 555);
  check("empty entries are carried through as empty snapshots, same shape as manual archive", pool.history[0].entries.length === 2);
  check("a pool whose picks are for NEXT week is left untouched", state.pools[1].history.length === 0 && Object.keys(state.pools[1].entries[0].picks).length === 1);
  check("sweep saves + syncs once and shows the notice", ctx.__calls.save === 1 && ctx.__calls.syncAll === 1 && Array.isArray(ctx.__calls.notice) && ctx.__calls.notice.length === 2);

  const again = ctx.autoArchiveFinishedWeeks(now);
  check("idempotent: a second sweep finds nothing left to archive", again.length === 0 && state.history.length === 1);
}
{
  const now = ms(SAT_NIGHT) + 8 * H;
  const state = freshState(now);
  const ctx = makeCtx({ state, signedIn: false });
  const closed = ctx.autoArchiveFinishedWeeks(now);
  check("signed-out (guest) sessions never auto-archive", closed.length === 0 && state.history.length === 0);
}
{
  const now = ms(SAT_NOON) + 6 * H; // before the pool's late-night game even kicks off
  const state = freshState(now);
  const ctx = makeCtx({ state });
  const closed = ctx.autoArchiveFinishedWeeks(now);
  check("mid-slate: nothing archives while the pool's Saturday-night game is still upcoming", !closed.some((c) => c.context === "Madwood"));
}

// --- Restore sets a hold so the week isn't instantly re-archived --------------
{
  const now = ms(SAT_NIGHT) + 8 * H;
  const state = freshState(now);
  const ctx = makeCtx({ state });
  ctx.autoArchiveFinishedWeeks(now);
  const weekId = state.history[0].id;
  await ctx.restoreWeek(weekId);
  check("restoreWeek() puts the picks back on the board", Object.keys(state.entries[0].picks).length === 1);
  check("restoreWeek() records a hold for that context at the restored CFB week", state.autoArchiveHold.overall === 4);
  const closed = ctx.autoArchiveFinishedWeeks(now);
  check("the restored week is NOT immediately re-archived by the next sweep", !closed.some((c) => c.context === "No Pool") && Object.keys(state.entries[0].picks).length === 1);
}

// --- Structural wiring ----------------------------------------------------------
check("pickTeam() freezes the game's kickoff on every new pick (commenceAtPick)", /commenceAtPick:g\.commence\|\|null/.test(extractFunction("pickTeam", picksSrc)));
check("import-time pool archive now routes through the shared archive core (was a drifted copy without CLV)",
  /archiveContextWeek\(pool,/.test(extractFunction("archivePoolCurrentWeek", poolSrc)));
check("manual closeWeek() also routes through the shared archive core", /archiveContextWeek\(pool,/.test(extractFunction("closeWeek", recordSrc)));
check("autoArchiveHold is normalized into state", mainSrc.includes("s.autoArchiveHold=("));
check("index.html has the dismissible auto-archive notice element", htmlSrc.includes('id="autoArchiveNotice"'));
check("My Picks no longer tells people they must archive manually", !htmlSrc.includes("Archive picks &amp; start new week") && htmlSrc.includes("Archive now instead"));
check("the auto-archive sweep also runs from the startup/resume auto-load path", oddsSrc.includes('if(typeof autoArchiveFinishedWeeks==="function") autoArchiveFinishedWeeks();'));
check("init() kicks off the auto-load path (which runs the sweep)", initSrc.includes('autoLoadLiveData("startup")'));

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
