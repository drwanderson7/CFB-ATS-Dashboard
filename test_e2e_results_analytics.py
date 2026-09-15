"""
Real-browser E2E test for Results historical analytics: real DOM wiring
for the season/week filters and the expanded frozen-data breakdowns.

One of 7 files split out of the original test_e2e_ui_behaviors.py (Sept 1,
2026, TODO #26) -- see tests/_e2e_common.py for the shared harness, and
the other test_e2e_*.py files for the remaining scenarios.

Run with:

    python3 tests/test_e2e_results_analytics.py
"""
import sys

from playwright.sync_api import sync_playwright

from _e2e_common import CLERK_MOCK, start_server, launch_browser

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser = launch_browser(p)
            page = browser.new_page(viewport={"width": 1360, "height": 900})
            page.add_init_script(CLERK_MOCK)
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(800)
            page.evaluate("""
              state.activeContext='overall';
              state.history=[
                {id:'rw26',label:'2026 Week 1',closedAt:'2026-09-05T20:00:00Z',entries:[{entryId:'re1',name:'2026 Entry',picks:[
                  {key:'a',team:'Alpha',matchup:'Beta @ Alpha',result:'W',side:'home',line:-3.5,cfbdSeason:2026,cfbdWeek:1,pickedEdgeAtPick:3.2,clv:1,coverProbabilityAtPick:.58,modelAgreementAtPick:{agree:8,total:10,pct:.8},keyTierAtPick:'major'},
                  {key:'b',team:'Gamma',matchup:'Gamma @ Delta',result:'L',side:'away',line:7,cfbdSeason:2026,cfbdWeek:1,pickedEdgeAtPick:2,clv:-.5,coverProbabilityAtPick:.54,modelAgreementAtPick:{agree:6,total:10,pct:.6},keyTierAtPick:'none'}
                ]}]},
                {id:'rw25',label:'2025 Week 4',closedAt:'2025-09-20T20:00:00Z',entries:[{entryId:'re2',name:'2025 Entry',picks:[
                  {key:'c',team:'Omega',matchup:'Sigma @ Omega',result:'W',side:'home',line:-14.5,cfbdSeason:2025,cfbdWeek:4,pickedEdgeAtPick:1,clv:1.5,coverProbabilityAtPick:.62,modelAgreementAtPick:{agree:7,total:10,pct:.7},keyTierAtPick:'minor'}
                ]}]}
              ];
              renderRecord(); switchTab('record');
            """)
            page.wait_for_timeout(150)
            check("Results renders season and week historical filters",
                  page.is_visible("#recordSeasonFilter") and page.is_visible("#recordWeekFilter"))
            check("Results exposes the expanded breakdowns",
                  "Favorites vs. underdogs" in page.inner_text("#recordBody")
                  and "ATS by closing-line value" in page.inner_text("#recordBody")
                  and "Cover % calibration" in page.inner_text("#recordBody"))
            season_values = page.locator("#recordSeasonFilter option").evaluate_all("els => els.map(e => e.value)")
            check("Results season filter is populated from archived canonical seasons",
                  season_values == ["all", "2026", "2025"])
            page.select_option("#recordSeasonFilter", "2025")
            page.wait_for_timeout(100)
            check("selecting a season filters the running record to that season",
                  "2025 Entry" in page.inner_text("#recordBody") and "2026 Entry" not in page.inner_text(".picklist"))
            week_values = page.locator("#recordWeekFilter option").evaluate_all("els => els.map(e => e.value)")
            check("week options narrow to the selected season", week_values == ["all", "4"])
            check("filtered Results only shows archived weeks matching the selected season",
                  "2025 Week 4" in page.inner_text("#recordBody") and "2026 Week 1" not in page.inner_text("#recordBody"))
            check("no error boundary triggered during Results analytics interaction",
                  not page.is_visible("#errorBoundary"))

            page.close()
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
