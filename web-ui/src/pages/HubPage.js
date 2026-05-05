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
const _heatmap = { year: 0, month: 0, counts: {} };
// Current-week bar chart data: 7 entries Sun→Sat for the week containing today.
// This is independent of the heatmap's navigated month so paging back/forward
// through months does not change the bar chart.
const _week = { startISO: '', counts: {} };

try {
  const r = localStorage.getItem('hub_range');
  if (r === 'day' || r === 'week' || r === 'month') _range = r;
  _viewAll = localStorage.getItem('hub_skills_viewall') === '1';
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
function renderSkillCard(s) {
  const isOpen = _expanded.has(s.id);
  return `
    <div class="hub-skill-card${isOpen ? ' open' : ''}" data-skill-id="${escHtml(s.id)}">
      <div class="hub-skill-card-head" data-action="toggle" data-id="${escHtml(s.id)}">
        <div class="hub-skill-emoji">${escHtml(s.emoji || '🧩')}</div>
        <div class="hub-skill-name" title="${escHtml(s.name)}">${escHtml(s.name)}</div>
        <div class="hub-skill-count">${s.count} ${s.count === 1 ? 'use' : 'uses'}</div>
        <div class="hub-skill-preview">${escHtml((s.description || '').slice(0, 90))}${(s.description || '').length > 90 ? '…' : ''}</div>
      </div>
      <div class="hub-skill-card-body">
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Version</span><span class="hub-skill-meta-val">${escHtml(s.version || '—')}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Last used</span><span class="hub-skill-meta-val" title="${escHtml(fmtDate(s.lastUsed))}">${escHtml(relTime(s.lastUsed))}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Last modified</span><span class="hub-skill-meta-val" title="${escHtml(fmtDate(s.lastModified))}">${escHtml(relTime(s.lastModified))}</span></div>
        <div class="hub-skill-card-actions">
          <button class="hub-skill-view-btn" data-action="view" data-id="${escHtml(s.id)}" type="button">View</button>
        </div>
      </div>
    </div>
  `;
}

function renderSkillsGrid() {
  const grid = document.getElementById('hub-skills-grid');
  if (!grid) return;
  const visible = _viewAll ? _skills : _skills.slice(0, 4);
  if (!visible.length) {
    grid.innerHTML = `<div class="hub-empty">No skills found.</div>`;
    return;
  }
  grid.innerHTML = visible.map(renderSkillCard).join('');
  grid.classList.toggle('hub-skills-grid-all', _viewAll);

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

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let labelsHtml = '<div class="hub-heat-daylabels">';
  for (let i = 0; i < 7; i++) {
    // Show every other label for readability
    const show = (i % 2 === 1);
    labelsHtml += `<div class="hub-heat-daylabel">${show ? dayLabels[i] : ''}</div>`;
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
  const emojiEl = document.getElementById('hub-modal-emoji');
  if (!modal || !body) return;
  body.innerHTML = `<div class="hub-empty">Loading…</div>`;
  modal.style.display = 'flex';

  try {
    const r = await api(`/api/hub/skills/${encodeURIComponent(id)}/content`);
    const sk = r?.skill || {};
    if (nameEl)  nameEl.textContent  = sk.name || id;
    if (verEl)   verEl.textContent   = sk.version ? `v${sk.version}` : '';
    if (emojiEl) emojiEl.textContent = sk.emoji || '🧩';
    const md = String(sk.content || '');
    let html;
    try {
      html = (window.marked && typeof window.marked.parse === 'function')
        ? window.marked.parse(md)
        : `<pre>${escHtml(md)}</pre>`;
    } catch {
      html = `<pre>${escHtml(md)}</pre>`;
    }
    body.innerHTML = `<div class="hub-modal-markdown">${html}</div>`;
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
  renderAchievements();
  loadSkills();
  loadHeatmap();
  loadWeek();
}

window.hubPageActivate = hubPageActivate;
window.openHubSkillModal = openHubSkillModal;
window.closeHubSkillModal = closeHubSkillModal;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('hub-skill-modal');
    if (modal && modal.style.display === 'flex') closeHubSkillModal();
  }
});
