"""
Real-browser E2E test: the "Compare Picks" export buttons (My Picks →
Compare picks) actually produce real, openable files -- not just a click
handler that doesn't throw. Seeds two real pool entries with real picks
(same page.evaluate()+save() pattern as test_e2e_pools_hides_shared_widgets.py),
opens Compare Picks, clicks "Save Image" and captures the real download,
then clicks "Save PDF" and validates the downloaded bytes with poppler's
pdfinfo/pdftoppm (not just "a file appeared") -- confirming the hand-rolled
single-image PDF writer in app/js/picks.js (pgBuildImagePdfBlob) produces a
structurally valid PDF a real reader can open and rasterize, since a
malformed xref table is the classic way this class of hand-written PDF
silently breaks in one reader while looking fine in another.

Run with:

    python3 tests/test_e2e_compare_picks_export.py
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

from _e2e_common import CLERK_MOCK, start_server, launch_browser

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser = launch_browser(p)
            page = browser.new_page(viewport={"width": 1360, "height": 900})
            page.add_init_script(CLERK_MOCK)
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(1200)

            # Two real pool entries with real, DIFFERENT picks on one shared
            # game (so the "highlighted agreement" path is exercised too via
            # a second, agreeing game) plus a distinct game each -- three
            # rows, two columns, matching the shape collectPickRecords()/
            # clusterGames()/renderCompareTable() already expect.
            page.evaluate(
                """
              () => {
                isDemo = false;
                state.pools = [{
                  id:'p1', name:'Test Pool', source:'splash', pickLimit:7, weekLabel:'Week 1',
                  games:[
                    {away:'Colorado',home:'Georgia Tech',line:6.5},
                    {away:'UAB',home:'Illinois',line:-27.5},
                    {away:'UCLA',home:'California',line:-1.5}
                  ],
                  entries:[
                    {id:'e1', name:'Entry 1', picks:{
                      'Colorado @ Georgia Tech':{team:'Colorado', line:6.5, matchup:'Colorado @ Georgia Tech'},
                      'UAB @ Illinois':{team:'Illinois', line:-27.5, matchup:'UAB @ Illinois'}
                    }},
                    {id:'e2', name:'Entry 2', picks:{
                      'Colorado @ Georgia Tech':{team:'Colorado', line:6.5, matchup:'Colorado @ Georgia Tech'},
                      'UCLA @ California':{team:'UCLA', line:-1.5, matchup:'UCLA @ California'}
                    }}
                  ],
                  activeEntryId:'e1', history:[]
                }];
                state.activeContext='p1';
                save();
              }
            """
            )

            page.click('button[data-tab="pickboard"]')
            page.wait_for_timeout(200)
            page.click('[data-pickboard-view="picks"]')
            page.wait_for_timeout(300)

            check(
                "Compare Picks card is visible with 2 real entries",
                page.evaluate("document.getElementById('compareCard').style.display") != "none",
            )
            check(
                "Compare table actually rendered 3 game rows",
                page.evaluate("document.querySelectorAll('#compareTable tbody tr').length") == 3,
            )
            check(
                "Shared Colorado pick is highlighted as agreement in the on-screen table",
                page.evaluate("document.querySelectorAll('#compareTable .cmp-agree').length") == 2,
            )

            # Compare Picks lives inside a <details>; open it so the export
            # buttons are actually interactable, same as a real user would.
            page.evaluate("document.getElementById('compareCard').open = true")
            page.wait_for_timeout(100)

            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)

                with page.expect_download() as dl_info:
                    page.click("#compareExportImageBtn")
                png_download = dl_info.value
                png_path = tmp_path / "compare.png"
                png_download.save_as(str(png_path))
                check("Save Image produced a real PNG file", png_path.exists() and png_path.stat().st_size > 5000)
                check(
                    "Downloaded file has a real PNG signature",
                    png_path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n",
                )

                page.wait_for_timeout(200)
                with page.expect_download() as pdf_dl_info:
                    page.click("#compareExportPdfBtn")
                pdf_download = pdf_dl_info.value
                pdf_path = tmp_path / "compare.pdf"
                pdf_download.save_as(str(pdf_path))
                check("Save PDF produced a real PDF file", pdf_path.exists() and pdf_path.stat().st_size > 5000)
                check("Downloaded file has a real %PDF header", pdf_path.read_bytes()[:5] == b"%PDF-")

                # The real structural test: does poppler's own pdfinfo parse
                # the xref table this hand-written writer produced, and does
                # pdftoppm actually rasterize page 1 without erroring? A
                # broken byte offset in the xref table is exactly the kind of
                # bug that can silently produce a file some viewers tolerate
                # (Chrome's built-in one is very forgiving) and others reject.
                info = subprocess.run(
                    ["pdfinfo", str(pdf_path)], capture_output=True, text=True
                )
                check("pdfinfo parses the generated PDF without error", info.returncode == 0)
                import re
                pages_match = re.search(r"Pages:\s+(\d+)", info.stdout)
                check("pdfinfo reports exactly 1 page", bool(pages_match) and pages_match.group(1) == "1")

                raster = subprocess.run(
                    ["pdftoppm", "-png", "-r", "72", str(pdf_path), str(tmp_path / "raster")],
                    capture_output=True, text=True,
                )
                raster_files = list(tmp_path.glob("raster*.png"))
                check("pdftoppm rasterized page 1 without error", raster.returncode == 0 and len(raster_files) == 1)
                if raster_files:
                    check("Rasterized page is a non-trivial size (real content, not a blank stub)", raster_files[0].stat().st_size > 20000)

            browser.close()
    finally:
        httpd.shutdown()

    print(f"\n{total - len(failures)}/{total} checks passed.")
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)


if __name__ == "__main__":
    main()
