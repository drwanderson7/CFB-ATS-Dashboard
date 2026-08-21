// Structural regression tests for Snapshot layout fixes across two areas:
// the "Quick Look" table (real screenshot report: "signal header is
// misaligned, the team names are misaligned with the recommended bet,
// the logos are too small, the arrow to expand the game is too small and
// not obvious enough" -- plus a follow-up "still not left justified" root
// -cause fix), and the "Top Opportunities" cards above it (later request:
// 5 cards instead of 3, bigger logos there too). Static checks against
// the real source (app/js/board.js, app/index.html) rather than
// pure-function extraction -- these are markup/CSS fixes, not logic, so
// this matches the convention already used for the Sort & filter panel
// and Matchup-breakdown-position fixes (tests/test_board_cfbd_dropdown_
// logic.mjs) rather than test_snapshot_logic.mjs's vm-extraction pattern
// (that file covers Snapshot's actual pure functions, e.g.
// percentileRank/scoring/filtering -- unrelated to either area's layout).
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
  /\.bet-block\{display:flex;align-items:center;gap:9px;text-align:left;\}/.test(html));
// Real root-cause fix ("still not left justified" report, second pass):
// thead th.l got its own text-align:left override long ago, but the
// matching BODY override was never added -- td.l (and everything inside
// it: .bet-block/.bet-text/.bet-line/.matchup-sub) was silently
// inheriting text-align:right from the base tbody td rule the whole
// time. Invisible whenever .bet-line's and .matchup-sub's text happened
// to render nearly the same width, but for uneven team-name pairs (the
// normal case), each line right-aligned independently within its own
// shrink-to-fit box -- exactly the ragged, inconsistent indentation
// reported.
check(".bet-line no longer carries its own display:flex/gap (that's what let the old inline logo push its text over) -- alignment now comes entirely from .bet-block's structure",
  /\.bet-line\{font-weight:700;color:var\(--ink\);\}/.test(html));

// --- Logo size ---------------------------------------------------------
check("Quick Look's logo uses its OWN class (.bet-logo), not the shared .teampick-logo -- bumping .teampick-logo directly would have also resized Board's compact pill buttons and the Top Opportunities cards, which weren't part of this report",
  /const logoHTML=logo\?`<span class="bet-logo">/.test(board));
check(".bet-logo is a wrapping <span> around the <img>, not a bare img with border-radius:50% -- same padded-circular-badge pattern Board's mobile .logo-badge already established, needed so a square/rectangular logo's corners land inside the circle instead of being clipped by it (\"part of the logo gets cut off\")",
  /\.bet-logo\{display:flex;align-items:center;justify-content:center;\s*\n\s*width:38px;height:38px;box-sizing:border-box;flex:none;overflow:hidden;\s*\n\s*background:#fff;border:1px solid var\(--line\);border-radius:50%;padding:5px;\}/.test(html));
check(".bet-logo's own img fills the padded frame via object-fit:contain, not a fixed size that could overflow or underfill the badge",
  /\.bet-logo img\{width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;\}/.test(html));
check(".bet-logo is meaningfully bigger than the shared .teampick-logo (18px) -- addresses \"logos are too small\" specifically for this table",
  (() => {
    const m = html.match(/\.bet-logo\{display:flex;align-items:center;justify-content:center;\s*\n\s*width:(\d+)px;height:(\d+)px;/);
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

// --- Header alignment: header text vs actual team-name text ------------
// Second-pass fix: the .bet-block/.bet-text restructure above correctly
// aligned .bet-line and .matchup-sub with EACH OTHER, but the header
// "Recommended bet / matchup" still started flush at the column's left
// edge while the actual team-name text on every row started ~35px
// further right (the logo occupies that gap) -- the header visibly
// didn't line up with the text underneath it, even though the LOGO
// technically did. Worse after the logo-size bump above (bigger logo =
// bigger unindented gap). Fixed with a spacer in the header matching
// .bet-logo's width + .bet-block's gap.
check("the header <th> for this column includes a .bet-th-spacer matching the logo's footprint, before the header text itself",
  /<th class="l"><span class="bet-th-spacer"><\/span>Recommended bet \/ matchup<\/th>/.test(board));
check(".bet-th-spacer's width is numerically in sync with .bet-logo's width (38px) + .bet-block's gap (9px) = 47px -- if either of those two values changes, this needs to change with it",
  /\.bet-th-spacer\{display:inline-block;width:47px;\}/.test(html));
check("mobile hides the whole <thead> for this table (#tab-snapshot thead{display:none}), so the spacer has zero visual effect there -- this is a desktop-only fix, consistent with the alignment bug only being reported on desktop",
  /#tab-snapshot thead\{display:none;\}/.test(html));

// --- Signal column: stacked badges instead of side-by-side ----------------
// Real gap fix: a 2-badge Signal cell (e.g. "key #7,10 · major" +
// "3/3 agree") was one of the widest columns in the whole table because
// .edge-extras (shared with Board's inline Edge/Pick column) laid badges
// out side-by-side. Scoped to .signal-td specifically -- Board's usage
// of the same .edge-extras class (sitting inline next to a team name +
// pill, not in its own column) intentionally keeps the horizontal layout.
check(".signal-td .edge-extras stacks vertically (flex-direction:column), narrowing the column",
  /\.signal-td \.edge-extras\{flex-direction:column;align-items:flex-start;gap:4px;\}/.test(html));
check("the vertical-stack override is scoped to .signal-td specifically, not a change to the base .edge-extras rule itself (which would have also affected Board's inline Edge/Pick column)",
  (() => {
    const base = html.match(/\.edge-extras\{display:flex;gap:8px;margin-top:3px;flex-wrap:wrap;\}/);
    return base && !/flex-direction/.test(base[0]);
  })());

// --- Top Opportunities: 5 cards instead of 3, bigger logos ---------------
check("Top Opportunities slices the top 5 ranked games, not 3",
  /ranked\.slice\(0,5\)\.map\(\(r,idx\)=>\{/.test(board));
check("the old top-3 slice is gone, not just a second slice(0,5) added alongside it",
  !/ranked\.slice\(0,3\)/.test(board));
check(".opp-grid's grid-template-columns are 5 EQUAL tracks now, not the earlier 1.5fr-featured + 4x-1fr layout -- second-pass feedback: card #1 shouldn't be physically bigger, only visually flagged via the green highlight",
  /\.opp-grid\{display:grid;grid-template-columns:repeat\(5,1fr\);gap:12px;align-items:start;\}/.test(html));
check("the OLD asymmetric 1.5fr-plus-4x-1fr column layout is gone from the file, not left alongside the new one",
  !/grid-template-columns:1\.5fr 1fr 1fr 1fr 1fr/.test(html));
check("mobile still collapses the grid to a single column regardless of card count -- untouched by the 3->5 change",
  /@media \(max-width:760px\)\{\.opp-grid\{grid-template-columns:1fr;\}\}/.test(html));
check("Top Opportunities logos use their OWN class (.opp-logo), not the shared .teampick-logo -- same reasoning as Quick Look's .bet-logo, bumping the shared class would have also resized Board's compact pill buttons",
  /const logoHTML=logo\?`<span class="opp-logo">/.test(board));
