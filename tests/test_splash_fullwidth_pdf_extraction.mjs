// Regression for Splash Team Pickem's full-width PDF layout. The real
// Grundy's Gang PDF places away pick, centered kickoff, and home pick across
// the same page. ESPN's generic "keep first two clusters" extraction dropped
// the home side. This executes the ACTUAL extractPdfTextLines() function with
// mocked pdf.js coordinates that mirror the real Splash row geometry.
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app/js/pool-contexts.js", import.meta.url), "utf8");
function extractAsyncFunction(name, src) {
  const marker = `async function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`Could not find ${name}`);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const code = extractAsyncFunction("extractPdfTextLines", source);
const ctx = { window: {}, File, Blob, console };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const item = (x, y, s, w = Math.max(10, s.length * 5)) => ({ transform: [1,0,0,1,x,y], width:w, str:s });
const pageItems = [
  item(24, 770, "Team Pickem | Splash Sports", 160),
  item(35, 600, "Picks lock: Thu, Sep 3, 2026, 7:00 PM", 230),
  // scoreboard row (should NOT lose the right side, but server later ignores it)
  item(75, 505, "COLO"), item(115, 505, "+6.5"), item(488, 505, "-6.5"), item(523, 505, "GT"),
  item(263, 500, "Thu, Sep 3 • 7:00 PM", 110),
  item(46, 472, "Winner", 40),
  // full pick button row: these are the authoritative team names/spreads
  item(82, 448, "Colorado", 46), item(129, 448, " ", 3), item(133, 448, "+6.5", 28),
  item(345, 448, "Georgia", 40), item(385, 448, " ", 3), item(388, 448, "Tech", 25), item(413, 448, " ", 3), item(416, 448, "-6.5", 28),
];
const fakePage = {
  view: [0,0,612,792],
  getTextContent: async () => ({ items: pageItems }),
  getViewport: () => ({ width:612 }),
};
const fakePdf = { numPages:1, getPage:async()=>fakePage };
const lib = { getDocument: () => ({ promise: Promise.resolve(fakePdf) }) };
ctx.window.pdfjsLib = lib; ctx.pdfjsLib = lib;
const fakeFile = new ctx.File([new ctx.Blob(["x"])], "splash.pdf", {type:"application/pdf"});
const lines = await ctx.extractPdfTextLines(fakeFile);

const checks = [
  ["detects Splash and keeps full team choice left", lines.includes("Colorado +6.5")],
  ["keeps full team choice right (old extractor dropped this)", lines.includes("Georgia Tech -6.5")],
  ["keeps kickoff metadata intact", lines.some(x => x.includes("Thu, Sep 3 • 7:00 PM"))],
  ["does not glue both full pick choices into one unusable line", !lines.includes("Colorado +6.5Georgia Tech -6.5")],
];
let failed=0;
for(const [name, ok] of checks){ console.log(`[${ok?'PASS':'FAIL'}] ${name}`); if(!ok) failed++; }
if(failed) process.exit(1);
console.log(`\n${checks.length}/${checks.length} checks passed`);
