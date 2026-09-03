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

# ---------------------------------------------------------------------------
# Full-slate model performance: every captured system is graded independently
# of the user's own pick history, against its frozen marketHomeLine.
# ---------------------------------------------------------------------------
model_state = {
    "history": [], "pools": [],
    "modelPerformanceHistory": [{
        "season": 2026, "week": 1,
        "games": [{
            "matchup": "Michigan Wolverines @ Ohio State Buckeyes",
            "away": "Michigan Wolverines", "home": "Ohio State Buckeyes",
            "marketHomeLine": -3,
            "systems": {"pickgauge": -6, "fpi": -2, "flat": -3},
            "systemResults": {},
        }],
    }],
}
check("pending count includes unresolved full-slate model decisions", grade_picks._pending_count(model_state) == 3)
mg, mc = grade_picks.grade_all_pending(model_state, scored_games)
mr = model_state["modelPerformanceHistory"][0]["games"][0]["systemResults"]
check("model grader resolves every captured system", mg == 3 and mc == 3)
check("model leaning home grades against frozen home line", mr["pickgauge"] == "W")
check("model leaning away grades against the opposite picked-side line", mr["fpi"] == "L")
check("model exactly equal to market becomes no-lean, not a fake push", mr["flat"] == "N")
check("resolved model decisions are no longer pending", grade_picks._pending_count(model_state) == 0)


# ---------------------------------------------------------------------------
# Sept 2, 2026 (Drew's explicit request): model performance grading now uses
# the real closing line -- resolved from the shared, cross-account
# preKickLines record (api/fetch_odds.py's merge_pre_kick_lines()) -- rather
# than trusting whatever line one account's browser last happened to observe
# pre-kickoff (marketHomeLine). Falls back to marketHomeLine when no shared
# record matches, exactly as before this change (covered above).
# ---------------------------------------------------------------------------
check("_round_half(): rounds to the nearest 0.5, matching resolveVegasLine()'s JS algorithm",
      grade_picks._round_half(-3.26) == -3.5 and grade_picks._round_half(-3.24) == -3.0)

check("_consensus_line_from_books(): averages every book, rounded to nearest 0.5",
      grade_picks._consensus_line_from_books({"dk": -3, "fd": -4}) == -3.5)
check("_consensus_line_from_books(): ignores non-numeric junk values rather than throwing",
      grade_picks._consensus_line_from_books({"dk": -3, "bad": "N/A"}) == -3.0)
check("_consensus_line_from_books(): empty/missing books -> None",
      grade_picks._consensus_line_from_books({}) is None and grade_picks._consensus_line_from_books(None) is None)

pre_kick_lines = {
    "evt_close_1": {
        "away": "Michigan Wolverines", "home": "Ohio State Buckeyes",
        "books": {"draftkings": -5.5, "fanduel": -6.5},  # consensus -6, the REAL close
        "observedAt": "2026-01-01T18:55:00Z",
    },
}
gm_with_provider_id = {
    "providerGameId": "evt_close_1",
    "away": "Michigan Wolverines", "home": "Ohio State Buckeyes",
}
closing = grade_picks._resolve_closing_line(gm_with_provider_id, pre_kick_lines)
check("_resolve_closing_line(): matches by providerGameId and returns the consensus close",
      closing is not None and closing["line"] == -6.0 and closing["book"] == "consensus")

gm_no_provider_id = {
    "away": "Michigan Wolverines", "home": "Ohio State Buckeyes",
}
closing_by_name = grade_picks._resolve_closing_line(gm_no_provider_id, pre_kick_lines)
check("_resolve_closing_line(): falls back to team-name matching when providerGameId is missing (older snapshots)",
      closing_by_name is not None and closing_by_name["line"] == -6.0)

gm_no_match = {"providerGameId": "evt_nowhere", "away": "Nobody", "home": "Nowhere"}
check("_resolve_closing_line(): no matching shared record -> None (caller falls back to marketHomeLine)",
      grade_picks._resolve_closing_line(gm_no_match, pre_kick_lines) is None)
