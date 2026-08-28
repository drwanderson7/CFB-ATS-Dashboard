// CFB Survivor — sync UI / orchestration
//
// App-level callbacks are registered once through configureSyncUI(). This
// keeps sync-ui independent of app.js and removes the previous circular ES
// module dependency while preserving the same runtime behavior.

import { state, els, syncActiveEntryState, syncStateToActiveEntry } from './state.js';
import {
  loadState, saveActivePoolId, saveState,
  saveSyncCode, clearSyncCode, saveSyncDirtyFlag, clearSyncDirtyFlag,
  buildSyncProfile, applySyncProfile
} from './storage.js';
import { createSyncAccount, fetchSyncProfile, pushSyncProfile, deleteSyncAccount } from './sync.js';
import { escapeHtml, formatSyncTimestamp } from './render-utils.js';
import { renderEntryControls } from './entry-controls.js';

let appCallbacks = { renderAll: null, loadData: null, refreshResults: null, renderEntryStatus: null };
function configureSyncUI({ renderAll, loadData, refreshResults, renderEntryStatus } = {}) {
  appCallbacks = {
    renderAll: typeof renderAll === 'function' ? renderAll : null,
    loadData: typeof loadData === 'function' ? loadData : null,
    refreshResults: typeof refreshResults === 'function' ? refreshResults : null,
    renderEntryStatus: typeof renderEntryStatus === 'function' ? renderEntryStatus : null
  };
}

function refreshEntryStatusSummary() {
  appCallbacks.renderEntryStatus?.();
}

function saveLocal({ sync = true } = {}) {
  state.season = Number(els.seasonSelect.value) || state.season || 2026;
  syncStateToActiveEntry();
  saveState(state.poolId, state);
  saveActivePoolId(state.poolId);
  if (sync && state.syncCode) {
    state.syncLocalDirty = true;
    saveSyncDirtyFlag(true);
    // If hydration is blocked, keep the local change safely queued rather
    // than silently dropping it. The next successful pull becomes an
    // explicit conflict choice instead of overwriting either side.
    if (!state.syncHydrationReady) {
      state.syncStatus = state.syncPendingRemote ? 'conflict' : state.syncStatus;
      refreshSyncDialogIfOpen();
    }
  }
  if (sync) scheduleSyncPush();
}

let syncPushTimer = null;
const SYNC_PUSH_DEBOUNCE_MS = 900;

function refreshSyncDialogIfOpen() {
  if (els.syncDialog?.open) renderSyncDialog();
}

function scheduleSyncPush() {
  if (!state.syncCode || !state.syncHydrationReady) return;
  state.syncStatus = 'syncing';
  refreshEntryStatusSummary();
  refreshSyncDialogIfOpen();
  if (syncPushTimer) clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(async () => {
    const code = state.syncCode;
    if (!code) return;
    try {
      const profile = buildSyncProfile();
      const result = await pushSyncProfile(code, profile);
      if (state.syncCode !== code) return; // sync was disabled/relinked mid-flight
      state.syncUpdatedAt = result.updatedAt;
      state.syncStatus = 'synced';
      state.syncError = null;
      state.syncLocalDirty = false;
      state.syncPendingRemote = null;
      clearSyncDirtyFlag();
    } catch (error) {
      if (state.syncCode !== code) return;
      state.syncStatus = 'error';
      state.syncError = error?.message || 'Sync failed.';
    }
    refreshEntryStatusSummary();
    refreshSyncDialogIfOpen();
  }, SYNC_PUSH_DEBOUNCE_MS);
}

// Reloads the in-memory state for whatever pool is currently active from
// local storage, after that local storage was just overwritten by an
// incoming sync profile (initial pull, or linking a new code). Mirrors what
// the poolSelect change handler already does when switching pools.
function reloadActivePoolFromLocalStorage() {
  const poolState = loadState(state.poolId);
  state.entries = poolState.entries;
  state.activeEntryId = poolState.activeEntryId;
  state.currentWeek = poolState.currentWeek;
  state.season = poolState.season;
  syncActiveEntryState();
  renderEntryControls();
  if (state.data) appCallbacks.renderAll?.();
}

