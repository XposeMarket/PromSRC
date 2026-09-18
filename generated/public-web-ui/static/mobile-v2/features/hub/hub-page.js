import { escapeHtml, loading, errorState, pageHeading, card, asTime } from '../../ui/page-kit.js';
import { getAccount } from '../../../auth/account.js';

const HUB_REFRESH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5M20 12a8 8 0 1 0 2 5"/></svg>';

function compactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  if (Math.abs(number) >= 1_000_000_000) return `${Math.round(number / 100_000_000) / 10}B`;
  if (Math.abs(number) >= 1_000_000) return `${Math.round(number / 100_000) / 10}M`;
  if (Math.abs(number) >= 1_000) return `${Math.round(number / 100) / 10}K`;
  return Math.round(number).toLocaleString();
}

function hubAccount() {
  let account = null;
  try {
    account = getAccount?.() || null;
  } catch {}
  const email = String(account?.email || account?.user?.email || '').trim();
  const rawName = String(account?.name || account?.displayName || account?.user?.name || email.split('@')[0] || 'Prometheus').trim();
  const name = rawName.replace(/^@/, '') || 'Prometheus';
  const handle = email ? email.split('@')[0] : name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return { name, handle: handle ? `@${handle}` : '@local' };
}

function initials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const value = parts.length >= 2 ? `${parts[0][0] || ''}${parts[1][0] || ''}` : String(name || 'P').slice(0, 2);
  return value.toUpperCase() || 'PM';
}

function latestGoalSection(goal) {
  const title = goal ? String(goal.title || goal.goal || goal.userRequest || goal.summary || goal.id || 'Latest goal').trim() : 'No goals yet';
  const body = goal
    ? String(goal.summary || goal.result || goal.assistantSummary || goal.description || goal.lastAssistantMessage || goal.status || 'In progress').trim()
    : 'Main chat goals will appear here once Prometheus records them.';
  const updatedAt = goal?.updatedAt || goal?.completedAt || goal?.createdAt;
  const timestamp = updatedAt && Number.isFinite(Date.parse(updatedAt))
    ? new Date(updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  return `<section class="pm-hub-profile-section" id="pm-hub-latest-goal"><div class="pm-hub-section-head"><strong>Latest goal</strong><span>${escapeHtml(timestamp)}</span></div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></section>`;
}

function tokenActivityFrom(modelPayload) {
  const rows = Array.isArray(modelPayload?.daily) ? modelPayload.daily : [];
  const tokensByDate = new Map(rows.map((row) => [String(row?.date || ''), Math.max(0, Number(row?.tokens ?? row?.count ?? 0))]));
  const start = new Date();
  start.setMonth(start.getMonth() - 6);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daily = [];
  for (const day = new Date(start); day <= today; day.setDate(day.getDate() + 1)) {
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const tokens = tokensByDate.get(date) || 0;
    daily.push({ date, tokens });
  }
  const stats = modelPayload?.stats || {};
  return {
    daily,
    stats: {
      ...stats,
      totalTokens: Number(stats.totalTokens || stats.total || 0),
      peakTokens: daily.reduce((peak, row) => Math.max(peak, row.tokens), 0),
      activeDays: Number(stats.activeDays || daily.filter((row) => row.tokens > 0).length),
    },
  };
}

function tokenOpacity(value, max) {
  const amount = Math.max(0, Number(value) || 0);
  if (!amount) return 0;
  return Math.min(1, 0.12 + (0.88 * Math.sqrt(amount / Math.max(1, Number(max) || 1))));
}

function tokenActivityGrid(activity = {}) {
  const daily = Array.isArray(activity.daily) ? activity.daily : [];
  if (!daily.length) return '<div class="pm-hub-token-empty">No token activity recorded yet.</div>';
  const first = new Date(`${daily[0].date}T00:00:00`);
  const leading = Number.isFinite(first.getTime()) ? first.getDay() : 0;
  const values = daily.map((row) => Math.max(0, Number(row.tokens || row.count || 0)));
  const max = Math.max(1, ...values);
  const weeks = Math.ceil((leading + daily.length) / 7);
  const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day) => `<span>${day}</span>`).join('');
  let cells = '';
  for (let index = 0; index < leading; index += 1) cells += '<i class="empty"></i>';
  daily.forEach((row) => {
    const tokens = Math.max(0, Number(row.tokens || row.count || 0));
    const title = `${row.date}: ${compactNumber(tokens)} tokens`;
    const active = tokens > 0 ? 'true' : 'false';
    const opacity = tokenOpacity(tokens, max).toFixed(3);
    cells += `<i class="pm-hub-token-cell" data-date="${escapeHtml(row.date)}" data-tokens="${tokens}" data-active="${active}" style="--pm-token-alpha:${opacity}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"></i>`;
  });
  const months = [];
  const seen = new Set();
  daily.forEach((row, index) => {
    const [year, month] = String(row.date || '').split('-');
    const key = `${year}-${month}`;
    if (!year || !month || seen.has(key)) return;
    seen.add(key);
    const date = new Date(`${row.date}T00:00:00`);
    months.push(`<span style="grid-column:${Math.floor((leading + index) / 7) + 1}">${escapeHtml(date.toLocaleDateString(undefined, { month: 'short' }))}</span>`);
  });
  return `<div class="pm-hub-token-calendar" style="--pm-token-weeks:${weeks}"><div class="pm-hub-token-labels">${labels}</div><div class="pm-hub-token-grid-wrap"><div class="pm-hub-token-months">${months.join('')}</div><div class="pm-hub-token-cells">${cells}</div></div></div>`;
}

