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
  a.download="edge_board_backup_"+new Date().toISOString().slice(0,10)+".json";
  a.click();
  document.getElementById("ioMsg").className="ok";
  document.getElementById("ioMsg").textContent="Backup exported.";
}
function importBackup(file){
  const r=new FileReader();
  r.onload=()=>{
    try{
      const s=JSON.parse(r.result);
      // Any valid JSON used to be accepted here and then normalised into a
      // blank state -- i.e. picking the wrong file silently wiped everything.
      const looksLikeBackup=s&&typeof s==="object"&&!Array.isArray(s)
        &&(Array.isArray(s.entries)||s.inputs&&typeof s.inputs==="object"||Array.isArray(s.history));
      if(!looksLikeBackup) throw new Error("not a backup");
      const keepKey=state.apiKey;              // key is device-local, never in the file
      localStorage.setItem(KEY,JSON.stringify(s));
      state=load();
      state.apiKey=state.apiKey||keepKey||"";
      saveLocal();
      syncAll(); refreshMeta(); populateBooks();
      document.getElementById("apiKeyInput").value=state.apiKey;
      document.getElementById("ioMsg").className="ok";
      document.getElementById("ioMsg").textContent="Backup imported.";
    }catch(e){
      document.getElementById("ioMsg").className="err";
      document.getElementById("ioMsg").textContent="That file couldn't be read as a backup.";
    }
  };
  r.readAsText(file);
}
