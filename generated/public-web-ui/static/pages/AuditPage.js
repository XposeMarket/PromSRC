import { api } from '../api.js';
import { escHtml } from '../utils.js';

let _auditEntries = [];
let _auditOffset = 0;
const AUDIT_PAGE_SIZE = 100;
const _expandedRuns = new Set();
let _proposalStats = { approved: 0, rejected: 0, pending: 0 };

function inferRunKind(sessionId, agentId) {
  const sid = String(sessionId || '');
  const aid = String(agentId || '');
  if (sid.startsWith('team_dispatch_')) return 'Team Dispatch';
  if (sid.startsWith('team_coord_')) return 'Team Coordinator';
  if (sid.startsWith('meta_coordinator_')) return 'Meta Coordinator';
  if (sid.startsWith('proposal_')) return 'Proposal Executor';
  if (sid.startsWith('cron_job_') || sid.startsWith('schedule_')) return 'Scheduled Task';
  if (sid.startsWith('task_') || sid.startsWith('bg_')) return 'Background Task';
  if (aid === 'scheduled_task') return 'Scheduled Task';
  if (aid === 'background_task') return 'Background Task';
  if (aid === 'team_coordinator') return 'Team Coordinator';
  if (aid === 'meta_coordinator') return 'Meta Coordinator';
  return 'Agent Run';
}

function deriveAgentName(agentId, sessionId) {
  const aid = String(agentId || '').trim();
  if (aid && aid.toLowerCase() !== 'unknown' && aid.toLowerCase() !== 'main') return aid;
  const sid = String(sessionId || '');
  if (sid.startsWith('team_dispatch_')) return sid.replace(/^team_dispatch_/, '').replace(/_\d+$/, '');
  if (sid.startsWith('team_coord_')) return sid.replace(/^team_coord_/, '');
  if (sid.startsWith('meta_coordinator_')) return sid.replace(/^meta_coordinator_/, '');
  if (sid.startsWith('task_') || sid.startsWith('bg_')) return 'background_task';
  if (sid.startsWith('cron_job_') || sid.startsWith('schedule_')) return 'scheduled_task';
  if (sid.startsWith('proposal_')) return 'proposal_executor';
  return sid || 'unknown';
}

function classifyToolAction(toolName, actionType) {
  const t = String(toolName || '').toLowerCase();
  const a = String(actionType || '').toLowerCase();
  if (a === 'approval_requested' || a === 'approval_resolved' || t.includes('proposal')) return 'proposal';
  if (t.includes('delete') || t.includes('remove')) return 'delete';
  if (t === 'run_command' || t === 'shell' || t.includes('command')) return 'command';
  if (t.includes('click') || t.includes('press_key')) return 'click';
  if (t.includes('type') || t.includes('fill')) return 'type';
  if (
    t.includes('read') || t.includes('list') || t.includes('search') || t.includes('grep')
    || t.includes('fetch') || t.includes('snapshot') || t.includes('stats') || t.includes('browse')
  ) return 'read';
  if (
    t.includes('create') || t.includes('write') || t.includes('replace') || t.includes('insert')
    || t.includes('edit') || t.includes('append') || t.includes('mkdir') || t.includes('rename') || t.includes('copy')
  ) return 'edit';
  return 'other';
}

function getRunKey(entry) {
  const sid = String(entry.sessionId || '').trim();
  if (sid) return sid;
  const aid = deriveAgentName(entry.agentId, entry.sessionId);
  return `${aid}:${String(entry.timestamp || '').slice(0, 13)}`;
}

function buildRunRows(entries) {
  const rows = new Map();
  for (const e of entries) {
    const key = getRunKey(e);
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        sessionId: String(e.sessionId || ''),
        agentId: deriveAgentName(e.agentId, e.sessionId),
        kind: inferRunKind(e.sessionId, e.agentId),
        startedAt: e.timestamp,
        endedAt: e.timestamp,
        tools: [],
      });
    }
    const run = rows.get(key);
    run.tools.push(e);
    if (e.timestamp < run.startedAt) run.startedAt = e.timestamp;
    if (e.timestamp > run.endedAt) run.endedAt = e.timestamp;
  }
  return Array.from(rows.values()).sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)));
}

function computeRunStatus(tools) {
  let pending = 0;
  let rejected = 0;
  let approved = 0;
  for (const t of tools) {
    const s = String(t.approvalStatus || '').toLowerCase();
    if (s === 'pending') pending++;
    else if (s === 'rejected') rejected++;
    else if (s === 'approved') approved++;
  }
  if (rejected > 0) return 'rejected';
  if (pending > 0) return 'pending';
  if (approved > 0) return 'approved';
  return 'auto';
}

function nonMainEntry(e) {
  const aid = String(e.agentId || '').toLowerCase();
  if (aid && aid !== 'main' && aid !== 'unknown') return true;
  const sid = String(e.sessionId || '');
  return sid.startsWith('team_') || sid.startsWith('task_') || sid.startsWith('bg_') || sid.startsWith('proposal_') || sid.startsWith('cron_') || sid.startsWith('schedule_') || sid.startsWith('meta_');
}

