/**
 * SchedulePage.js — F3c Extract
 *
 * Schedule management page: CRUD for cron jobs, pattern parsing, run history.
 * Brain Thought + Brain Dream cards are rendered as built-in system jobs.
 *
 * Functions extracted verbatim from index.html:
 *   refreshSchedules, renderScheduleList, _resolveSchedulePattern,
 *   onScheduleOccurrenceChange, addScheduleSkill, removeScheduleSkill,
 *   _loadScheduleModalData, _resetScheduleModalFields, openScheduleCreateModal,
 *   editSchedule, closeScheduleModal, parseSchedulePattern, saveSchedule,
 *   deleteSchedule, toggleJobEnabled, toggleBrainJob, runScheduleNow, runBrainNow
 *
 * Dependencies: api() from api.js, escHtml/showToast/showConfirm from utils.js
 * Cross-page: openAgentSettings, _updateHeartbeatMdPreview (window.* during migration)
 */

import { api } from '../api.js';
import { escHtml, showToast, showConfirm } from '../utils.js';
import { wsEventBus } from '../ws.js';

// --- STATE ------------------------------------------------------------------

let schedules  = [];
let brainStatus = null;
let brainUsage = null;
let teamsById = {};
let editingScheduleId = null;
let scheduleSkillsCache = [];
let _scheduleSkillIds = [];
let _scheduleContextRefs = [];
let _scheduleCtxRefEditId = null;
const scheduleRunStates = new Map();

const SCHEDULE_OWNER_MAIN = '__main__';

function _scheduleLocalTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function _scheduleOwnerValue(job) {
  const teamId = String(job?.team_id || job?.teamId || '').trim();
  if (teamId) return '';
  const assignmentTarget = String(job?.assignment_target || job?.assignmentTarget || '').trim();
  const subagentId = String(job?.subagent_id || job?.subagentId || '').trim();
  if (assignmentTarget === 'main' || job?.deliver_to_main_channel === true || job?.deliverToMainChannel === true || !subagentId) {
    return SCHEDULE_OWNER_MAIN;
  }
  return subagentId;
}

// --- TOGGLE SWITCH RENDERER -------------------------------------------------

function _toggleHtml(enabled, onClickFn, title = '') {
  const isOn = !!enabled;
  return `<div
    onclick="event.stopPropagation(); ${onClickFn}"
    title="${isOn ? 'Enabled — click to disable' : 'Disabled — click to enable'}"
    style="width:34px;height:18px;border-radius:9px;background:${isOn ? '#22c55e' : '#9ca3af'};
           position:relative;cursor:pointer;flex-shrink:0;user-select:none;transition:background .15s">
    <div style="position:absolute;top:2px;left:${isOn ? '18px' : '2px'};width:14px;height:14px;
                background:white;border-radius:7px;box-shadow:0 1px 2px rgba(0,0,0,.25);
                transition:left .15s"></div>
  </div>`;
}

// --- SCHEDULER MANAGEMENT ---------------------------------------------------

async function refreshSchedules() {
  try {
    const [schedResult, brainResult, teamsResult, usageResult] = await Promise.all([
      api('/api/schedules'),
      api('/api/brain/status').catch(() => null),
      api('/api/teams').catch(() => null),
      api('/api/brain/usage?days=30&limit=50').catch(() => null),
    ]);
    if (schedResult.success && Array.isArray(schedResult.schedules)) {
      schedules = schedResult.schedules;
    }
    brainStatus = (brainResult?.success) ? brainResult : null;
    brainUsage = (usageResult?.success) ? usageResult : null;
    teamsById = {};
    if (teamsResult?.success && Array.isArray(teamsResult.teams)) {
      for (const team of teamsResult.teams) {
        if (team?.id) teamsById[team.id] = team;
      }
    }
    const scheduleIds = new Set(schedules.map((job) => String(job?.id || '').trim()).filter(Boolean));
    for (const id of scheduleRunStates.keys()) {
      if (!scheduleIds.has(id)) scheduleRunStates.delete(id);
    }
    schedules.forEach((job) => {
      const id = String(job?.id || '').trim();
      if (id) scheduleRunStates.set(id, { loading: true, opening: false, runs: [], selectedRun: null, target: null, reason: '' });
    });
    renderScheduleList();
    await Promise.all(schedules.map((job) => _loadScheduleRunState(job)));
    renderScheduleList();
  } catch (err) {
    console.error('Failed to load schedules:', err);
  }
}

function _runTimestamp(run) {
  return Math.max(
    Number(run?.startedAt || 0),
    Number(run?.scheduledAt || 0),
    Number(run?.completedAt || 0),
  );
}

function _selectCurrentOrLastRun(runs) {
  const ordered = runs
    .filter((run) => run && typeof run === 'object')
    .slice()
    .sort((a, b) => _runTimestamp(b) - _runTimestamp(a));
  return ordered.find((run) => String(run.status || '').toLowerCase() === 'running') || ordered[0] || null;
}

