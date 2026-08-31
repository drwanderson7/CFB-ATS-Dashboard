"""Regression checks for CFBD scoreboard/ratings proxy + canonical grading."""
import importlib.util
import os
import pathlib
import sys

ROOT=pathlib.Path(__file__).resolve().parents[1]

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path)
    mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod

api=load("fetch_cfbd_test","api/fetch_cfbd.py")
grader=load("grade_cfbd_test","api/grade_picks.py")
fail=[]; total=0
def check(name,cond):
    global total
    total+=1; print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond: fail.append(name)

scoreboard=[{
    "id":401,"startDate":"2026-09-05T16:00:00Z","status":"in_progress","period":3,"clock":"8:24",
    "homeTeam":{"id":333,"name":"Alabama","points":17,"conference":"SEC","classification":"fbs","winProbability":.71},
    "awayTeam":{"id":2633,"name":"Tennessee","points":13,"conference":"SEC","classification":"fbs","winProbability":.29},
    "betting":{"spread":-6.5},"weather":{"temperature":84},"venue":{"name":"Bryant-Denny"}
}]
trim=api.trim_scoreboard(scoreboard)
check("scoreboard trim preserves canonical game id and live state",trim[0]["id"]==401 and trim[0]["status"]=="in_progress" and trim[0]["clock"]=="8:24")
check("scoreboard trim preserves canonical team ids + points",trim[0]["homeTeam"]["id"]==333 and trim[0]["awayTeam"]["points"]==13)

payloads={
 "core":[
   {"year":2026,"throughWeek":2,"team":"Alabama","conference":"SEC","overall":12,"offense":15,"defense":3,"modelVersion":"a"},
   {"year":2026,"throughWeek":4,"team":"Alabama","conference":"SEC","overall":18,"offense":21,"defense":3,"modelVersion":"b"},
 ],
 "sp":[{"year":2026,"team":"Alabama","conference":"SEC","rating":20.1,"ranking":3,"sos":5.2,"offense":{"rating":24},"defense":{"rating":4},"specialTeams":{"rating":.1}}],
 "srs":[{"year":2026,"team":"Alabama","conference":"SEC","rating":17.4,"ranking":4}],
 "elo":[{"year":2026,"team":"Alabama","conference":"SEC","elo":1912}],
 "fpi":[{"year":2026,"team":"Alabama","conference":"SEC","fpi":19.3,"efficiencies":{"overall":88,"offense":91,"defense":84}}],
}
merged=api.merge_ratings(payloads,2026)
a=merged[0]
check("ratings merge keeps latest CORE through-week snapshot",a["core"]["throughWeek"]==4 and a["core"]["overall"]==18)
check("ratings merge includes SP+, SRS, Elo and FPI",a["sp"]["rating"]==20.1 and a["srs"]["rating"]==17.4 and a["elo"]["elo"]==1912 and a["fpi"]["fpi"]==19.3)

# --- Matchup Intelligence v2: trim_advanced_team() -------------------------
# The 2026 populated response now matches CFBD's documented AdvancedSeasonStat
# schema. Pin the fields v2 actually needs, including offense/defense havoc
# and play counts used for early-season sample-size disclosure.
raw_advanced_row={
    "season":2026,"team":"Alabama","conference":"SEC",
    "offense":{
        "ppa":0.38,"successRate":0.481,"explosiveness":1.32,"plays":71,"drives":11,"stuffRate":0.14,"lineYards":2.9,
        "havoc":{"total":0.09,"frontSeven":0.06,"db":0.03},
        "standardDowns":{"ppa":0.31,"successRate":0.52,"explosiveness":1.1},
        "passingDowns":{"ppa":0.45,"successRate":0.38,"explosiveness":1.6},
        "rushingPlays":{"ppa":0.22,"successRate":0.49,"explosiveness":0.9},
        "passingPlays":{"ppa":0.51,"successRate":0.47,"explosiveness":1.7},
    },
    "defense":{
        "ppa":0.05,"successRate":0.352,"explosiveness":1.02,"plays":66,"drives":10,"stuffRate":0.22,"lineYards":2.1,
        "standardDowns":{"ppa":0.02,"successRate":0.33,"explosiveness":0.95},
        "passingDowns":{"ppa":0.09,"successRate":0.36,"explosiveness":1.15},
        "rushingPlays":{"ppa":0.01,"successRate":0.31,"explosiveness":0.85},
        "passingPlays":{"ppa":0.11,"successRate":0.38,"explosiveness":1.25},
        "havoc":{"total":0.19,"frontSeven":0.12,"db":0.07},
    },
}
trimmed=api.trim_advanced_team(raw_advanced_row,"fbs")
check("trim_advanced_team keeps team/conference/classification",trimmed["team"]=="Alabama" and trimmed["conference"]=="SEC" and trimmed["classification"]=="fbs")
check("trim_advanced_team keeps top-level offense ppa/successRate/explosiveness",
      trimmed["offense"]["ppa"]==0.38 and trimmed["offense"]["successRate"]==0.481 and trimmed["offense"]["explosiveness"]==1.32)
