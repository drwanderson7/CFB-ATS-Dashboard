"""Regression: Powers schedule pairs whose FAVORITE DIFFERS between the Current
column and the BP column (Week 5 2026, rotations 105/106).

    105 North Texas  9:00   58    57.5   -1      <- BP spread is on the AWAY row
    106 Tulsa        ESPN  -2.5   -1     55      <- Current spread is on the HOME row

The old parser decided which row held the spread from the Current column only
and read BP from that same row, so it grabbed the TOTAL (55) as Tulsa's BP. A
safety guard then dropped it, leaving the BP cell blank. Each column must find
its own spread row: BP North Texas -1 means Tulsa +1 from the home side.

Builds real (minimal) PDFs with the Powers column layout so the actual
pdfplumber code path runs -- no paid newsletter content is stored in the repo.

Run with:  python3 tests/test_powers_bp_column_flip.py
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("parse_pdf_bp_flip", os.path.join(ROOT, "api", "parse_pdf.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

failures, total = [], 0


def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


# ---------------------------------------------------------------- pure helpers
check("_spread_side: spread on the away row", mod._spread_side(-1.0, 55.0) == "away")
check("_spread_side: spread on the home row", mod._spread_side(57.5, -1.0) == "home")
check("_spread_side: PK (0) counts as the spread row", mod._spread_side(0.0, 54.0) == "away" and mod._spread_side(51.0, 0.0) == "home")
check("_spread_side: two totals / two spreads / nothing is undecidable (None)",
      mod._spread_side(51.0, 55.0) is None and mod._spread_side(-1.0, -2.0) is None and mod._spread_side(None, None) is None)
check("_spread_side: one missing number still resolves from the other", mod._spread_side(None, -3.0) == "home" and mod._spread_side(-3.0, None) == "away")

A = lambda cur, bp: {"team": "A", "cur": cur, "bp": bp}
H = lambda cur, bp: {"team": "H", "cur": cur, "bp": bp}
# The real Week 5 pair: Current favors Tulsa (home), BP favors North Texas (away).
bp, vegas, sus = mod._home_lines(A(57.5, -1.0), H(-1.0, 55.0), 2.4)
check("Week 5 105/106: BP is +1.0 from the home side (North Texas -1), not the 55 total", bp == 1.0)
check("Week 5 105/106: Vegas is still Tulsa -1.0 and nothing is flagged", vegas == -1.0 and sus is False)
bp, vegas, sus = mod._home_lines(A(-1.0, 52.0), H(50.0, -1.0), -1.0)
check("opposite flip (Current favors away, BP favors home): BP -1.0, Vegas +1.0", bp == -1.0 and vegas == 1.0 and sus is False)
bp, vegas, sus = mod._home_lines(A(51.0, 52.0), H(0.0, 0.0), 0.2)
check("PK from BP on the home row is 0.0, not a flagged blank", bp == 0.0 and vegas == 0.0 and sus is False and str(bp) == "0.0")
bp, vegas, sus = mod._home_lines(A(-14.5 + 1.0, -15.0), H(46.5, 47.0), 15.0)
check("away favorite, no flip: BP flips sign to the home view (+15.0)", bp == 15.0 and vegas == 13.5)
bp, vegas, sus = mod._home_lines(A(51.0, 53.0), H(-2.0, 55.0), -2.0)
check("BP column with no readable spread: blank AND flagged (a BP number exists but couldn't be read)", bp is None and sus is True)
bp, vegas, sus = mod._home_lines(A(None, None), H(None, None), None)
check("no numbers at all: blank and NOT flagged (the PDF never had a BP)", bp is None and sus is False)
bp, vegas, sus = mod._home_lines(A(-3.0, -40.0), H(50.0, 55.0), 2.0)
check("a wild BP is still dropped by the computer-line guard and flagged", bp is None and sus is True)

# ---------------------------------------------------------------- real PDF path
def build_pdf(pages):
    """pages: list of [(x, y_from_bottom, text), ...] -> minimal valid PDF bytes."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", None]
    kids = []
    n = 3
    page_objs = []
    for items in pages:
        stream = "".join(f"BT /F1 9 Tf {x} {y} Td ({t}) Tj ET\n" for x, y, t in items)
        page_objs.append((n, n + 1, stream))
        kids.append(f"{n} 0 R")
        n += 2
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >>"
    body = list(objs)
    for pn, cn, stream in page_objs:
        body.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {cn} 0 R /Resources << /Font << /F1 {n} 0 R >> >> >>")
        body.append(f"<< /Length {len(stream)} >>\nstream\n{stream}endstream")
    body.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out, offs = "%PDF-1.4\n", []
    for i, o in enumerate(body, 1):
        offs.append(len(out.encode()))
        out += f"{i} 0 obj\n{o}\nendobj\n"
    xref = len(out.encode())
    out += f"xref\n0 {len(body) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offs)
    out += f"trailer\n<< /Size {len(body) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return out.encode()


