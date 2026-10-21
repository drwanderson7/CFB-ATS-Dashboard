"""
Real-browser E2E: All Games' Powers / Computer columns collapse while empty
(Oct 21, 2026).

Desktop (1360px), with Brad Powers + Computer Line switched on in Models:
  * Collapsed: no Powers PDF and no values -> no Powers/Computer headers or
    input boxes, one narrow "+ Add Powers / Computer lines" header control
    (about half the two columns' width), and header and rows still line up.
  * Shown: the control brings both columns back (focus lands in the first
    Powers box), typing a value saves it, sorting by Powers works both ways,
    the choice survives a reload, and the x puts it back to automatic.
  * Auto-shown: a stored value, a "check PDF" flag or an imported Powers PDF
    brings the columns back without the control; clearing everything
    collapses them again.
At 1024px the collapsed table fits without sideways scroll (shown, it scrolls).
Phones (390px, 360px): none of this shows, and nothing runs off the screen.

Reuses the fully mocked /api/* harness from test_e2e_batch1_workflow.py.

Run with:

    python3 tests/test_e2e_board_powers_columns.py
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
_spec2 = importlib.util.spec_from_file_location(
    "overflow", pathlib.Path(__file__).with_name("test_e2e_phone_no_overflow.py"))
O = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(O)

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


PRIVATE = {"entries": [{"id": "e1", "name": "Entry 1", "picks": {}}], "history": [], "pools": [], "_rev": 1,
           "enabledSystems": ["bp", "comp", "teamrank", "sagpred", "sag", "wayward"]}
HEAD = "#boardHeadRow"
ROWS = "#boardBody tr[data-key]"


def state_of(page):
    return page.evaluate(f"""()=>{{ const head=document.querySelector('{HEAD}'), row=document.querySelector('{ROWS}');
      return {{
        bpTh: !!head.querySelector('th[data-sortkey="bp"]'), compTh: !!head.querySelector('th[data-sortkey="comp"]'),
        addBtn: !!head.querySelector('[data-powers-toggle="show"]'), hideBtn: !!head.querySelector('[data-powers-toggle="hide"]'),
        inputs: document.querySelectorAll('#boardBody input.inp').length,
        rows: document.querySelectorAll('{ROWS}').length,
        // Market header sits right above each row's Market cell (columns line up).
        aligned: [...document.querySelectorAll('{ROWS} td.veg-cell')].every(td=>Math.abs(td.getBoundingClientRect().left-head.querySelector('th[data-sortkey="vegas"]').getBoundingClientRect().left)<1),
        saved: !!state.boardPowersShown }}; }}""")


def render(page, js=""):
    page.evaluate(f"()=>{{ {js}; renderBoard(); }}")
    page.wait_for_timeout(250)


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": 1360, "height": 900})
            page.evaluate("switchTab('board')")
            render(page, "state.inputs={}; state.pdfGames=null; state.boardPowersShown=false; games.forEach(g=>{delete g.bpSuspect;})")

            # ---- Collapsed
            s = state_of(page)
            print(f"   collapsed: {s}")
            check("collapsed: no Powers / Computer headers", not s["bpTh"] and not s["compTh"])
            check("collapsed: no empty input boxes on any row", s["inputs"] == 0 and s["rows"] > 0)
            check("collapsed: the '+ Add Powers / Computer lines' control shows in the header",
                  s["addBtn"] and page.locator("[data-powers-toggle='show']").is_visible()
                  and page.locator("[data-powers-toggle='show']").inner_text().strip() == "+ Add Powers / Computer lines")
            check("collapsed: header and rows still line up (Market header above every Market cell)", s["aligned"])
            ctrl_w = page.locator("th.powers-collapsed-th").bounding_box()["width"]

            # ---- Shown on request
            page.click("[data-powers-toggle='show']")
            page.wait_for_timeout(300)
            s = state_of(page)
            print(f"   shown: {s}")
            check("Add: both columns come back with a Powers and a Computer box on every row",
                  s["bpTh"] and s["compTh"] and s["inputs"] == 2 * s["rows"])
            check("Add: the choice is saved (state.boardPowersShown)", s["saved"])
            check("Add: focus lands in the first Powers box, ready for manual entry",
                  page.evaluate("document.activeElement&&document.activeElement.matches('#boardBody input.inp[data-i=\"0\"]')"))
            check("shown while empty: a small x offers to hide them again", s["hideBtn"])
            check("header and rows still line up when shown", s["aligned"])
            bp_w = page.locator(f"{HEAD} th[data-sortkey='bp']").bounding_box()["width"]
            comp_w = page.locator(f"{HEAD} th[data-sortkey='comp']").bounding_box()["width"]
            print(f"   collapsed control {ctrl_w:.0f}px vs Powers+Computer columns {bp_w + comp_w:.0f}px")
            check("collapsed control takes at most two-thirds of the two columns' width", ctrl_w <= (bp_w + comp_w) * 2 / 3)

            # x goes back to automatic.
            page.click("[data-powers-toggle='hide']")
            page.wait_for_timeout(300)
            s = state_of(page)
            check("x: columns collapse again and the saved choice is cleared", not s["bpTh"] and s["addBtn"] and not s["saved"])

            # Manual entry + sorting.
            page.click("[data-powers-toggle='show']")
            page.wait_for_timeout(300)
            keys = page.eval_on_selector_all(ROWS, "els=>els.map(e=>e.dataset.key)")
            first_box = page.locator(f"#boardBody input.inp[data-k='{keys[2]}'][data-i='0']")
            first_box.fill("-9.5")
            page.wait_for_timeout(200)
            check("typing a Powers line by hand saves it", page.evaluate(f"inputsFor({json.dumps(keys[2])})[0]") == -9.5)
            page.evaluate(f"state.inputs[{json.dumps(keys[4])}]=[3,null]; save();")
            render(page)
            check("with values present the x is gone (columns stay because values exist)", not state_of(page)["hideBtn"])
            page.click(f"{HEAD} th[data-sortkey='bp']")
            page.wait_for_timeout(300)
            order1 = page.eval_on_selector_all(ROWS, "els=>els.slice(0,2).map(e=>e.dataset.key)")
            dir1 = page.evaluate("state.sortDir")
            check("clicking Powers sorts by it (sort-active header)", page.evaluate("state.sortKey") == "bp"
                  and page.locator(f"{HEAD} th[data-sortkey='bp'].sort-active").count() == 1)
            page.click(f"{HEAD} th[data-sortkey='bp']")
            page.wait_for_timeout(300)
            order2 = page.eval_on_selector_all(ROWS, "els=>els.slice(0,2).map(e=>e.dataset.key)")
            print(f"   sort by Powers {dir1}: {order1}; flipped: {order2}")
            check("Powers sort puts the two games with a value first, in value order, and flips on a second click",
                  set(order1) == {keys[2], keys[4]} and order1 != order2 and page.evaluate("state.sortDir") != dir1
                  and (order1 == ([keys[4], keys[2]] if dir1 == "desc" else [keys[2], keys[4]])))
            page.click(f"{HEAD} th[data-sortkey='comp']")
            page.wait_for_timeout(300)
            check("clicking Computer sorts by it", page.evaluate("state.sortKey") == "comp")

            # Saved choice survives a reload.
            render(page, "state.inputs={}; save()")
            page.reload()
            page.wait_for_function("() => (document.getElementById('refreshTime')||{}).textContent.indexOf('Loading')===-1", timeout=8000)
            page.wait_for_timeout(1200)
            page.evaluate("switchTab('board')")
            page.wait_for_timeout(300)
            s = state_of(page)
            check("after a reload the requested columns are still shown (empty)", s["saved"] and s["bpTh"] and s["inputs"] > 0)

            # ---- Auto-shown
            render(page, "state.boardPowersShown=false; state.inputs={}; state.pdfGames=null")
            check("back to automatic with nothing to show -> collapsed", state_of(page)["addBtn"])
            k = keys[0]
            render(page, f"state.inputs[{json.dumps(k)}]=[null,-4]")
            s = state_of(page)
            check("auto: one stored Computer value brings both columns back, no click needed",
                  s["bpTh"] and s["compTh"] and not s["addBtn"] and not s["saved"] and not s["hideBtn"])
            check("auto: the stored value shows in its box",
                  page.locator(f"#boardBody input.inp[data-k='{k}'][data-i='1']").input_value() == "-4")
            render(page, "state.inputs={}")
            check("auto: clearing the last value collapses them again", state_of(page)["addBtn"])
            render(page, "state.pdfGames=[{away:'Nowhere State',home:'Elsewhere Tech',bp:null,comp:null}]")
            s = state_of(page)
            check("auto: an imported Powers PDF brings the columns back", s["bpTh"] and not s["addBtn"])
            render(page, f"state.pdfGames=null; games.find(g=>g.key==={json.dumps(k)}).bpSuspect=true")
            check("auto: a 'check PDF' flag brings the columns back (so the flag is visible)",
                  state_of(page)["bpTh"] and page.locator(f"{ROWS}[data-key='{k}'] .bp-flag").is_visible())
            render(page, f"delete games.find(g=>g.key==={json.dumps(k)}).bpSuspect")
            check("desktop: no page errors", not errors)
            browser.close()

            # ---- Small desktop (1024px): the reclaimed width is what keeps the
            # table from scrolling sideways in this 12-game slate.
            browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": 1024, "height": 800})
            page.evaluate("switchTab('board')")
            sw = "(()=>{const b=document.querySelector('#tab-board .board');return b.scrollWidth-b.clientWidth})()"
            render(page, "state.inputs={}; state.pdfGames=null; state.boardPowersShown=false")
            collapsed_over = page.evaluate(sw)
            render(page, "state.boardPowersShown=true")
            shown_over = page.evaluate(sw)
            print(f"   1024px sideways overflow: collapsed {collapsed_over}px, shown {shown_over}px")
            check("1024px: collapsed, the table fits its box with no sideways scroll", collapsed_over <= 0)
            check("1024px: collapsing reclaims width the shown columns use", shown_over > collapsed_over)
            check("1024px: no page errors", not errors)
            browser.close()

            # ---- Phones: unaffected
            for width in (390, 360):
                browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": width, "height": 844})
                page.evaluate("switchTab('board')")
                for label, js in (("collapsed", "state.inputs={}; state.boardPowersShown=false"),
                                  ("shown", "state.boardPowersShown=true")):
                    render(page, js)
                    check(f"{width}px {label}: no Powers / Computer control or boxes visible on phones",
                          not page.locator("[data-powers-toggle]").first.is_visible()
                          and not page.locator("#boardBody input.inp").first.is_visible())
                    r = page.evaluate(O.OVERFLOW)
                    check(f"{width}px {label}: nothing runs off the screen", r["scrollWidth"] <= r["vw"] and not r["bad"])
                check(f"{width}px: no page errors", not errors)
                browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
