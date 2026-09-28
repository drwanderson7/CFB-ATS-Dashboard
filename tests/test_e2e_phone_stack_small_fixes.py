"""
Real-browser E2E for the Sept 23, 2026 phone pre-slate compaction (to-do #7)
and the four small UI fixes (to-do #11):

  #7  First All Games row moves up on phones: one-line Market view / pool
      status card, "Shortlist only" row hidden until something is
      shortlisted, one-line week bar. Measured before: first row at ~652px
      (390px wide).
  #11 - no "jump to date" pickers (All Games week bar + Viewing switcher)
      - "Mark submitted" appears once per entry (the entry's own card), not
        also in the entry switcher list
      - header Refresh hidden on Survivor and Results (kept where lines
        matter: This Week, All Games, Confidence)
      - Survivor shows ONE error banner / Retry for one data failure

Every /api/* call is mocked (harness from test_e2e_batch1_workflow.py).

Run with:

    python3 tests/test_e2e_phone_stack_small_fixes.py
"""
import importlib.util
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

from _e2e_common import start_server

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


PRIVATE = {"entries": [{"id": "e1", "name": "Entry 1", "picks": {}}], "history": [], "pools": [], "_rev": 1,
           "enabledSystems": ["teamrank", "sagpred", "sag", "wayward"]}
ROWS = "#tab-board .board tbody tr[data-key]"


