// --- Settings tab I/O --------------------------------------------------
// Split out of app/index.html as part of the JS-splitting pass. Covers:
// redirecting to Settings with an error message (goSettings(), called
// from odds/PDF/pool-import failure paths elsewhere), and the local
// backup export/import (exportBackup()/importBackup() -- a full-state
// JSON download/upload, API key deliberately stripped from exports since
// a backup file is something you'd email yourself or drop in cloud
// storage, and validated on import so an arbitrary JSON file can't
// silently wipe state the way it used to).
//
// importBackup() does a REAL account-level restore when signed in, not
// just a local write -- see its own comment for why the old version was
// actively misleading (it could report success and then have the very
// next sync silently undo it).
//
// deleteAccountData() is the self-serve "delete my data" action -- the
// first real one this app has had; see its own comment for the two-step
// confirmation and what it does and doesn't touch (Clerk login is
// separate).
//
// Loaded as a plain <script src="/app/js/settings.js"> tag, same as the
// other split files -- an ordinary global scope, not a module. Real
// external references this file makes that are NOT self-contained (all
// resolved lazily inside function bodies, never at top-level, so script
// load order relative to the rest of the page doesn't matter for
// correctness -- same reasoning as the other split files' header
// comments):
//   - `state`, `KEY` -- the global app state object and its localStorage
//     key (main inline script).
//   - `switchTab()` -- tab navigation (main inline script).
//   - `load()`/`saveLocal()`/`syncAll()` -- persistence (main inline
//     script).
//   - `normalizeState()`/`pickFields()`/`SHARED_FIELDS` -- state-shape
//     helpers (main inline script) -- importBackup()'s account-restore
//     path merges via the SAME pattern app/js/sync.js's pullTier() uses
//     for a remote pull, not a new one invented for this.
//   - `apiFetch()` -- classified fetch wrapper (app/js/api-client.js).
//   - `refreshMeta()`/`populateBooks()` -- odds-tab refresh, now in
//     app/js/odds.js.
function goSettings(msg){
  switchTab("settings");
  const m=document.getElementById("keyMsg");
  m.className="err"; m.textContent=msg||"";
}
function exportBackup(){
  // Strip the API key -- a backup file is something you email yourself or drop
  // in cloud storage, and the key is a live credential. Sync already omits it;
  // export shouldn't be the one place it leaks out in plaintext.
  const {apiKey,...safe}=state;
  const blob=new Blob([JSON.stringify(safe,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="pickgauge_backup_"+new Date().toISOString().slice(0,10)+".json";
  a.click();
  document.getElementById("ioMsg").className="ok";
  document.getElementById("ioMsg").textContent="Backup exported.";
}
// Restores a backup file. Two genuinely different behaviors depending on
// sign-in state -- the UI is upfront about which one is about to happen
// (see the restore confirmation below), not silently picking one.
//
// SIGNED IN: a REAL account-level restore, not a local write that hopes
// the next sync doesn't undo it. The old version just did
// localStorage.setItem()+saveLocal() and stopped -- it never pushed to
// the server at all. Since the backup file's own _rev/privateUpdatedAt
// were left untouched from whenever it was exported, the very next sync
// (a page reload, a background pull, another device) would compare that
// STALE timestamp against the server's actual current one, decide the
// server copy was "newer," and silently pull it back down over the
// restore the person just did -- or, if they made one more edit first, a
// push using the backup's stale _rev would hit a 409 conflict and
// pushState()'s own conflict handling would adopt the SERVER version
// instead. Either way: "Backup imported" would have been a lie. This
// reads the CURRENT server revision, then atomically overwrites it with
// the backup's content via the same CAS write pushState() uses for a
// normal edit -- so it either fully succeeds (every signed-in device now
// sees the restore) or fails loudly, never silently.
//
// NOT SIGNED IN: unchanged from before -- writes to this browser only.
// Now says so explicitly beforehand instead of implying an account-level
// restore it can't actually do without an account to restore TO.
function importBackup(file){
  const r=new FileReader();
  r.onload=async()=>{
    const ioMsg=document.getElementById("ioMsg");
    try{
      const s=JSON.parse(r.result);
      // Any valid JSON used to be accepted here and then normalised into a
      // blank state -- i.e. picking the wrong file silently wiped everything.
      const looksLikeBackup=s&&typeof s==="object"&&!Array.isArray(s)
        &&(Array.isArray(s.entries)||s.inputs&&typeof s.inputs==="object"||Array.isArray(s.history));
      if(!looksLikeBackup) throw new Error("not a backup");

      // Preview summary drawn ONLY from what's actually in the file -- no
      // fabricated stats. privateUpdatedAt is whatever the backup's own
      // last real sync stamped, i.e. "how old is this snapshot," not when
      // the .json file itself was downloaded (those can differ).
      const poolCount=Array.isArray(s.pools)?s.pools.length:0;
      const historyCount=Array.isArray(s.history)?s.history.length:0;
      const snapshotAge=s.privateUpdatedAt?new Date(s.privateUpdatedAt).toLocaleString():"an unknown date";
      const signedIn=!!(window.Clerk&&window.Clerk.user);
      const scopeWarning=signedIn
        ? "This will overwrite your ACCOUNT data — every signed-in device will see this backup once it's restored."
        : "You're not signed in, so this only replaces what's saved in THIS BROWSER — it won't touch any synced account. Sign in first if you want an account-level restore.";
      const ok=await pgConfirm({
        title:"Restore backup?",
        eyebrow:signedIn?"Account restore":"Browser-only restore",
        message:`Snapshot from ${snapshotAge}\n\n${poolCount} pool(s), ${historyCount} archived week(s) in Results.\n\n${scopeWarning}\n\nThis can't be undone.`,
        confirmText:"Restore backup",
        danger:true
      });
      if(!ok){
        if(ioMsg){ ioMsg.className=""; ioMsg.textContent="Restore cancelled."; }
        return;
      }

      const keepKey=state.apiKey; // key is device-local, never in the file

      if(!signedIn){
        // Previously: raw `s` was written to localStorage FIRST, then
        // load() (which calls normalizeState()) ran against it. A
        // malformed backup -- e.g. pools:[null] -- makes
        // normalizeState()'s `s.pools.forEach(p=>{p.history=...})` throw
        // on the null entry. That throw WAS caught here (friendly error
        // shown), but the raw broken JSON had already been committed to
        // localStorage by then. The next page load calls load() ->
        // normalizeState() again with no surrounding try/catch, so a
        // single bad import could permanently brick the app until the
        // person manually cleared browser storage. Fix: normalize in
        // memory first: if that throws, nothing has touched localStorage
        // at all yet, and the person just sees an error and keeps
        // whatever they had before.
        let normalized;
        try{
          normalized=normalizeState(s);
          purgeSeededDemoInputs(normalized);
        }catch(e){
          if(ioMsg){ ioMsg.className="err"; ioMsg.textContent="That backup file has a broken internal structure and can't be restored."; }
          return;
        }
        normalized.apiKey=normalized.apiKey||keepKey||"";
        state=normalized;
        saveLocal(); // only reaches localStorage now that normalization above already succeeded
        syncAll(); refreshMeta(); populateBooks();
        document.getElementById("apiKeyInput").value=state.apiKey;
        if(ioMsg){ ioMsg.className="ok"; ioMsg.textContent="Imported to this browser. You're not signed in, so your account (if you have one) wasn't touched."; }
        return;
      }

      if(ioMsg){ ioMsg.className=""; ioMsg.textContent="Restoring to your account…"; }
      const payload={...s};
      delete payload.apiKey;
      delete payload._rev; // the server assigns this; the backup's own stale value would be meaningless (or cause a false conflict)
      SHARED_FIELDS.forEach(f=>delete payload[f]); // shared tier is server-owned, never restored from a private backup

      // One retry on a 409: reads the (now-current) revision again and
      // re-attempts. A real collision here is rare -- this is a
      // deliberate, user-triggered action, not a background sync racing
      // against other background syncs -- so a single retry plus a clear
      // message on a second failure is proportionate, not an infinite loop.
      const attemptRestore=async()=>{
        const cur=await apiFetch('/api/state?scope=user',{});
        if(!cur.ok) throw new Error(cur.error||"Couldn't read your current account revision.");
        const rev=(cur.body&&typeof cur.body.revision==="number")?cur.body.revision:0;
        return apiFetch(`/api/state?scope=user&expectedRevision=${rev}`,{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
        });
      };

      let result=await attemptRestore();
      if(result.kind==="conflict") result=await attemptRestore();

      if(result.kind==="conflict"){
        if(ioMsg){ ioMsg.className="err"; ioMsg.textContent="Another device wrote to your account at the same moment — please try the restore again."; }
        return;
      }
      if(!result.ok){
        if(ioMsg){ ioMsg.className="err"; ioMsg.textContent=result.error||"Restore failed — please try again."; }
        return;
      }

      // Success: adopt the restored content locally too, same merge
      // pattern app/js/sync.js's pullTier() uses for a remote pull (keep
      // this device's already-synced shared tier rather than letting a
      // private-only backup clobber it).
      const sharedNow=pickFields(state,SHARED_FIELDS);
      state=normalizeState({...s,...sharedNow});
      state.apiKey=state.apiKey||keepKey||"";
      state._rev=(result.body&&typeof result.body.revision==="number")?result.body.revision:0;
      localStorage.setItem(KEY,JSON.stringify(state));
      syncAll(); refreshMeta(); populateBooks();
      document.getElementById("apiKeyInput").value=state.apiKey;
      if(ioMsg){ ioMsg.className="ok"; ioMsg.textContent="Restored to your account — synced to every signed-in device."; }
    }catch(e){
      if(ioMsg){ ioMsg.className="err"; ioMsg.textContent="That file couldn't be read as a backup."; }
    }
  };
  r.readAsText(file);
}
// Self-serve "delete my PickGauge data" -- Privacy's page used to say
// "contact us and we'll take care of it" because no button existed to do
// this; this is that button. Permanently deletes the entire account-level
// private-state blob (api/state.py's action=delete_account_data) plus any
// pools this account published to the shared tier -- separate from Clerk's
// own account/login deletion, which this doesn't touch.
//
// Two-step in-app confirmation (destructive confirmation, then a typed
// "DELETE") -- deliberately more friction than the single confirmation used
// elsewhere in this app since this is irreversible and
// account-wide, not scoped to one pool. The server has its own backstop
// too (requires {"confirmDelete": true} in the body) in case a client bug
// ever fired this action without a real confirmation.
async function deleteAccountData(){
  const msg=document.getElementById("deleteAccountMsg");
  if(!(window.Clerk&&window.Clerk.user)){
    if(msg){ msg.className="err"; msg.textContent="You're not signed in, so there's nothing on the server to delete — use \"Reset this browser\" above instead."; }
    return;
  }
  const step1=await pgConfirm({
    title:"Delete all PickGauge data?",
    eyebrow:"Permanent account-wide deletion",
    message:"This permanently deletes ALL your PickGauge data — every pool, pick, entry, and archived week — from every signed-in device.\n\nYour sign-in (email/password) is NOT affected, only your PickGauge data.\n\nThis can't be undone.",
    confirmText:"Continue",
    danger:true
  });
  if(!step1){ if(msg){ msg.className=""; msg.textContent="Cancelled."; } return; }
  const typed=await pgPrompt({
    title:"Type DELETE to confirm",
    eyebrow:"Final confirmation",
    message:"This is the final step. Enter DELETE in all caps to permanently remove your PickGauge data.",
    label:'Confirmation',
    value:'',
    placeholder:'DELETE',
    required:true,
    confirmText:'Permanently delete data',
    danger:true,
    validate:value=>value==="DELETE"?null:'Enter DELETE exactly as shown to continue.'
  });
  if(typed===null){ if(msg){ msg.className=""; msg.textContent="Cancelled."; } return; }
  // pgPrompt() already validates this inline, but keep a second check here
  // so the destructive action is safe even if the dialog helper is changed
  // or a future caller bypasses its validator.
  if(typed!=="DELETE"){
    if(msg){ msg.className=""; msg.textContent='Didn\'t match "DELETE" — cancelled, nothing was deleted.'; }
    return;
  }
  if(msg){ msg.className=""; msg.textContent="Deleting…"; }
  const result=await apiFetch('/api/state?action=delete_account_data',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmDelete:true})
  });
  if(!result.ok){
    if(msg){ msg.className="err"; msg.textContent=result.error||"Delete failed — please try again."; }
    return;
  }
  // Clear everything locally too -- a server-side delete with the old
  // local copy still sitting in this browser would just re-sync itself
  // right back up on the next edit.
  localStorage.removeItem(KEY);
  state=load(); // KEY is now gone, so this returns a fresh default state
  saveLocal();
  syncAll(); refreshMeta(); populateBooks();
  const apiKeyInput=document.getElementById("apiKeyInput");
  if(apiKeyInput) apiKeyInput.value=state.apiKey||"";
  if(msg){
    msg.className="ok";
    msg.textContent=(result.body&&result.body.message)||"Your account data has been permanently deleted.";
  }
}
