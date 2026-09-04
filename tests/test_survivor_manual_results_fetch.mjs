import fs from 'node:fs';
import assert from 'node:assert/strict';

// Sept 2026: Drew hit a real production bug (Clerk-token 401 on
// /api/fetch_cfbd?view=scoreboard) that silently starved the Survivor board
// of live scores for hours -- the old 90-second auto-render loop re-graded
// picks against whatever cfbdScoreboard already held in memory but never
// itself fetched anything new, and gave no visible signal that the
// underlying fetch was failing. This replaces that passive loop with an
// explicit "Fetch results" button that shows success/failure, including the
// real classified error message (auth vs missing-key vs offline) instead of
// a generic failure.

const integrationJs = fs.readFileSync(new URL('../app/js/survivor-integration.js', import.meta.url), 'utf8');
const insightsJs = fs.readFileSync(new URL('../app/js/cfbd-insights.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../app/css/survivor-integration.css', import.meta.url), 'utf8');

// The old passive Survivor-tab auto-render interval must be gone.
assert.doesNotMatch(
  integrationJs,
  /setInterval\(\(\)=>\{if\(document\.visibilityState!=="hidden"&&document\.getElementById\('tab-survivor'\)/,
  'the old 90-second Survivor auto-render interval should be removed'
);

// A manual fetch function must exist and must actually refresh final
// results from CFBD's free-tier /games endpoint (fetchTeamLogos(true) --
// see api/fetch_teams.py) as its PRIMARY source, not just the paid-tier
// live /scoreboard endpoint. fetchCfbdScoreboard is now best-effort only
// -- its failure must not be treated as the operation's overall result.
assert.match(integrationJs, /async function pgSurvivorFetchResultsNow\(\)/);
assert.match(integrationJs, /scheduleOk=await fetchTeamLogos\(true\)/);
assert.match(integrationJs, /fetchCfbdScoreboard\(true\)/);
// The scoreboard call's own failure must be caught locally and NOT allowed
// to override scheduleOk/scheduleErr -- it's inside its own try/catch that
// only console.warns, never sets pgSurvivorRuntime.resultsFetch itself.
assert.match(integrationJs, /best-effort live scoreboard fetch failed/);
// Refreshing cfbdGames alone is not enough -- Survivor's own candidate-
// game/matchup snapshot (pgSurvivorCandidateGames, pgSurvivorData()) is
// built once inside buildPickGaugeSurvivorData() and never otherwise
// invalidated, so a real rebuild via pgSurvivorEnsureSharedData(true) is
// required or every pick keeps showing "Pending" even after a successful
// network refresh (the actual bug this session, confirmed by Drew:
// "it says the results fetched but rutgers still says pending").
assert.match(integrationJs, /await pgSurvivorEnsureSharedData\(true\)/);
assert.match(integrationJs, /if\(scheduleOk\)\{\s*try\{\s*await pgSurvivorEnsureSharedData\(true\)/);

// It must guard against double-clicks while a fetch is already in flight.
assert.match(integrationJs, /resultsFetch\.status==='loading'\) return;/);

// The button must be real, delegated-click-wired markup, not a decoration.
assert.match(integrationJs, /data-survivor-fetch-results/);
assert.match(integrationJs, /e\.target\.closest\('\[data-survivor-fetch-results\]'\)/);
assert.match(integrationJs, /disabled/);

// Failure must surface the real message, not a generic "didn't work".
assert.match(integrationJs, /CFBD fetch failed: \$\{esc\(rf\.message/);

// The old blanket "Results: Live" claim (true regardless of whether the
// live fetch was actually succeeding) must be gone.
assert.doesNotMatch(integrationJs, />Results <strong>Live<\/strong></);

assert.match(css, /\.survivor-health-fetch\{/);
assert.match(css, /\.survivor-health-fetch-status\.error/);

// fetchCfbdScoreboard specifically must return a real result object
// (ok/kind/message) so callers can explain a failure, not a bare boolean
// that throws the reason away. (fetchCfbdRatings/fetchCfbdAdvanced are
// unrelated to this change and intentionally still return booleans.)
const scoreboardFnMatch = insightsJs.match(/async function fetchCfbdScoreboard\(force=false\)\{[\s\S]*?\n\}/);
assert.ok(scoreboardFnMatch, 'fetchCfbdScoreboard function body should be present');
const scoreboardFn = scoreboardFnMatch[0];
assert.doesNotMatch(scoreboardFn, /return false;/);
assert.match(scoreboardFn, /return \{ok:false,kind:result\.kind\|\|"other",message:result\.error/);
assert.match(scoreboardFn, /return \{ok:true,count:cfbdScoreboard\.length/);

console.log('Survivor manual results-fetch tests passed');
