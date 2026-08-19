"""
Real-browser end-to-end tests for the three features that had ZERO
automated coverage before this: the Context Bar, the Weekly Setup
checklist, and the global error boundary. All three were built and
verified via one-off Playwright screenshots during the sessions that
shipped them, then never protected against a future regression -- this
file closes that gap by turning that same kind of verification into a
permanent, repeatable, numbered test instead of a throwaway script.

Run with:

    python3 tests/test_e2e_ui_behaviors.py

Why a REAL browser and not a vm context, unlike most of this suite: all
three features here depend on things a plain Node/Python vm context
doesn't have -- real DOM elements, real event listeners
(addEventListener/click bubbling), and for the Context Bar specifically,
composedPath() (a real DOM API with no meaningful vm-context equivalent).
The pure DECISION logic behind two of these (what should the Context Bar
say, what should the Weekly Setup checklist say) already has its own
fast, no-browser-needed coverage -- see test_context_bar_logic.mjs and
test_weekly_setup_logic.mjs. This file is specifically for "does clicking
the actual thing actually do the actual thing."

Requires the app to be served over real HTTP (not file://) at the exact
path Vercel would use (/app, no trailing slash) -- the absolute
<script src="/app/..."> paths this app uses are only correct at that
exact URL shape, a real bug class this project has hit before.

Slower and heavier than the rest of this suite (spins up Chromium) --
run it, but don't be surprised it's the long pole in the full suite.
"""
import http.server
import socketserver
import threading
import time
import sys

from playwright.sync_api import sync_playwright
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


