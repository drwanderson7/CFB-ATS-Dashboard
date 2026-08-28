// Supported Survivor pool seasons.
//
// The app only exposes seasons for which we have an authoritative SplashSports
// allowlist. Do not silently fall back to a generic conference schedule for a
// different year: that changes pool eligibility and can create invalid picks.
export const SUPPORTED_SURVIVOR_SEASONS = Object.freeze([2026]);
export const DEFAULT_SURVIVOR_SEASON = 2026;

export function isSupportedSurvivorSeason(value) {
  return SUPPORTED_SURVIVOR_SEASONS.includes(Number(value));
}

export function normalizeSurvivorSeason(value) {
  return isSupportedSurvivorSeason(value) ? Number(value) : DEFAULT_SURVIVOR_SEASON;
}
