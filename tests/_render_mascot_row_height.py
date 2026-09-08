"""
One-off Playwright verification for Drew's follow-up question: "does that
reduce each game row height?" Renders the SAME games from his screenshot
(Florida A&M @ Miami, East Carolina @ Alabama, etc.) twice on the real Pick
Board -- once with full Odds-API names (mascots included, simulating the
pre-fix behavior) and once with CFBD school-only names (the actual post-fix
behavior) -- and measures real rendered row heights for both, at desktop
and mobile widths. Not meant to run in CI. Run manually:

    python3 tests/_render_mascot_row_height.py
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

# Real matchups from Drew's screenshot, full Odds-API names (with mascots).
MATCHUPS = [
    ("Florida A&M Rattlers", "Miami Hurricanes"),
    ("Villanova Wildcats", "Louisville Cardinals"),
    ("Richmond Spiders", "NC State Wolfpack"),
    ("Norfolk State Spartans", "Virginia Cavaliers"),
    ("Appalachian State Mountaineers", "East Carolina Pirates"),
    ("Arizona State Sun Devils", "Texas A&M Aggies"),
    ("East Tennessee State Buccaneers", "North Carolina Tar Heels"),
    ("Howard Bison", "Indiana Hoosiers"),
]
# CFBD's school-only equivalents (what g.cfbdAwaySchool/g.cfbdHomeSchool
# actually resolve to for these teams).
SCHOOLS = [
    ("Florida A&M", "Miami"),
    ("Villanova", "Louisville"),
    ("Richmond", "NC State"),
    ("Norfolk State", "Virginia"),
    ("Appalachian State", "East Carolina"),
    ("Arizona State", "Texas A&M"),
    ("East Tennessee State", "North Carolina"),
    ("Howard", "Indiana"),
]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass


def setup_board(page, with_schools):
    page.goto(f"http://127.0.0.1:{page._port}/app/")
    page.wait_for_selector("#appRoot", state="attached", timeout=5000)
    page.wait_for_function("document.getElementById('appRoot').style.display !== 'none'", timeout=5000)
    page.wait_for_timeout(300)
    page.evaluate(
        """
      (args) => {
        const {matchups, schools, withSchools} = args;
        isDemo = false;
        const gs = matchups.map(([away, home], i) => {
          const g = {id:'evt'+i, away, home, commence:'2026-09-08T17:00:00Z', vegas:-8.0, book:'consensus'};
          if (withSchools) { g.cfbdAwaySchool = schools[i][0]; g.cfbdHomeSchool = schools[i][1]; }
          return g;
        });
        state.lastGames = gs;
        state.weekAnchor = "ALL";
        state.pools = [];
        state.activeContext = null;
        state.entries = [{id:'e1', name:'Me', picks:{}}];
        state.enabledSystems = ['bp','comp','sag','sp'];
        state.predictions = gs.map(g=>({home:g.home, road:g.away, systems:{sag:-8.0, sp:-8.0}}));
        state.predMeta = {fetchedAt: new Date().toISOString(), count: gs.length};
        buildGames(); migrateGameKeys(); sortGames();
        renderBoard();
      }
    """,
        {"matchups": list(MATCHUPS), "schools": list(SCHOOLS), "withSchools": with_schools},
    )
    page.wait_for_timeout(300)
    hamburger = page.query_selector(".nav-hamburger")
    if hamburger and hamburger.is_visible():
        hamburger.click()
        page.wait_for_timeout(200)
    page.click('button[data-tab="pickboard"]')
    page.wait_for_timeout(300)


def measure(page):
    page.evaluate("document.querySelector('tr[data-key]')?.scrollIntoView()")
    page.wait_for_timeout(100)
    return page.evaluate(
        """
      () => {
        const rows = Array.from(document.querySelectorAll('tr[data-key]'));
        return rows.map(r => Math.round(r.getBoundingClientRect().height));
      }
    """
    )


def report(label, before, after):
    print(f"\n--- {label} ---")
    print("row heights WITH mascots (pre-fix):   ", before)
    print("row heights WITHOUT mascots (post-fix):", after)
    total_before, total_after = sum(before), sum(after)
    print(f"total table height: {total_before}px -> {total_after}px "
          f"({total_before - total_after}px saved, {len(before)} rows)")
    changed = [i for i, (b, a) in enumerate(zip(before, after)) if b != a]
    print(f"rows that actually got shorter: {len(changed)} of {len(before)}")


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
        page = browser.new_page(viewport={"width": 1360, "height": 900})
        page._port = port
        page.add_init_script(CLERK_MOCK)
        setup_board(page, with_schools=False)
        before_desktop = measure(page)
        page.screenshot(path="/tmp/mascot_before_desktop.png", full_page=False)
        setup_board(page, with_schools=True)
        after_desktop = measure(page)
        page.screenshot(path="/tmp/mascot_after_desktop.png", full_page=False)
        report("Desktop (1360px)", before_desktop, after_desktop)
        page.close()

        # --- Mobile ---
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page._port = port
        page.add_init_script(CLERK_MOCK)
        setup_board(page, with_schools=False)
        before_mobile = measure(page)
        page.screenshot(path="/tmp/mascot_before_mobile.png", full_page=True)
        setup_board(page, with_schools=True)
        after_mobile = measure(page)
        page.screenshot(path="/tmp/mascot_after_mobile.png", full_page=True)
        report("Mobile (390px)", before_mobile, after_mobile)
        page.close()

        browser.close()


if __name__ == "__main__":
    main()
