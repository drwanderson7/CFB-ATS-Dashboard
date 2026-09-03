"""
One-off Playwright verification for the new Confidence pool tab (Sept 2,
2026). Run: python3 tests/_render_confidence_tab.py
"""
import http.server
import socketserver
import threading
import time
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent

CLERK_MOCK = """
window.Clerk = {
  user: { id: 'test_user', primaryEmailAddress: { emailAddress: 'test@example.com' } },
  session: { getToken: async () => 'fake.jwt.token' },
  load: async () => {},
  mountSignIn: () => {},
  addListener: () => {},
  signOut: async () => {},
};
window.__internal_ClerkUICtor = {};
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass


def main():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.2)

    checks = []

    def check(name, cond):
        checks.append((name, bool(cond)))
        print(f"[{'PASS' if cond else 'FAIL'}] {name}")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1200, "height": 1100})
        page.add_init_script(CLERK_MOCK)

        errors = []
        page.on("pageerror", lambda exc: errors.append(f"PAGE ERROR: {exc}"))

        page.goto(f"http://127.0.0.1:{port}/app/")
        page.wait_for_selector("#appRoot", state="attached", timeout=5000)
        page.wait_for_function(
            "document.getElementById('appRoot').style.display !== 'none'", timeout=5000
        )
        page.wait_for_timeout(300)

        page.click("button[data-tab='confidence']")
        page.wait_for_timeout(300)
        page.screenshot(path="/tmp/confidence_empty_state.png", full_page=True)

        check("no page errors after switching to the Confidence tab", len(errors) == 0)
        check("empty state shows the pool-creation form", page.locator("#cpCreatePoolBtn").count() == 1)

        # Create a pool.
        page.fill("#cpNewPoolName", "Splash Confidence")
        page.click("#cpCreatePoolBtn")
        page.wait_for_timeout(300)
        page.screenshot(path="/tmp/confidence_pool_created.png", full_page=True)

        check("pool selector now shows the created pool", "Splash Confidence" in (page.locator("#cpPoolSelect").inner_text() or ""))
        check("a default entry ('Entry 1') exists as a chip", page.locator("[data-cp-entry]", has_text="Entry 1").count() == 1)

        # Add games via the manual custom-add path (no live board data in this offline harness).
        page.click(".pred-summary:has-text('Add games')")
        page.wait_for_timeout(200)
        page.fill("#cpCustomAway", "Ball State")
        page.fill("#cpCustomHome", "Ohio State")
        page.fill("#cpCustomLine", "-30")
        page.click("#cpAddCustomBtn")
        page.wait_for_timeout(200)
        page.fill("#cpCustomAway", "UMass")
        page.fill("#cpCustomHome", "Rutgers")
        page.fill("#cpCustomLine", "-14")
        page.click("#cpAddCustomBtn")
        page.wait_for_timeout(200)
        page.click("#cpSaveGamesBtn")
        page.wait_for_timeout(300)
        page.screenshot(path="/tmp/confidence_games_added.png", full_page=True)

        game_rows = page.locator(".cp-game-row").count()
        check(f"both manually-added games now appear on the slate (got {game_rows})", game_rows == 2)

        # The line is directly editable in the games list (not decorative) --
        # this is the actual correction from straight-up to ATS grading.
        line_inputs = page.locator(".cp-line-input")
        check(f"each game row has an editable line input (got {line_inputs.count()})", line_inputs.count() == 2)
        first_line_value = line_inputs.nth(0).input_value()
        check(f"the line input is prefilled with the value entered at add-time (got {first_line_value!r})",
              first_line_value in ("-30", "-14"))  # order not guaranteed

        pick_rows = page.locator(".cp-pick-row").count()
        check(f"the picks panel shows one row per game (got {pick_rows})", pick_rows == 2)

        # Pick a team on the first game -- button label now includes the
        # line (e.g. "Ohio State -30"), matching Splash's own convention.
        page.locator(".cp-team-btn", has_text="Ohio State").click()
        page.wait_for_timeout(200)
        page.screenshot(path="/tmp/confidence_team_picked.png", full_page=True)
        check("picking a team highlights that team's button as active",
              page.locator(".cp-team-btn.active", has_text="Ohio State").count() == 1)
        check("the team button label includes the line, matching Splash's own convention",
              "-30" in page.locator(".cp-team-btn.active", has_text="Ohio State").inner_text())

        # Assign points via the select.
        selects = page.locator(".cp-points-select")
        selects.nth(0).select_option("2")
        page.wait_for_timeout(200)

        # Game 0 now has both team + points -- 1 of 2 required picks made.
        # This is informational progress text, not an "error" -- by design
        # (see confidence.js's cpValidatePicks(), requireComplete=false: a
        # half-filled-in week shouldn't show a wall of "missing pick"
        # errors while someone's still working through it).
        progress_text = page.locator("#cpPicksCard .ok").inner_text()
        check(f"progress indicator correctly shows 1 of 2 picks made after completing just the first game (got {progress_text!r})",
              "1 of 2" in progress_text)

        # Try to assign the SAME point value (2) to the second game -- should be disabled in the dropdown.
        second_select_options = page.locator(".cp-points-select").nth(1).locator("option")
        disabled_2 = page.eval_on_selector_all(
            ".cp-points-select", "els => els[1] ? Array.from(els[1].options).find(o=>o.value==='2')?.disabled : null"
        )
        check("the already-used point value (2) is disabled in the second game's dropdown", disabled_2 is True)

        # Complete the second pick with the other available point value.
        page.locator(".cp-team-btn", has_text="UMass").click()
        page.wait_for_timeout(150)
        page.locator(".cp-points-select").nth(1).select_option("1")
        page.wait_for_timeout(200)
        page.screenshot(path="/tmp/confidence_picks_complete.png", full_page=True)

        ok_text = page.locator("#cpPicksCard .ok").inner_text()
        check(f"validation now reports complete picks (got {ok_text!r})", "2 of 2" in ok_text)

        # Close-week button should now be present and clickable without a blocking alert.
        check("Close week button is present once games exist", page.locator("#cpCloseWeekBtn").count() == 1)

        # Actually close the week -- confirms the archive flow end-to-end:
        # a confirmation dialog appears, confirming clears the current
        # week's games/picks and starts Week 2, and standings still show
        # the "no graded weeks yet" note since grading only happens
        # server-side (via /api/grade_picks, not exercised in this
        # offline harness).
        page.click("#cpCloseWeekBtn")
        page.wait_for_timeout(300)
        page.screenshot(path="/tmp/confidence_close_week_dialog.png", full_page=True)
        confirm_btn = page.locator("button", has_text="Continue")
        check("closing the week shows a confirmation dialog before archiving", confirm_btn.count() > 0)
        if confirm_btn.count() > 0:
            confirm_btn.first.click()
        page.wait_for_timeout(300)
        page.screenshot(path="/tmp/confidence_week_closed.png", full_page=True)

        check("after closing, the week label advances to Week 2",
              "Week 2" in (page.locator("#cpPoolSelect").inner_text() or ""))
        check("after closing, the current game slate is cleared (0 games shown)",
              page.locator(".cp-game-row").count() == 0)

        browser.close()
    httpd.shutdown()

    print()
    passed = sum(1 for _, ok in checks if ok)
    print(f"{passed}/{len(checks)} checks passed")
    if passed != len(checks):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