check(".opp-logo uses the same padded-circular-badge treatment as .bet-logo/Board's .logo-badge (wrapping <span> + inset <img>, not a bare img with border-radius:50%) so a square/rectangular logo's corners don't get clipped by the circle",
  /\.opp-logo\{display:flex;align-items:center;justify-content:center;\s*\n\s*width:30px;height:30px;box-sizing:border-box;flex:none;overflow:hidden;\s*\n\s*background:#fff;border:1px solid var\(--line\);border-radius:50%;padding:4px;\}/.test(html));
check(".opp-logo img fills the padded frame via object-fit:contain",
  /\.opp-logo img\{width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;\}/.test(html));
check(".opp-logo is meaningfully bigger than the shared .teampick-logo (18px)",
  (() => {
    const m = html.match(/\.opp-logo\{display:flex;align-items:center;justify-content:center;\s*\n\s*width:(\d+)px;height:(\d+)px;/);
    return m && Number(m[1]) > 18 && Number(m[2]) > 18;
  })());
check("cards 2-5 no longer get a smaller logo than the featured card -- that not(.rank-1) override is gone, matching the same 'no size differentiation, only the green highlight' feedback",
  !/\.opp-card:not\(\.rank-1\) \.opp-logo/.test(html));
check("cards 2-5 no longer get smaller padding/team-name/stat-value type than the featured card either -- confirms the WHOLE not(.rank-1) size-downgrade block is gone, not just the logo piece of it",
  !/\.opp-card:not\(\.rank-1\)\{padding:12px;\}/.test(html) && !/\.opp-card:not\(\.rank-1\) \.opp-team\{font-size:15px;\}/.test(html) && !/\.opp-card:not\(\.rank-1\) \.opp-stat-val\.edge-hero\{font-size:21px;\}/.test(html));
check("rank-1's ONLY remaining distinguishing style is the green highlight (border-color/border-width/background) -- no size-based differentiation left anywhere",
  /\.opp-card\.rank-1\{border-color:var\(--green\);border-width:1\.5px;background:var\(--green-fill\);\}/.test(html));

// --- Hardening: "logos are massive now" follow-up report -----------------
// A real report of the badges rendering at full/natural image size,
// overflowing the card entirely -- reproduced only with a large-viewbox
// SVG (my original test used a tiny 40x40 one, which masked it).
// width:100%/height:100% + object-fit:contain on the img SHOULD already
// constrain any source image regardless of its natural size, and did in
// every repro tried here (even a 2000x2000 source clipped correctly) --
// but since the exact failure couldn't be reproduced directly, the fix
// adds a hard, unconditional clip (overflow:hidden on the wrapper +
// max-width/max-height:100% on the img) so the badge physically cannot
// render larger than its own box regardless of source image quirks,
// rather than relying solely on object-fit behaving correctly everywhere.
// Applied to both .opp-logo and .bet-logo (same shared risk), plus
// Board's original .logo-badge this pattern was copied from, even though
// that one wasn't reported broken -- consistency, and the fix is free.
check(".opp-logo has overflow:hidden as a hard clip guarantee, not relying solely on object-fit",
  /\.opp-logo\{[^}]*overflow:hidden;/.test(html));
check(".bet-logo ALSO has overflow:hidden (same shared risk as .opp-logo -- both wrap an <img> the same way)",
  /\.bet-logo\{[^}]*overflow:hidden;/.test(html));
check("Board's original .logo-badge (the pattern .opp-logo/.bet-logo were copied from) got the same overflow:hidden hardening for consistency, even though it wasn't the one reported broken",
  /\.board \.logo-badge\{[\s\S]{0,200}overflow:hidden;/.test(html));

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
