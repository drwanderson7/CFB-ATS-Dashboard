// Runtime tests for importBackup()'s real account-level restore logic --
// extracts the ACTUAL function from app/js/settings.js (not a hand-copied
// reimplementation) and executes it in Node with mocked dependencies, per
// this project's established pattern (see test_pdf_error_handling.mjs).
// Run with:
//
//     node tests/test_backup_restore_logic.mjs
//
// This is the fix for handoff.md's item 4 ("Backup restore is not a
// reliable cloud restore"): the OLD importBackup() only wrote to
// localStorage and never pushed to the server, so a restore could report
// "Backup imported" and then have the very next sync silently pull the
// (unchanged) server copy back down over it, or hit a stale-revision 409
// that adopted the server version instead. This function now does a REAL
// atomic account-level restore when signed in (read current revision,
// then CAS-write the backup's content over it, one retry on conflict),
// and is honest in its in-app restore confirmation about the narrower behavior
// when not signed in.
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/js/settings.js", import.meta.url), "utf8");

function extractAsyncFunction(name, source) {
  const asyncMarker = `async function ${name}(`;
  const plainMarker = `function ${name}(`;
  let start = source.indexOf(asyncMarker);
  if (start === -1) {
    start = source.indexOf(plainMarker);
    if (start === -1) throw new Error(`Could not find function ${name}()`);
  }
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

const code = extractAsyncFunction("importBackup", src);

// A fake FileReader whose readAsText() synchronously invokes the real
// onload handler (an async function) and captures the promise it returns,
// so a test can await FakeFileReader.lastInstance._donePromise once
// importBackup() (which itself returns immediately, before onload's async
// work finishes) has been called.
class FakeFileReader {
  constructor() { FakeFileReader.lastInstance = this; }
  readAsText(file) {
    this.result = file.__content;
    this._donePromise = Promise.resolve(this.onload && this.onload());
  }
}

function makeCtx({ signedIn, confirmReturns = true } = {}) {
  const elements = {
    ioMsg: { className: "", textContent: "" },
    apiKeyInput: { value: "" },
  };
  const apiCalls = [];
  const ctx = {
    FileReader: FakeFileReader,
    pgConfirm: async (opts) => { ctx.lastConfirmMessage = opts && opts.message ? opts.message : String(opts||""); return confirmReturns; },
    window: { Clerk: signedIn ? { user: { id: "u1" } } : null },
    document: { getElementById: (id) => elements[id] || null },
    localStorage: { setItem: (k, v) => { ctx.localStorageValue = v; } },
    KEY: "pickgauge_state",
    state: { apiKey: "device-local-key", _rev: 3 },
    load: () => ({ apiKey: "", history: [] }), // simulates re-reading whatever localStorage.setItem just wrote
    saveLocal: () => { ctx.saveLocalCalled = true; ctx.localStorageValue = JSON.stringify(ctx.state); },
    syncAll: () => { ctx.syncAllCalled = true; },
    refreshMeta: () => {},
    populateBooks: () => {},
    SHARED_FIELDS: ["lastGames", "sharedUpdatedAt"],
    pickFields: (obj, fields) => { const out = {}; fields.forEach(f => { if (obj[f] !== undefined) out[f] = obj[f]; }); return out; },
    normalizeState: (s) => ({ ...s, normalized: true }),
    purgeSeededDemoInputs: (s) => s,
    apiFetch: async (url, opts) => {
      const call = { url, opts };
      apiCalls.push(call);
      return ctx._apiFetchImpl ? ctx._apiFetchImpl(call, apiCalls.length) : { ok: true, body: {} };
    },
  };
  ctx.elements = elements;
  ctx.apiCalls = apiCalls;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

function fakeFile(obj) {
  return { __content: JSON.stringify(obj) };
}

const VALID_BACKUP = {
  entries: [{ id: "e1", name: "Entry 1" }],
  pools: [{ id: "p1", name: "Pool A" }, { id: "p2", name: "Pool B" }],
  history: [{ id: "h1", label: "Week 1" }],
  privateUpdatedAt: "2026-08-01T12:00:00.000Z",
  lastGames: ["shared-tier-data-that-should-never-be-restored-from-a-backup"],
  apiKey: "should-be-stripped-from-any-restore-payload",
};

// ---------------------------------------------------------------------------
// Malformed file -- rejected before confirm() is even shown
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: true });
  ctx.importBackup(fakeFile({ notARealBackup: true }));
  await FakeFileReader.lastInstance._donePromise;
  check("importBackup(): a file with no entries/inputs/history is rejected as not a backup",
    ctx.elements.ioMsg.textContent.includes("couldn't be read as a backup"));
  check("importBackup(): a rejected file never shows the restore confirmation at all",
    ctx.lastConfirmMessage === undefined);
  check("importBackup(): a rejected file never calls apiFetch",
    ctx.apiCalls.length === 0);
}

