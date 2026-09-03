"""
Real-browser E2E test for the shared PickGauge modal layer: real DOM
interaction for the native-dialog replacement. Also verifies Escape
cancellation and that no native browser dialog event fires during the
flow.

Pool creation itself (Sept 2, 2026) now goes through a dedicated
step-by-step wizard rather than this shared modal layer -- see
tests/_render_ats_pool_wizard.py for that wizard's own coverage. This file
still exercises the new-pool wizard briefly (to stay accurate about what
actually opens when "+ New pool" is clicked) plus the remaining
pgDialogLayer-based flows (Edit pick limit, Escape-to-cancel) that are
unaffected by that change.

One of 7 files split out of the original test_e2e_ui_behaviors.py (Sept 1,
2026, TODO #26) -- see tests/_e2e_common.py for the shared harness, and
the other test_e2e_*.py files for the remaining scenarios.

Run with:

    python3 tests/test_e2e_dialogs.py
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
            native_dialogs = []
            page.on("dialog", lambda d: (native_dialogs.append(d.type), d.dismiss()))
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(1000)
            page.click('button[data-tab="pickboard"]')
            page.wait_for_timeout(100)
            page.click('[data-pickboard-view="pools"]')
            page.wait_for_timeout(150)

            page.click("#poolsNewBtn")
            page.wait_for_timeout(150)
            # Sept 2, 2026: "+ New pool" now opens the step-by-step ATS
            # setup wizard (matching the Confidence pool wizard's pattern),
            # not the old single pgDialogLayer form. See
            # tests/_render_ats_pool_wizard.py for the wizard's own
            # dedicated real-browser coverage; this test just needs to stay
            # accurate about which UI actually opens here.
            check("New pool opens the ATS setup wizard card, not the old single-form modal",
                  page.locator(".pg-wizard-card").count() == 1
                  and not page.is_visible("#pgDialogLayer.open"))
            check("wizard starts on step 1 (pool name)",
                  "Step 1 of 4" in page.locator(".pg-wizard-head h2").inner_text())

            # Step 1: name. Continue is disabled with no name.
            check("Continue is disabled until a name is entered",
                  page.locator("#atsWizNext").is_disabled())
            page.fill("#atsWizName", "Dialog Test Pool")
            page.wait_for_timeout(100)
            page.click("#atsWizNext")
            page.wait_for_timeout(150)

            # Step 2: weekly picks. Choose a set number; Continue disabled at 0.
            page.locator(".pg-wizard-choice", has_text="Pick a set number").click()
            page.wait_for_timeout(100)
            page.fill("#atsWizWeeklyCount", "0")
            page.wait_for_timeout(100)
            check("invalid pick count (0) keeps Continue disabled -- same 'can't proceed with bad input' guarantee the old modal's inline validation gave, expressed as a disabled button instead",
                  page.locator("#atsWizNext").is_disabled())
            page.fill("#atsWizWeeklyCount", "9")
            page.wait_for_timeout(100)
            check("a valid pick count (9) re-enables Continue", not page.locator("#atsWizNext").is_disabled())
            page.click("#atsWizNext")
            page.wait_for_timeout(150)

            # Step 3: lines. Choose manual entry (avoids a native file picker
            # this harness can't interact with).
            page.locator(".pg-wizard-choice", has_text="Enter lines manually").click()
            page.wait_for_timeout(100)
            page.click("#atsWizNext")
            page.wait_for_timeout(150)

            # Step 4: entries. Leave at the default (1).
            page.click("#atsWizNext")
            page.wait_for_timeout(150)

            # Review: create the pool.
            check("review step shows the entered name and pick count before creating",
                  "Dialog Test Pool" in page.locator(".pg-wizard-review").inner_text()
                  and "Pick 9 games" in page.locator(".pg-wizard-review").inner_text())
            page.click("#atsWizNext")
            page.wait_for_timeout(250)
            check("creating the pool closes the wizard",
                  page.locator(".pg-wizard-card").count() == 0)
            row = page.locator(".pool-row", has_text="Dialog Test Pool")
            check("the wizard creates the pool with the requested pick limit",
                  row.count() == 1 and "pick 9" in row.inner_text().lower())

            # Open Edit pick limit, then cancel with Escape. Native prompt()
            # used to own Escape handling automatically; the custom layer must
            # preserve that keyboard behavior itself.
            if row.count() == 1:
                row.locator('[data-pooltrigger$="_more"]').click()
                row.locator('[data-editlimit]').click()
                page.wait_for_timeout(100)
                check("Edit pick limit also uses the shared PickGauge modal",
                      page.is_visible("#pgDialogLayer.open"))
                page.keyboard.press("Escape")
                page.wait_for_timeout(100)
                check("Escape cancels and closes a dismissible PickGauge modal",
                      not page.is_visible("#pgDialogLayer.open"))
                row = page.locator(".pool-row", has_text="Dialog Test Pool")
                check("cancelling Edit pick limit leaves the original value unchanged",
                      row.count() == 1 and "pick 9" in row.inner_text().lower())

            check("native browser dialogs never fired during the migrated modal flow",
                  native_dialogs == [])
            check("no error boundary triggered during modal interaction",
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
