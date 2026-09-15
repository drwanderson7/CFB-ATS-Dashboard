"""
Not a pytest/CI test -- a one-off Playwright render to visually verify
this session's pool-vs-market CLV strengthening: the Quick Look column
now orients an unpicked game's CLV to the model's recommended side
(colored, not raw/unsigned), and both the Quick Look column and the
detail panel now show the same ⚡ alignment badge the full Board tab
already had. Mocked Clerk session; a hand-built pool (not demo data,
since demo mode has no locked line / no CLV concept at all). Run
manually:

    python3 tests/_render_clv_callout.py
"""
from playwright.sync_api import sync_playwright
import pathlib, json

APP_PATH = pathlib.Path(__file__).resolve().parent.parent / "app" / "index.html"

CLERK_MOCK = """
window.Clerk = {
  user: { id: 'test_user', primaryEmailAddress: { emailAddress: 'test@example.com' } },
  session: { getToken: async () => 'fake.jwt.token' },
  load: async () => {},
  mountSignIn: () => {},
  addListener: () => {},
  signOut: async () => {},
};
"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1360, "height": 1200})
    page.add_init_script(CLERK_MOCK)

    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: console_errors.append(f"PAGE ERROR: {exc}"))

    page.goto(f"file://{APP_PATH}")
    page.wait_for_timeout(1000)

    # Build a pool with 3 games covering the three CLV cases we touched:
    #   1. "Aligned" game: unpicked, model still leans the same direction
    #      the market's already drifted -- new "recommended" kind + ⚡ badge.
    #   2. "Not aligned" game: unpicked, market moved but model doesn't
    #      agree with more room left -- oriented CLV, no ⚡.
    #   3. Picked game: unchanged code path, confirms no regression.
    page.evaluate("""
    () => {
      const poolId = 'test_pool_1';
      state.pools = [{
        id: poolId, name: 'Test Pool', weekLabel: 'Week 3', pickLimit: 7,
        activeEntryId: null,
        entries: [{id: 'e1', name: 'Entry 1', picks: {}}],
        history: [],
        games: [
          // Home favored -6 at lock, drifted to -9 live (market sliding
          // toward home). BP/Comp inputs average to -13 -- further in the
          // SAME direction -- so this should be "aligned".
          {away: 'Ball State', home: 'Toledo', commence: '2026-09-15T17:00:00Z', line: -6.0},
          // Home favored -6 at lock, drifted to -9 live, but BP/Comp
          // average to -7 -- back TOWARD where the market already was --
          // so this should NOT be aligned.
          {away: 'Akron', home: 'Ohio', commence: '2026-09-15T17:00:00Z', line: -6.0},
          // Same movement as game 1, but this one gets an actual pick.
          {away: 'Kent State', home: 'Buffalo', commence: '2026-09-15T20:00:00Z', line: -6.0},
        ],
      }];
      state.activeContext = poolId;
      state.enabledSystems = ['bp', 'comp'];

      const k1 = mkey('Ball State', 'Toledo');
      const k2 = mkey('Akron', 'Ohio');
      const k3 = mkey('Kent State', 'Buffalo');
      state.inputs[k1] = [-13, -13];
      state.inputs[k2] = [-7, -7];
      state.inputs[k3] = [-13, -13];

      // Live odds match, providing liveVegas for CLV + a lean.
      state.lastGames = [
        {away: 'Ball State', home: 'Toledo', commence: '2026-09-15T17:00:00Z', vegas: -9.0, id: 'evt1'},
        {away: 'Akron', home: 'Ohio', commence: '2026-09-15T17:00:00Z', vegas: -9.0, id: 'evt2'},
        {away: 'Kent State', home: 'Buffalo', commence: '2026-09-15T20:00:00Z', vegas: -9.0, id: 'evt3'},
      ];

      saveLocal();
      buildGames();
      const ent = activeEntries()[0];
      state.pools[0].activeEntryId = ent.id;
      ent.picks[k3] = {side: 'home', team: 'Buffalo', line: -9.0, matchup: 'Kent State @ Buffalo'};
      saveLocal();
      switchTab('snapshot');
    }
    """)
    page.wait_for_timeout(400)

    print("=== Console/page errors ===")
    for e in console_errors:
        print(" -", e)
    if not console_errors:
        print(" (none)")

    page.screenshot(path="/tmp/clv_quicklook.png", full_page=True)

    # Expand each row to see the detail panel's Signals column.
    page.evaluate("""
    () => {
      const k1 = mkey('Ball State', 'Toledo');
      const k2 = mkey('Akron', 'Ohio');
      const k3 = mkey('Kent State', 'Buffalo');
      [k1, k2, k3].forEach(k => snapExpandedKeys.add(k));
      renderSnapshot();
    }
    """)
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/clv_detail_panels.png", full_page=True)

    # Dump the actual rendered CLV column text + detail-panel signal lines
    # for a text-level sanity check alongside the screenshot.
    rows = page.evaluate("""
    () => {
      const out = [];
      document.querySelectorAll('#snapTableBody tr[data-key]').forEach(tr => {
        const key = tr.dataset.key;
        const clvCell = tr.querySelector('td[data-label="CLV"]');
        out.push({key, clvText: clvCell ? clvCell.textContent.trim() : null});
      });
      document.querySelectorAll('.detail-sig').forEach(el => {
        out.push({sigLine: el.textContent.trim()});
      });
      return out;
    }
    """)
    print("\n=== Rendered CLV cells + signal lines ===")
    print(json.dumps(rows, indent=2))

    browser.close()
