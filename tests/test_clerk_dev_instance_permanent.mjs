// Regression coverage for the permanent move off clerk.pickgauge.com
// (Aug 27, Drew's explicit call). pickgauge.com itself is network-blocked
// on Drew's own work network (confirmed: Cisco Talos/Palo Alto/Fortinet
// all categorized it Gambling), and since clerk.pickgauge.com is a
// subdomain of that same blocked name, sign-in failed regardless of
// which page domain loaded the app -- Clerk's publishable key hard-codes
// which Frontend API domain it talks to, so the PAGE's own domain never
// mattered. A same-hostname-conditional dev/prod bootstrap briefly lived
// here as a lower-risk first attempt (see git history / prior session
// notes) -- replaced the same day with this simpler, permanent change
// once Drew confirmed he wants Clerk's Development instance to be the
// real, ONLY auth path (not a fallback), since there are zero real users
// yet besides Drew to disrupt.
//
// This file intentionally checks for the ABSENCE of clerk.pickgauge.com
// just as much as the presence of the new accounts.dev values -- a
// silent partial revert (e.g. only one of the two script tags updated)
// would be a real, easy-to-miss regression given how similar the two
// script blocks look to each other.
import fs from "node:fs";

const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

const DEV_HOST = "simple-monarch-32.clerk.accounts.dev";
const DEV_PUBLISHABLE_KEY = "pk_test_c2ltcGxlLW1vbmFyY2gtMzIuY2xlcmsuYWNjb3VudHMuZGV2JA";
const OLD_PROD_KEY = "pk_live_Y2xlcmsucGlja2dhdWdlLmNvbSQ";

// ---------------------------------------------------------------------------
// The two Clerk <script> tags themselves
// ---------------------------------------------------------------------------
const scriptTagPattern = /<script\b[^>]*>/gi;
const clerkTags = (html.match(scriptTagPattern) || []).filter((t) => /clerk/i.test(t));

check("exactly 2 Clerk-related <script> tags exist (UI bundle + core, same count as before -- this change swaps WHICH domain, not how many scripts load)",
  clerkTags.length === 2);

const uiTag = clerkTags.find((t) => t.includes("ui@1.30.2"));
const coreTag = clerkTags.find((t) => t.includes("clerk-js@6.28.1"));
check("Clerk UI bundle script tag found (ui@1.30.2, version unchanged by this move)", !!uiTag);
check("Clerk core script tag found (clerk-js@6.28.1, version unchanged by this move)", !!coreTag);

check(`Clerk UI bundle loads from the Development instance host (${DEV_HOST})`,
  (uiTag || "").includes(`https://${DEV_HOST}/`));
check(`Clerk core loads from the Development instance host (${DEV_HOST})`,
  (coreTag || "").includes(`https://${DEV_HOST}/`));
check("Clerk core script tag carries the real Development publishable key (confirmed by Drew against the live Clerk Dashboard, not guessed)",
  (coreTag || "").includes(DEV_PUBLISHABLE_KEY));

// ---------------------------------------------------------------------------
// The absence checks -- confirms this isn't a half-migration where one
// tag got updated and the other didn't, or where the old key/host
// lingers somewhere unexpected (a stray leftover reference, a duplicate
// tag, etc.)
// ---------------------------------------------------------------------------
check("NO script tag anywhere still points at clerk.pickgauge.com",
  !clerkTags.some((t) => t.includes("clerk.pickgauge.com")));
check("NO script tag anywhere still carries the old production publishable key",
  !clerkTags.some((t) => t.includes(OLD_PROD_KEY)));
check("the string 'clerk.pickgauge.com' only appears in explanatory comments now, never inside an actual tag's src/attributes",
  !new RegExp(`(src|data-clerk-publishable-key)\\s*=\\s*["'][^"']*clerk\\.pickgauge\\.com`, "i").test(html));

// ---------------------------------------------------------------------------
// No leftover dynamic-injection machinery from the earlier hostname-
// branching approach -- confirms this was a genuine clean replacement,
// not dead code left orphaned alongside the new static tags.
// ---------------------------------------------------------------------------
check("no leftover document.currentScript-based dynamic script injection remains from the earlier hostname-branching approach",
  !html.includes("document.currentScript"));
check("no leftover location.hostname-based Clerk branching logic remains",
  !/isProd\s*=.*pickgauge/i.test(html));

console.log("");
console.log(`${total - failures.length}/${total} checks passed`);
if (failures.length) {
  console.log("FAILED:");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
