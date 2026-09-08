"""
One-off Playwright render verifying Drew's request: "can it be pickgauge
model # instead" for the logged-out Guest Snapshot preview, with SP+ as a
per-game fallback only. Bypasses the actual network fetch to
/api/public_snapshot (that response shape is already covered by
tests/test_public_snapshot.py) and instead exercises the real CLIENT-SIDE
logic this fix actually lives in: model.js's relaxed-coverage
pickGaugeModelNumber()/myNumber(), fed with realistic sag+cfbdsp data the
way guest-snapshot.js's _guestLoadData() would after a real fetch.

Builds the exact kind of case Drew flagged: a team with a big raw SP+-vs-
market gap, then shows what the OLD (pure SP+, no market anchor) vs. NEW
(relaxed PickGauge Model #, ~19% market-anchored + Sagarin-damped) edge
number looks like for the same game, side by side. Not meant to run in
CI. Run manually:

    python3 tests/_render_guest_pickgauge_model.py
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
  user: null,
  session: null,
  load: async () => {},
  mountSignIn: () => {},
  addListener: () => {},
  signOut: async () => {},
};
window.__internal_ClerkUICtor = {};
"""

# Modeled on Drew's real screenshot: Ohio State Buckeyes +1.5 (market),
# with a big enough SP+-vs-market gap to produce the implausible-looking
# raw edge he flagged. sag (Sagarin Ratings) is deliberately set closer to
# the market than SP+ is -- realistic, since Sagarin doesn't weight
# returning production/recruiting as heavily as SP+ does early in a
# season, so it doesn't diverge from the market as sharply.
GAMES = [
    # away, home, market_home_line, sp_home_line, sag_home_line
    ["Some Team", "Ohio State", 1.5, -7.3, -3.5],
    ["Some Other Team", "Hawaii", -8.5, -18.5, -11.0],
]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass


SETUP_JS = """
  (gameSpecs) => {
    isDemo = false;
    const gs = gameSpecs.map(([away, home, market], i) => ({
      id:'evt'+i, away, home, cfbdAwaySchool:away, cfbdHomeSchool:home,
      commence:'2026-09-08T16:00:00Z', vegas: market, book:'consensus',
    }));
    state.lastGames = gs;
    state.weekAnchor = "ALL";
    state.pools = [];
    state.activeContext = null;
    state.entries = [{id:'e1', name:'Me', picks:{}}];
    state.predMeta = {fetchedAt: new Date().toISOString(), count: gs.length};
    buildGames(); migrateGameKeys(); sortGames();
    games.forEach(g => {
      const spec = gameSpecs.find(([away, home]) => away === g.away && home === g.home);
      if (spec) { const [, , , sp, sag] = spec;
        predByKey[g.key] = {cfbdsp: sp, sag: sag};
      }
    });
  }
"""


def setup_guest_mode(page, relaxed):
    page.evaluate(SETUP_JS, GAMES)
    if relaxed:
        page.evaluate("""() => {
          state.pickGaugeModelEnabled = true;
          state.guestModelRelaxedCoverage = true;
          state.enabledSystems = ['cfbdsp'];
        }""")
    else:
        page.evaluate("""() => {
          state.pickGaugeModelEnabled = false;
          state.guestModelRelaxedCoverage = false;
          state.enabledSystems = ['cfbdsp'];
        }""")


def main():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.2)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 500, "height": 900})
        page.add_init_script(CLERK_MOCK)
        page.goto(f"http://127.0.0.1:{port}/app/")
        page.wait_for_selector("#appRoot", state="attached", timeout=5000)
        page.wait_for_function("document.getElementById('appRoot').style.display !== 'none'", timeout=5000)
        page.wait_for_timeout(300)

        print("=== OLD behavior: pure SP+, no market anchor ===")
        setup_guest_mode(page, relaxed=False)
        rows_old = page.evaluate(
            "() => games.map(g => ({game: g.away+' @ '+g.home, vegas: g.vegas, myn: myNumber(g), edge: edgeOf(g)}))"
        )
        for r in rows_old:
            e = r["edge"] or {}
            print(f"  {r['game']}: market={r['vegas']}, myNumber={r['myn']}, "
                  f"pick={e.get('team')} {e.get('line')}, raw_edge={e.get('pts')}")

        print("\n=== NEW behavior: relaxed PickGauge Model # (sag+cfbdsp+~19% market anchor) ===")
        setup_guest_mode(page, relaxed=True)
        rows_new = page.evaluate(
            "() => games.map(g => ({game: g.away+' @ '+g.home, vegas: g.vegas, myn: myNumber(g), edge: edgeOf(g)}))"
        )
        for r in rows_new:
            e = r["edge"] or {}
            print(f"  {r['game']}: market={r['vegas']}, myNumber={r['myn']}, "
                  f"pick={e.get('team')} {e.get('line')}, raw_edge={e.get('pts')}")

        page.evaluate("if (typeof renderSnapshot === 'function') renderSnapshot();")
        page.wait_for_timeout(200)
        hamburger = page.query_selector(".nav-hamburger")
        if hamburger and hamburger.is_visible():
            hamburger.click()
            page.wait_for_timeout(200)
        snap_btn = page.query_selector('button[data-tab="snapshot"]')
        if snap_btn:
            snap_btn.click()
            page.wait_for_timeout(300)
        page.screenshot(path="/tmp/guest_pickgauge_model.png", full_page=True)
        browser.close()


if __name__ == "__main__":
    main()
