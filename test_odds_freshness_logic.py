"""Dynamic odds-cache freshness tests."""
import datetime, importlib.util, os, sys
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,ROOT)
spec=importlib.util.spec_from_file_location("fetch_odds",os.path.join(ROOT,"api","fetch_odds.py"))
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
fail=[]; total=0
def check(name,cond):
    global total
    total+=1; print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond: fail.append(name)
now=datetime.datetime(2026,9,5,12,0,tzinfo=datetime.timezone.utc)
def g(minutes):
    return {"commence":(now+datetime.timedelta(minutes=minutes)).isoformat()}
check(">24h stays at 30 minutes",mod.odds_fresh_minutes([g(1500)],now)==30)
check("within 24h tightens to 15 minutes",mod.odds_fresh_minutes([g(1200)],now)==15)
check("within 6h tightens to 10 minutes",mod.odds_fresh_minutes([g(300)],now)==10)
check("within 1h tightens to 5 minutes",mod.odds_fresh_minutes([g(45)],now)==5)
check("nearest future game controls the window",mod.odds_fresh_minutes([g(2000),g(50),g(400)],now)==5)
check("already-started games are ignored",mod.odds_fresh_minutes([g(-10),g(700)],now)==15)
check("no future games falls back to 30 minutes",mod.odds_fresh_minutes([g(-10)],now)==30)
if fail: print(f"\n{len(fail)} of {total} FAILURE(S):",fail); raise SystemExit(1)
print(f"\nAll {total} checks passed.")