async function pullSyncOnBoot() {
  if (!state.syncCode) {
    state.syncHydrationReady = true;
    return false;
  }
  const code = state.syncCode;
  state.syncHydrationReady = false;
  state.syncStatus = 'syncing';
  refreshEntryStatusSummary();
  refreshSyncDialogIfOpen();
  try {
    const result = await fetchSyncProfile(code);
    if (state.syncCode !== code) return false;
    // If this device has an unsynced durable edit (including one that
    // survived a browser reload), do not silently choose cloud or local.
    // Hold the fetched snapshot and ask the user which copy should win.
    if (state.syncLocalDirty) {
      state.syncPendingRemote = result;
      state.syncUpdatedAt = result.updatedAt;
      state.syncStatus = 'conflict';
      state.syncError = null;
      state.syncHydrationReady = false;
      return false;
    }
    applySyncProfile(result.profile);
    state.syncUpdatedAt = result.updatedAt;
    state.syncStatus = 'synced';
    state.syncError = null;
    state.syncHydrationReady = true;
    state.syncPendingRemote = null;
    clearSyncDirtyFlag();
    reloadActivePoolFromLocalStorage();
    return true;
  } catch (error) {
    if (state.syncCode !== code) return false;
    // Stay read-only with respect to cloud writes until a pull succeeds. This
    // prevents stale localStorage from overwriting newer cloud picks after a
    // slow or failed startup hydration. The sync dialog exposes a retry.
    state.syncHydrationReady = false;
    state.syncStatus = 'error';
    state.syncError = error?.message || 'Could not load synced data.';
    return false;
  } finally {
    refreshEntryStatusSummary();
    refreshSyncDialogIfOpen();
  }
}


function summarizeSyncProfile(profile) {
  const poolIds = ['sec', 'bigten'];
  const pools = {};
  let totalEntries = 0;
  let totalPicks = 0;
  for (const poolId of poolIds) {
    const entries = Array.isArray(profile?.[poolId]?.entries) ? profile[poolId].entries : [];
    const picks = entries.reduce((sum, entry) => sum + Object.values(entry?.picks || {}).filter(Boolean).length, 0);
    pools[poolId] = { entries: entries.length, picks };
    totalEntries += entries.length;
    totalPicks += picks;
  }
  return { totalEntries, totalPicks, pools };
}

function syncSummaryText(summary) {
  const pickWord = summary.totalPicks === 1 ? 'pick' : 'picks';
  return `${summary.totalPicks} saved ${pickWord} · SEC ${summary.pools.sec.picks} · Big Ten ${summary.pools.bigten.picks}`;
}

function finishSyncLink(result) {
  applySyncProfile(result.profile);
  state.syncCode = result.code;
  state.syncHydrationReady = true;
  state.syncUpdatedAt = result.updatedAt;
  state.syncStatus = 'synced';
  state.syncError = null;
  state.syncLocalDirty = false;
  state.syncPendingRemote = null;
  state.syncPendingLink = null;
  clearSyncDirtyFlag();
  saveSyncCode(result.code);
  reloadActivePoolFromLocalStorage();
}

function syncStatusLabel() {
  return { idle: 'Synced', syncing: 'Syncing…', synced: 'Synced', error: 'Sync error', conflict: 'Sync choice needed' }[state.syncStatus] || 'Synced';
}