async function _resolveScheduleRunState(job) {
  const jobId = String(job?.id || '').trim();
  if (!jobId) return { runs: [], selectedRun: null, target: null, reason: 'Schedule ID is missing.' };

  const logResult = await api(`/api/schedules/${encodeURIComponent(jobId)}/run-log`, { dedupe: false });
  const runs = Array.isArray(logResult?.runs) ? logResult.runs : [];
  const selectedRun = _selectCurrentOrLastRun(runs);
  if (!selectedRun) {
    return { runs, selectedRun: null, target: null, reason: 'No scheduled run has been recorded yet.' };
  }

  const taskId = String(selectedRun.taskId || '').trim();
  if (!taskId || taskId === `schedule_${jobId}`) {
    return { runs, selectedRun, target: null, reason: 'This run did not create a conversation task.' };
  }

  let taskResult;
  try {
    taskResult = await api(`/api/bg-tasks/${encodeURIComponent(taskId)}`, { dedupe: false });
  } catch {
    return { runs, selectedRun, target: null, reason: 'The conversation task for this run is no longer available.' };
  }
  const task = taskResult?.task;
  if (!task) {
    return { runs, selectedRun, target: null, reason: 'The conversation task for this run is no longer available.' };
  }

  const taskScheduleId = String(task.scheduleId || '').trim();
  const taskRunId = String(task.scheduleRunId || '').trim();
  if (taskScheduleId !== jobId || (taskRunId && taskRunId !== String(selectedRun.runId || '').trim())) {
    return { runs, selectedRun, target: null, reason: 'The run/task link could not be verified.' };
  }

  const teamId = String(job.team_id || job.teamId || '').trim();
  if (teamId) {
    return {
      runs,
      selectedRun,
      target: { kind: 'team', teamId, taskId, runId: String(selectedRun.runId || '') },
      reason: '',
    };
  }

  const assignmentTarget = String(job.assignment_target || job.assignmentTarget || '').trim().toLowerCase();
  const subagentId = String(job.subagent_id || job.subagentId || '').trim();
  const isMainConversation = assignmentTarget === 'main'
    || job.deliver_to_main_channel === true
    || job.deliverToMainChannel === true
    || !subagentId;

  // Main-agent scheduled runs write their user-facing output to an automated
  // conversation. The task session is only the scheduler's execution context.
  if (isMainConversation) {
    if (String(selectedRun.status || '').toLowerCase() === 'running') {
      return { runs, selectedRun, target: null, reason: 'The current run has not created its chat yet.' };
    }
    const outputSessionId = String(
      selectedRun.chatSessionId
        || job.last_output_session_id
        || job.lastOutputSessionId
        || '',
    ).trim();
    if (!outputSessionId || /heartbeat_ok/i.test(String(job.last_result || job.lastResult || ''))) {
      return { runs, selectedRun, target: null, reason: 'This run did not create a chat conversation.' };
    }
    try {
      const sessionResult = await api(`/api/sessions/${encodeURIComponent(outputSessionId)}`, { dedupe: false });
      if (!sessionResult?.session || !Array.isArray(sessionResult.session.history) || sessionResult.session.history.length === 0) {
        throw new Error('Session has no conversation history');
      }
    } catch {
      return { runs, selectedRun, target: null, reason: 'This run has no available chat session.' };
    }
    return {
      runs,
      selectedRun,
      target: { kind: 'session', sessionId: outputSessionId, taskId, runId: String(selectedRun.runId || '') },
      reason: '',
    };
  }

  const sessionId = String(task.sessionId || '').trim();
  if (!sessionId) {
    return { runs, selectedRun, target: null, reason: 'This run has no chat session.' };
  }
  try {
    const sessionResult = await api(`/api/sessions/${encodeURIComponent(sessionId)}`, { dedupe: false });
    if (!sessionResult?.session || !Array.isArray(sessionResult.session.history) || sessionResult.session.history.length === 0) {
      throw new Error('Session has no conversation history');
    }
  } catch {
    return { runs, selectedRun, target: null, reason: 'This run has no available chat session.' };
  }

  return {
    runs,
    selectedRun,
    target: { kind: 'session', sessionId, taskId, runId: String(selectedRun.runId || '') },
    reason: '',
  };
}

async function _loadScheduleRunState(job) {
  const jobId = String(job?.id || '').trim();
  if (!jobId) return;
  const prior = scheduleRunStates.get(jobId) || {};
  scheduleRunStates.set(jobId, { ...prior, loading: true, target: null, reason: '' });
  try {
    const resolved = await _resolveScheduleRunState(job);
    scheduleRunStates.set(jobId, { ...resolved, loading: false, opening: prior.opening === true });
  } catch (err) {
    scheduleRunStates.set(jobId, {
      ...prior,
      loading: false,
      target: null,
      reason: 'Run history is unavailable right now.',
      error: err?.message || 'Run history request failed',
    });
  }
}

function _scheduleChatControlHtml(job) {
  const jobId = String(job?.id || '').trim();
  const state = scheduleRunStates.get(jobId);
  if (!state || state.loading || state.opening) {
    return `<button disabled title="${state?.opening ? 'Opening the latest run chat' : 'Loading the latest run chat'}"
      style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);opacity:.65;
             border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:wait;white-space:nowrap">
      ${state?.opening ? 'Opening…' : 'Loading…'}
    </button>`;
  }
  if (state.target) {
    return `<button onclick="event.stopPropagation(); openScheduleRunChat('${escHtml(jobId)}')"
      style="border:1px solid color-mix(in srgb,var(--brand,#6c8ebf) 45%,var(--line));
             background:color-mix(in srgb,var(--brand,#6c8ebf) 10%,transparent);color:var(--brand,#6c8ebf);
             border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap"
      title="Open the conversation created by the current or last run">Open chat</button>`;
  }
  const reason = state.reason || 'No chat is available for the current or last run.';
  const label = 'No chat session available';
  return `<button disabled title="${escHtml(reason)}"
    style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);opacity:.7;
           border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:not-allowed;white-space:nowrap">
    ${label}
  </button>`;
}

function renderScheduleList() {
  const list  = document.getElementById('schedule-list');
  const count = document.getElementById('schedule-count');
  if (!list) return;

  const brainUsageCard = brainUsage ? _renderBrainUsage() : '';
  const brainCards = brainStatus ? _renderBrainCards() : '';
  const cronCards  = schedules.map(_renderCronCard).join('');
  const totalCount = schedules.length + (brainStatus ? 2 : 0);

  if (totalCount === 0) {
    list.innerHTML = '<div class="empty-state" style="text-align:center;color:var(--muted);padding:40px 20px">No schedules yet. <strong>+ New Schedule</strong> to get started.</div>';
    if (count) count.textContent = '0 schedules';
    return;
  }

  if (count) count.textContent = `${totalCount} schedule${totalCount !== 1 ? 's' : ''}`;
  list.innerHTML = brainUsageCard + brainCards + cronCards;
}

// --- BRAIN CARDS ------------------------------------------------------------

function _formatBrainUsageTokens(value) {
  const tokens = Math.max(0, Number(value || 0));
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`;
  return String(Math.round(tokens));
}

function _formatBrainUsageCost(value) {
  const usd = Math.max(0, Number(value || 0)) / 1000000;
  if (usd <= 0) return '$0';
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(5)}`;
}

function _brainUsageJobLabel(job) {
  if (job === 'thought') return 'Thought';
  if (job === 'dream_cleanup') return 'Dream cleanup';
  return 'Dream';
}

