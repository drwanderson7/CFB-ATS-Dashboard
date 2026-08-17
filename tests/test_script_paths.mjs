// Deployment-shape test: is every local <script src> in app/index.html
// actually wired to a real file, and does every one of those files still
// parse as valid JS? Run with:
//
//     node tests/test_script_paths.mjs
//
// Why this exists: the JS-splitting pass (v17) turned app/index.html from
// one self-contained file into a shell that loads 15 external files via
// plain <script src="/app/..."> tags -- 3 under app/data/, 12 under
// app/js/. Nothing before this test actually verified the wiring between
// them. A typo'd path, a rename that missed updating the tag, or a
// deleted file would all currently fail SILENTLY: the browser just skips
// a script it can't fetch and everything downstream that depended on it
// throws "X is not defined" the first time it's actually called --
// possibly well after page load, possibly only for one feature, not
// necessarily loud enough to notice immediately. This test catches that
// class of mistake at test time instead of live, in production, on
// whatever's the first click that happens to need the missing file.
// Added in response to a real ChatGPT audit finding: v17 changed enough
// structural wiring that this gap was worth closing immediately, not
// filed away as a someday item.
//
// Covers:
//   1. Parse every LOCAL <script src="..."> in app/index.html (external
//      CDN scripts -- Clerk, pdf.js -- are deliberately skipped; nothing
//      in this repo controls whether those exist).
//   2. Resolve each one to a real path in the repo and assert the file
//      exists.
//   3. Run `node --check` against every one of those files and assert it
//      parses cleanly.
//   4. Bonus, not in the original ask but cheap and closely related:
//      reverse-check app/js/*.js and app/data/*.js for any file that
//      exists on disk but ISN'T referenced by any <script> tag -- catches
//      the opposite mistake (a new split-out file whose loader tag never
//      got added, so it just silently never loads).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(REPO_ROOT, "app", "index.html");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

const html = fs.readFileSync(INDEX_PATH, "utf8");

// Match each full <script ...> opening tag (non-greedy up to the first
// ">") across the whole file, dot-matches-newline since a couple of these
// tags (Clerk's, notably) spread their attributes across multiple lines.
// Pulling src="..." out of the CAPTURED tag text (not straight out of the
// raw HTML) is what keeps this from false-matching the many places this
// project's own comments mention `<script src="...">` in prose when
// explaining why a file is loaded that way -- those aren't inside an
// actual `<...>` tag, so this regex never sees them as a candidate in the
// first place.
const scriptTagPattern = /<script\b[^>]*>/gis;
const tags = html.match(scriptTagPattern) || [];
check("found at least one <script> tag in app/index.html at all (sanity check on the parser itself)", tags.length > 0);

const srcPattern = /\bsrc\s*=\s*["']([^"']+)["']/i;
const localScripts = [];
const externalScripts = [];
for (const tag of tags) {
  const m = tag.match(srcPattern);
  if (!m) continue; // the main inline <script> (no src) isn't a candidate
  const src = m[1];
  if (/^https?:\/\//i.test(src)) {
    externalScripts.push(src);
  } else {
    localScripts.push(src);
  }
}

check("found the expected 3 external CDN scripts (Clerk UI bundle + Clerk core + pdf.js -- update this count deliberately if that ever changes; went from 2 to 3 when the separate @clerk/ui bundle script tag was added to fix a real production bug -- see app/js/init.js's bootstrap() comment)",
  externalScripts.length === 3);
check("found at least one local <script src> to check (if this is 0, the parser itself is broken, not the app)",
  localScripts.length > 0);

// --- 1 & 2: every local script path resolves to a real file -----------
const resolvedPaths = [];
for (const src of localScripts) {
  check(`local script path is absolute, not relative ("${src}") -- app/index.html is served at the exact path "/app" with no trailing slash, so a relative src would resolve wrong at that URL shape (this bit a real earlier session)`,
    src.startsWith("/"));
  // "/app/js/board.js" -> <repo root>/app/js/board.js
  const resolved = path.join(REPO_ROOT, src.replace(/^\//, ""));
  resolvedPaths.push(resolved);
  check(`"${src}" resolves to a file that actually exists on disk`, fs.existsSync(resolved));
}

// --- 3: every one of those files still parses as valid JS --------------
for (const resolved of resolvedPaths) {
  const rel = path.relative(REPO_ROOT, resolved);
  if (!fs.existsSync(resolved)) continue; // already failed above, don't double-report a confusing second failure
  try {
    execFileSync("node", ["--check", resolved], { stdio: "pipe" });
    check(`"${rel}" passes node --check`, true);
  } catch (e) {
    console.log(`   -> ${e.stderr ? e.stderr.toString().trim() : e.message}`);
    check(`"${rel}" passes node --check`, false);
  }
}

// --- 4: reverse check -- no orphaned file exists that nothing loads ----
// Cheap, closely related, and catches the opposite mistake: a new file
// added to app/js/ or app/data/ whose <script src> tag never got added
// to app/index.html, so it silently never loads at all.
const resolvedSet = new Set(resolvedPaths.map((p) => path.resolve(p)));
for (const dir of ["app/js", "app/data"]) {
  const dirPath = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(dirPath)) continue;
  const filesOnDisk = fs.readdirSync(dirPath).filter((f) => f.endsWith(".js"));
  for (const f of filesOnDisk) {
    const full = path.resolve(path.join(dirPath, f));
    check(`${dir}/${f} exists on disk AND is referenced by a <script src> tag in app/index.html (an orphaned file here would silently never load)`,
      resolvedSet.has(full));
  }
}

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
