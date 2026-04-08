/**
 * SchedulePage.js — F3c Extract
 *
 * Schedule management page: CRUD for cron jobs, pattern parsing, run history.
 *
 * Functions extracted verbatim from index.html:
 *   refreshSchedules, renderScheduleList, _resolveSchedulePattern,
 *   onScheduleOccurrenceChange, addScheduleRefLink, _renderScheduleRefChips,
 *   _loadScheduleModalData, _resetScheduleModalFields, openScheduleCreateModal,
 *   editSchedule, closeScheduleModal, parseSchedulePattern, saveSchedule,
 *   deleteSchedule, toggleSchedulePause, runScheduleNow
 *
 * Dependencies: api() from api.js, escHtml/showToast/showConfirm from utils.js
 * Cross-page: openAgentSettings, _updateHeartbeatMdPreview (window.* during migration)
 */

import { api } from '../api.js';
import { escHtml, showToast, showConfirm } from '../utils.js';
import { wsEventBus } from '../ws.js';

// --- SCHEDULER MANAGEMENT ---------------------------------------------------

let schedules = [];
let editingScheduleId = null;

async function refreshSchedules() {
  try {
    const result = await api('/api/schedules');
    if (result.success && Array.isArray(result.schedules)) {
      schedules = result.schedules;
      renderScheduleList();
    }
  } catch (err) {
    console.error('Failed to load schedules:', err);
  }
}

function renderScheduleList() {
  const list = document.getElementById('schedule-list');
  const count = document.getElementById('schedule-count');
  if (!list) return;

  if (schedules.length === 0) {
    list.innerHTML = '<div class="empty-state" style="text-align:center;color:var(--muted);padding:40px 20px">No schedules yet. <strong>+ New Schedule</strong> to get started.</div>';
    if (count) count.textContent = '0 schedules';
    return;
  }

  if (count) count.textContent = `${schedules.length} schedule${schedules.length !== 1 ? 's' : ''}`;

  list.innerHTML = schedules.map(job => {
    const nextRun = job.nextRun || job.next_run ? new Date(job.nextRun || job.next_run).toLocaleString() : 'Never';
    const lastRun = job.lastRun || job.last_run ? new Date(job.lastRun || job.last_run).toLocaleString() : 'Never';
    const statusClass = job.status === 'active' ? 'status-active' : job.status === 'paused' ? 'status-paused' : 'status-failed';
    const subagentId = job.subagent_id || job.subagentId || '';
    const agentName = subagentId ? (window._agentsCache && window._agentsCache[subagentId] ? window._agentsCache[subagentId] : subagentId) : '';
    
    return `
      <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;padding:12px;background:var(--panel);border:1px solid var(--line);border-radius:10px;cursor:pointer" onclick="editSchedule('${job.id}')">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <div style="font-weight:700;font-size:13px">${job.name || 'Untitled'}</div>
            <span class="${statusClass}" style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;${job.status === 'active' ? 'background:#c8f0c4;color:#0d5c2f' : job.status === 'paused' ? 'background:#fff4d6;color:#7d5700' : 'background:#ffd6d6;color:#8b0000'}">${job.status || 'unknown'}</span>
          </div>
          <div style="font-size:12px;color:var(--muted);line-height:1.4;margin-bottom:6px">${job.prompt ? job.prompt.slice(0, 60) + (job.prompt.length > 60 ? '...' : '') : 'No prompt'}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:11px;color:var(--muted);margin-bottom:6px">
            <div><strong>Next:</strong> ${nextRun}</div>
            <div><strong>Last:</strong> ${lastRun}</div>
          </div>
          <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;margin-top:2px">
            <strong>Assigned to:</strong>
            ${subagentId
              ? `<button onclick="event.stopPropagation(); openAgentSettings('${subagentId}')" title="Open agent settings" style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--brand,#6c8ebf);background:color-mix(in srgb,var(--brand,#6c8ebf) 10%,transparent);color:var(--brand,#6c8ebf);border-radius:999px;padding:2px 9px;font-size:10px;font-weight:700;cursor:pointer;font-family:monospace;white-space:nowrap">🤖 ${escHtml(subagentId)}</button>`
              : `<span style="font-size:10px;color:var(--muted);font-style:italic">Main agent (default)</span>`
            }
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          <button onclick="event.stopPropagation(); runScheduleNow('${job.id}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap" title="Run now">Run Now</button>
          <button onclick="event.stopPropagation(); toggleSchedulePause('${job.id}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap" title="Toggle pause">${job.status === 'active' ? 'Pause' : 'Resume'}</button>
          <button onclick="event.stopPropagation(); deleteSchedule('${job.id}')" style="border:1px solid #ff6b6b;background:#ffe0e0;color:#8b0000;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap" title="Delete">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

// Piece 6: state for reference links
let _scheduleRefLinks = [];

function _resolveSchedulePattern() {
  const occ = document.getElementById('schedule-occurrence').value;
  if (occ === 'manual') return null;
  if (occ === 'daily') {
    const t = document.getElementById('schedule-time').value || '09:00';
    const [hh, mm] = t.split(':');
    return `${parseInt(mm||0)} ${parseInt(hh||9)} * * *`;
  }
  if (occ === 'every48') {
    const t = document.getElementById('schedule-time').value || '09:00';
    const [hh, mm] = t.split(':');
    return `${parseInt(mm||0)} ${parseInt(hh||9)} */2 * *`;
  }
  if (occ === 'custom') {
    return document.getElementById('schedule-pattern').value.trim() || null;
  }
  return occ; // direct cron string
}

function onScheduleOccurrenceChange() {
  const occ = document.getElementById('schedule-occurrence').value;
  const needsTime = occ === 'daily' || occ === 'every48';
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
    btn.textContent = '?';
    btn.style.cssText = 'border:0;background:none;cursor:pointer;color:var(--muted);font-size:11px;padding:0;line-height:1';
    btn.onclick = () => { _scheduleRefLinks.splice(i,1); _renderScheduleRefChips(); };
    chip.appendChild(label);
    chip.appendChild(btn);
    container.appendChild(chip);
  });
}

