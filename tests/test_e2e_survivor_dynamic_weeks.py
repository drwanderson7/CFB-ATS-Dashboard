"""
Real-browser E2E: the Survivor Season Board drops finished weeks
automatically (Sept 23, 2026).

Injects a synthetic 8-week SEC season where Weeks 1-4 are complete and Week
5 is upcoming, then lets the REAL survivor core decide the current pool week
(deriveCurrentPoolWeek) and the real board render the grid.

Run with:

    python3 tests/test_e2e_survivor_dynamic_weeks.py
"""
import datetime
import importlib.util
import json
import pathlib
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


NOW = datetime.datetime.now(datetime.timezone.utc)
PRIVATE = {"entries": [{"id": "e1", "name": "Entry 1", "picks": {}}], "history": [], "pools": [], "_rev": 1}


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def season():
    teams = ["Alabama", "Georgia", "LSU", "Texas", "Tennessee", "Ole Miss"]
    matchups = []
    gid = 1
    for week in range(1, 9):
        # Weeks 1-4 are over; week 5 kicks off in 3 days.
        start = NOW + datetime.timedelta(days=(week - 5) * 7 + 3)
        for i, team in enumerate(teams):
            done = week <= 4
            matchups.append({
                "gameId": gid, "week": week, "team": team, "opponent": f"Opp {week}-{i}",
                "isHome": i % 2 == 0, "isNeutral": False, "startDate": iso(start),
                "completed": done, "teamPoints": 31 if done else None, "opponentPoints": 17 if done else None,
                "winProbability": 0.6 + 0.05 * (i % 6), "spread": "-7.0", "probabilitySourceShort": "SP+",
            })
            gid += 1
    n = len(matchups)
    return {"season": 2026, "weeks": list(range(1, 9)), "matchups": matchups,
            "schedule": {"matched": n, "expected": n, "missing": [], "authoritativeComplete": True,
                         "canonicalMatched": n, "canonicalExpected": n, "upstreamFallbackCount": 0, "upstreamFallbacks": []},
            "probability": {"modeled": n, "total": n, "bySource": {"WP": 0, "SP+": n, "Line": 0, "Missing": 0}},
            "bettingLines": {"gamesWithLine": n, "totalGames": n},
            "enrichment": {"status": "ready", "warning": None, "fetchedAt": iso(NOW)},
            "generatedAt": iso(NOW), "dataSource": "synthetic test season"}


