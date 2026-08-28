// Structural regression test for the Settings "Live odds & display
// settings" card. Real gap fix: the personal API key field used to sit
// permanently open at the top of this card, reading as "step one" even
// after the shared-connection copy was corrected to say it's optional --
// the shared ODDS_API_KEY now covers everyone by default (see
// api/fetch_odds.py's module docstring), so a field almost nobody needs
// shouldn't be the first thing this card shows. Tucked behind a
// collapsed-by-default <details class="pred-panel"> instead -- same
// pattern already used for Prediction systems, not a new one-off style.
// Run with:
//     node tests/test_settings_advanced_key_logic.mjs
import fs from "node:fs";

const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

const settingsStart = html.indexOf('id="tab-settings"');
const cardEnd = html.indexOf("</details>", settingsStart);
const card = html.slice(settingsStart, cardEnd);

check("the Settings panel exists and contains a Live odds card", settingsStart !== -1 && card.length > 0);
check("Book/edge-threshold controls (bookSel/goodThresh/strongThresh) are NOT inside the collapsed Advanced panel -- they're core display settings everyone needs, regardless of whether they ever touch the API key",
  (() => {
    const detailsStart = card.indexOf("<details");
    const bookIdx = card.indexOf('id="bookSel"');
    return detailsStart !== -1 && bookIdx !== -1 && bookIdx < detailsStart;
  })());
check("the personal API key input (#apiKeyInput) is wrapped in a <details class=\"pred-panel\"> (collapsed by default -- no [open] attribute), not left permanently visible",
  /<details class="pred-panel">\s*<summary class="pred-summary">[\s\S]{0,600}<input type="text" id="apiKeyInput"/.test(card));
check("the collapsed panel's summary clearly labels it as optional/advanced, not phrased like a required setup step",
  /<span class="pred-summary-title">Advanced: use your own API key<\/span>/.test(html));
check("the summary's meta text explicitly says this is only for a separate/optional refresh budget, reinforcing that the shared connection already works without it",
  /Optional — only if you want a separate refresh budget instead of the shared one/.test(html));
check("the card's own intro line leads with the shared connection working automatically, not with the key field",
  /Lines come from The Odds API \(NCAAF spreads\) via PickGauge's shared connection — works automatically once you're signed in, nothing to set up\./.test(html));
check("no leftover reference to the OLD open-by-default field id path exists twice (e.g. a stray duplicate #apiKeyInput from an incomplete edit)",
  (html.match(/id="apiKeyInput"/g) || []).length === 1);

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
