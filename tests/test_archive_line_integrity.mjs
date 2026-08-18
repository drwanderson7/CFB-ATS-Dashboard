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

// clvOf() is a real dependency closeWeek() now calls -- extract the real
// thing (plus its own dependency, round1()) rather than stub the math.
const clvOfCode = extractFunction("clvOf", modelSrc);
const round1Code = "function round1(n){ return Math.round(n*10)/10; }";
const closeWeekCode = extractFunction("closeWeek", src);

function makeCtx({ pool, entries, games, promptReturns = "Week 1" }) {
  const calls = { save: 0, syncAll: 0, renderRecord: 0, switchTab: null, alert: null };
  const ctx = {
    state: { history: pool ? [] : [] },
    games: games || [],
    currentPool: () => pool || null,
    activeEntries: () => entries,
    activeHistory: () => (pool ? pool.history : ctx.state.history),
    prompt: () => promptReturns,
    alert: (msg) => { calls.alert = msg; },
    save: () => { calls.save++; },
    syncAll: () => { calls.syncAll++; },
    renderRecord: () => { calls.renderRecord++; },
    switchTab: (t) => { calls.switchTab = t; },
    uid: (() => { let n = 0; return () => `id${n++}`; })(),
  };
  vm.createContext(ctx);
  vm.runInContext(round1Code, ctx);
  vm.runInContext(clvOfCode, ctx);
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
  ctx.closeWeek();

  const archived = ctx.state.history[0].entries[0].picks[0];
  check("closeWeek(): archived line is the PICK-time line (-6.5), not today's live market line (-8)",
    archived.line === -6.5);
  check("closeWeek(): the live-matched game's providerGameId is still carried through (unaffected by the fix)",
    archived.providerGameId === "g123");
}

// --- closingLine/clv are captured separately, and correctly signed --------
{
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": { side: "home", team: "Team B", line: -6.5, matchup: "Team A @ Team B" },
  } }];
  const games = [{ key: "a@b", home: "Team B", away: "Team A", vegas: -8 }];
  const ctx = makeCtx({ pool: null, entries, games });
  ctx.closeWeek();
  const p = ctx.state.history[0].entries[0].picks[0];

  check("closeWeek(): closingLine captures today's market read (home side: direct value, -8)",
    p.closingLine === -8);
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
  const games = [{ key: "a@b", home: "Team B", away: "Team A", vegas: -8 }];
  const ctx = makeCtx({ pool: null, entries, games });
  ctx.closeWeek();
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
  const ctx = makeCtx({ pool: null, entries, games: [] }); // game no longer in the live list at all
  ctx.closeWeek();
  const p = ctx.state.history[0].entries[0].picks[0];

  check("closeWeek(): with no live-matched game, the pick-time line is STILL preserved correctly",
    p.line === -6.5);
  check("closeWeek(): with no live-matched game, closingLine is honestly null (unknown), not silently reused from p.line",
    p.closingLine === null);
  check("closeWeek(): with no live-matched game, clv is null, not a fabricated zero",
    p.clv === null);
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
  ctx.closeWeek();

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
  ctx.closeWeek();
  check("closeWeek(): with zero picks anywhere, alerts and does not archive anything",
    ctx.__calls.alert != null && ctx.state.history.length === 0);
}
{
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": { side: "home", team: "Team B", line: -6.5, matchup: "Team A @ Team B" },
  } }];
  const ctx = makeCtx({ pool: null, entries, games: [], promptReturns: null }); // user cancels the label prompt
  ctx.closeWeek();
  check("closeWeek(): cancelling the week-label prompt aborts without archiving",
    ctx.state.history.length === 0 && ctx.__calls.save === 0);
}
{
  const entries = [{ id: "e1", name: "Entry 1", picks: {
    "a@b": { side: "home", team: "Team B", line: -6.5, matchup: "Team A @ Team B" },
  } }];
  const ctx = makeCtx({ pool: null, entries, games: [] });
  ctx.closeWeek();
  check("closeWeek(): the entry's picks are cleared after archiving (starts the new week empty)",
    Object.keys(entries[0].picks).length === 0);
  check("closeWeek(): calls save()/syncAll()/renderRecord() and switches to the Results tab",
    ctx.__calls.save === 1 && ctx.__calls.syncAll === 1 && ctx.__calls.renderRecord === 1 && ctx.__calls.switchTab === "record");
}

console.log(failures.length ? `\n${failures.length} of ${total} checks FAILED:` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);
