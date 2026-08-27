"""
Vercel Python serverless function: GET/POST /api/state

Cross-device sync for PickGauge, split into two storage tiers so this can
support multiple people without them overwriting each other's picks:

  scope=shared  -> one fixed key, same data for everyone (Vegas lines pull,
                   predictiontracker.com rows, related fetch metadata,
                   published test pools). Redistributing someone's PAID
                   Powers PDF numbers to other people would be a licensing
                   problem (flagged in project notes) -- PDF-derived
                   BP/Comp numbers are NOT in this tier, they live in each
                   person's private state instead.

  scope=user    -> one key per person (picks, entries, pools, PDF-derived
                   inputs, model weights/thresholds, everything else).

AUTH: every request must carry a real, verified Clerk session token as
`Authorization: Bearer <token>`, checked against Clerk's public signing key
(RS256, fetched from CLERK_JWKS_URL and cached). The verified token's own
`sub` claim IS the private-tier key -- there's no client-supplied `id`
parameter. A forged or mistyped token is simply rejected.

SHARED-TIER WRITES (rewritten, then rewritten again): a generic "POST
scope=shared, body=anything" used to exist, which meant ANY signed-in
person could overwrite the one global bucket everyone reads -- by
accident (a stale/buggy client), or on purpose. That's gone. The shared
tier is now server-owned:
  - fetch_odds.py and fetch_predictions.py write their own slice of the
    shared bucket themselves, server-side, right after a successful fetch
    -- the browser never gets to POST that data.
  - The one remaining legitimate client-initiated shared write (publishing
    a pool template) goes through a narrow, explicit
    `action=publish_pool` endpoint that can only touch pool data, and
    only a pool's own original publisher may overwrite it (a second
    version of this endpoint briefly had no ownership check at all --
    fixed now).
  - `action=clear_predictions` used to exist too and has been REMOVED: it
    let any signed-in user wipe shared predictions for every other user,
    which is exactly the kind of global-blast-radius action this
    rewrite was supposed to eliminate. "Clear predictions" is a
    local/private action now (see index.html's clearColumn) -- it stops
    showing predictions on that one device/account without touching what
    anyone else sees.
  - GET scope=shared is still open to any signed-in user (read-only).

SHARED-TIER STORAGE (split into per-domain keys): all three shared writers
above used to read-modify-write ONE combined blob (`edge_board_shared`).
That meant a genuine cross-domain race existed: fetch_odds.py and
fetch_predictions.py could both read the same snapshot, both compute their
own field's update against it, and whichever POST landed second would
silently overwrite the other's write with its own now-stale snapshot of
everything else -- an odds refresh could vanish because a predictions
fetch happened to land a moment later, with no error and no indication
anywhere that it happened. Odds, predictions, and published pools are now
three independent keys (SHARED_ODDS_KEY / SHARED_PREDICTIONS_KEY /
SHARED_POOLS_KEY) -- fetch_odds.py and fetch_predictions.py literally
cannot touch each other's data anymore, because they're not on the same
key. GET scope=shared reads all three and merges them into one flat
response object so the client's SHARED_FIELDS handling in index.html
doesn't need to change at all -- see _get_shared_state() below, which also
falls back to the old combined key for any field not yet present under
its new key, so a fresh deploy doesn't blank out whatever was already
cached under the old key.

Pool publishing (`sharedPools`) gets stronger treatment than a key split
alone: unlike odds/predictions, which are full replaces of their own data
every time, publishing a pool is a genuine read-modify-write against a
LIST that any signed-in user might be appending to or updating an entry
in (two different people publishing two different pools at close to the
same moment, or the same pool's owner updating it from two tabs). A key
split alone doesn't fix that -- two writers on the SAME key (the pools
key) can still race each other. `_publish_pool` now uses the same atomic
compare-and-set primitive (`cas_write`/`CAS_SCRIPT`) already proven for
private-state writes, with a short retry-on-conflict loop: if another
publish landed in between this request's read and write, re-read the
now-current list, re-apply this request's own change on top of it, and
retry -- rather than either silently dropping one publish, or rejecting
the person outright for a conflict that a simple retry resolves cleanly.

PRIVATE-TIER CONCURRENCY (new): private writes now carry a revision number.
A POST must include `expectedRevision` matching what the server currently
has, or it's rejected with 409 (see _post_user_state) instead of silently
overwriting a newer write from another device with a stale one.

LEGACY MIGRATION (tightened): `claim_legacy` used to accept any `legacy_id`
from any signed-in user with no proof they owned that old handle -- since
the old system was just a self-typed, unverified handle, this meant User A
could type User B's old handle and pull User B's private data into their
own account. It's now gated behind a second, server-only secret
(MIGRATION_ADMIN_SECRET) that isn't the person's own Clerk token, so a
regular signed-in user can no longer self-serve someone else's bucket.

This exact verify_user() function is duplicated in every api/*.py file --
Vercel's Python runtime does not reliably support importing a sibling
module across these isolated functions (confirmed non-viable without a
live redeploy to test against, so not changed here -- see HANDOFF for the
tradeoff). api/state.py is the source-of-truth copy; a checked-in test
(tests/test_auth_sync.py) diffs this function's source against the other
six files and fails if they drift, replacing "keep them in sync by hand"
with something that actually catches drift.

Backed by Upstash Redis (see _kv_creds below for the env var names).
GET  -> {"state": <saved object for this scope, or null>, "revision": <int, scope=user only>}
POST -> body is the state JSON for that scope (scope=user requires
        ?expectedRevision=<int> and returns 409 on conflict).
"""
from http.server import BaseHTTPRequestHandler
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
import jwt
from jwt import PyJWKClient