function _renderBrainUsage() {
  const summary = brainUsage?.summary || {};
  const records = Array.isArray(brainUsage?.records) ? brainUsage.records : [];
  const byJob = summary.byJob || {};
  const jobRows = ['thought', 'dream', 'dream_cleanup'].map((job) => {
    const value = byJob[job] || {};
    const successfulRuns = Number(value.successfulRuns || 0);
    const failedRuns = Number(value.failedRuns || 0);
    const abortedRuns = Number(value.abortedRuns || 0);
    return `<div style="padding:7px 9px;border:1px solid var(--line);border-radius:7px;background:var(--panel-2);min-width:125px">
      <div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em">${_brainUsageJobLabel(job)}</div>
      <div style="font-size:13px;font-weight:700;margin-top:2px">${_formatBrainUsageTokens(value.totalTokens)} tokens</div>
      <div style="font-size:10px;color:var(--muted)">${Number(value.runs || 0)} run${Number(value.runs || 0) === 1 ? '' : 's'} · ${successfulRuns} complete · ${failedRuns} failed · ${abortedRuns} aborted · ${_formatBrainUsageCost(value.totalCostMicros)}</div>
    </div>`;
  }).join('');
  const recentRows = records.slice(0, 6).map((record) => {
    const when = record.completedAt ? new Date(record.completedAt).toLocaleString() : '—';
    const outcome = String(record.outcome || 'unknown');
    const error = String(record.error || '').trim();
    const outcomeColor = outcome === 'success' ? '#0d5c2f' : outcome === 'aborted' ? '#7d5700' : '#9b1c1c';
    return `<tr>
      <td style="padding:5px 7px;white-space:nowrap">${escHtml(when)}</td>
      <td style="padding:5px 7px;white-space:nowrap">${escHtml(_brainUsageJobLabel(record.job))}</td>
      <td style="padding:5px 7px;text-align:right;white-space:nowrap">${_formatBrainUsageTokens(record.totalTokens)}</td>
      <td style="padding:5px 7px;text-align:right;white-space:nowrap">${_formatBrainUsageCost(record.totalCostMicros)}</td>
      <td title="${escHtml(error)}" style="padding:5px 7px;color:${outcomeColor};font-weight:700;white-space:nowrap">${escHtml(outcome)}</td>
    </tr>`;
  }).join('');
  const history = recentRows
    ? `<div style="overflow:auto;margin-top:9px"><table style="width:100%;border-collapse:collapse;font-size:10px;color:var(--muted)">
        <thead><tr style="border-bottom:1px solid var(--line);text-align:left"><th style="padding:4px 7px">Completed</th><th style="padding:4px 7px">Job</th><th style="padding:4px 7px;text-align:right">Tokens</th><th style="padding:4px 7px;text-align:right">Cost</th><th style="padding:4px 7px">Status</th></tr></thead>
        <tbody>${recentRows}</tbody>
      </table></div>`
    : `<div style="font-size:11px;color:var(--muted);margin-top:9px">No Brain runs have been recorded yet.</div>`;

  return `<div style="padding:12px;margin-bottom:10px;background:var(--panel);border:1px solid var(--line);border-radius:10px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <div style="font-weight:700;font-size:13px">Brain cost tracker</div>
      <div style="font-size:10px;color:var(--muted)">Last 30 days · estimated pricing</div>
    </div>
    <div style="font-size:11px;color:var(--muted);margin:4px 0 9px">${Number(summary.runs || 0)} runs · ${Number(summary.successfulRuns || 0)} complete · ${Number(summary.failedRuns || 0)} failed · ${Number(summary.abortedRuns || 0)} aborted · ${_formatBrainUsageTokens(summary.totalTokens)} tokens · ${_formatBrainUsageCost(summary.totalCostMicros)} estimated cost</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${jobRows}</div>
    ${history}
  </div>`;
}

function _renderBrainCards() {
  if (!brainStatus) return '';
  return [brainStatus.thought, brainStatus.dream].map(job => {
    if (!job) return '';
    const isThought = job.id === 'brain_thought';
    const enabled   = job.enabled !== false;
    const running   = job.running === true;
    const nextRun   = job.nextRun ? new Date(job.nextRun).toLocaleString() : '—';
    const lastRun   = job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never';

    const statusLabel = running ? 'running' : (enabled ? 'active' : 'disabled');
    const statusBg    = running ? 'rgba(167,139,250,.15)'
      : enabled ? '#c8f0c4'
      : '#e5e7eb';
    const statusTxt   = running ? '#6d28d9'
      : enabled ? '#0d5c2f'
      : '#374151';
    const outcome = String(job.lastOutcome || 'idle');
    const outcomeLabel = outcome === 'success' ? 'completed' : outcome === 'failed' ? 'failed' : outcome === 'aborted' ? 'aborted' : 'not run';
    const outcomeColor = outcome === 'success' ? '#0d5c2f' : outcome === 'failed' ? '#9b1c1c' : outcome === 'aborted' ? '#7d5700' : 'var(--muted)';

    const toggleFn = isThought
      ? `toggleBrainJob('thought', ${!enabled})`
      : `toggleBrainJob('dream', ${!enabled})`;
    const runFn = isThought
      ? `runBrainNow('thought')`
      : `runBrainNow('dream')`;

    const runNote = job.lastError
      ? ` <span style="color:var(--muted)">— ${escHtml(String(job.lastError).slice(0, 220))}</span>`
      : '';
    const outcomeNote = `<div style="font-size:11px;color:${outcomeColor}">Last outcome: <strong>${outcomeLabel}</strong>${runNote}</div>`;
    const extra = `${isThought && job.todayCount !== undefined
      ? `<div style="font-size:11px;color:var(--muted)">Thoughts today: <strong>${job.todayCount}</strong></div>`
      : job.ranToday !== undefined
        ? `<div style="font-size:11px;color:var(--muted)">Dream ran tonight: <strong>${job.ranToday ? 'yes' : 'not yet'}</strong></div>`
        : ''}${outcomeNote}`;

    return `
      <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;padding:12px;
                  background:var(--panel);border:1px solid var(--line);border-radius:10px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
            <div style="font-weight:700;font-size:13px">${escHtml(job.name)}</div>
            <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;
                         background:${statusBg};color:${statusTxt}">${statusLabel}</span>
            <span style="font-size:10px;padding:2px 7px;border-radius:5px;
                         background:rgba(99,102,241,.12);color:#6366f1;font-weight:600">Built-in</span>
          </div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:5px">${escHtml(job.description || '')}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:11px;color:var(--muted);margin-bottom:5px">
            <div><strong>Next:</strong> ${nextRun}</div>
            <div><strong>Last:</strong> ${lastRun}</div>
          </div>
          <div style="font-size:11px;color:var(--muted)">${job.schedule || ''}</div>
          ${extra}
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0;padding-top:2px">
          ${_toggleHtml(enabled, toggleFn)}
          <button onclick="event.stopPropagation(); ${runFn}"
            style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);
                   border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;
                   cursor:pointer;white-space:nowrap"
            ${running ? 'disabled title="Already running"' : 'title="Run now"'}>
            Run Now
          </button>
        </div>
      </div>`;
  }).join('');
}

// --- CRON JOB CARDS ---------------------------------------------------------

