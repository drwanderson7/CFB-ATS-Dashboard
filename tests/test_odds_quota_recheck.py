"""Regression tests for the stuck shared-quota pause in api/fetch_odds.py
(Oct 26, 2026).

The bug: SHARED_QUOTA_FLOOR (50 then, 5 since Oct 27, 2026) compared against
the reqLeft saved in the shared cache, but reqLeft only changed after a real
shared-key /odds call -- which the floor blocks. Once it fell to 49 it could
never recover, even after
the monthly reset or a plan upgrade, and the clicker just quietly got the old
copy.

The fix, exercised here through the real do_GET() with the network and Redis
stubbed out:
  * a click blocked by the floor first re-reads the real remaining count with
    the free GET /v4/sports call and saves it to the shared cache (without
    touching the lines' own timestamps);
  * that free check runs at most once per hour system-wide;
  * if the budget is back above the floor, the normal /odds refresh runs;
  * if it's still low, the response is the latest shared copy flagged
    paused=True with the plain-language message.

Run with:
    python3 tests/test_odds_quota_recheck.py
"""
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("fetch_odds", os.path.join(ROOT, "api", "fetch_odds.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

failures = []
total = [0]


def check(name, cond):
    total[0] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


def iso(minutes_ago):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


EVENT = [{
    "id": "evt1", "home_team": "Georgia", "away_team": "Clemson",
    "commence_time": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
    "bookmakers": [{"key": "draftkings", "markets": [{"key": "spreads", "outcomes": [
        {"name": "Georgia", "point": -4.5}, {"name": "Clemson", "point": 4.5}]}]}],
}]


class World:
    """Fake Redis (one shared blob + fixed-window rate limits on a fake clock)
    and a fake Odds API that counts calls by endpoint."""

    def __init__(self, req_left, cached_age_min=600, cached=True, free_remaining="420"):
        self.clock = 0.0
        self.windows = {}
        self.blob = None
        if cached:
            self.blob = {
                "lastGames": [{"id": "old", "home": "Alabama", "away": "Auburn", "books": {"dk": -3.5}}],
                "lastRefresh": iso(cached_age_min), "reqLeft": req_left, "booksSeen": ["dk"],
                "preKickLines": {}, "sharedUpdatedAt": iso(cached_age_min),
            }
        self.free_remaining = free_remaining
        self.calls = {"sports": 0, "odds": 0, "sports_urls": []}

    def rate_limited(self, uid, bucket, limit, window_seconds):
        key = f"{bucket}:{uid}"
        start = self.windows.get(key)
        if start is not None and self.clock - start < window_seconds:
            return True
        self.windows[key] = self.clock
        return False

    def kv_get(self, key):
        return json.dumps(self.blob) if (key == mod.SHARED_ODDS_KEY and self.blob is not None) else None

    def kv_set(self, key, value_str):
        if key == mod.SHARED_ODDS_KEY:
            self.blob = json.loads(value_str)
        return True

    def urlopen(self, req, timeout=None):
        url = getattr(req, "full_url", str(req))
        world = self

        class Res:
            def __init__(self, body, remaining):
                self.status = 200
                self._body = body
                self.headers = {"x-requests-remaining": remaining}

            def read(self):
                return self._body

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        # The paid /v4/sports/{sport}/odds URL also starts with /v4/sports/,
        # so classify it first.
        if "/odds?" in url:
            world.calls["odds"] += 1
            return Res(json.dumps(EVENT).encode(), str(int(world.free_remaining or 0) - 1))
        if url.startswith(mod.SPORTS_LIST_URL + "?"):
            world.calls["sports"] += 1
            world.calls["sports_urls"].append(url)
            return Res(b"[]", world.free_remaining)
        raise AssertionError("unexpected outbound call: " + url)


class FakeHandler(mod.handler):
    def __init__(self, path="/api/fetch_odds", headers=None):
        self.path = path
        self.headers = headers or {}
        self._status = None
        self._body = None

    def _respond(self, status, data, extra_headers=None):
        self._status = status
        self._body = data


def install(world):
    mod.rate_limited = world.rate_limited
    mod._kv_get = world.kv_get
    mod._kv_set = world.kv_set
    mod._kv_creds = lambda: ("https://kv.example", "token")
    mod.urllib.request.urlopen = world.urlopen
    mod.verify_user = lambda handler: "user-1"
    os.environ["ODDS_API_KEY"] = "shared-key"


def click(world, uid="user-1"):
    mod.verify_user = lambda handler: uid
    h = FakeHandler()
    h.do_GET()
    return h


# Values relative to the real floor, so these keep exercising the pause
# whatever SHARED_QUOTA_FLOOR is set to.
FLOOR = mod.SHARED_QUOTA_FLOOR
BELOW = FLOOR - 1

orig = (mod.rate_limited, mod._kv_get, mod._kv_set, mod._kv_creds, mod.urllib.request.urlopen, mod.verify_user,
        os.environ.get("ODDS_API_KEY"))
try:
    # --- Recovery: the monthly reset happened, the saved count is still stuck below the floor.
    w = World(req_left=BELOW, free_remaining="420")
    install(w)
    h = click(w)
    print(f"   recovery click: status {h._status}, calls {w.calls['sports']} free / {w.calls['odds']} odds")
    check(f"blocked by the floor ({BELOW} < {FLOOR}), the click first runs the free GET /v4/sports check", w.calls["sports"] == 1)
    check("the free check asks /v4/sports with the shared key and nothing else that costs quota",
          w.calls["sports_urls"][0].startswith("https://api.the-odds-api.com/v4/sports/?") and "apiKey=shared-key" in w.calls["sports_urls"][0]
          and "/odds" not in w.calls["sports_urls"][0])
    check("the budget is back (420), so the normal /odds refresh runs once and returns fresh lines",
          w.calls["odds"] == 1 and h._status == 200 and not h._body.get("paused") and h._body["games"][0]["home"] == "Georgia")
    check(f"the shared cache now holds the fresh count, not the stuck {BELOW}", int(w.blob["reqLeft"]) >= FLOOR)

    # --- Still low: the free check confirms the budget is nearly used up.
    w = World(req_left=BELOW, free_remaining=str(BELOW - 1), cached_age_min=600)
    install(w)
    before_updated = w.blob["sharedUpdatedAt"]
    h = click(w)
    check("still below the floor: no /odds call is spent", w.calls["odds"] == 0 and w.calls["sports"] == 1)
    check("the fresh (still low) count is saved", w.blob["reqLeft"] == BELOW - 1 and "reqLeftCheckedAt" in w.blob)
    check("saving the count leaves the lines' own timestamps alone", w.blob["sharedUpdatedAt"] == before_updated)
    check("the clicker gets the latest shared copy flagged paused, with the plain-language message",
          h._status == 200 and h._body.get("paused") is True
          and h._body.get("pausedMessage") == "Live lines are paused — the shared odds budget is nearly used up."
          and h._body["games"][0]["id"] == "old" and h._body.get("lastRefresh") == w.blob["lastRefresh"])
    check("a paused copy older than the 6-hour stale bound is still shown (with its time) rather than an error",
          (datetime.now(timezone.utc) - datetime.fromisoformat(h._body["lastRefresh"])).total_seconds() > 6 * 3600)

    # --- At most once an hour, system-wide.
    w.clock += 10 * 60
    h2 = click(w, uid="user-2")
    check("a second click 10 minutes later (another person) does NOT run the free check again",
          w.calls["sports"] == 1 and w.calls["odds"] == 0 and h2._body.get("paused") is True)
    w.clock += 55 * 60
    w.free_remaining = "500"
    h3 = click(w, uid="user-3")
    check("after the hour is up the free check runs again, sees the reset, and the refresh goes through",
          w.calls["sports"] == 2 and w.calls["odds"] == 1 and not h3._body.get("paused"))

    # --- Just above the new floor (Oct 27, 2026): a budget of 10, which the old
    # floor of 50 would have paused, is spent normally.
    w = World(req_left=10, free_remaining="10")
    install(w)
    h = click(w)
    check("10 requests left: refreshes normally (the old floor of 50 paused here)",
          w.calls["sports"] == 0 and w.calls["odds"] == 1 and not h._body.get("paused"))

    # --- Healthy budget: the free check never runs.
    w = World(req_left=300, free_remaining="300")
    install(w)
    h = click(w)
    check("above the floor: no free check, just the normal refresh", w.calls["sports"] == 0 and w.calls["odds"] == 1)

    # --- A failed free check is safe: stays paused, logs, no /odds spend.
    w = World(req_left=BELOW)
    install(w)

    def broken(req, timeout=None):
        raise mod.urllib.error.URLError("down")
    mod.urllib.request.urlopen = broken
    errs = []
    orig_log = mod._log_server_error
    mod._log_server_error = lambda ctx, exc: errs.append(ctx)
    h = click(w)
    mod._log_server_error = orig_log
    check("if the free check itself fails, lines stay paused (no /odds spend) and the failure is logged",
          h._body.get("paused") is True and errs == ["fetch_odds quota recheck"])
finally:
    (mod.rate_limited, mod._kv_get, mod._kv_set, mod._kv_creds, mod.urllib.request.urlopen, mod.verify_user, key) = orig
    if key is None:
        os.environ.pop("ODDS_API_KEY", None)
    else:
        os.environ["ODDS_API_KEY"] = key

src = open(os.path.join(ROOT, "api", "fetch_odds.py"), encoding="utf-8").read()
check("the hourly check uses a GLOBAL rate-limit key, not the caller's uid",
      'rate_limited("__global__", "odds_quota_recheck", 1, QUOTA_RECHECK_SECONDS)' in src and mod.QUOTA_RECHECK_SECONDS == 3600)

if failures:
    print(f"\n{len(failures)} of {total[0]} FAILURE(S):", failures)
    raise SystemExit(1)
print(f"\nAll {total[0]} checks passed.")
