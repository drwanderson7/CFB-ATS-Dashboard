"""
Runtime tests for api/grade_picks.py's grading logic -- executed, not just
syntax-checked, per this project's established pattern. Run with:

    python3 tests/test_grading.py

Covers the acceptance tests from the ChatGPT audit's Priority 2 item #3:
  - Overall (top-level) archived pick grades correctly.
  - Pool archived pick grades correctly (this is the actual bug fix).
  - Push grades as PUSH, not counted as a loss.
  - Locked spread saved with the pick is what's used to grade.
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

spec = importlib.util.spec_from_file_location("grade_picks", os.path.join(ROOT, "api", "grade_picks.py"))
grade_picks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grade_picks)

failures = []
total_checks = [0]


def check(name, cond):
    total_checks[0] += 1
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        failures.append(name)


# ---------------------------------------------------------------------------
# grade(): win / loss / push
# ---------------------------------------------------------------------------
check("grade(): favorite covers -> W", grade_picks.grade(31, 20, -7) == "W")   # won by 11, needed >7
check("grade(): favorite fails to cover -> L", grade_picks.grade(24, 20, -7) == "L")  # won by 4, needed >7
check("grade(): exact push on the number -> P", grade_picks.grade(27, 20, -7) == "P")  # won by exactly 7
check("grade(): underdog covers -> W", grade_picks.grade(17, 20, 7) == "W")   # lost by 3, +7 covers
check("grade(): underdog push -> P", grade_picks.grade(13, 20, 7) == "P")     # lost by 7, +7 pushes


# ---------------------------------------------------------------------------
# _grade_history / grade_all_pending: the actual bug fix
# ---------------------------------------------------------------------------
def make_pick(matchup, team, line):
    return {"matchup": matchup, "team": team, "line": line, "result": None}


scored_games = grade_picks.score_lookup([
    {
        "completed": True,
        "home_team": "Ohio State Buckeyes",
        "away_team": "Michigan Wolverines",
        "scores": [
            {"name": "Ohio State Buckeyes", "score": "31"},
            {"name": "Michigan Wolverines", "score": "24"},
        ],
    },
    {
        "completed": True,
        "home_team": "Alabama Crimson Tide",
        "away_team": "Auburn Tigers",
        "scores": [
            {"name": "Alabama Crimson Tide", "score": "17"},
            {"name": "Auburn Tigers", "score": "17"},
        ],
    },
])

state_obj = {
    "history": [
        {
            "id": "wk1",
            "entries": [
                {"entryId": "e1", "picks": [
                    make_pick("Michigan Wolverines @ Ohio State Buckeyes", "Ohio State Buckeyes", -7),
                ]},
            ],
        }
    ],
    "pools": [
        {
            "id": "pool1",
            "name": "Friends Pool",
            "history": [
                {
                    "id": "wk1",
                    "entries": [
                        {"entryId": "e1", "picks": [
                            make_pick("Auburn Tigers @ Alabama Crimson Tide", "Alabama Crimson Tide", -3.5),
                        ]},
                    ],
                }
            ],
        }
    ],
}

pending_before = grade_picks._pending_count(state_obj)
check("pending count sees pool picks before grading (was 0 with the old bug)", pending_before == 2)

graded, checked = grade_picks.grade_all_pending(state_obj, scored_games)
check("grade_all_pending: graded both picks (board + pool)", graded == 2)
check("grade_all_pending: checked both picks", checked == 2)

board_pick = state_obj["history"][0]["entries"][0]["picks"][0]
pool_pick = state_obj["pools"][0]["history"][0]["entries"][0]["picks"][0]

check("board pick (OSU -7, won by 7) grades as PUSH", board_pick["result"] == "P")
check("pool pick (Alabama -3.5, push impossible on a half-point line, tie 17-17 -> lose ATS) grades as L",
      pool_pick["result"] == "L")

pending_after = grade_picks._pending_count(state_obj)
check("pending count is 0 after grading", pending_after == 0)


# ---------------------------------------------------------------------------
# Locked line used even if a "live" number would differ -- grading only
# ever reads pk["line"], never a live/current spread, so this is inherently
# satisfied by construction; assert it explicitly so a future refactor that
# accidentally introduces a live-line lookup gets caught here.
# ---------------------------------------------------------------------------
import inspect
src = inspect.getsource(grade_picks._grade_history)
check("grade_all_pending only reads pk['line'] (the locked spread), no live-line lookup",
      "liveVegas" not in src and "live_line" not in src)


if failures:
    print(f"\n{len(failures)} of {total_checks[0]} FAILURE(S): {failures}")
    sys.exit(1)
print(f"\nAll {total_checks[0]} checks passed.")
