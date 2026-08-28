"""Regression checks for third-party error-body redaction.

PickGauge should preserve actionable HTTP classes (bad feature key, rate limit,
upstream failure) without passing CFBD/The Odds API response bodies directly to
the browser. Provider error formats are outside our control and can contain
implementation diagnostics that should stay out of product UI.

Run with:
    python3 tests/test_upstream_error_redaction.py
"""
import ast
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


def source(name):
    with open(os.path.join(ROOT, "api", name), encoding="utf-8") as f:
        return f.read()


teams = source("fetch_teams.py")
odds = source("fetch_odds.py")

check("fetch_teams no longer decodes CFBD's HTTPError body into a client response",
      "e.read().decode" not in teams)
check("fetch_teams maps rejected CFBD credentials to the feature-key 'message' shape",
      'self._respond(401, {"message": "CFBD rejected the API key."})' in teams)
check("fetch_teams has a static CFBD rate-limit message",
      'CFBD rate limit reached — try again later.' in teams)
check("fetch_teams has a static generic upstream-failure message",
      'CFBD request failed — try again shortly.' in teams)

check("fetch_odds no longer contains the old verbatim upstream-body relay",
      "Relay upstream status+body verbatim" not in odds)
check("fetch_odds maps rejected odds credentials to the feature-key 'message' shape",
      '"message": "Odds service rejected the API key."' in odds)
check("fetch_odds has a static odds rate-limit message",
      'Odds service rate limit reached — try again later.' in odds)
check("fetch_odds has a static generic upstream-failure message",
      'Odds service request failed — try again shortly.' in odds)

# Stronger structural guard: outside _respond(), fetch_odds must never write a
# local variable named `body` directly to wfile. `body` in do_GET is the raw
# bytes returned by The Odds API; writing it was the leak this test prevents.
tree = ast.parse(odds, filename="api/fetch_odds.py")
direct_raw_writes = []
for node in ast.walk(tree):
    if not isinstance(node, ast.FunctionDef) or node.name == "_respond":
        continue
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        fn = child.func
        if not (isinstance(fn, ast.Attribute) and fn.attr == "write"):
            continue
        if child.args and isinstance(child.args[0], ast.Name) and child.args[0].id == "body":
            direct_raw_writes.append(child.lineno)
check("fetch_odds never writes raw upstream `body` bytes directly to the browser",
      direct_raw_writes == [])

print(f"\n{'All ' + str(total) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(total) + ' checks FAILED:'}")
for failure in failures:
    print(" -", failure)
if failures:
    raise SystemExit(1)
