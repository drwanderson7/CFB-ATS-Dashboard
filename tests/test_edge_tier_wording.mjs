// One vocabulary for edge tiers (Oct 21, 2026).
//
// The board and This Week call the tiers Slim / Good / Strong (edgeClass /
// edgeTierLabel in app/js/model.js). Settings used to label the lower cutoff
// "Green edge >=", naming a color instead of the tier. This pins:
//   * Settings says "Good edge >=" / "Strong edge >=" (labels + aria-labels),
//   * no user-facing text anywhere says "green edge",
//   * the All Games legend and the Help glossary use exactly the words
//     edgeTierLabel() returns (run for real below), and
//   * the storage keys did NOT change: the inputs are still #goodThresh /
//     #strongThresh, wired to state.goodThresh / state.strongThresh, with the
//     same defaults -- so nobody loses saved values.
//
// Run with:
//     node tests/test_edge_tier_wording.mjs
import fs from "node:fs";
import vm from "node:vm";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const html = read("app/index.html");
const model = read("app/js/model.js");
const init = read("app/js/init.js");
const main = read("app/js/main.js");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

// ---- The real tier words, from model.js ------------------------------------
const fnSrc = ["edgeClass", "edgeTierLabel"].map((n) => {
  const m = model.match(new RegExp(`function ${n}\\(pts\\)\\{[\\s\\S]*?\\n\\}`));
  return m ? m[0] : "";
}).join("\n");
const ctx = { state: { goodThresh: 1.5, strongThresh: 3 } };
vm.createContext(ctx);
vm.runInContext(`${fnSrc};this.tier=edgeTierLabel;`, ctx);
const words = { strong: ctx.tier(3.2), good: ctx.tier(2), slim: ctx.tier(0.5) };
check("edgeTierLabel() returns Strong / Good / Slim (the vocabulary everything else must match)",
  words.strong === "Strong" && words.good === "Good" && words.slim === "Slim");
ctx.state.goodThresh = 1; ctx.state.strongThresh = 2;
check("the Good / Strong cutoffs come from state.goodThresh / state.strongThresh", ctx.tier(1) === "Good" && ctx.tier(2) === "Strong" && ctx.tier(0.9) === "Slim");

// ---- Settings ---------------------------------------------------------------
check(`Settings labels the lower cutoff "${words.good} edge ≥"`, html.includes(`<span class="field-lbl">${words.good} edge ≥</span>`));
check(`Settings labels the upper cutoff "${words.strong} edge ≥"`, html.includes(`<span class="field-lbl">${words.strong} edge ≥</span>`));
check("screen readers hear the same names (aria-labels)",
  /id="goodThresh"[^>]*aria-label="Good edge threshold"/.test(html) && /id="strongThresh"[^>]*aria-label="Strong edge threshold"/.test(html));

const uiSources = ["app/index.html", ...fs.readdirSync(new URL("../app/js", import.meta.url)).map((f) => `app/js/${f}`),
  ...fs.readdirSync(new URL("..", import.meta.url)).filter((f) => f.endsWith(".html"))];
// Strip JS line comments and HTML comments: only text a person can see counts.
const visible = (src) => src.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");
const green = uiSources.filter((f) => /green edge/i.test(visible(read(f))));
check('no user-facing text says "green edge" any more', green.length === 0);

// ---- All Games legend + Help ------------------------------------------------
check("the All Games legend reads Strong / Good / Slim, the edgeTierLabel() words",
  html.includes(`<i class="dot gd"></i>${words.strong}</span>`) && html.includes(`<i class="dot g"></i>${words.good}</span>`)
  && html.includes(`<i class="dot r"></i>${words.slim}</span>`));
check("the legend's lowercase strong/good/slim versions are gone", !/<\/i>(strong|good|slim)<\/span>/.test(html));
check("the Help glossary entry is titled Strong / Good / Slim", html.includes(`<summary>${words.strong} / ${words.good} / ${words.slim}</summary>`));
check("Help explains Strong and Good with the Settings names and defaults",
  html.includes("<b>Strong</b> is an edge at or above your <b>Strong edge</b> setting (3 points by default)")
  && html.includes("<b>Good</b> is at or above your <b>Good edge</b> setting (1.5 points by default)"));
check("Help no longer says 'higher / normal edge threshold'", !/(higher|normal) edge threshold/.test(html));

// ---- Storage unchanged ------------------------------------------------------
check("the inputs keep their ids (#goodThresh / #strongThresh)", html.includes('id="goodThresh"') && html.includes('id="strongThresh"'));
check("the inputs still save to state.goodThresh / state.strongThresh",
  /getElementById\("goodThresh"\)\.onchange=e=>\{ state\.goodThresh=Number\(e\.target\.value\);/.test(init)
  && /getElementById\("strongThresh"\)\.onchange=e=>\{ state\.strongThresh=Number\(e\.target\.value\);/.test(init));
check("saved values load back into the inputs", /getElementById\("goodThresh"\)\.value=state\.goodThresh;/.test(init));
check("after the startup account pull, the boxes are refilled with the account's saved values (not left at pre-pull defaults)",
  /await pullState\(false\);[\s\S]{0,2000}renderSystemsSettings\(\);[\s\S]{0,250}getElementById\("goodThresh"\)\.value=state\.goodThresh;\s*document\.getElementById\("strongThresh"\)\.value=state\.strongThresh;/.test(init));
check("defaults unchanged (Good 1.5, Strong 3), and an existing saved value is kept",
  main.includes("s.goodThresh=(s.goodThresh!=null)?s.goodThresh:1.5;") && main.includes("s.strongThresh=(s.strongThresh!=null)?s.strongThresh:3;"));

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
