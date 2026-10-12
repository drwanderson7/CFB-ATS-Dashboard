// Eliminated Survivor entries must read as DONE everywhere entries are
// compared: dropdown helper, Entry comparison, Pick grid, Entry correlation
// matrices and the Portfolio strategy wording. Runs the real functions.
import fs from "node:fs";
import vm from "node:vm";
const src = fs.readFileSync(new URL("../app/js/survivor-integration.js", import.meta.url), "utf8");
function extractFunction(name, source) {
  const start = source.indexOf(`function ${name}(`); if (start < 0) throw new Error(`missing ${name}`);
  let i = source.indexOf("{", start), depth = 0;
  for (; i < source.length; i++) { if (source[i] === "{") depth++; else if (source[i] === "}") { depth--; if (!depth) { i++; break; } } }
  return source.slice(start, i);
}
let total = 0; const failures = [];
const check = (n, c) => { total++; console.log(`[${c ? "PASS" : "FAIL"}] ${n}`); if (!c) failures.push(n); };

const entries = [{ id: "a", name: "Entry A" }, { id: "b", name: "Entry B" }, { id: "c", name: "Entry C" }];
const stats = {
  a: { wins: 6, losses: 0, pending: 1, eliminationWeek: null, status: { status: "alive", label: "ALIVE" } },
  b: { wins: 4, losses: 1, pending: 0, eliminationWeek: 5, status: { status: "eliminated", label: "ELIMINATED", detail: "Week 5 · Georgia L 20–24" } },
  c: { wins: 6, losses: 0, pending: 1, eliminationWeek: null, status: { status: "alive", label: "ALIVE" } },
};
const picks = { // B was eliminated W5 but still has saved picks for W6 (same team as A and C)
  a: { 5: "Texas", 6: "Ohio State" }, b: { 5: "Georgia", 6: "Ohio State" }, c: { 5: "Texas", 6: "Ohio State" },
};
entries.forEach(e => { e.picks = picks[e.id]; });
const data = { weeks: [5, 6], matchups: [
  { week: 5, team: "Texas", gameId: 1 }, { week: 5, team: "Georgia", gameId: 2 }, { week: 6, team: "Ohio State", gameId: 3 } ] };
const ctx = {
  console, Object, Array, Number, String, Math, Set, Map,
  esc: s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  pgSurvivorFmtPct: (p, d = 0) => (p == null || !Number.isFinite(Number(p))) ? "—" : `${(Number(p) * 100).toFixed(d)}%`,
  pgSurvivorCellClass: () => "", pgSurvivorData: () => data, pgSurvivorActualWeek: () => 6, pgSurvivorStartWeek: () => 1,
  pgSurvivorResult: () => null, pgSurvivorPickMeta: () => null,
  pgSurvivorEntryStats: e => stats[e.id], pgSurvivorEntryPlanFor: () => ({ coverageComplete: true, survivalProbability: .2 }),
  pgSurvivorEntryFutureAssets: () => ({ high: 3, top: [{ team: "Oregon", value: 5 }] }), pgSurvivorEntryUsedSet: () => new Set(["x"]),
};
vm.createContext(ctx);
vm.runInContext(["pgSurvivorEntryOutInfo", "pgSurvivorOutTagHTML", "pgSurvivorEntryComparisonStatsTableHTML",
  "pgSurvivorPickGridLastPlannedWeek", "pgSurvivorPickGridTableHTML", "pgSurvivorCorrCellStyle", "pgSurvivorCorrMatrixHTML"].map(n => extractFunction(n, src)).join("\n"), ctx);

const info = ctx.pgSurvivorEntryOutInfo(entries[1]);
check("out info for eliminated entry carries week + detail", info && info.week === 5 && /Georgia/.test(info.detail));
check("live entry has no out info", ctx.pgSurvivorEntryOutInfo(entries[0]) === null);
check("OUT tag shows week", /OUT W5/.test(ctx.pgSurvivorOutTagHTML(info)) && ctx.pgSurvivorOutTagHTML(null) === "");

const cmp = ctx.pgSurvivorEntryComparisonStatsTableHTML({ entries }, "a");
check("comparison: header tagged OUT", /survivor-out-tag/.test(cmp));
check("comparison: status says ELIMINATED with the loss", /ELIMINATED/.test(cmp) && /Georgia L 20–24/.test(cmp));
check("comparison: projected survival is 0% for the out entry", /<b>0%<\/b>/.test(cmp));
check("comparison: live entries keep their projection", (cmp.match(/20\.0%/g) || []).length === 2);
check("comparison: summary line says 2 of 3 alive", /2 of 3<\/b> entries are still alive/.test(cmp));
check("comparison: out column is dimmed class", /<td class="[^"]*\bout\b/.test(cmp));

const grid = ctx.pgSurvivorPickGridTableHTML({ entries });
check("grid: header tagged OUT", /<th scope="col" class="out">Entry B/.test(grid));
check("grid: out entry's week-6 cell is 'out'", /class="empty out"[^>]*>out</.test(grid));
check("grid: out entry's W5 pick still shown", /Georgia/.test(grid));
check("grid: shared marks count live entries only (W5 Texas x2 + W6 Ohio State x2 = 4, not 5)", (grid.match(/ shared"/g) || []).length === 4);
check("grid: legend explains out", /out = entry already eliminated/.test(grid));

const corr = { entries: [{ id: "a", name: "Entry A" }, { id: "b", name: "Entry B" }], cells: [[null, { samePick: .5, sharedPicks: [], sharedTeams: [], weeks: 2 }], [{ samePick: .5, sharedPicks: [], sharedTeams: [], weeks: 2 }, null]] };
const mx = ctx.pgSurvivorCorrMatrixHTML(corr, "samePick", "L", "h", { b: info });
check("correlation matrix: out entry tagged in header and row", (mx.match(/survivor-out-tag/g) || []).length === 2);
const mx2 = ctx.pgSurvivorCorrMatrixHTML(corr, "samePick", "L", "h");
check("correlation matrix: no tags when nobody is out", !/survivor-out-tag/.test(mx2));

check("portfolio: all-out wording present", /are eliminated or finished/.test(src) && /still alive\$\{analysis\.eliminatedCount/.test(src));
check("dropdown labels OUT + status note exists", /· OUT\$\{out\.week/.test(src) && /survivorEntryStatusNote/.test(src));
console.log(`\n${total - failures.length}/${total} checks passed`); process.exit(failures.length ? 1 : 0);
