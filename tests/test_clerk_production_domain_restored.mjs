// Regression coverage for the Aug 28 revert back to clerk.pickgauge.com.
// Closes the loop on the Aug 27 move to Clerk's Development instance
// (see git history / CURRENT_STATE.md's dated entries for both changes)
// -- that move was an accepted temporary tradeoff for as long as
// pickgauge.com was network-blocked on Drew's own work network (Cisco
// Talos had categorized it Gambling). Talos has since removed the
// Gambling category and Drew confirmed pickgauge.com is reachable again
// from the previously-blocked network, so this reverts production auth
// back to the real clerk.pickgauge.com custom domain -- the Development
// instance was never meant to be a permanent architecture, just a
// bridge for as long as the underlying block existed.
//
// This is the SECOND time this exact script-tag block has changed in
// two days (production -> Development on Aug 27, Development ->
// production again on Aug 28) -- if it needs to move again in the
// future (e.g. a categorization regression), this file's structure is a
// template for that: check for the intended values' PRESENCE and the
// unintended values' ABSENCE, both directions, so a half-reverted state
// can never silently pass.
import fs from "node:fs";

const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

const PROD_HOST = "clerk.pickgauge.com";
const PROD_PUBLISHABLE_KEY = "pk_live_Y2xlcmsucGlja2dhdWdlLmNvbSQ";
const DEV_HOST = "simple-monarch-32.clerk.accounts.dev";
const DEV_PUBLISHABLE_KEY = "pk_test_c2ltcGxlLW1vbmFyY2gtMzIuY2xlcmsuYWNjb3VudHMuZGV2JA";

// ---------------------------------------------------------------------------
// The two Clerk <script> tags themselves -- confirms they're back on the
// real production custom domain with the real production key.
// ---------------------------------------------------------------------------
const scriptTagPattern = /<script\b[^>]*>/gi;
const clerkTags = (html.match(scriptTagPattern) || []).filter((t) => /clerk/i.test(t));

check("exactly 2 Clerk-related <script> tags exist (UI bundle + core, same count as always -- this change swaps WHICH domain, not how many scripts load)",
  clerkTags.length === 2);

const uiTag = clerkTags.find((t) => t.includes("ui@1.30.2"));
const coreTag = clerkTags.find((t) => t.includes("clerk-js@6.28.1"));
check("Clerk UI bundle script tag found (ui@1.30.2, version unchanged by this revert)", !!uiTag);
check("Clerk core script tag found (clerk-js@6.28.1, version unchanged by this revert)", !!coreTag);

check(`Clerk UI bundle loads from the real production custom domain (${PROD_HOST})`,
  (uiTag || "").includes(`https://${PROD_HOST}/`));
check(`Clerk core loads from the real production custom domain (${PROD_HOST})`,
  (coreTag || "").includes(`https://${PROD_HOST}/`));
check("Clerk core script tag carries the real production publishable key",
  (coreTag || "").includes(PROD_PUBLISHABLE_KEY));

// ---------------------------------------------------------------------------
// The absence checks -- confirms this isn't a half-revert where one tag
// got changed back and the other still points at the Development
// instance, or where a stray Dev reference lingers somewhere unexpected.
// ---------------------------------------------------------------------------
check("NO script tag anywhere still points at the Development instance host",
  !clerkTags.some((t) => t.includes(DEV_HOST)));
check("NO script tag anywhere still carries the Development publishable key",
  !clerkTags.some((t) => t.includes(DEV_PUBLISHABLE_KEY)));
check(`the Development host (${DEV_HOST}) does not appear inside any actual tag's src/attributes (comments mentioning it historically are fine)`,
  !new RegExp(`(src|data-clerk-publishable-key)\\s*=\\s*["'][^"']*${DEV_HOST.replace(/\./g, "\\.")}`, "i").test(html));

console.log("");
console.log(`${total - failures.length}/${total} checks passed`);
if (failures.length) {
  console.log("FAILED:");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
