// Tests for the archive-line-integrity fix in app/js/record.js's
// closeWeek(). Extracts the ACTUAL function (not a hand-copied
// reimplementation) per this project's established pattern. Run with:
//
//     node tests/test_archive_line_integrity.mjs
//
// WHY THIS MATTERS: the archived `line` field isn't just a display
// value -- api/grade_picks.py's _grade_history() reads pk.get("line")
// directly to compute automatic W/L/P via grade(picked_score, opp_score,
// line). Before this fix, closeWeek() overwrote the pick-time line with
// today's live market line whenever a live-matched game still existed,
// which could silently produce a WRONG automatic grade (not just a wrong
// displayed number) whenever the market moved between picking and
// archiving. This path had ZERO test coverage before this file --
// exactly how a bug like this slips through unnoticed.
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/js/record.js", import.meta.url), "utf8");
const modelSrc = fs.readFileSync(new URL("../app/js/model.js", import.meta.url), "utf8");
const oddsSrc = fs.readFileSync(new URL("../app/js/odds.js", import.meta.url), "utf8");

function extractFunction(name, source) {
  const asyncMarker = `async function ${name}(`;
  const plainMarker = `function ${name}(`;
  let start = source.indexOf(asyncMarker);
  if (start === -1) start = source.indexOf(plainMarker);
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

// clvOf() is a real dependency closeWeek() now calls -- extract the real
// thing (plus its own dependency, round1()) rather than stub the math.
const clvOfCode = extractFunction("clvOf", modelSrc);
const round1Code = "function round1(n){ return Math.round(n*10)/10; }";
const closeWeekCode = extractFunction("closeWeek", src);
const resolveVegasLineCode = extractFunction("resolveVegasLine", oddsSrc);
const resolvePreKickRecordLineCode = extractFunction("resolvePreKickRecordLine", oddsSrc);
const preKickRecordForPickCode = extractFunction("preKickRecordForPick", oddsSrc);

function makeCtx({ pool, entries, games, preKickLines = {}, book = "consensus", promptReturns = "Week 1" }) {
  const calls = { save: 0, syncAll: 0, renderRecord: 0, switchTab: null, alert: null };
  const ctx = {
    state: { history: pool ? [] : [], preKickLines, book },
    games: games || [],
    currentPool: () => pool || null,
    activeEntries: () => entries,
    activeHistory: () => (pool ? pool.history : ctx.state.history),
    pgPrompt: async () => promptReturns,
    pgAlert: async (opts) => { calls.alert = opts && opts.message ? opts.message : opts; },
    pgConfirm: async () => true,
    save: () => { calls.save++; },
    syncAll: () => { calls.syncAll++; },
    renderRecord: () => { calls.renderRecord++; },
    switchTab: (t) => { calls.switchTab = t; },
    uid: (() => { let n = 0; return () => `id${n++}`; })(),
  };
  vm.createContext(ctx);
  vm.runInContext(round1Code, ctx);
  vm.runInContext(clvOfCode, ctx);
  vm.runInContext(resolveVegasLineCode, ctx);
  vm.runInContext(resolvePreKickRecordLineCode, ctx);
  // Tests below use provider ids, so the name-match fallback is not reached;
  // still define it because the real helper references it lazily.
  ctx.teamMatchTrunc = (a,b) => String(a||"").toLowerCase() === String(b||"").toLowerCase();
  vm.runInContext(preKickRecordForPickCode, ctx);
  vm.runInContext(closeWeekCode, ctx);
  ctx.__calls = calls;
  return ctx;
}

// --- The core bug fix: archived line must be the PICK-time line -----------
{
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": { side: "home", team: "Team B", line: -6.5, matchup: "Team A @ Team B" },
  } }];
  // The market has moved since the pick was made -- live.vegas is now -8,
  // NOT the -6.5 the pick was actually made against.
  const games = [{ key: "a@b", home: "Team B", away: "Team A", vegas: -8, providerGameId: "g123" }];
  const ctx = makeCtx({ pool: null, entries, games });
  await ctx.closeWeek();

  const archived = ctx.state.history[0].entries[0].picks[0];
  check("closeWeek(): archived line is the PICK-time line (-6.5), not today's live market line (-8)",
    archived.line === -6.5);
  check("closeWeek(): the live-matched game's providerGameId is still carried through (unaffected by the fix)",
    archived.providerGameId === "g123");
}

