// Thin fetch wrapper around /api/sync. Kept separate from storage.js (which
// owns *local* persistence) so the local-storage schema and the networking
// concerns don't get tangled — storage.js has no idea the network exists,
// and this file has no idea what localStorage keys look like.

const SYNC_ENDPOINT = '/api/sync';

export class SyncError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SyncError';
    this.status = status;
  }
}

async function parseJsonSafe(response) {
  try { return await response.json(); }
  catch { return {}; }
}

// Creates a new sync code, seeded with `profile` (typically this device's
// current local state, so enabling sync doesn't lose existing picks).
// Resolves to { code, updatedAt, profile }.
export async function createSyncAccount(profile) {
  const response = await fetch(SYNC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile })
  });
  const body = await parseJsonSafe(response);
  if (!response.ok) throw new SyncError(body?.error || `Could not enable sync (${response.status}).`, response.status);
  return body;
}

// Fetches the profile currently stored for `code`.
// Resolves to { code, updatedAt, profile }.
export async function fetchSyncProfile(code) {
  const response = await fetch(`${SYNC_ENDPOINT}?code=${encodeURIComponent(code)}`, { cache: 'no-store' });
  const body = await parseJsonSafe(response);
  if (!response.ok) throw new SyncError(body?.error || `Could not load synced data (${response.status}).`, response.status);
  return body;
}

// Overwrites the profile stored for `code`. Resolves to { code, updatedAt, profile }.
export async function pushSyncProfile(code, profile) {
  const response = await fetch(SYNC_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, profile })
  });
  const body = await parseJsonSafe(response);
  if (!response.ok) throw new SyncError(body?.error || `Sync failed (${response.status}).`, response.status);
  return body;
}

// Permanently deletes the synced data stored for `code` on the server —
// distinct from "stop syncing this device," which only forgets the code
// locally. Resolves to { code, deleted }.
export async function deleteSyncAccount(code) {
  const response = await fetch(`${SYNC_ENDPOINT}?code=${encodeURIComponent(code)}`, { method: 'DELETE', cache: 'no-store' });
  const body = await parseJsonSafe(response);
  if (!response.ok) throw new SyncError(body?.error || `Could not delete synced data (${response.status}).`, response.status);
  return body;
}
