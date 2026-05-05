/**
 * SubagentsPage.js — Standalone subagent management
 *
 * Shows all standalone (non-team) subagents in a card grid.
 * Click an agent to open a detail panel with Overview, System Prompt, Runs, and Chat tabs.
 */

import { api } from '../api.js';
import { escHtml, bgtToast, timeAgo, showToast } from '../utils.js';
import { wsEventBus } from '../ws.js';
import { renderAgentModelPicker as _renderAgentModelPicker, agentModelPickerHydrate, registerAgentModelPickerOnSaved } from '../components/agent-model-picker.js';

// ── State ─────────────────────────────────────────────────────────────────────
let subagentsData = [];          // All standalone agents (not team members)
let activeSubagentId = null;     // Currently open detail panel
let subagentDetailTab = 'overview'; // overview | systemprompt | memory | heartbeat | runs | chat
let subagentRuns = [];
let subagentChatHistory = [];    // [{ id, role:'user'|'agent'|'system', content, ts, metadata }]
let subagentChatDraft = '';
let _subagentChatSending = false;
let _subagentDetailPolling = null;
let subagentStreamingState = null; // { agentId, content, thinking, processEntries, progressLines, completed, finalReply, fallbackTimer }
let subagentStreamingStateByAgent = {}; // agentId -> live chat stream state
const MAX_SUBAGENT_CHAT_QUEUE = 8;
let subagentChatAbortControllers = {}; // agentId -> AbortController
let subagentChatQueueByAgent = {}; // agentId -> [{ content }]
let subagentChatQueueDrainTimers = {}; // agentId -> timer id

function getSubagentStreamingState(agentId) {
  if (!agentId) return null;
  return subagentStreamingStateByAgent[agentId] || null;
}

function isSubagentChatBusy(agentId) {
  return !!(getSubagentStreamingState(agentId)?.completed === false);
}

function getSubagentChatQueue(agentId, create = false) {
  if (!agentId) return [];
  if (!subagentChatQueueByAgent[agentId] && create) subagentChatQueueByAgent[agentId] = [];
  return subagentChatQueueByAgent[agentId] || [];
}

function queueSubagentChatMessage(agentId, content) {
  const text = String(content || '').trim();
  if (!text) return false;
  const queue = getSubagentChatQueue(agentId, true);
  if (queue.length >= MAX_SUBAGENT_CHAT_QUEUE) {
    showToast('Queue full', `Wait for ${getActiveSubagentName(agentId)} to catch up before adding more.`, 'warning');
    return false;
  }
  queue.push({ content: text });
  showToast('Queued', `${getActiveSubagentName(agentId)} will receive this next.`, 'info');
  return true;
}

function scheduleNextSubagentQueuedMessage(agentId) {
  if (!agentId || isSubagentChatBusy(agentId) || subagentChatQueueDrainTimers[agentId]) return;
  const queue = getSubagentChatQueue(agentId);
  if (queue.length === 0) return;
  subagentChatQueueDrainTimers[agentId] = setTimeout(() => {
    delete subagentChatQueueDrainTimers[agentId];
    if (isSubagentChatBusy(agentId)) return;
    const next = getSubagentChatQueue(agentId).shift();
    if (!next?.content) return;
    sendSubagentChat(agentId, next.content);
  }, 120);
  if (activeSubagentId === agentId && subagentDetailTab === 'chat') renderSubagentBoard(agentId);
}

function syncActiveSubagentStreamingState() {
  subagentStreamingState = activeSubagentId ? getSubagentStreamingState(activeSubagentId) : null;
  _subagentChatSending = !!(subagentStreamingState && subagentStreamingState.completed !== true);
  return subagentStreamingState;
}

function setSubagentStreamingState(agentId, state) {
  if (!agentId) return null;
  if (state) {
    subagentStreamingStateByAgent[agentId] = state;
  } else {
    delete subagentStreamingStateByAgent[agentId];
  }
  if (activeSubagentId === agentId) syncActiveSubagentStreamingState();
  return state;
}

// ── Per-agent detail state (reset on agent switch) ─────────────────────────
let subagentSystemPrompt = '';
let subagentContextRefs = [];
let subagentMemoryNotes = '';
let subagentHbConfig = { enabled: false, intervalMinutes: 30 };
let subagentHbMd = '';
let _subagentCtxRefEditId = null;   // ref id currently in edit modal

// ── Avatar colors / icons ──────────────────────────────────────────────────
const AGENT_COLORS = ['#4c8dff','#31b884','#d6a64f','#e05c5c','#a78bfa','#38bdf8','#fb923c','#4ade80'];
const AGENT_EMOJIS = ['🤖','🦾','⚡','🧬','🛸','👾','🔬','🧠'];

function _hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function agentColor(id) { return AGENT_COLORS[_hashStr(id) % AGENT_COLORS.length]; }
function getActiveSubagentName(agentId) {
  const agent = subagentsData.find(a => a.id === agentId);
  return agent?.name || agentId || 'Agent';
}
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
    const data = await api('/api/agents', { timeoutMs: 8000 });
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
  subagentDetailTab = getSubagentStreamingState(agentId) ? 'chat' : 'overview';
  subagentRuns = [];
  subagentChatHistory = [];
  syncActiveSubagentStreamingState();
  subagentSystemPrompt = '';
  subagentContextRefs = [];
  subagentMemoryNotes = '';
  subagentHbConfig = { enabled: false, intervalMinutes: 30 };
  subagentHbMd = '';

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
  if (subagentDetailTab === 'chat') restoreSubagentChatScroll({ hadChat: false }, { forceBottom: true });
  startSubagentPolling(agentId);
}

function closeSubagentDetail() {
  stopSubagentPolling();
  activeSubagentId = null;
  syncActiveSubagentStreamingState();

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
    const [histData, chatData, ctxData] = await Promise.all([
      api(`/api/agents/history?agentId=${encodeURIComponent(agentId)}&limit=30`),
      api(`/api/agents/${encodeURIComponent(agentId)}/chat?limit=100`),
      api(`/api/agents/${encodeURIComponent(agentId)}/context-refs`).catch(() => ({ refs: [] })),
    ]);
    subagentRuns = histData.history || [];
    subagentChatHistory = preserveSubagentProcessMetadata(normalizeSubagentChatMessages(chatData.messages || []));
    subagentContextRefs = ctxData.refs || [];
  } catch (err) {
    console.error('[Subagents] loadData:', err);
  }
}

function normalizeSubagentChatMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((m, idx) => ({
    id: m.id || `chat_${m.ts || Date.now()}_${idx}`,
    agentId: m.agentId || m.metadata?.agentId || activeSubagentId || undefined,
    role: m.role === 'user' || m.role === 'system' ? m.role : 'agent',
    content: String(m.content || ''),
    ts: Number(m.ts || Date.now()),
    steps: Number(m.steps || m.metadata?.stepCount || 0) || undefined,
    duration: Number(m.duration || (m.metadata?.durationMs ? Math.round(Number(m.metadata.durationMs) / 1000) : 0)) || undefined,
    metadata: m.metadata || {},
  }));
}

function newSubagentProcessEntry(type, content, extra = undefined) {
  return {
    ts: new Date().toLocaleTimeString(),
    type: String(type || 'info'),
    content: String(content || ''),
    ...(extra && typeof extra === 'object' ? extra : {}),
  };
}

function pushSubagentProgressLine(line, state = subagentStreamingState) {
  if (!state) return;
  const text = String(line || '').trim();
  if (!text) return;
  const lines = Array.isArray(state.progressLines) ? state.progressLines : [];
  if (lines[lines.length - 1] === text) return;
  lines.push(text);
  if (lines.length > 8) lines.splice(0, lines.length - 8);
  state.progressLines = lines;
}

function addSubagentProcessEntry(type, content, extra = undefined, state = subagentStreamingState) {
  if (!state) return;
  if (!Array.isArray(state.processEntries)) state.processEntries = [];
  state.processEntries.push(newSubagentProcessEntry(type, content, extra));
}

