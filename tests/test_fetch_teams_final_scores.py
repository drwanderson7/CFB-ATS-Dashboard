import importlib.util
import json
from pathlib import Path

# Sept 4 2026 root-cause fix: api/grade_picks.py's daily cron grades picks
# fine off CFBD's /games endpoint (free tier, includes homePoints/
# awayPoints once a game is completed), but api/fetch_teams.py's
# trim_games() -- which feeds the browser's cfbdGames array that
# app/js/survivor-data-adapter.js already falls back to when the live
# /scoreboard endpoint is unavailable -- was dropping those two fields on
# the floor. The frontend fallback logic (cg.homePoints/cg.awayPoints) was
# already written and wired; it just never had real data to read. This
# pins down that the raw CFBD score fields now survive the trim.

MOD = Path(__file__).parents[1] / 'api' / 'fetch_teams.py'
spec = importlib.util.spec_from_file_location('fetch_teams_mod', MOD)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def test_trim_games_includes_final_score_fields():
    raw = json.dumps([
        {
            # The real Rutgers/Massachusetts game from the Sept 4 investigation.
            'id': 401858423, 'season': 2026, 'week': 1, 'seasonType': 'regular',
            'startDate': '2026-09-03T22:00:00Z', 'completed': True,
            'homeId': 164, 'homeTeam': 'Rutgers', 'homeConference': 'Big Ten', 'homeClassification': 'fbs',
            'awayId': 113, 'awayTeam': 'Massachusetts', 'awayConference': 'Mid-American', 'awayClassification': 'fbs',
            'homePoints': 34, 'awayPoints': 10, 'neutralSite': False,
        },
        {
            # A not-yet-final game: CFBD sends null points. trim_games() must
            # pass that through as None, never invent a 0-0 score.
            'id': 500, 'season': 2026, 'week': 1, 'seasonType': 'regular',
            'startDate': '2026-09-05T00:00:00Z', 'completed': False,
            'homeId': 2, 'homeTeam': 'Ohio State', 'homeConference': 'Big Ten', 'homeClassification': 'fbs',
            'awayId': 3, 'awayTeam': 'Indiana', 'awayConference': 'Big Ten', 'awayClassification': 'fbs',
            'homePoints': None, 'awayPoints': None, 'neutralSite': False,
        },
    ])
    out = m.trim_games(raw)
    assert len(out) == 2

    rutgers = next(g for g in out if g['id'] == 401858423)
    assert rutgers['completed'] is True
    assert rutgers['homePoints'] == 34
    assert rutgers['awayPoints'] == 10

    pending = next(g for g in out if g['id'] == 500)
    assert pending['completed'] is False
    assert pending['homePoints'] is None
    assert pending['awayPoints'] is None


if __name__ == '__main__':
    test_trim_games_includes_final_score_fields()
    print('fetch_teams trim_games final-score field tests passed')