check("trim_advanced_team keeps offense plays/drives for sample-size disclosure",
      trimmed["offense"]["plays"]==71 and trimmed["offense"]["drives"]==11)
check("trim_advanced_team keeps offense stuffRate/lineYards",
      trimmed["offense"]["stuffRate"]==0.14 and trimmed["offense"]["lineYards"]==2.9)
check("trim_advanced_team keeps offense standardDowns/passingDowns/rushingPlays/passingPlays splits",
      trimmed["offense"]["passingPlays"]["successRate"]==0.47 and trimmed["offense"]["rushingPlays"]["ppa"]==0.22)
check("trim_advanced_team keeps defense's own top-level splits (opponent output allowed)",
      trimmed["defense"]["successRate"]==0.352 and trimmed["defense"]["passingDowns"]["successRate"]==0.36)
check("trim_advanced_team keeps offensive havoc allowed (total/frontSeven/db)",
      trimmed["offense"]["havoc"]=={"total":0.09,"frontSeven":0.06,"db":0.03})
check("trim_advanced_team keeps defensive havoc generated (total/frontSeven/db)",
      trimmed["defense"]["havoc"]=={"total":0.19,"frontSeven":0.12,"db":0.07})

# Missing/malformed blocks must degrade to None, never throw.
degenerate=api.trim_advanced_team({"team":"No Stats State"})
check("trim_advanced_team on a team with no offense/defense blocks at all doesn't throw, fields come back None",
      degenerate["team"]=="No Stats State" and degenerate["offense"]["ppa"] is None and degenerate["defense"]["havoc"]["total"] is None)
check("trim_advanced_team on a None row doesn't throw",
      api.trim_advanced_team(None)["team"] is None)
check("trim_advanced_team on an entirely empty dict doesn't throw",
      api.trim_advanced_team({})["offense"]["standardDowns"]["successRate"] is None)

# --- Matchup Intelligence v1: endpoint wiring (structural) ------------------
# Mirrors test_cfbd_identity.py's own convention (source-string checks for
# endpoint wiring/caching, not a full do_GET mock) rather than inventing a
# third testing style for this file.
src=(ROOT/"api"/"fetch_cfbd.py").read_text(encoding="utf-8")
check("server uses CFBD's season advanced-stats endpoint",'"/stats/season/advanced"' in src)
check("advanced stats explicitly exclude garbage time for predictive context",'"excludeGarbageTime": "true"' in src)
check("advanced stats fetch both FBS and FCS classifications",'"classification": "fbs"' in src and '"classification": "fcs"' in src)
check("advanced-stats view is dispatched from do_GET",'view == "advanced"' in src)
check("advanced-stats cache is season-scoped, same pattern as ratings",
      "ADVANCED_CACHE_PREFIX" in src and 'f"{ADVANCED_CACHE_PREFIX}:{year}"' in src)
check("advanced-stats cache reuses the same 6h freshness window as ratings",
      "ADVANCED_FRESH_SECONDS = 6 * 60 * 60" in src)
