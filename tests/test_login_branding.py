from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INIT = (ROOT / 'app' / 'js' / 'init.js').read_text(encoding='utf-8')


def test_embedded_clerk_signin_is_branded_pickgauge():
    assert 'start:{title:"Sign in to PickGauge"}' in INIT


def test_stale_edge_finder_brand_not_present_in_app_source():
    source = ''
    for path in (ROOT / 'app').rglob('*'):
        if path.is_file() and path.suffix.lower() in {'.js', '.html', '.css'}:
            source += path.read_text(encoding='utf-8', errors='ignore')
    assert 'Edge Finder' not in source
    assert 'EdgeFinder' not in source
