"""
Not a pytest/CI test -- a one-off Playwright render used to visually verify
the Snapshot tab actually works end-to-end (mocked Clerk session, demo
data), per this project's established "screenshot before claiming it
works" discipline. Not meant to be run in CI; kept out of the numbered
test_*.py files for that reason. Run manually:

    python3 tests/_render_snapshot.py
"""
from playwright.sync_api import sync_playwright
import pathlib

APP_PATH = pathlib.Path(__file__).resolve().parent.parent / "app" / "index.html"

CLERK_MOCK = """
window.Clerk = {
  user: { id: 'test_user', primaryEmailAddress: { emailAddress: 'test@example.com' } },
  session: { getToken: async () => 'fake.jwt.token' },
  load: async () => {},
  mountSignIn: () => {},
  addListener: () => {},
  signOut: async () => {},
};
"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1360, "height": 1000})
    page.add_init_script(CLERK_MOCK)

    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: console_errors.append(f"PAGE ERROR: {exc}"))

    page.goto(f"file://{APP_PATH}")
    page.wait_for_timeout(1200)

    print("=== Console/page errors ===")
    for e in console_errors:
        print(" -", e)
    if not console_errors:
        print(" (none)")

    page.screenshot(path="/tmp/snap_default.png", full_page=True)

    # Toggle Pick Score on
    page.click('#scoreToggle [data-score="1"]')
    page.wait_for_timeout(200)
    page.screenshot(path="/tmp/snap_score_on.png", full_page=True)

    # Try a filter pill
    page.click('#snapFilterPills [data-filter="strong"]')
    page.wait_for_timeout(200)
    page.screenshot(path="/tmp/snap_filter_strong.png", full_page=True)

    # Reset filter, try clicking a pick button on a Top Opportunity card
    page.click('#snapFilterPills [data-filter="all"]')
    page.wait_for_timeout(150)
    first_pick_btn = page.query_selector('#snapOppGrid [data-snap-pick]')
    if first_pick_btn:
        first_pick_btn.click()
        page.wait_for_timeout(200)
    page.screenshot(path="/tmp/snap_after_pick.png", full_page=True)

    # Jump to full board via the CTA button
    page.click('#snapFullBoardBtn')
    page.wait_for_timeout(200)
    page.screenshot(path="/tmp/snap_full_board.png", full_page=True)

    # Mobile check
    page.set_viewport_size({"width": 390, "height": 844})
    page.click('button[data-tab="snapshot"]')
    page.wait_for_timeout(200)
    page.screenshot(path="/tmp/snap_mobile.png", full_page=True)

    browser.close()
print("done")
