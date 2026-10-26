"""
Real-browser E2E: market lines refresh ONLY on a Refresh lines click
(Oct 26, 2026).

Every /api/* call is mocked (same harness as test_e2e_batch1_workflow.py) and
every request is recorded, so these are real counts of /api/fetch_odds calls:

  * startup with NO shared lines, and with two-day-old shared lines, makes no
    /api/fetch_odds request (model predictions still auto-load);
  * the header and the This Week / All Games context bar say when the shared
    lines were updated, with the weekday when it wasn't today
    ("Lines updated Sat 9:14 AM");
  * a tab resume (visibilitychange) makes no /api/fetch_odds request, but does
    re-pull the shared state, so lines someone else refreshed show up;
  * clicking Refresh lines makes exactly one /api/fetch_odds request, and a
    second click right after is answered from the fresh shared copy;
  * when the server says the shared budget is paused, the clicker sees a clear
    message (header + dialog) naming the time of the lines being shown;
  * on a 390px phone the "Lines updated ..." text is visible in the context bar.

Run with:

    python3 tests/test_e2e_lines_manual_refresh.py
"""
import datetime
import importlib.util
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

from _e2e_common import CLERK_MOCK, start_server, launch_browser

_spec = importlib.util.spec_from_file_location(
    "batch1", pathlib.Path(__file__).with_name("test_e2e_batch1_workflow.py"))
B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B)

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


NOW = datetime.datetime.now(datetime.timezone.utc)
TWO_DAYS_AGO = B.iso(NOW - datetime.timedelta(days=2, hours=1))
PRIVATE = {"entries": [{"id": "e1", "name": "Entry 1", "picks": {}}], "history": [], "pools": [], "_rev": 1,
           "enabledSystems": ["teamrank", "sagpred", "sag", "wayward"]}


def open_app(p, port, shared, odds_mode="ok", width=1360):
    """shared: dict for the shared tier (mutable -- the fetch_odds mock writes
    into it like production does). odds_mode: 'ok' or 'paused'."""
    browser = launch_browser(p)
    page = browser.new_page(viewport={"width": width, "height": 900})
    reqs, errors = [], []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.add_init_script(CLERK_MOCK)

    def handle(route):
        req = route.request
        url = req.url
        name = url.split("/api/")[1].split("?")[0]
        reqs.append((req.method, name, url))
        if name == "state" and req.method == "GET" and "scope=shared" in url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"state": shared}))
        if name == "state" and req.method == "GET":
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"state": json.loads(json.dumps(PRIVATE)), "revision": 1}))
        if name == "state":
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "revision": 2}))
        if name == "fetch_odds":
            if odds_mode == "paused":
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "games": shared.get("lastGames") or [], "lastRefresh": shared.get("lastRefresh"), "booksSeen": ["draftkings"],
                    "preKickLines": {}, "reqLeft": 12, "paused": True,
                    "pausedMessage": "Live lines are paused — the shared odds budget is nearly used up."}))
            fresh = B.iso(datetime.datetime.now(datetime.timezone.utc))
            shared.update({"lastGames": B.GAMES, "lastRefresh": fresh, "sharedUpdatedAt": fresh, "booksSeen": ["draftkings", "fanduel"]})
            return route.fulfill(status=200, content_type="application/json", headers={"x-requests-remaining": "480"},
                                 body=json.dumps({"games": B.GAMES, "lastRefresh": fresh, "booksSeen": ["draftkings", "fanduel"],
                                                  "sharedPersisted": True}))
        if name == "fetch_predictions":
            fresh = B.iso(datetime.datetime.now(datetime.timezone.utc))
            shared.update({"predictions": B.PREDS, "predMeta": {"fetchedAt": fresh, "count": len(B.PREDS)}, "sharedUpdatedAt": fresh})
            return route.fulfill(status=200, content_type="application/json",
                                 body=json.dumps({"games": B.PREDS, "fetchedAt": fresh, "count": len(B.PREDS), "sharedPersisted": True}))
        return route.fulfill(status=200, content_type="application/json", body="{}")

    page.route("**/api/**", handle)
    page.goto(f"http://localhost:{port}/app/index.html")
    page.wait_for_timeout(2500)
    return browser, page, reqs, errors