def heads(page):
    return page.eval_on_selector_all("#survivor-view-board thead [data-survivor-week-sort]", "els=>els.map(e=>Number(e.dataset.survivorWeekSort))")


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": 1360, "height": 900})
            page.evaluate("switchTab('survivor')")
            page.wait_for_timeout(2500)  # let the (mock-failing) shared load settle
            ready = page.evaluate("typeof window.PickGaugeSurvivorCore?.results?.deriveCurrentPoolWeek==='function'")
            check("real survivor core loaded (deriveCurrentPoolWeek available)", ready)
            page.evaluate("""(data)=>{ const pid=pgSurvivorPoolId(); data.poolId=pid;
                pgSurvivorRuntime.errorByPool[pid]=null; pgSurvivorRuntime.dataByPool[pid]=data;
                const ui=pgSurvivorUi(); delete ui.weekByPool[pid]; ui.view='board'; ui.showPastByPool={}; pgSurvivorSaveUi(ui);
                const u2=pgSurvivorUi(); u2.weekByPool[pid]=window.PickGaugeSurvivorCore.results.deriveCurrentPoolWeek(data.matchups,data.weeks,Date.now()); pgSurvivorSaveUi(u2);
                pgSurvivorComputePlans(); renderSurvivorShell(); }""", season())
            page.wait_for_timeout(500)
            actual = page.evaluate("pgSurvivorActualWeek()")
            check("core says the current pool week is Week 5 (Weeks 1-4 complete)", actual == 5)
            h = heads(page)
            print(f"   visible week columns: {h}")
            check("Season Board shows W5-W8 only; finished W1-W4 dropped", h == [5, 6, 7, 8])
            # Column sizing regression (Sept 23): with fewer weeks the old
            # fixed min-width:1760px table stretched each column to ~174px
            # around a 120px cell, leaving blank strips.
            geo = page.evaluate("""()=>{const t=document.querySelector('#survivor-view-board table');
                const pairs=[...t.querySelectorAll('tbody td')].filter(td=>!td.classList.contains('survivor-team-col'))
                  .map(td=>{const c=td.firstElementChild, a=td.getBoundingClientRect(), b=c.getBoundingClientRect(); return [a.width-b.width, a.height-b.height];});
                const rows=[...t.querySelectorAll('tbody tr')].map(r=>Math.round(r.getBoundingClientRect().height));
                return {maxGapW:Math.max(...pairs.map(p=>p[0])), maxGapH:Math.max(...pairs.map(p=>p[1])), rowSpread:Math.max(...rows)-Math.min(...rows), tableW:t.getBoundingClientRect().width};}""")
            print(f"   grid geometry: {geo}")
            check("desktop: every week cell fills its column width (no blank strip beside cells)", geo["maxGapW"] <= 2)
            check("desktop: every week cell fills its row height", geo["maxGapH"] <= 2)
            check("desktop: all rows the same height (team name + stars stay on one line)", geo["rowSpread"] <= 2)
            check("desktop: table sized to its 4 visible weeks, not a fixed 1760px", geo["tableW"] < 800)
            toggle = page.locator("[data-survivor-toggle-past='show']")
            check("eyebrow reads 'Rest of season' while finished weeks are hidden", "rest of season" in page.inner_text("#survivor-view-board .survivor-view-head").lower())
            check("toggle offers the hidden range", toggle.is_visible() and "W1–W4" in toggle.inner_text())
            page.screenshot(path="/tmp/survivor_dynamic_weeks.png", full_page=False)

            toggle.click()
            page.wait_for_timeout(300)
            check("'Show finished weeks' brings back W1-W8", heads(page) == [1, 2, 3, 4, 5, 6, 7, 8])
            check("toggle flips to 'Hide finished weeks'", page.locator("[data-survivor-toggle-past='hide']").is_visible())
            page.reload()
            page.wait_for_timeout(300)
            check("show-past choice is remembered on this device (survivor UI localStorage)",
                  page.evaluate("(()=>{const u=JSON.parse(localStorage.getItem(PG_SURVIVOR_UI_KEY)||'{}'); return !!(u.showPastByPool&&Object.values(u.showPastByPool).some(Boolean));})()"))
            page.evaluate("switchTab('survivor')")
            page.wait_for_timeout(2500)
            page.evaluate("""(data)=>{ const pid=pgSurvivorPoolId(); data.poolId=pid; pgSurvivorRuntime.errorByPool[pid]=null;
                pgSurvivorRuntime.dataByPool[pid]=data; pgSurvivorComputePlans(); renderSurvivorShell(); }""", season())
            page.wait_for_timeout(400)
            check("after reload the remembered choice still shows all weeks", heads(page) == [1, 2, 3, 4, 5, 6, 7, 8])
            page.click("[data-survivor-toggle-past='hide']")
            page.wait_for_timeout(300)
            check("'Hide finished weeks' drops them again", heads(page) == [5, 6, 7, 8])

            # Viewing a past week keeps that week on the board.
            page.evaluate("(()=>{const u=pgSurvivorUi(); u.weekByPool[pgSurvivorPoolId()]=3; pgSurvivorSaveUi(u); pgSurvivorComputePlans(); renderSurvivorShell();})()")
            page.wait_for_timeout(300)
            check("viewing past Week 3 shows W3 onward (never hides the viewed week)", heads(page)[:3] == [3, 4, 5])
            page.evaluate("(()=>{const u=pgSurvivorUi(); u.weekByPool[pgSurvivorPoolId()]=5; pgSurvivorSaveUi(u); renderSurvivorShell();})()")
            page.wait_for_timeout(300)

            # Used teams from hidden weeks still show as Used.
            page.evaluate("(()=>{const e=pgSurvivorActiveEntry(); e.picks={'2':'Alabama'}; pgSurvivorComputePlans(); renderSurvivorShell();})()")
            page.wait_for_timeout(300)
            row_txt = page.locator("#survivor-view-board tbody tr", has_text="Alabama").first.inner_text()
            check("a team used in hidden Week 2 still shows 'Used' in the team column", "Used" in row_txt)
            check("its future cells stay disabled (can't reuse)", page.locator("#survivor-view-board tbody tr", has_text="Alabama").first.locator("button.survivor-game-cell[disabled]").count() >= 1)

            # Phone
            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(300)
            check("phone: board still shows W5-W8", heads(page) == [5, 6, 7, 8])
            check("no uncaught page errors", not errors)
            if errors:
                print("   errors:", errors[:3])
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