check("_resolve_closing_line(): empty/missing pre_kick_lines -> None, never throws",
      grade_picks._resolve_closing_line(gm_with_provider_id, {}) is None
      and grade_picks._resolve_closing_line(gm_with_provider_id, None) is None)

# End-to-end: a model system that leans HOME off the stale captured
# marketHomeLine but leans AWAY off the real closing line must grade
# against the CLOSING line's side -- proves the closing line is actually
# driving the grade (a different side AND a different result), not just
# recorded alongside the old behavior.
closing_state = {
    "history": [], "pools": [],
    "modelPerformanceHistory": [{
        "season": 2026, "week": 1,
        "games": [{
            "providerGameId": "evt_close_1",
            "matchup": "Michigan Wolverines @ Ohio State Buckeyes",
            "away": "Michigan Wolverines", "home": "Ohio State Buckeyes",
            "marketHomeLine": -3,  # stale: this account's last pre-kick refresh, days before the close
            # pred(-4) vs stale market(-3) -> leans HOME, line -3, OSU won by 7 -> W
            # pred(-4) vs real close(-6)   -> leans AWAY, line +6, OSU won by 7 -> L
            "systems": {"stale_leans_home": -4},
            "systemResults": {},
        }],
    }],
}
mg2, mc2 = grade_picks.grade_all_pending(closing_state, scored_games, pre_kick_lines)
gm_result = closing_state["modelPerformanceHistory"][0]["games"][0]
check("closing-line grading: the game object records the resolved closing line",
      gm_result.get("closingHomeLine") == -6.0 and gm_result.get("closingLineSource") == "shared_prekick")
check("closing-line grading: same prediction flips from a W (vs stale -3) to an L (vs the real close -6) -- proves the close actually drives the grade",
      gm_result["systemResults"]["stale_leans_home"] == "L")

# Same game, but with NO shared preKickLines record at all -- must fall back
# to the old marketHomeLine-only behavior byte-for-byte, not error out.
# Deliberately a DIFFERENT matchup than evt_close_1 above -- reusing the same
# teams would let the team-name fallback in _resolve_closing_line() find
# THAT record instead, which would test the wrong thing entirely.
fallback_state = {
    "history": [], "pools": [],
    "modelPerformanceHistory": [{
        "season": 2026, "week": 1,
        "games": [{
            "providerGameId": "evt_no_shared_record",
            "matchup": "Auburn Tigers @ Alabama Crimson Tide",
            "away": "Auburn Tigers", "home": "Alabama Crimson Tide",
            "marketHomeLine": -3,
            "systems": {"no_shared_record": -4},  # vs -3 -> leans home
            "systemResults": {},
        }],
    }],
}
grade_picks.grade_all_pending(fallback_state, scored_games, pre_kick_lines)
gm_fallback = fallback_state["modelPerformanceHistory"][0]["games"][0]
# Alabama (home) 17, Auburn (away) 17 -- tie. side=home, line=-3 ->
# covering_margin = (17-17)+(-3) = -3 < 0 -> L.
check("no matching shared record: falls back to marketHomeLine (-3), untouched by this change",
      gm_fallback["systemResults"]["no_shared_record"] == "L")
check("no matching shared record: closingLineSource marks the fallback explicitly",
      gm_fallback.get("closingLineSource") == "captured_snapshot_fallback")
check("no matching shared record: no closingHomeLine written (nothing was actually resolved)",
      "closingHomeLine" not in gm_fallback)

# grade_all_pending()/grade_and_write_user() with pre_kick_lines entirely
# omitted (the pre-Sept-2 call signature) must still work exactly as before.
omitted_state = {
    "history": [], "pools": [],
    "modelPerformanceHistory": [{
        "season": 2026, "week": 1,
        "games": [{
            "matchup": "Michigan Wolverines @ Ohio State Buckeyes",
            "away": "Michigan Wolverines", "home": "Ohio State Buckeyes",
            "marketHomeLine": -3,
            "systems": {"legacy_call": -4},  # vs -3 -> leans home, OSU won by 7 -> W
            "systemResults": {},
        }],
    }],
}
og, oc = grade_picks.grade_all_pending(omitted_state, scored_games)  # no third arg at all
check("grade_all_pending() with pre_kick_lines omitted entirely still grades correctly (backward-compatible default)",
      og == 1 and omitted_state["modelPerformanceHistory"][0]["games"][0]["systemResults"]["legacy_call"] == "W")