function renderSyncDialog() {
  const body = els.syncDialogBody;
  if (!body) return;

  if (!state.syncCode) {
    if (state.syncPendingLink?.result) {
      const localSummary = state.syncPendingLink.localSummary || summarizeSyncProfile(buildSyncProfile());
      const remoteSummary = state.syncPendingLink.remoteSummary || summarizeSyncProfile(state.syncPendingLink.result.profile);
      body.innerHTML = `
        <p class="sync-intro"><strong>This device already has saved picks.</strong> Nothing has been replaced yet.</p>
        <p class="sync-intro sync-warning">Using sync code <strong>${escapeHtml(state.syncPendingLink.result.code)}</strong> will replace this device's Survivor entries and picks with the existing synced copy.</p>
        <div class="sync-link-compare" aria-label="Sync link comparison">
          <div class="sync-link-copy-card is-local">
            <span>This device</span>
            <strong>${escapeHtml(syncSummaryText(localSummary))}</strong>
            <small>${localSummary.totalEntries} ${localSummary.totalEntries === 1 ? 'entry' : 'entries'} across both pools</small>
          </div>
          <div class="sync-link-copy-card is-cloud">
            <span>Synced copy</span>
            <strong>${escapeHtml(syncSummaryText(remoteSummary))}</strong>
            <small>${remoteSummary.totalEntries} ${remoteSummary.totalEntries === 1 ? 'entry' : 'entries'} across both pools</small>
          </div>
        </div>
        <p class="sync-note">If you want to preserve this device's picks instead, cancel and choose <strong>Enable sync</strong> to create a new code from this device. Initial linking never overwrites the existing cloud copy.</p>
        <div class="sync-link-confirm-actions">
          <button type="button" id="syncLinkCancelBtn" class="button secondary">Cancel</button>
          <button type="button" id="syncLinkConfirmBtn" class="button primary">Use synced copy &amp; link</button>
        </div>
        <div id="syncFeedback" class="sync-feedback" role="status"></div>
      `;
      return;
    }

    body.innerHTML = `
      <p class="sync-intro">Sync keeps this pool's entries and picks the same on your phone, laptop, and any other device.</p>
      <p class="sync-intro sync-warning">Anyone with the code can view and change picks — treat it like a shared document link, not a password. Don't post it publicly.</p>
      <div class="sync-section">
        <h3>Start syncing this device</h3>
        <p class="sync-note">Creates a new sync code seeded with what's currently on this device.</p>
        <button type="button" id="syncCreateBtn" class="button primary">Enable sync</button>
      </div>
      <div class="sync-section">
        <h3>Already have a code?</h3>
        <div class="sync-link-row">
          <input type="text" id="syncCodeInput" placeholder="ABCD-2345" maxlength="9" autocapitalize="characters" autocomplete="off" spellcheck="false">
          <button type="button" id="syncLinkBtn" class="button secondary">Link this device</button>
        </div>
        <p class="sync-note">If this device already has saved picks, you'll review both copies before anything is replaced.</p>
      </div>
      <div id="syncFeedback" class="sync-feedback" role="status"></div>
    `;
    return;
  }

  const hasConflict = state.syncStatus === 'conflict' && state.syncPendingRemote;
  body.innerHTML = `
    <p class="sync-intro">This device is syncing. Enter the same code in "Already have a code?" on another device to see the same picks there.</p>
    <div class="sync-code-display">
      <span class="sync-code-label">Sync code</span>
      <span class="sync-code-value">${escapeHtml(state.syncCode)}</span>
      <button type="button" id="syncCopyBtn" class="button secondary small-button">Copy</button>
    </div>
    <div class="sync-status-row${state.syncStatus === 'error' || hasConflict ? ' is-error' : ''}">
      <span class="sync-status-dot" aria-hidden="true"></span>
      <span>${escapeHtml(syncStatusLabel())}</span>
      <span class="sync-last">Last synced ${escapeHtml(formatSyncTimestamp(state.syncUpdatedAt))}</span>
    </div>
    ${hasConflict ? `
      <div class="sync-conflict-box">
        <strong>Both this device and the synced copy have changes.</strong>
        <p>Nothing has been overwritten. Choose which copy should become the shared version.</p>
        ${state.syncError ? `<p class="sync-conflict-error">${escapeHtml(state.syncError)}</p>` : ''}
        <div class="sync-conflict-actions">
          <button type="button" id="syncKeepLocalBtn" class="button primary">Keep this device</button>
          <button type="button" id="syncUseCloudBtn" class="button secondary">Use synced copy</button>
        </div>
      </div>` : ''}
    ${state.syncStatus === 'error' && state.syncError ? `<p class="sync-note sync-warning">${escapeHtml(state.syncError)}</p><button type="button" id="syncRetryBtn" class="button secondary small-button">Retry sync</button>` : ''}
    ${state.syncLocalDirty && !hasConflict && state.syncStatus !== 'error' ? '<p class="sync-note sync-warning">This device has local changes waiting to be confirmed in the cloud.</p>' : ''}
    <div id="syncFeedback" class="sync-feedback" role="status"></div>
    <div class="sync-section sync-danger-section">
      <button type="button" id="syncStopBtn" class="danger-link">Stop syncing this device</button>
      <p class="sync-note">Only forgets the code on this device. Other devices using this code keep syncing with each other, and the data stays on the server.</p>
      ${state.syncDeleteConfirm ? `
        <p class="sync-note sync-warning"><strong>This permanently deletes the synced data for code ${escapeHtml(state.syncCode)} — every device using it loses access.</strong> This device's own local picks are not affected.</p>
        <div class="sync-delete-confirm-row">
          <button type="button" id="syncDeleteCancelBtn" class="button secondary small-button">Cancel</button>
          <button type="button" id="syncDeleteConfirmBtn" class="button danger small-button">Yes, delete everywhere</button>
        </div>
      ` : `
        <button type="button" id="syncDeleteBtn" class="danger-link">Delete synced data everywhere…</button>
        <p class="sync-note">Unused sync codes also expire automatically after 180 days of no changes.</p>
      `}
    </div>
  `;
}

