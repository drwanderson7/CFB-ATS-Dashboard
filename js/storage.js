import { DEFAULT_SURVIVOR_SEASON, normalizeSurvivorSeason } from '../data/survivor-config.js';

const ACTIVE_POOL_KEY = 'cfb-survivor-active-pool-v1';
const LEGACY_SEC_KEY = 'sec-survivor-state-v1';
const SYNC_CODE_KEY = 'cfb-survivor-sync-code-v1';
const SYNC_DIRTY_KEY = 'cfb-survivor-sync-dirty-v1';
const SYNCED_POOL_IDS = ['sec', 'bigten'];

const memoryStorage = new Map();

function storageGet(key) {
  try { return globalThis.localStorage?.getItem(key) ?? null; }
  catch { return memoryStorage.has(key) ? memoryStorage.get(key) : null; }
}

function storageSet(key, value) {
  const serialized = String(value);
  try { globalThis.localStorage?.setItem(key, serialized); }
  catch { memoryStorage.set(key, serialized); }
}

function storageRemove(key) {
  try { globalThis.localStorage?.removeItem(key); }
  catch { memoryStorage.delete(key); }
}


function poolKey(poolId) {
  return `cfb-survivor-state-v3:${poolId}`;
}

function legacyPoolKey(poolId) {
  return `cfb-survivor-state-v2:${poolId}`;
}

function normalizePicks(picks) {
  return picks && typeof picks === 'object' && !Array.isArray(picks) ? picks : {};
}

function defaultEntry(id = 'entry-1', name = 'My Entry', picks = {}) {
  return { id, name, picks: normalizePicks(picks) };
}

function emptyState() {
  return {
    entries: [defaultEntry()],
    activeEntryId: 'entry-1',
    currentWeek: null,
    season: DEFAULT_SURVIVOR_SEASON
  };
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) return [defaultEntry()];
  const seen = new Set();
  const normalized = [];
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `entry-${index + 1}`;
    if (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    normalized.push({
      id,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `Entry ${index + 1}`,
      picks: normalizePicks(entry.picks)
    });
  });
  return normalized.length ? normalized : [defaultEntry()];
}

export function loadActivePoolId() {
  try {
    const value = storageGet(ACTIVE_POOL_KEY);
    return value === 'bigten' ? 'bigten' : 'sec';
  } catch {
    return 'sec';
  }
}

export function saveActivePoolId(poolId) {
  storageSet(ACTIVE_POOL_KEY, poolId === 'bigten' ? 'bigten' : 'sec');
}

export function loadState(poolId) {
  try {
    let raw = storageGet(poolKey(poolId));

    // v1.4 migration: convert each pool's prior single-entry v2 state into Entry 1.
    if (!raw) {
      let legacyRaw = storageGet(legacyPoolKey(poolId));
      if (!legacyRaw && poolId === 'sec') legacyRaw = storageGet(LEGACY_SEC_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw || '{}');
        const migrated = {
          entries: [defaultEntry('entry-1', typeof legacy.entryName === 'string' ? legacy.entryName : 'My Entry', legacy.picks)],
          activeEntryId: 'entry-1',
          currentWeek: legacy.currentWeek,
          season: legacy.season
        };
        storageSet(poolKey(poolId), JSON.stringify(migrated));
        raw = JSON.stringify(migrated);
      }
    }

    const parsed = JSON.parse(raw || '{}');
    const entries = normalizeEntries(parsed.entries);
    const activeEntryId = entries.some(entry => entry.id === parsed.activeEntryId)
      ? parsed.activeEntryId
      : entries[0].id;

    return {
      entries,
      activeEntryId,
      currentWeek: parsed.currentWeek !== null && parsed.currentWeek !== undefined && Number.isFinite(Number(parsed.currentWeek)) ? Number(parsed.currentWeek) : null,
      season: normalizeSurvivorSeason(parsed.season)
    };
  } catch {
    return emptyState();
  }
}