function showTokenPopover(cell) {
  const date = String(cell?.dataset?.date || '');
  if (!date) return;
  document.getElementById('pm-token-activity-popover')?.remove();
  const popover = document.createElement('div');
  popover.id = 'pm-token-activity-popover';
  popover.className = 'pm-token-activity-popover';
  const formattedDate = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  popover.innerHTML = `<strong>${escapeHtml(formattedDate)}</strong><span>${escapeHtml(compactNumber(cell.dataset.tokens))} tokens</span>`;
  document.body.appendChild(popover);
  const rect = cell.getBoundingClientRect();
  const margin = 8;
  const width = popover.offsetWidth || 164;
  const height = popover.offsetHeight || 52;
  const left = Math.max(margin, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - margin));
  let top = rect.top - height - margin;
  if (top < margin) top = rect.bottom + margin;
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`;
}

function wireTokenActivity(scope) {
  let dismissTimer = null;
  const dismiss = () => {
    clearTimeout(dismissTimer);
    dismissTimer = null;
    document.getElementById('pm-token-activity-popover')?.remove();
  };
  scope.querySelectorAll('.pm-hub-token-cell[data-date]').forEach((cell) => {
    cell.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      clearTimeout(dismissTimer);
      showTokenPopover(cell);
      if (event.pointerType !== 'mouse') dismissTimer = setTimeout(dismiss, 1100);
    });
    cell.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') showTokenPopover(cell);
    });
    cell.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') dismiss();
    });
  });
}

function wireDetailHeader(shell, refresh) {
  const refreshIcon = `<button type="button" class="pm-icon-btn" data-action="hub-refresh" aria-label="Refresh" title="Refresh">${HUB_REFRESH_ICON}</button>`;
  shell.renderHeader?.({ leftIcon: 'back', rightActions: refreshIcon });
  const header = document.querySelector('#pm-v2-header-slot');
  const back = header?.querySelector('[data-v2-header-left]');
  const refreshButton = header?.querySelector('[data-action="hub-refresh"]');
  const onBack = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    shell.navigate?.('more');
  };
  back?.addEventListener('click', onBack, true);
  refreshButton?.addEventListener('click', refresh);
  return () => {
    back?.removeEventListener('click', onBack, true);
    refreshButton?.removeEventListener('click', refresh);
  };
}

function auditAction(toolName, actionType) {
  const tool = String(toolName || '').toLowerCase();
  const action = String(actionType || '').toLowerCase();
  if (action.includes('proposal') || tool.includes('proposal')) return 'proposal';
  if (/delete|remove/.test(tool)) return 'delete';
  if (/type|fill/.test(tool)) return 'type';
  if (/click|press/.test(tool)) return 'click';
  if (/command/.test(tool) || tool === 'shell') return 'cmd';
  if (/write|edit|create|append/.test(tool)) return 'edit';
  if (/read|list|search|stat|grep/.test(tool)) return 'read';
  return 'other';
}

function auditRunKind(entry) {
  const session = String(entry?.sessionId || '');
  const agent = String(entry?.agentId || '');
  if (session.startsWith('brain_dream_')) return 'Brain Dream';
  if (session.startsWith('brain_thought_')) return 'Brain Thought';
  if (session.startsWith('brain_')) return 'Brain Run';
  if (session.startsWith('team_dispatch_')) return `Subagent: ${titleCaseAuditRun(session.replace(/^team_dispatch_/, '').replace(/_\d+$/, ''))}`;
  if (session.startsWith('team_coord_')) return `${titleCaseAuditRun(session.replace(/^team_coord_/, '').replace(/_\d+$/, ''))} Team Manager`;
  if (session.startsWith('meta_coordinator_')) return `${titleCaseAuditRun(session.replace(/^meta_coordinator_/, '').replace(/_\d+$/, ''))} Meta Coordinator`;
  if (session.startsWith('proposal_')) return 'Proposal';
  if (/^(cron_job_|schedule_)/.test(session) || agent === 'scheduled_task') return 'Scheduled Task';
  if (/^(task_|bg_)/.test(session) || agent === 'background_task') return 'Background Task';
  if (agent === 'team_coordinator') return 'Team Manager';
  if (agent === 'meta_coordinator') return 'Meta Coordinator';
  return 'Agent Run';
}

function titleCaseAuditRun(value) {
  return String(value || 'Agent Run').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function auditAgent(entry) {
  const agent = String(entry?.agentId || '').trim();
  if (agent && !['main', 'unknown'].includes(agent.toLowerCase())) return agent;
  const session = String(entry?.sessionId || '').trim();
  if (/^team_dispatch_/.test(session)) return session.replace(/^team_dispatch_/, '').replace(/_\d+$/, '');
  if (/^team_coord_/.test(session)) return session.replace(/^team_coord_/, '').replace(/_\d+$/, '');
  if (/^meta_coordinator_/.test(session)) return session.replace(/^meta_coordinator_/, '').replace(/_\d+$/, '');
  if (session.startsWith('proposal_')) return 'proposal_executor';
  if (/^(cron_job_|schedule_)/.test(session)) return 'scheduled_task';
  if (/^(task_|bg_)/.test(session)) return 'background_task';
  return agent || session || 'agent';
}

function groupedAuditRuns(response) {
  const suppliedRuns = Array.isArray(response?.runs) ? response.runs : [];
  if (suppliedRuns.some((run) => Array.isArray(run?.tools))) return suppliedRuns;
  const entries = Array.isArray(response?.entries) ? response.entries
    : Array.isArray(response?.items) ? response.items : suppliedRuns;
  const grouped = new Map();
  entries.forEach((entry) => {
    const agent = String(entry?.agentId || '').toLowerCase();
    const session = String(entry?.sessionId || '');
    if ((agent === 'main' || agent === 'unknown' || !agent) && !/^(team_|task_|bg_|proposal_|cron_|schedule_|meta_)/i.test(session)) return;
    const key = session || `${auditAgent(entry)}:${String(entry?.timestamp || '').slice(0, 13)}`;
    if (!grouped.has(key)) grouped.set(key, {
      key,
      sessionId: session,
      agentId: auditAgent(entry),
      kind: auditRunKind(entry),
      startedAt: entry?.timestamp || '',
      endedAt: entry?.timestamp || '',
      tools: [],
    });
    const run = grouped.get(key);
    run.tools.push(entry);
    if (entry?.timestamp && (!run.startedAt || entry.timestamp < run.startedAt)) run.startedAt = entry.timestamp;
    if (entry?.timestamp && (!run.endedAt || entry.timestamp > run.endedAt)) run.endedAt = entry.timestamp;
  });
  return [...grouped.values()].map((run) => ({
    ...run,
    status: run.tools.some((tool) => String(tool.approvalStatus || '').toLowerCase() === 'pending') ? 'running'
      : run.tools.some((tool) => String(tool.approvalStatus || '').toLowerCase() === 'rejected' || tool.error) ? 'failed' : 'complete',
  })).sort((a, b) => Date.parse(b.endedAt || 0) - Date.parse(a.endedAt || 0));
}

function auditStats(runs) {
  const stats = { total: 0, read: 0, edit: 0, delete: 0, type: 0, click: 0, cmd: 0, proposal: 0, approved: 0, rejected: 0, pending: 0 };
  runs.forEach((run) => (run.tools || []).forEach((tool) => {
    stats.total += 1;
    const action = auditAction(tool.toolName || tool.name, tool.actionType || tool.action);
    if (stats[action] !== undefined) stats[action] += 1;
    const approval = String(tool.approvalStatus || '').toLowerCase();
    if (approval === 'approved') stats.approved += 1;
    else if (approval === 'rejected') stats.rejected += 1;
    else if (approval === 'pending') stats.pending += 1;
  }));
  return stats;
}

function auditStatusPill(status) {
  const value = String(status || '').toLowerCase();
  if (['running', 'pending', 'executing'].includes(value)) return '<span class="pm-pill running">running</span>';
  if (['failed', 'rejected', 'denied'].includes(value)) return '<span class="pm-pill orange">failed</span>';
  if (['complete', 'completed', 'done', 'approved', 'auto'].includes(value)) return '<span class="pm-pill active">complete</span>';
  return `<span class="pm-pill gray">${escapeHtml(value || 'unknown')}</span>`;
}

function topAuditTools(tools, limit = 3) {
  const counts = new Map();
  tools.forEach((tool) => {
    const name = String(tool.toolName || tool.name || 'tool');
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function mountAuditPage({ shell, features }) {
  shell.setActiveTab('chat');
  shell.setTitle('Audit');
  const page = shell.page;
  let disposed = false;
  let runs = [];
  let expanded = '';
  let query = '';
  let loadGeneration = 0;
  page.innerHTML = `<div class="pm-v2-page-scroll pm-v2-audit-page"><div id="pm-v2-audit-content">${loading('Loading audit…')}</div></div>`;

  function paint() {
    const stats = auditStats(runs);
    const labels = [['total', stats.total], ['read', stats.read], ['edit', stats.edit], ['delete', stats.delete], ['type', stats.type], ['click', stats.click], ['cmd', stats.cmd], ['proposal', stats.proposal], ['approved', stats.approved], ['rejected', stats.rejected], ['pending', stats.pending]];
    page.querySelector('#pm-v2-audit-content').innerHTML = `<div class="pm-audit-filter-row"><label aria-label="Filter audit activity"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4 4"/></svg><input id="pm-audit-search" type="search" placeholder="Filter by tool or activity..." value="${escapeHtml(query)}" /></label><button type="button" id="pm-audit-clear" aria-label="Refresh audit">${HUB_REFRESH_ICON}</button></div>
      <div class="pm-audit-stat-grid">${labels.map(([label, value]) => `<span class="${label}"><b>${escapeHtml(compactNumber(value))}</b><em>${escapeHtml(label.toUpperCase())}</em></span>`).join('')}</div>
      ${runs.length ? `<div class="pm-audit-run-list">${runs.slice(0, 80).map((run) => {
        const key = String(run.key || run.sessionId || run.startedAt || 'run');
        const isOpen = expanded === key;
        const tools = Array.isArray(run.tools) ? run.tools.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))) : [];
        const topTools = topAuditTools(tools);
        const started = run.endedAt || run.startedAt;
        const date = started && Number.isFinite(Date.parse(started)) ? new Date(started) : null;
        return `<article class="pm-card pm-audit-run-card" data-run-key="${escapeHtml(key)}"><div class="pm-audit-run-top"><span><strong>${escapeHtml(date ? date.toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Unknown date')}</strong><em>${escapeHtml(date ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '')}</em></span><span><strong>${escapeHtml(run.kind || 'Agent Run')}</strong><em>${escapeHtml(run.agentId || 'agent')}</em></span>${auditStatusPill(run.status)}</div><p>${tools.length} tools · Top activity: ${escapeHtml(topTools.map(([name, count]) => `${name} (${count})`).join(', ') || 'none')}</p><div class="pm-more-meta-row"><span>${escapeHtml(run.sessionId || key)}</span><span>${isOpen ? 'Collapse' : 'Open'}</span></div>${isOpen ? `<div class="pm-audit-tool-stream">${tools.map((tool) => {
          const name = tool.toolName || tool.name || 'tool';
          const action = tool.actionType || tool.action || 'event';
          const stamp = tool.timestamp && Number.isFinite(Date.parse(tool.timestamp)) ? asTime(tool.timestamp) : '';
          const actionLabel = auditAction(name, action).toUpperCase();
          return `<div><b>${escapeHtml(name)}</b><em>${escapeHtml(action)}${stamp ? ` · ${escapeHtml(stamp)}` : ''}</em><span>${escapeHtml(actionLabel)}</span>${tool.approvalStatus ? `<small>${escapeHtml(tool.approvalStatus)}</small>` : ''}${tool.error ? `<p>${escapeHtml(String(tool.error).slice(0, 240))}</p>` : ''}</div>`;
        }).join('')}</div>` : ''}</article>`;
      }).join('')}</div><div class="pm-empty" data-audit-no-match hidden><h2>No matching activity</h2><p>Try another search.</p></div>` : `<div class="pm-empty"><div class="pm-empty-icon">${HUB_REFRESH_ICON}</div><h2>No agent runs yet</h2><p>Non-main agent activity will show up here.</p></div>`}`;
    const search = page.querySelector('#pm-audit-search');
    const applySearch = () => {
      query = String(search?.value || '').trim().toLowerCase();
      let visibleCount = 0;
      page.querySelectorAll('.pm-audit-run-card').forEach((runCard) => {
        const visible = !query || runCard.textContent.toLowerCase().includes(query);
        runCard.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      const noMatch = page.querySelector('[data-audit-no-match]');
      if (noMatch) noMatch.hidden = visibleCount > 0;
    };
    search?.addEventListener('input', applySearch);
    applySearch();
    page.querySelector('#pm-audit-clear')?.addEventListener('click', load);
    page.querySelectorAll('[data-run-key]').forEach((card) => card.addEventListener('click', () => {
      const key = card.dataset.runKey || '';
      expanded = expanded === key ? '' : key;
      paint();
    }));
  }

  async function load() {
    const generation = ++loadGeneration;
    const host = page.querySelector('#pm-v2-audit-content');
    if (host) host.innerHTML = loading('Loading audit…');
    try {
      const response = await features.audit(200);
      if (disposed || generation !== loadGeneration) return;
      runs = groupedAuditRuns(response);
      paint();
    } catch (error) {
      if (disposed || generation !== loadGeneration) return;
      page.querySelector('#pm-v2-audit-content').innerHTML = errorState(error).replace('data-v2-retry', 'data-audit-retry');
      page.querySelector('[data-audit-retry]')?.addEventListener('click', load);
    }
  }

  const disposeHeader = wireDetailHeader(shell, load);
  load();
  return () => { disposed = true; disposeHeader(); };
}

const MEMORY_SETTINGS_KEY = 'pm_mobile_v2_memory_graph_settings';
const MEMORY_COLORS = ['#69d5e8', '#ffbd72', '#a78bfa', '#78b9ff', '#ee8ecb', '#84d29b', '#ff8a7a'];
const MEMORY_DEFAULT_LAYOUT_KEY = 'prometheus-memory-default-layout';
const MEMORY_LEGACY_DEFAULT_SHAPE_KEY = 'prometheus-memory-default-shape';

function memoryHash(value) {
  let hash = 5381;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  return Math.abs(hash);
}

function memoryClamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function memoryRenderDpr(nodeCount) {
  const device = window.devicePixelRatio || 1;
  if (nodeCount > 2600) return Math.min(device, 1);
  if (nodeCount > 1400) return Math.min(device, 1.25);
  return Math.min(device, 1.5);
}

function memoryEdgeBudget(nodeCount, edgeCount, organized) {
  if (organized) return Math.min(edgeCount, 420);
  if (nodeCount > 3200) return Math.min(edgeCount, 520);
  if (nodeCount > 1800) return Math.min(edgeCount, 820);
  if (nodeCount > 900) return Math.min(edgeCount, 1250);
  return Math.min(edgeCount, 1900);
}

