"""Regression tests for the server-side CFBD canonical identity payload."""
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone, timedelta

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,ROOT)
spec=importlib.util.spec_from_file_location("fetch_teams",os.path.join(ROOT,"api","fetch_teams.py"))
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

failures=[]; total=[0]
def check(name,cond):
    total[0]+=1; print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond: failures.append(name)

teams=json.dumps([
    {"id":194,"school":"Ohio State","abbreviation":"OSU","alternateNames":["Ohio State Buckeyes"],
     "conference":"Big Ten","division":"East","classification":"fbs","logos":["https://logo/osu.png"]},
    {"id":333,"school":"Logo-less State","conference":"Test","classification":"fbs","logos":[]},
]).encode()
games=json.dumps([
    {"id":401752000,"season":2026,"week":2,"seasonType":"regular","startDate":"2026-09-12T16:00:00Z",
     "completed":True,"homeId":194,"homeTeam":"Ohio State","homeConference":"Big Ten","homeClassification":"fbs",
     "awayId":999,"awayTeam":"Youngstown State","awayConference":"MVFC","awayClassification":"fcs"},
    {"id":401752001,"season":2026,"week":1,"seasonType":"regular","startDate":"2026-08-30T16:00:00Z",
     "homeId":57,"homeTeam":"Georgia","homeConference":"SEC","homeClassification":"fbs",
     "awayId":228,"awayTeam":"Clemson","awayConference":"ACC","awayClassification":"fbs",
     "neutralSite":True},
]).encode()

p=mod.build_identity_payload(teams,games,2026,"2026-08-18T22:00:00Z")
check("team identity keeps stable CFBD team id",p["teams"][0]["id"]==194)
check("team identity keeps aliases for safer external-name matching",p["teams"][0]["alternateNames"]==["Ohio State Buckeyes"])
check("team identity keeps canonical conference",p["teams"][0]["conference"]=="Big Ten")
check("logo is retained when present",p["teams"][0]["logo"]=="https://logo/osu.png")
check("team row is retained even if logo is missing",any(t["id"]==333 and t["logo"] is None for t in p["teams"]))
check("game identity keeps stable CFBD game id",p["games"][0]["id"]==401752000)
check("game identity keeps home/away team ids",p["games"][0]["homeId"]==194 and p["games"][0]["awayId"]==999)
check("FCS opponent identity survives even though team directory is FBS-only",p["games"][0]["awayClassification"]=="fcs")
check("game identity keeps season/week",p["games"][0]["season"]==2026 and p["games"][0]["week"]==2)
check("game identity keeps completed state for postgame hindsight protection",p["games"][0]["completed"] is True and p["games"][1]["completed"] is False)
check("payload includes independent team/game counts",p["count"]==2 and p["gameCount"]==2)

# Real HFA bug fix: neutralSite must pass through trim_games() -- without
# it, cfbdDerivedSpread() (app/js/cfbd-insights.js) has no way to know a
# game was played at a neutral site and silently applies a false 2.6pt
# home-field edge to whichever team CFBD calls "home".
check("neutral-site game keeps neutralSite=True",p["games"][1]["neutralSite"] is True)
check("true home game keeps neutralSite=False (CFBD omitted the field entirely)",p["games"][0]["neutralSite"] is False)

now=datetime(2026,8,18,22,0,tzinfo=timezone.utc)
check("fresh cache accepted within six hours",mod._identity_is_fresh({"fetchedAt":(now-timedelta(hours=5)).isoformat()},now))
check("cache becomes stale after six hours",not mod._identity_is_fresh({"fetchedAt":(now-timedelta(hours=7)).isoformat()},now))
check("malformed cache timestamp fails closed to refetch",not mod._identity_is_fresh({"fetchedAt":"nope"},now))

src=open(os.path.join(ROOT,"api","fetch_teams.py"),encoding="utf-8").read()
check("server uses current CFBD /teams/fbs endpoint",'"/teams/fbs"' in src)
check("server fetches CFBD /games for canonical game ids",'"/games"' in src and '"classification": "fbs"' in src)
check("identity cache is season-scoped",'CFBD_IDENTITY_CACHE_PREFIX' in src and ':{season}' in src)
check("stale identity fallback exists for provider outages",'stale["source"] = "stale"' in src)

# Social-export logo payload: use the canonical team-directory logo when
# present, and construct the trusted ESPN CDN URL from a CFBD/ESPN id when the
# opponent is schedule-only (e.g. FCS). Network is stubbed; this test only pins
# the resolver/shape, not ESPN availability.
seen=[]
_orig_logo_fetch=mod._fetch_logo_data_url
def _fake_logo_fetch(url):
    seen.append(url)
    return "data:image/png;base64,TEST"
mod._fetch_logo_data_url=_fake_logo_fetch
try:
    social=mod.build_social_logo_payload(p,[194,2449])
finally:
    mod._fetch_logo_data_url=_orig_logo_fetch
check("social logo payload returns requested ids as data URLs",social["logos"]["194"]=="data:image/png;base64,TEST" and social["logos"]["2449"]=="data:image/png;base64,TEST")
check("social logo resolver prefers CFBD directory URL when present","https://logo/osu.png" in seen)
check("social logo resolver falls back to ESPN CDN by canonical team id for schedule-only/FCS teams","https://a.espncdn.com/i/teamlogos/ncaa/500/2449.png" in seen)

if failures:
    print(f"\n{len(failures)} of {total[0]} FAILURE(S):",failures); raise SystemExit(1)
print(f"\nAll {total[0]} checks passed.")
