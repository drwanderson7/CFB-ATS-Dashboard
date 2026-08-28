"""Regression tests for server-side last-pre-kick market capture."""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("fetch_odds", os.path.join(ROOT, "api", "fetch_odds.py"))
fetch_odds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch_odds)

failures=[]
total=[0]
def check(name, cond):
    total[0]+=1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond: failures.append(name)

def game(gid="g1", commence="2026-09-05T16:00:00Z", books=None):
    return {"id":gid,"away":"Team A","home":"Team B","commence":commence,"books":books or {"draftkings":-6.5,"fanduel":-7}}

# Pre-kick observations update each currently visible bookmaker.
r=fetch_odds.merge_pre_kick_lines({}, [game()], "2026-09-05T15:30:00+00:00")
check("pre-kick fetch creates a retained record keyed by provider game id", "g1" in r)
check("pre-kick fetch captures every bookmaker line", r["g1"]["books"]=={"draftkings":-6.5,"fanduel":-7})
check("pre-kick fetch records per-book observation timestamps", r["g1"]["bookObservedAt"]["draftkings"]=="2026-09-05T15:30:00+00:00")

# A later pre-kick refresh advances lines and keeps a book that temporarily
# disappears, preserving that book's own last observed quote.
r2=fetch_odds.merge_pre_kick_lines(r, [game(books={"draftkings":-8})], "2026-09-05T15:59:00+00:00")
check("later pre-kick refresh updates the latest line", r2["g1"]["books"]["draftkings"]==-8)
check("book absent from the latest pull retains its own prior last-pre-kick quote", r2["g1"]["books"]["fanduel"]==-7)
check("per-book timestamp advances only for a book actually observed again", r2["g1"]["bookObservedAt"]["fanduel"]=="2026-09-05T15:30:00+00:00")

# At/after kickoff nothing is allowed to replace the close.
r3=fetch_odds.merge_pre_kick_lines(r2, [game(books={"draftkings":-10,"fanduel":-10})], "2026-09-05T16:00:00+00:00")
check("a quote observed exactly at kickoff cannot overwrite the pre-kick close", r3["g1"]["books"]["draftkings"]==-8)
r4=fetch_odds.merge_pre_kick_lines(r3, [game(books={"draftkings":-12})], "2026-09-05T16:15:00+00:00")
check("an in-game/post-kick quote cannot overwrite the pre-kick close", r4["g1"]["books"]["draftkings"]==-8)

# Records survive a later response where the game disappears entirely.
r5=fetch_odds.merge_pre_kick_lines(r4, [], "2026-09-06T12:00:00+00:00")
check("closing record survives after the event disappears from the live odds feed", "g1" in r5 and r5["g1"]["books"]["draftkings"]==-8)

# But stale records are pruned eventually to bound shared-cache growth.
r6=fetch_odds.merge_pre_kick_lines(r5, [], "2026-10-20T12:00:00+00:00")
check("records older than retention window are pruned", "g1" not in r6)

if failures:
    print(f"\n{len(failures)} of {total[0]} FAILURE(S):", failures)
    raise SystemExit(1)
print(f"\nAll {total[0]} checks passed.")
