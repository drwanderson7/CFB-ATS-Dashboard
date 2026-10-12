// Season Board drops teams already used in a FINISHED week (Drew, Oct 12, 2026).
import fs from "node:fs"; import vm from "node:vm";
const src = fs.readFileSync(new URL("../app/js/survivor-integration.js", import.meta.url), "utf8");
function fn(name) { const st = src.indexOf(`function ${name}(`); if (st < 0) throw new Error(name);
  let i = src.indexOf("{", st), d = 0; for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (!d) { i++; break; } } } return src.slice(st, i); }
const ctx = { Set, Object, Array, Number }; vm.createContext(ctx); vm.runInContext(fn("pgSurvivorPastUsedTeams"), ctx);
let t = 0, f = 0; const ck = (n, c) => { t++; console.log(`[${c ? "PASS" : "FAIL"}] ${n}`); if (!c) f++; };
const L = (...a) => [...ctx.pgSurvivorPastUsedTeams(...a)].sort().join();
const picks = { 1: "Alabama", 2: "Georgia", 5: "Tennessee", 6: "Texas" };
ck("finished weeks count (W1, W2 when current is W5)", L(picks, 5, 1) === "Alabama,Georgia");
ck("the current week's pick does NOT count", !L(picks, 5, 1).includes("Tennessee"));
ck("planned future picks do NOT count", !L(picks, 5, 1).includes("Texas"));
ck("next week: W5 is now finished", L(picks, 6, 1) === "Alabama,Georgia,Tennessee");
ck("two-pick pools (arrays) work", L({ 1: ["A", "B"], 2: ["C", "A"] }, 3, 1) === "A,B,C");
ck("weeks before the pool's start week are ignored", L({ 1: "Old", 3: "New" }, 5, 3) === "New");
ck("empty / bad input is safe", L(null, 5, 1) === "" && L({}, NaN, 1) === "" && L({ 1: "" , 2: null }, 5, 1) === "");
ck("board filters rows by it, with a Show/Hide link", /allTeams\.filter\(t=>!burned\.has\(t\)\)/.test(src) && /data-survivor-toggle-used/.test(src));
ck("choice stored per pool in device-local ui (showUsedByPool)", /showUsedByPool:\(raw\.showUsedByPool/.test(src));
console.log(`\n${t - f}/${t} checks passed`); process.exit(f ? 1 : 0);
