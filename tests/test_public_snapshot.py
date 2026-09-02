"""Regression tests for the unauthenticated Snapshot preview.

The critical production regression this protects: guest Snapshot originally
read a shared odds cache that only signed-in users could refresh. Once that
cache aged out, every new visitor got "Live data is warming up" indefinitely.
The public odds view may now self-warm the SAME shared odds cache, but only
behind a global Redis cooldown and shared quota floor.
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

failures=[]
total=[0]
def check(name, cond):
    total[0]+=1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond: failures.append(name)
def iso(age_minutes):
    return (datetime.now(timezone.utc)-timedelta(minutes=age_minutes)).isoformat()

fresh_odds={
    "lastGames":{"g1":{"id":"g1","home":"Alabama","away":"Auburn","books":{"dk":-3.5}}},
    "lastRefresh":iso(2),"reqLeft":812,"booksSeen":["dk","fd"],
    "preKickLines":{"g1":{"books":{"dk":-3.5}}},"sharedUpdatedAt":iso(2),
}

# --- odds cache + self-warm -------------------------------------------------
orig_get=mod._kv_get_json
orig_set=mod._kv_set_json
orig_fetch=mod._fetch_live_odds
orig_rate=mod.rate_limited
orig_key=os.environ.get("ODDS_API_KEY")
try:
    os.environ.pop("ODDS_API_KEY",None)
    mod._kv_get_json=lambda key: None
    out=mod.build_odds_view()
    check("odds: empty cache without server key is honestly not-ready", out.get("ready") is False)

    mod._kv_get_json=lambda key: fresh_odds
    out=mod.build_odds_view()
    check("odds: fresh shared cache is ready", out.get("ready") is True and out.get("source")=="cache")
    check("odds: public response never leaks reqLeft", "reqLeft" not in out)
    check("odds: public response never leaks preKickLines", "preKickLines" not in out)
    check("odds: public market games/books pass through", out.get("games")==fresh_odds["lastGames"] and out.get("booksSeen")==["dk","fd"])

    stale=dict(fresh_odds,sharedUpdatedAt=iso(mod.MAX_AGE_MINUTES_ODDS+5))
    mod._kv_get_json=lambda key: stale
    out=mod.build_odds_view()
    check("odds: bounded stale cache remains usable when warming is impossible", out.get("ready") is True and out.get("stale") is True)

    # Real self-warm path: stale cache + server key + global cooldown available.
    os.environ["ODDS_API_KEY"]="server-test-key"
    calls={"fetch":0,"set":0}
    event=[{
        "id":"evt-new","home_team":"Georgia","away_team":"Clemson","commence_time":iso(-120),
        "bookmakers":[{"key":"draftkings","markets":[{"key":"spreads","outcomes":[{"name":"Georgia","point":-4.5},{"name":"Clemson","point":4.5}]}]}],
    }]
    mod._kv_get_json=lambda key: stale
    mod.rate_limited=lambda bucket,limit,window: False
    def fake_fetch(key):
        calls["fetch"]+=1
        return 200,json.dumps(event).encode(),"799"
    mod._fetch_live_odds=fake_fetch
    def fake_set(key,value):
        calls["set"]+=1
        return True
    mod._kv_set_json=fake_set
    out=mod.build_odds_view()
    check("odds: stale cache self-warms from provider instead of permanent warming screen", out.get("ready") is True and out.get("source")=="live-warm")
    check("odds: self-warm performs one provider call and persists shared cache", calls=={"fetch":1,"set":1})
    check("odds: self-warmed payload has extracted real bookmaker line", out["games"][0]["books"]["draftkings"]==-4.5)

    # Quota protection: known low shared quota must never spend another call.
    low_quota=dict(stale,sharedUpdatedAt=iso(mod.MAX_AGE_MINUTES_ODDS+5),reqLeft=mod.PUBLIC_ODDS_QUOTA_FLOOR-1)
    mod._kv_get_json=lambda key: low_quota
    calls["fetch"]=0
    out=mod.build_odds_view()
    check("odds: quota floor blocks anonymous upstream spend", calls["fetch"]==0 and out.get("ready") is True and out.get("stale") is True)

    # Global cooldown: with no stale fallback, another visitor gets short not-ready,
    # but cannot trigger a second paid request during the cooldown.
    mod._kv_get_json=lambda key: None
    mod.rate_limited=lambda bucket,limit,window: bucket=="__global_odds_warm__"
    calls["fetch"]=0
    out=mod.build_odds_view()
    check("odds: global cooldown prevents one paid fetch per anonymous visitor", calls["fetch"]==0 and out.get("ready") is False and out.get("reason")=="odds-warm-in-progress")
finally:
    mod._kv_get_json=orig_get
    mod._kv_set_json=orig_set
    mod._fetch_live_odds=orig_fetch
    mod.rate_limited=orig_rate
    if orig_key is None: os.environ.pop("ODDS_API_KEY",None)
    else: os.environ["ODDS_API_KEY"]=orig_key

# --- predictions view remains narrow (guest UI currently does not call it) --
fresh_preds={
    "predictions":[
        {"home":"Alabama","road":"Auburn","systems":{"sag":-6.5,"fpi":-7.0,"donchess":-5.5}},
        {"home":"Georgia","road":"Florida","systems":{"fpi":-3.0}},
    ],
    "predMeta":{"fetchedAt":iso(1),"count":2},"sharedUpdatedAt":iso(1),
}
mod._kv_get_json=lambda key:fresh_preds
out=mod.build_predictions_view()
check("predictions: ready with narrow allowed data", out.get("ready") is True)
check("predictions: exposes only sag, never full prediction system set", out.get("systems")==["sag"] and set(out["games"][0]["systems"])=={"sag"})
check("predictions: drops games lacking the allowed public system", out.get("count")==1)

# --- ratings/SP+ -------------------------------------------------------------
fresh_ratings={
    "year":2026,"fetchedAt":iso(1),
    "ratings":[
        {"team":"Alabama","conference":"SEC","sp":{"rating":24.1,"ranking":3},"core":{"overall":1},"fpi":{"fpi":20}},
        {"team":"No SP Team","conference":"SEC","sp":None,"core":{"overall":1}},
    ],
}
mod._kv_get_json=lambda key:fresh_ratings
out=mod.build_ratings_view(2026)
check("ratings: fresh SP+ cache is ready", out.get("ready") is True)
check("ratings: team without SP+ is dropped", len(out["ratings"])==1 and out["ratings"][0]["team"]=="Alabama")
check("ratings: public team block exposes only team/conference/sp", set(out["ratings"][0])=={"team","conference","sp"})
stale_ratings=dict(fresh_ratings,fetchedAt=iso(mod.MAX_AGE_MINUTES_RATINGS+1))
mod._kv_get_json=lambda key:stale_ratings
check("ratings: stale ratings do not silently pass", mod.build_ratings_view(2026)=={"ready":False})

# --- handler dispatch / rate limiting ---------------------------------------
class FakeHandler(mod.handler):
    def __init__(self,path):
        self.path=path; self.headers={}; self._status=None; self._body=None
    def _respond(self,status,data):
        self._status=status; self._body=data
orig_rate=mod.rate_limited
mod.rate_limited=lambda bucket,limit,window:False
mod._kv_get_json=lambda key:fresh_odds
h=FakeHandler("/api/public_snapshot?view=odds"); h.do_GET()
check("handler: view=odds returns ready 200", h._status==200 and h._body.get("ready") is True)
h2=FakeHandler("/api/public_snapshot?view=bogus"); h2.do_GET()
check("handler: bogus view rejected", h2._status==400)
h3=FakeHandler("/api/public_snapshot"); h3.do_GET()
check("handler: missing view rejected", h3._status==400)
mod.rate_limited=lambda bucket,limit,window:True
h4=FakeHandler("/api/public_snapshot?view=odds"); h4.do_GET()
check("handler: per-IP hammer gets 429", h4._status==429)
mod.rate_limited=orig_rate

class H:
    def __init__(self,headers): self.headers=headers
check("client_ip: first forwarded hop", mod.client_ip(H({"x-forwarded-for":"203.0.113.5, 10.0.0.1"}))=="203.0.113.5")
check("client_ip: safe shared fallback", mod.client_ip(H({}))=="__unknown__")

# --- Structural security/cost contract --------------------------------------
src=open(os.path.join(ROOT,"api","public_snapshot.py"),encoding="utf-8").read()
first=src.index('"""'); second=src.index('"""',first+3)
code_only=src[:first]+src[second+3:]
code_only="\n".join(ln for ln in code_only.splitlines() if not ln.strip().startswith("#"))
check("structural: public odds warm is explicitly the only upstream provider domain", "api.the-odds-api.com" in code_only)
check("structural: public endpoint still never calls CFBD upstream", "collegefootballdata.com" not in code_only)
check("structural: public endpoint never calls prediction tracker upstream", "thepredictiontracker.com" not in code_only)
check("structural: public response keeps quota/pre-kick internals out", '"reqLeft"' not in src[src.index('def _public_odds_body'):src.index('def _merge_public_odds_cache')])
check("structural: ready public responses are CDN-cacheable", "public, max-age=" in code_only and "private, no-store" not in code_only)
check("structural: warm has global cooldown + quota floor", "__global_odds_warm__" in code_only and "PUBLIC_ODDS_QUOTA_FLOOR" in code_only)

print(f"\n{total[0]-len(failures)}/{total[0]} checks passed")
if failures:
    print("\nFAILURES:")
    for f in failures: print(" -",f)
    sys.exit(1)