# Generic message shown to the person on an unhandled server error --
# NEVER the real exception text. A raw Python exception string can carry
# internal URL structure, env var names, stack fragments, or third-party
# response bodies (see _log_server_error() below, which is where the real
# detail actually goes -- server-side only, via Vercel's function logs,
# never in the HTTP response). Kept as one exact literal string (not
# reworded per call site) so it's trivially greppable/pinned by
# tests/test_error_shapes.py, the same reasoning AUTH_EXPIRED_MESSAGE
# there already gets.
GENERIC_SERVER_ERROR = "Something went wrong processing that request — try again shortly."


def _log_server_error(context, exc):
    """The ONLY place the real exception text goes -- stderr, which
    Vercel captures as function logs, never the HTTP response body. Every
    api/*.py file has its own copy (see verify_user()'s own duplication
    note above for why nothing is shared across these files)."""
    print(f"[api/state.py] {context}: {exc}", file=sys.stderr)

SHARED_KEY = "edge_board_shared"  # legacy combined key -- read-only fallback now, see _get_shared_state()
SHARED_ODDS_KEY = "edge_board_shared_odds"
SHARED_PREDICTIONS_KEY = "edge_board_shared_predictions"
SHARED_POOLS_KEY = "edge_board_shared_pools"
USER_KEY_PREFIX = "edge_board_user_"

# --- Private-state size limits ---------------------------------------------
# Nothing capped the body a client could POST to scope=user before this --
# an unbounded write is both a real cost risk (Upstash bills/limits by data
# size) and a blast-radius risk (one runaway/buggy/malicious payload
# permanently bloating a single Redis key that every subsequent read/write
# for that account has to move). MAX_STATE_BYTES is checked against the
# RAW bytes actually read off the wire (not just the trusted Content-Length
# header -- see _post_user_state) before JSON is even parsed, so an
# oversized body is rejected cheaply. The per-field limits below are
# checked AFTER parsing, specifically on the fields most exposed to
# unbounded growth from repeated pool imports/creation -- everything else
# in the state blob (predictions, PDF inputs, weights) is implicitly
# bounded by MAX_STATE_BYTES already.
#
# All five numbers are deliberately generous relative to any real season --
# a full CFB season is ~14 weeks, a real pool rarely exceeds ~70 FBS games
# or a handful of entries -- these exist to catch a runaway bug or genuine
# abuse, not to pinch a real user's normal usage.
MAX_STATE_BYTES = 2_000_000       # ~2MB -- a real multi-pool season's worth of state is well under this
MAX_POOLS = 50                    # per account
MAX_POOL_NAME_LEN = 200
MAX_ENTRY_NAME_LEN = 200
MAX_GAMES_PER_POOL = 200          # a real week is ~40-70 FBS games; this covers several weeks' worth
MAX_ENTRIES_PER_POOL = 25         # Splash/ESPN pools typically cap around 5; generous headroom
MIN_PICK_LIMIT = 1
MAX_PICK_LIMIT = 50


def _validate_private_state(body):
    """Checks the fields most exposed to unbounded growth from repeated
    pool imports/creation (see MAX_STATE_BYTES's own comment for why these
    five and not every field). Returns None if OK, or a client-safe error
    string naming exactly what's wrong -- these are the person's own
    values, not internal detail, so unlike GENERIC_SERVER_ERROR there's
    nothing sensitive here to withhold."""
    pools = body.get("pools")
    if pools is None:
        return None
    if not isinstance(pools, list):
        return "pools must be a list."
    if len(pools) > MAX_POOLS:
        return f"Too many pools ({len(pools)}) -- the limit is {MAX_POOLS}."
    for i, pool in enumerate(pools):
        if not isinstance(pool, dict):
            return f"pools[{i}] must be an object."
        name = pool.get("name")
        if isinstance(name, str) and len(name) > MAX_POOL_NAME_LEN:
            return f"Pool name too long ({len(name)} chars) -- the limit is {MAX_POOL_NAME_LEN}."
        pick_limit = pool.get("pickLimit")
        if pick_limit is not None:
            try:
                pick_limit_int = int(pick_limit)
            except (TypeError, ValueError):
                return f"pools[{i}].pickLimit must be a number."
            if not (MIN_PICK_LIMIT <= pick_limit_int <= MAX_PICK_LIMIT):
                return f"Pick limit ({pick_limit_int}) must be between {MIN_PICK_LIMIT} and {MAX_PICK_LIMIT}."
        games = pool.get("games")
        if games is not None:
            if not isinstance(games, list):
                return f"pools[{i}].games must be a list."
            if len(games) > MAX_GAMES_PER_POOL:
                return f"Too many games ({len(games)}) in pool \"{name}\" -- the limit is {MAX_GAMES_PER_POOL}."
        entries = pool.get("entries")
        if entries is not None:
            if not isinstance(entries, list):
                return f"pools[{i}].entries must be a list."
            if len(entries) > MAX_ENTRIES_PER_POOL:
                return f"Too many entries ({len(entries)}) in pool \"{name}\" -- the limit is {MAX_ENTRIES_PER_POOL}."
            for j, entry in enumerate(entries):
                if not isinstance(entry, dict):
                    return f"pools[{i}].entries[{j}] must be an object."
                ename = entry.get("name")
                if isinstance(ename, str) and len(ename) > MAX_ENTRY_NAME_LEN:
                    return f"Entry name too long ({len(ename)} chars) -- the limit is {MAX_ENTRY_NAME_LEN}."
    return None

_CLERK_JWKS_URL = os.environ.get("CLERK_JWKS_URL")
_jwks_client = None

# Clerk's token issuer is deterministically the same Frontend API domain
# used for the JWKS URL, without the well-known suffix -- derived here,
# not guessed, so this stays correct automatically if CLERK_JWKS_URL is
# ever repointed (e.g. a future custom-domain change).
_CLERK_ISSUER = _CLERK_JWKS_URL.rsplit("/.well-known/jwks.json", 1)[0] if _CLERK_JWKS_URL else None

