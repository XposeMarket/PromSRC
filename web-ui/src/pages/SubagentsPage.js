/**
 * SubagentsPage.js — Standalone subagent management
 *
 * Shows all standalone (non-team) subagents in a card grid.
 * Click an agent to open a detail panel with Overview, System Prompt, Runs, and Chat tabs.
 */

import { api } from '../api.js';
import { escHtml, bgtToast, timeAgo, showToast } from '../utils.js';
import { wsEventBus } from '../ws.js';

// ── State ─────────────────────────────────────────────────────────────────────
let subagentsData = [];          // All standalone agents (not team members)
let activeSubagentId = null;     // Currently open detail panel
let subagentDetailTab = 'overview'; // overview | systemprompt | runs | chat
let subagentRuns = [];
let subagentChatHistory = [];    // [{ role:'user'|'agent', content, ts }]
let subagentChatDraft = '';
let _subagentChatSending = false;
let _subagentDetailPolling = null;

// ── Avatar colors / icons ──────────────────────────────────────────────────
const AGENT_COLORS = ['#4c8dff','#31b884','#d6a64f','#e05c5c','#a78bfa','#38bdf8','#fb923c','#4ade80'];
const AGENT_EMOJIS = ['🤖','🦾','⚡','🧬','🛸','👾','🔬','🧠'];

function _hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function agentColor(id) { return AGENT_COLORS[_hashStr(id) % AGENT_COLORS.length]; }
function agentEmoji(agent) {
  if (agent.emoji) return agent.emoji;
  return AGENT_EMOJIS[_hashStr(agent.id || '') % AGENT_EMOJIS.length];
}

// ── Robot SVG Avatar ──────────────────────────────────────────────────────────
function drawAgentSVG(agent, isActive, scale = 1) {
  const color = agentColor(agent.id);
  const h = _hashStr(agent.id);
  const eyeStyle = h % 3; // 0=round, 1=square, 2=visor
  const antenna = !!(h % 2);
  const glowColor = isActive ? 'rgba(76,141,255,0.55)' : 'none';
  const W = 80, H = 90;

  const eyesHtml = eyeStyle === 1
    ? `<rect x="20" y="34" width="12" height="10" rx="1" fill="#fff" opacity="0.9"/>
       <rect x="48" y="34" width="12" height="10" rx="1" fill="#fff" opacity="0.9"/>
       <rect x="23" y="37" width="6" height="4" rx="1" fill="${color}" opacity="0.8"/>
       <rect x="51" y="37" width="6" height="4" rx="1" fill="${color}" opacity="0.8"/>`
    : eyeStyle === 2
    ? `<rect x="18" y="32" width="44" height="14" rx="4" fill="rgba(0,0,0,0.4)"/>
       <rect x="22" y="35" width="14" height="8" rx="2" fill="#7df" opacity="0.85"/>
       <rect x="44" y="35" width="14" height="8" rx="2" fill="#7df" opacity="0.85"/>`
    : `<circle cx="28" cy="38" r="7" fill="#fff" opacity="0.9"/>
       <circle cx="52" cy="38" r="7" fill="#fff" opacity="0.9"/>
       <circle cx="28" cy="38" r="4" fill="${color}" opacity="0.8"/>
       <circle cx="52" cy="38" r="4" fill="${color}" opacity="0.8"/>
       <circle cx="29" cy="37" r="1.5" fill="#fff"/>
       <circle cx="53" cy="37" r="1.5" fill="#fff"/>`;

  const mouthY = 52;
  const mouthHtml = h % 4 === 0
    ? `<path d="M26 ${mouthY} Q40 ${mouthY+8} 54 ${mouthY}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.7"/>`
    : h % 4 === 1
    ? `<rect x="26" y="${mouthY}" width="28" height="5" rx="2" fill="rgba(0,0,0,0.3)"/>
       <rect x="28" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>
       <rect x="34" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>
       <rect x="40" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>
       <rect x="46" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>`
    : `<line x1="26" y1="${mouthY+2}" x2="54" y2="${mouthY+2}" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.7"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" width="${W*scale}" height="${H*scale}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;filter:${glowColor !== 'none' ? `drop-shadow(0 0 9px ${glowColor})` : 'none'};transition:filter 0.2s">
    <!-- Shadow -->
    <ellipse cx="40" cy="${H-4}" rx="28" ry="4" fill="rgba(0,0,0,0.12)"/>
    <!-- Body -->
    <rect x="20" y="62" width="40" height="22" rx="6" fill="${color}" opacity="0.85"/>
    <!-- Arms -->
    <rect x="8" y="64" width="10" height="16" rx="4" fill="${color}" opacity="0.7"/>
    <rect x="62" y="64" width="10" height="16" rx="4" fill="${color}" opacity="0.7"/>
    <!-- Legs -->
    <rect x="24" y="80" width="11" height="8" rx="3" fill="${color}" opacity="0.7"/>
    <rect x="45" y="80" width="11" height="8" rx="3" fill="${color}" opacity="0.7"/>
    <!-- Head -->
    <rect x="14" y="20" width="52" height="42" rx="10" fill="${color}"/>
    <rect x="16" y="22" width="48" height="38" rx="9" fill="${color}" opacity="0.7"/>
    <!-- Eyes -->
    ${eyesHtml}
    <!-- Mouth -->
    ${mouthHtml}
    <!-- Chest light -->
    <circle cx="40" cy="71" r="4" fill="rgba(255,255,255,0.25)"/>
    <circle cx="40" cy="71" r="2.5" fill="${isActive ? '#fff' : 'rgba(255,255,255,0.5)'}"/>
    <!-- Antenna -->
    ${antenna ? `<line x1="40" y1="20" x2="40" y2="10" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="40" cy="8" r="3.5" fill="${color}"/>
    <circle cx="40" cy="8" r="2" fill="#fff" opacity="0.8"/>` : ''}
  </svg>`;
}