function _renderCronCard(job) {
  if (job.team_id) return _renderTeamScheduleCard(job);

  const enabled    = job.enabled !== false;
  const running    = job.status === 'running';
  const isPaused   = job.status === 'paused';
  const isDisabled = !enabled;

  const statusLabel = running ? 'running' : isDisabled ? 'disabled' : isPaused ? 'paused' : 'active';
  const statusBg    = running ? 'rgba(167,139,250,.15)' : isDisabled ? '#e5e7eb' : isPaused ? '#fff4d6' : '#c8f0c4';
  const statusTxt   = running ? '#6d28d9' : isDisabled ? '#374151' : isPaused ? '#7d5700' : '#0d5c2f';

  const ownerValue = _scheduleOwnerValue(job);
  const subagentId = ownerValue === SCHEDULE_OWNER_MAIN ? '' : ownerValue;
  const nextRun    = job.next_run || job.nextRun  ? new Date(job.next_run || job.nextRun).toLocaleString()  : 'Never';
  const lastRun    = job.last_run || job.lastRun  ? new Date(job.last_run || job.lastRun).toLocaleString() : 'Never';

  return `
    <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;padding:12px;
                background:var(--panel);border:1px solid var(--line);border-radius:10px;cursor:pointer"
         onclick="editSchedule('${job.id}')">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <div style="font-weight:700;font-size:13px">${escHtml(job.name || 'Untitled')}</div>
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;
                       background:${statusBg};color:${statusTxt}">${statusLabel}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.4;margin-bottom:6px">
          ${escHtml((job.prompt || '').slice(0, 60))}${(job.prompt || '').length > 60 ? '…' : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:11px;color:var(--muted);margin-bottom:6px">
          <div><strong>Next:</strong> ${nextRun}</div>
          <div><strong>Last:</strong> ${lastRun}</div>
        </div>
        <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;margin-top:2px">
          <strong>Assigned to:</strong>
          ${ownerValue === SCHEDULE_OWNER_MAIN
            ? `<span style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);
                       background:var(--panel-2);color:var(--text);border-radius:999px;padding:2px 9px;
                       font-size:10px;font-weight:700;white-space:nowrap">Main agent</span>`
            : subagentId
            ? `<button onclick="event.stopPropagation(); (window.openScheduleOwnerAgent ? openScheduleOwnerAgent('${subagentId}') : openAgentSettings('${subagentId}'))"
                 title="Open in Subagents"
                 style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--brand,#6c8ebf);
                        background:color-mix(in srgb,var(--brand,#6c8ebf) 10%,transparent);
                        color:var(--brand,#6c8ebf);border-radius:999px;padding:2px 9px;font-size:10px;
                        font-weight:700;cursor:pointer;font-family:monospace;white-space:nowrap">
                 🤖 ${escHtml(subagentId)}</button>`
            : `<span style="font-size:10px;color:var(--muted);font-style:italic">No owner selected</span>`
          }
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0;padding-top:2px">
        ${_toggleHtml(enabled, `toggleJobEnabled('${job.id}', ${!enabled})`)}
        ${_scheduleChatControlHtml(job)}
        <button onclick="event.stopPropagation(); runScheduleNow('${job.id}')"
          style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);
                 border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;
                 cursor:pointer;white-space:nowrap"
          title="Run now">Run Now</button>
        <button onclick="event.stopPropagation(); deleteSchedule('${job.id}')"
          style="border:1px solid #ff6b6b;background:#ffe0e0;color:#8b0000;
                 border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;
                 cursor:pointer;white-space:nowrap"
          title="Delete">Delete</button>
      </div>
    </div>`;
}

function _formatMaybeDate(value) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function _formatScheduleSummary(job) {
  const cron = String(job.cron || job.schedule || '').trim();
  const runAt = job.run_at || job.runAt;
  if (runAt) return `One-time run at ${_formatMaybeDate(runAt)}`;
  const tz = job.timezone || job.tz || 'local time';
  const parts = cron.split(/\s+/);
  if (parts.length >= 5) {
    const [minute, hour, dom, month, dow] = parts;
    const time = /^(\d+)$/.test(hour) && /^(\d+)$/.test(minute)
      ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      : '';
    if (minute === '0' && hour === '*') return `Every hour (${tz})`;
    if (/^\*\/\d+$/.test(minute) && hour === '*') return `Every ${minute.slice(2)} minutes (${tz})`;
    if (time && dom === '*' && month === '*' && dow === '*') return `Every day at ${time} (${tz})`;
    if (time && dom === '*' && month === '*' && dow === '1-5') return `Weekdays at ${time} (${tz})`;
    if (time && dom === '*' && month === '*' && dow !== '*') return `Weekly at ${time} (${tz})`;
    if (time && month === '*' && dow === '*') return `Monthly at ${time} (${tz})`;
  }
  return cron ? `${cron} (${tz})` : 'Manual schedule';
}

function _openScheduledTeam(teamId) {
  if (typeof window.setMode === 'function') window.setMode('teams');
  setTimeout(() => {
    if (typeof window.openTeamBoard === 'function') window.openTeamBoard(teamId);
  }, 120);
}

function _renderTeamScheduleCard(job) {
  const enabled    = job.enabled !== false;
  const running    = job.status === 'running';
  const isPaused   = job.status === 'paused';
  const isDisabled = !enabled;
  const teamId     = String(job.team_id || '').trim();
  const team       = teamsById[teamId] || null;
  const teamName   = team?.name || teamId || 'Team';
  const memberCount = Array.isArray(team?.subagentIds) ? team.subagentIds.length : null;
  const purpose = String(team?.purpose || team?.mission || team?.teamContext || team?.description || job.prompt || '').trim();
  const statusLabel = running ? 'running' : isDisabled ? 'disabled' : isPaused ? 'paused' : 'active';
  const statusBg    = running ? 'rgba(20,184,166,.16)' : isDisabled ? '#e5e7eb' : isPaused ? '#fff4d6' : '#d9f7ed';
  const statusTxt   = running ? '#0f766e' : isDisabled ? '#374151' : isPaused ? '#7d5700' : '#066046';
  const scheduleText = _formatScheduleSummary(job);
  const nextRun = _formatMaybeDate(job.next_run || job.nextRun);
  const lastRun = _formatMaybeDate(job.last_run || job.lastRun);

  return `
    <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;padding:14px;
                background:var(--panel);border:1px solid var(--line);border-radius:10px;cursor:pointer"
         onclick="editSchedule('${job.id}')">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <div style="font-weight:800;font-size:13px">${escHtml(job.name || 'Team schedule')}</div>
          <span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:6px;
                       background:${statusBg};color:${statusTxt}">${statusLabel}</span>
          <span style="font-size:10px;padding:2px 7px;border-radius:5px;
                       background:rgba(20,184,166,.14);color:#0f766e;font-weight:800">Team Run</span>
          ${memberCount !== null ? `<span style="font-size:10px;color:var(--muted);font-weight:700">${memberCount} member${memberCount === 1 ? '' : 's'}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px">
          <button onclick="event.stopPropagation(); _openScheduledTeam('${escHtml(teamId)}')"
             title="Open team board"
             style="display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(20,184,166,.35);
                    background:rgba(20,184,166,.10);color:#0f766e;border-radius:999px;padding:3px 10px;
                    font-size:11px;font-weight:800;cursor:pointer;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
             TEAM ${escHtml(teamName)}</button>
          <span style="font-size:11px;color:var(--muted);font-weight:700">${escHtml(scheduleText)}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.45;margin-bottom:8px">
          Manager wakes first, reads the team goal and memory, then dispatches the right agents for this run.
          ${purpose ? `<span style="display:block;margin-top:3px">${escHtml(purpose.slice(0, 110))}${purpose.length > 110 ? '...' : ''}</span>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:11px;color:var(--muted);margin-bottom:5px">
          <div><strong>Next:</strong> ${nextRun}</div>
          <div><strong>Last:</strong> ${lastRun}</div>
        </div>
        <div style="font-size:10px;color:var(--muted);font-family:monospace">team_id: ${escHtml(teamId)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0;padding-top:2px">
        ${_toggleHtml(enabled, `toggleJobEnabled('${job.id}', ${!enabled})`)}
        ${_scheduleChatControlHtml(job)}
        <button onclick="event.stopPropagation(); runScheduleNow('${job.id}')"
          style="border:1px solid rgba(20,184,166,.35);background:rgba(20,184,166,.10);color:#0f766e;
                 border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;
                 cursor:pointer;white-space:nowrap"
          title="Start team run now">Run Team</button>
        <button onclick="event.stopPropagation(); deleteSchedule('${job.id}')"
          style="border:1px solid #ff6b6b;background:#ffe0e0;color:#8b0000;
                 border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;
                 cursor:pointer;white-space:nowrap"
          title="Delete">Delete</button>
      </div>
    </div>`;
}

// --- TOGGLE ACTIONS ---------------------------------------------------------

async function toggleJobEnabled(jobId, enabled) {
  try {
    const result = await api(`/api/schedules/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: !!enabled }),
    });
    if (result.success) {
      await refreshSchedules();
    } else {
      showToast('Update failed', result.error || 'Failed to update', 'error');
    }
  } catch (err) {
    showToast('Update failed', err.message, 'error');
  }
}

