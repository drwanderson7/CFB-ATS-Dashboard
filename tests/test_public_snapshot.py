"""Regression tests for api/public_snapshot.py -- the unauthenticated
Snapshot-preview endpoint that lets a logged-out visitor see real
model-vs-market edges before signing in.

Covers: never serving fabricated data when a cache is empty/missing,
never serving data past each view's own MAX_AGE_MINUTES_* cutoff, trimming predictions/ratings
down to ONLY the public default composite (sag / SP+), never leaking
odds quota (`reqLeft`) or per-user infrastructure fields
(`preKickLines`), the do_GET() view dispatch + validation, and that
this file structurally never calls any upstream provider (read-only by
construction, not just by convention).
"""
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("public_snapshot", os.path.join(ROOT, "api", "public_snapshot.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

failures = []
total = [0]


def check(name, cond):
    total[0] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


def iso(age_minutes):
    return (datetime.now(timezone.utc) - timedelta(minutes=age_minutes)).isoformat()


# --- build_odds_view() ------------------------------------------------------
mod._kv_get_json = lambda key: None
check("build_odds_view(): not ready when there's nothing cached at all",
      mod.build_odds_view() == {"ready": False})

mod._kv_get_json = lambda key: {"lastGames": {}}
check("build_odds_view(): not ready when lastGames is present but empty",
      mod.build_odds_view() == {"ready": False})

fresh_odds = {
    "lastGames": {"g1": {"id": "g1", "home": "Alabama", "away": "Auburn", "books": {"dk": -3.5}}},
    "lastRefresh": iso(2),
    "reqLeft": 812,
    "booksSeen": ["dk", "fd"],
    "preKickLines": {"g1": {"books": {"dk": -3.5}}},
    "sharedUpdatedAt": iso(2),
}
mod._kv_get_json = lambda key: fresh_odds
out = mod.build_odds_view()
check("build_odds_view(): ready:true for a fresh real cache", out.get("ready") is True)
check("build_odds_view(): games passed through", out.get("games") == fresh_odds["lastGames"])
check("build_odds_view(): reqLeft NEVER exposed publicly (quota/budget info)", "reqLeft" not in out)
check("build_odds_view(): preKickLines NEVER exposed publicly (grading/CLV internals)", "preKickLines" not in out)
check("build_odds_view(): booksSeen passed through (public market info anyway)", out.get("booksSeen") == ["dk", "fd"])

stale_odds = dict(fresh_odds, sharedUpdatedAt=iso(mod.MAX_AGE_MINUTES_ODDS + 5))
mod._kv_get_json = lambda key: stale_odds
check("build_odds_view(): not ready once past MAX_AGE_MINUTES_ODDS -- never serves ancient data to a logged-out visitor with no refresh control",
      mod.build_odds_view() == {"ready": False})

no_ts_odds = {"lastGames": {"g1": {"id": "g1"}}}
mod._kv_get_json = lambda key: no_ts_odds
check("build_odds_view(): not ready when sharedUpdatedAt is missing, doesn't crash",
      mod.build_odds_view() == {"ready": False})

# --- build_predictions_view() -----------------------------------------------
mod._kv_get_json = lambda key: None
check("build_predictions_view(): not ready with nothing cached",
      mod.build_predictions_view() == {"ready": False})

fresh_preds = {
    "predictions": [
        {"home": "Alabama", "road": "Auburn", "systems": {"sag": -6.5, "fpi": -7.0, "donchess": -5.5, "sagpred": -6.0}},
        {"home": "Georgia", "road": "Florida", "systems": {"fpi": -3.0, "donchess": -2.5}},  # no 'sag' -- should be dropped entirely
    ],
    "predMeta": {"fetchedAt": iso(1), "count": 2},
    "sharedUpdatedAt": iso(1),
}
mod._kv_get_json = lambda key: fresh_preds
out = mod.build_predictions_view()
check("build_predictions_view(): ready:true for a fresh real cache", out.get("ready") is True)
check("build_predictions_view(): systems list is hardcoded to the public default (['sag']), not the real ~40-system set",
      out.get("systems") == ["sag"])
check("build_predictions_view(): only 1 game survives -- the one with no 'sag' value is dropped, not sent with an empty systems dict",
      out.get("count") == 1 and len(out.get("games")) == 1)
g = out["games"][0]
check("build_predictions_view(): surviving game's systems dict contains ONLY 'sag' -- fpi/donchess/sagpred are stripped",
      set(g["systems"].keys()) == {"sag"} and g["systems"]["sag"] == -6.5)
check("build_predictions_view(): home/road team names pass through", g["home"] == "Alabama" and g["road"] == "Auburn")

all_non_sag = {
    "predictions": [{"home": "A", "road": "B", "systems": {"fpi": -3.0}}],
    "predMeta": {"fetchedAt": iso(1)},
    "sharedUpdatedAt": iso(1),
}
mod._kv_get_json = lambda key: all_non_sag
check("build_predictions_view(): not ready when every cached game lacks 'sag' (nothing left after trimming), rather than serving an empty board",
      mod.build_predictions_view() == {"ready": False})

stale_preds = dict(fresh_preds, sharedUpdatedAt=iso(mod.MAX_AGE_MINUTES_PREDICTIONS + 1))
mod._kv_get_json = lambda key: stale_preds
check("build_predictions_view(): not ready once past MAX_AGE_MINUTES_PREDICTIONS",
      mod.build_predictions_view() == {"ready": False})

# --- build_ratings_view() ---------------------------------------------------
mod._kv_get_json = lambda key: None
check("build_ratings_view(): not ready with nothing cached", mod.build_ratings_view(2026) == {"ready": False})

fresh_ratings = {
    "year": 2026,
    "fetchedAt": iso(1),
    "ratings": [
        {"team": "Alabama", "conference": "SEC", "sp": {"rating": 24.1, "ranking": 3}, "core": {"overall": 1}, "fpi": {"fpi": 20}},
        {"team": "No SP Team", "conference": "SEC", "sp": None, "core": {"overall": 1}},
    ],
}
mod._kv_get_json = lambda key: fresh_ratings
out = mod.build_ratings_view(2026)
check("build_ratings_view(): ready:true for a fresh real cache", out.get("ready") is True)
check("build_ratings_view(): team with no 'sp' rating is dropped entirely",
      len(out.get("ratings")) == 1 and out["ratings"][0]["team"] == "Alabama")
r = out["ratings"][0]
check("build_ratings_view(): surviving team's block contains ONLY team/conference/sp -- core/srs/elo/fpi are stripped",
      set(r.keys()) == {"team", "conference", "sp"})
check("build_ratings_view(): sp block itself passed through intact (needed client-side for cfbdDerivedSpread())",
      r["sp"] == {"rating": 24.1, "ranking": 3})

stale_ratings = dict(fresh_ratings, fetchedAt=iso(mod.MAX_AGE_MINUTES_RATINGS + 1))
mod._kv_get_json = lambda key: stale_ratings
check("build_ratings_view(): not ready once past MAX_AGE_MINUTES_RATINGS",
      mod.build_ratings_view(2026) == {"ready": False})

# --- do_GET(): view dispatch + validation -----------------------------------
class _FakeHandler(mod.handler):
    def __init__(self, path):
        self.path = path
        self.headers = {}
        self._status = None
        self._body = None

    def _respond(self, status, data):
        self._status = status
        self._body = data


_orig_rate_limited = mod.rate_limited
mod.rate_limited = lambda bucket, limit, window: False  # not rate-limited for these checks

mod._kv_get_json = lambda key: fresh_odds
h = _FakeHandler("/api/public_snapshot?view=odds")
h.do_GET()
check("do_GET(): view=odds dispatches to build_odds_view() and returns 200", h._status == 200 and h._body.get("ready") is True)

h2 = _FakeHandler("/api/public_snapshot?view=bogus")
h2.do_GET()
check("do_GET(): an unrecognized view is rejected with 400, not silently defaulted", h2._status == 400)

h3 = _FakeHandler("/api/public_snapshot")
h3.do_GET()
check("do_GET(): a missing view param is rejected with 400", h3._status == 400)

# Rate limiting: real 429 behavior
mod.rate_limited = lambda bucket, limit, window: True
h4 = _FakeHandler("/api/public_snapshot?view=odds")
h4.do_GET()
check("do_GET(): a rate-limited caller gets 429, not a normal response", h4._status == 429)
mod.rate_limited = _orig_rate_limited

# client_ip(): reads x-forwarded-for, falls back safely
class _H:
    def __init__(self, headers):
        self.headers = headers


check("client_ip(): reads the first hop of x-forwarded-for",
      mod.client_ip(_H({"x-forwarded-for": "203.0.113.5, 10.0.0.1"})) == "203.0.113.5")
check("client_ip(): falls back to a shared bucket key when the header is absent, doesn't crash",
      mod.client_ip(_H({})) == "__unknown__")

# --- Structural: this file must never call any upstream provider -----------
# Checks CODE lines only (strips comments/docstring prose first) -- the
# module docstring legitimately NAMES these providers/strings in its
# explanation of what got trimmed and why; what actually matters is that
# no executable line constructs a request to one of them.
src = open(os.path.join(ROOT, "api", "public_snapshot.py"), encoding="utf-8").read()
code_lines = [
    ln for ln in src.splitlines()
    if ln.strip() and not ln.strip().startswith("#")
]
# Drop the module-level triple-quoted docstring block (first """ ... """)
# before scanning -- everything inside it is prose, not code.
if '"""' in src:
    first = src.index('"""')
    second = src.index('"""', first + 3)
    code_only = src[:first] + src[second + 3:]
else:
    code_only = src
# Also drop full-line comments (e.g. the explanatory comment directly above
# the Cache-Control header) -- only real executable lines should count.
code_only = "\n".join(ln for ln in code_only.splitlines() if not ln.strip().startswith("#"))

check("structural: no request construction referencing The Odds API's domain in actual code",
      "the-odds-api.com" not in code_only)
check("structural: no request construction referencing CFBD's domain in actual code",
      "collegefootballdata.com" not in code_only)
check("structural: no request construction referencing thepredictiontracker.com in actual code",
      "thepredictiontracker.com" not in code_only)
check("structural: this file never calls _kv_set / writes any shared cache -- read-only by construction",
      "_kv_set" not in code_only)
check("structural: real 200-path responses use public cache headers, not the private/no-store convention every authenticated endpoint uses",
      "public, max-age=60" in code_only and "private, no-store" not in code_only)

print(f"\n{total[0] - len(failures)}/{total[0]} checks passed")
if failures:
    print("\nFAILURES:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
