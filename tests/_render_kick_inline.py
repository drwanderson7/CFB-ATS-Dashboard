"""
One-off Playwright render verifying Drew's follow-up request: move the
kickoff time + rotation number line ("Sat, 11:00 AM CDT · Rot 331-332")
to sit to the right of the "Matchup breakdown" toggle instead of on its
own line below it, to save further row height. Serves over real HTTP at
repo root (absolute /app/... paths only resolve that way). Not meant to
run in CI. Run manually:

    python3 tests/_render_kick_inline.py
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

MATCHUPS = [
    ("Arizona State", "Texas A&M", 329, 330),
    ("South Florida", "Army", 331, 332),
    ("East Tennessee State", "North Carolina", None, None),
]


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
    page.evaluate(
        """
      (matchups) => {
        isDemo = false;
        const gs = matchups.map(([away, home, ar, hr], i) => {
          const g = {id:'evt'+i, away:away, home:home, cfbdAwaySchool:away, cfbdHomeSchool:home,
                     commence:'2026-09-08T16:00:00Z', vegas:-14.5, book:'consensus'};
          if (ar!=null) { g.awayRotation = ar; g.homeRotation = hr; }
          return g;
        });
        state.lastGames = gs;
        state.weekAnchor = "ALL";
        state.pools = [];
        state.activeContext = null;
        state.entries = [{id:'e1', name:'Me', picks:{}}];
        state.enabledSystems = ['bp','comp','sag','sp'];
        state.predictions = gs.map(g=>({home:g.home, road:g.away, systems:{sag:-14.5, sp:-14.5}}));
        state.predMeta = {fetchedAt: new Date().toISOString(), count: gs.length};
        buildGames(); migrateGameKeys(); sortGames();
        renderBoard();
      }
    """,
        list(MATCHUPS),
    )
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

        page = browser.new_page(viewport={"width": 1360, "height": 700})
        page._port = port
        page.add_init_script(CLERK_MOCK)
        setup_board(page)
        heights = page.evaluate(
            """() => Array.from(document.querySelectorAll('tr[data-key]')).map(r => Math.round(r.getBoundingClientRect().height))"""
        )
        print("desktop row heights:", heights)
        page.screenshot(path="/tmp/kick_inline_desktop.png", full_page=False)
        page.close()

        page = browser.new_page(viewport={"width": 390, "height": 844})
        page._port = port
        page.add_init_script(CLERK_MOCK)
        setup_board(page)
        page.screenshot(path="/tmp/kick_inline_mobile.png", full_page=True)
        page.close()

        browser.close()


if __name__ == "__main__":
    main()
