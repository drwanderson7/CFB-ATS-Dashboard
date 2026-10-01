"""
Real-browser E2E: Survivor's code loads on demand (Sept 30, 2026).

  * Nothing Survivor is fetched on page load (see also test_e2e_bundle_and_lazy_pdf.py).
  * Opening the tab shows a loading card, then the real Survivor shell; the
    stylesheet + core module are fetched before the two classic scripts.
  * The ATS "Viewing" bar is already hidden while the Survivor CSS is still
    downloading (that one rule lives in the main stylesheet -- no flash).
  * A second open fetches nothing new; reaching for the nav button warms it.
  * Blocked script / blocked core module -> clear error card with Try again;
    the same page recovers (a failed module import uses a fresh URL).
  * Survivor still works end to end after a lazy load (pick saves, sync
    re-render doesn't error).

Every /api/* call is mocked (harness from test_e2e_batch1_workflow.py).

Run with:

    python3 tests/test_e2e_survivor_lazy_load.py
"""
import importlib.util
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

from _e2e_common import CLERK_MOCK, start_server, launch_browser

_spec = importlib.util.spec_from_file_location(
    "surv", pathlib.Path(__file__).with_name("test_e2e_survivor_dynamic_weeks.py"))
S = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S)
B = S.B

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


OBSERVER = """
window.__svStates=[];
document.addEventListener('DOMContentLoaded',()=>{
  const mount=document.getElementById('survivorMount'); if(!mount) return;
  new MutationObserver(()=>{
    const h=mount.innerHTML;
    const kind=h.includes('Loading Survivor')?'loading':(h.includes('Survivor couldn')?'error':(mount.dataset.mounted?'shell':'other'));
    const last=window.__svStates[window.__svStates.length-1];
    if(!last||last.kind!==kind){
      const w=document.getElementById('topWidgetsRow');
      window.__svStates.push({kind, topRowDisplay:w?getComputedStyle(w).display:null, css:!!document.querySelector('link[data-pg-lazy=survivor]')&&[...document.styleSheets].some(s=>s.href&&s.href.includes('survivor.min.css'))});
    }
  }).observe(mount,{childList:true,subtree:true,attributes:true});
});
"""


def new_page(p, port, width=1360):
    browser = launch_browser(p)
    ctx = browser.new_context(viewport={"width": width, "height": 900})
    page = ctx.new_page()
    reqs, errors = [], []
    page.on("request", lambda r: reqs.append(r.url))
    page.on("pageerror", lambda e: errors.append(str(e)))
    ctx.add_init_script(CLERK_MOCK)
    ctx.add_init_script(OBSERVER)
    page.route("**/api/**", B.make_handler([], json.loads(json.dumps(S.PRIVATE))))
    page.goto(f"http://localhost:{port}/app/index.html")
    page.wait_for_timeout(1800)
    return browser, ctx, page, reqs, errors


