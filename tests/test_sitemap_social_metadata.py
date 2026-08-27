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

print(f"\n{'All ' + str(total[0]) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(total[0]) + ' checks FAILED:'}")
for f in failures:
    print(" -", f)
if failures:
    raise SystemExit(1)
