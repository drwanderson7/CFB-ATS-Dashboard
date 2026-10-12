// "Hide eliminated entries" visibility rule -- real extracted function.
import fs from "node:fs"; import vm from "node:vm";
const src = fs.readFileSync(new URL("../app/js/survivor-integration.js", import.meta.url), "utf8");
function fn(name) { const st = src.indexOf(`function ${name}(`); if (st < 0) throw new Error(name);
  let i = src.indexOf("{", st), d = 0; for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (!d) { i++; break; } } } return src.slice(st, i); }
const ctx = { Array }; vm.createContext(ctx); vm.runInContext(fn("pgSurvivorVisibleEntries"), ctx);
let t = 0, f = 0; const ck = (n, c) => { t++; console.log(`[${c ? "PASS" : "FAIL"}] ${n}`); if (!c) f++; };
const E = [{ id: "a" }, { id: "b" }, { id: "c" }], out = e => e.id === "b";
const ids = a => a.map(e => e.id).join();
ck("off: everyone shown", ids(ctx.pgSurvivorVisibleEntries(E, false, out, null)) === "a,b,c");
ck("on: eliminated entry removed", ids(ctx.pgSurvivorVisibleEntries(E, true, out, null)) === "a,c");
ck("on + keepId: the active eliminated entry stays in the dropdown", ids(ctx.pgSurvivorVisibleEntries(E, true, out, "b")) === "a,b,c");
ck("on: never hides everyone (all eliminated -> all shown)", ids(ctx.pgSurvivorVisibleEntries(E, true, () => true, null)) === "a,b,c");
ck("bad input -> empty list, no crash", ctx.pgSurvivorVisibleEntries(null, true, out, null).length === 0);
ck("ui state defaults and normalizes hideOutByPool", /hideOutByPool:\(raw\.hideOutByPool&&typeof raw\.hideOutByPool==='object'/.test(src));
ck("History sections use the filtered entries", (src.match(/entries:pgSurvivorHistoryEntries\(pool\)/g) || []).length === 3);
ck("click handler wired", /data-survivor-toggle-out\]'\)\)\{pgSurvivorToggleHideOut/.test(src));
console.log(`\n${t - f}/${t} checks passed`); process.exit(f ? 1 : 0);
