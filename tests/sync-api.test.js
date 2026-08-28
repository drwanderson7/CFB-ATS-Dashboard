import assert from 'node:assert/strict';
import { createHandler } from '../api/sync.js';

const SYNC_TTL_SECONDS = 60 * 60 * 24 * 180;

function makeStore() {
  const store = new Map();
  const counters = new Map();
  const setCalls = [];
  const expireCalls = [];
  return {
    store,
    counters,
    setCalls,
    expireCalls,
    kvGet: async key => (store.has(key) ? store.get(key) : null),
    kvSet: async (key, value, ttlSeconds) => { store.set(key, value); setCalls.push({ key, value, ttlSeconds }); },
    kvDelete: async key => { store.delete(key); },
    kvIncr: async key => {
      const next = (counters.get(key) || 0) + 1;
      counters.set(key, next);
      return next;
    },
    kvExpire: async (key, seconds) => { expireCalls.push({ key, seconds }); }
  };
}

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  return res;
}

function mockReq({ method, query = {}, body = {}, ip = '203.0.113.5' } = {}) {
  return { method, query, body, headers: ip ? { 'x-forwarded-for': ip } : {} };
}

const validProfile = {
  sec: { entries: [{ id: 'entry-1', name: 'My Entry', picks: { 1: 'Georgia' } }], activeEntryId: 'entry-1', currentWeek: 1, season: 2026 },
  bigten: { entries: [{ id: 'entry-1', name: 'My Entry', picks: {} }], activeEntryId: 'entry-1', currentWeek: 1, season: 2026 }
};

// Not configured (missing KV_REST_API_URL/TOKEN): must fail safe with a
// clear 503 rather than throwing, mirroring api/survivor-data.js's
// CFBD_API_KEY-missing behavior.
{
  const handler = createHandler({ configured: () => false });
  const res = mockRes();
  await handler(mockReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0, must-revalidate');
  assert.equal(res.body.setupRequired, true);
}

// POST creates a new code and stores the seeded profile, with a TTL set.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire, store, setCalls } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { profile: validProfile } }), res);
  assert.equal(res.statusCode, 201);
  assert.match(res.body.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'code should be formatted like ABCD-2345');
  assert.deepEqual(res.body.profile, validProfile);
  assert.equal(store.size, 1, 'exactly one record should be written');
  assert.equal(setCalls[0].ttlSeconds, SYNC_TTL_SECONDS, 'creating a code should set the abandonment TTL');
}

// POST with no/malformed profile is rejected rather than creating a cloud
// snapshot that a buggy client could later mistake for valid empty data.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire, store } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const res = mockRes();
  await handler(mockReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(store.size, 0);
}

// GET round-trips what POST stored.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const createRes = mockRes();
  await handler(mockReq({ method: 'POST', body: { profile: validProfile } }), createRes);
  const code = createRes.body.code;

  const getRes = mockRes();
  await handler(mockReq({ method: 'GET', query: { code } }), getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.code, code);
  assert.deepEqual(getRes.body.profile, validProfile);

  // Case/whitespace-insensitive and dash-optional input should still resolve.
  const getRes2 = mockRes();
  await handler(mockReq({ method: 'GET', query: { code: `  ${code.toLowerCase()}  ` } }), getRes2);
  assert.equal(getRes2.statusCode, 200);
}

// GET with an unknown code returns 404, not a crash or empty-success.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: { code: 'ABCD-2345' } }), res);
  assert.equal(res.statusCode, 404);
}

// GET with a malformed code is rejected before ever touching the store.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire, store } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: { code: 'not a code!!' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(store.size, 0);
}