function bindSyncEvents() {
  els.syncBtn?.addEventListener('click', () => {
    renderSyncDialog();
    if (typeof els.syncDialog.showModal === 'function') els.syncDialog.showModal();
  });

  els.syncDialog?.addEventListener('close', () => {
    state.syncDeleteConfirm = false;
    if (!state.syncCode) state.syncPendingLink = null;
  });

  els.syncDialogBody?.addEventListener('click', async event => {
    const setFeedback = (message, isError = false) => {
      const feedback = document.getElementById('syncFeedback');
      if (!feedback) return;
      feedback.textContent = message;
      feedback.classList.toggle('is-error', isError);
    };

    if (event.target.id === 'syncCreateBtn') {
      event.target.disabled = true;
      setFeedback('Setting up sync…');
      try {
        const profile = buildSyncProfile();
        const result = await createSyncAccount(profile);
        state.syncCode = result.code;
        state.syncHydrationReady = true;
        state.syncUpdatedAt = result.updatedAt;
        state.syncStatus = 'synced';
        state.syncError = null;
        state.syncLocalDirty = false;
        state.syncPendingRemote = null;
        state.syncPendingLink = null;
        clearSyncDirtyFlag();
        saveSyncCode(result.code);
        refreshEntryStatusSummary();
        renderSyncDialog();
      } catch (error) {
        setFeedback(error?.message || 'Could not enable sync.', true);
        event.target.disabled = false;
      }
      return;
    }

    if (event.target.id === 'syncLinkBtn') {
      const input = document.getElementById('syncCodeInput');
      const code = (input?.value || '').trim();
      if (!code) { setFeedback('Enter a sync code first.', true); return; }
      event.target.disabled = true;
      setFeedback('Checking synced copy…');
      try {
        const result = await fetchSyncProfile(code);
        const localSummary = summarizeSyncProfile(buildSyncProfile());
        if (localSummary.totalPicks > 0) {
          state.syncPendingLink = {
            result,
            localSummary,
            remoteSummary: summarizeSyncProfile(result.profile)
          };
          renderSyncDialog();
          return;
        }
        finishSyncLink(result);
        renderSyncDialog();
      } catch (error) {
        setFeedback(error?.message || 'Could not link this device.', true);
        event.target.disabled = false;
      }
      return;
    }

    if (event.target.id === 'syncLinkCancelBtn') {
      state.syncPendingLink = null;
      renderSyncDialog();
      return;
    }

    if (event.target.id === 'syncLinkConfirmBtn') {
      const pending = state.syncPendingLink?.result;
      if (!pending?.profile) return;
      event.target.disabled = true;
      setFeedback('Using synced copy…');
      finishSyncLink(pending);
      renderSyncDialog();
      return;
    }

    if (event.target.id === 'syncRetryBtn') {
      event.target.disabled = true;
      setFeedback('Loading synced data…');
      const ok = await pullSyncOnBoot();
      if (!ok && state.syncStatus !== 'conflict') setFeedback(state.syncError || 'Could not load synced data.', true);
      renderSyncDialog();
      return;
    }

    if (event.target.id === 'syncKeepLocalBtn') {
      const code = state.syncCode;
      if (!code) return;
      event.target.disabled = true;
      setFeedback('Saving this device as the shared copy…');
      state.syncStatus = 'syncing';
      try {
        const result = await pushSyncProfile(code, buildSyncProfile());
        if (state.syncCode !== code) return;
        state.syncUpdatedAt = result.updatedAt;
        state.syncStatus = 'synced';
        state.syncError = null;
        state.syncHydrationReady = true;
        state.syncLocalDirty = false;
        state.syncPendingRemote = null;
        clearSyncDirtyFlag();
        refreshEntryStatusSummary();
        renderSyncDialog();
      } catch (error) {
        if (state.syncCode !== code) return;
        state.syncStatus = 'conflict';
        state.syncHydrationReady = false;
        state.syncError = error?.message || 'Could not save this device to the cloud.';
        setFeedback(state.syncError, true);
        renderSyncDialog();
      }
      return;
    }

    if (event.target.id === 'syncUseCloudBtn') {
      const pending = state.syncPendingRemote;
      if (!pending?.profile) return;
      applySyncProfile(pending.profile);
      state.syncUpdatedAt = pending.updatedAt;
      state.syncStatus = 'synced';
      state.syncError = null;
      state.syncHydrationReady = true;
      state.syncLocalDirty = false;
      state.syncPendingRemote = null;
      clearSyncDirtyFlag();
      reloadActivePoolFromLocalStorage();
      renderSyncDialog();
      return;
    }

    if (event.target.id === 'syncCopyBtn') {
      try {
        await navigator.clipboard.writeText(state.syncCode || '');
        setFeedback('Code copied.');
      } catch {
        setFeedback('Could not copy automatically — select and copy the code above.', true);
      }
      return;
    }

    if (event.target.id === 'syncStopBtn') {
      clearSyncCode();
      state.syncCode = null;
      state.syncHydrationReady = true;
      state.syncStatus = 'idle';
      state.syncUpdatedAt = null;
      state.syncError = null;
      state.syncLocalDirty = false;
      state.syncPendingRemote = null;
      state.syncPendingLink = null;
      clearSyncDirtyFlag();
      state.syncDeleteConfirm = false;
      if (syncPushTimer) { clearTimeout(syncPushTimer); syncPushTimer = null; }
      refreshEntryStatusSummary();
      renderSyncDialog();
      return;
    }

    if (event.target.id === 'syncDeleteBtn') {
      state.syncDeleteConfirm = true;
      renderSyncDialog();
      return;
    }

    if (event.target.id === 'syncDeleteCancelBtn') {
      state.syncDeleteConfirm = false;
      renderSyncDialog();
      return;
    }

    if (event.target.id === 'syncDeleteConfirmBtn') {
      const code = state.syncCode;
      event.target.disabled = true;
      setFeedback('Deleting…');
      try {
        await deleteSyncAccount(code);
        clearSyncCode();
        state.syncCode = null;
        state.syncHydrationReady = true;
        state.syncStatus = 'idle';
        state.syncUpdatedAt = null;
        state.syncError = null;
        state.syncLocalDirty = false;
        state.syncPendingRemote = null;
        clearSyncDirtyFlag();
        state.syncDeleteConfirm = false;
        if (syncPushTimer) { clearTimeout(syncPushTimer); syncPushTimer = null; }
        refreshEntryStatusSummary();
        renderSyncDialog();
      } catch (error) {
        setFeedback(error?.message || 'Could not delete synced data.', true);
        event.target.disabled = false;
      }
      return;
    }
  });
}