check("advanced-stats endpoint falls back to a stale cache on a provider outage, same resiliency as ratings/scoreboard",
      src.count('body["source"] = "stale"')>=2)

# Exercise the actual fetch helper with the network stubbed so the v2 request
# contract itself is pinned: FBS + FCS, both garbage-time excluded.
_orig_cfbd_get=api._cfbd_get
_seen_advanced_calls=[]
def _fake_advanced_get(key,path,params=None):
    _seen_advanced_calls.append((path,dict(params or {})))
    classification=(params or {}).get("classification")
    return [{"team":"FBS State" if classification=="fbs" else "FCS State","conference":"Test","offense":{"plays":60},"defense":{"plays":60}}]
api._cfbd_get=_fake_advanced_get
try:
    _fetched,_fcs_ok=api.fetch_advanced_stats("fake-key",2026)
finally:
    api._cfbd_get=_orig_cfbd_get
check("fetch_advanced_stats makes exactly one FBS and one FCS advanced-stat request",
      [c[1].get("classification") for c in _seen_advanced_calls]==["fbs","fcs"] and _fcs_ok is True)
check("fetch_advanced_stats sends excludeGarbageTime=true on BOTH classifications",
      all(c[1].get("excludeGarbageTime")=="true" for c in _seen_advanced_calls))
check("fetch_advanced_stats tags merged rows with their classification",
      [r.get("classification") for r in _fetched]==["fbs","fcs"])

# --- Matchup Intelligence v1: _handle_advanced() real behavior -------------
# REAL BUG, found and fixed after this shipped: a genuinely empty CFBD
# result (`teams == []`) was being treated as an upstream FAILURE and
# thrown as a 502 -- but confirmed against a real request (year=2026,
# August, zero games played), CFBD returns 200 with body `[]` on purpose:
# /stats/season/advanced computes CUMULATIVE season stats from games
# actually played, so there's nothing to aggregate yet in the preseason.
# This is exactly why the panel showed nothing in production with no
# explanation -- our own code manufactured an error out of a normal
# "nothing yet" response. A minimal fake handler (same technique as
# test_state.py's FakeHandler) actually exercises _handle_advanced()'s real
# control flow rather than just checking source text for this one, since
# getting this specific case right is what broke in production.
import io, json as _json
class _FakeCfbdHandler(api.handler):
    def __init__(self):
        self.headers={}
        self._status=None
        self._body=None
    def _respond(self,status,data):
        self._status=status
        self._body=data

_orig_kv_get, _orig_kv_set, _orig_fetch_advanced = api._kv_get, api._kv_set, api.fetch_advanced_stats
_FAKE_KV_STORE={}
api._kv_get=lambda key: _json.loads(_FAKE_KV_STORE[key]) if key in _FAKE_KV_STORE else None
api._kv_set=lambda key,obj: (_FAKE_KV_STORE.__setitem__(key,_json.dumps(obj)) or True)

api.fetch_advanced_stats=lambda key,year: ([],True)  # simulates the real preseason CFBD response
h=_FakeCfbdHandler()
h._handle_advanced("fake-key",2026,False)
check("_handle_advanced(): a genuinely empty CFBD result is a 200, NOT a 502 (this was the actual production bug)",
      h._status==200)
check("_handle_advanced(): the empty result is returned as teams:[] , not omitted or null",
      h._body is not None and h._body.get("teams")==[])
check("_handle_advanced(): v2 metadata records garbage-time exclusion and FBS+FCS coverage",
      h._body.get("excludeGarbageTime") is True and h._body.get("classifications")==["fbs","fcs"])
check("_handle_advanced(): an empty-but-successful result still gets cached (so we don't re-hit CFBD every single page load)",
      any(k.endswith(":2026") for k in _FAKE_KV_STORE))

# A REAL failure (upstream network/HTTP error, not just an empty list) must
# still behave as before -- fails loudly or falls back to a stale cache,
# never silently treated as "fine, empty."
_FAKE_KV_STORE.clear()
def _raise_url_error(key,year):
    import urllib.error
    raise urllib.error.URLError("simulated CFBD outage")
