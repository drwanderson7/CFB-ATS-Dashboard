"""Homepage regression coverage for the Sept. 2 Survivor marketing section."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "index.html").read_text(encoding="utf-8")

checks = []
def check(name, condition):
    checks.append((name, bool(condition)))
    print(f"[{'PASS' if condition else 'FAIL'}] {name}")

check("hero keeps the established primary headline",
      "Import your pool. Pick your models. Find your edge." in html)
check("hero eyebrow now positions ATS + Survivor together",
      "CFB ATS + Survivor analytics" in html)
check("hero links to the dedicated Survivor section",
      'href="#survivor"' in html and "Also built for CFB Survivor pools" in html)
check("dedicated Survivor section exists",
      'id="survivor"' in html and "CFB Survivor, planned beyond this week." in html)
check("Survivor section appears between Capabilities and How It Works",
      html.index('id="features"') < html.index('id="survivor"') < html.index('id="how"'))
check("Survivor copy explains future value and scarcity",
      "future schedule value and team scarcity" in html)
check("Survivor section explains exact season-path planning",
      "exact optimizer" in html and "Season Path Planning" in html)
check("Survivor section explains multi-entry portfolio strategy",
      "Multi-Entry Strategy" in html and "at least one entry survives" in html)
check("Survivor section shows a product-style strategy preview",
      "Survivor Strategy" in html and "Best Play" in html and "Multi-entry portfolio" in html)
check("page metadata now mentions Survivor",
      'name="description"' in html and "Survivor pool analytics" in html and
      'property="og:description"' in html and "Survivor analytics" in html and
      'name="twitter:description"' in html)
check("JSON-LD description now mentions Survivor",
      '"description": "College-football ATS and Survivor pool analytics' in html)
check("final CTA copy now covers both ATS and Survivor",
      "weekly ATS picks and Survivor strategy" in html)
check("homepage nav was not modified to add a duplicate Survivor anchor",
      'href="#survivor">Survivor</a>' not in html)

failed = [name for name, ok in checks if not ok]
print(f"\n{len(checks)-len(failed)}/{len(checks)} checks passed")
if failed:
    raise SystemExit("FAILED: " + ", ".join(failed))
