import http.server, socketserver, threading, time, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path("/home/claude/pg")
CLERK_MOCK = """
window.Clerk = {
  user: { id: 'test_user', primaryEmailAddress: { emailAddress: 'test@example.com' } },
  session: { getToken: async () => 'fake.jwt.token' },
  load: async () => {}, mountSignIn: () => {}, addListener: () => {}, signOut: async () => {},
};
window.__internal_ClerkUICtor = {};
"""
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, f, *a): pass
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
time.sleep(0.2)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1360, "height": 900})
    page.add_init_script(CLERK_MOCK)
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{port}/app/")
    page.wait_for_selector("#appRoot", state="attached", timeout=5000)
    page.wait_for_function("document.getElementById('appRoot').style.display !== 'none'", timeout=5000)
    page.wait_for_timeout(300)
    page.evaluate("""
      () => {
        isDemo = false;
        const gs = [
          {key:'g0', away:'Liberty Flames', home:'James Madison Dukes', commence:'2026-09-05T17:00:00Z', vegas:-6.0},
          {key:'g1', away:'UMass', home:'Rutgers', commence:'2026-09-05T17:00:00Z', vegas:-30.5},
        ];
        games = gs;
        state.pools = [{id:'p1', name:'Test Pool', pickLimit:7, weekLabel:'Week 1', games: gs.map(g=>({...g,line:g.vegas})), entries:[{id:'e1', name:'Me', picks:{}}], activeEntryId:'e1', history:[]}];
        state.activeContext = 'p1';
        state.enabledSystems = ['bp','comp'];
        buildGames(); applyTeamLogos(); migrateGameKeys(); sortGames();
        state.inputs = {};
        games.forEach(g => { state.inputs[g.key] = [g.vegas - 4.9, g.vegas - 4.5]; });
        renderBoard(); renderSnapshot();
      }
    """)
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/snapshot_quicklook.png", full_page=False)
    print("saved /tmp/snapshot_quicklook.png")
    # Verify Signal header/cell alignment now matches
    align = page.evaluate("""
      () => {
        const th = document.querySelector('#snapTableHead .signal-th');
        const td = document.querySelector('.signal-td');
        return { th: th && getComputedStyle(th).textAlign, td: td && getComputedStyle(td).textAlign };
      }
    """)
    print("signal alignment:", align)
    # Verify bet-line and matchup-sub share the same left edge now
    edges = page.evaluate("""
      () => {
        const line = document.querySelector('.bet-line');
        const sub = document.querySelector('.matchup-sub');
        return { lineLeft: line && line.getBoundingClientRect().left, subLeft: sub && sub.getBoundingClientRect().left };
      }
    """)
    print("bet-line vs matchup-sub left edge:", edges)
    logo = page.evaluate("""
      () => {
        const img = document.querySelector('.bet-logo');
        return img ? { w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height } : null;
      }
    """)
    print("bet-logo size:", logo)
    print("errors:", errors or "(none)")
    browser.close()
