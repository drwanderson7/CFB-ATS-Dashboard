// Runtime tests for deleteAccountData()'s two-step confirmation and
// account-delete logic -- extracts the ACTUAL function from
// app/js/settings.js (not a hand-copied reimplementation) and executes it
// in Node with mocked dependencies, per this project's established pattern
// (see test_backup_restore_logic.mjs for the sibling function this one was
// added alongside). Run with:
//
//     node tests/test_delete_account_data_logic.mjs
//
// This is the client half of handoff.md item 11 ("Self-serve 'delete my
// PickGauge data'") -- api/state.py's action=delete_account_data is the
// server half (see test_state.py). Covers the two-step confirmation
// (a destructive confirmation then a typed "DELETE" in the shared modal --
// deliberately more friction than the single confirmation used for a pool delete,
// since this is irreversible and account-wide), the not-signed-in guard,
// and that local state only gets cleared on an actual confirmed server
// success, never speculatively.
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

const code = extractAsyncFunction("deleteAccountData", src);

function makeCtx({ signedIn = true, confirmReturns = true, promptReturns = "DELETE", apiResult = { ok: true, body: { message: "Your account data has been permanently deleted." } } } = {}) {
  const elements = {
    deleteAccountMsg: { className: "", textContent: "" },
    apiKeyInput: { value: "" },
  };
  const apiCalls = [];
  const ctx = {
    window: { Clerk: signedIn ? { user: { id: "u1" } } : null },
    pgConfirm: async (opts) => { ctx.confirmMessage = opts && opts.message ? opts.message : String(opts||""); return confirmReturns; },
    pgPrompt: async (opts) => { ctx.promptMessage = opts && opts.message ? opts.message : String(opts||""); return promptReturns; },
    document: { getElementById: (id) => elements[id] || null },
    localStorage: { removeItem: (k) => { ctx.removedKey = k; } },
    KEY: "pickgauge_state",
    state: { apiKey: "" },
    load: () => { ctx.loadCalled = true; return { apiKey: "", entries: [] }; },
    saveLocal: () => { ctx.saveLocalCalled = true; },
    syncAll: () => { ctx.syncAllCalled = true; },
    refreshMeta: () => {},
    populateBooks: () => {},
    apiFetch: async (url, opts) => { apiCalls.push({ url, opts }); return apiResult; },
  };
  ctx.elements = elements;
  ctx.apiCalls = apiCalls;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

// ---------------------------------------------------------------------------
// Not signed in -- refuses before showing either confirmation, points at
// "Reset this browser" instead (there's genuinely nothing server-side to
// delete for a signed-out browser).
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: false });
  await ctx.deleteAccountData();
  check("not signed in: never shows the confirmation dialog at all", ctx.confirmMessage === undefined);
  check("not signed in: never shows the typed-confirmation dialog at all", ctx.promptMessage === undefined);
  check("not signed in: never calls apiFetch", ctx.apiCalls.length === 0);
  check("not signed in: points the person at 'Reset this browser' instead",
    ctx.elements.deleteAccountMsg.textContent.includes("Reset this browser"));
}

// ---------------------------------------------------------------------------
// Signed in, cancels at step 1
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: true, confirmReturns: false });
  await ctx.deleteAccountData();
  check("cancel at step 1: the confirm() message clearly states this is irreversible and account-wide",
    ctx.confirmMessage.includes("permanently") && ctx.confirmMessage.includes("every"));
  check("cancel at step 1: never reaches the prompt() step", ctx.promptMessage === undefined);
  check("cancel at step 1: never calls apiFetch", ctx.apiCalls.length === 0);
  check("cancel at step 1: reports 'Cancelled'", ctx.elements.deleteAccountMsg.textContent === "Cancelled.");
}

// ---------------------------------------------------------------------------
// Signed in, confirms step 1, but types the wrong thing at step 2
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: true, confirmReturns: true, promptReturns: "delete" }); // lowercase -- must not match
  await ctx.deleteAccountData();
  check("wrong typed confirmation (lowercase 'delete'): never calls apiFetch", ctx.apiCalls.length === 0);
  check("wrong typed confirmation: reports it didn't match, nothing was deleted",
    ctx.elements.deleteAccountMsg.textContent.toLowerCase().includes("didn't match") || ctx.elements.deleteAccountMsg.textContent.includes('"DELETE"'));
  check("wrong typed confirmation: never touches localStorage", ctx.removedKey === undefined);
}

// ---------------------------------------------------------------------------
// Signed in, cancels the typed-confirmation modal itself (returns null, e.g. hit Escape)
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: true, confirmReturns: true, promptReturns: null });
  await ctx.deleteAccountData();
  check("typed confirmation cancelled (null): never calls apiFetch", ctx.apiCalls.length === 0);
  check("typed confirmation cancelled (null): reports 'Cancelled', distinct from a typo", ctx.elements.deleteAccountMsg.textContent === "Cancelled.");
}

// ---------------------------------------------------------------------------
// Signed in, both confirmations pass -- the real delete
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: true, confirmReturns: true, promptReturns: "DELETE",
    apiResult: { ok: true, body: { message: "Your account data has been permanently deleted. 2 shared pool(s) you published were also removed." } } });
  await ctx.deleteAccountData();

  check("happy path: calls apiFetch exactly once, to the delete_account_data action",
    ctx.apiCalls.length === 1 && ctx.apiCalls[0].url === "/api/state?action=delete_account_data");
  const sentBody = JSON.parse(ctx.apiCalls[0].opts.body);
  check("happy path: the request body includes confirmDelete:true (server-side backstop, per its own doc comment)",
    sentBody.confirmDelete === true);
  check("happy path: uses POST", ctx.apiCalls[0].opts.method === "POST");

  check("happy path: clears the local copy too (localStorage.removeItem with the real KEY) -- otherwise the old data would just re-sync itself back up",
    ctx.removedKey === "pickgauge_state");
  check("happy path: reloads state via load() (fresh default state, since the key is now gone)", ctx.loadCalled === true);
  check("happy path: calls saveLocal() and syncAll() to persist and re-render the now-empty state",
    ctx.saveLocalCalled === true && ctx.syncAllCalled === true);
  check("happy path: shows the SERVER's own message (including the shared-pool count), not a generic canned string",
    ctx.elements.deleteAccountMsg.textContent.includes("2 shared pool(s)"));
  check("happy path: the status is marked 'ok'", ctx.elements.deleteAccountMsg.className === "ok");
}

// ---------------------------------------------------------------------------
// Signed in, both confirmations pass, but the SERVER rejects it (rate
// limited, conflict, offline, etc.) -- must fail loudly, never pretend
// success or clear local data it didn't actually delete server-side.
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx({ signedIn: true, confirmReturns: true, promptReturns: "DELETE",
    apiResult: { ok: false, error: "Too many delete attempts — please wait a bit before trying again." } });
  await ctx.deleteAccountData();
  check("server rejects the delete: reports the real error message, not a fabricated success",
    ctx.elements.deleteAccountMsg.className === "err" && ctx.elements.deleteAccountMsg.textContent.includes("Too many delete attempts"));
  check("server rejects the delete: does NOT touch localStorage (nothing was actually deleted server-side)",
    ctx.removedKey === undefined);
  check("server rejects the delete: does NOT call saveLocal()/syncAll() (no local state change to render)",
    ctx.saveLocalCalled === undefined && ctx.syncAllCalled === undefined);
}

console.log(failures.length ? `\n${failures.length} of ${total} checks FAILED:` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);
