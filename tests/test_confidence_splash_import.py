from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.parse_pool import parse_pool_lines


def test_confidence_style_splash_pdfjs_shape_and_metadata():
    # Minimal synthetic fixture matching the ACTUAL pdf.js line shape from
    # Grundy's Gang Week 1 2026: away abbreviation+spread, home spread+abbr,
    # kickoff row, then the two full pick-option lines.
    lines = [
        "Team Pickem | Splash Sports",
        "Week 1",
        "Your 2 lowest-scoring weeks will be dropped",
        "Picks lock: Thu, Sep 3, 2026, 7:00 PM Make bulk picks Rules",
        "Colorado+6.5",
        "-6.5 GT",
        "Thu, Sep 3 • 7:00 PM",
        "Winner",
        "Colorado +6.5",
        "Georgia Tech -6.5",
        "(0-0-0)",
        "(0-0-0)",
        "UAB+27.5",
        "-27.5 ILL",
        "Thu, Sep 3 • 8:00 PM",
        "Winner",
        "UAB +27.5",
        "Illinois -27.5",
        "(0-0-0)",
        "(0-0-0)",
        "0/2",
        "Picks",
    ]
    r = parse_pool_lines(lines, 2026)
    assert r["source"] == "splash"
    assert r["count"] == 2
    assert r["pickLimit"] == 2
    assert r["dropLowestWeeks"] == 2
    assert r["picksLockAt"] == "2026-09-03T19:00:00"
    assert r["lockMode"] == "card"
    assert r["weekNumber"] == 1
    assert r["games"][0] == {
        "away": "Colorado", "home": "Georgia Tech",
        "commence": "2026-09-03T19:00:00", "line": -6.5,
        "awaySpread": 6.5, "homeSpread": -6.5,
    }
    assert r["games"][1]["away"] == "UAB"
    assert r["games"][1]["home"] == "Illinois"
    assert r["games"][1]["line"] == -27.5


def test_flattened_pair_line_fallback():
    # A different extractor can flatten both full pick buttons into one line.
    lines = [
        "Team Pickem | Splash Sports",
        "Week 1",
        "0/1",
        "Thu, Sep 3 • 7:00 PM",
        "Colorado +6.5 Georgia Tech -6.5",
    ]
    r = parse_pool_lines(lines, 2026)
    assert r["count"] == 1
    assert r["games"][0]["away"] == "Colorado"
    assert r["games"][0]["home"] == "Georgia Tech"
    assert r["games"][0]["line"] == -6.5


def test_real_team_pickem_fullwidth_line_shape_and_page_boundary_glue():
    # Captured from the ACTUAL production pdf.js extraction geometry after the
    # Splash-specific full-width splitter. It deliberately includes the two
    # failure shapes from the real Grundy's Gang PDF: concatenated week tabs and
    # a sticky footer glued to Winner at a page boundary.
    lines = [
        "9/2/26, 5:03 PM Team Pickem | Splash Sports",
        "Week 1Week 2Week 3Week 4",
        "Your 2 lowest-scoring weeks will be dropped",
        "Picks lock: Thu, Sep 3, 2026, 7:00 PM Make bulk picks Rules",
        "TXST+29.5 Sat, Sep 5 • 2:30 PM -29.5 TEX",
        "WinnerPicks",
        # next PDF page begins here; full choice row must remain associated
        "Texas State +29.5",
        "Texas -29.5",
        "No picks",
        "LOU+6.5",
        "-6.5 MISS",
        "Sun, Sep 6 • 6:30 PM",
        "Winner0/18",
        # next page continuation
        "Louisville +6.5",
        "Ole Miss -6.5",
        "0/18",
    ]
    r = parse_pool_lines(lines, 2026)
    assert r["count"] == 2
    assert r["pickLimit"] == 18
    assert r["weekNumber"] == 1
    assert r["games"][0]["away"] == "Texas State"
    assert r["games"][0]["home"] == "Texas"
    assert r["games"][0]["line"] == -29.5
    assert r["games"][1]["away"] == "Louisville"
    assert r["games"][1]["home"] == "Ole Miss"
    assert r["games"][1]["line"] == -6.5


if __name__ == "__main__":
    tests = [
        test_confidence_style_splash_pdfjs_shape_and_metadata,
        test_flattened_pair_line_fallback,
        test_real_team_pickem_fullwidth_line_shape_and_page_boundary_glue,
    ]
    for test in tests:
        test()
        print(f"[PASS] {test.__name__}")
    print(f"\n{len(tests)}/{len(tests)} checks passed")
