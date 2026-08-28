import { els, state, activePool, activeEntry } from './state.js';
import { escapeHtml } from './render-utils.js';

function renderEntryControls() {
  const entry = activeEntry();
  if (!entry) return;
  els.entrySelect.innerHTML = state.entries.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  els.entrySelect.value = entry.id;
  els.entryNameInput.value = entry.name;
  els.deleteEntryBtn.disabled = state.entries.length <= 1;
  els.deleteEntryBtn.title = state.entries.length <= 1 ? 'Each pool must keep at least one entry' : `Delete ${entry.name}`;
  els.deleteEntryCopy.textContent = `Delete “${entry.name}” from ${activePool().name}? This removes only this entry and its picks. Your other ${activePool().name} entries and the other conference pool are unchanged.`;
  els.picksPoolCopy.textContent = `${activePool().name} · ${entry.name}. Each entry has its own picks, used teams, rankings and season plan. ${state.entries.length} ${state.entries.length === 1 ? 'entry' : 'entries'} in this pool.`;
}

export { renderEntryControls };
