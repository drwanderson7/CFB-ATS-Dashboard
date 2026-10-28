// Survivor's CURRENT pool week is priced from live odds (Oct 28, 2026).
//
// Runs the real functions from app/js/survivor-data-adapter.js:
//   * pgsLiveLineForCanonical(): the live Odds API line comes from the shared
//     slate (state.lastGames, this device's book), home-team perspective, with
//     a neutral-site game listed home/away-swapped flipped, and a game more
//     than 4 days from the CFBD kickoff ignored (no rematch borrowing).
//   * pgsSelectableSide(): every source is kept on the matchup.
//   * pgsPriceCurrentWeek(): current week -> Live line + its derived % when a
//     live line exists and the game hasn't kicked off; otherwise CFBD pregame
//     WP, then the CFBD line, then SP+. Other weeks untouched.
//   * pgsPreferSpForFutureWeeks() still moves later weeks to SP+.
// Plus the wiring: the builder prices the current week, and a successful
// Refresh lines rebuilds an open Survivor pool without refetching CFBD.
//
// Run with:
//     node tests/test_survivor_current_week_live.mjs
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/js/survivor-data-adapter.js", import.meta.url), "utf8");
const integ = fs.readFileSync(new URL("../app/js/survivor-integration.js", import.meta.url), "utf8");
const odds = fs.readFileSync(new URL("../app/js/odds.js", import.meta.url), "utf8");
const tabs = fs.readFileSync(new URL("../app/js/tabs.js", import.meta.url), "utf8");

