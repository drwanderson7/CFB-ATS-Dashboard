"""
Not a pytest/CI test -- a one-off Playwright render to visually verify the
Edge Board's "Sort & filter" panel (reported as clunky/unorganized). Serves
over real HTTP at repo root (absolute /app/... paths only resolve that
way, same as tests/_render_setup_rows.py). Not meant to run in CI. Run
manually:

    python3 tests/_render_sort_filter_panel.py
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
        page = browser.new_page(viewport={"width": 1360, "height": 900})
        page.add_init_script(CLERK_MOCK)

        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(f"PAGE ERROR: {exc}"))

        page.goto(f"http://127.0.0.1:{port}/app/")
        page.wait_for_selector("#appRoot", state="attached", timeout=5000)
        page.wait_for_function("document.getElementById('appRoot').style.display !== 'none'", timeout=5000)
        page.wait_for_timeout(300)

        # Reproduce the reported screenshot: a pool context (so the ⚡
        # alignment filter shows), a shortlist count, and enough games/
        # predictions that renderBoard()'s real counts populate.
        page.evaluate("""
          () => {
            isDemo = false;
            const gs = [];
            for (let i = 0; i < 43; i++) {
              gs.push({key:'g'+i, away:'Away '+i, home:'Home '+i, commence:'2026-09-05T17:00:00Z', vegas:-3.5, locked:true});
            }
            games = gs;
            state.pools = [{id:'p1', name:'Test Pool', pickLimit:7, weekLabel:'Week 1', games: gs.map(g=>({...g,line:g.vegas})), entries:[{id:'e1', name:'Me', picks:{}}], activeEntryId:'e1', history:[]}];
            state.activeContext = 'p1';
            state.boardShortlistOnly = false;
            state.boardFilter = 'all';
            state.enabledSystems = ['sag','sagp','sp','mas','trnk'];
            state.predictions = gs.map(g=>({home:g.home, road:g.away, systems:{sag:-3.5}}));
            state.predMeta = {fetchedAt: new Date().toISOString(), count: gs.length};
            buildGames(); applyTeamLogos(); migrateGameKeys(); sortGames();
            renderBoard();
          }
        """)
        page.wait_for_timeout(300)

        # Mobile nav hides tabs behind a hamburger menu at ≤720px.
        hamburger = page.query_selector(".nav-hamburger")
        if hamburger and hamburger.is_visible():
            hamburger.click()
            page.wait_for_timeout(200)

        page.click('button[data-tab="board"]')
        page.wait_for_timeout(300)

        panel = page.query_selector("#boardSortFilterPanel")
        if panel:
            is_open = panel.evaluate("el => el.open")
            print("panel open before click:", is_open)
            if not is_open:
                page.click("#boardSortFilterPanel summary")
                page.wait_for_timeout(300)

        page.screenshot(path="/tmp/sort_filter_before.png", full_page=False)
        print("saved /tmp/sort_filter_before.png")

        box = page.query_selector("#boardSortFilterPanel")
        if box:
            box.screenshot(path="/tmp/sort_filter_panel_only.png")
            print("saved /tmp/sort_filter_panel_only.png")

        print("=== Console/page errors ===")
        for e in errors:
            print(" -", e)
        if not errors:
            print(" (none)")

        browser.close()


if __name__ == "__main__":
    main()

