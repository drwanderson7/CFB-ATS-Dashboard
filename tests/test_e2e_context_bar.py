"""
Real-browser E2E test for the Context Bar: open/close, and specifically
the composedPath() click-outside fix (a real, previously-fixed bug: a
week-nav click INSIDE the switcher used to close the switcher on its own
navigation click, because bar.contains(e.target) fails once that click's
own re-render has already detached the clicked element from the DOM by
the time the bubble-phase listener runs).

One of 7 files split out of the original test_e2e_ui_behaviors.py (Sept 1,
2026, TODO #26) -- each scenario now runs in its own server + browser
session, so a crash in one can't abort or hide checks in another. See
tests/_e2e_common.py for the shared harness, and the other test_e2e_*.py
files for the remaining scenarios (Weekly Setup, error boundary, Pools
hiding shared widgets, the shared modal layer, Results analytics, mobile
UX).

The pure DECISION logic behind the Context Bar already has its own fast,
no-browser-needed coverage -- see test_context_bar_logic.mjs. This file is
specifically for "does clicking the actual thing actually do the actual
thing," which needs composedPath() (a real DOM API with no meaningful vm-
context equivalent) and real event-listener bubbling.

Run with:

    python3 tests/test_e2e_context_bar.py
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

            check("page loaded with no error boundary already showing (clean start)",
                  not page.is_visible("#errorBoundary"))

            check("Context Bar summary line is present and non-empty on load",
                  bool((page.inner_text("#ctxLine1") or "").strip()))

            switcher_closed_initially = not page.is_visible("#contextSwitcher")
            check("Context switcher is closed on initial load", switcher_closed_initially)

            page.click("#contextBarToggle")
            page.wait_for_timeout(300)
            check("clicking the Context Bar toggle opens the switcher", page.is_visible("#contextSwitcher"))

            # The exact historical bug scenario: click a week-nav control
            # INSIDE the open switcher.
            week_nav_exists = page.locator("#ctxWeekPrev").count() > 0
            check("week-nav prev button exists inside the open switcher (sanity check before the real assertion)",
                  week_nav_exists)
            if week_nav_exists:
                page.click("#ctxWeekPrev")
                page.wait_for_timeout(300)
                check("REGRESSION: clicking a week-nav control INSIDE the switcher does NOT close it "
                      "(the composedPath() fix -- this exact scenario used to close the switcher on itself)",
                      page.is_visible("#contextSwitcher"))

            # A genuine outside click must still close it.
            page.click("body", position={"x": 20, "y": 20})
            page.wait_for_timeout(300)
            check("clicking genuinely outside the Context Bar closes the switcher",
                  not page.is_visible("#contextSwitcher"))

            check("no error boundary triggered anywhere during Context Bar interaction",
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