function formatSubagentProcessLines(entries) {
  if (!entries || entries.length === 0) return '<div style="color:var(--muted)">No process details.</div>';
  const TYPE_COLORS = {
    user: 'var(--text)',
    think: '#388bfd',
    tool: '#e3b341',
    result: '#bc8cff',
    error: '#e05c5c',
    final: '#56d364',
    warn: '#d6a64f',
    info: '#79c0ff',
  };
  return entries.map((entry) => {
    const type = String(entry?.type || 'info');
    const color = TYPE_COLORS[type] || 'var(--muted)';
    const ts = escHtml(String(entry?.ts || ''));
    const content = escHtml(String(entry?.content || ''));
    return `<div style="margin-bottom:4px"><span style="color:var(--muted)">[${ts}]</span> <span style="color:${color};font-weight:700">${escHtml(type.toUpperCase())}</span> ${content}</div>`;
  }).join('');
}

function renderSubagentProcessPill(entries, prefix = 'sa_proc') {
  if (!entries || entries.length === 0) return '';
  const id = `${prefix}_${Math.random().toString(36).slice(2)}`;
  return `
    <div style="margin-top:8px">
      <button class="process-pill-btn" onclick="toggleSubagentProcess('${id}')">Process</button>
      <div id="${id}" style="display:none;margin-top:8px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);padding:8px;max-height:220px;overflow:auto;font-size:11px;line-height:1.6">
        ${formatSubagentProcessLines(entries)}
      </div>
    </div>
  `;
}

function mergeStreamingStateIntoMessage(message) {
  if (!message) return message;
  const messageAgentId = message.agentId || message.metadata?.agentId || activeSubagentId || null;
  const streamState = getSubagentStreamingState(messageAgentId) || subagentStreamingState;
  if (!streamState || message.role !== 'agent' || messageAgentId !== streamState.agentId) return message;
  const metadata = {
    ...(message.metadata || {}),
    processEntries: Array.isArray(streamState.processEntries) ? [...streamState.processEntries] : [],
    thinking: String(streamState.thinking || '').trim(),
  };
  return { ...message, agentId: messageAgentId, metadata };
}

function hasSubagentProcessMetadata(message) {
  const metadata = message?.metadata || {};
  return (Array.isArray(metadata.processEntries) && metadata.processEntries.length > 0)
    || String(metadata.thinking || '').trim();
}

function sameSubagentChatTurn(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  const aContent = String(a.content || '').trim();
  const bContent = String(b.content || '').trim();
  if (!aContent || aContent !== bContent) return false;
  if (a.role !== b.role) return false;
  const delta = Math.abs(Number(a.ts || 0) - Number(b.ts || 0));
  return !Number.isFinite(delta) || delta < 5 * 60 * 1000;
}

function preserveSubagentProcessMetadata(freshMessages, localMessages = subagentChatHistory) {
  const localWithProcess = (Array.isArray(localMessages) ? localMessages : []).filter(hasSubagentProcessMetadata);
  if (localWithProcess.length === 0) return freshMessages;
  return (Array.isArray(freshMessages) ? freshMessages : []).map((fresh) => {
    if (hasSubagentProcessMetadata(fresh)) return fresh;
    const local = localWithProcess.find((m) => sameSubagentChatTurn(m, fresh));
    if (!local) return fresh;
    return {
      ...fresh,
      metadata: {
        ...(fresh.metadata || {}),
        processEntries: Array.isArray(local.metadata?.processEntries) ? [...local.metadata.processEntries] : [],
        thinking: String(local.metadata?.thinking || '').trim(),
      },
    };
  });
}

function commitSubagentStreamingReply(agentId, streamState, content, startTs, extraMetadata = {}) {
  if (!streamState || getSubagentStreamingState(agentId) !== streamState) return false;
  const finalContent = String(content || streamState.finalReply || streamState.content || '').trim();
  if (!finalContent) return false;
  const [message] = normalizeSubagentChatMessages([{
    id: `stream_${Date.now()}`,
    agentId,
    role: 'agent',
    content: finalContent,
    ts: Date.now(),
    metadata: {
      source: 'subagent_chat',
      durationMs: Date.now() - startTs,
      localStreamingFallback: true,
      ...extraMetadata,
    },
  }]);
  if (!message) return false;
  subagentChatHistory = subagentChatHistory.filter(m => !(
    ((m.metadata?.pending || m.metadata?.localStreamingFallback) && m.role === message.role && m.content === message.content)
  ));
  if (!subagentChatHistory.some((m) => m.id === message.id)) {
    const durationSec = Math.round((Date.now() - startTs) / 1000);
    subagentChatHistory.push(mergeStreamingStateIntoMessage({ ...message, duration: durationSec }));
  }
  setSubagentStreamingState(agentId, null);
  if (activeSubagentId === agentId && subagentDetailTab === 'chat') renderSubagentBoard(agentId);
  return true;
}

async function reconcileSubagentChatFromServer(agentId, streamState, sinceTs = 0) {
  try {
    const chat = await api(`/api/agents/${encodeURIComponent(agentId)}/chat?limit=100`);
    const freshChat = normalizeSubagentChatMessages(chat.messages || []);
    const hasNewAgentReply = freshChat.some((m) =>
      m.role === 'agent'
      && Number(m.ts || 0) >= Number(sinceTs || 0)
      && String(m.content || '').trim()
      && !/^\(No response received\.\)$/i.test(String(m.content || '').trim())
    );
    if (!hasNewAgentReply) return false;
    subagentChatHistory = preserveSubagentProcessMetadata(freshChat);
    if (streamState && getSubagentStreamingState(agentId) === streamState) {
      setSubagentStreamingState(agentId, null);
    }
    if (activeSubagentId === agentId && subagentDetailTab === 'chat') renderSubagentBoard(agentId);
    return true;
  } catch {
    return false;
  }
}

function renderSubagentStreamingBubble(agent) {
  const streamState = getSubagentStreamingState(agent.id) || (subagentStreamingState?.agentId === agent.id ? subagentStreamingState : null);
  if (!streamState) return '';
  const color = agentColor(agent.id);
  const emoji = agentEmoji(agent);
  const progressHtml = Array.isArray(streamState.progressLines) && streamState.progressLines.length
    ? `<div id="subagent-streaming-progress-lines" style="margin:6px 0 8px 0;font-size:11px;line-height:1.6;color:var(--muted)">
        ${streamState.progressLines.map((line) => `<div>&bull; ${escHtml(line)}</div>`).join('')}
      </div>`
    : '';
  const content = String(streamState.content || streamState.finalReply || '').trim();
  return `
    <div class="msg ai">
      <div class="msg-avatar" style="background:${color};border-color:${color};font-size:15px">${emoji}</div>
      <div class="msg-body">
        <div class="msg-role">${escHtml(agent.name || agent.id)}</div>
        ${progressHtml}
        ${content
          ? `<div id="subagent-streaming-text-content" class="msg-content" style="white-space:pre-wrap;word-break:break-word">${escHtml(content)}</div>`
          : `<div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>`}
        <div id="subagent-streaming-process-wrapper">${renderSubagentProcessPill(streamState.processEntries || [], 'sa_stream_proc')}</div>
      </div>
    </div>
  `;
}

