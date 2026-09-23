"""
Real-browser E2E for the compacted All Games phone rows (Sept 23, 2026).

Before: ~327px per game at 390px wide (pick buttons stacked ABOVE the
recommendation, 56px logo badges flanking them, a separate full-width
"Why X?" row). After: recommendation card first (tier, kickoff, Why?,
recommended side, metrics), then both teams side by side as the pick action.

Measures real rendered heights (not CSS reasoning) and confirms desktop is
untouched. Reuses the fully-mocked /api/* harness from
test_e2e_batch1_workflow.py.

Run with:

    python3 tests/test_e2e_mobile_compact_rows.py
"""
import importlib.util
import json
import pathlib
import sys
import urllib.parse

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


LOGO = "data:image/svg+xml," + urllib.parse.quote(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#2563EB"/></svg>')
PRIVATE = {"entries": [{"id": "e1", "name": "Entry 1", "picks": {}}], "history": [], "pools": [], "_rev": 1,
           "enabledSystems": ["teamrank", "sagpred", "sag", "wayward"]}
ROWS = "#tab-board .board tbody tr[data-key]"


def with_logos(page):
    # Real logos come from CFBD identity (/api/fetch_teams); give every game
    # a logo so the measurement reflects a real slate, not a logo-less one.
    page.evaluate(f"""()=>{{ const L={json.dumps(LOGO)};
      applyTeamLogos=function(){{ games.forEach(g=>{{g.awayLogo=L;g.homeLogo=L;}}); return 0; }};
      applyTeamLogos(); renderBoard(); }}""")
    page.wait_for_timeout(300)


def heights(page):
    return page.eval_on_selector_all(ROWS, "els=>els.map(e=>Math.round(e.getBoundingClientRect().height))")


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            for width in (390, 360):
                browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": width, "height": 844})
                page.evaluate("switchTab('pickboard')")
                page.wait_for_timeout(300)
                with_logos(page)
                hs = heights(page)
                avg = sum(hs) / max(1, len(hs))
                print(f"   {width}px row heights: {hs}")
                check(f"{width}px: all 12 games render as rows", len(hs) == 12)
                check(f"{width}px: average unpicked game row is under 200px (was ~327px)", avg < 200)
                check(f"{width}px: no horizontal overflow", page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth") <= 0)

                first = page.locator(ROWS).first
                card_box = first.locator(".mobile-decision-cell").bounding_box()
                away_box = first.locator("[data-pickteam][data-side='away']").bounding_box()
                home_box = first.locator("[data-pickteam][data-side='home']").bounding_box()
                check(f"{width}px: recommendation card sits ABOVE the pick buttons", card_box["y"] + card_box["height"] <= away_box["y"] + 1)
                check(f"{width}px: away and home pick buttons share one line", abs(away_box["y"] - home_box["y"]) < 2 and away_box["x"] < home_box["x"])
                check(f"{width}px: pick buttons are at least 40px tall (touch target)", away_box["height"] >= 40 and home_box["height"] >= 40)
                check(f"{width}px: flanking 56px logo badges are gone on phones", not first.locator("td.away-logo").is_visible() and not first.locator("td.home-logo").is_visible())
                check(f"{width}px: team logos move inside the pick buttons", first.locator(".teampick .teampick-logo").first.is_visible())
                check(f"{width}px: the old separate full-width 'Why X?' row is hidden", not first.locator("td.board-cfbd-toggle-cell").is_visible())
                check(f"{width}px: kickoff shows inside the recommendation card", bool(first.locator(".mobile-decision-meta").inner_text().strip()))

                rec_side = page.evaluate("(()=>{const g=games.find(x=>x.key===document.querySelector('%s').dataset.key); return edgeOf(g).side;})()" % ROWS)
                check(f"{width}px: exactly the recommended side's button carries .rec",
                      first.locator(f"[data-pickteam][data-side='{rec_side}'].rec").count() == 1 and first.locator(".teampick.rec").count() == 1)

                # Why? in the card expands/collapses the analysis row.
                first.locator(".mobile-decision-why").click()
                page.wait_for_timeout(300)
                check(f"{width}px: 'Why?' in the card opens the analysis row", page.locator(".board tr.board-detail-row .board-mobile-why").first.is_visible())
                page.locator(ROWS).first.locator(".mobile-decision-why").click()
                page.wait_for_timeout(300)
                check(f"{width}px: tapping it again closes the analysis row", page.locator(".board tr.board-detail-row").count() == 0)

                # Picking from the side-by-side buttons still works.
                page.locator(ROWS).first.locator(f"[data-pickteam][data-side='{rec_side}']").click()
                page.wait_for_timeout(300)
                row = page.locator(ROWS).first
                check(f"{width}px: tapping the recommended button saves the pick", page.evaluate("Object.keys(activeEntry().picks).length") == 1
                      and row.locator(f"[data-pickteam][data-side='{rec_side}'].active").count() == 1)
                check(f"{width}px: picked row shows the 'Your line' editor below the buttons", row.locator(".pick-line-edit").is_visible())
                check(f"{width}px: no page errors", not errors)
                if width == 390:
                    page.screenshot(path="/tmp/e2e_mobile_compact_rows.png", full_page=False)
                browser.close()

            # Desktop is untouched.
            browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": 1360, "height": 900})
            page.evaluate("switchTab('pickboard')")
            page.wait_for_timeout(300)
            with_logos(page)
            first = page.locator(ROWS).first
            check("desktop: recommendation card and in-card Why? stay hidden", not first.locator(".mobile-decision-cell").is_visible()
                  and not first.locator(".mobile-decision-why").is_visible())
            check("desktop: table cells (Market, Model #, Cover %, Edge) still visible", all(first.locator(sel).is_visible() for sel in ("td.veg-cell", "td.myn-cell", "td.prob-cell", "td.edge")))
            check("desktop: inline 'Matchup breakdown' toggle still visible", first.locator(".board-cfbd-toggle-inline").is_visible())
            rec = first.locator(".teampick.rec")
            border = rec.evaluate("e=>getComputedStyle(e).boxShadow") if rec.count() else "none"
            check("desktop: .rec adds no styling (no inset outline)", border in ("none", ""))
            hs = heights(page)
            check("desktop: rows stay compact table rows (all under 160px)", hs and max(hs) < 160)
            check("desktop: no page errors", not errors)
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
