"""
Real-browser E2E: Survivor History tab -> "Entry correlation" (Oct 1, 2026).

Builds several entries on the synthetic 8-week SEC season (Weeks 1-4 complete,
current week 5) and checks the rendered similarity grids against an
INDEPENDENT recomputation in Python, plus the callouts, shared pending picks
and portfolio odds (hand-computed from the season's win probabilities).

Run with:

    python3 tests/test_e2e_survivor_entry_correlation.py
"""
import importlib.util
import itertools
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


# Entry picks, week -> team (1-pick pool). Win probabilities in the synthetic
# season: Alabama .60  Georgia .65  LSU .70  Texas .75  Tennessee .80  Ole Miss .85
ENTRIES = [
    ("My Entry", {1: "Alabama", 2: "Georgia", 3: "LSU", 4: "Texas", 5: "Tennessee", 6: "Ole Miss"}),
    ("Entry 2", {1: "Alabama", 2: "Georgia", 3: "LSU", 4: "Texas", 5: "Ole Miss", 6: "Tennessee"}),
    ("Entry 3", {1: "Georgia", 2: "Alabama", 3: "Texas", 4: "LSU", 5: "Tennessee", 6: "Ole Miss"}),
    ("Entry 4", {1: "Texas", 2: "LSU", 3: "Alabama", 4: "Georgia"}),
]


def jaccard_metrics(a, b):
    """Independent recomputation of the two similarity numbers."""
    common = sorted(set(a) & set(b))
    if not common:
        return None
    inter = sum(1 for w in common if a[w] == b[w])
    union = sum(1 if a[w] == b[w] else 2 for w in common)
    ta, tb = {a[w] for w in common}, {b[w] for w in common}
    return inter / union, len(ta & tb) / len(ta | tb)


SETUP = """([data, entries])=>{
  const pid=pgSurvivorPoolId(); data.poolId=pid; pgSurvivorRuntime.errorByPool[pid]=null; pgSurvivorRuntime.dataByPool[pid]=data;
  const pool=pgSurvivorPoolState(); pool.entries=entries.map(([name,picks],i)=>{
    const e=pgSurvivorDefaultEntry(name); e.picks={}; Object.entries(picks).forEach(([w,t])=>{e.picks[String(w)]=t;}); return e; });
  const ui=pgSurvivorUi(); ui.weekByPool[pid]=5; ui.view='history'; ui.viewChosen=true; ui.entryByPool[pid]=pool.entries[0].id; pgSurvivorSaveUi(ui);
  pgSurvivorComputePlans(); renderSurvivorShell();
}"""


