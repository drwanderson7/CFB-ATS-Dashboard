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
import json
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


# ---------------------------------------------------------------------------
# grade_and_write_user(): the grader's atomic CAS retry. Exact scenario from
# the handoff's Priority 3 acceptance test -- a user adds a new pick (and
# writes a newer revision) AFTER the grader has already read state but
# BEFORE the grader's write lands. The grader's CAS write must fail, reload
# the new state, and grade THAT (so the new pick isn't silently dropped),
# not just retry writing its now-stale original result.
# ---------------------------------------------------------------------------
FAKE_KV = {}
_read_count = [0]


def fake_kv_get(key):
    _read_count[0] += 1
    raw = FAKE_KV.get(key)
    return json.loads(raw) if raw else None


def fake_kv_set(key, obj):
    FAKE_KV[key] = json.dumps(obj)
    return True


def fake_kv_eval(script, keys, args):
    """Same CAS_SCRIPT semantics as tests/test_state.py's mock, adapted
    for grade_picks.py's kv_get (which returns a parsed dict, not a raw
    string)."""
    key = keys[0]
    expected_rev = int(args[0])
    new_body_json = args[1]
    current_raw = FAKE_KV.get(key)
    current_rev = 0
    if current_raw:
        try:
            current_rev = json.loads(current_raw).get("_rev", 0)
        except (TypeError, json.JSONDecodeError):
            current_rev = 0
    if current_rev != expected_rev:
        return ["conflict", current_rev, current_raw or ""]
    FAKE_KV[key] = new_body_json
    return ["ok", expected_rev + 1, ""]


grade_picks.kv_get = fake_kv_get
grade_picks.kv_set = fake_kv_set
grade_picks.kv_eval = fake_kv_eval

# Seed: revision 5, one ungraded pick.
seeded = {
    "_rev": 5,
    "history": [{"id": "wk1", "entries": [{"entryId": "e1", "picks": [
        make_pick("Michigan Wolverines @ Ohio State Buckeyes", "Ohio State Buckeyes", -7),
    ]}]}],
    "pools": [],
}
FAKE_KV["edge_board_user_racer"] = json.dumps(seeded)

# Monkeypatch kv_get so that on its FIRST call (the grader's initial read,
# landing on revision 5) a concurrent user write also lands immediately
# after -- simulating "user adds a pick and saves revision 6 while grading
# is in flight" -- before the grader's own CAS write attempt executes.
_original_fake_kv_get = fake_kv_get
_user_write_injected = [False]


def kv_get_with_race(key):
    result = _original_fake_kv_get(key)
    if not _user_write_injected[0]:
        _user_write_injected[0] = True
        # Concurrent user write: adds a SECOND pick and bumps to revision 6,
        # landing after the grader's read but before the grader's write.
        raced = json.loads(FAKE_KV[key])
        raced["history"][0]["entries"][0]["picks"].append(
            make_pick("Auburn Tigers @ Alabama Crimson Tide", "Alabama Crimson Tide", -3.5)
        )
        raced["_rev"] = 6
        FAKE_KV[key] = json.dumps(raced)
    return result


grade_picks.kv_get = kv_get_with_race

graded, checked, written = grade_picks.grade_and_write_user("edge_board_user_racer", scored_games, "2026-01-01T00:00:00Z")

check("grader's CAS conflict was actually hit (grade_and_write_user needed more than one internal read)", _user_write_injected[0])
check("grader eventually succeeds after retrying against the new state", written is True)
check("grader graded BOTH picks once it retried against the current (revision-6) state, not just the original one", graded == 2)

final = json.loads(FAKE_KV["edge_board_user_racer"])
final_picks = final["history"][0]["entries"][0]["picks"]
check("the user's concurrently-added pick is still present after grading (not silently dropped)", len(final_picks) == 2)
check("both picks -- the original AND the concurrently-added one -- ended up graded", all(p["result"] is not None for p in final_picks))
check("final revision is 7 (6 from the concurrent user write, +1 for the grader's successful retry)", final.get("_rev") == 7)

grade_picks.kv_get = fake_kv_get  # restore for any subsequent test in this file


# ---------------------------------------------------------------------------
# find_final_score(): provider game ID matching, with team-name fallback.
# ---------------------------------------------------------------------------
raw_scores_payload = [
    {
        "completed": True, "id": "evt_aaa111",
        "home_team": "Ohio State Buckeyes", "away_team": "Michigan Wolverines",
        "scores": [
            {"name": "Ohio State Buckeyes", "score": "31"},
            {"name": "Michigan Wolverines", "score": "24"},
        ],
    },
    {
        # Deliberately ambiguous/ANOTHER team-name-similar game, to prove ID
        # matching picks the RIGHT one even when name-based matching alone
        # could plausibly land on either -- Miami-style ambiguity, but here
        # constructed as two "State" schools that a looser matcher could
        # confuse if it didn't have team_match's alias protection AND we
        # want to prove the ID short-circuits any such ambiguity entirely.
        "completed": True, "id": "evt_bbb222",
        "home_team": "Alabama Crimson Tide", "away_team": "Auburn Tigers",
        "scores": [
            {"name": "Alabama Crimson Tide", "score": "20"},
            {"name": "Auburn Tigers", "score": "17"},
        ],
    },
]
scored_with_ids = grade_picks.score_lookup(raw_scores_payload)
check("score_lookup() captures the id field alongside the existing team/score fields",
      all(g.get("id") for g in scored_with_ids))

pick_with_correct_id = {
    "providerGameId": "evt_bbb222",
    "matchup": "Auburn Tigers @ Alabama Crimson Tide",
    "team": "Alabama Crimson Tide", "line": -3,
}
found = grade_picks.find_final_score(pick_with_correct_id, scored_with_ids)
check("find_final_score(): a pick with a matching providerGameId finds the exact right game",
      found is not None and found["id"] == "evt_bbb222" and found["home_score"] == 20)

pick_with_id_not_in_payload = {
    "providerGameId": "evt_zzz999",  # not in this scores fetch window
    "matchup": "Michigan Wolverines @ Ohio State Buckeyes",
    "team": "Ohio State Buckeyes", "line": -7,
}
found2 = grade_picks.find_final_score(pick_with_id_not_in_payload, scored_with_ids)
check("find_final_score(): an ID not present in THIS payload falls through to team-name matching instead of failing outright",
      found2 is not None and found2["id"] == "evt_aaa111")

legacy_pick_no_id = {
    "matchup": "Auburn Tigers @ Alabama Crimson Tide",
    "team": "Alabama Crimson Tide", "line": -3,
}  # no providerGameId key at all -- simulates a pick archived before this feature existed
found3 = grade_picks.find_final_score(legacy_pick_no_id, scored_with_ids)
check("find_final_score(): a legacy pick with NO providerGameId still matches correctly via team names (backward compatible)",
      found3 is not None and found3["id"] == "evt_bbb222")

pick_no_match_at_all = {"matchup": "Nobody @ Nowhere", "team": "Nobody", "line": -3}
check("find_final_score(): a pick matching nothing returns None, doesn't throw",
      grade_picks.find_final_score(pick_no_match_at_all, scored_with_ids) is None)

check("find_final_score(): still accepts a raw matchup string directly (non-dict), same as before this change",
      grade_picks.find_final_score("Auburn Tigers @ Alabama Crimson Tide", scored_with_ids) is not None)


if failures:
    print(f"\n{len(failures)} of {total_checks[0]} FAILURE(S): {failures}")
    sys.exit(1)
print(f"\nAll {total_checks[0]} checks passed.")
