"""Pins explicit no-store headers on every authenticated/server API JSON response."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(ROOT, "api")
API_FILES = [
    "state.py",
    "fetch_predictions.py",
    "fetch_odds.py",
    "fetch_teams.py",
    "parse_pdf.py",
    "grade_picks.py",
    "parse_pool.py",
    "fetch_cfbd.py",
    "beta.py",
]
EXPECTED = 'self.send_header("Cache-Control", "private, no-store, max-age=0")'

failures = []
total = 0
for fname in API_FILES:
    total += 1
    src = open(os.path.join(API_DIR, fname)).read()
    # Pin the header inside _respond(), not merely anywhere in the file.
    match = re.search(r"def _respond\(self, status, data(?:, extra_headers=None)?\):(?P<body>.*?)(?:\n    def |\Z)", src, re.S)
    ok = bool(match and EXPECTED in match.group("body"))
    print(f"[{'PASS' if ok else 'FAIL'}] {fname} _respond sends Cache-Control: private, no-store, max-age=0")
    if not ok:
        failures.append(fname)

print(f"\n{'All ' + str(total) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(total) + ' checks FAILED:'}")
if failures:
    for f in failures:
        print(" -", f)
    raise SystemExit(1)
