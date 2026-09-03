"""
Static check on vercel.json's security headers (X-Content-Type-Options,
Referrer-Policy, X-Frame-Options, Permissions-Policy, Content-Security-Policy,
Strict-Transport-Security) and, since Sept 3, 2026, its Cache-Control rules
for /app/js, /app/css, and /app/index.html (added after a real "I deployed
a code change and still saw the old behavior" report -- see that section
below for the full story).

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
    # connect-src need Cloudflare's bot/fraud-protection hosts;
    # worker-src needs 'self' blob: for the pdf.js worker; style-src
    # keeps 'unsafe-inline' because Clerk's own components require it
    # regardless of this app's inline style= attributes; img-src stays
    # broad https: since team logos come from CFBD's dynamic response
    # with no fixed CDN domain to pin to) -- added Aug 25 alongside
    # externalizing the last inline <script> block (app/js/main.js) and
    # self-hosting pdf.js (app/vendor/pdfjs/), both of which were
    # blockers on a real script-src.
    #
    # UPDATED Aug 27: script-src/connect-src's Clerk host changed from
    # clerk.pickgauge.com to simple-monarch-32.clerk.accounts.dev --
    # production auth moved off the pickgauge.com custom domain
    # permanently (Drew's explicit call) since pickgauge.com itself is
    # network-blocked on Drew's own work network (categorized Gambling
    # by Cisco Talos/Palo Alto/Fortinet), and clerk.pickgauge.com as a
    # subdomain of that same blocked name meant sign-in failed regardless
    # of which page domain loaded the app. This is the OTHER half of that
    # change (see app/index.html's own script-tag comment for the full
    # story) -- without updating this CSP header too, the browser itself
    # would silently block Clerk's new script/connect origin even though
    # the HTML script tags were pointed at the right place.
    #
    # REVERTED Aug 28: Talos removed the Gambling category, Drew confirmed
    # pickgauge.com is reachable again from the previously-blocked
    # network, so this (and app/index.html's script tags) moved back to
    # clerk.pickgauge.com -- the Development instance was always an
    # accepted temporary tradeoff for as long as the block existed, not a
    # permanent architecture choice. Second time this exact value has
    # changed in two days; if it needs to move again, both directions are
    # documented here and in app/index.html's own comment.
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

    # Sept 3, 2026 (Drew's report: deployed a real code change -- the ATS
    # pool setup wizard -- and still saw the OLD behavior in production).
    # Root cause: /app/js/*.js and /app/css/*.css script/link tags are
    # plain literal paths (no ?v= query string, no content-hashed
    # filenames), and this file previously had no explicit Cache-Control
    # for them at all -- meaning Vercel's/the browser's own default
    # static-asset caching could keep serving an old cached copy after a
    # successful deploy, with nothing forcing a revalidation. Fixed by
    # adding explicit "no-cache, must-revalidate" rules for JS, CSS, and
    # index.html itself (not "no-store" -- conditional GETs/304s still
    # let the browser reuse a cached body cheaply once it's confirmed
    # fresh; this only removes the "trust the cache blindly without
    # asking" behavior that caused the bug). This test pins that
    # configuration so a future edit can't silently drop it and
    # reintroduce the exact same "I deployed it but nothing changed"
    # confusion.
    CACHE_BUSTED_PATHS = {
        "/app/js/(.*)": "no-cache, must-revalidate",
        "/app/css/(.*)": "no-cache, must-revalidate",
        "/app/index.html": "no-cache, must-revalidate",
    }
    for source, expected_cc in CACHE_BUSTED_PATHS.items():
        rules = [r for r in (config.get("headers") or []) if isinstance(r, dict) and r.get("source") == source]
        check(f"a header rule exists for {source}", len(rules) == 1)
        if rules:
            applied_cc = {h.get("key"): h.get("value") for h in (rules[0].get("headers") or []) if isinstance(h, dict)}
            check(f"{source} sets Cache-Control", "Cache-Control" in applied_cc)
            if "Cache-Control" in applied_cc:
                check(f"{source}'s Cache-Control is '{expected_cc}'", applied_cc["Cache-Control"] == expected_cc)
    check("Cache-Control is NOT 'no-store' anywhere (that would disable caching entirely -- slower repeat loads for no benefit; 'no-cache' + revalidation is the correct fix, not a blunter one)",
          "no-store" not in raw)

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
