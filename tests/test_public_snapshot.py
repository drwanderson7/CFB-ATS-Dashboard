"""Regression tests for the unauthenticated Snapshot preview.

The public endpoint is a READ-ONLY window into the shared caches. Since
Oct 26, 2026 lines come from The Odds API only on a signed-in Refresh lines
click, so the public odds view serves the latest shared copy (stale-flagged
past MAX_AGE_MINUTES_ODDS, withheld past PUBLIC_ODDS_MAX_SERVE_MINUTES) and
never calls the provider -- the old guest "self-warm" is gone.
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

# --- odds: shared cache only, never upstream ---------------------------------
orig_get=mod._kv_get_json
orig_key=os.environ.get("ODDS_API_KEY")
orig_urlopen=mod.urllib.request.urlopen
upstream_calls=[]
def no_upstream(req,*a,**k):
    url=getattr(req,"full_url",str(req))
    upstream_calls.append(url)
    raise AssertionError("public_snapshot must not call out: "+url)
try:
    os.environ["ODDS_API_KEY"]="server-test-key"   # even with a server key present
    mod.urllib.request.urlopen=no_upstream
    mod._kv_get_json=lambda key: None
    out=mod.build_odds_view()
    check("odds: empty cache is honestly not-ready (no warm-up call)", out.get("ready") is False and not upstream_calls)

    mod._kv_get_json=lambda key: fresh_odds
    out=mod.build_odds_view()
    check("odds: fresh shared cache is ready", out.get("ready") is True and out.get("source")=="cache" and out.get("stale") is False)
    check("odds: public response never leaks reqLeft", "reqLeft" not in out)
    check("odds: public response never leaks preKickLines", "preKickLines" not in out)
    check("odds: public market games/books pass through", out.get("games")==fresh_odds["lastGames"] and out.get("booksSeen")==["dk","fd"])
    check("odds: lastRefresh passes through so the page can say when lines were updated", out.get("lastRefresh")==fresh_odds["lastRefresh"])

    stale=dict(fresh_odds,sharedUpdatedAt=iso(3*24*60))   # three days old
    mod._kv_get_json=lambda key: stale
    out=mod.build_odds_view()
    check("odds: a days-old shared copy is still served, marked stale, with no provider call",
          out.get("ready") is True and out.get("stale") is True and not upstream_calls)

    too_old=dict(fresh_odds,sharedUpdatedAt=iso(mod.PUBLIC_ODDS_MAX_SERVE_MINUTES+5))
    mod._kv_get_json=lambda key: too_old
    out=mod.build_odds_view()
    check("odds: a copy older than a week is withheld (not-ready), still no provider call",
          out.get("ready") is False and not upstream_calls)
finally:
    mod._kv_get_json=orig_get
    mod.urllib.request.urlopen=orig_urlopen
    if orig_key is None: os.environ.pop("ODDS_API_KEY",None)
    else: os.environ["ODDS_API_KEY"]=orig_key

# --- predictions view: exposes sag + wayward only (Sept 8, 2026, widened
# from sag-only so a guest has a real shot at PickGauge Model #'s
# unchanged 3-of-5-system floor -- see api/public_snapshot.py's own
# docstring and PUBLIC_PREDICTION_SYSTEMS for the full reasoning) --
fresh_preds={
    "predictions":[
        {"home":"Alabama","road":"Auburn","systems":{"sag":-6.5,"wayward":-7.2,"fpi":-7.0,"donchess":-5.5}},
        {"home":"Georgia","road":"Florida","systems":{"fpi":-3.0}},
    ],
    "predMeta":{"fetchedAt":iso(1),"count":2},"sharedUpdatedAt":iso(1),
}
mod._kv_get_json=lambda key:fresh_preds
out=mod.build_predictions_view()
check("predictions: ready with narrow allowed data", out.get("ready") is True)
check("predictions: exposes exactly sag + wayward, never the full prediction system set", set(out.get("systems") or [])=={"sag","wayward"} and set(out["games"][0]["systems"])=={"sag","wayward"})
check("predictions: drops games lacking BOTH allowed public systems", out.get("count")==1)

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
check("structural: public endpoint never calls The Odds API (no self-warm)", "api.the-odds-api.com" not in code_only and "ODDS_API_KEY" not in code_only)
check("structural: public endpoint still never calls CFBD upstream", "collegefootballdata.com" not in code_only)
check("structural: public endpoint never calls prediction tracker upstream", "thepredictiontracker.com" not in code_only)
check("structural: public response keeps quota/pre-kick internals out", '"reqLeft"' not in src[src.index('def _public_odds_body'):src.index('def build_odds_view')])
check("structural: ready public responses are CDN-cacheable", "public, max-age=" in code_only and "private, no-store" not in code_only)
check("structural: the warm-up machinery is gone", "_warm_public_odds" not in code_only and "__global_odds_warm__" not in code_only)

print(f"\n{total[0]-len(failures)}/{total[0]} checks passed")
if failures:
    print("\nFAILURES:")
    for f in failures: print(" -",f)
    sys.exit(1)
