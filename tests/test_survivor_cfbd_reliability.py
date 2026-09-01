from pathlib import Path

root=Path(__file__).resolve().parents[1]
api=(root/"api/fetch_cfbd.py").read_text(encoding="utf-8")
adapter=(root/"app/js/survivor-data-adapter.js").read_text(encoding="utf-8")

assert "CFBD_HTTP_TIMEOUT_SECONDS = 15" in api
assert "KV_HTTP_TIMEOUT_SECONDS = 3" in api
assert "timeout=CFBD_HTTP_TIMEOUT_SECONDS" in api
assert api.count("timeout=KV_HTTP_TIMEOUT_SECONDS") >= 3

survivor=api[api.index("    def _handle_survivor"):api.index("    def _handle_boxscore")]
assert 'if not unavailable:' in survivor
assert 'staleFallbackSources' in survivor
assert 'payload["source"] = "mixed"' in survivor
assert '"pregame" in unavailable' in survivor
assert '"lines" in unavailable' in survivor

ensure=adapter[adapter.index("async function pgsEnsureSeasonEnrichment"):adapter.index("function pgsDirectWpForCanonical")]
assert "freshEnough" in ensure
assert "30*60*1000" in ensure
assert "2*60*1000" in ensure
assert "pgSurvivorEnrichment.status==='ready'&&pgSurvivorEnrichment.year===year)return" not in ensure

print("Survivor CFBD reliability guards passed")
