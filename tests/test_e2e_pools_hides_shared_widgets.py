"""
Real-browser E2E test: the Pools tab hides the Context Bar and Weekly
Setup card -- both are shared, tab-independent elements (they persist
across every switchTab() call, not just re-created per tab), so it's easy
for a stale "last rendered elsewhere" visible state to leak onto Pools,
which is a list-of-everything page these two scoped-to-one-context
widgets don't belong on. Covers BOTH the direct-tab-click path
(switchTab() itself) and the Pools-page-own-action path
(renderContextAll(), called by archive/delete/import), since a fix that
only covered one of the two call paths shipped once already (see git
history -- the tab-click path was initially missed and caught by this
exact test before being fixed).

One of 7 files split out of the original test_e2e_ui_behaviors.py (Sept 1,
2026, TODO #26) -- see tests/_e2e_common.py for the shared harness, and
the other test_e2e_*.py files for the remaining scenarios.

Run with:

    python3 tests/test_e2e_pools_hides_shared_widgets.py
"""
import sys

from playwright.sync_api import sync_playwright

from _e2e_common import CLERK_MOCK, start_server, launch_browser

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser = launch_browser(p)
            page = browser.new_page(viewport={"width": 1360, "height": 900})
            page.add_init_script(CLERK_MOCK)
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(1200)

            # Force a genuinely incomplete, non-demo state with a real pool so
            # both widgets would clearly be showing SOMETHING if not hidden.
            page.evaluate("""
              () => {
                isDemo = false;
                state.pools = [{id:'p1', name:'Test Pool', source:'splash', pickLimit:7, weekLabel:'Week 1',
                  games:[{away:'A',home:'B',line:-3}], entries:[{id:'e1',name:'Entry 1',picks:{}}],
                  activeEntryId:'e1', history:[]}];
                state.activeContext='p1';
                state.enabledSystems = [];
                state.lastGames = null;
                state.predMeta = null;
                save();
              }
            """)

            page.click('button[data-tab="pickboard"]')
            page.wait_for_timeout(200)
            check("sanity check: setupNotice DOES show on Edge Board with this incomplete state "
                  "(so hiding it on Pools below is a real assertion, not a vacuous one)",
                  page.evaluate("document.getElementById('setupNotice').style.display") == "block")

            page.click('[data-pickboard-view="pools"]')
            page.wait_for_timeout(200)
            check("Pick Board → Pool Settings hides the Weekly Setup card",
                  page.evaluate("document.getElementById('setupNotice').style.display") == "none")
            check("Pick Board → Pool Settings hides the Context Bar",
                  page.evaluate("document.getElementById('contextBar').style.display") == "none")

            # Same guard, same reasoning, extended to My Picks and Results --
            # both already carry their own pool/entry context in what they
            # show (entry selector, per-entry breakdown), so a redundant
            # "VIEWING: X" bar and a setup checklist with nothing actionable
            # on either tab doesn't belong there either.
            page.click('[data-pickboard-view="picks"]')
            page.wait_for_timeout(200)
            check("Pick Board → My Picks hides the Weekly Setup card",
                  page.evaluate("document.getElementById('setupNotice').style.display") == "none")
            check("Pick Board → My Picks hides the Context Bar",
                  page.evaluate("document.getElementById('contextBar').style.display") == "none")

            page.click('button[data-tab="record"]')
            page.wait_for_timeout(200)
            check("direct tab click to Results hides the Weekly Setup card",
                  page.evaluate("document.getElementById('setupNotice').style.display") == "none")
            check("direct tab click to Results hides the Context Bar",
                  page.evaluate("document.getElementById('contextBar').style.display") == "none")

            page.click('[data-pickboard-view="pools"]')
            page.wait_for_timeout(200)

            # Now exercise the OTHER path: a Pools-page action that calls
            # renderContextAll() (which itself calls renderBoard() ->
            # renderSetupStatus() and renderContextBar()) while already on Pools.
            # Archive lives inside the pool row's "⋮ More" dropdown, not as a
            # standalone always-visible button -- View and Import ▾ stay
            # always-visible, but edit pick limit/share/archive/delete
            # collapsed behind this trigger (see poolRowHTML()'s own comment
            # in app/js/pool-contexts.js for why: fewer equal-weight buttons,
            # and putting delete/archive one tap further away is a small
            # real safety improvement). Open that menu first, or Playwright
            # correctly reports the Archive button as not visible and times
            # out.
            #
            # No page.once("dialog", ...) needed here either: archivePool()
            # (app/js/pool-contexts.js) shows no confirmation at all, native
            # or PickGauge-dialog -- reasonable, since it's fully reversible
            # via Unarchive, unlike Delete.
            page.click('[data-pooltrigger="p1_more"]')
            page.wait_for_timeout(150)
            page.click('[data-archive="p1"]')
            page.wait_for_timeout(200)
            check("a Pools-page action (archive) that triggers renderContextAll() keeps both hidden",
                  page.evaluate("document.getElementById('setupNotice').style.display") == "none"
                  and page.evaluate("document.getElementById('contextBar').style.display") == "none")

            page.click('button[data-tab="snapshot"]')
            page.wait_for_timeout(200)
            check("leaving Pools for another tab makes the Weekly Setup card reappear normally",
                  page.evaluate("document.getElementById('setupNotice').style.display") == "block")
            check("leaving Pools for another tab makes the Context Bar reappear normally",
                  page.evaluate("document.getElementById('contextBar').style.display") != "none")

            page.close()
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
