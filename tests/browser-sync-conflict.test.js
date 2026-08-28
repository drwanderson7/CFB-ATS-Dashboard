// Real browser interaction tests for cross-device sync conflict resolution —
// the single highest-stakes, weakest-covered flow in the app (getting this
// wrong means silently losing someone's picks). Nothing else in the test
// suite actually drives this in a browser; sync-safety.test.js only checks
// that certain source patterns exist in js/sync-ui.js, which cannot catch a
// runtime wiring mistake (see HANDOFF.md's v1.12.0 entry for three real
// examples of exactly that kind of bug slipping past text-based checks).
//
// Each test mocks /api/sync at the network layer (no real KV store needed)
// and pre-seeds localStorage to simulate a device that has a sync code AND
// unsynced local edits (the "dirty" flag) — the exact precondition for a
// conflict — then drives the real UI.

import assert from 'node:assert/strict';
import { withBrowserPage, assertNoErrors } from './browser-harness.js';

const REMOTE_PROFILE = {
  schemaVersion: 2,
  sec: { season: 2026, entries: [{ id: 'remote-1', name: 'Remote Copy', picks: { 1: 'Georgia' } }] },
  bigten: { season: 2026, entries: [{ id: 'remote-1', name: 'Remote Copy', picks: {} }] }
};

async function seedConflictedDevice(page, code) {
  await page.addInitScript(([c]) => {
    localStorage.setItem('cfb-survivor-sync-code-v1', c);
    localStorage.setItem('cfb-survivor-sync-dirty-v1', '1');
  }, [code]);
}

async function mockSyncApi(page, { onPut } = {}) {
  await page.route('**/api/sync*', async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'TEST-CODE', updatedAt: '2026-08-27T09:00:00Z', profile: REMOTE_PROFILE })
      });
    } else if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData() || '{}');
      if (onPut) onPut(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'TEST-CODE', updatedAt: '2026-08-27T11:00:00Z', profile: body.profile })
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });
}

// Test 1: the conflict is actually detected and surfaced in the UI, with
// both resolution buttons present and enabled.
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await mockSyncApi(page);
  await seedConflictedDevice(page, 'TEST-CODE');
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  await page.click('#syncBtn');
  await page.waitForTimeout(400);

  const bodyText = await page.textContent('#syncDialogBody');
  assert.match(bodyText, /both this device and the synced copy have changes/i, 'conflict banner should explain what happened');

  const keepBtn = page.locator('#syncKeepLocalBtn');
  const useCloudBtn = page.locator('#syncUseCloudBtn');
  assert.equal(await keepBtn.isVisible(), true, '"Keep this device" button should be visible during a conflict');
  assert.equal(await useCloudBtn.isVisible(), true, '"Use synced copy" button should be visible during a conflict');
  assert.equal(await keepBtn.isEnabled(), true);
  assert.equal(await useCloudBtn.isEnabled(), true);

  assertNoErrors(consoleErrors, pageErrors, 'conflict UI detection');
});
console.log('sync conflict: detection + UI test passed');

// Test 2: "Use synced copy" actually applies the remote profile — the entry
// name and picks in My Picks must change to match what the mocked server
// returned, and the local-dirty flag must clear (so a reload doesn't
// re-trigger the same conflict for no reason).
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await mockSyncApi(page);
  await seedConflictedDevice(page, 'TEST-CODE');
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  await page.click('#syncBtn');
  await page.waitForTimeout(400);
  await page.click('#syncUseCloudBtn');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await page.click('text=My Picks');
  await page.waitForTimeout(300);

  const entryName = await page.inputValue('#entryNameInput');
  assert.equal(entryName, 'Remote Copy', '"Use synced copy" should replace the local entry with the remote one');

  const weeklyPicks = await page.textContent('.pick-history');
  assert.match(weeklyPicks, /Georgia/, 'the remote pick (Georgia, week 1) should now show in My Picks');

  const dirtyFlag = await page.evaluate(() => localStorage.getItem('cfb-survivor-sync-dirty-v1'));
  assert.equal(dirtyFlag, null, 'resolving the conflict should clear the local-dirty flag');

  assertNoErrors(consoleErrors, pageErrors, '"Use synced copy" resolution');
});
console.log('sync conflict: "Use synced copy" test passed');

// Test 3: "Keep this device" pushes the LOCAL profile to the server (not the
// remote one) via a real PUT call, and also clears the dirty flag. This is
// the resolution path most likely to be implemented backwards by accident
// (pushing the wrong profile, or not pushing at all) since its correct
// behavior is "do nothing to local state, but do talk to the network" —
// the opposite shape of most bugs, which tend to be caught by checking local
// state changed. This test specifically watches the network call instead.
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  let putBody = null;
  await mockSyncApi(page, { onPut: body => { putBody = body; } });
  await seedConflictedDevice(page, 'TEST-CODE');
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  await page.click('#syncBtn');
  await page.waitForTimeout(400);
  await page.click('#syncKeepLocalBtn');
  await page.waitForTimeout(500);

  assert.ok(putBody, '"Keep this device" must actually push to the server, not just dismiss the dialog');
  assert.equal(putBody.code, 'TEST-CODE');
  assert.notEqual(putBody.profile?.sec?.entries?.[0]?.name, 'Remote Copy', 'the pushed profile must be the LOCAL entry, not the remote one that was just rejected');

  const dirtyFlag = await page.evaluate(() => localStorage.getItem('cfb-survivor-sync-dirty-v1'));
  assert.equal(dirtyFlag, null, 'resolving the conflict should clear the local-dirty flag');

  assertNoErrors(consoleErrors, pageErrors, '"Keep this device" resolution');
});
console.log('sync conflict: "Keep this device" test passed');

// Test 4: a device with NO local edits (dirty flag absent) should just pull
// silently — no conflict UI, no forced choice — since there's nothing of
// this device's to lose.
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await mockSyncApi(page);
  await page.addInitScript(() => {
    localStorage.setItem('cfb-survivor-sync-code-v1', 'TEST-CODE');
    // deliberately NOT setting the dirty flag
  });
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  await page.click('#syncBtn');
  await page.waitForTimeout(400);
  const bodyText = await page.textContent('#syncDialogBody');
  assert.doesNotMatch(bodyText, /both this device and the synced copy have changes/i, 'a clean device should not be shown a conflict it does not have');
  assert.match(bodyText, /synced|sync code/i, 'dialog should show the normal synced state instead');

  assertNoErrors(consoleErrors, pageErrors, 'clean-device pull (no conflict expected)');
});
console.log('sync conflict: no-false-positive test passed');
