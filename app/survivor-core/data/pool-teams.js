import { KELLY_POOL_TEAMS_2026 } from './kelly-pool-schedule-2026.js';

// Canonical survivor pool definitions — display/configuration metadata and team lists.
// name, and the CFBD conference abbreviation used to query the API.
//
// This is the single source of truth for team rosters. It's imported by both
// the browser (js/pools.js) and the Vercel serverless API (api/survivor-data.js),
// which previously each hardcoded their own copy of these two team lists. That
// meant a realignment change or a typo fix had to be made in two places and
// could silently drift out of sync (the frontend and API disagreeing about
// who's a conference member). Edit team membership only here.
//
// `cfbdConference` doubles as the short conference label used in the UI
// (brand mark text, etc.) since it happens to match ('SEC' / 'B1G').

export const POOL_DEFINITIONS = {
  sec: {
    id: 'sec',
    name: 'SEC Survivor',
    conference: 'SEC',
    cfbdConference: 'SEC',
    shortLabel: 'SEC',
    teamColumnLabel: 'SEC team',
    picksPerWeek: 1,
    teams: [
      'Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU',
      'Mississippi State', 'Missouri', 'Oklahoma', 'Ole Miss', 'South Carolina',
      'Tennessee', 'Texas', 'Texas A&M', 'Vanderbilt'
    ]
  },
  bigten: {
    id: 'bigten',
    name: 'Big Ten Survivor',
    conference: 'Big Ten',
    cfbdConference: 'B1G',
    shortLabel: 'B1G',
    teamColumnLabel: 'Big Ten team',
    picksPerWeek: 1,
    teams: [
      'Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan State',
      'Minnesota', 'Nebraska', 'Northwestern', 'Ohio State', 'Oregon', 'Penn State',
      'Purdue', 'Rutgers', 'UCLA', 'USC', 'Washington', 'Wisconsin'
    ]
  },
  kelly: {
    id: 'kelly',
    name: 'KellyInVegas Survivor CFB Championship',
    conference: 'KellyInVegas',
    cfbdConference: null,
    shortLabel: 'KELLY',
    teamColumnLabel: 'Team',
    picksPerWeek: 2,
    teams: [...KELLY_POOL_TEAMS_2026]
  }
};

export function getPoolDefinition(poolId) {
  return POOL_DEFINITIONS[poolId] || POOL_DEFINITIONS.sec;
}
