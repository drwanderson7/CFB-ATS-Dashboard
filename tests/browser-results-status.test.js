// Real browser interaction tests for automatic result tracking: entry status
// (PICK NEEDED / ALIVE / MISSING PICK / ELIMINATED / SURVIVED) and per-pick win/loss
// badges in My Picks. Previously covered only by results-ui.test.js's
// source-text regex checks (does app.js call evaluateEntryStatus()
// somewhere), which cannot prove any of these states actually render
// correctly — or render AT ALL, since demo mode (?demo=1) never generates a
// completed, scored game (confirmed: js/demo-data.js hardcodes
// `completed: false` everywhere), meaning this entire feature area has no
// way to be visually checked through the app's normal demo-preview path.
// These tests mock /api/survivor-data directly so real completed/scored
// games can be constructed, then drive the real UI — at a mobile viewport,
// doubling as a mobile-layout check for a feature area that was otherwise
// never actually seen rendered on a phone screen during development.

import assert from 'node:assert/strict';
import { withBrowserPage, assertNoErrors } from './browser-harness.js';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

function matchup({ gameId, week, team, opponent, teamPoints, opponentPoints, completed, startDate, winProbability = 0.6 }) {
  return {
    gameId, season: 2026, week, venue: null, startDate: startDate || '2026-09-05T17:00:00Z',
    completed: Boolean(completed), resultSource: 'CFBD /games', conferenceGame: true, lineProviders: 3,
    probabilitySource: 'CFBD pregame WP', probabilitySourceShort: 'WP',
    modelProjectedHomeMargin: null, homeSpRating: null, awaySpRating: null,
    eligibilityRule: 'Either team in a game involving a conference member is selectable.',
    team, opponent, isHome: true, isNeutral: false, isConferenceMember: true, opponentIsConferenceMember: false,
    teamPoints: teamPoints ?? null, opponentPoints: opponentPoints ?? null,
    winProbability, spread: '-7', spreadValue: -7, teamSpRating: null, opponentSpRating: null, modelProjectedMargin: null
  };
}

function apiResponse(matchups, weeks) {
  const teams = [...new Set(matchups.map(m => m.team))];
  return {
    year: 2026, poolId: 'sec', poolName: 'SEC Survivor', conference: 'SEC', cfbdConference: 'SEC',
    generatedAt: new Date().toISOString(), weeks, teams, memberTeams: teams, eligibleTeams: teams,
    eligibilityRule: 'Either team in any game listed by the 2026 SEC Splash survivor pool may be selected.',
    scheduleSource: 'SplashSports 2026 SEC pool schedule',
    scheduleRule: 'Only games listed by the SplashSports SEC survivor pool are eligible.',
    poolSchedule: { expectedGames: matchups.length / 2, matchedGames: matchups.length / 2, missingGames: [] },
    matchups,
    coverage: { eligibleGames: matchups.length / 2, selectableSides: matchups.length, direct: 0, spDerived: matchups.length, lineDerived: 0, missingProbability: 0 },
    model: { direct: 'CFBD /metrics/wp/pregame', fallback: 'SP+', tertiary: 'spread' },
    results: { source: 'CFBD /games', fields: ['completed', 'homePoints', 'awayPoints', 'startDate'], cacheSeconds: 120, manualRefreshBypassesCache: true },
    warnings: []
  };
}

async function mockApi(page, matchups, weeks) {
  const body = JSON.stringify(apiResponse(matchups, weeks));
  await page.route('**/api/survivor-data*', route => route.fulfill({ status: 200, contentType: 'application/json', body }));
}

async function seedPick(page, week, team) {
  await page.addInitScript(([w, t]) => {
    const key = 'cfb-survivor-state-v3:sec';
    const state = { entries: [{ id: 'e1', name: 'My Entry', picks: { [w]: t } }], activeEntryId: 'e1', currentWeek: Number(w), season: 2026 };
    localStorage.setItem(key, JSON.stringify(state));
  }, [String(week), team]);
}

