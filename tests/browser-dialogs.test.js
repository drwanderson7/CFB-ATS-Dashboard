// Real browser interaction tests for the remaining dialog/collapsible UI
// previously covered only by source-text regex checks: the entry-reset
// confirmation guard (a destructive action — worth verifying the guard
// actually blocks a single accidental click, not just that a dialog element
// exists in the HTML) and the status-banner/board-note collapsible sections
// (especially relevant on mobile, where banner text truncates and a working
// expand control matters more than on a wide desktop screen).

import assert from 'node:assert/strict';
import { withBrowserPage, assertNoErrors } from './browser-harness.js';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

// Reset-entry confirmation: clicking "Reset this entry's picks" must NOT
// immediately clear picks — it must open a confirmation dialog first, and
// only actually reset on the explicit confirm click. Cancel must leave picks
// untouched.
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Make a real pick first so there's something to (not) lose.
  await page.click('.season-grid tbody tr:first-child td:nth-child(2)');
  await page.waitForTimeout(300);
  await page.click('#useTeamBtn');
  await page.waitForTimeout(300);

  await page.click('text=My Picks');
  await page.waitForTimeout(300);
  const picksBeforeCancel = await page.textContent('.pick-history');
  assert.match(picksBeforeCancel, /Alabama/, 'a real pick (Alabama, from the matchup dialog above) should be recorded before testing reset');

  // Open the dialog and Cancel — picks must be unchanged.
  await page.click('#resetPicksBtn');
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('#resetEntryDialog'), true, 'clicking reset should open a confirmation dialog, not reset immediately');
  await page.click('#resetEntryDialog button[value="cancel"]');
  await page.waitForTimeout(300);
  const picksAfterCancel = await page.textContent('.pick-history');
  assert.equal(picksAfterCancel, picksBeforeCancel, 'Cancel must leave picks completely unchanged');

  // Now actually confirm — picks must clear.
  await page.click('#resetPicksBtn');
  await page.waitForTimeout(300);
  await page.click('#confirmResetPicksBtn');
  await page.waitForTimeout(300);
  const picksAfterConfirm = await page.textContent('.pick-history');
  assert.doesNotMatch(picksAfterConfirm, /Alabama/, 'confirming reset should actually clear the Week 1 Alabama pick, not just leave 12 already-empty weeks unchanged');
  assert.equal(await page.isVisible('#resetEntryDialog'), false, 'the dialog should close after confirming');

  assertNoErrors(consoleErrors, pageErrors, 'reset-entry confirmation flow');
});
console.log('dialogs: reset-entry confirmation guard test passed');

// Board-note (native <details>/<summary>) and the status-banner toggle
// should both start collapsed and actually expand on interaction — worth
// checking specifically at mobile width, where the banner's truncated text
// is the main reason the toggle exists at all.
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const boardNoteOpenBefore = await page.evaluate(() => document.querySelector('.board-note')?.open);
  assert.equal(boardNoteOpenBefore, false, '"How this board works" should be collapsed by default');
  await page.click('.board-note summary');
  await page.waitForTimeout(200);
  const boardNoteOpenAfter = await page.evaluate(() => document.querySelector('.board-note')?.open);
  assert.equal(boardNoteOpenAfter, true, 'clicking the summary should expand the board note');
  const noteText = await page.textContent('.board-note');
  assert.ok(noteText.length > 40, 'the expanded board note should show real explanatory content, not just the summary label');

  const bannerToggle = page.locator('.status-banner-toggle');
  if (await bannerToggle.count() > 0) {
    assert.equal(await bannerToggle.getAttribute('aria-expanded'), 'false', 'the demo banner should start collapsed on mobile');
    await bannerToggle.click();
    await page.waitForTimeout(200);
    assert.equal(await bannerToggle.getAttribute('aria-expanded'), 'true', 'clicking Details should expand the banner');
    const bannerFull = await page.textContent('.status-banner');
    assert.match(bannerFull, /SplashSports 2026 pool schedule/, 'the expanded banner should show the full, untruncated message');
  }

  assertNoErrors(consoleErrors, pageErrors, 'board-note and status-banner toggles');
}, { viewport: MOBILE_VIEWPORT });
console.log('dialogs: board-note + status-banner toggle test passed');