def sv(reqs, port):
    return [u.split(f":{port}", 1)[1].split("?")[0] for u in reqs if f":{port}" in u and "survivor" in u.lower() and "/api/" not in u]


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            # ---------------- first open
            browser, ctx, page, reqs, errors = new_page(p, port)
            check("before the tab opens: no Survivor file requested", not sv(reqs, port))
            page.evaluate("switchTab('survivor')")
            page.wait_for_function("typeof renderSurvivorShell==='function' && !!document.getElementById('survivorMount').dataset.mounted", timeout=15000)
            page.wait_for_timeout(600)
            states = page.evaluate("window.__svStates")
            kinds = [x["kind"] for x in states]
            print(f"   mount states observed: {kinds}; requests: {sv(reqs, port)}")
            check("a loading card is shown first, then the real Survivor shell", kinds[:1] == ["loading"] and "shell" in kinds)
            check("the ATS Viewing bar was already hidden while loading (no flash before the Survivor CSS arrives)", states[0]["topRowDisplay"] == "none")
            order = sv(reqs, port)
            check("all three Survivor files were fetched (css, core module, classic script)",
                  {"/app/dist/survivor.min.css", "/app/dist/survivor-core.min.js", "/app/dist/survivor.min.js"} <= set(order))
            check("the classic Survivor script is fetched AFTER the core module (it needs the core at load)",
                  order.index("/app/dist/survivor.min.js") > order.index("/app/dist/survivor-core.min.js"))
            check("core is ready and the shell really rendered (pool picker present)", page.evaluate("!!(window.PickGaugeSurvivorCore&&window.PickGaugeSurvivorCore.score)") and page.is_visible("#survivorPoolSelect"))
            check("the Survivor stylesheet is applied (card chrome from survivor CSS)", page.evaluate("getComputedStyle(document.querySelector('.survivor-context-card')).borderTopWidth!=='0px'"))
            n_before = len(sv(reqs, port))
            page.evaluate("switchTab('snapshot')"); page.wait_for_timeout(200)
            page.evaluate("switchTab('survivor')"); page.wait_for_timeout(500)
            check("re-opening the tab fetches nothing more", len(sv(reqs, port)) == n_before)
            check("the tab renders immediately the second time (shell, no loading card)", page.is_visible("#survivorPoolSelect") and "Loading Survivor" not in page.inner_text("#survivorMount"))

            # still works: load data, make a pick, sync re-render
            page.evaluate(S_LOAD, [S.season(), {}])
            page.wait_for_timeout(400)
            btn = page.locator(".survivor-summary-use")
            check("lazy-loaded Survivor is fully functional: the weekly Use button is offered", btn.count() == 1)
            btn.click(); page.wait_for_timeout(400)
            check("...and tapping it saves a pick", bool(page.evaluate("pgSurvivorActiveEntry().picks['5']")))
            page.evaluate("syncAll()"); page.wait_for_timeout(300)
            check("a sync re-render (syncAll) while on Survivor works after the lazy load", page.is_visible("#survivorPoolSelect"))
            check("no uncaught page errors (first open)", not errors)
            if errors:
                print("   errors:", errors[:3])
            ctx.close(); browser.close()

            # ---------------- warm on intent
            browser, ctx, page, reqs, errors = new_page(p, port)
            page.hover("nav.tabs button[data-tab='survivor']")
            page.wait_for_function("typeof renderSurvivorShell==='function'", timeout=15000)
            check("hovering the Survivor nav button warms the load (before any click)", not page.is_visible("#tab-survivor.active") and bool(sv(reqs, port)))
            page.click("nav.tabs button[data-tab='survivor']"); page.wait_for_timeout(500)
            check("clicking afterwards renders the shell at once", page.is_visible("#survivorPoolSelect"))
            check("no uncaught page errors (warm)", not errors)
            ctx.close(); browser.close()

            # ---------------- survivor.min.js blocked -> error card -> retry works
            browser, ctx, page, reqs, errors = new_page(p, port)
            page.route("**/survivor.min.js", lambda r: r.abort())
            page.evaluate("switchTab('survivor')")
            page.wait_for_selector("[data-survivor-load-retry]", timeout=15000)
            check("blocked script: a clear error card with Try again", "Survivor couldn" in page.inner_text("#survivorMount") and page.is_visible("[data-survivor-load-retry]"))
            check("blocked script: the rest of the app still works", page.evaluate("typeof switchTab==='function'"))
            page.unroute("**/survivor.min.js")
            page.click("[data-survivor-load-retry]")
            page.wait_for_selector("#survivorPoolSelect", timeout=15000)
            check("Try again recovers on the same page (failure wasn't cached)", page.is_visible("#survivorPoolSelect"))
            ctx.close(); browser.close()

            # ---------------- core module blocked -> error card -> retry uses a fresh URL
            browser, ctx, page, reqs, errors = new_page(p, port)
            page.route("**/survivor-core.min.js*", lambda r: r.abort())
            page.evaluate("switchTab('survivor')")
            page.wait_for_selector("[data-survivor-load-retry]", timeout=15000)
            check("blocked core module: error card with Try again", page.is_visible("[data-survivor-load-retry]"))
            page.unroute("**/survivor-core.min.js*")
            page.click("[data-survivor-load-retry]")
            page.wait_for_selector("#survivorPoolSelect", timeout=15000)
            check("blocked core module: Try again recovers (the browser remembers a failed import per URL, so the retry asks for a fresh one)",
                  page.is_visible("#survivorPoolSelect") and any("survivor-core.min.js?retry=" in u for u in reqs))
            ctx.close(); browser.close()

            # ---------------- phone
            browser, ctx, page, reqs, errors = new_page(p, port, width=390)
            page.evaluate("switchTab('survivor')")
            page.wait_for_function("typeof renderSurvivorShell==='function' && !!document.getElementById('survivorMount').dataset.mounted", timeout=15000)
            page.wait_for_timeout(500)
            check("phone: lazy load works at 390px and overflows nothing", page.is_visible("#survivorPoolSelect") and page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth") <= 0)
            check("no uncaught page errors (phone)", not errors)
            ctx.close(); browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


S_LOAD = """([data,picks])=>{ const pid=pgSurvivorPoolId(); data.poolId=pid; pgSurvivorRuntime.errorByPool[pid]=null; pgSurvivorRuntime.dataByPool[pid]=data;
   const u=pgSurvivorUi(); u.weekByPool[pid]=5; pgSurvivorSaveUi(u); const e=pgSurvivorActiveEntry(); e.picks=picks; pgSurvivorComputePlans(); renderSurvivorShell(); }"""

if __name__ == "__main__":
    main()
