// CSS dead-declaration audit (code-health tool, not part of the page build).
//
//   node scripts/build/css-audit.mjs            report only
//   node scripts/build/css-audit.mjs --fix      remove them from the source files
//
// A declaration is DEAD when another rule with the IDENTICAL selector, inside
// the IDENTICAL at-rule chain (e.g. the same @media), comes later in the same
// file and sets the same property at equal-or-higher importance: the cascade
// can never use the earlier value. These pile up because fixes are appended
// as override blocks at the end of the file instead of edited in place.
//
// Deliberately conservative -- NOT treated as dead:
//  - a property declared twice inside ONE rule (intentional fallbacks)
//  - an earlier !important overridden by a later non-important
//  - pairs where the LATER value uses a feature an older browser might drop
//    (dvh/svh/env()/clamp()/min()/max()/color-mix/vendor prefixes/gap/
//    aspect-ratio/inset/...): the earlier rule is then a real fallback
//  - anything inside @keyframes / @font-face / @page
// Rules left empty by a removal (and empty @media blocks) are dropped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const postcss = require("postcss");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
const FIX = process.argv.includes("--fix");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const skipAt = /^(-webkit-)?(keyframes|font-face|page|counter-style)$/i;
const RISKY_VALUE = /(dvh|svh|lvh|dvw|svw|lvw|env\(|clamp\(|min\(|max\(|color-mix|-webkit-|-moz-|fit-content|sticky|subgrid)/i;
const RISKY_PROP = new Set(["gap", "row-gap", "column-gap", "aspect-ratio", "inset", "overscroll-behavior", "scroll-padding-top", "touch-action", "backdrop-filter", "accent-color", "scroll-snap-type", "container-type"]);

const chainOf = (node) => { const c = []; for (let n = node.parent; n && n.type !== "root"; n = n.parent) if (n.type === "atrule") c.unshift("@" + n.name + " " + norm(n.params)); return c.join(" > "); };
const inSkipped = (node) => { for (let n = node.parent; n && n.type !== "root"; n = n.parent) if (n.type === "atrule" && skipAt.test(n.name)) return true; return false; };

let totalDead = 0, totalBytesSaved = 0;
for (const rel of [...manifest.css, ...Object.values(manifest.lazy || {}).flatMap((g) => g.css)]) {
  const file = path.join(root, rel);
  const css = fs.readFileSync(file, "utf8");
  const tree = postcss.parse(css, { from: file });
  const byKey = new Map();
  tree.walkRules((rule) => {
    if (inSkipped(rule)) return;
    const key = chainOf(rule) + "||" + norm(rule.selector);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(rule);
  });
  const dead = [];
  for (const [key, rules] of byKey) {
    if (rules.length < 2) continue;
    const props = new Map();
    rules.forEach((r) => r.each((n) => { if (n.type !== "decl") return; const p = n.prop.toLowerCase(); if (!props.has(p)) props.set(p, []); props.get(p).push({ r, n }); }));
    for (const [p, list] of props) {
      if (list.length < 2) continue;
      if (list.some((x) => x.r.nodes.filter((n) => n.type === "decl" && n.prop.toLowerCase() === p).length > 1)) continue;
      for (let i = 0; i < list.length - 1; i++) {
        const earlier = list[i];
        const overriding = list.slice(i + 1).filter((l) => l.r !== earlier.r && (l.n.important || !earlier.n.important));
        if (!overriding.length) continue;
        if (overriding.some((l) => RISKY_VALUE.test(l.n.value) || RISKY_PROP.has(p))) continue; // keep possible fallback
        dead.push({ node: earlier.n, line: earlier.n.source.start.line, where: key.split("||")[0] || "(top level)", sel: key.split("||")[1], p, v: earlier.n.value });
      }
    }
  }
  totalDead += dead.length;
  console.log(`${rel}: ${dead.length} dead declarations of ${css.length} bytes`);
  if (!FIX) { dead.slice(0, 8).forEach((d) => console.log(`   line ${d.line}  ${d.where}  ${d.sel.slice(0, 48)} { ${d.p}: ${d.v.slice(0, 28)} }`)); continue; }
  dead.forEach((d) => d.node.remove());
  let emptied = 0;
  for (let pass = 0; pass < 3; pass++) {
    tree.walk((n) => { if ((n.type === "rule" || n.type === "atrule") && n.nodes && n.nodes.length === 0 && !(n.type === "atrule" && /^(font-face|page|layer|import|charset)$/i.test(n.name))) { n.remove(); emptied++; } });
  }
  const out = tree.toString();
  fs.writeFileSync(file, out);
  totalBytesSaved += css.length - out.length;
  console.log(`   removed ${dead.length} declarations, ${emptied} now-empty blocks; ${css.length} -> ${out.length} bytes`);
}
console.log(FIX ? `total: removed ${totalDead} dead declarations, ${totalBytesSaved} source bytes` : `total: ${totalDead} dead declarations (run with --fix to remove)`);
