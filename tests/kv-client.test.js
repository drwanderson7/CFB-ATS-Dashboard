import assert from 'node:assert/strict';
import { isKvConfigured, kvGet, kvSet, kvDelete, kvIncr, kvExpire } from '../api/_lib/kv.js';

assert.equal(isKvConfigured({}), false);
assert.equal(isKvConfigured({ KV_REST_API_URL: 'https://example.com' }), false, 'both env vars are required');
assert.equal(isKvConfigured({ KV_REST_API_URL: 'https://example.com', KV_REST_API_TOKEN: 'tok' }), true);

const env = { KV_REST_API_URL: 'https://example-kv.upstash.io', KV_REST_API_TOKEN: 'test-token' };
const originalFetch = global.fetch;
const requests = [];

global.fetch = async (url, options) => {
  requests.push({ url: String(url), options });
  const path = String(url);
  if (path.includes('/get/')) {
    if (path.includes('missing-key')) {
      return { ok: true, status: 200, json: async () => ({ result: null }), text: async () => '{"result":null}' };
    }
    return { ok: true, status: 200, json: async () => ({ result: '{"hello":"world"}' }), text: async () => '' };
  }
  if (path.includes('/set/')) {
    return { ok: true, status: 200, json: async () => ({ result: 'OK' }), text: async () => '' };
  }
  if (path.includes('/del/')) {
    return { ok: true, status: 200, json: async () => ({ result: 1 }), text: async () => '' };
  }
  if (path.includes('/incr/')) {
    return { ok: true, status: 200, json: async () => ({ result: 3 }), text: async () => '' };
  }
  if (path.includes('/expire/')) {
    return { ok: true, status: 200, json: async () => ({ result: 1 }), text: async () => '' };
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
};

const value = await kvGet('some-key', env);
assert.equal(value, '{"hello":"world"}');
assert.ok(requests[0].url.endsWith('/get/some-key'));
assert.equal(requests[0].options.headers.Authorization, 'Bearer test-token');

const missing = await kvGet('missing-key', env);
assert.equal(missing, null);

await kvSet('some-key', '{"a":1}', null, env);
const setRequest = requests.find(r => r.url.endsWith('/set/some-key'));
assert.ok(setRequest, 'kvSet should hit the /set/<key> endpoint');
assert.equal(setRequest.options.method, 'POST');
assert.equal(setRequest.options.body, '{"a":1}');
assert.equal(setRequest.options.headers.Authorization, 'Bearer test-token');

// A TTL should be appended as an EX query param so Upstash expires the key —
// this is what makes abandoned sync codes eventually clean themselves up.
await kvSet('ttl-key', '{"b":2}', 86400, env);
const ttlRequest = requests.find(r => r.url.includes('/set/ttl-key'));
assert.ok(ttlRequest, 'kvSet with a TTL should still hit /set/<key>');
assert.match(ttlRequest.url, /\?EX=86400$/, 'TTL should be passed as an EX query parameter');

// No TTL means no EX param at all (not EX=null or EX=0).
const noTtlRequest = requests.find(r => r.url.endsWith('/set/some-key'));
assert.ok(!noTtlRequest.url.includes('EX='), 'omitting ttlSeconds should not add an EX param');

await kvDelete('some-key', env);
const delRequest = requests.find(r => r.url.endsWith('/del/some-key'));
assert.ok(delRequest, 'kvDelete should hit the /del/<key> endpoint');
assert.equal(delRequest.options.method, 'POST');

const incrResult = await kvIncr('counter-key', env);
assert.equal(incrResult, 3, 'kvIncr should return the numeric result from the store');
const incrRequest = requests.find(r => r.url.endsWith('/incr/counter-key'));
assert.ok(incrRequest, 'kvIncr should hit the /incr/<key> endpoint');
assert.equal(incrRequest.options.method, 'POST');

await kvExpire('counter-key', 60, env);
const expireRequest = requests.find(r => r.url.endsWith('/expire/counter-key/60'));
assert.ok(expireRequest, 'kvExpire should hit the /expire/<key>/<seconds> endpoint');

// A non-ok response should throw with the status attached, so the API
// handler's catch block can map it to a sensible HTTP status.
global.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
await assert.rejects(() => kvGet('x', env), err => {
  assert.equal(err.status, 500);
  return true;
});

global.fetch = originalFetch;
console.log('KV client tests passed');