async function _loadScheduleModalData() {
  // Load agents into subagent picker
  try {
    const agentsResult = await api('/api/agents');
    const sel = document.getElementById('schedule-subagent');
    sel.innerHTML = '<option value="">Main agent (default)</option>';
    // Build a name cache for schedule cards
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
    // Restore subagent_id if we're editing an existing job
    if (editingScheduleId) {
      const job = schedules.find(j => j.id === editingScheduleId);
      const sid = job?.subagent_id || job?.subagentId || '';
      if (sid) {
        sel.value = sid;
        _updateHeartbeatMdPreview(sid);
      }
    }
  } catch {}

  // Load MCP servers into checkboxes
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
  // Clear MCP checkboxes
  document.querySelectorAll('#schedule-mcp-checkboxes input[type=checkbox]').forEach(cb => cb.checked = false);
  // Clear ref links
  _scheduleRefLinks = [];
  _renderScheduleRefChips();
}

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
  // Restore occurrence from cron
  const cron = job.cron || job.run_at || '';
  const occSel = document.getElementById('schedule-occurrence');
  // Try to match a standard pattern
  const knownCrons = ['0 * * * *','0 */3 * * *','0 */6 * * *','0 */8 * * *','0 */12 * * *'];
  if (!cron) { occSel.value = 'manual'; }
  else if (knownCrons.includes(cron)) { occSel.value = cron; }
  else if (/^\d+ \d+ \* \* \*$/.test(cron)) {
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

async function parseSchedulePattern() {
  const pattern = document.getElementById('schedule-pattern').value.trim();
  const timezone = document.getElementById('schedule-timezone').value;
  if (!pattern) {
    alert('Enter a schedule pattern (e.g., "daily at 09:00" or "0 9 * * *")');
    return;
  }
  
  try {
    const result = await api('/api/schedules/parse', {
      method: 'POST',
      body: JSON.stringify({ text: pattern, timezone })
    });
    
    const preview = document.getElementById('schedule-pattern-preview');
    if (result.success) {
      preview.textContent = `? ${result.preview || result.human_text || 'Valid pattern'}`;
      preview.style.display = 'block';
      preview.style.color = 'var(--muted)';
    } else {
      preview.textContent = `? ${result.error || 'Invalid pattern'}`;
      preview.style.display = 'block';
      preview.style.color = '#ff6b6b';
    }
  } catch (err) {
    document.getElementById('schedule-pattern-preview').textContent = '? Parse failed';
    document.getElementById('schedule-pattern-preview').style.display = 'block';
    document.getElementById('schedule-pattern-preview').style.color = '#ff6b6b';
  }
}

async function saveSchedule() {
  const name = document.getElementById('schedule-name').value.trim();
  const prompt = document.getElementById('schedule-prompt').value.trim();
  const timezone = document.getElementById('schedule-timezone').value;
  const channel = document.getElementById('schedule-channel').value;
  const subagentId = document.getElementById('schedule-subagent').value.trim();

  // Piece 6: resolve cron pattern from occurrence picker
  const pattern = _resolveSchedulePattern();

  // Collect selected MCP servers
  const mcpServers = Array.from(
    document.querySelectorAll('#schedule-mcp-checkboxes input[type=checkbox]:checked')
  ).map(cb => cb.value);

  if (!name) { showToast('Name required', 'Schedule name is required', 'warning'); return; }
  if (!pattern && document.getElementById('schedule-occurrence').value !== 'manual') { showToast('Pattern required', 'Schedule pattern is required', 'warning'); return; }
  if (!prompt) { showToast('Prompt required', 'Prompt/action is required', 'warning'); return; }
  
  const method = editingScheduleId ? 'PUT' : 'POST';
  const apiPath = editingScheduleId ? `/api/schedules/${editingScheduleId}` : '/api/schedules';
  
  try {
    const body = {
      name,
      pattern: pattern || '0 9 * * *',  // fallback cron if manual
      prompt,
      timezone,
      delivery_channel: channel,
      confirm: true,
      ...(subagentId ? { subagent_id: subagentId } : {}),
      ...(mcpServers.length > 0 ? { mcp_servers: mcpServers } : {}),
      ...((_scheduleRefLinks.length > 0) ? { reference_links: _scheduleRefLinks } : {}),
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
  if (!await new Promise(r => showConfirm('Delete this schedule? This cannot be undone.', () => r(true), () => r(false), {title:'Delete Schedule', confirmText:'Delete', danger:true}))) return;
  
  try {
    const result = await api(`/api/schedules/${jobId}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true })
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

async function toggleSchedulePause(jobId) {
  const job = schedules.find(j => j.id === jobId);
  if (!job) return;
  
  const newStatus = job.status === 'active' ? 'paused' : 'active';
  
  try {
    const result = await api(`/api/schedules/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
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

async function runScheduleNow(jobId) {
  try {
    const result = await api(`/api/schedules/${jobId}/run`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    
    if (result.success) {
      await refreshSchedules();
      showToast('Schedule running now', job.name || '', 'success');
    } else {
      showToast('Run failed', result.error || 'Failed to run', 'error');
    }
  } catch (err) {
    showToast('Run failed', err.message, 'error');
  }
}

// ─── Expose on window for HTML onclick handlers ────────────────
window.refreshSchedules = refreshSchedules;
window.renderScheduleList = renderScheduleList;
window.openScheduleCreateModal = openScheduleCreateModal;
window.editSchedule = editSchedule;
window.closeScheduleModal = closeScheduleModal;
window.parseSchedulePattern = parseSchedulePattern;
window.saveSchedule = saveSchedule;
window.deleteSchedule = deleteSchedule;
window.toggleSchedulePause = toggleSchedulePause;
window.runScheduleNow = runScheduleNow;
window.onScheduleOccurrenceChange = onScheduleOccurrenceChange;
window.addScheduleRefLink = addScheduleRefLink;

// ─── WS Event Handlers (F5) ────────────────────────────────────
wsEventBus.on('jobs_update', (msg) => {
  window.allJobs = msg.jobs;
  if (typeof window.updateStats === 'function') window.updateStats([]);
  if (window.selectedJobId && typeof window.refreshJobDetail === 'function') window.refreshJobDetail(window.selectedJobId);
});
wsEventBus.on('job_created', (msg) => {
  if (typeof window.log === 'function') window.log(`Job created: ${msg.jobId}`, 'info');
});
wsEventBus.on('tasks_update', (msg) => {
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
    if (typeof window.bgtToast === 'function') window.bgtToast('\uD83D\uDD50 Scheduled task done', `"${msg.jobName}" \u2014 results in sidebar`);
    if (typeof window.addProcessEntry === 'function') window.addProcessEntry('info', `Task "${msg.jobName}" completed \u2014 check sidebar for results`);
  } else if (msg.isOk) {
    if (typeof window.addProcessEntry === 'function') window.addProcessEntry('info', `Task "${msg.jobName}" \u2014 OK (nothing to report)`);
  }
});