api.fetch_advanced_stats=_raise_url_error
h2=_FakeCfbdHandler()
threw=False
try:
    h2._handle_advanced("fake-key",2026,False)
except Exception:
    threw=True
check("_handle_advanced(): a REAL upstream failure (not just an empty list) still propagates when there's no cache to fall back to",
      threw)

api._kv_get, api._kv_set, api.fetch_advanced_stats = _orig_kv_get, _orig_kv_set, _orig_fetch_advanced

# --- Advanced postgame box-score analysis: trim_box_score() ----------------
# Verified against CFBD's OWN live, current official API reference example
# response (api.collegefootballdata.com/api/games, fetched directly while
# building this) -- meaningfully stronger footing than Matchup Intelligence
# v1's original build, which only had generic field-name knowledge to go
# on. real_cfbd_doc_example below is that documented example, copied
# verbatim (values are all 0/placeholder strings in CFBD's own docs, but
# the STRUCTURE is real).
real_cfbd_doc_example={
    "gameInfo":{"excitement":0,"homeWinner":True,"awayWinProb":0,"awayPoints":0,"awayTeam":"awayTeam","homeWinProb":0,"homePoints":0,"homeTeam":"homeTeam"},
    "teams":{
        "fieldPosition":[{"team":"team","averageStart":0,"averageStartingPredictedPoints":0}],
        "scoringOpportunities":[{"team":"team","opportunities":0,"points":0,"pointsPerOpportunity":0}],
        "havoc":[{"team":"team","total":0,"frontSeven":0,"db":0}],
        "rushing":[{"team":"team","powerSuccess":0,"stuffRate":0,"lineYards":0,"lineYardsAverage":0,"secondLevelYards":0,"secondLevelYardsAverage":0,"openFieldYards":0,"openFieldYardsAverage":0}],
        "explosiveness":[{"team":"team","overall":{"total":0,"quarter1":0,"quarter2":0,"quarter3":0,"quarter4":0}}],
        "successRates":[{"team":"team","overall":{"total":0,"quarter1":0,"quarter2":0,"quarter3":0,"quarter4":0},"standardDowns":{"total":0},"passingDowns":{"total":0}}],
        "cumulativePpa":[{"team":"team","plays":0,"overall":{"total":0},"passing":{"total":0},"rushing":{"total":0}}],
        "ppa":[{"team":"team","plays":0,"overall":{"total":0,"quarter1":0,"quarter2":0,"quarter3":0,"quarter4":0},"passing":{"total":0},"rushing":{"total":0}}],
    },
    "players":{"ppa":[],"usage":[]},
}
box=api.trim_box_score(real_cfbd_doc_example)
check("trim_box_score parses CFBD's own real documented example without error",box["teams"].get("team") is not None)
check("trim_box_score: gameInfo (homeTeam/awayTeam/points/winner) all correctly mapped",
      box["gameInfo"]=={"homeTeam":"homeTeam","awayTeam":"awayTeam","homePoints":0,"awayPoints":0,"homeWinner":True})
t=box["teams"]["team"]
check("trim_box_score: successRate pulled from successRates[].overall.total",t["successRate"]==0)
check("trim_box_score: ppa pulled from ppa[].overall.total (NOT cumulativePpa -- per-play average, not a season-style sum)",t["ppa"]==0)
check("trim_box_score: explosiveness/havoc/scoringOpportunities/pointsPerOpportunity all mapped",
      "explosiveness" in t and "havoc" in t and "scoringOpportunities" in t and "pointsPerOpportunity" in t)
check("trim_box_score: rushing efficiency (lineYards/stuffRate/powerSuccess) mapped",
      "lineYards" in t and "stuffRate" in t and "powerSuccess" in t)

