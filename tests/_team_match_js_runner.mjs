// Helper invoked by tests/test_team_match_parity.py (via `node
// tests/_team_match_js_runner.mjs`, corpus piped in on stdin as a JSON
// array of [nameA, nameB] pairs) -- NOT a standalone check()-emitting
// test itself, which is why it's underscore-prefixed like
// _render_snapshot.py/_render_clv_callout.py, even though unlike those
// two (manual, visual-verification-only scripts) this one IS load-bearing
// for an automated test, not just for eyeballing something.
//
// Extracts the REAL teamMatch()/teamTokens()/aliasOf()/prefixOk()/
// SIGNIFICANT_TOKENS from the actual app/js/pdf-import.js, and the REAL
// TEAM_ALIAS from the actual app/data/team-alias.js -- same "run the
// actual file's source, never a reimplementation" discipline as every
// other test in this suite, just reached from the Python side of a
// cross-language comparison instead of from another .mjs file.
//
// Runs teamMatch(a,b) for every pair in the corpus and prints a JSON
// array of booleans to stdout, in the same order the pairs came in --
// the Python side does the actual comparing.
//
// Can also be run directly for debugging (no Python involved):
//     echo '[["Wisconsin","Wisconsin Badgers"]]' | node tests/_team_match_js_runner.mjs
import fs from "node:fs";
import vm from "node:vm";

function extractFunction(name, source) {
  const startMarker = `function ${name}(`;
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find function ${name}()`);
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

function extractConst(name, source) {
  const startMarker = `const ${name}=`;
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find const ${name}`);
  // Bracket-depth walk from the opening [ or {, same reasoning as
  // extractFunction's brace walk -- SIGNIFICANT_TOKENS' Set(['...','...'])
  // literal spans multiple lines with nested [], a naive ";\n" search
  // would clip it wrong the same way BREAKEVEN_WINPCT's trailing comment
  // once broke a simpler version of this in another test file.
  let i = start + startMarker.length;
  while (source[i] !== "[" && source[i] !== "{" && source[i] !== "(") i++;
  const open = source[i];
  const close = open === "[" ? "]" : open === "{" ? "}" : ")";
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close) { depth--; if (depth === 0) { i++; break; } }
  }
  // Consume up to the trailing ";"
  while (source[i] !== ";") i++;
  return source.slice(start, i + 1);
}

const repoRoot = new URL("..", import.meta.url);
const pdfImportSrc = fs.readFileSync(new URL("app/js/pdf-import.js", repoRoot), "utf8");
const teamAliasSrc = fs.readFileSync(new URL("app/data/team-alias.js", repoRoot), "utf8");

const code = [
  teamAliasSrc, // defines the real global TEAM_ALIAS
  extractConst("SIGNIFICANT_TOKENS", pdfImportSrc),
  extractFunction("teamTokens", pdfImportSrc),
  extractFunction("aliasOf", pdfImportSrc),
  extractFunction("prefixOk", pdfImportSrc),
  extractFunction("teamMatch", pdfImportSrc),
].join("\n\n");

const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);

let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const pairs = JSON.parse(input);
  const results = pairs.map(([a, b]) => ctx.teamMatch(a, b));
  process.stdout.write(JSON.stringify(results));
});