export function saveState(poolId, state) {
  const entries = normalizeEntries(state.entries);
  const activeEntryId = entries.some(entry => entry.id === state.activeEntryId)
    ? state.activeEntryId
    : entries[0].id;

  storageSet(poolKey(poolId), JSON.stringify({
    entries,
    activeEntryId,
    currentWeek: state.currentWeek,
    season: normalizeSurvivorSeason(state.season)
  }));
}

// Wipes EVERY entry in the given pool (not just the active one) and clears
// legacy migration keys too. This is intentionally distinct from "reset this
// entry's picks," which the app implements in app.js by clearing only the
// active entry's picks and calling saveState(). Do not wire this function to
// a single-entry reset action, or it will silently delete the user's other
// entries in that pool.
export function resetAllEntriesForPool(poolId) {
  storageRemove(poolKey(poolId));
  storageRemove(legacyPoolKey(poolId));
  if (poolId === 'sec') storageRemove(LEGACY_SEC_KEY);
}

// --- Cross-device sync ---------------------------------------------------
// The sync code itself is stored separately from pool state (its own
// localStorage key) since it's device-linking metadata, not pool data, and
// clearing it ("stop syncing this device") should never touch the entries
// underneath it.

export function loadSyncCode() {
  const raw = storageGet(SYNC_CODE_KEY);
  const trimmed = raw ? raw.trim() : '';
  return trimmed || null;
}

export function saveSyncCode(code) {
  storageSet(SYNC_CODE_KEY, code);
}

export function clearSyncCode() {
  storageRemove(SYNC_CODE_KEY);
}

// Persist whether this device has durable survivor edits that have not yet
// been confirmed written to the linked cloud snapshot. Persisting the flag
// matters: if a push fails and the browser closes, the next boot must not
// blindly pull older cloud data over those local edits.
export function loadSyncDirtyFlag() {
  return storageGet(SYNC_DIRTY_KEY) === '1';
}

export function saveSyncDirtyFlag(isDirty) {
  if (isDirty) storageSet(SYNC_DIRTY_KEY, '1');
  else storageRemove(SYNC_DIRTY_KEY);
}

export function clearSyncDirtyFlag() {
  storageRemove(SYNC_DIRTY_KEY);
}

// Cloud sync intentionally contains only durable survivor data. Device UI
// context (active pool, active entry, focused week, grid sort, open view, etc.)
// stays local so simply browsing on one device cannot cause a last-write-wins
// overwrite of another device's picks. `schemaVersion` makes future profile
// migrations explicit without changing the localStorage schema.
const SYNC_PROFILE_SCHEMA_VERSION = 2;

function syncPoolSnapshot(poolId) {
  const local = loadState(poolId);
  return {
    season: local.season,
    entries: local.entries.map(entry => ({
      id: entry.id,
      name: entry.name,
      picks: normalizePicks(entry.picks)
    }))
  };
}

export function buildSyncProfile() {
  const profile = { schemaVersion: SYNC_PROFILE_SCHEMA_VERSION };
  for (const poolId of SYNCED_POOL_IDS) profile[poolId] = syncPoolSnapshot(poolId);
  return profile;
}

// Applies durable synced data while preserving this device's navigation/UI
// context. Old v1 profiles may still contain activePoolId/currentWeek/
// activeEntryId; those fields are deliberately ignored on pull.
export function applySyncProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return;

  for (const poolId of SYNCED_POOL_IDS) {
    const incoming = profile[poolId];
    if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.entries)) continue;

    const local = loadState(poolId);
    const incomingIds = new Set(incoming.entries.map(entry => entry?.id).filter(Boolean));
    const activeEntryId = incomingIds.has(local.activeEntryId)
      ? local.activeEntryId
      : (incoming.entries.find(entry => entry?.id)?.id || local.activeEntryId);
    // Season is intentionally local product configuration, not a free-form
    // synced value. Older cloud profiles may still contain 2025; normalize
    // those to the only authoritative Splash season instead of re-enabling
    // the old generic-conference fallback.
    const season = normalizeSurvivorSeason(incoming.season ?? local.season);

    saveState(poolId, {
      entries: incoming.entries,
      activeEntryId,
      currentWeek: local.currentWeek,
      season
    });
  }
}
