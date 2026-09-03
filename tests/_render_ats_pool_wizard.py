"""
One-off Playwright verification for the new ATS pool setup wizard (Sept 2,
2026). Run: python3 tests/_render_ats_pool_wizard.py
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

        page.click("button[data-tab='pools']")
        page.wait_for_timeout(300)
        check("no page errors after switching to the Pools tab", len(errors) == 0)

        # Normal view (Import card / Manage pools card) should be visible,
        # wizard mount should be empty, before clicking "+ New pool".
        check("before clicking '+ New pool': the normal Pools view is visible",
              page.locator("#poolsNormalView").is_visible())
        check("before clicking '+ New pool': the wizard mount is empty",
              page.eval_on_selector("#atsPoolWizardMount", "el => el.innerHTML.trim()") == "")

        page.screenshot(path="/tmp/ats_wizard_before.png", full_page=True)

        page.click("#poolsNewBtn")
        page.wait_for_timeout(300)
        page.screenshot(path="/tmp/ats_wizard_step1.png", full_page=True)

        check("clicking '+ New pool' hides the normal Pools view",
              not page.locator("#poolsNormalView").is_visible())
        check("clicking '+ New pool' shows the wizard card",
              page.locator(".pg-wizard-card").count() == 1)
        check("wizard starts on step 1 of 4",
              "Step 1 of 4" in page.locator(".pg-wizard-head h2").inner_text())

        # Step 1: name. Continue should be disabled until a name is entered.
        next_btn = page.locator("#atsWizNext")
        check("Continue is disabled with no name entered yet", next_btn.is_disabled())
        page.fill("#atsWizName", "Grundy's ATS Pool")
        page.wait_for_timeout(150)
        check("Continue enables once a name is entered", not next_btn.is_disabled())
        next_btn.click()
        page.wait_for_timeout(200)

        # Step 2: weekly picks.
        check("advanced to step 2 of 4", "Step 2 of 4" in page.locator(".pg-wizard-head h2").inner_text())
        check("Continue is disabled until a weekly-picks mode is chosen", page.locator("#atsWizNext").is_disabled())
        page.locator(".pg-wizard-choice", has_text="Pick a set number").click()
        page.wait_for_timeout(150)
        # Default prefill should be 7 (matches the old single-form default).
        count_input = page.locator("#atsWizWeeklyCount")
        check(f"weekly count input prefills to 7 (got {count_input.input_value()!r})", count_input.input_value() == "7")
        count_input.fill("5")
        page.wait_for_timeout(100)
        page.click("#atsWizNext")
        page.wait_for_timeout(200)

        # Step 3: lines. Choose "Import my pool sheet".
        check("advanced to step 3 of 4", "Step 3 of 4" in page.locator(".pg-wizard-head h2").inner_text())
        page.screenshot(path="/tmp/ats_wizard_step3.png", full_page=True)
        check("step 3 does NOT show a 'live Vegas lines' option (dropped for v1)",
              "live vegas" not in page.locator(".pg-wizard-question").inner_text().lower())
        page.locator(".pg-wizard-choice", has_text="Import my pool sheet").click()
        page.wait_for_timeout(150)
        check("choosing 'Import my pool sheet' shows the PDF-prompt notice",
              "uploaded" in page.locator(".pg-wizard-example").inner_text().lower()
              or "upload" in page.locator(".pg-wizard-example").inner_text().lower())
        page.click("#atsWizNext")
        page.wait_for_timeout(200)

        # Step 4: entries. Bump to 2 via the stepper.
        check("advanced to step 4 of 4", "Step 4 of 4" in page.locator(".pg-wizard-head h2").inner_text())
        page.click("[data-ats-entry-step='1']")
        page.wait_for_timeout(150)
        entry_input = page.locator("#atsWizEntryCount")
        check(f"entry stepper incremented to 2 (got {entry_input.input_value()!r})", entry_input.input_value() == "2")
        page.click("#atsWizNext")
        page.wait_for_timeout(200)

        # Review step.
        page.screenshot(path="/tmp/ats_wizard_review.png", full_page=True)
        review_text = page.locator(".pg-wizard-review").inner_text()
        check("review step shows the pool name", "Grundy's ATS Pool" in review_text)
        check("review step shows 'Pick 5 games'", "Pick 5 games" in review_text)
        check("review step shows 'Imported pool spreads'", "Imported pool spreads" in review_text)
        check("review step shows 2 entries", "2" in review_text)
        check("review button reads 'Create pool'", "Create pool" in page.locator("#atsWizNext").inner_text())

        # Edit link takes us back to the right step.
        page.locator("[data-ats-wiz-edit='2']").click()
        page.wait_for_timeout(150)
        check("clicking the 'Weekly picks' edit link jumps back to step 2",
              "Step 2 of 4" in page.locator(".pg-wizard-head h2").inner_text())
        check("editing preserved the previously-entered count (5)",
              page.locator("#atsWizWeeklyCount").input_value() == "5")

        # Advance forward again from step 2 back to review (edit links only
        # exist on the review step itself).
        page.click("#atsWizNext")  # -> step 3 (lineSource was already set to "import")
        page.wait_for_timeout(150)
        page.click("#atsWizNext")  # -> step 4 (entryCount was already set to 2)
        page.wait_for_timeout(150)
        page.click("#atsWizNext")  # -> review
        page.wait_for_timeout(150)

        # Switch lines to "Enter lines manually" from the review screen's
        # edit link -- this is an offline harness with no real network, so
        # "Import my pool sheet" would trigger a native OS file picker
        # Playwright can't interact with; manual entry lets pool creation
        # complete cleanly.
        page.locator("[data-ats-wiz-edit='3']").click()
        page.wait_for_timeout(150)
        page.locator(".pg-wizard-choice", has_text="Enter lines manually").click()
        page.wait_for_timeout(150)
        page.click("#atsWizNext")  # -> step 4
        page.wait_for_timeout(150)
        page.click("#atsWizNext")  # -> review
        page.wait_for_timeout(150)
        page.click("#atsWizNext")  # -> create
        page.wait_for_timeout(400)
        page.screenshot(path="/tmp/ats_wizard_created.png", full_page=True)

        check("after creating: the wizard closes and the normal Pools view returns",
              page.locator("#poolsNormalView").is_visible())
        check("after creating: the new pool appears in the pools list",
              "Grundy's ATS Pool" in page.locator("#poolsList").inner_text())
        debug_state = page.evaluate("() => ({activeContext: state.activeContext, poolIds: (state.pools||[]).map(p=>({id:p.id,name:p.name}))})")
        check("after creating: state.activeContext points at the new pool (the real source of truth)",
              debug_state["activeContext"] == debug_state["poolIds"][0]["id"] if debug_state["poolIds"] else False)

        # The context bar is deliberately hidden/not re-rendered while on
        # the Pools tab itself (see sharedWidgetsHiddenOnCurrentTab()) --
        # switch to Snapshot to see it actually reflect the new pool.
        page.click("button[data-tab='snapshot']")
        page.wait_for_timeout(300)
        ctx_bar_text = page.locator("#contextBar").inner_text()
        check("after switching to Snapshot: the Viewing context bar reflects the new pool",
              "Grundy's ATS Pool" in ctx_bar_text)

        browser.close()
    httpd.shutdown()

    print()
    passed = sum(1 for _, ok in checks if ok)
    print(f"{passed}/{len(checks)} checks passed")
    if passed != len(checks):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
