"""
Cross-language drift test for team-name matching. Run with:

    python3 tests/test_team_match_parity.py

Why this exists: team matching is implemented TWICE, deliberately, because
Vercel's Python serverless runtime can't share a module with the browser's
JS -- app/js/pdf-import.js's teamMatch()/TEAM_ALIAS (used for PDF import,
predictions merge, and team logos) and api/grade_picks.py's team_match()/
TEAM_ALIAS (used for grading) are supposed to be identical in behavior, and
each file's own header comment says so explicitly. Nothing before this
test actually verified that claim. This project already has an equivalent
drift test for the OTHER duplicated logic (verify_user()/kv_eval()/
CAS_SCRIPT across api/*.py, see test_auth_sync.py) -- this is the same
category of protection, extended to the one duplicated pair that test
doesn't cover, because it's cross-language rather than cross-file.

Why it matters in practice, concretely: if the two ever drift, the
realistic failure mode isn't a crash -- it's someone's already-displayed,
already-graded-looking pick silently failing to grade, because the pick
was made against a name the JS matcher resolved fine but the Python
grader's copy doesn't recognize (or vice versa). That's the kind of bug
that's invisible until the following week's Record tab quietly shows a
game as still-pending forever.

Unlike test_auth_sync.py (which AST-diffs Python source across files,
since both sides are the same language), this can't compare source code
directly -- JS and Python are never going to look alike. What CAN be
compared is BEHAVIOR: given the exact same corpus of team-name pairs, do
the real, unmodified functions from both files produce the same answer?
tests/_team_match_js_runner.mjs runs the actual JS teamMatch() (extracted
from the real files, not reimplemented) against the corpus; this file
runs the actual Python team_match() (imported directly) against the same
corpus and compares.

The corpus itself is the other half of the protection: several pairs are
the exact real CFBD-alternateNames collision cases documented in both
files' own comments (Texas vs Texas-El Paso, Nevada vs Nevada-Las Vegas,
Florida vs Florida Intl, the Kent State Golden Flashes mascot-suffix
case) -- so this test also acts as a regression test for those specific,
previously-real bugs, not just a generic drift check.
"""
import importlib.util
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

spec = importlib.util.spec_from_file_location("grade_picks", os.path.join(ROOT, "api", "grade_picks.py"))
grade_picks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grade_picks)

failures = []
total = 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


# ---------------------------------------------------------------------------
# The shared corpus. Each entry: (nameA, nameB, expected, description).
# `expected` is independently justified per-pair (not just "whatever the
# code happens to currently return") so this also catches the case where
# BOTH sides drift to the same new wrong answer, not only the case where
# they disagree with each other.
# ---------------------------------------------------------------------------
CORPUS = [
    # Exact / trivial
    ("Wisconsin", "Wisconsin", True, "identical names"),
    ("ALABAMA", "alabama", True, "case-insensitivity"),
    ("", "Alabama", False, "empty name never matches anything"),

    # Token-prefix (the base mechanism, no alias involved)
    ("Wisconsin", "Wisconsin Badgers", True,
     "token-prefix: mascot suffix on one side only"),
    ("Kent State", "Kent State Golden Flashes", True,
     "the exact case that defeated a hand-maintained mascot list, per both files' own header comments"),
    ("Texas A&M", "Texas AM", True,
     "'&' is stripped before tokenizing, not treated as a word boundary"),

    # SIGNIFICANT_TOKENS: real CFBD-documented collisions that must NOT match
    ("Texas", "Texas-El Paso", False,
     "real CFBD alternateNames collision (SIGNIFICANT_TOKENS was added for exactly this)"),
    ("Texas", "Texas-San Antonio", False, "same collision family as above"),
    ("Texas", "Texas Christian", False, "same collision family as above"),
    ("Nevada", "Nevada-Las Vegas", False, "real CFBD alternateNames collision"),
    ("Florida", "Florida Intl", False, "real CFBD alternateNames collision"),
    ("Ohio", "Ohio State", False, "different schools, must not collapse to one"),
    ("Louisiana", "Louisiana Tech", False, "different schools, must not collapse to one"),

    # TEAM_ALIAS-driven matches (two differently-shortened names of ONE school)
    ("Ole Miss", "Mississippi", True, "TEAM_ALIAS: Ole Miss <-> Mississippi"),
    ("Miami", "Miami (FL)", True, "TEAM_ALIAS: Miami <-> Miami (FL), parens stripped by tokenizer"),
    ("Miami (OH)", "Miami OH", True, "TEAM_ALIAS: Miami Ohio, both spellings"),
    ("Southern Miss", "Southern Mississippi", True, "TEAM_ALIAS: Southern Miss <-> Southern Mississippi"),
    ("UL Lafayette", "Louisiana", True, "TEAM_ALIAS: UL Lafayette <-> Louisiana"),
    ("UL Monroe", "Louisiana Monroe", True, "TEAM_ALIAS: UL Monroe <-> Louisiana-Monroe"),
    ("App State", "Appalachian State", True, "TEAM_ALIAS: App State <-> Appalachian State"),
    ("UMass", "Massachusetts", True, "TEAM_ALIAS: UMass <-> Massachusetts (Prediction Tracker naming dialect)"),

    # Alias resolves to the SAME target from both sides at once
    ("Ole Miss", "Rebels", False, "an alias target with no relation to the other name must not match"),

    # No relation at all
    ("Alabama", "Auburn", False, "unrelated schools"),
    ("Michigan", "Michigan State", False, "different schools, common trap for a naive prefix check"),
]


