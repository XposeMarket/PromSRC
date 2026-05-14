/**
 * HubPage.js — Hub view (usage tracker)
 *
 * Sections:
 *  - Top skills row (4 by default, "View all" expands the grid)
 *  - Achievements (left pane, definitions array — fill in later)
 *  - Tool-usage heatmap (right pane, by month)
 */

import { api } from '../api.js';
import { escHtml } from '../utils.js';
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
const _heatmap = { year: 0, month: 0, counts: {} };
const _stats = { mode: 'overview', range: 'all', tools: null, models: null, loading: false };
try {
  const m = localStorage.getItem('hub_stats_mode');
  if (m === 'overview' || m === 'models') _stats.mode = m;
  const r = localStorage.getItem('hub_stats_range');
  if (r === 'all' || r === '30d' || r === '7d') _stats.range = r;
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

function renderSkillChanges(changes, limit = 3) {
  const items = Array.isArray(changes) ? changes.slice(0, limit) : [];
  if (!items.length) return `<div class="hub-skill-change-empty">No recent skill changes.</div>`;
  return `
    <div class="hub-skill-change-list">
      ${items.map(ch => {
        const type = labelize(ch.changeType || 'skill_update');
        const when = relTime(ch.timestamp);
        const reason = String(ch.reason || '').trim();
        const paths = Array.isArray(ch.changedPaths) ? ch.changedPaths.filter(Boolean).slice(0, 2) : [];
        const appliedBy = String(ch.appliedBy || '').trim();
        return `
          <div class="hub-skill-change">
            <div class="hub-skill-change-main">
              <span class="hub-skill-change-type">${escHtml(type)}</span>
              <span class="hub-skill-change-time" title="${escHtml(fmtDate(ch.timestamp))}">${escHtml(when)}</span>
            </div>
            ${reason ? `<div class="hub-skill-change-reason">${escHtml(reason)}</div>` : ''}
            ${paths.length ? `<div class="hub-skill-change-paths">${paths.map(p => `<span>${escHtml(p)}</span>`).join('')}</div>` : ''}
            ${appliedBy ? `<div class="hub-skill-change-by">${escHtml(appliedBy)}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
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
  label.textContent = monthLabel(_heatmap.year, _heatmap.month);

  const firstDay = new Date(_heatmap.year, _heatmap.month - 1, 1);
  const daysInMonth = new Date(_heatmap.year, _heatmap.month, 0).getDate();
  const startWeekday = firstDay.getDay();

  const max = Math.max(1, ...Object.values(_heatmap.counts));

  // Heatmap calendar grid: rows = day-of-week (Sun–Sat), cols = week of month.
  const totalCells = startWeekday + daysInMonth;
  const weeks = Math.ceil(totalCells / 7);

  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let labelsHtml = '<div class="hub-heat-daylabels">';
  for (let i = 0; i < 7; i++) {
    labelsHtml += `<div class="hub-heat-daylabel">${dayLabels[i]}</div>`;
  }
  labelsHtml += '</div>';

  let cellsHtml = `<div class="hub-heatmap-cells">`;
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      const cellIdx = col * 7 + row;
      const dayNum = cellIdx - startWeekday + 1;
      if (dayNum < 1 || dayNum > daysInMonth) {
        cellsHtml += `<div class="hub-heat-cell hub-heat-empty"></div>`;
        continue;
      }
      const ds = `${_heatmap.year}-${String(_heatmap.month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const c = _heatmap.counts[ds] || 0;
      const lvl = heatmapLevel(c, max);
      const tip = `${ds} — ${c} tool call${c === 1 ? '' : 's'}`;
      cellsHtml += `<div class="hub-heat-cell" data-level="${lvl}" title="${escHtml(tip)}"></div>`;
    }
  }
  cellsHtml += '</div>';

  grid.innerHTML = labelsHtml + cellsHtml;
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

function renderStatTile(label, value, sub) {
  return `
    <div class="hub-stat-tile">
      <div class="hub-stat-label">${escHtml(label)}</div>
      <div class="hub-stat-value">${escHtml(String(value))}</div>
      ${sub ? `<div class="hub-stat-sub">${escHtml(sub)}</div>` : ''}
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
    const sessions = m.sessions || t.sessions || 0;
    const messages = t.messages || 0;
    const totalTokens = m.totalTokens || 0;
    const activeDays = t.activeDays || m.activeDays || 0;
    const currentStreak = t.currentStreak || 0;
    const longestStreak = t.longestStreak || 0;
    const peakHour = t.peakHour && t.peakHour !== '—' ? t.peakHour : (m.peakHour || '—');
    const favoriteModel = m.favorite && m.favorite !== '—' ? m.favorite : (t.favorite || '—');

    tilesEl.innerHTML = [
      renderStatTile('Sessions', compactNumber(sessions)),
      renderStatTile('Messages', compactNumber(messages)),
      renderStatTile('Total tokens', compactNumber(totalTokens)),
      renderStatTile('Active days', String(activeDays)),
      renderStatTile('Current streak', currentStreak + 'd'),
      renderStatTile('Longest streak', longestStreak + 'd'),
      renderStatTile('Peak hour', String(peakHour)),
      renderStatTile('Favorite model', String(favoriteModel)),
    ].join('');
    modelsEl.style.display = 'none';
    if (footnoteEl) {
      footnoteEl.textContent = (_stats.models && _stats.models.summary) || (_stats.tools && _stats.tools.summary) || '';
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
    renderStatTile('Total tokens', compactNumber(s.totalTokens || 0)),
    renderStatTile('Input', compactNumber(s.inputTokens || 0)),
    renderStatTile('Output', compactNumber(s.outputTokens || 0)),
    renderStatTile('Reasoning', compactNumber(s.reasoningTokens || 0)),
    renderStatTile('Cache', compactNumber(s.cacheTokens || 0)),
    renderStatTile('Model calls', compactNumber(s.messages || 0)),
    renderStatTile('Sessions', compactNumber(s.sessions || 0)),
    renderStatTile('Favorite', String(s.favorite || '—')),
  ].join('');

  const providersChips = topProviders.length
    ? `<div class="hub-models-providers">${topProviders.map(p => `
        <span class="hub-models-chip" title="${escHtml(compactNumber(p.tokens) + ' tokens')}">
          <span class="hub-models-chip-name">${escHtml(p.name)}</span>
          <span class="hub-models-chip-val">${escHtml(compactNumber(p.tokens))}</span>
        </span>
      `).join('')}</div>`
    : '';

  if (!topModels.length) {
    modelsEl.innerHTML = `${providersChips}<div class="hub-empty">No model usage recorded yet.</div>`;
  } else {
    modelsEl.innerHTML = `
      ${providersChips}
      <div class="hub-models-table">
        <div class="hub-models-row hub-models-head">
          <div>Model</div>
          <div class="hub-models-num">Tokens</div>
          <div class="hub-models-num">Share</div>
          <div class="hub-models-bar-cell"></div>
        </div>
        ${topModels.map(row => {
          const tokens = Number(row.tokens) || 0;
          const share = (tokens / totalForShare) * 100;
          return `
            <div class="hub-models-row">
              <div class="hub-models-name" title="${escHtml(row.name)}">${escHtml(row.name)}</div>
              <div class="hub-models-num">${escHtml(compactNumber(tokens))}</div>
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

async function loadStats() {
  _stats.loading = !(_stats.tools || _stats.models);
  renderStatsTiles();
  const range = encodeURIComponent(_stats.range);
  try {
    const [tools, models] = await Promise.all([
      api(`/api/hub/tools/overview?range=${range}`).catch(() => null),
      api(`/api/hub/models/overview?range=${range}`).catch(() => null),
    ]);
    _stats.tools = tools && tools.success !== false ? tools : null;
    _stats.models = models && models.success !== false ? models : null;
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
    const r = await api(`/api/hub/tools/heatmap?year=${_heatmap.year}&month=${_heatmap.month}`);
    _heatmap.counts = (r && r.counts) ? r.counts : {};
  } catch {
    _heatmap.counts = {};
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
      const r = await api(`/api/hub/tools/heatmap?year=${y}&month=${m}`);
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
    const md = String(sk.content || '');
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
    `;
    let html;
    try {
      html = (window.marked && typeof window.marked.parse === 'function')
        ? window.marked.parse(md)
        : `<pre>${escHtml(md)}</pre>`;
    } catch {
      html = `<pre>${escHtml(md)}</pre>`;
    }
    body.innerHTML = `${lifecycleHtml}<div class="hub-modal-markdown">${html}</div>`;
  } catch (err) {
    body.innerHTML = `<div class="hub-empty">Failed to load skill: ${escHtml(err?.message || String(err))}</div>`;
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
  loadHeatmap();
  loadWeek();
}

window.hubPageActivate = hubPageActivate;
window.openHubSkillModal = openHubSkillModal;
window.closeHubSkillModal = closeHubSkillModal;

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
