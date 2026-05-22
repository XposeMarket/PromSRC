import { api, ENDPOINTS } from '../api.js';
import { escHtml } from '../utils.js';
import { wsEventBus } from '../ws.js';

function fmtTime(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleTimeString(); } catch { return ''; }
}

function fmtDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1000) return `${Math.round(n)}ms`;
  const sec = Math.round(n / 100) / 10;
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

function stateColor(state, exitCode) {
  if (state === 'running' || state === 'starting') return '#0d4faf';
  if (state === 'exiting') return '#7c4d00';
  if (Number(exitCode) === 0) return '#1a6e35';
  return '#9c1a1a';
}

function activeTab(runId) {
  const wrap = document.getElementById(`process-log-wrap-${runId}`);
  return wrap?.dataset.processActiveTab || 'combined';
}

function setTerminalText(runId, text) {
  const el = document.getElementById(`process-log-${runId}`);
  if (!el) return;
  el.textContent = text || '(no output)';
  el.scrollTop = el.scrollHeight;
}

function appendTerminalChunk(runId, chunk, stream = 'stdout') {
  const el = document.getElementById(`process-log-${runId}`);
  if (!el || !chunk) return;
  const tab = activeTab(runId);
  if (tab !== 'combined' && tab !== stream) return;
  const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.textContent = `${el.textContent === '(no output yet)' || el.textContent === '(no output)' ? '' : el.textContent}${chunk}`;
  if (wasNearBottom) el.scrollTop = el.scrollHeight;
}