// --- WIN ---
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  const matchups = [
    matchup({ gameId: 1, week: 1, team: 'Georgia', opponent: 'Alabama', teamPoints: 28, opponentPoints: 14, completed: true }),
    matchup({ gameId: 1, week: 1, team: 'Alabama', opponent: 'Georgia', teamPoints: 14, opponentPoints: 28, completed: true })
  ];
  await mockApi(page, matchups, [1]);
  await seedPick(page, 1, 'Georgia');
  await page.goto(baseURL + '/?year=2026', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const statusText = await page.textContent('#entryStatusBar');
  assert.match(statusText, /survived/i, 'an undefeated final listed week should mark the entry SURVIVED');
  const survivedBar = page.locator('.entry-status-bar.is-survived');
  assert.equal(await survivedBar.count() > 0, true, 'the survived state should apply the .is-survived styling class');

  await page.click('text=My Picks');
  await page.waitForTimeout(300);
  const pickHistory = await page.textContent('.pick-history');
  assert.match(pickHistory, /W\s*28.?14/, 'a completed win should show a W score badge in My Picks');
  const winBadge = page.locator('.pick-result.is-win');
  assert.equal(await winBadge.count() > 0, true, 'the win badge should have the .is-win styling class applied, not just the right text');

  await page.screenshot({ path: '/tmp/results_status_win_mobile.png', fullPage: true });
  assertNoErrors(consoleErrors, pageErrors, 'win state');
}, { viewport: MOBILE_VIEWPORT });
console.log('results status: WIN state test passed');

// --- LOSS / ELIMINATED ---
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  const matchups = [
    matchup({ gameId: 2, week: 1, team: 'Georgia', opponent: 'Alabama', teamPoints: 14, opponentPoints: 28, completed: true }),
    matchup({ gameId: 2, week: 1, team: 'Alabama', opponent: 'Georgia', teamPoints: 28, opponentPoints: 14, completed: true })
  ];
  await mockApi(page, matchups, [1]);
  await seedPick(page, 1, 'Georgia');
  await page.goto(baseURL + '/?year=2026', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const statusText = await page.textContent('#entryStatusBar');
  assert.match(statusText, /eliminated/i, 'a loss should mark the entry ELIMINATED');
  const eliminatedBar = page.locator('.entry-status-bar.is-eliminated');
  assert.equal(await eliminatedBar.count() > 0, true, 'the eliminated state should apply the .is-eliminated styling class, not just show the right text');

  await page.click('text=My Picks');
  await page.waitForTimeout(300);
  const pickHistory = await page.textContent('.pick-history');
  assert.match(pickHistory, /L\s*14.?28/, 'a completed loss should show an L score badge in My Picks');
  const lossBadge = page.locator('.pick-result.is-loss');
  assert.equal(await lossBadge.count() > 0, true, 'the loss badge should have the .is-loss styling class applied');

  await page.screenshot({ path: '/tmp/results_status_eliminated_mobile.png', fullPage: true });
  assertNoErrors(consoleErrors, pageErrors, 'eliminated state');
}, { viewport: MOBILE_VIEWPORT });
console.log('results status: ELIMINATED state test passed');

// --- MISSING PICK ---
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  const pastStart = '2020-01-01T17:00:00Z'; // long completed, so week 1 is unambiguously "in the past"
  const matchups = [
    matchup({ gameId: 3, week: 1, team: 'Georgia', opponent: 'Alabama', teamPoints: 28, opponentPoints: 14, completed: true, startDate: pastStart }),
    matchup({ gameId: 3, week: 1, team: 'Alabama', opponent: 'Georgia', teamPoints: 14, opponentPoints: 28, completed: true, startDate: pastStart }),
    matchup({ gameId: 4, week: 2, team: 'Georgia', opponent: 'Auburn', completed: false, startDate: '2099-09-12T17:00:00Z' }),
    matchup({ gameId: 4, week: 2, team: 'Auburn', opponent: 'Georgia', completed: false, startDate: '2099-09-12T17:00:00Z' })
  ];
  await mockApi(page, matchups, [1, 2]);
  // No pick at all for week 1, which has already completed — this entry
  // should be flagged as having missed a pick, not just quietly "alive".
  await page.addInitScript(() => {
    const state = { entries: [{ id: 'e1', name: 'My Entry', picks: {} }], activeEntryId: 'e1', currentWeek: 1, season: 2026 };
    localStorage.setItem('cfb-survivor-state-v3:sec', JSON.stringify(state));
  });
  await page.goto(baseURL + '/?year=2026', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const statusText = await page.textContent('#entryStatusBar');
  assert.match(statusText, /missing/i, 'a completed past week with no pick should be flagged as a missing pick, not silently ignored');

  await page.screenshot({ path: '/tmp/results_status_missing_mobile.png', fullPage: true });
  assertNoErrors(consoleErrors, pageErrors, 'missing-pick state');
}, { viewport: MOBILE_VIEWPORT });
console.log('results status: MISSING PICK state test passed');