def count(reqs, name):
    return len([r for r in reqs if r[1] == name])


def expected_label(page, iso):
    return page.evaluate("(iso)=>linesUpdatedLabel(iso)", iso)


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            # ---- 1. Nothing in the shared tier at all.
            shared = {"lastGames": [], "predictions": [], "sharedUpdatedAt": None, "sharedPools": []}
            browser, page, reqs, errors = open_app(p, port, shared)
            check("empty shared lines: startup makes NO /api/fetch_odds request", count(reqs, "fetch_odds") == 0)
            check("...model predictions still load automatically", count(reqs, "fetch_predictions") == 1)
            check("header says lines aren't loaded yet", page.inner_text("#refreshTime") == "Lines not loaded yet")
            # No shared lines -> the board is built from the auto-loaded model
            # predictions (long-standing "predictions" mode); never a
            # "loading lines" state waiting on a refresh that won't come.
            check("no 'loading lines' state; the board is marked as built from predictions only",
                  "Loading this week's lines" not in page.inner_text("body")
                  and page.evaluate("document.getElementById('dataBadge').textContent") == "predictions")
            check("no page errors (empty)", not errors)
            browser.close()

            # ---- 2. Two-day-old shared lines.
            shared = {"lastGames": B.GAMES, "lastRefresh": TWO_DAYS_AGO, "booksSeen": ["draftkings", "fanduel"],
                      "predictions": B.PREDS, "predMeta": {"fetchedAt": B.FRESH, "count": len(B.PREDS)},
                      "sharedUpdatedAt": TWO_DAYS_AGO, "preKickLines": {}, "sharedPools": []}
            browser, page, reqs, errors = open_app(p, port, shared)
            label = expected_label(page, TWO_DAYS_AGO)
            weekday = page.evaluate("(iso)=>new Date(iso).toLocaleDateString(undefined,{weekday:'short'})", TWO_DAYS_AGO)
            print(f"   label for two-day-old lines: {label!r}")
            check("two-day-old shared lines: startup makes NO /api/fetch_odds request", count(reqs, "fetch_odds") == 0)
            check("...the board is built from the shared lines", page.locator("#snapOppGrid [data-snap-pick]").count() >= 3)
            check("label carries the weekday when it isn't today (\"Lines updated Sat 9:14 AM\")",
                  label.startswith(f"Lines updated {weekday} ") and label.endswith(("AM", "PM")))
            check("header shows it", page.inner_text("#refreshTime") == label)
            check("This Week's context bar shows it first", page.inner_text("#ctxLine2").startswith(label))
            page.evaluate("switchTab('pickboard')")
            page.wait_for_timeout(300)
            check("All Games' context bar shows it too", page.is_visible("#ctxLine2") and page.inner_text("#ctxLine2").startswith(label))

            # ---- 3. Tab resume: someone else refreshed meanwhile.
            newer = B.iso(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=3))
            shared.update({"lastRefresh": newer, "sharedUpdatedAt": newer})
            state_gets = len([r for r in reqs if r[1] == "state" and "scope=shared" in r[2]])
            page.evaluate("""()=>{ Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
                                   document.dispatchEvent(new Event('visibilitychange')); }""")
            page.wait_for_timeout(1200)
            check("tab resume makes NO /api/fetch_odds request", count(reqs, "fetch_odds") == 0)
            check("tab resume re-pulls the shared state",
                  len([r for r in reqs if r[1] == "state" and "scope=shared" in r[2]]) > state_gets)
            check("...so lines someone else refreshed show up (label moves to today's time)",
                  page.inner_text("#refreshTime") == expected_label(page, newer))
            check("no page errors (resume)", not errors)
            browser.close()

            # ---- 4. Clicking Refresh lines.
            shared = {"lastGames": B.GAMES, "lastRefresh": TWO_DAYS_AGO, "booksSeen": ["draftkings"],
                      "predictions": B.PREDS, "predMeta": {"fetchedAt": B.FRESH, "count": len(B.PREDS)},
                      "sharedUpdatedAt": TWO_DAYS_AGO, "preKickLines": {}, "sharedPools": []}
            browser, page, reqs, errors = open_app(p, port, shared)
            check("before the click: no /api/fetch_odds request", count(reqs, "fetch_odds") == 0)
            page.click("#refreshBtn")
            page.wait_for_timeout(1500)
            check("clicking Refresh lines makes exactly one /api/fetch_odds request", count(reqs, "fetch_odds") == 1)
            check("the label moves to the new refresh time", page.inner_text("#refreshTime") == expected_label(page, shared["lastRefresh"]))
            page.click("#refreshBtn")
            page.wait_for_timeout(1200)
            check("a second click right after is answered by the fresh shared copy (no second /api/fetch_odds)",
                  count(reqs, "fetch_odds") == 1 and "Using recent shared lines" in page.inner_text("#refreshTime"))
            check("no page errors (click)", not errors)
            browser.close()

            # ---- 5. Shared budget paused.
            shared = {"lastGames": B.GAMES, "lastRefresh": TWO_DAYS_AGO, "booksSeen": ["draftkings"],
                      "predictions": B.PREDS, "predMeta": {"fetchedAt": B.FRESH, "count": len(B.PREDS)},
                      "sharedUpdatedAt": TWO_DAYS_AGO, "preKickLines": {}, "sharedPools": []}
            browser, page, reqs, errors = open_app(p, port, shared, odds_mode="paused")
            page.click("#refreshBtn")
            page.wait_for_timeout(1200)
            when = page.evaluate("(iso)=>linesWhen(iso)", TWO_DAYS_AGO)
            msg = f"Live lines are paused — the shared odds budget is nearly used up. Showing lines from {when}."
            dialog = page.locator(".pg-dialog")
            print(f"   paused header: {page.inner_text('#refreshTime')!r}")
            check("paused: one /api/fetch_odds request, answered with the paused copy", count(reqs, "fetch_odds") == 1)
            check("paused: the clicker gets a dialog with the plain message and the lines' time",
                  dialog.count() == 1 and dialog.is_visible() and msg in dialog.inner_text())
            check("paused: the header keeps the same message (not wiped by the normal label)", page.inner_text("#refreshTime") == msg)
            check("paused: the board keeps showing the shared lines", page.evaluate("games.length") == len(B.GAMES))
            check("no page errors (paused)", not errors)
            browser.close()

            # ---- 6. Phone: label visible in the context bar.
            shared = {"lastGames": B.GAMES, "lastRefresh": TWO_DAYS_AGO, "booksSeen": ["draftkings"],
                      "predictions": B.PREDS, "predMeta": {"fetchedAt": B.FRESH, "count": len(B.PREDS)},
                      "sharedUpdatedAt": TWO_DAYS_AGO, "preKickLines": {}, "sharedPools": []}
            browser, page, reqs, errors = open_app(p, port, shared, width=390)
            line = page.locator("#ctxLine2")
            fits = page.evaluate("""()=>{ const el=document.getElementById('ctxLine2'), r=document.createRange();
                r.setStart(el.firstChild,0); r.setEnd(el.firstChild,Math.min(el.firstChild.length, linesUpdatedLabel(state.lastRefresh).length));
                return r.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1; }""")
            check("390px: the context bar starts with 'Lines updated ...' and that text isn't cut off", line.is_visible()
                  and line.inner_text().startswith(expected_label(page, TWO_DAYS_AGO)) and fits)
            check("390px: startup makes no /api/fetch_odds request", count(reqs, "fetch_odds") == 0)
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
