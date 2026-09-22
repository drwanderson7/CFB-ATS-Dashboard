"""
BUG FIXED Sept 16, 2026 (Drew's report: "Check results now" showing "The
Odds API request failed (HTTP 422)", with a 502 in the browser console for
GET /api/grade_picks). api/grade_picks.py's fetch_scores() -- the legacy
Odds API fallback used when a pending pick has no CFBD identity, or CFBD
itself is unavailable -- was requesting daysFrom=7. The Odds API's own docs
(https://the-odds-api.com/liveapi/guides/v4/) are explicit: daysFrom "Valid
values are integers from 1 to 3." That made every single one of these
calls an invalid request, not a transient failure -- The Odds API
correctly rejected it with 422 every time, which do_GET's own error
handling (correctly) then surfaced to the browser as a 502. Fixed by
capping daysFrom at 3, the documented maximum. This test locks in the
fix by inspecting the actual URL fetch_scores() builds, without making a
real network call.
"""
import importlib.util
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("grade_picks", os.path.join(ROOT, "api", "grade_picks.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

fail = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        fail.append(name)


captured_urls = []


class _FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return b"[]"


def _fake_urlopen(req, timeout=None):
    captured_urls.append(req.full_url)
    return _FakeResponse()


real_urlopen = urllib.request.urlopen
urllib.request.urlopen = _fake_urlopen
try:
    mod.fetch_scores("FAKE_KEY_FOR_TEST")
finally:
    urllib.request.urlopen = real_urlopen

check("fetch_scores() made exactly one request", len(captured_urls) == 1)
if captured_urls:
    url = captured_urls[0]
    m = re.search(r"daysFrom=(-?\d+)", url)
    check("fetch_scores() URL includes a daysFrom parameter", m is not None)
    if m:
        days_from = int(m.group(1))
        check(
            "daysFrom is within The Odds API's documented valid range (1 to 3), not the old invalid 7",
            1 <= days_from <= 3,
        )

if fail:
    print(f"\n{len(fail)} of {total} FAILURE(S):", fail)
    raise SystemExit(1)
print(f"\nAll {total} checks passed.")