def first_row_y(page):
    page.evaluate("scrollTo(0,0)")
    return page.evaluate("(()=>{const r=document.querySelector('%s'); return Math.round(r.getBoundingClientRect().top+scrollY);})()" % ROWS)


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            # ---------------- Phone (390px)
            browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": 390, "height": 844})
            page.evaluate("switchTab('pickboard')")
            page.wait_for_timeout(400)
            y = first_row_y(page)
            print(f"   first All Games row at {y}px (was ~652px)")
            check("phone: first All Games row starts under 540px (was ~652px)", y < 540)
            check("phone: 'Shortlist only' row hidden while the shortlist is empty", not page.is_visible("#shortlistFilterWrap"))
            wf = page.locator("#pickBoardWorkflow").bounding_box()
            check("phone: Market view card is a single line (< 56px tall)", wf and wf["height"] < 56)
            check("phone: Market view card still offers the pool action", page.is_visible("#pickBoardWorkflow [data-pickboard-next='pools']"))
            wb = page.locator("#weekBar").bounding_box()
            check("phone: week bar fits on one line (< 52px tall)", wb and wb["height"] < 52)
            check("phone: no horizontal overflow", page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth") <= 0)

            page.locator(ROWS).first.locator("[data-shortlist]").click()
            page.wait_for_timeout(300)
            check("phone: 'Shortlist only' row appears once a game is shortlisted", page.is_visible("#shortlistFilterWrap")
                  and "(1)" in page.inner_text("#shortlistFilterWrap"))
            page.check("#shortlistFilterChk")
            page.wait_for_timeout(300)
            page.locator(ROWS).first.locator("[data-shortlist]").click()  # un-shortlist while filter is on
            page.wait_for_timeout(300)
            check("phone: row stays visible while the filter is ON even at 0 (so it can be turned off)", page.is_visible("#shortlistFilterWrap"))
            page.uncheck("#shortlistFilterChk")
            page.wait_for_timeout(300)
            check("phone: row hides again once the filter is off and the shortlist is empty", not page.is_visible("#shortlistFilterWrap"))
            page.screenshot(path="/tmp/e2e_phone_stack.png", full_page=False)

            # No date pickers anywhere, including the open Viewing switcher.
            page.click("#contextBarToggle")
            page.wait_for_timeout(300)
            check("no <input type=date> in the app (week bar + Viewing switcher)", page.locator("input[type='date']").count() == 0)
            check("Viewing switcher still has week prev/next + Show all weeks",
                  page.locator("#ctxWeekPrev").count() == 1 and page.locator("#ctxWeekNext").count() == 1 and page.locator("#ctxWeekAll").count() == 1)
            page.click("#ctxWeekNext")
            page.wait_for_timeout(300)
            check("Viewing switcher next-week still works", page.evaluate("currentWeekIndex()") == page.evaluate("autoWeekIndex()") + 1)
            page.evaluate("setWeekAnchor(autoWeekIndex())")
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            check("no uncaught page errors (phone)", not errors)
            browser.close()

            # ---------------- Desktop
            full = json.loads(json.dumps(PRIVATE))
            browser, page, reqs, errors = B.open_app(p, port, full, {"width": 1360, "height": 900})
            page.evaluate("switchTab('pickboard')")
            page.wait_for_timeout(300)
            check("desktop: 'Shortlist only' row still always visible", page.is_visible("#shortlistFilterWrap"))
            check("desktop: week bar keeps 'Show all weeks'", page.is_visible("#weekAll"))
            check("desktop: no date picker in the week bar", page.locator("#weekBar input").count() == 0)

            # Header Refresh visibility by tab
            for tab, want in (("snapshot", True), ("pickboard", True), ("confidence", True), ("survivor", False), ("record", False)):
                page.evaluate(f"switchTab('{tab}')")
                page.wait_for_timeout(350)
                check(f"header Refresh {'shown' if want else 'hidden'} on {tab}", page.is_visible("#refreshBtn") == want)

            # Survivor: one failure -> one error banner with one Retry.
            page.evaluate("switchTab('survivor')")
            page.wait_for_timeout(1500)
            retries = page.locator("[data-survivor-retry]:visible").count()
            red = page.locator("#tab-survivor .pg-state-error:visible, #tab-survivor .pg-state.error:visible, #tab-survivor [class*='state-error']:visible").count()
            has_error = "could not" in page.inner_text("#tab-survivor")
            print(f"   survivor: error shown={has_error}, visible retry buttons={retries}, red error blocks={red}")
            page.screenshot(path="/tmp/surv.png", full_page=False)
            check("survivor (data unavailable in this mock): the failure is reported", has_error)
            check("survivor: exactly one visible Retry for one failure (was two)", retries == 1)
            check("survivor: child view points to the status panel instead of repeating the error", "Use Retry in the status panel above" in page.inner_text("#tab-survivor"))

            # My Picks: Mark submitted appears once per entry.
            page.evaluate("switchTab('pickboard')")
            page.wait_for_timeout(300)
            keys = page.eval_on_selector_all(ROWS, "els=>els.slice(0,7).map(e=>e.dataset.key)")
            for k in keys:
                page.click(f"{ROWS}[data-key='{k}'] [data-pickteam][data-side='home']")
                page.wait_for_timeout(120)
            page.evaluate("switchTab('picks')")
            page.wait_for_timeout(400)
            n_submit = page.locator("#tab-picks [data-submit]:visible").count()
            page.screenshot(path="/tmp/mypicks.png", full_page=True)
            check("My Picks: exactly one 'Mark submitted' for the entry (was two)", n_submit == 1)
            check("My Picks: entry switcher list no longer carries a submit button", page.locator("#entryList [data-submit], #entryList [data-unsubmit]").count() == 0)
            check("My Picks: the remaining button is enabled for a full 7/7 card", page.locator("#tab-picks [data-submit]:visible").first.is_enabled())
            page.locator("#tab-picks [data-submit]:visible").first.click()
            page.wait_for_timeout(400)
            check("My Picks: Mark submitted still locks the entry", page.evaluate("!!activeEntry().submittedAt"))
            check("My Picks: exactly one Unlock after submitting", page.locator("#tab-picks [data-unsubmit]:visible").count() == 1)
            check("no uncaught page errors (desktop)", not errors)
            if errors:
                print("   page errors:", errors[:3])
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
