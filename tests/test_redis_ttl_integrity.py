from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
state = (ROOT / "api/state.py").read_text()
preds = (ROOT / "api/fetch_predictions.py").read_text()
grade = (ROOT / "api/grade_picks.py").read_text()

failures = []
total = 0

def check(name, cond):
    global total
    total += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)

def block(src, start_marker, end_marker):
    start = src.index(start_marker)
    end = src.index(end_marker, start)
    return src[start:end]

cas = block(state, 'CAS_SCRIPT = """', '"""\n\n\n# Atomic per-user')
check("private/shared CAS writes use SET without EXPIRE, so season-critical user/pool state has no Redis TTL",
      "redis.call('SET', KEYS[1], ARGV[2])" in cas and "EXPIRE" not in cas)

kv_set = block(state, "def kv_set(", "\n\ndef kv_delete")
check("state.py kv_set uses plain /set/<key> with no expiration arguments",
      "/set/" in kv_set and not re.search(r"\b(EX|PX|EXPIRE|SETEX)\b", kv_set))

check("all three shared-domain keys are long-lived named keys",
      all(k in state for k in [
          'SHARED_ODDS_KEY = "edge_board_shared_odds"',
          'SHARED_PREDICTIONS_KEY = "edge_board_shared_predictions"',
          'SHARED_POOLS_KEY = "edge_board_shared_pools"',
      ]))

check("shared predictions use the normal non-expiring setter, not the TTL snapshot setter",
      "_kv_set(SHARED_PREDICTIONS_KEY, json.dumps(payload))" in preds)

check("weekly prediction snapshots are the one intentional long-lived data TTL",
      "SNAPSHOT_TTL_SECONDS = 60 * 60 * 24 * 7 * 26" in preds)

check("weekly prediction snapshots explicitly use the TTL-capable setter",
      "_kv_set_ex(key, json.dumps(payload), SNAPSHOT_TTL_SECONDS)" in preds)

rate = block(state, 'RATE_LIMIT_SCRIPT = """', '"""\n\n\ndef is_admin')
check("rate-limit keys intentionally expire and are isolated from season-critical state",
      "EXPIRE" in rate and 'ratelimit:' in state)

grade_set = block(grade, "def kv_set(", "\n\ndef kv_eval")
check("grader cache kv_set also uses plain non-expiring Redis SET semantics",
      "/set/" in grade_set and not re.search(r"\b(EX|PX|EXPIRE|SETEX)\b", grade_set))

if failures:
    print(f"\n{len(failures)} of {total} FAILURE(S): {failures}")
    raise SystemExit(1)

print(f"\nAll {total} checks passed.")
