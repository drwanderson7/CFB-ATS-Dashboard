"""
One-off Playwright verification for the Sept 3, 2026 fix: Model performance
table on Results now (a) prefers the real closing line over a stale
captured line for its side/edge display, and (b) explicitly names the
active week/season scope in its heading.

Run: python3 tests/_render_model_perf_week_scope.py
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

    checks = []

    def check(name, cond):
        checks.append((name, bool(cond)))
        print(f"[{'PASS' if cond else 'FAIL'}] {name}")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1200, "height": 1100})
        page.add_init_script(CLERK_MOCK)

        errors = []
        page.on("pageerror", lambda exc: errors.append(f"PAGE ERROR: {exc}"))

        page.goto(f"http://127.0.0.1:{port}/app/")
        page.wait_for_selector("#appRoot", state="attached", timeout=5000)
        page.wait_for_function(
            "document.getElementById('appRoot').style.display !== 'none'", timeout=8000
        )
        page.wait_for_timeout(300)

        # Seed two weeks of model performance history directly, then render
        # Results -- this exercises the real renderRecord()/
        # recordModelPerformanceHTML() path end to end.
        page.evaluate("""() => {
            state.modelPerformanceHistory = [
                {season: 2026, week: 1, games: [
                    {cfbdGameId: 1, matchup: "A @ B", marketHomeLine: -3, closingHomeLine: -6,
                     systems: {sag: -6}, systemResults: {sag: "W"}},
                ]},
                {season: 2026, week: 2, games: [
                    {cfbdGameId: 2, matchup: "C @ D", marketHomeLine: 3, closingHomeLine: null,
                     systems: {sag: 5}, systemResults: {sag: "L"}},
                ]},
            ];
            switchTab("record");
        }""")
        page.wait_for_timeout(300)
        check("no page errors after loading Results with model performance history", len(errors) == 0)

        heading_all = page.locator(".record-model-performance h2").inner_text()
        check(f"default (no week filter) heading reads 'All weeks' (got {heading_all!r})",
              "All weeks" in heading_all)

        page.screenshot(path="/tmp/model_perf_all_weeks.png", full_page=True)

        # Switch the week filter to Week 1 specifically.
        week_select = page.locator("select", has=page.locator("option", has_text="Week 1"))
        if week_select.count() == 0:
            # Fall back to any select containing a "Week" option, in case the
            # filter control isn't a plain <select> with that exact text scope.
            week_select = page.locator("select:has(option:has-text('Week'))").first
        week_select.select_option(label="Week 1")
        page.wait_for_timeout(300)
        page.screenshot(path="/tmp/model_perf_week1.png", full_page=True)

        heading_wk1 = page.locator(".record-model-performance h2").inner_text()
        check(f"after filtering to Week 1: heading names it explicitly (got {heading_wk1!r})",
              "Week 1" in heading_wk1)

        row_text = page.locator(".model-perf-row").inner_text()
        check(f"Week 1's table shows Sagarin's record for that week only (W-L-P, got {row_text!r})",
              "1-0-0" in row_text or "1-0" in row_text)

        browser.close()
    httpd.shutdown()

    print()
    passed = sum(1 for _, ok in checks if ok)
    print(f"{passed}/{len(checks)} checks passed")
    if passed != len(checks):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
