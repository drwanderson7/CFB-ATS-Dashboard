"""Regression checks for CFBD scoreboard/ratings proxy + canonical grading."""
import importlib.util
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

# --- Matchup Intelligence v1: trim_advanced_team() -------------------------
# CAVEAT (see api/fetch_cfbd.py's own module docstring): CFBD's exact
# /stats/season/advanced response shape hasn't been confirmed against live
# data in this environment. This tests trim_advanced_team()'s OWN logic --
# that it correctly picks out the fields it's supposed to, and degrades
# gracefully (never throws) when a block is missing or shaped differently
# than expected -- not that the field names themselves are definitely
# CFBD's real ones. That's the "logic verified, live unverified" split.
raw_advanced_row={
    "season":2026,"team":"Alabama","conference":"SEC",
    "offense":{
        "ppa":0.38,"successRate":0.481,"explosiveness":1.32,"stuffRate":0.14,"lineYards":2.9,
        "standardDowns":{"ppa":0.31,"successRate":0.52,"explosiveness":1.1},
        "passingDowns":{"ppa":0.45,"successRate":0.38,"explosiveness":1.6},
        "rushingPlays":{"ppa":0.22,"successRate":0.49,"explosiveness":0.9},
        "passingPlays":{"ppa":0.51,"successRate":0.47,"explosiveness":1.7},
    },
    "defense":{
        "ppa":0.05,"successRate":0.352,"explosiveness":1.02,"stuffRate":0.22,"lineYards":2.1,
        "standardDowns":{"ppa":0.02,"successRate":0.33,"explosiveness":0.95},
        "passingDowns":{"ppa":0.09,"successRate":0.36,"explosiveness":1.15},
        "rushingPlays":{"ppa":0.01,"successRate":0.31,"explosiveness":0.85},
        "passingPlays":{"ppa":0.11,"successRate":0.38,"explosiveness":1.25},
        "havoc":{"total":0.19,"frontSeven":0.12,"db":0.07},
    },
}
trimmed=api.trim_advanced_team(raw_advanced_row)
check("trim_advanced_team keeps team/conference",trimmed["team"]=="Alabama" and trimmed["conference"]=="SEC")
check("trim_advanced_team keeps top-level offense ppa/successRate/explosiveness",
      trimmed["offense"]["ppa"]==0.38 and trimmed["offense"]["successRate"]==0.481 and trimmed["offense"]["explosiveness"]==1.32)
check("trim_advanced_team keeps offense stuffRate/lineYards",
      trimmed["offense"]["stuffRate"]==0.14 and trimmed["offense"]["lineYards"]==2.9)
check("trim_advanced_team keeps offense standardDowns/passingDowns/rushingPlays/passingPlays splits",
      trimmed["offense"]["passingPlays"]["successRate"]==0.47 and trimmed["offense"]["rushingPlays"]["ppa"]==0.22)
check("trim_advanced_team keeps defense's own top-level splits (opponent output allowed)",
      trimmed["defense"]["successRate"]==0.352 and trimmed["defense"]["passingDowns"]["successRate"]==0.36)
check("trim_advanced_team keeps defensive havoc (total/frontSeven/db)",
      trimmed["defense"]["havoc"]=={"total":0.19,"frontSeven":0.12,"db":0.07})
check("trim_advanced_team does NOT put havoc under offense (offense has no havoc stat of its own)",
      "havoc" not in trimmed["offense"])

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
check("advanced-stats view is dispatched from do_GET",'view == "advanced"' in src)
check("advanced-stats cache is season-scoped, same pattern as ratings",
      "ADVANCED_CACHE_PREFIX" in src and 'f"{ADVANCED_CACHE_PREFIX}:{year}"' in src)
check("advanced-stats cache reuses the same 6h freshness window as ratings",
      "ADVANCED_FRESH_SECONDS = 6 * 60 * 60" in src)
check("advanced-stats endpoint falls back to a stale cache on a provider outage, same resiliency as ratings/scoreboard",
      src.count('body["source"] = "stale"')>=2)

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

if fail:
    print(f"\n{len(fail)} of {total} FAILURE(S): {fail}"); sys.exit(1)
print(f"\nAll {total} checks passed.")
