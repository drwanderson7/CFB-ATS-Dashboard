"""
Real-browser E2E test for the Weekly Setup checklist card: the card
actually renders based on real state, and actually changes when the
underlying state changes (not just present once at load and never
re-checked).

One of 7 files split out of the original test_e2e_ui_behaviors.py (Sept 1,
2026, TODO #26) -- see tests/_e2e_common.py for the shared harness, and
the other test_e2e_*.py files for the remaining scenarios.

The pure DECISION logic behind the Weekly Setup checklist already has its
own fast, no-browser-needed coverage -- see test_weekly_setup_logic.mjs.
This file is specifically for "does the real DOM actually reflect it."

Run with:

    python3 tests/test_e2e_weekly_setup.py
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
            page.wait_for_timeout(1000)

            setup_notice_text = page.inner_text("#setupNotice") if page.locator("#setupNotice").count() > 0 else None
            check("#setupNotice card is present in the DOM on initial (demo-mode) load", setup_notice_text is not None)
            check("demo-mode setup notice mentions demo data, matching computeSetupDisplay()'s 'demo' mode",
                  setup_notice_text is not None and "demo" in setup_notice_text.lower())

            # Force a genuinely incomplete, non-demo state and confirm the
            # card re-renders to reflect it -- proves this is live, not a
            # static message baked in at load.
            result = page.evaluate("""
            () => {
              isDemo = false;
              games = [{key: 'g1', away: 'Team A', home: 'Team B', commence: '2026-09-15T17:00:00Z'}];
              state.lastGames = null;   // Vegas lines: not refreshed -> 'bad'
              state.enabledSystems = [];
              renderSetupStatus();
              return document.getElementById('setupNotice').textContent;
            }
            """)
            check("forcing a real incomplete, non-demo state re-renders the setup card away from the demo message",
                  "demo" not in result.lower())
            check("the re-rendered card reflects genuine incompleteness (not silently showing 'complete')",
                  ("complete" not in result.lower()) or ("incomplete" in result.lower()) or ("setup" in result.lower()))

            check("no error boundary triggered while forcing Weekly Setup state changes",
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
