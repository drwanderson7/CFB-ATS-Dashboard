// --- Centralized API fetch/error classification ---------------------------
// Every api/*.py endpoint that calls verify_user() and fails responds with
// the EXACT SAME literal body on a real Clerk-auth failure:
//     401 {"error": "Unauthorized — please sign in again."}
// (see tests/test_error_shapes.py, which pins this down across all 7
// files so this file can rely on it without re-verifying by hand). A
// handful of endpoints ALSO return 401 for a completely different reason
// -- a missing/rejected feature-specific key (Odds API, CFBD) -- and
// those always use a "message" key instead of "error", e.g.
// fetch_odds.py's {"message": "No Odds API key provided..."}, INCLUDING
// the case where fetch_odds.py relays a 401 straight from the upstream
// Odds API itself (that upstream body isn't ours, but it happens to use
// the same "message" shape).
//
// Before this file, every call site had to independently guess what a
// 401 meant from the status code alone -- and several guessed wrong
// (see git history: refreshLines() used to treat EVERY 401 as "no odds
// key", including a genuinely expired Clerk session, and unconditionally
// sent the person to Settings for a key problem they didn't have). This
// file is the one place that decides what each status code means;
// individual call sites only handle what's actually specific to their
// own feature (an odds-key message, a pool-ownership conflict, etc.).
//
// Loaded as a plain <script src="/app/js/api-client.js"> tag, same as
// every other split file -- an ordinary global scope, not a module. Only
// external reference this file makes that isn't self-contained:
//   - `authHeaders()` -- Clerk-JWT auth header helper (main inline
//     script). Resolved lazily inside apiFetch()'s body, same reasoning
//     as every other split file's header comment.
const AUTH_EXPIRED_MESSAGE = "Unauthorized — please sign in again.";

// Turns a failed response's status+body into one of a small, fixed set of
// kinds every call site can switch on, plus a human-readable default
// message pulled from whatever the server actually said (never invented).
//   auth              - real Clerk session problem; re-sign-in is the fix,
//                        not anything feature-specific.
//   missing_key       - a feature's own API key is missing/rejected
//                        (Odds, CFBD, ...) -- the ONE case where "check
//                        Settings" is actually correct.
//   forbidden         - signed in fine, but not allowed to do this
//                        specific thing (e.g. someone else's pool).
//   conflict          - optimistic-concurrency clash (409); caller likely
//                        wants the body's own state/detail, not just text.
//   revision_required - state write missing/invalid expectedRevision (428).
//   rate_limit        - 429, upstream or ours.
//   server            - 5xx.
//   offline           - fetch() itself threw (DNS/network down, not a
//                        real HTTP response at all).
//   other             - anything else; falls back to whatever text the
//                        body carries, or a generic message.
function classifyApiError(status, body) {
  if (status === 401) {
    if (body && typeof body.error === "string") return { kind: "auth", message: body.error };
    if (body && typeof body.message === "string") return { kind: "missing_key", message: body.message };
    return { kind: "auth", message: AUTH_EXPIRED_MESSAGE };
  }
  if (status === 403) return { kind: "forbidden", message: (body && body.error) || "You don't have permission to do that." };
  if (status === 409) return { kind: "conflict", message: (body && body.error) || "Someone else changed this first — refresh and try again." };
  if (status === 428) return { kind: "revision_required", message: (body && body.error) || "Sync error — try refreshing the page." };
  if (status === 429) return { kind: "rate_limit", message: (body && body.error) || "Too many requests right now — try again shortly." };
  if (status >= 500) return { kind: "server", message: (body && body.error) || "Server error — try again shortly." };
  return { kind: "other", message: (body && (body.error || body.message)) || ("Request failed (" + status + ").") };
}

// Drop-in-ish replacement for `fetch(url, opts)` + `authHeaders()`, used
// the same way across every call site: pass `headers` for anything
// feature-specific (e.g. odds.js's X-Odds-Api-Key) exactly like you
// already did with authHeaders(extra) -- apiFetch merges the Clerk auth
// header in for you the same way.
//
// Always resolves (never throws) with one of:
//   {ok:true,  status, body, res}
//   {ok:false, status, kind, error, body, res}   -- res is null for "offline"
//
// `body` is the parsed JSON if the response declared a JSON content type
// and parsed cleanly, else null -- callers that need a non-JSON body
// (there are none currently) can still read `res` directly.
async function apiFetch(url, options) {
  options = options || {};

  async function doRequest(forceFreshToken) {
    const res = await fetch(url, { ...options, headers: await authHeaders(options.headers, !!forceFreshToken) });
    let body = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) {
      try { body = await res.json(); } catch { body = null; }
    }
    return { res, body };
  }

  let attempt;
  try {
    attempt = await doRequest(false);
  } catch (networkErr) {
    return { ok: false, status: 0, kind: "offline", error: "Can't reach the server — check your connection.", body: null, res: null };
  }

  let { res, body } = attempt;
  if (res.ok) return { ok: true, status: res.status, body, res };

  let classified = classifyApiError(res.status, body);

  // A Clerk session token is intentionally short-lived and Clerk can keep a
  // cached token for that lifetime. If the backend says THIS is an auth 401
  // (not an Odds/CFBD key 401), force-mint one fresh token and retry exactly
  // once before telling the person to sign in again. This makes a harmless
  // stale-token race self-healing without masking a genuine auth/config bug:
  // a second 401 is still returned normally and never loops.
  if (classified.kind === "auth" && window.Clerk && window.Clerk.session) {
    try {
      attempt = await doRequest(true);
      res = attempt.res; body = attempt.body;
      if (res.ok) return { ok: true, status: res.status, body, res };
      classified = classifyApiError(res.status, body);
    } catch (refreshErr) {
      // If Clerk itself cannot mint a fresh token, the session is not usable.
      // Keep the original auth diagnosis instead of mislabeling this as an
      // offline server failure.
      return { ok: false, status: 401, kind: "auth", error: AUTH_EXPIRED_MESSAGE, body: null, res: null };
    }
  }

  return { ok: false, status: res.status, kind: classified.kind, error: classified.message, body, res };
}
