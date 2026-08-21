"""Regression tests for api/fetch_odds.py's shared-key usage-protection
fix. The shared ODDS_API_KEY is now the DEFAULT for every signed-in
person (no personal key required -- "baked into the tool for all
users"), which means protecting Drew's own real-money-funded quota
matters far more than when each person had a separate budget. Two real
gaps this addresses:
  1. Thundering herd: many different people all deciding "cache is
     stale, fetch upstream" in the same instant -- the per-user cooldown
     alone does nothing here, since it's a DIFFERENT person's request
     each time.
  2. Quota exhaustion: nothing previously stopped ordinary usage from
     running the shared key's monthly quota to zero, silently breaking
     live odds for every signed-in person at once.
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


def blob(age_minutes=1, req_left=200, games=None):
    ts = (datetime.now(timezone.utc) - timedelta(minutes=age_minutes)).isoformat()
    return json.dumps({
        "lastGames": games if games is not None else [{"id": "g1", "home": "A", "away": "B", "books": {"dk": -3.5}}],
        "lastRefresh": ts,
        "reqLeft": req_left,
        "booksSeen": ["dk"],
        "preKickLines": {},
        "sharedUpdatedAt": ts,
    })


# --- _parse_shared_odds_blob(): shared parsing primitive -------------------
check("_parse_shared_odds_blob(): None for empty/missing raw value", mod._parse_shared_odds_blob(None) is None and mod._parse_shared_odds_blob("") is None)
check("_parse_shared_odds_blob(): None for malformed JSON, doesn't throw", mod._parse_shared_odds_blob("{not json") is None)
check("_parse_shared_odds_blob(): None when lastGames is missing/empty (nothing real cached yet)", mod._parse_shared_odds_blob(json.dumps({"lastGames": []})) is None)
parsed = mod._parse_shared_odds_blob(blob(age_minutes=3))
check("_parse_shared_odds_blob(): returns (current, age_minutes) for a real blob", parsed is not None and parsed[0]["reqLeft"] == 200 and 2.9 < parsed[1] < 3.1)

# --- _stale_shared_odds_any_age(): ignores the normal freshness window -----
mod._kv_get = lambda key: blob(age_minutes=90)  # well past the normal 30-min window
check("_stale_shared_odds_any_age(): serves data far past the normal freshness window (that window is a quota-conservation choice, not a usability cutoff)",
  mod._stale_shared_odds_any_age() is not None)
mod._kv_get = lambda key: blob(age_minutes=mod.STALE_ODDS_MAX_MINUTES + 10)
check("_stale_shared_odds_any_age(): still refuses to serve something genuinely ancient, past STALE_ODDS_MAX_MINUTES",
  mod._stale_shared_odds_any_age() is None)
mod._kv_get = lambda key: None
check("_stale_shared_odds_any_age(): None when there's nothing cached at all (first request ever) -- caller falls through to a real error, not a fabricated response",
  mod._stale_shared_odds_any_age() is None)

# --- _shared_reqLeft(): quota-floor peek, ignores freshness -----------------
mod._kv_get = lambda key: blob(age_minutes=90, req_left=12)
check("_shared_reqLeft(): reads the last known remaining-calls count even from a STALE blob (the floor check has to work exactly when a real call is about to be spent)",
  mod._shared_reqLeft() == 12)
mod._kv_get = lambda key: blob(req_left=None)
check("_shared_reqLeft(): None (never blocks) when the provider hasn't returned a remaining-calls count yet, rather than treating missing data as zero",
  mod._shared_reqLeft() is None)
mod._kv_get = lambda key: None
check("_shared_reqLeft(): None when there's no cache at all yet",
  mod._shared_reqLeft() is None)

# --- Structural: do_GET() actually wires the global lock + quota floor -----
src = open(os.path.join(ROOT, "api", "fetch_odds.py"), encoding="utf-8").read()
check("do_GET() only applies the global lock/quota-floor path when using the SHARED key (personal key skips both -- it's that person's own budget, not the pool's)",
  "if not personal_key:" in src and src.count("if not personal_key:") >= 1)
check("the global upstream lock uses a constant pseudo-uid ('__global__'), not the real per-request uid -- otherwise it would just be another per-user limiter, not a system-wide one",
  'rate_limited("__global__", "odds_upstream_shared", 1, GLOBAL_UPSTREAM_MIN_SECONDS)' in src)
check("losing the global-lock race falls back to _stale_shared_odds_any_age() before giving up with a 429 -- someone else's in-flight fetch should be usable, not wasted",
  "if rate_limited(\"__global__\"" in src and "fallback = _stale_shared_odds_any_age()" in src)
check("the quota floor compares against SHARED_QUOTA_FLOOR and also falls back to stale data before refusing outright",
  "known_left < SHARED_QUOTA_FLOOR" in src)
check("the quota-floor refusal message tells the person they can add their own personal key to bypass it, not just a bare error",
  "Add your own personal API key in Settings to bypass this" in src)
check("GLOBAL_UPSTREAM_MIN_SECONDS is a real number of seconds, not accidentally left as minutes (would be far too aggressive a lock)",
  mod.GLOBAL_UPSTREAM_MIN_SECONDS == 5)
check("SHARED_QUOTA_FLOOR is a sane, non-trivial safety margin (not 0, not absurdly high)",
  0 < mod.SHARED_QUOTA_FLOOR < 500)

if failures:
    print(f"\n{len(failures)} of {total[0]} FAILURE(S):", failures)
    raise SystemExit(1)
print(f"\nAll {total[0]} checks passed.")
