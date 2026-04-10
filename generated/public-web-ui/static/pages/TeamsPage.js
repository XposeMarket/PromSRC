/**
 * TeamsPage.js — F3e Extract
 *
 * Teams page: team canvas, team board, team chat, workspace viewer,
 * context references, progress tracking, subagent drawers, team CRUD.
 *
 * 67 functions extracted verbatim from index.html (~1,954 lines).
 *
 * Dependencies: api() from api.js, escHtml/bgtToast/timeAgo from utils.js
 * Cross-page: renderSessionsList (window.* during migration)
 */

import { api } from '../api.js';
import { escHtml, bgtToast, timeAgo, showToast, showConfirm } from '../utils.js';
import { wsEventBus } from '../ws.js';

// ── Stubs for cross-module globals not yet migrated ──────────────
let _teamsDataSig = '';
function refreshTeamsDebounced() {
  clearTimeout(refreshTeamsDebounced._t);
  refreshTeamsDebounced._t = setTimeout(() => refreshTeams(), 800);
}
function getTaskProgressItems(task) {
  return Array.isArray(task?.steps) ? task.steps
    : Array.isArray(task?.items) ? task.items
    : [];
}
function normalizeProgressStatus(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'done' || v === 'complete' || v === 'completed') return 'done';
  if (v === 'in_progress' || v === 'running') return 'in_progress';
  return 'pending';
}
function renderChecklistItemsHTML(items, opts = {}) {
  const max = opts.maxText || 160;
  return items.map(item => {
    const st = normalizeProgressStatus(item.status);
    const icon = st === 'done' ? '✅' : st === 'in_progress' ? '⏳' : '⬜';
    return `<div style="display:flex;align-items:flex-start;gap:7px;padding:4px 0;font-size:12px;line-height:1.4">
      <span style="flex-shrink:0;margin-top:1px">${icon}</span>
      <span style="color:var(--text);opacity:${st === 'done' ? '0.6' : '1'}">${escHtml(String(item.text || '').slice(0, max))}</span>
    </div>`;
  }).join('');
}

// -------------------------------------------------------------------------------

let teamsData = [];           // ManagedTeam[]
let teamMemberIds = new Set(); // agentIds belonging to any team
let activeTeamId = null;      // currently focused team (board open)
let teamBoardTab = 'context'; // context | memory | runs | chat
let teamRuns = [];            // cached runs for active team
let teamChatMessages = [];    // cached chat for active team
let teamWorkspaceFiles = [];  // cached workspace files for active team (flat)
let teamWorkspaceTree = [];   // cached workspace tree (nested) for active team
let teamActiveRunsByTeam = {};      // teamId -> { taskId -> live run row }
let teamProgressExpandedRuns = {};  // `${teamId}::${runKey}` -> true
let teamProgressTaskCache = {};     // taskId -> { items, status, title, loadedAt, error? }
let teamProgressTaskLoading = {};   // taskId -> booleanprom 
let teamProgressTaskRefreshTimers = {}; // taskId -> timeout handle
const workspaceFolderExpanded = new Set(); // relativePaths of expanded folders
let teamChatPolling = null;
let teamChatDraftByTeam = {}; // teamId -> unsent draft message
let activeTeamChatSignature = '';

function getTeamChatSignature(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const last = list.length > 0 ? list[list.length - 1] : null;
  return `${list.length}:${last?.id || ''}:${last?.timestamp || 0}`;
}

function renderActiveTeamChat(teamId, opts = {}) {
  if (teamBoardTab !== 'chat' || activeTeamId !== teamId) return;
  const { forceBottom = false } = opts;
  const contentEl = document.getElementById('team-tab-content');
  if (!contentEl) return;
  const msgElBefore = document.getElementById('team-chat-messages');
  const inputBefore = document.getElementById('team-chat-input');
  const prevScrollTop = msgElBefore ? msgElBefore.scrollTop : 0;
  const wasNearBottom = msgElBefore
    ? (msgElBefore.scrollHeight - (msgElBefore.scrollTop + msgElBefore.clientHeight)) < 28
    : true;
  if (inputBefore) {
    teamChatDraftByTeam[teamId] = inputBefore.value || '';
  }

  const team = teamsData.find(t => t.id === teamId);
  if (!team) return;
  contentEl.innerHTML = renderTeamChatTab(team);

  const inputAfter = document.getElementById('team-chat-input');
  if (inputAfter) {
    inputAfter.value = teamChatDraftByTeam[teamId] || '';
    inputAfter.addEventListener('input', () => {
      teamChatDraftByTeam[teamId] = inputAfter.value || '';
    });
  }

  requestAnimationFrame(() => {
    const msgElAfter = document.getElementById('team-chat-messages');
    if (!msgElAfter) return;
    if (forceBottom || wasNearBottom) {
      msgElAfter.scrollTop = msgElAfter.scrollHeight;
    } else {
      const maxTop = Math.max(0, msgElAfter.scrollHeight - msgElAfter.clientHeight);
      msgElAfter.scrollTop = Math.min(prevScrollTop, maxTop);
    }
  });
}

// --- Fetch & Render ---------------------------------------------------------
async function refreshTeams() {
  try {
    const data = await api('/api/teams');
    teamsData = data.teams || [];
    window.teamsData = teamsData;  // Expose to inline scripts (for AgentsTab team grouping)
    teamMemberIds = new Set(data.teamMemberIds || []);
    renderTeamsCanvas();
  } catch (err) {
    console.error('[Teams]', err);
  }
}

// --- Canvas Rendering --------------------------------------------------------
const HOUSE_PALETTES = [
  { wall:'#6c8ebf', roof:'#3a5a8c', door:'#8b4513', window:'#fffbe6', smoke:'#b0b8d0' },
  { wall:'#7cb87c', roof:'#3a6e3a', door:'#6b3a10', window:'#e6f7ff', smoke:'#b8d0b8' },
  { wall:'#c48a4a', roof:'#7a4a10', door:'#3a3a8c', window:'#fff8e6', smoke:'#d0c0a0' },
  { wall:'#b87ca8', roof:'#6a3a6a', door:'#3a7a3a', window:'#f0e6ff', smoke:'#c8b0c8' },
  { wall:'#7ab8c8', roof:'#3a6a7a', door:'#7a4a10', window:'#e6fff8', smoke:'#b0c8d0' },
  { wall:'#c87878', roof:'#7a3a3a', door:'#3a6a3a', window:'#fff0f0', smoke:'#d0b0b0' },
];

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function drawHouseSVG(team, isActive, isHovered, scale=1) {
  const h = hashStr(team.id);
  const pal = HOUSE_PALETTES[h % HOUSE_PALETTES.length];
  const roofStyle = h % 3; // 0=triangle, 1=flat, 2=pointy
  const hasChimney = !!(h % 2);
  const windowCount = 1 + (h % 2); // 1 or 2 windows
  const doorOffset = h % 3 === 0 ? 'left' : h % 3 === 1 ? 'center' : 'right';
  const glowColor = isActive ? 'rgba(76,141,255,0.5)' : isHovered ? 'rgba(49,184,132,0.5)' : 'none';
  const W = 100, H = 110;
  const wallY = roofStyle === 1 ? 45 : 40;
  const wallH = H - wallY - 15;
  const doorX = doorOffset === 'left' ? 12 : doorOffset === 'center' ? 38 : 62;
  const roofPts = roofStyle === 2
    ? `50,5 92,${wallY} 8,${wallY}`
    : roofStyle === 0
    ? `50,12 90,${wallY} 10,${wallY}`
    : `8,${wallY-12} 92,${wallY-12} 92,${wallY} 8,${wallY}`;

  const win1X = 16, win2X = 62;
  const winY = wallY + 12;
  const smokes = isActive ? `
    <circle cx="${hasChimney?78:72}" cy="${wallY-10}" r="3" fill="${pal.smoke}" opacity="0.6">
      <animate attributeName="cy" values="${wallY-10};${wallY-22};${wallY-10}" dur="1.8s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.6;0;0.6" dur="1.8s" repeatCount="indefinite"/>
    </circle>` : '';

  return `<svg viewBox="0 0 ${W} ${H}" width="${W*scale}" height="${H*scale}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;filter:${glowColor !== 'none' ? `drop-shadow(0 0 10px ${glowColor})` : 'none'};transition:filter 0.2s">
    <!-- Ground shadow -->
    <ellipse cx="50" cy="${H-6}" rx="42" ry="5" fill="rgba(0,0,0,0.12)"/>
    <!-- Roof -->
    <polygon points="${roofPts}" fill="${pal.roof}"/>
    ${hasChimney ? `<rect x="74" y="${wallY-20}" width="8" height="16" fill="${pal.roof}" rx="1"/>` : ''}
    ${smokes}
    <!-- Wall -->
    <rect x="8" y="${wallY}" width="84" height="${wallH}" fill="${pal.wall}" rx="2"/>
    <!-- Windows -->
    <rect x="${win1X}" y="${winY}" width="14" height="13" fill="${pal.window}" rx="1" stroke="${pal.roof}" stroke-width="1.5"/>
    ${windowCount === 2 ? `<rect x="${win2X}" y="${winY}" width="14" height="13" fill="${pal.window}" rx="1" stroke="${pal.roof}" stroke-width="1.5"/>` : ''}
    <!-- Window cross -->
    <line x1="${win1X+7}" y1="${winY}" x2="${win1X+7}" y2="${winY+13}" stroke="${pal.roof}" stroke-width="1"/>
    <line x1="${win1X}" y1="${winY+6}" x2="${win1X+14}" y2="${winY+6}" stroke="${pal.roof}" stroke-width="1"/>
    ${windowCount === 2 ? `<line x1="${win2X+7}" y1="${winY}" x2="${win2X+7}" y2="${winY+13}" stroke="${pal.roof}" stroke-width="1"/><line x1="${win2X}" y1="${winY+6}" x2="${win2X+14}" y2="${winY+6}" stroke="${pal.roof}" stroke-width="1"/>` : ''}
    <!-- Door -->
    <rect x="${doorX}" y="${wallY+wallH-24}" width="18" height="24" fill="${pal.door}" rx="2"/>
    <circle cx="${doorX+14}" cy="${wallY+wallH-12}" r="2" fill="${pal.window}"/>
  </svg>`;
}

