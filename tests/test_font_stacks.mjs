// Font loading guard (Oct 21, 2026).
//
// 1. Every rule that names Inter, Oswald or JetBrains Mono carries a fallback
//    stack (or uses the --font-sans / --font-display / --font-mono variables),
//    so a slow or blocked font never drops text to a Times-style serif.
// 2. Fonts are self-hosted (/fonts/fonts.css, variable woff2 files): no page
//    loads Google Fonts, and every font-weight in use is a real weight the
//    files cover (multiples of 100 -- the old 650/750/850 values are gone).
//
// Run with:
//     node tests/test_font_stacks.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const list = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const DISPLAY = 'Oswald, "Avenir Next Condensed", "Bahnschrift Condensed", "Roboto Condensed", "Arial Narrow", sans-serif-condensed, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

const rootPages = list(".", ".html");
const sources = [
  "app/css/app.css", "app/css/survivor-integration.css", "app/index.html",
  ...list("app/js", ".js"), "css/marketing.css", "css/legal-pages.css", ...rootPages,
];
const OURS = /^\s*['"]?(Inter|Oswald|JetBrains Mono)['"]?\s*(,|$)/i;
const GENERIC = /\b(sans-serif|monospace|serif)\s*['"]?\s*$/;

// ---- 1. fallbacks ----------------------------------------------------------
const bare = [];
for (const file of sources) {
  const text = read(file);
  // font-family values (may span lines in the Tailwind output); stop at ; } or
  // the closing quote of a style="..." attribute.
  for (const m of text.matchAll(/font-family:\s*([^;}`]+?)\s*(?=[;}`]|"\s*[>\s/])/g)) {
    const v = m[1].replace(/\s+/g, " ");
    if (OURS.test(v) && !GENERIC.test(v)) bare.push(`${file}: font-family:${v}`);
  }
  // font: shorthand (CSS) and ctx.font = '...' (canvas)
  for (const m of text.matchAll(/(?:\bfont:\s*|font\s*=\s*['"])((?:[1-9]00\s+)?[0-9.]+px(?:\/[0-9.]+)?)\s+([^;}'"`]+(?:['"][^'"`;}]*['"][^;}'"`]*)*)/g)) {
    const v = m[2].trim();
    if (OURS.test(v) && !GENERIC.test(v.replace(/['"]$/, ""))) bare.push(`${file}: font ${m[1]} ${v}`);
  }
}
if (bare.length) console.log("   without fallback:", bare.slice(0, 10));
check("every Inter / Oswald / JetBrains Mono rule (CSS, inline styles, canvas) has a fallback stack", bare.length === 0);

const appCss = read("app/css/app.css");
check("app.css defines --font-sans with the system-ui fallback stack", appCss.includes(`--font-sans:${SANS};`));
check("app.css defines --font-display with a condensed sans fallback", appCss.includes(`--font-display:${DISPLAY};`));
check("app.css defines --font-mono with the ui-monospace fallback stack", appCss.includes(`--font-mono:${MONO};`));
check("the app body uses var(--font-sans)", /\bbody\{[^}]*font-family:var\(--font-sans\)/.test(appCss));
check("legal pages' shared CSS spells out the same sans stack", read("css/legal-pages.css").includes(`font-family:${SANS};`));
check("marketing CSS spells out the same sans stack", read("css/marketing.css").includes(`font-family: ${SANS};`));
const canvasJs = ["app/js/picks.js", "app/js/snapshot-export.js", "app/js/survivor-integration.js"].map(read).join("\n");
check("canvas exports spell out the same sans stack (canvas can't read CSS variables)",
  canvasJs.includes(`px ${SANS.replace(/"/g, "'")}"`) || canvasJs.includes(`px ${SANS}'`));

// ---- 2. self-hosted fonts, real weights -------------------------------------
const google = sources.filter((f) => /fonts\.(googleapis|gstatic)\.com/.test(read(f)));
check("no page or stylesheet loads Google Fonts any more", google.length === 0);
const vercel = read("vercel.json");
check("CSP no longer allows fonts.googleapis.com / fonts.gstatic.com; font-src is 'self'",
  !/fonts\.(googleapis|gstatic)\.com/.test(vercel) && /font-src 'self';/.test(vercel));

const pagesUsingFonts = ["app/index.html", ...rootPages];
const missingLink = pagesUsingFonts.filter((f) => !read(f).includes('<link rel="stylesheet" href="/fonts/fonts.css">'));
check("every page links the self-hosted /fonts/fonts.css", missingLink.length === 0);

const fontsCss = read("fonts/fonts.css");
const faces = [...fontsCss.matchAll(/@font-face\{font-family:'([^']+)';[^}]*font-weight:(\d+) (\d+);\s*src:url\(([^)]+)\)/g)]
  .map((m) => ({ family: m[1], lo: +m[2], hi: +m[3], url: m[4] }));
check("fonts.css declares latin + latin-ext faces for Inter, Oswald and JetBrains Mono",
  ["Inter", "Oswald", "JetBrains Mono"].every((f) => faces.filter((x) => x.family === f).length === 2));
check("every font file fonts.css points at exists in /fonts", faces.length && faces.every((x) => fs.existsSync(path.join(ROOT, x.url))));
check("Inter's variable face covers weights 100-900 (so 700/800/900 are real, not faked)",
  faces.filter((x) => x.family === "Inter").every((x) => x.lo <= 400 && x.hi >= 900));
check("each font's OFL license ships next to it",
  ["LICENSE-Inter.txt", "LICENSE-Oswald.txt", "LICENSE-JetBrainsMono.txt"].every((f) => /Open Font License/.test(read(`fonts/${f}`))));
const appHtml = read("app/index.html");
check("the app preloads the two first-screen font files (Inter, Oswald)",
  /<link rel="preload" href="\/fonts\/inter-latin-wght\.woff2" as="font" type="font\/woff2" crossorigin>/.test(appHtml)
  && /<link rel="preload" href="\/fonts\/oswald-latin-wght\.woff2" as="font" type="font\/woff2" crossorigin>/.test(appHtml));

const oddWeights = [];
for (const file of sources) {
  for (const m of read(file).matchAll(/font-weight:\s*(\d+)/g)) if (+m[1] % 100) oddWeights.push(`${file}: ${m[0]}`);
}
if (oddWeights.length) console.log("   odd weights:", oddWeights);
check("every font-weight is a multiple of 100 (650/750/850 rounded to loaded weights)", oddWeights.length === 0);

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
