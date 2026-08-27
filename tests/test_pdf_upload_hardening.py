"""Regression checks for server-side Powers PDF upload hardening."""
import ast
import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "api", "parse_pdf.py")

spec = importlib.util.spec_from_file_location("parse_pdf_api_hardening", PATH)
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

failures = []
total = [0]

def check(name, cond):
    total[0] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)

check("canonical %PDF- signature is accepted", api._has_pdf_signature(b"%PDF-1.7\nrest"))
check("PDF signature within first 1024 bytes is accepted", api._has_pdf_signature(b"x" * 500 + b"%PDF-1.7\n"))
check("non-PDF HTML upload is rejected", not api._has_pdf_signature(b"<!doctype html><html>not a pdf</html>"))
check("signature after first 1024 bytes is rejected", not api._has_pdf_signature(b"x" * 1024 + b"%PDF-1.7"))
check("empty upload is rejected", not api._has_pdf_signature(b""))

# Prove the parser closes pdfplumber's PDF object even when parsing raises.
class FakePdf:
    def __init__(self):
        self.pages = []
        self.closed = False
    def close(self):
        self.closed = True

fake = FakePdf()
orig_open = api.pdfplumber.open
api.pdfplumber.open = lambda _stream: fake
try:
    raised = False
    try:
        api.parse_pdf_bytes(b"%PDF-1.7\nminimal fake body")
    except ValueError:
        raised = True
    check("malformed Powers-style PDF raises rather than silently succeeding", raised)
    check("pdfplumber PDF is closed in a finally block on parser failure", fake.closed)
finally:
    api.pdfplumber.open = orig_open

with open(PATH) as f:
    src = f.read()
tree = ast.parse(src, filename=PATH)
do_post = next((n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "do_POST"), None)
do_post_src = ast.get_source_segment(src, do_post) if do_post else ""
check("parse_pdf do_POST validates signature before parsing", "_has_pdf_signature(pdf_bytes)" in do_post_src)
check("invalid signature gets a client 400 response", 'self._respond(400, {"error": "That upload is not a valid PDF file."})' in do_post_src)

print(f"\n{'All ' + str(total[0]) + ' checks passed.' if not failures else str(len(failures)) + ' of ' + str(total[0]) + ' checks FAILED:'}")
for f in failures:
    print(" -", f)
if failures:
    raise SystemExit(1)
