// Survivor cells showed "— SP+" for every week without a betting line, which
// read as "SP+ is broken" even though the percentage WAS the SP+ probability
// (Drew, Sept 23, 2026). The adapter now also exposes the SP+ projected
// spread, and the board shows it ("≈-6.5 SP+") when no real line exists.
// Runs the REAL extracted functions.
//
// Run with:  node tests/test_survivor_sp_projection.mjs
import fs from "node:fs";
import vm from "node:vm";

const adapter = fs.readFileSync(new URL("../app/js/survivor-data-adapter.js", import.meta.url), "utf8");
const integ = fs.readFileSync(new URL("../app/js/survivor-integration.js", import.meta.url), "utf8");
function fn(name, src) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`missing ${name}()`);
  let i = src.indexOf("{", start), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}
const consts = adapter.match(/const PG_SURVIVOR_HFA=[^;]+;/)[0] + "\n" + adapter.match(/const PG_SURVIVOR_MARGIN_SD=[^;]+;/)[0];
const ctx = {};
vm.createContext(ctx);
vm.runInContext([consts, ...["pgsFinite", "pgsClamp", "pgsErf", "pgsNormalCdf", "pgsSpProjectedMarginForSide", "pgsSpProbabilityForSide", "pgsSpreadText"].map((n) => fn(n, adapter)),
  fn("pgSurvivorSpreadLabel", integ)].join("\n"), ctx);

let fail = 0, total = 0;
const check = (n, c) => { total++; console.log(`[${c ? "PASS" : "FAIL"}] ${n}`); if (!c) fail++; };
const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;

// Margin
check("home team +10 SP+ better: margin = 10 + 2.6 HFA", near(ctx.pgsSpProjectedMarginForSide(20, 10, true, false), 12.6));
check("same game, away side: margin = -12.6", near(ctx.pgsSpProjectedMarginForSide(10, 20, false, false), -12.6));
check("neutral site: no HFA", near(ctx.pgsSpProjectedMarginForSide(20, 10, true, true), 10));
check("missing rating -> null (not 0)", ctx.pgsSpProjectedMarginForSide(null, 10, true, false) === null && ctx.pgsSpProjectedMarginForSide(5, "", true, false) === null);

// Probability unchanged by the refactor: same formula as before
const oldP = (tr, or, home, neutral) => { const hfa = neutral ? 0 : (home ? 2.6 : -2.6); return Math.max(0.01, Math.min(0.99, ctx.pgsNormalCdf(((tr - or) + hfa) / 16))); };
let same = true;
for (const [tr, or, h, n] of [[20, 10, true, false], [3, 25, false, false], [-5, -5, true, true], [30, -10, true, false], [0, 40, false, false]]) {
  if (!near(ctx.pgsSpProbabilityForSide(tr, or, h, n), oldP(tr, or, h, n), 1e-12)) same = false;
}
check("SP+ win probability identical to the pre-refactor formula (HFA 2.6, SD 16, clamped)", same);
check("SP+ probability still null when a rating is missing", ctx.pgsSpProbabilityForSide(null, 10, true, false) === null);

// Display label
const L = (m) => JSON.parse(JSON.stringify(ctx.pgSurvivorSpreadLabel(m)));
check("real betting line always wins", L({ spreadValue: -7, spread: "-7", spProjectedSpread: -12.6 }).text === "-7");
check("no line + SP+ projection -> '≈-12.5' (rounded to half point)", L({ spreadValue: null, spread: "—", spProjectedSpread: -12.6 }).text === "≈-12.5");
check("underdog projection shows '+'", L({ spreadValue: null, spProjectedSpread: 4.2 }).text === "≈+4");
check("near-zero projection shows PK", L({ spreadValue: null, spProjectedSpread: 0.02 }).text === "≈PK");
check("projection label explains itself in the tooltip", /SP\+ projected spread/.test(L({ spreadValue: null, spProjectedSpread: -3 }).title));
check("no line and no projection -> '—'", L({ spreadValue: null, spProjectedSpread: null }).text === "—" && L(null).text === "—");

// Fallback: matchup lacks spProjectedSpread -> derive from the same SP+ ratings
ctx.pgsRating = (team) => ({ Alabama: { sp: { rating: 20 } }, Auburn: { sp: { rating: 10 } } })[team] || null;
check("fallback derives ≈ from SP+ ratings when the field is missing (home fav: -(10+2.6) -> ≈-12.5)",
  L({ team: "Alabama", opponent: "Auburn", isHome: true, isNeutral: false, probabilitySourceShort: "SP+", spreadValue: null }).text === "≈-12.5");
check("fallback respects neutral site and away side", L({ team: "Auburn", opponent: "Alabama", isHome: false, isNeutral: true, probabilitySourceShort: "SP+", spreadValue: null }).text === "≈+10");
check("fallback does nothing when a rating is missing", L({ team: "Alabama", opponent: "Nobody", isHome: true, probabilitySourceShort: "SP+", spreadValue: null }).text === "—");
check("fallback only applies to SP+-sourced cells", L({ team: "Alabama", opponent: "Auburn", isHome: true, probabilitySourceShort: "WP", spreadValue: null }).text === "—");

// Wiring
check("adapter exposes spProjectedSpread (sign flipped to betting-line convention)", adapter.includes("spProjectedSpread:spMargin===null?null:-spMargin,"));
check("adapter keeps spreadValue as the real line only (projection never becomes the market line)", adapter.includes("spreadValue:sideLine,"));
check("Season Board cell uses pgSurvivorSpreadLabel()", integ.includes("${esc(pgSurvivorSpreadLabel(m).text)} <span class=\"survivor-cell-source\">"));
check("Week Rankings row uses pgSurvivorSpreadLabel()", integ.includes("· ${esc(pgSurvivorSpreadLabel(m).text)} · ${esc(m.probabilitySourceShort)}"));
check("no raw esc(m.spread) left in Survivor display code", !integ.includes("esc(m.spread)"));

console.log(`\n${total - fail}/${total} checks passed`);
if (fail) process.exit(1);
