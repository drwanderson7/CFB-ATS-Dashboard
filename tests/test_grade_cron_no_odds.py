"""The daily grading cron must not spend The Odds API (Oct 26, 2026).

Before: api/grade_picks.py called The Odds API /scores (fetch_scores) on any
run where a pending item was "legacy" -- a pick or model snapshot without a
CFBD game id, and EVERY confidence-pool game (cpCloseWeek() never stores one).
/scores only looks back 3 days, so an old legacy item that could never match
still cost a call on every daily cron run.

Now: plan_score_sources() decides. In cron mode The Odds API is never used;
legacy items are name-matched against CFBD finals for the current season
instead. A person's manual "Check results now" keeps the old behavior.

Runs the real do_GET() with Redis, CFBD and The Odds API stubbed out.

Run with:
    python3 tests/test_grade_cron_no_odds.py
"""
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("grade_picks", os.path.join(ROOT, "api", "grade_picks.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

failures = []
total = [0]


def check(name, cond):
    total[0] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


# --- plan_score_sources(): the decision itself --------------------------------
OCT = datetime(2026, 10, 26, 14, 0, tzinfo=timezone.utc)
JAN = datetime(2027, 1, 5, 14, 0, tzinfo=timezone.utc)
check("cron + legacy pending -> no Odds API, current CFBD season added",
      mod.plan_score_sources("cron", set(), True, False, OCT) == ({2026}, False))
check("cron + CFBD failure -> still no Odds API fallback", mod.plan_score_sources("cron", {2026}, False, True, OCT)[1] is False)
check("cron in January -> the bowl season is the previous year's", mod.plan_score_sources("cron", set(), True, False, JAN)[0] == {2026})
check("cron with only CFBD-identified picks -> unchanged years, no Odds", mod.plan_score_sources("cron", {2025}, False, False, OCT) == ({2025}, False))
check("manual 'Check results now' + legacy -> Odds API allowed, as before", mod.plan_score_sources("user", set(), True, False, OCT) == (set(), True))
check("manual + CFBD failure -> Odds API fallback allowed, as before", mod.plan_score_sources("user", {2026}, False, True, OCT)[1] is True)
check("manual with nothing legacy -> no Odds API", mod.plan_score_sources("user", {2026}, False, False, OCT)[1] is False)

# --- Through do_GET(): one user with only legacy pending items ----------------
season = mod.current_cfbd_season()
USER = {
    "_rev": 3,
    "history": [{"id": "w8", "label": "Week 8", "entries": [{"entryId": "e1", "name": "Entry 1", "picks": [
        # Legacy ATS pick: no cfbdGameId / cfbdSeason (Odds-style team names).
        {"key": "a", "team": "Georgia Bulldogs", "matchup": "Clemson Tigers @ Georgia Bulldogs", "line": -4.5, "side": "home", "result": None},
    ]}]}],
    "confidencePools": [{"id": "cp", "entries": [{"id": "ce", "history": [{"games": [
        # Confidence games never carry a CFBD id -> always "legacy".
        {"matchup": "Auburn Tigers @ Alabama Crimson Tide", "pick": "Alabama Crimson Tide", "result": None},
    ]}]}]}],
}
CFBD_ROWS = [{"id": 401, "provider_id": None, "cfbd_id": 401, "away": "Clemson", "home": "Georgia", "away_id": 1, "home_id": 2,
              "away_score": 17, "home_score": 31, "source": "cfbd"}]


def run(mode):
    calls = {"odds_scores": 0, "cfbd_years": [], "writes": []}
    store = {"users:u1": json.loads(json.dumps(USER))}
    mod._auth_mode = lambda handler: (mode, "u1" if mode == "user" else None)
    mod.rate_limited = lambda *a, **k: False
    mod.kv_keys = lambda pattern: ["users:u1"]
    mod.USER_KEY_PREFIX = "users:"
    mod.kv_get = lambda key: store.get(key)
    mod.cfbd_scores_for_year = lambda key, year: (calls["cfbd_years"].append(year) or (CFBD_ROWS, "live"))

    def fake_fetch_scores(key):
        calls["odds_scores"] += 1
        return []
    mod.fetch_scores = fake_fetch_scores

    def fake_cas(key, rev, body):
        calls["writes"].append(body)
        store[key] = dict(body, _rev=rev + 1)
        return "ok", rev + 1, None
    mod.cas_write = fake_cas
    os.environ["ODDS_API_KEY"] = "odds-key"
    os.environ["CFBD_API_KEY"] = "cfbd-key"

    class H(mod.handler):
        def __init__(self):
            self.path = "/api/grade_picks"
            self.headers = {}
            self.status = None
            self.body = None

        def _respond(self, status, data):
            self.status, self.body = status, data
    h = H()
    h.do_GET()
    return h, calls, store


saved = (mod._auth_mode, mod.rate_limited, mod.kv_keys, mod.kv_get, mod.cfbd_scores_for_year, mod.fetch_scores, mod.cas_write,
         mod.USER_KEY_PREFIX, os.environ.get("ODDS_API_KEY"), os.environ.get("CFBD_API_KEY"))
try:
    h, calls, store = run("cron")
    print(f"   cron: {h.status} {h.body}; Odds /scores calls {calls['odds_scores']}, CFBD years {calls['cfbd_years']}")
    check("cron with legacy picks + a confidence game pending does NOT call The Odds API", calls["odds_scores"] == 0)
    check("cron fetches CFBD finals for the current season instead", calls["cfbd_years"] == [season])
    pick = store["users:u1"]["history"][0]["entries"][0]["picks"][0]
    check("the legacy pick still grades automatically, name-matched against CFBD (Georgia 31-17, -4.5 -> W)", pick["result"] == "W")

    h, calls, store = run("user")
    print(f"   manual: {h.status}; Odds /scores calls {calls['odds_scores']}")
    check("a manual 'Check results now' with legacy items may still call The Odds API (exactly once)", calls["odds_scores"] == 1)
finally:
    (mod._auth_mode, mod.rate_limited, mod.kv_keys, mod.kv_get, mod.cfbd_scores_for_year, mod.fetch_scores, mod.cas_write,
     mod.USER_KEY_PREFIX, odds_key, cfbd_key) = saved
    for k, v in (("ODDS_API_KEY", odds_key), ("CFBD_API_KEY", cfbd_key)):
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v

if failures:
    print(f"\n{len(failures)} of {total[0]} FAILURE(S):", failures)
    raise SystemExit(1)
print(f"\nAll {total[0]} checks passed.")
