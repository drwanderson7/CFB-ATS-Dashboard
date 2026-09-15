"""
Real-browser E2E test for the global error boundary: actually catches a
real error thrown during real app execution (not just "the function
exists"), shows the documented dismissible banner (not a full-page
takeover), the dismiss button actually dismisses it, and it can fire
again for a later, different error after being dismissed.

One of 7 files split out of the original test_e2e_ui_behaviors.py (Sept 1,
2026, TODO #26) -- see tests/_e2e_common.py for the shared harness, and
the other test_e2e_*.py files for the remaining scenarios.

Run with:

    python3 tests/test_e2e_error_boundary.py
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
            # Force a real error inside init()'s own execution -- the same
            # technique used to verify this during the init.js split itself,
            # made permanent here instead of one-off.
            page.add_init_script("""
            const origGetById = document.getElementById.bind(document);
            document.getElementById = function(id) {
              if (id === 'refreshBtn') { throw new Error('INTENTIONAL TEST ERROR for automated verification'); }
              return origGetById(id);
            };
            """)
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(1200)

            check("a real error thrown inside init()'s own execution is caught by the error boundary",
                  page.is_visible("#errorBoundary"))

            # Dismissible banner, not a full-page takeover: real page
            # structure (nav tabs) must still be present underneath it.
            check("the error boundary is a banner, not a full-page takeover -- the tab bar is still present underneath",
                  page.locator(".tabs, nav").count() > 0)

            dismiss_exists = page.locator("#errorDismissBtn").count() > 0
            check("dismiss button exists on the error banner", dismiss_exists)
            if dismiss_exists:
                page.click("#errorDismissBtn")
                page.wait_for_timeout(200)
                check("clicking dismiss actually hides the error banner", not page.is_visible("#errorBoundary"))

                # A LATER, DIFFERENT error must still be able to show again --
                # the boundary's own `shown` flag is deliberately reset on
                # dismiss for exactly this reason.
                page.evaluate("() => { setTimeout(() => { throw new Error('SECOND intentional test error'); }, 10); }")
                page.wait_for_timeout(300)
                check("a second, later error can still trigger the banner again after a dismiss "
                      "(the boundary doesn't permanently disable itself after the first catch)",
                      page.is_visible("#errorBoundary"))

            reload_exists = page.locator("#errorReloadBtn").count() > 0
            check("reload button exists on the error banner", reload_exists)

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