# Two real teams, values that actually differ -- confirms rows are
# genuinely grouped BY TEAM (not just echoing whichever team appeared
# first across every metric array).
two_team_box={
    "gameInfo":{"homeTeam":"Alabama","awayTeam":"Tennessee","homePoints":31,"awayPoints":20,"homeWinner":True},
    "teams":{
        "successRates":[{"team":"Tennessee","overall":{"total":0.38}},{"team":"Alabama","overall":{"total":0.51}}],
        "ppa":[{"team":"Tennessee","overall":{"total":0.12}},{"team":"Alabama","overall":{"total":0.29}}],
        "havoc":[{"team":"Tennessee","total":0.14},{"team":"Alabama","total":0.22}],
        "scoringOpportunities":[{"team":"Tennessee","opportunities":4,"pointsPerOpportunity":3.1},{"team":"Alabama","opportunities":6,"pointsPerOpportunity":4.8}],
    },
}
box2=api.trim_box_score(two_team_box)
check("trim_box_score: two real teams stay correctly separated, not merged/overwritten",
      box2["teams"]["Alabama"]["successRate"]==0.51 and box2["teams"]["Tennessee"]["successRate"]==0.38)
check("trim_box_score: Alabama's higher PPA doesn't leak onto Tennessee's entry",
      box2["teams"]["Alabama"]["ppa"]==0.29 and box2["teams"]["Tennessee"]["ppa"]==0.12)

# Missing/malformed input must degrade gracefully, never throw.
check("trim_box_score on None doesn't throw",api.trim_box_score(None)["teams"]=={})
check("trim_box_score on an empty dict doesn't throw",api.trim_box_score({})["gameInfo"]["homeTeam"] is None)

# --- turnovers: _extract_turnovers() ----------------------------------------
# CAVEAT (see module docstring): the "turnovers" category string itself
# isn't independently confirmed against a live response in this
# environment -- this tests the SEARCH logic (case-insensitive match,
# graceful None on no match / bad data), not that "turnovers" is
# definitely CFBD's exact real string.
row_with_turnovers={"team":"Alabama","stats":[{"category":"possessionTime","stat":"1800"},{"category":"Turnovers","stat":"2"}]}
check("_extract_turnovers finds a case-insensitive 'Turnovers' category match",api._extract_turnovers(row_with_turnovers)==2)
check("_extract_turnovers returns None when no matching category exists (not a guess, not a crash)",
      api._extract_turnovers({"team":"X","stats":[{"category":"totalYards","stat":"410"}]}) is None)
check("_extract_turnovers returns None on a non-numeric stat value rather than throwing",
      api._extract_turnovers({"stats":[{"category":"turnovers","stat":"not-a-number"}]}) is None)
check("_extract_turnovers returns None on completely missing/malformed input",
      api._extract_turnovers(None) is None and api._extract_turnovers({}) is None)

# --- fetch_box_score(): combines the box score + best-effort turnovers -----
_orig_cfbd_get=api._cfbd_get
def _fake_cfbd_get(key,path,params=None):
    if path=="/game/box/advanced":
        return two_team_box
    if path=="/games/teams":
        return [{"id":params.get("id"),"teams":[
            {"team":"Alabama","stats":[{"category":"turnovers","stat":"1"}]},
            {"team":"Tennessee","stats":[{"category":"turnovers","stat":"3"}]},
        ]}]
    raise AssertionError(f"unexpected path {path}")
api._cfbd_get=_fake_cfbd_get
combined=api.fetch_box_score("fake-key",401)
check("fetch_box_score merges turnovers onto the already-trimmed box score",
      combined["teams"]["Alabama"]["turnovers"]==1 and combined["teams"]["Tennessee"]["turnovers"]==3)
check("fetch_box_score's primary box-score fields are untouched by the turnovers merge",
      combined["teams"]["Alabama"]["successRate"]==0.51)

# If the SECOND call (turnovers) fails outright, the box score itself --
# the primary, confirmed data -- must still come back rather than failing
# the whole request over one best-effort field.
def _fake_cfbd_get_turnovers_fails(key,path,params=None):
    if path=="/game/box/advanced":
        return two_team_box
    raise RuntimeError("simulated /games/teams outage")
api._cfbd_get=_fake_cfbd_get_turnovers_fails
combined2=api.fetch_box_score("fake-key",401)
check("fetch_box_score still returns the primary box score even when the turnovers call fails outright",
      combined2["teams"]["Alabama"]["successRate"]==0.51 and "turnovers" not in combined2["teams"]["Alabama"])
