"""
Real-browser E2E for the Sept 23, 2026 Survivor weekly-flow batch:

  1. Weekly Snapshot has a one-tap "Use <best-path team>" button (and
     "Switch to ..." when a different team is saved).
  2. Phones open on Week Rankings until the person picks a sub-tab
     themselves; desktop keeps the Season Board. An explicit choice sticks.
  3. Setup area shrinks once set up: 4-step wizard only for a brand-new
     entry; data status is one line with a "Details" toggle; "Pool settings"
     stays hidden for built-in pools; phone setup card / snapshot compacted.

Synthetic 8-week SEC season (Weeks 1-4 complete) through the real survivor
core, all /api/* mocked.

Run with:

    python3 tests/test_e2e_survivor_weekly_flow.py
"""
import importlib.util
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

from _e2e_common import start_server

_spec = importlib.util.spec_from_file_location(
    "surv", pathlib.Path(__file__).with_name("test_e2e_survivor_dynamic_weeks.py"))
S = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S)

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


LOAD = """([data,picks])=>{ const pid=pgSurvivorPoolId(); data.poolId=pid; pgSurvivorRuntime.errorByPool[pid]=null; pgSurvivorRuntime.dataByPool[pid]=data;
   const u=pgSurvivorUi(); u.weekByPool[pid]=5; pgSurvivorSaveUi(u); const e=pgSurvivorActiveEntry(); e.picks=picks; pgSurvivorComputePlans(); renderSurvivorShell(); }"""


def open_survivor(p, port, width, picks, fresh_ui=True):
    browser, page, reqs, errors = S.B.open_app(p, port, json.loads(json.dumps(S.PRIVATE)), {"width": width, "height": 900})
    if fresh_ui:
        page.evaluate("localStorage.removeItem('pickgauge_survivor_ui_v1')")
    page.evaluate("switchTab('survivor')")
    page.wait_for_timeout(2500)
    page.evaluate(LOAD, [S.season(), picks])
    page.wait_for_timeout(500)
    return browser, page, errors


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            # ---------------- Phone, returning entry (has earlier picks)
            browser, page, errors = open_survivor(p, port, 390, {"1": "Alabama", "2": "Georgia"})
            check("phone: opens on Week Rankings by default", page.evaluate("pgSurvivorUi().view") == "rankings"
                  and page.is_visible("#survivor-view-rankings"))
            check("phone: 4-step wizard hidden for an entry that already has picks", page.inner_html("#survivorJourney").strip() == "")
            strip = page.locator("#survivorHealth .survivor-health-strip").bounding_box()
            check("phone: data status is a single line (< 56px)", strip and strip["height"] < 56)
            check("phone: technical details collapsed behind 'Details'", not page.is_visible("#survivorHealthDetail"))
            check("phone: 'Pool settings' hidden for a built-in pool", not page.is_visible("#survivorPoolSettingsBtn"))
            y = page.evaluate("Math.round(document.getElementById('survivorSubnav').getBoundingClientRect().top+scrollY)")
            print(f"   phone sub-tabs start at {y}px (was ~1331px)")
            check("phone: sub-tabs start under 1000px (was ~1331px)", y < 1000)
            use = page.locator(".survivor-summary-use")
            check("phone: Weekly Snapshot shows 'Use Ole Miss' (the best path)", use.count() == 1 and use.inner_text().strip() == "Use Ole Miss")
            check("phone: Use button is a >= 44px touch target", use.bounding_box()["height"] >= 44)
            use.click()
            page.wait_for_timeout(500)
            check("tapping Use saves the pick for the viewed week", page.evaluate("pgSurvivorActiveEntry().picks['5']") == "Ole Miss")
            check("after using it, the button disappears (pick matches best path)", page.locator(".survivor-summary-use").count() == 0)
            check("snapshot now shows Ole Miss as your pick", "Ole Miss" in page.inner_text(".survivor-week-summary-picks"))
            # explicit choice sticks
            page.click("#survivorSubnav [data-survivor-view='board']")
            page.wait_for_timeout(300)
            page.reload()
            page.wait_for_timeout(300)
            # Survivor is lazy-loaded now: its code doesn't exist again until the tab is reopened.
            page.evaluate("switchTab('survivor')")
            page.wait_for_function("typeof pgSurvivorUi==='function'", timeout=15000)
            check("phone: explicitly choosing Season Board is remembered after reload", page.evaluate("pgSurvivorUi().view") == "board"
                  and page.evaluate("pgSurvivorUi().viewChosen") is True)
            check("no page errors (phone)", not errors)
            browser.close()

            # ---------------- Desktop
            browser, page, errors = open_survivor(p, port, 1360, {"1": "Alabama", "2": "Georgia", "5": "Texas"})
            check("desktop: keeps Season Board as the default view", page.evaluate("pgSurvivorUi().view") == "board")
            sw = page.locator(".survivor-summary-use")
            check("desktop: with a different team saved, offers 'Switch to Ole Miss'", sw.count() == 1 and sw.inner_text().strip() == "Switch to Ole Miss")
            sw.click()
            page.wait_for_timeout(400)
            check("Switch replaces the saved pick", page.evaluate("pgSurvivorActiveEntry().picks['5']") == "Ole Miss")
            page.click("[data-survivor-health-toggle]")
            page.wait_for_timeout(200)
            check("'Details' opens the technical details", page.is_visible("#survivorHealthDetail") and "probability sources" in page.inner_text("#survivorHealthDetail").lower())
            check("toggle label flips to 'Hide details'", page.inner_text("[data-survivor-health-toggle]").strip() == "Hide details")
            page.click("[data-survivor-health-toggle]")
            page.wait_for_timeout(200)
            check("'Hide details' collapses them again", not page.is_visible("#survivorHealthDetail"))
            # kicked-off game: no Use button
            page.evaluate("""(()=>{ delete pgSurvivorActiveEntry().picks['5']; const d=pgSurvivorData();
                d.matchups.filter(m=>m.week===5&&m.team==='Ole Miss').forEach(m=>{m.startDate=new Date(Date.now()-3600e3).toISOString();});
                pgSurvivorComputePlans(); renderSurvivorShell(); })()""")
            page.wait_for_timeout(300)
            check("no Use button once the best-path game has kicked off", page.locator(".survivor-summary-use").count() == 0)
            check("no page errors (desktop)", not errors)
            browser.close()

            # ---------------- Brand-new entry keeps the onboarding wizard
            browser, page, errors = open_survivor(p, port, 1360, {})
            check("brand-new entry (no picks yet) still gets the 4-step wizard", page.locator("#survivorJourney .survivor-journey-step").count() == 4)
            check("brand-new entry also gets the Use button", page.locator(".survivor-summary-use").count() == 1)
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
