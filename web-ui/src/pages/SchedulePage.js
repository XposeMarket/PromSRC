/**
 * SchedulePage.js — F3c Extract
 *
 * Schedule management page: CRUD for cron jobs, pattern parsing, run history.
 * Brain Thought + Brain Dream cards are rendered as built-in system jobs.
 *
 * Functions extracted verbatim from index.html:
 *   refreshSchedules, renderScheduleList, _resolveSchedulePattern,
 *   onScheduleOccurrenceChange, addScheduleRefLink, _renderScheduleRefChips,
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
let teamsById = {};
let editingScheduleId = null;

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
    const [schedResult, brainResult, teamsResult] = await Promise.all([
      api('/api/schedules'),
      api('/api/brain/status').catch(() => null),
      api('/api/teams').catch(() => null),
    ]);
    if (schedResult.success && Array.isArray(schedResult.schedules)) {
      schedules = schedResult.schedules;
    }
    brainStatus = (brainResult?.success) ? brainResult : null;
    teamsById = {};
    if (teamsResult?.success && Array.isArray(teamsResult.teams)) {
      for (const team of teamsResult.teams) {
        if (team?.id) teamsById[team.id] = team;
      }
    }
    renderScheduleList();
  } catch (err) {
    console.error('Failed to load schedules:', err);
  }
}

function renderScheduleList() {
  const list  = document.getElementById('schedule-list');
  const count = document.getElementById('schedule-count');
  if (!list) return;

  const brainCards = brainStatus ? _renderBrainCards() : '';
  const cronCards  = schedules.map(_renderCronCard).join('');
  const totalCount = schedules.length + (brainStatus ? 2 : 0);

  if (totalCount === 0) {
    list.innerHTML = '<div class="empty-state" style="text-align:center;color:var(--muted);padding:40px 20px">No schedules yet. <strong>+ New Schedule</strong> to get started.</div>';
    if (count) count.textContent = '0 schedules';
    return;
  }

  if (count) count.textContent = `${totalCount} schedule${totalCount !== 1 ? 's' : ''}`;
  list.innerHTML = brainCards + cronCards;
}

// --- BRAIN CARDS ------------------------------------------------------------

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
    const statusColor = running ? '#a78bfa'
      : enabled ? '#16a34a'
      : '#6b7280';
    const statusBg    = running ? 'rgba(167,139,250,.15)'
      : enabled ? '#c8f0c4'
      : '#e5e7eb';
    const statusTxt   = running ? '#6d28d9'
      : enabled ? '#0d5c2f'
      : '#374151';

    const toggleFn = isThought
      ? `toggleBrainJob('thought', ${!enabled})`
      : `toggleBrainJob('dream', ${!enabled})`;
    const runFn = isThought
      ? `runBrainNow('thought')`
      : `runBrainNow('dream')`;

    const extra = isThought && job.todayCount !== undefined
      ? `<div style="font-size:11px;color:var(--muted)">Thoughts today: <strong>${job.todayCount}</strong></div>`
      : job.ranToday !== undefined
        ? `<div style="font-size:11px;color:var(--muted)">Dream ran tonight: <strong>${job.ranToday ? 'yes' : 'not yet'}</strong></div>`
        : '';

    return `
      <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;padding:12px;
                  background:var(--panel);border:1px solid var(--line);border-radius:10px;
                  border-left:3px solid ${statusColor}">
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

  const subagentId = job.subagent_id || '';
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
          ${subagentId
            ? `<button onclick="event.stopPropagation(); (window.openScheduleOwnerAgent ? openScheduleOwnerAgent('${subagentId}') : openAgentSettings('${subagentId}'))"
                 title="Open in Subagents"
                 style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--brand,#6c8ebf);
                        background:color-mix(in srgb,var(--brand,#6c8ebf) 10%,transparent);
                        color:var(--brand,#6c8ebf);border-radius:999px;padding:2px 9px;font-size:10px;
                        font-weight:700;cursor:pointer;font-family:monospace;white-space:nowrap">
                 🤖 ${escHtml(subagentId)}</button>`
            : `<span style="font-size:10px;color:var(--muted);font-style:italic">Owner agent will be assigned on next save/run</span>`
          }
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0;padding-top:2px">
        ${_toggleHtml(enabled, `toggleJobEnabled('${job.id}', ${!enabled})`)}
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
                background:linear-gradient(180deg,color-mix(in srgb,#14b8a6 8%,var(--panel)),var(--panel));
                border:1px solid color-mix(in srgb,#14b8a6 32%,var(--line));border-radius:10px;
                border-left:3px solid #14b8a6;cursor:pointer"
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

// --- REFERENCE LINKS --------------------------------------------------------

let _scheduleRefLinks = [];

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

function addScheduleRefLink() {
  const input = document.getElementById('schedule-ref-input');
  const url = (input.value || '').trim();
  if (!url) return;
  if (!_scheduleRefLinks.includes(url)) {
    _scheduleRefLinks.push(url);
    _renderScheduleRefChips();
  }
  input.value = '';
}

function _renderScheduleRefChips() {
  const container = document.getElementById('schedule-ref-chips');
  container.innerHTML = '';
  _scheduleRefLinks.forEach((url, i) => {
    const chip = document.createElement('div');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:var(--panel-2);border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:11px;max-width:240px;overflow:hidden';
    const label = document.createElement('span');
    label.textContent = url.length > 35 ? url.slice(0,32)+'...' : url;
    label.title = url;
    label.style.overflow = 'hidden';
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.style.cssText = 'border:0;background:none;cursor:pointer;color:var(--muted);font-size:11px;padding:0;line-height:1';
    btn.onclick = () => { _scheduleRefLinks.splice(i,1); _renderScheduleRefChips(); };
    chip.appendChild(label);
    chip.appendChild(btn);
    container.appendChild(chip);
  });
}

// --- MODAL: LOAD DATA -------------------------------------------------------

async function _loadScheduleModalData() {
  try {
    const agentsResult = await api('/api/agents');
    const sel = document.getElementById('schedule-subagent');
    sel.innerHTML = '<option value="">Create dedicated schedule agent</option>';
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
      const sid = job?.subagent_id || job?.subagentId || '';
      if (sid) {
        sel.value = sid;
        if (typeof window._updateHeartbeatMdPreview === 'function') window._updateHeartbeatMdPreview(sid);
      }
    }
  } catch {}

  try {
    const mcpResult = await api('/api/mcp/status');
    const box = document.getElementById('schedule-mcp-checkboxes');
    const servers = (mcpResult.servers || []).filter(s => s.status === 'connected');
    if (servers.length === 0) {
      box.innerHTML = '<span style="font-size:12px;color:var(--muted)">No connected MCP servers</span>';
    } else {
      box.innerHTML = '';
      for (const s of servers) {
        const label = document.createElement('label');
        label.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:12px;cursor:pointer';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = s.id;
        cb.id = `mcp-cb-${s.id}`;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(s.name || s.id));
        box.appendChild(label);
      }
    }
  } catch {
    document.getElementById('schedule-mcp-checkboxes').innerHTML = '<span style="font-size:12px;color:var(--muted)">MCP unavailable</span>';
  }
}

function _resetScheduleModalFields() {
  document.getElementById('schedule-name').value = '';
  document.getElementById('schedule-occurrence').value = 'manual';
  document.getElementById('schedule-time').value = '09:00';
  document.getElementById('schedule-pattern').value = '';
  document.getElementById('schedule-prompt').value = '';
  document.getElementById('schedule-timezone').value = 'UTC';
  document.getElementById('schedule-channel').value = 'web';
  document.getElementById('schedule-subagent').value = '';
  const hbPreview = document.getElementById('schedule-heartbeat-preview');
  if (hbPreview) hbPreview.style.display = 'none';
  document.getElementById('schedule-pattern-preview').style.display = 'none';
  document.getElementById('schedule-time-row').style.display = 'none';
  document.getElementById('schedule-custom-cron-row').style.display = 'none';
  document.querySelectorAll('#schedule-mcp-checkboxes input[type=checkbox]').forEach(cb => cb.checked = false);
  _scheduleRefLinks = [];
  _renderScheduleRefChips();
}

// --- MODAL: CREATE / EDIT ---------------------------------------------------

function openScheduleCreateModal() {
  editingScheduleId = null;
  document.getElementById('schedule-modal-title').textContent = 'Create Schedule';
  document.getElementById('schedule-save-btn').textContent = 'Create Schedule';
  _resetScheduleModalFields();
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
  document.getElementById('schedule-timezone').value = job.timezone || 'UTC';
  document.getElementById('schedule-channel').value = job.delivery_channel || 'web';
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
  const timezone = document.getElementById('schedule-timezone').value;
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
  const timezone  = document.getElementById('schedule-timezone').value;
  const channel   = document.getElementById('schedule-channel').value;
  const subagentId = document.getElementById('schedule-subagent').value.trim();
  const pattern   = _resolveSchedulePattern();
  const currentJob = editingScheduleId ? schedules.find(j => j.id === editingScheduleId) : null;
  const currentTeamId = String(currentJob?.team_id || '').trim();

  const mcpServers = Array.from(
    document.querySelectorAll('#schedule-mcp-checkboxes input[type=checkbox]:checked')
  ).map(cb => cb.value);

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
      delivery_channel: channel,
      confirm: true,
      ...(currentTeamId && !subagentId ? { team_id: currentTeamId } : {}),
      ...(subagentId    ? { subagent_id:      subagentId }    : {}),
      ...(mcpServers.length > 0 ? { mcp_servers: mcpServers } : {}),
      ...(_scheduleRefLinks.length > 0 ? { reference_links: _scheduleRefLinks } : {}),
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
    } else {
      showToast('Run failed', result.error || 'Failed to run', 'error');
    }
  } catch (err) {
    showToast('Run failed', err.message, 'error');
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
window.onScheduleOccurrenceChange = onScheduleOccurrenceChange;
window.addScheduleRefLink      = addScheduleRefLink;
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
  if (typeof window.addProcessEntry === 'function') window.addProcessEntry('info', `Task running: ${msg.jobName}`);
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