api._cfbd_get=_orig_cfbd_get

# --- endpoint wiring (structural, same convention as Matchup Intelligence) -
src2=(ROOT/"api"/"fetch_cfbd.py").read_text(encoding="utf-8")
check("server uses CFBD's real advanced box-score endpoint",'"/game/box/advanced"' in src2)
check("boxscore view is dispatched from do_GET",'view == "boxscore"' in src2)
check("boxscore cache is keyed per-GAME, not per-season (immutable once final, unlike ratings/advanced)",
      "BOXSCORE_CACHE_PREFIX" in src2 and 'f"{BOXSCORE_CACHE_PREFIX}:{game_id}"' in src2)
check("boxscore cache freshness is deliberately LONGER than ratings/advanced (24h vs 6h) -- a finished game's box score is immutable",
      "BOXSCORE_FRESH_SECONDS = 24 * 60 * 60" in src2)

# --- _handle_boxscore(): applies the SAME "empty is valid, not an error"
# lesson PROACTIVELY this time (Matchup Intelligence needed a production
# incident to learn this; boxscore ships with it from the start).
_FAKE_KV_STORE.clear()
api._kv_get=lambda key: _json.loads(_FAKE_KV_STORE[key]) if key in _FAKE_KV_STORE else None
api._kv_set=lambda key,obj: (_FAKE_KV_STORE.__setitem__(key,_json.dumps(obj)) or True)
_orig_fetch_box_score=api.fetch_box_score
api.fetch_box_score=lambda key,game_id: {"gameInfo":{},"teams":{}}  # simulates a game with no tracked advanced stats
h3=_FakeCfbdHandler()
h3._handle_boxscore("fake-key",999999,False)
check("_handle_boxscore(): an empty box score (no tracked stats for this game) is a 200, not a 502",h3._status==200)
check("_handle_boxscore(): the empty result is still cached (avoids re-hitting CFBD for a game confirmed to have no data)",
      any(k.endswith(":999999") for k in _FAKE_KV_STORE))
api.fetch_box_score=_orig_fetch_box_score

api._kv_get, api._kv_set = _orig_kv_get, _orig_kv_set

# --- Historical CFBD betting-line integration -------------------------
# Verified against CFBD's OWN live, current official API reference
# (api.collegefootballdata.com/api/betting, fetched directly while
# building this) -- same rigor as boxscore/Matchup Intelligence above,
# not assumed field names. real_lines_example below is a realistic
# CFBD-shaped response (the docs' own example uses all-0 placeholder
# values, unhelpful for testing real comparison logic, so this uses
# plausible real numbers in the SAME confirmed structure).
real_lines_example=[{
    "id":401520145,"season":2025,"seasonType":"regular","week":3,
    "startDate":"2025-09-13T19:00:00Z",
    "homeTeamId":333,"homeTeam":"Alabama","homeConference":"SEC","homeClassification":"fbs","homeScore":31,
    "awayTeamId":2633,"awayTeam":"Tennessee","awayConference":"SEC","awayClassification":"fbs","awayScore":20,
    "lines":[
        {"provider":"DraftKings","spread":-7.0,"formattedSpread":"Alabama -7","spreadOpen":-5.5,"overUnder":54.0,"overUnderOpen":53.0,"homeMoneyline":-270,"awayMoneyline":225},
        {"provider":"consensus","spread":-6.5,"formattedSpread":"Alabama -6.5","spreadOpen":-5.5,"overUnder":54.5,"overUnderOpen":53.0,"homeMoneyline":-260,"awayMoneyline":220},
    ],
}]
lines=api.trim_lines(real_lines_example)
check("trim_lines parses CFBD's own real-shaped example without error",lines["homeTeam"]=="Alabama" and lines["awayTeam"]=="Tennessee")
check("trim_lines keeps every provider's line, not just one -- the 'which one to prefer' choice happens client-side",len(lines["lines"])==2)
check("trim_lines keeps spread/spreadOpen/overUnder/overUnderOpen per provider",
      lines["lines"][0]["spread"]==-7.0 and lines["lines"][0]["spreadOpen"]==-5.5 and lines["lines"][0]["overUnder"]==54.0)
