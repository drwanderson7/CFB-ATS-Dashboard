// Cross-device sync — the "account" here is a single random code, not an
// email/password login. Whoever has the code can read and overwrite the
// synced profile; that's the entire security model. This is a deliberate
// scope decision for a casual pool tool used by a small number of people who
// already trust each other, not something to reuse for anything sensitive.
// See HANDOFF.md for the fuller rationale.
//
// Storage: a single JSON blob per code, holding both pools' durable survivor
// state (season + entries/names/picks). Device UI/navigation state stays local;
// see js/storage.js buildSyncProfile()/applySyncProfile().
//
// Endpoints (all on /api/sync):
//   POST   { profile }       -> creates a new code, seeds it with `profile`
//                               (typically the device's current local state,
//                               so the first device to sync doesn't lose picks)
//   GET    ?code=XXXX-XXXX   -> { code, updatedAt, profile }
//   PUT    { code, profile } -> overwrites the stored profile, bumps updatedAt
//   DELETE ?code=XXXX-XXXX   -> permanently deletes the synced data for that code
//
// Conflict handling is intentionally simple: last write wins. There's no
// merge of concurrent edits from two devices. For a once-a-week pick tool
// used solo or by a couple of friends who coordinate by talking to each
// other, that's an acceptable tradeoff against the complexity of real
// conflict resolution — see the "Not built" note in HANDOFF.md.
//
// Hardening (P8): every write refreshes a TTL so codes nobody uses for a
// long stretch clean themselves up automatically instead of sitting in KV
// forever; a DELETE endpoint lets someone remove their synced data
// immediately rather than waiting on that TTL; and every request is
// rate-limited per IP using the KV store itself as the counter (an
// in-memory counter would not work here — serverless functions don't share
// memory across invocations or regions, so it would silently do nothing
// under real traffic).

import { randomBytes } from 'node:crypto';
import { isKvConfigured, kvGet, kvSet, kvDelete, kvIncr, kvExpire } from './_lib/kv.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — easy to read and type aloud
const CODE_GROUP_LENGTH = 4;
const CODE_GROUPS = 2;
const MAX_PROFILE_BYTES = 200 * 1024; // generous for this data shape; guards against abuse/mistakes
const KEY_PREFIX = 'cfb-survivor-sync:';

// A code left untouched for this long is treated as abandoned and expires.
// Every successful write (POST/PUT) refreshes it, so an actively-used code
// never comes close to this — it only matters for pools/entries someone
// truly stopped using. Reads (GET) deliberately do NOT refresh it: a code
// that's only ever pulled from, never pushed to, isn't "active" in the sense
// that matters (nobody's picks are actually changing), and syncing a pull to
// count as activity would mean a code some other tool polls periodically
// could never expire even after the person genuinely stopped playing.
const SYNC_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days

// Rate limits are per IP, using a fixed window counted with kvIncr/kvExpire.
// Account creation gets the stricter limit since each one is a new stored
// record; reads/writes against an *existing* code get a much more generous
// one since normal usage (a debounced push after every pick, an occasional
// pull) can legitimately fire several requests a minute, especially if
// multiple devices share a household IP.
const RATE_LIMITS = {
  create: { limit: 8, windowSeconds: 600 },   // 8 new codes / 10 min / IP
  general: { limit: 60, windowSeconds: 60 }   // 60 read/write calls / 1 min / IP
};

function randomCode() {
  const bytes = randomBytes(CODE_GROUP_LENGTH * CODE_GROUPS);
  const chars = Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
  const groups = [];
  for (let i = 0; i < CODE_GROUPS; i++) {
    groups.push(chars.slice(i * CODE_GROUP_LENGTH, (i + 1) * CODE_GROUP_LENGTH).join(''));
  }
  return groups.join('-');
}

function normalizeCode(rawCode) {
  return String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

function isValidCodeFormat(code) {
  return new RegExp(`^[A-Z0-9]{${CODE_GROUP_LENGTH}}(-[A-Z0-9]{${CODE_GROUP_LENGTH}}){${CODE_GROUPS - 1}}$`).test(code);
}

// Very small, deliberately permissive shape check — this isn't trying to
// fully validate every field of the survivor storage schema (js/storage.js
// already does that on the read side when it loads state), just to reject
// obviously-wrong payloads (wrong type, empty object, missing pool keys)
// before they overwrite a device's synced data.
function isPlausibleProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  const pools = ['sec', 'bigten'];
  return pools.every(poolId => {
    const poolState = profile[poolId];
    return poolState && typeof poolState === 'object' && Array.isArray(poolState.entries);
  });
}

