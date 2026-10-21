"""
Real-browser E2E for self-hosted fonts and their fallbacks (Oct 21, 2026).

1. Normal load: Inter, Oswald and JetBrains Mono come from /fonts/*.woff2 on
   our own origin (no Google Fonts request), the body/heading/number text
   actually renders in them, and Inter 700/800/900 are real weights (the
   variable face covers 100-900), not browser-faked bold.
2. Fonts blocked (every /fonts/ request aborted, like a filtering work
   network): text falls back to a sans-serif, never the default serif.
3. In both cases, This Week, All Games, Results, Settings and Help fit the
   screen at 360px and 390px, and desktop at 1360px (same no-overflow check
   as test_e2e_phone_no_overflow.py), so the wider real bold weights and the
   fallback fonts don't break layouts.

Run with:

    python3 tests/test_e2e_fonts.py
"""
import importlib.util
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

from _e2e_common import start_server

_spec = importlib.util.spec_from_file_location(
    "overflow", pathlib.Path(__file__).with_name("test_e2e_phone_no_overflow.py"))
O = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(O)
B = O.B

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


TABS = ["snapshot", "board", "record", "settings", "help"]

# Width of a sample string in the element's own computed font vs. the same
# string in the browser's generic serif and sans-serif.
FONT_PROBE = """(sel)=>{ const el=document.querySelector(sel); if(!el) return null;
  const cs=getComputedStyle(el), c=document.createElement('canvas').getContext('2d'), s='Georgia Bulldogs -6.5 cover';
  const w=f=>{ c.font=`${cs.fontWeight} 20px ${f}`; return c.measureText(s).width; };
  return {family:cs.fontFamily, own:w(cs.fontFamily), serif:w('serif'), sans:w('sans-serif')}; }"""


def open_app(p, port, width, block_fonts=False):
    browser = B.launch_browser(p)
    page = browser.new_page(viewport={"width": width, "height": 900})
    font_reqs, errors = [], []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.on("request", lambda r: font_reqs.append(r.url) if ("/fonts/" in r.url or "fonts.g" in r.url) else None)
    page.add_init_script(B.CLERK_MOCK)
    page.route("**/api/**", B.make_handler([], json.loads(json.dumps(O.PRIVATE))))
    if block_fonts:
        page.route("**/fonts/*.woff2", lambda route: route.abort())
    page.goto(f"http://localhost:{port}/app/index.html")
    page.wait_for_function("() => (document.getElementById('refreshTime')||{}).textContent.indexOf('Loading')===-1", timeout=8000)
    page.wait_for_timeout(1200)
    page.evaluate(O.SEED_ATS)
    page.evaluate("document.fonts.ready")
    return browser, page, font_reqs, errors


def layouts_fit(page, width, label):
    for tab in TABS:
        page.evaluate(f"switchTab('{tab}')")
        page.wait_for_timeout(300)
        page.evaluate(O.OPEN_DETAILS)
        page.wait_for_timeout(150)
        r = page.evaluate(O.OVERFLOW)
        if r["bad"]:
            print(f"   {width}px {label} {tab}: {r['bad'][:5]}")
        check(f"{width}px {label}: {tab} fits the screen (no sideways scroll, nothing past the edge)",
              r["scrollWidth"] <= r["vw"] and not r["bad"])


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            # ---- 1. Normal load: self-hosted fonts, real weights.
            browser, page, font_reqs, errors = open_app(p, port, 390)
            check("no request goes to Google Fonts", not any("fonts.g" in u for u in font_reqs))
            check("Inter and Oswald woff2 files load from our own /fonts/",
                  any(u.endswith("/fonts/inter-latin-wght.woff2") for u in font_reqs)
                  and any(u.endswith("/fonts/oswald-latin-wght.woff2") for u in font_reqs))
            loaded = page.evaluate("""async()=>{ await document.fonts.ready;
                const want=['400 14px Inter','700 14px Inter','800 14px Inter','900 14px Inter','700 14px Oswald','700 14px "JetBrains Mono"'];
                await Promise.all(want.map(f=>document.fonts.load(f)));
                return Object.fromEntries(want.map(f=>[f,document.fonts.check(f)])); }""")
            print(f"   document.fonts.check: {loaded}")
            check("Inter 400/700/800/900, Oswald 700 and JetBrains Mono 700 are all available", all(loaded.values()))
            faces = page.evaluate("[...document.fonts].filter(f=>f.family.replace(/\"/g,'')==='Inter').map(f=>f.weight)")
            check("the Inter face is variable 100-900, so bold weights are real glyphs", "100 900" in faces)
            widths = page.evaluate("""()=>{ const c=document.createElement('canvas').getContext('2d');
                return [400,600,700,800,900].map(w=>{ c.font=`${w} 20px Inter`; return c.measureText('Georgia Bulldogs -6.5').width; }); }""")
            print(f"   Inter widths at 400/600/700/800/900: {[round(w, 1) for w in widths]}")
            check("each heavier Inter weight renders wider than the last (real 700/800/900, not one faked bold)",
                  all(b > a for a, b in zip(widths, widths[1:])))
            body = page.evaluate(FONT_PROBE, "body")
            check("body text uses the full Inter fallback stack", body["family"].startswith("Inter, system-ui, -apple-system"))
            check("Oswald headings use the condensed fallback stack",
                  page.evaluate("getComputedStyle(document.querySelector('.panel-title')).fontFamily").startswith('Oswald, "Avenir Next Condensed"'))
            check("no page errors (normal load)", not errors)
            browser.close()

            # ---- 2. Fonts blocked: sans-serif fallback, never serif.
            browser, page, font_reqs, errors = open_app(p, port, 390, block_fonts=True)
            failed = page.evaluate("[...document.fonts].filter(f=>f.family.replace(/\"/g,'')==='Inter'&&f.status==='loaded').length")
            check("with /fonts/ blocked, no Inter face loads (the fallback is really being exercised)", failed == 0)
            for sel, what in (("body", "body text"), (".panel-title", "Oswald heading"), (".snap-val", "monospace number")):
                pr = page.evaluate(FONT_PROBE, sel)
                print(f"   blocked {what}: {pr}")
                check(f"fonts blocked: {what} does not fall back to a serif",
                      pr and abs(pr["own"] - pr["serif"]) > 0.5)
            check("no page errors (fonts blocked)", not errors)
            browser.close()

            # ---- 3. Layouts fit with real weights and with fallbacks.
            for block in (False, True):
                label = "fallback fonts" if block else "web fonts"
                for width in (360, 390, 1360):
                    browser, page, _, errors = open_app(p, port, width, block_fonts=block)
                    layouts_fit(page, width, label)
                    check(f"{width}px {label}: no page errors", not errors)
                    browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
