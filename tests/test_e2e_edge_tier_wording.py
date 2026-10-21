"""
Real-browser E2E: Settings, the All Games legend and Help use the same
Slim / Good / Strong words as the board and This Week (Oct 21, 2026).

Checks the rendered Settings labels ("Good edge >=", "Strong edge >="), that a
value saved before the rename (state.goodThresh / state.strongThresh) still
loads into the renamed field, that changing it still saves to the same key
and re-tiers the slate, the All Games legend words, the Help glossary text,
and that the Settings row fits at 360px.

Run with:

    python3 tests/test_e2e_edge_tier_wording.py
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


# A person who saved custom cutoffs before the rename.
PRIVATE = {"entries": [{"id": "e1", "name": "Entry 1", "picks": {}}], "history": [], "pools": [], "_rev": 1,
           "enabledSystems": ["teamrank", "sagpred", "sag", "wayward"], "goodThresh": 2, "strongThresh": 4}


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": 1360, "height": 900})
            page.evaluate("switchTab('settings')")
            page.wait_for_timeout(300)
            labels = page.eval_on_selector_all("#tab-settings .settings-thresholds .field-lbl", "els=>els.map(e=>e.textContent.trim())")
            print(f"   Settings labels: {labels}")
            check("Settings reads 'Good edge ≥' and 'Strong edge ≥'", labels == ["Good edge ≥", "Strong edge ≥"])
            check("no 'Green edge' text anywhere on the page", "green edge" not in page.evaluate("document.body.innerText").lower())
            check("saved values from before the rename load into the renamed fields (2 and 4)",
                  page.input_value("#goodThresh") == "2" and page.input_value("#strongThresh") == "4")

            # Changing Good edge still saves to state.goodThresh and re-tiers the slate.
            before = page.evaluate("games.map(g=>edgeOf(g)).filter(e=>e&&e.side).map(e=>edgeTierLabel(e.pts))")
            page.fill("#goodThresh", "0.5")
            page.dispatch_event("#goodThresh", "change")
            page.wait_for_timeout(250)
            after = page.evaluate("games.map(g=>edgeOf(g)).filter(e=>e&&e.side).map(e=>edgeTierLabel(e.pts))")
            print(f"   tiers at Good 2: {before}\n   tiers at Good 0.5: {after}")
            check("changing 'Good edge ≥' saves to state.goodThresh", page.evaluate("state.goodThresh") == 0.5)
            check("...and the tiers use it (fewer Slim games at the lower cutoff)", after.count("Slim") < before.count("Slim"))
            check("tier words in use are only Strong / Good / Slim", set(before + after) <= {"Strong", "Good", "Slim"})
            page.reload()
            page.wait_for_function("() => (document.getElementById('refreshTime')||{}).textContent.indexOf('Loading')===-1", timeout=8000)
            page.wait_for_timeout(1200)
            page.evaluate("switchTab('settings')")
            page.wait_for_timeout(300)
            check("the new value is still there after a reload (same storage key)", page.input_value("#goodThresh") == "0.5")

            # All Games legend.
            page.evaluate("switchTab('board')")
            page.wait_for_timeout(300)
            page.evaluate("document.getElementById('boardSortFilterPanel').open=true")
            page.wait_for_timeout(200)
            legend = page.eval_on_selector_all("#boardSortFilterPanel .legend span", "els=>els.map(e=>e.textContent.trim())")
            print(f"   legend: {legend}")
            check("All Games legend reads Strong / Good / Slim", legend == ["Strong", "Good", "Slim"])

            # Help glossary.
            page.evaluate("switchTab('help')")
            page.wait_for_timeout(300)
            entry = page.locator(".help-glossary details", has_text="Strong / Good / Slim")
            entry.locator("summary").click()
            page.wait_for_timeout(150)
            text = entry.inner_text()
            check("Help explains the tiers with the 'Strong edge' and 'Good edge' setting names",
                  "Strong edge setting" in text and "Good edge setting" in text and "Slim" in text)
            check("no page errors", not errors)
            browser.close()

            # Settings row fits on a small phone.
            browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": 360, "height": 800})
            page.evaluate("switchTab('settings')")
            page.wait_for_timeout(300)
            r = page.evaluate(O.OVERFLOW)
            check("360px: Settings fits the screen with the new labels", r["scrollWidth"] <= r["vw"] and not r["bad"])
            check("360px: no page errors", not errors)
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