export async function loadAuditLog() {
  const tbody = document.getElementById('audit-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--muted)">Loading...</td></tr>';
  try {
    const tool = document.getElementById('audit-filter-tool')?.value?.trim() || '';
    const params = new URLSearchParams({
      limit: String(AUDIT_PAGE_SIZE),
      offset: String(_auditOffset),
      nonMainOnly: '1',
    });
    if (tool) params.set('toolName', tool);

    const [auditData, proposalsData] = await Promise.all([
      api('/api/audit-log?' + params.toString()),
      api('/api/proposals?status=all').catch(() => ({ proposals: [] })),
    ]);
    _auditEntries = Array.isArray(auditData.entries) ? auditData.entries : [];

    const proposals = Array.isArray(proposalsData.proposals) ? proposalsData.proposals : [];
    _proposalStats = {
      approved: proposals.filter((p) => p.status === 'approved' || p.status === 'executed').length,
      rejected: proposals.filter((p) => p.status === 'denied' || p.status === 'failed').length,
      pending: proposals.filter((p) => p.status === 'pending' || p.status === 'executing').length,
    };

    renderAuditTable();
    renderAuditStats(auditData);
    renderAuditPagination(auditData);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--err)">${escHtml(e.message || 'Failed to load audit log')}</td></tr>`;
  }
}