// PUT overwrites an existing code's profile, bumps updatedAt, and refreshes the TTL.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire, setCalls } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const createRes = mockRes();
  await handler(mockReq({ method: 'POST', body: { profile: validProfile } }), createRes);
  const code = createRes.body.code;
  const firstUpdatedAt = createRes.body.updatedAt;

  await new Promise(resolve => setTimeout(resolve, 5));

  const updatedProfile = {
    ...validProfile,
    sec: { ...validProfile.sec, entries: [{ id: 'entry-1', name: 'My Entry', picks: { 1: 'Georgia', 2: 'Texas' } }] }
  };
  const putRes = mockRes();
  await handler(mockReq({ method: 'PUT', body: { code, profile: updatedProfile } }), putRes);
  assert.equal(putRes.statusCode, 200);
  assert.deepEqual(putRes.body.profile, updatedProfile);
  assert.notEqual(putRes.body.updatedAt, firstUpdatedAt, 'updatedAt should advance on write');
  assert.equal(setCalls[setCalls.length - 1].ttlSeconds, SYNC_TTL_SECONDS, 'PUT should refresh the abandonment TTL too');

  const getRes = mockRes();
  await handler(mockReq({ method: 'GET', query: { code } }), getRes);
  assert.deepEqual(getRes.body.profile, updatedProfile, 'subsequent GET should reflect the PUT');
}

// PUT against a code that was never created is rejected rather than
// silently creating a record (that's what POST is for).
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire, store } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const res = mockRes();
  await handler(mockReq({ method: 'PUT', body: { code: 'ABCD-2345', profile: validProfile } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(store.size, 0);
}

// PUT with a malformed/incomplete profile is rejected — guards against a
// buggy client overwriting good synced data with garbage.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const createRes = mockRes();
  await handler(mockReq({ method: 'POST', body: { profile: validProfile } }), createRes);
  const code = createRes.body.code;

  const res = mockRes();
  await handler(mockReq({ method: 'PUT', body: { code, profile: { sec: {} } } }), res);
  assert.equal(res.statusCode, 400);

  const getRes = mockRes();
  await handler(mockReq({ method: 'GET', query: { code } }), getRes);
  assert.deepEqual(getRes.body.profile, validProfile, 'the bad PUT must not have overwritten the good profile');
}

// An oversized profile is rejected on both POST and PUT.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const huge = { sec: { entries: [{ id: 'x', name: 'x', picks: { 1: 'x'.repeat(300000) } }] }, bigten: { entries: [] } };
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { profile: huge } }), res);
  assert.equal(res.statusCode, 413);
}

// The size limit is based on actual UTF-8 bytes, not JavaScript string
// length. Multibyte text can be under 200k characters but over 200k bytes.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const multibyte = { sec: { entries: [{ id: 'x', name: 'é'.repeat(110000), picks: {} }] }, bigten: { entries: [] } };
  assert.ok(JSON.stringify(multibyte).length < 200 * 1024, 'fixture should be under the old character-count limit');
  assert.ok(Buffer.byteLength(JSON.stringify(multibyte), 'utf8') > 200 * 1024, 'fixture should exceed the byte limit');
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { profile: multibyte } }), res);
  assert.equal(res.statusCode, 413);
}

