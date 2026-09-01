// --- Cross-device sync ---------------------------------------------------
// Split out of app/index.html as part of the JS-splitting pass. This is
// the client-side half of the atomic-write system documented in
// api/state.py -- covers debounced pushes of the private tier
// (scheduleSync()/pushState(), 1.5s after the last edit, private-tier
// only since shared writes are server-owned), optimistic-concurrency
// conflict handling (pushState()'s 409 branch -- another device wrote
// since this one's last sync, so adopt the server's version rather than
// clobbering it), and pulling either tier (pullTier()) or both
// (pullState()) with newer-wins merge logic: shared external-data fields
// use server timestamps, while private user state uses its monotonic _rev.
//
// This is one of the more sensitive files to touch -- it's the client
// side of genuinely real concurrency handling (the 409/revision dance
// exists because a real TOCTOU race was found and fixed here, not
// theoretical). Prefer verifying against the actual file before assuming
// how a given edge case is handled.
//
// Loaded as a plain <script src="/app/js/sync.js"> tag, same as the
// other split files -- an ordinary global scope, not a module. Real
// external references this file makes that are NOT self-contained (all
// resolved lazily inside function bodies, never at top-level, so script
// load order relative to the rest of the page doesn't matter for
// correctness -- same reasoning as the other split files' header
// comments):
//   - `state`, `KEY`, `SHARED_FIELDS` -- global app state, its
//     localStorage key, and the field list that separates the shared
//     tier from the private tier (main inline script).
//   - `apiFetch()` -- classified fetch wrapper (app/js/api-client.js).
//   - `normalizeState()`/`pickFields()` -- state-shape helpers (main
//     inline script).
//   - `mergeSharedPoolsIntoLocal()` -- app/js/picks.js.
//   - `resolveBookLines()` -- app/js/odds.js.
//   - `rehydrateAfterSync()` -- post-sync re-render, defined in the
//     init section of the main inline script.
//   - `isAdminUser` -- account-admin flag, declared alongside `state`
//     (main inline script) but deliberately NOT part of `state` itself
//     (see its own declaration comment) -- pullTier("private") is the
//     one place that sets it, from the "isAdmin" field the server now
//     includes on every private-state GET (api/state.py).
// Two independent debounce timers -- a private-tier change (ticking a pick)
// and a shared-tier change (refreshing lines) shouldn't cancel/delay each
// other's push.
let syncTimerPrivate=null;
// A private edit is written to localStorage immediately but its cloud push is
// intentionally debounced. Browser refresh/sign-out can destroy that timer
// before it fires, leaving the local copy correct but another device stale.
// Persist a tiny, account-bound marker outside `state` so the next signed-in
// init can safely finish that interrupted push.
//
// The marker stores the Clerk user id + privateUpdatedAt, not the state itself:
// - it cannot accidentally become part of the synced account document;
// - it is tiny (no localStorage doubling for a potentially-large state blob);
// - it only resumes when BOTH the signed-in account and the exact local edit
//   still match, so switching accounts can never push one person's local state
//   into another person's private Redis key.
const PRIVATE_SYNC_PENDING_KEY="pickgauge_private_sync_pending_v1";
function privateSyncUserId(){
  const u=window.Clerk&&window.Clerk.user;
  return u&&u.id?String(u.id):null;
}
function readPrivateSyncPending(){
  try{
    const raw=localStorage.getItem(PRIVATE_SYNC_PENDING_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    return parsed&&typeof parsed==="object"?parsed:null;
  }catch(e){return null;}
}
function markPrivateSyncPending(){
  const userId=privateSyncUserId();
  if(!userId)return false; // signed-out/guest edits must never be auto-pushed later
  const marker={
    userId,
    privateUpdatedAt:String(state.privateUpdatedAt||""),
    revision:(typeof state._rev==="number")?state._rev:0,
    markedAt:new Date().toISOString()
  };
  try{localStorage.setItem(PRIVATE_SYNC_PENDING_KEY,JSON.stringify(marker));return true;}catch(e){return false;}
}
function privateSyncPendingMatchesCurrent(){
  const marker=readPrivateSyncPending(),userId=privateSyncUserId();
  return !!(marker&&userId&&marker.userId===userId
    && marker.privateUpdatedAt
    && marker.privateUpdatedAt===String(state.privateUpdatedAt||""));
}
function clearPrivateSyncPending(){
  const marker=readPrivateSyncPending(),userId=privateSyncUserId();
  // Never clear another account's marker merely because a different account
  // signed in on this browser. It will be harmlessly ignored by the match
  // check; if the original account returns with the same local edit, it can
  // still finish syncing.
  if(marker&&userId&&marker.userId!==userId)return false;
  try{localStorage.removeItem(PRIVATE_SYNC_PENDING_KEY);return true;}catch(e){return false;}
}
async function resumePendingPrivateSync(){
  if(!privateSyncPendingMatchesCurrent())return false;
  clearTimeout(syncTimerPrivate);
  syncTimerPrivate=null;
  setSyncStatus("finishing sync…");
  await pushState("private");
  return !privateSyncPendingMatchesCurrent();
}
function setSyncStatus(text){
  const el=document.getElementById("syncStatus");
  if(el) el.textContent=text;
}
function scheduleSync(scope){
  // Only "private" ever needs scheduling now -- shared writes are
  // server-owned (see api/state.py), so nothing schedules "shared" pushes
  // anymore (the old saveShared() that did is gone).
  markPrivateSyncPending();
  clearTimeout(syncTimerPrivate);
  syncTimerPrivate=setTimeout(()=>pushState("private"),1500);
}
function stateEndpoint(scope){
  if(scope==="shared") return '/api/state?scope=shared';
  const rev=(typeof state._rev==="number")?state._rev:0;
  return `/api/state?scope=user&expectedRevision=${rev}`;
}
async function pushState(scope){
  if(scope==="shared") return; // shared writes are server-owned now; nothing to push
  if(!(window.Clerk&&window.Clerk.user)){
    setSyncStatus("sign in to sync"); return;
  }
  try{
    // Private = everything except device-local fields (apiKey never
    // travels) and the shared fields (those live in their own bucket,
    // written server-side -- not duplicated into every person's private copy).
    const payload={...state};
    delete payload.apiKey;
    delete payload._rev; // the server assigns this; sending it back would be meaningless
    SHARED_FIELDS.forEach(f=>delete payload[f]);
    const result=await apiFetch(stateEndpoint("private"),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(result.kind==="conflict"){
      // Another device wrote since we last synced. Don't silently overwrite
      // it with our stale copy -- adopt the server's version (it's returned
      // right in the 409 body, no extra round trip needed), tell the person
      // plainly, and let scheduleSync retry their next real edit against the
      // now-current revision.
      const body=result.body||{};
      if(body.state){
        const localKey=state.apiKey;
        const sharedNow=pickFields(state,SHARED_FIELDS);
        state=normalizeState({...body.state,...sharedNow});
        state.apiKey=localKey||state.apiKey||"";
        state._rev=body.serverRevision||0;
        localStorage.setItem(KEY,JSON.stringify(state));
        clearPrivateSyncPending();
        rehydrateAfterSync();
      }
      setSyncStatus("synced elsewhere — reloaded latest, please redo your last change if it's missing");
      return;
    }
    if(result.ok){
      const body=result.body||{};
      if(typeof body.revision==="number") state._rev=body.revision;
      localStorage.setItem(KEY,JSON.stringify(state));
      clearPrivateSyncPending();
      setSyncStatus("synced "+new Date().toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}));
      return;
    }
    // Every other failure kind gets its own clear status line now, instead
    // of a hand-rolled status-number ternary that only ever covered 401
    // and 428 by name and dumped everything else (429, 5xx, a genuinely
    // offline device) into the same "sync not set up" bucket.
    setSyncStatus(
      result.kind==="auth"?"signed out — sign in again":
      result.kind==="revision_required"?"sync error — try refreshing the page":
      result.kind==="offline"?"offline":
      result.kind==="rate_limit"?"sync paused — rate limited, try again shortly":
      result.kind==="server"?"sync error — server issue, try again shortly":
      "sync not set up"
    );
  }catch(e){
    // apiFetch itself never throws (network failures come back as
    // kind:"offline" above) -- this only catches a genuine bug in the
    // success-path code, so it stays a generic fallback.
    setSyncStatus("offline");
  }
}
// Pulls ONE tier and merges it into local state if the remote copy is newer
// (or force=true). Returns true if anything actually changed locally.
async function pullTier(scope,force){
  if(scope==="private"&&!(window.Clerk&&window.Clerk.user)) return false;
  try{
    const result=await apiFetch(stateEndpoint(scope),{});
    if(!result.ok) return false;
    const data=result.body;
    if(!data||!data.state||typeof data.state!=="object") return false;
    const remote=data.state;
    if(scope==="shared"){
      const remoteTime=remote.sharedUpdatedAt?new Date(remote.sharedUpdatedAt).getTime():0;
      const localTime=state.sharedUpdatedAt?new Date(state.sharedUpdatedAt).getTime():0;
      if(!force&&remoteTime<=localTime) return false;
      Object.assign(state,pickFields(remote,SHARED_FIELDS));
      state.sharedUpdatedAt=remote.sharedUpdatedAt||state.sharedUpdatedAt;
      mergeSharedPoolsIntoLocal();
      resolveBookLines(state.lastGames); // this device's own book pref, not whoever refreshed
    }else{
      // Private state already has a server-assigned monotonic revision, so
      // use that as the freshness authority instead of browser clocks. A
      // laptop with a clock five minutes fast must not be able to reject a
      // genuinely newer write from another device. Equal revision means the
      // server has nothing this client doesn't already know; any local
      // unsynced edit at that same revision is therefore preserved until its
      // debounced CAS write runs.
      const remoteRev=(typeof data.revision==="number")?data.revision:((typeof remote._rev==="number")?remote._rev:0);
      const localRev=(typeof state._rev==="number")?state._rev:0;
      // isAdmin is read regardless of the newer-wins check below -- it's an
      // ACCOUNT attribute (see its own declaration comment), not part of
      // the state document being merged.
      if(typeof data.isAdmin==="boolean") isAdminUser=data.isAdmin;
      if(!force&&remoteRev<=localRev) return false;
      clearTimeout(syncTimerPrivate);
      const localKey=state.apiKey;
      const sharedNow=pickFields(state,SHARED_FIELDS); // don't let a private pull clobber the shared tier we already have
      state=normalizeState({...remote,...sharedNow});
      state.apiKey=localKey||state.apiKey||"";
      state._rev=remoteRev;
    }
    localStorage.setItem(KEY,JSON.stringify(state));
    return true;
  }catch(e){
    setSyncStatus("offline");
    return false;
  }
}
// Pulls both tiers. Kept as one function (same name/shape as before) so
// existing call sites (init, manual sync button) don't need to change --
// it just now fans out to two requests instead of one.
async function pullState(force){
  const [sharedChanged,privateChanged]=await Promise.all([pullTier("shared",force),pullTier("private",force)]);
  const changed=sharedChanged||privateChanged;
  if(changed) setSyncStatus("synced "+new Date().toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}));
  return changed;
}
