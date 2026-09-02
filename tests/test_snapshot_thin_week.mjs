// Regression coverage for Snapshot's thin-week handling (UI review item #5).
//
// The problem: "Top Opportunities" is headed "Your strongest ATS edges this
// week" and unconditionally rendered the top 5 leans by rank -- so on a week
// where the model and market broadly agree, it filled all five slots with
// SLIM cards and presented them under that heading anyway. The stat strip
// directly beneath it would simultaneously read "STRONG EDGES 0 · GOOD
// EDGES 0", contradicting the heading immediately above.
//
// Fix: gate the cards on actually clearing the "good" threshold, adapt the
// heading when nothing does, and explain the shortfall in a note whose
// counts are guaranteed to match the stat strip (both are edgeClass-based).
// Also blocks the shareable "TOP 5 EDGES" export graphic on an all-slim
// week -- same overstatement, but published rather than on-screen.
import fs from "node:fs";

const src = fs.readFileSync(new URL("../app/js/snapshot-export.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/css/app.css", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

// --- the gate itself -----------------------------------------------------
check("Top Opportunities filters to leans that clear the edge threshold, rather than slicing the raw ranked list",
  /const qualifying=ranked\.filter\(r=>edgeClass\(r\.e\.pts\)!=="r"\);/.test(src));
check("the 5-card cap still applies on top of that filter",
  /const shown=qualifying\.slice\(0,5\);/.test(src));
check("the cards render from the gated list, not from `ranked` directly",
  src.includes("shown.length?shown.map((r,idx)=>") && !/snapOppGrid"\)\.innerHTML=ranked\.slice/.test(src));

// --- the gate is edgeClass-based so its counts can never contradict the
//     STRONG EDGES / GOOD EDGES tiles rendered right below it ------------
check("the qualifying bar uses edgeClass (same basis as computeWeekStats' strong/good tiles), not a separate threshold",
  /qualifying=ranked\.filter\(r=>edgeClass\(/.test(src));
check("computeWeekStats still derives strong/good from edgeClass too, so the note and the tiles stay in lockstep",
  /const cls=edgeClass\(r\.e\.pts\);\s*\n\s*if\(cls==="gd"\) strong\+\+; else if\(cls==="g"\) good\+\+;/.test(src));

// --- heading adapts ------------------------------------------------------
check("the heading has an id so it can be swapped at render time",
  html.includes('id="snapOppTitle"'));
check("the heading drops the 'your strongest edges' claim when nothing qualifies",
  src.includes('"No standout edges this week"'));
check("the heading is restored to the normal wording whenever something does qualify",
  src.includes('"Your strongest ATS edges this week"'));
check("the heading only changes when leans EXIST but none qualify -- an empty slate keeps the normal heading, since its own empty state covers it",
  /\(allRows\.length&&!qualifying\.length\)/.test(src));

// --- the shortfall note --------------------------------------------------
check("a note element exists in the markup, hidden by default",
  html.includes('id="snapOppThinNote"') && /id="snapOppThinNote"[^>]*style="display:none;"/.test(html));
check("the note states how many games cleared the bar when it's a partial week",
  /clears? the edge bar this week/.test(src));
check("the note points the user to the full slate rather than dead-ending",
  src.includes("<b>Top games</b> below"));
check("the note is hidden when a full five qualify (no nagging on a normal week)",
  /\}else\{\s*\n\s*noteEl\.style\.display="none";\s*\n\s*\}/.test(src));
check("the note is hidden when there are no leans at all, so it can't stack on top of the empty state",
  /if\(!allRows\.length\)\{[\s\S]{0,240}?noteEl\.style\.display="none";/.test(src));

// --- no duplicated messaging (a real bug caught in review) ---------------
check("the grid renders NOTHING when leans exist but none qualify -- the note above already explains it, and an earlier pass said it twice",
  /\}\)\.join\(""\) : \(allRows\.length\s*\n[\s\S]{0,320}?\? ""/.test(src));
check("the genuinely-empty case still keeps its own actionable 'refresh lines' message",
  src.includes("No games with a live lean yet — refresh lines or load model predictions."));

// --- shareable export can't overclaim either -----------------------------
check("the 'TOP 5 EDGES' export is blocked when no game clears the bar",
  /!rows\.some\(r=>edgeClass\(r\.e\.pts\)!=="r"\)/.test(src));
check("the blocked export explains why instead of failing silently",
  src.includes("No standout edges to export"));
check("the export block sits AFTER the existing empty-rows guard, so a truly empty slate still gets its own distinct message",
  src.indexOf("Nothing to export") < src.indexOf("No standout edges to export"));

// --- styling -------------------------------------------------------------
check("the note has real styling", css.includes(".snap-opp-thin-note{"));

console.log("");
console.log(`${total - failures.length}/${total} checks passed`);
if (failures.length) {
  console.log("FAILED:");
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