function refreshSubagentStreamingUI(agentId, force = false) {
  if (!activeSubagentId || activeSubagentId !== agentId || subagentDetailTab !== 'chat') return;
  const streamState = syncActiveSubagentStreamingState();
  if (!streamState || streamState.agentId !== agentId) return;
  if (force) {
    renderSubagentBoard(agentId);
  } else {
    const streamEl = document.getElementById('subagent-streaming-text-content');
    if (streamEl) {
      streamEl.textContent = String(streamState.content || streamState.finalReply || '');
    } else {
      renderSubagentBoard(agentId);
    }
    const progressEl = document.getElementById('subagent-streaming-progress-lines');
    if (progressEl) {
      const lines = Array.isArray(streamState.progressLines) ? streamState.progressLines : [];
      progressEl.innerHTML = lines.map((line) => `<div>&bull; ${escHtml(line)}</div>`).join('');
    }
    const processEl = document.getElementById('subagent-streaming-process-wrapper');
    if (processEl) {
      processEl.innerHTML = renderSubagentProcessPill(streamState.processEntries || [], 'sa_stream_proc');
    }
  }
  requestAnimationFrame(() => {
    const msgs = document.getElementById('subagent-chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });
}

function getSubagentChatScrollSnapshot() {
  const msgs = document.getElementById('subagent-chat-messages');
  if (!msgs) return { hadChat: false, distanceFromBottom: 0, nearBottom: true };
  const distanceFromBottom = Math.max(0, msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight);
  return {
    hadChat: true,
    distanceFromBottom,
    nearBottom: distanceFromBottom < 96,
  };
}

function restoreSubagentChatScroll(snapshot, opts = {}) {
  if (subagentDetailTab !== 'chat') return;
  requestAnimationFrame(() => {
    const msgs = document.getElementById('subagent-chat-messages');
    if (!msgs) return;
    const shouldBottom = opts.forceBottom === true || !snapshot?.hadChat || snapshot?.nearBottom !== false;
    if (shouldBottom) {
      msgs.scrollTop = msgs.scrollHeight;
    } else {
      msgs.scrollTop = Math.max(0, msgs.scrollHeight - msgs.clientHeight - Number(snapshot.distanceFromBottom || 0));
    }
  });
}

function renderSubagentBoard(agentId) {
  const agent = subagentsData.find(a => a.id === agentId);
  if (!agent) return;

  const header = document.getElementById('subagent-board-header');
  const body = document.getElementById('subagent-board-body');
  if (!header || !body) return;

  const color = agentColor(agentId);
  const emoji = agentEmoji(agent);
  const chatScrollSnapshot = getSubagentChatScrollSnapshot();

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
    <div style="display:flex;border-bottom:1px solid var(--line);flex-shrink:0;overflow-x:auto;scrollbar-width:none">
      ${['overview','systemprompt','memory','heartbeat','runs','chat'].map(tab => {
        const labels = { overview:'Overview', systemprompt:'System Prompt', memory:'Memory', heartbeat:'Heartbeat', runs:`Runs (${subagentRuns.length})`, chat:'Chat' };
        const isActive = tab === subagentDetailTab;
        return `<button onclick="switchSubagentTab('${tab}','${escHtml(agentId)}')" style="padding:10px 14px;font-size:12px;font-weight:${isActive?'700':'500'};border:none;background:none;cursor:pointer;white-space:nowrap;color:${isActive?'var(--brand)':'var(--muted)'};border-bottom:2px solid ${isActive?'var(--brand)':'transparent'};margin-bottom:-1px;transition:all 0.15s">${labels[tab]}</button>`;
      }).join('')}
    </div>
    <div id="subagent-tab-content" style="flex:1;min-height:0;overflow-y:${subagentDetailTab === 'chat' ? 'hidden' : 'auto'};padding:14px 16px">
      ${renderSubagentTabContent(agent)}
    </div>`;

  if (subagentDetailTab === 'overview') {
    agentModelPickerHydrate('sa-model', agent);
  }
  restoreSubagentChatScroll(chatScrollSnapshot);
}

function renderSubagentTabContent(agent) {
  switch (subagentDetailTab) {
    case 'overview':    return renderSubagentOverviewTab(agent);
    case 'systemprompt': return renderSubagentSystemPromptTab(agent);
    case 'memory':      return renderSubagentMemoryTab(agent);
    case 'heartbeat':   return renderSubagentHeartbeatTab(agent);
    case 'runs':        return renderSubagentRunsTab(agent);
    case 'chat':        return renderSubagentChatTab(agent);
    default: return '';
  }
}

async function switchSubagentTab(tab, agentId) {
  subagentDetailTab = tab;
  if (!subagentsData.find(a => a.id === agentId)) return;

  if (tab === 'systemprompt' && !subagentSystemPrompt) {
    try {
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/system-prompt-md`);
      subagentSystemPrompt = d.content || '';
    } catch {}
  }
  if (tab === 'memory') {
    try {
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/workspace/notes`);
      subagentMemoryNotes = d.notes || '';
    } catch {}
  }
  if (tab === 'heartbeat' && !subagentHbMd) {
    try {
      const [cfgD, mdD] = await Promise.all([
        api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`).catch(() => ({})),
        api(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`).catch(() => ({})),
      ]);
      const cfg = cfgD?.config || {};
      subagentHbConfig = { enabled: cfg.enabled === true, intervalMinutes: cfg.intervalMinutes || 30 };
      subagentHbMd = mdD?.content || '';
    } catch {}
  }
  if (tab === 'runs' && subagentRuns.length === 0) {
    try {
      const d = await api(`/api/agents/history?agentId=${encodeURIComponent(agentId)}&limit=30`);
      subagentRuns = d.history || [];
    } catch {}
  }
  if (tab === 'chat') {
    try {
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/chat?limit=100`);
      subagentChatHistory = preserveSubagentProcessMetadata(normalizeSubagentChatMessages(d.messages || []));
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

// ── Inline model picker (shared component) ──────────────────────────────────
async function _refreshSubagentEntry(agentId) {
  try {
    const data = await api('/api/agents');
    const agents = data?.agents || [];
    const updated = agents.find(a => a.id === agentId);
    if (updated) {
      const idx = subagentsData.findIndex(a => a.id === agentId);
      if (idx >= 0) subagentsData[idx] = updated; else subagentsData.push(updated);
    }
  } catch {}
}

registerAgentModelPickerOnSaved('sa-model', async (agentId) => {
  await _refreshSubagentEntry(agentId);
  if (subagentDetailTab === 'overview' && activeSubagentId === agentId) {
    renderSubagentBoard(agentId);
  }
});

// ── Tab Renderers ─────────────────────────────────────────────────────────────
function renderSubagentOverviewTab(agent) {
  const color = agentColor(agent.id);
  const lastRunEntry = subagentRuns[0];
  const nextRun = agent.cronSchedule ? `<code style="background:var(--panel-2);padding:2px 6px;border-radius:4px;font-size:11px">${escHtml(agent.cronSchedule)}</code>` : '<span style="color:var(--muted)">Not scheduled</span>';

  const infoRows = [
    ['Agent ID', `<code style="font-size:11px;background:var(--panel-2);padding:2px 6px;border-radius:4px">${escHtml(agent.id)}</code>`],
    ['Model', agent.effectiveModel ? `<span style="font-size:12px">${escHtml(agent.effectiveModel)}<span style="font-size:10px;color:var(--muted);margin-left:5px">(${escHtml(agent.effectiveModelSource||'')})</span></span>` : '<span style="color:var(--muted)">Inherited</span>'],
    ['Schedule', nextRun],
    ['Last Run', lastRunEntry ? `<span style="font-size:12px">${timeAgo(lastRunEntry.finishedAt)} · ${lastRunEntry.success?'✅':'❌'} · ${lastRunEntry.stepCount||0} steps</span>` : '<span style="color:var(--muted)">Never</span>'],
  ];

  // Context reference cards
  const refsHtml = subagentContextRefs.length === 0
    ? `<div style="border:1px dashed var(--line);border-radius:8px;padding:12px;font-size:11px;color:var(--muted);background:var(--panel-2)">No context references yet. Add one above — it will be injected when this agent is spawned.</div>`
    : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
        ${subagentContextRefs.map(ref => {
          const preview = String(ref.content||'').replace(/\s+/g,' ').slice(0,120);
          const fileIcon = ref.isFile ? '📎 ' : '';
          return `<button onclick="openSubagentCtxRefModal('${escHtml(agent.id)}','${escHtml(ref.id)}')" style="text-align:left;border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:9px;cursor:pointer;display:flex;flex-direction:column;gap:5px;min-height:100px">
            <div style="font-size:11px;font-weight:700;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${fileIcon}${escHtml(ref.title||'Untitled')}</div>
            <div style="font-size:10px;color:var(--muted);overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical">${escHtml(preview||'(empty)')}</div>
            <div style="margin-top:auto;font-size:9px;color:var(--muted)">${timeAgo(ref.updatedAt||ref.createdAt||Date.now())}</div>
          </button>`;
        }).join('')}
      </div>`;

  return `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="flex-shrink:0">${drawAgentSVG(agent, true, 0.8)}</div>
        <div>
          <div style="font-size:15px;font-weight:800;margin-bottom:3px">${escHtml(agent.name||agent.id)}</div>
          ${agent.description ? `<div style="font-size:12px;color:var(--muted);line-height:1.5">${escHtml(agent.description)}</div>` : ''}
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            ${agent.cronSchedule ? `<span style="font-size:10px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:999px;padding:2px 8px;font-weight:700">⏰ Scheduled</span>` : ''}
            <span style="font-size:10px;background:#eaf2ff;color:#0d4faf;border-radius:999px;padding:2px 8px;border:1px solid #bcd4f8;font-weight:700">Standalone</span>
          </div>
        </div>
      </div>

      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:12px;overflow:hidden">
        ${infoRows.map(([label, value], i) => `
          <div style="display:flex;align-items:flex-start;gap:12px;padding:8px 14px;${i>0?'border-top:1px solid var(--line)':''}">
            <div style="font-size:11px;font-weight:700;color:var(--muted);min-width:80px;flex-shrink:0;padding-top:1px">${label}</div>
            <div style="font-size:12px;color:var(--text);flex:1">${value}</div>
          </div>`).join('')}
      </div>

      ${_renderAgentModelPicker(agent, 'sa-model')}

      <div style="display:flex;gap:8px">
        <button onclick="spawnSubagentTask('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">▶ Run Task</button>
        <button onclick="switchSubagentTab('chat','${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--text);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer">💬 Chat</button>
        <button onclick="refreshSubagentDetail('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:8px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer">↻</button>
      </div>

      <!-- Context References -->
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)">Context &amp; Reference</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">Cards are injected as context when this agent is spawned.</div>
          </div>
          <label style="flex-shrink:0;cursor:pointer;border:1px solid var(--line);background:var(--panel-2);border-radius:7px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--muted)">
            📎 Upload File
            <input type="file" style="display:none" onchange="uploadSubagentContextFile('${escHtml(agent.id)}',this)" />
          </label>
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:6px;margin-bottom:8px">
          <input id="sa-ctx-title-${escHtml(agent.id)}" type="text" placeholder="Reference title…" style="border:1px solid var(--line);border-radius:7px;padding:7px 10px;font-size:12px;background:var(--panel);color:var(--text)" />
          <textarea id="sa-ctx-content-${escHtml(agent.id)}" rows="2" placeholder="Reference content…" style="border:1px solid var(--line);border-radius:7px;padding:7px 10px;font-size:12px;font-family:inherit;background:var(--panel);color:var(--text);resize:vertical"></textarea>
          <button onclick="saveSubagentCtxRef('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:transparent;color:var(--brand);border-radius:7px;padding:6px 14px;font-size:11px;font-weight:700;cursor:pointer;align-self:flex-end">Save Reference</button>
        </div>
        ${refsHtml}

        <!-- Edit modal -->
        <div id="sa-ctx-modal-${escHtml(agent.id)}" style="display:none;position:fixed;inset:0;background:rgba(10,20,40,0.42);z-index:9999;align-items:center;justify-content:center;padding:16px">
          <div style="width:min(580px,96vw);max-height:88vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-md);padding:14px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="font-size:13px;font-weight:800">Edit Context Reference</div>
              <button onclick="closeSubagentCtxRefModal('${escHtml(agent.id)}')" style="border:0;background:none;font-size:18px;cursor:pointer;color:var(--muted)">&#x2715;</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <input id="sa-ctx-modal-title-${escHtml(agent.id)}" type="text" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;background:var(--panel-2);color:var(--text)" />
              <textarea id="sa-ctx-modal-content-${escHtml(agent.id)}" rows="10" style="border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:12px;font-family:inherit;background:var(--panel-2);color:var(--text);resize:vertical;line-height:1.5"></textarea>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <button onclick="deleteSubagentCtxRef('${escHtml(agent.id)}')" style="border:1px solid #f2c5c5;background:#fff5f5;color:#b42323;border-radius:7px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer">Delete</button>
                <div style="display:flex;gap:6px">
                  <button onclick="closeSubagentCtxRefModal('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:7px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer">Close</button>
                  <button onclick="updateSubagentCtxRef('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:7px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer">Save Changes</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderSubagentSystemPromptTab(agent) {
  return `
    <div style="display:flex;flex-direction:column;gap:10px;height:100%">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:800">System Prompt</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Defines this agent's persona, goals, and constraints</div>
        </div>
        <button onclick="saveSubagentSystemPrompt('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer">Save</button>
      </div>
      <textarea id="subagent-system-prompt-editor" style="flex:1;min-height:300px;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12px;font-family:'IBM Plex Mono',monospace;background:var(--panel-2);color:var(--text);line-height:1.6;outline:none" placeholder="Enter system prompt for this agent…">${escHtml(subagentSystemPrompt)}</textarea>
    </div>`;
}

function renderSubagentMemoryTab(agent) {
  return `
    <div style="display:flex;flex-direction:column;gap:10px;height:100%">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:800">Memory</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Latest notes from this agent's memory directory</div>
        </div>
        <button onclick="reloadSubagentMemory('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer">↻ Reload</button>
      </div>
      ${subagentMemoryNotes
        ? `<div style="flex:1;min-height:300px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12px;font-family:'IBM Plex Mono',monospace;background:var(--panel-2);color:var(--text);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(subagentMemoryNotes)}</div>`
        : `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;padding:48px;text-align:center">
            <div>
              <div style="font-size:32px;margin-bottom:10px">🧠</div>
              <div style="font-weight:700;margin-bottom:6px">No memory yet</div>
              <div style="font-size:12px">Memory notes are written by this agent during runs and appear here.</div>
            </div>
          </div>`
      }
    </div>`;
}

function renderSubagentHeartbeatTab(agent) {
  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:800">💓 Heartbeat</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Scheduled recurring task for this agent</div>
        </div>
        <button onclick="tickSubagentHbFromDetail('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:8px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer">▶ Run Now</button>
      </div>

      <div style="display:flex;align-items:center;gap:14px;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px">
        <label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="sa-hb-enabled-${escHtml(agent.id)}" ${subagentHbConfig.enabled ? 'checked' : ''} style="width:15px;height:15px" />
          Enabled
        </label>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:12px;color:var(--muted)">Every</span>
          <input type="number" id="sa-hb-interval-${escHtml(agent.id)}" min="1" max="1440" value="${subagentHbConfig.intervalMinutes||30}" style="width:56px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-size:12px;text-align:center" />
          <span style="font-size:12px;color:var(--muted)">min</span>
        </div>
        <button onclick="saveSubagentHbConfig('${escHtml(agent.id)}')" style="margin-left:auto;border:1px solid var(--brand);background:transparent;color:var(--brand);border-radius:7px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer">Save Config</button>
      </div>

      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px">HEARTBEAT.md — what this agent does when woken</div>
        <textarea id="sa-hb-md-${escHtml(agent.id)}" style="width:100%;min-height:260px;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12px;font-family:'IBM Plex Mono',monospace;background:var(--panel-2);color:var(--text);line-height:1.6;outline:none;box-sizing:border-box" placeholder="Describe what this agent should do on each heartbeat run…">${escHtml(subagentHbMd)}</textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button onclick="saveSubagentHbMd('${escHtml(agent.id)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">Save HEARTBEAT.md</button>
          <button onclick="reloadSubagentHb('${escHtml(agent.id)}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:8px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer">↻ Reload</button>
        </div>
        <div id="sa-hb-status-${escHtml(agent.id)}" style="margin-top:5px;font-size:11px;color:var(--muted)"></div>
      </div>
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
  const liveStream = getSubagentStreamingState(agent.id);
  const isSending = !!(liveStream && liveStream.completed !== true);
  const queuedCount = getSubagentChatQueue(agent.id).length;
  const emoji = agentEmoji(agent);
  const renderedMessages = subagentChatHistory.map(m => {
    const isUser = m.role === 'user';
    const rawSource = String(m.metadata?.source || '');
    const isDirectUserMessage = isUser && (!rawSource || rawSource === 'subagent_chat');
    const label = isDirectUserMessage
      ? 'You'
      : isUser && rawSource === 'schedule'
        ? 'Scheduled task'
        : isUser && (rawSource.includes('team') || rawSource === 'talk_to_subagent')
          ? 'Manager'
          : isUser
            ? 'Prometheus'
            : (m.role === 'system' ? 'System' : escHtml(agent.name||agent.id));
    const source = rawSource === 'schedule' ? 'scheduled' : rawSource && rawSource !== 'subagent_chat' ? rawSource.replace(/_/g, ' ') : '';
    const stepCount = m.steps || m.metadata?.stepCount;
    const durationSec = m.duration || (m.metadata?.durationMs ? Math.round(m.metadata.durationMs / 1000) : 0);
    const processHtml = !isUser ? renderSubagentProcessPill(m.metadata?.processEntries || [], 'sa_msg_proc') : '';
    const contentHtml = isUser
      ? `<div class="msg-content">${!isDirectUserMessage ? `<div style="font-size:11px;font-weight:800;margin-bottom:6px;opacity:0.78">${label}${source ? ` · ${source}` : ''}</div>` : ''}${escHtml(m.content)}</div>`
      : `<div class="msg-content markdown-body">${typeof marked !== 'undefined' ? marked.parse(m.content) : escHtml(m.content)}</div>`;
    const metaHtml = stepCount ? `<div style="font-size:10px;color:var(--muted);margin-top:4px">${stepCount} steps${durationSec ? ` · ${durationSec}s` : ''}</div>` : '';
    return `
      <div class="msg ${isUser ? 'user' : 'ai'}">
        ${!isUser ? `<div class="msg-avatar" style="background:${agentColor(agent.id)};border-color:${agentColor(agent.id)};font-size:15px">${agentEmoji(agent)}</div>` : ''}
        <div class="msg-body">
          ${!isUser ? `<div class="msg-role">${label} · <span style="font-weight:400;opacity:0.75">${timeAgo(m.ts)}${source ? ` · ${source}` : ''}</span></div>` : ''}
          ${contentHtml}
          ${processHtml}
          ${metaHtml}
        </div>
      </div>`;
  }).join('');
  return `
    <div style="display:flex;flex-direction:column;height:100%;gap:0">
      <div id="subagent-chat-messages" style="flex:1;display:flex;flex-direction:column;align-items:center;width:100%;gap:18px;overflow-y:auto;padding:16px 0 8px">
        ${subagentChatHistory.length === 0 ? `
          <div style="text-align:center;color:var(--muted);padding:32px 16px;font-size:13px">
            <div style="font-size:32px;margin-bottom:10px">${emoji}</div>
            <div style="font-weight:700;margin-bottom:6px">Chat with ${escHtml(agent.name||agent.id)}</div>
            <div style="font-size:12px;line-height:1.5">Send a message to interact directly with this agent. Each message spawns the agent with the full conversation as context.</div>
          </div>` : ''}
        ${renderedMessages}
        ${liveStream ? renderSubagentStreamingBubble(agent) : ''}
      </div>
      <div style="flex-shrink:0;border-top:1px solid var(--line);padding:10px 0 0;display:flex;gap:8px;align-items:flex-end">
        <div style="flex:1;display:flex;flex-direction:column;gap:6px">
          ${queuedCount ? `<div style="align-self:flex-start;border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:999px;padding:3px 9px;font-size:11px;font-weight:700">${queuedCount} queued</div>` : ''}
          <textarea id="subagent-chat-input" rows="2" placeholder="${isSending ? `Queue a message for ${escHtml(agent.name||agent.id)}...` : `Message ${escHtml(agent.name||agent.id)}...`} (Enter to send, Shift+Enter for newline)" style="width:100%;resize:none;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;font-family:inherit;background:var(--panel-2);color:var(--text);outline:none" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendSubagentChat('${escHtml(agent.id)}');}"></textarea>
        </div>
        <button onclick="${isSending ? `abortSubagentChat('${escHtml(agent.id)}')` : `sendSubagentChat('${escHtml(agent.id)}')`}" style="background:${isSending ? '#e05c5c' : 'var(--brand)'};color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;height:36px;min-width:58px">${isSending ? 'Stop' : 'Send'}</button>
      </div>
    </div>`;
}

// ── Chat ──────────────────────────────────────────────────────────────────────
async function sendSubagentChat(agentId, queuedMessage = null) {
  const inp = document.getElementById('subagent-chat-input');
  const fromQueue = queuedMessage !== null && queuedMessage !== undefined;
  if (!inp && !fromQueue) return;
  const msg = fromQueue ? String(queuedMessage || '').trim() : String(inp?.value || '').trim();
  if (!msg) return;

  if (isSubagentChatBusy(agentId)) {
    const queued = queueSubagentChatMessage(agentId, msg);
    if (queued && !fromQueue && inp) {
      inp.value = '';
      subagentChatDraft = '';
    }
    if (activeSubagentId === agentId && subagentDetailTab === 'chat') renderSubagentBoard(agentId);
    requestAnimationFrame(() => {
      const newInp = document.getElementById('subagent-chat-input');
      if (newInp) newInp.focus();
    });
    return;
  }

  if (inp && !fromQueue) inp.value = '';
  if (!fromQueue) subagentChatDraft = '';
  _subagentChatSending = true;

  subagentChatHistory.push({ id: `pending_${Date.now()}`, role: 'user', content: msg, ts: Date.now(), metadata: { pending: true } });

  const startTs = Date.now();
  const streamState = {
    agentId,
    content: '',
    thinking: '',
    processEntries: [],
    progressLines: [`${getActiveSubagentName(agentId)} is thinking...`],
    completed: false,
    finalReply: '',
    fallbackTimer: null,
  };
  setSubagentStreamingState(agentId, streamState);
  renderSubagentBoard(agentId);
  const controller = new AbortController();
  subagentChatAbortControllers[agentId] = controller;
  let wasAborted = false;

  // Scroll to bottom
  requestAnimationFrame(() => {
    const msgs = document.getElementById('subagent-chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });

  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      signal: controller.signal,
      body: JSON.stringify({
        message: msg,
        timeoutMs: 300000,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error('No response body from stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }

        if (getSubagentStreamingState(agentId) !== streamState) continue;

        switch (event.type) {
          case 'token': {
            const chunk = String(event.text || '');
            if (!chunk) break;
            streamState.content = `${streamState.content || ''}${chunk}`;
            refreshSubagentStreamingUI(agentId);
            break;
          }

          case 'thinking_delta': {
            const chunk = String(event.thinking || event.text || '');
            if (!chunk) break;
            streamState.thinking = `${streamState.thinking || ''}${chunk}`;
            if (!streamState.progressLines?.some((line) => /^Thinking/i.test(String(line)))) {
              pushSubagentProgressLine('Thinking...', streamState);
            }
            refreshSubagentStreamingUI(agentId);
            break;
          }

          case 'thinking':
          case 'agent_thought': {
            const thought = String(event.thinking || event.text || '').trim();
            if (!thought) break;
            streamState.thinking = streamState.thinking
              ? `${streamState.thinking}\n\n${thought}`
              : thought;
            addSubagentProcessEntry('think', thought, event.actor ? { actor: event.actor } : undefined, streamState);
            refreshSubagentStreamingUI(agentId, true);
            break;
          }

          case 'info': {
            const info = String(event.message || '').trim();
            if (!info) break;
            pushSubagentProgressLine(info, streamState);
            addSubagentProcessEntry('info', info, event.actor ? { actor: event.actor } : undefined, streamState);
            refreshSubagentStreamingUI(agentId, true);
            break;
          }

          case 'heartbeat': {
            const heartbeatMsg = String(event.message || event.current_step || event.state || '').trim();
            if (!heartbeatMsg) break;
            if (!/^processing$/i.test(heartbeatMsg)) {
              pushSubagentProgressLine(heartbeatMsg, streamState);
            }
            refreshSubagentStreamingUI(agentId);
            break;
          }

          case 'progress_state': {
            const items = Array.isArray(event.items) ? event.items : [];
            const activeIndex = Number(event.activeIndex || -1);
            const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
            const activeText = String(activeItem?.text || '').trim();
            if (activeText) {
              pushSubagentProgressLine(activeText, streamState);
            } else if (event.reason === 'request_start' && streamState.progressLines?.[0] === 'Connecting...') {
              streamState.progressLines = [`${getActiveSubagentName(agentId)} is thinking...`];
              refreshSubagentStreamingUI(agentId);
            }
            break;
          }

          case 'tool_call': {
            const action = String(event.action || '').trim();
            if (!action) break;
            const stepNum = Number(event.stepNum || 0);
            const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
            const args = (event.args && typeof event.args === 'object') ? event.args : null;
            const argsPreview = args ? JSON.stringify(args).slice(0, 240) : '';
            pushSubagentProgressLine(`${stepPrefix}Running ${action}...`, streamState);
            addSubagentProcessEntry(
              'tool',
              `${stepPrefix}${action}${argsPreview ? ` ${argsPreview}` : ''}`,
              (args || event.actor) ? { ...(args || {}), ...(event.actor ? { actor: event.actor } : {}) } : undefined,
              streamState,
            );
            refreshSubagentStreamingUI(agentId, true);
            break;
          }

          case 'tool_result': {
            const action = String(event.action || '').trim() || 'tool';
            const stepNum = Number(event.stepNum || 0);
            const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
            const text = String(event.result || '').trim();
            const ok = event.error === true ? false : !/^ERROR:/i.test(text);
            pushSubagentProgressLine(`${stepPrefix}${action} ${ok ? 'complete' : 'failed'}`, streamState);
            addSubagentProcessEntry(
              ok ? 'result' : 'error',
              `${stepPrefix}${action} => ${text || '(no output)'}`,
              event.actor ? { actor: event.actor } : undefined,
              streamState,
            );
            refreshSubagentStreamingUI(agentId, true);
            break;
          }

          case 'tool_progress': {
            const action = String(event.action || '').trim();
            const progressMsg = String(event.message || '').trim();
            if (!action || !progressMsg) break;
            pushSubagentProgressLine(`${action}: ${progressMsg}`, streamState);
            addSubagentProcessEntry('info', `${action}: ${progressMsg}`, event.actor ? { actor: event.actor } : undefined, streamState);
            refreshSubagentStreamingUI(agentId, true);
            break;
          }

          case 'final': {
            const reply = String(event.reply || event.text || '').trim();
            if (reply) {
              streamState.finalReply = reply;
              if (!streamState.content) streamState.content = reply;
              addSubagentProcessEntry('final', reply, undefined, streamState);
              refreshSubagentStreamingUI(agentId, true);
            }
            break;
          }

          case 'done': {
            const reply = String(event.reply || event.text || '').trim();
            if (reply) {
              streamState.finalReply = reply;
              if (!streamState.content) streamState.content = reply;
            }
            const thinking = String(event.thinking || '').trim();
            if (thinking && !String(streamState.thinking || '').includes(thinking)) {
              streamState.thinking = streamState.thinking
                ? `${streamState.thinking}\n\n${thinking}`
                : thinking;
            }
            streamState.completed = true;
            if (!commitSubagentStreamingReply(agentId, streamState, streamState.finalReply || streamState.content || reply, startTs, { streamDone: true })) {
              refreshSubagentStreamingUI(agentId, true);
            } else {
              scheduleNextSubagentQueuedMessage(agentId);
            }
            break;
          }

          case 'error':
            throw new Error(String(event.message || 'Unknown stream error'));
        }
      }
    }

    try {
      const d = await api(`/api/agents/history?agentId=${encodeURIComponent(agentId)}&limit=30`);
      subagentRuns = d.history || [];
    } catch {}

    if (getSubagentStreamingState(agentId) === streamState) {
      streamState.fallbackTimer = setTimeout(async () => {
        if (getSubagentStreamingState(agentId) !== streamState) return;
        const reconciled = await reconcileSubagentChatFromServer(agentId, streamState, startTs);
        if (reconciled || getSubagentStreamingState(agentId) !== streamState) return;
        const fallbackContent = String(streamState.finalReply || streamState.content || '').trim()
          || 'No final response was returned. The run may have been interrupted before completion.';
        if (commitSubagentStreamingReply(agentId, streamState, fallbackContent, startTs, { streamFallback: true })) {
          scheduleNextSubagentQueuedMessage(agentId);
        }
        requestAnimationFrame(() => {
          const newInp = document.getElementById('subagent-chat-input');
          if (newInp) newInp.focus();
        });
      }, 450);
    }
  } catch (err) {
    wasAborted = controller.signal.aborted || err?.name === 'AbortError';
    const errorMessage = err?.message || String(err);
    if (streamState.fallbackTimer) clearTimeout(streamState.fallbackTimer);
    if (wasAborted) {
      streamState.completed = true;
      pushSubagentProgressLine('Stopped by user.', streamState);
      commitSubagentStreamingReply(
        agentId,
        streamState,
        String(streamState.finalReply || streamState.content || '').trim() || 'Stopped.',
        startTs,
        { source: 'subagent_chat', success: false, stopped: true },
      );
    } else {
      if (getSubagentStreamingState(agentId) === streamState) setSubagentStreamingState(agentId, null);
      subagentChatHistory.push({ id: `error_${Date.now()}`, agentId, role: 'agent', content: `Error: ${errorMessage}`, ts: Date.now(), metadata: { source: 'subagent_chat', success: false } });
    }
  } finally {
    if (subagentChatAbortControllers[agentId] === controller) delete subagentChatAbortControllers[agentId];
  }

  if (!getSubagentStreamingState(agentId) && activeSubagentId === agentId) renderSubagentBoard(agentId);
  if (!wasAborted) scheduleNextSubagentQueuedMessage(agentId);
  requestAnimationFrame(() => {
    const msgs = document.getElementById('subagent-chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    const newInp = document.getElementById('subagent-chat-input');
    if (newInp) {
      newInp.focus();
      newInp.oninput = () => { subagentChatDraft = newInp.value; };
    }
  });
}

function abortSubagentChat(agentId) {
  const controller = subagentChatAbortControllers[agentId];
  if (controller && !controller.signal.aborted) controller.abort();
  const streamState = getSubagentStreamingState(agentId);
  if (streamState) {
    streamState.abortRequested = true;
    pushSubagentProgressLine('Stopping...', streamState);
    refreshSubagentStreamingUI(agentId, true);
  }
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
    subagentSystemPrompt = content;
    showToast('Saved', 'System prompt saved', 'success');
  } catch (err) {
    showToast('Error', 'Failed to save: ' + err.message, 'error');
  }
}

// ── Context Reference Actions ─────────────────────────────────────────────────
async function saveSubagentCtxRef(agentId) {
  const titleEl = document.getElementById(`sa-ctx-title-${agentId}`);
  const contentEl = document.getElementById(`sa-ctx-content-${agentId}`);
  const title = titleEl?.value.trim();
  const content = contentEl?.value.trim();
  if (!title || !content) { showToast('Error', 'Title and content are required', 'error'); return; }
  try {
    const d = await api(`/api/agents/${encodeURIComponent(agentId)}/context-refs`, {
      method: 'POST',
      body: JSON.stringify({ title, content }),
    });
    subagentContextRefs = [...subagentContextRefs, d.ref];
    if (titleEl) titleEl.value = '';
    if (contentEl) contentEl.value = '';
    renderSubagentBoard(agentId);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

function openSubagentCtxRefModal(agentId, refId) {
  _subagentCtxRefEditId = refId;
  const ref = subagentContextRefs.find(r => r.id === refId);
  if (!ref) return;
  const modal = document.getElementById(`sa-ctx-modal-${agentId}`);
  const titleEl = document.getElementById(`sa-ctx-modal-title-${agentId}`);
  const contentEl = document.getElementById(`sa-ctx-modal-content-${agentId}`);
  if (!modal || !titleEl || !contentEl) return;
  titleEl.value = ref.title || '';
  contentEl.value = ref.content || '';
  modal.style.display = 'flex';
}

function closeSubagentCtxRefModal(agentId) {
  const modal = document.getElementById(`sa-ctx-modal-${agentId}`);
  if (modal) modal.style.display = 'none';
  _subagentCtxRefEditId = null;
}

async function updateSubagentCtxRef(agentId) {
  if (!_subagentCtxRefEditId) return;
  const titleEl = document.getElementById(`sa-ctx-modal-title-${agentId}`);
  const contentEl = document.getElementById(`sa-ctx-modal-content-${agentId}`);
  const title = titleEl?.value.trim();
  const content = contentEl?.value.trim();
  if (!title || !content) { showToast('Error', 'Title and content are required', 'error'); return; }
  try {
    const d = await api(`/api/agents/${encodeURIComponent(agentId)}/context-refs/${encodeURIComponent(_subagentCtxRefEditId)}`, {
      method: 'PUT',
      body: JSON.stringify({ title, content }),
    });
    subagentContextRefs = subagentContextRefs.map(r => r.id === _subagentCtxRefEditId ? d.ref : r);
    closeSubagentCtxRefModal(agentId);
    renderSubagentBoard(agentId);
    showToast('Saved', 'Context reference updated', 'success');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function deleteSubagentCtxRef(agentId) {
  if (!_subagentCtxRefEditId) return;
  if (!confirm('Delete this context reference?')) return;
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/context-refs/${encodeURIComponent(_subagentCtxRefEditId)}`, { method: 'DELETE' });
    subagentContextRefs = subagentContextRefs.filter(r => r.id !== _subagentCtxRefEditId);
    closeSubagentCtxRefModal(agentId);
    renderSubagentBoard(agentId);
    showToast('Deleted', 'Context reference removed', 'success');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function uploadSubagentContextFile(agentId, input) {
  const file = input.files?.[0];
  if (!file) return;
  const isText = file.type.startsWith('text/') || /\.(md|txt|json|yaml|yml|csv|xml|js|ts|py|sh|html|css)$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      let content, encoding;
      if (isText) {
        content = e.target.result;
        encoding = 'text';
      } else {
        content = e.target.result.split(',')[1]; // strip data:...;base64,
        encoding = 'base64';
      }
      bgtToast('📎 Uploading…', file.name);
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/context-files`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, content, encoding, title: file.name }),
      });
      subagentContextRefs = [...subagentContextRefs, d.ref];
      renderSubagentBoard(agentId);
      showToast('Uploaded', `${file.name} added as context reference`, 'success');
    } catch (err) {
      showToast('Error', err.message, 'error');
    }
  };
  if (isText) reader.readAsText(file);
  else reader.readAsDataURL(file);
  input.value = '';
}

// ── Memory Tab Actions ────────────────────────────────────────────────────────
async function reloadSubagentMemory(agentId) {
  try {
    const d = await api(`/api/agents/${encodeURIComponent(agentId)}/workspace/notes`);
    subagentMemoryNotes = d.notes || '';
    renderSubagentBoard(agentId);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// ── Heartbeat Tab Actions ─────────────────────────────────────────────────────
async function saveSubagentHbConfig(agentId) {
  const enabledEl = document.getElementById(`sa-hb-enabled-${agentId}`);
  const intervalEl = document.getElementById(`sa-hb-interval-${agentId}`);
  const enabled = enabledEl?.checked === true;
  const interval_minutes = Math.max(1, Math.min(1440, Number(intervalEl?.value) || 30));
  const statusEl = document.getElementById(`sa-hb-status-${agentId}`);
  try {
    await api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, interval_minutes }),
    });
    subagentHbConfig = { enabled, intervalMinutes: interval_minutes };
    if (statusEl) { statusEl.textContent = 'Config saved.'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000); }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Save failed: ${err.message}`;
  }
}