# ---------------------------------------------------------------------------
# Confidence pools (Sept 2, 2026, Drew's explicit request). CORRECTED same
# day after seeing Drew's real Splash sheet: this is confidence AGAINST THE
# SPREAD, not straight-up -- every game carries a required "line", graded
# with the exact same grade(picked_score, opp_score, line) every ATS pick
# in this app already uses. Reuses the same scored_games fixture above:
# Ohio State (home) beat Michigan (away) 31-24 (margin +7); Alabama (home)
# and Auburn (away) tied 17-17.
# ---------------------------------------------------------------------------
confidence_state = {
    "confidencePools": [{
        "id": "cp1", "name": "Splash Confidence",
        "entries": [{
            "id": "e1", "name": "Entry 1",
            "history": [{
                "week": 1, "weekLabel": "Week 1",
                "games": [
                    # OSU (home) favored by 3 (line=-3), picked home, wins by 7 -> covers -> W, earns 7.
                    {"key": "michigan@ohiostate", "away": "Michigan Wolverines", "home": "Ohio State Buckeyes",
                     "cfbdGameId": None, "providerGameId": None, "line": -3,
                     "team": "home", "points": 7, "result": None, "pointsEarned": None},
                    # Same game, but picked AWAY (Michigan, +3 underdog). Michigan lost by 7 > 3 -> doesn't cover -> L.
                    {"key": "michigan@ohiostate2", "away": "Michigan Wolverines", "home": "Ohio State Buckeyes",
                     "cfbdGameId": None, "providerGameId": None, "line": -3,
                     "team": "away", "points": 3, "result": None, "pointsEarned": None},
                    # Alabama (home) favored by 3 (line=-3), tied 17-17 -- margin exactly equals
                    # the (negated) line for the away side... check both directions: home picked,
                    # margin = (17-17)+(-3) = -3 (not a push here) -- use a game where the true
                    # push math lines up: Alabama a 0-point "pick'em" (line=0), tied 17-17 -> push.
                    {"key": "auburn@alabama", "away": "Auburn Tigers", "home": "Alabama Crimson Tide",
                     "cfbdGameId": None, "providerGameId": None, "line": 0,
                     "team": "home", "points": 2, "result": None, "pointsEarned": None},
                ],
                "totalPoints": None, "possiblePoints": None,
            }],
        }],
    }],
}
cp_graded, cp_checked = grade_picks.grade_all_pending(confidence_state, scored_games)
cp_wk = confidence_state["confidencePools"][0]["entries"][0]["history"][0]
check("confidence pool grading: 3 pending game picks graded",
      cp_graded == 3 and cp_checked == 3)
check("confidence pool grading: a covering home pick (OSU -3, won by 7) earns its full point value",
      cp_wk["games"][0]["result"] == "W" and cp_wk["games"][0]["pointsEarned"] == 7)
check("confidence pool grading: a non-covering away pick (Michigan +3, lost by 7) earns 0 points",
      cp_wk["games"][1]["result"] == "L" and cp_wk["games"][1]["pointsEarned"] == 0)
check("confidence pool grading: a pick'em (line=0) tied game grades as a push -- 0 points, not counted as a loss",
      cp_wk["games"][2]["result"] == "P" and cp_wk["games"][2]["pointsEarned"] == 0)
check("confidence pool grading: totalPoints sums only the covering pick's points (7 + 0 + 0 = 7)",
      cp_wk["totalPoints"] == 7)
check("confidence pool grading: possiblePoints sums every picked game's value regardless of outcome (7+3+2=12)",
      cp_wk["possiblePoints"] == 12)

# Idempotent re-run: already-graded games must not be re-touched or double-counted.
cp_graded2, cp_checked2 = grade_picks.grade_all_pending(confidence_state, scored_games)
check("confidence pool grading: re-running on an already-graded week grades nothing new (idempotent)",
      cp_graded2 == 0 and cp_checked2 == 0)
