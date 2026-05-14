/**
 * TasksPage.js — F3d Extract
 *
 * Background Tasks (Kanban) page + Error Response Panel.
 *
 * BGT Functions: bgtNormalizeStatus, refreshBgTasks, renderBgTasks,
 *   bgtCardHTML, openBgtPanel, closeBgtPanel, bgtRefreshOpenPanel,
 *   bgtPauseResume, bgtSendReply, bgtChatSend, bgtDeleteTask,
 *   toggleEvidenceBus, loadEvidenceBusEntries, appendEvidenceBusEntry,
 *   updateManagerStatusBar
 *
 * Error Response Functions: _getOrCreateErrorBackdrop, showErrorResponsePanel,
 *   selectErrorOption, closeErrorResponse, submitErrorResponse,
 *   handleErrorResponseWsEvent (+ patchWebSocketForErrorResponse IIFE)
 *
 * Dependencies: api() from api.js, escHtml/showToast/showConfirm/bgtToast from utils.js
 */

import { api } from '../api.js';
import { escHtml, showToast, showConfirm, bgtToast, renderMd } from '../utils.js';
import { wsEventBus } from '../ws.js';
import { installProcessRunCardHandlers, loadRecentProcessRuns, renderProcessRunsHTML } from '../components/ProcessRunCard.js';
import { installCodingWorkspaceHandlers, loadCodingWorkspace, renderCodingWorkspacePanel } from '../components/CodingWorkspacePanel.js';


// ─── Shared helpers (moved from ChatPage.js — used by bgtCardHTML) ──────────

function normalizeProgressStatus(rawStatus) {
  const status = String(rawStatus || 'pending');
  if (status === 'done' || status === 'failed' || status === 'in_progress' || status === 'skipped') return status;
  return 'pending';
}

function getTaskProgressItems(task) {
  // Priority 1: task.plan[] — the authoritative persisted plan (set by declare_plan + mutated by step_complete).
  // This is stable and only changes via explicit step_complete calls, so the UI never flickers.
  const plan = Array.isArray(task?.plan) ? task.plan : [];
  if (plan.length > 0) {
    const currentIndex = Number.isFinite(Number(task?.currentStepIndex)) ? Number(task.currentStepIndex) : -1;
    const taskStatus = String(task?.status || '').toLowerCase();
    return plan.map((step, idx) => {
      const raw = String(step?.status || 'pending').toLowerCase();
      let status = 'pending';
      if (raw === 'done' || raw === 'skipped') status = 'done';
      else if (raw === 'failed') status = 'failed';
      else if (taskStatus === 'running' && idx === currentIndex) status = 'in_progress';
      else if (raw === 'running' && (taskStatus === 'running' || taskStatus === 'queued')) status = 'in_progress';
      else if ((taskStatus === 'failed' || taskStatus === 'stalled' || taskStatus === 'needs_assistance') && idx === currentIndex) status = 'failed';
      const suffix = raw === 'skipped' ? ' (skipped)' : '';
      return {
        id: `task_${String(task?.id || 'x')}_${idx + 1}`,
        text: `${String(step?.description || `Step ${idx + 1}`)}${suffix}`,
        status,
      };
    });
  }

  // Priority 2: runtimeProgress — for interactive sessions that called declare_plan
  // but have no persistent task.plan[] (e.g. direct chat sessions).
  const runtimeItems = Array.isArray(task?.runtimeProgress?.items) ? task.runtimeProgress.items : [];
  if (runtimeItems.length > 0) {
    return runtimeItems.map((item, idx) => ({
      id: String(item?.id || `runtime_${idx + 1}`),
      text: String(item?.text || `Step ${idx + 1}`),
      status: normalizeProgressStatus(item?.status),
    }));
  }

  return [];
}

window.getTaskProgressItems = getTaskProgressItems;
window.normalizeProgressStatus = normalizeProgressStatus;

// ---------------------------------------------------------------------------
// BACKGROUND TASKS KANBAN SYSTEM
// ---------------------------------------------------------------------------

let bgtTasks = [];           // all task records from server
let bgtOpenTaskId = null;    // currently open panel task id
window.bgtOpenTaskId = null;
let bgtEditMode = false;
let bgtDraggedTaskId = null;
let bgtDragClickSuppressUntil = 0;
let bgtRecentProcessRuns = [];
let bgtCodingWorkspace = null;

const BGT_HIDDEN_KEY = 'prom_hidden_tasks';

function bgtGetHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(BGT_HIDDEN_KEY) || '[]')); } catch { return new Set(); }
}

function bgtSaveHidden(set) {
  localStorage.setItem(BGT_HIDDEN_KEY, JSON.stringify([...set]));
}

function bgtHideTask(taskId) {
  const hidden = bgtGetHidden();
  hidden.add(taskId);
  bgtSaveHidden(hidden);
  if (bgtOpenTaskId === taskId) closeBgtPanel();
  renderBgTasks();
}

function toggleBgtEditMode() {
  bgtEditMode = !bgtEditMode;
  const btn = document.getElementById('bgt-edit-btn');
  if (btn) {
    btn.textContent = bgtEditMode ? 'Done' : 'Edit';
    btn.style.background = bgtEditMode ? 'var(--brand)' : 'var(--panel)';
    btn.style.color = bgtEditMode ? '#fff' : 'var(--muted)';
    btn.style.borderColor = bgtEditMode ? 'var(--brand)' : 'var(--line)';
  }
  renderBgTasks();
}

// --- Columns config ---------------------------------------------------------
const BGT_COLUMNS = [
  { key: 'running',          label: '● In Progress', color: '#0d4faf', bg: '#eaf2ff' },
  { key: 'queued',           label: '◷ Queued',      color: '#7c4d00', bg: '#fff8e1' },
  { key: 'paused',           label: '‖ Paused',      color: '#555',    bg: '#f5f5f5' },
  { key: 'stalled',          label: '▲ Stalled',     color: '#9c1a1a', bg: '#fff0f0' },
  { key: 'needs_assistance', label: '⚠️ Needs You',  color: '#6d2d9e', bg: '#f5eeff' },
  { key: 'complete',         label: '✓ Complete',    color: '#1a6e35', bg: '#efffea' },
  { key: 'failed',           label: '✕ Failed',      color: '#9c1a1a', bg: '#fff0f0' },
];

const STATUS_ICON = {
  running: '●',
  queued: '◷',
  paused: '‖',
  stalled: '▲',
  needs_assistance: '⚠️',
  awaiting_user_input: '⚠️',
  waiting_subagent: '◷',
  complete: '✓',
  completed: '✓',
  done: '✓',
  failed: '✕',
};

function bgtNormalizeStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (status === 'awaiting_user_input') return 'needs_assistance';
  if (status === 'waiting_subagent' || status === 'in_progress') return 'running';
  if (status === 'completed' || status === 'done') return 'complete';
  return status;
}

function bgtGetTask(taskId) {
  return bgtTasks.find(t => String(t.id) === String(taskId));
}

function bgtActionForDrop(task, targetStatus) {
  if (!task || !targetStatus) return null;
  const rawStatus = String(task.status || '').trim().toLowerCase();
  const displayStatus = bgtNormalizeStatus(rawStatus);
  if (displayStatus === targetStatus) return { type: 'noop' };

  if (targetStatus === 'paused') {
    if (rawStatus === 'complete' || rawStatus === 'completed' || rawStatus === 'done' || rawStatus === 'failed') return null;
    return { type: 'pause', endpoint: `/api/bg-tasks/${encodeURIComponent(task.id)}/pause`, label: 'Task paused' };
  }

  if (targetStatus === 'running' || targetStatus === 'queued') {
    if (rawStatus === 'failed') {
      return { type: 'restart', endpoint: `/api/bg-tasks/${encodeURIComponent(task.id)}/restart`, label: 'Task restarted' };
    }
    if (['paused', 'queued', 'stalled', 'needs_assistance', 'awaiting_user_input', 'running'].includes(rawStatus)) {
      if (rawStatus === 'running') return { type: 'noop' };
      return { type: 'resume', endpoint: `/api/bg-tasks/${encodeURIComponent(task.id)}/resume`, label: 'Task resumed' };
    }
    return null;
  }

  return null;
}

