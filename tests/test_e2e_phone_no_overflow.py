"""
Real-browser E2E: nothing on any tab runs off a phone screen (Oct 20, 2026).

Opens every tab -- This Week, All Games (+ My Picks and Pools subviews),
Confidence, Survivor and each of its sub-tabs, Results, Settings, Help,
Account -- at 390px and 360px, with picks, a pool, Results history and four
Survivor entries seeded so the busy states render, and every folded
<details> opened. For each screen it asserts:

  * document.documentElement.scrollWidth <= the viewport width, and
  * no visible element sticks out past the left or right screen edge,
    unless it sits inside an intended sideways-scroll box (an ancestor
    with overflow-x:auto/scroll). html/body clip sideways overflow
    (overflow-x:hidden), so scrollWidth alone can't catch content that is
    simply cut off -- the per-element check does.

Found before the fix: Settings' "Clear a specific column or source" select
(#clearSel) was 413px wide at both widths. Reuses the fully mocked /api/*
harness from test_e2e_batch1_workflow.py and the synthetic Survivor season
from test_e2e_survivor_dynamic_weeks.py.

Run with:

    python3 tests/test_e2e_phone_no_overflow.py
"""
import importlib.util
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

from _e2e_common import start_server


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


B = _load("batch1", "test_e2e_batch1_workflow.py")
SV = _load("surv", "test_e2e_survivor_dynamic_weeks.py")

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


PRIVATE = {"entries": [{"id": "e1", "name": "Entry 1", "picks": {}}], "history": [], "pools": [], "_rev": 1,
           "enabledSystems": ["teamrank", "sagpred", "sag", "wayward"]}

# Picks on the first three games, an ATS pool with two entries, and three
# weeks of Results history (two entries) -- same shape as
# test_e2e_results_layout.py's seed.
SEED_ATS = """()=>{
  games.slice(0,3).forEach(g=>{ const e=edgeOf(g); pickTeam(g.key, e&&e.side||'home'); });
  state.pools=[{id:'pt',name:'Office pool with a fairly long name',pickLimit:7,
    entries:[{id:'pe1',name:'Entry 1',picks:{}},{id:'pe2',name:'Second entry',picks:{}}]}];
  const T=[['Ohio State',-10,'W'],['Auburn',3,'L'],['USC',6.5,'W'],['Texas',-6.5,'P']];
  state.history=['w3','w2','w1'].map((id,wi)=>({id,label:'Week '+(3-wi),closedAt:'2026-09-'+(20-wi)+'T15:00:00Z',
    entries:['e1','e2'].map(eid=>({entryId:eid,name:eid==='e1'?'Entry 1':'Entry 2',picks:T.map((t,i)=>({key:eid+id+i,team:t[0],
      matchup:'Mississippi State @ '+t[0],line:t[1],side:'home',result:t[2],cfbdSeason:2026,cfbdWeek:3-wi,clv:0.5,pickedEdgeAtPick:2}))}))}));
  save();
}"""

SURVIVOR_ENTRIES = [
    ["My Entry", {"1": "Alabama", "2": "Georgia", "3": "LSU", "4": "Texas", "5": "Tennessee", "6": "Ole Miss"}],
    ["Entry 2", {"1": "Alabama", "2": "Georgia", "3": "LSU", "4": "Texas", "5": "Ole Miss"}],
    ["Entry 3", {"1": "Georgia", "2": "Alabama", "3": "Texas", "4": "LSU", "5": "Tennessee"}],
    ["Entry 4", {"1": "Texas", "2": "LSU", "3": "Alabama", "4": "Georgia"}],
]
SEED_SURVIVOR = """([data, entries, view])=>{
  const pid=pgSurvivorPoolId(); data.poolId=pid; pgSurvivorRuntime.errorByPool[pid]=null; pgSurvivorRuntime.dataByPool[pid]=data;
  const pool=pgSurvivorPoolState(); pool.entries=entries.map(([name,picks])=>{
    const e=pgSurvivorDefaultEntry(name); e.picks={...picks}; return e; });
  const ui=pgSurvivorUi(); ui.weekByPool[pid]=5; ui.view=view; ui.viewChosen=true; ui.entryByPool[pid]=pool.entries[0].id; pgSurvivorSaveUi(ui);
  pgSurvivorComputePlans(); renderSurvivorShell();
}"""