// --- Pick-time analytics survive archive intact ----------------------------
{
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": {
      side: "home", team: "Team B", line: -6.5, matchup: "Team A @ Team B",
      pickedAt: "2026-08-18T20:00:00.000Z",
      modelVersion: 1,
      modelNumberAtPick: -9.5,
      rawEdgeAtPick: 3,
      pickedEdgeAtPick: 3,
      coverProbabilityAtPick: 0.58,
      modelInputsAtPick: { bp: -9, comp: -10, vegas: -6.5 },
      modelWeightsAtPick: { bp: 1, comp: 1, vegas: 0 },
    },
  } }];
  const games = [{ key: "a@b", home: "Team B", away: "Team A", vegas: -8 }];
  const ctx = makeCtx({ pool: null, entries, games });
  await ctx.closeWeek();
  const p = ctx.state.history[0].entries[0].picks[0];

  check("closeWeek(): preserves pick-time Model # instead of recalculating it at archive time", p.modelNumberAtPick === -9.5);
  check("closeWeek(): preserves the original pickedAt timestamp", p.pickedAt === "2026-08-18T20:00:00.000Z");
  check("closeWeek(): preserves frozen model inputs/weights", p.modelInputsAtPick.comp === -10 && p.modelWeightsAtPick.vegas === 0);
}

// --- closingLine/clv are captured separately, and correctly signed --------
{
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": { side: "home", team: "Team B", line: -6.5, matchup: "Team A @ Team B" },
  } }];
  entries[0].picks["a@b"].providerGameId = "g1";
  entries[0].picks["a@b"].bookAtPick = "draftkings";
  const games = [{ key: "a@b", home: "Team B", away: "Team A", vegas: -9, providerGameId: "g1" }];
  const preKickLines = { g1: { id:"g1", away:"Team A", home:"Team B", books:{draftkings:-8,fanatics:-7.5}, bookObservedAt:{draftkings:"2026-09-05T15:58:00Z"}, observedAt:"2026-09-05T15:58:00Z" } };
  const ctx = makeCtx({ pool: null, entries, games, preKickLines });
  await ctx.closeWeek();
  const p = ctx.state.history[0].entries[0].picks[0];

  check("closeWeek(): closingLine uses the stored LAST PRE-KICK line (-8), not the later/archive-time live market (-9)",
    p.closingLine === -8);
  check("closeWeek(): closing line uses the same book frozen at pick time", p.closingLineBook === "draftkings");
  check("closeWeek(): stores when that pre-kick line was observed", p.closingLineObservedAt === "2026-09-05T15:58:00Z");
  // Home favorite growing from -6.5 to -8 is GOOD closing line value for a
  // home-favorite pick: the market later confirms the picked team was even
  // more dominant than the number you got, so your -6.5 was a "cheaper"
  // number than the market ended up settling on. Matches the exact same
  // pattern already verified via a real screenshot earlier this session
  // (locked -3 -> live -6, home pick -> CLV +3.0, shown green/good) --
  // clvOf({lockedLine:-6.5,liveVegas:-8},"home") really does return +1.5,
  // confirmed directly against clvOf() itself before trusting this test.
  check("closeWeek(): CLV is POSITIVE -- home favorite growing stronger after you picked it is good closing line value",
    p.clv > 0);
  check("closeWeek(): CLV magnitude is exactly 1.5 (|-6.5 - (-8)| via the shared clvOf() math)",
    p.clv === 1.5);
}

// --- Away-side pick: perspective conversion must be correct ---------------
{
  // Pick was the away underdog at +6.5 (home line was -6.5 at pick time).
  // Market has since moved to home -8 (home favorite grew stronger --
  // BAD for the away-dog pick, so CLV should be negative).
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": { side: "away", team: "Team A", line: 6.5, matchup: "Team A @ Team B" },
  } }];
  entries[0].picks["a@b"].providerGameId = "g2";
  entries[0].picks["a@b"].bookAtPick = "consensus";
  const games = [{ key: "a@b", home: "Team B", away: "Team A", vegas: -9, providerGameId: "g2" }];
  const preKickLines = { g2: { id:"g2", away:"Team A", home:"Team B", books:{draftkings:-8,fanduel:-8}, observedAt:"2026-09-05T15:59:00Z" } };
  const ctx = makeCtx({ pool: null, entries, games, preKickLines });
  await ctx.closeWeek();
  const p = ctx.state.history[0].entries[0].picks[0];

  check("closeWeek(): away-side archived line is still the pick-time line (+6.5), not derived from today's market",
    p.line === 6.5);
  check("closeWeek(): away-side closingLine is correctly converted to the picked team's own perspective (+8, not -8)",
    p.closingLine === 8);
  check("closeWeek(): away-side CLV is negative (home favorite growing stronger is bad for the away-dog pick)",
    p.clv < 0 && p.clv === -1.5);
}