function bgtSetDropActive(targetStatus, active) {
  document.querySelectorAll(`[data-bgt-drop-status="${targetStatus}"]`).forEach((el) => {
    el.style.outline = active ? '2px solid var(--brand)' : '';
    el.style.outlineOffset = active ? '3px' : '';
    el.style.background = active ? 'rgba(90,145,255,0.06)' : '';
  });
}

function bgtHandleCardDragStart(e, taskId) {
  bgtDraggedTaskId = taskId;
  bgtDragClickSuppressUntil = Date.now() + 600;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  }
  const card = e.currentTarget;
  if (card) {
    card.style.opacity = '0.65';
    card.style.transform = 'scale(0.98)';
  }
}

function bgtHandleCardDragEnd(e) {
  bgtDraggedTaskId = null;
  document.querySelectorAll('[data-bgt-drop-status]').forEach((el) => bgtSetDropActive(el.dataset.bgtDropStatus, false));
  const card = e.currentTarget;
  if (card) {
    card.style.opacity = '';
    card.style.transform = '';
  }
}

function bgtOpenCardFromClick(e, taskId) {
  if (Date.now() < bgtDragClickSuppressUntil) {
    if (e) e.stopPropagation();
    return;
  }
  openBgtPanel(taskId);
}

function bgtHandleColumnDragOver(e, targetStatus) {
  if (!bgtDraggedTaskId) return;
  const task = bgtGetTask(bgtDraggedTaskId);
  if (!bgtActionForDrop(task, targetStatus)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
}

function bgtHandleColumnDragEnter(e, targetStatus) {
  if (!bgtDraggedTaskId) return;
  const task = bgtGetTask(bgtDraggedTaskId);
  if (!bgtActionForDrop(task, targetStatus)) return;
  e.preventDefault();
  bgtSetDropActive(targetStatus, true);
}

function bgtHandleColumnDragLeave(e, targetStatus) {
  const current = e.currentTarget;
  if (current && e.relatedTarget && current.contains(e.relatedTarget)) return;
  bgtSetDropActive(targetStatus, false);
}

async function bgtMoveTaskToStatus(taskId, targetStatus) {
  const task = bgtGetTask(taskId);
  const action = bgtActionForDrop(task, targetStatus);
  bgtSetDropActive(targetStatus, false);
  bgtDraggedTaskId = null;

  if (!task || !action) {
    bgtToast('Task not moved', 'That column does not have a matching task action');
    await refreshBgTasks();
    return;
  }
  if (action.type === 'noop') {
    bgtToast('No change', 'Task is already there');
    return;
  }

  try {
    const result = await api(action.endpoint, { method: 'POST' });
    if (!result?.success) {
      bgtToast('Task not moved', result?.error || 'Could not update task');
    } else {
      bgtToast(action.label, 'Updated from the board');
    }
  } catch (err) {
    bgtToast('Task not moved', err?.message || 'Could not update task');
  }
  await refreshBgTasks();
  if (bgtOpenTaskId === taskId) await bgtRefreshOpenPanel();
}

async function bgtHandleColumnDrop(e, targetStatus) {
  e.preventDefault();
  const taskId = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || bgtDraggedTaskId;
  if (!taskId) return;
  await bgtMoveTaskToStatus(taskId, targetStatus);
}

// --- Fetch & Render ----------------------------------------------------------
async function refreshBgTasks() {
  try {
    const data = await api('/api/bg-tasks', { timeoutMs: 8000 });
    if (data.success) {
      bgtTasks = data.tasks || [];
    }
  } catch (err) {
    console.error('[BGT] refreshBgTasks error:', err);
  }
  if (typeof window.refreshHeartbeatSummary === 'function') window.refreshHeartbeatSummary().catch(() => {});
  renderBgTasks();
}

async function loadTaskApprovals(taskId) {
  if (!taskId) return [];
  try {
    const data = await api(`/api/approvals?status=pending&taskId=${encodeURIComponent(taskId)}`);
    return Array.isArray(data?.approvals) ? data.approvals : [];
  } catch (err) {
    console.error('[BGT] loadTaskApprovals error:', err);
    return [];
  }
}

function renderBgTasks() {
  const board = document.getElementById('bgt-board');
  if (!board) return;

  // Update count badge
  const countEl = document.getElementById('bgt-count');
  if (countEl) {
    const _hidden = bgtGetHidden();
    const active = bgtTasks.filter(t => {
      if (_hidden.has(t.id)) return false;
      const status = bgtNormalizeStatus(t.status);
      return status !== 'complete' && status !== 'failed';
    }).length;
    countEl.textContent = `${active} active`;
  }

  updateBgtHeartbeatLabel();

  // Only render non-empty columns
  const hidden = bgtGetHidden();
  const visibleTasks = bgtTasks.filter(t => !hidden.has(t.id));
  const byStatus = {};
  for (const col of BGT_COLUMNS) byStatus[col.key] = [];
  for (const t of visibleTasks) {
    const normalizedStatus = bgtNormalizeStatus(t.status);
    if (byStatus[normalizedStatus]) byStatus[normalizedStatus].push(t);
    else if (byStatus['stalled']) byStatus['stalled'].push(t);
  }

  board.innerHTML = '';
  for (const col of BGT_COLUMNS) {
    const tasks = byStatus[col.key];
    if (tasks.length === 0 && (col.key === 'complete' || col.key === 'failed' || col.key === 'stalled' || col.key === 'needs_assistance')) continue;
    const colEl = document.createElement('div');
    colEl.style.cssText = 'min-width:240px;max-width:280px;flex:0 0 auto;display:flex;flex-direction:column;gap:0;';
    colEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:${col.color}">${col.label}</span>
        <span style="font-size:10px;background:${col.bg};color:${col.color};border-radius:999px;padding:1px 8px;font-weight:700">${tasks.length}</span>
      </div>
      <div class="bgt-col-cards" data-bgt-drop-status="${col.key}" ondragover="bgtHandleColumnDragOver(event,'${col.key}')" ondragenter="bgtHandleColumnDragEnter(event,'${col.key}')" ondragleave="bgtHandleColumnDragLeave(event,'${col.key}')" ondrop="bgtHandleColumnDrop(event,'${col.key}')" style="display:flex;flex-direction:column;gap:8px;min-height:60px;border-radius:12px;transition:outline 0.15s,background 0.15s">
        ${tasks.slice(0,5).map(t => bgtCardHTML(t, col)).join('')}
        ${tasks.length > 5 ? `
        <div id="bgt-more-${col.key}" style="display:none;">${tasks.slice(5).map(t => bgtCardHTML(t, col)).join('')}</div>
        <button onclick="event.stopPropagation();const m=document.getElementById('bgt-more-${col.key}');const show=m.style.display==='none';m.style.display=show?'flex':'none';m.style.flexDirection='column';m.style.gap='8px';this.textContent=show?'▲ show less':'▼ +${tasks.length - 5} more'" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:5px;font-size:11px;font-weight:600;cursor:pointer;text-align:center">▼ +${tasks.length - 5} more</button>` : ''}
      </div>
    `;
    board.appendChild(colEl);
    if (tasks.length === 0) {
      // Empty placeholder
      colEl.querySelector('.bgt-col-cards').innerHTML = `<div style="text-align:center;padding:20px 8px;color:var(--muted);font-size:11px;border:1.5px dashed var(--line);border-radius:10px">No ${col.label.split(' ').slice(1).join(' ').toLowerCase()} tasks</div>`;
    }
  }

  // If no tasks at all
  if (visibleTasks.length === 0) {
    board.innerHTML = `<div style="text-align:center;padding:60px 24px;color:var(--muted);font-size:13px;flex:1">
      <div style="font-size:36px;margin-bottom:12px">Tasks</div>
      <div style="font-weight:700;margin-bottom:4px">No background tasks yet</div>
      <div style="font-size:12px">Ask Prom to do something in the background and it'll appear here.</div>
    </div>`;
  }
}

function bgtCardHTML(t, col) {
  const displayStatus = bgtNormalizeStatus(t.status);
  const mins = Math.round((Date.now() - (t.lastProgressAt || t.startedAt)) / 60000);
  const timeAgo = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins/60)}h ago`;
  const progressItems = getTaskProgressItems(t);
  const stepsDone = progressItems.filter(s => s.status === 'done' || s.status === 'skipped').length;
  const totalSteps = progressItems.length > 0 ? progressItems.length : (t.plan || []).length;
  const pct = totalSteps > 0 ? Math.round(stepsDone / totalSteps * 100) : 0;
  let currentStepIndex = progressItems.findIndex(s => s.status === 'in_progress');
  if (currentStepIndex < 0) currentStepIndex = progressItems.findIndex(s => s.status === 'pending');
  if (currentStepIndex < 0 && totalSteps > 0) currentStepIndex = Math.max(0, Math.min(totalSteps - 1, Number(t.currentStepIndex || 0)));
  const currentStep = currentStepIndex >= 0 ? progressItems[currentStepIndex] : null;
  const channel = t.channel === 'telegram' ? 'Telegram' : 'Web UI';

  return `
  <div onclick="bgtOpenCardFromClick(event,'${escHtml(t.id)}')" draggable="true" ondragstart="bgtHandleCardDragStart(event,'${escHtml(t.id)}')" ondragend="bgtHandleCardDragEnd(event)" data-bgt-id="${escHtml(t.id)}" style="
    background:var(--panel);border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;
    cursor:pointer;transition:border-color 0.15s,box-shadow 0.15s;
    ${bgtOpenTaskId === t.id ? 'border-color:var(--brand);box-shadow:0 0 0 2px rgba(90,145,255,0.15);' : ''}
  " onmouseover="this.style.borderColor='var(--brand)'" onmouseout="this.style.borderColor='${bgtOpenTaskId===t.id?'var(--brand)':'var(--line)'}'">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
      <span style="font-size:13px;font-weight:700;line-height:1.3;flex:1;min-width:0">${escHtml(t.title || 'Untitled Task')}</span>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        ${bgtEditMode ? `<button
          onclick="event.stopPropagation(); bgtHideTask('${escHtml(t.id)}')"
          title="Hide task"
          style="border:none;background:none;color:#9c1a1a;font-size:15px;cursor:pointer;padding:0 2px;line-height:1;opacity:0.85"
        >🗑</button>` : ''}
        <span style="font-size:14px;flex-shrink:0">${STATUS_ICON[displayStatus] || '●'}</span>
      </div>
    </div>
    ${currentStep ? `<div style="font-size:11px;color:var(--muted);margin-bottom:8px;line-height:1.4">Step ${currentStepIndex + 1}/${totalSteps}: ${escHtml(String(currentStep.text || '').slice(0,60))}${String(currentStep.text || '').length>60?'…':''}</div>` : ''}
    ${totalSteps > 0 ? `
    <div style="background:var(--line);border-radius:999px;height:3px;margin-bottom:8px;overflow:hidden">
      <div style="background:${col.color};width:${pct}%;height:100%;border-radius:999px;transition:width 0.4s"></div>
    </div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:10px;color:var(--muted)">${channel} ${timeAgo}</span>
      ${displayStatus === 'needs_assistance' ? `<span style="font-size:10px;background:#f5eeff;color:#6d2d9e;border-radius:999px;padding:1px 8px;font-weight:700">Needs you</span>` : ''}
      ${displayStatus === 'paused' ? `<span style="font-size:10px;background:#f5f5f5;color:#555;border-radius:999px;padding:1px 8px;font-weight:700">${t.pauseReason || 'paused'}</span>` : ''}
    </div>
  </div>`;
}

// --- Side Panel --------------------------------------------------------------
async function openBgtPanel(taskId) {
  bgtOpenTaskId = taskId;
  window.bgtOpenTaskId = taskId;
  const panel = document.getElementById('bgt-panel');
  if (panel) panel.style.display = 'flex';
  // Clear chat input when switching tasks
  const chatInput = document.getElementById('bgt-chat-input');
  if (chatInput) { chatInput.value = ''; chatInput.disabled = false; chatInput.style.opacity = ''; }
  await bgtRefreshOpenPanel();
  // Highlight the card
  renderBgTasks();
}

function closeBgtPanel() {
  bgtOpenTaskId = null;
  window.bgtOpenTaskId = null;
  const panel = document.getElementById('bgt-panel');
  if (panel) panel.style.display = 'none';
  renderBgTasks();
}

async function bgtRefreshOpenPanel() {
  if (!bgtOpenTaskId) return;
  let task;
  try {
    const data = await api(`/api/bg-tasks/${bgtOpenTaskId}`);
    if (data.success) task = data.task;
  } catch {}
  if (!task) { task = bgtTasks.find(t => t.id === bgtOpenTaskId); }
  if (!task) return;
  const pendingApprovals = await loadTaskApprovals(task.id);
  try {
    const runs = await loadRecentProcessRuns(12);
    const linked = runs.filter((run) => String(run.taskId || '') === String(task.id));
    bgtRecentProcessRuns = linked.length > 0 ? linked : runs.slice(0, 5);
  } catch {
    bgtRecentProcessRuns = [];
  }
  try {
    bgtCodingWorkspace = await loadCodingWorkspace();
  } catch {
    bgtCodingWorkspace = null;
  }

  const titleEl = document.getElementById('bgt-panel-title');
  if (titleEl) titleEl.textContent = task.title || 'Task Details';

  const pauseBtn = document.getElementById('bgt-panel-pause');
  if (pauseBtn) {
    if (task.status === 'running') {
      pauseBtn.textContent = 'Pause';
      pauseBtn.style.display = '';
    } else if (['paused', 'queued', 'stalled', 'needs_assistance', 'awaiting_user_input'].includes(task.status)) {
      pauseBtn.textContent = 'Resume';
      pauseBtn.style.display = '';
    } else if (task.status === 'failed') {
      pauseBtn.textContent = 'Restart';
      pauseBtn.style.display = '';
    } else {
      pauseBtn.style.display = 'none';
    }
  }

  const body = document.getElementById('bgt-panel-body');
  if (!body) return;

  const plan = task.plan || [];
  const journal = task.journal || [];
  const progressItems = getTaskProgressItems(task);
  const stepsDone = progressItems.filter(s => s.status === 'done' || s.status === 'skipped').length;
  const totalSteps = progressItems.length > 0 ? progressItems.length : plan.length;
  const lastTool = task.lastToolCall || '—';
  const lastToolAt = task.lastToolCallAt ? new Date(task.lastToolCallAt).toLocaleTimeString() : '—';
  const channel = task.channel === 'telegram' ? 'Telegram' : 'Web UI';
  const startedAt = task.startedAt ? new Date(task.startedAt).toLocaleString() : '—';
  const displayStatus = bgtNormalizeStatus(task.status);
  const statusColor = { running:'#0d4faf', queued:'#7c4d00', paused:'#555', stalled:'#9c1a1a', needs_assistance:'#6d2d9e', complete:'#1a6e35', failed:'#9c1a1a' };
  const sc = statusColor[displayStatus] || '#555';

  const stepsHTML = renderChecklistItemsHTML(progressItems, { maxText: 200 });

  // Build journal HTML (last 30 entries)
  const recentJournal = journal.slice(-30).reverse();
  const journalHTML = recentJournal.map(entry => {
    const time = new Date(entry.t).toLocaleTimeString();
    const typeColor = { tool_call:'#0d4faf', tool_result:'#1a6e35', error:'#9c1a1a', plan_mutation:'#6d2d9e', status_push:'#555', pause:'#7c4d00', resume:'#7c4d00', advisor_decision:'#555', heartbeat:'var(--brand)' };
    const tc = typeColor[entry.type] || '#888';
    return `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:11px">
      <span style="color:var(--muted);flex-shrink:0;min-width:52px">${time}</span>
      <span style="color:${tc};flex-shrink:0;font-weight:700;min-width:60px">${entry.type}</span>
      <span style="color:var(--text);flex:1;min-width:0;word-break:break-word">${escHtml(entry.content)}</span>
    </div>`;
  }).join('');

  // Build assistance block outside template literal to avoid backtick nesting issues
  let assistanceHTML = '';
  const taskStatusNorm = String(task.status || '').trim().toLowerCase();
  const isCommandApprovalPause = task.pauseReason === 'awaiting_command_approval' || pendingApprovals.length > 0;
  const pauseAnalysisHtml = task.pauseAnalysis?.message
    ? `<div style="margin-top:10px;background:#fff;border:1px solid #e9d8ff;border-radius:10px;padding:10px 12px;color:#3d1a6e">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;color:#6d2d9e;margin-bottom:6px">AI Recovery Plan</div>
        <div style="font-size:12px;line-height:1.6">${renderMd(task.pauseAnalysis.message)}</div>
      </div>`
    : '';
  const recoveryTurns = Array.isArray(task.recoveryConversation)
    ? task.recoveryConversation.filter(turn => turn).slice(-16)
    : [];
  const canChatWithTask = ['needs_assistance', 'paused', 'stalled', 'awaiting_user_input', 'failed'].includes(taskStatusNorm);
  const recoveryConversationHtml = (recoveryTurns.length > 0 || canChatWithTask)
    ? `<div style="border:1px solid #e9d8ff;border-radius:10px;background:#fff;overflow:hidden">
        <div style="padding:8px 12px;font-size:11px;font-weight:800;color:#6d2d9e;border-bottom:1px solid #f0e7ff">Task Chat & Recovery Trail</div>
        <div style="display:flex;flex-direction:column;gap:8px;padding:10px 12px">
          ${recoveryTurns.length > 0 ? recoveryTurns.map((turn) => {
            const isUser = turn.role === 'user';
            const bg = isUser ? '#efe5ff' : '#f8f5ff';
            const color = isUser ? '#4c1d95' : '#3d1a6e';
            const source = String(turn.source || '');
            const label = source === 'team_manager'
              ? 'Manager Response to Proposal Executor'
              : source === 'pause_analysis'
                ? 'Pause Analysis'
                : isUser ? 'You' : 'Prometheus';
            const body = isUser ? escHtml(turn.content || '') : renderMd(turn.content || '');
            return `<div style="align-self:${isUser ? 'flex-end' : 'flex-start'};max-width:92%;background:${bg};border:1px solid #e9d8ff;border-radius:10px;padding:8px 10px;color:${color};font-size:12px;line-height:1.55">
              <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;opacity:0.7;margin-bottom:4px">${label}</div>
              <div>${body}</div>
            </div>`;
          }).join('') : '<div style="color:var(--muted);font-size:12px">No recovery messages yet.</div>'}
	          ${canChatWithTask ? `<div style="display:flex;gap:8px;border-top:1px solid #f0e7ff;padding-top:10px">
            <textarea id="task-reply-input" rows="2" placeholder="Type your reply - the agent will see this and continue..." style="flex:1;resize:none;border:1px solid #cba8f5;border-radius:8px;padding:8px;font-size:12px;font-family:inherit;background:#fff;color:var(--text)"></textarea>
            <button id="task-reply-send" data-taskid="${escHtml(task.id)}" style="background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;align-self:flex-end">Send</button>
	          </div>` : ''}
        </div>
      </div>`
    : '';
  console.log('[BGT panel] task.status =', JSON.stringify(task.status), 'norm =', taskStatusNorm);
  if (taskStatusNorm === 'needs_assistance' || taskStatusNorm === 'paused' || taskStatusNorm === 'stalled' || taskStatusNorm === 'failed' || taskStatusNorm === 'awaiting_user_input') {
    const lastPause = [...journal].reverse().find(e => e.type === 'pause' || e.type === 'error');
    const lastStatusPush = [...journal].reverse().find(e => e.type === 'status_push' && e.content);
    const pauseMsg = escHtml((lastPause?.content || lastStatusPush?.content || 'Task paused and waiting for input.').replace(/^Task paused for assistance:\s*/i, ''));
    const pauseDetail = lastPause?.detail ? escHtml(lastPause.detail.slice(0, 300)) : '';
    const clarificationMsg = task.pendingClarificationQuestion
      ? '<div style="font-size:11px;color:#6d2d9e;margin-top:6px"><strong>Pending question:</strong> ' + escHtml(task.pendingClarificationQuestion) + '</div>'
      : '';
    assistanceHTML = '<div style="background:#f5eeff;border:1px solid #cba8f5;border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.6;color:#6d2d9e">'
      + '<div style="font-weight:800;margin-bottom:6px">⚠️ Task needs your input</div>'
      + '<div style="color:#3d1a6e;margin-bottom:' + (pauseDetail ? '6px' : '0') + '">' + pauseMsg + '</div>'
      + (pauseDetail ? '<div style="font-size:11px;color:#6d2d9e;opacity:0.8;margin-bottom:4px">' + pauseDetail + '</div>' : '')
      + clarificationMsg
      + pauseAnalysisHtml
      + '</div>';
  }

  const approvalHTML = pendingApprovals.length > 0
    ? `<div style="display:flex;flex-direction:column;gap:10px">${pendingApprovals.map((approval) => `
      <div style="background:#fff8e8;border:1px solid #f3c677;border-radius:12px;padding:12px 14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">
          <div style="font-size:12px;font-weight:800;color:#7c4d00">Command approval required</div>
          <div style="font-size:10px;background:#fff1cc;color:#7c4d00;border-radius:999px;padding:2px 8px;font-weight:700">risk ${Math.round(Number(approval.riskScore || 0))}</div>
        </div>
        <div style="font-size:11px;color:#7c4d00;line-height:1.5;margin-bottom:8px">${escHtml(approval.action || 'Run command')}</div>
        ${approval.reason ? `<div style="font-size:11px;color:#8a5a00;line-height:1.5;margin-bottom:8px">${escHtml(approval.reason)}</div>` : ''}
        <pre style="margin:0 0 10px 0;padding:10px 12px;background:#1c1f26;color:#f8fafc;border-radius:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word">${escHtml(approval.command || '')}</pre>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button onclick="bgtResolveApproval('${escHtml(approval.id)}','deny')" style="border:1px solid #fca5a5;background:#fff0f0;color:#9c1a1a;border-radius:8px;padding:7px 12px;font-size:11px;font-weight:700;cursor:pointer">Reject</button>
          <button onclick="bgtResolveApproval('${escHtml(approval.id)}','approve')" style="border:none;background:#7c4d00;color:#fff;border-radius:8px;padding:7px 12px;font-size:11px;font-weight:700;cursor:pointer">Approve</button>
        </div>
      </div>`).join('')}</div>`
    : '';

  body.innerHTML = `
    <!-- Status row -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <span style="font-size:11px;background:var(--line);border-radius:999px;padding:2px 10px;font-weight:700;color:${sc}">${STATUS_ICON[displayStatus] || '●'} ${displayStatus.replace(/_/g,' ')}</span>
      <span style="font-size:11px;color:var(--muted)">${channel}</span>
      <span style="font-size:11px;color:var(--muted)">Started ${startedAt}</span>
    </div>

    <!-- Summary if complete -->
    ${task.finalSummary ? `<div style="background:#efffea;border:1px solid #b2dfb2;border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.6;color:#1a6e35">
      <div style="font-weight:800;margin-bottom:4px">📝 Summary</div>
      ${renderMd(task.finalSummary)}
    </div>` : ''}

	    <!-- Needs assistance -->
	    ${assistanceHTML}

		    <!-- Approval cards -->
		    ${approvalHTML}

        <!-- Completed/read-only recovery trail -->
        ${!assistanceHTML ? recoveryConversationHtml : ''}

		    <!-- Stats row -->
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:100px;background:var(--panel-2);border-radius:10px;padding:10px 12px">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;margin-bottom:2px">Progress</div>
        <div style="font-size:18px;font-weight:800">${stepsDone}<span style="font-size:12px;color:var(--muted)">/${totalSteps}</span></div>
        <div style="font-size:10px;color:var(--muted)">steps done</div>
      </div>
      <div style="flex:1;min-width:100px;background:var(--panel-2);border-radius:10px;padding:10px 12px">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;margin-bottom:2px">Last Tool</div>
        <div style="font-size:12px;font-weight:700;word-break:break-all">${escHtml(lastTool.slice(0,30))}</div>
        <div style="font-size:10px;color:var(--muted)">${lastToolAt}</div>
      </div>
    </div>

    <!-- Progress checklist -->
    <div>
      <div class="progress-card">
        <div class="progress-card-header" style="cursor:default;padding-bottom:6px">
          <span>Progress</span>
        </div>
        <div class="progress-list-wrap">
          ${progressItems.length > 0
            ? `<div class="progress-list">${stepsHTML}</div>`
            : `<div class="progress-empty">Progress - This panel will be used to make a short to-do list</div>`}
        </div>
      </div>
    </div>

    <!-- Coding workspace -->
    <div id="coding-workspace-section">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Coding Workspace</div>
      ${renderCodingWorkspacePanel(bgtCodingWorkspace)}
    </div>

    <!-- Manager/Worker status indicator (only shown when manager is active) -->
    ${task.managerEnabled ? `<div id="manager-status-bar" style="background:#f0f5ff;border:1px solid #c7d8f5;border-radius:10px;padding:8px 12px;font-size:11px;font-weight:700;color:#0d4faf;display:flex;align-items:center;gap:8px">
      <span id="manager-status-icon">⚙️</span>
      <span id="manager-status-text">Manager/Worker mode active</span>
      ${task.executorProvider ? `<span style="font-weight:400;color:#555;margin-left:auto">Worker: ${escHtml(task.executorProvider)}</span>` : ''}
    </div>` : ''}

    <!-- Supervised command runs -->
    <div id="process-runs-section">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px;display:flex;align-items:center;gap:8px">
        <span>Command Runs</span>
        <span style="font-weight:400;opacity:0.6">${bgtRecentProcessRuns.length ? `${bgtRecentProcessRuns.length} recent` : ''}</span>
      </div>
      <div id="process-runs-body" class="process-runs-list">${renderProcessRunsHTML(bgtRecentProcessRuns)}</div>
    </div>

    <!-- Evidence Bus panel (collapsible) -->
    <div id="evidence-bus-section">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px;display:flex;align-items:center;gap:8px;cursor:pointer" onclick="toggleEvidenceBus()">
        <span>Evidence Bus</span>
        <span id="evidence-bus-count" style="font-weight:400;opacity:0.6"></span>
        <span id="evidence-bus-toggle" style="margin-left:auto;font-size:10px">▼ show</span>
      </div>
      <div id="evidence-bus-body" style="display:none"></div>
    </div>

    <!-- Process journal -->
    <div>
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Process Log <span style="font-weight:400;opacity:0.6">(latest first)</span></div>
      <div style="font-family:monospace;font-size:11px;border:1px solid var(--line);border-radius:10px;padding:6px 8px;max-height:300px;overflow-y:auto">
        ${journalHTML || '<div style="color:var(--muted);padding:8px">No entries yet.</div>'}
      </div>
    </div>

    <!-- Finished-task actions -->
    ${(displayStatus === 'complete' || displayStatus === 'failed') ? `
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="bgtCreateSkillProposal('${escHtml(task.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer">Draft Skill</button>
      <button onclick="bgtDeleteTask('${escHtml(task.id)}')" style="border:1px solid #fca5a5;background:#fff0f0;color:#9c1a1a;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer">Remove</button>
    </div>` : ''}
  `;

  // Auto-expand evidence bus for cron tasks (they always write notes) or if entries already exist
  if (task.scheduleId) {
    const busBody = document.getElementById('evidence-bus-body');
    const busToggle = document.getElementById('evidence-bus-toggle');
    if (busBody && busBody.style.display === 'none') {
      busBody.style.display = 'block';
      if (busToggle) busToggle.textContent = '▲ hide';
      loadEvidenceBusEntries(task.id);
    }
  }

  // Wire up the reply send button via JS (avoids inline onclick escaping issues)
  const sendBtn = document.getElementById('task-reply-send');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => bgtSendReply(sendBtn.dataset.taskid));
  }
  // Also allow Enter (without Shift) in the textarea to send
  const replyInput = document.getElementById('task-reply-input');
  if (replyInput) {
    replyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        bgtSendReply(sendBtn ? sendBtn.dataset.taskid : bgtOpenTaskId);
      }
    });
  }
}

// --- Actions -----------------------------------------------------------------
async function bgtPauseResume() {
  if (!bgtOpenTaskId) return;
  const task = bgtTasks.find(t => t.id === bgtOpenTaskId);
  if (!task) return;
  if (task.status === 'running') {
    // Pause
    try { await api(`/api/bg-tasks/${bgtOpenTaskId}/pause`, { method: 'POST' }); } catch {}
  } else if (['paused', 'queued', 'stalled', 'needs_assistance', 'awaiting_user_input'].includes(task.status)) {
    // Resume
    try { await api(`/api/bg-tasks/${bgtOpenTaskId}/resume`, { method: 'POST' }); } catch {}
  } else if (task.status === 'failed') {
    // Restart failed task with previous-run context
    try { await api(`/api/bg-tasks/${bgtOpenTaskId}/restart`, { method: 'POST' }); } catch {}
  }
  await refreshBgTasks();
  await bgtRefreshOpenPanel();
}

async function bgtCreateSkillProposal(taskId) {
  if (!taskId) return;
  try {
    const result = await api(ENDPOINTS.bgTaskSkillProposal(taskId), { method: 'POST' });
    if (!result?.success) {
      bgtToast('Skill draft failed', result?.error || 'Could not create draft skill');
      return;
    }
    bgtToast('Skill draft created', result.path || 'Draft saved');
    await bgtRefreshOpenPanel();
  } catch (err) {
    bgtToast('Skill draft failed', err?.message || 'Could not create draft skill');
  }
}

async function bgtResolveApproval(approvalId, action) {
  if (!approvalId || !action) return;
  const endpoint = action === 'approve'
    ? `/api/approvals/${approvalId}/approve`
    : `/api/approvals/${approvalId}/deny`;
  try {
    const result = await api(endpoint, { method: 'POST' });
    if (!result?.success) {
      showToast(result?.error || 'Could not resolve approval');
      return;
    }
    bgtToast(action === 'approve' ? 'Command approved' : 'Command rejected', 'Task updated');
    await refreshBgTasks();
    await bgtRefreshOpenPanel();
  } catch (err) {
    console.error('[BGT] resolve approval error:', err);
    showToast(err?.message || 'Could not resolve approval');
  }
}

async function bgtSendReply(taskId) {
  const input = document.getElementById('task-reply-input');
  if (!input) return;
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  input.disabled = true;
  try {
    const result = await api(`/api/bg-tasks/${taskId}/message`, { method: 'POST', body: JSON.stringify({ message }) });
    if (result.success) {
      // Refresh the panel after a short delay to show the journal update
      setTimeout(() => bgtRefreshOpenPanel(), 800);
    } else {
      alert('Failed to send: ' + (result.error || 'unknown error'));
    }
  } catch (e) {
    alert('Error sending message: ' + e.message);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function bgtChatSend() {
  const input = document.getElementById('bgt-chat-input');
  if (!input || !bgtOpenTaskId) return;
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  input.disabled = true;
  input.style.opacity = '0.5';
  try {
    const result = await api(`/api/bg-tasks/${bgtOpenTaskId}/message`, { method: 'POST', body: JSON.stringify({ message }) });
    if (result.success) {
      // Show optimistic sent indicator in journal area
      const body = document.getElementById('bgt-panel-body');
      if (body) {
        const sentDiv = document.createElement('div');
        sentDiv.style.cssText = 'background:var(--brand);color:#fff;border-radius:8px;padding:6px 10px;font-size:12px;align-self:flex-end;max-width:80%;word-break:break-word;opacity:0.85';
        sentDiv.textContent = '\u2192 ' + message;
        body.appendChild(sentDiv);
        body.scrollTop = body.scrollHeight;
      }
      // Refresh panel after short delay to show journal update
      setTimeout(() => bgtRefreshOpenPanel(), 1000);
    } else {
      alert('Failed to send: ' + (result.error || 'unknown error'));
    }
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    input.disabled = false;
    input.style.opacity = '';
    input.focus();
  }
}

async function bgtDeleteTask(taskId, status) {
  const isActive = status && status !== 'complete' && status !== 'failed';
  const msg = isActive
    ? 'This task is still active. Remove it from the board anyway?'
    : 'Remove this task from the board?';
  const confirmed = await new Promise(r => showConfirm(msg, () => r(true), () => r(false), {
    title: 'Remove Task',
    confirmText: 'Remove',
    danger: isActive,
  }));
  if (!confirmed) return;
  try { await api(`/api/bg-tasks/${taskId}`, { method: 'DELETE' }); } catch {}
  if (bgtOpenTaskId === taskId) closeBgtPanel();
  await refreshBgTasks();
}

// --- Toast notification -------------------------------------------------------
// -- Evidence Bus UI helpers ------------------------------------------------------------------

function toggleEvidenceBus() {
  const body = document.getElementById('evidence-bus-body');
  const toggle = document.getElementById('evidence-bus-toggle');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  if (toggle) toggle.textContent = isHidden ? '\u25b2 hide' : '\u25bc show';
  // Load entries when first opened
  if (isHidden && bgtOpenTaskId) loadEvidenceBusEntries(bgtOpenTaskId);
}

async function loadEvidenceBusEntries(taskId) {
  try {
    const data = await fetch(`/api/bg-tasks/${taskId}/evidence`).then(r => r.json());
    const entries = data.entries || [];
    const count = document.getElementById('evidence-bus-count');
    if (count) count.textContent = `(${entries.length} entries)`;
    const body = document.getElementById('evidence-bus-body');
    if (!body) return;
    if (entries.length === 0) {
      body.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:6px">No evidence yet.</div>';
      return;
    }
    const catColors = { finding:'#0d4faf', decision:'#7c4d00', artifact:'#1a6e35', error:'#9c1a1a', dedup_key:'#6d2d9e' };
    // Group by category
    const grouped = {};
    for (const e of entries) {
      if (!grouped[e.category]) grouped[e.category] = [];
      grouped[e.category].push(e);
    }
    let html = '<div style="font-family:monospace;font-size:11px;border:1px solid var(--line);border-radius:10px;padding:6px 8px;max-height:250px;overflow-y:auto">';
    for (const [cat, catEntries] of Object.entries(grouped)) {
      const col = catColors[cat] || '#555';
      html += `<div style="font-size:10px;font-weight:800;color:${col};text-transform:uppercase;padding:4px 0 2px">${escHtml(cat)} (${catEntries.length})</div>`;
      for (const e of catEntries.slice(-10)) {
        const keyPart = e.key ? ` <span style="color:#888;font-weight:700">[${escHtml(e.key)}]</span>` : '';
        const stepPart = `<span style="color:var(--muted)">step ${e.stepIndex}</span>`;
        const agentPart = e.agentId ? ` <span style="color:var(--muted)">by ${escHtml(e.agentId.slice(0,16))}</span>` : '';
        const valueText = escHtml(e.value); // No truncation — full text
        html += `<div style="padding:5px 0;border-bottom:1px solid var(--line)">`
          + `<div style="display:flex;gap:6px;align-items:center;margin-bottom:2px">${stepPart}${agentPart}${keyPart}</div>`
          + `<div style="color:var(--text);line-height:1.5;word-break:break-word;white-space:pre-wrap">${valueText}</div>`
          + `</div>`;
      }
    }
    html += '</div>';
    body.innerHTML = html;
    // Update entry count
    if (count) count.textContent = `(${entries.length} entries)`;
  } catch (err) {
    console.error('loadEvidenceBusEntries error:', err);
  }
}

function appendEvidenceBusEntry(entry) {
  // Update count
  const count = document.getElementById('evidence-bus-count');
  if (count) {
    const cur = parseInt(count.textContent.replace(/\D/g,'')) || 0;
    count.textContent = `(${cur + 1} entries)`;
  }
  // If bus body is visible, reload
  const body = document.getElementById('evidence-bus-body');
  if (body && body.style.display !== 'none' && bgtOpenTaskId) {
    loadEvidenceBusEntries(bgtOpenTaskId);
  }
}

function updateManagerStatusBar(text, color) {
  const bar = document.getElementById('manager-status-bar');
  const icon = document.getElementById('manager-status-icon');
  const textEl = document.getElementById('manager-status-text');
  if (!bar) return;
  if (color) bar.style.color = color;
  if (icon) {
    // Pick icon based on content
    if (text.startsWith('🧭')) icon.textContent = '🧭';
    else if (text.startsWith('⚙')) icon.textContent = '⚙️';
    else if (text.startsWith('✅') || text.startsWith('\u2713')) icon.textContent = '✅';
    else if (text.startsWith('🔁') || text.startsWith('\u21ba')) icon.textContent = '🔁';
    else icon.textContent = '⚙️';
  }
  if (textEl) textEl.textContent = text;
}

// bgtToast — imported from utils.js


// ─── Error Response Panel ──────────────────────────────────────

function _getOrCreateErrorBackdrop() {
  if (_errBackdrop) return _errBackdrop;
  _errBackdrop = document.createElement('div');
  _errBackdrop.id = 'error-response-backdrop';
  _errBackdrop.style.cssText = 'position:fixed;inset:0;background:rgba(10,20,40,0.45);z-index:9997;display:none';
  _errBackdrop.addEventListener('click', closeErrorResponse);
  document.body.appendChild(_errBackdrop);
  return _errBackdrop;
}

function showErrorResponsePanel(taskId, category, errorMessage, errorDetail, template) {
  _errTaskId = taskId;
  _errTemplate = template;
  _errSelectedAction = null;
  _errCategory = category;

  // Title & description
  const titleEl = document.getElementById('error-response-title');
  const descEl = document.getElementById('error-response-desc');
  if (titleEl) titleEl.textContent = template?.title || ('\u26a0\ufe0f ' + (category || 'Error').toUpperCase());
  if (descEl) descEl.textContent = template?.description || errorMessage || 'The task needs your help to continue.';

  // Render options
  const optionsEl = document.getElementById('error-response-options');
  if (optionsEl) {
    optionsEl.innerHTML = '';
    const options = template?.options || [
      { id: 'retry_now', label: '\u27f3 Retry Now', icon: '\u27f3' },
      { id: 'skip', label: '\u229a Skip Step', icon: '\u229a' },
      { id: 'cancel', label: '\u2715 Cancel Task', icon: '\u2715', danger: true },
    ];
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'error-option-btn' + (opt.danger ? ' danger' : '');
      btn.dataset.actionId = opt.id;
      btn.innerHTML = `<strong>${escHtml(opt.icon || '')} ${escHtml(opt.label)}</strong>${opt.description ? `<br><span style="font-weight:400;opacity:0.75">${escHtml(opt.description)}</span>` : ''}`;
      btn.addEventListener('click', () => selectErrorOption(opt));
      optionsEl.appendChild(btn);
    });
  }

  // Clear inputs
  const inputsEl = document.getElementById('error-response-inputs');
  if (inputsEl) {
    inputsEl.innerHTML = '';
    inputsEl.classList.remove('visible');
  }

  // Reset submit button
  const submitBtn = document.getElementById('error-response-submit-btn');
  if (submitBtn) submitBtn.disabled = true;

  // Show backdrop + panel
  const backdrop = _getOrCreateErrorBackdrop();
  backdrop.style.display = 'block';
  const panel = document.getElementById('error-response-panel');
  if (panel) panel.classList.add('visible');

  // Notification toast
  bgtToast('\u26a0\ufe0f Task needs help', (template?.title || category || 'Error') + ' — see panel');
}

function selectErrorOption(opt) {
  _errSelectedAction = opt.id;

  // Highlight selected
  document.querySelectorAll('.error-option-btn').forEach(b => b.classList.remove('selected'));
  const btn = document.querySelector(`.error-option-btn[data-action-id="${opt.id}"]`);
  if (btn) btn.classList.add('selected');

  // Show input fields if this option requires them
  const inputsEl = document.getElementById('error-response-inputs');
  if (inputsEl) {
    inputsEl.innerHTML = '';
    inputsEl.classList.remove('visible');

    const triggerInputs = opt.triggerInputs || [];
    const allFields = _errTemplate?.requiredInputs || [];
    const fieldsToShow = triggerInputs.length > 0
      ? allFields.filter(f => triggerInputs.includes(f.id))
      : [];

    if (fieldsToShow.length > 0) {
      fieldsToShow.forEach(field => {
        const wrap = document.createElement('div');
        wrap.className = 'input-field';
        const label = document.createElement('label');
        label.textContent = field.label;
        label.setAttribute('for', 'err-input-' + field.id);
        const input = document.createElement('input');
        input.id = 'err-input-' + field.id;
        input.type = field.type || 'text';
        input.placeholder = field.placeholder || '';
        input.dataset.fieldId = field.id;
        if (field.validation === 'digits_only') {
          input.inputMode = 'numeric';
          input.pattern = '[0-9]*';
          input.maxLength = 8;
        }
        wrap.appendChild(label);
        wrap.appendChild(input);
        inputsEl.appendChild(wrap);
      });
      inputsEl.classList.add('visible');
      // Focus first input
      const firstInput = inputsEl.querySelector('input');
      if (firstInput) setTimeout(() => firstInput.focus(), 80);
    }
  }

  // Enable submit unless it's cancel (which submits immediately)
  const submitBtn = document.getElementById('error-response-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = opt.danger ? 'Cancel Task' : 'Continue';
  }
}

function closeErrorResponse() {
  _errTaskId = null;
  _errTemplate = null;
  _errSelectedAction = null;
  _errCategory = null;

  const backdrop = document.getElementById('error-response-backdrop');
  if (backdrop) backdrop.style.display = 'none';
  const panel = document.getElementById('error-response-panel');
  if (panel) panel.classList.remove('visible');
}

async function submitErrorResponse() {
  if (!_errTaskId || !_errSelectedAction) return;

  const action = _errSelectedAction;
  const category = _errCategory;

  // Collect input values
  const inputs = {};
  document.querySelectorAll('#error-response-inputs input[data-field-id]').forEach(el => {
    if (el.value.trim()) inputs[el.dataset.fieldId] = el.value.trim();
  });

  // Validate required fields for credential action
  if (action === 'credentials') {
    if (!inputs.email) {
      const emailEl = document.getElementById('err-input-email');
      if (emailEl) { emailEl.style.borderColor = 'var(--err)'; emailEl.focus(); }
      return;
    }
    if (!inputs.password) {
      const pwEl = document.getElementById('err-input-password');
      if (pwEl) { pwEl.style.borderColor = 'var(--err)'; pwEl.focus(); }
      return;
    }
  }

  if (action === 'verification_code') {
    if (!inputs.code) {
      const codeEl = document.getElementById('err-input-code');
      if (codeEl) { codeEl.style.borderColor = 'var(--err)'; codeEl.focus(); }
      return;
    }
  }

  // Disable submit to prevent double-send
  const submitBtn = document.getElementById('error-response-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

  try {
    const resp = await fetch(`/api/bg-tasks/${_errTaskId}/error-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, category, inputs }),
    });
    const data = await resp.json();
    if (data.success) {
      closeErrorResponse();
      if (data.resumed) {
        bgtToast('\u2705 Task resuming', 'Agent is continuing with your response');
        // Refresh the kanban board to show updated status
        if (typeof refreshBgTasks === 'function') setTimeout(refreshBgTasks, 800);
      } else {
        bgtToast('Task cancelled', 'Task has been stopped');
        if (typeof refreshBgTasks === 'function') setTimeout(refreshBgTasks, 400);
      }
    } else {
      bgtToast('\u274c Error', data.error || 'Failed to submit response');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Continue'; }
    }
  } catch (err) {
    console.error('[ErrorResponse] Submit failed:', err);
    bgtToast('\u274c Network error', 'Could not submit response');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Continue'; }
  }
}