// --- PICK NEEDED ---
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  const matchups = [
    matchup({ gameId: 50, week: 1, team: 'Georgia', opponent: 'Alabama', teamPoints: 28, opponentPoints: 14, completed: true, startDate: '2020-01-01T17:00:00Z' }),
    matchup({ gameId: 50, week: 1, team: 'Alabama', opponent: 'Georgia', teamPoints: 14, opponentPoints: 28, completed: true, startDate: '2020-01-01T17:00:00Z' }),
    matchup({ gameId: 51, week: 2, team: 'Texas', opponent: 'Auburn', completed: false, startDate: '2099-09-12T17:00:00Z' }),
    matchup({ gameId: 51, week: 2, team: 'Auburn', opponent: 'Texas', completed: false, startDate: '2099-09-12T17:00:00Z' })
  ];
  await mockApi(page, matchups, [1, 2]);
  await seedPick(page, 1, 'Georgia');
  await page.goto(baseURL + '/?year=2026', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const statusText = await page.textContent('#entryStatusBar');
  assert.match(statusText, /pick needed/i, 'an upcoming current week with no selection should show PICK NEEDED');
  const pickNeededBar = page.locator('.entry-status-bar.is-pick-needed');
  assert.equal(await pickNeededBar.count() > 0, true, 'PICK NEEDED should have its own visual state class');

  await page.screenshot({ path: '/tmp/results_status_pick_needed_mobile.png', fullPage: true });
  assertNoErrors(consoleErrors, pageErrors, 'pick-needed state');
}, { viewport: MOBILE_VIEWPORT });
console.log('results status: PICK NEEDED state test passed');


// --- DATA ISSUE ---
await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  const matchups = [
    matchup({ gameId: 60, week: 1, team: 'Georgia', opponent: 'Alabama', teamPoints: 28, opponentPoints: 14, completed: true, startDate: '2020-01-01T17:00:00Z' }),
    matchup({ gameId: 60, week: 1, team: 'Alabama', opponent: 'Georgia', teamPoints: 14, opponentPoints: 28, completed: true, startDate: '2020-01-01T17:00:00Z' }),
    matchup({ gameId: 61, week: 2, team: 'Texas', opponent: 'Auburn', completed: false, startDate: '2099-09-12T17:00:00Z' }),
    matchup({ gameId: 61, week: 2, team: 'Auburn', opponent: 'Texas', completed: false, startDate: '2099-09-12T17:00:00Z' })
  ];
  await mockApi(page, matchups, [1, 2]);
  await page.addInitScript(() => {
    const state = {
      entries: [{ id: 'e1', name: 'My Entry', picks: { 1: 'Georgia', 2: 'Ghost Team' } }],
      activeEntryId: 'e1',
      currentWeek: 2,
      season: 2026
    };
    localStorage.setItem('cfb-survivor-state-v3:sec', JSON.stringify(state));
  });
  await page.goto(baseURL + '/?year=2026', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const statusText = await page.textContent('#entryStatusBar');
  assert.match(statusText, /data issue/i, 'an unmapped saved pick must show DATA ISSUE rather than ALIVE');
  assert.match(statusText, /Ghost Team/i, 'the status should identify the saved team that cannot be mapped');
  const dataIssueBar = page.locator('.entry-status-bar.is-data-issue');
  assert.equal(await dataIssueBar.count() > 0, true, 'DATA ISSUE should have its own visual state class');

  await page.click('text=My Picks');
  await page.waitForTimeout(300);
  const resultBadge = page.locator('.pick-result.is-data-issue');
  assert.equal(await resultBadge.count() > 0, true, 'My Picks should surface the unmapped result as a data-issue badge');
  assert.match(await resultBadge.textContent(), /matchup unavailable/i);

  await page.screenshot({ path: '/tmp/results_status_data_issue_mobile.png', fullPage: true });
  assertNoErrors(consoleErrors, pageErrors, 'data-issue state');
}, { viewport: MOBILE_VIEWPORT });
console.log('results status: DATA ISSUE state test passed');
