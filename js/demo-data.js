import { getPool } from './pools.js';
import { SEC_POOL_SCHEDULE_2026 } from '../data/sec-pool-schedule-2026.js';
import { BIGTEN_POOL_SCHEDULE_2026 } from '../data/bigten-pool-schedule-2026.js';
import { DEFAULT_SURVIVOR_SEASON, isSupportedSurvivorSeason } from '../data/survivor-config.js';

const AUTHORITATIVE_SCHEDULES_2026 = { sec: SEC_POOL_SCHEDULE_2026, bigten: BIGTEN_POOL_SCHEDULE_2026 };

// Exposed so the UI chrome (brand subtitle, pool-rule badge, grid title) can
// say "Splash schedule" only for pools that actually have one, instead of
// hand-maintaining a separate "is this pool authoritative" list in app.js
// that could drift from what the schedule files actually cover.
export function hasAuthoritativeSchedule(poolId, year) {
  return Number(year) === 2026 && Boolean(AUTHORITATIVE_SCHEDULES_2026[poolId]);
}


function spreadText(value) {
  if (Math.abs(value) < 0.05) return 'PK';
  return `${value > 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(1)}`;
}

function hashText(text) {
  let hash = 0;
  for (const char of String(text)) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return hash;
}

// A fixed-per-team "power rating" (roughly an SP+-style scale, -18..+18),
// deterministic from the team name alone so the same team is equally strong
// in every game it plays. This replaces the previous demo model, which drew
// each game's probability independently from a per-*game* hash — that made
// every matchup roughly uniform between ~42% and ~95% regardless of whether
// it was a top team hosting a bottom-tier cupcake or two evenly matched
// conference rivals, so genuine blowouts (95%+) almost never appeared and
// features like the future-week scarcity strip (P4) had little to show:
// nearly every week looked "Very Hard" because essentially no demo game
// ever climbed above ~90%. Giving each team a fixed strength and deriving
// win probability from the *rating gap* (same margin -> normal-CDF approach
// api/survivor-data.js's real SP+ fallback uses) produces the kind of
// realistic spread real seasons have: some weeks stacked with lopsided
// favorites, others tightly contested.
function teamPowerRating(team) {
  const seed = hashText(`power|${team}`);
  return ((seed % 3601) / 100) - 18; // -18..+18
}

const DEMO_HOME_FIELD_POINTS = 2.5;
const DEMO_MARGIN_SD = 16.0;

