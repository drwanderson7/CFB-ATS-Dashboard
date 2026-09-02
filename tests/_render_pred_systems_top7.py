"""
One-off Playwright verification for the Sept 2, 2026 Prediction Systems
panel changes: the restricted 19-item curated list and the reinstated
"★ Top 7" badges. Not part of the numbered test_*.py suite. Run:

    python3 tests/_render_pred_systems_top7.py
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

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1360, "height": 1000})
        page.add_init_script(CLERK_MOCK)

        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(f"PAGE ERROR: {exc}"))

        page.goto(f"http://127.0.0.1:{port}/app/")
        page.wait_for_selector("#appRoot", state="attached", timeout=5000)
        page.wait_for_function("document.getElementById('appRoot').style.display !== 'none'", timeout=5000)
        page.wait_for_timeout(300)

        page.click("button[data-tab='board']")
        page.wait_for_timeout(300)
        page.screenshot(path="/tmp/debug_before_click.png", full_page=True)
        # Multiple `.pred-summary` elements exist (one per pool tab); only
        # the active tab's copy is actually visible.
        page.click("#predPanel summary")
        page.wait_for_timeout(200)
        page.screenshot(path="/tmp/pred_systems_open.png", full_page=True)
        page.wait_for_timeout(200)

        names = page.eval_on_selector_all(
            "#systemsList .sys-item .sys-name",
            "els => els.map(e => e.textContent.trim())",
        )
        badged = page.eval_on_selector_all(
            "#systemsList .sys-item",
            """els => els
                .filter(e => e.querySelector('.sys-top'))
                .map(e => e.querySelector('.sys-name')?.textContent.trim())""",
        )
        legend = page.text_content(".pred-panel-body .sys-top")

        print("Visible system names:")
        for n in names:
            print(f"  - {n}")
        print()
        print("Systems with a badge:")
        for n in badged:
            print(f"  ★ {n}")
        print()
        print(f"Legend chip text: {legend!r}")
        print()

        expected_names = {
            "BP (Brad Powers line)", "Comp (computer line)",
            "Sagarin (Rating)", "Sagarin Predictor", "Sagarin Golden Mean", "Sagarin Recent",
            "ESPN FPI", "SP+ (CFBD, derived)", "CORE (CFBD, derived)",
            "Dokter Entropy", "Massey Ratings", "Team Rankings",
            "Congrove Computer", "Waywardtrends", "Talisman Red", "Laz Index",
            "Versus Sports Sim", "David Harville", "Beck Elo",
        }
        expected_badged = {
            "Sagarin (Rating)", "Sagarin Predictor", "Waywardtrends",
            "Team Rankings", "SP+ (CFBD, derived)", "ESPN FPI", "Dokter Entropy",
        }

        actual_names = set(names)
        actual_badged = set(badged)

        print("=== CHECKS ===")
        print(f"[{'PASS' if actual_names == expected_names else 'FAIL'}] visible list matches exactly")
        if actual_names != expected_names:
            print(f"    extra: {actual_names - expected_names}")
            print(f"    missing: {expected_names - actual_names}")
        print(f"[{'PASS' if actual_badged == expected_badged else 'FAIL'}] badged list matches exactly")
        if actual_badged != expected_badged:
            print(f"    extra: {actual_badged - expected_badged}")
            print(f"    missing: {expected_badged - actual_badged}")
        print(f"[{'PASS' if legend and '★ Top 7' in legend else 'FAIL'}] legend chip reads Top 7")
        print(f"[{'PASS' if not errors else 'FAIL'}] no console errors")
        if errors:
            for e in errors:
                print(f"    {e}")

        page.screenshot(path="/tmp/pred_systems_panel.png", full_page=False)
        browser.close()
    httpd.shutdown()


if __name__ == "__main__":
    main()
