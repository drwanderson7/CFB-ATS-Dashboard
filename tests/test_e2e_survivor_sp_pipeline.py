"""
Real-browser E2E: the FULL Survivor build pipeline produces an SP+ projected
spread for every SP+-sourced matchup, and the Season Board shows it.

Feeds the real buildPickGaugeSurvivorData('sec') a season built from the
real 2026 SEC pool schedule (survivor-core) plus SP+ ratings, with no
pregame WP or lines (so everything is SP+-sourced, like weeks without a
line). Also proves the label's fallback derives the projection from ratings
when a matchup object lacks spProjectedSpread (older adapter / other builder).

Run with:

    python3 tests/test_e2e_survivor_sp_pipeline.py
"""
import importlib.util
import json
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

from _e2e_common import start_server

_spec = importlib.util.spec_from_file_location(
    "batch1", pathlib.Path(__file__).with_name("test_e2e_batch1_workflow.py"))
B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B)

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


BUILD = """async()=>{
  const mod=await import('/app/survivor-core/data/sec-pool-schedule-2026.js');
  const sched=mod.SEC_POOL_SCHEDULE_2026; const teams=new Set(); let id=1;
  const base=Date.now()+3*864e5;
  cfbdGames=sched.map(g=>{ g.teams.forEach(t=>teams.add(t)); const n=id++; return {id:n,season:2026,week:g.week,seasonType:'regular',
     awayTeam:g.teams[0],homeTeam:g.teams[1],awayId:1000+n,homeId:2000+n,startDate:new Date(base+(g.week-1)*7*864e5).toISOString(),
     completed:false,neutralSite:false,homeConference:'SEC',awayConference:'SEC',homeClassification:'fbs',awayClassification:'fbs'}; });
  let r=0; cfbdRatings=[...teams].map(t=>({team:t,sp:{rating:((r++*7)%40)-12}}));
  pgSurvivorEnrichment.wpByGame=new Map(); pgSurvivorEnrichment.lineByGame=new Map();
  const d=buildPickGaugeSurvivorData('sec'); d.poolId=pgSurvivorPoolId();
  return d;
}"""


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser, page, reqs, errors = B.open_app(p, port, {"entries": [{"id": "e1", "name": "E", "picks": {}}], "history": [], "pools": [], "_rev": 1},
                                                     {"width": 1360, "height": 900})
            page.evaluate("switchTab('survivor')")
            page.wait_for_timeout(2500)
            stats = page.evaluate("""async()=>{ const d=await (%s)(); window.__pgTestData=d;
                const sp=d.matchups.filter(m=>m.probabilitySourceShort==='SP+');
                return {total:d.matchups.length, sp:sp.length, withProj:sp.filter(m=>Number.isFinite(m.spProjectedSpread)).length,
                  consistent:sp.every(m=>(m.winProbability>0.5)===(m.spProjectedSpread<0)||Math.abs(m.spProjectedSpread)<0.01),
                  lineSides:sp.filter(m=>m.spreadValue!==null).length,
                  projNeverAsLine:sp.filter(m=>m.spreadValue!==null).every(m=>typeof pgsLiveLineForCanonical==='function'&&m.spreadValue!==m.spProjectedSpread)}; }""" % BUILD)
            print(f"   pipeline: {stats}")
            check("real pipeline built the SEC season from the real 2026 pool schedule", stats["total"] > 150)
            check("every matchup is SP+-sourced (no WP / lines supplied)", stats["sp"] == stats["total"])
            check("EVERY SP+ matchup carries a numeric spProjectedSpread", stats["withProj"] == stats["sp"])
            check("projection agrees with the win probability (favored side <-> negative spread)", stats["consistent"])
            # The mocked ATS board (test_e2e_batch1_workflow) happens to include a
            # few real SEC matchups with live lines -- those keep their real line.
            check("the projection never becomes the market line (real lines only where the board has one)", stats["projNeverAsLine"] and stats["lineSides"] < 20)

            page.evaluate("""()=>{ const d=window.__pgTestData, pid=pgSurvivorPoolId(); pgSurvivorRuntime.errorByPool[pid]=null; pgSurvivorRuntime.dataByPool[pid]=d;
                const u=pgSurvivorUi(); u.view='board'; u.showPastByPool={[pid]:true}; pgSurvivorSaveUi(u); pgSurvivorComputePlans(); renderSurvivorShell(); }""")
            page.wait_for_timeout(500)
            lines = page.eval_on_selector_all("#survivor-view-board .survivor-cell-line > span:first-child", "els=>els.map(e=>e.textContent.trim())")
            proj = [t for t in lines if re.match(r"^≈(PK|[+-]\d+(\.5)?) SP\+", t)]
            real = [t for t in lines if re.match(r"^(PK|[+-]\d+(\.5)?) SP\+", t)]
            dash = [t for t in lines if t.startswith("— ")]
            print(f"   board cells: {len(lines)}, with ≈ projection: {len(proj)}, bare dash: {len(dash)}  e.g. {lines[:3]}")
            check("Season Board renders cells", len(lines) > 50)
            check("every cell shows a number: SP+ projection (≈…) or, where one exists, the real line", len(proj) + len(real) == len(lines) and len(proj) > 150)
            check("real-line cells match the matchups that have a live line", len(real) == stats["lineSides"])
            check("no cell shows the old bare '— SP+'", len(dash) == 0)

            # Fallback: strip the field and re-render -> label still derives it from ratings.
            page.evaluate("""()=>{ pgSurvivorData().matchups.forEach(m=>{ delete m.spProjectedSpread; }); renderSurvivorShell(); }""")
            page.wait_for_timeout(400)
            lines2 = page.eval_on_selector_all("#survivor-view-board .survivor-cell-line > span:first-child", "els=>els.map(e=>e.textContent.trim())")
            check("fallback: without spProjectedSpread on the matchups, cells STILL show ≈ from SP+ ratings",
                  lines2 == lines)
            check("no uncaught page errors", not errors)
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
