import { renderMd } from '../../../utils.js';
import { wsEventBus } from '../../../ws.js';
import { ICONS } from '../../ui/icons.js';
import { escapeHtml } from '../../ui/page-kit.js';

const TASK_FILTERS = [
  { key: 'running', label: 'In Progress' },
  { key: 'complete', label: 'Completed' },
  { key: 'paused', label: 'Paused' },
  { key: 'needs_you', label: 'Needs You' },
  { key: 'failed', label: 'Failed' },
  { key: 'queued', label: 'Queued' },
];
const ACTIVE_FILTERS = new Set(['running', 'paused', 'needs_you', 'queued']);
const RECOVERY_STATUSES = new Set(['needs_assistance', 'awaiting_user_input', 'paused', 'stalled', 'failed']);
const TERMINAL_STATUS = /complete|succeeded|cancelled|failed/;
const REFRESH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.8-4L3 10"/><path d="M3 4v6h6M4 13a8 8 0 0 0 14.8 4L21 14"/><path d="M21 20v-6h-6"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg>';
const TASK_PILLS = {
  running: { label: 'running', cls: 'running' },
  queued: { label: 'queued', cls: 'orange' },
  paused: { label: 'paused', cls: 'gray' },
  stalled: { label: 'stalled', cls: 'orange' },
  needs_assistance: { label: 'needs help', cls: 'orange' },
  awaiting_user_input: { label: 'awaiting', cls: 'orange' },
  waiting_subagent: { label: 'waiting', cls: 'orange' },
  completed: { label: 'complete', cls: 'active' },
  succeeded: { label: 'success', cls: 'active' },
  failed: { label: 'failed', cls: 'orange' },
  cancelled: { label: 'cancelled', cls: 'gray' },
};

