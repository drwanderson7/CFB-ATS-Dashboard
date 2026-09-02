"""
Real-browser E2E test for the shared PickGauge modal layer: real DOM
interaction for the native-dialog replacement. Creating a pool used to
require two blocking browser prompts; it is now one validated in-app
form. Also verifies Escape cancellation and that no native browser
dialog event fires during the flow.

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
            page.click('button[data-tab="pools"]')
            page.wait_for_timeout(150)

            page.click("#poolsNewBtn")
            page.wait_for_timeout(100)
            check("New pool opens the PickGauge modal layer, not a browser prompt",
                  page.is_visible("#pgDialogLayer.open") and page.is_visible(".pg-dialog"))
            check("new-pool modal contains both Pool name and Picks per entry fields in one form",
                  page.locator('#pgDialogLayer input[name="name"]').count() == 1
                  and page.locator('#pgDialogLayer input[name="pickLimit"]').count() == 1)

            page.fill('#pgDialogLayer input[name="name"]', "Dialog Test Pool")
            page.fill('#pgDialogLayer input[name="pickLimit"]', "0")
            page.click('#pgDialogLayer button[type="submit"]')
            page.wait_for_timeout(100)
            check("invalid pick limit stays in the modal and shows inline validation",
                  page.is_visible("#pgDialogLayer.open")
                  and page.is_visible("#pgDialogLayer .pg-dialog-error"))

            page.fill('#pgDialogLayer input[name="pickLimit"]', "9")
            page.click('#pgDialogLayer button[type="submit"]')
            page.wait_for_timeout(200)
            check("valid new-pool form closes the modal",
                  not page.is_visible("#pgDialogLayer.open"))
            row = page.locator(".pool-row", has_text="Dialog Test Pool")
            check("valid new-pool form creates the pool with the requested pick limit",
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
