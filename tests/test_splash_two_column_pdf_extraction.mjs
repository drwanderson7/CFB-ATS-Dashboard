// Regression for Splash's brandless two-column desktop Team Pickem PDF.
// Real Madwood Week 1 2026 export: two complete game cards share each row,
// the PDF text layer omits "Splash Sports" / "Team Pickem", and the sticky
// Week scroller overlaps Tulane/Duke + Baylor/Auburn pick-button text.
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

const item = (x, y, s, w = Math.max(4, s.length * 5)) => ({ transform:[1,0,0,1,x,y], width:w, str:s });
const page1 = [
  item(40,760,"Make bulk picks",70),
  item(40,735,"Picks lock: Mon, Sep 7, 2026, 6:30 PM",220),
  // Two Winner markers prove this is the two-card desktop layout.
  item(53,650,"Winner",34), item(351,650,"1 Point",32),
  item(412,650,"Winner",34), item(710,650,"1 Point",32),
  // Full pick choices for left card.
  item(88,625,"Colorado",47), item(139,625,"+6.5",22),
  item(255,625,"Georgia Tech",66), item(327,625,"-6.5",22),
  // Full pick choices for right card.
  item(447,625,"UAB",22), item(474,625,"+27.5",27),
  item(614,625,"Illinois",35), item(652,625,"-27.5",27),
  // Kickoffs for each card.
  item(173,680,"Thu, Sep 3 • 7:00 PM",110),
  item(528,680,"Thu, Sep 3 • 8:00 PM",110),
];
const page2 = [
  item(53,520,"Winner",34), item(351,520,"1 Point",32),
  item(412,520,"Winner",34), item(710,520,"1 Point",32),
  // Sticky week-nav labels just above the real pick row.
  item(54,507,"Week",25), item(82,507,"1",5), item(149,507,"Week",25), item(177,507,"2",5),
  item(244,507,"Week",25), item(272,507,"3",5), item(339,507,"Week",25), item(367,507,"4",5),
  item(435,507,"Week",25), item(463,507,"5",5), item(530,507,"Week",25), item(558,507,"6",5),
  item(625,507,"Week",25), item(653,507,"7",5), item(721,507,"Week",25), item(749,507,"8",5),
  // Nav date fragments overlap the ACTUAL team/spread baseline (~12 px lower).
  item(54,495,"Sep",15), item(71,495,"3 -",12), item(84,495,"Sep",15), item(101,495,"7",5),
  item(149,495,"Sep",15), item(166,495,"11 -",15), item(183,495,"Sep",15), item(200,495,"12",8),
  item(435,495,"Sep",15), item(452,495,"28 -",16), item(470,495,"Oct",15), item(487,495,"5",5),
  item(530,495,"Oct",15), item(547,495,"5 -",12), item(561,495,"Oct",15), item(578,495,"12",8),
  // Real team names/spreads sharing that baseline.
  item(88,494,"Tulane",35), item(127,495,"+7.5",22), item(255,494,"Duke",27), item(286,495,"-7.5",22),
  item(447,494,"Baylor",34), item(484,495,"+7.5",22), item(614,494,"Auburn",38), item(656,495,"-7.5",22),
  item(171,548,"Sat, Sep 5 • 2:30 PM",110),
  item(530,548,"Sat, Sep 5 • 2:30 PM",110),
];
const pages=[page1,page2].map(items=>({
  view:[0,0,792,792],
  getTextContent:async()=>({items}),
  getViewport:()=>({width:792}),
}));
const fakePdf={numPages:pages.length,getPage:async n=>pages[n-1]};
const lib={getDocument:()=>({promise:Promise.resolve(fakePdf)})};
ctx.window.pdfjsLib=lib; ctx.pdfjsLib=lib;
const fakeFile=new ctx.File([new ctx.Blob(["x"])],"madwood.pdf",{type:"application/pdf"});
const lines=await ctx.extractPdfTextLines(fakeFile);

const checks=[
  ["brandless Splash UI signal preserves right-hand game card", lines.includes("UAB +27.5 Illinois -27.5")],
  ["left-hand game card remains parseable", lines.includes("Colorado +6.5 Georgia Tech -6.5")],
  ["sticky week scroller does not corrupt Tulane/Duke", lines.includes("Tulane +7.5 Duke -7.5")],
  ["sticky week scroller does not corrupt Baylor/Auburn", lines.includes("Baylor +7.5 Auburn -7.5")],
  ["nav dates are not glued into Tulane/Duke line", !lines.some(x=>x.includes("SepTulane")||x.includes("Tulane 7 +7.5 Sep"))],
  ["left lane is emitted before right lane so page continuations stay within a game lane", lines.indexOf("Tulane +7.5 Duke -7.5") < lines.indexOf("UAB +27.5 Illinois -27.5")],
];
let failed=0;
for(const [name,ok] of checks){ console.log(`[${ok?'PASS':'FAIL'}] ${name}`); if(!ok) failed++; }
if(failed) process.exit(1);
console.log(`\n${checks.length}/${checks.length} checks passed`);
