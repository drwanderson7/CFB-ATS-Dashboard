import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'app/js/pool-contexts.js'), 'utf8');

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`[PASS] ${label}`);
  else { console.log(`[FAIL] ${label}`); failures++; }
}

function extractFunction(name, source) {
  const asyncMarker = `async function ${name}(`, plainMarker = `function ${name}(`;
  let start = source.indexOf(asyncMarker); if (start < 0) start = source.indexOf(plainMarker);
  if (start < 0) throw new Error(`missing ${name}`);
  let i = source.indexOf('{', start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

// Sept 11, 2026 (Drew's report, 3rd round on the same Madwood import bug):
// the parser fix that upgrades short codes ("OKLA") to full team names
// ("Oklahoma") was correct and verified against the real PDF, but
// re-importing into an ALREADY-loaded week kept showing the old short
// codes no matter how many times it ran. Root cause: applyParsedPoolData()
// treated "same week already loaded" as always meaning "just update
// lines, never touch away/home" (mergePoolLines()'s own explicit
// contract) -- correct when picks exist (changing away/home would orphan
// them), but that same caution was blocking a legitimate identity
// correction on a pool with ZERO picks recorded, where there was nothing
// to protect and the merge-only path could never fix anything.
const fn = extractFunction('applyParsedPoolData', src);

check(
  'the same-week branch checks hasPicks before deciding whether to merge-only or fully replace',
  /const hasPicks=target\.entries\.some\(e=>Object\.keys\(e\.picks\)\.length\);\s*\n\s*if\(curWeekIdx!=null\s*&&\s*newWeekIdx!=null\s*&&\s*curWeekIdx===newWeekIdx\)\{/.test(fn)
);
check(
  'same week + picks exist -> still the original safe merge-only path (mergePoolLines, away/home untouched)',
  /if\(hasPicks\)\{[\s\S]{0,700}mergePoolLines\(target, ?data\.games\)/.test(fn)
);
check(
  'same week + NO picks -> falls through to a full target.games replace (same shape as the different-week branch), not just a line-only merge',
  /\/\/ Same week, but nothing to preserve[\s\S]{0,1600}target\.games=data\.games\.map\(g=>\(\{away:g\.away,home:g\.home,commence:g\.commence,line:\(g\.line!=null\?g\.line:null\)\}\)\)/.test(fn)
);
check(
  "hasPicks is declared exactly once in this function (no duplicate 'const hasPicks' -- the different-week branch below reuses the same one)",
  (fn.match(/const hasPicks=/g) || []).length === 1
);
check(
  'the full-replace path still updates weekLabel/pickLimit/importedAt/activeContext and saves, same as the different-week branch (not a stripped-down duplicate that forgets a field)',
  /\/\/ Same week, but nothing to preserve[\s\S]{0,1200}target\.weekLabel=newWeekLbl;[\s\S]{0,300}target\.pickLimit=data\.pickLimit;[\s\S]{0,300}target\.importedAt=new Date\(\)\.toISOString\(\);[\s\S]{0,300}state\.activeContext=target\.id;[\s\S]{0,300}save\(\); ?renderContextAll\(\); ?renderPoolsPage\(\);/.test(fn)
);

console.log('');
if (failures) { console.log(`${failures} check(s) FAILED`); process.exit(1); }
console.log('Pool same-week identity-refresh tests passed');