check("trim_lines does NOT include its own gameId key -- the REAL bug this avoided: _handle_lines()'s outer explicit gameId could get silently overwritten via dict-spread ordering, especially in the empty-fallback case where it'd become None",
      "gameId" not in lines)

# Missing/malformed input must degrade gracefully, never throw.
check("trim_lines on an empty list doesn't throw, returns an empty-but-valid shape",
      api.trim_lines([])=={"homeTeam":None,"awayTeam":None,"lines":[]})
check("trim_lines on None doesn't throw",
      api.trim_lines(None)=={"homeTeam":None,"awayTeam":None,"lines":[]})
check("trim_lines on a list containing an empty dict doesn't throw",
      api.trim_lines([{}])=={"homeTeam":None,"awayTeam":None,"lines":[]})

# --- endpoint wiring (structural) ---------------------------------------
src3=(ROOT/"api"/"fetch_cfbd.py").read_text(encoding="utf-8")
check("server uses CFBD's real historical betting-lines endpoint",'"/lines"' in src3)
check("lines view is dispatched from do_GET",'view == "lines"' in src3)
check("lines cache is keyed per-GAME, not per-season (immutable once final, same as boxscore)",
      "LINES_CACHE_PREFIX" in src3 and 'f"{LINES_CACHE_PREFIX}:{game_id}"' in src3)
check("lines cache freshness matches boxscore's 24h (finished-game data is immutable either way)",
      "LINES_FRESH_SECONDS = 24 * 60 * 60" in src3)

# --- _handle_lines(): applies the "empty is valid, not an error" lesson
# PROACTIVELY (same discipline boxscore already shipped with, learned the
# hard way from Matchup Intelligence's real production incident).
_FAKE_KV_STORE.clear()
api._kv_get=lambda key: _json.loads(_FAKE_KV_STORE[key]) if key in _FAKE_KV_STORE else None
api._kv_set=lambda key,obj: (_FAKE_KV_STORE.__setitem__(key,_json.dumps(obj)) or True)
_orig_fetch_historical_lines=api.fetch_historical_lines
api.fetch_historical_lines=lambda key,game_id: {"homeTeam":None,"awayTeam":None,"lines":[]}  # simulates a game CFBD has no tracked lines for
h4=_FakeCfbdHandler()
h4._handle_lines("fake-key",999998,False)
check("_handle_lines(): a game with zero tracked lines is a 200, not a 502",h4._status==200)
check("_handle_lines(): the outer payload's gameId is the REQUESTED id (999998), not silently lost/overwritten by the empty trim_lines() result",
      h4._body is not None and h4._body.get("gameId")==999998)
check("_handle_lines(): the empty result is still cached (avoids re-hitting CFBD for a game confirmed to have no lines)",
      any(k.endswith(":999998") for k in _FAKE_KV_STORE))
api.fetch_historical_lines=_orig_fetch_historical_lines

# A real (non-empty) result: confirm the outer gameId ALSO isn't
# overwritten by trim_lines() output when there IS real data returned
# (the collision this test suite specifically caught before it ever ran
# against the live endpoint).
_FAKE_KV_STORE.clear()
api.fetch_historical_lines=lambda key,game_id: api.trim_lines(real_lines_example)
h5=_FakeCfbdHandler()
h5._handle_lines("fake-key",401520145,False)
check("_handle_lines(): with a REAL non-empty result, the payload's gameId is still the outer REQUESTED id, not anything trim_lines() itself returned",
      h5._body is not None and h5._body.get("gameId")==401520145)
check("_handle_lines(): the real result's own line data comes through intact alongside the correct gameId",
      h5._body.get("homeTeam")=="Alabama" and len(h5._body.get("lines",[]))==2)
api.fetch_historical_lines=_orig_fetch_historical_lines

api._kv_get, api._kv_set = _orig_kv_get, _orig_kv_set