async function toggleBrainJob(type, enabled) {
  try {
    const body = type === 'thought'
      ? { thoughtEnabled: !!enabled }
      : { dreamEnabled:  !!enabled };
    const result = await api('/api/brain/config', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (result.success) {
      await refreshSchedules();
    } else {
      showToast('Update failed', result.error || 'Failed to update', 'error');
    }
  } catch (err) {
    showToast('Update failed', err.message, 'error');
  }
}

async function runBrainNow(type) {
  try {
    const result = await api('/api/brain/run', {
      method: 'POST',
      body: JSON.stringify({ type }),
    });
    if (result.success) {
      showToast(`Brain ${type} triggered`, '', 'success');
      setTimeout(refreshSchedules, 1000);
    } else {
      showToast('Run failed', result.error || 'Failed to trigger', 'error');
    }
  } catch (err) {
    showToast('Run failed', err.message, 'error');
  }
}

function _resolveSchedulePattern() {
  const occ = document.getElementById('schedule-occurrence').value;
  if (occ === 'manual') return null;
  if (occ === 'daily') {
    const t = document.getElementById('schedule-time').value || '09:00';
    const [hh, mm] = t.split(':');
    return `${parseInt(mm||0)} ${parseInt(hh||9)} * * *`;
  }
  if (occ === 'weekday') {
    const t = document.getElementById('schedule-time').value || '09:00';
    const [hh, mm] = t.split(':');
    return `${parseInt(mm||0)} ${parseInt(hh||9)} * * 1-5`;
  }
  if (occ === 'every48') {
    const t = document.getElementById('schedule-time').value || '09:00';
    const [hh, mm] = t.split(':');
    return `${parseInt(mm||0)} ${parseInt(hh||9)} */2 * *`;
  }
  if (occ === 'custom') {
    return document.getElementById('schedule-pattern').value.trim() || null;
  }
  return occ;
}

function onScheduleOccurrenceChange() {
  const occ = document.getElementById('schedule-occurrence').value;
  const needsTime = occ === 'daily' || occ === 'weekday' || occ === 'every48';
  const isCustom = occ === 'custom';
  document.getElementById('schedule-time-row').style.display = needsTime ? '' : 'none';
  document.getElementById('schedule-custom-cron-row').style.display = isCustom ? '' : 'none';
}

// --- CONTEXT + SKILLS -------------------------------------------------------

function _normalizeScheduleContextRef(raw) {
  const title = String(raw?.title || '').trim();
  const content = String(raw?.content || '').trim();
  if (!title || !content) return null;
  const now = Date.now();
  return {
    id: String(raw?.id || `ref_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`).trim(),
    title,
    content,
    createdAt: Number(raw?.createdAt || raw?.created_at || now) || now,
    updatedAt: Number(raw?.updatedAt || raw?.updated_at || now) || now,
  };
}

function _setScheduleAttachmentsFromJob(job) {
  _scheduleSkillIds = Array.isArray(job?.skillIds)
    ? Array.from(new Set(job.skillIds.map(id => String(id || '').trim()).filter(Boolean)))
    : [];
  const refs = Array.isArray(job?.context_refs)
    ? job.context_refs
    : (Array.isArray(job?.contextReferences) ? job.contextReferences : []);
  _scheduleContextRefs = refs.map(_normalizeScheduleContextRef).filter(Boolean);
  _scheduleCtxRefEditId = null;
}

function _renderScheduleSkills() {
  const chips = document.getElementById('schedule-skill-chips');
  const select = document.getElementById('schedule-skill-select');
  if (!chips || !select) return;
  const byId = new Map(scheduleSkillsCache.map(skill => [String(skill.id || '').trim(), skill]));
  chips.innerHTML = _scheduleSkillIds.length
    ? _scheduleSkillIds.map((id) => {
        const skill = byId.get(id) || {};
        const label = skill.name && skill.name !== id ? `${skill.name} (${id})` : id;
        return `<span style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--panel-2);border-radius:999px;padding:4px 9px;font-size:11px;font-weight:700;max-width:100%">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(label)}</span>
          <button type="button" onclick="removeScheduleSkill('${escHtml(id)}')" style="border:0;background:none;color:var(--muted);cursor:pointer;font-weight:900;padding:0;line-height:1">&times;</button>
        </span>`;
      }).join('')
    : '<span style="font-size:11px;color:var(--muted)">No skills attached.</span>';
  const available = scheduleSkillsCache.filter(skill => skill?.id && !_scheduleSkillIds.includes(String(skill.id)));
  select.innerHTML = '<option value="">Attach skill...</option>' + available.map(skill => {
    const id = String(skill.id || '');
    const label = skill.name && skill.name !== id ? `${skill.name} (${id})` : id;
    return `<option value="${escHtml(id)}">${escHtml(label)}</option>`;
  }).join('');
}

function addScheduleSkill() {
  const select = document.getElementById('schedule-skill-select');
  const skillId = String(select?.value || '').trim();
  if (!skillId || _scheduleSkillIds.includes(skillId)) return;
  _scheduleSkillIds.push(skillId);
  if (select) select.value = '';
  _renderScheduleSkills();
}

function removeScheduleSkill(skillId) {
  const id = String(skillId || '').trim();
  _scheduleSkillIds = _scheduleSkillIds.filter(existing => existing !== id);
  _renderScheduleSkills();
}

async function reloadScheduleSkills() {
  try {
    const data = await api('/api/skills?refresh=1');
    scheduleSkillsCache = Array.isArray(data?.skills) ? data.skills : [];
    _renderScheduleSkills();
  } catch (err) {
    showToast('Skills unavailable', err.message || 'Could not load skills', 'warning');
  }
}

function _renderScheduleContextRefs() {
  const list = document.getElementById('schedule-context-ref-list');
  if (!list) return;
  if (!_scheduleContextRefs.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--muted);border:1px dashed var(--line);border-radius:8px;padding:9px 10px">No context references attached.</div>';
    return;
  }
  list.innerHTML = _scheduleContextRefs.map((ref) => `
    <button type="button" onclick="openScheduleCtxRefModal('${escHtml(ref.id)}')" style="text-align:left;border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:9px 10px;cursor:pointer;color:var(--text)">
      <div style="font-size:12px;font-weight:800;margin-bottom:3px">${escHtml(ref.title)}</div>
      <div style="font-size:11px;color:var(--muted);line-height:1.45;white-space:pre-wrap">${escHtml(ref.content.slice(0, 220))}${ref.content.length > 220 ? '...' : ''}</div>
    </button>
  `).join('');
}

