"""
Real-browser E2E: Survivor's CURRENT pool week uses live odds, and a Refresh
lines click re-prices it (Oct 28, 2026).

Builds the real SEC season with the real buildPickGaugeSurvivorData() (the
2026 SEC pool schedule from survivor-core, synthetic SP+ ratings, Week 1 one
day out so it is the current pool week), with a live Odds API line in the
shared slate (state.lastGames) for one Week 1 game and CFBD pregame WP for
another. Every /api/* call is mocked and recorded.

Checks:
  * the live-line game shows the live line, a % derived from it, and "Live";
  * the WP-only game falls back to CFBD WP; a game with nothing falls to SP+;
  * later weeks are SP+;
  * Refresh lines is visible on the Survivor tab, and clicking it (mocked
    server returns a moved line) rebuilds the grid with the new line and %,
    with no CFBD / schedule request;
  * a pick saved before the click keeps its pick-time probability;
  * "Lines as of <time>" shows on the Season Board and Week Rankings.

Run with:

    python3 tests/test_e2e_survivor_current_week_live.py
"""
import datetime
import importlib.util
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

from _e2e_common import CLERK_MOCK, start_server, launch_browser

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


NOW = datetime.datetime.now(datetime.timezone.utc)
OLD = B.iso(NOW - datetime.timedelta(days=1))
PRIVATE = {"entries": [{"id": "e1", "name": "Entry 1", "picks": {}}], "history": [], "pools": [], "_rev": 1}

BUILD = """async()=>{
  const mod=await import('/app/survivor-core/data/sec-pool-schedule-2026.js');
  const sched=mod.SEC_POOL_SCHEDULE_2026; const teams=new Set(); let id=1;
  const base=Date.now()+1*864e5;   // Week 1 kicks off tomorrow -> current pool week
  cfbdGames=sched.map(g=>{ g.teams.forEach(t=>teams.add(t)); const n=id++; return {id:n,season:2026,week:g.week,seasonType:'regular',
     awayTeam:g.teams[0],homeTeam:g.teams[1],awayId:1000+n,homeId:2000+n,startDate:new Date(base+(g.week-1)*7*864e5+n*60000).toISOString(),
     completed:false,neutralSite:false,homeConference:'SEC',awayConference:'SEC',homeClassification:'fbs',awayClassification:'fbs'}; });
  let r=0; cfbdRatings=[...teams].map(t=>({team:t,sp:{rating:((r++*7)%40)-12}}));
  const wk1=cfbdGames.filter(g=>g.week===Math.min(...cfbdGames.map(x=>x.week)));
  const live=wk1[0], wp=wk1[1];
  pgSurvivorEnrichment.wpByGame=new Map([[String(wp.id),{homeWinProbability:0.83}]]); pgSurvivorEnrichment.lineByGame=new Map();
  return {live:{id:live.id,away:live.awayTeam,home:live.homeTeam,start:live.startDate,week:live.week},
          wp:{id:wp.id,away:wp.awayTeam,home:wp.homeTeam,week:wp.week}, plain:{id:wk1[2].id,home:wk1[2].homeTeam}};
}"""