// --- No live match at archive time: line still preserved, CLV genuinely unknown ---
{
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": { side: "home", team: "Team B", line: -6.5, matchup: "Team A @ Team B" },
  } }];
  entries[0].picks["a@b"].providerGameId = "g3";
  entries[0].picks["a@b"].bookAtPick = "draftkings";
  const preKickLines = { g3: { id:"g3", away:"Team A", home:"Team B", books:{draftkings:-7.5}, bookObservedAt:{draftkings:"2026-09-05T15:57:00Z"}, observedAt:"2026-09-05T15:57:00Z" } };
  const ctx = makeCtx({ pool: null, entries, games: [], preKickLines }); // game no longer in the live list at all
  await ctx.closeWeek();
  const p = ctx.state.history[0].entries[0].picks[0];

  check("closeWeek(): with no live-matched game, the pick-time line is STILL preserved correctly",
    p.line === -6.5);
  check("closeWeek(): with no live-matched game, retained pre-kick history still supplies the true close",
    p.closingLine === -7.5 && p.clv === 1);
}

// --- No pre-kick observation: do not fabricate closing value from archive-time live odds ---
{
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": { side: "home", team: "Team B", line: -6.5, matchup: "Team A @ Team B", providerGameId:"missing" },
  } }];
  const games = [{ key:"a@b", home:"Team B", away:"Team A", vegas:-10, providerGameId:"missing" }];
  const ctx = makeCtx({ pool:null, entries, games, preKickLines:{} });
  await ctx.closeWeek();
  const p = ctx.state.history[0].entries[0].picks[0];
  check("closeWeek(): without a captured pre-kick snapshot, closingLine stays null instead of using archive-time live odds",
    p.closingLine === null && p.clv === null);
}

// --- Pool context: same fix applies (protects the pre-lock edge case) -----
{
  const pool = { id: "p1", name: "Test Pool", history: [] };
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": { side: "home", team: "Team B", line: -3, matchup: "Team A @ Team B" },
  } }];
  // Simulates a pre-lock pick whose provisional number later got replaced
  // by the real locked line by archive time -- g.vegas is now the locked
  // -7, not the -3 the pre-lock pick was actually made against.
  const games = [{ key: "a@b", home: "Team B", away: "Team A", vegas: -7 }];
  const ctx = makeCtx({ pool, entries, games });
  await ctx.closeWeek();

  const archived = pool.history[0].entries[0].picks[0];
  check("closeWeek() in a pool context: archived line is still the pick-time line (-3), protecting the pre-lock edge case too",
    archived.line === -3);
  check("closeWeek() in a pool context: writes to pool.history, not state.history",
    ctx.state.history.length === 0 && pool.history.length === 1);
}

// --- Side effects: unchanged behavior around the fix -----------------------
{
  const entries = [{ id: "e1", name: "Entry 1", picks: {} }]; // no picks at all
  const ctx = makeCtx({ pool: null, entries, games: [] });
  await ctx.closeWeek();
  check("closeWeek(): with zero picks anywhere, alerts and does not archive anything",
    ctx.__calls.alert != null && ctx.state.history.length === 0);
}
{
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": { side: "home", team: "Team B", line: -6.5, matchup: "Team A @ Team B" },
  } }];
  const ctx = makeCtx({ pool: null, entries, games: [], promptReturns: null }); // user cancels the label prompt
  await ctx.closeWeek();
  check("closeWeek(): cancelling the week-label prompt aborts without archiving",
    ctx.state.history.length === 0 && ctx.__calls.save === 0);
}
{
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": { side: "home", team: "Team B", line: -6.5, matchup: "Team A @ Team B" },
  } }];
  const ctx = makeCtx({ pool: null, entries, games: [] });
  await ctx.closeWeek();
  check("closeWeek(): the entry's picks are cleared after archiving (starts the new week empty)",
    Object.keys(entries[0].picks).length === 0);
  check("closeWeek(): calls save()/syncAll()/renderRecord() and switches to the Results tab",
    ctx.__calls.save === 1 && ctx.__calls.syncAll === 1 && ctx.__calls.renderRecord === 1 && ctx.__calls.switchTab === "record");
}

console.log(failures.length ? `\n${failures.length} of ${total} checks FAILED:` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);
