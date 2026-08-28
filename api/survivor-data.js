import { applySecPoolSchedule, SEC_POOL_WEEK_GAME_COUNTS_2026 } from '../data/sec-pool-schedule-2026.js';
import { applyBigTenPoolSchedule, BIGTEN_POOL_WEEK_GAME_COUNTS_2026 } from '../data/bigten-pool-schedule-2026.js';
import { POOL_DEFINITIONS } from '../data/pool-teams.js';
import { DEFAULT_SURVIVOR_SEASON, SUPPORTED_SURVIVOR_SEASONS, isSupportedSurvivorSeason } from '../data/survivor-config.js';

const CFBD_BASE = 'https://api.collegefootballdata.com';

const POOLS = POOL_DEFINITIONS;

// Authoritative pool-provider schedule appliers, keyed by pool id. A pool
// listed here uses its provider's own eligible-game list (Splash) instead of
// naive "any game involving a conference member" filtering. Adding a new
// pool's authoritative schedule is just adding an entry here plus a
// data/<pool>-pool-schedule-<year>.js file — no other handler changes needed.
const POOL_SCHEDULE_APPLIERS = {
  sec: applySecPoolSchedule,
  bigten: applyBigTenPoolSchedule
};

// Per-week game counts for each pool's authoritative schedule, used only to
// detect and warn about weeks that haven't been transcribed into the
// schedule file yet (a `null` entry) — see the Week 11 note in
// data/bigten-pool-schedule-2026.js. A pool without a known gap simply has no
// `null` entries here and produces no such warning.
const POOL_SCHEDULE_WEEK_COUNTS = {
  sec: SEC_POOL_WEEK_GAME_COUNTS_2026,
  bigten: BIGTEN_POOL_WEEK_GAME_COUNTS_2026
};

// SP+ is expressed in points relative to an average team, so the rating
// difference is a neutral-field projected margin. We add a modest home-field
// adjustment, then convert margin to win probability with a normal CDF.
// The 16-point game-margin SD is intentionally conservative for CFB.
const HOME_FIELD_POINTS = 2.5;
const CFB_MARGIN_SD = 16.0;
const MODEL_MIN_PROBABILITY = 0.01;
const MODEL_MAX_PROBABILITY = 0.99;

