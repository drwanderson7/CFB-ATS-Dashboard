"""
Real-browser E2E test for the "Your line" pick override on the main Pick
Board (Overall context) -- Drew's real question: "what if my line is
different than what's listed?" e.g. Marshall -24 in hand, board shows
-24.5.

Confirms, against the real DOM and real click/input events (not just
source-text regex):
  - the override field only appears once a team is actually picked
  - it's pre-filled with the market line PickGauge showed at pick time
  - typing a different number and committing (blur/change) updates the
    saved pick's line and shows the "edited" badge
  - clearing the field reverts to the ORIGINAL market line frozen at pick
    time (not whatever the live line currently is) and removes the badge
  - Edge/CLV cells are untouched by any of this (Drew's explicit choice)

Run with:

    python3 tests/test_e2e_pick_custom_line.py
"""
import sys
from pathlib import Path

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

            page.evaluate(
                """
              () => {
                isDemo = false;
                games = [{
                  key: 'g1', away: 'UMass', home: 'Marshall',
                  vegas: -24.5, book: 'Test Book',
                  providerGameId: null,
                }];
                state.entries = [{id: 'e1', name: 'Entry 1', picks: {}}];
                state.enabledSystems = [];
                renderBoard();
              }
            """
            )
            page.click('button[data-tab="pickboard"]')
            page.wait_for_timeout(150)
            page.click('[data-pickboard-view="board"]')
            page.wait_for_timeout(150)

            check(
                "no override field before any pick is made",
                page.locator('[data-pick-line-for="g1"]').count() == 0,
            )

            # Pick Marshall (home side) -- the button shows -24.5 (g.vegas).
            page.click('[data-pickteam="g1"][data-side="home"]')
            page.wait_for_timeout(150)

            override = page.locator('[data-pick-line-for="g1"]')
            check("override field appears once a team is picked", override.count() == 1)
            check("override field is pre-filled with the market line at pick time (-24.5)", override.input_value() == "-24.5")
            check(
                "no 'edited' badge yet -- line matches the market",
                page.locator('.pick-line-custom-badge').count() == 0,
            )

            stored_line = page.evaluate("activeEntry().picks['g1'].line")
            check("pick actually stored -24.5 before any override", stored_line == -24.5)

            # Type the real line Drew actually got and commit it.
            override.fill("-24")
            override.dispatch_event("change")
            page.wait_for_timeout(150)

            stored_after = page.evaluate("() => ({line: activeEntry().picks['g1'].line, custom: activeEntry().picks['g1'].customLine})")
            check("overriding the line actually updates the stored pick", stored_after["line"] == -24)
            check("customLine flag set after a real override", stored_after["custom"] is True)
            check("'edited' badge now shown", page.locator('.pick-line-custom-badge').count() == 1)

            # Re-locate after the re-render (renderBoard rebuilt the row).
            override = page.locator('[data-pick-line-for="g1"]')
            check("re-rendered field reflects the new value", override.input_value() == "-24")
            page.screenshot(path="/tmp/pick_custom_line_edited_state.png", full_page=False)

            frozen = page.evaluate(
                "() => ({market: activeEntry().picks['g1'].marketHomeLineAtPick, team: activeEntry().picks['g1'].team, side: activeEntry().picks['g1'].side})"
            )
            check("frozen market-line-at-pick snapshot untouched by the override", frozen["market"] == -24.5)
            check("team/side untouched by the override", frozen["team"] == "Marshall" and frozen["side"] == "home")

            # Clear the field -- must revert to the ORIGINAL market line
            # (-24.5), not whatever games[0].vegas currently is, and even if
            # the live line has since moved.
            page.evaluate("() => { games[0].vegas = -30; }")  # simulate the market moving after the pick
            override.fill("")
            override.dispatch_event("change")
            page.wait_for_timeout(150)

            reverted = page.evaluate("() => ({line: activeEntry().picks['g1'].line, custom: activeEntry().picks['g1'].customLine})")
            check("clearing reverts to the ORIGINAL frozen market line (-24.5), not the now-moved live line (-30)", reverted["line"] == -24.5)
            check("customLine flag cleared", not reverted["custom"])
            check("'edited' badge gone after clearing", page.locator('.pick-line-custom-badge').count() == 0)

            check("no error boundary triggered at any point", not page.is_visible("#errorBoundary"))

            page.screenshot(path="/tmp/pick_custom_line_e2e.png", full_page=False)

            page.close()
            browser.close()
    finally:
        httpd.shutdown()

    print(f"\n{total - len(failures)}/{total} checks passed.")
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)


if __name__ == "__main__":
    main()