// ---------------------------------------------------------------------------
// Not signed in -- local-only restore, honest messaging, no network calls
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: false, confirmReturns: true });
  ctx.importBackup(fakeFile(VALID_BACKUP));
  await FakeFileReader.lastInstance._donePromise;
  check("importBackup() not signed in: the restore confirmation explicitly warns this only affects this browser",
    ctx.lastConfirmMessage.includes("not signed in") && ctx.lastConfirmMessage.includes("THIS BROWSER"));
  check("importBackup() not signed in: never calls apiFetch (no account to restore to)",
    ctx.apiCalls.length === 0);
  check("importBackup() not signed in: writes the backup to localStorage",
    typeof ctx.localStorageValue === "string" && ctx.localStorageValue.includes("Pool A"));
  check("importBackup() not signed in: calls saveLocal() and syncAll() (local re-render path)",
    ctx.saveLocalCalled === true && ctx.syncAllCalled === true);
  check("importBackup() not signed in: the final message is honest that the account wasn't touched",
    ctx.elements.ioMsg.className === "ok" && ctx.elements.ioMsg.textContent.includes("wasn't touched"));
}

// ---------------------------------------------------------------------------
// Not signed in, but the backup's INTERNAL structure is malformed in a way
// that makes normalizeState() throw (e.g. the real bug: pools:[null] makes
// normalizeState()'s `s.pools.forEach(p=>{p.history=...})` throw on the
// null entry). Before the fix, the raw broken JSON was written to
// localStorage BEFORE this throw -- meaning a single bad import could
// permanently brick the app on the next reload (load() calls
// normalizeState() again with no surrounding try/catch). The fix:
// normalize in memory first, so a throw here means NOTHING was written.
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: false, confirmReturns: true });
  ctx.normalizeState = () => { throw new TypeError("Cannot set properties of null (setting 'history')"); };
  ctx.importBackup(fakeFile(VALID_BACKUP));
  await FakeFileReader.lastInstance._donePromise;
  check("importBackup() not signed in, normalizeState() throws: localStorage is NEVER written -- nothing was committed before the failure",
    ctx.localStorageValue === undefined);
  check("importBackup() not signed in, normalizeState() throws: saveLocal()/syncAll() are never called",
    ctx.saveLocalCalled === undefined && ctx.syncAllCalled === undefined);
  check("importBackup() not signed in, normalizeState() throws: reports a clear error, not a silent success",
    ctx.elements.ioMsg.className === "err" && ctx.elements.ioMsg.textContent.toLowerCase().includes("broken"));
}

// ---------------------------------------------------------------------------
// Signed in, cancelled -- nothing happens
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: true, confirmReturns: false });
  ctx.importBackup(fakeFile(VALID_BACKUP));
  await FakeFileReader.lastInstance._donePromise;
  check("importBackup() signed in, cancelled: never calls apiFetch",
    ctx.apiCalls.length === 0);
  check("importBackup() signed in, cancelled: never writes to localStorage",
    ctx.localStorageValue === undefined);
  check("importBackup() signed in, cancelled: reports 'cancelled', not success",
    ctx.elements.ioMsg.textContent.toLowerCase().includes("cancelled"));
}

