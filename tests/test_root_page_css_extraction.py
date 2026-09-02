"""Regression coverage for the Sept 1, 2026 CSS extraction (TODO #25).

Before this, index.html and 7 other root pages (methodology, pricing,
privacy, terms, contact, responsible-play, 404) each had a full inline
<style> block, several of them near-identical copies of the same ~13
rules (nav chrome, base reset, footer link row). index.html's own block
was a 1218-line compiled-Tailwind dump. Both got extracted to real files
(css/marketing.css, css/legal-pages.css) -- this test protects that:

1. Every root page's <link rel="stylesheet"> actually resolves to a real
   file on disk (a typo'd href fails silently in a browser -- the page
   just renders unstyled, no error loud enough to notice immediately).
2. None of the 8 pages' remaining page-specific <style> block re-declares
   a rule that's already in css/legal-pages.css -- that would be silent,
   confusing duplication (which copy wins depends on cascade order,
   exactly the kind of thing this project's CSS lessons warn about) and
   defeats the point of extracting a shared file in the first place.
3. index.html has NO inline <style> block left at all (the whole
   Tailwind block moved to css/marketing.css, nothing should drift back).
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PAGES_WITH_SHARED_LINK = [
    "methodology.html", "pricing.html", "privacy.html", "terms.html",
    "contact.html", "responsible-play.html", "404.html",
]

failures = []
total = 0
def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)

def split_rules(css_text):
    """Split into top-level rules, treating @media{...} as one atomic unit
    (brace-nesting aware -- a naive non-nested regex would silently strip
    the @media wrapper off any responsive rule inside it)."""
    rules, i, n = [], 0, len(css_text)
    while i < n:
        while i < n and css_text[i].isspace():
            i += 1
        if i >= n:
            break
        start = i
        brace_idx = css_text.find("{", i)
        if brace_idx == -1:
            break
        j, depth = brace_idx, 0
        while j < n:
            if css_text[j] == "{":
                depth += 1
            elif css_text[j] == "}":
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
        rule = css_text[start:j].strip()
        if rule:
            rules.append(rule)
        i = j
    return rules

# --- index.html: fully extracted, zero inline <style> left --------------
index_html = (ROOT / "index.html").read_text(encoding="utf-8")
check("index.html has no inline <style> block left", "<style" not in index_html)
check("index.html links css/marketing.css", 'href="/css/marketing.css"' in index_html)
check("css/marketing.css exists on disk", (ROOT / "css" / "marketing.css").exists())

# --- app/index.html: untouched by this pass, still zero inline style ----
app_index_html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
check("app/index.html still has no inline <style> block (extracted separately, Aug 28)", "<style" not in app_index_html)

# --- shared legal-pages.css exists and every dependent page links it ----
legal_css_path = ROOT / "css" / "legal-pages.css"
check("css/legal-pages.css exists on disk", legal_css_path.exists())
shared_rules = set(split_rules(legal_css_path.read_text(encoding="utf-8"))) if legal_css_path.exists() else set()
check("css/legal-pages.css has real rules in it (not an empty stub)", len(shared_rules) > 0)

for page in PAGES_WITH_SHARED_LINK:
    html = (ROOT / page).read_text(encoding="utf-8")
    check(f"{page} links css/legal-pages.css", 'href="/css/legal-pages.css"' in html)
    m = re.search(r"<style>(.*?)</style>", html, re.S)
    residual_rules = set(split_rules(m.group(1))) if m else set()
    overlap = residual_rules & shared_rules
    check(f"{page}: no page-specific rule duplicates something already in css/legal-pages.css", not overlap)

# --- pricing.html's two @media blocks specifically must have survived intact --
# (this is the exact bug a naive non-nesting-aware splitter introduced during
# the original extraction: it silently dropped the @media wrapper, making a
# MOBILE-ONLY single-column override apply unconditionally on desktop too.)
pricing_html = (ROOT / "pricing.html").read_text(encoding="utf-8")
check("pricing.html's .tiers media-query override kept its @media wrapper (not flattened to unconditional)",
      "@media(max-width:680px){ .tiers{grid-template-columns:1fr;} }" in pricing_html)
check("pricing.html's .why-grid media-query override kept its @media wrapper",
      "@media(max-width:680px){ .why-grid{grid-template-columns:1fr;} }" in pricing_html)
check("pricing.html's base (non-mobile) .tiers rule is still a real 2-column grid",
      ".tiers{display:grid;grid-template-columns:1fr 1fr;" in pricing_html)

print("")
print(f"{total - len(failures)}/{total} checks passed")
if failures:
    print("FAILED:")
    for f in failures:
        print(f"  - {f}")
    raise SystemExit(1)
