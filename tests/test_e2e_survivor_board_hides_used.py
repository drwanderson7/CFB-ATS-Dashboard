"""
Real-browser E2E: Season Board hides teams already used in finished weeks.
Synthetic season, current week 5. Entry picked Alabama W1, Georgia W2 (finished),
Tennessee W5 (current), Texas W6 (planned).

    python3 tests/test_e2e_survivor_board_hides_used.py
"""
import importlib.util, json, pathlib, sys
from playwright.sync_api import sync_playwright
from _e2e_common import start_server
_spec = importlib.util.spec_from_file_location("surv", pathlib.Path(__file__).with_name("test_e2e_survivor_dynamic_weeks.py"))
S = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(S)
failures = []; total = 0
def check(n, c):
    global total; total += 1; print(f"[{'PASS' if c else 'FAIL'}] {n}")
    if not c: failures.append(n)

SETUP = """([data, picks])=>{
  const pid=pgSurvivorPoolId(); data.poolId=pid; pgSurvivorRuntime.errorByPool[pid]=null; pgSurvivorRuntime.dataByPool[pid]=data;
  const pool=pgSurvivorPoolState(); const e=pgSurvivorDefaultEntry('My Entry'); e.picks={}; Object.entries(picks).forEach(([w,t])=>{e.picks[String(w)]=t;}); pool.entries=[e];
  const ui=pgSurvivorUi(); ui.weekByPool[pid]=5; ui.view='board'; ui.viewChosen=true; ui.entryByPool[pid]=e.id; ui.showUsedByPool={}; pgSurvivorSaveUi(ui);
  pgSurvivorComputePlans(); renderSurvivorShell();
}"""
ROWS = "[...document.querySelectorAll('#survivor-view-board tbody tr .survivor-team-name-row b')].map(b=>b.textContent.trim())"

def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser, page, reqs, errors = S.B.open_app(p, port, json.loads(json.dumps(S.PRIVATE)), {"width": 1360, "height": 900})
            page.evaluate("switchTab('survivor')")
            page.wait_for_function("typeof renderSurvivorShell==='function' && !!document.getElementById('survivorMount').dataset.mounted", timeout=15000)
            page.wait_for_timeout(500)
            page.evaluate(SETUP, [S.season(), {"1": "Alabama", "2": "Georgia", "5": "Tennessee", "6": "Texas"}])
            page.wait_for_timeout(500)
            rows = page.evaluate(ROWS); print("   rows:", rows)
            check("teams used in finished weeks (Alabama, Georgia) are gone from the grid", "Alabama" not in rows and "Georgia" not in rows)
            check("the current-week pick (Tennessee) and the planned pick (Texas) stay", "Tennessee" in rows and "Texas" in rows)
            n_hidden_view = len(rows)
            check("unused teams stay (LSU, Ole Miss)", "LSU" in rows and "Ole Miss" in rows and n_hidden_view >= 10)
            note = page.inner_text(".survivor-used-note"); print("   note:", note)
            check("a one-line note says 2 used teams are hidden", "2 teams" in note and "hidden" in note)
            check("no row exists for a hidden team", page.evaluate("[...document.querySelectorAll('#survivor-view-board [data-survivor-pick-team]')].filter(b=>['Alabama','Georgia'].includes(b.dataset.survivorPickTeam)).length") == 0)
            page.click("[data-survivor-toggle-used]"); page.wait_for_timeout(300)
            rows2 = page.evaluate(ROWS)
            check("Show them brings the 2 used teams back", len(rows2) == n_hidden_view + 2 and "Alabama" in rows2 and "Georgia" in rows2)
            check("the note flips to a Hide link", "Hide them" in page.inner_text(".survivor-used-note"))
            check("choice is saved per pool on the device", page.evaluate("Object.keys(JSON.parse(localStorage.getItem('pickgauge_survivor_ui_v1')).showUsedByPool||{}).length") == 1)
            page.click("[data-survivor-toggle-used]"); page.wait_for_timeout(300)
            check("Hide them removes them again", len(page.evaluate(ROWS)) == n_hidden_view)
            check("no uncaught page errors", not errors)
            browser.close()
    finally:
        httpd.shutdown()
    print(f"\n{total - len(failures)}/{total} checks passed")
    if failures: print("FAILED:", failures); sys.exit(1)
    print("All checks passed.")
main()
