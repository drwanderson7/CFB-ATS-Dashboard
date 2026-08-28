// Authoritative 2026 SEC survivor-pool schedule transcribed from the user's
// SplashSports pool screenshots on 2026-08-25. Only games listed by the pool
// are eligible. In particular, SEC-vs-non-FBS games omitted by Splash are NOT
// part of this survivor schedule.

import { createScheduleMatcher } from './pool-schedule-utils.js';

export const SEC_POOL_SCHEDULE_2026 = [
  // Week 1 — 10 games
  { week: 1, teams: ['UTEP', 'Oklahoma'] },
  { week: 1, teams: ['East Carolina', 'Alabama'] },
  { week: 1, teams: ['Kent State', 'South Carolina'] },
  { week: 1, teams: ['Texas State', 'Texas'] },
  { week: 1, teams: ['Baylor', 'Auburn'] },
  { week: 1, teams: ['Missouri State', 'Texas A&M'] },
  { week: 1, teams: ['Clemson', 'LSU'] },
  { week: 1, teams: ['UL Monroe', 'Mississippi State'] },
  { week: 1, teams: ['Florida Atlantic', 'Florida'] },
  { week: 1, teams: ['Louisville', 'Ole Miss'] },

  // Week 2 — 13 games
  { week: 2, teams: ['Missouri', 'Kansas'] },
  { week: 2, teams: ['Arizona State', 'Texas A&M'] },
  { week: 2, teams: ['Oklahoma', 'Michigan'] },
  { week: 2, teams: ['Western Kentucky', 'Georgia'] },
  { week: 2, teams: ['Alabama', 'Kentucky'] },
  { week: 2, teams: ['Mississippi State', 'Minnesota'] },
  { week: 2, teams: ['Delaware', 'Vanderbilt'] },
  { week: 2, teams: ['Tennessee', 'Georgia Tech'] },
  { week: 2, teams: ['Ohio State', 'Texas'] },
  { week: 2, teams: ['Louisiana Tech', 'LSU'] },
  { week: 2, teams: ['Charlotte', 'Ole Miss'] },
  { week: 2, teams: ['Southern Miss', 'Auburn'] },
  { week: 2, teams: ['Arkansas', 'Utah'] },

  // Week 3 — 11 games
  { week: 3, teams: ['Georgia', 'Arkansas'] },
  { week: 3, teams: ['Troy', 'Missouri'] },
  { week: 3, teams: ['NC State', 'Vanderbilt'] },
  { week: 3, teams: ['Florida State', 'Alabama'] },
  { week: 3, teams: ['Kentucky', 'Texas A&M'] },
  { week: 3, teams: ['Mississippi State', 'South Carolina'] },
  { week: 3, teams: ['Florida', 'Auburn'] },
  { week: 3, teams: ['New Mexico', 'Oklahoma'] },
  { week: 3, teams: ['LSU', 'Ole Miss'] },
  { week: 3, teams: ['Kennesaw State', 'Tennessee'] },
  { week: 3, teams: ['UTSA', 'Texas'] },

  // Week 4 — 9 games
  { week: 4, teams: ['Texas', 'Tennessee'] },
  { week: 4, teams: ['South Alabama', 'Kentucky'] },
  { week: 4, teams: ['South Carolina', 'Alabama'] },
  { week: 4, teams: ['Missouri', 'Mississippi State'] },
  { week: 4, teams: ['Ole Miss', 'Florida'] },
  { week: 4, teams: ['Texas A&M', 'LSU'] },
  { week: 4, teams: ['Vanderbilt', 'Auburn'] },
  { week: 4, teams: ['Oklahoma', 'Georgia'] },
  { week: 4, teams: ['Tulsa', 'Arkansas'] },

  // Week 5 — 6 games
  { week: 5, teams: ['Arkansas', 'Texas A&M'] },
  { week: 5, teams: ['Kentucky', 'South Carolina'] },
  { week: 5, teams: ['Vanderbilt', 'Georgia'] },
  { week: 5, teams: ['Alabama', 'Mississippi State'] },
  { week: 5, teams: ['Auburn', 'Tennessee'] },
  { week: 5, teams: ['Florida', 'Missouri'] },

  // Week 6 — 7 games
  { week: 6, teams: ['South Carolina', 'Florida'] },
  { week: 6, teams: ['Ole Miss', 'Vanderbilt'] },
  { week: 6, teams: ['Georgia', 'Alabama'] },
  { week: 6, teams: ['Tennessee', 'Arkansas'] },
  { week: 6, teams: ['Texas A&M', 'Missouri'] },
  { week: 6, teams: ['LSU', 'Kentucky'] },
  { week: 6, teams: ['Texas', 'Oklahoma'] },

  // Week 7 — 7 games
  { week: 7, teams: ['Arkansas', 'Vanderbilt'] },
  { week: 7, teams: ['Missouri', 'Ole Miss'] },
  { week: 7, teams: ['Florida', 'Texas'] },
  { week: 7, teams: ['Auburn', 'Georgia'] },
  { week: 7, teams: ['Alabama', 'Tennessee'] },
  { week: 7, teams: ['Kentucky', 'Oklahoma'] },
  { week: 7, teams: ['Mississippi State', 'LSU'] },

  // Week 8 — 6 games
  { week: 8, teams: ['LSU', 'Auburn'] },
  { week: 8, teams: ['Tennessee', 'South Carolina'] },
  { week: 8, teams: ['Ole Miss', 'Texas'] },
  { week: 8, teams: ['Texas A&M', 'Alabama'] },
  { week: 8, teams: ['Vanderbilt', 'Kentucky'] },
  { week: 8, teams: ['Oklahoma', 'Mississippi State'] },

  // Week 9 — 5 games
  { week: 9, teams: ['Mississippi State', 'Texas'] },
  { week: 9, teams: ['South Carolina', 'Oklahoma'] },
  { week: 9, teams: ['Missouri', 'Arkansas'] },
  { week: 9, teams: ['Auburn', 'Ole Miss'] },
  { week: 9, teams: ['Florida', 'Georgia'] },

  // Week 10 — 8 games
  { week: 10, teams: ['Arkansas', 'Auburn'] },
  { week: 10, teams: ['Texas', 'Missouri'] },
  { week: 10, teams: ['Alabama', 'LSU'] },
  { week: 10, teams: ['Oklahoma', 'Florida'] },
  { week: 10, teams: ['Vanderbilt', 'Mississippi State'] },
  { week: 10, teams: ['Texas A&M', 'South Carolina'] },
  { week: 10, teams: ['Georgia', 'Ole Miss'] },
  { week: 10, teams: ['Kentucky', 'Tennessee'] },

  // Week 11 — 8 games
  { week: 11, teams: ['Tennessee', 'Texas A&M'] },
  { week: 11, teams: ['Florida', 'Kentucky'] },
  { week: 11, teams: ['Ole Miss', 'Oklahoma'] },
  { week: 11, teams: ['Texas', 'LSU'] },
  { week: 11, teams: ['Alabama', 'Vanderbilt'] },
  { week: 11, teams: ['South Carolina', 'Arkansas'] },
  { week: 11, teams: ['Auburn', 'Mississippi State'] },
  { week: 11, teams: ['Missouri', 'Georgia'] },

  // Week 12 — 6 games
  { week: 12, teams: ['Texas A&M', 'Oklahoma'] },
  { week: 12, teams: ['Vanderbilt', 'Florida'] },
  { week: 12, teams: ['Kentucky', 'Missouri'] },
  { week: 12, teams: ['Arkansas', 'Texas'] },
  { week: 12, teams: ['LSU', 'Tennessee'] },
  { week: 12, teams: ['Georgia', 'South Carolina'] },

  // Week 13 — 10 games
  { week: 13, teams: ['Mississippi State', 'Ole Miss'] },
  { week: 13, teams: ['Florida', 'Florida State'] },
  { week: 13, teams: ['Texas', 'Texas A&M'] },
  { week: 13, teams: ['Tennessee', 'Vanderbilt'] },
  { week: 13, teams: ['South Carolina', 'Clemson'] },
  { week: 13, teams: ['Louisville', 'Kentucky'] },
  { week: 13, teams: ['Georgia Tech', 'Georgia'] },
  { week: 13, teams: ['Auburn', 'Alabama'] },
  { week: 13, teams: ['Oklahoma', 'Missouri'] },
  { week: 13, teams: ['LSU', 'Arkansas'] }
];

export const SEC_POOL_WEEK_GAME_COUNTS_2026 = [10, 13, 11, 9, 6, 7, 7, 6, 5, 8, 8, 6, 10];

const TEAM_ALIASES = new Map([
  ['louisianamonroe', 'ulmonroe'],
  ['ulm', 'ulmonroe'],
  ['ulmonroe', 'ulmonroe'],
  ['southernmississippi', 'southernmiss'],
  ['southernmiss', 'southernmiss']
]);

const matcher = createScheduleMatcher(TEAM_ALIASES);

export const teamScheduleKey = matcher.teamScheduleKey;
export const gameScheduleKey = matcher.gameScheduleKey;

export function secPoolScheduleForYear(year) {
  return Number(year) === 2026 ? SEC_POOL_SCHEDULE_2026 : null;
}

export function applySecPoolSchedule(games, year) {
  return matcher.applySchedule(games, secPoolScheduleForYear(year));
}