async function saveSubagentHbMd(agentId) {
  const textarea = document.getElementById(`sa-hb-md-${agentId}`);
  if (!textarea) return;
  const content = textarea.value;
  const statusEl = document.getElementById(`sa-hb-status-${agentId}`);
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    subagentHbMd = content;
    if (statusEl) { statusEl.textContent = 'HEARTBEAT.md saved.'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000); }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Save failed: ${err.message}`;
  }
}

async function reloadSubagentHb(agentId) {
  subagentHbMd = '';
  try {
    const [cfgD, mdD] = await Promise.all([
      api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`).catch(() => ({})),
      api(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`).catch(() => ({})),
    ]);
    const cfg = cfgD?.config || {};
    subagentHbConfig = { enabled: cfg.enabled === true, intervalMinutes: cfg.intervalMinutes || 30 };
    subagentHbMd = mdD?.content || '';
    renderSubagentBoard(agentId);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function tickSubagentHbFromDetail(agentId) {
  const statusEl = document.getElementById(`sa-hb-status-${agentId}`);
  try {
    await api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}/tick`, { method: 'POST' });
    if (statusEl) { statusEl.textContent = 'Heartbeat triggered.'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000); }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Failed: ${err.message}`;
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
  subagentSystemPrompt = '';
  subagentHbMd = '';
  await loadSubagentBoardData(agentId);
  // Reload current tab data too
  if (subagentDetailTab === 'systemprompt') {
    try { const d = await api(`/api/agents/${encodeURIComponent(agentId)}/system-prompt-md`); subagentSystemPrompt = d.content || ''; } catch {}
  }
  if (subagentDetailTab === 'memory') {
    try { const d = await api(`/api/agents/${encodeURIComponent(agentId)}/workspace/notes`); subagentMemoryNotes = d.notes || ''; } catch {}
  }
  if (subagentDetailTab === 'heartbeat') {
    try {
      const [cfgD, mdD] = await Promise.all([
        api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`).catch(() => ({})),
        api(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`).catch(() => ({})),
      ]);
      const cfg = cfgD?.config || {};
      subagentHbConfig = { enabled: cfg.enabled === true, intervalMinutes: cfg.intervalMinutes || 30 };
      subagentHbMd = mdD?.content || '';
    } catch {}
  }
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
	      if (subagentDetailTab === 'chat') {
	        const chat = await api(`/api/agents/${encodeURIComponent(agentId)}/chat?limit=100`);
	        const freshChat = normalizeSubagentChatMessages(chat.messages || []);
	        if (freshChat.length !== subagentChatHistory.length) {
	          subagentChatHistory = preserveSubagentProcessMetadata(freshChat);
	          renderSubagentBoard(agentId);
	        }
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

async function openScheduleOwnerAgent(agentId) {
  if (!agentId) return;
  if (typeof window.setMode === 'function') window.setMode('subagents');
  await refreshSubagents();
  await openSubagentDetail(agentId);
}

function ensureSubagentExternalStream(agentId, meta = {}) {
  let streamState = getSubagentStreamingState(agentId);
  if (streamState && streamState.completed !== true) return streamState;
  streamState = {
    agentId,
    content: '',
    thinking: '',
    processEntries: [],
    progressLines: [meta.scheduleName ? `Scheduled run: ${meta.scheduleName}` : `${getActiveSubagentName(agentId)} is running...`],
    completed: false,
    finalReply: '',
    fallbackTimer: null,
    taskId: meta.taskId || '',
    scheduleId: meta.scheduleId || '',
    externalStream: true,
  };
  setSubagentStreamingState(agentId, streamState);
  if (agentId === activeSubagentId && subagentDetailTab === 'chat') {
    renderSubagentBoard(agentId);
    requestAnimationFrame(() => {
      const msgs = document.getElementById('subagent-chat-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    });
  }
  return streamState;
}

function applySubagentExternalStreamEvent(agentId, rawEvent, meta = {}) {
  if (!agentId || !rawEvent) return;
  const event = { type: rawEvent.type || meta.event, ...rawEvent };
  const streamState = ensureSubagentExternalStream(agentId, meta);

  switch (event.type) {
    case 'token': {
      const chunk = String(event.text || '');
      if (chunk) streamState.content = `${streamState.content || ''}${chunk}`;
      break;
    }
    case 'thinking_delta': {
      const chunk = String(event.thinking || event.text || '');
      if (chunk) {
        streamState.thinking = `${streamState.thinking || ''}${chunk}`;
        if (!streamState.progressLines?.some((line) => /^Thinking/i.test(String(line)))) {
          pushSubagentProgressLine('Thinking...', streamState);
        }
      }
      break;
    }
    case 'thinking':
    case 'agent_thought': {
      const thought = String(event.thinking || event.text || '').trim();
      if (thought) {
        streamState.thinking = streamState.thinking ? `${streamState.thinking}\n\n${thought}` : thought;
        addSubagentProcessEntry('think', thought, event.actor ? { actor: event.actor } : undefined, streamState);
      }
      break;
    }
    case 'info': {
      const info = String(event.message || '').trim();
      if (info) {
        pushSubagentProgressLine(info, streamState);
        addSubagentProcessEntry('info', info, event.actor ? { actor: event.actor } : undefined, streamState);
      }
      break;
    }
    case 'progress_state': {
      const items = Array.isArray(event.items) ? event.items : [];
      const activeIndex = Number(event.activeIndex || -1);
      const activeText = String(activeIndex >= 0 ? items[activeIndex]?.text || '' : '').trim();
      if (activeText) pushSubagentProgressLine(activeText, streamState);
      break;
    }
    case 'tool_call': {
      const action = String(event.action || '').trim();
      if (action) {
        const stepNum = Number(event.stepNum || 0);
        const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
        const args = (event.args && typeof event.args === 'object') ? event.args : null;
        const argsPreview = args ? JSON.stringify(args).slice(0, 240) : '';
        pushSubagentProgressLine(`${stepPrefix}Running ${action}...`, streamState);
        addSubagentProcessEntry(
          'tool',
          `${stepPrefix}${action}${argsPreview ? ` ${argsPreview}` : ''}`,
          (args || event.actor) ? { ...(args || {}), ...(event.actor ? { actor: event.actor } : {}) } : undefined,
          streamState,
        );
      }
      break;
    }
    case 'tool_result': {
      const action = String(event.action || '').trim() || 'tool';
      const stepNum = Number(event.stepNum || 0);
      const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
      const text = String(event.result || '').trim();
      const ok = event.error === true ? false : !/^ERROR:/i.test(text);
      pushSubagentProgressLine(`${stepPrefix}${action} ${ok ? 'complete' : 'failed'}`, streamState);
      addSubagentProcessEntry(
        ok ? 'result' : 'error',
        `${stepPrefix}${action} => ${text || '(no output)'}`,
        event.actor ? { actor: event.actor } : undefined,
        streamState,
      );
      break;
    }
    case 'tool_progress': {
      const action = String(event.action || '').trim();
      const progressMsg = String(event.message || '').trim();
      if (action && progressMsg) {
        pushSubagentProgressLine(`${action}: ${progressMsg}`, streamState);
        addSubagentProcessEntry('info', `${action}: ${progressMsg}`, event.actor ? { actor: event.actor } : undefined, streamState);
      }
      break;
    }
    case 'final':
    case 'done': {
      const reply = String(event.reply || event.text || '').trim();
      if (reply) {
        streamState.finalReply = reply;
        if (!streamState.content) streamState.content = reply;
        addSubagentProcessEntry('final', reply, undefined, streamState);
      }
      streamState.completed = event.type === 'done';
      break;
    }
    case 'error': {
      const message = String(event.message || 'Scheduled run error').trim();
      pushSubagentProgressLine(message, streamState);
      addSubagentProcessEntry('error', message, undefined, streamState);
      break;
    }
  }

  if (agentId === activeSubagentId) {
    refreshSubagentStreamingUI(agentId, true);
  }
}

// ── Module init ───────────────────────────────────────────────────────────────
console.log('[SubagentsPage] module loaded');

// ── WS events ─────────────────────────────────────────────────────────────────
wsEventBus.on('agent_run_complete', (data) => {
  if (!activeSubagentId || data.agentId !== activeSubagentId) return;
  refreshSubagentDetail(activeSubagentId);
});

wsEventBus.on('subagent_chat_message', (data) => {
  if (!data.agentId || !data.message) return;
  let [message] = normalizeSubagentChatMessages([data.message]);
  if (!message) return;
  const streamState = getSubagentStreamingState(data.agentId);
  if (streamState && message.role === 'agent') {
    if (streamState.fallbackTimer) clearTimeout(streamState.fallbackTimer);
    message = mergeStreamingStateIntoMessage(message);
    setSubagentStreamingState(data.agentId, null);
  }
  if (data.agentId !== activeSubagentId) {
    return;
  }
  const priorChatHistory = subagentChatHistory;
  [message] = preserveSubagentProcessMetadata([message], priorChatHistory);
  subagentChatHistory = priorChatHistory.filter(m => !(
    ((m.metadata?.pending || m.metadata?.localStreamingFallback) && m.role === message.role && m.content === message.content)
  ));
  if (!subagentChatHistory.some(m => m.id === message.id)) {
    subagentChatHistory.push(message);
  }
  if (subagentDetailTab === 'chat') {
    renderSubagentBoard(activeSubagentId);
    requestAnimationFrame(() => {
      const msgs = document.getElementById('subagent-chat-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    });
  }
});

wsEventBus.on('subagent_chat_stream_event', (data) => {
  const agentId = String(data.agentId || '').trim();
  if (!agentId) return;
  applySubagentExternalStreamEvent(agentId, {
    type: data.event,
    ...(data.data || {}),
  }, {
    event: data.event,
    taskId: data.taskId,
    scheduleId: data.scheduleId,
    scheduleName: data.scheduleName,
  });
});

wsEventBus.on('agents_updated', () => { refreshSubagents(); });

// ── Exports ───────────────────────────────────────────────────────────────────
window.subagentsPageActivate = subagentsPageActivate;
window.refreshSubagents = refreshSubagents;
window.openSubagentDetail = openSubagentDetail;
window.openScheduleOwnerAgent = openScheduleOwnerAgent;
window.closeSubagentDetail = closeSubagentDetail;
window.switchSubagentTab = switchSubagentTab;
window.sendSubagentChat = sendSubagentChat;
window.abortSubagentChat = abortSubagentChat;
window.saveSubagentSystemPrompt = saveSubagentSystemPrompt;
window.spawnSubagentTask = spawnSubagentTask;
window.refreshSubagentDetail = refreshSubagentDetail;
window.openSubagentSettings = openSubagentSettings;
// Context refs
window.saveSubagentCtxRef = saveSubagentCtxRef;
window.openSubagentCtxRefModal = openSubagentCtxRefModal;
window.closeSubagentCtxRefModal = closeSubagentCtxRefModal;
window.updateSubagentCtxRef = updateSubagentCtxRef;
window.deleteSubagentCtxRef = deleteSubagentCtxRef;
window.uploadSubagentContextFile = uploadSubagentContextFile;
window.toggleSubagentProcess = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === 'none' || !el.style.display ? 'block' : 'none';
};
// Memory
window.reloadSubagentMemory = reloadSubagentMemory;
// Heartbeat
window.saveSubagentHbConfig = saveSubagentHbConfig;
window.saveSubagentHbMd = saveSubagentHbMd;
window.reloadSubagentHb = reloadSubagentHb;
window.tickSubagentHbFromDetail = tickSubagentHbFromDetail;
