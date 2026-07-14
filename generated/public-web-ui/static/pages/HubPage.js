/**
 * HubPage.js — Hub view (usage tracker)
 *
 * Sections:
 *  - Top skills row (4 by default, "View all" expands the grid)
 *  - Achievements (left pane, definitions array — fill in later)
 *  - Tool-usage heatmap (right pane, by month)
 */

import { api } from '../api.js';
import { escHtml, renderMd } from '../utils.js';
import { wsEventBus } from '../ws.js';

const SKILL_DESKTOP_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="5" width="16" height="11" rx="2"></rect>
    <path d="M9 20h6"></path>
    <path d="M12 16v4"></path>
  </svg>
`;

// ─── Achievement definitions ─────────────────────────────────────────────────
// TODO: define achievements here. Shape:
// { id, name, description, icon, earned: boolean, earnedAt?: string, progress?: { value, target } }
const ACHIEVEMENTS = [
  // Empty by design — fill in later.
];

// ─── State ───────────────────────────────────────────────────────────────────
let _range = 'week';
let _viewAll = false;
const _expanded = new Set();
let _skills = [];
let _hubSkillSearch = '';
let _goals = [];
let _curator = { suggestions: [], activity: [], pending: 0, quarantined: 0, appliedActivity: 0, observedActivity: 0, loading: false, actingId: '' };
const _heatmap = { year: 0, month: 0, counts: {} };
const _tokenActivity = { daily: [], stats: null };
const _stats = { mode: 'overview', range: 'all', tools: null, models: null, loading: false };
const _providers = { items: [], loading: false, loaded: false };
try {
  const m = localStorage.getItem('hub_stats_mode');
  if (m === 'overview' || m === 'models') _stats.mode = m;
  const r = localStorage.getItem('hub_stats_range');
  if (r === 'all' || r === '30d' || r === '7d' || r === '1d') _stats.range = r;
} catch {}
// Current-week bar chart data: 7 entries Sun→Sat for the week containing today.
// This is independent of the heatmap's navigated month so paging back/forward
// through months does not change the bar chart.
const _week = { startISO: '', counts: {} };

try {
  const r = localStorage.getItem('hub_range');
  if (r === 'day' || r === 'week' || r === 'month') _range = r;
  _viewAll = localStorage.getItem('hub_skills_viewall') === '1';
  _hubSkillSearch = localStorage.getItem('hub_skill_search') || '';
} catch {}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  } catch { return '—'; }
}

function relTime(iso) {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!isFinite(t)) return 'never';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  return fmtDate(iso);
}

function heatmapLevel(count, max) {
  if (!count) return 0;
  if (max <= 0) return 0;
  // 5 graduated levels above 0; ensures even small max values produce visible color
  const r = count / max;
  if (r > 0.85) return 5;
  if (r > 0.65) return 4;
  if (r > 0.45) return 3;
  if (r > 0.25) return 2;
  return 1;
}

function monthLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function shortMonthDay(year, month, day) {
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sumCounts(counts) {
  let total = 0;
  for (const k in counts) total += (counts[k] || 0);
  return total;
}

// Returns the Sunday at the start of the week containing `d` (local time).
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Renderers ───────────────────────────────────────────────────────────────
function labelize(value) {
  const text = String(value || '').trim();
  if (!text) return 'Unknown';
  return text.replace(/[-_]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

function renderSkillBadges(s) {
  const lifecycle = String(s.lifecycle || '').trim();
  const ownership = String(s.ownership || '').trim();
  const status = String(s.status || '').trim();
  const badges = [];
  if (lifecycle) badges.push(`<span class="hub-skill-badge lifecycle" data-value="${escHtml(lifecycle)}">${escHtml(labelize(lifecycle))}</span>`);
  if (ownership) badges.push(`<span class="hub-skill-badge ownership" data-value="${escHtml(ownership)}">${escHtml(labelize(ownership))}</span>`);
  if (!lifecycle && status) badges.push(`<span class="hub-skill-badge status" data-value="${escHtml(status)}">${escHtml(labelize(status))}</span>`);
  return badges.length ? `<div class="hub-skill-badges">${badges.join('')}</div>` : '';
}

function stripMarkdownFrontmatter(md) {
  const text = String(md || '');
  return text.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trimStart();
}

function renderSkillChanges(changes, limit = 3) {
  const items = Array.isArray(changes) ? changes.slice(0, limit) : [];
  if (!items.length) return `<div class="hub-skill-change-empty">No recent skill changes.</div>`;
  return `
    <div class="hub-skill-change-list">
      ${items.map(ch => {
        const type = labelize(ch.changeType || 'skill_update');
        const when = relTime(ch.timestamp);
        const reason = String(ch.reason || '').trim();
        const paths = Array.isArray(ch.changedPaths) ? ch.changedPaths.filter(Boolean) : [];
        const appliedBy = String(ch.appliedBy || '').trim();
        const evidence = String(ch.evidence || '').trim();
        const metadata = ch.metadata && typeof ch.metadata === 'object' ? ch.metadata : null;
        const details = JSON.stringify({
          changeType: ch.changeType || 'skill_update',
          timestamp: ch.timestamp || '',
          reason,
          changedPaths: paths,
          evidence,
          appliedBy,
          ...(metadata ? { metadata } : {}),
        }, null, 2);
        return `
          <div class="hub-skill-change" data-hub-change-card tabindex="0" role="button" aria-expanded="false">
            <div class="hub-skill-change-main">
              <span class="hub-skill-change-type">${escHtml(type)}</span>
              <span class="hub-skill-change-time" title="${escHtml(fmtDate(ch.timestamp))}">${escHtml(when)}</span>
            </div>
            ${reason ? `<div class="hub-skill-change-reason">${escHtml(reason)}</div>` : ''}
            ${paths.length ? `<div class="hub-skill-change-paths">${paths.slice(0, 3).map(p => `<span>${escHtml(p)}</span>`).join('')}</div>` : ''}
            ${appliedBy ? `<div class="hub-skill-change-by">${escHtml(appliedBy)}</div>` : ''}
            <div class="hub-skill-change-detail"><pre>${escHtml(details)}</pre></div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderSkillAddons(skill) {
  const resources = Array.isArray(skill?.resources) ? skill.resources : [];
  if (!resources.length) return '';
  return `
    <details class="hub-modal-addons">
      <summary><span>Add-ons</span><strong>${resources.length} file${resources.length === 1 ? '' : 's'}</strong></summary>
      <div class="hub-modal-resource-list">
        ${resources.map((resource) => {
          const relPath = String(resource?.path || '').trim();
          if (!relPath) return '';
          const type = String(resource?.type || '').trim();
          const size = Number(resource?.sizeBytes || 0);
          const desc = String(resource?.description || '').trim();
          return `
            <button class="hub-modal-resource-item" type="button" data-skill-id="${escHtml(skill.id)}" data-resource-path="${escHtml(relPath)}">
              <span class="hub-modal-resource-path">${escHtml(relPath)}</span>
              <span class="hub-modal-resource-meta">${escHtml([type, size ? `${size.toLocaleString()} bytes` : '', desc].filter(Boolean).join(' · '))}</span>
            </button>
          `;
        }).join('')}
      </div>
      <div id="hub-modal-resource-preview" class="hub-modal-resource-preview">
        <div class="hub-modal-resource-empty">Select a file to preview it.</div>
      </div>
    </details>
  `;
}

function renderSkillCard(s) {
  const isOpen = _expanded.has(s.id);
  const recentChanges = Array.isArray(s.recentChanges) ? s.recentChanges : [];
  return `
    <div class="hub-skill-card${isOpen ? ' open' : ''}" data-skill-id="${escHtml(s.id)}">
      <div class="hub-skill-card-head" data-action="toggle" data-id="${escHtml(s.id)}">
        <div class="hub-skill-icon">${SKILL_DESKTOP_ICON}</div>
        <div class="hub-skill-name" title="${escHtml(s.name)}">${escHtml(s.name)}</div>
        ${renderSkillBadges(s)}
        <div class="hub-skill-count">${s.count} ${s.count === 1 ? 'use' : 'uses'}</div>
        <div class="hub-skill-preview">${escHtml((s.description || '').slice(0, 90))}${(s.description || '').length > 90 ? '…' : ''}</div>
      </div>
      <div class="hub-skill-card-body">
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Version</span><span class="hub-skill-meta-val">${escHtml(s.version || '—')}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Lifecycle</span><span class="hub-skill-meta-val">${escHtml(labelize(s.lifecycle || s.status))}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Ownership</span><span class="hub-skill-meta-val">${escHtml(labelize(s.ownership))}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Last used</span><span class="hub-skill-meta-val" title="${escHtml(fmtDate(s.lastUsed))}">${escHtml(relTime(s.lastUsed))}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Last modified</span><span class="hub-skill-meta-val" title="${escHtml(fmtDate(s.lastModified))}">${escHtml(relTime(s.lastModified))}</span></div>
        <div class="hub-skill-card-changes">
          <div class="hub-skill-card-changes-title">Recent changes</div>
          ${renderSkillChanges(recentChanges, 2)}
        </div>
        <div class="hub-skill-card-actions">
          <button class="hub-skill-view-btn" data-action="view" data-id="${escHtml(s.id)}" type="button">View</button>
          <button class="hub-skill-view-btn secondary" data-action="edit" data-id="${escHtml(s.id)}" type="button">Edit</button>
        </div>
      </div>
    </div>
  `;
}

function skillMatchesSearch(s, query) {
  if (!query) return true;
  const requires = s.requires || {};
  const assignment = s.assignment || {};
  const toolBinding = s.toolBinding || {};
  const parts = [
    s.id,
    s.name,
    s.description,
    s.version,
    s.lifecycle,
    s.ownership,
    s.manifestSource,
    s.status,
    s.eligibility?.status,
    s.safety?.verdict,
    assignment.agentId,
    assignment.teamId,
    assignment.mode,
    toolBinding.mode,
    ...(Array.isArray(requires.tools) ? requires.tools : []),
    ...(Array.isArray(requires.connectors) ? requires.connectors : []),
    ...(Array.isArray(requires.plugins) ? requires.plugins : []),
    ...(Array.isArray(s.triggers) ? s.triggers : []),
  ];
  return parts.join(' ').toLowerCase().includes(query);
}

function renderSkillsGrid() {
  const grid = document.getElementById('hub-skills-grid');
  if (!grid) return;
  const query = _hubSkillSearch.trim().toLowerCase();
  const filtered = _skills.filter(s => skillMatchesSearch(s, query));
  const visible = query || _viewAll ? filtered : filtered.slice(0, 4);
  if (!visible.length) {
    grid.innerHTML = `<div class="hub-empty">${query ? 'No matching skills found.' : 'No skills found.'}</div>`;
    grid.classList.toggle('hub-skills-grid-all', Boolean(query) || _viewAll);
    return;
  }
  grid.innerHTML = visible.map(renderSkillCard).join('');
  grid.classList.toggle('hub-skills-grid-all', Boolean(query) || _viewAll);
  wireHubSkillChangeCards(grid);

  grid.querySelectorAll('[data-action="toggle"]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-id');
      if (!id) return;
      if (_expanded.has(id)) _expanded.delete(id); else _expanded.add(id);
      renderSkillsGrid();
    });
  });
  grid.querySelectorAll('[data-action="view"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.getAttribute('data-id');
      if (id) openHubSkillModal(id);
    });
  });
  grid.querySelectorAll('[data-action="edit"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.getAttribute('data-id');
      if (id && typeof window.editSkill === 'function') window.editSkill(id);
    });
  });
}

function renderAchievements() {
  const grid = document.getElementById('hub-achievements-grid');
  if (!grid) return;
  if (!ACHIEVEMENTS.length) {
    grid.innerHTML = `<div class="hub-empty">No achievements yet.</div>`;
    return;
  }
  grid.innerHTML = ACHIEVEMENTS.map(a => `
    <div class="hub-achievement${a.earned ? ' earned' : ' locked'}" title="${escHtml(a.description || '')}">
      <div class="hub-achievement-icon">${escHtml(a.icon || '🏆')}</div>
      <div class="hub-achievement-name">${escHtml(a.name || a.id || '—')}</div>
      ${a.progress ? `<div class="hub-achievement-progress"><div class="hub-achievement-progress-bar" style="width:${Math.min(100, Math.round((a.progress.value / Math.max(1, a.progress.target)) * 100))}%"></div></div>` : ''}
    </div>
  `).join('');
}

function renderGoals() {
  const grid = document.getElementById('hub-achievements-grid');
  if (!grid) return;
  if (!_goals.length) {
    grid.innerHTML = `<div class="hub-empty">No main-chat goals yet.</div>`;
    return;
  }
  grid.innerHTML = _goals.map(g => {
    const status = String(g.status || 'unknown').trim().toLowerCase() || 'unknown';
    const summary = String(g.progressSummary || g.lastReason || g.blockedReason || g.pausedReason || g.failureReason || '').trim();
    const deniedActions = Array.isArray(g.deniedActions) ? g.deniedActions : [];
    const latestDenial = deniedActions[deniedActions.length - 1] || null;
    const updatedIso = Number(g.updatedAt || g.createdAt || 0) ? new Date(Number(g.updatedAt || g.createdAt)).toISOString() : '';
    return `
      <div class="hub-goal-card" data-status="${escHtml(status)}" title="${escHtml(g.goal || '')}">
        <div class="hub-goal-card-head">
          <div class="hub-goal-status">${escHtml(status)}${g.current ? ' · current' : ''}</div>
          <div class="hub-goal-turns">${Number(g.turnsUsed || 0)} turns</div>
        </div>
        <div class="hub-goal-title">${escHtml(g.goal || 'Untitled goal')}</div>
        <div class="hub-goal-meta">
          <span>${escHtml(g.sessionTitle || g.sessionId || 'session')}</span>
          <span>${escHtml(relTime(updatedIso))}</span>
          <span>Autonomous</span>
          <span>Hard policy</span>
          ${deniedActions.length ? `<span>${deniedActions.length} denied</span>` : ''}
        </div>
        ${latestDenial ? `<div class="hub-goal-denial">${escHtml(`${latestDenial.category || 'policy'}: ${latestDenial.reason || 'Blocked by hard policy.'}`)}</div>` : ''}
        ${summary ? `<div class="hub-goal-summary">${escHtml(summary)}</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderHeatmap() {
  const grid = document.getElementById('hub-heatmap-grid');
  const label = document.getElementById('hub-heatmap-label');
  if (!grid || !label) return;
  const stats = _tokenActivity.stats || {};
  const daily = Array.isArray(_tokenActivity.daily) ? _tokenActivity.daily : [];
  label.textContent = `${compactNumber(stats.totalTokens || sumCounts(Object.fromEntries(daily.map((d) => [d.date, d.tokens || d.count || 0]))))} tokens`;
  if (!daily.length) {
    grid.innerHTML = `<div class="hub-empty">No token activity recorded yet.</div>`;
    return;
  }
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let labelsHtml = '<div class="hub-heat-daylabels">';
  for (let i = 0; i < 7; i++) {
    labelsHtml += `<div class="hub-heat-daylabel">${dayLabels[i]}</div>`;
  }
  labelsHtml += '</div>';

  const first = new Date(`${daily[0].date}T00:00:00`);
  const leading = Number.isFinite(first.getTime()) ? first.getDay() : 0;
  const values = daily.map((row) => Math.max(0, Number(row.tokens || row.count || 0)));
  const max = Math.max(1, ...values);
  let cellsHtml = `<div class="hub-heatmap-cells hub-token-activity-cells">`;
  for (let i = 0; i < leading; i++) {
    cellsHtml += `<div class="hub-heat-cell hub-heat-empty"></div>`;
  }
  daily.forEach((row) => {
    const tokens = Math.max(0, Number(row.tokens || row.count || 0));
    const lvl = heatmapLevel(tokens, max);
    const tip = `${row.date} — ${compactNumber(tokens)} token${tokens === 1 ? '' : 's'}`;
    cellsHtml += `<div class="hub-heat-cell" data-level="${lvl}" title="${escHtml(tip)}"></div>`;
  });
  cellsHtml += '</div>';

  const months = [];
  const seen = new Set();
  daily.forEach((row, index) => {
    const [year, month] = String(row.date || '').split('-');
    const key = `${year}-${month}`;
    if (!year || !month || seen.has(key)) return;
    seen.add(key);
    const d = new Date(`${row.date}T00:00:00`);
    months.push(`<span style="grid-column:${Math.floor((leading + index) / 7) + 1}">${escHtml(d.toLocaleDateString(undefined, { month: 'short' }))}</span>`);
  });
  grid.innerHTML = `<div class="hub-token-activity-wrap">${labelsHtml}<div><div class="hub-token-months">${months.join('')}</div>${cellsHtml}</div></div>`;
}

// Render the current-week bar chart + summary. Independent of heatmap navigation.
function renderWeekBars() {
  const bars = document.getElementById('hub-daily-bars');
  const summary = document.getElementById('hub-daily-summary');
  if (!bars || !summary) return;

  const start = _week.startISO ? new Date(_week.startISO + 'T00:00:00') : startOfWeek(new Date());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push({ key: dateKey(d), date: d });
  }

  const counts = days.map(d => _week.counts[d.key] || 0);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const activeDays = counts.filter(v => v > 0).length;
  const denom = activeDays > 0 ? activeDays : 7;
  const avg = Math.round(total / denom);

  const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endStr = days[6].date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  summary.innerHTML = `
    <div class="hub-daily-summary-left">
      <div class="hub-daily-summary-label">Daily Average · This Week</div>
      <div class="hub-daily-summary-value">${avg.toLocaleString()}<span class="hub-daily-summary-unit">tool calls</span></div>
      <div class="hub-daily-summary-range">${escHtml(startStr)} – ${escHtml(endStr)}</div>
    </div>
    <div class="hub-daily-summary-total">${total.toLocaleString()} total</div>
  `;

  const dayShort = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let html = '';
  for (let i = 0; i < 7; i++) {
    const c = counts[i];
    const pct = c > 0 ? Math.max(2, Math.round((c / max) * 100)) : 0;
    const cls = c > 0 ? 'hub-daily-bar' : 'hub-daily-bar empty';
    const tip = `${days[i].key} — ${c} tool call${c === 1 ? '' : 's'}`;
    html += `
      <div class="hub-daily-col" title="${escHtml(tip)}">
        <div class="hub-daily-bar-wrap">
          <div class="${cls}" style="height:${pct}%"></div>
        </div>
        <div class="hub-daily-bar-label">${dayShort[i]}</div>
      </div>
    `;
  }
  bars.innerHTML = html;
}

// ─── Stats panel (Overview / Models) ─────────────────────────────────────────
function compactNumber(n) {
  const value = Number(n) || 0;
  if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(value >= 1e10 ? 0 : 1) + 'B';
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(value >= 1e7 ? 0 : 1) + 'M';
  if (Math.abs(value) >= 1e4) return (value / 1e3).toFixed(0) + 'K';
  if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toLocaleString();
}

function formatCostMicros(micros) {
  const value = Math.max(0, Number(micros) || 0);
  const usd = value / 1000000;
  if (usd <= 0) return '$0';
  if (usd >= 100) return '$' + usd.toFixed(0);
  if (usd >= 1) return '$' + usd.toFixed(2);
  if (usd >= 0.01) return '$' + usd.toFixed(3);
  return '$' + usd.toFixed(5);
}

function formatDurationMs(ms) {
  const value = Math.max(0, Number(ms) || 0);
  if (value <= 0) return '—';
  if (value < 1000) return Math.round(value) + 'ms';
  if (value < 10000) return (value / 1000).toFixed(2) + 's';
  if (value < 60000) return (value / 1000).toFixed(1) + 's';
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return minutes + 'm' + (seconds ? ' ' + seconds + 's' : '');
}

function renderStatTile(label, value, sub) {
  return `
    <div class="hub-stat-tile">
      <div class="hub-stat-label">${escHtml(label)}</div>
      <div class="hub-stat-value">${escHtml(String(value))}</div>
      ${sub ? `<div class="hub-stat-sub">${escHtml(sub)}</div>` : ''}
    </div>
  `;
}

function renderToolsCostTable(data) {
  const rows = Array.isArray(data.expensiveTools) && data.expensiveTools.length
    ? data.expensiveTools
    : (Array.isArray(data.topTools) ? data.topTools : []);
  if (!rows.length) return `<div class="hub-empty">No tool telemetry recorded yet.</div>`;
  return `
    <div class="hub-models-table is-tools">
      <div class="hub-models-row hub-models-head">
        <div>Tool</div>
        <div class="hub-models-num">Calls</div>
        <div class="hub-models-num">Context</div>
        <div class="hub-models-num">Avg</div>
        <div class="hub-models-num">Max</div>
        <div class="hub-models-num">Est. Cost</div>
      </div>
      ${rows.slice(0, 10).map(row => `
        <div class="hub-models-row">
          <div class="hub-models-name" title="${escHtml(row.name)}">${escHtml(row.name)}</div>
          <div class="hub-models-num">${escHtml(compactNumber(Number(row.count) || 0))}</div>
          <div class="hub-models-num">${escHtml(compactNumber(Number(row.contextTokens) || 0))}</div>
          <div class="hub-models-num">${escHtml(formatDurationMs(row.durationMsAvg))}</div>
          <div class="hub-models-num">${escHtml(formatDurationMs(row.durationMsMax))}</div>
          <div class="hub-models-num">${escHtml(formatCostMicros(row.totalCostMicros))}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderStatsTiles() {
  const tilesEl = document.getElementById('hub-stats-tiles');
  const modelsEl = document.getElementById('hub-stats-models');
  const footnoteEl = document.getElementById('hub-stats-footnote');
  if (!tilesEl || !modelsEl) return;

  if (_stats.loading) {
    tilesEl.innerHTML = `<div class="hub-empty">Loading…</div>`;
    modelsEl.style.display = 'none';
    if (footnoteEl) footnoteEl.textContent = '';
    return;
  }

  if (_stats.mode === 'overview') {
    const t = (_stats.tools && _stats.tools.stats) || {};
    const m = (_stats.models && _stats.models.stats) || {};
    const sessions = t.chatSessions || m.chatSessions || 0;
    const messages = t.messages || 0;
    const totalTokens = m.totalTokens || 0;
    const activeDays = t.activeDays || m.activeDays || 0;
    const currentStreak = t.currentStreak || 0;
    const peakHour = t.peakHour && t.peakHour !== '—' ? t.peakHour : (m.peakHour || '—');
    const favoriteModel = m.favorite && m.favorite !== '—' ? m.favorite : (t.favorite || '—');
    const modelCostMicros = Number(m.totalCostMicros || 0);
    const toolDirectCostMicros = Number(t.directCostMicros || 0);
    const toolContextCostMicros = Number(t.contextCostMicros || 0);
    const estimatedSpendMicros = modelCostMicros + toolDirectCostMicros;

    tilesEl.innerHTML = [
      renderStatTile('Est. spend', formatCostMicros(estimatedSpendMicros), 'model + direct tool'),
      renderStatTile('Model cost', formatCostMicros(modelCostMicros), compactNumber(totalTokens) + ' tokens'),
      renderStatTile('Tool context', formatCostMicros(toolContextCostMicros), compactNumber(t.contextTokens || 0) + ' tokens'),
      renderStatTile('Avg tool', formatDurationMs(t.durationMsAvg), 'max ' + formatDurationMs(t.durationMsMax)),
      renderStatTile('Sessions', compactNumber(sessions)),
      renderStatTile('Messages', compactNumber(messages)),
      renderStatTile('Tool calls', compactNumber(t.toolCalls || t.total || 0)),
      renderStatTile('Active days', String(activeDays)),
      renderStatTile('Current streak', currentStreak + 'd'),
      renderStatTile('Peak hour', String(peakHour)),
      renderStatTile('Favorite model', String(favoriteModel)),
    ].join('');
    modelsEl.innerHTML = renderToolsCostTable(_stats.tools || {});
    modelsEl.style.display = '';
    if (footnoteEl) {
      const modelSummary = (_stats.models && _stats.models.summary) || '';
      const toolSummary = (_stats.tools && _stats.tools.summary) || '';
      footnoteEl.textContent = [modelSummary, toolSummary].filter(Boolean).join(' ');
    }
    return;
  }

  // Models view
  const data = _stats.models || {};
  const s = data.stats || {};
  const topModels = Array.isArray(data.topModels) ? data.topModels : [];
  const topProviders = Array.isArray(data.topProviders) ? data.topProviders : [];
  const totalForShare = topModels.reduce((sum, x) => sum + (Number(x.tokens) || 0), 0) || 1;

  tilesEl.innerHTML = [
    renderStatTile('Est. cost', formatCostMicros(s.totalCostMicros || 0)),
    renderStatTile('Total tokens', compactNumber(s.totalTokens || 0)),
    renderStatTile('Input', compactNumber(s.inputTokens || 0)),
    renderStatTile('Output', compactNumber(s.outputTokens || 0)),
    renderStatTile('Reasoning', compactNumber(s.reasoningTokens || 0)),
    renderStatTile('Cache', compactNumber(s.cacheTokens || 0)),
    renderStatTile('Model calls', compactNumber(s.messages || 0)),
    renderStatTile('Model sessions', compactNumber(s.modelSessions || s.sessions || 0)),
    renderStatTile('Favorite', String(s.favorite || '—')),
  ].join('');

  const providersChips = topProviders.length
    ? `<div class="hub-models-providers">${topProviders.map(p => `
        <span class="hub-models-chip" title="${escHtml(compactNumber(p.tokens) + ' tokens · ' + formatCostMicros(p.costMicros))}">
          <span class="hub-models-chip-name">${escHtml(p.name)}</span>
          <span class="hub-models-chip-val">${escHtml(compactNumber(p.tokens))}</span>
          <span class="hub-models-chip-val">${escHtml(formatCostMicros(p.costMicros))}</span>
        </span>
      `).join('')}</div>`
    : '';

  if (!topModels.length) {
    modelsEl.innerHTML = `${providersChips}<div class="hub-empty">No model usage recorded yet.</div>`;
  } else {
    modelsEl.innerHTML = `
      ${providersChips}
      <div class="hub-models-table is-cost">
        <div class="hub-models-row hub-models-head">
          <div>Model</div>
          <div class="hub-models-num">Calls</div>
          <div class="hub-models-num">Tokens</div>
          <div class="hub-models-num">Cost</div>
          <div class="hub-models-num">Share</div>
          <div class="hub-models-bar-cell"></div>
        </div>
        ${topModels.map(row => {
          const tokens = Number(row.tokens) || 0;
          const share = (tokens / totalForShare) * 100;
          return `
            <div class="hub-models-row">
              <div class="hub-models-name" title="${escHtml(row.name)}">${escHtml(row.name)}</div>
              <div class="hub-models-num">${escHtml(compactNumber(Number(row.calls) || 0))}</div>
              <div class="hub-models-num">${escHtml(compactNumber(tokens))}</div>
              <div class="hub-models-num">${escHtml(formatCostMicros(row.costMicros))}</div>
              <div class="hub-models-num">${share.toFixed(1)}%</div>
              <div class="hub-models-bar-cell"><div class="hub-models-bar" style="width:${Math.max(2, Math.min(100, share))}%"></div></div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
  modelsEl.style.display = '';
  if (footnoteEl) footnoteEl.textContent = data.summary || '';
}

// ─── Connected providers / usage limits ───────────────────────────────────────
function gaugeClass(pct) {
  const p = Number(pct) || 0;
  if (p >= 90) return 'crit';
  if (p >= 75) return 'warn';
  return 'ok';
}

// Short relative hint, e.g. "in 3h", "in 12m", "in 6d".
function fmtRelative(diffMs) {
  if (diffMs <= 0) return 'soon';
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) {
    const rem = mins % 60;
    return rem ? `in ${hrs}h ${rem}m` : `in ${hrs}h`;
  }
  return `in ${Math.round(hrs / 24)}d`;
}

// Builds an exact reset string. Short windows (e.g. 5-hour) show a clock time;
// multi-day windows (Weekly / Opus weekly) show date AND time. A relative hint
// is appended so "Resets at 11:08 AM (in 3h)" reads at a glance.
function fmtReset(iso, label) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = t - Date.now();
  if (diff <= 0) return 'resets now';
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const rel = fmtRelative(diff);

  // Weekly/multi-day windows or anything more than ~24h out gets a date too.
  const isLong = /week|day|opus/i.test(String(label || '')) || diff >= 24 * 3600 * 1000;
  if (isLong) {
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `resets ${date}, ${time} (${rel})`;
  }
  return `resets at ${time} (${rel})`;
}

function renderUsageGauge(label, pct, resetIso) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const reset = fmtReset(resetIso, label);
  return `
    <div class="usage-gauge">
      <div class="usage-gauge-head">
        <span class="usage-gauge-label">${escHtml(label)}</span>
        <span class="usage-gauge-pct">${p}%</span>
      </div>
      <div class="usage-gauge-track"><div class="usage-gauge-fill ${gaugeClass(p)}" style="width:${p}%"></div></div>
      ${reset ? `<div class="usage-gauge-reset">${escHtml(reset)}</div>` : ''}
    </div>
  `;
}

// Renders one provider card. Shared shape: { provider, label, source, windows[], budget, tokens, error }.
export function renderProviderUsageCard(p) {
  const windows = Array.isArray(p.windows) ? p.windows : [];
  const tokens = p.tokens || {};
  let body = '';
  if (windows.length) {
    body += windows.map(w => renderUsageGauge(w.label, w.used_percent, w.reset_at)
      + (w.detail ? `<div class="usage-gauge-reset">${escHtml(w.detail)}</div>` : '')).join('');
  } else if (p.usage_scope === 'model') {
    body = `<div class="usage-provider-note">Codex Spark limit data is currently unavailable.</div>`;
  } else if (p.budget && p.budget.limit_tokens > 0) {
    body = renderUsageGauge('Monthly budget', p.budget.used_percent, null)
      + `<div class="usage-gauge-reset">${compactNumber(p.budget.used_tokens)} / ${compactNumber(p.budget.limit_tokens)} tokens</div>`;
  } else {
    body = `<div class="usage-provider-note">No limit data — tracking tokens only</div>`;
  }
  const badge = p.source === 'live'
    ? `<span class="usage-provider-badge live">live</span>`
    : `<span class="usage-provider-badge">tracked</span>`;
  const err = p.error ? `<div class="usage-provider-err">${escHtml(p.error)}</div>` : '';
  return `
    <div class="usage-provider-card" data-provider="${escHtml(p.provider)}">
      <div class="usage-provider-head">
        <span class="usage-provider-name">${escHtml(p.label || p.provider)}</span>
        ${badge}
      </div>
      ${body}
      ${err}
      <div class="usage-provider-foot">${p.plan_label ? `${escHtml(p.plan_label)} · ` : ''}${compactNumber(tokens.total || 0)} tokens · ${compactNumber(tokens.calls || 0)} calls</div>
    </div>
  `;
}

function renderProviders() {
  const grid = document.getElementById('hub-providers-grid');
  const section = document.getElementById('hub-providers-section');
  if (!grid) return;
  if (_providers.loading && !_providers.loaded) {
    grid.innerHTML = `<div class="hub-empty">Loading…</div>`;
    return;
  }
  const items = _providers.items || [];
  if (!items.length) {
    // Nothing configured — hide the section entirely to avoid an empty block.
    if (section) section.style.display = 'none';
    return;
  }
  if (section) section.style.display = '';
  grid.innerHTML = items.map(renderProviderUsageCard).join('');
}

async function loadProviders() {
  _providers.loading = true;
  renderProviders();
  try {
    const r = await api('/api/usage/limits', { timeoutMs: 30000 });
    _providers.items = (r && Array.isArray(r.providers)) ? r.providers : [];
  } catch {
    _providers.items = [];
  } finally {
    _providers.loading = false;
    _providers.loaded = true;
    renderProviders();
  }
}

// Skill Curator review queue
function curatorStatusClass(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'applied') return 'applied';
  if (s === 'rejected') return 'rejected';
  if (s === 'quarantined') return 'quarantined';
  return 'pending';
}

function curatorMarkdownSection(markdown, heading) {
  const text = String(markdown || '');
  if (!text) return '';
  const target = String(heading || '').trim().toLowerCase();
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const m = line.match(/^##\s+(.+?)\s*$/);
    return m && m[1].trim().toLowerCase() === target;
  });
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

function curatorFirstSentence(text, fallback = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  const sentence = cleaned.match(/^(.{30,220}?[.!?])(?:\s|$)/);
  return sentence ? sentence[1].trim() : cleaned.slice(0, 220);
}

function curatorToolLesson(markdown) {
  const section = curatorMarkdownSection(markdown, 'Tool Sequence');
  if (!section) return '';
  const tools = Array.from(section.matchAll(/^\s*[-*]\s*`?([a-zA-Z0-9_.:-]+)`?/gm)).map((m) => m[1]);
  const unique = [...new Set(tools)].slice(0, 5);
  if (!unique.length) return '';
  return `Captures a reusable tool sequence: ${unique.join(', ')}${tools.length > unique.length ? `, +${tools.length - unique.length} more` : ''}.`;
}

function curatorLessonSummary(s, content) {
  if (s?.learnedBehavior) return String(s.learnedBehavior);
  const action = curatorMarkdownSection(content, 'Suggested Action');
  const outcome = curatorMarkdownSection(content, 'Outcome Excerpt');
  const request = curatorMarkdownSection(content, 'Request Excerpt');
  const toolLesson = curatorToolLesson(content);
  const kind = String(s?.change?.kind || '').toLowerCase();
  if (kind === 'write_resource') {
    const first = curatorFirstSentence(action || s?.reason, 'Adds a reusable skill note from a completed run.');
    const second = curatorFirstSentence(outcome || request, '');
    return [first, toolLesson || second].filter(Boolean).join(' ');
  }
  if (kind === 'manifest_overlay') {
    return curatorFirstSentence(action || s?.reason, 'Updates the skill manifest metadata so Prometheus can route to this skill more reliably.');
  }
  return curatorFirstSentence(action || s?.reason, 'Reviews a proposed skill improvement from Brain.');
}

function curatorApplyPreview(s) {
  if (s?.approvePreview) return String(s.approvePreview);
  const change = s?.change || {};
  const kind = String(change.kind || '').toLowerCase();
  const skill = String(s?.skillId || 'this skill');
  const path = String(change.path || '').trim();
  if (kind === 'write_resource') {
    return `Approve will add ${path || 'a resource file'} to ${skill}.`;
  }
  if (kind === 'manifest_overlay') {
    return `Approve will update ${skill}'s manifest metadata.`;
  }
  if (kind === 'review_only') {
    return `Approve will mark this daily skill-change audit accepted without changing skill files.`;
  }
  return `Approve will apply this suggested change to ${skill}.`;
}

function curatorLessonTypeLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Skill change';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function curatorResourceKind(pathValue) {
  const p = String(pathValue || '').toLowerCase();
  if (p.includes('/recovery/')) return 'Recovery note';
  if (p.includes('/styles/')) return 'Style reference';
  if (p.includes('/workflows/')) return 'Workflow recipe';
  if (p.includes('/examples/')) return 'Example';
  if (p.includes('/templates/')) return 'Template';
  return 'Skill resource';
}

function curatorChangeSummary(s, lesson) {
  const change = s?.change || {};
  const kind = String(change.kind || '').toLowerCase();
  const skill = String(s?.skillId || 'unknown skill').trim();
  const pathValue = String(change.path || '').trim();
  if (kind === 'write_resource') {
    const resourceKind = curatorResourceKind(pathValue);
    return {
      action: `Create ${resourceKind.toLowerCase()}`,
      targetLabel: 'Will write',
      target: pathValue ? `skill:${skill}/${pathValue}` : `skill:${skill}/(new resource file)`,
      scope: `${resourceKind} for ${skill}.`,
      writeNote: 'Adds a reference file. It does not create a new skill or edit SKILL.md.',
      teachLabel: 'Will teach',
      teach: lesson || s?.learnedBehavior || 'A reusable behavior captured from Brain evidence.',
    };
  }
  if (kind === 'manifest_overlay') {
    return {
      action: 'Update skill routing metadata',
      targetLabel: 'Will write',
      target: `skill:${skill}/skill.json overlay`,
      scope: 'Adds or adjusts trigger words so this skill is found earlier.',
      writeNote: 'No instruction body or resource markdown is changed.',
      teachLabel: 'Routing change',
      teach: lesson || s?.learnedBehavior || 'Prometheus should route matching requests to this skill sooner.',
    };
  }
  if (kind === 'review_only') {
    return {
      action: 'Accept daily skill-change audit',
      targetLabel: 'File change',
      target: 'No files written',
      scope: 'Marks a self-improvement audit item as reviewed.',
      writeNote: 'This accepts the audit record only.',
      teachLabel: 'Audit purpose',
      teach: lesson || s?.learnedBehavior || 'Checks that recent skill mutations were evidence-backed and safe.',
    };
  }
  return {
    action: 'Apply suggested skill change',
    targetLabel: 'Target',
    target: pathValue ? `skill:${skill}/${pathValue}` : `skill:${skill}`,
    scope: 'Applies a Brain skill suggestion.',
    writeNote: 'Review the technical details before approving.',
    teachLabel: 'Will teach',
    teach: lesson || s?.learnedBehavior || 'A reusable skill behavior from Brain evidence.',
  };
}

function curatorApproveLabel(s) {
  const kind = String(s?.change?.kind || '').toLowerCase();
  if (kind === 'review_only') return 'Accept audit';
  if (kind === 'manifest_overlay') return 'Update trigger';
  if (kind === 'write_resource') return 'Create file';
  return 'Apply change';
}

function renderCuratorSuggestion(s) {
  const status = curatorStatusClass(s.status);
  const risk = String(s.risk || 'low').toLowerCase();
  const change = s.change || {};
  const evidence = Array.isArray(s.evidence) ? s.evidence : [];
  const findings = Array.isArray(s.scan?.findings) ? s.scan.findings : [];
  const content = String(change.content || '').trim();
  const lesson = curatorLessonSummary(s, content);
  const applyPreview = curatorApplyPreview(s);
  const changeSummary = curatorChangeSummary(s, lesson);
  const lessonTypeLabel = curatorLessonTypeLabel(s.lessonType || change.kind);
  const isPending = status === 'pending';
  const isBusy = _curator.actingId === s.id;
  return `
    <article class="hub-curator-card" data-status="${escHtml(status)}" data-risk="${escHtml(risk)}">
      <div class="hub-curator-card-head">
        <div class="hub-curator-title-wrap">
          <div class="hub-curator-title">${escHtml(s.title || 'Untitled suggestion')}</div>
          <div class="hub-curator-meta">
            <span>${escHtml(s.skillId || 'unknown skill')}</span>
            <span>${escHtml(s.lessonType || change.kind || 'change')}</span>
            <span title="${escHtml(fmtDate(s.updatedAt))}">${escHtml(relTime(s.updatedAt))}</span>
          </div>
        </div>
        <div class="hub-curator-badges">
          <span class="hub-curator-badge kind">${escHtml(lessonTypeLabel)}</span>
          <span class="hub-curator-badge status">${escHtml(status)}</span>
          <span class="hub-curator-badge risk">${escHtml(risk)} risk</span>
          <span class="hub-curator-badge scan">${escHtml(s.scan?.verdict || 'unscanned')}</span>
        </div>
      </div>
      <div class="hub-curator-apply-preview">
        <span>Approve action</span>
        <strong>${escHtml(changeSummary.action)}</strong>
        <small>${escHtml(changeSummary.scope)}</small>
      </div>
      <div class="hub-curator-decision-grid">
        <div>
          <span>${escHtml(changeSummary.targetLabel)}</span>
          <code title="${escHtml(changeSummary.target)}">${escHtml(changeSummary.target)}</code>
          <small>${escHtml(changeSummary.writeNote)}</small>
        </div>
        <div>
          <span>${escHtml(changeSummary.teachLabel)}</span>
          <strong>${escHtml(changeSummary.teach)}</strong>
        </div>
        ${s.futureTrigger ? `<div><span>Use when</span><strong>${escHtml(s.futureTrigger)}</strong></div>` : ''}
      </div>
      ${s.whyUseful ? `<div class="hub-curator-why"><strong>Why keep it</strong> ${escHtml(s.whyUseful)}</div>` : ''}
      ${s.reason ? `<div class="hub-curator-reason"><strong>Curator reason</strong> ${escHtml(s.reason)}</div>` : ''}
      <div class="hub-curator-path" title="${escHtml(changeSummary.target)}"><span>Target</span>${escHtml(changeSummary.target)}</div>
      ${evidence.length ? `
        <div class="hub-curator-evidence-block">
          <span>Evidence sources</span>
          <div class="hub-curator-evidence">
          ${evidence.slice(0, 4).map((item) => `<span title="${escHtml(item)}">${escHtml(item)}</span>`).join('')}
          ${evidence.length > 4 ? `<span>+${evidence.length - 4} more</span>` : ''}
          </div>
        </div>
      ` : ''}
      <details class="hub-curator-details">
        <summary>Technical evidence, raw file preview, and scan results</summary>
        <div class="hub-curator-detail-grid">
          <div><span>ID</span><code>${escHtml(s.id || '')}</code></div>
          <div><span>Created</span><code>${escHtml(fmtDate(s.createdAt))}</code></div>
          <div><span>Updated</span><code>${escHtml(fmtDate(s.updatedAt))}</code></div>
          <div><span>Scan hash</span><code>${escHtml(s.scan?.contentHash || '')}</code></div>
          <div><span>Quality</span><code>${escHtml(String(s.qualityScore ?? 'legacy'))}</code></div>
          <div><span>Auto</span><code>${escHtml(s.autoApplyEligible ? 'eligible' : 'review')}</code></div>
          <div><span>Backend preview</span><code>${escHtml(applyPreview)}</code></div>
          <div><span>Change kind</span><code>${escHtml(change.kind || 'unknown')}</code></div>
        </div>
        ${s.autoDecisionReason ? `<div class="hub-curator-findings">${escHtml(s.autoDecisionReason)}</div>` : ''}
        ${findings.length ? `<div class="hub-curator-findings">${findings.map((f) => `<div>${escHtml(f.message || JSON.stringify(f))}</div>`).join('')}</div>` : ''}
        ${content ? `<pre class="hub-curator-content">${escHtml(content.slice(0, 2400))}${content.length > 2400 ? '\n…' : ''}</pre>` : ''}
      </details>
      <div class="hub-curator-card-actions">
        ${isPending ? `
          <button class="hub-curator-btn approve" data-curator-action="apply" data-id="${escHtml(s.id)}" type="button" ${isBusy ? 'disabled' : ''}>${escHtml(curatorApproveLabel(s))}</button>
          <button class="hub-curator-btn deny" data-curator-action="reject" data-id="${escHtml(s.id)}" type="button" ${isBusy ? 'disabled' : ''}>Deny</button>
        ` : `<span class="hub-curator-resolved">${escHtml(status)}</span>`}
      </div>
    </article>
  `;
}

function renderCuratorActivityItem(item) {
  const status = String(item?.status || 'observed').toLowerCase() === 'applied' ? 'applied' : 'observed';
  const source = String(item?.appliedBy || item?.source || 'brain').trim();
  const risk = String(item?.risk || '').trim();
  const paths = Array.isArray(item?.changedPaths) ? item.changedPaths.filter(Boolean) : [];
  const evidence = Array.isArray(item?.evidence) ? item.evidence.filter(Boolean) : [];
  const tools = Array.isArray(item?.toolSequence) ? item.toolSequence.filter(Boolean) : [];
  const summary = String(item?.summary || item?.reason || item?.suggestedAction || '').trim();
  return `
    <article class="hub-curator-activity-card" data-status="${escHtml(status)}">
      <div class="hub-curator-card-head">
        <div class="hub-curator-title-wrap">
          <div class="hub-curator-title">${escHtml(item?.title || 'Skill activity')}</div>
          <div class="hub-curator-meta">
            <span>${escHtml(item?.skillId || 'unassigned signal')}</span>
            <span>${escHtml(item?.changeType || item?.source || 'activity')}</span>
            <span title="${escHtml(fmtDate(item?.timestamp))}">${escHtml(relTime(item?.timestamp))}</span>
          </div>
        </div>
        <div class="hub-curator-badges">
          <span class="hub-curator-badge status">${escHtml(status === 'applied' ? 'applied' : 'observed')}</span>
          ${source ? `<span class="hub-curator-badge scan">${escHtml(source)}</span>` : ''}
          ${risk ? `<span class="hub-curator-badge risk">${escHtml(risk)} risk</span>` : ''}
        </div>
      </div>
      ${summary ? `<div class="hub-curator-lesson">${escHtml(summary)}</div>` : ''}
      ${item?.requestExcerpt ? `<div class="hub-curator-why"><strong>Observed</strong> ${escHtml(item.requestExcerpt)}</div>` : ''}
      ${item?.finalResponseExcerpt ? `<div class="hub-curator-why"><strong>Outcome</strong> ${escHtml(item.finalResponseExcerpt)}</div>` : ''}
      ${paths.length ? `<div class="hub-curator-path" title="${escHtml(paths.join(', '))}"><span>Changed</span>${paths.slice(0, 4).map(escHtml).join(', ')}${paths.length > 4 ? `, +${paths.length - 4} more` : ''}</div>` : ''}
      ${tools.length ? `<div class="hub-curator-evidence">${tools.slice(0, 6).map((tool) => `<span title="${escHtml(tool)}">${escHtml(tool)}</span>`).join('')}${tools.length > 6 ? `<span>+${tools.length - 6} tools</span>` : ''}</div>` : ''}
      ${evidence.length ? `
        <details class="hub-curator-details">
          <summary>Evidence</summary>
          <div class="hub-curator-evidence">
            ${evidence.slice(0, 10).map((ev) => `<span title="${escHtml(ev)}">${escHtml(ev)}</span>`).join('')}
            ${evidence.length > 10 ? `<span>+${evidence.length - 10} more</span>` : ''}
          </div>
        </details>
      ` : ''}
    </article>
  `;
}

function renderCuratorPanel() {
  const list = document.getElementById('hub-curator-list');
  const summary = document.getElementById('hub-curator-summary');
  const subtitle = document.getElementById('hub-curator-subtitle');
  if (!list) return;

  const suggestions = Array.isArray(_curator.suggestions) ? _curator.suggestions : [];
  const activity = Array.isArray(_curator.activity) ? _curator.activity : [];
  const counts = suggestions.reduce((acc, item) => {
    const s = curatorStatusClass(item.status);
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const appliedActivity = activity.filter((item) => String(item?.status || '').toLowerCase() === 'applied').length;
  const observedActivity = activity.length - appliedActivity;
  if (subtitle) subtitle.textContent = _curator.loading
    ? 'Loading Brain skill suggestions and Thought/Dream activity...'
    : `${counts.pending || 0} pending, ${counts.quarantined || 0} quarantined, ${appliedActivity} applied updates, ${observedActivity} observed signals`;
  if (summary) {
    const low = suggestions.filter((s) => String(s.risk || '').toLowerCase() === 'low').length;
    const medium = suggestions.filter((s) => String(s.risk || '').toLowerCase() === 'medium').length;
    const high = suggestions.filter((s) => String(s.risk || '').toLowerCase() === 'high').length;
    summary.innerHTML = [
      renderStatTile('Pending', compactNumber(counts.pending || 0)),
      renderStatTile('Quarantined', compactNumber(counts.quarantined || 0)),
      renderStatTile('Applied Updates', compactNumber(appliedActivity)),
      renderStatTile('Observed Signals', compactNumber(observedActivity)),
      renderStatTile('Low risk', compactNumber(low)),
      renderStatTile('Medium risk', compactNumber(medium)),
      renderStatTile('High risk', compactNumber(high)),
      renderStatTile('Total', compactNumber(suggestions.length + activity.length)),
    ].join('');
  }

  if (_curator.loading && !suggestions.length && !activity.length) {
    list.innerHTML = `<div class="hub-empty">Loading curator suggestions and activity...</div>`;
    return;
  }
  if (!suggestions.length && !activity.length) {
    list.innerHTML = `<div class="hub-empty">No skill curator suggestions or Thought/Dream activity yet.</div>`;
    return;
  }
  const sorted = suggestions.slice().sort((a, b) => {
    const ap = curatorStatusClass(a.status) === 'pending' ? 0 : 1;
    const bp = curatorStatusClass(b.status) === 'pending' ? 0 : 1;
    return (ap - bp) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
  const sortedActivity = activity.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  list.innerHTML = [
    sorted.length ? `<div class="hub-curator-group-title">Review Queue</div>${sorted.map(renderCuratorSuggestion).join('')}` : '',
    sortedActivity.length ? `<div class="hub-curator-group-title">Thought and Dream Activity</div>${sortedActivity.map(renderCuratorActivityItem).join('')}` : '',
  ].filter(Boolean).join('');
  list.querySelectorAll('[data-curator-action]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      handleCuratorAction(btn.getAttribute('data-id'), btn.getAttribute('data-curator-action'), btn);
    });
  });
}

async function loadCuratorSuggestions() {
  _curator.loading = true;
  renderCuratorPanel();
  try {
    const r = await api('/api/hub/skills/review', { timeoutMs: 30000 });
    _curator.suggestions = Array.isArray(r?.suggestions) ? r.suggestions : [];
    _curator.activity = Array.isArray(r?.activity) ? r.activity : [];
    _curator.pending = Number(r?.pending || 0);
    _curator.quarantined = Number(r?.quarantined || 0);
    _curator.appliedActivity = Number(r?.appliedActivity || 0);
    _curator.observedActivity = Number(r?.observedActivity || 0);
  } catch {
    _curator.suggestions = [];
    _curator.activity = [];
  } finally {
    _curator.loading = false;
    _curator.actingId = '';
    renderCuratorPanel();
  }
}

async function runCuratorReview() {
  _curator.loading = true;
  renderCuratorPanel();
  try {
    await api('/api/hub/skills/review/run', {
      method: 'POST',
      body: { mode: 'pending' },
      timeoutMs: 60000,
    });
  } catch (err) {
    window.showToast?.('Skill curator run failed', err?.message || String(err), 'error');
  } finally {
    await loadCuratorSuggestions();
  }
}

async function handleCuratorAction(id, action, btn) {
  const suggestionId = String(id || '').trim();
  const act = String(action || '').trim();
  if (!suggestionId || !act) return;
  _curator.actingId = suggestionId;
  if (btn) btn.disabled = true;
  renderCuratorPanel();
  try {
    await api(`/api/hub/skills/review/${encodeURIComponent(suggestionId)}/${act === 'apply' ? 'apply' : 'reject'}`, {
      method: 'POST',
      body: {},
      timeoutMs: 30000,
    });
    await loadCuratorSuggestions();
    loadSkills();
  } catch (err) {
    window.showToast?.('Skill curator action failed', err?.message || String(err), 'error');
    _curator.actingId = '';
    renderCuratorPanel();
  }
}

async function loadStats() {
  _stats.loading = !(_stats.tools || _stats.models);
  renderStatsTiles();
  const range = encodeURIComponent(_stats.range);
  try {
    const [tools, models] = await Promise.allSettled([
      api(`/api/hub/tools/overview?range=${range}`, { timeoutMs: 30000 }),
      api(`/api/hub/models/overview?range=${range}`, { timeoutMs: 30000 }),
    ]);
    if (tools.status === 'fulfilled' && tools.value && tools.value.success !== false) {
      _stats.tools = tools.value;
    }
    if (models.status === 'fulfilled' && models.value && models.value.success !== false) {
      _stats.models = models.value;
    }
  } finally {
    _stats.loading = false;
    renderStatsTiles();
  }
}

// ─── Loaders ─────────────────────────────────────────────────────────────────
async function loadSkills() {
  try {
    const r = await api(`/api/hub/skills/usage?range=${encodeURIComponent(_range)}`);
    _skills = Array.isArray(r?.skills) ? r.skills : [];
  } catch {
    _skills = [];
  }
  renderSkillsGrid();
}

async function loadGoals() {
  try {
    const r = await api('/api/hub/goals');
    _goals = Array.isArray(r?.goals) ? r.goals : [];
  } catch {
    _goals = [];
  }
  renderGoals();
}

async function loadHeatmap() {
  try {
    const r = await api('/api/hub/tokens/activity', { timeoutMs: 30000 });
    _tokenActivity.daily = Array.isArray(r?.daily) ? r.daily : [];
    _tokenActivity.stats = r?.stats || null;
  } catch {
    _tokenActivity.daily = [];
    _tokenActivity.stats = null;
  }
  renderHeatmap();
}

// Loads the current week's daily counts. The week may span two calendar months,
// so we fetch heatmap data for both months when needed and merge the relevant days.
async function loadWeek() {
  const start = startOfWeek(new Date());
  _week.startISO = dateKey(start);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);

  const months = new Set([
    `${start.getFullYear()}-${start.getMonth() + 1}`,
    `${end.getFullYear()}-${end.getMonth() + 1}`,
  ]);

  const merged = {};
  await Promise.all([...months].map(async (key) => {
    const [y, m] = key.split('-').map(Number);
    try {
      const r = await api(`/api/hub/tools/heatmap?year=${y}&month=${m}`, { timeoutMs: 30000 });
      const counts = (r && r.counts) ? r.counts : {};
      Object.assign(merged, counts);
    } catch { /* noop */ }
  }));

  _week.counts = merged;
  renderWeekBars();
}

// ─── Modal ───────────────────────────────────────────────────────────────────
async function openHubSkillModal(id) {
  const modal = document.getElementById('hub-skill-modal');
  const body = document.getElementById('hub-modal-body');
  const nameEl = document.getElementById('hub-modal-name');
  const verEl = document.getElementById('hub-modal-version');
  if (!modal || !body) return;
  body.innerHTML = `<div class="hub-empty">Loading…</div>`;
  modal.style.display = 'flex';

  try {
    const r = await api(`/api/hub/skills/${encodeURIComponent(id)}/content`);
    const sk = r?.skill || {};
    if (nameEl)  nameEl.textContent  = sk.name || id;
    if (verEl)   verEl.textContent   = sk.version ? `v${sk.version}` : '';
    const md = stripMarkdownFrontmatter(sk.content);
    const lifecycleHtml = `
      <div class="hub-modal-skill-meta">
        <div class="hub-modal-skill-meta-item"><span>Status</span><strong>${escHtml(labelize(sk.status))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Lifecycle</span><strong>${escHtml(labelize(sk.lifecycle || sk.status))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Ownership</span><strong>${escHtml(labelize(sk.ownership))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Manifest</span><strong>${escHtml(labelize(sk.manifestSource))}</strong></div>
      </div>
        <div class="hub-modal-change-panel">
          <div class="hub-modal-section-title">Recent skill changes</div>
          ${renderSkillChanges(sk.recentChanges, 8)}
        </div>
        ${renderSkillAddons(sk)}
      `;
    let html;
    try {
      html = renderMd(md);
    } catch {
      html = `<pre>${escHtml(md)}</pre>`;
    }
    body.innerHTML = `${lifecycleHtml}<div class="hub-modal-markdown">${html}</div>`;
    wireHubSkillChangeCards(body);
    wireHubResourceButtons(body);
  } catch (err) {
    body.innerHTML = `<div class="hub-empty">Failed to load skill: ${escHtml(err?.message || String(err))}</div>`;
  }
}

function toggleHubSkillChangeCard(card) {
  if (!card) return;
  const open = card.classList.toggle('open');
  card.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function wireHubSkillChangeCards(root = document) {
  root.querySelectorAll('[data-hub-change-card]').forEach((card) => {
    if (card.dataset.changeBound === '1') return;
    card.dataset.changeBound = '1';
    card.addEventListener('click', (event) => {
      if (event.target.closest('a,button')) return;
      toggleHubSkillChangeCard(card);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleHubSkillChangeCard(card);
    });
  });
}

function wireHubResourceButtons(root = document) {
  root.querySelectorAll('.hub-modal-resource-item[data-skill-id][data-resource-path]').forEach((button) => {
    if (button.dataset.resourceBound === '1') return;
    button.dataset.resourceBound = '1';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openHubSkillResource(button.dataset.skillId || '', button.dataset.resourcePath || '');
    });
  });
}

async function openHubSkillResource(skillId, relPath) {
  const preview = document.getElementById('hub-modal-resource-preview');
  if (!preview) return;
  preview.innerHTML = `<div class="hub-modal-resource-empty">Loading ${escHtml(relPath)}...</div>`;
  try {
    const r = await api(`/api/hub/skills/${encodeURIComponent(skillId)}/resources/content?path=${encodeURIComponent(relPath)}`);
    const resource = r?.resource || {};
    preview.innerHTML = `
      <div class="hub-modal-resource-preview-head">
        <strong>${escHtml(resource.path || relPath)}</strong>
        ${resource.truncated ? '<span>Truncated</span>' : ''}
      </div>
      <pre>${escHtml(resource.content || '')}</pre>
    `;
  } catch (err) {
    preview.innerHTML = `<div class="hub-modal-resource-empty">Failed to load file: ${escHtml(err?.message || String(err))}</div>`;
  }
}

function closeHubSkillModal() {
  const modal = document.getElementById('hub-skill-modal');
  if (modal) modal.style.display = 'none';
}

// ─── Wiring ──────────────────────────────────────────────────────────────────
function wireHeader() {
  const seg = document.getElementById('hub-range-seg');
  if (seg && !seg._wired) {
    seg._wired = true;
    seg.querySelectorAll('.hub-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = btn.getAttribute('data-range');
        if (!r || r === _range) return;
        _range = r;
        try { localStorage.setItem('hub_range', _range); } catch {}
        seg.querySelectorAll('.hub-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
        loadSkills();
      });
    });
    seg.querySelectorAll('.hub-seg-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-range') === _range);
    });
  }

  const viewAllBtn = document.getElementById('hub-viewall-btn');
  if (viewAllBtn && !viewAllBtn._wired) {
    viewAllBtn._wired = true;
    viewAllBtn.addEventListener('click', () => {
      _viewAll = !_viewAll;
      try { localStorage.setItem('hub_skills_viewall', _viewAll ? '1' : '0'); } catch {}
      viewAllBtn.textContent = _viewAll ? 'Show top 4 ▴' : 'View all skills ▾';
      renderSkillsGrid();
    });
    viewAllBtn.textContent = _viewAll ? 'Show top 4 ▴' : 'View all skills ▾';
  }

  const skillSearch = document.getElementById('hub-skill-search');
  if (skillSearch && !skillSearch._wired) {
    skillSearch._wired = true;
    skillSearch.value = _hubSkillSearch;
    skillSearch.addEventListener('input', () => {
      _hubSkillSearch = skillSearch.value || '';
      try { localStorage.setItem('hub_skill_search', _hubSkillSearch); } catch {}
      renderSkillsGrid();
    });
  } else if (skillSearch && skillSearch.value !== _hubSkillSearch) {
    skillSearch.value = _hubSkillSearch;
  }

  const tabs = document.getElementById('hub-stats-tabs');
  if (tabs && !tabs._wired) {
    tabs._wired = true;
    tabs.querySelectorAll('.hub-stats-tab').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === _stats.mode);
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        if (!mode || mode === _stats.mode) return;
        _stats.mode = mode;
        try { localStorage.setItem('hub_stats_mode', mode); } catch {}
        tabs.querySelectorAll('.hub-stats-tab').forEach(b => b.classList.toggle('active', b === btn));
        renderStatsTiles();
      });
    });
  }

  const rangeSeg = document.getElementById('hub-stats-range');
  if (rangeSeg && !rangeSeg._wired) {
    rangeSeg._wired = true;
    rangeSeg.querySelectorAll('.hub-stats-range-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-range') === _stats.range);
      btn.addEventListener('click', () => {
        const r = btn.getAttribute('data-range');
        if (!r || r === _stats.range) return;
        _stats.range = r;
        try { localStorage.setItem('hub_stats_range', r); } catch {}
        rangeSeg.querySelectorAll('.hub-stats-range-btn').forEach(b => b.classList.toggle('active', b === btn));
        loadStats();
      });
    });
  }

  const prev = document.getElementById('hub-heatmap-prev');
  const next = document.getElementById('hub-heatmap-next');
  if (prev && !prev._wired) {
    prev._wired = true;
    prev.addEventListener('click', () => {
      _heatmap.month -= 1;
      if (_heatmap.month < 1) { _heatmap.month = 12; _heatmap.year -= 1; }
      loadHeatmap();
    });
  }
  if (next && !next._wired) {
    next._wired = true;
    next.addEventListener('click', () => {
      _heatmap.month += 1;
      if (_heatmap.month > 12) { _heatmap.month = 1; _heatmap.year += 1; }
      loadHeatmap();
    });
  }

  const curatorRefresh = document.getElementById('hub-curator-refresh-btn');
  if (curatorRefresh && !curatorRefresh._wired) {
    curatorRefresh._wired = true;
    curatorRefresh.addEventListener('click', loadCuratorSuggestions);
  }

  const curatorRun = document.getElementById('hub-curator-run-btn');
  if (curatorRun && !curatorRun._wired) {
    curatorRun._wired = true;
    curatorRun.addEventListener('click', runCuratorReview);
  }

  const provRefresh = document.getElementById('hub-providers-refresh');
  if (provRefresh && !provRefresh._wired) {
    provRefresh._wired = true;
    provRefresh.addEventListener('click', loadProviders);
  }
}

export function hubPageActivate() {
  wireHeader();
  if (!_heatmap.year) {
    const now = new Date();
    _heatmap.year = now.getFullYear();
    _heatmap.month = now.getMonth() + 1;
  }
  loadGoals();
  loadSkills();
  loadStats();
  loadProviders();
  loadHeatmap();
  loadWeek();
  loadCuratorSuggestions();
}

window.hubPageActivate = hubPageActivate;
window.openHubSkillModal = openHubSkillModal;
window.closeHubSkillModal = closeHubSkillModal;
window.toggleHubSkillChangeCard = toggleHubSkillChangeCard;
window.openHubSkillResource = openHubSkillResource;
window.loadCuratorSuggestions = loadCuratorSuggestions;

wsEventBus.on('main_chat_goal_updated', () => {
  const hub = document.getElementById('hub-view');
  if (hub && hub.style.display !== 'none') loadGoals();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('hub-skill-modal');
    if (modal && modal.style.display === 'flex') closeHubSkillModal();
  }
});
