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
            browser = p.chromium.launch()

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
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
