"""
Real-browser E2E for the asset build + lazy pdf.js (Sept 2026).

  * index.html pulls exactly: HTML, ONE built stylesheet, ONE built script --
    nothing from app/js, app/data, app/css, and nothing Survivor (lazy; see
    test_e2e_survivor_lazy_load.py).
  * pdf.js (320KB) is NOT fetched on page load; opening a PDF file picker
    warms it; a real PDF then parses end to end through the self-hosted
    worker; a blocked load fails with the clear message and can be retried.
  * The source map is served so DevTools shows real file names.

Every /api/* call is mocked (harness from test_e2e_batch1_workflow.py).

Run with:

    python3 tests/test_e2e_bundle_and_lazy_pdf.py
"""
import base64
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


PRIVATE = {"entries": [{"id": "e1", "name": "E", "picks": {}}], "history": [], "pools": [], "_rev": 1,
           "enabledSystems": ["teamrank", "sagpred", "sag", "wayward"]}


def tiny_pdf(text="Hello PickGauge"):
    """A minimal, valid one-page PDF with correct xref offsets."""
    stream = f"BT /F1 18 Tf 72 720 Td ({text}) Tj ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = "%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out.encode()))
        out += f"{i} 0 obj\n{o}\nendobj\n"
    xref = len(out.encode())
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n"
    out += "".join(f"{off:010d} 00000 n \n" for off in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return out.encode()


EXTRACT = """async(b64)=>{ const bin=atob(b64); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
  const file=new File([u],'t.pdf',{type:'application/pdf'});
  try{ const lines=await extractPdfTextLines(file); return {ok:true, text:JSON.stringify(lines)}; }
  catch(e){ return {ok:false, message:e.message}; } }"""


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser = launch_browser(p)
            ctx = browser.new_context(viewport={"width": 1360, "height": 900})
            page = ctx.new_page()
            reqs, errors = [], []
            page.on("request", lambda r: reqs.append(r.url))
            page.on("pageerror", lambda e: errors.append(str(e)))
            ctx.add_init_script(CLERK_MOCK)
            page.route("**/api/**", B.make_handler([], json.loads(json.dumps(PRIVATE))))
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(2500)
            local = [u.split(f":{port}", 1)[1].split("?")[0] for u in reqs if f":{port}" in u and "/api/" not in u]

            check("loads exactly one built stylesheet (Survivor's is lazy)", local.count("/app/dist/app.min.css") == 1)
            check("loads exactly one built classic script", local.count("/app/dist/app.min.js") == 1)
            stray = [u for u in local if u.startswith(("/app/js/", "/app/data/", "/app/css/"))]
            check("no individual source files are requested anymore (was 30 scripts + 2 stylesheets)", not stray)
            check("Survivor's files are NOT requested on page load (lazy: survivor.min.js/css, survivor-core.min.js)",
                  not any("survivor" in u for u in local))
            print(f"   static requests on load: {len(local)} -> {sorted(set(local))[:8]}")
            check("page makes < 12 static requests in total", len(local) < 12)
            check("Survivor code is not defined until the tab opens", page.evaluate("typeof renderSurvivorShell==='undefined' && !window.PickGaugeSurvivorCore"))
            check("app booted (switchTab works, This Week rendered)", page.evaluate("typeof switchTab==='function'") and page.is_visible("#tab-snapshot"))

            check("pdf.js is NOT fetched on page load", not any("pdf.min.js" in u or "pdf.worker" in u for u in reqs))
            check("window.pdfjsLib is not defined before anyone needs it", page.evaluate("typeof window.pdfjsLib")== "undefined")

            # Warm on opening a PDF file picker.
            page.evaluate("document.getElementById('poolSettingsWeekFile').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))")
            page.wait_for_function("typeof window.pdfjsLib!=='undefined'", timeout=15000)
            check("opening a PDF file picker warms pdf.js (loaded before any file is chosen)", page.evaluate("typeof window.pdfjsLib")== "object")
            check("pdf.min.js was fetched exactly once", sum("pdf.min.js" in u for u in reqs) == 1)

            # A real PDF parses end to end through the self-hosted worker.
            res = page.evaluate(EXTRACT, base64.b64encode(tiny_pdf()).decode())
            print(f"   extractPdfTextLines -> {res}")
            check("a real PDF is parsed end to end (text extracted)", res.get("ok") and "Hello PickGauge" in res.get("text", ""))
            check("the self-hosted worker was used (/app/vendor/pdfjs/pdf.worker.min.js)", any("pdf.worker.min.js" in u for u in reqs))
            check("worker path is the self-hosted one", page.evaluate("pdfjsLib.GlobalWorkerOptions.workerSrc") == "/app/vendor/pdfjs/pdf.worker.min.js")

            # Source map is served.
            check("source map is served (DevTools shows real file names)", page.request.get(f"http://localhost:{port}/app/dist/app.min.js.map").ok)
            check("no uncaught page errors", not errors)
            ctx.close()

            # ---------------- Blocked load -> clear message -> retry works.
            ctx2 = browser.new_context(viewport={"width": 1360, "height": 900})
            page2 = ctx2.new_page()
            errors2 = []
            page2.on("pageerror", lambda e: errors2.append(str(e)))
            ctx2.add_init_script(CLERK_MOCK)
            page2.route("**/api/**", B.make_handler([], json.loads(json.dumps(PRIVATE))))
            page2.route("**/vendor/pdfjs/pdf.min.js", lambda r: r.abort())
            page2.goto(f"http://localhost:{port}/app/index.html")
            page2.wait_for_timeout(2000)
            res = page2.evaluate(EXTRACT, base64.b64encode(tiny_pdf()).decode())
            check("pdf.js blocked (offline/ad-blocker): the clear 'PDF reader didn't load' message", (not res["ok"]) and res["message"] == "PDF reader didn't load — check your connection and try again.")
            page2.unroute("**/vendor/pdfjs/pdf.min.js")
            res = page2.evaluate(EXTRACT, base64.b64encode(tiny_pdf("Second try")).decode())
            check("after the network recovers, the SAME page retries and parses the PDF (failure wasn't cached)", res.get("ok") and "Second try" in res.get("text", ""))
            check("no uncaught page errors (blocked-load page)", not errors2)
            ctx2.close()
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
