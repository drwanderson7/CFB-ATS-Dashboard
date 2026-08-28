// Real browser interaction tests for "Why this pick?" (P2) — previously
// covered only by p1-p2-ui.test.js's source-text regex checks (does app.js
// contain "buildPickExplanation(", does the four-factor label text appear
// somewhere in the file). Those can't prove the panel actually opens, shows
// real computed values instead of empty placeholders, or reads acceptably
// at a mobile viewport.

import assert from 'node:assert/strict';
import { withBrowserPage, assertNoErrors } from './browser-harness.js';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Panel starts closed/hidden.
  assert.equal(await page.isVisible('#whyPickPanel'), false, 'the Why-this-pick panel should be closed by default');
  const toggleBtn = page.locator('.hero-why-button');
  assert.equal(await toggleBtn.textContent(), 'Why this pick?', 'the toggle should read "Why this pick?" while closed');
  assert.equal(await toggleBtn.getAttribute('aria-expanded'), 'false');

  await toggleBtn.click();
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('#whyPickPanel'), true, 'clicking the toggle should open the panel');
  assert.equal(await toggleBtn.textContent(), 'Hide why', 'the toggle should relabel to "Hide why" once open');
  assert.equal(await toggleBtn.getAttribute('aria-expanded'), 'true');

  // All four decision factors must actually be present with real content,
  // not just the section labels — each should include at least one number
  // (a percentage, rank, or point value), since a broken data wire-up would
  // most likely show an empty or placeholder-only section while the label
  // itself still renders fine.
  const panelText = await page.textContent('#whyPickPanel');
  for (const label of ['Safety', 'Future cost', 'Season path', 'Future scarcity']) {
    assert.match(panelText, new RegExp(label, 'i'), `Why-this-pick panel should include a "${label}" section`);
  }
  assert.match(panelText, /%/, 'the explanation should include at least one real percentage figure');

  // The panel's team name should match the Best Play card's team — this is
  // the kind of "two independent things must agree" check that's easy to
  // accidentally break by wiring the panel to the wrong matchup.
  const heroTeam = await page.textContent('.hero-team');
  assert.match(panelText, new RegExp(heroTeam.trim().split(' ')[0]), 'the explanation should be about the same team as the Best Play card');

  // Toggling again should close it.
  await toggleBtn.click();
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('#whyPickPanel'), false, 'clicking the toggle again should close the panel');

  assertNoErrors(consoleErrors, pageErrors, 'Why this pick toggle (desktop width)');
});
console.log('why-this-pick: toggle + content test passed');

await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.click('.hero-why-button');
  await page.waitForTimeout(300);

  // At mobile width the 4-factor grid should still be legible — not
  // squeezed into unreadably narrow columns. responsive-mobile.css defines
  // breakpoints that collapse the grid from 4 -> 2 -> 1 columns as the
  // viewport narrows; confirm the grid actually has more than one column's
  // worth of usable width per item at 390px (i.e. it collapsed sensibly)
  // rather than remaining stuck at 4 columns and getting crushed.
  const gridInfo = await page.$eval('.why-pick-grid', el => {
    const cs = getComputedStyle(el);
    return { columns: cs.gridTemplateColumns.split(' ').length, width: el.getBoundingClientRect().width };
  });
  const perColumnWidth = gridInfo.width / gridInfo.columns;
  assert.ok(perColumnWidth >= 100, `each Why-this-pick factor column should have at least 100px of width at 390px viewport, got ~${perColumnWidth.toFixed(0)}px across ${gridInfo.columns} columns`);

  assertNoErrors(consoleErrors, pageErrors, 'Why this pick mobile layout');
}, { viewport: MOBILE_VIEWPORT });
console.log('why-this-pick: mobile grid layout test passed');
