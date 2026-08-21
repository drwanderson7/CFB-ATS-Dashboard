// Structural regression tests for the Snapshot "Quick Look" table layout
// fixes (real screenshot report: "signal header is misaligned, the team
// names are misaligned with the recommended bet, the logos are too
// small, the arrow to expand the game is too small and not obvious
// enough"). Static checks against the real source (app/js/board.js,
// app/index.html) rather than pure-function extraction -- these are
// markup/CSS fixes, not logic, so this matches the convention already
// used for the Sort & filter panel and Matchup-breakdown-position fixes
// (tests/test_board_cfbd_dropdown_logic.mjs) rather than
// test_snapshot_logic.mjs's vm-extraction pattern (that file covers
// Snapshot's actual pure functions, e.g. percentileRank/scoring/
// filtering -- unrelated to this table's layout).
//
// Visual confirmation lives in tests/_render_snapshot_quicklook.py
// (one-off Playwright render, not part of this numbered suite).
// Run with:
//     node tests/test_snapshot_quicklook_layout.mjs
import fs from "node:fs";

const board = fs.readFileSync(new URL("../app/js/board.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

// --- Signal header/cell alignment -----------------------------------------
// Root cause: edgeExtrasHTML()'s badges render in a flex row
// (.edge-extras, flex-start/left by default) inside a <td> that defaulted
// to text-align:right like every numeric column beside it -- "SIGNAL"
// sat pinned right while its own badges hugged left.
check("the Signal <th> carries a dedicated .signal-th class (NOT .l -- that class also carries thead th.l's sticky-left-edge positioning, which belongs only to the real first column)",
  /<th class="signal-th">Signal<\/th>/.test(board));
check("the Signal <td> carries a matching .signal-td class",
  /<td data-label="Signal" class="signal-td">/.test(board));
check("CSS left-aligns both the Signal header and cell, matching .edge-extras' own natural flex-start alignment instead of fighting it",
  /th\.signal-th,td\.signal-td\{text-align:left;\}/.test(html));

// --- bet-line / matchup-sub shared left edge -------------------------------
// Root cause: the logo used to sit INSIDE .bet-line (line 1 only), so the
// logo's width+gap pushed line 1's text start rightward while
// .matchup-sub (line 2, no logo) started flush at column 0 -- the two
// stacked lines didn't share a left edge.
check("the Bet cell wraps logo + both text lines in a .bet-block flex row, with a separate .bet-text column holding .bet-line and .matchup-sub -- not the logo living inside .bet-line itself",
  /<td class="l" data-label="Bet"><div class="bet-block">\$\{logoHTML\}<div class="bet-text"><div class="bet-line">/.test(board));
check(".bet-block centers the logo alongside the WHOLE two-line block (align-items:center on the row), not just line 1",
  /\.bet-block\{display:flex;align-items:center;gap:9px;\}/.test(html));
check(".bet-line no longer carries its own display:flex/gap (that's what let the old inline logo push its text over) -- alignment now comes entirely from .bet-block's structure",
  /\.bet-line\{font-weight:700;color:var\(--ink\);\}/.test(html));

// --- Logo size ---------------------------------------------------------
check("Quick Look's logo uses its OWN class (.bet-logo), not the shared .teampick-logo -- bumping .teampick-logo directly would have also resized Board's compact pill buttons and the Top Opportunities cards, which weren't part of this report",
  /const logoHTML=logo\?`<img class="bet-logo"/.test(board));
check(".bet-logo is meaningfully bigger than the shared .teampick-logo (18px) -- addresses \"logos are too small\" specifically for this table",
  (() => {
    const m = html.match(/\.bet-logo\{width:(\d+)px;height:(\d+)px;/);
    return m && Number(m[1]) > 18 && Number(m[2]) > 18;
  })());

// --- Expand arrow visibility --------------------------------------------
// Root cause: the desktop .expand-btn was 11px at var(--muted) -- a
// mobile-only override already fixed the tap-target/visibility there
// (Aug 20-era), but desktop -- what the actual screenshot report showed
// -- never got the same treatment.
check("the desktop (base, non-mobile-scoped) .expand-btn rule uses a real dark color (var(--ink)), not var(--muted)",
  /\.expand-btn\{background:transparent;border:none;color:var\(--ink\);cursor:pointer;font-size:16px;font-weight:700;/.test(html));
check("the desktop .expand-btn is meaningfully bigger than the old 11px",
  (() => {
    const m = html.match(/\.expand-btn\{background:transparent;border:none;color:var\(--ink\);cursor:pointer;font-size:(\d+)px;/);
    return m && Number(m[1]) >= 16;
  })());
check("the desktop .expand-btn gets a visible hover background, reading as a clickable control rather than decorative punctuation",
  /\.expand-btn:hover\{background:var\(--row\);\}/.test(html));
check("the mobile-only tap-target override (min 40px, bumped further for touch) still exists on top of the desktop base fix, not replaced by it",
  /#tab-snapshot \.expand-btn\{font-size:20px;font-weight:700;color:var\(--ink\);\s*\n\s*width:40px;min-height:40px;/.test(html));

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