function renderTeamsCanvas() {
  const canvas = document.getElementById('teams-canvas');
  if (!canvas) return;

  const countEl = document.getElementById('teams-count');
  if (countEl) countEl.textContent = `${teamsData.length} team${teamsData.length !== 1 ? 's' : ''}`;

  if (teamsData.length === 0) {
    canvas.innerHTML = `
      <div style="text-align:center;color:var(--muted);padding:60px 20px">
        <div style="font-size:48px;margin-bottom:16px">🏘️</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:8px">No teams yet</div>
        <div style="font-size:13px;margin-bottom:20px">Teams group your scheduled agents under a manager who reviews their performance and improves them automatically.</div>
        <button onclick="openCreateTeamModal()" style="background:var(--brand);color:#fff;border:none;border-radius:10px;padding:10px 24px;font-size:13px;font-weight:700;cursor:pointer">+ Create Team</button>
      </div>`;
    return;
  }

  canvas.innerHTML = teamsData.map((team, idx) => {
    const isActive = team.id === activeTeamId;
    const agentCount = team.subagentIds?.length || 0;
    const hasPending = (team.pendingChanges || []).length > 0;
    const isPaused = team.manager?.paused === true;
    return `
      <div class="team-house-wrap" data-team-id="${team.id}" 
           onclick="openTeamBoard('${team.id}')" 
           onmouseenter="showHousePopover(this, '${team.id}')" 
           onmouseleave="hideHousePopover()"
           style="display:inline-flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;padding:16px;border-radius:16px;transition:all 0.2s;position:relative;${isActive ? 'transform:scale(1.05)' : ''};${isPaused ? 'opacity:0.72' : ''}">
        <div class="house-svg" style="position:relative">
          ${drawHouseSVG(team, isActive, false)}
          ${hasPending ? `<div style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;border-radius:50%;background:#e05c5c;border:2px solid var(--bg)"></div>` : ''}
          ${isPaused ? `<div style="position:absolute;bottom:-4px;right:-6px;font-size:11px;background:#fff6e9;color:#7a5a00;border:1px solid #f2dfbd;border-radius:999px;padding:1px 5px;font-weight:700">⏸</div>` : ''}
        </div>
        <div style="font-size:11px;font-weight:800;color:var(--text);letter-spacing:-0.01em;max-width:110px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(team.name)}</div>
        <div style="font-size:10px;color:var(--muted);font-weight:600">${agentCount} agent${agentCount !== 1 ? 's' : ''}${isPaused ? ' · paused' : ''}</div>
      </div>`;
  }).join('');
}

// --- Popover -----------------------------------------------------------------
let _popoverTimeout = null;
function showHousePopover(el, teamId) {
  clearTimeout(_popoverTimeout);
  const team = teamsData.find(t => t.id === teamId);
  if (!team) return;
  let existing = document.getElementById('house-popover');
  if (!existing) {
    existing = document.createElement('div');
    existing.id = 'house-popover';
    existing.style.cssText = 'position:fixed;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-md);padding:12px 14px;font-size:12px;z-index:9999;min-width:200px;max-width:260px;pointer-events:none;transition:opacity 0.15s';
    document.body.appendChild(existing);
  }
  const subagents = team.subagentIds || [];
  const lastNote = (team.managerNotes || []).slice(-1)[0];
  const lastRun = team.lastActivityAt ? timeAgo(team.lastActivityAt) : 'Never';
  existing.innerHTML = `
    <div style="font-weight:800;margin-bottom:6px;color:var(--text)">${escHtml(team.name)}</div>
    <div style="color:var(--muted);display:flex;flex-direction:column;gap:3px">
      <div>👥 ${subagents.length} subagent${subagents.length !== 1 ? 's' : ''}</div>
      <div>🕐 Last activity: ${lastRun}</div>
      <div>📋 Total runs: ${team.totalRuns || 0}</div>
      ${lastNote ? `<div style="margin-top:6px;font-style:italic;color:var(--muted);font-size:11px">${escHtml(lastNote.content.slice(0,100))}${lastNote.content.length > 100 ? '…' : ''}</div>` : ''}
    </div>`;
  const rect = el.getBoundingClientRect();
  existing.style.opacity = '1';
  existing.style.left = (rect.left + rect.width/2 - 100) + 'px';
  existing.style.top = (rect.top - 10) + 'px';
  existing.style.transform = 'translateY(-100%)';
}
function hideHousePopover() {
  _popoverTimeout = setTimeout(() => {
    const p = document.getElementById('house-popover');
    if (p) p.style.opacity = '0';
  }, 200);
}

// --- Team Board ---------------------------------------------------------------
async function openTeamBoard(teamId) {
  activeTeamId = teamId;
  teamBoardTab = 'context';
  const board = document.getElementById('team-board');
  const canvas = document.getElementById('teams-canvas-wrap');

  // Slide canvas to 38%, board slides in at 62%
  canvas.style.transition = 'width 0.38s cubic-bezier(0.4,0,0.2,1)';
  canvas.style.width = '38%';
  board.style.display = 'flex';
  board.style.transition = 'opacity 0.3s ease';
  board.style.width = '62%';
  board.style.opacity = '0';
  setTimeout(() => { board.style.opacity = '1'; }, 60);

  // Fade + blur inactive houses
  document.querySelectorAll('.team-house-wrap').forEach(el => {
    const isActive = el.dataset.teamId === teamId;
    el.style.transition = 'opacity 0.3s, filter 0.3s, transform 0.38s cubic-bezier(0.4,0,0.2,1)';
    el.style.opacity = isActive ? '1' : '0.25';
    el.style.filter = isActive ? '' : 'blur(2px)';
    el.style.pointerEvents = isActive ? '' : 'none';
  });

  // After canvas shrinks, show the new vertical panels
  setTimeout(() => _showTeamPanels(teamId), 420);

  // Load data
  await loadTeamBoardData(teamId);
  renderTeamBoard(teamId);
}

function _showTeamPanels(teamId) {
  const canvasWrap = document.getElementById('teams-canvas-wrap');
  const canvasInner = document.getElementById('teams-canvas');
  if (!canvasWrap || !canvasInner) return;

  const team = teamsData.find(t => t.id === teamId);
  if (!team) return;

  // Hide house tiles, replace with vertical panel layout
  canvasInner.style.display = 'none';

  // Remove old panels if any
  const oldPanels = document.getElementById('team-side-panels');
  if (oldPanels) oldPanels.remove();

  const panels = document.createElement('div');
  panels.id = 'team-side-panels';
  panels.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:10px;padding:12px;overflow-y:auto;';

  panels.innerHTML = _buildHousePanel(team) + _buildWorkspacePanel(teamId) + _buildProgressPanel(teamId);
  canvasWrap.appendChild(panels);

  // Animate in
  panels.style.opacity = '0';
  panels.style.transform = 'translateY(12px)';
  panels.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    panels.style.opacity = '1';
    panels.style.transform = 'translateY(0)';
  }));
}

function _buildHousePanel(team) {
  const agentIds = team.subagentIds || [];
  const colors = ['#4c8dff', '#31b884', '#d6a64f', '#e05c5c', '#a78bfa', '#4c8dff'];
  const emojis = ['🧠', '🤖', '👾', '🦾', '⚡', '🛸'];
  const allAgents = [{ id: '__manager__', label: 'Manager', emoji: '🧠', color: '#4c8dff' },
    ...agentIds.map((id, i) => {
      const agentObj = window._allAgentsForTeam?.find(a => a.id === id);
      return { id, label: agentObj?.name || id, emoji: agentObj?.emoji || emojis[(i+1)%emojis.length], color: colors[(i+1)%colors.length] };
    })];

  return `
    <div style="background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;flex-shrink:0">
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
        ${drawHouseSVG(team, true, false, 0.85)}
        <div style="font-size:13px;font-weight:800;color:var(--text);text-align:center">${escHtml(team.name)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">
          ${allAgents.map(a => `
            <div style="display:flex;align-items:center;gap:5px;background:var(--panel-2);border:1px solid var(--line);border-radius:20px;padding:3px 10px 3px 4px">
              <div style="width:22px;height:22px;border-radius:50%;background:${a.color};display:flex;align-items:center;justify-content:center;font-size:12px">${a.emoji}</div>
              <span style="font-size:11px;font-weight:700;color:var(--text);max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(a.label)}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

function _buildWorkspacePanel(teamId) {
  const files = teamWorkspaceFiles || [];
  const fileRows = files.length === 0
    ? `<div style="text-align:center;color:var(--muted);font-size:12px;padding:16px 8px">No workspace files yet.<br><span style="font-size:11px">Agents can read/write shared files here.</span></div>`
    : files.map(f => {
        const ext = (f.name || '').split('.').pop().toLowerCase();
        const icon = { json:'📄', md:'📝', txt:'📝', csv:'📊', html:'🌐', js:'⚙️', py:'🐍' }[ext] || '📁';
        const size = f.size > 1024 ? (f.size/1024).toFixed(1)+'kb' : f.size+'b';
        const agentTag = f.writtenBy ? `<span style="font-size:10px;background:#eaf2ff;color:#0d4faf;border-radius:4px;padding:1px 5px">${escHtml(f.writtenBy)}</span>` : '';
        return `
          <div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;background:var(--panel-2);border:1px solid var(--line)">
            <span style="font-size:16px">${icon}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(f.name)}</div>
              <div style="display:flex;gap:6px;align-items:center;margin-top:2px">
                <span style="font-size:10px;color:var(--muted)">${size}</span>
                ${f.modifiedAt ? `<span style="font-size:10px;color:var(--muted)">${timeAgo(f.modifiedAt)}</span>` : ''}
                ${agentTag}
              </div>
            </div>
          </div>`;
      }).join('');

  return `
    <div style="background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;flex-shrink:0">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--panel-2)">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:14px">🗂</span>
          <span style="font-size:12px;font-weight:800;letter-spacing:-0.01em">Workspace</span>
          ${files.length > 0 ? `<span style="font-size:10px;background:#e8f5ed;color:#166534;border-radius:999px;padding:1px 8px;font-weight:700">${files.length} file${files.length!==1?'s':''}</span>` : ''}
        </div>
        <button onclick="refreshTeamWorkspace('${teamId}')" title="Refresh workspace" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer">↻</button>
      </div>
      <div id="team-workspace-files-${teamId}" style="padding:8px;display:flex;flex-direction:column;gap:5px;max-height:200px;overflow-y:auto">
        ${fileRows}
      </div>
    </div>`;
}

function _teamRunKey(run, idx) {
  if (run?.taskId) return `task:${String(run.taskId)}`;
  if (run?.id) return `run:${String(run.id)}`;
  return `run:${String(run?.agentId || 'agent')}:${Number(run?.startedAt || 0)}:${idx}`;
}

function _teamRunStartedAt(run) {
  return Number(run?.startedAt || 0);
}

function _teamRunIsInProgress(run) {
  if (run?.inProgress === true) return true;
  const status = String(run?.taskStatus || '').toLowerCase();
  if (status === 'running' || status === 'queued' || status === 'waiting_subagent') return true;
  if (status === 'paused' || status === 'stalled' || status === 'needs_assistance' || status === 'awaiting_user_input') return false;
  const finishedAt = Number(run?.finishedAt || run?.endedAt || 0);
  if (finishedAt > 0) return false;
  return false;
}

function _escapeOnclickArg(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function _getTeamProgressEntries(teamId) {
  const merged = new Map();
  const baseRuns = Array.isArray(teamRuns) ? teamRuns : [];
  const liveRuns = Object.values(teamActiveRunsByTeam?.[teamId] || {});

  for (const run of [...baseRuns, ...liveRuns]) {
    const key = run?.taskId
      ? `task:${String(run.taskId)}`
      : (run?.id ? `run:${String(run.id)}` : `run:${String(run?.agentId || 'agent')}:${Number(run?.startedAt || 0)}`);
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...run });
      continue;
    }
    const preferNext = _teamRunIsInProgress(run) || _teamRunStartedAt(run) >= _teamRunStartedAt(prev);
    merged.set(key, preferNext ? { ...prev, ...run } : prev);
  }

  return Array.from(merged.values())
    .sort((a, b) => _teamRunStartedAt(b) - _teamRunStartedAt(a))
    .slice(0, 8);
}

function _refreshTeamProgressPanel(teamId) {
  const panel = document.getElementById(`team-progress-panel-${teamId}`);
  if (!panel) return;
  panel.outerHTML = _buildProgressPanel(teamId);
}

function _isTeamTaskProgressExpanded(teamId, taskId) {
  const needle = `${teamId}::task:${String(taskId || '')}`;
  return !!teamProgressExpandedRuns[needle];
}

async function loadTeamProgressTask(taskId, teamId) {
  const id = String(taskId || '').trim();
  if (!id || teamProgressTaskLoading[id]) return;
  const cached = teamProgressTaskCache[id];
  if (cached && (Date.now() - Number(cached.loadedAt || 0) < 4000)) return;
  teamProgressTaskLoading[id] = true;
  _refreshTeamProgressPanel(teamId);
  try {
    const data = await api(`/api/bg-tasks/${id}`);
    const task = data?.task;
    if (!task) throw new Error('Task not found');
    const items = getTaskProgressItems(task);
    teamProgressTaskCache[id] = {
      title: String(task.title || ''),
      status: String(task.status || ''),
      loadedAt: Date.now(),
      items: items.map((item, idx) => ({
        id: String(item?.id || `task_${idx + 1}`),
        text: String(item?.text || `Step ${idx + 1}`).slice(0, 200),
        status: normalizeProgressStatus(item?.status),
      })),
    };
    const status = String(task.status || '').toLowerCase();
    if (status === 'complete' || status === 'failed') {
      for (const tid of Object.keys(teamActiveRunsByTeam || {})) {
        if (teamActiveRunsByTeam[tid]?.[id]) delete teamActiveRunsByTeam[tid][id];
      }
    }
  } catch (err) {
    teamProgressTaskCache[id] = {
      title: '',
      status: '',
      loadedAt: Date.now(),
      items: [],
      error: String(err?.message || err || 'Failed to load progress'),
    };
  } finally {
    delete teamProgressTaskLoading[id];
    _refreshTeamProgressPanel(teamId);
  }
}

async function toggleTeamProgressRun(teamId, runKey, taskId) {
  const key = `${teamId}::${runKey}`;
  if (teamProgressExpandedRuns[key]) {
    delete teamProgressExpandedRuns[key];
    _refreshTeamProgressPanel(teamId);
    return;
  }
  teamProgressExpandedRuns[key] = true;
  _refreshTeamProgressPanel(teamId);
  if (taskId) await loadTeamProgressTask(taskId, teamId);
}

function _buildProgressPanel(teamId) {
  const recentRuns = _getTeamProgressEntries(teamId);
  const jsTeamId = _escapeOnclickArg(teamId);
  const rows = recentRuns.length === 0
    ? `<div class="progress-empty">Progress - This panel will be used to make a short to-do list</div>`
    : `<div class="team-progress-runs">${recentRuns.map((run, idx) => {
        const runKey = _teamRunKey(run, idx);
        const expandKey = `${teamId}::${runKey}`;
        const isOpen = !!teamProgressExpandedRuns[expandKey];
        const isInProgress = _teamRunIsInProgress(run);
        const runTitle = String(run?.agentName || run?.agentId || 'agent');
        const timeLabel = _teamRunStartedAt(run) > 0 ? timeAgo(_teamRunStartedAt(run)) : '';
        const durationSec = Number(run?.durationMs || 0) > 0 ? `${Math.max(1, Math.round(Number(run.durationMs) / 1000))}s` : '';
        const trigger = String(run?.trigger || '').trim();
        const summary = String(run?.taskSummary || run?.resultPreview || run?.error || '').trim().slice(0, 140);
        const runStatus = String(run?.taskStatus || '').toLowerCase();
        let metaClass = isInProgress ? 'pending' : (run?.success ? 'ok' : 'fail');
        let metaText = isInProgress ? 'In progress' : (run?.success ? 'Complete' : 'Failed');
        if (!isInProgress && runStatus === 'paused') { metaClass = 'pending'; metaText = 'Paused'; }
        if (!isInProgress && runStatus === 'stalled') { metaClass = 'fail'; metaText = 'Stalled'; }
        if (!isInProgress && runStatus === 'needs_assistance') { metaClass = 'fail'; metaText = 'Needs input'; }
        if (!isInProgress && runStatus === 'awaiting_user_input') { metaClass = 'pending'; metaText = 'Waiting'; }
        const subline = [trigger, timeLabel, (!isInProgress ? durationSec : '')].filter(Boolean).join(' · ');
        const jsRunKey = _escapeOnclickArg(runKey);
        const jsTaskId = _escapeOnclickArg(run?.taskId || '');
        const taskId = String(run?.taskId || '').trim();
        const cached = taskId ? teamProgressTaskCache[taskId] : null;
        const loading = taskId ? !!teamProgressTaskLoading[taskId] : false;
        const fallbackItems = summary
          ? [{
              id: `summary_${idx + 1}`,
              text: summary,
              status: isInProgress ? 'in_progress' : (run?.success ? 'done' : 'pending'),
            }]
          : [];
        const progressItems = cached?.items?.length ? cached.items : fallbackItems;
        const detailBody = loading
          ? `<div class="progress-empty">Loading progress...</div>`
          : (cached?.error
              ? `<div class="progress-empty">${escHtml(String(cached.error))}</div>`
              : (progressItems.length > 0
                  ? `<div class="progress-list">${renderChecklistItemsHTML(progressItems, { maxText: 200 })}</div>`
                  : `<div class="progress-empty">No checklist available for this run yet.</div>`));

        return `
          <div class="team-progress-run${isOpen ? ' open' : ''}">
            <button class="team-progress-run-btn" onclick="toggleTeamProgressRun('${jsTeamId}','${jsRunKey}','${jsTaskId}')">
              <div class="team-progress-run-main">
                <div class="team-progress-run-title">${escHtml(runTitle)}</div>
                <div class="team-progress-run-sub">${escHtml(subline || (isInProgress ? 'Running now' : 'Recent run'))}</div>
              </div>
              <span class="team-progress-run-meta ${metaClass}">
                ${isInProgress ? '<span class="team-progress-inline-spinner"></span>' : ''}
                ${escHtml(metaText)}
              </span>
              <span class="team-progress-run-chevron">▾</span>
            </button>
            ${isOpen ? `
              <div class="team-progress-run-body">
                <div class="progress-card">
                  <div class="progress-card-header" style="cursor:default;padding-bottom:6px">
                    <span>Progress</span>
                  </div>
                  <div class="progress-list-wrap">
                    ${detailBody}
                  </div>
                </div>
              </div>` : ''}
          </div>`;
      }).join('')}</div>`;

  return `
    <div id="team-progress-panel-${teamId}" style="background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;flex-shrink:0">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--panel-2)">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:14px">📋</span>
          <span style="font-size:12px;font-weight:800;letter-spacing:-0.01em">Progress</span>
        </div>
        <span style="font-size:10px;color:var(--muted)">Recent runs</span>
      </div>
      <div id="team-progress-steps-${teamId}" style="padding:8px 12px;max-height:320px;overflow-y:auto">
        ${rows}
      </div>
    </div>`;
}

async function refreshTeamWorkspace(teamId) {
  try {
    const data = await api(`/api/teams/${teamId}/workspace`).catch(() => ({ files: [], tree: [] }));
    teamWorkspaceFiles = data.files || [];
    teamWorkspaceTree = data.tree || [];
    const el = document.getElementById(`team-workspace-files-${teamId}`);
    if (el) {
      if (teamWorkspaceTree.length === 0) {
        el.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:12px;padding:16px 8px">No workspace files yet.<br><span style="font-size:11px">Agents can read/write shared files here.</span></div>`;
      } else {
        el.innerHTML = renderWorkspaceTree(teamWorkspaceTree, 0);
      }
    }
  } catch(e) {
    console.warn('[Teams] Workspace refresh failed', e);
  }
}

