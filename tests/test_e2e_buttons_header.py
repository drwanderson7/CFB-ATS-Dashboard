"""
Real-browser E2E for the Sept 23, 2026 review items 8 & 9:

  8. Secondary buttons (.btn-light / .btn-secondary) have a visible outline
     again. A later shared ".btn{border:1px solid transparent}" rule had
     wiped their border color, so they read as plain bold text.
  9. Phone header fits on ONE row (was ~107px, two rows): Feedback moves
     into the phone menu ("Send feedback"), Refresh becomes an icon-only
     44px circle, brand drops "CFB ATS". Desktop header unchanged.

Run with:

    python3 tests/test_e2e_buttons_header.py
"""
import importlib.util
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
TABS = ("snapshot", "pickboard", "confidence", "survivor", "record", "settings", "help")

BORDER_AUDIT = """()=>[...document.querySelectorAll('.btn.btn-light,.btn.btn-secondary')].filter(b=>b.offsetParent!==null).map(b=>{
  const cs=getComputedStyle(b); return {id:b.id||b.textContent.trim().slice(0,24), w:parseFloat(cs.borderTopWidth), c:cs.borderTopColor};})"""


def transparent(c):
    return c in ("transparent", "rgba(0, 0, 0, 0)")


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            # ---------------- Desktop
            browser, page, reqs, errors = B.open_app(p, port, dict(PRIVATE), {"width": 1360, "height": 900})
            seen, bad = 0, []
            for t in TABS + ("picks",):
                if t == "picks":
                    page.evaluate("switchTab('pickboard')"); page.evaluate("switchPickBoardView('picks')")
                else:
                    page.evaluate(f"switchTab('{t}')")
                page.wait_for_timeout(350)
                for r in page.evaluate(BORDER_AUDIT):
                    seen += 1
                    if r["w"] < 1 or transparent(r["c"]):
                        bad.append(f"{t}:{r['id']}")
            print(f"   audited {seen} visible secondary buttons across tabs")
            check("desktop: audited a meaningful number of secondary buttons", seen >= 8)
            check("desktop: EVERY visible .btn-light/.btn-secondary has a visible outline", not bad)
            if bad:
                print("   borderless:", bad[:8])
            page.evaluate("switchTab('settings')"); page.wait_for_timeout(200)
            reset = page.evaluate("getComputedStyle(document.getElementById('resetBtn')).borderTopColor")
            check("desktop: the red 'Reset this browser' keeps its own red outline", reset == "rgb(243, 199, 199)")
            check("desktop: header Feedback button still visible", page.is_visible("#feedbackBtn"))
            check("desktop: phone-only 'Send feedback' menu item hidden", not page.is_visible("#navFeedbackBtn"))
            check("desktop: header height unchanged (~63px)", round(page.locator("header.app").bounding_box()["height"]) <= 66)
            page.click("nav.tabs button[data-tab='record']")
            page.wait_for_timeout(250)
            check("desktop: nav tabs still switch tabs (wiring limited to [data-tab])", page.is_visible("#tab-record"))
            check("no page errors (desktop)", not errors)
            browser.close()

            # ---------------- Phones
            for width in (390, 360):
                browser, page, reqs, errors = B.open_app(p, port, dict(PRIVATE), {"width": width, "height": 844})
                heights, overflow = [], []
                for t in TABS:
                    page.evaluate(f"switchTab('{t}')"); page.wait_for_timeout(250)
                    heights.append(round(page.locator("header.app").bounding_box()["height"]))
                    overflow.append(page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth"))
                print(f"   {width}px header heights: {heights}")
                check(f"{width}px: header is one row on every tab (< 70px; was 107px)", max(heights) < 70)
                check(f"{width}px: no horizontal overflow on any tab", max(overflow) <= 0)
                page.evaluate("switchTab('snapshot')"); page.wait_for_timeout(200)
                check(f"{width}px: header Feedback button hidden", not page.is_visible("#feedbackBtn"))
                check(f"{width}px: 'CFB ATS' tag hidden", not page.is_visible("#wkLabel"))
                rb = page.locator("#refreshBtn").bounding_box()
                check(f"{width}px: Refresh is an icon-only 44px circle", rb and round(rb["width"]) == 44 and round(rb["height"]) == 44)
                sizes = page.eval_on_selector_all("header.app .icon-nav-btn", "els=>els.filter(e=>e.offsetParent!==null).map(e=>[e.offsetWidth,e.offsetHeight])")
                check(f"{width}px: Account/Settings/Help stay 44px touch targets", len(sizes) == 3 and all(w >= 44 and h >= 44 for w, h in sizes))
                brand = page.locator("header.app .brand h1").bounding_box()
                right = page.locator("header.app .app-right").bounding_box()
                check(f"{width}px: brand and buttons share the row without overlapping", brand["x"] + brand["width"] <= right["x"] + 1 and abs(brand["y"] - right["y"]) < 30)
                # Feedback via the menu
                page.click("#navHamburger"); page.wait_for_timeout(250)
                check(f"{width}px: menu shows 'Send feedback'", page.is_visible("#navFeedbackBtn"))
                page.click("#navFeedbackBtn"); page.wait_for_timeout(300)
                check(f"{width}px: 'Send feedback' opens the feedback dialog", page.evaluate("(()=>{const m=document.getElementById('betaFeedbackModal'); return !!m && getComputedStyle(m).display!=='none' && !m.hidden;})()"))
                check(f"{width}px: ...and closes the menu", page.get_attribute("#navHamburger", "aria-expanded") == "false")
                check(f"{width}px: ...without switching tabs", page.is_visible("#tab-snapshot"))
                check(f"no page errors ({width}px)", not errors)
                if width == 390:
                    page.keyboard.press("Escape")
                    page.screenshot(path="/tmp/e2e_header_390.png", clip={"x": 0, "y": 0, "width": 390, "height": 140})
                browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
