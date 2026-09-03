"""
Not a pytest/CI test -- a one-off Playwright render to visually verify the
Edge Board's "Matchup breakdown" toggle button after moving it from its own
far-right table column to directly right of the shortlist flag (still its
own <td>/direct <tr> child -- required for the mobile grid-row/grid-column
repositioning fix from Aug 20 to keep working, see that CSS rule's own
comment in app/index.html). Serves over real HTTP at repo root (absolute
/app/... paths only resolve that way). Not meant to run in CI. Run
manually:

    python3 tests/_render_board_matchup_toggle_position.py
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


def setup_board(page):
    page.goto(f"http://127.0.0.1:{page._port}/app/")
    page.wait_for_selector("#appRoot", state="attached", timeout=5000)
    page.wait_for_function("document.getElementById('appRoot').style.display !== 'none'", timeout=5000)
    page.wait_for_timeout(300)
    page.evaluate("""
      () => {
        isDemo = false;
        const gs = [];
        for (let i = 0; i < 5; i++) {
          gs.push({key:'g'+i, away:'Liberty Flames', home:'James Madison Dukes', commence:'2026-09-05T17:00:00Z', vegas:-6.0, locked:true});
        }
        games = gs;
        state.pools = [{id:'p1', name:'Test Pool', pickLimit:7, weekLabel:'Week 1', games: gs.map(g=>({...g,line:g.vegas})), entries:[{id:'e1', name:'Me', picks:{}}], activeEntryId:'e1', history:[]}];
        state.activeContext = 'p1';
        state.enabledSystems = ['sag','sagp','sp','mas','trnk'];
        state.predictions = gs.map(g=>({home:g.home, road:g.away, systems:{sag:-6.0}}));
        state.predMeta = {fetchedAt: new Date().toISOString(), count: gs.length};
        buildGames(); applyTeamLogos(); migrateGameKeys(); sortGames();
        renderBoard();
      }
    """)
    page.wait_for_timeout(300)
    hamburger = page.query_selector(".nav-hamburger")
    if hamburger and hamburger.is_visible():
        hamburger.click()
        page.wait_for_timeout(200)
    page.click('button[data-tab="pickboard"]')
    page.wait_for_timeout(300)


def main():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.2)

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # --- Desktop ---
        page = browser.new_page(viewport={"width": 1360, "height": 700})
        page._port = port
        page.add_init_script(CLERK_MOCK)
        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(f"PAGE ERROR: {exc}"))
        setup_board(page)
        page.screenshot(path="/tmp/board_toggle_desktop.png", full_page=False)
        print("saved /tmp/board_toggle_desktop.png")
        print("desktop console/page errors:", errors or "(none)")
        page.close()

        # --- Mobile ---
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page._port = port
        page.add_init_script(CLERK_MOCK)
        errors2 = []
        page.on("console", lambda msg: errors2.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors2.append(f"PAGE ERROR: {exc}"))
        setup_board(page)
        page.screenshot(path="/tmp/board_toggle_mobile.png", full_page=False)
        print("saved /tmp/board_toggle_mobile.png")
        print("mobile console/page errors:", errors2 or "(none)")

        # Confirm the toggle button still lands in row 4 on mobile (the
        # exact positioning the Aug 20 fix guaranteed) -- not just eyeballed.
        pos = page.evaluate("""
          () => {
            const cell = document.querySelector('td.board-cfbd-toggle-cell');
            if (!cell) return null;
            const cs = getComputedStyle(cell);
            return { gridRow: cs.gridRowStart, gridColumn: cs.gridColumnStart };
          }
        """)
        print("mobile board-cfbd-toggle-cell computed grid position:", pos)

        browser.close()


if __name__ == "__main__":
    main()
