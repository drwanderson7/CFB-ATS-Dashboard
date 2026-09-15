"""
One-off Playwright verification for the "editable line before saving"
fix to the Confidence pool manual add-games checklist (Sept 3, 2026 --
Drew's explicit request, since the Splash PDF parser still isn't
reliably succeeding). Confirms: the checkbox and "Live X" text are
unchanged, an editable line input appears prefilled with the live line,
editing it before saving actually carries the CORRECTED value onto the
saved game (not the original live line), and clicking the input doesn't
accidentally toggle the wrapping checkbox.

Run: python3 tests/_render_confidence_preadd_line_edit.py
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

        # This session's confidence pool creation goes through a separate,
        # newer setup wizard (cpStartPoolWizard()) not related to this fix
        # -- inject a minimal, already-normalized ATS pool directly rather
        # than driving that wizard's UI, since it isn't what's under test
        # here.
        page.evaluate("""() => {
            const pool = {
                id: 'test_pool_1', name: 'Preadd Line Test Pool', scoring: 'ats',
                weeklyPickMode: 'all', weeklyPickCount: null,
                confidenceMode: 'all', confidenceCount: null,
                dropLowestWeeks: null, currentWeekNumber: 1, weekLabel: 'Week 1',
                cardLockAt: null, lockMode: null, weekImportMeta: null,
                games: [], entries: [{id: 'e1', name: 'Entry 1', picks: {}, history: []}],
            };
            state.confidencePools = [pool];
            state.confidenceActivePoolId = pool.id;
            renderConfidenceTab();
        }""")
        page.wait_for_timeout(200)

        page.click("text=Manual setup / troubleshooting")
        page.wait_for_timeout(200)
        check("no page errors so far", len(errors) == 0)

        # This offline harness has no live board data, so add a custom game
        # first via the existing custom-add path to have SOMETHING to work
        # with, then verify its shape once it's on the slate. But the real
        # target of this fix is the BOARD CHECKLIST rows (games pulled from
        # state.lastGames) -- seed a fake live game directly so the
        # checklist actually has a row to test against.
        page.evaluate("""() => {
            state.lastGames = [{
                away: 'Michigan Wolverines', home: 'Ohio State Buckeyes',
                commence: new Date(Date.now()+3600000).toISOString(),
                vegas: -6.5, id: 'evt_test_1',
            }];
            renderConfidenceTab();
        }""")
        page.wait_for_timeout(200)
        page.click("text=Manual setup / troubleshooting")
        page.wait_for_timeout(200)
        page.screenshot(path="/tmp/confidence_preadd_line_edit.png", full_page=True)

        # Checkbox and "Live" text should be unchanged.
        row = page.locator(".pool-manual-row", has_text="Michigan Wolverines")
        check("the board checklist row still shows the checkbox", row.locator("input[type=checkbox]").count() == 1)
        check("the board checklist row still shows the live line text", "Live -6.5" in row.inner_text())

        # New editable line input should be present, prefilled with -6.5.
        line_input = row.locator(".cp-preadd-line-input")
        check("an editable line input now appears in the row", line_input.count() == 1)
        check(f"the line input is prefilled with the live line (-6.5) (got {line_input.input_value()!r})",
              line_input.input_value() == "-6.5")

        # Clicking directly on the line input must NOT toggle the checkbox
        # (both live inside the same <label>).
        checkbox = row.locator("input[type=checkbox]")
        check("checkbox starts unchecked", not checkbox.is_checked())
        line_input.click()
        page.wait_for_timeout(100)
        check("clicking the line input does NOT accidentally check the checkbox",
              not checkbox.is_checked())

        # Now actually correct the line (simulating: live market says -6.5,
        # but the real Splash sheet printed -7) and check the box.
        line_input.fill("-7")
        page.wait_for_timeout(100)
        checkbox.check()
        page.wait_for_timeout(100)
        check("checkbox is now checked", checkbox.is_checked())

        page.click("#cpSaveGamesBtn")
        page.wait_for_timeout(300)
        page.screenshot(path="/tmp/confidence_preadd_line_saved.png", full_page=True)

        # The saved game (in "This week's games") should carry the
        # CORRECTED line (-7), not the original live line (-6.5).
        saved_line_input = page.locator(".cp-line-input")
        check(f"the saved game carries the CORRECTED line (-7), not the original live line (got {saved_line_input.input_value()!r})",
              saved_line_input.input_value() == "-7")

        browser.close()
    httpd.shutdown()

    print()
    passed = sum(1 for _, ok in checks if ok)
    print(f"{passed}/{len(checks)} checks passed")
    if passed != len(checks):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
