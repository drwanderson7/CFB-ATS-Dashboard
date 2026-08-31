import importlib.util
from pathlib import Path

MOD=Path(__file__).parents[1]/'api'/'cfbd_survivor_enrichment.py'
spec=importlib.util.spec_from_file_location('surv_enrich',MOD)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def test_trim_and_endpoints():
    calls=[]
    def fetch(path,params):
        calls.append((path,params))
        if path.endswith('/pregame'):
            return [
                {'game_id':101,'week':1,'home_team':'A','away_team':'B','spread':-7.5,'home_win_probability':0.81},
                {'game_id':102,'home_win_probability':None},
            ]
        return [
            {'id':101,'week':1,'home_team':'A','away_team':'B','lines':[
                {'provider':'DraftKings','spread':-7},
                {'provider':'consensus','spread':-7.5,'spread_open':-6.5},
            ]}
        ]
    out=m.build_survivor_enrichment(2026,fetch)
    assert {c[0] for c in calls}=={'/metrics/wp/pregame','/lines'}
    assert all(c[1]['seasonType']=='regular' for c in calls)
    assert out['pregame']==[{'gameId':101,'week':1,'homeTeam':'A','awayTeam':'B','spread':-7.5,'homeWinProbability':0.81}]
    assert out['lines'][0]['gameId']==101
    assert len(out['lines'][0]['lines'])==2
    assert out['coverage']=={'pregameGames':1,'lineGames':1}
    assert out['unavailable']==[]



def test_partial_failure_keeps_remaining_source():
    def fetch(path,params):
        if path.endswith('/pregame'):
            raise RuntimeError('pregame temporarily unavailable')
        return [{'id':201,'lines':[{'provider':'consensus','spread':-4.5}]}]
    out=m.build_survivor_enrichment(2026,fetch)
    assert out['pregame']==[]
    assert out['lines'][0]['gameId']==201
    assert out['unavailable']==['pregame']


def test_total_failure_raises_for_handler_stale_fallback():
    def fetch(path,params):
        raise RuntimeError(path)
    try:
        m.build_survivor_enrichment(2026,fetch)
        assert False, 'expected total upstream failure to raise'
    except RuntimeError:
        pass

def test_missing_never_becomes_zero():
    assert m.trim_pregame([{'game_id':1,'home_win_probability':None}])==[]
    assert m.trim_pregame([{'game_id':1,'home_win_probability':False}])==[]
    assert m.trim_lines([{'id':1,'lines':[{'provider':'x','spread':None}]}])==[]

if __name__=='__main__':
    test_trim_and_endpoints();test_partial_failure_keeps_remaining_source();test_total_failure_raises_for_handler_stale_fallback();test_missing_never_becomes_zero();print('server helper tests passed')
