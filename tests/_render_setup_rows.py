"""
One-off Playwright verification for the clickable Weekly Setup checklist
rows (not part of the numbered test_*.py suite). Serves over real HTTP
at repo root, same as test_e2e_ui_behaviors.py, since the app's absolute
<script src="/app/..."> paths only resolve correctly that way. Run:

    python3 tests/_render_setup_rows.py
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

        # Force a genuinely incomplete, non-demo state so every row is real.
        page.evaluate("""
          () => {
            isDemo = false;
            games = [{key:'g1', away:'Team A', home:'Team B', commence:'2026-09-15T17:00:00Z'}];
            state.enabledSystems = ['sagp'];
            state.lastGames = null;
            state.predMeta = null;
            renderSetupStatus();
          }
        """)
        page.wait_for_timeout(200)

        page.click(".setup-details summary")
        page.wait_for_timeout(150)
        page.screenshot(path="/tmp/setup_rows_open.png", full_page=True)

        # "Prediction systems loaded" row -> Edge Board, predPanel open, highlighted.
        page.click('.setup-row-action[data-setup-key="preds"]')
        page.wait_for_timeout(400)
        active_tab = page.evaluate("document.querySelector('nav.tabs button.active').dataset.tab")
        panel_open = page.evaluate("document.getElementById('predPanel').open")
        highlighted = page.evaluate(
            "document.getElementById('loadPredsBtn2').classList.contains('setup-highlight-pulse')"
        )
        print("preds row -> active tab:", active_tab, "| predPanel open:", panel_open, "| highlight:", highlighted)
        page.screenshot(path="/tmp/setup_rows_after_preds_click.png", full_page=True)

        # Vegas row: no tab switch, header button gets highlighted in place.
        page.click('button[data-tab="snapshot"]')
        page.wait_for_timeout(150)
        page.evaluate("""
          () => {
            isDemo = false;
            games = [{key:'g1', away:'Team A', home:'Team B', commence:'2026-09-15T17:00:00Z'}];
            state.enabledSystems = ['sagp'];
            state.lastGames = null;
            state.predMeta = null;
            renderSetupStatus();
          }
        """)
        page.wait_for_timeout(150)
        page.click('.setup-row-action[data-setup-key="vegas"]')
        page.wait_for_timeout(200)
        active_tab3 = page.evaluate("document.querySelector('nav.tabs button.active').dataset.tab")
        highlighted3 = page.evaluate(
            "document.getElementById('refreshBtn').classList.contains('setup-highlight-pulse')"
        )
        print("vegas row -> active tab (should stay snapshot):", active_tab3, "| highlight:", highlighted3)

        print("=== Console/page errors ===")
        for e in errors:
            print(" -", e)
        if not errors:
            print(" (none)")

        browser.close()
    httpd.shutdown()
    print("done")


if __name__ == "__main__":
    main()
