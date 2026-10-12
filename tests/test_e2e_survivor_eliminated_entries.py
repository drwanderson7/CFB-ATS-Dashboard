"""
Real-browser E2E: eliminated Survivor entries are shown as done everywhere
(Oct 12, 2026). Synthetic season where Georgia LOSES in Week 3; the entry that
picked Georgia that week must read OUT in the dropdown, status note, Entry
comparison, Pick grid, Entry correlation and Portfolio strategy.

    python3 tests/test_e2e_survivor_eliminated_entries.py
"""
import importlib.util, json, pathlib, sys
from playwright.sync_api import sync_playwright
from _e2e_common import start_server

_spec = importlib.util.spec_from_file_location("surv", pathlib.Path(__file__).with_name("test_e2e_survivor_dynamic_weeks.py"))
S = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(S)
failures = []; total = 0
def check(name, cond):
    global total; total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond: failures.append(name)

ENTRIES = [
    ("My Entry", {1: "Alabama", 2: "LSU", 3: "Texas", 4: "Tennessee", 5: "Ole Miss"}),
    ("Entry 2", {1: "Alabama", 2: "LSU", 3: "Georgia", 4: "Texas", 5: "Ole Miss"}),   # Georgia loses W3 -> OUT
    ("Entry 3", {1: "Georgia", 2: "Alabama", 3: "Texas", 4: "LSU", 5: "Tennessee"}),
]
SETUP = """([data, entries, active])=>{
  const pid=pgSurvivorPoolId(); data.poolId=pid; pgSurvivorRuntime.errorByPool[pid]=null; pgSurvivorRuntime.dataByPool[pid]=data;
  const pool=pgSurvivorPoolState(); pool.entries=entries.map(([name,picks])=>{
    const e=pgSurvivorDefaultEntry(name); e.picks={}; Object.entries(picks).forEach(([w,t])=>{e.picks[String(w)]=t;}); return e; });
  const ui=pgSurvivorUi(); ui.weekByPool[pid]=5; ui.view='history'; ui.viewChosen=true; ui.entryByPool[pid]=pool.entries[active].id; pgSurvivorSaveUi(ui);
  pgSurvivorComputePlans(); renderSurvivorShell();
}"""

def lose_georgia_w3(data):
    for m in data["matchups"]:
        if m["team"] == "Georgia" and m["week"] == 3:
            m["teamPoints"], m["opponentPoints"] = 10, 24
    return data

def open_app(p, port, width):
    browser, page, reqs, errors = S.B.open_app(p, port, json.loads(json.dumps(S.PRIVATE)), {"width": width, "height": 900})
    page.evaluate("switchTab('survivor')")
    page.wait_for_function("typeof renderSurvivorShell==='function' && !!document.getElementById('survivorMount').dataset.mounted", timeout=15000)
    page.wait_for_timeout(500)
    return browser, page, errors

