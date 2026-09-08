import fs from 'node:fs';
import assert from 'node:assert/strict';

// Drew's ask: opponent names in the Season Board grid are CSS-truncated
// with an ellipsis at the cell's fixed width ("vs Kenne...", "@ Georgi...")
// and there was no way to see the full name without it. The cell button
// already had a title attribute, but it was blank except when the pick was
// already selected -- this makes it always carry the full, untruncated
// matchup label (and win probability), so hover/long-press reveals the
// real opponent regardless of column width.

const src = fs.readFileSync(new URL('../app/js/survivor-integration.js', import.meta.url), 'utf8');

const fnMatch = src.match(/function pgSurvivorRenderBoard\(\)\{[\s\S]*?\n\}/);
assert.ok(fnMatch, 'pgSurvivorRenderBoard should be present');
const fn = fnMatch[0];

assert.match(
  fn,
  /const cellTitle=`\$\{pgSurvivorMatchLabel\(m\)\} · \$\{pgSurvivorFmtPct\(m\.winProbability\)\}\$\{selected\?' · Click to remove this pick':''\}`;/,
  'the cell title must be built from the full (untruncated) match label + win probability, with the remove hint appended only when already picked'
);
assert.match(fn, /title="\$\{esc\(cellTitle\)\}"/, 'the constructed title must actually be applied to the cell button, and escaped');

// The old blank-unless-selected title must be gone, not left alongside the
// new one.
assert.doesNotMatch(fn, /title="\$\{selected\?'Click to remove this pick':''\}"/);

// The on-screen (still-truncated-by-CSS) label is unchanged -- this is a
// hover-affordance addition, not a layout change.
assert.match(fn, /<span class="survivor-cell-opp">\$\{esc\(pgSurvivorMatchLabel\(m\)\)\}<\/span>/);

console.log('Survivor Season Board cell hover-title test passed');
