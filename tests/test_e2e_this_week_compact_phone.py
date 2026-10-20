"""
Real-browser E2E for the compact This Week phone layout (Oct 20, 2026).

Before (390px, 12-game mocked slate with logos): This Week tab 3,300px,
each top-5 edge card 206px, each "Games to watch" row 227px (360px: 3,390px
tab, rows 227-261px). After: cards ~124px, rows ~105px, tab ~2,016px.

Checks the measured heights at 390px and 360px, that nothing is clipped,
that pick / shortlist / "Why this game?" still work on both the cards and
the rows, that the details hidden from the phone row (Market -> Model,
vs breakeven, Signal) are inside the "Why this game?" panel, that the pool
(CLV) variant still fits, and that desktop is unchanged. Reuses the fully
mocked /api/* harness from test_e2e_batch1_workflow.py.

Run with:

    python3 tests/test_e2e_this_week_compact_phone.py
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
CARDS = "#snapOppGrid .opp-card"
ROWS = "#snapTableBody tr[data-key]"

# Every interactive control in a row/card must sit fully inside its card.
CLIPPED_JS = """sel=>[...document.querySelectorAll(sel)].some(box=>{
  const b=box.getBoundingClientRect();
  return [...box.querySelectorAll('button')].filter(x=>x.offsetParent).some(x=>{
    const r=x.getBoundingClientRect(); return r.left<b.left-1||r.right>b.right+1; });
})"""


def open_this_week(p, port, width):
    browser, page, reqs, errors = B.open_app(p, port, json.loads(json.dumps(PRIVATE)), {"width": width, "height": 844})
    page.evaluate(f"""()=>{{ const L={json.dumps(LOGO)};
      applyTeamLogos=function(){{ games.forEach(g=>{{g.awayLogo=L;g.homeLogo=L;}}); return 0; }};
      applyTeamLogos(); switchTab('snapshot'); }}""")
    page.wait_for_timeout(400)
    return browser, page, errors


def measure(page):
    return page.evaluate(f"""()=>({{
      tab: Math.round(document.getElementById('tab-snapshot').getBoundingClientRect().height),
      cards: [...document.querySelectorAll('{CARDS}')].map(e=>Math.round(e.getBoundingClientRect().height)),
      rows: [...document.querySelectorAll('{ROWS}')].map(e=>Math.round(e.getBoundingClientRect().height)),
      pageOverflow: document.documentElement.scrollWidth-document.documentElement.clientWidth,
      tableOverflow: (()=>{{ const w=document.getElementById('snapTableBody').closest('table').parentElement; return w.scrollWidth-w.clientWidth; }})()
    }})""")


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            for width in (390, 360):
                browser, page, errors = open_this_week(p, port, width)
                m = measure(page)
                print(f"   {width}px: tab {m['tab']}px, cards {m['cards']}, rows {m['rows']}")
                check(f"{width}px: 5 top cards and 7 'Games to watch' rows render", len(m["cards"]) == 5 and len(m["rows"]) == 7)
                check(f"{width}px: every top card is under 140px (was 206px)", max(m["cards"]) < 140)
                check(f"{width}px: every 'Games to watch' row is under 120px (was 227-261px)", max(m["rows"]) < 120)
                check(f"{width}px: This Week tab is under 2,200px (was 3,300-3,390px)", m["tab"] < 2200)
                check(f"{width}px: no sideways page scroll", m["pageOverflow"] <= 0)
                check(f"{width}px: the rows' table does not scroll sideways", m["tableOverflow"] <= 0)
                check(f"{width}px: no button pokes outside its card or row", not page.evaluate(CLIPPED_JS, CARDS) and not page.evaluate(CLIPPED_JS, ROWS))

                # Card: side+line, Edge, Cover % and the three controls are all visible.
                card = page.locator(CARDS).first
                check(f"{width}px: card shows side + line, Edge and Cover %", card.locator(".opp-team").is_visible()
                      and card.locator(".edge-hero").is_visible() and "%" in card.locator(".opp-stats").inner_text())
                check(f"{width}px: card keeps pick, shortlist and 'Why this game?'", all(card.locator(s).is_visible() for s in
                      ("[data-snap-pick]", "[data-snap-shortlist]", "[data-snap-jump]")))
                team_box = card.locator(".opp-team").bounding_box()
                tier_box = card.locator(".opp-tier").bounding_box()
                check(f"{width}px: tier label shares the team line", abs((team_box["y"] + team_box["height"] / 2) - (tier_box["y"] + tier_box["height"] / 2)) < 6)

                # Row: one tight card -- recommended side, Edge, Cover %, controls.
                row = page.locator(ROWS).first
                key = row.get_attribute("data-key")
                check(f"{width}px: row shows the recommended side and line", row.locator(".bet-line").is_visible())
                check(f"{width}px: row shows Edge and Cover %", row.locator("td[data-label='Raw edge']").is_visible() and row.locator("td[data-label='Cover %'] .cover-val").is_visible())
                check(f"{width}px: Market -> Model, breakeven note and Signal are folded away in the row",
                      not row.locator("td[data-label='Market → Model']").is_visible() and not row.locator("td[data-label='Signal']").is_visible()
                      and not row.locator(".raw-edge").is_visible())
                why = row.locator(".snap-why-mobile")
                check(f"{width}px: row has a visible 'Why this game?' button (chevron hidden)", why.is_visible() and why.inner_text().strip() == "Why this game?"
                      and not row.locator(".expand-btn").is_visible())
                pick_box = row.locator("[data-snap-pick]").bounding_box()
                flag_box = row.locator("[data-snap-shortlist]").bounding_box()
                check(f"{width}px: row pick and shortlist share one line, 40px+ tall", abs(pick_box["y"] - flag_box["y"]) < 2
                      and pick_box["height"] >= 40 and flag_box["height"] >= 40 and why.bounding_box()["height"] >= 40)

                # Why this game? opens the detail with the folded-away cells inside it.
                why.click()
                page.wait_for_timeout(250)
                detail = page.locator(f"#snapTableBody tr.detail-row[data-detail-for='{key}']")
                mobile = detail.locator(".snap-detail-mobile")
                check(f"{width}px: 'Why this game?' opens the detail panel", detail.count() == 1 and detail.is_visible())
                check(f"{width}px: detail shows Market -> Model, Cover % vs breakeven and Signal", mobile.is_visible()
                      and mobile.locator(".mkt-model").is_visible() and mobile.locator(".raw-edge").is_visible()
                      and "agree" in mobile.inner_text())
                row = page.locator(f"{ROWS}[data-key='{key}']")
                check(f"{width}px: the button now reads 'Hide details'", row.locator(".snap-why-mobile").inner_text().strip() == "Hide details"
                      and row.locator(".snap-why-mobile").get_attribute("aria-expanded") == "true")
                check(f"{width}px: no sideways scroll with the detail open", measure(page)["pageOverflow"] <= 0)
                row.locator(".snap-why-mobile").click()
                page.wait_for_timeout(250)
                check(f"{width}px: tapping it again closes the detail", page.locator("#snapTableBody tr.detail-row").count() == 0)

                # Pick + shortlist from a row.
                page.locator(f"{ROWS}[data-key='{key}'] [data-snap-pick]").click()
                page.wait_for_timeout(250)
                check(f"{width}px: row pick button saves the pick", page.evaluate(f"!!activeEntry().picks[{json.dumps(key)}]")
                      and page.locator(f"{ROWS}[data-key='{key}']").get_attribute("class") == "picked")
                page.locator(f"{ROWS}[data-key='{key}'] [data-snap-shortlist]").click()
                page.wait_for_timeout(250)
                check(f"{width}px: row shortlist button flags the game", page.evaluate(f"isShortlisted({json.dumps(key)})")
                      and "active" in page.locator(f"{ROWS}[data-key='{key}'] [data-snap-shortlist]").get_attribute("class"))

                # Pick + shortlist + Why from a top card.
                card = page.locator(CARDS).first
                card_key = card.locator("[data-snap-pick]").get_attribute("data-snap-pick")
                card.locator("[data-snap-pick]").click()
                page.wait_for_timeout(250)
                check(f"{width}px: card 'Add pick' saves the pick", page.evaluate(f"!!activeEntry().picks[{json.dumps(card_key)}]")
                      and "Picked" in page.locator(CARDS).first.locator("[data-snap-pick]").inner_text())
                page.locator(CARDS).first.locator("[data-snap-shortlist]").click()
                page.wait_for_timeout(250)
                check(f"{width}px: card shortlist flags the game", page.evaluate(f"isShortlisted({json.dumps(card_key)})"))
                page.locator(CARDS).first.locator("[data-snap-jump]").click()
                page.wait_for_timeout(400)
                check(f"{width}px: card 'Why this game?' opens the game on All Games", page.is_visible("#tab-board")
                      and page.locator(f"#tab-board tr[data-key='{card_key}']").count() >= 1)

                # Pool mode adds a CLV cell; the row must still fit.
                page.evaluate("""()=>{ const keys=games.map(g=>g.key);
                  games.forEach(g=>{ if(g.vegas!=null){ g.lockedLine=g.vegas+0.5; g.liveVegas=g.vegas; } });
                  state.pools=[{id:'pt',name:'Test pool',entries:[{id:'pe',name:'Entry',picks:{}}],pickLimit:7}];
                  state.activeContext='pt'; switchTab('snapshot'); }""")
                page.wait_for_timeout(400)
                pm = measure(page)
                has_clv = page.locator(f"{ROWS} td[data-label='CLV']").count() > 0
                print(f"   {width}px pool: rows {pm['rows']}")
                check(f"{width}px pool: rows carry a visible CLV cell", has_clv and page.locator(f"{ROWS} td[data-label='CLV']").first.is_visible())
                check(f"{width}px pool: rows stay under 160px with nothing clipped", pm["rows"] and max(pm["rows"]) < 160
                      and pm["tableOverflow"] <= 0 and pm["pageOverflow"] <= 0 and not page.evaluate(CLIPPED_JS, ROWS))
                check(f"{width}px: no page errors", not errors)
                if width == 390:
                    page.screenshot(path="/tmp/e2e_this_week_compact_phone.png", full_page=True)
                browser.close()

            # Desktop is unchanged.
            browser, page, errors = open_this_week(p, port, 1360)
            m = measure(page)
            print(f"   desktop: tab {m['tab']}px, cards {m['cards']}, rows {m['rows']}")
            row = page.locator(ROWS).first
            check("desktop: rows stay one-line table rows (all under 80px)", m["rows"] and max(m["rows"]) < 80)
            check("desktop: Market -> Model and Signal columns still show", row.locator("td[data-label='Market → Model']").is_visible()
                  and row.locator("td[data-label='Signal']").is_visible())
            check("desktop: chevron expand stays, phone 'Why this game?' button hidden", row.locator(".expand-btn").is_visible()
                  and not row.locator(".snap-why-mobile").is_visible())
            card = page.locator(CARDS).first
            check("desktop: cards keep the edge bar and stacked layout", card.locator(".edge-bar-track").is_visible()
                  and card.locator(".opp-tier").bounding_box()["y"] < card.locator(".opp-team").bounding_box()["y"])
            row.locator(".expand-btn").click()
            page.wait_for_timeout(250)
            check("desktop: chevron opens the detail; the phone-only summary stays hidden",
                  page.locator("#snapTableBody tr.detail-row").count() == 1 and not page.locator(".snap-detail-mobile").first.is_visible())
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