// Hook into the existing WebSocket message handler
// We extend the onmessage handler after the page loads
(function patchWebSocketForErrorResponse() {
  function applyPatch() {
    // Find the ws variable — it’s declared in a closure, so we intercept via MutationObserver
    // Alternative: override addEventListener on WebSocket prototype to intercept messages
    const _origOnMessage = WebSocket.prototype.__defineGetter__
      ? null
      : null; // not needed — use event listener approach below

    // We hook into the document-level custom event that server-v2’s WS handler
    // already dispatches. If that’s not available, we’ll patch the WS directly.
    document.addEventListener('ws:message', handleErrorResponseWsEvent);

    // Also directly patch any open WebSocket connections by overriding WebSocket prototype
    const _OrigWS = window.WebSocket;
    window.WebSocket = function(...args) {
      const ws = new _OrigWS(...args);
      const _origAddEventListener = ws.addEventListener.bind(ws);
      ws.addEventListener = function(type, listener, ...rest) {
        if (type === 'message') {
          const wrappedListener = function(e) {
            try {
              const msg = JSON.parse(e.data);
              if (msg.type === 'task_error_requires_response') {
                handleErrorResponseWsEvent({ detail: msg });
              }
            } catch {}
            return listener.call(this, e);
          };
          return _origAddEventListener('message', wrappedListener, ...rest);
        }
        return _origAddEventListener(type, listener, ...rest);
      };
      // Also patch onmessage setter
      let _onmsgHandler = null;
      Object.defineProperty(ws, 'onmessage', {
        get: () => _onmsgHandler,
        set: (fn) => {
          _onmsgHandler = fn;
          _origAddEventListener('message', (e) => {
            try {
              const msg = JSON.parse(e.data);
              if (msg.type === 'task_error_requires_response') {
                handleErrorResponseWsEvent({ detail: msg });
              }
            } catch {}
            if (_onmsgHandler) _onmsgHandler.call(ws, e);
          });
        },
        configurable: true,
      });
      return ws;
    };
    // Copy static properties
    Object.assign(window.WebSocket, _OrigWS);
    window.WebSocket.prototype = _OrigWS.prototype;
    window.WebSocket.CONNECTING = _OrigWS.CONNECTING;
    window.WebSocket.OPEN = _OrigWS.OPEN;
    window.WebSocket.CLOSING = _OrigWS.CLOSING;
    window.WebSocket.CLOSED = _OrigWS.CLOSED;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyPatch);
  } else {
    applyPatch();
  }
})();

