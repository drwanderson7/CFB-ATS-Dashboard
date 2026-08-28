"""Static launch checks for sitemap coverage and the dedicated social-share card."""
import os
import struct
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITEMAP = os.path.join(ROOT, "sitemap.xml")
ROBOTS = os.path.join(ROOT, "robots.txt")
INDEX = os.path.join(ROOT, "index.html")
SOCIAL = os.path.join(ROOT, "social-share.png")

failures = []
total = [0]
def check(name, cond):
    total[0] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)

check("sitemap.xml exists", os.path.isfile(SITEMAP))
urls = set()
if os.path.isfile(SITEMAP):
    try:
        tree = ET.parse(SITEMAP)
        root = tree.getroot()
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        urls = {el.text.strip() for el in root.findall("sm:url/sm:loc", ns) if el.text}
        check("sitemap.xml is valid sitemap XML", root.tag == "{http://www.sitemaps.org/schemas/sitemap/0.9}urlset")
    except Exception:
        check("sitemap.xml is valid sitemap XML", False)

expected = {
    "https://pickgauge.com/",
    "https://pickgauge.com/methodology.html",
    "https://pickgauge.com/contact.html",
    "https://pickgauge.com/privacy.html",
    "https://pickgauge.com/terms.html",
    "https://pickgauge.com/responsible-play.html",
}
check("sitemap includes every intended public/indexable page", expected.issubset(urls))
check("sitemap excludes signed-in app", not any("/app" in u for u in urls))
check("sitemap excludes API routes", not any("/api" in u for u in urls))
check("sitemap excludes draft pricing page", not any("pricing" in u for u in urls))

robots = open(ROBOTS).read()
check("robots.txt advertises sitemap", "Sitemap: https://pickgauge.com/sitemap.xml" in robots)

# Every URL in the sitemap should carry a matching <link rel="canonical">
# on the actual page -- reinforces pickgauge.com as the representative
# URL for pages also reachable via the Vercel hostname (Google's own
# guidance for exactly this kind of duplicate-URL situation). Added
# Aug 28 -- previously only the homepage had one; the other 5 static
# pages (methodology/privacy/terms/responsible-play/contact) had none at
# all.
def local_path_for(url):
    path = url.replace("https://pickgauge.com/", "")
    return os.path.join(ROOT, path) if path else INDEX

for url in sorted(expected):
    path = local_path_for(url)
    name = os.path.basename(path) if path != INDEX else "index.html"
    if not os.path.isfile(path):
        check(f"{name}: file exists (can't check its canonical tag otherwise)", False)
        continue
    content = open(path).read()
    check(f"{name}: has a canonical tag pointing at its own sitemap URL ({url})",
          f'<link rel="canonical" href="{url}">' in content)

check("dedicated social-share.png exists", os.path.isfile(SOCIAL))
if os.path.isfile(SOCIAL):
    data = open(SOCIAL, "rb").read(24)
    is_png = data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24
    check("social-share.png is a real PNG", is_png)
    if is_png:
        width, height = struct.unpack(">II", data[16:24])
        check("social-share.png is exactly 1200x630", (width, height) == (1200, 630))

index = open(INDEX).read()
check("Open Graph image points at social-share.png", '<meta property="og:image" content="https://pickgauge.com/social-share.png">' in index)
check("Open Graph dimensions are declared", '<meta property="og:image:width" content="1200">' in index and '<meta property="og:image:height" content="630">' in index)
check("Twitter uses large-image card", '<meta name="twitter:card" content="summary_large_image">' in index)
check("Twitter image points at social-share.png", '<meta name="twitter:image" content="https://pickgauge.com/social-share.png">' in index)
check("social image has accessibility alt metadata", 'og:image:alt' in index and 'twitter:image:alt' in index)

# ---------------------------------------------------------------------------
# Structured data (JSON-LD) -- Aug 28, real check, not just presence-of-tag.
# Parses the actual embedded JSON and confirms it's both valid JSON AND the
# expected schema.org shape, so a future edit that breaks the JSON syntax or
# silently drops a required field fails loudly here instead of only being
# caught by an external validator nobody remembers to re-run.
# ---------------------------------------------------------------------------
import json
import re as _re

ldjson_match = _re.search(r'<script type="application/ld\+json">\s*(\{.*?\})\s*</script>', index, _re.S)
check("index.html has a JSON-LD structured-data block", ldjson_match is not None)
if ldjson_match:
    try:
        ld = json.loads(ldjson_match.group(1))
        ld_parses = True
    except json.JSONDecodeError:
        ld = {}
        ld_parses = False
    check("JSON-LD block is syntactically valid JSON", ld_parses)
    check("JSON-LD declares the schema.org context", ld.get("@context") == "https://schema.org")
    check("JSON-LD type is WebApplication", ld.get("@type") == "WebApplication")
    check("JSON-LD name matches the product", ld.get("name") == "PickGauge")
    check("JSON-LD url points at the canonical homepage", ld.get("url") == "https://pickgauge.com/")
    check("JSON-LD description is non-empty and reasonably substantive", len(ld.get("description", "")) > 40)
    check("JSON-LD applicationCategory is set", bool(ld.get("applicationCategory")))
    check("JSON-LD image points at the real social-share asset (not a placeholder)", ld.get("image") == "https://pickgauge.com/social-share.png")
    offers = ld.get("offers", {})
    check("JSON-LD offers block reflects the CURRENT actual state (free, no paywall) -- not a permanent pricing commitment, just today's fact", offers.get("price") == "0" and offers.get("priceCurrency") == "USD")
    publisher = ld.get("publisher", {})
    check("JSON-LD publisher is a real Organization block, not just a bare string", publisher.get("@type") == "Organization" and publisher.get("name") == "PickGauge")
    check("JSON-LD publisher's sameAs links the real X/Twitter account", publisher.get("sameAs") == ["https://x.com/PickGauge"])

check("footer links to the real X/Twitter account", 'href="https://x.com/PickGauge"' in index)
check("the X/Twitter footer link opens in a new tab with noopener (first external link on this page, so this wasn't an established pattern to copy -- both attributes needed together: target so it doesn't navigate away from the marketing page, noopener so the new tab can't reach back into window.opener)", 'href="https://x.com/PickGauge" target="_blank" rel="noopener noreferrer"' in index)

print(f"\n{'All ' + str(total[0]) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(total[0]) + ' checks FAILED:'}")
for f in failures:
    print(" -", f)
if failures:
    raise SystemExit(1)