// -- Team inline rename -----------------------------------------------------------------------

function startTeamRename(teamId) {
  const display = document.getElementById('team-name-display-' + teamId);
  const input = document.getElementById('team-name-input-' + teamId);
  if (!display || !input) return;

  // Show input, hide display
  display.style.display = 'none';
  input.style.display = 'block';
  input.focus();
  input.select();

  function cancelRename() {
    // Restore original name and hide input
    const team = teamsData.find(t => t.id === teamId);
    if (team) input.value = team.name;
    input.style.display = 'none';
    display.style.display = 'inline-flex';
    input.removeEventListener('keydown', onKeydown);
    input.removeEventListener('blur', onBlur);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const newName = input.value.trim();
      const team = teamsData.find(t => t.id === teamId);
      if (!newName || !team || newName === team.name) { cancelRename(); return; }
      // Remove listeners before showing modal (blur would fire otherwise)
      input.removeEventListener('keydown', onKeydown);
      input.removeEventListener('blur', onBlur);
      confirmTeamRename(teamId, newName, cancelRename);
    }
  }

  function onBlur() {
    // Small delay so if the user pressed Enter, keydown fires first
    setTimeout(() => {
      if (document.getElementById('team-rename-modal')) return; // modal open, don’t cancel
      cancelRename();
    }, 120);
  }

  input.addEventListener('keydown', onKeydown);
  input.addEventListener('blur', onBlur);
}

function confirmTeamRename(teamId, newName, onCancel) {
  // Remove any existing modal
  const existing = document.getElementById('team-rename-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'team-rename-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--panel,#fff);border-radius:14px;padding:24px 28px;min-width:320px;max-width:420px;box-shadow:0 8px 40px rgba(0,0,0,0.18);border:1px solid var(--line)">
      <div style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:10px">✏️ Rename Team</div>
      <div style="font-size:14px;color:var(--muted);margin-bottom:20px">You are changing the team name to<br><strong style="color:var(--text);font-size:15px">${escHtml(newName)}</strong></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="team-rename-cancel" style="border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:7px 18px;font-size:13px;font-weight:600;cursor:pointer;color:var(--muted)">Cancel</button>
        <button id="team-rename-confirm" style="border:none;background:var(--brand,#2563eb);color:#fff;border-radius:8px;padding:7px 18px;font-size:13px;font-weight:700;cursor:pointer">Confirm</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  function closeModal() {
    modal.remove();
  }

  document.getElementById('team-rename-cancel').onclick = () => {
    closeModal();
    if (onCancel) onCancel();
  };

  document.getElementById('team-rename-confirm').onclick = async () => {
    closeModal();
    try {
      const res = await api(`/api/teams/${teamId}`, { method: 'PUT', body: JSON.stringify({ name: newName }) });
      if (res.success) {
        // Update local cache
        const team = teamsData.find(t => t.id === teamId);
        if (team) team.name = newName;
        // Re-render header + team canvas card
        renderTeamBoard(teamId);
        renderTeamsCanvas();
        bgtToast('✏️ Team renamed', newName);
      } else {
        bgtToast('? Rename failed', res.error || 'Unknown error');
        if (onCancel) onCancel();
      }
    } catch (err) {
      bgtToast('? Rename failed', err.message || 'Unknown error');
      if (onCancel) onCancel();
    }
  };

  // Click backdrop to cancel
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
      if (onCancel) onCancel();
    }
  });
}

function closeTeamBoard() {
  activeTeamId = null;
  clearInterval(teamChatPolling);
  teamChatPolling = null;

  // Remove agent overlay (legacy) and new side panels
  const overlay = document.getElementById('teams-agent-overlay');
  if (overlay) overlay.remove();
  const sidePanels = document.getElementById('team-side-panels');
  if (sidePanels) sidePanels.remove();

  // Restore the canvas grid
  const canvasInner = document.getElementById('teams-canvas');
  if (canvasInner) canvasInner.style.display = '';

  const board = document.getElementById('team-board');
  const canvas = document.getElementById('teams-canvas-wrap');
  canvas.style.width = '100%';
  board.style.opacity = '0';
  setTimeout(() => { board.style.display = 'none'; }, 350);

  // Restore all houses
  document.querySelectorAll('.team-house-wrap').forEach(el => {
    el.style.opacity = '1';
    el.style.filter = '';
    el.style.transform = '';
    el.style.boxShadow = '';
    el.style.pointerEvents = '';
    el.style.zIndex = '';
  });
}

async function loadTeamBoardData(teamId) {
  try {
    const [runsData, chatData, workspaceData, agentsData] = await Promise.all([
      api(`/api/teams/${teamId}/runs?limit=50`),
      api(`/api/teams/${teamId}/chat?limit=100`),
      api(`/api/teams/${teamId}/workspace`).catch(() => ({ files: [] })),
      api('/api/agents').catch(() => ({ agents: [] })),
    ]);
    if (agentsData?.agents) {
      window._allAgentsForTeam = agentsData.agents;
    }
    teamRuns = runsData.runs || [];
    const nextLive = {};
    for (const run of teamRuns) {
      const taskId = String(run?.taskId || '').trim();
      if (!taskId) continue;
      if (_teamRunIsInProgress(run)) {
        nextLive[taskId] = { ...run };
      }
    }
    teamActiveRunsByTeam[teamId] = nextLive;
    teamChatMessages = chatData.messages || [];
    teamWorkspaceFiles = workspaceData.files || [];
      teamWorkspaceTree = workspaceData.tree || [];
    activeTeamChatSignature = getTeamChatSignature(teamChatMessages);
  } catch (err) {
    console.error('[Teams] Load board data failed:', err);
  }
}

