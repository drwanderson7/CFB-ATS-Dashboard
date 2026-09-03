// Structural regression tests for the Sept 3, 2026 ATS navigation refactor:
// Edge Board + My Picks + Pools remain separate implementation panels, but
// are exposed as one top-level Pick Board destination with three subviews.
// Existing switchTab("board"|"picks"|"pools") call sites must keep working
// and land on the corresponding Pick Board subview.
import fs from "node:fs";

const ROOT = new URL("../", import.meta.url);
const html = fs.readFileSync(new URL("app/index.html", ROOT), "utf8");
const tabs = fs.readFileSync(new URL("app/js/tabs.js", ROOT), "utf8");
const init = fs.readFileSync(new URL("app/js/init.js", ROOT), "utf8");
const css = fs.readFileSync(new URL("app/css/app.css", ROOT), "utf8");

const failures=[];
let total=0;
function check(name,cond){
  total++;
  console.log(`[${cond?"PASS":"FAIL"}] ${name}`);
  if(!cond) failures.push(name);
}

// Top-level IA: Snapshot | Pick Board | Confidence | Survivor | Results.
const navMatch=html.match(/<nav class="tabs" id="navTabs">([\s\S]*?)<\/nav>/);
const nav=navMatch?navMatch[1]:"";
check("top nav exposes Pick Board", /data-tab="pickboard"[^>]*>Pick Board<\/button>/.test(nav));
check("top nav no longer exposes Edge Board as its own tab", !/data-tab="board"/.test(nav));
check("top nav no longer exposes My Picks as its own tab", !/data-tab="picks"/.test(nav));
check("top nav no longer exposes Pools as its own tab", !/data-tab="pools"/.test(nav));
check("top nav keeps Confidence", /data-tab="confidence"/.test(nav));
check("top nav keeps Survivor", /data-tab="survivor"/.test(nav));
check("top nav keeps Results", /data-tab="record"[^>]*>Results<\/button>/.test(nav));
check("Confidence appears before Survivor in the simplified product nav",
  nav.indexOf('data-tab="confidence"') < nav.indexOf('data-tab="survivor"'));

// Internal Pick Board subviews.
check("Pick Board shell exists", html.includes('id="pickBoardShell"'));
for(const [view,label] of [["board","This Week"],["picks","My Picks"],["pools","Pool Settings"]]){
  check(`Pick Board exposes ${label} subview`,
    new RegExp(`data-pickboard-view="${view}"[^>]*[^<]*>${label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}<\\/button>`).test(html));
}

// Legacy implementation ids stay intact so mature ATS renderers are not
// rewritten just to change IA.
for(const id of ["tab-board","tab-picks","tab-pools"]){
  check(`${id} implementation panel remains present`, html.includes(`id="${id}"`));
}

// Alias routing is the safety-critical piece: old deep links/call sites map
// into Pick Board, while panelName chooses the real internal panel.
check("tabs.js defines the three Pick Board implementation views",
  /const PICK_BOARD_VIEWS=new Set\(\["board","picks","pools"\]\)/.test(tabs));
check("switchTab aliases board/picks/pools to top-level pickboard",
  /if\(PICK_BOARD_VIEWS\.has\(name\)\)\{ pickBoardView=name; name="pickboard"; \}/.test(tabs));
check("switchTab resolves the actual internal panel from pickBoardView",
  /const panelName=name==="pickboard"\?pickBoardView:name;/.test(tabs));
check("top-level active styling uses canonical Pick Board name",
  /b\.dataset\.tab===name/.test(tabs));
check("panel activation uses panelName rather than the top-level name",
  /p\.id==="tab-"\+panelName/.test(tabs));
check("Pick Board shell is refreshed on every switch",
  /renderPickBoardShell\(name\)/.test(tabs));
check("subview buttons call switchPickBoardView",
  /b\.onclick=\(\)=>switchPickBoardView\(b\.dataset\.pickboardView\)/.test(tabs));
check("init wires Pick Board subnav",
  init.split("\n").some(line=>/\binitPickBoardNav\(\)/.test(line)&&!line.trim().startsWith("//")));

// Responsive styling exists; mobile should keep all 3 subviews readable.
check("Pick Board shell has dedicated styling", /\.pickboard-shell\{/.test(css));
check("mobile Pick Board subnav becomes a 3-column grid",
  /@media\(max-width:720px\)\{[\s\S]*?\.pickboard-subnav\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(css));

console.log(failures.length?`\n${failures.length} of ${total} checks FAILED:`:`\nAll ${total} checks passed.`);
for(const f of failures) console.log(" -",f);
if(failures.length) process.exit(1);
