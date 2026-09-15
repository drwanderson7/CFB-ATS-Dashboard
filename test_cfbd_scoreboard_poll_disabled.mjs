import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'app/js/cfbd-insights.js'), 'utf8');

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`[PASS] ${label}`);
  else { console.log(`[FAIL] ${label}`); failures++; }
}

function extractFunction(name, source) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  let i = source.indexOf('{', start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

// Sept 2026 (Drew's report): CFBD gates the live /scoreboard endpoint
// behind a paid Patreon tier -- confirmed directly against the real API
// response ("CFBD rejected the API key or this endpoint is unavailable on
// the current CFBD tier"). This account's key doesn't have it, so the
// unconditional startup fetch + 90s background poll in initCfbdInsights()
// was failing every single time, on every page, for the entire time the
// app was open -- pure wasted requests and console noise, since nothing
// about actual results-checking depends on it: api/grade_picks.py grades
// against CFBD's historical /games endpoint server-side, which isn't
// tier-gated and was never affected by this. The one real consumer (the
// live in-progress game-status badge on My Picks) was already silently
// non-functional for the same reason before this fix.
const fn = extractFunction('initCfbdInsights', src);

check(
  'initCfbdInsights() no longer calls fetchCfbdScoreboard() on startup',
  !/fetchCfbdScoreboard\(false\)/.test(fn)
);
check(
  'initCfbdInsights() no longer sets up the 90s background scoreboard poll',
  !/setInterval\([\s\S]*?fetchCfbdScoreboard/.test(fn) && !/,\s*90000\)/.test(fn)
);
check(
  'ratings and advanced stats fetches are untouched -- this is a targeted removal of the scoreboard poll specifically, not a wholesale gutting of CFBD startup fetches',
  /fetchCfbdRatings\(currentCfbdSeason\(\),false\)/.test(fn) && /fetchCfbdAdvanced\(currentCfbdSeason\(\),false\)/.test(fn)
);
check(
  'fetchCfbdScoreboard() itself still exists and is callable -- Survivor\'s own manual "Fetch results" still uses it as a best-effort call in its own try/catch, this fix only removes the unconditional background poll',
  /async function fetchCfbdScoreboard\(force=false\)\{/.test(src)
);

console.log('');
if (failures) { console.log(`${failures} check(s) FAILED`); process.exit(1); }
console.log('CFBD live-scoreboard poll removal tests passed');
