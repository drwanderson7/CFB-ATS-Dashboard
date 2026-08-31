"""Regression coverage for PickGauge's Vercel Web Analytics integration.

The site is plain/static HTML rather than a bundled framework, so the integration
is intentionally two same-origin scripts on every user-visible HTML page:
  1) /vercel-analytics.js — CSP-safe bootstrap + privacy redaction
  2) /_vercel/insights/script.js — Vercel's intake script after Analytics is enabled

This test pins full-page coverage, one-and-only-one inclusion, load order, CSP
compatibility, and the privacy guard that strips query strings / URL fragments.
"""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
HTML_FILES = [
    ROOT / "index.html",
    ROOT / "app" / "index.html",
    ROOT / "methodology.html",
    ROOT / "pricing.html",
    ROOT / "privacy.html",
    ROOT / "responsible-play.html",
    ROOT / "terms.html",
    ROOT / "contact.html",
    ROOT / "404.html",
]
BOOTSTRAP = ROOT / "vercel-analytics.js"
VERCEL = ROOT / "vercel.json"
PRIVACY = ROOT / "privacy.html"

failures = []
checks = 0

def check(name, cond):
    global checks
    checks += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)

boot = BOOTSTRAP.read_text()
check("analytics bootstrap exists", BOOTSTRAP.exists())
check("bootstrap initializes Vercel's va queue", "window.va" in boot and "window.vaq" in boot)
check("bootstrap installs beforeSend privacy filter", "'beforeSend'" in boot)
check("bootstrap strips URL query strings", "url.search = ''" in boot)
check("bootstrap strips URL fragments", "url.hash = ''" in boot)
check("bootstrap never references account/user/email data", all(token not in boot for token in ["email", "userId", "primaryEmailAddress", "poolName", "picks"]))

for path in HTML_FILES:
    text = path.read_text()
    rel = path.relative_to(ROOT)
    check(f"{rel} loads bootstrap exactly once", text.count('src="/vercel-analytics.js"') == 1)
    check(f"{rel} loads Vercel intake exactly once", text.count('src="/_vercel/insights/script.js"') == 1)
    check(f"{rel} bootstrap is before intake", text.index('src="/vercel-analytics.js"') < text.index('src="/_vercel/insights/script.js"'))
    check(f"{rel} analytics scripts are before </body>", text.index('src="/_vercel/insights/script.js"') < text.index('</body>'))

cfg = json.loads(VERCEL.read_text())
catchall = next(rule for rule in cfg["headers"] if rule.get("source") == "/(.*)")
headers = {h["key"]: h["value"] for h in catchall["headers"]}
csp = headers.get("Content-Security-Policy", "")
check("CSP allows same-origin analytics scripts", "script-src 'self'" in csp)
check("CSP allows same-origin analytics intake requests", "connect-src 'self'" in csp)

privacy = PRIVACY.read_text()
check("privacy policy discloses Vercel Web Analytics", "Vercel Web Analytics" in privacy)
check("privacy policy discloses no analytics cookies", "does not use analytics cookies" in privacy or "Neither Vercel Web Analytics" in privacy)
check("privacy policy discloses query/hash stripping", "strips URL query strings and fragments" in privacy)
check("privacy policy keeps first-party signed-in analytics separate", "Signed-in product analytics and beta feedback" in privacy)
check("privacy policy excludes Google/Meta/advertising trackers", "does not use Google Analytics, Meta Pixel, advertising trackers" in privacy)

print(f"\n{'All ' + str(checks) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(checks) + ' checks FAILED:'}")
for failure in failures:
    print(" -", failure)
if failures:
    raise SystemExit(1)
