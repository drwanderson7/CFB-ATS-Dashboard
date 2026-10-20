// Cover % math review (Oct 14, 2026): centered, continuous, symmetric, ties split.
// Runs the REAL probabilityCoverForGame() against the real cover table.
import fs from "node:fs"; import vm from "node:vm";
const model = fs.readFileSync(new URL("../app/js/model.js", import.meta.url), "utf8");
const table = fs.readFileSync(new URL("../app/data/cover-table.js", import.meta.url), "utf8");
function fn(name) { const st = model.indexOf(`function ${name}(`); if (st < 0) throw new Error(name);
  let i = model.indexOf("{", st), d = 0; for (; i < model.length; i++) { if (model[i] === "{") d++; else if (model[i] === "}") { d--; if (!d) { i++; break; } } } return model.slice(st, i); }
const ctx = { Math, Number, Object, String }; vm.createContext(ctx);
vm.runInContext(table + "\nconst BREAKEVEN_WINPCT=0.5238;const PG_COVER_BUCKET_MEANS={};\n" +
  ["bucketForSpread", "coverBucketMean", "pgUniformAbove", "probabilityCoverForGame"].map(fn).join("\n") + "\nthis.P=probabilityCoverForGame;", ctx);
let t = 0, f = 0; const ck = (n, c) => { t++; console.log(`[${c ? "PASS" : "FAIL"}] ${n}`); if (!c) f++; };
const P = (M, V) => ctx.P(M, V);

// 1. Continuous + monotonic in the edge (no jumps from Model # decimals)
for (const V of [-7.5, -7, -3, -14, -21.5, 2.5]) {
  let prev = -1, maxJump = 0, mono = true;
  for (let e = 0.1; e <= 12.0001; e += 0.1) {
    const p = P(V - e, V).pCover; if (p < prev - 1e-12) mono = false;
    if (prev >= 0) maxJump = Math.max(maxJump, p - prev); prev = p;
  }
  ck(`V=${V}: Cover % rises steadily with a bigger edge (no dips)`, mono);
  ck(`V=${V}: no jump bigger than 0.6 pts per 0.1-pt edge (was up to ~1 pt)`, maxJump < 0.006);
}
// 2. Symmetric: same edge on home or away -> same %
let sym = true;
for (const V of [-7.5, -7, -3, -10, 4.5, -24]) for (const e of [0.5, 1.3, 3, 6.2]) {
  const h = P(V - e, V), a = P(V + e, V);
  if (Math.abs(h.pCover - a.pCover) > 1e-9 || h.side !== "home" || a.side !== "away") sym = false;
}
ck("equal home/away edges give identical Cover % (bucket tilt removed)", sym);
// 3. Tiny edge ~ coin flip (centered buckets)
ck("half-point line, 0.1-pt edge -> ~50% (within 0.5)", Math.abs(P(-7.6, -7.5).pCover - 0.5) < 0.005);
ck("whole line, 0.01-pt edge -> cover ~= loss (within 0.2)", Math.abs(P(-7.01, -7).pCover - P(-7.01, -7).pLoss) < 0.002);
// 4. Ties: half-point lines never push and probabilities sum to 1; whole lines have push mass
let sums = true, halfNoPush = true, wholePush = true;
for (const V of [-7.5, -3.5, -10.5, -7, -3, -14]) for (const e of [0.5, 1, 2, 2.5, 3.3, 7]) {
  const r = P(V - e, V);
  if (Math.abs(r.pCover + r.pPush + r.pLoss - 1) > 1e-9) sums = false;
  if (!Number.isInteger(V) && r.pPush !== 0) halfNoPush = false;
  if (Number.isInteger(V) && !(r.pPush > 0.005)) wholePush = false;
}
ck("cover + push + loss = 1 everywhere", sums);
ck("half-point lines: push is exactly 0", halfNoPush);
ck("whole-number lines: push no longer vanishes when Model # has a decimal", wholePush);
ck("the old exact-tie dip is gone (-9.5 < -10 < -10.5 on a -7.5 line)", P(-9.5, -7.5).pCover < P(-10, -7.5).pCover && P(-10, -7.5).pCover < P(-10.5, -7.5).pCover);
// 5. EV unchanged in form
const r = P(-9.3, -7);
ck("EV = cover*0.9091 - loss (push refunds)", Math.abs(r.ev - (r.pCover * 0.9091 - r.pLoss)) < 1e-12);
ck("probEdge = cover - 52.38%", Math.abs(r.probEdge - (r.pCover - 0.5238)) < 1e-12);
ck("no edge -> 50/50, side null", P(-7, -7).side === null && P(-7, -7).pCover === 0.5);
ck("missing input -> null", P(null, -7) === null && P(-7, null) === null);
console.log(`\n${t - f}/${t} checks passed`); process.exit(f ? 1 : 0);
