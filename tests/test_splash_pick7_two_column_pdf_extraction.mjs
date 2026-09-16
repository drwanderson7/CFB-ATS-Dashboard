// Regression for Splash's "Edit picks" pick-7 two-column PDF export.
// Real CFB_Splash_Pick_7_Wk_3_2026.pdf: two complete game cards share each
// row (like Madwood's Team Pickem export), but this template has NO
// "Winner" marker anywhere and none of the original strongSplashSignal
// phrases -- it only says "Edit picks" / "Make your picks" / "Spread
// finalized" -- and each pick button is "TeamName(+spread)" directly, not
// "TeamName +spread" on a separate line. Before the Sept 15, 2026 fix,
// isSplashPage never resolved true for this shape, so it fell into the
// ESPN-oriented branch, which crops anything past 60% of page width as a
// sidebar -- silently deleting the entire right-hand game card on every
// row (confirmed against the real PDF: only left-column games survived,
// landing right around the 26 games Drew saw out of ~57 real games).
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
  // This template's own real signal phrases -- no "Splash Sports"/"Team
  // Pickem"/"Winner" anywhere on the whole document.
  item(40,780,"Edit picks",70),
  item(40,760,"Make your picks",100),
  item(40,745,"Spread finalized | Picks lock: At the start of each game",380),
  // Header + "Preview" link for each of the two cards sharing this row --
  // the only twin-column signal available on this template.
  item(60,650,"Thu, Sep 17 • 6:30 PM",140), item(330,650,"Preview",44),
  item(420,650,"Fri, Sep 18 • 6:30 PM",140), item(700,650,"Preview",44),
  // Left card: away team + spread glued in parens, then record, then home.
  item(88,625,"Syracuse",56), item(146,625,"(+9.5)",44),
  item(88,610,"(1-1-0)",50),
  item(88,595,"Pittsburgh",62), item(152,595,"(-9.5)",44),
  item(88,580,"(2-0-0)",50),
  // Right card: same shape, real away/home names with a real paren in one.
  item(447,625,"Miami (FL)",70), item(519,625,"(-20.5)",50),
  item(447,610,"(2-0-0)",50),
  item(447,595,"Wake Forest",68), item(517,595,"(+20.5)",50),
  item(447,580,"(2-0-0)",50),
  item(40,560,"0/7 picks made",90),
];
const pages=[page1].map(items=>({
  view:[0,0,792,792],
  getTextContent:async()=>({items}),
  getViewport:()=>({width:792}),
}));
const fakePdf={numPages:pages.length,getPage:async n=>pages[n-1]};
const lib={getDocument:()=>({promise:Promise.resolve(fakePdf)})};
ctx.window.pdfjsLib=lib; ctx.pdfjsLib=lib;
const fakeFile=new ctx.File([new ctx.Blob(["x"])],"pick7.pdf",{type:"application/pdf"});
const lines=await ctx.extractPdfTextLines(fakeFile);
const joined=lines.join("\n");

const checks=[
  ["left-hand game card is preserved", joined.includes("Syracuse") && joined.includes("Pittsburgh")],
  ["right-hand game card is NOT dropped as a sidebar", joined.includes("Wake Forest") && joined.includes("(-20.5)")],
  ["right-hand away team survives too", joined.includes("Miami (FL)")],
  ["both kickoff headers survive", joined.includes("Thu, Sep 17") && joined.includes("Fri, Sep 18")],
  ["left lane is emitted before right lane", lines.findIndex(l=>l.includes("Syracuse")) < lines.findIndex(l=>l.includes("Miami (FL)"))],
];
let failed=0;
for(const [name,ok] of checks){ console.log(`[${ok?'PASS':'FAIL'}] ${name}`); if(!ok) failed++; }
if(failed) process.exit(1);
console.log(`\n${checks.length}/${checks.length} checks passed`);
