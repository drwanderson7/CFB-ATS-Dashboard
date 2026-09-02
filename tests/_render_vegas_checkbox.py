"""
One-off Playwright verification for the Sept 2, 2026 "Vegas as a real
checkbox" feature. Not part of the numbered test_*.py suite. Run:

    python3 tests/_render_vegas_checkbox.py

Checks, in real headless Chromium against the actual index.html/app/js:
  1. DIY mode (PickGauge Model # off): a "Vegas (live line)" checkbox
     exists in the systems grid, unchecked by default, with no weight
     box showing until checked.
  2. Checking it reveals a weight input (default value 1).
  3. Switching to My Blend mode (PickGauge Model # on): the Vegas
     checkbox is still present and usable there too -- this is the
     actual feature gap that prompted the change (previously there was
     no way to add Vegas to My Blend at all).
  4. The old standalone "INPUT WEIGHTS ... Vegas" box is gone.
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
        page = browser.new_page(viewport={"width": 1360, "height": 1100})
        page.add_init_script(CLERK_MOCK)

        page.goto(f"http://127.0.0.1:{port}/app/")
        page.wait_for_selector("#appRoot", state="attached", timeout=5000)
        page.wait_for_function(
            "document.getElementById('appRoot').style.display !== 'none'", timeout=5000
        )
        page.wait_for_timeout(300)

        page.click("button[data-tab='board']")
        page.wait_for_timeout(200)
        page.click("#predPanel summary")
        page.wait_for_timeout(200)

        # --- DIY mode (PickGauge Model # off, the default state) ---
        pg_checked = page.eval_on_selector("#pickGaugeModelBtn", "el => el.checked")
        check("starts in DIY mode (PickGauge Model # unchecked)", pg_checked is False)

        vegas_row = page.locator("#systemsList .sys-item", has_text="Vegas (live line)")
        check("DIY mode: a 'Vegas (live line)' checkbox item exists", vegas_row.count() == 1)

        vegas_checkbox = vegas_row.locator("input[type=checkbox]")
        vegas_checked_initially = vegas_checkbox.is_checked()
        check("DIY mode: Vegas checkbox is unchecked by default", not vegas_checked_initially)

        vegas_weight_visible_before = vegas_row.locator(".sys-weight").count()
        check("DIY mode: no weight box shows for Vegas while unchecked", vegas_weight_visible_before == 0)

        old_input_weights_vegas = page.locator("#coreWeights #cwVegas").count()
        check("the old standalone 'INPUT WEIGHTS ... Vegas' box is gone", old_input_weights_vegas == 0)

        page.screenshot(path="/tmp/vegas_diy_before_check.png", full_page=True)

        # Check the Vegas box.
        vegas_checkbox.click()
        page.wait_for_timeout(200)

        vegas_row_after = page.locator("#systemsList .sys-item", has_text="Vegas (live line)")
        weight_input = vegas_row_after.locator(".sys-weight")
        check("DIY mode: checking Vegas reveals a weight input", weight_input.count() == 1)
        if weight_input.count() == 1:
            val = weight_input.input_value()
            check(f"DIY mode: Vegas weight input defaults to 1 (got {val!r})", val == "1")

        page.screenshot(path="/tmp/vegas_diy_checked.png", full_page=True)

        # --- Switch to My Blend mode (PickGauge Model # on) ---
        # Turning PickGauge on intentionally clears every previously-checked
        # comparison system for a clean start (applyPickGaugeModelPreset(),
        # `if(turningOn) state.enabledSystems=[];`) -- true for BP/Comp
        # already, and now Vegas too. That's existing, deliberate behavior,
        # not something this feature changes. So: verify Vegas can be
        # checked and works WITHIN My Blend mode, rather than expecting a
        # DIY-mode check to survive the switch.
        page.click("#pickGaugeModelBtn")
        page.wait_for_timeout(200)

        pg_checked_now = page.eval_on_selector("#pickGaugeModelBtn", "el => el.checked")
        check("My Blend mode: PickGauge Model # is now checked", pg_checked_now is True)

        vegas_row_blend = page.locator("#systemsList .sys-item", has_text="Vegas (live line)")
        check("My Blend mode: Vegas checkbox item still present", vegas_row_blend.count() == 1)

        vegas_checkbox_blend = vegas_row_blend.locator("input[type=checkbox]")
        cleared_on_switch = not vegas_checkbox_blend.is_checked()
        check("My Blend mode: turning PickGauge on resets Vegas along with every other comparison system (existing, intentional 'clean start' behavior)",
              cleared_on_switch)

        page.screenshot(path="/tmp/vegas_my_blend_before_check.png", full_page=True)

        # This is the actual feature: check Vegas WHILE My Blend is active.
        vegas_checkbox_blend.click()
        page.wait_for_timeout(200)

        vegas_row_blend2 = page.locator("#systemsList .sys-item", has_text="Vegas (live line)")
        weight_input_blend = vegas_row_blend2.locator(".sys-weight")
        check("My Blend mode: checking Vegas here reveals its weight input (it now feeds My Blend, not just DIY Model #)",
              weight_input_blend.count() == 1)
        if weight_input_blend.count() == 1:
            val = weight_input_blend.input_value()
            check(f"My Blend mode: Vegas weight input defaults to 1 here too (got {val!r})", val == "1")

        page.screenshot(path="/tmp/vegas_my_blend_mode.png", full_page=True)

        browser.close()
    httpd.shutdown()

    print()
    passed = sum(1 for _, ok in checks if ok)
    print(f"{passed}/{len(checks)} checks passed")
    if passed != len(checks):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