// ── Fetch & Render ────────────────────────────────────────────────────────────
async function refreshSubagents() {
  console.log('[SubagentsPage] refreshSubagents called');
  try {
    const data = await api('/api/agents');
    console.log('[SubagentsPage] agents loaded:', data.agents?.length);
    // Show all non-default, non-synthetic agents — including team members (with badge)
    subagentsData = (data.agents || []).filter(a => !a.default && !a.isSynthetic);
    window.subagentsData = subagentsData;
    renderSubagentsCanvas();
  } catch (err) {
    console.error('[SubagentsPage] refreshSubagents error:', err);
    const canvas = document.getElementById('subagents-canvas');
    if (canvas) canvas.innerHTML = `<div style="color:var(--muted);padding:24px;font-size:13px">Error loading agents: ${escHtml(err.message)}</div>`;
  }
}

function renderSubagentsCanvas() {
  const canvas = document.getElementById('subagents-canvas');
  if (!canvas) return;

  const countEl = document.getElementById('subagents-count');
  if (countEl) countEl.textContent = `${subagentsData.length} agent${subagentsData.length !== 1 ? 's' : ''}`;

  if (subagentsData.length === 0) {
    canvas.innerHTML = `
      <div style="text-align:center;color:var(--muted);padding:80px 24px">
        <div style="font-size:52px;margin-bottom:16px">🤖</div>
        <div style="font-size:18px;font-weight:800;margin-bottom:8px">No subagents configured</div>
        <div style="font-size:13px;line-height:1.6;max-width:380px;margin:0 auto">Create agents in <strong>Settings → Agents</strong> to add subagents here.</div>
      </div>`;
    return;
  }

  canvas.innerHTML = subagentsData.map(agent => {
    const isActive = agent.id === activeSubagentId;
    const lastRun = agent.lastRun?.finishedAt ? timeAgo(agent.lastRun.finishedAt) : null;
    const modelLabel = agent.effectiveModel ? agent.effectiveModel.split('/').pop() : null;
    const teamBadge = agent.isTeamMember ? `<div style="position:absolute;top:-4px;left:-4px;font-size:9px;background:#eaf2ff;color:#0d4faf;border:1px solid #bcd4f8;border-radius:999px;padding:1px 5px;font-weight:700;white-space:nowrap">team</div>` : '';
    const schedBadge = agent.cronSchedule ? `<div style="position:absolute;top:-4px;right:-6px;font-size:10px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:999px;padding:1px 5px;font-weight:700">⏰</div>` : '';
    return `
      <div class="subagent-card" data-agent-id="${agent.id}"
           onclick="openSubagentDetail('${escHtml(agent.id)}')"
           style="display:inline-flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;padding:16px 12px;border-radius:16px;transition:all 0.2s;position:relative;${isActive ? 'background:var(--panel-2);box-shadow:0 0 0 2px var(--brand);transform:scale(1.04)' : 'background:var(--panel);border:1px solid var(--line)'}">
        <div style="position:relative">
          ${drawAgentSVG(agent, isActive, 0.9)}
          ${teamBadge}
          ${schedBadge}
        </div>
        <div style="text-align:center;max-width:90px">
          <div style="font-size:11px;font-weight:800;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(agent.name || agent.id)}</div>
          ${modelLabel ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(modelLabel)}</div>` : ''}
          ${lastRun ? `<div style="font-size:9px;color:var(--muted);margin-top:1px">Last: ${lastRun}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ── Detail Panel ──────────────────────────────────────────────────────────────
async function openSubagentDetail(agentId) {
  activeSubagentId = agentId;
  subagentDetailTab = 'overview';
  subagentRuns = [];
  subagentChatHistory = [];

  const board = document.getElementById('subagent-board');
  const canvasWrap = document.getElementById('subagents-canvas-wrap');

  canvasWrap.style.transition = 'width 0.35s cubic-bezier(0.4,0,0.2,1)';
  canvasWrap.style.width = '38%';
  board.style.display = 'flex';
  board.style.width = '62%';
  board.style.opacity = '0';
  setTimeout(() => { board.style.opacity = '1'; }, 60);

  // Dim inactive cards
  document.querySelectorAll('.subagent-card').forEach(el => {
    const isActive = el.dataset.agentId === agentId;
    el.style.transition = 'opacity 0.3s, transform 0.35s';
    el.style.opacity = isActive ? '1' : '0.25';
    el.style.pointerEvents = isActive ? '' : 'none';
  });

  renderSubagentsCanvas();
  await loadSubagentBoardData(agentId);
  renderSubagentBoard(agentId);
  startSubagentPolling(agentId);
}

function closeSubagentDetail() {
  stopSubagentPolling();
  activeSubagentId = null;

  const board = document.getElementById('subagent-board');
  const canvasWrap = document.getElementById('subagents-canvas-wrap');

  board.style.opacity = '0';
  setTimeout(() => {
    board.style.display = 'none';
    board.style.width = '0';
  }, 300);

  canvasWrap.style.transition = 'width 0.35s cubic-bezier(0.4,0,0.2,1)';
  canvasWrap.style.width = '100%';

  document.querySelectorAll('.subagent-card').forEach(el => {
    el.style.opacity = '1';
    el.style.pointerEvents = '';
  });

  renderSubagentsCanvas();
}

async function loadSubagentBoardData(agentId) {
  try {
    const [histData] = await Promise.all([
      api(`/api/agents/history?agentId=${encodeURIComponent(agentId)}&limit=30`),
    ]);
    subagentRuns = histData.history || [];
  } catch (err) {
    console.error('[Subagents] loadData:', err);
  }
}

function renderSubagentBoard(agentId) {
  const agent = subagentsData.find(a => a.id === agentId);
  if (!agent) return;

  const header = document.getElementById('subagent-board-header');
  const body = document.getElementById('subagent-board-body');
  if (!header || !body) return;

  const color = agentColor(agentId);
  const emoji = agentEmoji(agent);

  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;min-width:0">
      <div style="width:36px;height:36px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${emoji}</div>
      <div style="min-width:0">
        <div style="font-size:14px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(agent.name || agent.id)}</div>
        ${agent.description ? `<div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(agent.description)}</div>` : ''}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
      <button onclick="openSubagentSettings('${escHtml(agentId)}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:7px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer">Settings</button>
      <button onclick="closeSubagentDetail()" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:7px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer">✕</button>
    </div>`;

  body.innerHTML = `
    <div style="display:flex;border-bottom:1px solid var(--line);flex-shrink:0">
      ${['overview','systemprompt','runs','chat'].map(tab => {
        const labels = { overview:'Overview', systemprompt:'System Prompt', runs:`Runs (${subagentRuns.length})`, chat:'Chat' };
        const isActive = tab === subagentDetailTab;
        return `<button onclick="switchSubagentTab('${tab}','${escHtml(agentId)}')" style="padding:10px 14px;font-size:12px;font-weight:${isActive?'700':'500'};border:none;background:none;cursor:pointer;color:${isActive?'var(--brand)':'var(--muted)'};border-bottom:2px solid ${isActive?'var(--brand)':'transparent'};margin-bottom:-1px;transition:all 0.15s">${labels[tab]}</button>`;
      }).join('')}
    </div>
    <div id="subagent-tab-content" style="flex:1;min-height:0;overflow-y:auto;padding:14px 16px">
      ${renderSubagentTabContent(agent)}
    </div>`;
}

function renderSubagentTabContent(agent) {
  switch (subagentDetailTab) {
    case 'overview': return renderSubagentOverviewTab(agent);
    case 'systemprompt': return renderSubagentSystemPromptTab(agent);
    case 'runs': return renderSubagentRunsTab(agent);
    case 'chat': return renderSubagentChatTab(agent);
    default: return '';
  }
}

async function switchSubagentTab(tab, agentId) {
  subagentDetailTab = tab;
  const agent = subagentsData.find(a => a.id === agentId);
  if (!agent) return;

  if (tab === 'systemprompt') {
    try {
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/system-prompt-md`);
      agent._systemPrompt = d.content || '';
    } catch {}
  }
  if (tab === 'runs' && subagentRuns.length === 0) {
    try {
      const d = await api(`/api/agents/history?agentId=${encodeURIComponent(agentId)}&limit=30`);
      subagentRuns = d.history || [];
    } catch {}
  }

  renderSubagentBoard(agentId);

  if (tab === 'chat') {
    requestAnimationFrame(() => {
      const msgs = document.getElementById('subagent-chat-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      const inp = document.getElementById('subagent-chat-input');
      if (inp) {
        inp.value = subagentChatDraft;
        inp.focus();
        inp.addEventListener('input', () => { subagentChatDraft = inp.value; });
      }
    });
  }
}

// ── Tab Renderers ─────────────────────────────────────────────────────────────
function renderSubagentOverviewTab(agent) {
  const color = agentColor(agent.id);
  const lastRunEntry = subagentRuns[0];
  const nextRun = agent.cronSchedule ? `<code style="background:var(--panel-2);padding:2px 6px;border-radius:4px;font-size:11px">${escHtml(agent.cronSchedule)}</code>` : '<span style="color:var(--muted)">Not scheduled</span>';

  const infoRows = [
    ['Agent ID', `<code style="font-size:11px;background:var(--panel-2);padding:2px 6px;border-radius:4px">${escHtml(agent.id)}</code>`],
    ['Model', agent.effectiveModel ? `<span style="font-size:12px">${escHtml(agent.effectiveModel)}<span style="font-size:10px;color:var(--muted);margin-left:5px">(${escHtml(agent.effectiveModelSource||'')})</span></span>` : '<span style="color:var(--muted)">Inherited</span>'],
    ['Schedule', nextRun],
    ['Workspace', `<span style="font-size:11px;font-family:'IBM Plex Mono',monospace;word-break:break-all;color:var(--muted)">${escHtml(agent.workspaceResolved||agent.workspace||'—')}</span>`],
    ['Last Run', lastRunEntry ? `<span style="font-size:12px">${timeAgo(lastRunEntry.finishedAt)} · ${lastRunEntry.success?'✅':'❌'} · ${lastRunEntry.stepCount||0} steps</span>` : '<span style="color:var(--muted)">Never</span>'],
    ['Total Runs', `<span style="font-size:12px">${subagentRuns.length}</span>`],
  ];

  return `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="flex-shrink:0">${drawAgentSVG(agent, true, 0.85)}</div>
        <div>
          <div style="font-size:16px;font-weight:800;margin-bottom:4px">${escHtml(agent.name||agent.id)}</div>
          ${agent.description ? `<div style="font-size:12px;color:var(--muted);line-height:1.5">${escHtml(agent.description)}</div>` : ''}
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            ${agent.cronSchedule ? `<span style="font-size:10px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:999px;padding:2px 8px;font-weight:700">⏰ Scheduled</span>` : ''}
            <span style="font-size:10px;background:#eaf2ff;color:#0d4faf;border-radius:999px;padding:2px 8px;border:1px solid #bcd4f8;font-weight:700">Standalone</span>
          </div>
        </div>
      </div>

      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:12px;overflow:hidden">
        ${infoRows.map(([label, value], i) => `
          <div style="display:flex;align-items:flex-start;gap:12px;padding:9px 14px;${i>0?'border-top:1px solid var(--line)':''}">
            <div style="font-size:11px;font-weight:700;color:var(--muted);min-width:90px;flex-shrink:0;padding-top:1px">${label}</div>
            <div style="font-size:12px;color:var(--text);flex:1">${value}</div>
          </div>`).join('')}
      </div>

      <div style="display:flex;gap:8px">
        <button onclick="spawnSubagentTask('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">▶ Run Task</button>
        <button onclick="switchSubagentTab('chat','${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--text);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer">💬 Open Chat</button>
        <button onclick="refreshSubagentDetail('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:8px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer">↻</button>
      </div>
    </div>`;
}

function renderSubagentSystemPromptTab(agent) {
  const content = agent._systemPrompt || '';
  return `
    <div style="display:flex;flex-direction:column;gap:10px;height:100%">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:800">System Prompt</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Defines this agent's persona, goals, and constraints</div>
        </div>
        <button onclick="saveSubagentSystemPrompt('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer">Save</button>
      </div>
      <textarea id="subagent-system-prompt-editor" style="flex:1;min-height:280px;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12px;font-family:'IBM Plex Mono',monospace;background:var(--panel-2);color:var(--text);line-height:1.6;outline:none" placeholder="Enter system prompt...">${escHtml(content)}</textarea>
    </div>`;
}

function renderSubagentRunsTab(agent) {
  if (subagentRuns.length === 0) {
    return `<div style="text-align:center;color:var(--muted);padding:48px 16px">
      <div style="font-size:36px;margin-bottom:10px">📭</div>
      <div style="font-size:13px;font-weight:700;margin-bottom:6px">No runs yet</div>
      <div style="font-size:12px">This agent hasn't been run yet. Use the Overview tab to start a task.</div>
    </div>`;
  }

  return `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:2px">Run History (${subagentRuns.length})</div>
      ${subagentRuns.map(r => `
        <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:11px 13px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
            <div style="display:flex;align-items:center;gap:7px">
              <span style="font-size:13px">${r.success ? '✅' : '❌'}</span>
              <span style="font-size:11px;font-weight:700;color:var(--text)">${new Date(r.startedAt).toLocaleString()}</span>
            </div>
            <div style="display:flex;gap:5px;align-items:center">
              <span style="font-size:10px;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:1px 6px">${escHtml(r.trigger||'manual')}</span>
              <span style="font-size:10px;color:var(--muted)">${Math.round((r.durationMs||0)/1000)}s · ${r.stepCount||0} steps</span>
            </div>
          </div>
          ${r.resultPreview ? `<div style="font-size:11px;color:var(--text);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;opacity:0.85">${escHtml(r.resultPreview.slice(0,300))}${r.resultPreview.length>300?'…':''}</div>` : ''}
          ${r.error ? `<div style="font-size:11px;color:#e05c5c;margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(r.error)}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function renderSubagentChatTab(agent) {
  const color = agentColor(agent.id);
  const emoji = agentEmoji(agent);
  return `
    <div style="display:flex;flex-direction:column;height:100%;gap:0">
      <div id="subagent-chat-messages" style="flex:1;display:flex;flex-direction:column;gap:10px;overflow-y:auto;padding-bottom:8px">
        ${subagentChatHistory.length === 0 ? `
          <div style="text-align:center;color:var(--muted);padding:32px 16px;font-size:13px">
            <div style="font-size:32px;margin-bottom:10px">${emoji}</div>
            <div style="font-weight:700;margin-bottom:6px">Chat with ${escHtml(agent.name||agent.id)}</div>
            <div style="font-size:12px;line-height:1.5">Send a message to interact directly with this agent. Each message spawns the agent with the full conversation as context.</div>
          </div>` : ''}
        ${subagentChatHistory.map(m => {
          const isUser = m.role === 'user';
          return `
            <div style="display:flex;flex-direction:column;gap:3px;align-items:${isUser?'flex-end':'flex-start'}">
              <div style="font-size:10px;color:var(--muted)">${isUser ? 'You' : escHtml(agent.name||agent.id)} · ${timeAgo(m.ts)}</div>
              <div style="max-width:85%;padding:9px 12px;border-radius:${isUser?'12px 12px 4px 12px':'12px 12px 12px 4px'};background:${isUser?'var(--brand)':'var(--panel-2)'};color:${isUser?'#fff':'var(--text)'};border:1px solid ${isUser?'transparent':'var(--line)'};font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere">${isUser?escHtml(m.content):(typeof marked!=='undefined'?marked.parse(m.content):escHtml(m.content))}</div>
              ${m.steps ? `<div style="font-size:10px;color:var(--muted)">${m.steps} steps · ${m.duration}s</div>` : ''}
            </div>`;
        }).join('')}
        ${_subagentChatSending ? `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 0">
            <div style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${emoji}</div>
            <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:12px;color:var(--muted)">
              <span style="animation:pulse 1.2s infinite">Thinking...</span>
            </div>
          </div>` : ''}
      </div>
      <div style="flex-shrink:0;border-top:1px solid var(--line);padding:10px 0 0;display:flex;gap:8px;align-items:flex-end">
        <textarea id="subagent-chat-input" rows="2" placeholder="Message ${escHtml(agent.name||agent.id)}... (Enter to send, Shift+Enter for newline)" style="flex:1;resize:none;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;font-family:inherit;background:var(--panel-2);color:var(--text);outline:none" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendSubagentChat('${escHtml(agent.id)}');}" ${_subagentChatSending?'disabled':''}></textarea>
        <button onclick="sendSubagentChat('${escHtml(agent.id)}')" ${_subagentChatSending?'disabled':''} style="background:var(--brand);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;height:36px;opacity:${_subagentChatSending?'0.5':'1'}">Send</button>
      </div>
    </div>`;
}

// ── Chat ──────────────────────────────────────────────────────────────────────
async function sendSubagentChat(agentId) {
  const inp = document.getElementById('subagent-chat-input');
  if (!inp || _subagentChatSending) return;
  const msg = inp.value.trim();
  if (!msg) return;

  inp.value = '';
  subagentChatDraft = '';
  _subagentChatSending = true;

  subagentChatHistory.push({ role: 'user', content: msg, ts: Date.now() });

  const agent = subagentsData.find(a => a.id === agentId);
  renderSubagentBoard(agentId);

  // Scroll to bottom
  requestAnimationFrame(() => {
    const msgs = document.getElementById('subagent-chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });

  // Build context from prior history (exclude last user message we just added)
  const priorHistory = subagentChatHistory.slice(0, -1);
  const contextLines = priorHistory.map(m =>
    `${m.role === 'user' ? 'User' : (agent?.name||agentId)}: ${m.content}`
  );

  const contextBlock = contextLines.length > 0
    ? `Prior conversation:\n${contextLines.join('\n\n')}\n\n---\n\n`
    : '';

  try {
    const startTs = Date.now();
    const result = await api(`/api/agents/${encodeURIComponent(agentId)}/spawn`, {
      method: 'POST',
      body: JSON.stringify({
        task: msg,
        context: contextBlock || undefined,
        timeoutMs: 120000,
      }),
    });
    const durationSec = Math.round((Date.now() - startTs) / 1000);
    const reply = result.result?.result || result.result?.text || result.error || 'No response';
    subagentChatHistory.push({
      role: 'agent',
      content: reply,
      ts: Date.now(),
      steps: result.result?.stepCount,
      duration: durationSec,
    });
    // Refresh run count
    try {
      const d = await api(`/api/agents/history?agentId=${encodeURIComponent(agentId)}&limit=30`);
      subagentRuns = d.history || [];
    } catch {}
  } catch (err) {
    subagentChatHistory.push({ role: 'agent', content: `Error: ${err.message}`, ts: Date.now() });
  } finally {
    _subagentChatSending = false;
  }

  renderSubagentBoard(agentId);
  requestAnimationFrame(() => {
    const msgs = document.getElementById('subagent-chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    const newInp = document.getElementById('subagent-chat-input');
    if (newInp) {
      newInp.focus();
      newInp.addEventListener('input', () => { subagentChatDraft = newInp.value; });
    }
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function saveSubagentSystemPrompt(agentId) {
  const editor = document.getElementById('subagent-system-prompt-editor');
  if (!editor) return;
  const content = editor.value;
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/system-prompt-md`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    const agent = subagentsData.find(a => a.id === agentId);
    if (agent) agent._systemPrompt = content;
    showToast('Saved', 'System prompt saved', 'success');
  } catch (err) {
    showToast('Error', 'Failed to save: ' + err.message, 'error');
  }
}

async function spawnSubagentTask(agentId) {
  const task = prompt('Enter task for agent:');
  if (!task) return;
  try {
    bgtToast('▶ Running...', `Spawning ${agentId}`);
    const result = await api(`/api/agents/${encodeURIComponent(agentId)}/spawn`, {
      method: 'POST',
      body: JSON.stringify({ task, timeoutMs: 120000 }),
    });
    if (result.success) {
      const preview = result.result?.result?.slice(0, 200) || '';
      bgtToast('✅ Done', preview || 'Task completed');
      const d = await api(`/api/agents/history?agentId=${encodeURIComponent(agentId)}&limit=30`);
      subagentRuns = d.history || [];
      renderSubagentBoard(agentId);
    } else {
      bgtToast('❌ Failed', result.error || 'Unknown error');
    }
  } catch (err) {
    bgtToast('❌ Error', err.message);
  }
}

async function refreshSubagentDetail(agentId) {
  await loadSubagentBoardData(agentId);
  renderSubagentBoard(agentId);
}

function openSubagentSettings(agentId) {
  // Open settings page at agents tab, pre-selecting the agent
  if (typeof window.openSettings === 'function') window.openSettings();
  setTimeout(() => {
    if (typeof window.setSettingsTab === 'function') window.setSettingsTab('agents');
    setTimeout(() => {
      const item = document.querySelector(`[data-agent-id-settings="${agentId}"]`);
      if (item) item.click();
    }, 200);
  }, 150);
}

// ── Polling ───────────────────────────────────────────────────────────────────
function startSubagentPolling(agentId) {
  stopSubagentPolling();
  _subagentDetailPolling = setInterval(async () => {
    if (!activeSubagentId) return stopSubagentPolling();
    try {
      const d = await api(`/api/agents/history?agentId=${encodeURIComponent(agentId)}&limit=30`);
      const fresh = d.history || [];
      if (fresh.length !== subagentRuns.length) {
        subagentRuns = fresh;
        if (subagentDetailTab === 'runs') renderSubagentBoard(agentId);
      }
    } catch {}
  }, 15000);
}

function stopSubagentPolling() {
  if (_subagentDetailPolling) { clearInterval(_subagentDetailPolling); _subagentDetailPolling = null; }
}

// ── Page lifecycle ────────────────────────────────────────────────────────────
function subagentsPageActivate() {
  stopSubagentPolling();
  activeSubagentId = null;

  // Reset canvas to full width (in case detail panel was open)
  const canvasWrap = document.getElementById('subagents-canvas-wrap');
  if (canvasWrap) {
    canvasWrap.style.transition = 'none';
    canvasWrap.style.width = '100%';
  }

  // Hide detail board
  const board = document.getElementById('subagent-board');
  if (board) {
    board.style.display = 'none';
    board.style.opacity = '0';
    board.style.width = '0';
  }

  // Restore any dimmed cards
  document.querySelectorAll('.subagent-card').forEach(el => {
    el.style.opacity = '1';
    el.style.pointerEvents = '';
  });

  refreshSubagents();
}

// ── Module init ───────────────────────────────────────────────────────────────
console.log('[SubagentsPage] module loaded');

// ── WS events ─────────────────────────────────────────────────────────────────
wsEventBus.on('agent_run_complete', (data) => {
  if (!activeSubagentId || data.agentId !== activeSubagentId) return;
  refreshSubagentDetail(activeSubagentId);
});

wsEventBus.on('agents_updated', () => { refreshSubagents(); });

// ── Exports ───────────────────────────────────────────────────────────────────
window.subagentsPageActivate = subagentsPageActivate;
window.refreshSubagents = refreshSubagents;
window.openSubagentDetail = openSubagentDetail;
window.closeSubagentDetail = closeSubagentDetail;
window.switchSubagentTab = switchSubagentTab;
window.sendSubagentChat = sendSubagentChat;
window.saveSubagentSystemPrompt = saveSubagentSystemPrompt;
window.spawnSubagentTask = spawnSubagentTask;
window.refreshSubagentDetail = refreshSubagentDetail;
window.openSubagentSettings = openSubagentSettings;