function readMemorySettings() {
  const fallback = { minEdgeWeight: 0.34, showLabels: false, organizeByType: false, separateByType: false, visualMode: 'galaxy', speed: 35, depth: 740, glow: 20 };
  try {
    const saved = JSON.parse(localStorage.getItem(MEMORY_SETTINGS_KEY) || 'null') || {};
    const bounded = (key, min, max) => {
      const value = Number(saved[key]);
      return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback[key];
    };
    const separateByType = typeof saved.separateByType === 'boolean' ? saved.separateByType : fallback.separateByType;
    return {
      minEdgeWeight: bounded('minEdgeWeight', 0, 1),
      showLabels: typeof saved.showLabels === 'boolean' ? saved.showLabels : fallback.showLabels,
      organizeByType: separateByType || (typeof saved.organizeByType === 'boolean' ? saved.organizeByType : fallback.organizeByType),
      separateByType,
      visualMode: ['galaxy', 'sphere', 'wave', 'tunnel'].includes(saved.visualMode) ? saved.visualMode : fallback.visualMode,
      speed: bounded('speed', 0, 200),
      depth: bounded('depth', 160, 900),
      glow: bounded('glow', 0, 100),
    };
  } catch { return fallback; }
}

function mountMemoryPage({ shell, features }) {
  shell.setActiveTab('chat');
  shell.setTitle('Memory Graph');
  const page = shell.page;
  const controls = readMemorySettings();
  let disposed = false;
  let nodes = [];
  let edges = [];
  let selectedId = '';
  let hoveredId = '';
  let filterText = '';
  let typeFilter = '';
  let scale = 1;
  let orbitYaw = -0.35;
  let orbitPitch = 0.22;
  let sceneTime = 0;
  let shapeMode = 'prometheus';
  let imagePoints = null;
  let drag = null;
  let motionTimer = 0;
  let graphGeneration = 0;
  let resizeObserver = null;
  let ctx = null;
  let canvas = null;
  let stage = null;
  let visibleNodes = [];
  let visibleEdges = [];
  let memoryAttachments = [];
  const particleSpriteCache = new Map();
  let disposeHeader = () => {};

  try {
    const savedLayout = JSON.parse(localStorage.getItem(MEMORY_DEFAULT_LAYOUT_KEY) || 'null');
    if (savedLayout?.mode === 'image' && Array.isArray(savedLayout.points) && savedLayout.points.length >= 30) {
      shapeMode = 'image';
      imagePoints = savedLayout.points;
    } else {
      const legacyPoints = JSON.parse(localStorage.getItem(MEMORY_LEGACY_DEFAULT_SHAPE_KEY) || 'null');
      if (Array.isArray(legacyPoints) && legacyPoints.length >= 30) {
        shapeMode = 'image';
        imagePoints = legacyPoints;
      }
    }
  } catch { /* Ignore malformed saved image shape. */ }

  page.innerHTML = `<style>
    .pm-v2-body.is-v2-memory{display:flex;flex-direction:column;min-height:0;padding:0!important;overflow:hidden}
    .pm-v2-memory-route{display:flex;flex:1;min-height:100dvh;min-width:0;flex-direction:column;gap:0;box-sizing:border-box;padding:calc(max(env(safe-area-inset-top),12px) + 50px + 64px) 0 calc(var(--pm-tabbar-h) + env(safe-area-inset-bottom));overflow:hidden}
    .pm-v2-memory-route .memory-page-shell{display:flex;flex:0 0 auto;flex-direction:column;min-height:0;color:var(--pm-text)}
    .pm-v2-memory-route .memory-page-header{flex:0 0 auto;display:flex;gap:8px;align-items:center;overflow-x:auto;padding:0 14px 10px;scrollbar-width:none}
    .pm-v2-memory-route .memory-page-header::-webkit-scrollbar{display:none}
    .pm-v2-memory-route .memory-action-btn{min-height:36px;padding:0 13px;border:1px solid var(--pm-border);border-radius:999px;background:var(--pm-surface);color:var(--pm-text);font:750 12px var(--pm-font);white-space:nowrap}
    .pm-v2-memory-route .memory-action-btn--primary{background:var(--pm-orange);border-color:transparent;color:#fff}
    .pm-v2-memory-route .memory-page-body{flex:0 0 240px;min-height:0;height:240px;position:relative;overflow:hidden;background:#071321}
    .pm-v2-memory-route .memory-graph-panel,.pm-v2-memory-route .memory-graph-stage{position:absolute;inset:0;min-height:0;height:100%;overflow:hidden}
    .pm-v2-memory-route .memory-graph-stage{background:radial-gradient(circle at 50% 45%,#15365a,#071321 66%,#030912);}
    .pm-v2-memory-route .memory-graph-stage canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}
    .pm-v2-memory-route .memory-graph-stage canvas.is-dragging{cursor:grabbing}
    .pm-v2-memory-route .memory-graph-toolbar{position:absolute;z-index:5;top:10px;left:10px;right:10px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
    .pm-v2-memory-route .memory-graph-stats{max-width:142px;overflow:hidden;text-overflow:ellipsis}
    .pm-v2-memory-route .memory-side-panel{display:flex;flex-direction:column;gap:10px;}
    .pm-v2-memory-route .memory-side-panel-header,.pm-v2-memory-route .memory-detail-drawer-header{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .pm-v2-memory-route .memory-panel-title,.pm-v2-memory-route .memory-side-panel-title{font-size:11px;font-weight:850;letter-spacing:.08em;text-transform:uppercase;color:var(--pm-muted)}
    .pm-v2-memory-route .memory-panel-collapse-btn{width:30px;height:30px;border:1px solid var(--pm-border);border-radius:999px;background:var(--pm-surface);color:var(--pm-text);font-size:18px}
    .pm-v2-memory-route .memory-panel-card{border:1px solid var(--pm-border);border-radius:14px;background:var(--pm-surface);padding:12px}
    .pm-v2-memory-route .memory-control-stack{display:flex;flex-direction:column;gap:10px}
    .pm-v2-memory-route .memory-particle-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:10px}
    .pm-v2-memory-route .memory-particle-mode-btn{min-height:34px;border:1px solid var(--pm-border);border-radius:10px;background:var(--pm-bg-soft);color:var(--pm-text);font:700 11px var(--pm-font)}
    .pm-v2-memory-route .memory-particle-mode-btn.active{border-color:var(--pm-orange);background:var(--pm-orange-soft);color:var(--pm-orange)}
    .pm-v2-memory-route .memory-particle-mode-btn:disabled{opacity:.45}
    .pm-v2-memory-route .memory-control{display:grid;grid-template-columns:1fr;gap:5px;font-size:12px;color:var(--pm-text)}
    .pm-v2-memory-route .memory-control-row{grid-template-columns:64px minmax(0,1fr) 38px;align-items:center}
    .pm-v2-memory-route .memory-control input[type=range]{width:100%;accent-color:var(--pm-orange)}
    .pm-v2-memory-route .memory-control select{min-height:36px;border:1px solid var(--pm-border);border-radius:10px;background:var(--pm-bg-soft);color:var(--pm-text);padding:0 9px}
    .pm-v2-memory-route .memory-control-value,.pm-v2-memory-route .memory-control-hint{color:var(--pm-muted);font-size:11px;text-align:right}
    .pm-v2-memory-route .memory-check{display:flex;align-items:center;gap:8px}
    .pm-v2-memory-route .memory-check input{accent-color:var(--pm-orange)}
    .pm-v2-memory-route .memory-filter-save-btn{min-height:36px;border:1px solid var(--pm-border);border-radius:10px;background:var(--pm-bg-soft);color:var(--pm-text);font-weight:750}
    .pm-v2-memory-route .memory-controls-fab{display:none;position:absolute;right:12px;bottom:12px;z-index:10;min-height:46px;padding:0 15px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(6,19,33,.82);color:#fff;font-weight:800}
    .pm-v2-memory-route .memory-detail-drawer{display:none;flex-direction:column;gap:10px}
    .pm-v2-memory-route .memory-detail-panel{min-height:0;overflow-y:auto;padding:2px 0 8px}
    .pm-v2-memory-route .memory-detail-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
    .pm-v2-memory-route .memory-detail-heading h3{margin:0;font-size:16px;line-height:1.25}
    .pm-v2-memory-route .memory-detail-chip{padding:4px 8px;border:1px solid var(--pm-border);border-radius:999px;color:var(--pm-muted);font-size:10px}
    .pm-v2-memory-route .memory-detail-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-bottom:12px}
    .pm-v2-memory-route .memory-detail-meta div{padding:8px;border:1px solid var(--pm-border);border-radius:10px;background:var(--pm-bg-soft);overflow-wrap:anywhere;font-size:11px}
    .pm-v2-memory-route .memory-detail-meta strong{display:block;margin-bottom:3px;color:var(--pm-muted);font-size:10px}
    .pm-v2-memory-route .memory-detail-section-title{margin:12px 0 5px;font-size:11px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;color:var(--pm-muted)}
    .pm-v2-memory-route .memory-detail-summary,.pm-v2-memory-route .memory-detail-chunk{font-size:12px;line-height:1.5;overflow-wrap:anywhere}
    .pm-v2-memory-route .memory-detail-summary p{margin:0 0 8px}
    .pm-v2-memory-route .memory-related-list{display:flex;flex-direction:column;gap:7px}
    .pm-v2-memory-route .memory-related-item{padding:9px;border:1px solid var(--pm-border);border-radius:10px;background:var(--pm-bg-soft);color:var(--pm-text);text-align:left}
    .pm-v2-memory-route .memory-compose-form{display:flex;flex-direction:column;gap:10px}
    .pm-v2-memory-route .memory-compose-field{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:750}
    .pm-v2-memory-route .memory-compose-input,.pm-v2-memory-route .memory-compose-textarea{width:100%;box-sizing:border-box;border:1px solid var(--pm-border);border-radius:10px;background:var(--pm-bg-soft);color:var(--pm-text);padding:10px;font:inherit}
    .pm-v2-memory-route .memory-compose-textarea{min-height:120px;resize:vertical}
    .pm-v2-memory-route .memory-compose-actions{display:flex;justify-content:flex-end;gap:8px}
    .pm-v2-memory-route .memory-compose-help,.pm-v2-memory-route .memory-detail-empty{font-size:12px;line-height:1.45;color:var(--pm-muted)}
    .pm-v2-memory-route .memory-drop-overlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(4,14,25,.78);color:#fff;font-weight:800;z-index:9;pointer-events:none}
    @media(max-width:420px){.pm-v2-memory-route .memory-detail-meta{grid-template-columns:1fr}}
  </style>
  <div class="pm-v2-memory-route"><div class="memory-page-shell pm-mobile-memory-shell">
    <div class="memory-page-header pm-mobile-memory-actions"><input id="memory-image-input" type="file" accept="image/*" hidden/><button class="memory-action-btn memory-action-btn--primary" type="button" data-memory-add>+ Add Memory</button><button class="memory-action-btn" type="button" data-memory-image-shape>Image Shape</button><button id="memory-set-default-btn" class="memory-action-btn" type="button" data-memory-set-default>Set Image Default</button></div>
    <div class="memory-page-body" id="pm-v2-memory-workspace">
      <section class="memory-graph-panel"><div class="memory-graph-toolbar"><input id="memory-search-input" class="memory-search-input" type="search" placeholder="Search nodes, summaries, paths…"/><div id="memory-graph-stats" class="memory-graph-stats">Loading graph…</div></div><div id="memory-graph-stage" class="memory-graph-stage"><canvas id="memory-graph-canvas" aria-label="Interactive memory graph"></canvas><div id="memory-graph-tooltip" class="memory-graph-tooltip" style="display:none"></div><div id="memory-graph-empty" class="memory-graph-empty">Loading memory graph…</div><div id="memory-drop-overlay" class="memory-drop-overlay">Drop image to reshape node outline</div></div></section>
      <aside id="memory-side-panel" class="memory-side-panel collapsed"><div class="memory-side-panel-header"><div class="memory-side-panel-title">Controls</div><button class="memory-panel-collapse-btn" type="button" data-memory-close-controls aria-label="Close controls">×</button></div>
        <section class="memory-panel-card memory-particle-controls"><div class="memory-panel-header-line"><div class="memory-panel-title">Graph style</div><div class="memory-panel-hint">interactive graph</div></div><div class="memory-particle-modes">${['galaxy','sphere','wave','tunnel'].map((mode) => `<button class="memory-particle-mode-btn ${controls.visualMode === mode ? 'active' : ''}" type="button" data-memory-mode="${mode}">${mode[0].toUpperCase()}${mode.slice(1)}</button>`).join('')}</div><div class="memory-control-stack">${[['speed','Speed',0,200],['depth','Depth',160,900],['glow','Glow',0,100]].map(([name,label,min,max]) => `<label class="memory-control memory-control-row"><span>${label}</span><input id="memory-${name}" type="range" min="${min}" max="${max}" step="1" value="${controls[name]}"/><span class="memory-control-value" id="memory-${name}-value">${controls[name]}</span></label>`).join('')}</div></section>
        <section class="memory-panel-card"><div class="memory-panel-title">Filters</div><div class="memory-control-stack"><label class="memory-control"><span>Source Type</span><select id="memory-type-filter"><option value="">All records</option></select></label><label class="memory-control"><span>Minimum edge weight</span><input id="memory-edge-weight" type="range" min="0" max="100" value="${Math.round(controls.minEdgeWeight * 100)}"/><span id="memory-edge-weight-value" class="memory-control-hint">${controls.minEdgeWeight.toFixed(2)}+</span></label><label class="memory-control memory-check"><input id="memory-show-labels" type="checkbox" ${controls.showLabels ? 'checked' : ''}/><span>Show labels for important nodes</span></label><label class="memory-control memory-check"><input id="memory-organize-type" type="checkbox" ${controls.organizeByType ? 'checked' : ''}/><span>Organize by type</span></label><label class="memory-control memory-check"><input id="memory-separate-type" type="checkbox" ${controls.separateByType ? 'checked' : ''}/><span>Separate by type</span></label><button id="memory-save-settings" class="memory-filter-save-btn" type="button">Save Settings</button></div></section>
      </aside>
      <button id="memory-controls-fab" class="memory-controls-fab" type="button" data-memory-controls>Filters</button>
      <aside id="memory-detail-drawer" class="memory-detail-drawer"><div class="memory-detail-drawer-header"><div id="memory-drawer-title" class="memory-side-panel-title">Node Detail</div><button class="memory-panel-collapse-btn" type="button" data-memory-close-detail aria-label="Close details">×</button></div><div id="memory-detail-panel" class="memory-detail-panel"><div class="memory-detail-empty">Select a node to inspect its summary, source, and related records.</div></div></aside>
    </div>
  </div></div>`;

  const searchInput = page.querySelector('#memory-search-input');
  const typeSelect = page.querySelector('#memory-type-filter');
  const statsEl = page.querySelector('#memory-graph-stats');
  const tooltip = page.querySelector('#memory-graph-tooltip');
  const empty = page.querySelector('#memory-graph-empty');
  const controlsPanel = page.querySelector('#memory-side-panel');
  const controlsFab = page.querySelector('#memory-controls-fab');
  const detailDrawer = page.querySelector('#memory-detail-drawer');
  const detailPanel = page.querySelector('#memory-detail-panel');
  const canvasEl = page.querySelector('#memory-graph-canvas');
  const stageEl = page.querySelector('#memory-graph-stage');
  const imageInput = page.querySelector('#memory-image-input');
  const defaultShapeButton = page.querySelector('#memory-set-default-btn');
  page.classList.add('is-v2-memory');
  canvas = canvasEl;
  stage = stageEl;
  ctx = canvasEl?.getContext('2d');

  function readSavedImageLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(MEMORY_DEFAULT_LAYOUT_KEY) || 'null');
      if (saved?.mode === 'image' && Array.isArray(saved.points) && saved.points.length >= 30) return saved;
      const legacy = JSON.parse(localStorage.getItem(MEMORY_LEGACY_DEFAULT_SHAPE_KEY) || 'null');
      if (Array.isArray(legacy) && legacy.length >= 30) return { mode: 'image', points: legacy };
    } catch { /* Invalid local settings are ignored. */ }
    return null;
  }

  function updateDefaultShapeButton() {
    if (!defaultShapeButton) return;
    const saved = readSavedImageLayout();
    const canSaveCurrent = shapeMode === 'image' && imagePoints?.length;
    defaultShapeButton.textContent = saved ? 'Clear Image Default' : 'Set Image Default';
    defaultShapeButton.style.opacity = canSaveCurrent || saved ? '1' : '0.4';
  }

  function prepareScene(list) {
    const ordered = [...list].sort((a, b) => Number(b.degree || 0) - Number(a.degree || 0)
      || String(a.label || a.title || '').localeCompare(String(b.label || b.title || '')));
    const groups = new Map();
    for (const node of ordered) {
      const key = String(node.sourceType || node.sourceTypeLabel || 'other');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(node);
    }
    const groupRows = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    const groupIndexes = new Map(groupRows.map(([key], index) => [key, index]));
    const localIndexes = new Map();
    groupRows.forEach(([, group]) => group.forEach((node, index) => localIndexes.set(node, index)));
    ordered.forEach((node, index) => {
      node._pmSceneIndex = index;
      node._pmSceneT = ordered.length <= 1 ? 0.5 : index / Math.max(1, ordered.length - 1);
      node._pmSceneSeed = memoryHash(`${node.id}:particle`);
      const huePick = (memoryHash(`${node.id}:hue`) % 100) / 100;
      node._pmSceneHue = huePick < 0.46 ? 'cyan' : huePick < 0.78 ? 'ember' : 'pink';
      const key = String(node.sourceType || node.sourceTypeLabel || 'other');
      const group = groups.get(key) || [];
      node._pmTypeGroupIndex = groupIndexes.get(key) || 0;
      node._pmTypeGroupCount = Math.max(1, groupRows.length);
      node._pmTypeLocalIndex = localIndexes.get(node) || 0;
      node._pmTypeCount = group.length || 1;
      node._pmTypeLocalT = node._pmTypeCount <= 1 ? 0.5 : node._pmTypeLocalIndex / Math.max(1, node._pmTypeCount - 1);
    });
  }

  function prepareImageShape() {
    if (shapeMode !== 'image' || !imagePoints?.length || !nodes.length) return;
    const ordered = [...nodes].sort((a, b) => Number(b.degree || 0) - Number(a.degree || 0)
      || String(a.label || a.title || '').localeCompare(String(b.label || b.title || '')));
    const step = Math.max(1, Math.floor(imagePoints.length / ordered.length));
    const picked = [];
    for (let index = 0; index < imagePoints.length && picked.length < ordered.length; index += step) picked.push(imagePoints[index]);
    while (picked.length < ordered.length) picked.push(imagePoints[picked.length % imagePoints.length]);
    const minX = Math.min(...picked.map((point) => point.x));
    const maxX = Math.max(...picked.map((point) => point.x));
    const minY = Math.min(...picked.map((point) => point.y));
    const maxY = Math.max(...picked.map((point) => point.y));
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const fit = Math.min(860 / spanX, 560 / spanY) * 0.82;
    ordered.forEach((node, index) => {
      const point = picked[index];
      node._pmImageX = (point.x - minX - spanX / 2) * fit;
      node._pmImageY = (point.y - minY - spanY / 2) * fit;
    });
  }

  function applyImageShape(file) {
    if (!file || !String(file.type || '').startsWith('image/')) return;
    const reader = new FileReader();
    reader.onerror = () => shell.showNotice('Could not read that image.');
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => shell.showNotice('Could not open that image.');
      image.onload = () => {
        const sampleWidth = 220;
        const sampleHeight = Math.max(100, Math.min(660, Math.round(image.height * sampleWidth / Math.max(1, image.width))));
        const sample = document.createElement('canvas');
        sample.width = sampleWidth;
        sample.height = sampleHeight;
        const sampleContext = sample.getContext('2d', { willReadFrequently: true });
        if (!sampleContext) { shell.showNotice('This browser could not sample that image.'); return; }
        sampleContext.clearRect(0, 0, sampleWidth, sampleHeight);
        sampleContext.drawImage(image, 0, 0, sampleWidth, sampleHeight);
        const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
        const points = [];
        for (let y = 0; y < sampleHeight; y += 2) {
          for (let x = 0; x < sampleWidth; x += 2) {
            const offset = (y * sampleWidth + x) * 4;
            const luminance = 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
            if (pixels[offset + 3] > 20 && luminance < 190) points.push({ x, y });
          }
        }
        if (points.length < 30) { shell.showNotice('Use a higher-contrast image so its outline is easier to sample.'); return; }
        imagePoints = points;
        shapeMode = 'image';
        controls.organizeByType = false;
        controls.separateByType = false;
        page.querySelector('#memory-organize-type').checked = false;
        page.querySelector('#memory-separate-type').checked = false;
        prepareImageShape();
        updateDefaultShapeButton();
        drawGraph();
        shell.showNotice(`${file.name} now defines the memory graph outline.`);
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  }

  function toggleDefaultShape() {
    const saved = readSavedImageLayout();
    if (saved) {
      localStorage.removeItem(MEMORY_DEFAULT_LAYOUT_KEY);
      localStorage.removeItem(MEMORY_LEGACY_DEFAULT_SHAPE_KEY);
      shapeMode = 'prometheus';
      imagePoints = null;
      drawGraph();
      shell.showNotice('Default image cleared. The galaxy layout will be used next time.');
    } else if (shapeMode === 'image' && imagePoints?.length) {
      try {
        localStorage.setItem(MEMORY_DEFAULT_LAYOUT_KEY, JSON.stringify({ mode: 'image', points: imagePoints }));
        localStorage.removeItem(MEMORY_LEGACY_DEFAULT_SHAPE_KEY);
        shell.showNotice('Image shape saved as the default layout.');
      } catch { shell.showNotice('Could not save that image shape in browser storage.'); }
    } else {
      shell.showNotice('Choose an Image Shape first, then save it as the default.');
    }
    updateDefaultShapeButton();
  }

  function setParticleMode(mode) {
    if (!['galaxy', 'sphere', 'wave', 'tunnel'].includes(mode)) return;
    shapeMode = 'prometheus';
    controls.visualMode = mode;
    page.querySelectorAll('[data-memory-mode]').forEach((button) => { button.classList.toggle('active', button.dataset.memoryMode === mode); });
    updateDefaultShapeButton();
    drawGraph();
  }

  function particlePosition(node) {
    const mode = ['galaxy', 'sphere', 'wave', 'tunnel'].includes(controls.visualMode) ? controls.visualMode : 'galaxy';
    const depth = Number(controls.depth || 740);
    const seed = Number(node._pmSceneSeed || memoryHash(node.id));
    const index = Number(node._pmSceneIndex || 0);
    const t = Number(node._pmSceneT || 0);
    const time = sceneTime;
    let x = 0; let y = 0; let z = 0;

    if (controls.organizeByType) {
      const groupCount = Math.max(1, Number(node._pmTypeGroupCount || 1));
      const groupIndex = Number(node._pmTypeGroupIndex || 0);
      const localIndex = Number(node._pmTypeLocalIndex || 0);
      const typeCount = Math.max(1, Number(node._pmTypeCount || 1));
      const localT = Number.isFinite(node._pmTypeLocalT) ? node._pmTypeLocalT : 0.5;
      const groupAngle = (Math.PI * 2 * groupIndex) / groupCount;
      const localHashA = (memoryHash(`${node.id}:type:a`) % 1000) / 1000 - 0.5;
      const localHashB = (memoryHash(`${node.id}:type:b`) % 1000) / 1000 - 0.5;
      const colorPhase = groupAngle * 0.18;
      const laneOffset = ((groupIndex - (groupCount - 1) / 2) / Math.max(1, groupCount)) * depth * 0.22;
      if (mode === 'galaxy') {
        const arm = (localIndex % 5) * (Math.PI * 2 / 5) + colorPhase;
        const radius = (0.1 + Math.sqrt(localT) * 0.88) * depth;
        const swirl = radius * 0.013 + time * 0.38 + arm + localHashA * 0.18;
        x = Math.cos(swirl) * radius + Math.cos(groupAngle) * laneOffset + localHashB * 18;
        y = Math.sin(seed * 2.1 + time) * 16 + Math.cos(radius * 0.02 + groupIndex) * 18;
        z = Math.sin(swirl) * radius + Math.sin(groupAngle) * laneOffset + localHashA * 18;
      } else if (mode === 'sphere') {
        const phi = Math.acos(1 - 2 * localT);
        const theta = Math.PI * (3 - Math.sqrt(5)) * localIndex + time * 0.22 + colorPhase;
        const radius = depth * (0.35 + 0.11 * Math.sin(time * 1.2 + seed));
        x = Math.cos(theta) * Math.sin(phi) * radius + Math.cos(groupAngle) * depth * 0.055;
        y = Math.cos(phi) * radius + localHashB * depth * 0.025;
        z = Math.sin(theta) * Math.sin(phi) * radius + Math.sin(groupAngle) * depth * 0.055;
      } else if (mode === 'wave') {
        const grid = Math.max(1, Math.ceil(Math.sqrt(typeCount)));
        const gx = (localIndex % grid) / grid - 0.5 + localHashA * 0.025;
        const gy = Math.floor(localIndex / grid) / grid - 0.5 + localHashB * 0.025;
        x = gx * depth * 1.42 + laneOffset;
        z = gy * depth * 1.42 + Math.sin(groupAngle) * depth * 0.08;
        y = Math.sin(gx * 18 + time * 2.1 + groupIndex * 0.34) * 42 + Math.cos(gy * 16 + time * 1.7) * 34;
      } else {
        const travel = ((localT * 2 + time * 0.12) % 1);
        const lane = (localIndex % 80) / 80 * Math.PI * 2 + colorPhase + localHashA * 0.08;
        const radius = depth * (0.12 + 0.34 * travel) + laneOffset * 0.18;
        x = Math.cos(lane + time * 0.8) * radius;
        y = Math.sin(lane + time * 0.8) * radius;
        z = (travel - 0.5) * depth * 2.1 + localHashB * 30;
      }
    } else if (shapeMode === 'image' && Number.isFinite(node._pmImageX) && Number.isFinite(node._pmImageY)) {
      x = node._pmImageX;
      y = node._pmImageY;
      z = Math.sin(seed * 0.01 + time) * 28;
    } else if (mode === 'galaxy') {
      const arm = (index % 5) * (Math.PI * 2 / 5);
      const radius = Math.sqrt(t) * depth * 0.95;
      const swirl = radius * 0.013 + time * 0.38 + arm;
      x = Math.cos(swirl) * radius + Math.sin(seed) * 20;
      y = Math.sin(seed * 2.1 + time) * 18 + Math.cos(radius * 0.02) * 22;
      z = Math.sin(swirl) * radius + Math.cos(seed) * 20;
    } else if (mode === 'sphere') {
      const phi = Math.acos(1 - 2 * t);
      const theta = Math.PI * (3 - Math.sqrt(5)) * index + time * 0.22;
      const radius = depth * (0.38 + 0.12 * Math.sin(time * 1.2 + seed));
      x = Math.cos(theta) * Math.sin(phi) * radius;
      y = Math.cos(phi) * radius;
      z = Math.sin(theta) * Math.sin(phi) * radius;
    } else if (mode === 'wave') {
      const count = Math.max(1, visibleNodes.length);
      const grid = Math.max(1, Math.ceil(Math.sqrt(count)));
      const gx = (index % grid) / grid - 0.5;
      const gy = Math.floor(index / grid) / grid - 0.5;
      x = gx * depth * 1.55;
      z = gy * depth * 1.55;
      y = Math.sin(gx * 18 + time * 2.1) * 42 + Math.cos(gy * 16 + time * 1.7) * 42;
    } else {
      const travel = ((t * 2 + time * 0.12) % 1);
      const lane = (index % 80) / 80 * Math.PI * 2;
      const radius = depth * (0.12 + 0.34 * travel);
      x = Math.cos(lane + time * 0.8) * radius;
      y = Math.sin(lane + time * 0.8) * radius;
      z = (travel - 0.5) * depth * 2.1;
    }
    return { x, y, z };
  }

  function projectPosition(position, width, height, node) {
    const cy = Math.cos(orbitYaw); const sy = Math.sin(orbitYaw);
    const cp = Math.cos(orbitPitch); const sp = Math.sin(orbitPitch);
    let x = position.x * cy - position.z * sy;
    let z = position.x * sy + position.z * cy;
    let y = position.y * cp - z * sp;
    z = position.y * sp + z * cp;
    const cameraZ = memoryClamp(1120 / Math.max(0.35, scale), 300, 2600);
    const perspective = cameraZ / (cameraZ + z);
    const sceneScale = 720 / Math.max(280, cameraZ);
    const screenX = width / 2 + x * perspective * sceneScale;
    const screenY = height / 2 + y * perspective * sceneScale;
    const radius = memoryClamp((3 + Math.sqrt(Math.max(0, Number(node?.degree || 0))) * 0.72 + Number(node?.durability || 0.5) * 2.4) * perspective * 0.62, 1.2, 8.2);
    return { x: screenX, y: screenY, z, perspective, radius };
  }

  function particleColor(node) {
    if (controls.organizeByType) {
      const type = String(node.sourceType || node.sourceTypeLabel || 'other');
      const index = memoryHash(type) % MEMORY_COLORS.length;
      return MEMORY_COLORS[index];
    }
    if (node._pmSceneHue === 'pink') return '#ff4fd8';
    if (node._pmSceneHue === 'ember') return '#ff6a1a';
    return '#39e8ff';
  }

  function particleSprite(color, size) {
    const glow = Number(controls.glow || 20) / 100;
    const sizeBucket = Math.max(1, Math.round(size * 2) / 2);
    const glowBucket = Math.round(glow * 20) / 20;
    const key = `${color}:${sizeBucket}:${glowBucket}`;
    const cached = particleSpriteCache.get(key);
    if (cached) return cached;
    if (particleSpriteCache.size > 420) particleSpriteCache.clear();
    const halo = sizeBucket * (4.8 + glowBucket * 9.5);
    const dimension = Math.ceil((halo + 3) * 2);
    const sprite = document.createElement('canvas');
    sprite.width = dimension;
    sprite.height = dimension;
    const spriteContext = sprite.getContext('2d');
    if (!spriteContext) return { canvas: sprite, width: dimension, height: dimension };
    const center = dimension / 2;
    const hex = color.replace('#', '');
    const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const gradient = spriteContext.createRadialGradient(center, center, 0, center, center, halo);
    gradient.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
    gradient.addColorStop(0.28, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${glowBucket * 0.42})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    spriteContext.fillStyle = gradient;
    spriteContext.beginPath(); spriteContext.arc(center, center, halo, 0, Math.PI * 2); spriteContext.fill();
    spriteContext.fillStyle = color;
    spriteContext.beginPath(); spriteContext.arc(center, center, sizeBucket, 0, Math.PI * 2); spriteContext.fill();
    const result = { canvas: sprite, width: dimension, height: dimension };
    particleSpriteCache.set(key, result);
    return result;
  }

  function drawParticleBackground(width, height) {
    const background = ctx.createRadialGradient(width * 0.52, height * 0.46, 0, width * 0.52, height * 0.46, Math.max(width, height) * 0.72);
    background.addColorStop(0, '#101118');
    background.addColorStop(0.45, '#07080b');
    background.addColorStop(1, '#020203');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1;
    const gap = 62;
    for (let x = width / 2 % gap; x < width; x += gap) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = height / 2 % gap; y < height; y += gap) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.restore();
  }

  function filteredGraph() {
    const terms = filterText.toLowerCase().split(/\s+/).filter(Boolean);
    visibleNodes = nodes.filter((node) => {
      const haystack = `${node.label || ''} ${node.title || ''} ${node.sourcePath || ''} ${node.summary || ''} ${node.sourceTypeLabel || ''} ${node.sourceType || ''}`.toLowerCase();
      return (!typeFilter || node.sourceType === typeFilter) && terms.every((term) => haystack.includes(term));
    });
    const ids = new Set(visibleNodes.map((node) => String(node.id)));
    visibleEdges = edges.filter((edge) => ids.has(String(edge.source)) && ids.has(String(edge.target)) && Number(edge.weight || 0) >= controls.minEdgeWeight)
      .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));
    prepareScene(visibleNodes);
    prepareImageShape();
    if (empty) { empty.style.display = visibleNodes.length ? 'none' : 'flex'; empty.textContent = nodes.length ? 'No records match these filters.' : 'No memory records yet. Add a memory to get started.'; }
    if (statsEl) statsEl.textContent = `${visibleNodes.length} of ${nodes.length} nodes · ${visibleEdges.length} links`;
    drawGraph();
  }

  function drawGraph() {
    if (!ctx || !canvasEl || !stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = memoryRenderDpr(visibleNodes.length);
    if (canvasEl.width !== Math.round(rect.width * dpr) || canvasEl.height !== Math.round(rect.height * dpr)) { canvasEl.width = Math.round(rect.width * dpr); canvasEl.height = Math.round(rect.height * dpr); }
    canvasEl.style.width = `${rect.width}px`;
    canvasEl.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawParticleBackground(rect.width, rect.height);
    const positions = new Map();
    for (const node of visibleNodes) {
      const position = particlePosition(node);
      const projected = projectPosition(position, rect.width, rect.height, node);
      if (projected.perspective <= 0 || projected.x < -70 || projected.x > rect.width + 70 || projected.y < -70 || projected.y > rect.height + 70) continue;
      const alpha = memoryClamp((projected.perspective - 0.25) * 1.4, 0.08, 0.9);
      const point = { ...projected, alpha, hitRadius: Math.max(9, projected.radius + 8) };
      positions.set(String(node.id), point);
    }
    canvasEl._pmNodePositions = positions;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const edgeBudget = memoryEdgeBudget(visibleNodes.length, visibleEdges.length, controls.organizeByType);
    for (let index = 0; index < visibleEdges.length; index += 1) {
      const edge = visibleEdges[index];
      const sourceId = String(edge.source); const targetId = String(edge.target);
      const a = positions.get(sourceId); const b = positions.get(targetId);
      if (!a || !b) continue;
      const linkedToHover = hoveredId && (sourceId === hoveredId || targetId === hoveredId);
      const linkedToSelected = selectedId && (sourceId === selectedId || targetId === selectedId);
      if (!linkedToHover && !linkedToSelected && index >= edgeBudget) continue;
      const opacity = linkedToSelected ? 0.5 : linkedToHover ? 0.42 : 0.045;
      ctx.strokeStyle = linkedToSelected ? `rgba(255,255,255,${opacity})` : linkedToHover ? `rgba(116,244,255,${opacity})` : `rgba(57,232,255,${opacity})`;
      ctx.lineWidth = linkedToSelected ? 2 : linkedToHover ? 1.6 : 0.7;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const glow = Number(controls.glow || 20) / 100;
    const labels = [];
    for (const node of visibleNodes) {
      const point = positions.get(String(node.id));
      if (!point) continue;
      const selected = String(node.id) === selectedId;
      const hovered = String(node.id) === hoveredId;
      const radius = point.radius + (selected ? 3.2 : hovered ? 1.6 : 0);
      const sprite = particleSprite(particleColor(node), radius);
      const alpha = memoryClamp(point.alpha * 1.15, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite.canvas, point.x - sprite.width / 2, point.y - sprite.height / 2, sprite.width, sprite.height);
      ctx.globalAlpha = 1;
      if (selected) {
        ctx.fillStyle = 'rgba(255,255,255,0.98)'; ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(1.8, radius * 0.55), 0, Math.PI * 2); ctx.fill();
      }
      if (selected || hovered) {
        ctx.lineWidth = selected ? 2 : 1.2; ctx.strokeStyle = `rgba(255,255,255,${selected ? 0.92 : 0.62})`;
        ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.stroke();
      }
      if (controls.showLabels && (Number(node.degree || 0) >= 2 || selected || hovered || point.radius > 4.6)) labels.push({ node, point });
    }
    ctx.restore();
    if (controls.showLabels) {
      const maxLabels = Math.round(memoryClamp(26 + memoryClamp(1120 / Math.max(0.35, scale), 300, 2600) / 18, 32, 92));
      ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      labels.sort((a, b) => b.point.radius - a.point.radius).slice(0, maxLabels).forEach(({ node, point }) => {
        ctx.fillStyle = String(node.id) === selectedId ? '#fff' : 'rgba(236,244,255,.86)';
        ctx.fillText(String(node.label || node.title || 'Memory'), point.x + point.radius + 7, point.y);
      });
      ctx.restore();
    }
    canvasEl._pmNodePositions = positions;
  }

  function showControls(show) {
    const open = typeof show === 'boolean' ? show : controlsPanel.classList.contains('collapsed');
    controlsPanel.classList.toggle('collapsed', !open);
    controlsFab.style.display = open ? 'none' : 'inline-flex';
  }

  function syncModeControls() {
    page.querySelectorAll('[data-memory-mode]').forEach((button) => { button.disabled = controls.separateByType; });
  }

  function renderDetail(node, payload = null, preview = false) {
    const record = payload?.record || (node ? { id: node.id, title: node.label || node.title || 'Untitled record', sourceType: node.sourceTypeLabel || node.sourceType || 'record', sourcePath: node.sourcePath || '', timestamp: node.timestamp || '', projectId: node.projectId || '', durability: node.durability ?? 0.5 } : null);
    if (!record) { detailPanel.innerHTML = '<div class="memory-detail-empty">Select a record to inspect its summary, source, and related items.</div>'; return; }
    const chunks = Array.isArray(payload?.chunks) ? payload.chunks.slice(0, 3) : [];
    const summary = chunks.map((chunk) => String(chunk?.text || '').trim()).filter(Boolean).join('\n\n') || node?.summary || node?.text || '';
    const related = Array.isArray(payload?.related) ? payload.related.slice(0, 6) : [];
    const paragraphs = summary ? summary.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('') : '<em>No content available.</em>';
    detailPanel.innerHTML = `<div class="memory-detail-heading"><div><h3>${escapeHtml(record.title || 'Untitled record')}</h3></div><div class="memory-detail-chip">${escapeHtml(record.sourceType || 'record')}</div></div><div class="memory-detail-meta"><div><strong>Time</strong>${escapeHtml(record.timestamp ? asTime(record.timestamp) : '—')}</div><div><strong>Project</strong>${escapeHtml(record.projectId || 'None')}</div><div><strong>Durability</strong>${escapeHtml(Number(record.durability ?? 0.5).toFixed(2))}</div><div><strong>Source</strong>${escapeHtml(record.sourcePath || '—')}</div></div>${preview ? '<div class="memory-detail-empty">Loading full record…</div>' : ''}<div class="memory-detail-section-title">Summary</div><div class="memory-detail-summary">${paragraphs}</div>${chunks.length > 1 ? `<div class="memory-detail-section-title">Additional Chunks</div>${chunks.slice(1).map((chunk) => `<div class="memory-detail-chunk">${escapeHtml(chunk.text || '')}</div>`).join('')}` : ''}<div class="memory-detail-section-title">Related Records</div><div class="memory-related-list">${related.map((item) => `<button type="button" class="memory-related-item" data-memory-related="${escapeHtml(item.recordId)}"><strong>${escapeHtml(item.title || item.recordId)}</strong><div>${escapeHtml(item.sourceType || 'record')} · ${escapeHtml(item.timestamp ? asTime(item.timestamp) : '')}</div><small>${escapeHtml(String(item.preview || '').slice(0, 180))}</small></button>`).join('') || '<div class="memory-detail-empty">No related records returned for this node.</div>'}</div>`;
    detailPanel.querySelectorAll('[data-memory-related]').forEach((button) => button.addEventListener('click', () => { const relatedNode = nodes.find((item) => String(item.id) === button.dataset.memoryRelated); if (relatedNode) selectNode(relatedNode); }));
  }

  async function selectNode(node) {
    if (disposed || !node?.id) return;
    selectedId = String(node.id);
    showControls(false);
    detailDrawer.style.display = 'flex';
    page.querySelector('#memory-drawer-title').textContent = 'Node Detail';
    renderDetail(node, { record: { title: node.label || node.title, sourceType: node.sourceTypeLabel || node.sourceType, sourcePath: node.sourcePath, timestamp: node.timestamp, projectId: node.projectId, durability: node.durability }, chunks: node.summary ? [{ text: node.summary }] : [] }, true);
    drawGraph();
    try {
      const detail = await features.api.request(`/api/memory/record/${encodeURIComponent(node.id)}?related=0`);
      if (!disposed && selectedId === String(node.id)) renderDetail(node, detail, false);
    } catch (error) {
      if (!disposed && selectedId === String(node.id)) detailPanel.insertAdjacentHTML('afterbegin', `<div class="memory-detail-empty">Could not load full record: ${escapeHtml(error?.message || error)}</div>`);
    }
  }

  function hitTest(x, y) {
    const rect = canvasEl.getBoundingClientRect();
    const positions = canvasEl._pmNodePositions;
    if (!positions) return null;
    for (let index = visibleNodes.length - 1; index >= 0; index -= 1) {
      const node = visibleNodes[index]; const point = positions.get(String(node.id));
      if (!point) continue;
      if (Math.hypot(x - (point.x + rect.left), y - (point.y + rect.top)) <= point.hitRadius) return node;
    }
    return null;
  }

  function pointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    canvasEl.setPointerCapture?.(event.pointerId);
    const node = hitTest(event.clientX, event.clientY);
    drag = { startX: event.clientX, startY: event.clientY, startYaw: orbitYaw, startPitch: orbitPitch, node, moved: false };
    canvasEl.classList.add('is-dragging');
  }

  function pointerMove(event) {
    if (drag) {
      const dx = event.clientX - drag.startX; const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) {
        orbitYaw = drag.startYaw + dx * 0.006;
        orbitPitch = memoryClamp(drag.startPitch + dy * 0.004, -1.25, 1.25);
        drawGraph();
      }
      return;
    }
    const node = hitTest(event.clientX, event.clientY);
    const nextHoveredId = node ? String(node.id) : '';
    if (nextHoveredId !== hoveredId) { hoveredId = nextHoveredId; drawGraph(); }
    if (!node) { tooltip.style.display = 'none'; return; }
    const rect = stageEl.getBoundingClientRect();
    tooltip.innerHTML = `<strong>${escapeHtml(node.label || node.title || 'Memory')}</strong><div class="meta">${escapeHtml(node.sourceTypeLabel || node.sourceType || 'Record')} · ${escapeHtml(node.timestamp ? asTime(node.timestamp) : '')}</div><div class="body">${escapeHtml(node.summary || node.sourcePath || 'No summary available.')}</div>`;
    tooltip.style.left = `${Math.max(8, Math.min(event.clientX - rect.left + 14, rect.width - 250))}px`;
    tooltip.style.top = `${Math.max(56, Math.min(event.clientY - rect.top + 14, rect.height - 132))}px`;
    tooltip.style.display = 'block';
  }

  function pointerUp(event) {
    if (!drag) return;
    try { canvasEl.releasePointerCapture?.(event.pointerId); } catch {}
    const selected = !drag.moved ? drag.node : null;
    drag = null;
    canvasEl.classList.remove('is-dragging');
    if (selected) selectNode(selected);
  }

  function pointerCancel(event) {
    if (!drag) return;
    try { canvasEl.releasePointerCapture?.(event.pointerId); } catch {}
    drag = null;
    canvasEl.classList.remove('is-dragging');
  }

  function wheel(event) {
    event.preventDefault();
    scale = Math.max(0.35, Math.min(3.5, scale * (event.deltaY < 0 ? 1.12 : 0.89)));
    drawGraph();
  }

  function pointerLeave() {
    if (hoveredId) { hoveredId = ''; drawGraph(); }
    if (tooltip) tooltip.style.display = 'none';
  }

  async function loadGraph(forceIndex = false) {
    const generation = ++graphGeneration;
    const emptyEl = page.querySelector('#memory-graph-empty');
    let refreshError = null;
    if (emptyEl) { emptyEl.style.display = 'flex'; emptyEl.textContent = forceIndex ? 'Refreshing memory index…' : 'Loading memory graph…'; }
    try {
      if (forceIndex) {
        try { await features.api.request('/api/memory/refresh', { method: 'POST', body: '{}' }); }
        catch (error) { refreshError = error; }
      }
      const graph = await features.memory();
      if (disposed || generation !== graphGeneration) return;
      nodes = Array.isArray(graph?.nodes) ? graph.nodes : Array.isArray(graph?.items) ? graph.items : [];
      edges = Array.isArray(graph?.edges) ? graph.edges : [];
      const types = [...new Set(nodes.map((node) => String(node.sourceType || '').trim()).filter(Boolean))].sort();
      const previousType = typeFilter;
      typeSelect.innerHTML = `<option value="">All records</option>${types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(nodes.find((node) => node.sourceType === type)?.sourceTypeLabel || type)}</option>`).join('')}`;
      typeSelect.value = types.includes(previousType) ? previousType : '';
      typeFilter = typeSelect.value;
      filteredGraph();
      if (!nodes.length && emptyEl) emptyEl.textContent = 'No memory records yet. Add a memory to get started.';
      if (forceIndex) shell.showNotice(refreshError ? `Could not refresh memory index: ${refreshError?.message || refreshError}` : 'Memory graph refreshed.');
    } catch (error) {
      if (disposed || generation !== graphGeneration) return;
      if (emptyEl) { emptyEl.style.display = 'flex'; emptyEl.textContent = error?.message || 'Could not load memory graph.'; }
    }
  }

  async function addMemory(event) {
    event.preventDefault();
    if (disposed || event.currentTarget.dataset.submitting === 'true') return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title') || '').trim();
    const description = String(data.get('description') || '').trim();
    const content = String(data.get('content') || '').trim();
    if (!title || (!description && !content && !memoryAttachments.length)) { shell.showNotice('Add a title and some memory text or an attachment before saving.'); return; }
    const submit = form.querySelector('[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = 'Creating…'; }
    form.dataset.submitting = 'true';
    try {
      const attachments = await Promise.all(memoryAttachments.map(async (file) => ({ name: file.name, mimeType: file.type || '', base64: await fileToBase64(file) })));
      const result = await features.api.request('/api/memory/create', { method: 'POST', body: JSON.stringify({ title, description, content, attachments }) });
      if (disposed) return;
      shell.showNotice('Memory created.');
      if (result?.recordId) {
        filterText = '';
        typeFilter = '';
        searchInput.value = '';
        typeSelect.value = '';
      }
      memoryAttachments = [];
      await loadGraph();
      if (disposed) return;
      const created = nodes.find((node) => String(node.id) === String(result?.recordId));
      if (created) selectNode(created); else closeDetail();
    } catch (error) {
      if (!disposed) shell.showNotice(error?.message || 'Could not create memory.');
      if (submit) { submit.disabled = false; submit.textContent = 'Create Memory'; }
    } finally {
      if (!disposed && form.isConnected) form.dataset.submitting = 'false';
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^;]+;base64,/, ''));
      reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  function renderAttachmentList() {
    const list = detailPanel.querySelector('[data-memory-attachments]');
    if (!list) return;
    list.innerHTML = memoryAttachments.length
      ? memoryAttachments.map((file, index) => `<div class="memory-detail-meta"><div><strong>${escapeHtml(file.name)}</strong>${escapeHtml(file.size ? `${Math.ceil(file.size / 1024)} KB` : 'Attachment')}</div><button class="pm-btn ghost" type="button" data-memory-remove-file="${index}">Remove</button></div>`).join('')
      : '<div class="memory-detail-empty">No files selected yet.</div>';
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file instanceof File);
    const slots = Math.max(0, 12 - memoryAttachments.length);
    memoryAttachments.push(...files.slice(0, slots));
    if (files.length > slots) shell.showNotice('Only the first 12 memory attachments are kept.');
    renderAttachmentList();
  }

  function openComposer() {
    memoryAttachments = [];
    selectedId = '';
    page.querySelector('#memory-drawer-title').textContent = 'Add Memory';
    detailPanel.innerHTML = `<form class="memory-compose-form" data-memory-form><div class="memory-compose-help">Create a durable memory with a clear title, a short description, and the full text to index.</div><label class="memory-compose-field"><span>Title</span><input class="memory-compose-input" name="title" maxlength="140" placeholder="Give this memory a clear title" required/></label><label class="memory-compose-field"><span>Description</span><input class="memory-compose-input" name="description" maxlength="220" placeholder="Short summary for previews and search"/></label><label class="memory-compose-field"><span>Memory</span><textarea class="memory-compose-textarea" name="content" placeholder="Write the full memory here. This becomes the indexed node content."></textarea></label><label class="memory-compose-field"><span>Attachments</span><input data-memory-file-input type="file" multiple hidden/><button class="pm-btn ghost" data-memory-choose-files type="button">Choose files</button><div data-memory-attachments class="memory-related-list"></div></label><div class="memory-compose-actions"><button class="pm-btn ghost" type="button" data-memory-close-detail>Cancel</button><button class="pm-btn primary" type="submit">Create Memory</button></div></form>`;
    detailDrawer.style.display = 'flex';
    showControls(false);
    page.querySelector('[data-memory-form]')?.addEventListener('submit', addMemory);
    page.querySelector('[data-memory-choose-files]')?.addEventListener('click', () => page.querySelector('[data-memory-file-input]')?.click());
    page.querySelector('[data-memory-file-input]')?.addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
    renderAttachmentList();
  }

  function closeDetail() {
    detailDrawer.style.display = 'none';
    selectedId = '';
    detailPanel.innerHTML = '<div class="memory-detail-empty">Select a node to inspect its summary, source, and related records.</div>';
    drawGraph();
  }

  searchInput.addEventListener('input', () => { filterText = searchInput.value || ''; filteredGraph(); });
  typeSelect.addEventListener('change', () => { typeFilter = typeSelect.value || ''; filteredGraph(); });
  page.querySelector('#memory-edge-weight').addEventListener('input', (event) => { controls.minEdgeWeight = Number(event.target.value) / 100; page.querySelector('#memory-edge-weight-value').textContent = `${controls.minEdgeWeight.toFixed(2)}+`; filteredGraph(); });
  page.querySelector('#memory-show-labels').addEventListener('change', (event) => { controls.showLabels = event.target.checked; drawGraph(); });
  page.querySelector('#memory-organize-type').addEventListener('change', (event) => { controls.organizeByType = event.target.checked; if (!controls.organizeByType) { controls.separateByType = false; page.querySelector('#memory-separate-type').checked = false; } syncModeControls(); filteredGraph(); });
  page.querySelector('#memory-separate-type').addEventListener('change', (event) => { controls.separateByType = event.target.checked; if (controls.separateByType) { controls.organizeByType = true; page.querySelector('#memory-organize-type').checked = true; } syncModeControls(); filteredGraph(); });
  ['speed','depth','glow'].forEach((key) => page.querySelector(`#memory-${key}`).addEventListener('input', (event) => {
    controls[key] = Number(event.target.value);
    page.querySelector(`#memory-${key}-value`).textContent = String(controls[key]);
    if (key === 'depth') drawGraph();
    if (key === 'glow') drawGraph();
    if (key === 'speed') scheduleMotion();
  }));
  page.querySelectorAll('[data-memory-mode]').forEach((button) => button.addEventListener('click', () => {
    if (controls.separateByType) return;
    setParticleMode(button.dataset.memoryMode);
  }));
  syncModeControls();
  showControls(false);
  page.querySelectorAll('[data-memory-controls]').forEach((button) => button.addEventListener('click', () => showControls()));
  page.querySelector('[data-memory-close-controls]')?.addEventListener('click', () => showControls(false));
  page.querySelector('[data-memory-close-detail]')?.addEventListener('click', closeDetail);
  page.querySelector('[data-memory-add]')?.addEventListener('click', openComposer);
  page.querySelector('[data-memory-image-shape]')?.addEventListener('click', () => imageInput?.click());
  imageInput?.addEventListener('change', (event) => { applyImageShape(event.target.files?.[0]); event.target.value = ''; });
  defaultShapeButton?.addEventListener('click', toggleDefaultShape);
  updateDefaultShapeButton();
  page.querySelector('#memory-save-settings')?.addEventListener('click', () => {
    try { localStorage.setItem(MEMORY_SETTINGS_KEY, JSON.stringify(controls)); shell.showNotice('Memory graph settings saved.'); }
    catch { shell.showNotice('Could not save memory graph settings.'); }
  });
  detailPanel.addEventListener('click', (event) => {
    const close = event.target.closest('[data-memory-close-detail]');
    if (close) closeDetail();
    const remove = event.target.closest('[data-memory-remove-file]');
    if (remove) { memoryAttachments.splice(Number(remove.dataset.memoryRemoveFile), 1); renderAttachmentList(); }
  });
  canvasEl.addEventListener('pointerdown', pointerDown);
  canvasEl.addEventListener('pointermove', pointerMove);
  canvasEl.addEventListener('pointerup', pointerUp);
  canvasEl.addEventListener('pointercancel', pointerCancel);
  canvasEl.addEventListener('pointerleave', pointerLeave);
  canvasEl.addEventListener('wheel', wheel, { passive: false });
  if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(drawGraph); resizeObserver.observe(stageEl); }
  const onResize = () => drawGraph();
  const onVisibility = () => scheduleMotion();
  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  function scheduleMotion() {
    clearTimeout(motionTimer);
    if (disposed || !controls.speed || document.visibilityState === 'hidden' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    motionTimer = window.setTimeout(() => {
      sceneTime += (controls.speed / 100) * 0.016 * (90 / 16);
      drawGraph();
      scheduleMotion();
    }, 90);
  }

  const onHeaderRefresh = () => loadGraph(true);
  disposeHeader = wireDetailHeader(shell, onHeaderRefresh);
  loadGraph();
  scheduleMotion();

  return () => {
    disposed = true;
    graphGeneration += 1;
    clearTimeout(motionTimer);
    disposeHeader();
    resizeObserver?.disconnect();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    canvasEl.removeEventListener('pointerdown', pointerDown);
    canvasEl.removeEventListener('pointermove', pointerMove);
    canvasEl.removeEventListener('pointerup', pointerUp);
    canvasEl.removeEventListener('pointercancel', pointerCancel);
    canvasEl.removeEventListener('pointerleave', pointerLeave);
    drag = null;
    memoryAttachments = [];
    canvasEl.removeEventListener('wheel', wheel);
    page.classList.remove('is-v2-memory');
    particleSpriteCache.clear();
  };
}

