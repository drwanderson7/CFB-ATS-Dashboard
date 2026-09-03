"""
Real-browser E2E test for mobile UX regressions, at a representative
iPhone-width viewport with touch/mobile semantics enabled: hamburger
navigation, no document-level horizontal overflow, stacked pool import,
iOS-safe focus font sizes, modal fit/tap targets, Results filters, a
submitted entry with live CFBD scoring, the Sort & filter panel default
state, the Weekly Setup card's fully-hidden-when-complete behavior, and
the Matchup breakdown dropdown's position/width on mobile. Physical
Safari/Android signoff still belongs on the launch checklist -- this is
what can be verified automatically.

One of 7 files split out of the original test_e2e_ui_behaviors.py (Sept 1,
2026, TODO #26) -- see tests/_e2e_common.py for the shared harness, and
the other test_e2e_*.py files for the remaining scenarios. This is the
one file that stayed a single long sequential flow rather than splitting
further: the checks below build on each other's state within the SAME
page/session on purpose (e.g. the Weekly Setup card's "fully hidden while
complete" check deliberately runs right after My Picks left the active
tab on one of TABS_WITHOUT_SHARED_WIDGETS, and needs switchTab() to fire
a real re-render) -- splitting those into separate files would mean
re-deriving that sequential state each time instead of testing it, and
would multiply browser-launch overhead for no real independence gain
(unlike the other 6 scenarios, which genuinely don't depend on each
other's state at all). The TODO's actual goal -- one setup issue
elsewhere can't hide these checks, and vice versa -- is already achieved
by this file having its own server + browser session, separate from the
other 6.

Run with:

    python3 tests/test_e2e_mobile_ux.py
"""
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