function fn(source, name) {
  const st = source.indexOf(`function ${name}(`); if (st < 0) throw new Error(name);
  let i = source.indexOf("{", st), d = 0;
  for (; i < source.length; i++) { if (source[i] === "{") d++; else if (source[i] === "}") { d--; if (!d) { i++; break; } } }
  return source.slice(st, i);
}
const failures = []; let total = 0;
const check = (n, c) => { total++; console.log(`[${c ? "PASS" : "FAIL"}] ${n}`); if (!c) failures.push(n); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

const consts = src.slice(src.indexOf("const PG_SURVIVOR_HFA"), src.indexOf("const PG_SURVIVOR_POWER3_CONFERENCES"));
const ctx = {
  Number, Math, Array, String, Date, Set, Map, console,
  // Stand-ins for app globals the adapter reads.
  teamMatch: (a, b) => String(a || "").toLowerCase().split(" ")[0] === String(b || "").toLowerCase().split(" ")[0],
  resolveVegasLine: (g, book) => (g.books && g.books[book] != null ? { line: g.books[book], book } : g.vegas != null ? { line: g.vegas, book: "consensus" } : null),
  pgSurvivorEnrichment: { wpByGame: new Map(), lineByGame: new Map() },
  state: { book: "consensus", lastGames: [] },
  cfbdRatings: [], cfbdScoreboard: [],
};
vm.createContext(ctx);
vm.runInContext([
  consts,
  "const PG_SURVIVOR_POWER3_CONFERENCES=new Set();",
  ...["pgsNormToken", "pgsIsPower3Conference", "pgsFinite", "pgsClamp", "pgsErf", "pgsNormalCdf", "pgsSpreadText",
      "pgsSpProjectedMarginForSide", "pgsSpProbabilityForSide", "pgsDirectWpForCanonical", "pgsSeasonLineForCanonical",
      "pgsLiveLineForCanonical", "pgsLineProbability", "pgsSelectableSide", "pgsPriceCurrentWeek", "pgsPreferSpForFutureWeeks"].map(n => fn(src, n)),
  src.slice(src.indexOf("const PG_SURVIVOR_LIVE_SOURCE"), src.indexOf("function pgsPriceCurrentWeek(")),
  "function pgsRating(name){return cfbdRatings.find(r=>r.team===name)||null;}",
  "function pgsScoreboardGame(){return null;}",
].join("\n"), ctx);

const lineP = (sideLine) => Math.min(0.99, Math.max(0.01, ctx.pgsNormalCdf(-sideLine / 16)));

// --- pgsLineProbability: the existing line formula ------------------------------
check("line formula: -7 for this side -> P = Phi(7/16)", near(ctx.pgsLineProbability(-7), ctx.pgsNormalCdf(7 / 16)));
check("line formula clamps to 1-99%", ctx.pgsLineProbability(-60) === 0.99 && ctx.pgsLineProbability(60) === 0.01);
check("no line -> null", ctx.pgsLineProbability(null) === null);

// --- pgsLiveLineForCanonical ---------------------------------------------------------
const kick = "2026-10-31T19:30:00Z";
const cg = { id: 101, season: 2026, week: 9, awayTeam: "Auburn", homeTeam: "Georgia", awayId: 1, homeId: 2, startDate: kick, neutralSite: false };
ctx.state.lastGames = [{ id: "ev1", away: "Auburn Tigers", home: "Georgia Bulldogs", commence: "2026-10-31T19:30:00Z", books: { consensus: -9.5, draftkings: -10 } }];
check("live line read from the shared Odds API slate (state.lastGames), home perspective", ctx.pgsLiveLineForCanonical(cg) === -9.5);
ctx.state.book = "draftkings";
check("...with this device's sportsbook choice", ctx.pgsLiveLineForCanonical(cg) === -10);
ctx.state.book = "consensus";
ctx.state.lastGames = [{ id: "ev2", away: "Georgia Bulldogs", home: "Auburn Tigers", commence: kick, books: { consensus: 3.5 } }];
check("neutral site listed home/away-swapped: matched and flipped to CFBD's home perspective", ctx.pgsLiveLineForCanonical(cg) === -3.5);
ctx.state.lastGames = [{ id: "ev3", away: "Auburn Tigers", home: "Georgia Bulldogs", commence: "2026-12-05T20:00:00Z", books: { consensus: -2 } }];
check("a same-teams game 5 weeks away (a rematch) does not lend its line", ctx.pgsLiveLineForCanonical(cg) === null);
ctx.state.lastGames = [];
check("no live slate -> null", ctx.pgsLiveLineForCanonical(cg) === null);

// --- pgsSelectableSide keeps every source ------------------------------------------
ctx.cfbdRatings.push({ team: "Georgia", sp: { rating: 20 } }, { team: "Auburn", sp: { rating: 8 } });
ctx.state.lastGames = [{ id: "ev1", away: "Auburn", home: "Georgia", commence: kick, books: { consensus: -9.5 } }];
ctx.pgSurvivorEnrichment.wpByGame.set("101", { homeWinProbability: 0.8 });
ctx.pgSurvivorEnrichment.lineByGame.set("101", { homeSpread: -7 });
const home = ctx.pgsSelectableSide(cg, 9, true, "sec");
const away = ctx.pgsSelectableSide(cg, 9, false, "sec");
check("side carries the live line in its own perspective (home -9.5, away +9.5)", home.liveSpreadValue === -9.5 && away.liveSpreadValue === 9.5);
check("side carries the live-line probability", near(home.liveWinProbability, lineP(-9.5)) && near(away.liveWinProbability, lineP(9.5)));
check("side carries CFBD WP, CFBD line and SP+ separately", home.wpWinProbability === 0.8 && home.cfbdSpreadValue === -7
  && near(home.cfbdLineWinProbability, lineP(-7)) && home.spWinProbability > 0.5);
check("default (non-current-week) pricing unchanged: CFBD WP first, CFBD line shown", home.winProbability === 0.8 && home.probabilitySourceShort === "WP" && home.spreadValue === -7);

// --- pgsPriceCurrentWeek ------------------------------------------------------------
const NOW = Date.parse("2026-10-28T12:00:00Z");
const mk = (o) => Object.assign({ week: 9, completed: false, startDate: kick, winProbability: null, probabilitySourceShort: "—",
  spreadValue: null, spread: "—", liveSpreadValue: null, liveWinProbability: null, wpWinProbability: null,
  cfbdSpreadValue: null, cfbdLineWinProbability: null, spWinProbability: null }, o);
{
  const m = mk({ ...home });
  ctx.pgsPriceCurrentWeek([m], 9, NOW);
  check("current week + live line: shown line is the LIVE line (-9.5), not the CFBD -7", m.spreadValue === -9.5 && m.spread === "-9.5");
  check("...the % is derived from it with Phi(-line/16)", near(m.winProbability, lineP(-9.5)));
  check("...labelled Live", m.probabilitySourceShort === "Live" && /Live/.test(m.probabilitySource));
}
{
  const m = mk({ wpWinProbability: 0.8, cfbdSpreadValue: -7, cfbdLineWinProbability: lineP(-7), spWinProbability: 0.7 });
  ctx.pgsPriceCurrentWeek([m], 9, NOW);
  check("no live line -> CFBD pregame WP, with the CFBD line shown", m.probabilitySourceShort === "WP" && m.winProbability === 0.8 && m.spreadValue === -7);
}
{
  const m = mk({ cfbdSpreadValue: -7, cfbdLineWinProbability: lineP(-7), spWinProbability: 0.7 });
  ctx.pgsPriceCurrentWeek([m], 9, NOW);
  check("no live line, no WP -> the CFBD line and its %", m.probabilitySourceShort === "Line" && near(m.winProbability, lineP(-7)) && m.spreadValue === -7);
}
{
  const m = mk({ spWinProbability: 0.7 });
  ctx.pgsPriceCurrentWeek([m], 9, NOW);
  check("no live line, WP or CFBD line -> SP+", m.probabilitySourceShort === "SP+" && m.winProbability === 0.7 && m.spreadValue === null);
}
{
  const m = mk({ liveSpreadValue: -9.5, liveWinProbability: lineP(-9.5), wpWinProbability: 0.8, startDate: "2026-10-28T11:00:00Z" });
  ctx.pgsPriceCurrentWeek([m], 9, NOW);
  check("a game already under way is never priced from a live (in-game) line -> WP", m.probabilitySourceShort === "WP" && m.winProbability === 0.8);
}
{
  const other = mk({ week: 8, liveSpreadValue: -9.5, liveWinProbability: lineP(-9.5), wpWinProbability: 0.6, winProbability: 0.6, probabilitySourceShort: "WP" });
  const later = mk({ week: 10, liveSpreadValue: -9.5, liveWinProbability: lineP(-9.5), wpWinProbability: 0.6, spWinProbability: 0.55, winProbability: 0.6, probabilitySourceShort: "WP" });
  ctx.pgsPriceCurrentWeek([other, later], 9, NOW);
  check("past weeks untouched by current-week pricing", other.winProbability === 0.6 && other.probabilitySourceShort === "WP");
  ctx.pgsPreferSpForFutureWeeks([later], 9);
  check("future weeks still use SP+ even with a live line posted", later.probabilitySourceShort === "SP+" && later.winProbability === 0.55);
}
check("bad current week is a no-op", ctx.pgsPriceCurrentWeek([mk({ liveWinProbability: 0.9, winProbability: 0.5 })], NaN, NOW)[0].winProbability === 0.5);

// --- Wiring ------------------------------------------------------------------------
check("builder prices the current week, then future weeks, from ONE derived current week",
  /const currentWeek=derive\(matchups,wks,Date\.now\(\),30\);\s*pgsPriceCurrentWeek\(matchups,currentWeek\);\s*pgsPreferSpForFutureWeeks\(matchups,currentWeek\);/.test(src));
check("source counts include Live", /const bySource=\{Live:0,WP:0,'SP\+':0,Line:0,Missing:0\};/.test(src));
const rebuild = fn(integ, "pgSurvivorRebuildAfterLines");
check("rebuild after Refresh lines: local build + plans + render, no CFBD refetch",
  rebuild.includes("buildPickGaugeSurvivorData(") && rebuild.includes("pgSurvivorComputePlans();") && rebuild.includes("renderSurvivorShell();")
  && !/fetchTeamLogos|fetchCfbd|pgsEnsureSeasonEnrichment|pgSurvivorEnsureSharedData/.test(rebuild));
check("rebuild only runs when Survivor data is already loaded for the open pool", rebuild.includes("if(!pgSurvivorRuntime.dataByPool[poolId]||pgSurvivorRuntime.loadingByPool[poolId])return false;"));
const refresh = fn(odds, "refreshLines");
check("refreshLines() triggers the Survivor rebuild on each successful path (shared copy, paused copy, fresh lines)",
  (refresh.match(/rebuildSurvivorForLines\(\);/g) || []).length === 3);
check("...through tabs.js (the only Survivor-aware file outside Survivor), only once the lazy Survivor code has loaded",
  fn(odds, "rebuildSurvivorForLines").includes('typeof notifyLinesRefreshed==="function"') && !/pgSurvivor/.test(odds)
  && fn(tabs, "notifyLinesRefreshed").includes('pgSurvivorReady()&&typeof pgSurvivorRebuildAfterLines==="function"'));
check("Refresh lines is shown on Survivor (only Results hides it)", tabs.includes('document.body.classList.toggle("lines-refresh-hidden",name==="record");'));
check("Season Board and Week Rankings show 'Lines as of <time>'",
  (integ.match(/pgSurvivorLinesAsOfHTML\(/g) || []).length >= 3 && fn(integ, "pgSurvivorLinesAsOfHTML").includes("Lines as of ${esc(when)}"));
check("saved picks keep their pick-time probability (pick meta is written once, never overwritten)",
  /if\(entry\.pickMeta\[key\]\)return;/.test(integ));

if (failures.length) { console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures); process.exit(1); }
console.log(`\nAll ${total} checks passed.`);