function erf(value) {
  // Abramowitz & Stegun 7.1.26 approximation — same one api/survivor-data.js
  // uses for its real SP+-derived fallback, kept in sync for consistency.
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function demoHomeWinProbability(homeTeam, awayTeam) {
  const margin = (teamPowerRating(homeTeam) - teamPowerRating(awayTeam)) + DEMO_HOME_FIELD_POINTS;
  const raw = normalCdf(margin / DEMO_MARGIN_SD);
  return Math.max(0.03, Math.min(0.97, raw));
}

function buildExactPoolDemo(year, pool, schedule) {
  const members = new Set(pool.teams);
  const matchups = [];
  let id = pool.id === 'bigten' ? 950000 : 900000;

  for (const slot of schedule) {
    const [awayTeam, homeTeam] = slot.teams;
    const homeIsMember = members.has(homeTeam);
    const awayIsMember = members.has(awayTeam);
    const homeP = demoHomeWinProbability(homeTeam, awayTeam);
    const homeSpread = Math.round((0.5 - homeP) * 42 * 2) / 2;
    const gameId = id++;
    const startDate = new Date(Date.UTC(year, 8, 4 + (slot.week - 1) * 7, 17, 0)).toISOString();
    const common = {
      gameId,
      season: year,
      week: slot.week,
      isNeutral: false,
      venue: null,
      startDate,
      completed: false,
      conferenceGame: homeIsMember && awayIsMember,
      lineProviders: 4,
      probabilitySource: 'Demo model',
      probabilitySourceShort: 'Demo',
      poolScheduleSource: `SplashSports ${year} ${pool.conference} pool`,
      eligibilityRule: `Either team in a game listed by the ${year} ${pool.conference} Splash survivor pool is selectable.`
    };

    matchups.push(
      {
        ...common,
        team: homeTeam,
        opponent: awayTeam,
        isHome: true,
        isConferenceMember: homeIsMember,
        opponentIsConferenceMember: awayIsMember,
        teamPoints: null,
        opponentPoints: null,
        winProbability: homeP,
        spread: spreadText(homeSpread),
        spreadValue: homeSpread
      },
      {
        ...common,
        team: awayTeam,
        opponent: homeTeam,
        isHome: false,
        isConferenceMember: awayIsMember,
        opponentIsConferenceMember: homeIsMember,
        teamPoints: null,
        opponentPoints: null,
        winProbability: 1 - homeP,
        spread: spreadText(-homeSpread),
        spreadValue: -homeSpread
      }
    );
  }

  const eligibleTeams = [...new Set(matchups.map(matchup => matchup.team))].sort((a, b) => a.localeCompare(b));
  const weeks = [...new Set(schedule.map(slot => slot.week))].sort((a, b) => a - b);
  const expectedGames = schedule.length;
  // Generic gap detection (not hardcoded to a specific pool): if the schedule
  // is missing an entire week's worth of games — as Big Ten's was for Week 11
  // before it was supplied — say so instead of silently rendering an empty
  // week with no explanation.
  const presentWeeks = new Set(weeks);
  const gapWeeks = weeks.length ? Array.from({ length: Math.max(...weeks) }, (_, i) => i + 1).filter(w => !presentWeeks.has(w)) : [];
  const gapNote = gapWeeks.length
    ? [`Demo mode: week${gapWeeks.length === 1 ? '' : 's'} ${gapWeeks.join(', ')} of the ${pool.conference} Splash pool schedule ${gapWeeks.length === 1 ? 'has' : 'have'} not been supplied yet, so ${gapWeeks.length === 1 ? 'it has' : 'they have'} no demo games either.`]
    : [];

  return {
    year,
    poolId: pool.id,
    conference: pool.conference,
    generatedAt: new Date().toISOString(),
    weeks,
    teams: [...pool.teams],
    memberTeams: [...pool.teams],
    eligibleTeams,
    eligibilityRule: `Either team in any game listed by the ${year} ${pool.conference} Splash survivor pool may be selected.`,
    scheduleSource: `SplashSports ${year} ${pool.conference} pool schedule`,
    scheduleRule: `Only the ${expectedGames} games listed by the SplashSports ${pool.conference} survivor pool are eligible. Omitted games are excluded.`,
    poolSchedule: { expectedGames, matchedGames: expectedGames, missingGames: [] },
    coverage: {
      gamesFetched: expectedGames,
      eligibleGames: expectedGames,
      selectableSides: matchups.length,
      eligibleTeamMatchups: matchups.length,
      directPregame: 0,
      spDerived: 0,
      spreadDerived: 0,
      missingProbability: 0,
      spRatingsLoaded: 0
    },
    results: { source: 'Demo data', cacheSeconds: 0, manualRefreshBypassesCache: false },
    matchups,
    warnings: [
      `Demo mode: the ${pool.conference} game schedule matches the supplied SplashSports ${year} pool schedule; lines and probabilities are synthetic.`,
      ...gapNote
    ],
    demo: true
  };
}

export function buildDemoData(year = DEFAULT_SURVIVOR_SEASON, poolId = 'sec') {
  if (!isSupportedSurvivorSeason(year)) {
    throw new Error(`Demo mode only supports the ${DEFAULT_SURVIVOR_SEASON} authoritative Splash survivor schedule.`);
  }

  const pool = getPool(poolId);
  const schedule = AUTHORITATIVE_SCHEDULES_2026[poolId];
  if (!schedule) throw new Error(`No authoritative Splash survivor schedule is configured for ${poolId}.`);
  return buildExactPoolDemo(DEFAULT_SURVIVOR_SEASON, pool, schedule);
}
