import assert from 'node:assert/strict';
import { createSyncAccount, fetchSyncProfile, pushSyncProfile, deleteSyncAccount, SyncError } from '../js/sync.js';

const originalFetch = global.fetch;
const calls = [];

function mockFetch(handler) {
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options);
  };
}

const profile = { sec: { entries: [] }, bigten: { entries: [] } };

// createSyncAccount: POSTs the profile, returns the parsed body on success.
mockFetch(async (url, options) => {
  assert.equal(url, '/api/sync');
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body), { profile });
  return { ok: true, status: 201, json: async () => ({ code: 'ABCD-2345', updatedAt: 'now', profile }) };
});
const created = await createSyncAccount(profile);
assert.equal(created.code, 'ABCD-2345');

// fetchSyncProfile: GETs with the code in the query string, URL-encoded.
mockFetch(async (url, options) => {
  assert.equal(url, `/api/sync?code=${encodeURIComponent('ABCD-2345')}`);
  assert.equal(options.cache, 'no-store');
  return { ok: true, status: 200, json: async () => ({ code: 'ABCD-2345', updatedAt: 'now', profile }) };
});
const fetched = await fetchSyncProfile('ABCD-2345');
assert.deepEqual(fetched.profile, profile);

// pushSyncProfile: PUTs code + profile.
mockFetch(async (url, options) => {
  assert.equal(url, '/api/sync');
  assert.equal(options.method, 'PUT');
  assert.deepEqual(JSON.parse(options.body), { code: 'ABCD-2345', profile });
  return { ok: true, status: 200, json: async () => ({ code: 'ABCD-2345', updatedAt: 'later', profile }) };
});
const pushed = await pushSyncProfile('ABCD-2345', profile);
assert.equal(pushed.updatedAt, 'later');

// deleteSyncAccount: DELETEs with the code in the query string.
mockFetch(async (url, options) => {
  assert.equal(url, `/api/sync?code=${encodeURIComponent('ABCD-2345')}`);
  assert.equal(options.method, 'DELETE');
  return { ok: true, status: 200, json: async () => ({ code: 'ABCD-2345', deleted: true }) };
});
const deleted = await deleteSyncAccount('ABCD-2345');
assert.equal(deleted.deleted, true);

// A non-ok response should throw a SyncError carrying the server's message and status.
mockFetch(async () => ({ ok: false, status: 404, json: async () => ({ error: 'No synced data found for that code.' }) }));
await assert.rejects(
  () => fetchSyncProfile('ZZZZ-9999'),
  err => {
    assert.ok(err instanceof SyncError);
    assert.equal(err.status, 404);
    assert.equal(err.message, 'No synced data found for that code.');
    return true;
  }
);

// A response with an unparseable body still produces a usable error rather than throwing mid-parse.
mockFetch(async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } }));
await assert.rejects(() => pushSyncProfile('ABCD-2345', profile), SyncError);

global.fetch = originalFetch;
console.log('sync client tests passed');
