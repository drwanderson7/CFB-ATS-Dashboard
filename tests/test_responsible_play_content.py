from pathlib import Path

html=(Path(__file__).resolve().parents[1]/"responsible-play.html").read_text()
checks=[
    ("current National Problem Gambling Helpline number is shown", "1-800-MY-RESET" in html),
    ("legacy 1-800-522-4700 remains listed as an alternate active number", "1-800-522-4700" in html),
    ("direct online help/chat destination is present", "https://www.1800myreset.org" in html),
    ("legal-age language is present", "legal age" in html.lower()),
    ("local-law language is present", "applicable laws" in html.lower()),
    ("page still states PickGauge is not a sportsbook", "not a sportsbook" in html.lower()),
]
failures=[]
for name,ok in checks:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    if not ok: failures.append(name)
if failures:
    print(f"\n{len(failures)} of {len(checks)} FAILURE(S): {failures}")
    raise SystemExit(1)
print(f"\nAll {len(checks)} checks passed.")