function saveScheduleCtxRef() {
  const titleInput = document.getElementById('schedule-ctx-title');
  const contentInput = document.getElementById('schedule-ctx-content');
  const title = String(titleInput?.value || '').trim();
  const content = String(contentInput?.value || '').trim();
  if (!title || !content) {
    showToast('Reference required', 'Add a title and content for the context card.', 'warning');
    return;
  }
  const ref = _normalizeScheduleContextRef({ title, content });
  if (!ref) return;
  _scheduleContextRefs.push(ref);
  if (titleInput) titleInput.value = '';
  if (contentInput) contentInput.value = '';
  _renderScheduleContextRefs();
}

function openScheduleCtxRefModal(refId) {
  const ref = _scheduleContextRefs.find(item => item.id === refId);
  if (!ref) return;
  _scheduleCtxRefEditId = ref.id;
  document.getElementById('schedule-ctx-modal-title').value = ref.title;
  document.getElementById('schedule-ctx-modal-content').value = ref.content;
  document.getElementById('schedule-ctx-modal').style.display = 'flex';
}

function closeScheduleCtxRefModal() {
  _scheduleCtxRefEditId = null;
  const modal = document.getElementById('schedule-ctx-modal');
  if (modal) modal.style.display = 'none';
}

function updateScheduleCtxRef() {
  if (!_scheduleCtxRefEditId) return;
  const idx = _scheduleContextRefs.findIndex(ref => ref.id === _scheduleCtxRefEditId);
  if (idx < 0) return;
  const title = String(document.getElementById('schedule-ctx-modal-title')?.value || '').trim();
  const content = String(document.getElementById('schedule-ctx-modal-content')?.value || '').trim();
  if (!title || !content) {
    showToast('Reference required', 'Context references need a title and content.', 'warning');
    return;
  }
  _scheduleContextRefs[idx] = {
    ..._scheduleContextRefs[idx],
    title,
    content,
    updatedAt: Date.now(),
  };
  closeScheduleCtxRefModal();
  _renderScheduleContextRefs();
}

function deleteScheduleCtxRef() {
  if (!_scheduleCtxRefEditId) return;
  _scheduleContextRefs = _scheduleContextRefs.filter(ref => ref.id !== _scheduleCtxRefEditId);
  closeScheduleCtxRefModal();
  _renderScheduleContextRefs();
}

// --- MODAL: LOAD DATA -------------------------------------------------------

async function _loadScheduleModalData() {
  try {
    const agentsResult = await api('/api/agents');
    const sel = document.getElementById('schedule-subagent');
    sel.innerHTML = '<option value="__main__">Main agent (Prometheus)</option>';
    window._agentsCache = window._agentsCache || {};
    if (agentsResult.agents && Array.isArray(agentsResult.agents)) {
      for (const a of agentsResult.agents) {
        window._agentsCache[a.id] = a.name || a.id;
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name ? `${a.name} (${a.id})` : a.id;
        sel.appendChild(opt);
      }
    }
    if (editingScheduleId) {
      const job = schedules.find(j => j.id === editingScheduleId);
      const sid = _scheduleOwnerValue(job);
      if (sid) {
        sel.value = sid;
        if (typeof window._updateHeartbeatMdPreview === 'function') window._updateHeartbeatMdPreview(sid);
      }
    }
  } catch {}

  try {
    const skillsResult = await api('/api/skills').catch(() => ({ skills: [] }));
    scheduleSkillsCache = Array.isArray(skillsResult?.skills) ? skillsResult.skills : [];
  } catch {
    scheduleSkillsCache = [];
  }
  _renderScheduleSkills();
  _renderScheduleContextRefs();
}

function _resetScheduleModalFields() {
  document.getElementById('schedule-name').value = '';
  document.getElementById('schedule-occurrence').value = '0 * * * *';
  document.getElementById('schedule-time').value = '09:00';
  document.getElementById('schedule-pattern').value = '';
  document.getElementById('schedule-prompt').value = '';
  document.getElementById('schedule-subagent').value = SCHEDULE_OWNER_MAIN;
  document.getElementById('schedule-pattern-preview').style.display = 'none';
  document.getElementById('schedule-time-row').style.display = 'none';
  document.getElementById('schedule-custom-cron-row').style.display = 'none';
  _scheduleSkillIds = [];
  _scheduleContextRefs = [];
  _scheduleCtxRefEditId = null;
  _renderScheduleSkills();
  _renderScheduleContextRefs();
}