def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser, page, errors = open_app(p, port, 1360)
            page.evaluate(SETUP, [lose_georgia_w3(S.season()), [[n, {str(k): v for k, v in pk.items()}] for n, pk in ENTRIES], 0])
            page.wait_for_timeout(500)
            opts = page.evaluate("[...document.querySelectorAll('#survivorEntrySelect option')].map(o=>o.textContent.trim())")
            print("   dropdown:", opts)
            check("dropdown marks only the eliminated entry as OUT (W3)", opts == ["My Entry", "Entry 2 · OUT (W3)", "Entry 3"] or (opts[1].startswith("Entry 2 · OUT") and "OUT" not in opts[0] and "OUT" not in opts[2]))
            check("status note hidden for a live entry", page.evaluate("document.getElementById('survivorEntryStatusNote').hidden"))
            cmp_status = page.evaluate("[...document.querySelectorAll('.survivor-compare-table tbody tr')].find(tr=>tr.querySelector('th').textContent==='Status')?.innerText")
            print("   status row:", repr(cmp_status))
            check("comparison status row says ELIMINATED once", cmp_status.count("ELIMINATED") == 1 and cmp_status.count("ALIVE") >= 1)
            check("comparison header tags Entry 2 OUT", page.evaluate("[...document.querySelectorAll('.survivor-compare-table thead th')].some(th=>/Entry 2/.test(th.textContent)&&/OUT W3/.test(th.textContent))"))
            surv = page.evaluate("[...document.querySelectorAll('.survivor-compare-table tbody tr')].find(tr=>tr.querySelector('th').textContent==='Projected survival')?.innerText")
            check("eliminated entry shows 0% projected survival", "0%" in surv)
            check("summary says 2 of 3 entries still alive", page.is_visible("text=2 of 3") )
            grid_out = page.evaluate("[...document.querySelectorAll('.survivor-pick-grid-table td.out')].map(td=>td.textContent.trim())")
            print("   grid out cells:", grid_out)
            check("pick grid blanks Entry 2's weeks after W3 (W4, W5 -> 'out')", grid_out == ["out", "out"])
            check("pick grid header tagged OUT", page.evaluate("[...document.querySelectorAll('.survivor-pick-grid-table thead th')].some(th=>/Entry 2/.test(th.textContent)&&/OUT/.test(th.textContent))"))
            check("correlation matrices tag the eliminated entry (4 tags: header+row x 2 grids)", page.evaluate("document.querySelectorAll('#survivorEntryCorrelation .survivor-out-tag').length") == 4)
            check("correlation note explains eliminated entries", "still alive" in page.inner_text("#survivorEntryCorrelation"))
            port_txt = page.inner_text(".survivor-portfolio")
            print("   portfolio:", port_txt[:200].replace("\n", " | "))
            check("portfolio counts 2 live entries and 1 eliminated", "1 eliminated" in port_txt or "Eliminated entries (1)" in port_txt)

            # Viewing the eliminated entry itself
            page.select_option("#survivorEntrySelect", index=1)
            page.wait_for_timeout(400)
            note = page.inner_text("#survivorEntryStatusNote")
            print("   note:", note)
            check("status note appears under the selector for the eliminated entry", page.is_visible("#survivorEntryStatusNote") and "Eliminated" in note and "Georgia" in note)
            check("dropdown stays selected on the eliminated entry", page.evaluate("document.getElementById('survivorEntrySelect').selectedIndex") == 1)
            # --- Hide eliminated entries (Oct 12, 2026) ---
            btn = page.inner_text("#survivorHideOutBtn")
            check("hide button offers to hide 1 eliminated entry", "Hide 1 eliminated entry" in btn)
            page.click("#survivorHideOutBtn")  # active entry is the eliminated one -> should move to a live entry
            page.wait_for_timeout(400)
            opts2 = page.evaluate("[...document.querySelectorAll('#survivorEntrySelect option')].map(o=>o.textContent.trim())")
            sel = page.evaluate("document.getElementById('survivorEntrySelect').selectedOptions[0].textContent.trim()")
            print("   dropdown after hide:", opts2, "selected:", sel)
            check("hiding removes the eliminated entry from the dropdown", opts2 == ["My Entry", "Entry 3"])
            check("active entry moved off the eliminated one", sel == "My Entry")
            check("button now offers to show them", "Show 1 eliminated entry" in page.inner_text("#survivorHideOutBtn"))
            cols = page.evaluate("[...document.querySelectorAll('.survivor-compare-table thead th')].map(th=>th.textContent.trim())")
            gcols = page.evaluate("[...document.querySelectorAll('.survivor-pick-grid-table thead th')].map(th=>th.textContent.trim())")
            print("   comparison cols:", cols, "grid cols:", gcols)
            check("comparison table drops the eliminated entry", not any("Entry 2" in c for c in cols) and len(cols) == 3)
            check("pick grid drops the eliminated entry", not any("Entry 2" in c for c in gcols) and len(gcols) == 3)
            check("correlation shows no OUT tags while hidden", page.evaluate("document.querySelectorAll('#survivorEntryCorrelation .survivor-out-tag').length") == 0)
            check("a note says 1 eliminated entry is hidden, with a Show link", "hidden" in page.inner_text("#survivor-view-history") and page.is_visible(".survivor-out-hidden-note [data-survivor-toggle-out]"))
            page.reload(); page.evaluate("switchTab('survivor')")
            page.wait_for_function("typeof renderSurvivorShell==='function' && !!document.getElementById('survivorMount').dataset.mounted", timeout=15000)
            page.wait_for_timeout(600)
            check("the choice is remembered after a reload (device-local)", page.evaluate("JSON.parse(localStorage.getItem('pickgauge_survivor_ui_v1')||'{}').hideOutByPool?.sec===true"))
            # entries were injected by script (not saved), so re-inject them after the reload
            page.evaluate(SETUP, [lose_georgia_w3(S.season()), [[n, {str(k): v for k, v in pk.items()}] for n, pk in ENTRIES], 0])
            page.wait_for_timeout(400)
            check("after reload + same entries the saved choice still hides the eliminated entry", page.evaluate("[...document.querySelectorAll('#survivorEntrySelect option')].length") == 2
                  and "Show 1 eliminated entry" in page.inner_text("#survivorHideOutBtn"))
            page.evaluate("document.getElementById('survivorHideOutBtn').click()")
            page.wait_for_timeout(400)
            opts3 = page.evaluate("[...document.querySelectorAll('#survivorEntrySelect option')].map(o=>o.textContent.trim())")
            check("showing again brings the eliminated entry back", len(opts3) == 3 and "OUT" in opts3[1])
            check("no uncaught page errors", not errors)
            browser.close()
    finally:
        httpd.shutdown()
    print(f"\n{total - len(failures)}/{total} checks passed")
    if failures: print("FAILED:", failures); sys.exit(1)
    print("All checks passed.")
main()
