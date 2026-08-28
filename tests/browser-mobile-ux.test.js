// Real browser interaction tests for mobile behavior — previously covered
// only by tests/mobile-ux.test.js's regex checks against source/CSS text
// (e.g. "does the file contain the string '44px' somewhere"), which cannot
// prove a button is ACTUALLY 44px tall once rendered, or that the board
// actually scrolls horizontally instead of overflowing the page. This test
// measures real rendered layout at a real mobile viewport.

import assert from 'node:assert/strict';
import { withBrowserPage, assertNoErrors } from './browser-harness.js';

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MIN_TOUCH_TARGET_PX = 40; // slightly under the 44px design goal to allow for sub-pixel rendering

await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Pool/entry controls must stay visible and labeled at mobile width, not
  // collapse into something unusable or get hidden entirely.
  assert.equal(await page.isVisible('#poolSelect'), true, 'pool selector should be visible on mobile');
  assert.equal(await page.isVisible('#entrySelect'), true, 'entry selector should be visible on mobile');

  // The season board should scroll horizontally within its own container —
  // not force the whole page to scroll sideways, which breaks the sticky
  // header/nav and is a much worse mobile experience.
  const scrollInfo = await page.$eval('.grid-scroller', el => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth
  }));
  assert.ok(scrollInfo.scrollWidth > scrollInfo.clientWidth, 'the season board should be wider than its container (horizontally scrollable) on mobile');

  const pageHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  assert.equal(pageHorizontalOverflow, false, 'the page itself should not scroll horizontally — only the board container should');

  assertNoErrors(consoleErrors, pageErrors, 'mobile initial load');
}, { viewport: MOBILE_VIEWPORT });
console.log('mobile: layout/scroll test passed');

await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Open the matchup dialog by tapping a cell — this is the core mobile
  // interaction the whole app is built around, and must actually work with
  // a real tap, not just a desktop click.
  await page.click('.season-grid tbody tr:first-child td:nth-child(2)');
  await page.waitForTimeout(400);
  assert.equal(await page.isVisible('#matchupDialog'), true, 'tapping a cell should open the matchup dialog on mobile');

  // At mobile widths, the desktop-only #useTeamBtn/#useOpponentBtn pair is
  // hidden (see .dialog-actions .pick-side-button { display: none; } in
  // responsive-tablet.css) in favor of a per-team "Use <Team>" button inside
  // each side-option card ([data-dialog-pick-team]) — those are the buttons
  // that must actually be usable on a real phone.
  const pickButtons = page.locator('[data-dialog-pick-team]');
  const pickButtonCount = await pickButtons.count();
  assert.equal(pickButtonCount, 2, 'both sides of the matchup should have a per-team pick button on mobile');
  for (let i = 0; i < pickButtonCount; i++) {
    const box = await pickButtons.nth(i).boundingBox();
    assert.ok(box, `mobile pick button ${i} should be visible and have a bounding box`);
    assert.ok(box.height >= MIN_TOUCH_TARGET_PX, `mobile pick button ${i} should be at least ${MIN_TOUCH_TARGET_PX}px tall for touch, was ${box.height}`);
  }
  // The desktop-only duplicate buttons should indeed be hidden, not just
  // present-but-redundant — confirms the CSS breakpoint is actually working,
  // not merely that alternate buttons happen to exist.
  assert.equal(await page.isVisible('#useTeamBtn'), false, 'the desktop-only Use-team button should be hidden at mobile width');

  // Making a pick should close the dialog and reflect in the board without
  // a full page reload — verify the dialog closes.
  await pickButtons.first().click();
  await page.waitForTimeout(400);
  assert.equal(await page.isVisible('#matchupDialog'), false, 'the dialog should close after making a pick');

  assertNoErrors(consoleErrors, pageErrors, 'mobile matchup dialog interaction');
}, { viewport: MOBILE_VIEWPORT });
console.log('mobile: matchup dialog + touch target test passed');

await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Week Rankings' mobile action row (Details / Compare / Use) must all be
  // reachable and correctly sized — this is the row that needed its CSS
  // grid widened from 2 to 3 columns when Compare was added (v1.10.0); a
  // regression here would silently make one of the three buttons
  // unclickable by squeezing it to near-zero width.
  await page.click('text=Week Rankings');
  await page.waitForTimeout(400);

  const mobileActions = page.locator('.rank-card').first().locator('.rank-mobile-actions');
  const buttons = mobileActions.locator('.small-button');
  const count = await buttons.count();
  assert.equal(count, 3, 'each mobile ranking row should show exactly 3 action buttons (Details, Compare, Use)');
  for (let i = 0; i < count; i++) {
    const box = await buttons.nth(i).boundingBox();
    assert.ok(box, `mobile action button ${i} should have a bounding box`);
    assert.ok(box.width > 20, `mobile action button ${i} should have real width (not squeezed to near-zero), was ${box.width}px`);
  }

  assertNoErrors(consoleErrors, pageErrors, 'mobile Week Rankings action row');
}, { viewport: MOBILE_VIEWPORT });
console.log('mobile: rankings action row test passed');

// Regression guard for a real bug found during a mobile UX audit: the
// static index.html markup for #heroRecommendation carried a stale
// "skeleton-block" class (meant only for the transient loading state) that
// was never removed once real content rendered. .skeleton-block sets
// `display: flex`, which silently forced the card's two child sections
// (team identity, and the stats/actions row) into a side-by-side flex row
// instead of stacking as normal blocks — at narrow mobile widths this
// squeezed the team name and opponent badge to near-zero visible width.
// The fix was in the static markup itself, not app.js's rendering logic
// (which already correctly creates its own scoped loading skeleton), so
// this is checked directly against the loaded page's computed style, not
// source text — a regex check here would have passed even with the bug
// present, since the string "skeleton-block" legitimately appears elsewhere
// in the file for the real loading-state div.
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const display = await page.$eval('#heroRecommendation', el => getComputedStyle(el).display);
  assert.equal(display, 'block', '#heroRecommendation must not be flex once real content has loaded — a stale skeleton-block class previously forced this and squeezed mobile content');
  assertNoErrors(consoleErrors, pageErrors, 'hero recommendation layout after load');
});
console.log('mobile: hero recommendation layout regression test passed');