function profileByteLength(profile) {
  return Buffer.byteLength(JSON.stringify(profile), 'utf8');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  // Fallback for runtimes that don't pre-parse the body.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// Best-effort client IP extraction. Vercel sets x-forwarded-for; falls back
// to a shared 'unknown' bucket if it's ever missing (e.g. local dev without
// a proxy in front) so rate limiting degrades to "one shared bucket for
// everyone with no IP header" rather than throwing.
function clientIp(req) {
  const header = req.headers?.['x-forwarded-for'] || req.headers?.['X-Forwarded-For'];
  if (!header) return 'unknown';
  return String(header).split(',')[0].trim() || 'unknown';
}

export function createHandler({
  kvGet: get = kvGet,
  kvSet: set = kvSet,
  kvDelete: del = kvDelete,
  kvIncr: incr = kvIncr,
  kvExpire: expire = kvExpire,
  configured = isKvConfigured,
  now = () => Date.now()
} = {}) {
  // Increments the counter for (bucketName, ip) within the current fixed
  // window and reports whether the caller is still under the limit. Sets the
  // counter key's own TTL on its first increment each window so counter keys
  // don't accumulate forever either.
  async function checkRateLimit(bucketName, ip) {
    const { limit, windowSeconds } = RATE_LIMITS[bucketName];
    const windowStart = Math.floor(now() / 1000 / windowSeconds);
    const key = `cfb-survivor-ratelimit:${bucketName}:${ip}:${windowStart}`;
    const count = await incr(key);
    if (count === 1) {
      // Only the request that created the counter needs to set its expiry.
      await expire(key, windowSeconds);
    }
    return count <= limit;
  }

  return async function handler(req, res) {
    // Sync data is personalized, frequently changing state. It must never be
    // cached by a browser, CDN, or shared proxy; a stale GET could otherwise
    // resurrect an old pick after another device changed or deleted it.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');

    if (!configured()) {
      return res.status(503).json({
        error: 'Cross-device sync is not configured on the server (missing KV_REST_API_URL/KV_REST_API_TOKEN).',
        setupRequired: true
      });
    }

    const ip = clientIp(req);

    try {
      if (req.method === 'POST') {
        if (!(await checkRateLimit('create', ip))) {
          res.setHeader('Retry-After', String(RATE_LIMITS.create.windowSeconds));
          return res.status(429).json({ error: 'Too many sync codes created from this network recently. Try again in a few minutes.' });
        }

        const body = await readBody(req);
        if (!isPlausibleProfile(body?.profile)) {
          return res.status(400).json({ error: 'Profile payload is missing expected pool data.' });
        }
        const profile = body.profile;
        if (profileByteLength(profile) > MAX_PROFILE_BYTES) {
          return res.status(413).json({ error: 'Profile payload is too large to sync.' });
        }

        // Extremely unlikely to collide (32^8 space), but check anyway rather
        // than silently overwriting an existing code's data.
        let code = randomCode();
        for (let attempt = 0; attempt < 5; attempt++) {
          const existing = await get(KEY_PREFIX + code);
          if (!existing) break;
          code = randomCode();
        }

        const updatedAt = new Date().toISOString();
        await set(KEY_PREFIX + code, JSON.stringify({ code, updatedAt, profile }), SYNC_TTL_SECONDS);
        return res.status(201).json({ code, updatedAt, profile });
      }

      if (!(await checkRateLimit('general', ip))) {
        res.setHeader('Retry-After', String(RATE_LIMITS.general.windowSeconds));
        return res.status(429).json({ error: 'Too many sync requests from this network recently. Try again in a minute.' });
      }

      if (req.method === 'GET') {
        const code = normalizeCode(req.query?.code);
        if (!isValidCodeFormat(code)) {
          return res.status(400).json({ error: 'That sync code doesn\'t look right. It should look like ABCD-2345.' });
        }
        const stored = await get(KEY_PREFIX + code);
        if (!stored) {
          return res.status(404).json({ error: 'No synced data found for that code.' });
        }
        const parsed = JSON.parse(stored);
        return res.status(200).json(parsed);
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        const code = normalizeCode(body?.code);
        if (!isValidCodeFormat(code)) {
          return res.status(400).json({ error: 'That sync code doesn\'t look right. It should look like ABCD-2345.' });
        }
        if (!isPlausibleProfile(body?.profile)) {
          return res.status(400).json({ error: 'Profile payload is missing expected pool data.' });
        }
        if (profileByteLength(body.profile) > MAX_PROFILE_BYTES) {
          return res.status(413).json({ error: 'Profile payload is too large to sync.' });
        }

        const existing = await get(KEY_PREFIX + code);
        if (!existing) {
          return res.status(404).json({ error: 'No synced data found for that code. Create a new sync code on this device instead.' });
        }

        const updatedAt = new Date().toISOString();
        await set(KEY_PREFIX + code, JSON.stringify({ code, updatedAt, profile: body.profile }), SYNC_TTL_SECONDS);
        return res.status(200).json({ code, updatedAt, profile: body.profile });
      }

      if (req.method === 'DELETE') {
        const code = normalizeCode(req.query?.code);
        if (!isValidCodeFormat(code)) {
          return res.status(400).json({ error: 'That sync code doesn\'t look right. It should look like ABCD-2345.' });
        }
        const existing = await get(KEY_PREFIX + code);
        if (!existing) {
          // Deleting something that's already gone is not an error — the
          // caller's goal ("this code should not exist") is already true.
          return res.status(200).json({ code, deleted: false });
        }
        await del(KEY_PREFIX + code);
        return res.status(200).json({ code, deleted: true });
      }

      res.setHeader('Allow', 'GET, POST, PUT, DELETE');
      return res.status(405).json({ error: `Method ${req.method} not allowed.` });
    } catch (error) {
      const status = Number(error?.status) || 500;
      return res.status(status >= 400 && status < 600 ? status : 500).json({
        error: error?.message || 'Unable to reach the sync store.'
      });
    }
  };
}

export default createHandler();