def run_python_side(corpus):
    return [grade_picks.team_match(a, b) for (a, b, _exp, _desc) in corpus]


def run_js_side(corpus):
    pairs = [[a, b] for (a, b, _exp, _desc) in corpus]
    proc = subprocess.run(
        ["node", os.path.join(ROOT, "tests", "_team_match_js_runner.mjs")],
        input=json.dumps(pairs), capture_output=True, text=True, timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"_team_match_js_runner.mjs failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


py_results = run_python_side(CORPUS)
js_results = run_js_side(CORPUS)

for (a, b, expected, desc), py_result, js_result in zip(CORPUS, py_results, js_results):
    label = f'"{a}" vs "{b}" ({desc})'
    check(f"Python: {label} -> {expected}", py_result == expected)
    check(f"JS:     {label} -> {expected}", js_result == expected)
    check(f"PARITY: {label} -- JS and Python agree with each other", py_result == js_result)

# ---------------------------------------------------------------------------
# Direct dict/set comparison as a second, independent check -- catches a
# drift even in an alias/token that isn't exercised by the hand-written
# corpus above.
# ---------------------------------------------------------------------------
js_alias_result = subprocess.run(
    ["node", "-e", """
const fs = require('fs');
const src = fs.readFileSync(process.argv[1], 'utf8');
const vm = require('vm');
const ctx = {};
vm.createContext(ctx);
// TEAM_ALIAS is declared with `const`, not `function` -- a top-level const
// inside vm.runInContext does NOT attach to the context object the way a
// function declaration does (confirmed empirically earlier in this
// project; a plain `ctx.TEAM_ALIAS` read after the fact is always
// undefined). Appending a final expression that references it BY NAME,
// in the SAME runInContext call, works instead -- it's resolved via the
// normal lexical scope of that one script, and runInContext returns the
// completion value of its last statement.
const result = vm.runInContext(src + '\\nJSON.stringify(TEAM_ALIAS)', ctx);
process.stdout.write(result);
""", os.path.join(ROOT, "app", "data", "team-alias.js")],
    capture_output=True, text=True, timeout=10,
)
check("could extract the real JS TEAM_ALIAS for a direct dict comparison", js_alias_result.returncode == 0)
if js_alias_result.returncode == 0:
    js_team_alias = json.loads(js_alias_result.stdout)
    check("TEAM_ALIAS dicts are IDENTICAL between app/data/team-alias.js and api/grade_picks.py (every key and value)",
          js_team_alias == grade_picks.TEAM_ALIAS)
    if js_team_alias != grade_picks.TEAM_ALIAS:
        only_js = set(js_team_alias.items()) - set(grade_picks.TEAM_ALIAS.items())
        only_py = set(grade_picks.TEAM_ALIAS.items()) - set(js_team_alias.items())
        if only_js:
            print(f"   -> present only in JS (or different value): {only_js}")
        if only_py:
            print(f"   -> present only in Python (or different value): {only_py}")

js_tokens_result = subprocess.run(
    ["node", "-e", """
const fs = require('fs');
const src = fs.readFileSync(process.argv[1], 'utf8');
const start = src.indexOf('const SIGNIFICANT_TOKENS=');
const openIdx = src.indexOf('[', start);
let depth = 0, i = openIdx;
for (; i < src.length; i++) {
  if (src[i] === '[') depth++;
  else if (src[i] === ']') { depth--; if (depth === 0) { i++; break; } }
}
const arrLiteral = src.slice(openIdx, i);
const vm = require('vm');
const ctx = {};
vm.createContext(ctx);
const arr = vm.runInContext(arrLiteral, ctx);
process.stdout.write(JSON.stringify(arr));
""", os.path.join(ROOT, "app", "js", "pdf-import.js")],
    capture_output=True, text=True, timeout=10,
)
check("could extract the real JS SIGNIFICANT_TOKENS for a direct set comparison", js_tokens_result.returncode == 0)
if js_tokens_result.returncode == 0:
    js_tokens = set(json.loads(js_tokens_result.stdout))
    check("SIGNIFICANT_TOKENS sets are IDENTICAL between app/js/pdf-import.js and api/grade_picks.py",
          js_tokens == grade_picks.SIGNIFICANT_TOKENS)
    if js_tokens != grade_picks.SIGNIFICANT_TOKENS:
        print(f"   -> only in JS: {js_tokens - grade_picks.SIGNIFICANT_TOKENS}")
        print(f"   -> only in Python: {grade_picks.SIGNIFICANT_TOKENS - js_tokens}")


if failures:
    print(f"\n{len(failures)} of {total} FAILURE(S):", failures)
    sys.exit(1)
print(f"\nAll {total} checks passed.")
