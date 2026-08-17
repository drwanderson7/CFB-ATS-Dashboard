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
    a pool for "share for testing") goes through a narrow, explicit
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
import urllib.parse
import urllib.request
import urllib.error
import jwt
from jwt import PyJWKClient

SHARED_KEY = "edge_board_shared"  # legacy combined key -- read-only fallback now, see _get_shared_state()
SHARED_ODDS_KEY = "edge_board_shared_odds"
SHARED_PREDICTIONS_KEY = "edge_board_shared_predictions"
SHARED_POOLS_KEY = "edge_board_shared_pools"
USER_KEY_PREFIX = "edge_board_user_"

_CLERK_JWKS_URL = os.environ.get("CLERK_JWKS_URL")
_jwks_client = None


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None and _CLERK_JWKS_URL:
        _jwks_client = PyJWKClient(_CLERK_JWKS_URL)
    return _jwks_client


def verify_user(handler):
    """Returns the verified Clerk user ID from the Authorization header, or
    None if the token is missing, malformed, expired, or signed with a key
    that doesn't match Clerk's published JWKS (i.e. forged)."""
    auth = handler.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    client = _get_jwks_client()
    if not client:
        return None
    try:
        signing_key = client.get_signing_key_from_jwt(token)
        payload = jwt.decode(token, signing_key.key, algorithms=["RS256"], options={"verify_aud": False})
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
_LEGACY_ODDS_FIELDS = ("lastGames", "lastRefresh", "reqLeft", "booksSeen")
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
            self._respond(200, {"state": obj, "revision": rev})
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
        if action == "publish_pool":
            # Tighter than the general POST limit above -- publishing is a
            # deliberate, infrequent action ("Share for testing"), not
            # something a normal sync flow does repeatedly, so a lower
            # ceiling here doesn't cost a real user anything.
            if rate_limited(uid, "publish_pool", 5, 60):
                self._respond(429, {"error": "Too many pool-publish attempts — please wait a bit before trying again."})
                return
            self._publish_pool(uid)
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
                          "Use action=publish_pool to publish a pool, or "
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
            body_raw = self.rfile.read(length).decode()
            body = json.loads(body_raw)
            if not isinstance(body, dict):
                self._respond(400, {"error": "Body must be a JSON object."})
                return
        except json.JSONDecodeError:
            self._respond(400, {"error": "Body was not valid JSON"})
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
            self._respond(500, {"error": "KV unreachable: " + str(e)})
        except Exception as e:
            self._respond(500, {"error": str(e)})

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
            body_raw = self.rfile.read(length).decode()
            pool = json.loads(body_raw)
            if not isinstance(pool, dict) or not pool.get("id"):
                self._respond(400, {"error": "Body must be a pool object with an 'id'."})
                return
        except json.JSONDecodeError:
            self._respond(400, {"error": "Body was not valid JSON"})
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
            self._respond(500, {"error": "KV unreachable: " + str(e)})
        except Exception as e:
            self._respond(500, {"error": str(e)})

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
            self._respond(500, {"error": "KV unreachable: " + str(e)})
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Migration-Secret")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
