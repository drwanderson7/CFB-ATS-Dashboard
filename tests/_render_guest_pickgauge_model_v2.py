"""
One-off Playwright verification for the REVISED guest PickGauge Model #
fix (Sept 8, 2026, second revision same day): confirms that whenever a
game clears the real, UNMODIFIED 3-of-5-system floor using the two
publicly-exposed tracker systems (sag, wayward) + SP+, the guest number
is byte-for-byte the same as what a signed-in account with those same 3
inputs would compute -- not a lighter, guest-only approximation. Also
confirms the SP+-only fallback still kicks in for a game that can't
clear the real floor. Not meant to run in CI. Run manually:

    python3 tests/_render_guest_pickgauge_model_v2.py
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
  user: null, session: null, load: async () => {}, mountSignIn: () => {},
  addListener: () => {}, signOut: async () => {},
};
window.__internal_ClerkUICtor = {};
"""

GAMES = [
    ["Some Team", "Ohio State", 1.5, -7.3, -3.5, -4.5],
    ["Some Other Team", "Hawaii", -8.5, -18.5, -11.0, -13.0],
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
      if (spec) { const [, , , sp, sag, wayward] = spec;
        predByKey[g.key] = {cfbdsp: sp, sag: sag, wayward: wayward};
      }
    });
  }
"""


def setup_mode(page, guest, with_wayward):
    specs = [g[:5] + [g[5] if with_wayward else None] for g in GAMES]
    page.evaluate(SETUP_JS, specs)
    if guest:
        page.evaluate("""() => {
          state.pickGaugeModelEnabled = true;
          state.guestModelFallbackEnabled = true;
          state.enabledSystems = ['cfbdsp'];
        }""")
    else:
        # A real signed-in account with PickGauge Model # active does NOT
        # need sag/wayward/cfbdsp in state.enabledSystems for the branded
        # recipe to use them -- predByKey feeds pickGaugeModelNumber()
        # directly, independent of which extra comparison COLUMNS a user
        # has separately toggled on to look at. enabledSystems=[] here
        # isolates the pure PickGauge Model # path -- setting it to the
        # same 3 codes instead would (correctly) trigger myBlendActive()
        # and blend PickGauge with each of them AGAIN on top, which is a
        # real, different feature (My Blend), not what a plain "PickGauge
        # Model # is active" account looks like.
        page.evaluate("""() => {
          state.pickGaugeModelEnabled = true;
          state.guestModelFallbackEnabled = false;
          state.enabledSystems = [];
        }""")


def rows(page):
    return page.evaluate(
        "() => games.map(g => ({game: g.away+' @ '+g.home, vegas: g.vegas, myn: myNumber(g)}))"
    )


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

        print("=== Signed-in account, 3 real inputs (sag+wayward+cfbdsp) loaded ===")
        setup_mode(page, guest=False, with_wayward=True)
        signed_in_rows = rows(page)
        for r in signed_in_rows:
            print(f"  {r['game']}: market={r['vegas']}, myNumber={r['myn']}")

        print("\n=== Guest, SAME 3 real inputs available (sag+wayward now public) ===")
        setup_mode(page, guest=True, with_wayward=True)
        guest_rows_full = rows(page)
        for r in guest_rows_full:
            print(f"  {r['game']}: market={r['vegas']}, myNumber={r['myn']}")

        match = all(a["myn"] == b["myn"] for a, b in zip(signed_in_rows, guest_rows_full))
        print(f"\n  MATCH (guest == signed-in with identical inputs): {match}")

        print("\n=== Guest, Waywardtrends NOT yet posted for these games (only 2 of 5) ===")
        setup_mode(page, guest=True, with_wayward=False)
        guest_rows_fallback = rows(page)
        for r in guest_rows_fallback:
            print(f"  {r['game']}: market={r['vegas']}, myNumber={r['myn']} (SP+-only fallback expected)")

        browser.close()


if __name__ == "__main__":
    main()