export function asNumber(value) {
  // Number(null), Number(''), and Number(false) are all 0 in JavaScript.
  // Those values represent missing API data here and must never become 0%.
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function clampProbability(value) {
  const number = asNumber(value);
  if (number === null) return null;
  if (number > 1 && number <= 100) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
}

function erf(value) {
  // Abramowitz & Stegun 7.1.26 approximation.
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

function clampModelProbability(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(MODEL_MIN_PROBABILITY, Math.min(MODEL_MAX_PROBABILITY, value));
}

export function winProbabilityFromMargin(projectedMargin, marginSd = CFB_MARGIN_SD) {
  const margin = asNumber(projectedMargin);
  const sd = asNumber(marginSd);
  if (margin === null || sd === null || sd <= 0) return null;
  return clampModelProbability(normalCdf(margin / sd));
}

async function cfbd(path, params, apiKey) {
  const url = new URL(path, CFBD_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`CFBD ${response.status}: ${body.slice(0, 180)}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function chooseConsensusLine(lineGame) {
  const lines = Array.isArray(lineGame?.lines) ? lineGame.lines : [];
  const valid = lines.filter(line => asNumber(line?.spread) !== null);
  if (!valid.length) return { spread: null, providerCount: 0 };

  const sorted = valid.map(line => Number(line.spread)).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  return {
    spread: median,
    providerCount: valid.length
  };
}

function formatTeamSpread(isHome, homeSpread) {
  if (homeSpread === null) return null;
  const teamSpread = isHome ? homeSpread : -homeSpread;
  if (Math.abs(teamSpread) < 0.05) return 'PK';
  return `${teamSpread > 0 ? '+' : ''}${Number.isInteger(teamSpread) ? teamSpread : teamSpread.toFixed(1)}`;
}

function ratingMap(rows) {
  return new Map((Array.isArray(rows) ? rows : [])
    .map(row => [row?.team, asNumber(row?.rating)])
    .filter(([team, rating]) => team && rating !== null));
}

export function deriveHomeProbability(game, line, directHomeWP, spByTeam) {
  const direct = clampProbability(directHomeWP);
  if (direct !== null) {
    return {
      homeWinProbability: direct,
      source: 'CFBD pregame WP',
      sourceShort: 'WP',
      projectedMargin: null,
      homeRating: null,
      awayRating: null
    };
  }

  const homeRating = spByTeam.get(game.homeTeam) ?? null;
  const awayRating = spByTeam.get(game.awayTeam) ?? null;
  if (homeRating !== null && awayRating !== null) {
    const homeField = game.neutralSite ? 0 : HOME_FIELD_POINTS;
    const projectedMargin = homeRating - awayRating + homeField;
    return {
      homeWinProbability: winProbabilityFromMargin(projectedMargin),
      source: 'SP+ derived',
      sourceShort: 'SP+',
      projectedMargin,
      homeRating,
      awayRating
    };
  }

  // Last-resort coverage for games where SP+ does not rate the opponent
  // (commonly FCS). A market spread is still preferable to fabricating 0%.
  if (line.spread !== null) {
    const projectedMargin = -line.spread;
    return {
      homeWinProbability: winProbabilityFromMargin(projectedMargin),
      source: 'Spread derived',
      sourceShort: 'Line',
      projectedMargin,
      homeRating: null,
      awayRating: null
    };
  }

  return {
    homeWinProbability: null,
    source: null,
    sourceShort: null,
    projectedMargin: null,
    homeRating,
    awayRating
  };
}

export function normalizeGame(game, members, linesByGame, wpByGame, spByTeam) {
  const memberHome = members.has(game.homeTeam);
  const memberAway = members.has(game.awayTeam);
  if (!memberHome && !memberAway) return [];

  const line = chooseConsensusLine(linesByGame.get(Number(game.id)));
  const wp = wpByGame.get(Number(game.id));
  const model = deriveHomeProbability(game, line, wp?.homeWinProbability, spByTeam);
  const homeWP = model.homeWinProbability;

  const common = {
    gameId: Number(game.id),
    season: Number(game.season),
    week: Number(game.week),
    venue: game.venue || null,
    startDate: game.startDate || null,
    completed: Boolean(game.completed),
    resultSource: 'CFBD /games',
    conferenceGame: Boolean(game.conferenceGame),
    lineProviders: line.providerCount,
    probabilitySource: model.source,
    probabilitySourceShort: model.sourceShort,
    modelProjectedHomeMargin: model.projectedMargin,
    homeSpRating: model.homeRating,
    awaySpRating: model.awayRating,
    eligibilityRule: 'Either team in a game involving a conference member is selectable.'
  };

  // Survivor eligibility is game-based, not membership-based. Once a game contains
  // at least one pool member, BOTH sides are valid survivor picks. This intentionally
  // includes non-conference and FCS opponents.
  return [
    {
      ...common,
      team: game.homeTeam,
      opponent: game.awayTeam,
      isHome: !game.neutralSite,
      isNeutral: Boolean(game.neutralSite),
      isConferenceMember: memberHome,
      opponentIsConferenceMember: memberAway,
      teamPoints: asNumber(game.homePoints),
      opponentPoints: asNumber(game.awayPoints),
      winProbability: homeWP,
      spread: formatTeamSpread(true, line.spread),
      spreadValue: line.spread,
      teamSpRating: model.homeRating,
      opponentSpRating: model.awayRating,
      modelProjectedMargin: model.projectedMargin
    },
    {
      ...common,
      team: game.awayTeam,
      opponent: game.homeTeam,
      isHome: false,
      isNeutral: Boolean(game.neutralSite),
      isConferenceMember: memberAway,
      opponentIsConferenceMember: memberHome,
      teamPoints: asNumber(game.awayPoints),
      opponentPoints: asNumber(game.homePoints),
      winProbability: homeWP === null ? null : 1 - homeWP,
      spread: formatTeamSpread(false, line.spread),
      spreadValue: line.spread === null ? null : -line.spread,
      teamSpRating: model.awayRating,
      opponentSpRating: model.homeRating,
      modelProjectedMargin: model.projectedMargin === null ? null : -model.projectedMargin
    }
  ];
}

function coverageSummary(matchups, gamesFetched, spByTeam) {
  const bySource = matchups.reduce((acc, matchup) => {
    const key = matchup.probabilitySource || 'Missing';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    gamesFetched,
    eligibleGames: new Set(matchups.map(matchup => matchup.gameId)).size,
    selectableSides: matchups.length,
    eligibleTeamMatchups: matchups.length,
    directPregame: bySource['CFBD pregame WP'] || 0,
    spDerived: bySource['SP+ derived'] || 0,
    spreadDerived: bySource['Spread derived'] || 0,
    missingProbability: bySource.Missing || 0,
    spRatingsLoaded: spByTeam.size
  };
}

export default async function handler(req, res) {
  const requestedYear = Number(req.query.year) || DEFAULT_SURVIVOR_SEASON;
  const forceFresh = String(req.query.fresh || '') === '1';

  // Pool eligibility is only trustworthy for years where we have an
  // authoritative SplashSports allowlist. Never silently serve a generic
  // conference schedule for an unsupported year; that changes the contest's
  // selectable games and can generate invalid survivor recommendations.
  if (!isSupportedSurvivorSeason(requestedYear)) {
    res.setHeader?.('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    return res.status(400).json({
      error: `Only the ${SUPPORTED_SURVIVOR_SEASONS.join(', ')} Splash survivor schedule is supported.`,
      unsupportedSeason: requestedYear,
      supportedSeasons: [...SUPPORTED_SURVIVOR_SEASONS]
    });
  }

  const year = requestedYear;
  const mode = String(req.query.mode || '').toLowerCase() === 'results' ? 'results' : 'full';
  res.setHeader?.('Cache-Control', forceFresh
    ? 'private, no-store, max-age=0, must-revalidate'
    : mode === 'results'
      ? 'public, s-maxage=60, stale-while-revalidate=120'
      : 'public, s-maxage=120, stale-while-revalidate=300');
  const poolId = req.query.pool === 'bigten' ? 'bigten' : 'sec';
  const pool = POOLS[poolId];
  const members = new Set(pool.teams);
  const apiKey = process.env.CFBD_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: 'CFBD_API_KEY is not configured on the server.',
      setupRequired: true
    });
  }

  try {
    // Frequent live-result polling deliberately takes a lightweight path.
    // The browser already has schedule/model/line data from the full load, so
    // re-fetching those inputs every five minutes only wastes CFBD quota. One
    // /games call is enough to patch kickoff times, completion, and scores.
    if (mode === 'results') {
      const rows = await cfbd('/games', { year, seasonType: 'regular', conference: pool.cfbdConference }, apiKey);
      const games = (Array.isArray(rows) ? rows : []).map(game => ({
        gameId: Number(game?.id),
        homeTeam: game?.homeTeam || null,
        awayTeam: game?.awayTeam || null,
        startDate: game?.startDate || null,
        completed: Boolean(game?.completed),
        homePoints: asNumber(game?.homePoints),
        awayPoints: asNumber(game?.awayPoints)
      })).filter(game => Number.isFinite(game.gameId));
      const generatedAt = new Date().toISOString();
      return res.status(200).json({
        year,
        poolId: pool.id,
        mode: 'results',
        generatedAt,
        games,
        results: {
          source: 'CFBD /games',
          fields: ['completed', 'homePoints', 'awayPoints', 'startDate'],
          gamesFetched: games.length,
          cacheSeconds: forceFresh ? 0 : 60,
          manualRefreshBypassesCache: true
        }
      });
    }
    // CFBD's conventional Big Ten abbreviation is B1G. Use the API abbreviation first
    // (which also returns non-conference games involving a member), then fall back to the
    // full regular-season schedule if a conference alias ever returns no schedule data.
    const [gamesResult, linesResult, wpResult, spResult] = await Promise.allSettled([
      cfbd('/games', { year, seasonType: 'regular', conference: pool.cfbdConference }, apiKey),
      cfbd('/lines', { year, seasonType: 'regular', conference: pool.cfbdConference }, apiKey),
      cfbd('/metrics/wp/pregame', { year, seasonType: 'regular' }, apiKey),
      cfbd('/ratings/sp', { year }, apiKey)
    ]);

    if (gamesResult.status !== 'fulfilled') throw gamesResult.reason;

    let games = Array.isArray(gamesResult.value) ? gamesResult.value : [];
    let lines = linesResult.status === 'fulfilled' && Array.isArray(linesResult.value) ? linesResult.value : [];
    let scheduleFallbackUsed = false;
    let linesFallbackUsed = false;
    let poolSchedule = null;

    // Some pools (currently SEC and Big Ten for 2026) have an authoritative
    // provider ("Splash") schedule that does NOT match every game involving a
    // conference team — the published pool listing omits certain games
    // (notably non-FBS opponents). Where one exists, match CFBD's game
    // records to that authoritative list and use the pool's own week
    // numbering for the board/rankings/planner, instead of naive
    // "any game involving a member" filtering.
    const scheduleApplier = POOL_SCHEDULE_APPLIERS[poolId];
    if (scheduleApplier && year === 2026) {
      poolSchedule = scheduleApplier(games, year);

      // If the conference-filtered CFBD response did not contain every listed
      // pool game, supplement it with the complete regular-season schedule.
      if (poolSchedule.matchedGames < poolSchedule.expectedGames) {
        const fullGames = await cfbd('/games', { year, seasonType: 'regular' }, apiKey);
        const merged = new Map();
        for (const game of [...games, ...(Array.isArray(fullGames) ? fullGames : [])]) {
          const key = Number(game?.id);
          if (Number.isFinite(key)) merged.set(key, game);
        }
        poolSchedule = scheduleApplier([...merged.values()], year);
        scheduleFallbackUsed = true;
      }

      games = poolSchedule.games;
    } else if (!games.length) {
      games = await cfbd('/games', { year, seasonType: 'regular' }, apiKey);
      scheduleFallbackUsed = true;
    }

    if (!lines.length && linesResult.status === 'fulfilled') {
      lines = await cfbd('/lines', { year, seasonType: 'regular' }, apiKey);
      linesFallbackUsed = true;
    }
    const probabilities = wpResult.status === 'fulfilled' && Array.isArray(wpResult.value) ? wpResult.value : [];
    const spRatings = spResult.status === 'fulfilled' && Array.isArray(spResult.value) ? spResult.value : [];

    const linesByGame = new Map(lines.map(item => [Number(item.id), item]));
    const wpByGame = new Map(probabilities.map(item => [Number(item.gameId), item]));
    const spByTeam = ratingMap(spRatings);

    const relevantGames = games.filter(game => members.has(game.homeTeam) || members.has(game.awayTeam));
    const matchups = relevantGames
      .flatMap(game => normalizeGame(game, members, linesByGame, wpByGame, spByTeam))
      .sort((a, b) => a.week - b.week || a.team.localeCompare(b.team));
    const eligibleTeams = [...new Set(matchups.map(item => item.team))].sort((a, b) => a.localeCompare(b));

    const weeks = [...new Set(matchups.map(item => item.week))].sort((a, b) => a - b);
    const coverage = coverageSummary(matchups, games.length, spByTeam);
    const hasAuthoritativeSchedule = Boolean(scheduleApplier && year === 2026);
    const weekCounts = POOL_SCHEDULE_WEEK_COUNTS[poolId] || [];
    const gapWeeks = hasAuthoritativeSchedule
      ? weekCounts.map((count, index) => (count === null ? index + 1 : null)).filter(week => week !== null)
      : [];
    const warnings = [
      ...(scheduleFallbackUsed && !hasAuthoritativeSchedule ? [`CFBD conference filter ${pool.cfbdConference} returned no games; used the full regular-season schedule fallback.`] : []),
      ...(scheduleFallbackUsed && hasAuthoritativeSchedule ? [`The full CFBD schedule was used to supplement the authoritative ${year} ${pool.conference} Splash pool schedule.`] : []),
      ...(poolSchedule?.missing?.length ? [`${poolSchedule.missing.length} game${poolSchedule.missing.length === 1 ? '' : 's'} from the ${year} ${pool.conference} Splash pool schedule could not be matched to CFBD.`] : []),
      ...(gapWeeks.length ? [`Week${gapWeeks.length === 1 ? '' : 's'} ${gapWeeks.join(', ')} of the ${year} ${pool.conference} Splash pool schedule ${gapWeeks.length === 1 ? 'has' : 'have'} not been supplied yet and will show no eligible games until added.`] : []),
      ...(linesFallbackUsed ? [`CFBD conference filter ${pool.cfbdConference} returned no lines; used the full-season lines fallback.`] : []),
      ...(linesResult.status === 'rejected' ? ['Betting lines were unavailable from CFBD for this request.'] : []),
      ...(wpResult.status === 'rejected' ? ['Direct CFBD pregame win probability was unavailable; derived probabilities will be used where possible.'] : []),
      ...(spResult.status === 'rejected' ? ['SP+ ratings were unavailable; missing direct probabilities will fall back to betting spreads where possible.'] : []),
      ...(matchups.length === 0 ? [`No scheduled games involved a ${pool.conference} team.`] : []),
      ...(coverage.missingProbability > 0 ? [`${coverage.missingProbability} selectable side${coverage.missingProbability === 1 ? '' : 's'} still ${coverage.missingProbability === 1 ? 'lacks' : 'lack'} enough data for a probability.`] : [])
    ];

    const generatedAt = new Date().toISOString();
    return res.status(200).json({
      year,
      mode: 'full',
      poolId: pool.id,
      poolName: pool.name,
      conference: pool.conference,
      cfbdConference: pool.cfbdConference,
      generatedAt,
      modelGeneratedAt: generatedAt,
      weeks,
      teams: [...pool.teams],
      memberTeams: [...pool.teams],
      eligibleTeams,
      eligibilityRule: hasAuthoritativeSchedule
        ? `Either team in any game listed by the ${year} ${pool.conference} Splash survivor pool may be selected.`
        : `Either team in any game involving a ${pool.conference} team may be selected.`,
      scheduleSource: hasAuthoritativeSchedule ? `SplashSports ${year} ${pool.conference} pool schedule` : 'CFBD conference schedule',
      scheduleRule: hasAuthoritativeSchedule
        ? `Only games listed by the SplashSports ${pool.conference} survivor pool are eligible; omitted games are excluded even when a ${pool.conference} team participates.`
        : `Games involving a ${pool.conference} member are eligible.`,
      poolSchedule: poolSchedule ? {
        expectedGames: poolSchedule.expectedGames,
        matchedGames: poolSchedule.matchedGames,
        missingGames: poolSchedule.missing.map(slot => ({ week: slot.week, teams: [...slot.teams] }))
      } : null,
      matchups,
      coverage,
      model: {
        direct: 'CFBD /metrics/wp/pregame',
        fallback: 'CFBD SP+ rating differential + 2.5-point home field, converted with 16.0-point CFB margin SD',
        tertiary: 'Consensus betting spread converted with the same margin distribution when SP+ cannot rate both teams'
      },
      results: {
        source: 'CFBD /games',
        fields: ['completed', 'homePoints', 'awayPoints', 'startDate'],
        cacheSeconds: forceFresh ? 0 : 120,
        manualRefreshBypassesCache: true
      },
      warnings
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: error?.message || 'Unable to load CFBD data.'
    });
  }
}
