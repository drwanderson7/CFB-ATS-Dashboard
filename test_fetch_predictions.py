"""Regression tests for api/fetch_predictions.py's reliability fixes:
stale-if-error fallback, immutable weekly snapshots, and schema-drift
alarms. See CURRENT_STATE.md / chatgptnotes.md item #5 for the full audit
this addresses -- thepredictiontracker.com's weekly CSV previously had no
resilience beyond a hard 30-minute freshness gate, no historical record
beyond the single rolling cache slot, and no detection at all for a
silently-broken/reshaped upstream CSV."""
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("fetch_predictions", os.path.join(ROOT, "api", "fetch_predictions.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

failures = []
total = [0]


def check(name, cond):
    total[0] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


# --- parse_csv_text(): duplicate-matchup tracking (new) --------------------
dup_csv = (
    "home,road,linesag,linefpi\n"
    "Alabama,Auburn,3.5,4.0\n"
    "Alabama,Auburn,3.5,4.0\n"  # exact duplicate matchup row
    "Georgia,Florida,7.0,6.5\n"
)
dup_parsed = mod.parse_csv_text(dup_csv)
check("parse_csv_text(): still de-dupes exact repeat matchups (existing behavior preserved)", dup_parsed["count"] == 2)
check("parse_csv_text(): NEW -- tracks how many duplicate rows were dropped instead of silently discarding that signal", dup_parsed["duplicateCount"] == 1)

clean_csv = "home,road,linesag\nAlabama,Auburn,3.5\nGeorgia,Florida,7.0\n"
clean_parsed = mod.parse_csv_text(clean_csv)
check("parse_csv_text(): duplicateCount is 0 for a CSV with no repeats", clean_parsed["duplicateCount"] == 0)

# --- _relative_age_phrase(): human-readable staleness ----------------------
check("_relative_age_phrase(): under a minute reads as 'under a minute ago', not '0 minutes ago'", mod._relative_age_phrase(0.4) == "under a minute ago")
check("_relative_age_phrase(): singular minute", mod._relative_age_phrase(1) == "1 minute ago")
check("_relative_age_phrase(): plural minutes", mod._relative_age_phrase(45) == "45 minutes ago")
check("_relative_age_phrase(): singular hour", mod._relative_age_phrase(61) == "1 hour ago")
check("_relative_age_phrase(): plural hours (the real 2pm-refresh/7:30pm-kickoff scenario from the audit)", mod._relative_age_phrase(330) == "6 hours ago")
check("_relative_age_phrase(): plural days once past 24 hours", mod._relative_age_phrase(60 * 30) == "1 day ago" or mod._relative_age_phrase(60 * 30) == "2 days ago")
check("_relative_age_phrase(): never goes negative even with bad input", mod._relative_age_phrase(-5) == "under a minute ago")

# --- _iso_week_key(): stable, unique snapshot keys --------------------------
mid_week = datetime(2026, 9, 3, 12, 0, tzinfo=timezone.utc)  # a Thursday
same_week_later = datetime(2026, 9, 5, 23, 0, tzinfo=timezone.utc)  # the following Saturday, same ISO week
next_week = datetime(2026, 9, 8, 12, 0, tzinfo=timezone.utc)  # the following Tuesday, next ISO week
check("_iso_week_key(): two fetches within the same real week produce the SAME key (so later-week refinements overwrite, not fragment)", mod._iso_week_key(mid_week) == mod._iso_week_key(same_week_later))
check("_iso_week_key(): a fetch from the following week produces a DIFFERENT key (so history isn't silently merged across weeks)", mod._iso_week_key(mid_week) != mod._iso_week_key(next_week))
check("_iso_week_key(): key is namespaced under SNAPSHOT_KEY_PREFIX and human-decodable (year:Wweek)", mod._iso_week_key(mid_week) == f"{mod.SNAPSHOT_KEY_PREFIX}2026:W36")

# --- detect_schema_drift(): the actual data-quality alarm logic ------------
baseline = {"count": 40, "systems": ["sag", "fpi", "dent", "elo", "srs"]}

check("detect_schema_drift(): no baseline yet (first-ever fetch) -> no warnings, nothing to compare against", mod.detect_schema_drift({"count": 3, "systems": ["sag"]}, None) == [])

normal_week = {"count": 35, "systems": ["sag", "fpi", "dent", "elo", "srs"]}
check("detect_schema_drift(): an ordinary week-to-week count dip (40->35, well within tolerance) produces no warning", mod.detect_schema_drift(normal_week, baseline) == [])

broken_scrape = {"count": 2, "systems": ["sag", "fpi", "dent", "elo", "srs"]}
broken_warnings = mod.detect_schema_drift(broken_scrape, baseline)
check("detect_schema_drift(): a genuine game-count collapse (40->2) DOES produce a warning", any("Game count dropped sharply" in w for w in broken_warnings))
check("detect_schema_drift(): the game-count warning names both the old and new numbers", any("40" in w and "2" in w for w in broken_warnings))

few_systems = {"count": 35, "systems": ["sag"]}
system_warnings = mod.detect_schema_drift(few_systems, baseline)
check("detect_schema_drift(): a sharp drop in tracked SYSTEM count (not just games) is flagged independently", any("system count dropped sharply" in w for w in system_warnings))

missing_core = {"count": 35, "systems": ["fpi", "elo", "srs"]}
core_warnings = mod.detect_schema_drift(missing_core, baseline)
check("detect_schema_drift(): Sagarin ('sag') silently vanishing from a previously-tracking fetch is specifically flagged as a core-system loss", any("sag" in w and "core system" in w for w in core_warnings))
check("detect_schema_drift(): a core-system-lost warning does NOT fire for a system that was never in the baseline to begin with", not any("sag" in w for w in mod.detect_schema_drift({"count": 35, "systems": ["fpi"]}, {"count": 40, "systems": ["fpi", "elo", "srs", "rt", "gp"]})))

tiny_baseline = {"count": 3, "systems": ["sag", "fpi"]}
check("detect_schema_drift(): a tiny baseline (below DRIFT_MIN_BASELINE_COUNT) is too noisy for the ratio check -- skipped, not a false alarm", mod.detect_schema_drift({"count": 1, "systems": ["sag", "fpi"]}, tiny_baseline) == [])

dup_heavy = {"count": 10, "systems": ["sag"]}
dup_warnings = mod.detect_schema_drift(dup_heavy, None, duplicate_count=5)
check("detect_schema_drift(): an unusual spike in duplicate matchups is flagged even with no baseline at all", any("duplicate matchup" in w for w in dup_warnings))
check("detect_schema_drift(): a small, ordinary duplicate count (below the floor) is NOT flagged", mod.detect_schema_drift({"count": 40, "systems": ["sag"]}, None, duplicate_count=1) == [])

# --- write_weekly_snapshot() / _stale_shared_predictions(): structural ------
# These two hit real Redis via _kv_set_ex/_kv_get and can't be exercised
# without live credentials (same reasoning tests/_live_cas_concurrency_test.py
# documents for why THAT test is excluded from the automated suite) -- so
# this checks the actual source wiring instead of a live round-trip.
src = open(os.path.join(ROOT, "api", "fetch_predictions.py"), encoding="utf-8").read()
check("write_weekly_snapshot() uses the TTL-capable _kv_set_ex(), not the plain (non-expiring) _kv_set()", "_kv_set_ex(key, json.dumps(payload), SNAPSHOT_TTL_SECONDS)" in src)
check("SNAPSHOT_TTL_SECONDS is roughly a season-plus-buffer (26 weeks), not indefinite retention", mod.SNAPSHOT_TTL_SECONDS == 60 * 60 * 24 * 7 * 26)
check("_stale_shared_predictions() uses the looser STALE_FALLBACK_MAX_MINUTES bound, not the normal 30-minute freshness gate", "age_minutes >= STALE_FALLBACK_MAX_MINUTES" in src)
check("STALE_FALLBACK_MAX_MINUTES is a full week, deliberately looser than the 30-minute normal-freshness gate", mod.STALE_FALLBACK_MAX_MINUTES == 60 * 24 * 7)

# --- do_GET() wiring: stale-if-error + snapshot + warnings (structural) ----
check("do_GET() falls back to _stale_shared_predictions() on an upstream URLError before giving up with a 502", "except urllib.error.URLError as e:" in src and src.index("except urllib.error.URLError as e:") < src.index("_stale_shared_predictions()", src.index("except urllib.error.URLError as e:")))
check("do_GET() also tries the stale fallback for a genuinely empty CSV result (count==0), not just network failures", "if not data[\"count\"]:" in src and "fallback = _stale_shared_predictions()" in src)
check("do_GET() reads the PREVIOUS shared-cache blob as the drift baseline BEFORE write_shared_predictions() overwrites it", src.index("_parse_shared_predictions_blob(_kv_get(SHARED_PREDICTIONS_KEY))", src.index("baseline = None")) < src.index("write_shared_predictions(data[\"games\"]"))
check("do_GET() calls write_weekly_snapshot() on every successful fetch", "write_weekly_snapshot(data[\"games\"], data[\"systems\"], fetched_at)" in src)
check("do_GET() attaches detect_schema_drift()'s warnings to the real response, not just logging them server-side", 'response["warnings"] = warnings' in src)
check("a best-effort snapshot-write failure never blocks the live response (wrapped in its own try/except)", "write_weekly_snapshot(data[\"games\"], data[\"systems\"], fetched_at)\n            except Exception:" in src)

if failures:
    print(f"\n{len(failures)} of {total[0]} FAILURE(S):", failures)
    raise SystemExit(1)
print(f"\nAll {total[0]} checks passed.")