# Origins this app's own frontend is actually served from. Clerk's own
# guidance is to restrict a token's azp (authorized party) to known
# application origins, since accepting any azp exposes the app to
# cross-origin/session misuse.
#
# CONFIRMED against a real production Clerk token (Aug 26, decoded via
# jwt.io from window.Clerk.session.getToken() on live pickgauge.com):
# azp IS reliably populated -- "https://www.pickgauge.com" for a
# www-origin sign-in -- and the token had NO aud claim at all (Clerk
# simply doesn't issue one for this app's session tokens, confirming
# decode_kwargs's verify_aud=False below is correct behavior, not an
# unverified guess). Since azp's presence is now confirmed rather than
# assumed, a MISSING azp is fail-closed (rejected) below -- previously
# it was fail-open specifically because a wrong guess here would have
# silently broken every authenticated request in production with no way
# to catch it before a live deploy; that risk no longer applies now that
# a real token has actually been inspected.
#
# ADDED cfb-ats-dashboard.vercel.app (Aug 27): production auth moved off
# the clerk.pickgauge.com custom domain permanently (Drew's explicit
# call, since pickgauge.com itself is network-blocked on Drew's own work
# network -- categorized Gambling by Cisco Talos/Palo Alto/Fortinet) onto
# Clerk's Development instance. Drew confirmed cfb-ats-dashboard.
# vercel.app is now a real, permanent, first-class entry point for this
# app going forward (alongside pickgauge.com itself), not just a
# temporary testing URL -- so it's hardcoded here as a first-class
# origin, same as the other two, rather than left as a PICKGAUGE_
# ALLOWED_AZP env-var step someone could forget to set in production.
_ALLOWED_AZP = {"https://pickgauge.com", "https://www.pickgauge.com", "https://cfb-ats-dashboard.vercel.app"}
_ALLOWED_AZP.update(x.strip() for x in os.environ.get("PICKGAUGE_ALLOWED_AZP", "").split(",") if x.strip())


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None and _CLERK_JWKS_URL:
        _jwks_client = PyJWKClient(_CLERK_JWKS_URL)
    return _jwks_client


def verify_user(handler):
    """Returns the verified Clerk user ID from the Authorization header, or
    None if the token is missing, malformed, expired, signed with a key
    that doesn't match Clerk's published JWKS (i.e. forged), issued by a
    different issuer than this app's own Clerk instance, or authorized
    for a different (or missing) application origin."""
    auth = handler.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    client = _get_jwks_client()
    if not client:
        return None
    try:
        signing_key = client.get_signing_key_from_jwt(token)
        decode_kwargs = {"algorithms": ["RS256"], "options": {"verify_aud": False}}
        if _CLERK_ISSUER:
            decode_kwargs["issuer"] = _CLERK_ISSUER
        payload = jwt.decode(token, signing_key.key, **decode_kwargs)
        azp = payload.get("azp")
        if azp not in _ALLOWED_AZP:
            return None
        return payload.get("sub")
    except Exception:
        return None


def _kv_creds():
    # Vercel's native "KV" product is retired -- storage is now provisioned
    # via an Upstash Redis integration through the Marketplace. Depending on
    # how it was installed, it may inject the legacy KV_REST_API_* names,
    # Upstash's own UPSTASH_REDIS_REST_* names, or -- as seen when connecting
    # via Vercel's Storage tab with a custom store name -- names prefixed
    # with that store's name (e.g. STORAGE_KV_REST_API_URL). Check all three
    # rather than assume one.
    url = (
        os.environ.get("KV_REST_API_URL")
        or os.environ.get("UPSTASH_REDIS_REST_URL")
        or os.environ.get("STORAGE_KV_REST_API_URL")
    )
    token = (
        os.environ.get("KV_REST_API_TOKEN")
        or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
        or os.environ.get("STORAGE_KV_REST_API_TOKEN")
    )
    return url, token