function renderTeamBoard(teamId) {
  const team = teamsData.find(t => t.id === teamId);
  if (!team) return;
  const header = document.getElementById('team-board-header');
  const body = document.getElementById('team-board-body');
  if (!header || !body) return;

  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
      <div style="font-size:22px">${team.emoji || '🏠'}</div>
      <div style="min-width:0">
        <div id="team-name-display-${teamId}" style="font-size:15px;font-weight:800;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;display:inline-flex;align-items:center;gap:5px" title="Click to rename" onclick="startTeamRename('${teamId}')">${escHtml(team.name)}<span style="font-size:11px;opacity:0;transition:opacity 0.15s" class="team-rename-hint">✏️</span></div>
        <input id="team-name-input-${teamId}" type="text" value="${escHtml(team.name)}" style="display:none;font-size:15px;font-weight:800;letter-spacing:-0.01em;border:none;border-bottom:2px solid var(--brand);outline:none;background:transparent;color:var(--text);padding:0;width:220px" />
        <div style="font-size:11px;color:var(--muted)">${(team.subagentIds||[]).length} subagents · ${team.totalRuns||0} total runs${team.manager?.paused ? ' · ? paused' : ''}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <button onclick="toggleTeamRunPause('${teamId}')" title="${team.manager?.paused ? 'Resume and let the manager coordinate this run' : 'Start a manager-coordinated run'}" style="border:1px solid ${team.manager?.paused ? 'var(--line)' : 'var(--brand)'};background:${team.manager?.paused ? 'var(--panel-2)' : 'var(--brand)'};color:${team.manager?.paused ? 'var(--muted)' : '#fff'};border-radius:8px;padding:5px 14px;font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px">${team.manager?.paused ? '▶ Resume & Start' : '▶ Start Run'}</button>
      <button onclick="${team.manager?.paused ? '' : `pauseTeam('${teamId}')`}" title="Pause all team schedules and manager reviews" ${team.manager?.paused ? 'disabled' : ''} style="border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:600;cursor:${team.manager?.paused ? 'not-allowed' : 'pointer'};color:${team.manager?.paused ? '#c0c8d8' : 'var(--muted)'}">⏸ Pause</button>
      <button onclick="triggerManagerReview('${teamId}')" ${team.manager?.paused ? 'disabled' : ''} title="${team.manager?.paused ? 'Team is paused' : 'Force manager review'}" style="border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:600;cursor:${team.manager?.paused ? 'not-allowed' : 'pointer'};color:${team.manager?.paused ? '#9ba8be' : 'var(--muted)'}">🧠 Review</button>
      <button onclick="deleteTeam('${teamId}')" title="Delete this team" style="border:1px solid #f2c5c5;background:#fff5f5;color:#b42323;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer">🗑 Delete</button>
      <button onclick="closeTeamBoard()" style="border:0;background:none;font-size:18px;cursor:pointer;color:var(--muted);line-height:1">&#x2715;</button>
    </div>`;

  // Tabs
  const tabs = ['context','workspace','memory','runs','chat'];
  const tabLabels = { context:'Context', workspace:'Workspace', memory:'Memory', runs:'Runs', chat:'Team Chat' };
  const pendingCount = (team.pendingChanges||[]).length;
  body.innerHTML = `
    <div style="display:flex;gap:4px;border-bottom:1px solid var(--line);padding:0 16px;flex-shrink:0;background:var(--panel-2)">
      ${tabs.map(t => `
        <button onclick="switchTeamTab('${t}','${teamId}')" 
          style="border:none;background:none;padding:10px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;color:${t===teamBoardTab?'var(--brand)':'var(--muted)'};border-bottom:2px solid ${t===teamBoardTab?'var(--brand)':'transparent'};transition:all 0.15s">
          ${tabLabels[t]}${t==='memory'&&pendingCount>0?` <span style="background:#e05c5c;color:#fff;border-radius:999px;font-size:10px;padding:1px 6px">${pendingCount}</span>`:''}
        </button>`).join('')}
    </div>
    <div id="team-tab-content" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px">
      ${renderTeamTabContent(team)}
    </div>`;

  // Characters section (left side - shown in canvas area)
  renderTeamCharacters(team);

  // Start chat polling
  clearInterval(teamChatPolling);
  if (teamBoardTab === 'chat') {
    teamChatPolling = setInterval(() => {
      api(`/api/teams/${teamId}/chat?limit=100`).then(d => {
        const nextMessages = d.messages || [];
        const nextSig = getTeamChatSignature(nextMessages);
        if (nextSig === activeTeamChatSignature) return;
        teamChatMessages = nextMessages;
        activeTeamChatSignature = nextSig;
        renderActiveTeamChat(teamId, { forceBottom: false });
      }).catch(() => {});
    }, 5000);
  }
}

function switchTeamTab(tab, teamId) {
  teamBoardTab = tab;
  renderTeamBoard(teamId);
  if (tab === 'chat') {
    setTimeout(() => renderActiveTeamChat(teamId, { forceBottom: true }), 100);
  }
}

function renderTeamTabContent(team) {
  switch (teamBoardTab) {
    case 'context': return renderTeamContextTab(team);
    case 'workspace': return renderTeamWorkspaceTab(team);
    case 'memory': return renderTeamMemoryTab(team);
    case 'runs': return renderTeamRunsTab(team);
    case 'chat': return renderTeamChatTab(team);
    default: return '';
  }
}

// --- Workspace file icon helper ---------------------------------------------
function _wsFileIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  return { json:'📄', md:'📝', txt:'📝', log:'📋', csv:'📊', html:'🌐', htm:'🌐',
           js:'⚙️', ts:'⚙️', jsx:'⚙️', tsx:'⚙️', py:'🐍', sh:'⚙️',
           png:'🖼️', jpg:'🖼️', jpeg:'🖼️', gif:'🖼️', svg:'🖼️',
           zip:'📦', gz:'📦', env:'🔒' }[ext] || '📄';
}

function _wsFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes > 1024*1024) return (bytes/1024/1024).toFixed(1)+'MB';
  if (bytes > 1024) return (bytes/1024).toFixed(1)+'KB';
  return bytes+'B';
}

// Render a workspace tree entry (file or folder) at a given indent depth
function renderWorkspaceTree(entries, depth) {
  if (!entries || entries.length === 0) return '';
  const indent = depth * 16;
  return entries.map(entry => {
    if (entry.isDirectory) {
      const relPath = entry.relativePath || entry.name;
      const isOpen = workspaceFolderExpanded.has(relPath);
      const chevron = isOpen ? '▼' : '▶';
      const childrenHtml = isOpen ? renderWorkspaceTree(entry.children || [], depth + 1) : '';
      return `
        <div>
          <div onclick="toggleWorkspaceFolder('${escHtml(relPath)}')" style="display:flex;align-items:center;gap:6px;padding:6px 8px;padding-left:${indent + 8}px;border-radius:7px;cursor:pointer;user-select:none;background:var(--panel-2);border:1px solid var(--line);margin-bottom:2px" onmouseover="this.style.background='var(--panel-hover)'" onmouseout="this.style.background='var(--panel-2)'">
            <span style="color:var(--muted);font-size:11px;width:10px;flex-shrink:0">${chevron}</span>
            <span style="font-size:16px">📁</span>
            <span style="font-size:13px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(entry.name)}/</span>
            <span style="font-size:10px;color:var(--muted)">${(entry.children || []).length} item${(entry.children||[]).length===1?'':'s'}</span>
          </div>
          ${isOpen ? `<div style="border-left:2px solid var(--line);margin-left:${indent + 20}px;margin-bottom:4px;padding-left:4px">${childrenHtml}</div>` : ''}
        </div>`;
    }
    // File entry
    const icon = _wsFileIcon(entry.name);
    const size = _wsFileSize(entry.size);
    const agentTag = entry.writtenBy ? `<span style="font-size:10px;background:#eaf2ff;color:#0d4faf;border-radius:4px;padding:1px 6px;font-weight:600">${escHtml(entry.writtenBy)}</span>` : '';
    const readTags = (entry.readBy || []).map(id => `<span style="font-size:10px;background:#f0fdf4;color:#166534;border-radius:4px;padding:1px 5px">${escHtml(id)}</span>`).join('');
    return `
      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:9px;padding:9px 11px;padding-left:${indent + 11}px;margin-bottom:3px">
        <div style="display:flex;align-items:flex-start;gap:9px">
          <span style="font-size:18px;flex-shrink:0;margin-top:1px">${icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(entry.relativePath || entry.name)}">${escHtml(entry.name)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
              ${size ? `<span style="font-size:11px;color:var(--muted)">${size}</span>` : ''}
              ${entry.modifiedAt ? `<span style="font-size:11px;color:var(--muted)">· ${timeAgo(entry.modifiedAt)}</span>` : ''}
              ${agentTag ? `<span style="font-size:10px;color:var(--muted)">Written by:</span>${agentTag}` : ''}
              ${readTags ? `<span style="font-size:10px;color:var(--muted)">Read by:</span>${readTags}` : ''}
            </div>
            ${entry.preview ? `<div style="font-size:11px;color:var(--muted);margin-top:5px;font-family:'IBM Plex Mono',monospace;background:var(--panel);border:1px solid var(--line);border-radius:5px;padding:5px 7px;white-space:pre-wrap;max-height:56px;overflow:hidden">${escHtml(entry.preview)}</div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

function toggleWorkspaceFolder(relPath) {
  if (workspaceFolderExpanded.has(relPath)) {
    workspaceFolderExpanded.delete(relPath);
  } else {
    workspaceFolderExpanded.add(relPath);
  }
  // Re-render the workspace tab in place without a network round-trip
  const tree = teamWorkspaceTree || [];
  const el = document.querySelector('[id^="team-workspace-files-"]');
  if (el) el.innerHTML = tree.length === 0 ? '' : renderWorkspaceTree(tree, 0);
  // Also re-render the full tab if open
  if (teamBoardTab === 'workspace' && activeTeamId) renderTeamBoard(activeTeamId);
}

function renderTeamWorkspaceTab(team) {
  const tree = teamWorkspaceTree || [];
  const treeHtml = tree.length === 0
    ? `<div style="text-align:center;color:var(--muted);font-size:13px;padding:32px 16px">
        <div style="font-size:36px;margin-bottom:10px">🗂</div>
        <div style="font-weight:700;margin-bottom:6px">No workspace files yet</div>
        <div style="font-size:12px;line-height:1.6">Agents write shared files here during runs.<br>Example: a scraper writes <code style="background:var(--panel-2);padding:1px 5px;border-radius:4px">news.json</code>, a writer reads it and outputs <code style="background:var(--panel-2);padding:1px 5px;border-radius:4px">post.md</code>.</div>
      </div>`
    : `<div style="display:flex;flex-direction:column;gap:0">${renderWorkspaceTree(tree, 0)}</div>`;

  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:800">Shared Workspace</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Files agents create, read, and pass between each other during runs</div>
        </div>
        <button onclick="refreshTeamWorkspace('${team.id}');switchTeamTab('workspace','${team.id}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:7px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer">↻ Refresh</button>
      </div>
      <div style="background:var(--panel-2);border:1px dashed var(--line-strong);border-radius:10px;padding:10px 14px;font-size:11px;color:var(--muted);line-height:1.7">
        💡 <strong>How it works:</strong> Each team gets a shared <code style="background:var(--panel);padding:1px 5px;border-radius:4px">workspace/</code> directory. Configure agents to read/write files there. Example pipeline: <em>scraper → news.json → writer → post.md → poster → publish</em>
      </div>
      ${treeHtml}
    </div>`;
}

function getTeamContextReferences(team) {
  const refs = Array.isArray(team?.contextReferences) ? team.contextReferences.slice() : [];
  if (refs.length > 0) {
    return refs.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }
  const legacy = String(team?.contextNotes || '').trim();
  if (!legacy) return [];
  return [{
    id: `legacy_${team.id}`,
    title: 'Legacy Team Context',
    content: legacy,
    createdAt: team?.updatedAt || Date.now(),
    updatedAt: team?.updatedAt || Date.now(),
  }];
}

function renderTeamContextReferenceCards(team) {
  const refs = getTeamContextReferences(team);
  if (refs.length === 0) {
    return `<div style="border:1px dashed var(--line-strong);border-radius:10px;padding:14px;font-size:12px;color:var(--muted);background:var(--panel-2)">
      No reference cards yet. Add one above and it will be injected into manager + subagent runtimes.
    </div>`;
  }
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">
    ${refs.map(ref => {
      const preview = String(ref.content || '').trim().replace(/\s+/g, ' ').slice(0, 150);
      return `<button onclick="openTeamContextRefModal('${team.id}','${escHtml(ref.id)}')" style="text-align:left;border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:10px;cursor:pointer;display:flex;flex-direction:column;gap:6px;min-height:140px">
        <div style="font-size:12px;font-weight:800;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escHtml(ref.title || 'Untitled')}</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical">${escHtml(preview || '(empty)')}</div>
        <div style="margin-top:auto;font-size:10px;color:var(--muted)">Updated ${timeAgo(ref.updatedAt || ref.createdAt || Date.now())}</div>
      </button>`;
    }).join('')}
  </div>`;
}

function renderTeamContextTab(team) {
  const subagents = (team.subagentIds || []).map(id => {
    const agent = /* best effort from agents list */ { id, name: id };
    return agent;
  });
  const purposeText = team.purpose || team.mission || team.teamContext || '';
  const currentTask = team.currentFocus || '';
  const lastReviewAt = team.manager?.lastReviewAt;

  return `
    <div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Purpose</div>
      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:13px;line-height:1.6">${escHtml(purposeText || 'No purpose set.')}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Current Task / Goal</div>
        <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:13px;line-height:1.6;min-height:56px;color:${currentTask ? 'var(--text)' : 'var(--muted)'}">
          ${currentTask ? escHtml(currentTask) : '<span style="font-style:italic">No active task — starts on next run</span>'}
        </div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Last Run</div>
        <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:13px;line-height:1.6;min-height:56px;color:${lastReviewAt ? 'var(--text)' : 'var(--muted)'}">
          ${lastReviewAt
            ? `<span title="${new Date(lastReviewAt).toLocaleString()}">${timeAgo(lastReviewAt)}</span>`
            : '<span style="font-style:italic">Never run</span>'}
        </div>
      </div>
    </div>
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)">Context &amp; Reference</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Each save adds a new card. Cards are injected into manager + subagent runtime context.</div>
        </div>
        <button id="ctx-save-btn-${team.id}" onclick="saveTeamContextNotes('${team.id}')" style="flex-shrink:0;border:1px solid var(--brand);background:transparent;color:var(--brand);border-radius:7px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;margin-left:12px">Save</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr;gap:6px;margin-bottom:10px">
        <input
          id="ctx-ref-title-${team.id}"
          type="text"
          placeholder="Reference title (e.g. Brand Voice, API URL, Posting Rules)"
          style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;background:var(--panel);color:var(--text)"
          oninput="document.getElementById('ctx-save-btn-${team.id}').style.background='var(--brand)';document.getElementById('ctx-save-btn-${team.id}').style.color='#fff'"
        />
        <textarea
          id="ctx-ref-content-${team.id}"
          rows="3"
          placeholder="Reference content..."
          style="width:100%;resize:vertical;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;font-family:inherit;background:var(--panel);color:var(--text);line-height:1.5"
          oninput="document.getElementById('ctx-save-btn-${team.id}').style.background='var(--brand)';document.getElementById('ctx-save-btn-${team.id}').style.color='#fff'"
        ></textarea>
      </div>
      ${renderTeamContextReferenceCards(team)}
      <div id="ctx-ref-modal-${team.id}" style="display:none;position:fixed;inset:0;background:rgba(10,20,40,0.42);z-index:9999;align-items:center;justify-content:center;padding:16px">
        <div style="width:min(680px,96vw);max-height:90vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-md);padding:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="font-size:14px;font-weight:800">Edit Context Reference</div>
            <button onclick="closeTeamContextRefModal('${team.id}')" style="border:0;background:none;font-size:18px;cursor:pointer;color:var(--muted)">&#x2715;</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <input id="ctx-ref-modal-title-${team.id}" type="text" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;background:var(--panel-2);color:var(--text)" />
            <textarea id="ctx-ref-modal-content-${team.id}" rows="12" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:12px;line-height:1.5;background:var(--panel-2);color:var(--text);resize:vertical;font-family:inherit"></textarea>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <button onclick="deleteTeamContextReferenceCard('${team.id}')" style="border:1px solid #f2c5c5;background:#fff5f5;color:#b42323;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer">Delete</button>
              <div style="display:flex;gap:6px">
                <button onclick="closeTeamContextRefModal('${team.id}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer">Close</button>
                <button onclick="saveTeamContextReferenceModal('${team.id}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Description</div>
      <div style="font-size:13px;color:var(--muted)">${escHtml(team.description||'')}</div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Subagents (${(team.subagentIds||[]).length})</div>
      <div style="display:flex;flex-direction:column;gap:6px" id="subagent-accordion-${team.id}">
        ${(team.subagentIds||[]).map(id => {
          // Inline stats from run history (synchronous - uses teamRuns which is already loaded)
        const agentRuns = teamRuns.filter(r => r.agentId === id);
        const runCount = agentRuns.length;
        const lastRun = agentRuns[0];
        const hasNotes = true; // will be shown in drawer
        const agentObj = window._allAgentsForTeam ? window._allAgentsForTeam.find(a => a.id === id) : null;
        const schedule = agentObj?.cronSchedule || '';
        const agentEmoji = agentObj?.emoji || '🤖';
        const agentDisplayName = agentObj?.name || id;
        return `
        <div class="subagent-accordion-item" style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;overflow:hidden">
        <div style="display:flex;align-items:center;gap:0">
          <div onclick="toggleSubagentAccordion('${team.id}','${id}')" style="display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;user-select:none;flex:1;min-width:0">
            <div style="width:28px;height:28px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;border:2px solid var(--bg)">${escHtml(agentEmoji)}</div>
              <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(agentDisplayName)}</div>
                  <div style="display:flex;gap:6px;margin-top:2px;align-items:center;flex-wrap:wrap">
                    ${runCount > 0 ? `<span style="font-size:10px;color:var(--muted)">${runCount} run${runCount!==1?'s':''}</span>` : '<span style="font-size:10px;color:var(--muted)">no runs</span>'}
                    ${lastRun ? `<span style="font-size:10px;color:${lastRun.success?'#31b884':'#e05c5c'}">${lastRun.success?'?':'?'} ${timeAgo(lastRun.startedAt)}</span>` : ''}
                    ${schedule ? `<span style="font-size:10px;color:#4c8dff;background:#eaf2ff;border-radius:4px;padding:0 4px;white-space:nowrap">&#128336; ${escHtml(schedule)}</span>` : ''}
                  </div>
                </div>
                <span id="chevron-${team.id}-${id}" style="font-size:11px;color:var(--muted);transition:transform 0.2s;flex-shrink:0">&#9654;</span>
              </div>
              <button onclick="event.stopPropagation();runSubagentNow('${id}',this,'${team.id}')" title="Run now with original instructions" style="flex-shrink:0;border:1px solid var(--line);background:var(--panel);color:var(--brand);border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;margin-right:10px;white-space:nowrap;display:flex;align-items:center;gap:4px">▶️ Run</button>
            </div>
            <div id="subagent-drawer-${team.id}-${id}" style="display:none;border-top:1px solid var(--line);padding:10px 12px;background:var(--panel)">
              <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Loading…</div>
            </div>
          </div>`;
          }).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Dispatch One-Off Task</div>
      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:12px;color:var(--muted)">Send a task to any team member to run immediately, outside their schedule.</div>
        ${team.manager?.paused ? '<div style="font-size:11px;color:#b06b00;background:#fff6e9;border:1px solid #f2dfbd;border-radius:8px;padding:7px 9px">Team is paused. Resume the team to dispatch one-off tasks.</div>' : ''}
        <select id="dispatch-agent-select" ${team.manager?.paused ? 'disabled' : ''} style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:12px;background:var(--panel);color:var(--text)">
          ${(team.subagentIds||[]).map(id => `<option value="${escHtml(id)}">${escHtml(id)}</option>`).join('')}
        </select>
        <textarea id="dispatch-task-input" ${team.manager?.paused ? 'disabled' : ''} rows="2" placeholder="What should this agent do right now?" style="width:100%;resize:vertical;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;font-family:inherit;background:var(--panel);color:var(--text)"></textarea>
        <button onclick="dispatchTeamTask('${team.id}')" ${team.manager?.paused ? 'disabled' : ''} style="background:${team.manager?.paused ? '#9ba8be' : 'var(--brand)'};color:#fff;border:none;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:${team.manager?.paused ? 'not-allowed' : 'pointer'};align-self:flex-start">📬 Dispatch Now</button>
      </div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Manager Config</div>
      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12px;display:flex;flex-direction:column;gap:4px">
        <div><span style="color:var(--muted)">Review trigger:</span> ${team.manager?.reviewTrigger || 'after_each_run'}</div>
        <div><span style="color:var(--muted)">Paused:</span> ${team.manager?.paused ? 'Yes' : 'No'}</div>
        <div><span style="color:var(--muted)">Auto-apply low risk:</span> ${team.manager?.autoApplyLowRisk ? 'Yes' : 'No'}</div>
        <div><span style="color:var(--muted)">Model:</span> ${team.manager?.model || 'Global secondary'}</div>
        ${team.manager?.lastReviewAt ? `<div><span style="color:var(--muted)">Last review:</span> ${timeAgo(team.manager.lastReviewAt)}</div>` : ''}
      </div>
    </div>`;
}

function renderTeamMemoryTab(team) {
  const notes = (team.managerNotes || []).slice().reverse();
  const pending = team.pendingChanges || [];
  const history = (team.changeHistory || []).slice().reverse().slice(0, 20);
  return `
    ${pending.length > 0 ? `
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#e05c5c;margin-bottom:8px">? Pending Changes (${pending.length})</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${pending.map(c => `
            <div style="background:var(--panel-2);border:1px solid var(--line);border-left:3px solid ${c.riskLevel==='high'?'#e05c5c':c.riskLevel==='medium'?'#d6a64f':'#31b884'};border-radius:8px;padding:10px 12px">
              <div style="font-size:12px;font-weight:700;margin-bottom:4px">${escHtml(c.description)}</div>
              <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Risk: ${c.riskLevel} · ${c.targetSubagentId ? 'Target: ' + c.targetSubagentId : 'Team-wide'}</div>
              <div style="display:flex;gap:6px">
                <button onclick="applyTeamChangeFn('${team.id}','${c.id}')" style="background:#31b884;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">Apply</button>
                <button onclick="rejectTeamChangeFn('${team.id}','${c.id}')" style="background:var(--panel);border:1px solid var(--line);color:var(--muted);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer">Reject</button>
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}
    <div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Manager Notes</div>
      ${notes.length === 0 ? '<div style="color:var(--muted);font-size:13px">No notes yet. Manager will write notes after first review.</div>' : ''}
      <div style="display:flex;flex-direction:column;gap:6px">
        ${notes.slice(0,30).map(n => `
          <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span style="font-size:10px;background:${n.type==='decision'?'#eaf2ff':n.type==='analysis'?'#f0fff0':'#fff8e6'};color:${n.type==='decision'?'#0d4faf':n.type==='analysis'?'#0f6e3a':'#7a5a00'};border-radius:4px;padding:2px 6px;font-weight:700">${n.type}</span>
              <span style="font-size:10px;color:var(--muted)">${timeAgo(n.timestamp)}</span>
            </div>
            <div style="font-size:12px;line-height:1.5;color:var(--text)">${escHtml(n.content)}</div>
          </div>`).join('')}
      </div>
    </div>
    ${history.length > 0 ? `
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Change History</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${history.map(c => `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--panel-2);border:1px solid var(--line);border-radius:6px;font-size:11px">
              <span style="color:${c.status==='applied'?'#31b884':'#e05c5c'};font-size:12px">${c.status==='applied'?'?':'?'}</span>
              <span style="flex:1;color:var(--text)">${escHtml(c.description)}</span>
              <span style="color:var(--muted)">${timeAgo(c.appliedAt||c.rejectedAt||c.proposedAt)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}`;
}

function renderTeamRunsTab(team) {
  if (teamRuns.length === 0) {
    return '<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px">No runs yet. Runs will appear here once subagents execute.</div>';
  }
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      ${teamRuns.map(r => `
        <div style="display:flex;align-items:start;gap:10px;background:var(--panel-2);border:1px solid var(--line);border-left:3px solid ${r.success?'#31b884':'#e05c5c'};border-radius:8px;padding:10px 12px">
          <div style="flex-shrink:0;margin-top:2px">
            <span style="font-size:16px">${r.success?'?':'?'}</span>
          </div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
              <span style="font-size:12px;font-weight:700;color:var(--text)">${escHtml(r.agentName||r.agentId)}</span>
              <span style="font-size:10px;color:var(--muted);background:var(--bg-soft);border-radius:4px;padding:1px 6px">${r.trigger}</span>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${new Date(r.startedAt).toLocaleString()} · ${Math.round(r.durationMs/1000)}s · ${r.stepCount||0} steps</div>
            ${r.resultPreview ? `<div style="font-size:11px;color:var(--text);line-height:1.4;opacity:0.9;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(r.resultPreview)}</div>` : ''}
            ${r.error ? `<div style="font-size:11px;color:#e05c5c;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(r.error)}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
}

function renderTeamChatTab(team) {
  const msgs = teamChatMessages.slice(-80);
  const colors = { manager:'#4c8dff', user:'var(--brand)', subagent:'#31b884' };
  return `
    <div id="team-chat-messages" style="flex:1;display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:calc(100% - 80px)">
      ${msgs.length === 0 ? '<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px">Team chat is empty. The manager will post here after each review.</div>' : ''}
      ${msgs.map(m => `
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:11px;font-weight:700;color:${colors[m.from]||'var(--muted)'}">${escHtml(m.fromName)}</span>
            <span style="font-size:10px;color:var(--muted)">${timeAgo(m.timestamp)}</span>
          </div>
          <div style="font-size:12px;line-height:1.5;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(m.content)}</div>
        </div>`).join('')}
    </div>
    <div style="flex-shrink:0;border-top:1px solid var(--line);padding:10px 0 0;margin-top:8px;display:flex;gap:8px;align-items:flex-end">
      <textarea id="team-chat-input" rows="2" placeholder="Message the manager..." style="flex:1;resize:none;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;font-family:inherit;background:var(--panel-2);color:var(--text);outline:none" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendTeamChat('${team.id}');}"></textarea>
      <button onclick="sendTeamChat('${team.id}')" style="background:var(--brand);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;height:36px">Send</button>
    </div>`;
}

function renderTeamCharacters(team) {
  // Characters are now shown in the house panel (_buildHousePanel) when board is open.
  // If side panels are visible, skip the old canvas-based character rendering.
  if (document.getElementById('team-side-panels')) return;

  // Render pixel characters below the house in the canvas area when a team is focused
  // Characters are simple SVG avatars, each unique per agentId
  const wrap = document.getElementById('teams-canvas');
  if (!wrap) return;
  const houseWrap = wrap.querySelector(`[data-team-id="${team.id}"]`);
  if (!houseWrap) return;

  // Remove old character strip
  const old = houseWrap.querySelector('.team-characters');
  if (old) old.remove();

  const charDiv = document.createElement('div');
  charDiv.className = 'team-characters';
  charDiv.style.cssText = 'display:flex;gap:6px;justify-content:center;margin-top:4px;flex-wrap:wrap';

  // Manager character (always first)
  charDiv.innerHTML = renderCharacterSVG('manager', '🧠', '#4c8dff') +
    (team.subagentIds||[]).map((id, i) =>
      renderCharacterSVG(id, ['🤖','👾','🦾','⚡','🛸'][i%5], ['#31b884','#d6a64f','#e05c5c','#a78bfa','#4c8dff'][i%5])
    ).join('');
  houseWrap.appendChild(charDiv);
}

function renderCharacterSVG(id, emoji, color) {
  const h = hashStr(id);
  const bodyColor = color;
  return `<div title="${escHtml(id)}" style="display:flex;flex-direction:column;align-items:center;gap:2px;cursor:default">
    <div style="width:28px;height:28px;border-radius:50%;background:${bodyColor};display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid var(--bg);box-shadow:0 2px 6px rgba(0,0,0,0.18)">${emoji}</div>
    <div style="font-size:9px;color:var(--muted);max-width:36px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(id.slice(0,6))}</div>
  </div>`;
}

// --- Actions -----------------------------------------------------------------
async function sendTeamChat(teamId) {
  const inp = document.getElementById('team-chat-input');
  if (!inp) return;
  const msg = inp.value.trim();
  if (!msg) return;
  inp.value = '';
  teamChatDraftByTeam[teamId] = '';
  inp.disabled = true;
  try {
    await api(`/api/teams/${teamId}/chat`, { method:'POST', body: JSON.stringify({ message: msg }) });
    const data = await api(`/api/teams/${teamId}/chat?limit=100`);
    teamChatMessages = data.messages || [];
    activeTeamChatSignature = getTeamChatSignature(teamChatMessages);
    renderActiveTeamChat(teamId, { forceBottom: true });
  } catch (err) {
    bgtToast('? Error', 'Could not send message');
  } finally {
    inp.disabled = false;
    inp.focus();
  }
}

async function triggerManagerReview(teamId) {
  try {
    bgtToast('🧠 Manager reviewing...', 'Running analysis for your team');
    await api(`/api/teams/${teamId}/manager/trigger`, { method:'POST', body:'{}' });
    await refreshTeams();
    if (activeTeamId === teamId) {
      await loadTeamBoardData(teamId);
      if (teamBoardTab === 'chat') renderActiveTeamChat(teamId, { forceBottom: false });
      else renderTeamBoard(teamId);
    }
  } catch (err) {
    bgtToast('? Error', 'Manager review failed');
  }
}

async function runAllTeamAgents(teamId) {
  const team = teamsData.find(t => t.id === teamId);
  if (team?.manager?.paused) { bgtToast('⏸️ Team paused', 'Resume the team before running agents'); return; }
  try {
    const kickoffTaskRaw = String(team?.currentFocus || '').trim();
    const kickoffTask = kickoffTaskRaw || 'N/A';
    bgtToast('🧠 Manager kickoff', 'Manager is reading purpose/task and dispatching the right subagents');
    await api(`/api/teams/${teamId}/start`, {
      method: 'POST',
      body: JSON.stringify({ task: kickoffTask }),
    });
    // Switch to chat tab so user sees activity immediately
    if (activeTeamId === teamId) {
      teamBoardTab = 'chat';
      await loadTeamBoardData(teamId);
      renderTeamBoard(teamId);
      renderActiveTeamChat(teamId, { forceBottom: true });
    }
  } catch (err) {
    bgtToast('❌ Run failed', err.message || 'Unknown error');
  }
}

// Combined Run/Resume button — if paused: resume then run; if active: just run
async function toggleTeamRunPause(teamId) {
  const team = teamsData.find(t => t.id === teamId);
  if (!team) return;
  if (team.manager?.paused) {
    // Resume first, then kick off a run
    try {
      await api(`/api/teams/${teamId}/resume`, { method: 'POST', body: '{}' });
      bgtToast('▶ Team resumed', 'Starting manager-coordinated run...');
      await refreshTeams();
    } catch (err) {
      bgtToast('❌ Error', err.message || 'Could not resume team');
      return;
    }
  }
  // Now run all agents
  await runAllTeamAgents(teamId);
}

async function saveTeamContextNotes(teamId) {
  const titleInput = document.getElementById(`ctx-ref-title-${teamId}`);
  const contentInput = document.getElementById(`ctx-ref-content-${teamId}`);
  const btn = document.getElementById(`ctx-save-btn-${teamId}`);
  if (!titleInput || !contentInput) return;
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  if (!title || !content) {
    bgtToast('? Error', 'Title and content are required');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const res = await api(`/api/teams/${teamId}/context-references`, {
      method: 'POST',
      body: JSON.stringify({ title, content, actor: 'teams_ui' }),
    });
    const team = teamsData.find(t => t.id === teamId);
    if (team) {
      const refs = Array.isArray(team.contextReferences) ? team.contextReferences.slice() : [];
      if (res?.reference) refs.push(res.reference);
      team.contextReferences = refs;
    }
    titleInput.value = '';
    contentInput.value = '';
    _teamsDataSig = ''; // invalidate sig so next refreshTeams re-renders
    if (btn) { btn.disabled = false; btn.textContent = 'Saved ?'; btn.style.background = '#31b884'; btn.style.color = '#fff'; btn.style.borderColor = '#31b884'; }
    setTimeout(() => {
      if (btn) { btn.textContent = 'Save'; btn.style.background = 'transparent'; btn.style.color = 'var(--brand)'; btn.style.borderColor = 'var(--brand)'; }
    }, 2000);
    if (activeTeamId === teamId) {
      await refreshTeams();
      await loadTeamBoardData(teamId);
      renderTeamBoard(teamId);
    }
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    bgtToast('? Error', 'Could not save context reference');
  }
}

function openTeamContextRefModal(teamId, refId) {
  const team = teamsData.find(t => t.id === teamId);
  if (!team) return;
  const refs = getTeamContextReferences(team);
  const ref = refs.find(r => r.id === refId);
  if (!ref) return;
  const modal = document.getElementById(`ctx-ref-modal-${teamId}`);
  const titleEl = document.getElementById(`ctx-ref-modal-title-${teamId}`);
  const contentEl = document.getElementById(`ctx-ref-modal-content-${teamId}`);
  if (!modal || !titleEl || !contentEl) return;
  modal.dataset.refId = ref.id;
  titleEl.value = ref.title || '';
  contentEl.value = ref.content || '';
  modal.style.display = 'flex';
}

function closeTeamContextRefModal(teamId) {
  const modal = document.getElementById(`ctx-ref-modal-${teamId}`);
  if (modal) modal.style.display = 'none';
}

async function saveTeamContextReferenceModal(teamId) {
  const modal = document.getElementById(`ctx-ref-modal-${teamId}`);
  const titleEl = document.getElementById(`ctx-ref-modal-title-${teamId}`);
  const contentEl = document.getElementById(`ctx-ref-modal-content-${teamId}`);
  const refId = modal?.dataset?.refId;
  if (!modal || !titleEl || !contentEl || !refId) return;
  const title = titleEl.value.trim();
  const content = contentEl.value.trim();
  if (!title || !content) {
    bgtToast('? Error', 'Title and content are required');
    return;
  }
  try {
    const out = await api(`/api/teams/${teamId}/context-references/${encodeURIComponent(refId)}`, {
      method: 'PUT',
      body: JSON.stringify({ title, content, actor: 'teams_ui' }),
    });
    const team = teamsData.find(t => t.id === teamId);
    if (team && out?.reference) {
      const refs = Array.isArray(team.contextReferences) ? team.contextReferences.slice() : [];
      const idx = refs.findIndex(r => r.id === refId);
      if (idx >= 0) refs[idx] = out.reference;
      team.contextReferences = refs;
    }
    closeTeamContextRefModal(teamId);
    await refreshTeams();
    if (activeTeamId === teamId) {
      await loadTeamBoardData(teamId);
      renderTeamBoard(teamId);
    }
    bgtToast('? Saved', 'Context reference updated');
  } catch (err) {
    bgtToast('? Error', 'Could not update context reference');
  }
}

async function deleteTeamContextReferenceCard(teamId) {
  const modal = document.getElementById(`ctx-ref-modal-${teamId}`);
  const refId = modal?.dataset?.refId;
  if (!refId) return;
  if (!confirm('Delete this context reference card?')) return;
  try {
    await api(`/api/teams/${teamId}/context-references/${encodeURIComponent(refId)}`, { method: 'DELETE' });
    const team = teamsData.find(t => t.id === teamId);
    if (team && Array.isArray(team.contextReferences)) {
      team.contextReferences = team.contextReferences.filter(r => r.id !== refId);
    }
    closeTeamContextRefModal(teamId);
    await refreshTeams();
    if (activeTeamId === teamId) {
      await loadTeamBoardData(teamId);
      renderTeamBoard(teamId);
    }
    bgtToast('🗑 Deleted', 'Context reference removed');
  } catch (err) {
    bgtToast('? Error', 'Could not delete context reference');
  }
}

async function pauseTeam(teamId) {
  try {
    await api(`/api/teams/${teamId}/pause`, { method:'POST', body: JSON.stringify({ reason: 'Paused from Teams UI' }) });
    await refreshTeams();
    if (activeTeamId === teamId) {
      await loadTeamBoardData(teamId);
      renderTeamBoard(teamId);
    }
    bgtToast('⏸️ Team paused', 'Schedules and manager reviews are paused');
  } catch (err) {
    bgtToast('? Error', err.message || 'Could not pause team');
  }
}

async function resumeTeam(teamId) {
  try {
    await api(`/api/teams/${teamId}/resume`, { method:'POST', body:'{}' });
    await refreshTeams();
    if (activeTeamId === teamId) {
      await loadTeamBoardData(teamId);
      renderTeamBoard(teamId);
    }
    bgtToast('▶️ Team resumed', 'Schedules and manager reviews are active again');
  } catch (err) {
    bgtToast('? Error', err.message || 'Could not resume team');
  }
}

async function deleteTeam(teamId) {
  const team = teamsData.find(t => t.id === teamId);
  if (!team) return;
  if (!confirm(`Delete team "${team.name}"? Subagents will remain unless you delete them separately.`)) return;
  try {
    await api(`/api/teams/${teamId}`, { method:'DELETE' });
    if (activeTeamId === teamId) closeTeamBoard();
    await refreshTeams();
    bgtToast('🗑 Team deleted', team.name);
  } catch (err) {
    bgtToast('? Error', err.message || 'Could not delete team');
  }
}

// --- Subagent Accordion (Teams Context Panel) ---------------------------------
const _subagentAccordionState = {}; // teamId-agentId -> open bool
const _subagentDrawerCache = {};    // teamId-agentId -> {runs, nextRuns, loadedAt}

async function toggleSubagentAccordion(teamId, agentId) {
  const key = `${teamId}-${agentId}`;
  const drawer = document.getElementById(`subagent-drawer-${teamId}-${agentId}`);
  const chevron = document.getElementById(`chevron-${teamId}-${agentId}`);
  if (!drawer) return;

  const isOpen = _subagentAccordionState[key];
  _subagentAccordionState[key] = !isOpen;

  if (!isOpen) {
    // Opening — show drawer and load data
    drawer.style.display = 'block';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    await loadSubagentDrawer(teamId, agentId);
  } else {
    // Closing
    drawer.style.display = 'none';
    if (chevron) chevron.style.transform = '';
  }
}

async function loadSubagentDrawer(teamId, agentId) {
  // Also try to fetch agent workspace notes for write_notes display
  const drawer = document.getElementById(`subagent-drawer-${teamId}-${agentId}`);
  if (!drawer) return;

  drawer.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:4px 0">Loading…</div>';

  try {
    const [histRes, nextRes, notesRes, agentsMdRes] = await Promise.all([
      fetch(`/api/agents/history?agentId=${encodeURIComponent(agentId)}&limit=10`).then(r => r.json()),
      fetch(`/api/agents/${encodeURIComponent(agentId)}/next-runs?count=3`).then(r => r.json()).catch(() => ({ nextRuns: [] })),
      fetch(`/api/agents/${encodeURIComponent(agentId)}/workspace/notes`).then(r => r.json()).catch(() => null),
      fetch(`/api/agents/${encodeURIComponent(agentId)}/agents-md`).then(r => r.json()).catch(() => null)
    ]);
    const runs = histRes.history || [];
    const nextRuns = nextRes.nextRuns || [];
    const notes = notesRes?.notes || '';
    const agentPrompt = agentsMdRes?.content || agentsMdRes?.md || '';
    renderSubagentDrawerContent(drawer, agentId, runs, nextRuns, notes, agentPrompt);
  } catch (err) {
    drawer.innerHTML = `<div style="font-size:11px;color:#e05c5c">Failed to load: ${escHtml(String(err?.message||err))}</div>`;
  }
}

function renderSubagentDrawerContent(drawer, agentId, runs, nextRuns, notes, agentPrompt) {
  const successColor = '#31b884';
  const failColor = '#e05c5c';

  const nextRunsHtml = nextRuns.length > 0 ? `
    <div style="margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:5px">Upcoming Runs</div>
      <div style="display:flex;flex-direction:column;gap:3px">
        ${nextRuns.map(ts => `
          <div style="display:flex;align-items:center;gap:6px;font-size:11px">
            <span style="color:#4c8dff">&#128197;</span>
            <span>${new Date(ts).toLocaleString(undefined, {weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
          </div>`).join('')}
      </div>
    </div>` : '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">No schedule set.</div>';

  const runsHtml = runs.length === 0
    ? '<div style="font-size:11px;color:var(--muted)">No runs yet.</div>'
    : `<div style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto">
        ${runs.slice(0, 8).map(r => `
          <div style="display:flex;align-items:start;gap:7px;padding:6px 8px;background:var(--panel-2);border:1px solid var(--line);border-left:3px solid ${r.success ? successColor : failColor};border-radius:6px;font-size:11px">
            <span style="flex-shrink:0;margin-top:1px">${r.success ? '?' : '?'}</span>
            <div style="flex:1;min-width:0">
              <div style="display:flex;gap:5px;align-items:center;margin-bottom:1px">
                <span style="font-size:10px;background:var(--bg-soft);color:var(--muted);border-radius:3px;padding:0 4px">${escHtml(r.trigger||'?')}</span>
                <span style="color:var(--muted)">${timeAgo(r.startedAt)}</span>
              </div>
              ${r.resultPreview ? `<div style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px">${escHtml(String(r.resultPreview).slice(0,120))}</div>` : ''}
              ${r.error ? `<div style="color:${failColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px">${escHtml(String(r.error).slice(0,100))}</div>` : ''}
            </div>
            <span style="flex-shrink:0;color:var(--muted);white-space:nowrap">${Math.round((r.durationMs||0)/1000)}s</span>
          </div>`).join('')}
      </div>`;

  const notesHtml = notes && notes.trim()
    ? `<div style="margin-bottom:10px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:4px">📝 Workspace Notes</div>
        <div style="font-size:11px;line-height:1.5;background:var(--panel-2);border:1px solid var(--line);border-radius:6px;padding:7px 9px;color:var(--text);max-height:90px;overflow-y:auto;white-space:pre-wrap;opacity:0.9">${escHtml(notes.trim().slice(0, 600))}${notes.length > 600 ? '…' : ''}</div>
      </div>`
    : '';

  // Store the agentPrompt on the drawer element for runSubagentNow to use
  drawer.dataset.agentPrompt = agentPrompt ? agentPrompt.slice(0, 4000) : '';

  const promptPreviewHtml = agentPrompt && agentPrompt.trim()
    ? `<div style="margin-bottom:10px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:4px">📋 Agent Instructions</div>
        <div style="font-size:11px;line-height:1.5;background:var(--panel-2);border:1px solid var(--line);border-radius:6px;padding:7px 9px;color:var(--text);max-height:80px;overflow-y:auto;white-space:pre-wrap;opacity:0.85;font-family:monospace">${escHtml(agentPrompt.trim().slice(0, 400))}${agentPrompt.trim().length > 400 ? '\u2026' : ''}</div>
      </div>`
    : '';

  drawer.innerHTML = `
    ${nextRunsHtml}
    ${promptPreviewHtml}
    ${notesHtml}
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:5px">Recent Runs</div>
      ${runsHtml}
    </div>`;
}

async function runSubagentNow(agentId, btn, teamId) {
  const origText = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '? Running…'; }
  try {
    // Fetch the agent's system prompt to use as the task instruction
    const agentsRes = await fetch('/api/agents').then(r => r.json());
    const agentDef = (agentsRes?.agents || []).find(a => a.id === agentId);
    const agentTask = agentDef?.systemPrompt || agentDef?.description || agentDef?.name || '';
    if (!agentTask) {
      bgtToast('? Error', 'Agent has no system prompt set. Edit the agent to add instructions.');
      return;
    }

    // Route through the team dispatch endpoint — this uses handleChat (full tools,
    // memory, browser access) instead of the Reactor (stripped-down executor).
    // This is the same pipeline as scheduled task "Run Now".
    if (teamId) {
      const r = await fetch(`/api/teams/${encodeURIComponent(teamId)}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, task: agentTask.slice(0, 4000) })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
    } else {
      // Fallback for non-team agents: use the spawn endpoint
      const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: agentTask.slice(0, 4000) })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
    }
    bgtToast('▶️ Running!', `${agentId} started — check Tasks page for live progress`);
  } catch (err) {
    bgtToast('❌ Failed', String(err?.message || err));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origText; }
  }
}

async function applyTeamChangeFn(teamId, changeId) {
  try {
    await api(`/api/teams/${teamId}/changes/${changeId}/apply`, { method:'POST', body:'{}' });
    await refreshTeams();
    if (activeTeamId === teamId) { await loadTeamBoardData(teamId); renderTeamBoard(teamId); }
    bgtToast('? Change applied', '');
  } catch (err) { bgtToast('? Error', 'Could not apply change'); }
}

async function dispatchTeamTask(teamId) {
  const team = teamsData.find(t => t.id === teamId);
  if (team?.manager?.paused) { bgtToast('⏸️ Team paused', 'Resume the team before dispatching'); return; }
  const agentSel = document.getElementById('dispatch-agent-select');
  const taskInp = document.getElementById('dispatch-task-input');
  if (!agentSel || !taskInp) return;
  const agentId = agentSel.value;
  const task = taskInp.value.trim();
  if (!task) { bgtToast('\u274c Error', 'Enter a task first'); return; }
  taskInp.disabled = true;
  try {
    await api(`/api/teams/${teamId}/dispatch`, { method:'POST', body: JSON.stringify({ agentId, task }) });
    taskInp.value = '';
    bgtToast('📬 Dispatched!', `${agentId} is running your task`);
    // Switch to chat tab to watch results
    switchTeamTab('chat', teamId);
    setTimeout(() => { const el = document.getElementById('team-chat-messages'); if (el) el.scrollTop = el.scrollHeight; }, 200);
  } catch (err) {
    bgtToast('\u274c Error', 'Could not dispatch task');
  } finally {
    taskInp.disabled = false;
  }
}

async function rejectTeamChangeFn(teamId, changeId) {
  try {
    await api(`/api/teams/${teamId}/changes/${changeId}/reject`, { method:'POST', body:'{}' });
    await refreshTeams();
    if (activeTeamId === teamId) { await loadTeamBoardData(teamId); renderTeamBoard(teamId); }
    bgtToast('Change rejected', '');
  } catch (err) { bgtToast('? Error', 'Could not reject change'); }
}

// --- Create Team Modal --------------------------------------------------------
let _allAgentsForTeam = [];
async function openCreateTeamModal(prefill) {
  _allAgentsForTeam = [];
  try {
    const d = await api('/api/agents');
    _allAgentsForTeam = (d.agents||[]).filter(a => !a.default);
  } catch {}

  const modal = document.getElementById('create-team-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  // Prefill from suggestion
  if (prefill) {
    document.getElementById('cteam-name').value = prefill.suggestedName || '';
    document.getElementById('cteam-context').value = prefill.suggestedContext || '';
    document.getElementById('cteam-emoji').value = prefill.suggestedEmoji || '🏠';
  }

  // Render agent checkboxes
  const agentList = document.getElementById('cteam-agents');
  agentList.innerHTML = _allAgentsForTeam.map(a => `
    <label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;cursor:pointer;font-size:12px;background:var(--panel-2)">
      <input type="checkbox" value="${a.id}" ${prefill?.candidateAgentIds?.includes(a.id)?'checked':''}> 
      <span style="font-weight:600">${escHtml(a.name||a.id)}</span>
      ${a.cronSchedule ? `<span style="color:var(--muted);font-size:11px">${escHtml(a.cronSchedule)}</span>` : ''}
    </label>`).join('');

  if (_allAgentsForTeam.length === 0) {
    agentList.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px">No non-default agents found. Create agents first.</div>';
  }
}

function closeCreateTeamModal() {
  document.getElementById('create-team-modal').style.display = 'none';
}

async function saveCreateTeam() {
  const name = document.getElementById('cteam-name').value.trim();
  const context = document.getElementById('cteam-context').value.trim();
  const emoji = document.getElementById('cteam-emoji').value.trim() || '🏠';
  if (!name || !context) { bgtToast('? Error', 'Name and goal are required'); return; }
  const subagentIds = Array.from(document.querySelectorAll('#cteam-agents input[type=checkbox]:checked')).map(cb => cb.value);
  if (subagentIds.length === 0) { bgtToast('? Error', 'Select at least one subagent'); return; }
  const btn = document.getElementById('cteam-save-btn');
  btn.disabled = true; btn.textContent = 'Creating...';
  try {
    await api('/api/teams', {
      method:'POST',
      body: JSON.stringify({
        name,
        description: context.slice(0,100),
        emoji,
        subagentIds,
        teamContext: context,
        kickoffInitialReview: true,
        kickoffAfterSeconds: 30,
      }),
    });
    closeCreateTeamModal();
    await refreshTeams();
    bgtToast('🏠 Team created!', `${name} is ready`);
  } catch (err) {
    bgtToast('? Error', 'Could not create team');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Team';
  }
}

// --- WS Team Events -----------------------------------------------------------
function handleTeamWsEvent(msg) {
  if (msg.type === 'task_running') {
    if (msg.teamId && msg.taskId) {
      if (!teamActiveRunsByTeam[msg.teamId]) teamActiveRunsByTeam[msg.teamId] = {};
      teamActiveRunsByTeam[msg.teamId][msg.taskId] = {
        id: `live_${msg.taskId}`,
        taskId: msg.taskId,
        agentId: msg.agentId,
        agentName: msg.agentName || msg.agentId,
        trigger: 'team_dispatch',
        inProgress: true,
        taskStatus: 'running',
        startedAt: Date.now(),
        success: false,
      };
      if (activeTeamId === msg.teamId) {
        _refreshTeamProgressPanel(msg.teamId);
      }
    }
  }
  if (msg.type === 'task_tool_call') {
    if (msg.teamId && msg.taskId && activeTeamId === msg.teamId && _isTeamTaskProgressExpanded(msg.teamId, msg.taskId)) {
      const taskId = String(msg.taskId);
      if (teamProgressTaskRefreshTimers[taskId]) clearTimeout(teamProgressTaskRefreshTimers[taskId]);
      teamProgressTaskRefreshTimers[taskId] = setTimeout(() => {
        delete teamProgressTaskRefreshTimers[taskId];
        loadTeamProgressTask(taskId, msg.teamId);
      }, 500);
    }
  }
  if (msg.type === 'task_complete') {
    if (msg.teamId && msg.taskId) {
      if (teamActiveRunsByTeam[msg.teamId]?.[msg.taskId]) {
        delete teamActiveRunsByTeam[msg.teamId][msg.taskId];
      }
      if (activeTeamId === msg.teamId) {
        loadTeamBoardData(msg.teamId).then(() => {
          _refreshTeamProgressPanel(msg.teamId);
          if (teamBoardTab === 'runs') renderTeamBoard(msg.teamId);
        });
      }
    }
  }
  if (msg.type === 'team_subagent_completed') {
    const icon = msg.success ? '?' : '?';
    bgtToast(`🏠 ${msg.teamName}`, `${icon} ${msg.agentName} completed a task`);
    refreshTeamsDebounced();
    if (activeTeamId === msg.teamId) {
      loadTeamBoardData(msg.teamId).then(() => {
        if (teamBoardTab === 'chat') renderActiveTeamChat(msg.teamId, { forceBottom: false });
        else renderTeamBoard(msg.teamId);
        // Always refresh workspace cache after a run (agent may have written files)
        api(`/api/teams/${msg.teamId}/workspace`).then(d => {
          if (d?.files) {
            teamWorkspaceFiles = d.files;
            teamWorkspaceTree = d.tree || [];
            if (teamBoardTab === 'workspace') renderTeamBoard(msg.teamId);
          }
        }).catch(() => {});
        // Refresh side panels if open
        const sidePanels = document.getElementById('team-side-panels');
        if (sidePanels) _showTeamPanels(msg.teamId);
      });
    }
  }
  if (msg.type === 'team_manager_review_done') {
    refreshTeamsDebounced();
    if (activeTeamId === msg.teamId) {
      loadTeamBoardData(msg.teamId).then(() => {
        if (teamBoardTab === 'chat') renderActiveTeamChat(msg.teamId, { forceBottom: false });
        else renderTeamBoard(msg.teamId);
      });
    }
  }
  if (msg.type === 'team_dispatch') {
    bgtToast(`📬 ${msg.agentId}`, `Running: ${(msg.task||'').slice(0,80)}`);
  }
  if (msg.type === 'team_dispatch_complete') {
    const icon = msg.success ? '?' : '?';
    bgtToast(`${icon} ${msg.agentId}`, (msg.resultPreview||'').slice(0,100));
    if (activeTeamId === msg.teamId) {
      loadTeamBoardData(msg.teamId).then(() => {
        if (teamBoardTab === 'chat') {
          renderActiveTeamChat(msg.teamId, { forceBottom: false });
        } else if (teamBoardTab === 'workspace') {
          refreshTeamWorkspace(msg.teamId);
          renderTeamBoard(msg.teamId);
        }
      });
    }
  }
  if (msg.type === 'team_workspace_updated') {
    // Agent just wrote file(s) — refresh workspace tab live
    if (activeTeamId === msg.teamId) {
      if (teamBoardTab === 'workspace') {
        refreshTeamWorkspace(msg.teamId);
        renderTeamBoard(msg.teamId);
      } else {
        // Update cached data silently so next tab switch shows fresh files
        api(`/api/teams/${msg.teamId}/workspace`).then(d => {
          if (d?.files) { teamWorkspaceFiles = d.files; teamWorkspaceTree = d.tree || []; }
        }).catch(() => {});
      }
    }
  }
  if (msg.type === 'team_chat_message') {
    if (activeTeamId === msg.teamId && teamBoardTab === 'chat') {
      teamChatMessages.push(msg.message);
      activeTeamChatSignature = getTeamChatSignature(teamChatMessages);
      renderActiveTeamChat(msg.teamId, { forceBottom: false });
    }
  }
  if (msg.type === 'team_change_proposed') {
    bgtToast(`🏠 ${msg.teamName}`, `Manager proposed: ${msg.change?.description?.slice(0,80) || 'a change'}`);
    const badge = document.getElementById('teams-badge');
    if (badge) badge.style.display = 'block';
    refreshTeamsDebounced();
  }
  if (msg.type === 'proposal_created') {
    bgtToast(`🔍 New Proposal`, (msg.title || 'New proposal') + (msg.priority ? ` [${msg.priority}]` : ''));
    const badge = document.getElementById('proposals-badge');
    if (badge) { badge.style.display = 'inline-block'; badge.textContent = '+'; }
    if (currentMode === 'proposals') loadProposals();
    // Always refresh the right-column approval panel — shows in current chat session
    loadSessionApprovals();
  }
  if (msg.type === 'proposal_approved') {
    if (currentMode === 'proposals') loadProposals();
  }
  if (msg.type === 'proposal_executing') {
    bgtToast(`⏳ Executing proposal`, msg.title || 'Proposal running...');
    if (currentMode === 'proposals') loadProposals();
    checkPendingProposalsBadge();
    // Create a placeholder Auto session so user can track it in sidebar
    if (msg.sessionId) {
      const existIdx = chatSessions.findIndex(s => s.id === msg.sessionId);
      if (existIdx === -1) {
        chatSessions.push({
          id: msg.sessionId,
          title: `📝 ${msg.title || 'Proposal execution'}`,
          history: [{ role: 'assistant', content: `⏳ **Executing proposal:** ${msg.title || 'Proposal'}\n\nThis task is running in the background. Results will appear here when complete.` }],
          processLog: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          automated: true,
          unread: true,
          isProposal: true,
        });
        saveChatSessions();
        renderSessionsList();
      }
    }
  }
  if (msg.type === 'proposal_executed') {
    bgtToast(`✅ Proposal complete`, msg.title || 'Execution complete');
    if (currentMode === 'proposals') loadProposals();
    checkPendingProposalsBadge();
    // Update or create the session with the completion summary
    const execSessionId = `proposal_${msg.proposalId}`;
    const sessIdx = chatSessions.findIndex(s => s.id === execSessionId);
    const completionMsg = `✅ **Proposal executed:** ${msg.title || 'Proposal'}\n\nThe task has been completed. Check the Proposals panel for the full execution result.`;
    if (sessIdx !== -1) {
      chatSessions[sessIdx].history.push({ role: 'assistant', content: completionMsg });
      chatSessions[sessIdx].updatedAt = Date.now();
      chatSessions[sessIdx].unread = execSessionId !== activeChatSessionId;
      chatSessions[sessIdx].title = `✅ ${msg.title || 'Proposal'}`;
    } else {
      chatSessions.push({
        id: execSessionId,
        title: `✅ ${msg.title || 'Proposal'}`,
        history: [{ role: 'assistant', content: completionMsg }],
        processLog: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        automated: true,
        unread: true,
        isProposal: true,
      });
    }
    saveChatSessions();
    renderSessionsList();
  }
  if (msg.type === 'proposal_failed') {
    bgtToast(`❌ Proposal failed`, (msg.title || 'Execution failed') + (msg.error ? ': ' + msg.error.slice(0, 80) : ''));
    if (currentMode === 'proposals') loadProposals();
    checkPendingProposalsBadge();
    const execSessionId = `proposal_${msg.proposalId}`;
    const sessIdx = chatSessions.findIndex(s => s.id === execSessionId);
    const failMsg = `❌ **Proposal failed:** ${msg.title || 'Proposal'}\n\n${msg.error || 'An error occurred during execution.'}`;
    if (sessIdx !== -1) {
      chatSessions[sessIdx].history.push({ role: 'assistant', content: failMsg });
      chatSessions[sessIdx].updatedAt = Date.now();
      chatSessions[sessIdx].unread = true;
      chatSessions[sessIdx].title = `❌ ${msg.title || 'Proposal'}`;
      saveChatSessions();
      renderSessionsList();
    }
  }
  if (msg.type === 'proposal_denied') {
    if (currentMode === 'proposals') loadProposals();
    checkPendingProposalsBadge();
  }
  if (msg.type === 'team_paused' || msg.type === 'team_resumed' || msg.type === 'team_deleted' || msg.type === 'team_updated' || msg.type === 'team_created') {
    if (msg.type === 'team_paused') bgtToast(`⏸️ ${msg.teamName || 'Team'}`, 'Paused');
    if (msg.type === 'team_resumed') bgtToast(`▶️ ${msg.teamName || 'Team'}`, 'Resumed');
    if (msg.type === 'team_deleted') bgtToast(`🗑 ${msg.teamName || 'Team'}`, 'Deleted');
    refreshTeamsDebounced();
    if (activeTeamId && msg.teamId && activeTeamId === msg.teamId) {
      if (msg.type === 'team_deleted') {
        closeTeamBoard();
      } else {
        loadTeamBoardData(msg.teamId).then(() => renderTeamBoard(msg.teamId));
      }
    }
  }
  if (msg.type === 'team_suggestion') {
    const s = msg.suggestion;
    if (!s || s.confidence < 0.75) return;
    showTeamSuggestionToast(s);
  }
}

function showTeamSuggestionToast(suggestion) {
  const toastId = 'team-suggest-toast';
  let el = document.getElementById(toastId);
  if (el) el.remove();
  el = document.createElement('div');
  el.id = toastId;
  el.style.cssText = 'position:fixed;bottom:80px;right:20px;background:var(--panel);border:1px solid var(--brand);border-radius:14px;box-shadow:var(--shadow-md);padding:14px 16px;z-index:9999;max-width:340px;animation:slideUp 0.3s ease';
  el.innerHTML = `
    <div style="font-size:13px;font-weight:800;margin-bottom:6px">🏠 Create a Team?</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">I noticed ${suggestion.candidateAgentNames.slice(0,3).join(', ')} look related. Would you like me to group them into <strong>${escHtml(suggestion.suggestedName)}</strong>?</div>
    <div style="display:flex;gap:8px">
      <button onclick="openCreateTeamModal(${JSON.stringify(suggestion).replace(/"/g,'&quot;')});document.getElementById('team-suggest-toast')?.remove()" style="background:var(--brand);color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer">Yes, create team</button>
      <button onclick="this.closest('#team-suggest-toast').remove()" style="background:var(--panel-2);border:1px solid var(--line);color:var(--muted);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer">Dismiss</button>
    </div>`;
  document.body.appendChild(el);
  setTimeout(() => { if (document.getElementById(toastId)) document.getElementById(toastId)?.remove(); }, 20000);
}

// --- timeAgo helper (if not already present) --------------------------------
if (typeof timeAgo === 'undefined') {
  window.timeAgo = function(ts) {
    if (!ts) return 'never';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
    return Math.floor(diff/86400000) + 'd ago';
  };
}




// ─── Expose on window for HTML onclick handlers ────────────────
window.refreshTeams = refreshTeams;
window.renderTeamsCanvas = renderTeamsCanvas;
window.drawHouseSVG = drawHouseSVG;
window.showHousePopover = showHousePopover;
window.hideHousePopover = hideHousePopover;
window.openTeamBoard = openTeamBoard;
window.closeTeamBoard = closeTeamBoard;
window.loadTeamBoardData = loadTeamBoardData;
window.renderTeamBoard = renderTeamBoard;
window.switchTeamTab = switchTeamTab;
window.renderTeamTabContent = renderTeamTabContent;
window.renderTeamContextTab = renderTeamContextTab;
window.renderTeamMemoryTab = renderTeamMemoryTab;
window.renderTeamRunsTab = renderTeamRunsTab;
window.renderTeamChatTab = renderTeamChatTab;
window.renderTeamCharacters = renderTeamCharacters;
window.sendTeamChat = sendTeamChat;
window.triggerManagerReview = triggerManagerReview;
window.runAllTeamAgents = runAllTeamAgents;
window.toggleTeamRunPause = toggleTeamRunPause;
window.saveTeamContextNotes = saveTeamContextNotes;
window.openTeamContextRefModal = openTeamContextRefModal;
window.closeTeamContextRefModal = closeTeamContextRefModal;
window.saveTeamContextReferenceModal = saveTeamContextReferenceModal;
window.deleteTeamContextReferenceCard = deleteTeamContextReferenceCard;
window.pauseTeam = pauseTeam;
window.resumeTeam = resumeTeam;
window.deleteTeam = deleteTeam;
window.toggleSubagentAccordion = toggleSubagentAccordion;
window.loadSubagentDrawer = loadSubagentDrawer;
window.renderSubagentDrawerContent = renderSubagentDrawerContent;
window.runSubagentNow = runSubagentNow;
window.applyTeamChangeFn = applyTeamChangeFn;
window.dispatchTeamTask = dispatchTeamTask;
window.rejectTeamChangeFn = rejectTeamChangeFn;
window.openCreateTeamModal = openCreateTeamModal;
window.closeCreateTeamModal = closeCreateTeamModal;
window.saveCreateTeam = saveCreateTeam;
window.handleTeamWsEvent = handleTeamWsEvent;
window.showTeamSuggestionToast = showTeamSuggestionToast;
window.startTeamRename = startTeamRename;
window.confirmTeamRename = confirmTeamRename;
window.renderWorkspaceTree = renderWorkspaceTree;
window.toggleWorkspaceFolder = toggleWorkspaceFolder;
window.renderTeamWorkspaceTab = renderTeamWorkspaceTab;
window.refreshTeamWorkspace = refreshTeamWorkspace;
window.getTeamContextReferences = getTeamContextReferences;
window.renderTeamContextReferenceCards = renderTeamContextReferenceCards;
window.getTeamChatSignature = getTeamChatSignature;
window.renderActiveTeamChat = renderActiveTeamChat;
window.loadTeamProgressTask = loadTeamProgressTask;
window.toggleTeamProgressRun = toggleTeamProgressRun;
window.hashStr = hashStr;
window.renderCharacterSVG = renderCharacterSVG;

// ─── WS Event Handlers (F5) ────────────────────────────────────
wsEventBus.on('team_*', (msg) => {
  handleTeamWsEvent(msg);
});

// ─── Page activation — called by setMode('teams') ────────────────────────
// Resets any lingering board/panel state left from a previous visit before
// re-fetching teams.  Without this, navigating away while a board was open
// leaves #teams-canvas hidden (display:none set by _showTeamPanels) and
// teams-canvas-wrap stuck at 38% width — making the canvas appear blank.
function teamsPageActivate() {
  // Reset board-open state silently (no animation needed, view is hidden)
  activeTeamId = null;
  clearInterval(teamChatPolling);
  teamChatPolling = null;

  // Remove side panels injected by _showTeamPanels()
  const sidePanels = document.getElementById('team-side-panels');
  if (sidePanels) sidePanels.remove();

  // Restore the canvas grid to full visibility
  const canvasInner = document.getElementById('teams-canvas');
  if (canvasInner) canvasInner.style.display = '';

  // Restore canvas-wrap to full width
  const canvasWrap = document.getElementById('teams-canvas-wrap');
  if (canvasWrap) {
    canvasWrap.style.transition = 'none';
    canvasWrap.style.width = '100%';
  }

  // Hide the board panel
  const board = document.getElementById('team-board');
  if (board) {
    board.style.display = 'none';
    board.style.opacity = '0';
    board.style.width = '0';
  }

  // Restore any dimmed house tiles
  document.querySelectorAll('.team-house-wrap').forEach(el => {
    el.style.opacity = '1';
    el.style.filter = '';
    el.style.transform = '';
    el.style.pointerEvents = '';
  });

  // Now load fresh data
  refreshTeams();
}

// ─── Register on window immediately ────────────────────────────────────
window.refreshTeams = refreshTeams;
window.renderTeamsCanvas = renderTeamsCanvas;
window.teamsPageActivate = teamsPageActivate;