// --- MODAL: CREATE / EDIT ---------------------------------------------------

function openScheduleCreateModal() {
  editingScheduleId = null;
  document.getElementById('schedule-modal-title').textContent = 'Create Schedule';
  document.getElementById('schedule-save-btn').textContent = 'Create Schedule';
  _resetScheduleModalFields();
  _setScheduleAttachmentsFromJob(null);
  document.getElementById('schedule-modal').style.display = 'flex';
  _loadScheduleModalData();
}

function editSchedule(jobId) {
  const job = schedules.find(j => j.id === jobId);
  if (!job) return;

  editingScheduleId = jobId;
  document.getElementById('schedule-modal-title').textContent = 'Edit Schedule';
  document.getElementById('schedule-save-btn').textContent = 'Save Changes';
  _resetScheduleModalFields();
  _setScheduleAttachmentsFromJob(job);
  document.getElementById('schedule-name').value = job.name || '';

  const cron = job.cron || job.run_at || '';
  const occSel = document.getElementById('schedule-occurrence');
  const knownCrons = ['0 * * * *','0 */3 * * *','0 */6 * * *','0 */8 * * *','0 */12 * * *'];
  if (!cron) { occSel.value = 'manual'; }
  else if (knownCrons.includes(cron)) { occSel.value = cron; }
  else if (/^\d+ \d+ \* \* 1-5$/.test(cron)) {
    occSel.value = 'weekday';
    const parts = cron.split(' ');
    document.getElementById('schedule-time').value = `${String(parts[1]).padStart(2,'0')}:${String(parts[0]).padStart(2,'0')}`;
    document.getElementById('schedule-time-row').style.display = '';
  } else if (/^\d+ \d+ \* \* \*$/.test(cron)) {
    occSel.value = 'daily';
    const parts = cron.split(' ');
    document.getElementById('schedule-time').value = `${String(parts[1]).padStart(2,'0')}:${String(parts[0]).padStart(2,'0')}`;
    document.getElementById('schedule-time-row').style.display = '';
  } else if (/^\d+ \d+ \*\/2 \* \*$/.test(cron)) {
    occSel.value = 'every48';
    const parts = cron.split(' ');
    document.getElementById('schedule-time').value = `${String(parts[1]).padStart(2,'0')}:${String(parts[0]).padStart(2,'0')}`;
    document.getElementById('schedule-time-row').style.display = '';
  } else {
    occSel.value = 'custom';
    document.getElementById('schedule-pattern').value = cron;
    document.getElementById('schedule-custom-cron-row').style.display = '';
  }
  document.getElementById('schedule-prompt').value = job.prompt || '';
  document.getElementById('schedule-pattern-preview').style.display = 'none';
  document.getElementById('schedule-modal').style.display = 'flex';
  _loadScheduleModalData();
}

function closeScheduleModal() {
  document.getElementById('schedule-modal').style.display = 'none';
  editingScheduleId = null;
}

// --- PATTERN PARSE ----------------------------------------------------------

async function parseSchedulePattern() {
  const pattern  = document.getElementById('schedule-pattern').value.trim();
  const timezone = _scheduleLocalTimezone();
  if (!pattern) {
    alert('Enter a schedule pattern (e.g., "daily at 09:00" or "0 9 * * *")');
    return;
  }
  try {
    const result = await api('/api/schedules/parse', {
      method: 'POST',
      body: JSON.stringify({ text: pattern, timezone }),
    });
    const preview = document.getElementById('schedule-pattern-preview');
    if (result.success) {
      preview.textContent = `✓ ${result.preview || result.human_text || 'Valid pattern'}`;
      preview.style.display = 'block';
      preview.style.color = 'var(--muted)';
    } else {
      preview.textContent = `✗ ${result.error || 'Invalid pattern'}`;
      preview.style.display = 'block';
      preview.style.color = '#ff6b6b';
    }
  } catch (err) {
    document.getElementById('schedule-pattern-preview').textContent = '✗ Parse failed';
    document.getElementById('schedule-pattern-preview').style.display = 'block';
    document.getElementById('schedule-pattern-preview').style.color = '#ff6b6b';
  }
}

// --- SAVE / DELETE ----------------------------------------------------------

async function saveSchedule() {
  const name      = document.getElementById('schedule-name').value.trim();
  const prompt    = document.getElementById('schedule-prompt').value.trim();
  const timezone  = _scheduleLocalTimezone();
  const ownerValue = document.getElementById('schedule-subagent').value.trim() || SCHEDULE_OWNER_MAIN;
  const subagentId = ownerValue === SCHEDULE_OWNER_MAIN ? '' : ownerValue;
  const pattern   = _resolveSchedulePattern();
  const currentJob = editingScheduleId ? schedules.find(j => j.id === editingScheduleId) : null;
  const currentTeamId = String(currentJob?.team_id || '').trim();

  if (!name)    { showToast('Name required',    'Schedule name is required',    'warning'); return; }
  if (!pattern && document.getElementById('schedule-occurrence').value !== 'manual') {
    showToast('Pattern required', 'Schedule pattern is required', 'warning'); return;
  }
  if (!prompt)  { showToast('Prompt required',  'Prompt/action is required',    'warning'); return; }

  const method  = editingScheduleId ? 'PUT'  : 'POST';
  const apiPath = editingScheduleId ? `/api/schedules/${editingScheduleId}` : '/api/schedules';

  try {
    const body = {
      name,
      pattern: pattern || '0 9 * * *',
      prompt,
      timezone,
      delivery_channel: 'web',
      confirm: true,
      ...(currentTeamId && !subagentId ? { team_id: currentTeamId } : {}),
      ...(!currentTeamId || subagentId ? { subagent_id: subagentId } : {}),
      skillIds: _scheduleSkillIds,
      context_refs: _scheduleContextRefs,
    };
    const result = await api(apiPath, { method, body: JSON.stringify(body) });
    if (result.success) {
      closeScheduleModal();
      await refreshSchedules();
    } else {
      showToast('Save failed', result.error || 'Unknown error', 'error');
    }
  } catch (err) {
    showToast('Save failed', err.message, 'error');
  }
}

