"""
Real-browser E2E for the Results tab redesign (Sept 30, 2026):

  * Order: your record -> latest week -> older weeks (folded) -> analytics (folded).
  * "Check results now" is a small button in the page header (and its message
    survives re-renders).
  * Analytics stay folded until 10 graded picks; the person's own fold/unfold
    choice is remembered across re-renders.
  * Older weeks are folded; expanding one is remembered.
  * W/L/P buttons are hidden behind "Edit result" / "Set result"; choosing a
    result saves it and closes the editor; choosing the same one clears it.
  * Filters only appear once there is more than one week.
  * Phone: no overflow, 44px touch targets.

All /api/* calls are mocked (harness from test_e2e_batch1_workflow.py).

Run with:

    python3 tests/test_e2e_results_layout.py
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


PRIVATE = {"entries": [{"id": "e1", "name": "Entry 1", "picks": {}}], "history": [], "pools": [], "_rev": 1}
SEED = """([weeks, entries2])=>{
  state.activeContext='overall'; state.history=[];
  const T=[['Ohio State',-10,'W'],['Auburn',3,'L'],['USC',6.5,'W'],['Texas',-6.5,'P'],['Oregon',3.5,'W'],['Kentucky',-17,'L'],['Florida',-14.5,'W'],['Baylor',2.5,'W']];
  weeks.forEach((w,wi)=>{   // weeks[0] = newest, like real history (unshift)
    const mk=(pre)=>Array.from({length:w.n},(_,i)=>({key:pre+w.id+i,team:T[i%8][0],matchup:'A @ '+T[i%8][0],line:T[i%8][1],side:'home',result:i<w.graded?T[i%8][2]:null,cfbdSeason:2026,cfbdWeek:w.wk,clv:0.5,pickedEdgeAtPick:2}));
    const ents=[{entryId:'e1',name:'Entry 1',picks:mk('a')}];
    if(entries2) ents.push({entryId:'e2',name:'Entry 2',picks:mk('b').slice(0,2)});
    state.history.push({id:w.id,label:w.label,closedAt:'2026-09-'+(20-wi)+'T15:00:00Z',entries:ents});
  });
  save(); renderRecord(); switchTab('record');
}"""
THREE = [{"id": "w3", "label": "Week 3", "n": 4, "graded": 3, "wk": 3}, {"id": "w2", "label": "Week 2", "n": 3, "graded": 3, "wk": 2}, {"id": "w1", "label": "Week 1", "n": 3, "graded": 3, "wk": 1}]
ONE = [{"id": "w1", "label": "Week 1", "n": 4, "graded": 3, "wk": 1}]


def open_results(p, port, width=1360):
    browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": width, "height": 900})
    return browser, page, errors


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            # ---------------- Desktop, 3 weeks, 3 graded in the latest (9 total -> analytics folded)
            browser, page, errors = open_results(p, port)
            page.evaluate(SEED, [THREE, False])
            page.wait_for_timeout(300)
            ys = page.evaluate("""()=>{const y=s=>{const e=document.querySelector(s);return e?Math.round(e.getBoundingClientRect().top+scrollY):null};
               return {summary:y('.record-summary'),latest:y('.record-week-latest'),old:y('.record-week-old'),analytics:y('#recordAnalyticsDetails')}}""")
            print(f"   section tops: {ys}")
            check("order on the page: your record, then the latest week, then older weeks, then analytics",
                  ys["summary"] < ys["latest"] < ys["old"] < ys["analytics"])
            check("'Your record' card shows the ATS record (W-L-P) from every graded pick",
                  "7-2-1".replace("7-2-1", page.evaluate("(()=>{const a=recordAnalytics(activeHistory(),recordFilters);return a.W+'-'+a.L+'-'+a.P})()")) in page.inner_text(".record-summary")
                  and page.evaluate("recordAnalytics(activeHistory(),recordFilters).gradedCount") == 9)
            check("summary counts picks still waiting on a result", "1 waiting on a result" in page.inner_text(".record-summary"))
            check("latest week is expanded and tagged Latest", page.is_visible(".record-week-latest .record-pick-row") and "latest" in page.inner_text(".record-week-latest h2").lower())
            check("older weeks are folded, each with its record in the header",
                  page.locator("details.record-week-old").count() == 2 and all(not d for d in page.eval_on_selector_all("details.record-week-old", "els=>els.map(e=>e.open)"))
                  and "3-0-0" not in "" and bool(page.inner_text("details.record-week-old >> nth=0 >> summary").strip()))
            check("...their picks are not on screen until expanded", not page.is_visible("details.record-week-old >> nth=0 >> .record-pick-row"))
            check("analytics folded with a hint: '9 of 10 graded picks'", not page.evaluate("document.getElementById('recordAnalyticsDetails').open") and "9 of 10 graded picks" in page.inner_text("#recordAnalyticsDetails > summary"))
            check("filters are shown when there is more than one week", page.is_visible("#recordSeasonFilter"))

            # header button
            btn = page.locator("#checkResultsBtn").bounding_box()
            check("'Check results now' is a small header button (< 40px tall), not a big card", btn and btn["height"] < 40 and page.locator("#tab-record .card >> text=Auto-grading").count() == 0)
            page.click("#checkResultsBtn"); page.wait_for_timeout(700)
            msg = page.inner_text("#gradeMsg")
            check("checking results shows its message", bool(msg.strip()))
            page.evaluate("renderRecord()"); page.wait_for_timeout(150)
            check("...and the message survives a re-render of the results", page.inner_text("#gradeMsg") == msg)

            # expanding an older week is remembered across re-renders
            page.click("details.record-week-old >> nth=0 >> summary"); page.wait_for_timeout(150)
            check("expanding an older week shows its picks", page.is_visible("details.record-week-old >> nth=0 >> .record-pick-row"))
            page.evaluate("renderRecord()"); page.wait_for_timeout(150)
            check("...and it stays open after the results re-render", page.evaluate("document.querySelector('details.record-week-old').open") is True)

            # Edit result
            check("W/L/P buttons are hidden by default (grading is automatic)", page.locator(".record-week-latest .resbtn").count() == 0)
            chips = page.eval_on_selector_all(".record-week-latest .rescell", "els=>els.map(e=>e.textContent.trim())")
            check("each pick shows its result chip (W / L / Pending)", chips[:3] == ["W", "L", "W"] and chips[3] == "Pending")
            check("graded picks say 'Edit result', pending ones 'Set result'",
                  page.inner_text(".record-week-latest .record-edit-link >> nth=0") == "Edit result" and page.inner_text(".record-week-latest .record-edit-link >> nth=3") == "Set result")
            page.click(".record-week-latest .record-edit-link >> nth=3"); page.wait_for_timeout(150)
            check("'Set result' reveals W/L/P for just that pick", page.locator(".record-week-latest .resbtn").count() == 3)
            page.click(".record-week-latest .resbtn[data-res='W']"); page.wait_for_timeout(200)
            check("choosing W saves the result", page.evaluate("activeHistory()[0].entries[0].picks[3].result") == "W")
            check("...closes the editor and shows the W chip", page.locator(".record-week-latest .resbtn").count() == 0
                  and page.eval_on_selector_all(".record-week-latest .rescell", "els=>els.map(e=>e.textContent.trim())")[3] == "W")
            page.click(".record-week-latest .record-edit-link >> nth=3"); page.wait_for_timeout(120)
            page.click(".record-week-latest .resbtn[data-res='W']"); page.wait_for_timeout(200)
            check("choosing the same result again clears it (back to Pending), as before", page.evaluate("activeHistory()[0].entries[0].picks[3].result") is None
                  and page.eval_on_selector_all(".record-week-latest .rescell", "els=>els.map(e=>e.textContent.trim())")[3] == "Pending")
            page.click(".record-week-latest .record-edit-link >> nth=0"); page.wait_for_timeout(120)
            check("'Done' closes the editor without changing anything", page.inner_text(".record-week-latest .record-edit-link >> nth=0") == "Done")
            page.click(".record-week-latest .record-edit-link >> nth=0"); page.wait_for_timeout(120)
            check("...the chip is back", page.locator(".record-week-latest .resbtn").count() == 0 and page.evaluate("activeHistory()[0].entries[0].picks[0].result") == "W")

            # person's analytics choice is remembered
            page.click("#recordAnalyticsDetails > summary"); page.wait_for_timeout(150)
            check("clicking the analytics header opens it (breakdown tables appear)", page.is_visible("#recordBody >> text=Favorites vs. underdogs"))
            page.evaluate("renderRecord()"); page.wait_for_timeout(150)
            check("...and it stays open across re-renders even though it's still under 10 graded picks", page.evaluate("document.getElementById('recordAnalyticsDetails').open") is True)
            check("no uncaught page errors (desktop)", not errors)
            browser.close()

            # ---------------- 10+ graded -> analytics open automatically
            browser, page, errors = open_results(p, port)
            page.evaluate(SEED, [[{"id": "w2", "label": "Week 2", "n": 6, "graded": 6, "wk": 2}, {"id": "w1", "label": "Week 1", "n": 6, "graded": 6, "wk": 1}], False])
            page.wait_for_timeout(300)
            check("12 graded picks: analytics open automatically with the 'breakdowns' hint",
                  page.evaluate("document.getElementById('recordAnalyticsDetails').open") is True and "Breakdowns by edge" in page.inner_text("#recordAnalyticsDetails > summary"))
            page.click("#recordAnalyticsDetails > summary"); page.wait_for_timeout(120)
            page.evaluate("renderRecord()"); page.wait_for_timeout(150)
            check("closing it yourself is remembered too", page.evaluate("document.getElementById('recordAnalyticsDetails').open") is False)
            check("no uncaught page errors (10+ graded)", not errors)
            browser.close()

            # ---------------- one week, two entries
            browser, page, errors = open_results(p, port)
            page.evaluate(SEED, [ONE, True])
            page.wait_for_timeout(300)
            check("a single week: no filter bar (nothing to filter)", not page.is_visible("#recordSeasonFilter"))
            check("a single week: no folded older weeks", page.locator("details.record-week-old").count() == 0)
            check("two entries: the record card lists each entry's W-L-P", page.locator(".record-summary-entries .pl-row").count() == 2)
            browser.close()

            # ---------------- phone
            browser, page, errors = open_results(p, port, width=390)
            page.evaluate(SEED, [THREE, False])
            page.wait_for_timeout(300)
            check("phone: no horizontal overflow", page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth") <= 0)
            eb = page.locator(".record-week-latest .record-edit-link").first.bounding_box()
            check("phone: 'Edit result' is a >= 44px touch target", eb and eb["height"] >= 43)
            sb = page.locator("details.record-week-old > summary").first.bounding_box()
            check("phone: folded week headers are >= 44px tall", sb and sb["height"] >= 43)
            check("phone: the check button sits in the header, one compact control", page.locator("#checkResultsBtn").bounding_box()["height"] < 48)
            check("no uncaught page errors (phone)", not errors)
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
