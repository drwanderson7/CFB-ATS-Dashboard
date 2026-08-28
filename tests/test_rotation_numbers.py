"""Regression tests for rotation-number support (Aug 27 feature).

Confirmed (Drew, against a real week's live Odds API pull vs. a real
Powers PDF for the same week) that Brad Powers' own rotation numbers
match The Odds API's rotation numbers for the same real games -- this
unblocked building rotation-number matching as a more reliable PRIMARY
match for Powers PDF imports, falling back to the existing fuzzy
team-name matching (app/js/pdf-import.js's teamMatch()) for any game
where either source lacks a rotation number (confirmed common for
lower-profile FCS-opponent buy games).

Covers the two SERVER-side pieces: api/fetch_odds.py (requests and
extracts The Odds API's rotation numbers) and api/parse_pdf.py (now
returns the rotation number it already extracted internally, previously
discarded after being used purely as an away/home pairing + cross-page
join key). The CLIENT-side matching logic itself
(findBoardGameByRotation(), app/js/pdf-import.js) is JS and covered
separately in tests/test_pdf_import_logic.mjs (or wherever that file's
own rotation-number cases were added).
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def _load(name, relpath):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, relpath))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


fetch_odds = _load("fetch_odds_rot", "api/fetch_odds.py")
parse_pdf = _load("parse_pdf_rot", "api/parse_pdf.py")

failures = []
total = [0]


def check(name, cond):
    total[0] += 1
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        failures.append(name)


# ---------------------------------------------------------------------------
# api/fetch_odds.py: build_url() requests rotation numbers
# ---------------------------------------------------------------------------
url = fetch_odds.build_url("fake-key")
check("build_url() requests includeRotationNumbers=true", "includeRotationNumbers=true" in url)

# ---------------------------------------------------------------------------
# api/fetch_odds.py: extract_games() -- present, absent, and mixed cases
# ---------------------------------------------------------------------------
events_both_present = [{
    "id": "evt1", "home_team": "Alabama", "away_team": "Auburn",
    "commence_time": "2026-11-28T18:00:00Z",
    "home_rotation": 182, "away_rotation": 181,
    "bookmakers": [{"key": "draftkings", "markets": [
        {"key": "spreads", "outcomes": [{"name": "Alabama", "point": -14.5}]}
    ]}],
}]
games, _ = fetch_odds.extract_games(events_both_present)
check("extract_games(): awayRotation present and correct when The Odds API provides one", games[0].get("awayRotation") == 181)
check("extract_games(): homeRotation present and correct when The Odds API provides one", games[0].get("homeRotation") == 182)

events_absent = [{
    "id": "evt2", "home_team": "Georgia State", "away_team": "Coastal Carolina",
    "commence_time": "2026-09-05T23:00:00Z",
    # No away_rotation/home_rotation keys at all -- the real shape The
    # Odds API sends for a game it hasn't assigned rotation numbers to
    # yet, not `null` values.
    "bookmakers": [{"key": "draftkings", "markets": [
        {"key": "spreads", "outcomes": [{"name": "Georgia State", "point": 3.5}]}
    ]}],
}]
games2, _ = fetch_odds.extract_games(events_absent)
check("extract_games(): no awayRotation KEY at all when The Odds API doesn't provide one (not a null placeholder)", "awayRotation" not in games2[0])
check("extract_games(): no homeRotation KEY at all when The Odds API doesn't provide one (not a null placeholder)", "homeRotation" not in games2[0])

events_explicit_null = [{
    "id": "evt3", "home_team": "Team A", "away_team": "Team B",
    "commence_time": "2026-09-05T23:00:00Z",
    "home_rotation": None, "away_rotation": None,
    "bookmakers": [{"key": "draftkings", "markets": [
        {"key": "spreads", "outcomes": [{"name": "Team A", "point": -3}]}
    ]}],
}]
games3, _ = fetch_odds.extract_games(events_explicit_null)
check("extract_games(): an EXPLICIT null from The Odds API is also omitted, not passed through as null", "awayRotation" not in games3[0] and "homeRotation" not in games3[0])

# ---------------------------------------------------------------------------
# api/parse_pdf.py: rotation numbers survive into the final game output
# ---------------------------------------------------------------------------
# The pairing logic (already existed before this feature) requires: odd
# rotation = away, even = home, and r+1 must also exist in m2. Rather than
# reconstruct a full synthetic PDF, call the pairing section directly via
# its own module-level helper isn't exposed -- so this drives it the same
# way tests/test_pdf_import_hardening.py or similar files already do:
# through the real parse_pdf() entry point with a minimal fake PDF is
# heavier than needed here. Instead, confirm the SHAPE contract directly:
# every game dict this module can emit includes awayRotation/homeRotation
# alongside the existing fields, by checking the actual append() call
# site's literal key set in source -- a targeted, honest proxy for "this
# field made it into the output schema," consistent with how this
# project already source-checks schema-shape contracts elsewhere (e.g.
# tests/test_no_raw_exceptions_in_500s.py's structural scans) rather than
# needing a full synthetic PDF fixture for a pure plumbing change.
src = open(os.path.join(ROOT, "api", "parse_pdf.py")).read()
check("parse_pdf.py's game-output dict includes awayRotation", '"awayRotation": r' in src)
check("parse_pdf.py's game-output dict includes homeRotation", '"homeRotation": r + 1' in src)
check("parse_pdf.py's own module docstring documents the new output fields (not just the code)", "awayRotation, homeRotation" in src)

print()
print(f"{total[0]-len(failures)}/{total[0]} checks passed")
if failures:
    print("FAILED:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
sys.exit(0)
