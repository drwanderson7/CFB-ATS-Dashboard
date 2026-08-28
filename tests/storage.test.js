import assert from 'node:assert/strict';
import {
  loadState,
  resetAllEntriesForPool,
  saveState,
  loadSyncCode,
  saveSyncCode,
  clearSyncCode,
  loadSyncDirtyFlag,
  saveSyncDirtyFlag,
  clearSyncDirtyFlag,
  buildSyncProfile,
  applySyncProfile,
  saveActivePoolId,
  loadActivePoolId
} from '../js/storage.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
  clear() { this.map.clear(); }
}

globalThis.localStorage = new MemoryStorage();

localStorage.setItem('cfb-survivor-state-v2:sec', JSON.stringify({
  entryName: 'Office Pool',
  picks: { 1: 'Georgia', 2: 'Texas' },
  currentWeek: 3,
  season: 2026
}));

const migrated = loadState('sec');
assert.equal(migrated.entries.length, 1, 'legacy single entry should migrate into one v3 entry');
assert.equal(migrated.entries[0].name, 'Office Pool');
assert.deepEqual(migrated.entries[0].picks, { 1: 'Georgia', 2: 'Texas' });
assert.equal(migrated.activeEntryId, migrated.entries[0].id);

saveState('sec', {
  ...migrated,
  entries: [
    migrated.entries[0],
    { id: 'entry-2', name: 'Second Chance', picks: { 1: 'Alabama' } }
  ],
  activeEntryId: 'entry-2'
});

const multi = loadState('sec');
assert.equal(multi.entries.length, 2, 'two entries should persist independently inside one pool');
assert.equal(multi.activeEntryId, 'entry-2');
assert.deepEqual(multi.entries.find(entry => entry.id === 'entry-2').picks, { 1: 'Alabama' });
assert.deepEqual(multi.entries.find(entry => entry.id !== 'entry-2').picks, { 1: 'Georgia', 2: 'Texas' });

saveState('bigten', {
  entries: [{ id: 'b1', name: 'Big Ten Entry', picks: { 1: 'Ohio State' } }],
  activeEntryId: 'b1',
  currentWeek: 2,
  season: 2026
});

const bigten = loadState('bigten');
assert.deepEqual(bigten.entries[0].picks, { 1: 'Ohio State' }, 'Big Ten entries should remain isolated from SEC entries');
assert.deepEqual(loadState('sec').entries.find(entry => entry.id === 'entry-2').picks, { 1: 'Alabama' }, 'SEC entries should be unchanged by Big Ten saves');

resetAllEntriesForPool('bigten');
assert.equal(loadState('bigten').entries.length, 1, 'reset should restore a clean default entry');

// --- Cross-device sync helpers ---

assert.equal(loadSyncCode(), null, 'no sync code should be set initially');
saveSyncCode('ABCD-2345');
assert.equal(loadSyncCode(), 'ABCD-2345');
clearSyncCode();
assert.equal(loadSyncCode(), null, 'clearSyncCode should remove the stored code');

assert.equal(loadSyncDirtyFlag(), false, 'sync dirty flag should start clear');
saveSyncDirtyFlag(true);
assert.equal(loadSyncDirtyFlag(), true, 'unsynced-local marker should persist in storage');
saveSyncDirtyFlag(false);
assert.equal(loadSyncDirtyFlag(), false, 'saveSyncDirtyFlag(false) should clear the marker');
saveSyncDirtyFlag(true);
clearSyncDirtyFlag();
assert.equal(loadSyncDirtyFlag(), false, 'clearSyncDirtyFlag should clear the marker explicitly');

// buildSyncProfile() should snapshot only durable survivor data. Device
// navigation state (active pool/entry and focused week) must stay local so
// browsing on one device cannot trigger a last-write-wins overwrite elsewhere.
saveState('sec', { entries: [{ id: 'e1', name: 'SEC Entry', picks: { 1: 'Georgia' } }], activeEntryId: 'e1', currentWeek: 7, season: 2026 });
saveState('bigten', { entries: [{ id: 'e1', name: 'B1G Entry', picks: { 1: 'Ohio State' } }], activeEntryId: 'e1', currentWeek: 8, season: 2026 });
saveActivePoolId('sec');

const profile = buildSyncProfile();
assert.equal(profile.schemaVersion, 2);
assert.equal(profile.activePoolId, undefined, 'active pool is device-only and must not sync');
assert.equal(profile.sec.activeEntryId, undefined, 'active entry is device-only and must not sync');
assert.equal(profile.sec.currentWeek, undefined, 'focused week is device-only and must not sync');
assert.deepEqual(profile.sec.entries[0].picks, { 1: 'Georgia' });
assert.deepEqual(profile.bigten.entries[0].picks, { 1: 'Ohio State' });

// applySyncProfile() updates entries/picks while preserving this device's UI
// context. It also accepts legacy v1 profiles that still contain those old
// navigation fields, but deliberately ignores them.
const incomingProfile = {
  activePoolId: 'bigten',
  sec: { entries: [{ id: 'e9', name: 'Synced SEC', picks: { 1: 'Alabama', 2: 'Texas' } }], activeEntryId: 'e9', currentWeek: 2, season: 2026 },
  bigten: { entries: [{ id: 'e9', name: 'Synced B1G', picks: { 1: 'Michigan' } }], activeEntryId: 'e9', currentWeek: 1, season: 2026 }
};
applySyncProfile(incomingProfile);
assert.equal(loadActivePoolId(), 'sec', "incoming profile must not change this device's active pool");
assert.equal(loadState('sec').currentWeek, 7, "incoming profile must not change this device's focused SEC week");
assert.equal(loadState('bigten').currentWeek, 8, "incoming profile must not change this device's focused Big Ten week");
assert.deepEqual(loadState('sec').entries[0].picks, { 1: 'Alabama', 2: 'Texas' }, 'applySyncProfile should overwrite local SEC entries/picks');
assert.deepEqual(loadState('bigten').entries[0].picks, { 1: 'Michigan' }, 'applySyncProfile should overwrite local Big Ten entries/picks');

// applySyncProfile() should tolerate garbage input rather than throwing —
// this can be called with server data whose shape wasn't already validated
// again on the client, so it needs to fail safe.
assert.doesNotThrow(() => applySyncProfile(null));
assert.doesNotThrow(() => applySyncProfile({}));
assert.doesNotThrow(() => applySyncProfile('not an object'));

// v1.20: 2025 was previously exposed even though no authoritative Splash
// schedule exists for it. Old local/cloud snapshots must migrate to 2026
// rather than silently re-enabling generic conference eligibility.
localStorage.setItem('cfb-survivor-state-v3:sec', JSON.stringify({
  entries: [{ id: 'old', name: 'Old Season', picks: { 1: 'Georgia' } }],
  activeEntryId: 'old',
  currentWeek: 1,
  season: 2025
}));
assert.equal(loadState('sec').season, 2026, 'old local 2025 state must normalize to the supported Splash season');

applySyncProfile({
  sec: { season: 2025, entries: [{ id: 'cloud-old', name: 'Cloud Old', picks: { 1: 'Alabama' } }] },
  bigten: { season: 2025, entries: [{ id: 'cloud-old-b1g', name: 'Cloud Old B1G', picks: { 1: 'Ohio State' } }] }
});
assert.equal(loadState('sec').season, 2026, 'old synced SEC season must normalize to 2026');
assert.equal(loadState('bigten').season, 2026, 'old synced Big Ten season must normalize to 2026');
assert.equal(buildSyncProfile().sec.season, 2026, 'new sync snapshots must never publish unsupported 2025 state');

console.log('storage tests passed');