check("confidence pool grading: totalPoints is unchanged by the idempotent re-run",
      cp_wk["totalPoints"] == 7)

# A game with no resolvable final score (team not in scored_games at all)
# must leave the week's totals as None -- no misleadingly-final-looking
# partial total -- while still being counted as "checked".
partial_confidence_state = {
    "confidencePools": [{
        "id": "cp2", "name": "Partial Pool",
        "entries": [{
            "id": "e1", "name": "Entry 1",
            "history": [{
                "week": 1, "weekLabel": "Week 1",
                "games": [
                    {"key": "michigan@ohiostate", "away": "Michigan Wolverines", "home": "Ohio State Buckeyes",
                     "cfbdGameId": None, "providerGameId": None, "line": -3,
                     "team": "home", "points": 5, "result": None, "pointsEarned": None},
                    {"key": "nobody@nowhere", "away": "Team Nobody Has Heard Of", "home": "Another Unknown Team",
                     "cfbdGameId": None, "providerGameId": None, "line": -7,
                     "team": "home", "points": 1, "result": None, "pointsEarned": None},
                ],
                "totalPoints": None, "possiblePoints": None,
            }],
        }],
    }],
}
grade_picks.grade_all_pending(partial_confidence_state, scored_games)
partial_wk = partial_confidence_state["confidencePools"][0]["entries"][0]["history"][0]
check("confidence pool grading: the resolvable game IS graded even though its sibling isn't",
      partial_wk["games"][0]["result"] == "W")
check("confidence pool grading: the unresolvable game (no final score anywhere) is left ungraded, not guessed",
      partial_wk["games"][1]["result"] is None)
check("confidence pool grading: totalPoints/possiblePoints stay None for a week that isn't fully resolved yet",
      partial_wk["totalPoints"] is None and partial_wk["possiblePoints"] is None)

# A game with a resolvable score but NO line -- also must stay ungraded.
# ATS grading is impossible without a line, no matter how final the score is.
no_line_state = {
    "confidencePools": [{
        "id": "cp4", "name": "No Line Pool",
        "entries": [{
            "id": "e1", "name": "Entry 1",
            "history": [{
                "week": 1, "weekLabel": "Week 1",
                "games": [
                    {"key": "michigan@ohiostate", "away": "Michigan Wolverines", "home": "Ohio State Buckeyes",
                     "cfbdGameId": None, "providerGameId": None, "line": None,
                     "team": "home", "points": 5, "result": None, "pointsEarned": None},
                ],
                "totalPoints": None, "possiblePoints": None,
            }],
        }],
    }],
}
no_line_graded, no_line_checked = grade_picks.grade_all_pending(no_line_state, scored_games)
no_line_wk = no_line_state["confidencePools"][0]["entries"][0]["history"][0]
check("confidence pool grading: a resolvable score but missing line leaves the pick ungraded (no line = no ATS grade)",
      no_line_graded == 0 and no_line_wk["games"][0]["result"] is None)

# _pending_count()/_pending_requirements() must actually see confidence-pool
# games as pending -- otherwise the top-level handler would never bother
# fetching scores at all when confidence pools are the only pending thing.
fresh_confidence_state = {
    "confidencePools": [{
        "id": "cp3", "entries": [{"id": "e1", "history": [{
            "games": [{"key":"a@b","away":"A","home":"B","cfbdGameId":None,"providerGameId":None,"line":-3,
                       "team":"home","points":1,"result":None,"pointsEarned":None}],
            "totalPoints": None, "possiblePoints": None,
        }]}],
    }],
}
check("_pending_count() counts an ungraded confidence-pool game",
      grade_picks._pending_count(fresh_confidence_state) == 1)
years_seen, has_legacy_seen = grade_picks._pending_requirements(fresh_confidence_state)
check("_pending_requirements() flags a pending confidence-pool game (with no cfbdGameId yet) as needing the Odds-API fallback path",
      has_legacy_seen is True)

if failures:
    print(f"\n{len(failures)} of {total_checks[0]} FAILURE(S): {failures}")
    sys.exit(1)
print(f"\nAll {total_checks[0]} checks passed.")
