// Runtime tests for extractPdfTextLines()'s error-translation logic --
// extracts the ACTUAL function from app/index.html (not a hand-copied
// reimplementation) and executes it in Node with mocked pdfjsLib
// failure modes, per this project's established pattern. Run with:
//
//     node tests/test_pdf_error_handling.mjs
//
// Covers the three distinct failure modes item 19 was about:
//   1. window.pdfjsLib never loaded at all (main CDN script failed)
//   2. window.pdfjsLib loaded, but the pdf.js WORKER (a separate network
//      request pdf.js spawns internally, with no <script> tag of our own
//      to attach an onerror to) failed -- this was the real, previously
//      unhandled gap: the old code only checked for case 1
//   3. the reader loaded fine, but the file itself is bad (corrupt,
//      password-protected, not a real PDF) -- must NOT be reported as a
//      network/CDN problem, since telling someone to check their
//      internet connection for a bad file is actively misleading
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
// extractPdfTextLines moved out of index.html into app/js/pool-contexts.js
// (client-side pdf.js reading for the Splash/OFP pool sheet import --
// different from the Powers newsletter's server-side parsing, which
// moved to app/js/pdf-import.js in an earlier pass). Read separately and
// passed as the source to search.
const poolContextsSrc = fs.readFileSync(new URL("../app/js/pool-contexts.js", import.meta.url), "utf8");

// Same brace-depth extraction as the rest of the suite, but aware that
// this particular function is declared `async function name(...)` --
// the plain "function name(" marker used elsewhere would find the right
// spot but silently drop the `async` keyword, producing code that throws
// a SyntaxError the moment it hits `await` inside.
function extractAsyncFunction(name, source = src) {
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

const code = extractAsyncFunction("extractPdfTextLines", poolContextsSrc);
const ctx = { window: {}, File, Blob };
vm.createContext(ctx);
vm.runInContext(code, ctx);

// Helper: sets pdfjsLib in BOTH forms the real code references it by
// (window.pdfjsLib for the initial guard, bare pdfjsLib for the actual
// call) -- in a real browser these are the same global; in this sandbox
// they need to be wired together explicitly.
function setPdfjsLib(value) {
  ctx.window.pdfjsLib = value;
  ctx.pdfjsLib = value;
}

const fakeFile = new ctx.File([new ctx.Blob(["fake"])], "test.pdf", { type: "application/pdf" });

// ---------------------------------------------------------------------
// Case 1: main library never loaded (window.pdfjsLib undefined) -- the
// ORIGINAL check, still needs to work.
// ---------------------------------------------------------------------
{
  ctx.window.pdfjsLib = undefined;
  ctx.pdfjsLib = undefined;
  let caught = null;
  try {
    await ctx.extractPdfTextLines(fakeFile);
  } catch (e) {
    caught = e.message;
  }
  check("case 1 (library never loaded): clear, specific message", caught === "PDF reader didn't load — check your connection and try again.");
}

// ---------------------------------------------------------------------
// Case 2: library loaded, but the WORKER failed -- the actual gap this
// fix closes. Error message text deliberately mimics what a real
// worker/fetch failure looks like from pdf.js/the browser.
// ---------------------------------------------------------------------
{
  setPdfjsLib({
    getDocument: () => ({ promise: Promise.reject(new Error("Failed to fetch dynamically imported module: worker script")) }),
  });
  let caught = null;
  try {
    await ctx.extractPdfTextLines(fakeFile);
  } catch (e) {
    caught = e.message;
  }
  check("case 2 (worker fails to load): reports a reader/network problem, not a raw pdf.js error",
    caught === "The PDF reader failed to load (network or ad-blocker issue) — check your connection and try again.");
}

// ---------------------------------------------------------------------
// Case 3: reader loaded fine, file itself is bad -- must NOT claim it's
// a network problem.
// ---------------------------------------------------------------------
{
  setPdfjsLib({
    getDocument: () => ({ promise: Promise.reject(new Error("Invalid PDF structure")) }),
  });
  let caught = null;
  try {
    await ctx.extractPdfTextLines(fakeFile);
  } catch (e) {
    caught = e.message;
  }
  check("case 3 (bad/corrupt file): reports a FILE problem, not a network problem",
    caught === "Couldn't read that PDF — it may be corrupted, password-protected, or not a valid PDF file.");
  check("case 3: does NOT tell the person to check their connection (that would be misleading for a bad file)",
    !caught.toLowerCase().includes("connection"));
}

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
