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
    page.evaluate("switchTab('settings')")
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/settings_collapsed.png", full_page=False)
    print("saved /tmp/settings_collapsed.png")
    key_input_visible = page.is_visible("#apiKeyInput")
    print("apiKeyInput visible before expanding (should be False):", key_input_visible)
    page.click("#tab-settings .pred-panel summary")
    page.wait_for_timeout(200)
    page.screenshot(path="/tmp/settings_expanded.png", full_page=False)
    print("saved /tmp/settings_expanded.png")
    key_input_visible_after = page.is_visible("#apiKeyInput")
    print("apiKeyInput visible after expanding (should be True):", key_input_visible_after)
    print("errors:", errors or "(none)")
    browser.close()
