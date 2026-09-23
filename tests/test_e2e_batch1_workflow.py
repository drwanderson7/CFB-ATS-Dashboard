"""
Real-browser E2E for the Sept 23, 2026 workflow-simplification batch:

  1. Lines + model predictions load automatically on sign-in when the
     shared copy is stale (no Refresh lines / Load models clicks needed).
  2. Finished weeks move to Results automatically (no manual Archive step),
     with a dismissible notice.
  3. This Week's "Games to watch" list no longer repeats the top-5 cards,
     and the page has exactly one All Games link.
  4. All Games shows ONE pool prompt (the Market view card), not three.
  5. Confidence/Survivor no longer show the ATS Viewing bar / ATS pool
     banner (Confidence used to route "Use your pool's lines" to ATS Pools).

Every /api/* call is mocked at the network layer (page.route), so this runs
the real app code end to end against realistic payloads with no backend.

Run with:

    python3 tests/test_e2e_batch1_workflow.py
"""
import datetime
import json
import sys

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


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


NOW = datetime.datetime.now(datetime.timezone.utc)
MATCHUPS = [
    ("Houston", "Arizona State", -2.0, -8.2), ("Iowa State", "Kansas", -4.0, 1.5),
    ("Wisconsin", "Oregon", 3.5, -0.6), ("Texas", "Oklahoma", 6.5, 10.2),
    ("Tennessee", "Florida", -14.5, -18.0), ("Ole Miss", "Kentucky", -17.0, -19.9),
    ("Michigan", "Penn State", -10.0, -7.2), ("USC", "Utah", -6.5, -3.9),
    ("Georgia", "Alabama", -6.5, -4.1), ("Clemson", "Florida State", -14.5, -16.8),
    ("Baylor", "Cincinnati", 3.5, 2.0), ("SMU", "Wake Forest", -2.5, -3.7),
]


def slate(start):
    games, preds = [], []
    for i, (a, h, v, m) in enumerate(MATCHUPS):
        c = iso(start + datetime.timedelta(hours=i))
        games.append({"id": f"ev{i}", "away": a, "home": h, "commence": c,
                      "books": {"draftkings": v, "fanduel": v}, "vegas": v, "book": "consensus"})
        preds.append({"road": a, "home": h, "homeVegas": v,
                      "systems": {k: round(m + d, 1) for k, d in
                                  [("teamrank", 0.2), ("sagpred", -0.3), ("sag", 0.1), ("wayward", 0.0), ("dokter", 0.4)]}})
    return games, preds


UPCOMING = NOW + datetime.timedelta(days=2)
GAMES, PREDS = slate(UPCOMING)
STALE = iso(NOW - datetime.timedelta(hours=3))
FRESH = iso(NOW)
LAST_WEEK_KICK = iso(NOW - datetime.timedelta(days=9))


def make_handler(requests, private_state):
    shared_state = {"lastGames": GAMES, "lastRefresh": STALE, "booksSeen": ["draftkings", "fanduel"],
                    "predictions": PREDS, "predMeta": {"fetchedAt": STALE, "count": len(PREDS)},
                    "sharedUpdatedAt": STALE, "preKickLines": {}, "sharedPools": []}

    def handle(route):
        req = route.request
        url = req.url
        requests.append((req.method, url.split("/api/")[1].split("?")[0], url))
        if "/api/state" in url and req.method == "GET" and "scope=shared" in url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"state": shared_state}))
        if "/api/state" in url and req.method == "GET":
            return route.fulfill(status=200, content_type="application/json",
                                 body=json.dumps({"state": private_state, "revision": 1}))
        if "/api/state" in url and req.method == "POST":
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "revision": 2}))
        # Like production, the fetch endpoints persist into the shared tier
        # themselves, so the client's follow-up shared pull sees fresh data.
        if "/api/fetch_odds" in url:
            shared_state.update({"lastRefresh": FRESH, "sharedUpdatedAt": FRESH})
            return route.fulfill(status=200, content_type="application/json",
                                 headers={"x-requests-remaining": "480"},
                                 body=json.dumps({"games": GAMES, "lastRefresh": FRESH, "booksSeen": ["draftkings", "fanduel"],
                                                  "sharedPersisted": True}))
        if "/api/fetch_predictions" in url:
            shared_state.update({"predMeta": {"fetchedAt": FRESH, "count": len(PREDS)}, "sharedUpdatedAt": FRESH})
            return route.fulfill(status=200, content_type="application/json",
                                 body=json.dumps({"games": PREDS, "fetchedAt": FRESH, "count": len(PREDS), "sharedPersisted": True}))
        return route.fulfill(status=200, content_type="application/json", body="{}")
    return handle


