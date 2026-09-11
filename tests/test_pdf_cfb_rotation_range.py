"""
Regression for Drew's Sept 10, 2026 report: importing the real Powers Wk 2
2026 newsletter PDF failed with "No games returned" even though the file
parsed and its schedule page had 49 real CFB games on it.

Root cause: parse_pdf_bytes()'s CFB/NFL split used a hardcoded
`rot >= 261` cutoff, calibrated against whichever earlier issue's
rotation numbering happened to put CFB below 261 and NFL above. Brad
Powers reassigns rotation numbers fresh every issue -- the real Week 2
2026 PDF numbers CFB games 313-410 and NFL games 451-482 (NFL straddling
CFB on both sides across the week: 451-454 Wed/Thu, then CFB, then
455-482 Sun/Mon) -- so EVERY rotation in that issue is >= 261, and the
old cutoff silently filtered out the entire schedule, not just NFL rows.

Fix: derive the CFB rotation range from the page Powers themselves title
"Computer Projected Lines for Every CFB Game" (m6 in parse_pdf_bytes) --
it never contains an NFL rotation by its own stated scope, so the
min/max rotation actually present in it is that issue's real CFB
boundary, computed fresh from the PDF every time.

This test builds a minimal synthetic two-page pdfplumber-like fake (same
monkeypatch approach as test_pdf_upload_hardening.py) reproducing the
exact numeric layout that broke: CFB rotations well above the old 261
cutoff, with NFL rotations positioned on BOTH sides of the CFB block
(proving the fix isn't just "raise the cutoff," which would still break
whenever a future issue's NFL block sits below CFB again).

Run with:
    python3 tests/test_pdf_cfb_rotation_range.py
"""
import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "api", "parse_pdf.py")

spec = importlib.util.spec_from_file_location("parse_pdf_cfb_range", PATH)
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

failures = []
total = [0]


def check(name, cond):
    total[0] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


class FakeWord(dict):
    def __init__(self, text, x0, top):
        super().__init__(text=text, x0=x0, top=top)


class FakePage:
    def __init__(self, text, words, height=800):
        self._text = text
        self._words = words
        self.height = height

    def extract_text(self):
        return self._text

    def extract_words(self, keep_blank_chars=False):
        return self._words


def sched_row(rot, team_words, cur, bp, y, block):
    rX, tlo, curX, bpX = (36.4, 50, 226.4, 273.4) if block == 0 else (312.0, 326, 502.0, 549.0)
    ws = [FakeWord(str(rot), rX, y)]
    for txt, off in team_words:
        ws.append(FakeWord(txt, tlo + off, y))
    ws.append(FakeWord(str(cur), curX, y))
    ws.append(FakeWord(str(bp), bpX, y))
    return ws


def comp_away_row(rot, y, block):
    rX, compX = (36.0, 157.0) if block == 0 else (217.8, 338.8)
    return [FakeWord(str(rot), rX, y)]


def comp_home_row(rot, comp, y, block):
    rX, compX = (36.0, 157.0) if block == 0 else (217.8, 338.8)
    return [FakeWord(str(rot), rX, y), FakeWord(str(comp), compX, y)]


# --- Schedule page: CFB rotations 313-316, PLUS NFL rotations on BOTH
# sides (100/101 below, 451/452 above) -- the "NFL straddles CFB" shape
# that broke the old single-sided cutoff.
sched_words = []
sched_words += sched_row(100, [("SomeNFLAway", 0)], -3, -3, y=10, block=0)
sched_words += sched_row(101, [("SomeNFLHome", 0)], 3, 3, y=20, block=0)
sched_words += sched_row(313, [("Rutgers", 0)], -3.0, -2.0, y=30, block=0)
sched_words += sched_row(314, [("Boston", 0), ("College", 40)], -3.0, -2.0, y=40, block=0)
sched_words += sched_row(315, [("Missouri", 0)], 5.5, 4.0, y=50, block=0)
sched_words += sched_row(316, [("Kansas", 0)], 5.5, 4.0, y=60, block=0)
sched_words += sched_row(451, [("SomeNFLAway2", 0)], -4, -4, y=70, block=0)
sched_words += sched_row(452, [("SomeNFLHome2", 0)], 4, 4, y=80, block=0)
sched_page = FakePage("Current BP schedule text", sched_words)

# --- Comp page: ONLY the CFB rotations, matching Powers' own "for every
# CFB game" scope -- this is exactly what the fix reads the range from.
comp_words = []
comp_words += comp_away_row(313, y=30, block=0)
comp_words += comp_home_row(314, -1.2, y=40, block=0)
comp_words += comp_away_row(315, y=50, block=0)
comp_words += comp_home_row(316, 5.3, y=60, block=0)
comp_page = FakePage("Comp Diff computer lines text", comp_words)

fake_pages = [sched_page, comp_page]


class FakePdf:
    def __init__(self, pages):
        self.pages = pages

    def close(self):
        pass


orig_open = api.pdfplumber.open
api.pdfplumber.open = lambda _stream: FakePdf(fake_pages)
try:
    games = api.parse_pdf_bytes(b"%PDF-1.7\nfake")
finally:
    api.pdfplumber.open = orig_open

check("all 4 synthetic NFL rows (100/101 below CFB, 451/452 above CFB) are excluded",
      not any(g["awayRotation"] in (100, 451) for g in games))
check("all 2 real CFB games (313/314 and 315/316) are included",
      len(games) == 2)
check("CFB game 313@314 (Rutgers @ Boston College) parsed correctly",
      any(g["awayRotation"] == 313 and g["home"] == "Boston College" for g in games))
check("CFB game 315@316 (Missouri @ Kansas) parsed correctly",
      any(g["awayRotation"] == 315 and g["home"] == "Kansas" for g in games))

# --- The exact real-world shape that originally broke: the CFB
# rotations themselves are numerically >= 261 (the old cutoff would have
# excluded them entirely), while NFL sits on BOTH sides of that range --
# proving the fix doesn't merely raise the old constant (which would
# still break the moment a future issue's NFL block drops below CFB
# again), it stopped depending on any fixed constant at all.
cfb_rots = [313, 314, 315, 316]
check("the real CFB rotations in this scenario are >= 261 (the old hardcoded cutoff would have wrongly excluded every one of them, exactly like the real Week 2 2026 PDF)",
      all(r >= 261 for r in cfb_rots))
check("yet NFL rotations exist on BOTH sides of that CFB range (100/101 below, 451/452 above) and are still correctly excluded -- a simple raised cutoff could only handle one side",
      100 < min(cfb_rots) and max(cfb_rots) < 451)

if failures:
    print(f"\n{len(failures)} of {total[0]} FAILURE(S):", failures)
    raise SystemExit(1)
print(f"\nAll {total[0]} checks passed.")
