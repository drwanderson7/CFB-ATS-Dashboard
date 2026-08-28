// Minimal REST client for Upstash Redis's HTTP API — the same protocol
// Vercel KV exposes (Vercel KV *is* Upstash Redis under the hood, using the
// identically-named KV_REST_API_URL / KV_REST_API_TOKEN env vars). Written by
// hand with plain fetch instead of adding the @vercel/kv or @upstash/redis
// npm packages, to match this project's existing zero-npm-dependency style
// (see api/survivor-data.js's hand-written CFBD client) and so it's testable
// the same way — by mocking global.fetch — without needing a real Redis
// instance or SDK-specific test doubles.
//
// Deploy setup: in the Vercel dashboard, add "Vercel KV" (or any
// Upstash-compatible Redis) to the project under Storage. Vercel injects
// KV_REST_API_URL and KV_REST_API_TOKEN automatically — no code changes
// needed beyond what's already here.
//
// Operations wrapped: GET, SET (with optional TTL), DEL, and INCR/EXPIRE
// (used together for rate limiting — see api/sync.js). Upstash's REST API
// supports much more (see https://upstash.com/docs/redis/features/restapi)
// but there's no reason to wrap commands this app doesn't use.

export function isKvConfigured(env = process.env) {
  return Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
}

async function kvFetch(env, path, options) {
  const url = `${env.KV_REST_API_URL.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.KV_REST_API_TOKEN}`,
      ...(options?.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`KV store ${response.status}: ${body.slice(0, 180)}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

// Returns the stored string value for `key`, or null if the key doesn't exist.
export async function kvGet(key, env = process.env) {
  const result = await kvFetch(env, `/get/${encodeURIComponent(key)}`, { method: 'GET' });
  return result?.result ?? null;
}

// Stores `value` (a string — callers JSON.stringify their own data) under
// `key`. `ttlSeconds`, when given, sets an expiry on the key (Upstash's SET
// endpoint accepts command options as query params, e.g. `?EX=<seconds>`) —
// used to auto-expire abandoned sync codes rather than keeping every code
// ever created forever. `env` is last since it almost always defaults; only
// tests need to override it.
export async function kvSet(key, value, ttlSeconds = null, env = process.env) {
  const query = ttlSeconds ? `?EX=${encodeURIComponent(ttlSeconds)}` : '';
  await kvFetch(env, `/set/${encodeURIComponent(key)}${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: value
  });
}

// Deletes `key`. No-op (not an error) if it didn't exist.
export async function kvDelete(key, env = process.env) {
  await kvFetch(env, `/del/${encodeURIComponent(key)}`, { method: 'POST' });
}

// Atomically increments `key` (creating it at 0 first if missing) and
// returns the new integer value. Used as the counter half of rate limiting;
// pair with kvExpire on the first increment so counter keys don't accumulate
// forever (see checkRateLimit in api/sync.js).
export async function kvIncr(key, env = process.env) {
  const result = await kvFetch(env, `/incr/${encodeURIComponent(key)}`, { method: 'POST' });
  return Number(result?.result);
}

// Sets a TTL (in seconds) on an existing key.
export async function kvExpire(key, seconds, env = process.env) {
  await kvFetch(env, `/expire/${encodeURIComponent(key)}/${seconds}`, { method: 'POST' });
}