function rawStatus(task) { return String(task?.status || task?.state || '').trim().toLowerCase(); }
function taskStatus(task) {
  const status = rawStatus(task);
  if (['completed', 'done', 'succeeded'].includes(status)) return 'complete';
  if (status === 'awaiting_user_input') return 'needs_assistance';
  if (['waiting_subagent', 'in_progress'].includes(status)) return 'running';
  if (status === 'cancelled') return 'failed';
  return status || 'queued';
}
function taskFilter(task) {
  const status = taskStatus(task);
  if (status === 'needs_assistance') return 'needs_you';
  if (status === 'stalled') return 'paused';
  return ['running', 'complete', 'paused', 'failed', 'queued'].includes(status) ? status : 'queued';
}
function taskPill(task) {
  const status = rawStatus(task) || 'queued';
  const pill = TASK_PILLS[status] || TASK_PILLS[taskStatus(task)] || { label: taskStatus(task), cls: 'gray' };
  return `<span class="pm-pill ${pill.cls}">${escapeHtml(pill.label)}</span>`;
}
function brainTaskLabel(task) {
  const job = String(task?.brainJob || '').trim().toLowerCase();
  if (job === 'thought') return 'Brain Thought';
  if (job === 'dream_cleanup') return 'Brain Dream Cleanup';
  if (job === 'dream') return 'Brain Dream';
  return '';
}
function isBrainTask(task) {
  return Boolean(brainTaskLabel(task)) || /^brain_(?:thought|dream)(?:_|$)/i.test(String(task?.sessionId || ''));
}
function progressItems(task) {
  const plan = Array.isArray(task?.plan) ? task.plan : [];
  if (plan.length) {
    const currentIndex = Number.isFinite(Number(task?.currentStepIndex)) ? Number(task.currentStepIndex) : -1;
    const status = rawStatus(task);
    return plan.map((step, index) => {
      const raw = String(step?.status || 'pending').toLowerCase();
      let current = 'pending';
      if (raw === 'done' || raw === 'skipped') current = 'done';
      else if (raw === 'failed') current = 'failed';
      else if (raw === 'running' || (status === 'running' && index === currentIndex)) current = 'in_progress';
      else if (['failed', 'stalled', 'needs_assistance'].includes(status) && index === currentIndex) current = 'failed';
      return { text: step?.description || step?.text || step?.title || `Step ${index + 1}`, status: current };
    });
  }
  const runtime = Array.isArray(task?.runtimeProgress?.items) ? task.runtimeProgress.items : [];
  return runtime.map((item, index) => ({ text: item?.text || `Step ${index + 1}`, status: item?.status || 'pending' }));
}
function renderProgress(items) {
  if (!items.length) return '<div class="pm-card-body">No plan steps recorded yet.</div>';
  return `<div style="display:flex;flex-direction:column;gap:8px;">${items.map((item, index) => {
    const status = String(item.status || 'pending').toLowerCase();
    const done = status === 'done' || status === 'skipped';
    const failed = status === 'failed';
    const running = status === 'running' || status === 'in_progress';
    const color = failed ? '#d8473a' : done ? '#2fae66' : running ? '#0d4faf' : 'var(--pm-muted)';
    const marker = done ? 'OK' : failed ? '!' : String(index + 1);
    const background = running ? '#eaf2ff' : done ? '#eaffe9' : failed ? '#fff0f0' : 'var(--pm-surface)';
    return `<div style="display:grid;grid-template-columns:28px 1fr;gap:8px;align-items:start;">
      <span style="width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:${background};border:1px solid var(--pm-border);color:${color};font-size:10px;font-weight:800;">${marker}</span>
      <span style="font-size:12px;line-height:1.45;color:var(--pm-text);">${escapeHtml(String(item.text || '').slice(0, 260))}</span>
    </div>`;
  }).join('')}</div>`;
}
function renderRecovery(task) {
  const turns = Array.isArray(task?.recoveryConversation) ? task.recoveryConversation.slice(-12) : [];
  const pending = String(task?.pendingClarificationQuestion || '').trim();
  const pauseMessage = String(task?.pauseAnalysis?.message || '').trim();
  const keyFor = (value) => String(value || '').replace(/\s+/g, ' ').replace(/[#*_`~>-]+/g, '').trim().toLowerCase();
  const pauseKey = keyFor(pauseMessage);
  const seen = new Set();
  const uniqueTurns = turns.filter((turn) => {
    const key = keyFor(turn?.content);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !(pauseKey && (key === pauseKey || (key.length > 160 && pauseKey.includes(key)) || (pauseKey.length > 160 && key.includes(pauseKey))));
  });
  const content = [];
  if (pending) content.push(`<div class="pm-card-body"><strong>Pending question:</strong> ${escapeHtml(pending)}</div>`);
  if (pauseMessage) content.push(`<div class="pm-card-body pm-task-recovery-copy">
    <div class="pm-task-recovery-label">Recovery plan</div>
    <div class="markdown-body pm-task-markdown">${renderMd(pauseMessage)}</div>
  </div>`);
  if (uniqueTurns.length) content.push(`<div style="display:flex;flex-direction:column;gap:8px;">${uniqueTurns.map((turn) => {
    const user = turn?.role === 'user';
    return `<div class="pm-task-recovery-message ${user ? 'from-user' : 'from-prometheus'}" style="align-self:${user ? 'flex-end' : 'flex-start'};max-width:92%;">
      <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--pm-muted);margin-bottom:4px;">${user ? 'You' : 'Prometheus'}</div>
      <div class="markdown-body pm-task-markdown pm-task-recovery-turn">${renderMd(turn?.content || '')}</div>
    </div>`;
  }).join('')}</div>`);
  return content.join('') || '<div class="pm-card-body">No recovery messages yet.</div>';
}
function parseDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number' || /^\d+$/.test(String(value || ''))) return new Date(Number(value));
  return new Date(value);
}
function timeAgo(value) {
  if (!value) return '';
  const timestamp = Number(parseDate(value));
  if (!Number.isFinite(timestamp)) return '';
  const delta = Date.now() - timestamp;
  if (delta < 0) return new Date(timestamp).toLocaleString();
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
function formatDuration(value) {
  if (!value) return '';
  let milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) milliseconds = Number(parseDate(value));
  if (!Number.isFinite(milliseconds)) return '';
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
function formatClock(value) {
  const date = parseDate(value);
  return Number.isFinite(Number(date)) ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}
function renderEvidence(entries) {
  if (!entries?.length) return '<div class="pm-card-body">No evidence bus entries yet.</div>';
  return `<div class="pm-task-evidence-list">${entries.slice().reverse().map((entry) => `<div class="pm-task-evidence-entry">
    <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
      <strong style="font-size:12px;">${escapeHtml(entry?.title || entry?.type || 'Evidence')}</strong>
      <span style="font-size:10px;color:var(--pm-muted);">${entry?.t || entry?.timestamp ? escapeHtml(formatClock(entry.t || entry.timestamp)) : ''}</span>
    </div>
    <div style="font-size:12px;color:var(--pm-text-soft);white-space:pre-wrap;word-break:break-word;">${escapeHtml(entry?.content || entry?.summary || entry?.text || JSON.stringify(entry).slice(0, 700))}</div>
  </div>`).join('')}</div>`;
}
function renderJournal(journal) {
  const entries = Array.isArray(journal) ? journal.slice().reverse() : [];
  if (!entries.length) return '<div class="pm-card-body">No process log entries yet.</div>';
  return `<div class="pm-task-journal" data-pm-task-journal>${entries.map((entry) => {
    const time = entry?.t ? formatClock(entry.t) : '';
    const type = String(entry?.type || 'event');
    const content = String(entry?.content || entry?.detail || '').trim();
    const color = type === 'error' ? '#d8473a' : type === 'tool_call' ? '#0d4faf' : type === 'tool_result' ? '#2f7d44' : type === 'reasoning' ? '#6d2d9e' : type === 'pause' ? '#7c4d00' : 'var(--pm-muted)';
    const typeClass = type.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    const detail = String(entry?.detail || '').trim();
    const detailMarkup = detail && detail !== content ? `<details class="pm-task-journal-detail"><summary>View full output</summary><pre>${escapeHtml(detail)}</pre></details>` : '';
    return `<div class="pm-task-journal-row type-${escapeHtml(typeClass)}" style="display:grid;grid-template-columns:54px 82px 1fr;gap:6px;padding:7px 8px;border-bottom:1px solid var(--pm-border);">
      <span style="color:var(--pm-muted);">${escapeHtml(time)}</span>
      <span style="color:${color};font-weight:800;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(type)}</span>
      <span style="white-space:pre-wrap;word-break:break-word;color:var(--pm-text-soft);">${escapeHtml(content)}${detailMarkup}</span>
    </div>`;
  }).join('')}</div>`;
}
function dispatchedMessage(task) {
  const original = String(task?.originalAssignment || '').trim();
  if (original) return original;
  const prompt = String(task?.prompt || task?.title || '').trim();
  if (!prompt) return '';
  const messageMatch = prompt.match(/(?:^|\n)Message:\s*\n([\s\S]*?)(?=\n\n(?:CONTEXT DATA|CONSTRAINTS|SUCCESS CRITERIA|EVIDENCE BUS|PROCESS LOG):|$)/i);
  if (messageMatch?.[1]?.trim()) return messageMatch[1].trim();
  const taskMatch = prompt.match(/(?:^|\n)(?:YOUR TASK|TASK):\s*\n?([\s\S]*?)(?=\n\n(?:ADDITIONAL CONTEXT|CONTEXT DATA|CONSTRAINTS|SUCCESS CRITERIA|TOOL RULES|EVIDENCE BUS|PROCESS LOG):|$)/i);
  return taskMatch?.[1]?.trim() || prompt;
}
function renderPrompt(task) {
  const prompt = dispatchedMessage(task);
  if (!prompt) return '';
  const compact = prompt.replace(/\s+/g, ' ').trim();
  const previewLimit = 96;
  return `<section class="pm-task-prompt-section">
    <details class="pm-task-prompt-disclosure">
      <summary><span class="pm-task-prompt-title">Task Prompt</span><span class="pm-task-prompt-preview">${escapeHtml(compact.slice(0, previewLimit))}${compact.length > previewLimit ? '…' : ''}</span></summary>
      <div class="pm-card-body pm-task-prompt-body">${escapeHtml(prompt)}</div>
    </details>
  </section>`;
}
function taskAction(task) {
  if (isBrainTask(task)) return null;
  const status = rawStatus(task);
  if (status === 'running') return { action: 'pause', label: 'Pause' };
  if (['paused', 'queued', 'stalled', 'needs_assistance', 'awaiting_user_input'].includes(status)) return { action: 'resume', label: 'Resume' };
  if (status === 'failed') return { action: 'retry', label: 'Restart' };
  return null;
}
function skeleton() {
  const block = `<div class="pm-card" style="opacity:.55"><div class="pm-card-head">${ICONS.clipboard} loading…</div><div class="pm-card-body" style="height:36px;background:rgba(0,0,0,.04);border-radius:6px;"></div></div>`;
  return block.repeat(3);
}

export async function mountTasksPage({ shell, features, route }) {
  shell.setActiveTab('tasks');
  shell.setTitle('Tasks');

  let disposed = false;
  let allTasks = [];
  let currentFilter = 'running';
  let expandedId = String(route?.id || '').trim();
  const details = new Map();
  const evidence = new Map();
  const page = shell.page;
  let refreshTimer = null;
  let eventRefreshTimer = null;

  page.classList.add('pm-v2-task-page');
  shell.renderHeader?.();
  page.innerHTML = `<div class="pm-v2-task-toolbar">
    <span class="pm-count-pill" id="pm-tasks-count">…</span>
      <button class="pm-icon-btn" id="pm-tasks-refresh" type="button" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${REFRESH_ICON}</button>
  </div><div id="pm-tasks-body">
    <div class="pm-tabs" id="pm-tasks-filter" style="margin-top:4px;overflow-x:auto;justify-content:flex-start;">
      ${TASK_FILTERS.map((filter, index) => `<button type="button" class="${index === 0 ? 'active' : ''}" data-filter="${filter.key}">${filter.label} <span data-count="${filter.key}"></span></button>`).join('')}
    </div>
    <div id="pm-tasks-list">${skeleton()}</div>
  </div>`;

  const list = page.querySelector('#pm-tasks-list');
  const count = page.querySelector('#pm-tasks-count');
  const filterBar = page.querySelector('#pm-tasks-filter');

  function restoreScroll(scrollTop, distanceFromBottom) {
    requestAnimationFrame(() => {
      if (disposed) return;
      if (distanceFromBottom < 48) page.scrollTop = page.scrollHeight;
      else page.scrollTop = Math.max(0, page.scrollHeight - page.clientHeight - distanceFromBottom);
      if (!Number.isFinite(page.scrollTop)) page.scrollTop = scrollTop;
    });
  }

  function paint() {
    if (disposed) return;
    const scrollTop = page.scrollTop || 0;
    const distanceFromBottom = Math.max(0, page.scrollHeight - page.scrollTop - page.clientHeight);
    const journal = list.querySelector('[data-pm-task-journal]');
    const journalScroll = journal ? {
      top: journal.scrollTop || 0,
      distance: Math.max(0, journal.scrollHeight - journal.scrollTop - journal.clientHeight),
      nearBottom: journal.scrollHeight - journal.scrollTop - journal.clientHeight < 48,
    } : null;

    const counts = Object.fromEntries(TASK_FILTERS.map((filter) => [filter.key, 0]));
    for (const task of allTasks) {
      const key = taskFilter(task);
      counts[key] = (counts[key] || 0) + 1;
    }
    for (const filter of TASK_FILTERS) {
      const target = filterBar.querySelector(`[data-count="${filter.key}"]`);
      if (target) target.textContent = counts[filter.key] ? `(${counts[filter.key]})` : '';
    }
    const tasks = allTasks.filter((task) => taskFilter(task) === currentFilter);
    if (!tasks.length) {
      list.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>No tasks here</h2><p>Background tasks and agent runs will appear here.</p></div>`;
      restoreScroll(scrollTop, distanceFromBottom);
      return;
    }

    list.innerHTML = tasks.map((task) => {
      const id = String(task.id || '');
      const brain = brainTaskLabel(task);
      const source = brain || String(task.channel || task.source || task.actor || 'Background task');
      const started = task.startedAt || task.createdAt;
      const finished = task.completedAt || task.finishedAt;
      const duration = finished && task.startedAt ? formatDuration(Number(parseDate(finished)) - Number(parseDate(task.startedAt))) : (task.startedAt ? formatDuration(Date.now() - Number(parseDate(task.startedAt))) : '');
      const summary = String(task.title || task.prompt || task.summary || task.detail || '');
      const progress = progressItems(task);
      const currentStep = progress.find((item) => String(item?.status) === 'in_progress')?.text || '';
      const open = id === expandedId;
      const detail = details.get(id)?.task;
      const detailEvidence = evidence.get(id) || details.get(id)?.evidenceBus?.entries || [];
      const action = taskAction(detail || task);
      const filter = taskFilter(detail || task);
      const removeAvailable = TERMINAL_STATUS.test(rawStatus(detail || task));

      return `<article class="pm-card pm-task-card" style="padding:12px 14px;cursor:pointer;" data-task-id="${escapeHtml(id)}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <strong style="flex:1;font-size:13px;line-height:1.3;">${escapeHtml(summary.slice(0, 140))}${summary.length > 140 ? '...' : ''}</strong>
          ${taskPill(task)}
        </div>
        ${brain ? `<div style="font-size:10px;color:#6d2d9e;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:-1px 0 5px;">${escapeHtml(brain)}${task.brainDate ? ` · ${escapeHtml(String(task.brainDate))}` : ''}</div>` : ''}
        ${currentStep ? `<div class="pm-card-body" style="font-size:12px;color:var(--pm-text-soft);margin-bottom:4px;"><span style="color:var(--pm-orange);font-weight:700;">&gt;</span> ${escapeHtml(String(currentStep).slice(0, 160))}</div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);gap:10px;">
          <span>${escapeHtml(source)} - ${progress.length} step${progress.length === 1 ? '' : 's'}</span>
          <span>${started ? escapeHtml(timeAgo(started)) : ''}${duration ? ` - ${escapeHtml(duration)}` : ''}</span>
        </div>
        ${open ? `<div class="pm-task-expanded" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--pm-border);display:flex;flex-direction:column;gap:12px;cursor:default;">
          ${!detail ? `<div class="pm-card-body">${details.get(id)?.error ? `Could not load task details: ${escapeHtml(details.get(id).error)}` : 'Loading task details...'}</div>` : `
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${action ? `<button class="pm-btn ghost" data-task-action="${action.action}" data-task-id="${escapeHtml(id)}">${escapeHtml(action.label)}</button>` : ''}
              ${removeAvailable ? `<button class="pm-btn ghost danger" data-task-action="delete" data-task-id="${escapeHtml(id)}">${TRASH_ICON} Remove</button>` : ''}
            </div>
            ${brain ? `<div style="background:#f8f5ff;border:1px solid #e9d8ff;border-radius:10px;padding:9px 11px;font-size:11px;color:#6d2d9e;line-height:1.5;"><strong>${escapeHtml(brain)}</strong>${detail.brainDate ? ` · ${escapeHtml(String(detail.brainDate))}` : ''}${detail.brainRunId ? `<br><span style="opacity:.78">Run ${escapeHtml(String(detail.brainRunId))}</span>` : ''}${detail.brainArtifact ? `<br><span style="opacity:.78">Primary artifact: ${escapeHtml(String(detail.brainArtifact))}</span>` : ''}</div>` : ''}
            ${detail.finalSummary ? `<section><div class="pm-card-head">Final Response</div><div class="pm-card-body pm-task-final-response markdown-body pm-task-markdown">${renderMd(detail.finalSummary)}</div></section>` : ''}
            ${RECOVERY_STATUSES.has(rawStatus(detail)) ? `<section class="pm-task-recovery-panel">
              <div class="pm-card-head pm-task-recovery-head">Needs You / Recovery</div>
              ${renderRecovery(detail)}
              <div style="display:flex;gap:8px;margin-top:10px;">
                <textarea class="pm-textarea" data-task-reply="${escapeHtml(id)}" rows="2" placeholder="Reply to this task..." style="min-height:58px;"></textarea>
                <button class="pm-btn primary" data-task-send="${escapeHtml(id)}" style="align-self:flex-end;">Send</button>
              </div>
            </section>` : ''}
            <section><div class="pm-card-head">Progress</div>${renderProgress(progressItems(detail))}</section>
            ${renderPrompt(detail)}
            <section><div class="pm-card-head">Evidence Bus</div>${renderEvidence(detailEvidence)}</section>
            <section><div class="pm-card-head">Process Log</div>${renderJournal(detail.journal)}</section>
          `}
        </div>` : ''}
      </article>`;
    }).join('');

    wireTaskCards();
    const nextJournal = list.querySelector('[data-pm-task-journal]');
    if (nextJournal && journalScroll) {
      const restoreJournal = () => {
        if (journalScroll.nearBottom) nextJournal.scrollTop = nextJournal.scrollHeight;
        else nextJournal.scrollTop = Math.max(0, nextJournal.scrollHeight - nextJournal.clientHeight - journalScroll.distance);
      };
      restoreJournal();
      requestAnimationFrame(restoreJournal);
    }
    restoreScroll(scrollTop, distanceFromBottom);
  }

  async function loadDetail(id) {
    try {
      const [response, detailEvidence] = await Promise.all([features.task(id), features.taskEvidence(id)]);
      if (disposed) return;
      if (response?.success === false) throw new Error(response.error || 'Could not load task details.');
      const task = response?.task || response;
      if (!task || typeof task !== 'object') throw new Error('Could not load task details.');
      details.set(id, { task, evidenceBus: response?.evidenceBus || null });
      evidence.set(id, Array.isArray(detailEvidence) ? detailEvidence : []);
    } catch (error) {
      if (disposed) return;
      details.set(id, { task: null, error: error?.message || 'Failed to load task detail' });
    }
    paint();
  }

  async function load({ force = true, resetExpandedDetail = false } = {}) {
    try {
      const nextTasks = await features.tasks({ force });
      if (disposed) return;
      allTasks = Array.isArray(nextTasks) ? nextTasks : [];
      if (expandedId) {
        const selected = allTasks.find((task) => String(task.id || '') === expandedId);
        if (selected) {
          currentFilter = taskFilter(selected);
          filterBar.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.filter === currentFilter));
        }
      } else if (allTasks.length && !allTasks.some((task) => taskFilter(task) === currentFilter)) {
        const fallback = TASK_FILTERS.find((filter) => allTasks.some((task) => taskFilter(task) === filter.key))?.key;
        if (fallback) {
          currentFilter = fallback;
          filterBar.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.filter === currentFilter));
        }
      }
      const activeCount = allTasks.filter((task) => ACTIVE_FILTERS.has(taskFilter(task))).length;
      count.textContent = `${activeCount} active`;
      paint();
      if (expandedId) {
        if (resetExpandedDetail) details.delete(expandedId);
        if (!details.has(expandedId) || !details.get(expandedId)?.task) await loadDetail(expandedId);
      }
    } catch (error) {
      if (disposed) return;
      if (!allTasks.length) list.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.clipboard}</div><h2>Could not load tasks</h2><p>${escapeHtml(error?.message || '')}</p></div>`;
    }
  }

  function wireTaskCards() {
    list.querySelectorAll('.pm-task-card').forEach((card) => {
      card.addEventListener('click', async (event) => {
        if (event.target.closest('button, textarea, input, a, summary')) return;
        const id = card.getAttribute('data-task-id');
        expandedId = expandedId === id ? '' : id;
        paint();
        if (expandedId && !details.has(expandedId)) await loadDetail(expandedId);
      });
    });
    list.querySelectorAll('[data-task-action]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = button.dataset.taskId;
        const action = button.dataset.taskAction;
        button.disabled = true;
        try {
          const response = await features.taskAction(id, action);
          if (!response || response.success === false) throw new Error(response?.error || 'Action failed');
          shell.showNotice(action === 'delete' ? 'Task removed' : 'Task updated');
          details.delete(id);
          if (action === 'delete') expandedId = '';
          await load({ force: true });
        } catch (error) {
          shell.showNotice(error?.message || 'Action failed');
          button.disabled = false;
        }
      });
    });
    list.querySelectorAll('[data-task-send]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = button.dataset.taskSend;
        const input = list.querySelector(`[data-task-reply="${CSS.escape(id)}"]`);
        const message = String(input?.value || '').trim();
        if (!message) return;
        button.disabled = true;
        try {
          const response = await features.taskMessage(id, message);
          if (!response || response.success === false) throw new Error(response?.error || 'Send failed');
          if (input) input.value = '';
          shell.showNotice('Reply sent');
          details.delete(id);
          await loadDetail(id);
        } catch (error) {
          shell.showNotice(error?.message || 'Send failed');
          button.disabled = false;
        }
      });
    });
  }

  filterBar.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      filterBar.querySelectorAll('button').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      currentFilter = button.dataset.filter;
      expandedId = '';
      paint();
    });
  });
  page.querySelector('#pm-tasks-refresh')?.addEventListener('click', () => {
    list.innerHTML = skeleton();
    load({ force: true, resetExpandedDetail: true });
  });

  const onTaskEvent = (event = {}) => {
    if (disposed || !event.taskId) return;
    if (eventRefreshTimer) clearTimeout(eventRefreshTimer);
    eventRefreshTimer = setTimeout(() => {
      eventRefreshTimer = null;
      load({ force: true }).catch(() => {});
    }, 120);
  };
  const taskEvents = ['task_running', 'task_panel_update', 'task_complete', 'task_failed'];
  taskEvents.forEach((name) => wsEventBus.on(name, onTaskEvent));

  await load({ force: true });
  refreshTimer = setInterval(() => load({ force: true }).catch(() => {}), 5000);

  return () => {
    disposed = true;
    if (refreshTimer) clearInterval(refreshTimer);
    if (eventRefreshTimer) clearTimeout(eventRefreshTimer);
    taskEvents.forEach((name) => wsEventBus.off(name, onTaskEvent));
    page.classList.remove('pm-v2-task-page');
  };
}
