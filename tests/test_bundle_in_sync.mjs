// The built files in app/dist/ must match the sources (asset build, Sept 2026).
//
// index.html loads app/dist/app.min.js + app.min.css. Survivor's code
// (survivor.min.js, survivor.min.css, survivor-core.min.js) is LAZY: it is
// fetched the first time the Survivor tab opens (pgLoadSurvivor, app/js/tabs.js).
// All of these are GENERATED from app/js, app/data, app/css and
// app/survivor-core by scripts/build.sh. If someone edits a source file and
// forgets to rebuild, the live site silently keeps running the old code -- and
// every browser test would quietly test the old code too. This test recomputes
// the content hash (no esbuild needed) and fails on any drift.
//
// Fix for a failure:   scripts/build.sh   then commit app/dist/
// Run with:            node tests/test_bundle_in_sync.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const manifest = JSON.parse(read("scripts/build/manifest.json"));
const lazy = manifest.lazy || {};
const lazyGroups = Object.entries(lazy);
const lazyJs = lazyGroups.flatMap(([, g]) => g.js);
const lazyCss = lazyGroups.flatMap(([, g]) => g.css);
const lazyOut = (name) => manifest.out.lazy[name];

let total = 0, failed = 0;
const check = (name, cond) => { total++; console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`); if (!cond) failed++; };

// Same algorithm as sourceHash() in scripts/build/build.mjs.
function sourceHash() {
  const h = crypto.createHash("sha256");
  h.update("manifest\0" + JSON.stringify({ js: manifest.js, module: manifest.module, css: manifest.css, lazy }) + "\0");
  for (const f of [...manifest.js, manifest.module, ...manifest.css, ...lazyJs, ...lazyCss]) h.update(f + "\0" + read(f) + "\0");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(path.join(root, "app/survivor-core")).filter((p) => p.endsWith(".js")).sort()) h.update(path.relative(root, f) + "\0" + fs.readFileSync(f, "utf8") + "\0");
  return h.digest("hex").slice(0, 16);
}
const expected = sourceHash();
const info = JSON.parse(read(manifest.out.info));

const outputs = [manifest.out.js, manifest.out.css, manifest.out.module, ...lazyGroups.flatMap(([n]) => [lazyOut(n).js, lazyOut(n).css])];
check("all files listed in the manifest exist", [...manifest.js, manifest.module, ...manifest.css, ...lazyJs, ...lazyCss].every((f) => fs.existsSync(path.join(root, f))));
check("every built output and source map exists", [...outputs, manifest.out.js + ".map", manifest.out.module + ".map", ...lazyGroups.map(([n]) => lazyOut(n).js + ".map")].every((f) => fs.existsSync(path.join(root, f))));
check(`build-info.json hash matches the current sources (${expected}) -- if not, run scripts/build.sh`, info.hash === expected);
for (const rel of outputs) {
  check(`${rel} carries the current source hash in its first line`, read(rel).split("\n", 1)[0].includes(`pickgauge build ${expected}`));
}

// Orphans: every app/js + app/data file must be in the manifest (main, lazy or module).
const listed = new Set([...manifest.js, ...lazyJs, manifest.module]);
for (const dir of ["app/js", "app/data"]) {
  for (const f of fs.readdirSync(path.join(root, dir)).filter((x) => x.endsWith(".js"))) {
    check(`${dir}/${f} is in the build manifest`, listed.has(`${dir}/${f}`));
  }
}
for (const f of fs.readdirSync(path.join(root, "app/css")).filter((x) => x.endsWith(".css"))) {
  check(`app/css/${f} is in the build manifest`, [...manifest.css, ...lazyCss].includes(`app/css/${f}`));
}

// Sanity on the output itself.
const bundle = read(manifest.out.js);
const jsOutputs = [manifest.out.js, manifest.out.module, ...lazyGroups.map(([n]) => lazyOut(n).js)];
for (const rel of jsOutputs) {
  try { execFileSync("node", ["--check", path.join(root, rel)], { stdio: "pipe" }); check(`${rel} parses`, true); }
  catch (e) { check(`${rel} parses`, false); }
}
check("main bundle is actually minified (< 470KB; its sources are ~830KB)", bundle.length < 470000);
const classicOutputs = [manifest.out.js, ...lazyGroups.map(([n]) => lazyOut(n).js)];
check("no classic bundle is a single-IIFE wrapper (classic scripts must share the global scope)",
  classicOutputs.every((rel) => { const t = read(rel); return !/^\/\*![^\n]*\n\(\(\)=>\{/.test(t) && !/^\/\*![^\n]*\n\(function/.test(t); }));

// Top-level names must survive minification: code calls them by name across
// files, from inline handlers in template strings, and from tests.
const nameRe = [/^(?:async )?function\s+([A-Za-z_$][\w$]*)\s*\(/gm, /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/gm];
const groups = [{ files: manifest.js, out: manifest.out.js }, ...lazyGroups.map(([n, g]) => ({ files: g.js, out: lazyOut(n).js }))];
let missing = [], checked = 0;
for (const { files, out } of groups) {
  const built = read(out);
  for (const rel of files) {
    const src = read(rel);
    for (const re of nameRe) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(src))) {
        checked++;
        if (!new RegExp(`(?<![\\w$])${m[1].replace(/\$/g, "\\$")}(?![\\w$])`).test(built)) missing.push(`${rel}:${m[1]}`);
      }
    }
  }
}
console.log(`   checked ${checked} top-level declarations`);
check("every top-level function/const/let name from the sources is still present in its bundle (no top-level renaming)", missing.length === 0);
if (missing.length) console.log("   missing:", missing.slice(0, 10));
check("inline-handler entry points keep their names (spot check)", ["renderBoard", "switchTab", "refreshLines", "closeWeek", "pgLoadSurvivor", "pgShowSurvivor"].every((n) => bundle.includes(`function ${n}(`)));

// Lazy split is real: Survivor code is ONLY in the lazy bundle.
const survivorBundle = read(lazyOut("survivor").js);
check("Survivor's shell/render code is NOT in the page-load bundle", !bundle.includes("function renderSurvivorShell(") && !bundle.includes("function pgSurvivorRenderBoard("));
check("...it is in the lazy Survivor bundle", survivorBundle.includes("function renderSurvivorShell(") && survivorBundle.includes("function pgSurvivorRenderBoard("));
check("Survivor's stylesheet is NOT in the page-load stylesheet", !/\.survivor-board/.test(read(manifest.out.css)));
check("...it is in the lazy Survivor stylesheet", /\.survivor-board/.test(read(lazyOut("survivor").css)));
const tabs = read("app/js/tabs.js");
check("pgLoadSurvivor() fetches exactly the three built Survivor files from the manifest",
  tabs.includes(`css:"/${lazyOut("survivor").css}"`) && tabs.includes(`core:"/${manifest.out.module}"`) && tabs.includes(`js:"/${lazyOut("survivor").js}"`));
check("the ONLY code outside the Survivor files that touches Survivor is the tabs.js loader/guards (plus main.js ensuring state.survivor is an object)", (() => {
  const offenders = [];
  for (const rel of [...manifest.js]) {
    const src = read(rel);
    if (rel === "app/js/tabs.js") continue;
    if (/pgSurvivor|renderSurvivorShell|PickGaugeSurvivorCore/.test(src)) offenders.push(rel);
  }
  if (offenders.length) console.log("   offenders:", offenders);
  return offenders.length === 0;
})());

// Source maps map back to the real files.
for (const [rel, files] of [[manifest.out.js, manifest.js], ...lazyGroups.map(([n, g]) => [lazyOut(n).js, g.js])]) {
  const map = JSON.parse(read(rel + ".map"));
  check(`${rel}.map is an index map with one section per source file`, map.version === 3 && Array.isArray(map.sections) && map.sections.length === files.length);
  check(`${rel}.map: every section names its original file (DevTools shows real files)`, map.sections.every((s, i) => (s.map.sources || []).includes("/" + files[i])));
  check(`${rel} ends with its sourceMappingURL`, read(rel).trimEnd().endsWith(`//# sourceMappingURL=${path.basename(rel)}.map`));
}

// Size budget (gzip is what Vercel actually sends).
const gz = (rel) => zlib.gzipSync(fs.readFileSync(path.join(root, rel)), { level: 9 }).length;
const gzJs = gz(manifest.out.js), gzCss = gz(manifest.out.css);
const gzLazy = gz(lazyOut("survivor").js) + gz(lazyOut("survivor").css) + gz(manifest.out.module);
console.log(`   gzip: page-load js ${gzJs}, css ${gzCss} | lazy survivor (js+css+core) ${gzLazy}`);
check("gzipped page-load JS stays under 130KB (was ~303KB across 30 files before the build, ~154KB before Survivor went lazy)", gzJs < 130000);
check("gzipped page-load CSS stays under 25KB", gzCss < 25000);
check("gzipped lazy Survivor payload stays under 100KB", gzLazy < 100000);

// index.html wiring.
const html = read("app/index.html");
const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, "");
check("index.html links only the built main stylesheet (no source stylesheets, no Survivor stylesheet)",
  htmlNoComments.includes('href="/app/dist/app.min.css"') && !/href="\/app\/css\//.test(htmlNoComments) && !/survivor\.min\.css/.test(htmlNoComments));
check("index.html does not reference any Survivor script (it is lazy)", !/survivor[^"']*\.js/.test(htmlNoComments));
check("index.html no longer loads pdf.js on every page view (lazy-loaded on first PDF import)", !/<script[^>]*pdf\.min\.js/.test(html));
check("vercel.json serves /app/dist/ with no-cache, must-revalidate (a deploy is picked up immediately)", /"source":\s*"\/app\/dist\/\(\.\*\)"[\s\S]{0,200}no-cache, must-revalidate/.test(read("vercel.json")));

console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nAll ${total} checks passed.`);
process.exit(failed ? 1 : 0);
