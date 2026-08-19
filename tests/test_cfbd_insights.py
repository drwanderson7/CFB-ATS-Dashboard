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
