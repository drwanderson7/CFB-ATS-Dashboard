// Authoritative 2026 Big Ten survivor-pool schedule transcribed from the
// user's Splash pool screenshots on 2026-08-26. Mirrors the SEC pool's
// approach: only games listed by the pool are eligible, rather than every
// game involving a Big Ten team. Team names below are stripped of mascots to
// match CFBD's `homeTeam`/`awayTeam` school-name convention (the same
// convention already used by data/sec-pool-schedule-2026.js and
// js/pools.js/api/survivor-data.js for the 18 Big Ten members).
//
// Full 13-week schedule (122 games), including Week 11 (supplied separately
// from the initial screenshots, added 2026-08-26).

import { createScheduleMatcher } from './pool-schedule-utils.js';

export const BIGTEN_POOL_SCHEDULE_2026 = [
  // Week 1 — 14 games
  { week: 1, teams: ['UMass', 'Rutgers'] },
  { week: 1, teams: ['UAB', 'Illinois'] },
  { week: 1, teams: ['Toledo', 'Michigan State'] },
  { week: 1, teams: ['Fresno State', 'USC'] },
  { week: 1, teams: ['Ohio', 'Nebraska'] },
  { week: 1, teams: ['North Texas', 'Indiana'] },
  { week: 1, teams: ['Ball State', 'Ohio State'] },
  { week: 1, teams: ['Boise State', 'Oregon'] },
  { week: 1, teams: ['Marshall', 'Penn State'] },
  { week: 1, teams: ['Northern Illinois', 'Iowa'] },
  { week: 1, teams: ['Western Michigan', 'Michigan'] },
  { week: 1, teams: ['UCLA', 'California'] },
  { week: 1, teams: ['Washington State', 'Washington'] },
  { week: 1, teams: ['Wisconsin', 'Notre Dame'] },

  // Week 2 — 15 games
  { week: 2, teams: ['Rutgers', 'Boston College'] },
  { week: 2, teams: ['Penn State', 'Temple'] },
  { week: 2, teams: ['Oregon', 'Oklahoma State'] },
  { week: 2, teams: ['Oklahoma', 'Michigan'] },
  { week: 2, teams: ['Wake Forest', 'Purdue'] },
  { week: 2, teams: ['Maryland', 'UConn'] },
  { week: 2, teams: ['Duke', 'Illinois'] },
  { week: 2, teams: ['Utah State', 'Washington'] },
  { week: 2, teams: ['Mississippi State', 'Minnesota'] },
  { week: 2, teams: ['Eastern Michigan', 'Michigan State'] },
  { week: 2, teams: ['Bowling Green', 'Nebraska'] },
  { week: 2, teams: ['San Diego State', 'UCLA'] },
  { week: 2, teams: ['Iowa State', 'Iowa'] },
  { week: 2, teams: ['Ohio State', 'Texas'] },
  { week: 2, teams: ['Louisiana', 'USC'] },

  // Week 3 — 11 games
  { week: 3, teams: ['Kent State', 'Ohio State'] },
  { week: 3, teams: ['Buffalo', 'Penn State'] },
  { week: 3, teams: ['Akron', 'Minnesota'] },
  { week: 3, teams: ['Eastern Michigan', 'Wisconsin'] },
  { week: 3, teams: ['USC', 'Rutgers'] },
  { week: 3, teams: ['UTEP', 'Michigan'] },
  { week: 3, teams: ['Western Kentucky', 'Indiana'] },
  { week: 3, teams: ['Colorado', 'Northwestern'] },
  { week: 3, teams: ['Virginia Tech', 'Maryland'] },
  { week: 3, teams: ['Michigan State', 'Notre Dame'] },
  { week: 3, teams: ['Purdue', 'UCLA'] },

  // Week 4 — 9 games
  { week: 4, teams: ['Northwestern', 'Indiana'] },
  { week: 4, teams: ['Notre Dame', 'Purdue'] },
  { week: 4, teams: ['Illinois', 'Ohio State'] },
  { week: 4, teams: ['Nebraska', 'Michigan State'] },
  { week: 4, teams: ['Iowa', 'Michigan'] },
  { week: 4, teams: ['Oregon', 'USC'] },
  { week: 4, teams: ['Minnesota', 'Washington'] },
  { week: 4, teams: ['Wisconsin', 'Penn State'] },
  { week: 4, teams: ['UCLA', 'Maryland'] },

  // Week 5 — 8 games
  { week: 5, teams: ['Penn State', 'Northwestern'] },
  { week: 5, teams: ['Ohio State', 'Iowa'] },
  { week: 5, teams: ['Purdue', 'Illinois'] },
  { week: 5, teams: ['Maryland', 'Nebraska'] },
  { week: 5, teams: ['Michigan', 'Minnesota'] },
  { week: 5, teams: ['Michigan State', 'Wisconsin'] },
  { week: 5, teams: ['Washington', 'USC'] },
  { week: 5, teams: ['Indiana', 'Rutgers'] },

  // Week 6 — 8 games
  { week: 6, teams: ['Iowa', 'Washington'] },
  { week: 6, teams: ['Ball State', 'Northwestern'] },
  { week: 6, teams: ['Indiana', 'Nebraska'] },
  { week: 6, teams: ['UCLA', 'Oregon'] },
  { week: 6, teams: ['Illinois', 'Michigan State'] },
  { week: 6, teams: ['Maryland', 'Ohio State'] },
  { week: 6, teams: ['Minnesota', 'Purdue'] },
  { week: 6, teams: ['USC', 'Penn State'] },

  // Week 7 — 7 games
  { week: 7, teams: ['Washington', 'Purdue'] },
  { week: 7, teams: ['Rutgers', 'Maryland'] },
  { week: 7, teams: ['Ohio State', 'Indiana'] },
  { week: 7, teams: ['Nebraska', 'Oregon'] },
  { week: 7, teams: ['Wisconsin', 'UCLA'] },
  { week: 7, teams: ['Penn State', 'Michigan'] },
  { week: 7, teams: ['Northwestern', 'Michigan State'] },

  // Week 8 — 6 games
  { week: 8, teams: ['Iowa', 'Minnesota'] },
  { week: 8, teams: ['USC', 'Wisconsin'] },
  { week: 8, teams: ['Indiana', 'Michigan'] },
  { week: 8, teams: ['Michigan State', 'UCLA'] },
  { week: 8, teams: ['Rutgers', 'Northwestern'] },
  { week: 8, teams: ['Oregon', 'Illinois'] },

  // Week 9 — 9 games
  { week: 9, teams: ['Michigan', 'Rutgers'] },
  { week: 9, teams: ['Northwestern', 'Oregon'] },
  { week: 9, teams: ['Ohio State', 'USC'] },
  { week: 9, teams: ['Wisconsin', 'Iowa'] },
  { week: 9, teams: ['Washington', 'Nebraska'] },
  { week: 9, teams: ['Minnesota', 'Indiana'] },
  { week: 9, teams: ['Purdue', 'Penn State'] },
  { week: 9, teams: ['Nevada', 'UCLA'] },
  { week: 9, teams: ['Illinois', 'Maryland'] },

  // Week 10 — 8 games
  { week: 10, teams: ['Nebraska', 'Illinois'] },
  { week: 10, teams: ['Oregon', 'Ohio State'] },
  { week: 10, teams: ['UCLA', 'Minnesota'] },
  { week: 10, teams: ['Rutgers', 'Wisconsin'] },
  { week: 10, teams: ['Penn State', 'Washington'] },
  { week: 10, teams: ['Maryland', 'Purdue'] },
  { week: 10, teams: ['Michigan State', 'Michigan'] },
  { week: 10, teams: ['Iowa', 'Northwestern'] },

  // Week 11 — 9 games
  { week: 11, teams: ['Illinois', 'UCLA'] },
  { week: 11, teams: ['Washington', 'Michigan State'] },
  { week: 11, teams: ['Purdue', 'Iowa'] },
  { week: 11, teams: ['Michigan', 'Oregon'] },
  { week: 11, teams: ['Wisconsin', 'Maryland'] },
  { week: 11, teams: ['Minnesota', 'Penn State'] },
  { week: 11, teams: ['USC', 'Indiana'] },
  { week: 11, teams: ['Nebraska', 'Rutgers'] },
  { week: 11, teams: ['Northwestern', 'Ohio State'] },

  // Week 12 — 9 games
  { week: 12, teams: ['Oregon', 'Michigan State'] },
  { week: 12, teams: ['Northwestern', 'Minnesota'] },
  { week: 12, teams: ['Rutgers', 'Penn State'] },
  { week: 12, teams: ['UCLA', 'Michigan'] },
  { week: 12, teams: ['Maryland', 'USC'] },
  { week: 12, teams: ['Wisconsin', 'Purdue'] },
  { week: 12, teams: ['Ohio State', 'Nebraska'] },
  { week: 12, teams: ['Indiana', 'Washington'] },
  { week: 12, teams: ['Iowa', 'Illinois'] },

  // Week 13 — 9 games
  { week: 13, teams: ['Nebraska', 'Iowa'] },
  { week: 13, teams: ['Minnesota', 'Wisconsin'] },
  { week: 13, teams: ['Michigan', 'Ohio State'] },
  { week: 13, teams: ['Michigan State', 'Rutgers'] },
  { week: 13, teams: ['USC', 'UCLA'] },
  { week: 13, teams: ['Illinois', 'Northwestern'] },
  { week: 13, teams: ['Penn State', 'Maryland'] },
  { week: 13, teams: ['Washington', 'Oregon'] },
  { week: 13, teams: ['Purdue', 'Indiana'] }
];