async function deleteSchedule(jobId) {
  if (!await new Promise(r => showConfirm(
    'Delete this schedule? This cannot be undone.',
    () => r(true), () => r(false),
    { title: 'Delete Schedule', confirmText: 'Delete', danger: true }
  ))) return;

  try {
    const result = await api(`/api/schedules/${jobId}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true }),
    });
    if (result.success) {
      await refreshSchedules();
    } else {
      showToast('Delete failed', result.error || 'Failed to delete', 'error');
    }
  } catch (err) {
    showToast('Delete failed', err.message, 'error');
  }
}

async function runScheduleNow(jobId) {
  try {
    const job = schedules.find(j => j.id === jobId);
    const result = await api(`/api/schedules/${jobId}/run`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (result.success) {
      await refreshSchedules();
      showToast('Schedule running now', job?.name || '', 'success');
      // The scheduler acknowledges before the run task is necessarily persisted.
      // Re-check once the task/run-log write has had a chance to complete.
      setTimeout(async () => {
        if (!job) return;
        await _loadScheduleRunState(job);
        if (window.currentMode === 'schedule') renderScheduleList();
      }, 800);
    } else {
      showToast('Run failed', result.error || 'Failed to run', 'error');
    }
  } catch (err) {
    showToast('Run failed', err.message, 'error');
  }
}

async function _openScheduleTeamChat(teamId) {
  if (typeof window.setMode === 'function') window.setMode('teams');
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (typeof window.openTeamBoard !== 'function' || typeof window.switchTeamTab !== 'function') {
    throw new Error('Team chat navigation is unavailable in this view.');
  }
  await window.openTeamBoard(teamId);
  window.switchTeamTab('chat', teamId);
}

async function openScheduleRunChat(jobId) {
  const job = schedules.find((item) => String(item?.id || '') === String(jobId || ''));
  if (!job) return;

  const current = scheduleRunStates.get(String(jobId)) || {};
  if (current.opening) return;
  scheduleRunStates.set(String(jobId), { ...current, loading: true, opening: true, target: null });
  renderScheduleList();

  try {
    // Re-resolve at click time so a newly-started run cannot accidentally open
    // the previous run's conversation.
    const resolved = await _resolveScheduleRunState(job);
    scheduleRunStates.set(String(jobId), { ...resolved, loading: false, opening: true });
    if (!resolved.target) {
      throw new Error(resolved.reason || 'No chat is available for this run.');
    }

    if (resolved.target.kind === 'team') {
      await _openScheduleTeamChat(resolved.target.teamId);
      return;
    }

    const sessionId = resolved.target.sessionId;
    if (typeof window.openTerminalSession === 'function') {
      await window.openTerminalSession(sessionId, 'web');
    } else if (typeof window.openSession === 'function') {
      await window.openSession(sessionId);
    } else {
      throw new Error('Chat navigation is unavailable in this view.');
    }
    if (String(window.activeChatSessionId || '') !== sessionId) {
      throw new Error('The run chat could not be opened.');
    }
  } catch (err) {
    showToast('Chat unavailable', err?.message || 'Could not open the run chat', 'warning');
  } finally {
    const latest = scheduleRunStates.get(String(jobId)) || {};
    scheduleRunStates.set(String(jobId), { ...latest, loading: false, opening: false });
    renderScheduleList();
  }
}

// ─── Expose on window for HTML onclick handlers ────────────────
window.refreshSchedules        = refreshSchedules;
window.renderScheduleList      = renderScheduleList;
window.openScheduleCreateModal = openScheduleCreateModal;
window.editSchedule            = editSchedule;
window.closeScheduleModal      = closeScheduleModal;
window.parseSchedulePattern    = parseSchedulePattern;
window.saveSchedule            = saveSchedule;
window.deleteSchedule          = deleteSchedule;
window.toggleJobEnabled        = toggleJobEnabled;
window.toggleBrainJob          = toggleBrainJob;
window.runBrainNow             = runBrainNow;
window.runScheduleNow          = runScheduleNow;
window.openScheduleRunChat     = openScheduleRunChat;
window.onScheduleOccurrenceChange = onScheduleOccurrenceChange;
window.addScheduleSkill        = addScheduleSkill;
window.removeScheduleSkill     = removeScheduleSkill;
window.reloadScheduleSkills    = reloadScheduleSkills;
window.saveScheduleCtxRef      = saveScheduleCtxRef;
window.openScheduleCtxRefModal = openScheduleCtxRefModal;
window.closeScheduleCtxRefModal = closeScheduleCtxRefModal;
window.updateScheduleCtxRef    = updateScheduleCtxRef;
window.deleteScheduleCtxRef    = deleteScheduleCtxRef;
window._openScheduledTeam      = _openScheduledTeam;

// ─── WS Event Handlers ─────────────────────────────────────────
wsEventBus.on('jobs_update', (msg) => {
  window.allJobs = msg.jobs;
  if (typeof window.updateStats === 'function') window.updateStats([]);
  if (window.selectedJobId && typeof window.refreshJobDetail === 'function') window.refreshJobDetail(window.selectedJobId);
});
wsEventBus.on('job_created', (msg) => {
  if (typeof window.log === 'function') window.log(`Job created: ${msg.jobId}`, 'info');
});
wsEventBus.on('tasks_update', () => {
  if (window.currentMode === 'schedule') refreshSchedules();
});
wsEventBus.on('task_running', (msg) => {
  if (window.currentMode === 'schedule') refreshSchedules();
  const eventSessionId = String(msg.sessionId || '').trim();
  const activeSessionId = String(window.activeChatSessionId || '').trim();
  if (eventSessionId && eventSessionId === activeSessionId && typeof window.addProcessEntry === 'function') {
    window.addProcessEntry('info', `Task running: ${msg.jobName}`, { actor: 'Background Task' });
  }
});
wsEventBus.on('task_done', (msg) => {
  if (window.currentMode === 'schedule') refreshSchedules();
  if (msg.automatedSession && !msg.isOk) {
    if (typeof window.upsertAutomatedSession === 'function') window.upsertAutomatedSession(msg.automatedSession);
    if (typeof window.bgtToast === 'function') window.bgtToast('🕐 Scheduled task done', `"${msg.jobName}" — results in sidebar`);
    if (typeof window.addProcessEntry === 'function') window.addProcessEntry('info', `Task "${msg.jobName}" completed — check sidebar for results`);
  } else if (msg.isOk) {
    if (typeof window.addProcessEntry === 'function') window.addProcessEntry('info', `Task "${msg.jobName}" — OK (nothing to report)`);
  }
});
wsEventBus.on('brain_thought_done', () => {
  if (window.currentMode === 'schedule') refreshSchedules();
});
wsEventBus.on('brain_dream_done', () => {
  if (window.currentMode === 'schedule') refreshSchedules();
});
wsEventBus.on('brain_dream_cleanup_done', () => {
  if (window.currentMode === 'schedule') refreshSchedules();
});
