import { api, ENDPOINTS } from '../api.js';
import { escHtml } from '../utils.js';

function fmtTime(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleTimeString(); } catch { return ''; }
}

function stateColor(state, exitCode) {
  if (state === 'running' || state === 'starting') return '#0d4faf';
  if (state === 'exiting') return '#7c4d00';
  if (Number(exitCode) === 0) return '#1a6e35';
  return '#9c1a1a';
}

export function renderProcessRunCard(run) {
  const state = String(run?.state || 'unknown');
  const color = stateColor(state, run?.exitCode);
  const title = run?.title || run?.command || 'Command';
  const preview = String(run?.outputPreview || '').trim();
  const runId = String(run?.runId || '');
  return `
    <div class="process-run-card" data-run-id="${escHtml(runId)}">
      <div class="process-run-head">
        <div class="process-run-title">${escHtml(title)}</div>
        <span class="process-run-pill" style="color:${color};border-color:${color}33;background:${color}12">${escHtml(state)}${run?.exitCode != null ? ` ${escHtml(String(run.exitCode))}` : ''}</span>
      </div>
      <div class="process-run-meta">
        <span>${escHtml(runId)}</span>
        <span>${escHtml(fmtTime(run?.startedAt))}</span>
        <span>${escHtml(run?.cwd || '')}</span>
      </div>
      <pre class="process-run-preview">${escHtml(preview || '(no output yet)')}</pre>
      <div class="process-run-actions">
        <button type="button" data-process-action="log" data-run-id="${escHtml(runId)}">Logs</button>
        ${(state === 'running' || state === 'starting') ? `<button type="button" data-process-action="kill" data-run-id="${escHtml(runId)}">Kill</button>` : ''}
      </div>
      <pre class="process-run-log" id="process-log-${escHtml(runId)}" hidden></pre>
    </div>`;
}

export function renderProcessRunsHTML(runs = []) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return '<div class="process-run-empty">No command runs yet.</div>';
  }
  return runs.map(renderProcessRunCard).join('');
}

export async function loadRecentProcessRuns(limit = 8) {
  const data = await api(`${ENDPOINTS.PROCESSES}?limit=${encodeURIComponent(limit)}`);
  return Array.isArray(data?.runs) ? data.runs : [];
}

export function installProcessRunCardHandlers(root = document) {
  root.addEventListener('click', async (event) => {
    const button = event.target?.closest?.('[data-process-action]');
    if (!button) return;
    const action = button.dataset.processAction;
    const runId = button.dataset.runId;
    if (!runId) return;
    if (action === 'kill') {
      await api(ENDPOINTS.processRunAction(runId, 'kill'), { method: 'POST', body: {} });
      if (typeof window.refreshProcessRunsPanel === 'function') window.refreshProcessRunsPanel();
      return;
    }
    if (action === 'log') {
      const el = document.getElementById(`process-log-${runId}`);
      if (!el) return;
      if (!el.hidden) {
        el.hidden = true;
        return;
      }
      const log = await api(ENDPOINTS.processRunLog(runId));
      el.textContent = log?.combined || '(no output)';
      el.hidden = false;
    }
  });
}