const RESULTS_REFRESH_MS = 5 * 60 * 1000;
const MODEL_REFRESH_MS = 30 * 60 * 1000;
let resultsRefreshTimer = null;
let modelRefreshTimer = null;
function startAutomaticResultRefresh() {
  // Defensive against being called more than once (it previously was, by
  // mistake, from the sync dialog's retry handler as well as at boot — that
  // silently stacked a new never-cleared setInterval on every retry click,
  // multiplying CFBD polling and re-renders the longer a session ran).
  // Clearing any existing timer first makes a duplicate call a no-op instead
  // of a leak, regardless of where a future duplicate call might sneak in.
  if (resultsRefreshTimer !== null) clearInterval(resultsRefreshTimer);
  resultsRefreshTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || state.loading || state.data?.demo) return;
    appCallbacks.refreshResults?.().catch(() => {});
  }, RESULTS_REFRESH_MS);

  // Model/line inputs still receive a periodic full refresh, just much less
  // often than game results. This keeps pregame inputs reasonably current
  // without paying four CFBD calls every five minutes.
  if (modelRefreshTimer !== null) clearInterval(modelRefreshTimer);
  modelRefreshTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || state.loading || state.data?.demo) return;
    appCallbacks.loadData?.({ silent: true }).catch(() => {});
  }, MODEL_REFRESH_MS);
  return resultsRefreshTimer;
}

export {
  configureSyncUI,
  saveLocal,
  scheduleSyncPush,
  refreshSyncDialogIfOpen,
  reloadActivePoolFromLocalStorage,
  pullSyncOnBoot,
  syncStatusLabel,
  summarizeSyncProfile,
  renderSyncDialog,
  bindSyncEvents,
  startAutomaticResultRefresh
};
