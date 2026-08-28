// Real-browser regression coverage for initial linking of an existing sync
// code. This path is intentionally different from the already-linked dirty
// conflict flow: before a device is linked, its local picks must never be
// silently replaced just because the user typed a code.

import assert from 'node:assert/strict';
import { withBrowserPage, assertNoErrors } from './browser-harness.js';

const REMOTE_PROFILE = {
  schemaVersion: 2,
  sec: { season: 2026, entries: [{ id: 'remote-1', name: 'Remote Entry', picks: { 1: 'Alabama', 2: 'Georgia' } }] },
  bigten: { season: 2026, entries: [{ id: 'remote-b1', name: 'Remote Big Ten', picks: { 1: 'Ohio State' } }] }
};

async function mockSyncGet(page) {
  await page.route('**/api/sync*', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'TEST-CODE', updatedAt: '2026-08-28T12:00:00Z', profile: REMOTE_PROFILE })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function seedLocalPick(page) {
  await page.addInitScript(() => {
    localStorage.setItem('cfb-survivor-state-v3:sec', JSON.stringify({
      entries: [{ id: 'local-1', name: 'Local Entry', picks: { 1: 'Oklahoma' } }],
      activeEntryId: 'local-1', currentWeek: 1, season: 2026
    }));
  });
}

// Saved local picks require a review step; merely fetching the code must not
// write the sync code or replace local state.
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await mockSyncGet(page);
  await seedLocalPick(page);
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('#syncBtn');
  await page.fill('#syncCodeInput', 'TEST-CODE');
  await page.click('#syncLinkBtn');
  await page.waitForTimeout(250);

  const body = await page.textContent('#syncDialogBody');
  assert.match(body, /already has saved picks/i);
  assert.match(body, /Nothing has been replaced yet/i);
  assert.match(body, /This device/i);
  assert.match(body, /Synced copy/i);
  assert.equal(await page.locator('#syncLinkConfirmBtn').isVisible(), true);
  assert.equal(await page.locator('#syncLinkCancelBtn').isVisible(), true);

  const beforeConfirm = await page.evaluate(() => ({
    syncCode: localStorage.getItem('cfb-survivor-sync-code-v1'),
    sec: JSON.parse(localStorage.getItem('cfb-survivor-state-v3:sec') || '{}')
  }));
  assert.equal(beforeConfirm.syncCode, null, 'typing/fetching a code must not link the device before confirmation');
  assert.equal(beforeConfirm.sec.entries?.[0]?.picks?.['1'], 'Oklahoma', 'local pick must remain intact before confirmation');

  await page.click('#syncLinkCancelBtn');
  await page.waitForTimeout(100);
  const afterCancel = await page.evaluate(() => ({
    syncCode: localStorage.getItem('cfb-survivor-sync-code-v1'),
    pick: JSON.parse(localStorage.getItem('cfb-survivor-state-v3:sec') || '{}').entries?.[0]?.picks?.['1']
  }));
  assert.equal(afterCancel.syncCode, null);
  assert.equal(afterCancel.pick, 'Oklahoma', 'Cancel should preserve the local copy');
  assertNoErrors(consoleErrors, pageErrors, 'initial sync-link cancel');
});
console.log('sync link safety: local review/cancel test passed');

// Explicit confirmation applies the fetched remote snapshot and only then
// saves the code locally.
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await mockSyncGet(page);
  await seedLocalPick(page);
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('#syncBtn');
  await page.fill('#syncCodeInput', 'TEST-CODE');
  await page.click('#syncLinkBtn');
  await page.waitForTimeout(200);
  await page.click('#syncLinkConfirmBtn');
  await page.waitForTimeout(250);

  const linked = await page.evaluate(() => ({
    syncCode: localStorage.getItem('cfb-survivor-sync-code-v1'),
    sec: JSON.parse(localStorage.getItem('cfb-survivor-state-v3:sec') || '{}')
  }));
  assert.equal(linked.syncCode, 'TEST-CODE');
  assert.equal(linked.sec.entries?.[0]?.name, 'Remote Entry');
  assert.equal(linked.sec.entries?.[0]?.picks?.['1'], 'Alabama');
  assertNoErrors(consoleErrors, pageErrors, 'initial sync-link confirm');
});
console.log('sync link safety: explicit replace/link test passed');

// An empty device keeps the fast path and links immediately.
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await mockSyncGet(page);
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('#syncBtn');
  await page.fill('#syncCodeInput', 'TEST-CODE');
  await page.click('#syncLinkBtn');
  await page.waitForTimeout(250);

  const body = await page.textContent('#syncDialogBody');
  assert.doesNotMatch(body, /already has saved picks/i, 'empty devices should not get an unnecessary overwrite warning');
  const code = await page.evaluate(() => localStorage.getItem('cfb-survivor-sync-code-v1'));
  assert.equal(code, 'TEST-CODE');
  assertNoErrors(consoleErrors, pageErrors, 'empty-device initial link');
});
console.log('sync link safety: empty-device fast path test passed');
