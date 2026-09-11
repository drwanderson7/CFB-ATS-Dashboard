"""
Runtime tests for api/parse_pool.py's parsing logic -- executed, not just
syntax-checked, per this project's established pattern. Run with:

    python3 tests/test_pool_parsing.py

This is the first dedicated coverage for parse_splash()/parse_espn()/
detect_source() themselves -- the existing parse_pool tests (test_error_shapes,
test_rate_limits, test_auth_sync, test_no_raw_exceptions_in_500s) only cover
the shared api/*.py conventions (401/500 shapes, rate limiting, auth), never
the actual per-source parsing.

IMPORTANT CAVEAT on the ESPN cases: the "lines" fixtures below are a
best-effort hand-built approximation of what app/js/pool-contexts.js's
extractPdfTextLines() (real browser pdf.js, row-sorted top-to-bottom then
left-to-right) would produce from a real ESPN College Pick'em PDF export.
ESPN's page is genuinely two-column (picks + a prizes/related-games/legal
sidebar), unlike Splash's single column that this same extraction approach
was already confirmed against. This file proves parse_espn()'s logic is
correct against a plausible input shape -- it does NOT prove real pdf.js
output looks like this. See parse_pool.py's module docstring and
NEW_SESSION_START_HERE.md rule #2/#6: "logic verified, live unverified"
until Drew imports a real ESPN sheet through the running app.
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

spec = importlib.util.spec_from_file_location("parse_pool", os.path.join(ROOT, "api", "parse_pool.py"))
parse_pool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parse_pool)

failures = []
total_checks = [0]


def check(name, cond):
    total_checks[0] += 1
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        failures.append(name)


# ---------------------------------------------------------------------------
# detect_source()
# ---------------------------------------------------------------------------
SPLASH_SAMPLE = [
    "Thu, Sep 3 • 5:00 PM   Preview",
    "Wisconsin(-3.5)",
    "(0-0-0)",
    "Alabama(3.5)",
    "(0-0-0)",
    "0/7 picks made",
]
ESPN_SAMPLE = [
    "SAT 9/5 • LOCKS @ 11:00 AM",
    "Who will win this matchup against the spread?",
    "+23.5",
    "-23.5",
    "Ohio Bobcats",
    "Nebraska Cornhuskers",
    "0-0",
    "0-0",
    "36% Picked",
    "64% Picked",
    "Preview • Spread Info FS1",
    "0/10 Picks Made",
]

check("detect_source(): Splash sample -> splash", parse_pool.detect_source(SPLASH_SAMPLE) == "splash")
check("detect_source(): ESPN sample -> espn", parse_pool.detect_source(ESPN_SAMPLE) == "espn")
check(
    "detect_source(): ESPN's own 'Picks Made' footer doesn't false-match Splash",
    parse_pool.detect_source(ESPN_SAMPLE) != "splash",
)

# ---------------------------------------------------------------------------
# parse_splash() -- regression coverage for previously-untested logic
# ---------------------------------------------------------------------------
splash_res = parse_pool.parse_splash(SPLASH_SAMPLE, 2026)
check("parse_splash(): source is splash", splash_res["source"] == "splash")
check("parse_splash(): pickLimit from '0/7 picks made'", splash_res["pickLimit"] == 7)
check("parse_splash(): finds 1 game", splash_res["count"] == 1)
if splash_res["count"] == 1:
    g = splash_res["games"][0]
    check("parse_splash(): away team", g["away"] == "Wisconsin")
    check("parse_splash(): home team", g["home"] == "Alabama")
    check("parse_splash(): home-perspective line", g["line"] == 3.5)
    check("parse_splash(): awaySpread", g["awaySpread"] == -3.5)
    check("parse_splash(): commence", g["commence"] == "2026-09-03T17:00:00")

# TBD (pre-lock) spread -> line is None, not a crash
splash_tbd = parse_pool.parse_splash([
    "Thu, Sep 3 • 5:00 PM   Preview",
    "Wisconsin(TBD)",
    "(0-0-0)",
    "Alabama(TBD)",
    "(0-0-0)",
], 2026)
check("parse_splash(): pre-lock TBD -> line is None", splash_tbd["games"] and splash_tbd["games"][0]["line"] is None)

# ---------------------------------------------------------------------------
# parse_splash() -- LEADING format (spread BEFORE team name, e.g.
# "(-3.5)Wisconsin" rather than "Wisconsin(-3.5)"). Found Aug 26 against a
# real Drew-uploaded Week-1 2026 Splash PDF ("Edit picks" screen, entry with
# ranked opponents): pdf.js's x-position ordering put the spread badge to
# the LEFT of the team name on that real export, the opposite of the
# TRAILING sample above (also real, just a different export/screen). Before
# this fix TEAM_RE only recognized TRAILING, so EVERY team line in that real
# PDF failed to match, parse_splash() found zero games, and the request came
# back a hard 500 ("Couldn't find any games") -- reproduced exactly via
# tests/_live_cas_concurrency_test.py-style direct reproduction before the
# fix, using the ACTUAL pdf.js output for that file (see
# REAL_SPLASH_WK1_PRELIM_SAMPLE below for the real end-to-end case).
# ---------------------------------------------------------------------------
splash_leading = parse_pool.parse_splash([
    "Thu, Sep 3 • 5:00 PM   Preview",
    "(-3.5)Wisconsin",
    "(0-0-0)",
    "(3.5)Alabama",
    "(0-0-0)",
    "0/7 picks made",
], 2026)
check("parse_splash() LEADING: finds 1 game", splash_leading["count"] == 1)
if splash_leading["count"] == 1:
    g = splash_leading["games"][0]
    check("parse_splash() LEADING: away team", g["away"] == "Wisconsin")
    check("parse_splash() LEADING: home team", g["home"] == "Alabama")
    check("parse_splash() LEADING: home-perspective line", g["line"] == 3.5)

# Ranked team, rank badge floating on its OWN preceding line (no team name
# attached to it at all) -- must be silently skipped, not mistaken for a
# spread-only team line, and must not pollute the following team's name.
splash_ranked_floating = parse_pool.parse_splash([
    "Fri, Sep 4 • 7:00 PM   Preview",
    "(+41.5)UTEP",
    "(0-0-0)",
    "(10)",
    "(-41.5)Oklahoma",
    "(0-0-0)",
], 2026)
check("parse_splash() LEADING ranked (floating rank line): finds 1 game", splash_ranked_floating["count"] == 1)
if splash_ranked_floating["count"] == 1:
    check(
        "parse_splash() LEADING ranked (floating rank line): home name has no rank pollution",
        splash_ranked_floating["games"][0]["home"] == "Oklahoma",
    )

# Ranked team, rank badge GLUED onto the same line as the spread+name
# (the other real shape seen -- pdf.js's gap clustering doesn't always
# split them). Must still strip the rank and keep the team name clean.
splash_ranked_glued = parse_pool.parse_splash([
    "Sat, Sep 5 • 2:30 PM   Preview",
    "(+30.5)Texas State",
    "(0-0-0)",
    "(5) (-30.5)Texas",
    "(0-0-0)",
], 2026)
check("parse_splash() LEADING ranked (glued rank prefix): finds 1 game", splash_ranked_glued["count"] == 1)
if splash_ranked_glued["count"] == 1:
    check(
        "parse_splash() LEADING ranked (glued rank prefix): home name has no rank pollution",
        splash_ranked_glued["games"][0]["home"] == "Texas",
    )

# A team name that itself contains real parens ("Miami (FL)") must not be
# confused with the leading rank/spread markers -- those are anchored to
# the START of the line only, so parens later in the name pass through
# untouched as part of the captured name.
splash_name_with_parens = parse_pool.parse_splash([
    "Fri, Sep 4 • 8:00 PM   Preview",
    "(-23.5)Miami (FL)",
    "(0-0-0)",
    "(+23.5)Stanford",
    "(0-0-0)",
], 2026)
check("parse_splash() LEADING, team name contains real parens: finds 1 game", splash_name_with_parens["count"] == 1)
if splash_name_with_parens["count"] == 1:
    check(
        "parse_splash() LEADING, team name contains real parens: name preserved exactly",
        splash_name_with_parens["games"][0]["away"] == "Miami (FL)",
    )

# ---------------------------------------------------------------------------
# Full real-world regression: the EXACT lines app/js/pool-contexts.js's
# extractPdfTextLines() (real pdf.js, self-hosted, same build as production)
# produced from Drew's actual Splash_CFB_Wk_1_Preliminary.pdf (Aug 26,
# 2026) -- captured via a Playwright harness that loaded the real vendored
# pdf.js and ran the real extraction function against the real file, not
# hand-typed. This is the strongest regression guard available for this
# bug: if a future change to TEAM_RE/TEAM_RE_LEADING/TEAM_RE_TRAILING ever
# breaks this shape again, this fails immediately instead of waiting for
# another live import to hit it.
# ---------------------------------------------------------------------------
REAL_SPLASH_WK1_PRELIM_SAMPLE = [
    'Edit picks',
    'Entry 2',
    'Segment 1',
    'Week 1',
    'Week 2',
    'Sep 3-7',
    'Sep 11-12',
    '\uedd9',
    'Spread locks: Wed, 11:00 AM | Picks lock: At the',
    'Thu, Sep 3 • 5:00 PM',
    '(+29.5)UMass',
    '(0-0-0)',
    '(-29.5)Rutgers',
    '(0-0-0)',
    'Thu, Sep 3 • 6:00 PM',
    '(+23.5)Akron',
    '(0-0-0)',
    '(-23.5)Wake Forest',
    '(0-0-0)',
    'Thu, Sep 3 • 7:00 PM',
    '(+6.5)Colorado',
    '(0-0-0)',
    '(-6.5)Georgia Tech',
    '(0-0-0)',
    'Thu, Sep 3 • 8:00 PM',
    '(+28.5)UAB',
    '(0-0-0)',
    '0/7 picks madeOpt-Out Honored',
    '(-28.5)Illinois',
    '(0-0-0)',
    'Fri, Sep 4 • 5:30 PM',
    '(+4.5)San Jose State',
    '(0-0-0)',
    '(-4.5)Eastern Michig…',
    '(0-0-0)',
    'Fri, Sep 4 • 7:00 PM',
    '(+41.5)UTEP',
    '(0-0-0)',
    '(10)',
    '(-41.5)Oklahoma',
    '(0-0-0)',
    'Fri, Sep 4 • 7:00 PM',
    '(+10.5)Toledo',
    '(0-0-0)',
    '(-10.5)Michigan State',
    '(0-0-0)',
    'Fri, Sep 4 • 8:00 PM',
    '(+23.5)Fresno State',
    '(0-0-0)',
    '(14) (-23.5)USC',
    '(0-0-0)',
    '0/7 picks madeOpt-Out Honored',
    'Fri, Sep 4 • 8:00 PM',
    '(7)',
    '(-23.5)Miami (FL)',
    '(0-0-0)',
    '(+23.5)Stanford',
    '(0-0-0)',
    'Sat, Sep 5 • 11:00 AM',
    '(+40.5)North Texas',
    '(0-0-0)',
    '(6)',
    '(-40.5)Indiana',
    '(0-0-0)',
    'Sat, Sep 5 • 11:00 AM',
    '(+21.5)Coastal Carolina',
    '(0-0-0)',
    '(-21.5)West Virginia',
    '(0-0-0)',
    'Sat, Sep 5 • 11:00 AM',
    '(+24.5)Ohio',
    '(0-0-0)',
    '(-24.5)Nebraska',
    '(0-0-0)',
    'Sat, Sep 5 • 11:00 AM',
    '(+20.5)Oregon State',
    '(0-0-0)',
    '0/7 picks madeOpt-Out Honored',
    '(23)',
    '(-20.5)Houston',
    '(0-0-0)',
    'Sat, Sep 5 • 11:00 AM',
    '(+28.5)East Carolina',
    '(0-0-0)',
    '(13)',
    '(-28.5)Alabama',
    '(0-0-0)',
    'Sat, Sep 5 • 11:00 AM',
    '(+6.5)Liberty',
    '(0-0-0)',
    '(-6.5)James Madison',
    '(0-0-0)',
    'Sat, Sep 5 • 11:30 AM',
    '(+16.5)Miami (OH)',
    '(0-0-0)',
    '(-16.5)Pittsburgh',
    '(0-0-0)',
    'Sat, Sep 5 • 11:30 AM',
    '(+50.5)Ball State',
    '(0-0-0)',
    '(1)',
    '(-50.5)Ohio State',
    '(0-0-0)',
    '0/7 picks madeOpt-Out Honored',
    'Sat, Sep 5 • 11:45 AM',
    '(+36.5)Kent State',
    '(0-0-0)',
    '(-36.5)South Carolina',
    '(0-0-0)',
    'Sat, Sep 5 • 2:30 PM',
    '(+24.5)Marshall',
    '(0-0-0)',
    '(18)',
    '(-24.5)Penn State',
    '(0-0-0)',
    'Sat, Sep 5 • 2:30 PM',
    '(+7.5)Boston College',
    '(0-0-0)',
    '(-7.5)Cincinnati',
    '(0-0-0)',
    'Sat, Sep 5 • 2:30 PM',
    '(+30.5)Texas State',
    '(0-0-0)',
    '(5) (-30.5)Texas',
    '(0-0-0)',
    'Sat, Sep 5 • 2:30 PM',
    '(+24.5)Boise State',
    '(0-0-0)',
    '0/7 picks madeOpt-Out Honored',
    '(2) (-24.5)Oregon',
    '(0-0-0)',
    'Sat, Sep 5 • 2:30 PM',
    '(+9.5)Tulane',
    '(0-0-0)',
    '(-9.5)Duke',
    '(0-0-0)',
    'Sat, Sep 5 • 2:30 PM',
    '(+7.5)Baylor',
    '(0-0-0)',
    '(-7.5)Auburn',
    '(0-0-0)',
    'Sat, Sep 5 • 2:45 PM',
    '(-14.5)Oklahoma State',
    '(0-0-0)',
    '(+14.5)Tulsa',
    '(0-0-0)',
    'Sat, Sep 5 • 3:15 PM',
    '(+31.5)Northern Illinois',
    '(0-0-0)',
    '(22) (-31.5)Iowa',
    '(0-0-0)',
    '0/7 picks madeOpt-Out Honored',
    'Sat, Sep 5 • 5:00 PM',
    '(+3.5)Wyoming',
    '(0-0-0)',
    '(-3.5)Colorado State',
    '(0-0-0)',
    'Sat, Sep 5 • 6:00 PM',
    '(+13.5)Florida Interna…',
    '(0-0-0)',
    '(-13.5)South Florida',
    '(0-0-0)',
    'Sat, Sep 5 • 6:00 PM',
    '(+16.5)Sam Houston',
    '(0-0-0)',
    '(-16.5)Troy',
    '(0-0-0)',
    'Sat, Sep 5 • 6:00 PM',
    '(+40.5)Missouri State',
    '(0-0-0)',
    '(8)',
    '(-40.5)Texas A&M',
    '(0-0-0)',
    'Sat, Sep 5 • 6:00 PM',
    '(+8.5)Arkansas State',
    '(0-0-0)',
    '0/7 picks madeOpt-Out Honored',
    '(-8.5)Memphis',
    '(0-0-0)',
    'Sat, Sep 5 • 6:30 PM',
    '(+10.5)Clemson',
    '(0-0-0)',
    '(11) (-10.5)LSU',
    '(0-0-0)',
    'Sat, Sep 5 • 6:30 PM',
    '(+29.5)Louisiana-Mon…',
    '(0-0-0)',
    '(-29.5)Mississippi St…',
    '(0-0-0)',
    'Sat, Sep 5 • 6:30 PM',
    '(+27.5)Western Michi…',
    '(0-0-0)',
    '(16)',
    '(-27.5)Michigan',
    '(0-0-0)',
    'Sat, Sep 5 • 6:45 PM',
    '(+26.5)Florida Atlantic',
    '(0-0-0)',
    '(-26.5)Florida',
    '(0-0-0)',
    '0/7 picks madeOpt-Out Honored',
    'Sat, Sep 5 • 9:00 PM',
    '(+11.5)Central Michig…',
    '(0-0-0)',
    '(-11.5)New Mexico',
    '(0-0-0)',
    'Sat, Sep 5 • 9:00 PM',
    '(-2.5)UNLV',
    '(0-0-0)',
    "(+2.5)Hawai'i",
    '(0-0-0)',
    'Sat, Sep 5 • 9:30 PM',
    '(-1.5)UCLA',
    '(0-0-0)',
    '(+1.5)California',
    '(0-0-0)',
    'Sat, Sep 5 • 9:30 PM',
    '(-2.5)Western Kentu…',
    '(0-0-0)',
    '(+2.5)Nevada',
    '(0-0-0)',
    'Sun, Sep 6 • 3:00 PM',
    '(+22.5)Washington St…',
    '(0-0-0)',
    '0/7 picks madeOpt-Out Honored',
    '(17)',
    '(-22.5)Washington',
    '(0-0-0)',
    'Sun, Sep 6 • 6:30 PM',
    '(+20.5)Wisconsin',
    '(0-0-0)',
    '(4)',
    '(-20.5)Notre Dame',
    '(0-0-0)',
    'Sun, Sep 6 • 6:30 PM',
    '(24)',
    '(+6.5)Louisville',
    '(0-0-0)',
    '(9)',
    '(-6.5)Ole Miss',
    '(0-0-0)',
    'Mon, Sep 7 • 6:30 PM',
    '(19) (-2.5)SMU',
    '(0-0-0)',
    '(+2.5)Florida State',
    '(0-0-0)',
    '0/7 picks madeOpt-Out Honored',
]
real_pdf_res = parse_pool.parse_pool_lines(REAL_SPLASH_WK1_PRELIM_SAMPLE, 2026)
check("real Splash Wk1 preliminary PDF: does not raise, finds all 43 games", real_pdf_res["count"] == 43)
check("real Splash Wk1 preliminary PDF: pickLimit is 7", real_pdf_res["pickLimit"] == 7)
real_games_by_pair = {(g["away"], g["home"]): g for g in real_pdf_res["games"]}
check(
    "real Splash Wk1 preliminary PDF: UMass/Rutgers sign convention matches the real sheet (Rutgers -29.5 home favorite)",
    real_games_by_pair.get(("UMass", "Rutgers"), {}).get("line") == -29.5,
)
check(
    "real Splash Wk1 preliminary PDF: Miami (FL)/Stanford -- name-with-parens AND away-favorite sign convention both correct",
    real_games_by_pair.get(("Miami (FL)", "Stanford"), {}).get("line") == 23.5,
)
check(
    "real Splash Wk1 preliminary PDF: ranked team Oklahoma's name has no rank-badge pollution",
    real_games_by_pair.get(("UTEP", "Oklahoma"), {}).get("home") == "Oklahoma",
)
check(
    "real Splash Wk1 preliminary PDF: ranked team Ohio State (biggest spread in the sheet, -50.5) parses correctly",
    real_games_by_pair.get(("Ball State", "Ohio State"), {}).get("line") == -50.5,
)

# ---------------------------------------------------------------------------
# parse_espn() -- clean single-column ordering (best case)
# ---------------------------------------------------------------------------
espn_res = parse_pool.parse_espn(ESPN_SAMPLE, 2026)
check("parse_espn(): source is espn", espn_res["source"] == "espn")
check("parse_espn(): pickLimit from '0/10 Picks Made'", espn_res["pickLimit"] == 10)
check("parse_espn(): finds 1 game", espn_res["count"] == 1)
if espn_res["count"] == 1:
    g = espn_res["games"][0]
    check("parse_espn(): away team", g["away"] == "Ohio Bobcats")
    check("parse_espn(): home team", g["home"] == "Nebraska Cornhuskers")
    check("parse_espn(): home-perspective line", g["line"] == -23.5)
    check("parse_espn(): awaySpread", g["awaySpread"] == 23.5)
    check("parse_espn(): commence (numeric month/day)", g["commence"] == "2026-09-05T11:00:00")

# Ranked team ("#13Alabama Crimson Tide", no space in the real export) ->
# rank prefix stripped.
espn_ranked = parse_pool.parse_espn([
    "SAT 9/5 • LOCKS @ 12:00 PM",
    "Who will win this matchup against the spread?",
    "+25.5",
    "-25.5",
    "East Carolina Pirates",
    "#13Alabama Crimson Tide",
    "0-0",
    "0-0",
    "16% Picked",
    "84% Picked",
], 2026)
check(
    "parse_espn(): rank prefix stripped from ranked team",
    espn_ranked["games"] and espn_ranked["games"][0]["home"] == "Alabama Crimson Tide",
)

# Multiple games in one document, with a stray UI-chrome line ("0/10 Picks
# Made" / "Submit Your Picks" -- ESPN's sticky footer bar, seen landing mid-
# block at a page boundary in the real Week 1 sample) sitting between the
# spread pair and the name pair -- must not be mistaken for a team name.
espn_multi = parse_pool.parse_espn([
    "SAT 9/5 • LOCKS @ 11:00 AM",
    "Who will win this matchup against the spread?",
    "+23.5",
    "-23.5",
    "Ohio Bobcats",
    "Nebraska Cornhuskers",
    "0-0",
    "0-0",
    "36% Picked",
    "64% Picked",
    "Preview • Spread Info FS1",
    "SAT 9/5 • LOCKS @ 2:45 PM",
    "Who will win this matchup against the spread?",
    "+18.5",
    "-18.5",
    "0/10 Picks Made",
    "Submit Your Picks",
    "Oregon State Beavers",
    "#23Houston Cougars",
    "0-0",
    "0-0",
], 2026)
check("parse_espn(): multi-game document finds both games", espn_multi["count"] == 2)
if espn_multi["count"] == 2:
    check("parse_espn(): 2nd game away (UI chrome line skipped, not mistaken for a name)", espn_multi["games"][1]["away"] == "Oregon State Beavers")
    check("parse_espn(): 2nd game home, rank stripped", espn_multi["games"][1]["home"] == "Houston Cougars")

# Tiebreaker block is skipped, not parsed as a fake game, and doesn't corrupt
# whatever comes after it.
espn_tiebreak = parse_pool.parse_espn([
    "SAT 9/5 • LOCKS @ 6:30 PM",
    "Who will win this matchup against the spread?",
    "+10.5",
    "-10.5",
    "Clemson Tigers",
    "#11LSU Tigers",
    "0-0",
    "0-0",
    "46% Picked",
    "54% Picked",
    "TIEBREAKER • SAT 9/5 • LOCKS @ 6:30 PM",
    "How many total points will be scored in LSU v. Clemson?",
    "Type Answer Here",
], 2026)
check("parse_espn(): tiebreaker line doesn't create a phantom game", espn_tiebreak["count"] == 1)
check("parse_espn(): tiebreaker's own game (Clemson/LSU) still parsed", espn_tiebreak["games"] and espn_tiebreak["games"][0]["away"] == "Clemson Tigers")

# PK (pick'em, no favorite) -> spread of 0.0, not dropped/crashed
espn_pk = parse_pool.parse_espn([
    "SAT 9/5 • LOCKS @ 3:00 PM",
    "Who will win this matchup against the spread?",
    "PK",
    "PK",
    "Team A",
    "Team B",
    "0-0",
    "0-0",
    "50% Picked",
    "50% Picked",
], 2026)
check("parse_espn(): PK spread parses as 0.0", espn_pk["games"] and espn_pk["games"][0]["line"] == 0.0)

# Sidebar-noise guard: text sitting outside any "LOCKS @" section (e.g. the
# right-column prize/related-games text) must not be treated as a game.
espn_with_noise = parse_pool.parse_espn([
    "Welcome back to College Pick'em!",
    "Total Prizes",
    "$86,000",
    "SAT 9/5 • LOCKS @ 11:00 AM",
    "Who will win this matchup against the spread?",
    "+23.5",
    "-23.5",
    "Ohio Bobcats",
    "Nebraska Cornhuskers",
    "0-0",
    "0-0",
    "36% Picked",
    "64% Picked",
], 2026)
check("parse_espn(): leading sidebar noise doesn't create a phantom game", espn_with_noise["count"] == 1)

# ---------------------------------------------------------------------------
# parse_espn_paste() -- plain-text copy-paste from the live ESPN page
# (strictly sequential [name, spread, record, picked%] per team, away then
# home -- confirmed against a real Week 1 2026 paste). No headers, no
# sidebar, no kickoff time at all.
# ---------------------------------------------------------------------------
ESPN_PASTE_SAMPLE = [
    "Ohio", "+23.5", "0-0", "36% Picked",
    "Nebraska", "-23.5", "0-0", "64% Picked",
    "East Carolina", "+25.5", "0-0", "16% Picked",
    "#13Alabama", "-25.5", "0-0", "84% Picked",
]
paste_res = parse_pool.parse_espn_paste(ESPN_PASTE_SAMPLE, 2026)
check("parse_espn_paste(): finds 2 games", paste_res["count"] == 2)
if paste_res["count"] == 2:
    check("parse_espn_paste(): game 1 away/home", paste_res["games"][0]["away"] == "Ohio" and paste_res["games"][0]["home"] == "Nebraska")
    check("parse_espn_paste(): game 1 line", paste_res["games"][0]["line"] == -23.5)
    check("parse_espn_paste(): game 2 rank prefix stripped", paste_res["games"][1]["home"] == "Alabama")
    check("parse_espn_paste(): commence is always None (no kickoff time in a plain paste)", paste_res["games"][0]["commence"] is None)

check(
    "parse_pool_lines(): format_hint='espn_paste' bypasses detect_source() entirely",
    parse_pool.parse_pool_lines(ESPN_PASTE_SAMPLE, 2026, format_hint="espn_paste")["source"] == "espn",
)


# ---------------------------------------------------------------------------
# parse_splash() -- second real export shape ("pick every game" / confidence-
# style Splash pool template, distinct from the pick-7 "Edit picks" template
# REAL_SPLASH_WK1_PRELIM_SAMPLE above covers). Confirmed via a real Playwright
# browser run of the ACTUAL vendored app/vendor/pdfjs/* build's real
# extractPdfTextLines() (app/js/pool-contexts.js) against a real Madwood
# Week-1 2026 export -- not hand-typed, not a pdfplumber approximation (an
# initial pdfplumber-based simulation was tried first and its coordinate
# gaps turned out NOT to match real pdf.js behavior on this file -- see
# HDR_RE/TEAM_RE_GLUED's own comments in parse_pool.py for what that
# simulation got wrong before this real capture replaced it). This is the
# same "logic verified against the real thing, not memory" standard the
# original REAL_SPLASH_WK1_PRELIM_SAMPLE was held to.
#
# Distinguishing real shape confirmed here: the away/home spread glues
# directly onto the team name with ZERO separator ("+6.5Colorado",
# "-6.5Georgia Tech" -- no parens, no space), unlike either paren-based shape
# above. The header line's leading spread badge and trailing away-team
# abbreviation land inconsistently (sometimes glued onto the same line as
# the weekday/date/time text, sometimes stranded on an unrelated adjacent
# junk line), which is why HDR_RE moved from an anchored .match() to a
# .search() -- see that regex's own comment in parse_pool.py.
# ---------------------------------------------------------------------------
REAL_MADWOOD_WK1_PRELIM_SAMPLE = [
    'Make picks',
    'Entry 1',
    'Week 1',
    'Week 2',
    'Sep 3 - Sep 7',
    'Sep 11 - Sep 12Sep 18 - Sep 19Sep 21 - Sep',
    '\uedd9',
    'Picks lock: Mon, Sep 7, 2026, 6:30 PM Spreads lock: Tue, Sep 1, 2026, 12:00',
    'Make your picks',
    'Thursday, Sep 3',
    '+6.5 Thu, Sep 3 • 7:00 PM COLO',
    'Winner',
    '+6.5Colorado',
    '-6.5Georgia Tech',
    'No picks',
    '+28.5 Thu, Sep 3 • 8:00 PM UAB',
    'Winner',
    '+28.5UAB',
    '-28.5Illinois',
    'No picks',
    'Friday, Sep 4',
    '—0/25+41.5',
    'Fri, Sep 4 • 7:00 PM UTEP',
    'TiebreakerOpt-Out HonoredPicks',
    'Winner',
    '+41.5UTEP',
    '-41.5Oklahoma',
    'No picks',
    '+10.5 Fri, Sep 4 • 7:00 PM TOL',
    'Winner',
    '+10.5Toledo',
    '-10.5Michigan State',
    'No picks',
    '+23.5 Fri, Sep 4 • 8:00 PM FRES',
    'Winner',
    '+23.5Fresno State',
    '-23.5USC',
    'No picks',
    '-23.5 Fri, Sep 4 • 8:00 PM MIA',
    '#7',
    'Winner',
    '-23.5Miami (FL)',
    '0/25',
    'Opt-Out HonoredPicks',
    '+23.5Stanford',
    'No picks',
    'Saturday, Sep 5',
    '+40.5 Sat, Sep 5 • 11:00 AM UNT',
    'Winner',
    '+40.5North Texas',
    '-40.5Indiana',
    'No picks',
    '+28.5 Sat, Sep 5 • 11:00 AM ECU',
    'Winner',
    '+28.5East Carolina',
    '-28.5Alabama',
    'No picks',
    '+50.5 Sat, Sep 5 • 11:30 AM BALL',
    'Winner',
    '+50.5Ball State',
    '-50.5Ohio State',
    '0/25',
    'No picks',
    'Opt-Out HonoredPicks',
    '+36.5 Sat, Sep 5 • 11:45 AM KENT',
    'Winner',
    '+36.5Kent State',
    '-36.5South Carolina',
    'No picks',
    '+24.5 Sat, Sep 5 • 2:30 PM MRSH',
    'Winner',
    '+24.5Marshall',
    '-24.5Penn State',
    'No picks',
    '+24.5 Sat, Sep 5 • 2:30 PM BSU',
    'Winner',
    '+24.5Boise State',
    '-24.5Oregon',
    'No picks',
    '+9.5 Sat, Sep 5 • 2:30 PM TULN',
    '0/25',
    'Opt-Out HonoredPicksWinner',
    '+9.5Tulane',
    '-9.5Duke',
    'No picks',
    '+7.5 Sat, Sep 5 • 2:30 PM BAY',
    'Winner',
    '+7.5Baylor',
    '-7.5Auburn',
    'No picks',
    '+16.5 Sat, Sep 5 • 6:00 PM SHSU',
    'Winner',
    '+16.5Sam Houston',
    '-16.5Troy',
    'No picks',
    '+10.5 Sat, Sep 5 • 6:30 PM CLEM',
    'Winner',
    '+10.5Clemson',
    '-10.5LSU',
    '0/25',
    'Opt-Out HonoredPicks',
    'No picks',
    '+29.5 Sat, Sep 5 • 6:30 PM ULM',
    'Winner',
    '+29.5Louisiana-Monroe',
    '-29.5Mississippi State',
    'No picks',
    '+27.5 Sat, Sep 5 • 6:30 PM WMU',
    'Winner',
    '+27.5Western Michigan',
    '-27.5Michigan',
    'No picks',
    '+26.5 Sat, Sep 5 • 6:45 PM FAU',
    'Winner',
    '+26.5Florida Atlantic',
    '-26.5Florida',
    'No picks',
    '0/25',
    '-1.5 Sat, Sep 5 • 9:30 PM Opt-Out HonoredPicksUCLA',
    'Winner',
    '-1.5UCLA',
    '+1.5California',
    'No picks',
    '-2.5 Sat, Sep 5 • 9:30 PM WKU',
    'Winner',
    '-2.5Western Kentucky',
    '+2.5Nevada',
    'No picks',
    'Sunday, Sep 6',
    '+23.5 Sun, Sep 6 • 3:00 PM WSU',
    'Winner',
    '+23.5Washington State',
    '-23.5Washington',
    'No picks',
    '+20.5 Sun, Sep 6 • 6:30 PM WIS',
    'Winner',
    '0/25',
    'Opt-Out HonoredPicks',
    '+20.5Wisconsin',
    '-20.5Notre Dame',
    'No picks',
    '+6.5 Sun, Sep 6 • 6:30 PM LOU',
    '#24',
    'Winner',
    '+6.5Louisville',
    '-6.5Ole Miss',
    'No picks',
    'Monday, Sep 7',
    '-2.5 Mon, Sep 7 • 6:30 PM SMU',
    '#19',
    'Winner',
    '-2.5SMU',
    '+2.5Florida State',
    'No picks',
    'Tiebreaker',
    'Predict the total combined score. The entrant with the',
    'advantage.',
    'Mon, September 7',
    'SMU',
    'FSU',
    '6:30 PM',
    '0/25',
    'Combined Total Score',
    'Opt-Out HonoredPicks',
    '– –',
    'Enter a whole number from 0 to',
    'Example: if you think the final score will be 24-17, enter',
    'total score.',
    '0/25',
    'Opt-Out HonoredPicks',
]

madwood_res = parse_pool.parse_pool_lines(REAL_MADWOOD_WK1_PRELIM_SAMPLE, 2026)
check("real Madwood Wk1 preliminary PDF: detected as splash", parse_pool.detect_source(REAL_MADWOOD_WK1_PRELIM_SAMPLE) == "splash")
check("real Madwood Wk1 preliminary PDF: does not raise, finds all 25 games", madwood_res["count"] == 25)
check("real Madwood Wk1 preliminary PDF: pickLimit is 25 (from the bare '0/25' footer, no 'picks made' wording exists on this template)", madwood_res["pickLimit"] == 25)
madwood_games_by_pair = {(g["away"], g["home"]): g for g in madwood_res["games"]}
check(
    "real Madwood Wk1 preliminary PDF: Colorado/Georgia Tech sign convention (Georgia Tech -6.5 home favorite)",
    madwood_games_by_pair.get(("Colorado", "Georgia Tech"), {}).get("line") == -6.5,
)
check(
    "real Madwood Wk1 preliminary PDF: Miami (FL)/Stanford -- name-with-parens AND away-favorite sign convention both correct",
    madwood_games_by_pair.get(("Miami (FL)", "Stanford"), {}).get("line") == 23.5,
)
check(
    "real Madwood Wk1 preliminary PDF: a header line stranded without its own leading spread badge (Fri, Sep 4 UTEP @ Oklahoma) still gets a real kickoff time",
    madwood_games_by_pair.get(("UTEP", "Oklahoma"), {}).get("commence") == "2026-09-04T19:00:00",
)
check(
    "real Madwood Wk1 preliminary PDF: multi-word away team name glued to its spread parses cleanly (Louisiana-Monroe)",
    madwood_games_by_pair.get(("Louisiana-Monroe", "Mississippi State"), {}).get("line") == -29.5,
)
check(
    "real Madwood Wk1 preliminary PDF: last game of the sheet (Monday night, SMU/Florida State) still parses -- no truncation at end of input",
    madwood_games_by_pair.get(("SMU", "Florida State"), {}).get("line") == 2.5,
)

# ---------------------------------------------------------------------------
# TEAM_RE_GLUED -- unit-level checks, isolated from the full real sample
# above, so a future regex tweak that breaks one shape shows up precisely
# instead of just "some Madwood games went missing."
# ---------------------------------------------------------------------------
check("TEAM_RE_GLUED matches a real glued line", bool(parse_pool.TEAM_RE_GLUED.match("+6.5Colorado")))
check("TEAM_RE_GLUED requires a sign (rejects a bare unsigned number, e.g. tiebreaker instructional text ending in a number)", not parse_pool.TEAM_RE_GLUED.match("Enter a whole number from 0 to 200"))
check("TEAM_RE_GLUED does not match when a real space separates the number from following text (falls through to header handling instead)", not parse_pool.TEAM_RE_GLUED.match("-1.5 Sat, Sep 5 • 9:30 PM UCLA"))
check("TEAM_RE_GLUED does not match plain UI chrome with no leading sign", not parse_pool.TEAM_RE_GLUED.match("No picks"))


# ---------------------------------------------------------------------------
# parse_splash() -- THIRD real export shape ("Winner (ATS)" straight
# pick-em template, distinct from both the pick-7 "Edit picks" template
# REAL_MADWOOD_WK1_PRELIM_SAMPLE covers and the "pick every game"
# confidence-style template above). Confirmed via a real Playwright browser
# run of the ACTUAL vendored app/vendor/pdfjs/* build's real
# extractPdfTextLines() (app/js/pool-contexts.js) against the real Madwood
# Week-2 2026 export Drew reported as "only loading 1 game from the pdf" --
# same "logic verified against the real thing, not memory" standard as the
# two Madwood samples above.
#
# Two distinct real bugs were found and fixed against this one export:
#
# 1) pageText (extractPdfTextLines(), used to detect "is this a Splash
#    export at all") never collapsed the irregular multi-space runs pdf.js
#    produces (explicit space-only text items PLUS the join's own added
#    space -- "Make   bulk   picks", not "Make bulk picks"). The
#    strongSplashSignal regex requires literal single spaces, so it matched
#    on NO page of this real export -- isSplashPage stayed false everywhere,
#    and the code fell through to the ESPN-only 60%-width sidebar crop,
#    which silently deleted every home team/spread sitting past that cutoff
#    (confirmed: "Michigan" at x=404.8 on a 612pt page, well past the
#    367.2pt cutoff, vanished entirely -- only the away side of each
#    matchup survived).
#
# 2) parse_splash()'s game-boundary detection (HDR_RE, "Thu, Sep 3 * 5:00
#    PM") never matches this template's kickoff format at all -- pdf.js's
#    x-position ordering glues the date between the two team codes above it
#    ("OKLASat, Sep 12MICH") and interleaves the time with both teams'
#    records on the next row. With flush() never triggered mid-document,
#    every game's candidates piled into ONE pending list for the entire
#    28-game sheet, and only the first two entries ever collected (i.e.
#    exactly one game) made it into the final output. Flushing (and
#    resetting) pending on every "Winner" marker line -- not gated on
#    team_pickem, and not gated on len(pending)>=2 either, since a team
#    whose short code equals its own printed name (UCF, BYU, UAB, LSU, USC)
#    renders that side's spread with no name prefix at all, which can leave
#    pending stuck at a lone, unrecoverable 1 entry -- fixed the boundary
#    detection without depending on the kickoff header matching.
#
# KNOWN REMAINING GAP, not yet solved: the 5 games above where the HOME
# team's short code equals its own printed name (UCF, BYU, UAB, LSU, USC)
# lose that side's spread entirely (a bare "+7.5" with no name to attach it
# to) and are dropped rather than recovered -- 23 of the real 28 games
# parse correctly. Recovering those 5 would need parse_splash() restructured
# to correlate against the "UCFSat, Sep 12PITT"-style header row's own two
# team codes rather than relying solely on each side's own spread line
# carrying a name, a larger design change intentionally left for a
# follow-up rather than rushed into this fix.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Sept 11, 2026: the literal lines pdf.js actually extracts from the real
# Madwood_CFB_Wk_2.pdf, captured by porting extractPdfTextLines()/
# splashLaneLines() (app/js/pool-contexts.js) to Node and running it through
# the exact pdfjs-dist 3.11.174 the app vendors (app/vendor/pdfjs/pdf.min.js)
# against Drew's actual uploaded PDF -- not a hand-typed approximation. Used
# once, at the bottom of the Madwood Wk2 block below, specifically to catch
# any future case where the hand-typed REAL_MADWOOD_WK2_WINNER_ATS_SAMPLE
# fixture above has silently drifted from what pdf.js really produces (this
# turned out NOT to be the actual gap this session -- the two were already
# near character-for-character identical -- but the drift risk is real for
# ANY hand-maintained fixture, so keeping this real capture around as a
# cross-check is worth the ~250 extra lines).
REAL_MADWOOD_WK2_PDFJS_EXTRACTED_LINES = [
    'Make picks',
    'Entry 1',
    'Picks lock: Sat, Sep 12, 2026, 10:00 PM Make bulk picks Rules',
    'Make your picks',
    'Saturday, Sep 12 28 games',
    'OKLASat, Sep 12MICH',
    '1-011:00',
    'AM1-0',
    '#11',
    'Winner (ATS)',
    'OklahomaMichigan',
    'OKLA -5.5',
    'MICH +5.5',
    'No picks',
    'ORESat, Sep 12OKST',
    '1-011:00',
    'AM0-1',
    '#6',
    'Winner (ATS)',
    'OregonOklahoma State',
    'ORE -22.5',
    'OKST +22.5',
    'No picks',
    'ASUSat, Sep 12TXAM',
    '1-011:00',
    'AM1-0',
    '#10',
    'Winner (ATS)',
    'Arizona StateTexas A&M',
    'ASU +14.5',
    'TXAM -14.5',
    'No picks',
    'WAKE0/28—Sat, Sep 12PUR',
    '1-0PicksTiebreaker11:00',
    'AM1-0',
    'Winner (ATS)',
    'Wake ForestPurdue',
    'WAKE -2.5',
    'PUR +2.5',
    'No picks',
    'PSUSat, Sep 12TEM',
    '1-011:00',
    'AM1-0',
    '#16',
    'Winner (ATS)',
    'Penn StateTemple',
    'PSU -23.5',
    'TEM +23.5',
    'No picks',
    'WKUSat, Sep 12UGA',
    '0-111:45',
    'AM1-0',
    '#2',
    'Winner (ATS)',
    'Western KentuckyGeorgia',
    'WKU +40.5',
    'UGA -40.5',
    'No picks',
    'Week 1Week 2Week 3Week 4Week 5Week 6',
    'FinalSep 12Sep 18 - Sep 19Sep 25 - Sep 26Oct 2 - Oct 3Oct 5 - Oct 12',
    'MSSTSat, Sep 12MINN',
    '\uedd91-02:30',
    'PM1-0\uedda',
    'Winner (ATS)',
    'Mississippi StateMinnesota',
    'MSST -1.5',
    'MINN +1.5',
    'No picks',
    'UCFSat, Sep 12PITT',
    '1-02:30',
    'PM1-0',
    'Winner (ATS)',
    'UCFPittsburgh',
    '+7.5',
    'PITT -7.5',
    '0/28No picks',
    'Picks',
    'ARIZSat, Sep 12BYU',
    '1-02:30',
    'PM1-0',
    '#15',
    'Winner (ATS)',
    'ArizonaBYU',
    'ARIZ +7.5',
    '-7.5',
    'No picks',
    'ULMSat, Sep 12UAB',
    '0-12:30',
    'PM0-1',
    'Winner (ATS)',
    'Louisiana-MonroeUAB',
    'ULM +9.5',
    '-9.5',
    'No picks',
    'RICESat, Sep 12ND',
    '1-02:30',
    'PM1-0',
    '#3',
    'Winner (ATS)',
    'RiceNotre Dame',
    'RICE +43.5',
    'ND -43.5',
    'No picks',
    'DUKESat, Sep 12ILL',
    '1-02:30',
    'PM1-0',
    'Winner (ATS)',
    'DukeIllinois',
    'DUKE +5.5',
    'ILL -5.5',
    'No picks',
    'ALASat, Sep 12UK',
    '1-02:30',
    'PM1-0',
    '#12',
    'Winner (ATS)',
    '0/28AlabamaKentucky',
    'PicksALA -10.5',
    'UK +10.5',
    'No picks',
    'USUSat, Sep 12WASH',
    '0-12:30',
    'PM1-0',
    '#19',
    'Winner (ATS)',
    'Utah StateWashington',
    'USU +27.5',
    'WASH -27.5',
    'No picks',
    'DELSat, Sep 12VAN',
    '1-03:15',
    'PM1-0',
    'Winner (ATS)',
    'DelawareVanderbilt',
    'DEL +20.5',
    'VAN -20.5',
    'No picks',
    'MEMSat, Sep 12BSU',
    '2-05:00',
    'PM0-1',
    'Winner (ATS)',
    'MemphisBoise State',
    'MEM +8.5',
    'BSU -8.5',
    'No picks',
    'USASat, Sep 12TULN',
    '1-06:00',
    'PM0-1',
    'Winner (ATS)',
    'South AlabamaTulane',
    'USA +9.5',
    'TULN -9.5',
    'No picks',
    'TENNSat, Sep 12GT',
    '1-06:00',
    'PM0-1',
    '#180/28',
    'Winner (ATSPicks)',
    'TennesseeGeorgia Tech',
    'TENN -12.5',
    'GT +12.5',
    'No picks',
    'GASOSat, Sep 12CLEM',
    '1-06:30',
    'PM0-1',
    'Winner (ATS)',
    'Georgia SouthernClemson',
    'GASO +20.5',
    'CLEM -20.5',
    'No picks',
    'ISUSat, Sep 12IOWA',
    '1-06:30',
    'PM1-0',
    '#21',
    'Winner (ATS)',
    'Iowa StateIowa',
    'ISU +13.5',
    'IOWA -13.5',
    'No picks',
    'TTUSat, Sep 12ORST',
    '1-06:30',
    'PM0-1',
    '#13',
    'Winner (ATS)',
    'Texas TechOregon State',
    'TTU -26.5',
    'ORST +26.5',
    'No picks',
    'LTSat, Sep 12LSU',
    '1-06:30',
    'PM1-0',
    '#8',
    'Winner (ATS)',
    'Louisiana TechLSU',
    'LT +35.5',
    '-35.5',
    'No picks',
    '0/28',
    'Picks',
    'Sat, Sep 12',
    '6:30 PM',
    'OSUTEX',
    '1-0',
    '1-0',
    'Winner#1 (ATS)#4',
    'Ohio StateTexas',
    'OSU +1.5',
    'TEX -1.5',
    'No picks',
    'CHARSat, Sep 12MISS',
    '0-16:45',
    'PM1-0',
    '#9',
    'Winner (ATS)',
    'CharlotteOle Miss',
    'CHAR +47.5',
    'MISS -47.5',
    'No picks',
    'USMSat, Sep 12AUB',
    '1-06:45',
    'PM1-0',
    'Winner (ATS)',
    'Southern MissAuburn',
    'USM +32.5',
    'AUB -32.5',
    'No picks',
    'NDSUSat, Sep 12AFA',
    '2-09:00',
    'PM1-0',
    'Winner (ATS)',
    'North Dakota StateAir Force',
    'NDSU -2.5',
    'AFA +2.5',
    'No picks',
    'ARKSat, Sep 12UTAH',
    '1-09:15',
    'PM1-0',
    '#20',
    'Winner (ATS)',
    'ArkansasUtah',
    'ARK +12.5',
    'UTAH -12.5',
    '0/28',
    'Picks',
    'No picks',
    'ULLSat, Sep 12USC',
    '1-010:00',
    'PM2-0',
    '#14',
    'Winner (ATS)',
    'LouisianaUSC',
    'ULL +30.5',
    '-30.5',
    'No picks',
    'Tiebreaker',
    'Predict the total combined score. The entrant with the closest guess is given the',
    'advantage.',
    'Sat, September 12',
    'OSU TEX',
    '6:30 PM',
    'Combined Total Score',
    '– –',
    'Enter a whole number from 0 to 200',
    'Example: if you think the final score will be 24-17, enter “41” as the combined',
    'total score.',
    '0/28',
    'Picks',
]

REAL_MADWOOD_WK2_WINNER_ATS_SAMPLE = [
    'Make picks',
    'Entry 1',
    'Picks lock: Sat, Sep 12, 2026, 10:00 PM Make bulk picks Rules',
    'Make your picks',
    'Saturday, Sep 12 28 games',
    'OKLASat, Sep 12MICH',
    '1-011:00',
    'AM1-0',
    '#11',
    'Winner (ATS)',
    'OklahomaMichigan',
    'OKLA -5.5',
    'MICH +5.5',
    'No picks',
    'ORESat, Sep 12OKST',
    '1-011:00',
    'AM0-1',
    '#6',
    'Winner (ATS)',
    'OregonOklahoma State',
    'ORE -22.5',
    'OKST +22.5',
    'No picks',
    'ASUSat, Sep 12TXAM',
    '1-011:00',
    'AM1-0',
    '#10',
    'Winner (ATS)',
    'Arizona StateTexas A&M',
    'ASU +14.5',
    'TXAM -14.5',
    'No picks',
    'WAKE0/28—Sat, Sep 12PUR',
    '1-0PicksTiebreaker11:00',
    'AM1-0',
    'Winner (ATS)',
    'Wake ForestPurdue',
    'WAKE -2.5',
    'PUR +2.5',
    'No picks',
    'PSUSat, Sep 12TEM',
    '1-011:00',
    'AM1-0',
    '#16',
    'Winner (ATS)',
    'Penn StateTemple',
    'PSU -23.5',
    'TEM +23.5',
    'No picks',
    'WKUSat, Sep 12UGA',
    '0-111:45',
    'AM1-0',
    '#2',
    'Winner (ATS)',
    'Western KentuckyGeorgia',
    'WKU +40.5',
    'UGA -40.5',
    'No picks',
    'Week 1Week 2Week 3Week 4Week 5Week 6',
    'FinalSep 12Sep 18 - Sep 19Sep 25 - Sep 26Oct 2 - Oct 3Oct 5 - Oct 12',
    'MSSTSat, Sep 12MINN',
    '\uedd91-02:30',
    'PM1-0\uedda',
    'Winner (ATS)',
    'Mississippi StateMinnesota',
    'MSST -1.5',
    'MINN +1.5',
    'No picks',
    'UCFSat, Sep 12PITT',
    '1-02:30',
    'PM1-0',
    'Winner (ATS)',
    'UCFPittsburgh',
    '+7.5',
    'PITT -7.5',
    '0/28No picks',
    'Picks',
    'ARIZSat, Sep 12BYU',
    '1-02:30',
    'PM1-0',
    '#15',
    'Winner (ATS)',
    'ArizonaBYU',
    'ARIZ +7.5',
    '-7.5',
    'No picks',
    'ULMSat, Sep 12UAB',
    '0-12:30',
    'PM0-1',
    'Winner (ATS)',
    'Louisiana-MonroeUAB',
    'ULM +9.5',
    '-9.5',
    'No picks',
    'RICESat, Sep 12ND',
    '1-02:30',
    'PM1-0',
    '#3',
    'Winner (ATS)',
    'RiceNotre Dame',
    'RICE +43.5',
    'ND -43.5',
    'No picks',
    'DUKESat, Sep 12ILL',
    '1-02:30',
    'PM1-0',
    'Winner (ATS)',
    'DukeIllinois',
    'DUKE +5.5',
    'ILL -5.5',
    'No picks',
    'ALASat, Sep 12UK',
    '1-02:30',
    'PM1-0',
    '#12',
    'Winner (ATS)',
    '0/28AlabamaKentucky',
    'PicksALA -10.5',
    'UK +10.5',
    'No picks',
    'USUSat, Sep 12WASH',
    '0-12:30',
    'PM1-0',
    '#19',
    'Winner (ATS)',
    'Utah StateWashington',
    'USU +27.5',
    'WASH -27.5',
    'No picks',
    'DELSat, Sep 12VAN',
    '1-03:15',
    'PM1-0',
    'Winner (ATS)',
    'DelawareVanderbilt',
    'DEL +20.5',
    'VAN -20.5',
    'No picks',
    'MEMSat, Sep 12BSU',
    '2-05:00',
    'PM0-1',
    'Winner (ATS)',
    'MemphisBoise State',
    'MEM +8.5',
    'BSU -8.5',
    'No picks',
    'USASat, Sep 12TULN',
    '1-06:00',
    'PM0-1',
    'Winner (ATS)',
    'South AlabamaTulane',
    'USA +9.5',
    'TULN -9.5',
    'No picks',
    'TENNSat, Sep 12GT',
    '1-06:00',
    'PM0-1',
    '#180/28',
    'Winner (ATSPicks)',
    'TennesseeGeorgia Tech',
    'TENN -12.5',
    'GT +12.5',
    'No picks',
    'GASOSat, Sep 12CLEM',
    '1-06:30',
    'PM0-1',
    'Winner (ATS)',
    'Georgia SouthernClemson',
    'GASO +20.5',
    'CLEM -20.5',
    'No picks',
    'ISUSat, Sep 12IOWA',
    '1-06:30',
    'PM1-0',
    '#21',
    'Winner (ATS)',
    'Iowa StateIowa',
    'ISU +13.5',
    'IOWA -13.5',
    'No picks',
    'TTUSat, Sep 12ORST',
    '1-06:30',
    'PM0-1',
    '#13',
    'Winner (ATS)',
    'Texas TechOregon State',
    'TTU -26.5',
    'ORST +26.5',
    'No picks',
    'LTSat, Sep 12LSU',
    '1-06:30',
    'PM1-0',
    '#8',
    'Winner (ATS)',
    'Louisiana TechLSU',
    'LT +35.5',
    '-35.5',
    'No picks',
    '0/28',
    'Picks',
    'Sat, Sep 12',
    '6:30 PM',
    'OSUTEX',
    '1-0',
    '1-0',
    'Winner#1 (ATS)#4',
    'Ohio StateTexas',
    'OSU +1.5',
    'TEX -1.5',
    'No picks',
    'CHARSat, Sep 12MISS',
    '0-16:45',
    'PM1-0',
    '#9',
    'Winner (ATS)',
    'CharlotteOle Miss',
    'CHAR +47.5',
    'MISS -47.5',
    'No picks',
    'USMSat, Sep 12AUB',
    '1-06:45',
    'PM1-0',
    'Winner (ATS)',
    'Southern MissAuburn',
    'USM +32.5',
    'AUB -32.5',
    'No picks',
    'NDSUSat, Sep 12AFA',
    '2-09:00',
    'PM1-0',
    'Winner (ATS)',
    'North Dakota StateAir Force',
    'NDSU -2.5',
    'AFA +2.5',
    'No picks',
    'ARKSat, Sep 12UTAH',
    '1-09:15',
    'PM1-0',
    '#20',
    'Winner (ATS)',
    'ArkansasUtah',
    'ARK +12.5',
    'UTAH -12.5',
    '0/28',
    'Picks',
    'No picks',
    'ULLSat, Sep 12USC',
    '1-010:00',
    'PM2-0',
    '#14',
    'Winner (ATS)',
    'LouisianaUSC',
    'ULL +30.5',
    '-30.5',
    'No picks',
    'Tiebreaker',
    'Predict the total combined score. The entrant with the closest guess is given the',
    'advantage.',
    'Sat, September 12',
    'OSU TEX',
    '6:30 PM',
    'Combined Total Score',
    '– –',
    'Enter a whole number from 0 to 200',
    'Example: if you think the final score will be 24-17, enter “41” as the combined',
    'total score.',
    '0/28',
    'Picks',
]

wk2_res = parse_pool.parse_pool_lines(REAL_MADWOOD_WK2_WINNER_ATS_SAMPLE, 2026)
check("real Madwood Wk2 'Winner (ATS)' PDF: detected as splash", parse_pool.detect_source(REAL_MADWOOD_WK2_WINNER_ATS_SAMPLE) == "splash")
check("real Madwood Wk2 'Winner (ATS)' PDF: recovers all 28 of the real 28 games (up from 1, then 23, before this fix) -- GAME_CODE_HDR_RE/BARE_SPREAD_RE now recover the 5 code-collision games too", wk2_res["count"] == 28)
check("real Madwood Wk2 'Winner (ATS)' PDF: pickLimit is 28 (from the '0/28 Picks' footer)", wk2_res["pickLimit"] == 28)
wk2_games_by_pair = {(g["away"], g["home"]): g for g in wk2_res["games"]}
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: first game of the sheet (Oklahoma @ Michigan) parses with the correct sign convention",
    wk2_games_by_pair.get(("Oklahoma", "Michigan"), {}).get("line") == 5.5,
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: a game immediately AFTER one of the 5 (formerly-)known-gap games (Duke @ Illinois follows Louisiana-Monroe @ UAB) still parses correctly -- confirms the per-game pending/pending_hdr/bare_spreads snapshot doesn't let one game's reconciliation bleed into its neighbor",
    wk2_games_by_pair.get(("Duke", "Illinois"), {}).get("line") == -5.5,
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: last game of the sheet (Arkansas @ Utah) still parses -- no truncation at end of input",
    wk2_games_by_pair.get(("Arkansas", "Utah"), {}).get("line") == -12.5,
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: the 5 code-collision games (short code == printed name) are now recovered with the correct team on each side and the correct sign convention, including the two that appear back-to-back (UCF/Pittsburgh immediately followed by Arizona/BYU -- the pair that corrupted into a single bogus game before the Sept 10 flush-trigger fix)",
    wk2_games_by_pair.get(("UCF", "Pittsburgh"), {}).get("awaySpread") == 7.5
    and wk2_games_by_pair.get(("UCF", "Pittsburgh"), {}).get("homeSpread") == -7.5
    and wk2_games_by_pair.get(("Arizona", "BYU"), {}).get("awaySpread") == 7.5
    and wk2_games_by_pair.get(("Arizona", "BYU"), {}).get("homeSpread") == -7.5
    and wk2_games_by_pair.get(("Louisiana-Monroe", "UAB"), {}).get("awaySpread") == 9.5
    and wk2_games_by_pair.get(("Louisiana-Monroe", "UAB"), {}).get("homeSpread") == -9.5
    and wk2_games_by_pair.get(("Louisiana Tech", "LSU"), {}).get("awaySpread") == 35.5
    and wk2_games_by_pair.get(("Louisiana Tech", "LSU"), {}).get("homeSpread") == -35.5
    and wk2_games_by_pair.get(("Louisiana", "USC"), {}).get("awaySpread") == 30.5
    and wk2_games_by_pair.get(("Louisiana", "USC"), {}).get("homeSpread") == -30.5,
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: Sept 11 2026 fix -- ALL 28 games now get a real commence timestamp (was None for all 28 before this fix; production symptom was 'Week not set' plus every game stuck on Model # incomplete, since weekIndexOf() has nothing to key off with a null commence)",
    sum(1 for g in wk2_res["games"] if g["commence"] is None) == 0,
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: an ordinary game's commence combines the header's own date (GAME_CODE_HDR_RE's month/day groups) with the two-line glued record+time ('1-011:00' then 'AM1-0') correctly -- 11:00 AM, not the greedy-backtrack misread of 1:00 AM",
    wk2_games_by_pair.get(("Oklahoma", "Michigan"), {}).get("commence") == "2026-09-12T11:00:00",
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: a PM game combines correctly too, and specifically the ambiguous-digit case ('1-010:00' -> record '1-0' + time '10:00', not '1-01' + '0:00') resolves to 10:00 PM, not the greedy misread of 12:00 PM",
    wk2_games_by_pair.get(("Louisiana", "USC"), {}).get("commence") == "2026-09-12T22:00:00",
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: a record+time line with a stray Private-Use-Area glyph glued on ('\\uedd91-02:30' / 'PM1-0\\uedda', on Mississippi State @ Minnesota) still resolves -- tolerated at either end, not required to be stripped upstream",
    wk2_games_by_pair.get(("Mississippi State", "Minnesota"), {}).get("commence") == "2026-09-12T14:30:00",
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: a header line too noisy for GAME_CODE_HDR_RE's strict code extraction ('WAKE0/28\\u2014Sat, Sep 12PUR', a game counter + em-dash sitting between the away code and the weekday) still recovers its DATE via the separate DATE_ONLY_RE fallback, and its TIME despite an inline 'PicksTiebreaker' badge glued into the record+time line ('1-0PicksTiebreaker11:00')",
    wk2_games_by_pair.get(("Wake Forest", "Purdue"), {}).get("commence") == "2026-09-12T11:00:00",
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: the one nationally-ranked matchup (Ohio State @ Texas, 'Winner#1 (ATS)#4') uses a THIRD, distinct header shape entirely -- date and time each on their own clean line ('Sat, Sep 12' / '6:30 PM', no glued records at all) -- and still resolves via PLAIN_TIME_RE, not left on the None this shape would otherwise fall through to",
    wk2_games_by_pair.get(("Ohio State", "Texas"), {}).get("commence") == "2026-09-12T18:30:00",
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: Sept 11 2026 fix (2nd bug this same production report) -- every game now stores its real FULL team name (\"Oklahoma\"), not the short code (\"OKLA\") the spread line itself carries, recovered from the glued-names line right after each game's own Winner marker ('OklahomaMichigan' -> 'Oklahoma'/'Michigan'). This is what was actually breaking Market/CLV/PickGauge Model # in production -- teamMatchTrunc() has no way to token-prefix-match a bare code against the prediction feed's full names, so EVERY non-collision game failed applyPredictions() even after commence/week resolved correctly",
    all(
        wk2_games_by_pair.get(pair) is not None
        for pair in [("Oklahoma", "Michigan"), ("Oregon", "Oklahoma State"), ("Arizona State", "Texas A&M"),
                     ("Wake Forest", "Purdue"), ("Penn State", "Temple"), ("Western Kentucky", "Georgia"),
                     ("Mississippi State", "Minnesota"), ("Rice", "Notre Dame"), ("Duke", "Illinois"),
                     ("Utah State", "Washington"), ("Delaware", "Vanderbilt"), ("Memphis", "Boise State"),
                     ("South Alabama", "Tulane"), ("Tennessee", "Georgia Tech"), ("Georgia Southern", "Clemson"),
                     ("Iowa State", "Iowa"), ("Texas Tech", "Oregon State"), ("Louisiana Tech", "LSU"),
                     ("Ohio State", "Texas"), ("Charlotte", "Ole Miss"), ("Southern Miss", "Auburn"),
                     ("North Dakota State", "Air Force"), ("Arkansas", "Utah")]
    )
    # None of the OLD short-code pairings should exist anymore.
    and all(
        wk2_games_by_pair.get(pair) is None
        for pair in [("OKLA", "MICH"), ("ORE", "OKST"), ("ASU", "TXAM"), ("WAKE", "PUR"), ("PSU", "TEM")]
    ),
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: the 5 code-collision games' full names are correctly recovered on BOTH sides now, not just the collision side that already worked before this fix (e.g. UCF/Pittsburgh: 'PITT' short code upgraded to 'Pittsburgh' full name, while 'UCF' -- correct already, since the collision IS that UCF's own full name equals its code -- is left alone rather than being second-guessed)",
    wk2_games_by_pair.get(("UCF", "Pittsburgh"), {}).get("awaySpread") == 7.5
    and wk2_games_by_pair.get(("UCF", "Pittsburgh"), {}).get("homeSpread") == -7.5
    and wk2_games_by_pair.get(("Arizona", "BYU"), {}).get("awaySpread") == 7.5
    and wk2_games_by_pair.get(("Arizona", "BYU"), {}).get("homeSpread") == -7.5
    and wk2_games_by_pair.get(("Louisiana-Monroe", "UAB"), {}).get("awaySpread") == 9.5
    and wk2_games_by_pair.get(("Louisiana-Monroe", "UAB"), {}).get("homeSpread") == -9.5
    and wk2_games_by_pair.get(("Louisiana Tech", "LSU"), {}).get("awaySpread") == 35.5
    and wk2_games_by_pair.get(("Louisiana Tech", "LSU"), {}).get("homeSpread") == -35.5
    and wk2_games_by_pair.get(("Louisiana", "USC"), {}).get("awaySpread") == 30.5
    and wk2_games_by_pair.get(("Louisiana", "USC"), {}).get("homeSpread") == -30.5,
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: the Alabama/Kentucky game -- previously flagged (Sept 11 2026, first pass) as a SEPARATE, un-fixed bug where a stray '0/28Picks' pick-counter glued onto the spread line corrupted the away name into 'PicksALA' -- is now resolved as a side effect of sourcing team identity from the glued-names line instead of the spread line's own (buggy) name capture ('0/28AlabamaKentucky' strips its leading counter and still splits cleanly into 'Alabama'/'Kentucky')",
    wk2_games_by_pair.get(("Alabama", "Kentucky"), {}).get("line") == 10.5,
)
check(
    "real Madwood Wk2 'Winner (ATS)' PDF: GLUED_FULL_NAMES_SPLIT_RE correctly leaves 3-word team names alone -- 'North Dakota StateAir Force' splits into 'North Dakota State' (all 3 words intact, both real internal spaces preserved) and 'Air Force', not a false split at 'Dakota' or 'State'",
    wk2_games_by_pair.get(("North Dakota State", "Air Force"), {}).get("line") == 2.5,
)
check(
    "parse_pool.py against the REAL pdf.js-extracted lines from the actual Madwood_CFB_Wk_2.pdf (not the hand-typed fixture above) -- ported extractPdfTextLines()/splashLaneLines() verbatim from pool-contexts.js and ran it through the real pdfjs-dist 3.11.174 the app vendors, confirming the fixture wasn't silently diverging from what production actually sends to /api/parse_pool: 28/28 games, 0 missing commence, every game keyed by full team name",
    (lambda res, collision={"UCF", "BYU", "UAB", "LSU", "USC"}: res["count"] == 28
        and sum(1 for g in res["games"] if g["commence"] is None) == 0
        # A short code is conventionally ALL CAPS (OKLA, TXAM, MSST); a real
        # full name is Title Case (Rice, Duke, Iowa) -- checking for at
        # least one lowercase letter distinguishes them correctly even for
        # genuinely short 4-letter school names, which a length check alone
        # cannot.
        and all(
            (not g["away"].isupper() or g["away"] in collision) and (not g["home"].isupper() or g["home"] in collision)
            for g in res["games"]
        )
    )(parse_pool.parse_pool_lines(REAL_MADWOOD_WK2_PDFJS_EXTRACTED_LINES, 2026)),
)

print("")
print(f"{total_checks[0] - len(failures)}/{total_checks[0]} checks passed")
if failures:
    print("FAILED:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
sys.exit(0)
