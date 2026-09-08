"""
One-off Playwright render verifying Drew's report: "after loading
predictions the edge gets populated and then each game row becomes tall
again... it seems like the edge section is too tall." Builds real games
with enough prediction-system data to make PickGauge Model # produce a
real edge, a key-number badge, AND a model-agreement badge -- the exact
combination from Drew's screenshot -- then checks the actual rendered
row/cell markup after the .edge-flex fix. Not meant to run in CI. Run
manually:

    python3 tests/_render_edge_flex.py
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

# Real matchups + numbers modeled on Drew's screenshot: Vegas well off the
# model's number, landing near a key number (3/7/10), with every PickGauge
# Model # input system agreeing on the same side -- reproduces both the
# key-number badge AND the "5/5 agree" badge at once.
GAMES = [
    ["Buffalo", "Florida International", -10.5, -5.8],
    ["Louisiana Tech", "LSU", -35.5, -31.4],
    ["Texas Tech", "Oregon State", -26.5, 22.4],
]

SETUP_JS = """
  (gameSpecs) => {
    isDemo = false;
    const gs = gameSpecs.map(([away, home, vegas, model], i) => ({
      id:'evt'+i, away, home, cfbdAwaySchool:away, cfbdHomeSchool:home,
      commence:'2026-09-08T16:00:00Z', vegas, book:'consensus',
    }));
    state.lastGames = gs;
    state.weekAnchor = "ALL";
    state.pools = [];
    state.activeContext = null;
    state.entries = [{id:'e1', name:'Me', picks:{}}];
    state.pickGaugeModelEnabled = true;
    state.enabledSystems = ['bp','comp','vegas'];
    state.predictions = [];
    state.predMeta = {fetchedAt: new Date().toISOString(), count: gs.length};
    buildGames(); migrateGameKeys(); sortGames();
    // Bypass the fuzzy team-name-matching pipeline that normally builds
    // predByKey (pdf-import.js) -- this is a visual check, not a test of
    // that matching logic, so set it directly keyed by the real game keys
    // buildGames() just assigned, guaranteeing the data actually reaches
    // pickGaugeModelValues()/predsFor() regardless of whether these
    // fictional team names would fuzzy-match a real roster.
    games.forEach(g => {
      const spec = gameSpecs.find(([away, home]) => away === g.away && home === g.home);
      if (spec) { const model = spec[3];
        predByKey[g.key] = {teamrank: model, sagpred: model, cfbdsp: model, wayward: model, sag: model};
      }
    });
    renderBoard();
  }
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass


def load_board(page, port):
    page.goto(f"http://127.0.0.1:{port}/app/")
    page.wait_for_selector("#appRoot", state="attached", timeout=5000)
    page.wait_for_function("document.getElementById('appRoot').style.display !== 'none'", timeout=5000)
    page.wait_for_timeout(300)
    page.evaluate(SETUP_JS, GAMES)
    page.wait_for_timeout(300)
    hamburger = page.query_selector(".nav-hamburger")
    if hamburger and hamburger.is_visible():
        hamburger.click()
        page.wait_for_timeout(200)
    page.click('button[data-tab="pickboard"]')
    page.wait_for_timeout(300)
    debug = page.evaluate(
        "() => games.map(g => ({key:g.key, vegas:g.vegas, myn:myNumber(g), edge:edgeOf(g)}))"
    )
    import json
    print("DEBUG games/edge:", json.dumps(debug, indent=2))


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
        load_board(page, port)
        heights = page.evaluate(
            "() => Array.from(document.querySelectorAll('tr[data-key]')).map(r => Math.round(r.getBoundingClientRect().height))"
        )
        edge_html = page.evaluate(
            "() => { const td = document.querySelector('td.edge'); return td ? td.innerHTML : null; }"
        )
        print("desktop row heights:", heights)
        print("first edge cell HTML:\n", edge_html)
        page.screenshot(path="/tmp/edge_flex_desktop.png", full_page=False)
        page.close()

        page2 = browser.new_page(viewport={"width": 390, "height": 844})
        page2.add_init_script(CLERK_MOCK)
        load_board(page2, port)
        page2.screenshot(path="/tmp/edge_flex_mobile.png", full_page=True)
        page2.close()

        browser.close()


if __name__ == "__main__":
    main()
