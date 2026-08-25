"""
Static check on vercel.json's security headers (X-Content-Type-Options,
Referrer-Policy, X-Frame-Options, Permissions-Policy, Content-Security-Policy,
Strict-Transport-Security).

WHY STATIC ONLY: these headers are applied by Vercel's routing/edge layer
based on this config file, not by any Python code this project controls
-- there's no way to exercise that layer from a local test the way the
rest of this suite exercises real app behavior (browser renders, mocked
HTTP responses, etc.). This is the same category of limitation as the
CAS/rate-limit Lua scripts only being provable against a faithful
simulation, not literally Upstash's engine (see test_rate_limits.py's own
docstring) -- except here there's no simulation possible at all, so this
just pins the config file itself: correct JSON shape, every header in
EXPECTED_HEADERS present, and the exact values this project decided on,
so a future edit can't silently drop or weaken one without this failing.

Also checks each header doesn't collide with anything an api/*.py
handler already sets explicitly via send_header() -- a header set by
vercel.json AND overridden by the function itself would mean this config
is silently not doing what it looks like it's doing.

Run with:
    python3 tests/test_vercel_headers.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(ROOT, "api")
VERCEL_JSON = os.path.join(ROOT, "vercel.json")

EXPECTED_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    # Built against Clerk's own documented CSP requirements (script-src/
    # connect-src need clerk.pickgauge.com + Cloudflare's bot/fraud-
    # protection hosts; worker-src needs 'self' blob: for the pdf.js
    # worker; style-src keeps 'unsafe-inline' because Clerk's own
    # components require it regardless of this app's inline style=
    # attributes; img-src stays broad https: since team logos come from
    # CFBD's dynamic response with no fixed CDN domain to pin to) --
    # added Aug 25 alongside externalizing the last inline <script> block
    # (app/js/main.js) and self-hosting pdf.js (app/vendor/pdfjs/), both
    # of which were blockers on a real script-src.
    "Content-Security-Policy": "default-src 'self'; script-src 'self' https://clerk.pickgauge.com https://challenges.cloudflare.com https://*.protect.clerk.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://clerk.pickgauge.com https://*.protect.clerk.com; worker-src 'self' blob:; frame-src https://challenges.cloudflare.com https://*.protect.clerk.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    # 2 years, includeSubDomains -- NOT preload. Vercel already forces
    # HTTPS for this deployment, so this is belt-and-suspenders against a
    # user's own bookmarked/typed http:// link rather than a load-bearing
    # protection. Deliberately not submitting to the HSTS preload list
    # (hstspreload.org) yet: that's a much bigger commitment (baked into
    # browsers themselves, slow and painful to undo if any subdomain ever
    # turns out to need plain HTTP) and should only happen after this
    # header's been live for a while with zero problems, not on day one.
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
}

failures = []
total = [0]


def check(name, cond):
    total[0] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


with open(VERCEL_JSON) as f:
    raw = f.read()

try:
    config = json.loads(raw)
    parsed_ok = True
except json.JSONDecodeError as e:
    config = None
    parsed_ok = False

check("vercel.json is valid JSON", parsed_ok)

if parsed_ok:
    check("vercel.json has a top-level 'headers' array", isinstance(config.get("headers"), list))
    check("vercel.json still has its pre-existing 'functions' config (this change shouldn't touch that)",
          isinstance(config.get("functions"), dict) and len(config["functions"]) > 0)
    check("vercel.json still has its pre-existing 'crons' config (this change shouldn't touch that)",
          isinstance(config.get("crons"), list) and len(config["crons"]) > 0)

    # Find a rule matching all routes ("/(.*)") -- the security headers
    # need to apply site-wide (both the app's own pages and every
    # api/*.py route), not just a subset.
    catchall_rules = [r for r in (config.get("headers") or []) if isinstance(r, dict) and r.get("source") == "/(.*)"]
    check("exactly one catch-all ('/(.*)')  header rule exists", len(catchall_rules) == 1)

    if catchall_rules:
        applied = {h.get("key"): h.get("value") for h in (catchall_rules[0].get("headers") or []) if isinstance(h, dict)}
        for key, expected_value in EXPECTED_HEADERS.items():
            check(f"catch-all rule sets {key}", key in applied)
            if key in applied:
                check(f"{key} has the expected value", applied[key] == expected_value)

# Collision check: none of these headers should already be sent
# explicitly by any api/*.py handler (that would mean the function's own
# send_header() call wins and this config silently does nothing for that
# route -- see this project's own history with a similar Content-Type
# surprise on other platforms).
api_files = [f for f in os.listdir(API_DIR) if f.endswith(".py")]
collision_found = False
for fname in api_files:
    with open(os.path.join(API_DIR, fname)) as f:
        src = f.read()
    for key in EXPECTED_HEADERS:
        # Matches send_header("X-Frame-Options", ...) with either quote style.
        pattern = re.compile(r"""send_header\(\s*['"]""" + re.escape(key) + r"""['"]""", re.IGNORECASE)
        if pattern.search(src):
            collision_found = True
            check(f"{fname} does NOT already explicitly set {key} (would override vercel.json's value)", False)
check("no api/*.py handler explicitly sets any of the pinned security headers (no silent override)",
      not collision_found)

print(f"\n{'All ' + str(total[0]) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(total[0]) + ' checks FAILED:'}")
for f_ in failures:
    print(" -", f_)
if failures:
    raise SystemExit(1)
