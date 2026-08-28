// Browser smoke test for the compact entry/pool summary. The summary lives
// above every view, so verify both its content model and its mobile layout.

import assert from 'node:assert/strict';
import { withBrowserPage, assertNoErrors } from './browser-harness.js';

await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cfb-survivor-state-v3:sec', JSON.stringify({
      entries: [{ id: 'e1', name: 'Main Entry', picks: { 1: 'Oklahoma' } }],
      activeEntryId: 'e1', currentWeek: 1, season: 2026
    }));
  });
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const text = await page.textContent('#entryStatusBar');
  for (const label of ['SEC Survivor', 'Main Entry', 'Record', 'Pool week', 'Pick', 'Oklahoma', 'Used', 'Sync', 'Off']) {
    assert.match(text, new RegExp(label, 'i'), `entry summary should visibly include ${label}`);
  }

  const chips = page.locator('#entryStatusBar .entry-summary-chip');
  assert.equal(await chips.count() >= 5, true, 'entry summary should render at least the five core summary chips');

  const barBox = await page.locator('#entryStatusBar').boundingBox();
  assert.ok(barBox && barBox.width <= 390, 'mobile summary must stay within the viewport');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'entry summary must not create page-level horizontal overflow');
  assertNoErrors(consoleErrors, pageErrors, 'entry summary mobile rendering');
}, { viewport: { width: 390, height: 844 } });

console.log('entry summary browser test passed');