// Unsupported methods get a clean 405, not a crash, and the Allow header
// now includes DELETE alongside the other three.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const res = mockRes();
  await handler(mockReq({ method: 'PATCH' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET, POST, PUT, DELETE');
}

// --- DELETE endpoint (P8 hardening) ---

// DELETE removes an existing code; a subsequent GET 404s.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire, store } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const createRes = mockRes();
  await handler(mockReq({ method: 'POST', body: { profile: validProfile } }), createRes);
  const code = createRes.body.code;

  const delRes = mockRes();
  await handler(mockReq({ method: 'DELETE', query: { code } }), delRes);
  assert.equal(delRes.statusCode, 200);
  assert.equal(delRes.body.deleted, true);
  assert.equal(store.size, 0);

  const getRes = mockRes();
  await handler(mockReq({ method: 'GET', query: { code } }), getRes);
  assert.equal(getRes.statusCode, 404, 'the code should no longer resolve after deletion');
}

// DELETE on a code that never existed (or was already deleted) is not an
// error — the caller's goal is already satisfied.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const res = mockRes();
  await handler(mockReq({ method: 'DELETE', query: { code: 'ABCD-2345' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, false);
}

// DELETE with a malformed code is still rejected with 400.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const res = mockRes();
  await handler(mockReq({ method: 'DELETE', query: { code: 'nope' } }), res);
  assert.equal(res.statusCode, 400);
}

console.log('sync API tests passed');

// --- Rate limiting (P8 hardening) ---
// KV-backed (not in-memory) since serverless functions don't share memory
// across invocations/regions — an in-memory counter would silently do
// nothing under real traffic. `now` is injected so the fixed-window bucket
// is deterministic instead of depending on wall-clock timing during the test.

// Account creation: the 9th POST from the same IP within the same 10-minute
// window should be rejected with 429 + Retry-After; the general (get/put)
// budget must not be touched by create-rate-limiting.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const fixedNow = () => Date.parse('2026-09-01T12:00:00Z');
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true, now: fixedNow });

  let lastRes;
  for (let i = 0; i < 8; i++) {
    lastRes = mockRes();
    await handler(mockReq({ method: 'POST', body: { profile: validProfile } }), lastRes);
    assert.equal(lastRes.statusCode, 201, `request ${i + 1} of 8 should succeed`);
  }

  const ninthRes = mockRes();
  await handler(mockReq({ method: 'POST', body: { profile: validProfile } }), ninthRes);
  assert.equal(ninthRes.statusCode, 429, 'the 9th creation in the same window from the same IP should be rate limited');
  assert.equal(ninthRes.headers['Retry-After'], '600');
}

// A different IP gets its own independent creation budget.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const fixedNow = () => Date.parse('2026-09-01T12:00:00Z');
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true, now: fixedNow });

  for (let i = 0; i < 8; i++) {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { profile: validProfile }, ip: '198.51.100.1' }), res);
    assert.equal(res.statusCode, 201);
  }
  // Same window, different IP — should still succeed, not inherit the other IP's usage.
  const otherIpRes = mockRes();
  await handler(mockReq({ method: 'POST', body: { profile: validProfile }, ip: '198.51.100.2' }), otherIpRes);
  assert.equal(otherIpRes.statusCode, 201, 'a different IP must have its own creation budget');
}

// General bucket (GET/PUT/DELETE): the 61st request in the same minute from
// the same IP should be rejected, and creating a code doesn't consume this
// budget (create uses its own separate counter).
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const fixedNow = () => Date.parse('2026-09-01T12:00:00Z');
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true, now: fixedNow });

  const createRes = mockRes();
  await handler(mockReq({ method: 'POST', body: { profile: validProfile } }), createRes);
  const code = createRes.body.code;

  for (let i = 0; i < 60; i++) {
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: { code } }), res);
    assert.equal(res.statusCode, 200, `general request ${i + 1} of 60 should succeed`);
  }

  const overLimitRes = mockRes();
  await handler(mockReq({ method: 'GET', query: { code } }), overLimitRes);
  assert.equal(overLimitRes.statusCode, 429, 'the 61st general request in the same window should be rate limited');
  assert.equal(overLimitRes.headers['Retry-After'], '60');
}

// Missing x-forwarded-for (e.g. local dev with no proxy) must not crash —
// it degrades to a shared 'unknown' bucket rather than throwing.
{
  const { kvGet, kvSet, kvDelete, kvIncr, kvExpire } = makeStore();
  const handler = createHandler({ kvGet, kvSet, kvDelete, kvIncr, kvExpire, configured: () => true });
  const res = mockRes();
  await handler({ method: 'POST', query: {}, body: { profile: validProfile }, headers: {} }, res);
  assert.equal(res.statusCode, 201);
}

console.log('sync rate-limit tests passed');