function handleErrorResponseWsEvent(e) {
  const msg = e.detail || e;
  if (!msg || msg.type !== 'task_error_requires_response') return;
  showErrorResponsePanel(
    msg.taskId,
    msg.errorCategory,
    msg.errorMessage,
    msg.errorDetail,
    msg.template,
  );
}



// ─── Expose on window for HTML onclick handlers ────────────────
window.refreshBgTasks = refreshBgTasks;
window.toggleBgtEditMode = toggleBgtEditMode;
window.bgtHideTask = bgtHideTask;
window.bgtOpenCardFromClick = bgtOpenCardFromClick;
window.bgtHandleCardDragStart = bgtHandleCardDragStart;
window.bgtHandleCardDragEnd = bgtHandleCardDragEnd;
window.bgtHandleColumnDragOver = bgtHandleColumnDragOver;
window.bgtHandleColumnDragEnter = bgtHandleColumnDragEnter;
window.bgtHandleColumnDragLeave = bgtHandleColumnDragLeave;
window.bgtHandleColumnDrop = bgtHandleColumnDrop;
window.openBgtPanel = openBgtPanel;
window.closeBgtPanel = closeBgtPanel;
window.bgtRefreshOpenPanel = bgtRefreshOpenPanel;
window.bgtPauseResume = bgtPauseResume;
window.bgtCreateSkillProposal = bgtCreateSkillProposal;
window.bgtResolveApproval = bgtResolveApproval;
window.bgtSendReply = bgtSendReply;
window.bgtChatSend = bgtChatSend;
window.bgtDeleteTask = bgtDeleteTask;
window.toggleEvidenceBus = toggleEvidenceBus;
window.loadEvidenceBusEntries = loadEvidenceBusEntries;
window.appendEvidenceBusEntry = appendEvidenceBusEntry;
window.updateManagerStatusBar = updateManagerStatusBar;
window.bgtNormalizeStatus = bgtNormalizeStatus;
window.showErrorResponsePanel = showErrorResponsePanel;
window.selectErrorOption = selectErrorOption;
window.closeErrorResponse = closeErrorResponse;
window.submitErrorResponse = submitErrorResponse;
window.handleErrorResponseWsEvent = handleErrorResponseWsEvent;
// bgtToast already on window via utils.js import