def main():
    httpd, port = start_server()
    try:
        with sync_playwright() as p:
            browser = launch_browser(p)
            page = browser.new_page(
                viewport={"width": 390, "height": 844},
                is_mobile=True,
                has_touch=True,
            )
            page.add_init_script(CLERK_MOCK)
            page.goto(f"http://localhost:{port}/app/index.html")
            page.wait_for_timeout(1000)

            no_overflow = lambda: page.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth"
            )
            check("MOBILE: Snapshot has no document-level horizontal overflow at 390px",
                  no_overflow())
            check("MOBILE: hamburger is visible while the desktop tab row is collapsed",
                  page.is_visible("#navHamburger")
                  and not page.is_visible("nav.tabs"))

            page.click("#navHamburger")
            page.wait_for_timeout(100)
            check("MOBILE: hamburger opens the real navigation menu and updates ARIA state",
                  page.is_visible("nav.tabs")
                  and page.get_attribute("#navHamburger", "aria-expanded") == "true")
            page.click('button[data-tab="pools"]')
            page.wait_for_timeout(150)
            check("MOBILE: selecting a tab closes the hamburger menu and activates Pools",
                  not page.is_visible("nav.tabs")
                  and page.get_attribute("#navHamburger", "aria-expanded") == "false"
                  and page.is_visible("#tab-pools"))
            check("MOBILE: Pools remains free of document-level horizontal overflow",
                  no_overflow())

            import_rects = page.locator(".pool-import-grid > *").evaluate_all(
                "els => els.map(e => ({top:e.getBoundingClientRect().top,left:e.getBoundingClientRect().left}))"
            )
            check("MOBILE: the two pool-import methods stack vertically instead of becoming cramped half-width cards",
                  len(import_rects) >= 2 and import_rects[1]["top"] > import_rects[0]["top"])
            paste_font = page.locator("#poolsTopPasteText").evaluate(
                "e => parseFloat(getComputedStyle(e).fontSize)"
            )
            check("MOBILE: pool paste textarea uses a >=16px focus font to avoid iOS Safari auto-zoom",
                  paste_font >= 16)

            page.click("#poolsNewBtn")
            page.wait_for_timeout(150)
            # Sept 2, 2026: "+ New pool" now opens the step-by-step ATS
            # wizard (.pg-wizard-card), not the old .pg-dialog modal --
            # same mobile-fit/touch-target/font-size guarantees checked
            # against the new UI instead.
            wizard_box = page.locator(".pg-wizard-card").bounding_box()
            check("MOBILE: New Pool wizard stays fully inside the 390x844 viewport",
                  wizard_box is not None
                  and wizard_box["x"] >= 0
                  and wizard_box["x"] + wizard_box["width"] <= 390
                  and wizard_box["y"] >= 0)
            name_font = page.locator("#atsWizName").evaluate("e => parseFloat(getComputedStyle(e).fontSize)")
            check("MOBILE: wizard name input uses a >=16px focus font to avoid iOS Safari auto-zoom",
                  name_font >= 16)
            page.fill("#atsWizName", "Mobile Test Pool")
            page.wait_for_timeout(100)
            action_heights = page.locator(".pg-wizard-actions button").evaluate_all(
                "els => els.map(e => e.getBoundingClientRect().height)"
            )
            check("MOBILE: wizard action buttons provide >=44px touch targets",
                  bool(action_heights) and min(action_heights) >= 44)
            page.locator("#atsWizCancel").click()
            page.wait_for_timeout(80)

            # Seed canonical archived rows so Results controls exist with real
            # filter options rather than checking an empty-state shell.
            page.evaluate("""
              () => {
                state.activeContext='overall';
                state.history=[
                  {id:'m26',label:'2026 Week 1',closedAt:'2026-09-05T20:00:00Z',entries:[{entryId:'me1',name:'Mobile 2026',picks:[
                    {key:'a',team:'Alpha',matchup:'Beta @ Alpha',result:'W',side:'home',line:-3.5,cfbdSeason:2026,cfbdWeek:1,pickedEdgeAtPick:3.2,clv:1,coverProbabilityAtPick:.58,modelAgreementAtPick:{agree:8,total:10,pct:.8},keyTierAtPick:'major'}
                  ]}]},
                  {id:'m25',label:'2025 Week 4',closedAt:'2025-09-20T20:00:00Z',entries:[{entryId:'me2',name:'Mobile 2025',picks:[
                    {key:'b',team:'Gamma',matchup:'Gamma @ Delta',result:'L',side:'away',line:7,cfbdSeason:2025,cfbdWeek:4,pickedEdgeAtPick:2,clv:-.5,coverProbabilityAtPick:.54,modelAgreementAtPick:{agree:6,total:10,pct:.6},keyTierAtPick:'none'}
                  ]}]}
                ];
                renderRecord(); switchTab('record');
              }
            """)
            page.wait_for_timeout(100)
            filter_fonts = page.locator("#recordSeasonFilter, #recordWeekFilter").evaluate_all(
                "els => els.map(e => parseFloat(getComputedStyle(e).fontSize))"
            )
            check("MOBILE: Results filters stay visible, 16px+, and usable without page overflow",
                  page.is_visible("#recordSeasonFilter")
                  and page.is_visible("#recordWeekFilter")
                  and min(filter_fonts) >= 16
                  and no_overflow())
            page.select_option("#recordSeasonFilter", "2025")
            page.wait_for_timeout(80)
            check("MOBILE: Results season filtering remains functional after the responsive reflow",
                  "Mobile 2025" in page.inner_text("#recordBody")
                  and "Mobile 2026" not in page.inner_text(".picklist"))

            # Submitted + live is the densest My Picks state: it adds workflow
            # locking, a score/status pill, edge/cover stats, and disabled row
            # actions at once. Protect that exact combination on mobile.
            page.evaluate("""
              () => {
                state.activeContext='overall';
                buildGames();
                const e=state.entries[0];
                e.picks={};
                const g=games[0];
                e.picks[g.key]={team:g.away,line:g.vegas,matchup:`${g.away} @ ${g.home}`,side:'away',cfbdGameId:999,cfbdPickedTeamId:1};
                e.submittedAt='2026-08-19T20:00:00Z';
                cfbdScoreboard=[{id:999,status:'in_progress',period:3,clock:'06:22',awayTeam:{id:1,name:g.away,points:21},homeTeam:{id:2,name:g.home,points:17}}];
                renderEntries(); renderPicksDetail(); switchTab('picks');
              }
            """)
            page.wait_for_timeout(100)
            check("MOBILE: submitted-entry lock and live scoring both render in My Picks",
                  page.is_visible(".cfbd-game-status.live")
                  and "locked after submission" in page.inner_text("#picksDetail").lower())
            check("MOBILE: submitted entry row actions remain locked/disabled",
                  page.locator(".pr-actions .iconbtn:disabled").count() > 0)
            check("MOBILE: the densest submitted/live My Picks state has no document-level horizontal overflow",
                  no_overflow())

            # Real screenshot report: the toolbar above the game list (Weekly
            # Setup card, sort dropdown, two filter checkboxes, the legend,
            # "Load model predictions") stacked into ~9 persistent rows
            # before a single game was visible on a phone. Three fixes,
            # each verified here against the ACTUAL rendered DOM, not just
            # reasoned about:
            check("MOBILE: the Sort & filter panel is COLLAPSED by default at 390px (it stayed expanded/persistent before this fix -- the actual space complaint)",
                  page.evaluate("document.getElementById('boardSortFilterPanel').open") is False)

            # Weekly Setup card should disappear ENTIRELY (not just shrink to
            # a compact card) once every required item is genuinely done --
            # confirmed via a state deliberately shaped like the real
            # screenshot's bug (everything ok, but WOULD have carried a stale-
            # odds warning under the old logic).
            page.evaluate("""
              () => {
                state.activeContext='overall';
                // buildGames() derives isDemo from whether state.lastGames has
                // real data -- NOT from assigning isDemo directly, which it
                // would just overwrite -- so this seeds an actual (minimal,
                // realistic-shaped) live slate rather than relying on
                // whatever demo/earlier-test state happened to be sitting
                // around at this point in this sequential mobile flow.
                state.lastGames=[
                  {away:'Setup Away',home:'Setup Home',commence:new Date(Date.now()+2*24*60*60*1000).toISOString(),vegas:-3.5,book:'DK'}
                ];
                state.enabledSystems=[];
                state.predictions=[];
                state.lastRefresh=new Date(Date.now()-4*60*60*1000).toISOString(); // 4h old -> the exact warning that used to force the big card back
                buildGames();
                // The previous step (My Picks) left the active tab as one of
                // TABS_WITHOUT_SHARED_WIDGETS (board.js) -- the Context Bar
                // deliberately no-ops there (renderContextBar() early-
                // returns via sharedWidgetsHiddenOnCurrentTab()), so
                // #ctxLine2 would otherwise still show stale text from
                // whatever last rendered it. switchTab() is what actually
                // triggers a real re-render here, not renderContextAll()
                // alone.
                switchTab('board');
                renderContextAll();
              }
            """)
            page.wait_for_timeout(150)
            check("MOBILE: the Weekly Setup card is fully hidden once setup is genuinely complete, even with a stale-odds warning present (the real bug: this used to force the itemized checklist card back on screen)",
                  not page.is_visible("#setupNotice"))
            check("MOBILE: 'setup ✓' shows up in the Context Bar instead -- the ONLY remaining trace once the card itself disappears",
                  "setup" in page.inner_text("#ctxLine2").lower())

            # "Load model predictions": full button when genuinely nothing's
            # loaded, collapses to a quiet text link once it has.
            check("MOBILE: 'Load model predictions' shows the full actionable button when nothing's loaded yet this session",
                  "Load model predictions" in page.inner_text("#loadPredsControl"))
            page.evaluate("""
              () => {
                state.predMeta={fetchedAt:new Date().toISOString(), count:12};
                renderBoard();
              }
            """)
            page.wait_for_timeout(100)
            check("MOBILE: 'Load model predictions' collapses to a quiet 'reload' text link once predictions ARE already loaded, instead of staying a persistent full-width row with nothing left to do",
                  "reload" in page.inner_text("#loadPredsControl").lower()
                  and "⬇ Load model predictions" not in page.inner_text("#loadPredsControl"))
            # Edge Board's "▾ Matchup breakdown" dropdown (ratings + Matchup
            # Intelligence, board.js) -- a SEPARATE real bug from a SEPARATE
            # screenshot: added after this table's own mobile card-reflow,
            # and the reflow's broad ".board tr{display:grid;...}" rule
            # caught it with no placement rule for its plain <td>, crushing
            # it into an unreadable sliver via CSS Grid's auto-placement
            # default.
            page.evaluate("""
              () => {
                state.activeContext='overall';
                buildGames();
                const g=games[0];
                cfbdRatings=[
                  {team:g.away,core:{overall:12,throughWeek:1},sp:{rating:8.4,ranking:40},fpi:{fpi:5.1},elo:{elo:1550},srs:{rating:6.2,ranking:55}},
                  {team:g.home,core:{overall:18,throughWeek:1},sp:{rating:14.2,ranking:12},fpi:{fpi:11.3},elo:{elo:1700},srs:{rating:12.1,ranking:18}}
                ];
                cfbdAdvancedMeta={year:2026,excludeGarbageTime:true,classifications:['fbs','fcs'],fcsAvailable:true};
                cfbdAdvanced=[
                  {team:g.away,offense:{ppa:0.18,successRate:0.42,explosiveness:1.1,plays:68,rushingPlays:{successRate:0.40},passingPlays:{successRate:0.38},havoc:{total:0.12}},
                   defense:{ppa:0.10,successRate:0.36,explosiveness:1.0,rushingPlays:{successRate:0.33},passingPlays:{successRate:0.35},havoc:{total:0.15}}},
                  {team:g.home,offense:{ppa:0.29,successRate:0.50,explosiveness:1.3,plays:72,rushingPlays:{successRate:0.48},passingPlays:{successRate:0.45},havoc:{total:0.09}},
                   defense:{ppa:0.06,successRate:0.32,explosiveness:0.95,rushingPlays:{successRate:0.29},passingPlays:{successRate:0.31},havoc:{total:0.20}}}
                ];
                renderBoard(); switchTab('board');
              }
            """)
            page.wait_for_timeout(150)
            # The actual bug report: the toggle appeared right after the
            # matchup/kickoff line (row 1 of the mobile card), ABOVE the
            # Vegas/CLV/Model#/Cover% stats -- not after them, which is
            # where it was supposed to be. A real geometric position check,
            # not just "doesn't overflow" (which the earlier checks below
            # would pass either way, at either position).
            #
            # Scoped to .board-cfbd-toggle-cell specifically (not just
            # ".board-cfbd-toggle" -- as of Aug 21 there are TWO copies of
            # this button, an inline one next to the shortlist flag for
            # DESKTOP and this dedicated <td> for MOBILE, see that CSS
            # rule's own comment). ".first" alone would grab the inline
            # desktop copy instead (it comes first in DOM order), which is
            # display:none on this mobile viewport -- bounding_box() on a
            # hidden element returns None, not a wrong-but-truthy result,
            # so an unscoped locator here fails loudly rather than silently
            # testing the wrong element. Scoping to the cell that's
            # actually visible on mobile is the correct fix either way.
            toggle_top = page.locator(".board-cfbd-toggle-cell .board-cfbd-toggle").first.bounding_box()["y"]
            stats_bottom = page.locator(".prob-cell").first.bounding_box()
            stats_bottom = stats_bottom["y"] + stats_bottom["height"]
            check("MOBILE: the 'Matchup breakdown' toggle sits BELOW the Vegas/CLV/Model#/Cover% stats row, not above/within the matchup line",
                  toggle_top >= stats_bottom)
            page.locator(".board-cfbd-toggle-cell .board-cfbd-toggle").first.click()
            page.wait_for_timeout(150)
            check("MOBILE: expanding Edge Board's 'Matchup breakdown' causes no document-level horizontal overflow",
                  no_overflow())
            panel_box = page.locator(".board-detail-row .cfbd-matchup-panel").first.bounding_box()
            check("MOBILE: the expanded matchup panel is actually wide enough to read -- NOT crushed into the ~60px logo column the real bug put it in",
                  panel_box is not None and panel_box["width"] > 250)
            row_right_edges = page.locator(".board-detail-row .cfbd-matchup-row").evaluate_all(
                "els => els.map(e => e.getBoundingClientRect().right)"
            )
            check("MOBILE: every stat row inside the expanded panel stays within the viewport, not clipped off the right edge",
                  bool(row_right_edges) and max(row_right_edges) <= 390)

            check("MOBILE: no error boundary fired anywhere in the responsive acceptance flow",
                  not page.is_visible("#errorBoundary"))

            page.close()
            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