function renderAuditTable() {
  const tbody = document.getElementById('audit-table-body');
  if (!tbody) return;

  const toolFilter = (document.getElementById('audit-filter-tool')?.value || '').toLowerCase().trim();
  const actionFilter = (document.getElementById('audit-filter-tier')?.value || '').toLowerCase().trim();
  const statusFilter = (document.getElementById('audit-filter-status')?.value || '').toLowerCase().trim();

  const runs = buildRunRows(_auditEntries.filter(nonMainEntry)).filter((run) => {
    if (toolFilter) {
      const hit = run.tools.some((t) => String(t.toolName || '').toLowerCase().includes(toolFilter));
      if (!hit && !String(run.agentId || '').toLowerCase().includes(toolFilter)) return false;
    }
    if (actionFilter) {
      if (!run.tools.some((t) => classifyToolAction(t.toolName, t.actionType) === actionFilter)) return false;
    }
    if (statusFilter) {
      if (computeRunStatus(run.tools) !== statusFilter) return false;
    }
    return true;
  });

  if (!runs.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--muted)">No non-main agent runs match the current filters</td></tr>';
    return;
  }

  const statusStyle = {
    auto: 'background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe',
    approved: 'background:#f0fdf4;color:#166534;border:1px solid #86efac',
    rejected: 'background:#fff1f2;color:#991b1b;border:1px solid #fca5a5',
    pending: 'background:#fffbeb;color:#92400e;border:1px solid #fcd34d',
  };
  const actionStyle = {
    read: 'background:#f0fdf4;color:#166534;border:1px solid #86efac',
    edit: 'background:#fff7ed;color:#9a3412;border:1px solid #fdba74',
    delete: 'background:#fff1f2;color:#991b1b;border:1px solid #fca5a5',
    type: 'background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe',
    click: 'background:#ecfeff;color:#155e75;border:1px solid #a5f3fc',
    command: 'background:#f5f3ff;color:#5b21b6;border:1px solid #c4b5fd',
    proposal: 'background:#fef3c7;color:#92400e;border:1px solid #fcd34d',
    other: 'background:var(--panel-2);color:var(--muted);border:1px solid var(--line)',
  };

  const html = [];
  for (const run of runs) {
    const ended = new Date(run.endedAt);
    const timeStr = ended.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = ended.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const runStatus = computeRunStatus(run.tools);
    const style = statusStyle[runStatus] || actionStyle.other;
    const isExpanded = _expandedRuns.has(run.key);
    const rowKey = escHtml(run.key).replace(/['"]/g, '');
    const toolsCount = run.tools.length;
    const topTools = Object.entries(run.tools.reduce((acc, t) => {
      const key = String(t.toolName || 'unknown');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => `${x[0]} (${x[1]})`).join(', ');

    html.push(`<tr style="border-bottom:1px solid var(--line);cursor:pointer" onclick="toggleAuditRow('${rowKey}')" title="Click to expand run tools">
      <td style="padding:7px 12px;white-space:nowrap;color:var(--muted)">
        <div>${escHtml(timeStr)}</div>
        <div style="font-size:9px;opacity:0.7">${escHtml(dateStr)}</div>
      </td>
      <td style="padding:7px 12px;font-size:11px;color:var(--text);max-width:240px">
        <div style="font-weight:700">${escHtml(run.agentId || 'unknown')}</div>
        <div style="font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(run.kind)} • ${escHtml(run.sessionId || run.key)}</div>
      </td>
      <td style="padding:7px 12px;white-space:nowrap">
        <span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:999px;text-transform:uppercase;letter-spacing:0.05em;${style}">${escHtml(runStatus)}</span>
      </td>
      <td style="padding:7px 12px;font-size:11px;color:var(--muted)">${toolsCount} tool${toolsCount === 1 ? '' : 's'}</td>
      <td style="padding:7px 12px;font-size:11px;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(run.kind)}</td>
      <td style="padding:7px 12px;font-size:11px;color:var(--muted);max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(topTools || 'No tool names')}</td>
    </tr>`);

    if (isExpanded) {
      const details = run.tools.slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).map((t) => {
        const action = classifyToolAction(t.toolName, t.actionType);
        const badgeStyle = actionStyle[action] || actionStyle.other;
        const ts = new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const args = t.toolArgs ? escHtml(JSON.stringify(t.toolArgs).slice(0, 140)) : '';
        const result = escHtml(t.error || t.resultSummary || '—');
        return `<div style="display:grid;grid-template-columns:80px 190px 78px 1fr;gap:10px;padding:6px 8px;border-bottom:1px solid var(--line);font-size:11px">
          <div style="color:var(--muted)">${escHtml(ts)}</div>
          <div style="font-family:'IBM Plex Mono',monospace">
            <div style="color:var(--text)">${escHtml(t.toolName || 'unknown')}</div>
            ${args ? `<div style="color:var(--muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${args}</div>` : ''}
          </div>
          <div><span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:999px;text-transform:uppercase;letter-spacing:0.05em;${badgeStyle}">${escHtml(action)}</span></div>
          <div style="color:${t.error ? 'var(--err)' : 'var(--muted)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${result}</div>
        </div>`;
      }).join('');
      html.push(`<tr><td colspan="6" style="padding:0;background:var(--panel-2)"><div style="padding:6px 0">${details}</div></td></tr>`);
    }
  }

  tbody.innerHTML = html.join('');
}

export function toggleAuditRow(key) {
  if (_expandedRuns.has(key)) _expandedRuns.delete(key);
  else _expandedRuns.add(key);
  renderAuditTable();
}

function renderAuditStats(data) {
  const bar = document.getElementById('audit-stats-bar');
  if (!bar) return;
  const entries = _auditEntries.filter(nonMainEntry);
  const counts = { read: 0, edit: 0, delete: 0, type: 0, click: 0, command: 0, proposal: 0 };
  entries.forEach((e) => {
    const action = classifyToolAction(e.toolName, e.actionType);
    if (counts[action] !== undefined) counts[action]++;
  });
  const stats = [
    { label: 'Total', val: data.total || entries.length, color: 'var(--muted)' },
    { label: 'Read', val: counts.read, color: '#16a34a' },
    { label: 'Edit', val: counts.edit, color: '#d97706' },
    { label: 'Delete', val: counts.delete, color: '#dc2626' },
    { label: 'Type', val: counts.type, color: '#3730a3' },
    { label: 'Click', val: counts.click, color: '#0e7490' },
    { label: 'Cmd', val: counts.command, color: '#7c3aed' },
    { label: 'Proposal', val: counts.proposal, color: '#92400e' },
    { label: 'Approved', val: _proposalStats.approved, color: '#16a34a' },
    { label: 'Rejected', val: _proposalStats.rejected, color: '#dc2626' },
    { label: 'Pending', val: _proposalStats.pending, color: '#d97706' },
  ];
  bar.innerHTML = stats.map((s) => `
    <div style="background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 12px;display:flex;flex-direction:column;align-items:center;min-width:60px">
      <span style="font-size:16px;font-weight:800;color:${s.color}">${s.val}</span>
      <span style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.04em">${s.label}</span>
    </div>`).join('');
}

function renderAuditPagination(data) {
  const pg = document.getElementById('audit-pagination');
  if (!pg) return;
  const total = data.total || 0;
  const hasMore = data.hasMore || false;
  const start = total === 0 ? 0 : _auditOffset + 1;
  const end = total === 0 ? 0 : Math.min(_auditOffset + AUDIT_PAGE_SIZE, total);
  pg.innerHTML = `
    <span>${start}-${end} of ${total} entries</span>
    <div style="display:flex;gap:6px">
      <button onclick="auditPage(-1)" ${_auditOffset === 0 ? 'disabled' : ''} style="border:1px solid var(--line);background:var(--panel);border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px;color:var(--text)">← Prev</button>
      <button onclick="auditPage(1)" ${!hasMore ? 'disabled' : ''} style="border:1px solid var(--line);background:var(--panel);border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px;color:var(--text)">Next →</button>
    </div>`;
}

export function auditPage(dir) {
  _auditOffset = Math.max(0, _auditOffset + dir * AUDIT_PAGE_SIZE);
  loadAuditLog();
}

window.loadAuditLog = loadAuditLog;
window.renderAuditTable = renderAuditTable;
window.toggleAuditRow = toggleAuditRow;
window.auditPage = auditPage;