// ─── WS Event Handlers (F5) ────────────────────────────────────
const _taskEvents = ['task_running','task_complete','task_paused','task_failed',
  'task_needs_assistance','task_step_done','task_tool_call','task_heartbeat_resumed'];

_taskEvents.forEach(evt => {
  wsEventBus.on(evt, (msg) => {
    if (window.currentMode === 'bgtasks') refreshBgTasks();
    if (window.bgtOpenTaskId && msg.taskId === window.bgtOpenTaskId) bgtRefreshOpenPanel();
    if (evt === 'task_complete') {
      bgtToast('\u2713 Task complete', msg.summary ? msg.summary.slice(0,120) : '');
      // Backend task_done.automatedSession is the single source of truth for cron/scheduled auto sessions.
    } else if (evt === 'task_failed') {
    } else if (evt === 'task_failed') {
      bgtToast('\u2715 Task failed', msg.error ? msg.error.slice(0,120) : '');
    } else if (evt === 'task_needs_assistance') {
      bgtToast('Task paused', msg.reason ? String(msg.reason).slice(0, 120) : 'Needs assistance');
    }
  });
});

wsEventBus.on('task_panel_update', (msg) => {
  if (window.bgtOpenTaskId && msg.taskId === window.bgtOpenTaskId) bgtRefreshOpenPanel();
});
['approval_created', 'approval_approved', 'approval_denied'].forEach((eventName) => {
  wsEventBus.on(eventName, (msg) => {
    if (window.currentMode === 'bgtasks') refreshBgTasks();
    if (window.bgtOpenTaskId && (!msg.taskId || msg.taskId === window.bgtOpenTaskId)) bgtRefreshOpenPanel();
  });
});
wsEventBus.on('task_manager_briefing', (msg) => {
  if (window.bgtOpenTaskId === msg.taskId) updateManagerStatusBar(`\uD83E\uDDED Manager briefing step ${(msg.stepIndex||0)+1}...`, '#7c4d00');
});
wsEventBus.on('task_worker_start', (msg) => {
  if (window.bgtOpenTaskId === msg.taskId) {
    const prov = msg.provider && msg.provider !== 'primary' ? ` (${escHtml(String(msg.provider))})` : '';
    updateManagerStatusBar(`\u2699\uFE0F Worker executing step ${(msg.stepIndex||0)+1}${prov}...`, '#0d4faf');
  }
});
wsEventBus.on('task_manager_verifying', (msg) => {
  if (window.bgtOpenTaskId === msg.taskId) updateManagerStatusBar(`\u2705 Manager verifying step ${(msg.stepIndex||0)+1}...`, '#1a6e35');
});
wsEventBus.on('task_brief_retry', (msg) => {
  if (window.bgtOpenTaskId === msg.taskId) updateManagerStatusBar(`\uD83D\uDD01 Manager retrying (attempt ${msg.attempt||1})...`, '#9c1a1a');
});
wsEventBus.on('task_evidence_update', (msg) => {
  if (window.bgtOpenTaskId === msg.taskId && msg.entry) appendEvidenceBusEntry(msg.entry);
});
wsEventBus.on('cron_task_spawned', (msg) => {
  bgtToast('\uD83D\uDD50 Scheduled job running', `"${msg.jobName}" started as background task`);
  if (window.currentMode === 'bgtasks') refreshBgTasks();
});

window.refreshProcessRunsPanel = async function refreshProcessRunsPanel() {
  if (window.bgtOpenTaskId) {
    await bgtRefreshOpenPanel();
    return;
  }
  const body = document.getElementById('process-runs-body');
  if (!body) return;
  try {
    const runs = await loadRecentProcessRuns(8);
    body.innerHTML = renderProcessRunsHTML(runs);
  } catch {}
};

installProcessRunCardHandlers(document);
installCodingWorkspaceHandlers(document);
wsEventBus.on('process_run_started', () => window.refreshProcessRunsPanel?.());
wsEventBus.on('process_run_output', () => window.refreshProcessRunsPanel?.());
wsEventBus.on('process_run_exited', () => window.refreshProcessRunsPanel?.());
wsEventBus.on('skill_proposal_created', (msg) => {
  bgtToast('Skill draft created', msg?.title || 'Draft saved');
  if (window.bgtOpenTaskId === msg?.taskId) bgtRefreshOpenPanel();
});
