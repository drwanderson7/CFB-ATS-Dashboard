import { POOL_DEFINITIONS, getPoolDefinition } from '../data/pool-teams.js';

export const POOLS = POOL_DEFINITIONS;

export const TEAM_META = {
  'Alabama': { abbr: 'ALA', color: '#9E1B32' },
  'Arkansas': { abbr: 'ARK', color: '#9D2235' },
  'Auburn': { abbr: 'AUB', color: '#0C2340' },
  'Florida': { abbr: 'FLA', color: '#0021A5' },
  'Georgia': { abbr: 'UGA', color: '#BA0C2F' },
  'Kentucky': { abbr: 'UK', color: '#0033A0' },
  'LSU': { abbr: 'LSU', color: '#461D7C' },
  'Mississippi State': { abbr: 'MSST', color: '#660000' },
  'Missouri': { abbr: 'MIZ', color: '#111827' },
  'Oklahoma': { abbr: 'OU', color: '#841617' },
  'Ole Miss': { abbr: 'MISS', color: '#CE1126' },
  'South Carolina': { abbr: 'SC', color: '#73000A' },
  'Tennessee': { abbr: 'TENN', color: '#FF8200' },
  'Texas': { abbr: 'TEX', color: '#BF5700' },
  'Texas A&M': { abbr: 'TAMU', color: '#500000' },
  'Vanderbilt': { abbr: 'VAN', color: '#866D4B' },
  'Illinois': { abbr: 'ILL', color: '#13294B' },
  'Indiana': { abbr: 'IND', color: '#990000' },
  'Iowa': { abbr: 'IOWA', color: '#111111' },
  'Maryland': { abbr: 'MD', color: '#E03A3E' },
  'Michigan': { abbr: 'MICH', color: '#00274C' },
  'Michigan State': { abbr: 'MSU', color: '#18453B' },
  'Minnesota': { abbr: 'MINN', color: '#7A0019' },
  'Nebraska': { abbr: 'NEB', color: '#E41C38' },
  'Northwestern': { abbr: 'NU', color: '#4E2A84' },
  'Ohio State': { abbr: 'OSU', color: '#BA0C2F' },
  'Oregon': { abbr: 'ORE', color: '#154733' },
  'Penn State': { abbr: 'PSU', color: '#041E42' },
  'Purdue': { abbr: 'PUR', color: '#8E6F3E' },
  'Rutgers': { abbr: 'RUT', color: '#CC0033' },
  'UCLA': { abbr: 'UCLA', color: '#2774AE' },
  'USC': { abbr: 'USC', color: '#990000' },
  'Washington': { abbr: 'WASH', color: '#4B2E83' },
  'Wisconsin': { abbr: 'WIS', color: '#C5050C' }
};

export function getPool(poolId) {
  return getPoolDefinition(poolId);
}
