"""Regression for a real malformed rotation pair in Powers Week 1 2026.

The newsletter prints both Texas State and Texas as rotation 190. Before this
repair, parse_pdf.py stored schedule rows in a dict keyed by rotation, so Texas
State was overwritten and the matchup disappeared entirely.
"""
import importlib.util
import os

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec=importlib.util.spec_from_file_location("parse_pdf_dup_rot",os.path.join(ROOT,"api","parse_pdf.py"))
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

rows={}
a={"team":"Texas State","cur":59.5,"bp":62.0}
h={"team":"Texas","cur":-29.5,"bp":-30.0}
assert mod._insert_schedule_row(rows,190,a) is False
assert mod._insert_schedule_row(rows,190,h) is True
assert rows[189]["team"]=="Texas State"
assert rows[190]["team"]=="Texas"

normal={}
assert mod._insert_schedule_row(normal,195,{"team":"Northern Illinois"}) is False
assert mod._insert_schedule_row(normal,196,{"team":"Iowa"}) is False
assert set(normal)=={195,196}
print("Powers duplicate-rotation repair tests passed")
