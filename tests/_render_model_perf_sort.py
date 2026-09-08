"""
One-off Playwright render verifying Drew's Sept 8, 2026 request: clickable
sort headers on the Results tab's Model Performance leaderboard. Not meant
to run in CI. Run manually:

    python3 tests/_render_model_perf_sort.py
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


def build_history():
    # Several systems with distinct W/L/P/n/edge so every column produces a
    # visibly different order when sorted.
    systems = {
        "pickgauge": (-6, -3, "W"),   # big favorite, correct
        "sag":       (-9, -3, "L"),
        "sagpred":   (2, -3, "W"),
        "teamrank":  (-1, -3, "L"),
        "wayward":   (5, -3, "W"),
    }
    games = []
    gid = 1
    for code, (pred, market, want) in systems.items():
        for i in range(3):
            games.append({
                "cfbdGameId": gid, "matchup": f"Team{gid} @ Rival{gid}",
                "away": f"Team{gid}", "home": f"Rival{gid}",
                "marketHomeLine": market,
                "systems": {code: pred + i},
                "systemResults": {code: want if i else ("L" if want == "W" else "W")},
            })
            gid += 1
    return [{"season": 2026, "week": 1, "games": games}]


def main():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.2)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1100, "height": 900})
        page.add_init_script(CLERK_MOCK)
        page.goto(f"http://127.0.0.1:{port}/app/")
        page.wait_for_selector("#appRoot", state="attached", timeout=5000)
        page.wait_for_function("document.getElementById('appRoot').style.display !== 'none'", timeout=5000)
        page.wait_for_timeout(300)
        page.evaluate(
            """
          (hist) => {
            state.modelPerformanceHistory = hist;
            renderRecord();
          }
        """,
            build_history(),
        )
        page.wait_for_timeout(200)
        hamburger = page.query_selector(".nav-hamburger")
        if hamburger and hamburger.is_visible():
            hamburger.click()
            page.wait_for_timeout(200)
        page.click('button[data-tab="record"]')
        page.wait_for_timeout(300)

        def row_order():
            return page.evaluate(
                """() => Array.from(document.querySelectorAll('[data-model-perf-toggle]')).map(b => b.dataset.modelPerfToggle)"""
            )

        print("default order:      ", row_order())
        page.screenshot(path="/tmp/model_perf_sort_default.png", full_page=False)

        page.click('[data-model-perf-sort="name"]')
        page.wait_for_timeout(150)
        print("Model asc:          ", row_order())
        page.screenshot(path="/tmp/model_perf_sort_name_asc.png", full_page=False)

        page.click('[data-model-perf-sort="name"]')
        page.wait_for_timeout(150)
        print("Model desc:         ", row_order())

        page.click('[data-model-perf-sort="winPct"]')
        page.wait_for_timeout(150)
        print("Win % desc:         ", row_order())
        page.screenshot(path="/tmp/model_perf_sort_winpct_desc.png", full_page=False)

        page.click('[data-model-perf-sort="n"]')
        page.wait_for_timeout(150)
        print("n desc:             ", row_order())

        browser.close()


if __name__ == "__main__":
    main()