// ---------------------------------------------------------------------------
// Signed in, confirmed, happy path -- the actual fix: a real CAS restore
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: true, confirmReturns: true });
  ctx._apiFetchImpl = (call, n) => {
    if (n === 1) { check("call #1 is the GET to read the current server revision", call.url === "/api/state?scope=user"); return { ok: true, body: { revision: 7 } }; }
    if (n === 2) { check("call #2 is the POST restore using that exact revision as expectedRevision", call.url === "/api/state?scope=user&expectedRevision=7"); return { ok: true, body: { revision: 8 } }; }
    throw new Error("unexpected extra apiFetch call: " + call.url);
  };
  ctx.importBackup(fakeFile(VALID_BACKUP));
  await FakeFileReader.lastInstance._donePromise;

  check("importBackup() signed in, happy path: the restore confirmation warns this overwrites the ACCOUNT",
    ctx.lastConfirmMessage.includes("ACCOUNT"));
  check("importBackup() signed in, happy path: the restore confirmation shows the backup's real pool count (2), not a fabricated number",
    ctx.lastConfirmMessage.includes("2 pool(s)"));
  check("importBackup() signed in, happy path: makes exactly 2 apiFetch calls (GET revision, POST restore) -- no extra round trips",
    ctx.apiCalls.length === 2);

  const postBody = JSON.parse(ctx.apiCalls[1].opts.body);
  check("importBackup() signed in, happy path: the restore payload strips apiKey (never sent to the server)",
    !("apiKey" in postBody));
  check("importBackup() signed in, happy path: the restore payload strips _rev (server assigns its own)",
    !("_rev" in postBody));
  check("importBackup() signed in, happy path: the restore payload strips shared-tier fields (server-owned, never restored from a private backup)",
    !("lastGames" in postBody));
  check("importBackup() signed in, happy path: the restore payload STILL contains the actual private data (pools)",
    Array.isArray(postBody.pools) && postBody.pools.length === 2);

  check("importBackup() signed in, happy path: state._rev is updated to the NEW revision the server returned (8), not left stale",
    ctx.state._rev === 8);
  check("importBackup() signed in, happy path: local state goes through normalizeState() (same merge path pullTier() uses for a remote pull)",
    ctx.state.normalized === true);
  check("importBackup() signed in, happy path: calls syncAll() to re-render",
    ctx.syncAllCalled === true);
  check("importBackup() signed in, happy path: the final message confirms an ACCOUNT-level restore, not just a local import",
    ctx.elements.ioMsg.className === "ok" && ctx.elements.ioMsg.textContent.includes("Restored to your account"));
}

// ---------------------------------------------------------------------------
// Signed in, first attempt conflicts, retry succeeds
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: true, confirmReturns: true });
  ctx._apiFetchImpl = (call, n) => {
    if (n === 1) return { ok: true, body: { revision: 7 } };               // 1st GET
    if (n === 2) return { ok: false, kind: "conflict", body: {} };          // 1st POST -- someone else wrote first
    if (n === 3) return { ok: true, body: { revision: 9 } };               // retry GET -- now-current revision
    if (n === 4) { check("the retry's POST uses the FRESH revision (9), not the stale one from the first attempt", call.url === "/api/state?scope=user&expectedRevision=9"); return { ok: true, body: { revision: 10 } }; }
    throw new Error("unexpected extra apiFetch call: " + call.url);
  };
  ctx.importBackup(fakeFile(VALID_BACKUP));
  await FakeFileReader.lastInstance._donePromise;
  check("importBackup() signed in, one conflict then success: retries exactly once (4 total apiFetch calls: GET+POST, GET+POST)",
    ctx.apiCalls.length === 4);
  check("importBackup() signed in, one conflict then success: still ends in success, using the retry's revision",
    ctx.state._rev === 10 && ctx.elements.ioMsg.className === "ok");
}

// ---------------------------------------------------------------------------
// Signed in, BOTH attempts conflict -- fails loudly, doesn't silently drop it
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: true, confirmReturns: true });
  let n = 0;
  ctx._apiFetchImpl = (call) => {
    n++;
    if (n % 2 === 1) return { ok: true, body: { revision: 7 } }; // every GET succeeds
    return { ok: false, kind: "conflict", body: {} };             // every POST conflicts
  };
  ctx.importBackup(fakeFile(VALID_BACKUP));
  await FakeFileReader.lastInstance._donePromise;
  check("importBackup() signed in, persistent conflict: does NOT retry more than once (exactly 4 calls, not an infinite loop)",
    ctx.apiCalls.length === 4);
  check("importBackup() signed in, persistent conflict: reports the failure clearly, doesn't claim success",
    ctx.elements.ioMsg.className === "err" && ctx.elements.ioMsg.textContent.toLowerCase().includes("try the restore again"));
  check("importBackup() signed in, persistent conflict: never wrote anything to localStorage (no silent partial restore)",
    ctx.localStorageValue === undefined);
}

// ---------------------------------------------------------------------------
// Signed in, the revision-read itself fails (offline, server error, etc.)
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: true, confirmReturns: true });
  ctx._apiFetchImpl = () => ({ ok: false, kind: "offline", error: "Can't reach the server — check your connection." });
  ctx.importBackup(fakeFile(VALID_BACKUP));
  await FakeFileReader.lastInstance._donePromise;
  check("importBackup() signed in, can't even read current revision: fails cleanly with a real error message, not a crash",
    ctx.elements.ioMsg.className === "err" && ctx.elements.ioMsg.textContent.length > 0);
  check("importBackup() signed in, can't even read current revision: never wrote anything to localStorage",
    ctx.localStorageValue === undefined);
}

console.log(failures.length ? `\n${failures.length} of ${total} checks FAILED:` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);