export const BIGTEN_POOL_WEEK_GAME_COUNTS_2026 = [14, 15, 11, 9, 8, 8, 7, 6, 9, 8, 9, 9, 9];

const TEAM_ALIASES = new Map([
  // Defensive aliases for opponents whose CFBD `school` spelling is uncertain
  // without a live API key to verify against. Matching degrades gracefully
  // even if one of these is wrong — a mismatched slot shows up in `missing`
  // rather than silently breaking other games.
  ['cal', 'california'],
  ['california', 'california'],
  ['connecticut', 'uconn'],
  ['uconn', 'uconn'],
  ['louisianalafayette', 'louisiana'],
  ['ullafayette', 'louisiana'],
  ['louisianaragincajuns', 'louisiana'],
  ['louisiana', 'louisiana'],
  // CFBD's canonical `school` spelling for the Week 1 UMass @ Rutgers game
  // is "Massachusetts", not "UMass" (the pool listing's spelling). Without
  // this alias the authoritative-schedule matcher can't line the two up,
  // and the game silently drops out of the Week 1 board even though a real
  // CFBD game exists and the shared teamMatch()/TEAM_ALIAS table elsewhere
  // already treats them as the same team (see data/team-alias.js and
  // kelly-pool-schedule-2026.js, which already carries this same alias).
  ['massachusetts', 'umass'],
  ['umass', 'umass']
]);

const matcher = createScheduleMatcher(TEAM_ALIASES);

export const teamScheduleKey = matcher.teamScheduleKey;
export const gameScheduleKey = matcher.gameScheduleKey;

export function bigTenPoolScheduleForYear(year) {
  return Number(year) === 2026 ? BIGTEN_POOL_SCHEDULE_2026 : null;
}

export function applyBigTenPoolSchedule(games, year) {
  return matcher.applySchedule(games, bigTenPoolScheduleForYear(year));
}
