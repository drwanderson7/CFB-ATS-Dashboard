// Shared application state, the DOM element cache, and the small "model"
// accessors that read/derive from that state. Extracted from js/app.js
// (architecture cleanup pass) so every module — the view renderers, the
// sync subsystem, the dialogs — can share one source of truth for `state`
// and `els` without importing from each other's UI code.
//
// `state` and `els` are plain mutable objects, not reactive/observable —
// this app has no framework. Every module that imports them gets the same
// object reference (ES module bindings are live), and mutates it directly
// via property assignment (e.g. `state.currentWeek = 5`), the same way the
// original single-file app.js always did. Re-rendering after a mutation is
// still the caller's responsibility, exactly as before — this file only
// centralizes the state shape and its most fundamental derived accessors,
// it does not add any new state-management behavior.

import { loadActivePoolId, loadState, loadSyncCode, loadSyncDirtyFlag } from './storage.js';
import { getPool } from './pools.js';
import { deriveCurrentPoolWeek } from './results.js';

const els = Object.fromEntries([
  'seasonSelect','refreshBtn','statusBanner','heroRecommendation','currentWeekMetric','currentWeekMeta',
  'teamsRemainingMetric','planSurvivalMetric','planSurvivalDetail','weekHeading','weekSelect','prevWeekBtn','nextWeekBtn',
  'weekPrevSecondary','weekNextSecondary','weekNavLabel','rankingList','seasonGrid','plannerSummary','plannerList',
  'entryNameInput','pickHistory','usedTeams','resetPicksBtn','matchupDialog','dialogWeek','dialogTitle','dialogBody',
  'useTeamBtn','useOpponentBtn','dataFreshness','poolSelect','entrySelect','addEntryBtn','brandMarkText','brandSubtitle','poolRuleConference',
  'teamsRemainingDetail','gridTitle','picksPoolCopy','deleteEntryBtn','deleteEntryDialog','deleteEntryCopy','confirmDeleteEntryBtn',
  'syncBtn','syncDialog','syncDialogBody','compareBar','scarcityStrip','resetEntryDialog','resetEntryCopy','confirmResetPicksBtn','whyPickPanel','entryStatusBar','dataHealthPanel','dataHealthItems','dataHealthDetails'
].map(id => [id, document.getElementById(id)]));

const initialPoolId = loadActivePoolId();
const initialPoolState = loadState(initialPoolId);
const initialSyncCode = loadSyncCode();
const initialEntry = initialPoolState.entries.find(entry => entry.id === initialPoolState.activeEntryId) || initialPoolState.entries[0];
const state = {
  poolId: initialPoolId,
  ...initialPoolState,
  entryName: initialEntry.name,
  picks: initialEntry.picks,
  data: null,
  loading: false,
  recommendationPlan: null,
  scheduleCurrentWeek: null,
  entryStatus: null,
  selectedMatchup: null,
  plan: null,
  selectedView: 'grid',
  gridSortWeek: null,
  syncCode: initialSyncCode,
  syncHydrationReady: !initialSyncCode,
  syncStatus: 'idle', // 'idle' | 'syncing' | 'synced' | 'error' | 'conflict'
  syncUpdatedAt: null,
  syncError: null,
  syncLocalDirty: initialSyncCode ? loadSyncDirtyFlag() : false,
  syncPendingRemote: null,
  syncPendingLink: null,
  whyPickOpen: false,
  compareSelection: new Set(),
  compareWeek: null,
  syncDeleteConfirm: false
};

function activePool() {
  return getPool(state.poolId);
}

function poolTeams() {
  return activePool().teams;
}

function eligibleTeamsSet() {
  if (!state.data) return new Set();
  const listed = Array.isArray(state.data.eligibleTeams) ? state.data.eligibleTeams : [];
  return new Set(listed.length ? listed : state.data.matchups.map(matchup => matchup.team));
}

function activeEntry() {
  return state.entries.find(entry => entry.id === state.activeEntryId) || state.entries[0];
}

function syncActiveEntryState() {
  const entry = activeEntry();
  if (!entry) return;
  state.activeEntryId = entry.id;
  state.entryName = entry.name;
  state.picks = entry.picks;
}

function syncStateToActiveEntry() {
  const entry = activeEntry();
  if (!entry) return;
  entry.name = state.entryName || entry.name || 'My Entry';
  entry.picks = state.picks && typeof state.picks === 'object' ? state.picks : {};
}

function nextEntryName() {
  const existing = new Set(state.entries.map(entry => entry.name.trim().toLowerCase()));
  let number = 1;
  while (existing.has(`entry ${number}`)) number += 1;
  return `Entry ${number}`;
}

function newEntryId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function selectedPickForWeek(week) {
  return state.picks[String(week)] || state.picks[week] || null;
}

function usedTeamsSet(excludeWeek = null) {
  return new Set(Object.entries(state.picks)
    .filter(([week]) => excludeWeek === null || Number(week) !== Number(excludeWeek))
    .map(([, team]) => team)
    .filter(Boolean));
}

function getDataWeeks() {
  return (state.data?.weeks || []).filter(Number.isFinite).sort((a, b) => a - b);
}

function determineCurrentWeek() {
  const weeks = getDataWeeks();
  if (!weeks.length || !state.data) return 1;
  return deriveCurrentPoolWeek(state.data.matchups, weeks, Date.now());
}

export {
  els,
  state,
  activePool,
  poolTeams,
  eligibleTeamsSet,
  activeEntry,
  syncActiveEntryState,
  syncStateToActiveEntry,
  nextEntryName,
  newEntryId,
  selectedPickForWeek,
  usedTeamsSet,
  getDataWeeks,
  determineCurrentWeek
};