export async function mountHubPage({ shell, features, route }) {
  if (route?.name === 'audit') return mountAuditPage({ shell, features });
  if (route?.name === 'memory') return mountMemoryPage({ shell, features });
  shell.setActiveTab(route?.name === 'hub' ? 'hub' : 'chat');
  shell.setTitle(route?.name === 'hub' ? 'Hub' : (route?.name || 'More'));
  if (route?.name === 'hub') shell.renderHeader?.({ rightActions: `<button type="button" class="pm-icon-btn" data-action="hub-refresh" aria-label="Refresh" title="Refresh">${HUB_REFRESH_ICON}</button>` });
  const page = shell.page;
  let disposed = false;
  let overviewGeneration = 0;

  async function overview() {
    const generation = ++overviewGeneration;
    page.innerHTML = `<div class="pm-v2-page-scroll pm-hub-profile-page">${loading('Loading Hub…')}</div>`;
    try {
      const data = await features.hubOverview();
      if (disposed || generation !== overviewGeneration) return;
      const modelPayload = data.models || {};
      const toolPayload = data.tools || {};
      const modelStats = modelPayload.stats || {};
      const toolStats = toolPayload.stats || {};
      const tokenActivity = tokenActivityFrom(modelPayload);
      const tokenStats = tokenActivity.stats;
      const totalTokens = Number(tokenStats.totalTokens || modelStats.totalTokens || modelStats.total || 0);
      const peakTokens = Number(tokenStats.peakTokens || 0);
      const activeDays = Number(tokenStats.activeDays || toolStats.activeDays || modelStats.activeDays || 0);
      const currentStreak = Number(tokenStats.current ?? tokenStats.currentStreak ?? toolStats.currentStreak ?? modelStats.currentStreak ?? 0);
      const longestStreak = Number(tokenStats.longest ?? tokenStats.longestStreak ?? toolStats.longestStreak ?? modelStats.longestStreak ?? 0);
      const modelCalls = Number(modelStats.modelCalls ?? modelStats.messages ?? 0);
      const toolCalls = Number(toolStats.toolCalls || toolStats.total || 0);
      const sessions = Number(toolStats.chatSessions || modelStats.chatSessions || 0);
      const peakHour = toolStats.peakHour || modelStats.peakHour || '-';
      const topModels = Array.isArray(modelPayload.topModels) ? modelPayload.topModels : [];
      const topTools = Array.isArray(toolPayload.topTools) ? toolPayload.topTools : [];
      const goals = Array.isArray(data.goals) ? data.goals.slice().sort((a, b) => {
        const dateA = Date.parse(a?.updatedAt || a?.completedAt || a?.createdAt || 0) || 0;
        const dateB = Date.parse(b?.updatedAt || b?.completedAt || b?.createdAt || 0) || 0;
        return dateB - dateA;
      }) : [];
      const account = hubAccount();
      page.innerHTML = `<div class="pm-v2-page-scroll pm-hub-profile-page">
        <div class="pm-hub-profile-hero">
          <div class="pm-hub-avatar">${escapeHtml(initials(account.name))}</div>
          <h1>${escapeHtml(account.name)}</h1>
          <p><span>${escapeHtml(account.handle)}</span><span>Prometheus</span></p>
        </div>
        <section class="pm-hub-profile-stats">
          <span><b>${escapeHtml(compactNumber(totalTokens))}</b><em>Lifetime tokens</em></span>
          <span><b>${escapeHtml(compactNumber(peakTokens))}</b><em>Peak tokens</em></span>
          <span><b>${escapeHtml(compactNumber(modelCalls))}</b><em>Model calls</em></span>
          <span><b>${escapeHtml(`${currentStreak}d`)}</b><em>Current streak</em></span>
          <span><b>${escapeHtml(`${longestStreak}d`)}</b><em>Longest streak</em></span>
        </section>
        <section class="pm-hub-profile-section">
          <div class="pm-hub-section-head"><strong>Token activity</strong><span>${escapeHtml(compactNumber(totalTokens))} total</span></div>
          ${tokenActivityGrid(tokenActivity)}
        </section>
        <section class="pm-hub-profile-columns">
          <div class="pm-hub-profile-section">
            <div class="pm-hub-section-head"><strong>Activity insights</strong></div>
            <div class="pm-hub-insight-list">
              <span><em>Active days</em><b>${escapeHtml(compactNumber(activeDays))}</b></span>
              <span><em>Tool calls</em><b>${escapeHtml(compactNumber(toolCalls))}</b></span>
              <span><em>Sessions</em><b>${escapeHtml(compactNumber(sessions))}</b></span>
              <span><em>Peak hour</em><b>${escapeHtml(String(peakHour))}</b></span>
            </div>
          </div>
          <div class="pm-hub-profile-section">
            <div class="pm-hub-section-head"><strong>Most used models</strong></div>
            <div class="pm-hub-usage-list">
              ${topModels.slice(0, 4).map((model) => `<span><b>${escapeHtml(model.name || model.model || 'Model')}</b><em>${escapeHtml(compactNumber(model.tokens || 0))} tokens</em></span>`).join('') || '<p>No model usage yet.</p>'}
            </div>
          </div>
        </section>
        ${latestGoalSection(goals[0] || null)}
        <section class="pm-hub-profile-section">
          <div class="pm-hub-section-head"><strong>Most used tools</strong></div>
          <div class="pm-hub-usage-list">
            ${topTools.slice(0, 6).map((tool) => `<span><b>${escapeHtml(tool.name || tool.tool || 'Tool')}</b><em>${escapeHtml(compactNumber(tool.count || tool.calls || 0))} calls</em></span>`).join('') || '<p>No tool usage yet.</p>'}
          </div>
        </section>
      </div>`;
      wireTokenActivity(page);
    } catch (error) {
      if (disposed || generation !== overviewGeneration) return;
      page.innerHTML = `<div class="pm-v2-page-scroll pm-hub-profile-page">${pageHeading('Hub')}${errorState(error)}</div>`;
      page.querySelector('[data-v2-retry]')?.addEventListener('click', overview);
    }
  }

  async function audit() {
    page.innerHTML = `${pageHeading('Audit', 'Recent non-main activity')}${loading('Loading audit…')}`;
    const response = await features.audit().catch((error) => ({ error }));
    if (disposed) return;
    if (response.error) { page.innerHTML += errorState(response.error); return; }
    const rows = response.runs || response.entries || response.items || [];
    page.innerHTML = `${pageHeading('Audit', 'Recent non-main activity')}${card('', rows.length ? `<div class="pm-v2-event-list">${rows.slice(0, 80).map((row) => `<div><strong>${escapeHtml(row.action || row.type || row.event || 'Activity')}</strong><span>${escapeHtml(row.summary || row.message || row.actor || '')} ${row.createdAt ? `• ${escapeHtml(asTime(row.createdAt))}` : ''}</span></div>`).join('')}</div>` : '<p class="pm-v2-muted">No recent audit entries.</p>')}`;
  }

  async function memory() {
    page.innerHTML = `${pageHeading('Memory', 'Recent associative memory')}${loading('Loading memory…')}`;
    const graph = await features.memory().catch((error) => ({ error }));
    if (disposed) return;
    if (graph.error) { page.innerHTML += errorState(graph.error); return; }
    const nodes = graph.nodes || graph.items || [];
    page.innerHTML = `${pageHeading('Memory', 'Recent associative memory')}<div class="pm-v2-metric-grid"><div><strong>${nodes.length}</strong><span>Nodes</span></div><div><strong>${(graph.edges || []).length}</strong><span>Links</span></div></div>${card('Recent', nodes.length ? `<div class="pm-v2-event-list">${nodes.slice(-40).reverse().map((node) => `<div><strong>${escapeHtml(node.title || node.type || node.id || 'Memory')}</strong><span>${escapeHtml(node.summary || node.text || node.content || '')}</span></div>`).join('')}</div>` : '<p class="pm-v2-muted">No memory graph entries were returned.</p>')}`;
  }

  document.querySelector('#pm-v2-header-slot [data-action="hub-refresh"]')?.addEventListener('click', overview);
  if (route?.name === 'audit') audit();
  else if (route?.name === 'memory') memory();
  else overview();
  return () => { disposed = true; };
}