def odds_game(g, line):
    return {"id": f"ev{g['id']}", "away": g["away"], "home": g["home"], "commence": g["start"],
            "books": {"draftkings": line}, "vegas": line, "book": "consensus"}


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser = launch_browser(p)
            page = browser.new_page(viewport={"width": 1360, "height": 900})
            reqs, errors = [], []
            page.on("pageerror", lambda exc: errors.append(str(exc)))
            page.add_init_script(CLERK_MOCK)
            shared = {"lastGames": [], "lastRefresh": OLD, "sharedUpdatedAt": OLD, "booksSeen": ["draftkings"],
                      "predictions": B.PREDS, "predMeta": {"fetchedAt": B.FRESH, "count": len(B.PREDS)}, "preKickLines": {}, "sharedPools": []}
            moved = {}

            def handle(route):
                req = route.request
                url = req.url
                name = url.split("/api/")[1].split("?")[0]
                reqs.append((req.method, name, url))
                if name == "state" and req.method == "GET" and "scope=shared" in url:
                    return route.fulfill(status=200, content_type="application/json", body=json.dumps({"state": shared}))
                if name == "state" and req.method == "GET":
                    return route.fulfill(status=200, content_type="application/json", body=json.dumps({"state": json.loads(json.dumps(PRIVATE)), "revision": 1}))
                if name == "state":
                    return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "revision": 2}))
                if name == "fetch_odds":
                    fresh = B.iso(datetime.datetime.now(datetime.timezone.utc))
                    shared.update({"lastGames": moved["games"], "lastRefresh": fresh, "sharedUpdatedAt": fresh})
                    return route.fulfill(status=200, content_type="application/json", headers={"x-requests-remaining": "300"},
                                         body=json.dumps({"games": moved["games"], "lastRefresh": fresh, "booksSeen": ["draftkings"], "sharedPersisted": True}))
                return route.fulfill(status=200, content_type="application/json", body="{}")

            page.route("**/api/**", handle)
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(2000)
            page.evaluate("switchTab('survivor')")
            page.wait_for_function("typeof renderSurvivorShell==='function' && !!document.getElementById('survivorMount').dataset.mounted", timeout=15000)
            page.wait_for_timeout(800)
            g = page.evaluate(BUILD)
            # Live line -7.5 for the first Week 1 game (home favored), in this
            # device's shared slate, then build + show the board.
            page.evaluate("""([games,old])=>{ state.lastGames=games; state.lastRefresh=old; state.book='draftkings';
                const pid=pgSurvivorPoolId(), d=buildPickGaugeSurvivorData('sec'); d.poolId=pid;
                pgSurvivorRuntime.errorByPool[pid]=null; pgSurvivorRuntime.dataByPool[pid]=d;
                const u=pgSurvivorUi(); u.view='board'; u.viewChosen=true; u.weekByPool[pid]=d.weeks[0]; pgSurvivorSaveUi(u);
                pgSurvivorComputePlans(); renderSurvivorShell(); }""", [[odds_game(g["live"], -7.5)], OLD])
            page.wait_for_timeout(500)

            def side(game_id, team):
                return page.evaluate("([id,t])=>{const m=pgSurvivorData().matchups.find(x=>String(x.gameId)===String(id)&&x.team===t); return m&&{p:m.winProbability,line:m.spreadValue,src:m.probabilitySourceShort,week:m.week};}", [game_id, team])

            def cell(game_id, team):
                sel = f"#survivor-view-board button[data-survivor-pick-game='{game_id}'][data-survivor-pick-team='{team}']"
                return page.locator(sel)

            phi = lambda line: page.evaluate("(l)=>Math.min(.99,Math.max(.01,pgsNormalCdf(-l/16)))", line)
            h = side(g["live"]["id"], g["live"]["home"])
            a = side(g["live"]["id"], g["live"]["away"])
            print(f"   current week {g['live']['week']}: live game home {h}, away {a}")
            check("current week, live line posted: home side shows the live line -7.5 and 'Live'", h["line"] == -7.5 and h["src"] == "Live")
            check("...its % is derived from the live line", abs(h["p"] - phi(-7.5)) < 1e-9 and abs(a["p"] - phi(7.5)) < 1e-9 and a["line"] == 7.5)
            check("...and the Season Board cell says so", "-7.5" in cell(g["live"]["id"], g["live"]["home"]).inner_text()
                  and "Live" in cell(g["live"]["id"], g["live"]["home"]).inner_text())
            w = side(g["wp"]["id"], g["wp"]["home"])
            check("current week, no live line but CFBD pregame WP -> WP (83%)", w["src"] == "WP" and abs(w["p"] - 0.83) < 1e-9)
            plain = side(g["plain"]["id"], g["plain"]["home"])
            check("current week, nothing but SP+ -> SP+", plain["src"] == "SP+")
            later = page.evaluate("(cw)=>{const ms=pgSurvivorData().matchups.filter(m=>m.week>cw); return {n:ms.length, sp:ms.filter(m=>m.probabilitySourceShort==='SP+').length};}", g["live"]["week"])
            check("later weeks stay SP+", later["n"] > 50 and later["sp"] == later["n"])
            note = page.inner_text("#survivor-view-board .survivor-lines-asof")
            check("Season Board shows 'Lines as of <time>'", note.startswith("Lines as of ") and page.evaluate("(o)=>linesWhen(o)", OLD) in note)

            # Save a pick on the live-line team: its probability is recorded now.
            cell(g["live"]["id"], g["live"]["home"]).click()
            page.wait_for_timeout(400)
            meta_before = page.evaluate("(t)=>{const e=pgSurvivorActiveEntry(); return Object.values(e.pickMeta||{}).find(m=>m&&m.team===t)||null;}", g["live"]["home"])
            check("a pick was saved with its pick-time probability", meta_before is not None and abs(meta_before["winProbability"] - phi(-7.5)) < 1e-9)

            # Refresh lines on the Survivor tab: the server returns a moved line (-10.5).
            moved["games"] = [odds_game(g["live"], -10.5)]
            check("Refresh lines is visible on the Survivor tab", page.is_visible("#refreshBtn"))
            built_before = page.evaluate("pgSurvivorData().generatedAt")
            n_before = len(reqs)
            page.wait_for_timeout(50)
            page.click("#refreshBtn")
            page.wait_for_timeout(1500)
            during = [r[1] for r in reqs[n_before:]]
            print(f"   requests during the click: {during}")
            check("the click made exactly one /api/fetch_odds request", during.count("fetch_odds") == 1)
            check("...and no CFBD / schedule refetch", not any(n in ("fetch_cfbd", "fetch_teams") for n in during))
            h2 = side(g["live"]["id"], g["live"]["home"])
            print(f"   after refresh: {h2}")
            check("Survivor data was rebuilt", page.evaluate("pgSurvivorData().generatedAt") != built_before)
            check("the grid now shows the moved live line (-10.5) and its new %", h2["line"] == -10.5 and h2["src"] == "Live" and abs(h2["p"] - phi(-10.5)) < 1e-9)
            check("...on the Season Board cell too", "-10.5" in cell(g["live"]["id"], g["live"]["home"]).inner_text())
            meta_after = page.evaluate("(t)=>{const e=pgSurvivorActiveEntry(); return Object.values(e.pickMeta||{}).find(m=>m&&m.team===t)||null;}", g["live"]["home"])
            check("the saved pick keeps its pick-time probability (not the new %)", meta_after == meta_before)
            note2 = page.inner_text("#survivor-view-board .survivor-lines-asof")
            check("'Lines as of' moves to the new refresh time", note2 != note and note2.startswith("Lines as of "))

            page.evaluate("()=>{const u=pgSurvivorUi(); u.view='rankings'; pgSurvivorSaveUi(u); renderSurvivorShell();}")
            page.wait_for_timeout(400)
            check("Week Rankings shows 'Lines as of <time>' too", page.inner_text("#survivor-view-rankings .survivor-lines-asof").startswith("Lines as of "))
            check("no page errors", not errors)
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
