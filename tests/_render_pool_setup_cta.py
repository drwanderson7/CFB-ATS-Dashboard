"""
One-off Playwright verification for the new pool-setup discovery CTA on
Snapshot/Edge Board (renderPoolSetupCta(), app/js/board.js). Not part of
the numbered CI suite. Run manually:

    python3 tests/_render_pool_setup_cta.py
"""
import http.server, socketserver, threading, time, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLERK_MOCK = """
window.Clerk = {
  user: { id: 'test_user', primaryEmailAddress: { emailAddress: 'test@example.com' } },
  session: { getToken: async () => 'fake.jwt.token' },
  load: async () => {}, mountSignIn: () => {}, addListener: () => {}, signOut: async () => {},
};
window.__internal_ClerkUICtor = {};
"""

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, f, *a): pass

def main():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.2)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1360, "height": 900})
        page.add_init_script(CLERK_MOCK)
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{port}/app/")
        page.wait_for_selector("#appRoot", state="attached", timeout=5000)
        page.wait_for_function("document.getElementById('appRoot').style.display !== 'none'", timeout=5000)
        page.wait_for_timeout(300)

        # Real (non-demo) live data, Overall board, zero pools ever -- the
        # gap case: previously zero pool messaging here.
        page.evaluate("""
          () => {
            isDemo = false;
            const gs = [{key:'g0', away:'Liberty Flames', home:'James Madison Dukes', commence:'2026-09-05T17:00:00Z', vegas:-6.0}];
            games = gs;
            state.lastGames = gs;
            state.lastRefresh = new Date().toISOString();
            state.pools = [];
            state.activeContext = 'overall';
            renderBoard(); renderSnapshot(); renderSetupStatus();
          }
        """)
        page.wait_for_timeout(300)

        print("=== Snapshot tab (default) ===")
        cta_visible = page.is_visible("#poolSetupCta")
        print("pool setup CTA visible on Snapshot:", cta_visible)
        page.screenshot(path="/tmp/pool_cta_snapshot.png", full_page=False)

        page.click('button[data-tab="board"]')
        page.wait_for_timeout(300)
        print("=== Edge Board tab ===")
        cta_visible_board = page.is_visible("#poolSetupCta")
        print("pool setup CTA visible on Edge Board:", cta_visible_board)
        page.screenshot(path="/tmp/pool_cta_board.png", full_page=False)

        # Click the CTA button -> should jump to Pools tab
        page.click("#poolSetupCtaBtn")
        page.wait_for_timeout(300)
        active_tab = page.evaluate("document.querySelector('.panel.active')?.id")
        print("active tab after clicking CTA button:", active_tab)
        page.screenshot(path="/tmp/pool_cta_after_click.png", full_page=False)

        # Now simulate having created a pool -- CTA should disappear forever.
        page.evaluate("""
          () => {
            state.pools = [{id:'p1', name:'Test Pool', pickLimit:7, weekLabel:'Week 1', games:[], entries:[{id:'e1', name:'Me', picks:{}}], activeEntryId:'e1', history:[]}];
            switchTab('overall'.length ? 'snapshot' : 'snapshot');
            switchTab('snapshot');
            renderBoard(); renderSnapshot(); renderSetupStatus();
          }
        """)
        page.wait_for_timeout(300)
        print("=== After creating a pool, back on Snapshot ===")
        cta_after_pool = page.is_visible("#poolSetupCta")
        print("pool setup CTA visible (should be False now):", cta_after_pool)

        print("errors:", errors or "(none)")
        browser.close()

if __name__ == "__main__":
    main()