def matrix(page, kind):
    rows = page.evaluate("""(kind)=>[...document.querySelectorAll('#survivorEntryCorrelation table.survivor-corr-'+kind+' tbody tr')].map(tr=>
        [tr.querySelector('th').textContent.trim(), ...[...tr.querySelectorAll('td')].map(td=>td.textContent.trim())])""", kind)
    return rows


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
            page.evaluate(SETUP, [S.season(), [[n, {str(k): v for k, v in pk.items()}] for n, pk in ENTRIES]])
            page.wait_for_timeout(500)
            check("the Entry correlation section is on the History tab", page.is_visible("#survivorEntryCorrelation"))
            order = page.evaluate("[...document.querySelectorAll('#survivor-view-history .survivor-history-section h3')].map(h=>h.textContent.trim())")
            print(f"   History sections: {order}")
            check("it sits between Portfolio Strategy and Entry comparison (before the Pick grid)",
                  order.index("Entry correlation") < order.index("Entry comparison") < order.index("Pick grid"))

            names = [n for n, _ in ENTRIES]
            for kind, idx in (("samePick", 0), ("sameTeams", 1)):
                rows = matrix(page, kind)
                ok, bad = True, []
                for i, (ni, pi) in enumerate(ENTRIES):
                    for j, (nj, pj) in enumerate(ENTRIES):
                        cell = rows[i][1 + j]
                        if i == j:
                            ok &= cell == "—"
                            continue
                        exp = jaccard_metrics(pi, pj)
                        want = "—" if exp is None else f"{round(exp[idx] * 100)}%"
                        if cell != want:
                            ok = False
                            bad.append((ni, nj, cell, want))
                print(f"   {kind}: " + " | ".join(r[0] + " " + ",".join(r[1:]) for r in rows))
                check(f"'{kind}' grid matches an independent recomputation for all {len(ENTRIES) * (len(ENTRIES) - 1)} cells", ok)
                if bad:
                    print("   mismatches:", bad[:4])
                check(f"'{kind}' grid has one row per entry, in order", [r[0] for r in rows] == names)

            # Spot checks from hand math
            sp = dict(((r[0]), r[1:]) for r in matrix(page, "samePick"))
            st = dict(((r[0]), r[1:]) for r in matrix(page, "sameTeams"))
            check("My Entry vs Entry 2: 4 identical picks of 8 distinct = 50% same picks, 100% same teams", sp["My Entry"][1] == "50%" and st["My Entry"][1] == "100%")
            check("My Entry vs Entry 3: only 2 identical picks of 10 = 20%, but the same 6 teams = 100%", sp["My Entry"][2] == "20%" and st["My Entry"][2] == "100%")
            check("My Entry vs Entry 4: 0% same picks, 100% same teams (they used the same four teams in different weeks)", sp["My Entry"][3] == "0%" and st["My Entry"][3] == "100%")

            tip = page.get_attribute("table.survivor-corr-samePick tbody tr:nth-child(1) td.survivor-corr-cell >> nth=0", "title")
            check("hovering a cell lists the identical picks (W1 Alabama ... W4 Texas)", tip and "W1 Alabama" in tip and "W4 Texas" in tip and "4 identical picks" in tip)
            tip2 = page.get_attribute("table.survivor-corr-sameTeams tbody tr:nth-child(1) td.survivor-corr-cell >> nth=0", "title")
            check("the team grid's tooltip names the shared teams", tip2 and "Alabama" in tip2 and "Ole Miss" in tip2)
            bg = page.evaluate("[...document.querySelectorAll('table.survivor-corr-samePick td.survivor-corr-cell')].map(td=>getComputedStyle(td).backgroundColor)")
            check("cells are shaded (warmer = more alike), not blank", all(b not in ("rgba(0, 0, 0, 0)", "transparent") for b in bg))

            # Callouts
            txt = page.inner_text("#survivorEntryCorrelation .survivor-corr-callouts").lower()  # labels are shown in capitals
            pairs = {(a, b): jaccard_metrics(dict(ENTRIES)[a], dict(ENTRIES)[b]) for a, b in itertools.combinations(names, 2)}
            alike = max(pairs, key=lambda k: (pairs[k][0], pairs[k][1]))
            diff = min(pairs, key=lambda k: (pairs[k][0], pairs[k][1]))
            check(f"'Most alike' names the right pair ({alike[0]} & {alike[1]})", f"{alike[0]} & {alike[1]}".lower() in txt.split("most different")[0])
            check(f"'Most different' names the right pair ({diff[0]} & {diff[1]})", f"{diff[0]} & {diff[1]}".lower() in txt.split("most different")[1])
            check("'Used by every entry' lists the four teams all entries burned", all(t.lower() in txt.split("used by every entry")[1] for t in ("Alabama", "Georgia", "LSU", "Texas")))

            # Shared pending picks
            ex = page.eval_on_selector_all("#survivorEntryCorrelation .survivor-exposure-table tbody tr", "els=>els.map(e=>[...e.querySelectorAll('td')].map(t=>t.textContent.trim().replace(/\\s+/g,' ')))")
            print(f"   shared pending picks: {ex}")
            check("two shared pending picks are listed (W5 Tennessee and W6 Ole Miss, each on My Entry + Entry 3)", len(ex) == 2)
            w5 = next(r for r in ex if r[0] == "W5")
            check("W5 Tennessee: entries 'My Entry, Entry 3', win 80%, '2 of 4 out', 20% chance",
                  "Tennessee" in w5[1] and w5[2] == "My Entry, Entry 3" and w5[3] == "80%" and "2 of 4 out" in w5[4] and "20% chance" in w5[4])
            w6 = next(r for r in ex if r[0] == "W6")
            check("W6 Ole Miss: win 85%, 15% chance", "Ole Miss" in w6[1] and w6[3] == "85%" and "15% chance" in w6[4])

            # Portfolio odds (hand math in the test docstring)
            kp = page.eval_on_selector_all("#survivorEntryCorrelation .survivor-corr-kpi", "els=>els.map(e=>[e.querySelector('small').textContent.trim(), e.querySelector('b').textContent.trim()])")
            kp = dict(kp)
            print(f"   portfolio odds: {kp}")
            check("P(at least one entry survives) = 89.8% (1 - 0.32 x 0.32 for independent paths... shared games counted once)", kp["At least one entry survives"] == "89.8%")
            check("P(all entries survive) = 46.2%", kp["All entries survive"] == "46.2%")
            check("expected entries alive = 2.0 of 3", kp["Expected entries alive"] == "2.0 of 3")
            check("P(every entry out) = 10.2%", kp["Every entry out"] == "10.2%")
            note = page.inner_text("#survivorEntryCorrelation .survivor-corr-block:last-child")
            check("Entry 4 (no pending picks saved) is reported as not counted, not silently ignored", "Entry 4" in note and "no pending picks" in note)
            check("no uncaught page errors (desktop)", not errors)
            page.screenshot(path="/tmp/e2e_corr_desktop.png", full_page=False)
            page.locator("#survivorEntryCorrelation").screenshot(path="/tmp/e2e_corr_section.png")

            # An entry with no weeks in common with another: dash, not a fake number
            page.evaluate("""()=>{ const pool=pgSurvivorPoolState(); const e=pgSurvivorDefaultEntry('Entry 5'); e.picks={'5':'Ole Miss','6':'Tennessee'}; pool.entries.push(e); renderSurvivorShell(); }""")
            page.wait_for_timeout(300)
            r4 = {r[0]: r[1:] for r in matrix(page, "samePick")}
            check("Entry 5 has no week in common with Entry 4 -> '—' (no fake 0%)", r4["Entry 4"][4] == "—" and r4["Entry 5"][3] == "—")
            check("'Used by every entry' now says no team (Entry 5 shares none with the others' full set)",
                  "no team yet" in page.inner_text("#survivorEntryCorrelation .survivor-corr-callouts").lower())

            # One entry -> no section
            page.evaluate("""()=>{ const pool=pgSurvivorPoolState(); pool.entries=[pool.entries[0]]; renderSurvivorShell(); }""")
            page.wait_for_timeout(300)
            check("with a single entry the correlation section is not shown", page.locator("#survivorEntryCorrelation").count() == 0)
            browser.close()

            # ---------------- phone
            browser, page, errors = open_app(p, port, 390)
            page.evaluate(SETUP, [S.season(), [[n, {str(k): v for k, v in pk.items()}] for n, pk in ENTRIES]])
            page.wait_for_timeout(500)
            check("phone: no horizontal overflow of the page", page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth") <= 0)
            check("phone: the similarity grids scroll inside their own box instead of squeezing", page.evaluate("[...document.querySelectorAll('#survivorEntryCorrelation .survivor-corr-scroll')].every(e=>e.scrollWidth>=e.clientWidth)"))
            check("phone: with 4 entries the similarity grids and the shared-picks table all fit without scrolling sideways",
                  page.evaluate("[...document.querySelectorAll('#survivorEntryCorrelation .survivor-corr-scroll')].every(e=>e.scrollWidth<=e.clientWidth+1)"))
            check("phone: the shared-picks table keeps Week, Pick, Entries and 'If it loses' (Win % is folded into the last column)",
                  page.evaluate("[...document.querySelectorAll('#survivorEntryCorrelation .survivor-exposure-table thead th')].filter(th=>th.offsetParent!==null).map(th=>th.textContent.trim()).join('|')") == "Week|Pick|Entries on it|If it loses")
            check("phone: callouts, grids, shared picks and odds are all present", page.locator("#survivorEntryCorrelation .survivor-corr-callout").count() == 4
                  and page.locator("#survivorEntryCorrelation table.survivor-corr-table").count() == 2 and page.locator("#survivorEntryCorrelation .survivor-corr-kpi").count() == 4)
            page.locator("#survivorEntryCorrelation").scroll_into_view_if_needed()
            page.screenshot(path="/tmp/e2e_corr_phone.png", full_page=False)
            check("no uncaught page errors (phone)", not errors)
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
