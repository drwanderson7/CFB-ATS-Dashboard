"""Shared harness for the E2E Playwright test files (tests/test_e2e_*.py).

Not itself a test -- doesn't match test_all.sh's `test_*.py` glob (this
starts with an underscore, same convention as `_render_*.py` and
`_team_match_js_runner.mjs`: a helper other tests import/shell out to,
not a standalone check() emitter -- see scripts/test_all.sh's own header
comment for that convention).

Split out of the original single test_e2e_ui_behaviors.py (Sept 1, 2026,
TODO #26) when that ~740-line, 7-scenario file got broken into one
independent file per scenario -- see each test_e2e_*.py's own docstring
for which scenario it covers. This holds just the boilerplate every one
of them needs (Clerk mock, static-file HTTP handler, browser launch with
a system-Chromium fallback). Each test file still spins up its OWN
server + browser instance and tears it down itself -- this module only
removes the ~35 lines of literal duplicate setup code, not the
independence itself. That's the whole point of the split: a crash in one
file's Playwright calls can no longer abort or hide checks in another
file, the way one shared `main()` used to.
"""
import http.server
import socketserver
import threading
import time
import shutil
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

CLERK_MOCK = """
window.Clerk = {
  user: { id: 'test_user', primaryEmailAddress: { emailAddress: 'test@example.com' } },
  session: { getToken: async () => 'fake.jwt.token' },
  load: async () => {},
  mountSignIn: () => {},
  addListener: () => {},
  signOut: async () => {},
};
// bootstrap() also waits for this real Clerk global (see app/js/init.js --
// a real production bug fix: Clerk's UI components load as a separate
// bundle from window.Clerk itself, and without waiting for BOTH,
// mountSignIn() can throw "Clerk was not loaded with Ui components" on a
// genuine first-time visit). Every mock needs it defined too, or
// bootstrap() times out waiting for it and never shows appRoot.
window.__internal_ClerkUICtor = {};
"""


class _Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass


def start_server():
    """Starts a background static-file server rooted at the repo root on a
    free OS-assigned port (not a hardcoded one -- a leftover bound socket
    from an earlier run/process is a real way for a fixed port to break a
    re-run, and independent test files launching their own servers makes
    a collision more likely, not less, if they all picked the same fixed
    port). Returns (httpd, port); caller owns httpd.shutdown() via its own
    try/finally.
    """
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", 0), _Handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    time.sleep(0.3)
    return httpd, port


def launch_browser(playwright):
    """Launches Chromium, falling back to a system-installed binary if
    Playwright's own managed one isn't available in this environment
    (some development/review environments only have a system Chromium
    package)."""
    try:
        return playwright.chromium.launch()
    except Exception as first_error:
        system_chromium = (
            shutil.which("chromium")
            or shutil.which("chromium-browser")
            or shutil.which("google-chrome")
        )
        if not system_chromium:
            raise first_error
        return playwright.chromium.launch(executable_path=system_chromium)