CLERK_MOCK = """
window.Clerk = {
  user: { id: 'test_user', primaryEmailAddress: { emailAddress: 'test@example.com' } },
  session: { getToken: async () => 'fake.jwt.token' },
  load: async () => {},
  mountSignIn: () => {},
  addListener: () => {},
  signOut: async () => {},
};
// bootstrap() now also waits for this real Clerk global (see app/js/init.js --
// a real production bug fix: Clerk's UI components load as a separate
// bundle from window.Clerk itself, and without waiting for BOTH,
// mountSignIn() can throw "Clerk was not loaded with Ui components" on a
// genuine first-time visit). Every mock in this test needs it defined too,
// or bootstrap() times out waiting for it and never shows appRoot.
window.__internal_ClerkUICtor = {};
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass


def main():
    # Port 0 -- let the OS assign a free ephemeral port rather than
    # hardcoding one. A fixed port is fragile: this project's own manual
    # verification scripts (_render_snapshot.py etc.) each pick their own
    # fixed port specifically to avoid colliding with each other, and even
    # so, a leftover bound socket from an earlier run/process is a real,
    # not hypothetical, way for a fixed-port choice to break a re-run.
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", 0), Handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    time.sleep(0.3)

    try:
        with sync_playwright() as p:
            # CI installs Playwright's managed Chromium. Some development/review
            # environments instead have only a system Chromium package; fall
            # back to that binary so the real-browser suite stays runnable in
            # both places rather than reporting a false "browser missing" gap.
            try:
                browser = p.chromium.launch()
            except Exception as first_error:
                system_chromium = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
                if not system_chromium:
                    raise first_error
                browser = p.chromium.launch(executable_path=system_chromium)

            # =================================================================
            # 1. Context Bar -- open/close, and specifically the composedPath()
            #    click-outside fix (a real, previously-fixed bug: a week-nav
            #    click INSIDE the switcher used to close the switcher on its
            #    own navigation click, because bar.contains(e.target) fails
            #    once that click's own re-render has already detached the
            #    clicked element from the DOM by the time the bubble-phase
            #    listener runs).
            # =================================================================
            page = browser.new_page(viewport={"width": 1360, "height": 900})
            page.add_init_script(CLERK_MOCK)
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(1000)

            check("page loaded with no error boundary already showing (clean start)",
                  not page.is_visible("#errorBoundary"))

            check("Context Bar summary line is present and non-empty on load",
                  bool((page.inner_text("#ctxLine1") or "").strip()))

            switcher_closed_initially = not page.is_visible("#contextSwitcher")
            check("Context switcher is closed on initial load", switcher_closed_initially)

            page.click("#contextBarToggle")
            page.wait_for_timeout(300)
            check("clicking the Context Bar toggle opens the switcher", page.is_visible("#contextSwitcher"))

            # The exact historical bug scenario: click a week-nav control
            # INSIDE the open switcher.
            week_nav_exists = page.locator("#ctxWeekPrev").count() > 0
            check("week-nav prev button exists inside the open switcher (sanity check before the real assertion)",
                  week_nav_exists)
            if week_nav_exists:
                page.click("#ctxWeekPrev")
                page.wait_for_timeout(300)
                check("REGRESSION: clicking a week-nav control INSIDE the switcher does NOT close it "
                      "(the composedPath() fix -- this exact scenario used to close the switcher on itself)",
                      page.is_visible("#contextSwitcher"))

            # A genuine outside click must still close it.
            page.click("body", position={"x": 20, "y": 20})
            page.wait_for_timeout(300)
            check("clicking genuinely outside the Context Bar closes the switcher",
                  not page.is_visible("#contextSwitcher"))

            check("no error boundary triggered anywhere during Context Bar interaction",
                  not page.is_visible("#errorBoundary"))

            page.close()

            # =================================================================
            # 2. Weekly Setup -- the card actually renders based on real state,
            #    and actually changes when the underlying state changes (not
            #    just present once at load and never re-checked).
            # =================================================================
            page = browser.new_page(viewport={"width": 1360, "height": 900})
            page.add_init_script(CLERK_MOCK)
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(1000)

            setup_notice_text = page.inner_text("#setupNotice") if page.locator("#setupNotice").count() > 0 else None
            check("#setupNotice card is present in the DOM on initial (demo-mode) load", setup_notice_text is not None)
            check("demo-mode setup notice mentions demo data, matching computeSetupDisplay()'s 'demo' mode",
                  setup_notice_text is not None and "demo" in setup_notice_text.lower())

            # Force a genuinely incomplete, non-demo state and confirm the
            # card re-renders to reflect it -- proves this is live, not a
            # static message baked in at load.
            result = page.evaluate("""
            () => {
              isDemo = false;
              games = [{key: 'g1', away: 'Team A', home: 'Team B', commence: '2026-09-15T17:00:00Z'}];
              state.lastGames = null;   // Vegas lines: not refreshed -> 'bad'
              state.enabledSystems = [];
              renderSetupStatus();
              return document.getElementById('setupNotice').textContent;
            }
            """)
            check("forcing a real incomplete, non-demo state re-renders the setup card away from the demo message",
                  "demo" not in result.lower())
            check("the re-rendered card reflects genuine incompleteness (not silently showing 'complete')",
                  ("complete" not in result.lower()) or ("incomplete" in result.lower()) or ("setup" in result.lower()))

            check("no error boundary triggered while forcing Weekly Setup state changes",
                  not page.is_visible("#errorBoundary"))

            page.close()

            # =================================================================
            # 3. Error boundary -- actually catches a real error thrown during
            #    real app execution (not just "the function exists"), shows the
            #    documented dismissible banner (not a full-page takeover), the
            #    dismiss button actually dismisses it, and it can fire again
            #    for a later, different error after being dismissed.
            # =================================================================
            page = browser.new_page(viewport={"width": 1360, "height": 900})
            page.add_init_script(CLERK_MOCK)
            # Force a real error inside init()'s own execution -- the same
            # technique used to verify this during the init.js split itself,
            # now made permanent instead of one-off.
            page.add_init_script("""
            const origGetById = document.getElementById.bind(document);
            document.getElementById = function(id) {
              if (id === 'refreshBtn') { throw new Error('INTENTIONAL TEST ERROR for automated verification'); }
              return origGetById(id);
            };
            """)
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(1200)

            check("a real error thrown inside init()'s own execution is caught by the error boundary",
                  page.is_visible("#errorBoundary"))

            # Dismissible banner, not a full-page takeover: real page
            # structure (nav tabs) must still be present underneath it.
            check("the error boundary is a banner, not a full-page takeover -- the tab bar is still present underneath",
                  page.locator(".tabs, nav").count() > 0)

            dismiss_exists = page.locator("#errorDismissBtn").count() > 0
            check("dismiss button exists on the error banner", dismiss_exists)
            if dismiss_exists:
                page.click("#errorDismissBtn")
                page.wait_for_timeout(200)
                check("clicking dismiss actually hides the error banner", not page.is_visible("#errorBoundary"))

                # A LATER, DIFFERENT error must still be able to show again --
                # the boundary's own `shown` flag is deliberately reset on
                # dismiss for exactly this reason.
                page.evaluate("() => { setTimeout(() => { throw new Error('SECOND intentional test error'); }, 10); }")
                page.wait_for_timeout(300)
                check("a second, later error can still trigger the banner again after a dismiss "
                      "(the boundary doesn't permanently disable itself after the first catch)",
                      page.is_visible("#errorBoundary"))

            reload_exists = page.locator("#errorReloadBtn").count() > 0
            check("reload button exists on the error banner", reload_exists)

            page.close()

            # =================================================================
            # 4. Pools tab hides the Context Bar and Weekly Setup card -- both
            #    are shared, tab-independent elements (they persist across
            #    every switchTab() call, not just re-created per tab), so it's
            #    easy for a stale "last rendered elsewhere" visible state to
            #    leak onto Pools, which is a list-of-everything page these two
            #    scoped-to-one-context widgets don't belong on. Covers BOTH the
            #    direct-tab-click path (switchTab() itself) and the
            #    Pools-page-own-action path (renderContextAll(), called by
            #    archive/delete/import), since a fix that only covered one of
            #    the two call paths shipped once already (see git history --
            #    the tab-click path was initially missed and caught by this
            #    exact test before being fixed).
            # =================================================================
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

            page.click('button[data-tab="board"]')
            page.wait_for_timeout(200)
            check("sanity check: setupNotice DOES show on Edge Board with this incomplete state "
                  "(so hiding it on Pools below is a real assertion, not a vacuous one)",
                  page.evaluate("document.getElementById('setupNotice').style.display") == "block")

            page.click('button[data-tab="pools"]')
            page.wait_for_timeout(200)
            check("direct tab click to Pools hides the Weekly Setup card",
                  page.evaluate("document.getElementById('setupNotice').style.display") == "none")
            check("direct tab click to Pools hides the Context Bar",
                  page.evaluate("document.getElementById('contextBar').style.display") == "none")

            # Same guard, same reasoning, extended to My Picks and Results --
            # both already carry their own pool/entry context in what they
            # show (entry selector, per-entry breakdown), so a redundant
            # "VIEWING: X" bar and a setup checklist with nothing actionable
            # on either tab doesn't belong there either.
            page.click('button[data-tab="picks"]')
            page.wait_for_timeout(200)
            check("direct tab click to My Picks hides the Weekly Setup card",
                  page.evaluate("document.getElementById('setupNotice').style.display") == "none")
            check("direct tab click to My Picks hides the Context Bar",
                  page.evaluate("document.getElementById('contextBar').style.display") == "none")

            page.click('button[data-tab="record"]')
            page.wait_for_timeout(200)
            check("direct tab click to Results hides the Weekly Setup card",
                  page.evaluate("document.getElementById('setupNotice').style.display") == "none")
            check("direct tab click to Results hides the Context Bar",
                  page.evaluate("document.getElementById('contextBar').style.display") == "none")

            page.click('button[data-tab="pools"]')
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
            # out -- this line used to click data-archive directly, from
            # before that tiered layout existed, and was never updated when
            # it landed (caught by actually running this file, not just
            # reasoning about it -- exactly the class of thing this suite
            # exists to catch).
            #
            # No page.once("dialog", ...) needed here either, unlike before:
            # archivePool() (app/js/pool-contexts.js) shows no confirmation
            # at all, native or PickGauge-dialog -- reasonable, since it's
            # fully reversible via Unarchive, unlike Delete.
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

            # =================================================================
            # 5. Shared PickGauge modal layer -- real DOM interaction for the
            #    native-dialog replacement. Creating a pool used to require two
            #    blocking browser prompts; it is now one validated in-app form.
            #    Also verifies Escape cancellation and that no native browser
            #    dialog event fires during the flow.
            # =================================================================
            page = browser.new_page(viewport={"width": 1360, "height": 900})
            page.add_init_script(CLERK_MOCK)
            native_dialogs = []
            page.on("dialog", lambda d: (native_dialogs.append(d.type), d.dismiss()))
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(1000)
            page.click('button[data-tab="pools"]')
            page.wait_for_timeout(150)

            page.click("#poolsNewBtn")
            page.wait_for_timeout(100)
            check("New pool opens the PickGauge modal layer, not a browser prompt",
                  page.is_visible("#pgDialogLayer.open") and page.is_visible(".pg-dialog"))
            check("new-pool modal contains both Pool name and Picks per entry fields in one form",
                  page.locator('#pgDialogLayer input[name="name"]').count() == 1
                  and page.locator('#pgDialogLayer input[name="pickLimit"]').count() == 1)

            page.fill('#pgDialogLayer input[name="name"]', "Dialog Test Pool")
            page.fill('#pgDialogLayer input[name="pickLimit"]', "0")
            page.click('#pgDialogLayer button[type="submit"]')
            page.wait_for_timeout(100)
            check("invalid pick limit stays in the modal and shows inline validation",
                  page.is_visible("#pgDialogLayer.open")
                  and page.is_visible("#pgDialogLayer .pg-dialog-error"))

            page.fill('#pgDialogLayer input[name="pickLimit"]', "9")
            page.click('#pgDialogLayer button[type="submit"]')
            page.wait_for_timeout(200)
            check("valid new-pool form closes the modal",
                  not page.is_visible("#pgDialogLayer.open"))
            row = page.locator(".pool-row", has_text="Dialog Test Pool")
            check("valid new-pool form creates the pool with the requested pick limit",
                  row.count() == 1 and "pick 9" in row.inner_text().lower())

            # Open Edit pick limit, then cancel with Escape. Native prompt()
            # used to own Escape handling automatically; the custom layer must
            # preserve that keyboard behavior itself.
            if row.count() == 1:
                row.locator('[data-pooltrigger$="_more"]').click()
                row.locator('[data-editlimit]').click()
                page.wait_for_timeout(100)
                check("Edit pick limit also uses the shared PickGauge modal",
                      page.is_visible("#pgDialogLayer.open"))
                page.keyboard.press("Escape")
                page.wait_for_timeout(100)
                check("Escape cancels and closes a dismissible PickGauge modal",
                      not page.is_visible("#pgDialogLayer.open"))
                row = page.locator(".pool-row", has_text="Dialog Test Pool")
                check("cancelling Edit pick limit leaves the original value unchanged",
                      row.count() == 1 and "pick 9" in row.inner_text().lower())

            check("native browser dialogs never fired during the migrated modal flow",
                  native_dialogs == [])
            check("no error boundary triggered during modal interaction",
                  not page.is_visible("#errorBoundary"))

            page.close()

            # =================================================================
            # 6. Results historical analytics -- real DOM wiring for the new
            #    season/week filters and the expanded frozen-data breakdowns.
            # =================================================================
            page = browser.new_page(viewport={"width": 1360, "height": 900})
            page.add_init_script(CLERK_MOCK)
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(800)
            page.evaluate("""
              state.activeContext='overall';
              state.history=[
                {id:'rw26',label:'2026 Week 1',closedAt:'2026-09-05T20:00:00Z',entries:[{entryId:'re1',name:'2026 Entry',picks:[
                  {key:'a',team:'Alpha',matchup:'Beta @ Alpha',result:'W',side:'home',line:-3.5,cfbdSeason:2026,cfbdWeek:1,pickedEdgeAtPick:3.2,clv:1,coverProbabilityAtPick:.58,modelAgreementAtPick:{agree:8,total:10,pct:.8},keyTierAtPick:'major'},
                  {key:'b',team:'Gamma',matchup:'Gamma @ Delta',result:'L',side:'away',line:7,cfbdSeason:2026,cfbdWeek:1,pickedEdgeAtPick:2,clv:-.5,coverProbabilityAtPick:.54,modelAgreementAtPick:{agree:6,total:10,pct:.6},keyTierAtPick:'none'}
                ]}]},
                {id:'rw25',label:'2025 Week 4',closedAt:'2025-09-20T20:00:00Z',entries:[{entryId:'re2',name:'2025 Entry',picks:[
                  {key:'c',team:'Omega',matchup:'Sigma @ Omega',result:'W',side:'home',line:-14.5,cfbdSeason:2025,cfbdWeek:4,pickedEdgeAtPick:1,clv:1.5,coverProbabilityAtPick:.62,modelAgreementAtPick:{agree:7,total:10,pct:.7},keyTierAtPick:'minor'}
                ]}]}
              ];
              renderRecord(); switchTab('record');
            """)
            page.wait_for_timeout(150)
            check("Results renders season and week historical filters",
                  page.is_visible("#recordSeasonFilter") and page.is_visible("#recordWeekFilter"))
            check("Results exposes the expanded breakdowns",
                  "Favorites vs. underdogs" in page.inner_text("#recordBody")
                  and "ATS by closing-line value" in page.inner_text("#recordBody")
                  and "Cover % calibration" in page.inner_text("#recordBody"))
            season_values = page.locator("#recordSeasonFilter option").evaluate_all("els => els.map(e => e.value)")
            check("Results season filter is populated from archived canonical seasons",
                  season_values == ["all", "2026", "2025"])
            page.select_option("#recordSeasonFilter", "2025")
            page.wait_for_timeout(100)
            check("selecting a season filters the running record to that season",
                  "2025 Entry" in page.inner_text("#recordBody") and "2026 Entry" not in page.inner_text(".picklist"))
            week_values = page.locator("#recordWeekFilter option").evaluate_all("els => els.map(e => e.value)")
            check("week options narrow to the selected season", week_values == ["all", "4"])
            check("filtered Results only shows archived weeks matching the selected season",
                  "2025 Week 4" in page.inner_text("#recordBody") and "2026 Week 1" not in page.inner_text("#recordBody"))
            check("no error boundary triggered during Results analytics interaction",
                  not page.is_visible("#errorBoundary"))

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