def sched_row(y, rot, team, tv, open_, cur, bp):
    # Column x positions the parser expects for the LEFT block.
    return [(36.4, y, str(rot)), (62, y, team), (130, y, tv), (180, y, open_), (226.4, y, cur), (273.4, y, bp)]


def comp_row(y, rot, team, line=None, comp=None, diff=None):
    row = [(36.0, y, str(rot)), (62, y, team)]
    if comp is not None:
        row += [(118, y, line), (157.0, y, comp), (195, y, diff)]
    return row


sched = [(150, 740, "Open"), (226.4, 740, "Current"), (273.4, 740, "BP")]
for i, args in enumerate([
    (105, "North", "9:00", "58", "57.5", "-1"),       # BP favors North Texas (away) ...
    (106, "Tulsa", "ESPN", "-2.5", "-1", "55"),       # ... Current favors Tulsa (home)
    (107, "Pittsburgh", "7:00", "52.5", "54.5", "52"),
    (108, "Virginia", "ESPN", "-4.5", "-3", "-4"),    # normal: home favorite in both
    (139, "Buffalo", "1:00", "-14.5", "-13.5", "-15"),  # away favorite in both
    (140, "Akron", "ESPN+", "48", "46.5", "47"),
    (201, "Alpha", "7:00", "50", "51", "52"),
    (202, "Beta", "ESPN", "-1", "PK", "PK"),          # PK from both columns
    (203, "Gamma", "7:00", "50", "51", "53"),
    (204, "Delta", "ESPN", "-1", "-2", "55"),         # BP has no readable spread
    (205, "Eps", "7:00", "-2", "-1", "52"),
    (206, "Zeta", "ESPN", "50", "49", "-1"),          # opposite flip
]):
    sched += sched_row(700 - i * 14, *args)
comp = [(36, 740, "Comp"), (157, 740, "Diff")]
for i, args in enumerate([
    (105, "North"), (106, "Tulsa", "-1.0", "+2.4", "+3.4"),
    (107, "Pittsburgh"), (108, "Virginia", "-3.0", "-3.1", "-0.1"),
    (139, "Buffalo"), (140, "Akron", "13.5", "+15.0", "+1.5"),
    (201, "Alpha"), (202, "Beta", "0.0", "+0.2", "+0.2"),
    (203, "Gamma"), (204, "Delta", "-2.0", "-2.0", "0.0"),
    (205, "Eps"), (206, "Zeta", "+1.0", "-1.0", "-2.0"),
]):
    comp += comp_row(700 - i * 14, *args)

games = {g["awayRotation"]: g for g in mod.parse_pdf_bytes(build_pdf([sched, comp]))}
check("synthetic Powers PDF parses into 6 games", len(games) == 6 and set(games) == {105, 107, 139, 201, 203, 205})
g = games[105]
check("PDF 105/106 North Texas @ Tulsa: bp = +1.0 (North Texas -1), homeVegas -1.0, not flagged",
      g["away"] == "North" and g["home"] == "Tulsa" and g["bp"] == 1.0 and g["homeVegas"] == -1.0 and g["bpSuspect"] is False)
check("PDF 107/108 normal home favorite: bp -4.0, vegas -3.0", games[107]["bp"] == -4.0 and games[107]["homeVegas"] == -3.0)
check("PDF 139/140 away favorite: bp +15.0, vegas +13.5", games[139]["bp"] == 15.0 and games[139]["homeVegas"] == 13.5)
check("PDF 201/202 PK: bp 0.0 and vegas 0.0", games[201]["bp"] == 0.0 and games[201]["homeVegas"] == 0.0 and games[201]["bpSuspect"] is False)
check("PDF 203/204 BP with no readable spread: blank and flagged", games[203]["bp"] is None and games[203]["bpSuspect"] is True)
check("PDF 205/206 opposite flip: bp -1.0, vegas +1.0", games[205]["bp"] == -1.0 and games[205]["homeVegas"] == 1.0)

print(f"\n{total - len(failures)}/{total} checks passed")
if failures:
    print("FAILED:", failures)
    sys.exit(1)