def open_app(p, port, private_state, viewport):
    browser = launch_browser(p)
    page = browser.new_page(viewport=viewport)
    requests, errors = [], []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.add_init_script(CLERK_MOCK)
    page.route("**/api/**", make_handler(requests, private_state))
    page.goto(f"http://localhost:{port}/app/index.html")
    page.wait_for_function("() => (document.getElementById('refreshTime')||{}).textContent.indexOf('Loading')===-1", timeout=8000)
    page.wait_for_timeout(1500)
    return browser, page, requests, errors


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            # ---------------- Scenario A: stale shared data, finished last-week pick
            private_state = {
                "entries": [{"id": "e1", "name": "Entry 1", "picks": {
                    "baylor@tcu": {"side": "home", "team": "TCU", "line": -3.5, "matchup": "Baylor @ TCU",
                                   "commenceAtPick": LAST_WEEK_KICK}}}],
                "history": [], "pools": [], "_rev": 1, "enabledSystems": ["teamrank", "sagpred", "sag", "wayward"],
            }
            browser, page, reqs, errors = open_app(p, port, private_state, {"width": 1360, "height": 900})
            paths = [r[1] for r in reqs]
            check("stale shared lines -> /api/fetch_odds requested automatically on sign-in (no click)", "fetch_odds" in paths)
            check("stale shared predictions -> /api/fetch_predictions requested automatically (no click)", "fetch_predictions" in paths)
            check("fetch_odds requested exactly once on startup (no duplicate auto-load)", paths.count("fetch_odds") == 1)
            check("automatic load does not bounce the user to Settings", page.is_visible("#tab-snapshot"))
            cards = page.locator("#snapOppGrid .opp-card, #snapOppGrid [class*='opp-card']").count()
            check("This Week ranks real edges after the automatic load (top cards rendered)", page.locator("#snapOppGrid [data-snap-pick]").count() >= 3)

            # Auto-archive
            check("finished last-week pick triggers the auto-archive notice", page.is_visible("#autoArchiveNotice"))
            notice = page.inner_text("#autoArchiveNotice") if page.is_visible("#autoArchiveNotice") else ""
            check("notice says the picks moved to Results", "moved to Results" in notice)
            page.screenshot(path="/tmp/e2e_batch1_notice.png", clip={"x": 0, "y": 0, "width": 1360, "height": 260})
            hist = page.evaluate("state.history.length")
            check("the pick landed in state.history (where grade_picks.py grades from)", hist == 1)
            check("the board's entry is now empty for the new week", page.evaluate("Object.keys(state.entries[0].picks).length") == 0)
            check("archived record is flagged autoArchived", page.evaluate("!!(state.history[0]&&state.history[0].autoArchived)"))
            page.wait_for_timeout(2500)  # private sync is debounced ~1.5s
            posted = [r for r in reqs if r[0] == "POST" and r[1] == "state"]
            check("the archive was synced to the account (state POST fired)", len(posted) >= 1)
            page.click("#autoArchiveNotice [data-auto-archive='results']")
            page.wait_for_timeout(500)
            check("'View Results' on the notice opens Results showing the archived week",
                  page.is_visible("#tab-record") and "Week" in page.inner_text("#tab-record"))

            # This Week de-duplication + single All Games link
            page.evaluate("switchTab('snapshot')")
            page.wait_for_timeout(400)
            top = page.eval_on_selector_all("#snapOppGrid [data-snap-pick]", "els=>els.map(e=>e.dataset.snapPick)")
            rows = page.eval_on_selector_all("#snapTableBody tr[data-key]", "els=>els.map(e=>e.dataset.key)")
            check("'Rest of slate' list is non-empty on a 12-game slate", len(rows) > 0)
            check("'Rest of slate' list does not repeat any top-card game", len(set(top) & set(rows)) == 0)
            page.click('#snapFilterPills [data-filter="strong"]')
            page.wait_for_timeout(300)
            strong_rows = page.eval_on_selector_all("#snapTableBody tr[data-key]", "els=>els.map(e=>e.dataset.key)")
            check("an explicit filter (Strong) still includes top-card games", len(set(top) & set(strong_rows)) > 0)
            page.click('#snapFilterPills [data-filter="all"]')
            page.wait_for_timeout(300)
            all_games_links = page.locator("#tab-snapshot button:has-text('Open All Games')").count()
            check("This Week has exactly one 'Open All Games' link", all_games_links == 1)
            check("old 'Want to compare every game?' card is gone", page.locator(".full-board-cta").count() == 0)
            check("old ranking footnote is gone", page.locator("#snapMethodology").count() == 0)
            page.screenshot(path="/tmp/e2e_batch1_thisweek.png", full_page=True)

            # All Games: one pool prompt
            page.evaluate("switchTab('pickboard')")
            page.wait_for_timeout(400)
            check("All Games: blue 'Use your pool's lines' banner no longer shows", not page.is_visible("#poolSetupCta"))
            wf = page.inner_text("#pickBoardWorkflow") if page.is_visible("#pickBoardWorkflow") else ""
            check("All Games: Market view card carries first-time pool discovery", "Playing in a pool?" in wf and "Set up a pool" in wf)
            page.screenshot(path="/tmp/e2e_batch1_allgames.png", full_page=False)
            page.click("#pickBoardWorkflow [data-pickboard-next='pools']")
            page.wait_for_timeout(400)
            check("Market view card's 'Set up a pool' opens the Pools subview", page.is_visible("#tab-pools"))

            # Confidence / Survivor: no ATS chrome
            for tab in ("confidence", "survivor"):
                page.evaluate(f"switchTab('{tab}')")
                page.wait_for_timeout(500)
                check(f"{tab}: ATS Viewing bar hidden", not page.is_visible("#contextBar"))
                check(f"{tab}: ATS pool banner hidden", not page.is_visible("#poolSetupCta"))
                check(f"{tab}: ATS setup/demo notice hidden", not page.is_visible("#setupNotice"))
            page.evaluate("switchTab('snapshot')")
            page.wait_for_timeout(300)
            check("This Week: Viewing bar still shows (ATS tabs unaffected)", page.is_visible("#contextBar"))

            # Header refresh still works manually and is the quiet style
            cls = page.get_attribute("#refreshBtn", "class") or ""
            check("header Refresh uses the secondary header style", "header-refresh" in cls and "btn-go" not in cls)
            before = len([r for r in reqs if r[1] == "state" and r[0] == "GET"])
            page.click("#refreshBtn")
            page.wait_for_timeout(800)
            after = len([r for r in reqs if r[1] == "state" and r[0] == "GET"])
            check("manual Refresh still works (re-pulls the shared tier)", after > before)
            check("no uncaught page errors during the whole scenario", not errors)
            if errors:
                print("   page errors:", errors[:3])
            browser.close()

            # ---------------- Scenario B: fresh data -> no auto fetch, unfinished pick stays
            private_b = {
                "entries": [{"id": "e1", "name": "Entry 1", "picks": {
                    "houston@arizona state": {"side": "home", "team": "Arizona State", "line": -2.0,
                                              "matchup": "Houston @ Arizona State", "commenceAtPick": GAMES[0]["commence"]}}}],
                "history": [], "pools": [], "_rev": 1, "enabledSystems": ["teamrank", "sagpred", "sag", "wayward"],
            }
            browser = launch_browser(p)
            page = browser.new_page(viewport={"width": 390, "height": 844})
            reqs_b = []
            fresh_handler = make_handler(reqs_b, private_b)

            def fresh_route(route):
                u = route.request.url
                if "/api/state" in u and "scope=shared" in u:
                    st = {"lastGames": GAMES, "lastRefresh": FRESH, "booksSeen": ["draftkings"], "predictions": PREDS,
                          "predMeta": {"fetchedAt": FRESH, "count": len(PREDS)}, "sharedUpdatedAt": FRESH,
                          "preKickLines": {}, "sharedPools": []}
                    reqs_b.append(("GET", "state", u))
                    return route.fulfill(status=200, content_type="application/json", body=json.dumps({"state": st}))
                return fresh_handler(route)
            page.add_init_script(CLERK_MOCK)
            page.route("**/api/**", fresh_route)
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(2500)
            paths_b = [r[1] for r in reqs_b]
            check("fresh shared data -> no automatic fetch_odds call (quota untouched)", "fetch_odds" not in paths_b)
            check("fresh shared data -> no automatic fetch_predictions call", "fetch_predictions" not in paths_b)
            check("an upcoming (unplayed) pick is NOT auto-archived", page.evaluate("Object.keys(state.entries[0].picks).length") == 1
                  and not page.is_visible("#autoArchiveNotice"))
            overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check("mobile (390px): header/page has no horizontal overflow", overflow <= 0)
            page.screenshot(path="/tmp/e2e_batch1_mobile.png", full_page=False)
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