def kv_get(key):
    base, token = _kv_creds()
    if not base or not token:
        return None
    req = urllib.request.Request(
        f"{base}/get/{urllib.parse.quote(key, safe='')}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.loads(res.read().decode())
        return data.get("result")


def kv_set(key, value_str: str) -> bool:
    base, token = _kv_creds()
    if not base or not token:
        return False
    req = urllib.request.Request(
        f"{base}/set/{urllib.parse.quote(key, safe='')}",
        data=value_str.encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "text/plain",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        json.loads(res.read().decode())
        return True


def kv_delete(key) -> bool:
    """Permanently removes a key via Upstash's REST DEL command. Used
    exclusively by the self-serve "delete my data" action below -- nothing
    else in this app deletes a key outright (everything else is a
    read-modify-write). Returns False (not an exception) if KV isn't
    configured, matching kv_get()/kv_set()'s own fail-quiet-on-missing-
    config convention -- the caller decides what that means for its own
    response."""
    base, token = _kv_creds()
    if not base or not token:
        return False
    req = urllib.request.Request(
        f"{base}/del/{urllib.parse.quote(key, safe='')}",
        headers={"Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        json.loads(res.read().decode())
        return True


def kv_eval(script, keys, args):
    """Runs a Lua script atomically on the Redis server via Upstash's REST
    EVAL command -- the whole script executes as one indivisible step; no
    other request's command can interleave partway through it. This is
    what a plain kv_get()-then-kv_set() pair can never provide: those are
    two separate HTTP round trips, and another request's write can land
    in the gap between them (a classic TOCTOU race). Returns the script's
    return value (Lua tables come back as JSON arrays).

    See CAS_SCRIPT below for the specific atomic compare-and-set this
    project uses for private-state writes and grading.
    """
    base, token = _kv_creds()
    if not base or not token:
        return None
    body = json.dumps(["EVAL", script, len(keys), *keys, *args])
    req = urllib.request.Request(
        base,
        data=body.encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.loads(res.read().decode())
        return data.get("result")


# Atomic compare-and-set for "write this JSON blob only if its current
# _rev still matches what the caller expects." KEYS[1] = the Redis key,
# ARGV[1] = the expected revision, ARGV[2] = the full new value to store
# (already carrying the incremented _rev, computed by the Python caller
# before invoking this script). Returns a 3-element array:
#   ["ok", <new_revision>, ""]                        on success
#   ["conflict", <actual_current_revision>, <raw current JSON or "">]  on mismatch
# A missing key is treated as revision 0, so a brand-new account's first
# write (expectedRevision=0) succeeds without any special-cased branch.
CAS_SCRIPT = """
local current = redis.call('GET', KEYS[1])
local current_rev = 0
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and decoded and decoded['_rev'] then current_rev = decoded['_rev'] end
end
local expected_rev = tonumber(ARGV[1])
if current_rev ~= expected_rev then
  return {'conflict', current_rev, current or ''}
end
redis.call('SET', KEYS[1], ARGV[2])
return {'ok', expected_rev + 1, ''}
"""


# Atomic per-user, per-bucket request counter for basic server-side abuse
# limits. KEYS[1] = "ratelimit:<bucket>:<uid>", ARGV[1] = limit, ARGV[2] =
# window in seconds. INCR both creates the key at 1 and returns the new
# count in one atomic step; EXPIRE is only set on the FIRST hit in a
# window (count==1) so a steady stream of requests doesn't keep pushing
# the window back forever -- it's a fixed window, not a sliding one, which
# is deliberately the simpler of the two: good enough to stop someone from
# looping a request in a script, not trying to be exact under adversarial
# traffic shaping. Returns 1 (blocked -- over limit) or 0 (allowed).
RATE_LIMIT_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if count > tonumber(ARGV[1]) then
  return 1
else
  return 0
end
"""


def is_admin(uid):
    """Reads PICKGAUGE_ADMIN_UIDS from the environment -- a comma-separated
    list of Clerk user ids allowed to publish/unpublish a shared pool
    template. Anyone signed in can still USE a shared pool once one
    exists (browse it, pick against it); this only gates CREATING/
    updating one, since any signed-in user being able to spin up entries
    in the shared bucket -- a resource visible to every user of this
    deployment -- is the actual abuse surface, not reading one.

    Empty/unset env var means the set of admins is empty, so this fails
    toward "nobody is admin" rather than "everybody is admin" -- the safe
    default before Drew sets the real env var in Vercel, and the safe
    failure mode if the env var is ever accidentally unset later too.
    """
    allowed = os.environ.get("PICKGAUGE_ADMIN_UIDS", "")
    admin_ids = {u.strip() for u in allowed.split(",") if u.strip()}
    return uid in admin_ids


def rate_limited(uid, bucket, limit, window_seconds):
    """Returns True if this uid has made more than `limit` calls to
    `bucket` within the last `window_seconds` and the caller should be
    rejected with 429; False if the call is allowed.

    Fails OPEN (returns False) if KV is unreachable or misconfigured, or
    on any unexpected error -- a rate limiter that takes the whole app
    down whenever Redis hiccups would be a worse outage than the abuse
    it's meant to prevent. This mirrors kv_eval()'s own "best-effort,
    never the reason a request fails" posture used elsewhere in this file
    for non-critical shared-cache writes.
    """
    try:
        result = kv_eval(RATE_LIMIT_SCRIPT, [f"ratelimit:{bucket}:{uid}"], [str(limit), str(window_seconds)])
        return result == 1
    except Exception:
        return False


def cas_write(key, expected_rev, new_body_without_rev):
    """Atomically writes new_body_without_rev to key IF its current stored
    revision equals expected_rev, assigning revision expected_rev+1 as
    part of the same atomic step. Returns (status, revision, current_or_none):
      status == "ok"       -> revision is the NEW revision just written
      status == "conflict" -> revision is the ACTUAL current revision;
                               current_or_none is the current stored dict
      status == None        -> KV not configured / unreachable
    """
    new_body = dict(new_body_without_rev)
    new_body["_rev"] = expected_rev + 1
    result = kv_eval(CAS_SCRIPT, [key], [str(expected_rev), json.dumps(new_body)])
    if not result or len(result) < 3:
        return None, None, None
    status, revision, current_raw = result[0], result[1], result[2]
    if status == "ok":
        return "ok", revision, None
    current = None
    if current_raw:
        try:
            current = json.loads(current_raw)
        except (TypeError, json.JSONDecodeError):
            current = None
    return "conflict", revision, current


def _get_json(key):
    raw = kv_get(key)
    if raw is None:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except (TypeError, json.JSONDecodeError):
        return None


# Fields each new per-domain key is responsible for -- used both to pull the
# right slice out of the legacy combined key as a migration fallback, and
# to keep this list in one obvious place rather than repeated inline.
_LEGACY_ODDS_FIELDS = ("lastGames", "lastRefresh", "reqLeft", "booksSeen", "preKickLines")
_LEGACY_PREDICTIONS_FIELDS = ("predictions", "predMeta")


def _newest_iso_timestamp(*candidates):
    """Returns the newest of several ISO-8601 timestamp strings (or None),
    skipping anything missing or unparseable rather than raising -- a
    malformed or absent timestamp on one domain shouldn't break the
    other two. Parses rather than does a raw string max(): every current
    writer (fetch_odds.py/fetch_predictions.py/_publish_pool() below) uses
    the exact same datetime.datetime.now(timezone.utc).isoformat() format
    so a string comparison would happen to work today, but the legacy
    combined key predates this field entirely and its shape isn't
    guaranteed, so parse-and-compare is the correct one, not the
    convenient one.
    """
    best = None
    best_dt = None
    for c in candidates:
        if not c:
            continue
        try:
            dt = datetime.datetime.fromisoformat(c)
        except (TypeError, ValueError):
            continue
        if best_dt is None or dt > best_dt:
            best_dt, best = dt, c
    return best


def _get_shared_state():
    """Assembles the one flat shared-state object index.html expects (see
    SHARED_FIELDS in index.html) from the three independent per-domain keys,
    falling back to the legacy combined key (SHARED_KEY) for any field not
    yet present under its new key -- e.g. right after this split first
    deploys, before the next odds refresh/predictions fetch/pool publish has
    happened to populate the new keys. This is read-only: it never writes
    anything back to the legacy key, so there's no migration script to run
    and nothing that can go wrong beyond "briefly reads two keys instead of
    one" until the new keys are naturally populated by normal use.

    BUG FIXED (found in a v17 ChatGPT audit, confirmed real): this function
    used to never return a top-level sharedUpdatedAt at all, despite
    fetch_odds.py/fetch_predictions.py both stamping their own writes with
    one. app/js/sync.js's non-forced pull compares
    `remote.sharedUpdatedAt <= state.sharedUpdatedAt` (both fall back to 0
    when missing) to decide whether to bother merging -- with remote always
    missing, that comparison was always `0 <= 0`, so the automatic
    (non-forced) startup pull silently adopted nothing, on every page load,
    not just a fresh browser's first visit. A forced pull (refresh-lines
    button, load-predictions button, importing a pool) still worked because
    force bypasses this check entirely, which is exactly why this went
    unnoticed. Fixed by surfacing the NEWEST of the three domains' own
    timestamps (plus the legacy key's, if it happens to have one).
    """
    odds = _get_json(SHARED_ODDS_KEY) or {}
    preds = _get_json(SHARED_PREDICTIONS_KEY) or {}
    pools = _get_json(SHARED_POOLS_KEY) or {}

    legacy = None
    if not odds or not preds or not pools:
        legacy = _get_json(SHARED_KEY) or {}

    out = {}
    for f in _LEGACY_ODDS_FIELDS:
        if f in odds:
            out[f] = odds[f]
        elif legacy and f in legacy:
            out[f] = legacy[f]
    for f in _LEGACY_PREDICTIONS_FIELDS:
        if f in preds:
            out[f] = preds[f]
        elif legacy and f in legacy:
            out[f] = legacy[f]
    if "sharedPools" in pools:
        out["sharedPools"] = pools["sharedPools"]
    elif legacy and "sharedPools" in legacy:
        out["sharedPools"] = legacy["sharedPools"]

    newest = _newest_iso_timestamp(
        odds.get("sharedUpdatedAt"),
        preds.get("sharedUpdatedAt"),
        pools.get("sharedUpdatedAt"),
        legacy.get("sharedUpdatedAt") if legacy else None,
    )
    if newest:
        out["sharedUpdatedAt"] = newest
    return out


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return
        if rate_limited(uid, "state_get", 60, 60):
            self._respond(429, {"error": "Too many requests — please slow down."})
            return
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        scope = (params.get("scope", ["user"])[0] or "user").strip()
        if scope == "shared":
            self._respond(200, {"state": _get_shared_state()})
            return
        if scope == "user":
            key = USER_KEY_PREFIX + uid
            obj = _get_json(key)
            rev = (obj or {}).get("_rev", 0)
            # isAdmin rides along on every private-state pull rather than a
            # separate endpoint -- the client already calls this on load and
            # every re-sync, so this is "free" (no extra round trip) and
            # means the frontend can hide template-publishing controls for non-admins
            # instead of showing it to everyone and letting them discover
            # the 403 by clicking it (the backend gate itself, is_admin(),
            # is unchanged and remains the actual enforcement -- this field
            # is a UI convenience, not a new trust boundary).
            self._respond(200, {"state": obj, "revision": rev, "isAdmin": is_admin(uid)})
            return
        self._respond(400, {"error": f"Unknown scope '{scope}'. Use 'shared' or 'user'."})

    def do_POST(self):
        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return
        if rate_limited(uid, "state_post", 40, 60):
            self._respond(429, {"error": "Too many requests — please slow down."})
            return
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        action = (params.get("action", [""])[0] or "").strip()

        if action == "claim_legacy":
            self._claim_legacy(params)
            return
        if action in ("publish_pool", "unpublish_pool"):
            # Shared pools are deliberately a one-time TEMPLATE/invite
            # mechanism, not live collaborative state. Only admins can add
            # or remove templates from the globally visible catalog; every
            # recipient's local entries/picks remain private and independent.
            # Checked BEFORE the tighter rate limit so a non-admin gets a
            # clear permission response instead of a misleading throttle.
            if not is_admin(uid):
                self._respond(403, {"error": "Publishing pool templates is limited to admins for now."})
                return
            if rate_limited(uid, "publish_pool", 5, 60):
                self._respond(429, {"error": "Too many pool-template changes — please wait a bit before trying again."})
                return
            if action == "publish_pool":
                self._publish_pool(uid)
            else:
                self._unpublish_pool(uid)
            return
        if action == "delete_account_data":
            # Tighter than the general POST limit -- this is a rare,
            # deliberate, destructive action, never something a normal
            # sync flow does repeatedly. Checked before the body is even
            # read.
            if rate_limited(uid, "delete_account_data", 3, 60):
                self._respond(429, {"error": "Too many delete attempts — please wait a bit before trying again."})
                return
            self._delete_account_data(uid)
            return
        if action == "clear_predictions":
            # Removed: this used to wipe shared predictions/predMeta for
            # EVERY signed-in user, not just the caller -- any authenticated
            # user (or a repeated/automated call) could grief the whole
            # shared prediction cache for everyone. "Clear predictions" is
            # now purely local (see index.html's clearColumn) -- it stops
            # showing predictions on this device/account without touching
            # what anyone else sees. The shared cache simply gets replaced
            # on the next real fetch_predictions.py call, same as always.
            self._respond(410, {"error": "Clearing predictions is local-only now -- nothing to do server-side."})
            return

        scope = (params.get("scope", ["user"])[0] or "user").strip()
        if scope == "shared":
            # Generic client writes to the shared blob are no longer
            # accepted -- see module docstring. Anything legitimate that
            # used to go through here now has its own action= above, or is
            # written server-side by fetch_odds.py / fetch_predictions.py.
            self._respond(
                410,
                {"error": "Direct shared-state writes have been removed. "
                          "Use action=publish_pool/unpublish_pool for pool templates, or "
                          "refresh lines/predictions (the server writes shared "
                          "data itself now)."},
            )
            return
        if scope != "user":
            self._respond(400, {"error": f"Unknown scope '{scope}'. Use 'shared' or 'user'."})
            return

        self._post_user_state(uid, params)

    def _post_user_state(self, uid, params):
        key = USER_KEY_PREFIX + uid
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        # Reject on the CLAIMED length first (cheap, before reading anything
        # off the wire), then again on the ACTUAL bytes read (a mismatched/
        # understated Content-Length header shouldn't be a bypass). Both
        # checks exist because they catch different things -- the first
        # avoids reading a huge body at all when the client is honest about
        # its size, the second is the real backstop regardless.
        if length > MAX_STATE_BYTES:
            self._respond(413, {"error": f"Request body too large ({length} bytes) -- the limit is {MAX_STATE_BYTES} bytes."})
            return
        try:
            body_raw_bytes = self.rfile.read(length)
        except Exception as e:
            _log_server_error("private state write (do_POST) - body read failed", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})
            return
        if len(body_raw_bytes) > MAX_STATE_BYTES:
            self._respond(413, {"error": f"Request body too large ({len(body_raw_bytes)} bytes) -- the limit is {MAX_STATE_BYTES} bytes."})
            return
        try:
            body_raw = body_raw_bytes.decode()
            body = json.loads(body_raw)
            if not isinstance(body, dict):
                self._respond(400, {"error": "Body must be a JSON object."})
                return
        except json.JSONDecodeError:
            self._respond(400, {"error": "Body was not valid JSON"})
            return

        validation_error = _validate_private_state(body)
        if validation_error:
            self._respond(400, {"error": validation_error})
            return

        # expectedRevision is now REQUIRED on every write, not just
        # existing accounts -- a previous version treated an omitted
        # parameter as "must be a brand-new account" without actually
        # verifying that, which meant an existing account's write could
        # skip the concurrency check entirely just by leaving the
        # parameter off. A brand-new account sends expectedRevision=0
        # (nothing to conflict with, since a missing key reads as
        # revision 0 -- see CAS_SCRIPT) -- there's no meaningful
        # distinction between "new account" and "existing account" from
        # the server's point of view, so one universal rule covers both.
        expected_raw = params.get("expectedRevision", [None])[0]
        if expected_raw is None:
            self._respond(428, {"error": "expectedRevision is required on every write. Send 0 for a brand-new account."})
            return
        try:
            expected_rev = int(expected_raw)
        except ValueError:
            self._respond(400, {"error": "expectedRevision must be an integer."})
            return

        body.pop("_rev", None)  # cas_write assigns this; ignore whatever the client sent
        try:
            status, revision, current = cas_write(key, expected_rev, body)
            if status is None:
                self._respond(500, {"error": "KV not configured (missing env vars)"})
                return
            if status == "conflict":
                # Someone else's write landed since this client last
                # pulled -- the read, compare, and write above happened
                # as ONE atomic Redis-side operation (see cas_write/
                # CAS_SCRIPT), so this is a real conflict, not a race
                # this check merely failed to catch. Reject instead of
                # silently clobbering it -- the client is expected to
                # pull the latest state and either merge or inform the
                # person, then retry.
                self._respond(409, {
                    "error": "conflict",
                    "message": "Your data changed on another device since you last synced.",
                    "serverRevision": revision,
                    "state": current,
                })
                return
            self._respond(200, {"ok": True, "revision": revision})
        except urllib.error.URLError as e:
            _log_server_error("private state write (do_POST) - KV unreachable", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})
        except Exception as e:
            _log_server_error("private state write (do_POST)", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

    def _publish_pool(self, uid, max_retries=5):
        """Adds/updates ONE pool's structure (games, locked lines, name,
        pick limit -- never entries/picks) in the shared pools list, stored
        under its own dedicated key (SHARED_POOLS_KEY) rather than the old
        combined shared blob.

        OWNERSHIP: an earlier version of this let ANY signed-in user
        overwrite ANY existing published pool just by reusing its id
        (the docstring claimed otherwise -- that claim was wrong). Now,
        updating an id that's already published requires
        existing.publishedBy == this caller's uid; a mismatch is
        rejected with 403. A brand-new id is fine for anyone to publish.

        CONCURRENCY: unlike odds/predictions (which just replace their own
        data wholesale every write), this is a genuine read-modify-write
        against a shared LIST -- two different people publishing two
        different pools close together, or the same pool republished from
        two tabs, both do a real merge against whatever the list currently
        holds. A plain get-then-set here (even on its own dedicated key)
        could still silently drop one publish if another lands in the
        gap. This uses the same atomic compare-and-set already proven for
        private-state writes and grading (cas_write/CAS_SCRIPT), with a
        short retry loop: on conflict, re-apply this request's own change
        on top of whatever the OTHER writer just landed (not the stale
        snapshot this attempt started with), then retry the atomic write.
        Exhausting max_retries under real concurrent load is expected to
        be rare -- pool publishes are an infrequent, human-triggered
        action, not a hot path -- so this returns 409 rather than looping
        forever if it somehow happens."""
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        if length > MAX_STATE_BYTES:
            self._respond(413, {"error": f"Request body too large ({length} bytes) -- the limit is {MAX_STATE_BYTES} bytes."})
            return
        try:
            body_bytes = self.rfile.read(length)
            if len(body_bytes) > MAX_STATE_BYTES:
                self._respond(413, {"error": f"Request body too large ({len(body_bytes)} bytes) -- the limit is {MAX_STATE_BYTES} bytes."})
                return
            pool = json.loads(body_bytes.decode())
            if not isinstance(pool, dict) or not pool.get("id"):
                self._respond(400, {"error": "Body must be a pool object with an 'id'."})
                return
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._respond(400, {"error": "Body was not valid JSON"})
            return

        # Validate the same human-entered/collection bounds as private state
        # before this structure becomes globally visible. Entries are absent
        # by design, so wrapping the one pool lets the existing validator stay
        # the single source of truth for name/game/pick-limit ceilings.
        validation_error = _validate_private_state({"pools": [pool]})
        if validation_error:
            self._respond(400, {"error": validation_error})
            return

        # Strip anything that isn't structure -- defense in depth even
        # though the client isn't supposed to send entries/picks here.
        safe_pool = {
            "id": pool.get("id"),
            "name": pool.get("name"),
            "games": pool.get("games"),
            "weekLabel": pool.get("weekLabel"),
            "pickLimit": pool.get("pickLimit"),
            "source": pool.get("source"),
            "publishedBy": uid,
            "publishedAt": pool.get("publishedAt"),
        }

        try:
            current = _get_json(SHARED_POOLS_KEY) or {}
            for _attempt in range(max_retries):
                pools = current.get("sharedPools") or []
                existing = next((p for p in pools if p.get("id") == safe_pool["id"]), None)
                if existing and existing.get("publishedBy") != uid:
                    self._respond(403, {"error": "That pool was published by someone else -- you can't overwrite it."})
                    return
                new_pools = [p for p in pools if p.get("id") != safe_pool["id"]]
                new_pools.append(safe_pool)
                expected_rev = current.get("_rev") or 0
                status, _revision, conflict_current = cas_write(
                    SHARED_POOLS_KEY, expected_rev,
                    {
                        "sharedPools": new_pools,
                        # Bug found in a v17 ChatGPT audit: this write never
                        # set a timestamp, and _get_shared_state() below
                        # never returned one either -- meaning
                        # app/js/sync.js's non-forced startup pull
                        # (remoteTime <= localTime, both always 0) silently
                        # skipped adopting shared data on every page load,
                        # not just a fresh browser's first visit. Fixed
                        # here to match fetch_odds.py/fetch_predictions.py,
                        # which already stamp their own writes this way.
                        "sharedUpdatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    }
                )
                if status == "ok":
                    self._respond(200, {"ok": True})
                    return
                if status is None:
                    self._respond(500, {"error": "KV not configured (missing env vars)"})
                    return
                # status == "conflict": someone else published/updated a pool
                # in between our read and write -- re-apply OUR change on top
                # of THEIR result (conflict_current), not the stale snapshot
                # we started this attempt with, and try again.
                current = conflict_current or {}
            self._respond(409, {"error": "Another pool publish is landing at the same "
                                          "moment -- try again in a second."})
        except urllib.error.URLError as e:
            _log_server_error("publish_pool - KV unreachable", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})
        except Exception as e:
            _log_server_error("publish_pool", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

    def _unpublish_pool(self, uid, max_retries=5):
        """Remove one pool template owned by this caller from shared state.

        This intentionally does NOT reach into anyone's private state. A user
        who already seeded the template keeps their independent local pool,
        entries, picks, and history; unpublishing only stops NEW accounts from
        discovering/importing that shared template. Uses the same CAS/retry
        pattern as publishing so a simultaneous publish of another template
        cannot be lost.
        """
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        if length > 10_000:
            self._respond(413, {"error": "Request body too large for a template removal."})
            return
        try:
            raw = self.rfile.read(length)
            body = json.loads(raw.decode()) if raw else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._respond(400, {"error": "Body was not valid JSON"})
            return
        pool_id = str(body.get("id") or "").strip() if isinstance(body, dict) else ""
        if not pool_id:
            self._respond(400, {"error": "Body must include the pool template 'id'."})
            return

        try:
            current = _get_json(SHARED_POOLS_KEY) or {}
            for _attempt in range(max_retries):
                pools = current.get("sharedPools") or []
                existing = next((p for p in pools if str(p.get("id")) == pool_id), None)
                if not existing:
                    self._respond(200, {"ok": True, "removed": False})
                    return
                if existing.get("publishedBy") != uid:
                    self._respond(403, {"error": "That pool template was published by someone else -- you can't remove it."})
                    return
                new_pools = [p for p in pools if str(p.get("id")) != pool_id]
                expected_rev = current.get("_rev") or 0
                status, _revision, conflict_current = cas_write(
                    SHARED_POOLS_KEY, expected_rev,
                    {"sharedPools": new_pools,
                     "sharedUpdatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
                )
                if status == "ok":
                    self._respond(200, {"ok": True, "removed": True})
                    return
                if status is None:
                    self._respond(500, {"error": "KV not configured (missing env vars)"})
                    return
                current = conflict_current or {}
            self._respond(409, {"error": "Another pool-template change is landing at the same moment -- try again in a second."})
        except urllib.error.URLError as e:
            _log_server_error("unpublish_pool - KV unreachable", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})
        except Exception as e:
            _log_server_error("unpublish_pool", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

    def _delete_account_data(self, uid, max_retries=5):
        """Self-serve "delete my PickGauge data" -- everything synced under
        this account (picks, pools, entries, history, PDF-derived inputs,
        weights/thresholds -- the entire private-tier blob) is permanently
        removed, plus any pools this account published to the shared tier
        (a published template). This is the first real self-service delete
        this app has ever had; before this, Privacy's page could only say
        "contact us and we'll take care of it" -- a promise nobody had
        actually built. Clerk's own Manage Account still covers the LOGIN
        itself (email/password/session) -- this is specifically the app's
        OWN synced data, a separate concern deleting a Clerk account
        wouldn't touch on its own.

        Requires an explicit {"confirmDelete": true} in the body -- same
        "require real intent, don't infer it from a bare POST" reasoning as
        expectedRevision being mandatory on every private-state write, or
        force=1 on a legacy-claim overwrite. The client's own confirm()
        dialog is the real UX gate; this is the server-side backstop in
        case a client bug ever fires this action without one.

        Order matters: the shared-pool cleanup runs FIRST, private-key
        deletion LAST. If anything fails partway, the worst case is a
        published pool with no working private account behind it (harmless
        -- it's already visible to others and stays that way until an
        admin removes it) rather than a deleted private account with an
        orphaned published pool still claiming an ownership that no longer
        resolves to anything. Neither order is perfectly atomic across two
        different keys, but this is the safer failure direction.
        """
        try:
            length = int(self.headers.get("Content-Length", 0))
            body_raw = self.rfile.read(length).decode()
            body = json.loads(body_raw) if body_raw else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            body = {}
        if not (isinstance(body, dict) and body.get("confirmDelete") is True):
            self._respond(400, {"error": "This action requires {\"confirmDelete\": true} in the body -- it permanently deletes your data."})
            return

        try:
            # 1. Remove any pools this account published to the shared
            # tier -- same atomic read-modify-write pattern _publish_pool()
            # uses (a plain get-then-set here could silently drop a
            # DIFFERENT person's concurrent publish).
            removed_pool_count = 0
            current = _get_json(SHARED_POOLS_KEY) or {}
            for _attempt in range(max_retries):
                pools = current.get("sharedPools") or []
                owned = [p for p in pools if p.get("publishedBy") == uid]
                if not owned:
                    break
                new_pools = [p for p in pools if p.get("publishedBy") != uid]
                expected_rev = current.get("_rev") or 0
                status, _revision, conflict_current = cas_write(
                    SHARED_POOLS_KEY, expected_rev,
                    {"sharedPools": new_pools,
                     "sharedUpdatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
                )
                if status == "ok":
                    removed_pool_count = len(owned)
                    break
                if status is None:
                    self._respond(500, {"error": "KV not configured (missing env vars)"})
                    return
                current = conflict_current or {}
            else:
                self._respond(409, {"error": "Another change to shared pools is landing at the same moment -- try again in a second."})
                return

            # 2. Delete the private-tier key entirely.
            key = USER_KEY_PREFIX + uid
            if not kv_delete(key):
                self._respond(500, {"error": "KV not configured (missing env vars)"})
                return

            self._respond(200, {
                "ok": True,
                "message": f"Your account data has been permanently deleted."
                           + (f" {removed_pool_count} shared pool(s) you published were also removed." if removed_pool_count else ""),
            })
        except urllib.error.URLError as e:
            _log_server_error("delete_account_data - KV unreachable", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})
        except Exception as e:
            _log_server_error("delete_account_data", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

    def _claim_legacy(self, params):
        """One-time migration for people who used the old passphrase+handle
        system before real accounts existed: copies their old
        edge_board_user_{legacy_id} bucket into their new verified
        edge_board_user_{uid} bucket.

        SECURITY: this now requires MIGRATION_ADMIN_SECRET as a SEPARATE
        header (X-Migration-Secret) from the person's own Clerk token. The
        old handle was never a real credential, so knowing it (or guessing
        a common one) proved nothing about ownership -- any signed-in user
        could otherwise pull ANY other person's private legacy bucket into
        their own account. If MIGRATION_ADMIN_SECRET isn't set in Vercel,
        this endpoint is fully disabled (safe default). Run migrations for
        the handful of real legacy users by sharing that secret with
        yourself only, or by curling this endpoint on their behalf.
        """
        admin_secret = os.environ.get("MIGRATION_ADMIN_SECRET")
        if not admin_secret:
            self._respond(403, {"error": "Legacy migration is disabled (MIGRATION_ADMIN_SECRET not set)."})
            return
        supplied = self.headers.get("X-Migration-Secret", "")
        if supplied != admin_secret:
            self._respond(403, {"error": "Invalid or missing X-Migration-Secret header."})
            return

        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return

        legacy_id = (params.get("legacy_id", [""])[0] or "").strip()
        force = (params.get("force", [""])[0] or "") == "1"
        if not legacy_id:
            self._respond(400, {"error": "legacy_id is required."})
            return
        try:
            new_key = USER_KEY_PREFIX + uid
            existing = kv_get(new_key)
            if existing and not force:
                self._respond(409, {"error": "Your account already has data. Pass force=1 to overwrite it with the legacy handle's data anyway."})
                return
            legacy_raw = kv_get(USER_KEY_PREFIX + legacy_id)
            if legacy_raw is None:
                self._respond(404, {"error": f"No data found under the handle '{legacy_id}'."})
                return
            ok = kv_set(new_key, legacy_raw)
            if not ok:
                self._respond(500, {"error": "KV not configured (missing env vars)"})
                return
            self._respond(200, {"ok": True, "migrated_from": legacy_id})
        except urllib.error.URLError as e:
            _log_server_error("claim_legacy migration - KV unreachable", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})
        except Exception as e:
            _log_server_error("claim_legacy migration", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Migration-Secret")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Cache-Control", "private, no-store, max-age=0")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
