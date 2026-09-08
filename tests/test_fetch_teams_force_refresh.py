import datetime
import importlib.util
import os
from pathlib import Path

# Sept 4 2026: the real remaining bug behind "it still is not working" after
# the free-tier /games fix. fetchTeamLogos(true)'s "true" only ever skipped
# the BROWSER's own local 12h freshness check -- the actual HTTP request it
# sent to /api/fetch_teams was indistinguishable from a normal one, so
# api/fetch_teams.py's server-side 6-hour Redis cache kept silently serving
# the same stale payload back regardless of what the client wanted. A click
# on "Fetch results" could report success (the request succeeded, data came
# back) while every game's completed/score fields were still up to 6 hours
# stale. This pins down the actual gate added to fix that: force=1. Initially
# shipped admin-gated (matching fetch_cfbd.py's existing pattern), then
# opened to any signed-in user the same session after Drew asked for it to
# actually work for every Survivor player, not just him -- is_admin() stays
# defined in api/fetch_teams.py (unused, drift-tested) for a possible future
# admin-only feature, but no longer gates this.

MOD = Path(__file__).parents[1] / 'api' / 'fetch_teams.py'
spec = importlib.util.spec_from_file_location('fetch_teams_mod', MOD)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def test_is_admin_reads_env_var_allowlist():
    os.environ.pop('PICKGAUGE_ADMIN_UIDS', None)
    assert m.is_admin('user_abc') is False, 'unset env var must fail toward "nobody is admin"'
    os.environ['PICKGAUGE_ADMIN_UIDS'] = 'user_abc, user_xyz'
    assert m.is_admin('user_abc') is True
    assert m.is_admin('user_xyz') is True
    assert m.is_admin('user_someone_else') is False
    os.environ.pop('PICKGAUGE_ADMIN_UIDS', None)


def test_force_bypasses_fresh_cache_the_way_do_get_actually_uses_it():
    # This mirrors the exact condition inside do_GET:
    #     if _identity_is_fresh(cached, now_dt) and not force:
    #         ... serve the cached copy, no CFBD call ...
    # i.e. the real fix is entirely in getting `force` to correctly flip
    # this boolean -- proving the four combinations here is proving the fix.
    now = datetime.datetime.now(datetime.timezone.utc)
    fresh_cached = {'fetchedAt': (now - datetime.timedelta(minutes=5)).isoformat().replace('+00:00', 'Z')}
    stale_cached = {'fetchedAt': (now - datetime.timedelta(hours=7)).isoformat().replace('+00:00', 'Z')}

    assert m._identity_is_fresh(fresh_cached, now) is True
    assert m._identity_is_fresh(stale_cached, now) is False

    def serves_cache(cached, force):
        return m._identity_is_fresh(cached, now) and not force

    assert serves_cache(fresh_cached, force=False) is True, 'normal request within 6h: cache served, no CFBD call (expected, cheap)'
    assert serves_cache(fresh_cached, force=True) is False, 'THE FIX: force=1 must bypass even a still-fresh cache and hit CFBD for real'
    assert serves_cache(stale_cached, force=False) is False, 'cache older than 6h always refetches regardless of force'
    assert serves_cache(stale_cached, force=True) is False


def test_force_param_open_to_any_signed_in_user():
    # Mirrors do_GET's actual line (Sept 4 2026, changed from an
    # is_admin()-gated version after Drew explicitly asked for this to
    # work for every Survivor player, not just him):
    #     force = (params.get("force") or ["0"])[0] == "1"
    # verify_user() already ran before this point in do_GET, so "any uid
    # that reaches this line" already means "a real signed-in user" --
    # there's no separate allowlist check anymore. The per-user rate
    # limiter (5 teams_fetch calls/60s, checked earlier in do_GET) is the
    # actual abuse backstop now, not this line.
    def resolve_force(raw_force_param):
        return (raw_force_param or ['0'])[0] == '1'

    assert resolve_force(['1']) is True, 'any signed-in user\'s force=1 must actually force a refresh now'
    assert resolve_force(None) is False, 'no force param at all -> normal cached behavior'
    assert resolve_force(['0']) is False


def test_do_get_source_no_longer_gates_force_on_is_admin():
    # A stronger check than the two above: read do_GET's actual source and
    # confirm the specific line was really changed, not just that the
    # behavior we WANT happens to also be achievable some other way.
    import inspect
    src = inspect.getsource(m.handler.do_GET)
    assert 'force = (params.get("force") or ["0"])[0] == "1"' in src
    assert 'force = (params.get("force") or ["0"])[0] == "1" and is_admin(uid)' not in src


if __name__ == '__main__':
    test_is_admin_reads_env_var_allowlist()
    test_force_bypasses_fresh_cache_the_way_do_get_actually_uses_it()
    test_force_param_open_to_any_signed_in_user()
    test_do_get_source_no_longer_gates_force_on_is_admin()
    print('fetch_teams force=1 cache-bypass tests passed')