function cssEscape(value) {
  const raw = String(value || '');
  try {
    if (window.CSS?.escape) return window.CSS.escape(raw);
  } catch {}
  return raw.replace(/["\\\]]/g, '\\$&');
}

export function renderProcessRunCard(run) {
  const state = String(run?.state || 'unknown');
  const color = stateColor(state, run?.exitCode);
  const title = run?.title || run?.command || 'Command';
  const preview = String(run?.outputPreview || '').trim();
  const runId = String(run?.runId || '');
  const running = state === 'running' || state === 'starting' || state === 'exiting';
  const duration = run?.durationMs ? fmtDuration(run.durationMs) : (run?.startedAt ? fmtDuration(Date.now() - Date.parse(run.startedAt)) : '');
  const shell = run?.shell || 'auto';
  const statusText = `${state}${run?.exitCode != null ? ` ${run.exitCode}` : ''}`;
  const cwd = run?.cwd || '';
  return `
    <div class="process-run-card" data-run-id="${escHtml(runId)}">
      <div class="process-run-head">
        <div>
          <div class="process-run-kicker">Shell</div>
          <div class="process-run-title">${escHtml(title)}</div>
        </div>
        <span class="process-run-pill" style="color:${color};border-color:${color}33;background:${color}12">${escHtml(statusText)}</span>
      </div>
      <div class="process-run-meta">
        <span>${escHtml(runId)}</span>
        <span>shell ${escHtml(shell)}${run?.pty ? ' + pty' : ''}</span>
        <span>${escHtml(run?.mode || '')}</span>
        <span>${escHtml(fmtTime(run?.startedAt))}</span>
        ${duration ? `<span>${escHtml(duration)}</span>` : ''}
        ${run?.exitCode != null ? `<span>exit ${escHtml(String(run.exitCode))}</span>` : ''}
        <span>${escHtml(cwd)}</span>
      </div>
      ${run?.waitingForInputHint ? '<div class="process-run-hint">Waiting for input</div>' : ''}
      ${run?.failureSummary ? `<div class="process-run-summary process-run-failure">${escHtml(run.failureSummary)}</div>` : ''}
      ${run?.completionSummary && !running ? `<div class="process-run-summary">${escHtml(run.completionSummary)}</div>` : ''}
      <div class="process-run-terminal">
        <div class="process-run-terminal-bar">
          <span>Ran command</span>
          <span class="process-run-live-state">${running ? 'streaming' : 'completed'}</span>
        </div>
        <pre class="process-run-command"><span class="process-run-prompt">$</span> ${escHtml(run?.command || '')}</pre>
        <pre class="process-run-preview" id="process-log-${escHtml(runId)}">${escHtml(preview || '(no output yet)')}</pre>
      </div>
      <div class="process-run-actions">
        <button type="button" data-process-action="log" data-run-id="${escHtml(runId)}">Live tail</button>
        <button type="button" data-process-action="copy" data-run-id="${escHtml(runId)}">Copy output</button>
        <button type="button" data-process-action="rerun" data-run-id="${escHtml(runId)}">Rerun</button>
        ${running ? `<button type="button" data-process-action="kill" data-run-id="${escHtml(runId)}">Kill</button>` : ''}
        ${run?.stdinOpen || run?.pty ? `<input class="process-run-input" data-process-input="${escHtml(runId)}" placeholder="Send input..." /><button type="button" data-process-action="submit" data-run-id="${escHtml(runId)}">Send</button>` : ''}
      </div>
      <div class="process-run-log-wrap" id="process-log-wrap-${escHtml(runId)}" data-process-active-tab="combined">
        <div class="process-run-tabs">
          <button type="button" data-process-tab="combined" data-run-id="${escHtml(runId)}">combined</button>
          <button type="button" data-process-tab="stdout" data-run-id="${escHtml(runId)}">stdout</button>
          <button type="button" data-process-tab="stderr" data-run-id="${escHtml(runId)}">stderr</button>
        </div>
      </div>
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
    if (action === 'rerun') {
      await api(ENDPOINTS.processRunRerun(runId), { method: 'POST', body: {} });
      if (typeof window.refreshProcessRunsPanel === 'function') window.refreshProcessRunsPanel();
      return;
    }
    if (action === 'submit') {
      const input = root.querySelector(`[data-process-input="${CSS.escape(runId)}"]`);
      const value = input ? input.value : '';
      await api(ENDPOINTS.processRunAction(runId, 'submit'), { method: 'POST', body: { data: value } });
      if (input) input.value = '';
      if (typeof window.refreshProcessRunsPanel === 'function') window.refreshProcessRunsPanel();
      return;
    }
    if (action === 'copy') {
      const log = await api(ENDPOINTS.processRunLog(runId));
      await navigator.clipboard?.writeText?.(log?.combined || '');
      return;
    }
    if (action === 'log') {
      const log = await api(ENDPOINTS.processRunLog(runId));
      setTerminalText(runId, log?.combined || '');
    }
  });
  root.addEventListener('click', async (event) => {
    const button = event.target?.closest?.('[data-process-tab]');
    if (!button) return;
    const runId = button.dataset.runId;
    const tab = button.dataset.processTab || 'combined';
    if (!runId) return;
    const wrap = document.getElementById(`process-log-wrap-${runId}`);
    if (wrap) wrap.dataset.processActiveTab = tab;
    button.parentElement?.querySelectorAll('[data-process-tab]')?.forEach((btn) => {
      btn.classList.toggle('active', btn === button);
    });
    const log = await api(ENDPOINTS.processRunLog(runId));
    setTerminalText(runId, log?.[tab] || '');
  });
}

function installProcessRunLiveStream() {
  if (window.__processRunLiveStreamInstalled) return;
  window.__processRunLiveStreamInstalled = true;
  wsEventBus.on('process_run_output', (msg = {}) => {
    const runId = String(msg.run?.runId || msg.runId || '').trim();
    if (!runId) return;
    appendTerminalChunk(runId, String(msg.chunk || ''), String(msg.stream || 'stdout'));
  });
  ['process_run_started', 'process_run_update', 'process_run_exited'].forEach((eventName) => {
    wsEventBus.on(eventName, (msg = {}) => {
      const run = msg.run;
      const runId = String(run?.runId || msg.runId || '').trim();
      const card = runId ? document.querySelector(`.process-run-card[data-run-id="${cssEscape(runId)}"]`) : null;
      if (!run || !card) return;
      const pill = card.querySelector('.process-run-pill');
      if (pill) pill.textContent = `${run.state || 'unknown'}${run.exitCode != null ? ` ${run.exitCode}` : ''}`;
      const hint = card.querySelector('.process-run-live-state');
      if (hint) hint.textContent = run.state === 'exited' ? 'completed' : 'streaming';
    });
  });
}

installProcessRunLiveStream();
