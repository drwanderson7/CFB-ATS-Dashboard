// Weeks after the current pool week use SP+ (not CFBD pregame WP) as the win
// probability; the current week keeps WP (Drew, Oct 12, 2026). Real function.
import fs from "node:fs"; import vm from "node:vm";
const src = fs.readFileSync(new URL("../app/js/survivor-data-adapter.js", import.meta.url), "utf8");
function fn(name) {
  const st = src.indexOf(`function ${name}(`); if (st < 0) throw new Error(name);
  let i = src.indexOf("{", st), d = 0; for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (!d) { i++; break; } } }
  return src.slice(st, i);
}
const ctx = { Number, Array, Math }; vm.createContext(ctx); vm.runInContext(fn("pgsPreferSpForFutureWeeks"), ctx);
let t = 0, f = 0; const ck = (n, c) => { t++; console.log(`[${c ? "PASS" : "FAIL"}] ${n}`); if (!c) f++; };
const mk = (week, wp, sp) => ({ week, winProbability: wp, spWinProbability: sp, probabilitySource: "CFBD Pregame WP via PickGauge shared CFBD", probabilitySourceShort: wp == null ? "—" : "WP" });
const ms = [mk(5, .90, .80), mk(6, .95, .70), mk(7, .60, .66), mk(8, null, .55), mk(9, .88, null)];
ctx.pgsPreferSpForFutureWeeks(ms, 5);
ck("current week keeps WP", ms[0].winProbability === .90 && ms[0].probabilitySourceShort === "WP");
ck("future week switches to SP+ number", ms[1].winProbability === .70 && ms[1].probabilitySourceShort === "SP+");
ck("future week label/source updated", /SP\+/.test(ms[2].probabilitySource) && ms[2].winProbability === .66);
ck("future week with no WP still uses SP+", ms[3].winProbability === .55 && ms[3].probabilitySourceShort === "SP+");
ck("future week with no SP+ keeps WP fallback", ms[4].winProbability === .88 && ms[4].probabilitySourceShort === "WP");
const past = [mk(3, .5, .9)]; ctx.pgsPreferSpForFutureWeeks(past, 5);
ck("past weeks untouched", past[0].winProbability === .5);
ck("bad current week is a no-op", ctx.pgsPreferSpForFutureWeeks([mk(9, .5, .9)], NaN)[0].winProbability === .5);
ck("wired into the builder before counts", /pgsPreferSpForFutureWeeks\(matchups,derive\(/.test(src) && src.indexOf("pgsPreferSpForFutureWeeks(matchups,derive") < src.indexOf("const modeled=matchups.filter"));
console.log(`\n${t - f}/${t} checks passed`); process.exit(f ? 1 : 0);