cfbd_games=[{"id":401,"completed":True,"homeId":333,"homeTeam":"Alabama","homePoints":31,"awayId":2633,"awayTeam":"Tennessee","awayPoints":20}]
lookup=grader.score_lookup_cfbd(cfbd_games)
pick={"cfbdGameId":401,"cfbdPickedTeamId":333,"team":"Alabama","matchup":"Tennessee @ Alabama","line":-6.5}
found=grader.find_final_score(pick,lookup)
check("grader resolves canonical CFBD game id exactly",found is not None and found["source"]=="cfbd" and found["cfbd_id"]==401)
check("grader orients picked team by CFBD team id",grader._picked_scores(pick,found)==(31,20))
state={"history":[{"entries":[{"picks":[dict(pick,result=None,cfbdSeason=2026)]}]}],"pools":[]}
graded,checked=grader.grade_all_pending(state,lookup)
check("canonical CFBD final automatically grades ATS pick",graded==1 and checked==1 and state["history"][0]["entries"][0]["picks"][0]["result"]=="W")
years,legacy=grader._pending_requirements({"history":[{"entries":[{"picks":[dict(pick,result=None,cfbdSeason=2026)]}]}]})
check("pending requirements requests CFBD season without legacy fallback",years=={2026} and legacy is False)


# --- force=1 admin gate ------------------------------------------------
# REAL SECURITY FIX: force=1 used to bypass the shared Redis cache for
# ANY signed-in user, forcing a real upstream CFBD round trip on every
# request -- a cost/rate-limit abuse surface, since CFBD's own per-key
# rate limit is shared across every PickGauge user (same class of risk
# the shared Odds API key's quota-floor protection in api/fetch_odds.py
# already guards against). Now gated to admins only (is_admin(), synced
# with api/state.py's copy -- see tests/test_auth_sync.py). This exercises
# do_GET()'s REAL control flow (not just a source-text check) to confirm
# a non-admin's force=1 is silently downgraded rather than erroring the
# whole request.
class _FakeCfbdHandlerForce(api.handler):
    def __init__(self,path):
        self.path=path
        self.headers={"Authorization":"Bearer faketoken"}
        self._status=None; self._body=None
        self.captured_force=None
    def _respond(self,status,data):
        self._status=status; self._body=data
    def _handle_scoreboard(self,key,force):
        self.captured_force=force
        self._respond(200,{"ok":True})

_orig_verify_user, _orig_rate_limited, _orig_is_admin = api.verify_user, api.rate_limited, api.is_admin
_orig_cfbd_key_env = os.environ.get("CFBD_API_KEY")
os.environ["CFBD_API_KEY"]="fake-cfbd-key"
api.verify_user=lambda handler: "user_nonadmin"
api.rate_limited=lambda uid,bucket,limit,window: False

api.is_admin=lambda uid: False
h6=_FakeCfbdHandlerForce("/api/fetch_cfbd?view=scoreboard&force=1")
h6.do_GET()
check("do_GET(): a non-admin's force=1 is silently downgraded to force=False, not rejected",
      h6._status==200 and h6.captured_force is False)

api.is_admin=lambda uid: True
h7=_FakeCfbdHandlerForce("/api/fetch_cfbd?view=scoreboard&force=1")
h7.do_GET()
check("do_GET(): an admin's force=1 actually bypasses the cache (force=True reaches _handle_scoreboard)",
      h7._status==200 and h7.captured_force is True)

api.is_admin=lambda uid: False
h8=_FakeCfbdHandlerForce("/api/fetch_cfbd?view=scoreboard")
h8.do_GET()
check("do_GET(): no force param at all still resolves to force=False for a non-admin (baseline unaffected)",
      h8._status==200 and h8.captured_force is False)

api.verify_user, api.rate_limited, api.is_admin = _orig_verify_user, _orig_rate_limited, _orig_is_admin
if _orig_cfbd_key_env is None:
    os.environ.pop("CFBD_API_KEY",None)
else:
    os.environ["CFBD_API_KEY"]=_orig_cfbd_key_env

if fail:
    print(f"\n{len(fail)} of {total} FAILURE(S): {fail}"); sys.exit(1)
print(f"\nAll {total} checks passed.")