OPEN_DETAILS = "()=>document.querySelectorAll('.panel.active details:not([open])').forEach(d=>{d.open=true;})"

# Every visible element must sit inside the screen, unless an ancestor below
# <body> is an intended sideways-scroll box (overflow-x:auto/scroll).
OVERFLOW = """()=>{
  const vw=document.documentElement.clientWidth, bad=[];
  const inScrollBox=el=>{ for(let a=el.parentElement;a&&a!==document.body;a=a.parentElement){
    const o=getComputedStyle(a).overflowX; if(o==='auto'||o==='scroll') return true; } return false; };
  for(const el of document.body.querySelectorAll('*')){
    const r=el.getBoundingClientRect(); if(!r.width||!r.height) continue;
    if(r.right<=vw+1&&r.left>=-1) continue;
    const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none') continue;
    if(inScrollBox(el)) continue;
    bad.push((el.id?'#'+el.id+' ':'')+el.tagName.toLowerCase()+(el.classList.length?'.'+[...el.classList].join('.'):'')
      +` left ${Math.round(r.left)} right ${Math.round(r.right)}`);
  }
  return {scrollWidth:document.documentElement.scrollWidth, vw:window.innerWidth, bad};
}"""

ATS_TABS = [("This Week", "snapshot"), ("All Games", "board"), ("All Games: My Picks", "picks"),
            ("All Games: Pools", "pools"), ("Confidence", "confidence"), ("Results", "record"),
            ("Settings", "settings"), ("Help", "help"), ("Account", "account")]
SURVIVOR_VIEWS = [("Season Board", "board"), ("Week Rankings", "rankings"), ("Season Plan", "plan"),
                  ("My Picks", "picks"), ("History", "history")]


def assert_fits(page, width, label):
    page.evaluate(OPEN_DETAILS)
    page.wait_for_timeout(200)
    r = page.evaluate(OVERFLOW)
    if r["bad"]:
        print(f"   {width}px {label}: sticking out -> {r['bad'][:8]}")
    check(f"{width}px {label}: page does not scroll sideways (scrollWidth {r['scrollWidth']} <= {r['vw']})", r["scrollWidth"] <= r["vw"])
    check(f"{width}px {label}: no element sticks out past the screen edge", not r["bad"])


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            for width in (390, 360):
                browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": width, "height": 844})
                page.evaluate(SEED_ATS)
                for label, tab in ATS_TABS:
                    page.evaluate(f"switchTab('{tab}')")
                    page.wait_for_timeout(350)
                    check(f"{width}px {label}: tab opened", page.locator(".panel.active").count() == 1)
                    assert_fits(page, width, label)

                # Same screens in the pool context (CLV columns, pool entry bar).
                page.evaluate("state.activeContext='pt'; save();")
                for label, tab in (("This Week (pool)", "snapshot"), ("All Games (pool)", "board")):
                    page.evaluate(f"switchTab('{tab}')")
                    page.wait_for_timeout(350)
                    assert_fits(page, width, label)
                page.evaluate("state.activeContext='overall'; save();")

                page.evaluate("switchTab('survivor')")
                page.wait_for_function("typeof renderSurvivorShell==='function' && !!document.getElementById('survivorMount').dataset.mounted", timeout=15000)
                page.wait_for_timeout(500)
                for label, view in SURVIVOR_VIEWS:
                    page.evaluate(SEED_SURVIVOR, [SV.season(), SURVIVOR_ENTRIES, view])
                    page.wait_for_timeout(400)
                    check(f"{width}px Survivor {label}: sub-tab rendered", page.locator(f"#survivor-view-{view}").count() == 1
                          and page.locator(f"#survivor-view-{view}").is_visible())
                    assert_fits(page, width, f"Survivor {label}")

                check(f"{width}px: no page errors", not errors)
                browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
