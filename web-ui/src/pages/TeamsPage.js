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

import { renderAgentModelPicker as _renderAgentModelPicker, agentModelPickerHydrate, registerAgentModelPickerOnSaved } from '../components/agent-model-picker.js';
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
let teamRoomState = null;     // live room state for active team
let teamRunExpanded = {};     // runId -> expanded/collapsed in Runs tab
let teamChatMessages = [];    // cached chat for active team
const TEAM_CHAT_INITIAL_VISIBLE = 20;
let teamChatVisibleCountByTeam = {}; // teamId -> number of recent messages currently visible
let teamWorkspaceFiles = [];  // cached workspace files for active team (flat)
let teamWorkspaceTree = [];   // cached workspace tree (nested) for active team
let teamWorkspaceData = null; // full workspace API response (incl. workspacePath)
let teamMemoryFiles = { memory: null, lastRun: null, pending: null, loading: false };
let teamSubagentDetailId = null;     // currently-open subagent inside the Subagents tab
let teamSubagentDetailTab = 'overview'; // overview | systemprompt | heartbeat
let teamSubagentDetail = { systemPrompt: '', heartbeatMd: '', heartbeatCfg: { enabled: false, intervalMinutes: 30 }, contextRefs: [] };
let _teamCmEditors = {};      // CodeMirror instances for the Subagents tab editors
let teamWorkspaceOpenFile = null; // { teamId, relpath, name, content, modifiedAt, dirty, mode }
let _teamWorkspaceCm = null;
let teamActiveRunsByTeam = {};      // teamId -> { taskId -> live run row }
let teamProgressExpandedRuns = {};  // `${teamId}::${runKey}` -> true
let teamProgressTaskCache = {};     // taskId -> { items, status, title, loadedAt, error? }
let teamProgressTaskLoading = {};   // taskId -> booleanprom 
let teamProgressTaskRefreshTimers = {}; // taskId -> timeout handle
const workspaceFolderExpanded = new Set(); // relativePaths of expanded folders
let teamChatPolling = null;
let teamChatDraftByTeam = {}; // teamId -> unsent draft message
let activeTeamChatSignature = '';
let teamChatStreamingState = null;
const MAX_TEAM_CHAT_QUEUE = 8;
let teamChatAbortControllersByTeam = {}; // teamId -> AbortController
let teamChatQueueByTeam = {}; // teamId -> [{ content }]
let teamChatQueueDrainTimers = {}; // teamId -> timer id
let teamDispatchStreamsByTeam = {}; // teamId -> { taskId -> live dispatch bubble state }
let teamDispatchExpanded = {};      // `${teamId}::${taskId}` -> true
let teamDispatchTicker = null;
let teamDispatchRefreshTimers = {}; // teamId -> timeout handle
let teamManagerStreamsByTeam = {};  // teamId -> { streamId -> live manager turn state }
let teamMemberStreamsByTeam = {};   // teamId -> { streamId -> live member room turn state }
let teamChatMentionState = null;

function normalizeTeamChatMentionSearch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .trim();
}

function buildTeamChatHandleLabel(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^@+/, '');
}

function getTeamById(teamId) {
  return teamsData.find((team) => team.id === teamId) || null;
}

function getTeamChatParticipants(teamOrId) {
  const team = typeof teamOrId === 'string' ? getTeamById(teamOrId) : teamOrId;
  if (!team) return [];
  const allAgents = Array.isArray(window._allAgentsForTeam) ? window._allAgentsForTeam : [];
  const participants = [
    {
      type: 'team',
      id: team.id,
      label: 'team',
      aliases: ['team'],
    },
    {
      type: 'manager',
      id: 'manager',
      label: 'manager',
      aliases: ['manager'],
    },
  ];
  for (const agentId of (team.subagentIds || [])) {
    const agent = allAgents.find((entry) => entry.id === agentId);
    const label = buildTeamChatHandleLabel(agent?.name || agentId);
    const aliases = Array.from(new Set([
      label,
      label.toLowerCase(),
      label.replace(/\s+/g, '-'),
      label.replace(/\s+/g, ''),
      String(agentId || '').trim(),
      String(agentId || '').trim().replace(/[_-]+/g, ' '),
    ].map((value) => String(value || '').trim()).filter(Boolean)));
    participants.push({
      type: 'member',
      id: agentId,
      label,
      aliases,
    });
  }
  return participants.map((participant) => ({
    ...participant,
    searchKey: Array.from(new Set(
      [participant.label, participant.id, ...(participant.aliases || [])]
        .map((value) => normalizeTeamChatMentionSearch(value))
        .filter(Boolean),
    )).join(' | '),
  }));
}

function findTeamChatMentions(text, teamOrId) {
  const raw = String(text || '');
  if (!raw.includes('@')) return [];
  const participants = getTeamChatParticipants(teamOrId);
  if (!participants.length) return [];
  const aliasEntries = participants
    .flatMap((participant) => (participant.aliases || []).map((alias) => ({
      participant,
      alias,
      aliasLower: String(alias || '').toLowerCase(),
    })))
    .sort((a, b) => b.alias.length - a.alias.length);
  const lowerRaw = raw.toLowerCase();
  const matches = [];
  let index = 0;
  while (index < raw.length) {
    if (raw.charAt(index) !== '@') { index += 1; continue; }
    const prev = index > 0 ? raw.charAt(index - 1) : '';
    if (prev && /[A-Za-z0-9_]/.test(prev)) { index += 1; continue; }
    const after = raw.slice(index + 1);
    const afterLower = lowerRaw.slice(index + 1);
    let found = null;
    for (const entry of aliasEntries) {
      if (!entry.aliasLower) continue;
      if (!afterLower.startsWith(entry.aliasLower)) continue;
      const boundary = after.charAt(entry.alias.length);
      if (boundary && !/[\s.,!?;:)\]}]/.test(boundary)) continue;
      found = entry;
      break;
    }
    if (!found) { index += 1; continue; }
    const end = index + 1 + found.alias.length;
    matches.push({
      start: index,
      end,
      text: raw.slice(index, end),
      participant: found.participant,
    });
    index = end;
  }
  return matches;
}

function renderTeamChatMentionHtml(mention) {
  const label = buildTeamChatHandleLabel(mention?.participant?.label || mention?.text || '');
  return `<span style="color:#79c0ff;font-weight:700">@${escHtml(label)}</span>`;
}

function renderTeamChatTextWithMentions(text, teamOrId, options = {}) {
  const raw = String(text || '');
  const mentions = findTeamChatMentions(raw, teamOrId);
  const renderPlain = (input) => escHtml(String(input || '')).replace(/\n/g, '<br>');
  if (!mentions.length) {
    if (options.markdown && typeof marked !== 'undefined') {
      return marked.parse(raw);
    }
    return renderPlain(raw);
  }

  const placeholders = [];
  let rebuilt = '';
  let cursor = 0;
  for (const mention of mentions) {
    rebuilt += raw.slice(cursor, mention.start);
    const token = `[[[TEAM_MENTION_${placeholders.length}]]]`;
    placeholders.push({ token, mention });
    rebuilt += token;
    cursor = mention.end;
  }
  rebuilt += raw.slice(cursor);

  let html = options.markdown && typeof marked !== 'undefined'
    ? marked.parse(rebuilt)
    : renderPlain(rebuilt);
  for (const entry of placeholders) {
    html = html.split(entry.token).join(renderTeamChatMentionHtml(entry.mention));
  }
  return html;
}

function getLeadingTeamChatTarget(text, teamOrId) {
  const raw = String(text || '');
  const trimmed = raw.trimStart();
  const leadingOffset = raw.length - trimmed.length;
  const mentions = findTeamChatMentions(raw, teamOrId);
  const leading = mentions.find((mention) => mention.start === leadingOffset);
  if (!leading) return { type: 'room', targetId: '', targetLabel: '', routedMessage: raw.trim() };
  const routedMessage = raw.slice(leading.end).trim() || raw.trim();
  return {
    type: leading.participant.type,
    targetId: leading.participant.type === 'member' ? leading.participant.id : '',
    targetLabel: leading.participant.label,
    routedMessage,
  };
}

function syncTeamChatInputMirror(teamId) {
  const input = document.getElementById('team-chat-input');
  const mirror = document.getElementById('team-chat-input-mirror');
  const placeholder = document.getElementById('team-chat-input-placeholder');
  if (!input || !mirror) return;
  const value = input.value || '';
  mirror.innerHTML = value
    ? renderTeamChatTextWithMentions(value, teamId, { markdown: false })
    : '&nbsp;';
  mirror.scrollTop = input.scrollTop;
  if (placeholder) placeholder.style.display = value ? 'none' : 'block';
}

function resizeTeamChatInput() {
  const input = document.getElementById('team-chat-input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(180, Math.max(64, input.scrollHeight))}px`;
  syncTeamChatInputMirror(activeTeamId);
}

function hideTeamChatMentionPopover() {
  teamChatMentionState = null;
  const popover = document.getElementById('team-chat-mention-popover');
  if (popover) {
    popover.style.display = 'none';
    popover.innerHTML = '';
  }
}

function renderTeamChatMentionPopover(teamId) {
  const popover = document.getElementById('team-chat-mention-popover');
  if (!popover || !teamChatMentionState || teamChatMentionState.teamId !== teamId) return;
  const items = Array.isArray(teamChatMentionState.items) ? teamChatMentionState.items : [];
  if (!items.length) {
    hideTeamChatMentionPopover();
    return;
  }
  popover.style.display = 'block';
  popover.innerHTML = items.map((item, index) => {
    const active = index === Number(teamChatMentionState.activeIndex || 0);
    const hint = item.type === 'team' ? 'Everyone'
      : item.type === 'manager' ? 'Manager'
      : (item.id || 'Member');
    return `
      <button
        type="button"
        onclick="selectTeamChatMention('${teamId}', ${index})"
        style="display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:none;background:${active ? 'rgba(76,141,255,0.16)' : 'transparent'};color:var(--text);padding:9px 11px;cursor:pointer;text-align:left"
      >
        <span style="font-size:12px;font-weight:700;color:${active ? '#9dc2ff' : 'var(--text)'}">@${escHtml(item.label)}</span>
        <span style="font-size:11px;color:var(--muted)">${escHtml(hint)}</span>
      </button>
    `;
  }).join('');
}

function refreshTeamChatMentionState(teamId) {
  const input = document.getElementById('team-chat-input');
  if (!input) return;
  const value = input.value || '';
  const caret = Number(input.selectionStart ?? value.length);
  const uptoCaret = value.slice(0, caret);
  const atIndex = uptoCaret.lastIndexOf('@');
  if (atIndex < 0) {
    hideTeamChatMentionPopover();
    return;
  }
  const beforeAt = atIndex > 0 ? uptoCaret.charAt(atIndex - 1) : '';
  if (beforeAt && /[A-Za-z0-9_]/.test(beforeAt)) {
    hideTeamChatMentionPopover();
    return;
  }
  const query = uptoCaret.slice(atIndex + 1);
  if (query.includes('\n') || /[()[\]{}]/.test(query)) {
    hideTeamChatMentionPopover();
    return;
  }
  const normalizedQuery = normalizeTeamChatMentionSearch(query);
  const items = getTeamChatParticipants(teamId).filter((participant) => {
    if (!normalizedQuery) return true;
    return participant.searchKey.includes(normalizedQuery);
  });
  if (!items.length) {
    hideTeamChatMentionPopover();
    return;
  }
  const activeIndex = Math.min(Number(teamChatMentionState?.activeIndex || 0), items.length - 1);
  teamChatMentionState = {
    teamId,
    start: atIndex,
    end: caret,
    items,
    activeIndex: activeIndex < 0 ? 0 : activeIndex,
  };
  renderTeamChatMentionPopover(teamId);
}

function selectTeamChatMention(teamId, index) {
  const input = document.getElementById('team-chat-input');
  if (!input || !teamChatMentionState || teamChatMentionState.teamId !== teamId) return;
  const items = Array.isArray(teamChatMentionState.items) ? teamChatMentionState.items : [];
  const picked = items[Number(index)];
  if (!picked) return;
  const value = input.value || '';
  const before = value.slice(0, teamChatMentionState.start);
  const after = value.slice(teamChatMentionState.end).replace(/^\s*/, '');
  const mentionText = `@${picked.label}`;
  const nextValue = `${before}${mentionText}${after ? ' ' : ' '}${after}`;
  const nextCaret = before.length + mentionText.length + 1;
  input.value = nextValue;
  input.focus();
  input.setSelectionRange(nextCaret, nextCaret);
  teamChatDraftByTeam[teamId] = nextValue;
  hideTeamChatMentionPopover();
  resizeTeamChatInput();
  refreshTeamChatMentionState(teamId);
}

function handleTeamChatInputKeydown(event, teamId) {
  if (teamChatMentionState && teamChatMentionState.teamId === teamId && Array.isArray(teamChatMentionState.items) && teamChatMentionState.items.length > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      teamChatMentionState.activeIndex = (Number(teamChatMentionState.activeIndex || 0) + 1) % teamChatMentionState.items.length;
      renderTeamChatMentionPopover(teamId);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      teamChatMentionState.activeIndex = (Number(teamChatMentionState.activeIndex || 0) - 1 + teamChatMentionState.items.length) % teamChatMentionState.items.length;
      renderTeamChatMentionPopover(teamId);
      return;
    }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault();
      selectTeamChatMention(teamId, Number(teamChatMentionState.activeIndex || 0));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      hideTeamChatMentionPopover();
      return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendTeamChat(teamId);
  }
}

if (!window.__teamChatMentionDismissBound) {
  window.__teamChatMentionDismissBound = true;
  document.addEventListener('mousedown', (event) => {
    const target = event.target;
    if (target && typeof target.closest === 'function' && target.closest('#team-chat-composer-shell')) return;
    hideTeamChatMentionPopover();
  });
}

function getTeamChatSignature(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const last = list.length > 0 ? list[list.length - 1] : null;
  return `${list.length}:${last?.id || ''}:${last?.timestamp || 0}`;
}

function isTeamChatBusy(teamId) {
  return !!(teamChatStreamingState && teamChatStreamingState.teamId === teamId && teamChatStreamingState.completed !== true);
}

function getTeamChatQueue(teamId, create = false) {
  if (!teamId) return [];
  if (!teamChatQueueByTeam[teamId] && create) teamChatQueueByTeam[teamId] = [];
  return teamChatQueueByTeam[teamId] || [];
}

function queueTeamChatMessage(teamId, content) {
  const text = String(content || '').trim();
  if (!text) return false;
  const queue = getTeamChatQueue(teamId, true);
  if (queue.length >= MAX_TEAM_CHAT_QUEUE) {
    bgtToast('Queue full', 'Wait for the team chat to catch up before adding more.');
    return false;
  }
  queue.push({ content: text });
  bgtToast('Queued', 'This will send after the current team turn.');
  return true;
}

function scheduleNextTeamQueuedMessage(teamId) {
  if (!teamId || (teamChatStreamingState && teamChatStreamingState.teamId === teamId) || teamChatQueueDrainTimers[teamId]) return;
  const queue = getTeamChatQueue(teamId);
  if (queue.length === 0) return;
  teamChatQueueDrainTimers[teamId] = setTimeout(() => {
    delete teamChatQueueDrainTimers[teamId];
    if (teamChatStreamingState && teamChatStreamingState.teamId === teamId) return;
    const next = getTeamChatQueue(teamId).shift();
    if (!next?.content) return;
    sendTeamChat(teamId, next.content);
  }, 120);
  refreshTeamChatComposerState(teamId);
}

function getTeamEventChatMessage(msg) {
  const candidate = msg?.chatMessage || msg?.message;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

function newTeamChatProcessEntry(type, content, extra = undefined) {
  return {
    ts: new Date().toLocaleTimeString(),
    type: String(type || 'info'),
    content: String(content || ''),
    ...(extra && typeof extra === 'object' ? extra : {}),
  };
}

function pushTeamChatProgressLine(line) {
  if (!teamChatStreamingState) return;
  const text = String(line || '').trim();
  if (!text) return;
  const lines = Array.isArray(teamChatStreamingState.progressLines) ? teamChatStreamingState.progressLines : [];
  if (lines[lines.length - 1] === text) return;
  lines.push(text);
  if (lines.length > 8) lines.splice(0, lines.length - 8);
  teamChatStreamingState.progressLines = lines;
}

function addTeamChatProcessEntry(type, content, extra = undefined) {
  if (!teamChatStreamingState) return;
  if (!Array.isArray(teamChatStreamingState.processEntries)) teamChatStreamingState.processEntries = [];
  teamChatStreamingState.processEntries.push(newTeamChatProcessEntry(type, content, extra));
}

function getTeamDispatchStreamMap(teamId) {
  if (!teamId) return {};
  if (!teamDispatchStreamsByTeam[teamId]) teamDispatchStreamsByTeam[teamId] = {};
  return teamDispatchStreamsByTeam[teamId];
}

function getTeamDispatchStreams(teamId) {
  return Object.values(getTeamDispatchStreamMap(teamId))
    .sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));
}

function ensureTeamDispatchStream(teamId, taskId, patch = {}) {
  if (!teamId || !taskId) return null;
  const streamMap = getTeamDispatchStreamMap(teamId);
  const existing = streamMap[taskId] || {
    teamId,
    taskId,
    agentId: '',
    agentName: 'Subagent',
    taskSummary: '',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    status: 'running',
    completed: false,
    content: '',
    finalReply: '',
    thinking: '',
    lastTool: '',
    progressLines: ['Working...'],
    processEntries: [],
    stepCount: 0,
    durationMs: 0,
  };
  Object.assign(existing, patch || {});
  if (!Array.isArray(existing.progressLines)) existing.progressLines = [];
  if (!Array.isArray(existing.processEntries)) existing.processEntries = [];
  if (!existing.progressLines.length) existing.progressLines = ['Working...'];
  existing.updatedAt = Date.now();
  streamMap[taskId] = existing;
  refreshTeamDispatchTicker();
  return existing;
}

function removeTeamDispatchStream(teamId, taskId) {
  const streamMap = getTeamDispatchStreamMap(teamId);
  if (streamMap && streamMap[taskId]) delete streamMap[taskId];
  delete teamDispatchExpanded[`${teamId}::${taskId}`];
  if (Object.keys(streamMap || {}).length === 0) {
    delete teamDispatchStreamsByTeam[teamId];
  }
  refreshTeamDispatchTicker();
}

function pushTeamDispatchProgressLine(stream, line) {
  if (!stream) return;
  const text = String(line || '').trim();
  if (!text) return;
  const lines = Array.isArray(stream.progressLines) ? stream.progressLines : [];
  if (lines[lines.length - 1] === text) return;
  lines.push(text);
  if (lines.length > 8) lines.splice(0, lines.length - 8);
  stream.progressLines = lines;
}

function addTeamDispatchProcessEntry(stream, type, content, extra = undefined) {
  if (!stream) return;
  if (!Array.isArray(stream.processEntries)) stream.processEntries = [];
  stream.processEntries.push(newTeamChatProcessEntry(type, content, extra));
  if (stream.processEntries.length > 250) {
    stream.processEntries.splice(0, stream.processEntries.length - 250);
  }
}

function formatTeamDispatchElapsed(stream) {
  if (!stream) return '0s';
  const startedAt = Number(stream.startedAt || Date.now());
  const totalMs = stream.completed
    ? Math.max(0, Number(stream.durationMs || 0) || (Number(stream.finishedAt || Date.now()) - startedAt))
    : Math.max(0, Date.now() - startedAt);
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function refreshTeamDispatchTicker() {
  const hasActive = Object.values(teamDispatchStreamsByTeam).some((streamMap) =>
    Object.values(streamMap || {}).some((stream) => stream && stream.completed !== true)
  );
  if (!hasActive) {
    if (teamDispatchTicker) {
      clearInterval(teamDispatchTicker);
      teamDispatchTicker = null;
    }
    return;
  }
  if (teamDispatchTicker) return;
  teamDispatchTicker = setInterval(() => {
    if (activeTeamId && teamBoardTab === 'chat' && getTeamDispatchStreams(activeTeamId).length > 0) {
      renderActiveTeamChat(activeTeamId, { forceBottom: false });
    }
  }, 1000);
}

function scheduleTeamDispatchRefresh(teamId, forceBottom = false) {
  if (!teamId) return;
  if (teamDispatchRefreshTimers[teamId]) return;
  teamDispatchRefreshTimers[teamId] = setTimeout(() => {
    delete teamDispatchRefreshTimers[teamId];
    refreshVisibleTeamChat(teamId, forceBottom);
  }, 70);
}

function getTeamManagerStreamMap(teamId) {
  if (!teamId) return {};
  if (!teamManagerStreamsByTeam[teamId]) teamManagerStreamsByTeam[teamId] = {};
  return teamManagerStreamsByTeam[teamId];
}

function getTeamManagerStreams(teamId) {
  return Object.values(getTeamManagerStreamMap(teamId))
    .sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));
}

function ensureTeamManagerStream(teamId, streamId, patch = {}) {
  if (!teamId || !streamId) return null;
  const streamMap = getTeamManagerStreamMap(teamId);
  const existing = streamMap[streamId] || {
    teamId,
    streamId,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    completed: false,
    source: 'conversation',
    turn: 1,
    content: '',
    finalReply: '',
    thinking: '',
    progressLines: ['Thinking...'],
    processEntries: [],
    stepCount: 0,
    durationMs: 0,
  };
  Object.assign(existing, patch || {});
  if (!Array.isArray(existing.progressLines)) existing.progressLines = [];
  if (!Array.isArray(existing.processEntries)) existing.processEntries = [];
  if (!existing.progressLines.length) existing.progressLines = ['Thinking...'];
  existing.updatedAt = Date.now();
  streamMap[streamId] = existing;
  return existing;
}

function removeTeamManagerStream(teamId, streamId) {
  const streamMap = getTeamManagerStreamMap(teamId);
  if (streamMap && streamMap[streamId]) delete streamMap[streamId];
  if (Object.keys(streamMap || {}).length === 0) delete teamManagerStreamsByTeam[teamId];
}

function applyTeamManagerStreamEvent(msg) {
  const teamId = String(msg?.teamId || '').trim();
  const streamId = String(msg?.streamId || '').trim();
  if (!teamId || !streamId) return null;
  const eventType = String(msg?.eventType || '').trim();
  const event = msg?.data && typeof msg.data === 'object' ? msg.data : {};
  const stream = ensureTeamManagerStream(teamId, streamId, {
    startedAt: Number(msg.startedAt || Date.now()),
    source: String(msg.source || 'conversation'),
    turn: Number(msg.turn || 1),
  });
  if (!stream) return null;

  switch (eventType) {
    case 'token': {
      const chunk = String(event.text || '');
      if (chunk) stream.content = `${stream.content || ''}${chunk}`;
      break;
    }
    case 'thinking_delta': {
      const chunk = String(event.thinking || event.text || '');
      if (chunk) {
        stream.thinking = `${stream.thinking || ''}${chunk}`;
        pushTeamDispatchProgressLine(stream, 'Thinking...');
      }
      break;
    }
    case 'thinking':
    case 'agent_thought': {
      const thought = String(event.thinking || event.text || '').trim();
      if (!thought) break;
      stream.thinking = stream.thinking ? `${stream.thinking}\n\n${thought}` : thought;
      addTeamDispatchProcessEntry(stream, 'think', thought, event.actor ? { actor: event.actor } : undefined);
      break;
    }
    case 'info': {
      const info = String(event.message || '').trim();
      if (!info) break;
      pushTeamDispatchProgressLine(stream, info);
      addTeamDispatchProcessEntry(stream, 'info', info, event.actor ? { actor: event.actor } : undefined);
      break;
    }
    case 'heartbeat': {
      const heartbeatMsg = String(event.message || event.current_step || event.state || '').trim();
      if (heartbeatMsg) pushTeamDispatchProgressLine(stream, heartbeatMsg);
      break;
    }
    case 'progress_state': {
      const items = Array.isArray(event.items) ? event.items : [];
      const activeIndex = Number(event.activeIndex || -1);
      const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
      const activeText = String(activeItem?.text || '').trim();
      if (activeText) pushTeamDispatchProgressLine(stream, activeText);
      break;
    }
    case 'tool_call': {
      const action = String(event.action || '').trim();
      if (!action) break;
      const stepNum = Number(event.stepNum || 0);
      const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
      const args = event.args && typeof event.args === 'object' ? event.args : null;
      const argsPreview = args ? JSON.stringify(args).slice(0, 240) : '';
      stream.stepCount = Number(stream.stepCount || 0) + 1;
      pushTeamDispatchProgressLine(stream, `${stepPrefix}Running ${action}...`);
      addTeamDispatchProcessEntry(
        stream,
        'tool',
        `${stepPrefix}${action}${argsPreview ? ` ${argsPreview}` : ''}`,
        (args || event.actor) ? { ...(args || {}), ...(event.actor ? { actor: event.actor } : {}) } : undefined,
      );
      break;
    }
    case 'tool_result': {
      const action = String(event.action || '').trim() || 'tool';
      const stepNum = Number(event.stepNum || 0);
      const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
      const text = String(event.result || '').trim();
      const ok = event.error === true ? false : !/^ERROR:/i.test(text);
      pushTeamDispatchProgressLine(stream, `${stepPrefix}${action} ${ok ? 'complete' : 'failed'}`);
      addTeamDispatchProcessEntry(
        stream,
        ok ? 'result' : 'error',
        `${stepPrefix}${action} => ${text || '(no output)'}`,
        event.actor ? { actor: event.actor } : undefined,
      );
      break;
    }
    case 'tool_progress': {
      const action = String(event.action || '').trim();
      const progressMsg = String(event.message || '').trim();
      if (!action || !progressMsg) break;
      pushTeamDispatchProgressLine(stream, `${action}: ${progressMsg}`);
      addTeamDispatchProcessEntry(stream, 'info', `${action}: ${progressMsg}`, event.actor ? { actor: event.actor } : undefined);
      break;
    }
    case 'final': {
      const reply = String(event.reply || event.text || '').trim();
      if (!reply) break;
      stream.finalReply = reply;
      if (!stream.content) stream.content = reply;
      addTeamDispatchProcessEntry(stream, 'final', reply);
      break;
    }
    case 'done': {
      const reply = String(event.reply || event.text || '').trim();
      if (reply) {
        stream.finalReply = reply;
        if (!stream.content) stream.content = reply;
      }
      if (String(event.thinking || '').trim()) {
        stream.thinking = stream.thinking
          ? `${stream.thinking}\n\n${String(event.thinking).trim()}`
          : String(event.thinking).trim();
      }
      stream.completed = true;
      stream.finishedAt = Date.now();
      stream.durationMs = Math.max(Number(stream.durationMs || 0), stream.finishedAt - Number(stream.startedAt || Date.now()));
      break;
    }
    default:
      break;
  }

  stream.updatedAt = Date.now();
  return stream;
}

function getTeamMemberStreamMap(teamId) {
  if (!teamId) return {};
  if (!teamMemberStreamsByTeam[teamId]) teamMemberStreamsByTeam[teamId] = {};
  return teamMemberStreamsByTeam[teamId];
}

function getTeamMemberStreams(teamId) {
  return Object.values(getTeamMemberStreamMap(teamId))
    .sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));
}

function ensureTeamMemberStream(teamId, streamId, patch = {}) {
  if (!teamId || !streamId) return null;
  const streamMap = getTeamMemberStreamMap(teamId);
  const existing = streamMap[streamId] || {
    teamId,
    streamId,
    agentId: '',
    agentName: 'Team Member',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    completed: false,
    content: '',
    finalReply: '',
    thinking: '',
    progressLines: ['Thinking...'],
    processEntries: [],
    stepCount: 0,
    durationMs: 0,
  };
  Object.assign(existing, patch || {});
  if (!Array.isArray(existing.progressLines)) existing.progressLines = [];
  if (!Array.isArray(existing.processEntries)) existing.processEntries = [];
  if (!existing.progressLines.length) existing.progressLines = ['Thinking...'];
  existing.updatedAt = Date.now();
  streamMap[streamId] = existing;
  return existing;
}

function removeTeamMemberStream(teamId, streamId) {
  const streamMap = getTeamMemberStreamMap(teamId);
  if (streamMap && streamMap[streamId]) delete streamMap[streamId];
  if (Object.keys(streamMap || {}).length === 0) delete teamMemberStreamsByTeam[teamId];
}

function applyTeamMemberStreamEvent(msg) {
  const teamId = String(msg?.teamId || '').trim();
  const streamId = String(msg?.streamId || '').trim();
  if (!teamId || !streamId) return null;
  const eventType = String(msg?.eventType || '').trim();
  const event = msg?.data && typeof msg.data === 'object' ? msg.data : {};
  const stream = ensureTeamMemberStream(teamId, streamId, {
    agentId: String(msg.agentId || '').trim(),
    agentName: String(msg.agentName || msg.agentId || 'Team Member').trim(),
    startedAt: Number(msg.startedAt || Date.now()),
  });
  if (!stream) return null;

  switch (eventType) {
    case 'token': {
      const chunk = String(event.text || '');
      if (chunk) stream.content = `${stream.content || ''}${chunk}`;
      break;
    }
    case 'thinking_delta': {
      const chunk = String(event.thinking || event.text || '');
      if (chunk) {
        stream.thinking = `${stream.thinking || ''}${chunk}`;
        pushTeamDispatchProgressLine(stream, 'Thinking...');
      }
      break;
    }
    case 'thinking':
    case 'agent_thought': {
      const thought = String(event.thinking || event.text || '').trim();
      if (!thought) break;
      stream.thinking = stream.thinking ? `${stream.thinking}\n\n${thought}` : thought;
      addTeamDispatchProcessEntry(stream, 'think', thought, event.actor ? { actor: event.actor } : undefined);
      break;
    }
    case 'info': {
      const info = String(event.message || '').trim();
      if (!info) break;
      pushTeamDispatchProgressLine(stream, info);
      addTeamDispatchProcessEntry(stream, 'info', info, event.actor ? { actor: event.actor } : undefined);
      break;
    }
    case 'progress_state': {
      const items = Array.isArray(event.items) ? event.items : [];
      const activeIndex = Number(event.activeIndex || -1);
      const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
      const activeText = String(activeItem?.text || '').trim();
      if (activeText) pushTeamDispatchProgressLine(stream, activeText);
      break;
    }
    case 'tool_call': {
      const action = String(event.action || '').trim();
      if (!action) break;
      const args = event.args && typeof event.args === 'object' ? event.args : null;
      const argsPreview = args ? JSON.stringify(args).slice(0, 240) : '';
      stream.stepCount = Number(stream.stepCount || 0) + 1;
      pushTeamDispatchProgressLine(stream, `Running ${action}...`);
      addTeamDispatchProcessEntry(
        stream,
        'tool',
        `${action}${argsPreview ? ` ${argsPreview}` : ''}`,
        (args || event.actor) ? { ...(args || {}), ...(event.actor ? { actor: event.actor } : {}) } : undefined,
      );
      break;
    }
    case 'tool_result': {
      const action = String(event.action || '').trim() || 'tool';
      const text = String(event.result || '').trim();
      const ok = event.error === true ? false : !/^ERROR:/i.test(text);
      pushTeamDispatchProgressLine(stream, `${action} ${ok ? 'complete' : 'failed'}`);
      addTeamDispatchProcessEntry(
        stream,
        ok ? 'result' : 'error',
        `${action} => ${text || '(no output)'}`,
        event.actor ? { actor: event.actor } : undefined,
      );
      break;
    }
    case 'tool_progress': {
      const action = String(event.action || '').trim();
      const progressMsg = String(event.message || '').trim();
      if (!action || !progressMsg) break;
      pushTeamDispatchProgressLine(stream, `${action}: ${progressMsg}`);
      addTeamDispatchProcessEntry(stream, 'info', `${action}: ${progressMsg}`, event.actor ? { actor: event.actor } : undefined);
      break;
    }
    case 'final': {
      const reply = String(event.reply || event.text || '').trim();
      if (!reply) break;
      stream.finalReply = reply;
      if (!stream.content) stream.content = reply;
      addTeamDispatchProcessEntry(stream, 'final', reply);
      break;
    }
    case 'done': {
      const reply = String(event.reply || event.text || '').trim();
      if (reply) {
        stream.finalReply = reply;
        if (!stream.content) stream.content = reply;
      }
      if (String(event.thinking || '').trim()) {
        stream.thinking = stream.thinking
          ? `${stream.thinking}\n\n${String(event.thinking).trim()}`
          : String(event.thinking).trim();
      }
      stream.completed = true;
      stream.finishedAt = Date.now();
      stream.durationMs = Math.max(Number(stream.durationMs || 0), stream.finishedAt - Number(stream.startedAt || Date.now()));
      break;
    }
    default:
      break;
  }

  stream.updatedAt = Date.now();
  return stream;
}

function mergeDispatchMetadataIntoMessages(teamId, messages) {
  const list = Array.isArray(messages) ? messages.map((message) => ({ ...message })) : [];
  const streamMap = getTeamDispatchStreamMap(teamId);
  return list.map((message) => {
    const taskId = String(message?.metadata?.taskId || '').trim();
    if (!taskId || !streamMap[taskId]) return message;
    const stream = streamMap[taskId];
    return {
      ...message,
      metadata: {
        ...(message.metadata || {}),
        taskId,
        stepCount: message.metadata?.stepCount ?? stream.stepCount,
        durationMs: message.metadata?.durationMs ?? stream.durationMs,
        thinking: message.metadata?.thinking || stream.thinking || undefined,
        processEntries: (Array.isArray(message.metadata?.processEntries) && message.metadata.processEntries.length > 0)
          ? message.metadata.processEntries
          : (Array.isArray(stream.processEntries) ? [...stream.processEntries] : undefined),
      },
    };
  });
}

function reconcileTeamDispatchStreamsWithMessages(teamId, messages) {
  const taskIds = new Set(
    (Array.isArray(messages) ? messages : [])
      .map((message) => String(message?.metadata?.taskId || '').trim())
      .filter(Boolean)
  );
  if (taskIds.size === 0) return;
  const streamMap = getTeamDispatchStreamMap(teamId);
  let removedAny = false;
  for (const taskId of Object.keys(streamMap)) {
    if (!taskIds.has(taskId)) continue;
    delete streamMap[taskId];
    delete teamDispatchExpanded[`${teamId}::${taskId}`];
    removedAny = true;
  }
  if (removedAny && Object.keys(streamMap).length === 0) {
    delete teamDispatchStreamsByTeam[teamId];
  }
  if (removedAny) refreshTeamDispatchTicker();
}

function renderTeamDispatchBubble(teamId, stream) {
  if (!stream) return '';
  const expandedKey = `${teamId}::${stream.taskId}`;
  const expanded = teamDispatchExpanded[expandedKey] === true;
  const previewText = String(stream.finalReply || stream.content || '').trim();
  const summaryLines = [
    stream.completed ? 'Finished.' : 'Working...',
    `Last tool: ${stream.lastTool ? escHtml(stream.lastTool) : '<span style="color:var(--muted)">waiting...</span>'}`,
    `${stream.completed ? 'Worked for' : 'Working for'} ${escHtml(formatTeamDispatchElapsed(stream))}`,
  ];
  const progressHtml = Array.isArray(stream.progressLines) && stream.progressLines.length
    ? `<div style="margin-top:8px;font-size:11px;line-height:1.5;color:var(--muted)">
        ${stream.progressLines.map((line) => `<div>&bull; ${escHtml(line)}</div>`).join('')}
      </div>`
    : '';
  const expandedHtml = expanded
    ? `
      ${previewText ? `<div style="margin-top:10px;font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(previewText)}</div>` : ''}
      ${progressHtml}
      <div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px;font-size:11px;line-height:1.6;color:var(--text)">
        ${formatTeamChatProcessLines(stream.processEntries || [])}
      </div>
    `
    : '';
  return `
    <div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start">
      <div style="font-size:10px;color:var(--muted)">${escHtml(String(stream.agentName || stream.agentId || 'Subagent'))} · ${escHtml(stream.completed ? 'finished' : 'working')}</div>
      <div onclick="toggleTeamDispatchBubble('${String(teamId)}','${String(stream.taskId)}')" style="max-width:88%;padding:10px 12px;border-radius:12px 12px 12px 4px;background:var(--panel-2);color:var(--text);border:1px solid var(--line);font-size:12px;line-height:1.55;overflow-wrap:anywhere;cursor:pointer">
        <div style="font-weight:700">${stream.completed ? 'Finished' : 'Working...'}</div>
        <div style="margin-top:6px;font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:3px">
          ${summaryLines.map((line) => `<div>${line}</div>`).join('')}
        </div>
        ${expandedHtml}
      </div>
    </div>
  `;
}

function formatTeamChatProcessLines(entries) {
  if (!entries || entries.length === 0) return '<div style="color:var(--muted)">No process details.</div>';
  const TYPE_COLORS = {
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

function renderTeamChatProcessPill(entries, prefix = 'team_proc') {
  if (!entries || entries.length === 0) return '';
  const id = `${prefix}_${Math.random().toString(36).slice(2)}`;
  return `
    <div style="margin-top:8px">
      <button class="process-pill-btn" onclick="toggleTeamChatProcess('${id}')">Process</button>
      <div id="${id}" style="display:none;margin-top:8px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);padding:8px;max-height:220px;overflow:auto;font-size:11px;line-height:1.6">
        ${formatTeamChatProcessLines(entries)}
      </div>
    </div>
  `;
}

function renderTeamChatBubbleFrame(options) {
  const align = options.align === 'right' ? 'flex-end' : 'flex-start';
  const innerAlign = options.align === 'right' ? 'flex-end' : 'flex-start';
  return `
    <div style="display:flex;justify-content:${align};width:100%">
      <div style="display:flex;flex-direction:column;gap:4px;align-items:${innerAlign};max-width:min(84%, 760px);min-width:min(180px, 100%)">
        ${options.actorLine || ''}
        ${options.targetLine || ''}
        <div style="display:block;max-width:100%;width:100%;padding:12px 14px;border-radius:${options.radius || '18px'};background:${options.bubbleBg || 'var(--panel-2)'};color:${options.bubbleColor || 'var(--text)'};border:${options.bubbleBorder || '1px solid var(--line)'};box-shadow:${options.shadow || 'none'};font-size:12px;line-height:1.58;white-space:normal;overflow-wrap:anywhere;word-break:break-word">
          ${options.bodyHtml || ''}
          ${options.metaLine || ''}
          ${options.processHtml || ''}
        </div>
      </div>
    </div>
  `;
}

function renderTeamChatMessageBubble(message) {
  const isUser = message.from === 'user';
  const label = String(message.fromName || (isUser ? 'You' : message.from === 'manager' ? 'Manager' : 'Subagent'));
  const timeLabel = timeAgo(message.timestamp);
  const content = String(message.content || '');
  const renderedContent = renderTeamChatTextWithMentions(content, activeTeamId, { markdown: !isUser });
  const processHtml = !isUser ? renderTeamChatProcessPill(message.metadata?.processEntries || [], 'team_msg_proc') : '';
  const runMetaBits = [];
  if (!isUser && Number(message?.metadata?.stepCount || 0) > 0) runMetaBits.push(`${Number(message.metadata.stepCount)} tools`);
  if (!isUser && Number(message?.metadata?.durationMs || 0) > 0) runMetaBits.push(`${Math.max(1, Math.round(Number(message.metadata.durationMs) / 1000))}s`);
  const runMetaHtml = runMetaBits.length > 0
    ? `<div style="margin-top:10px;font-size:10px;color:var(--muted)">${escHtml(runMetaBits.join(' · '))}</div>`
    : '';
  const targetLabel = String(message?.metadata?.targetLabel || '').trim();
  const targetLine = isUser && targetLabel
    ? `<div style="font-size:10px;color:#79c0ff;font-weight:700">to @${escHtml(buildTeamChatHandleLabel(targetLabel))}</div>`
    : '';
  return renderTeamChatBubbleFrame({
    align: isUser ? 'right' : 'left',
    actorLine: `<div style="font-size:10px;color:var(--muted);font-weight:600">${escHtml(label)} · ${timeLabel}</div>`,
    targetLine,
    bubbleBg: isUser ? 'linear-gradient(180deg, rgba(76,141,255,0.98) 0%, rgba(47,111,255,0.98) 100%)' : 'var(--panel-2)',
    bubbleColor: isUser ? '#f7fbff' : 'var(--text)',
    bubbleBorder: isUser ? '1px solid rgba(125,182,255,0.34)' : '1px solid var(--line)',
    radius: isUser ? '18px 18px 8px 18px' : '18px 18px 18px 8px',
    shadow: isUser ? '0 10px 24px rgba(46,111,255,0.18)' : '0 6px 18px rgba(0,0,0,0.10)',
    bodyHtml: `<div>${renderedContent}</div>`,
    metaLine: runMetaHtml,
    processHtml,
  });
}

function renderTeamManagerBackgroundStreamingBubble(stream) {
  if (!stream) return '';
  const progressHtml = Array.isArray(stream.progressLines) && stream.progressLines.length
    ? `<div style="margin:6px 0 8px 0;font-size:11px;line-height:1.6;color:var(--muted)">
        ${stream.progressLines.map((line) => `<div>&bull; ${escHtml(line)}</div>`).join('')}
      </div>`
    : '';
  const content = String(stream.content || stream.finalReply || '').trim();
  const processHtml = renderTeamChatProcessPill(stream.processEntries || [], `team_bg_mgr_proc_${String(stream.streamId || '').replace(/[^a-z0-9_-]/gi, '')}`);
  const metaBits = [];
  if (Number(stream?.stepCount || 0) > 0) metaBits.push(`${Number(stream.stepCount)} tools`);
  if (Number(stream?.durationMs || 0) > 0) metaBits.push(`${Math.max(1, Math.round(Number(stream.durationMs) / 1000))}s`);
  const metaHtml = metaBits.length > 0
    ? `<div style="margin-top:10px;font-size:10px;color:var(--muted)">${escHtml(metaBits.join(' · '))}</div>`
    : '';
  return renderTeamChatBubbleFrame({
    align: 'left',
    actorLine: `<div style="font-size:10px;color:var(--muted);font-weight:600">Manager · ${escHtml(stream.completed ? 'finalizing' : 'live')}</div>`,
    radius: '18px 18px 18px 8px',
    bubbleBg: 'var(--panel-2)',
    bubbleColor: 'var(--text)',
    bubbleBorder: '1px solid var(--line)',
    shadow: '0 6px 18px rgba(0,0,0,0.10)',
    bodyHtml: `
      ${progressHtml}
      ${content
        ? `<div style="font-size:12px;line-height:1.58">${renderTeamChatTextWithMentions(content, stream.teamId, { markdown: false })}</div>`
        : `<div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>`}
    `,
    metaLine: metaHtml,
    processHtml,
  });
}

function renderTeamMemberStreamingBubble(stream) {
  if (!stream) return '';
  const progressHtml = Array.isArray(stream.progressLines) && stream.progressLines.length
    ? `<div style="margin:6px 0 8px 0;font-size:11px;line-height:1.6;color:var(--muted)">
        ${stream.progressLines.map((line) => `<div>&bull; ${escHtml(line)}</div>`).join('')}
      </div>`
    : '';
  const content = String(stream.content || stream.finalReply || '').trim();
  const processHtml = renderTeamChatProcessPill(stream.processEntries || [], `team_member_proc_${String(stream.streamId || '').replace(/[^a-z0-9_-]/gi, '')}`);
  const metaBits = [];
  if (Number(stream?.stepCount || 0) > 0) metaBits.push(`${Number(stream.stepCount)} tools`);
  if (Number(stream?.durationMs || 0) > 0) metaBits.push(`${Math.max(1, Math.round(Number(stream.durationMs) / 1000))}s`);
  const metaHtml = metaBits.length > 0
    ? `<div style="margin-top:10px;font-size:10px;color:var(--muted)">${escHtml(metaBits.join(' · '))}</div>`
    : '';
  return renderTeamChatBubbleFrame({
    align: 'left',
    actorLine: `<div style="font-size:10px;color:var(--muted);font-weight:600">${escHtml(String(stream.agentName || stream.agentId || 'Team Member'))} · ${escHtml(stream.completed ? 'finalizing' : 'live')}</div>`,
    radius: '18px 18px 18px 8px',
    bubbleBg: 'var(--panel-2)',
    bubbleColor: 'var(--text)',
    bubbleBorder: '1px solid var(--line)',
    shadow: '0 6px 18px rgba(0,0,0,0.10)',
    bodyHtml: `
      ${progressHtml}
      ${content
        ? `<div style="font-size:12px;line-height:1.58">${renderTeamChatTextWithMentions(content, stream.teamId, { markdown: false })}</div>`
        : `<div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>`}
    `,
    metaLine: metaHtml,
    processHtml,
  });
}

function renderTeamChatStreamingBubble(team) {
  if (!teamChatStreamingState || teamChatStreamingState.teamId !== team.id) return '';
  const progressHtml = Array.isArray(teamChatStreamingState.progressLines) && teamChatStreamingState.progressLines.length
    ? `<div id="team-chat-streaming-progress-lines" style="margin:6px 0 8px 0;font-size:11px;line-height:1.6;color:var(--muted)">
        ${teamChatStreamingState.progressLines.map((line) => `<div>&bull; ${escHtml(line)}</div>`).join('')}
      </div>`
    : '';
  const content = String(teamChatStreamingState.content || teamChatStreamingState.finalReply || '').trim();
  const processHtml = renderTeamChatProcessPill(teamChatStreamingState.processEntries || [], 'team_stream_proc');
  return renderTeamChatBubbleFrame({
    align: 'left',
    actorLine: `<div style="font-size:10px;color:var(--muted);font-weight:600">Manager · live</div>`,
    radius: '18px 18px 18px 8px',
    bubbleBg: 'var(--panel-2)',
    bubbleColor: 'var(--text)',
    bubbleBorder: '1px solid var(--line)',
    shadow: '0 6px 18px rgba(0,0,0,0.10)',
    bodyHtml: `
      ${progressHtml}
      ${content
        ? `<div id="team-chat-streaming-text-content" style="font-size:12px;line-height:1.58">${renderTeamChatTextWithMentions(content, team.id, { markdown: false })}</div>`
        : `<div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>`}
    `,
    processHtml: `<div id="team-chat-streaming-process-wrapper">${processHtml}</div>`,
  });
}

function refreshTeamChatStreamingUI(teamId, force = false) {
  if (!teamChatStreamingState || teamChatStreamingState.teamId !== teamId || activeTeamId !== teamId || teamBoardTab !== 'chat') return;
  refreshTeamChatComposerState(teamId);
  if (force) {
    renderActiveTeamChat(teamId, { forceBottom: true });
  } else {
    const textEl = document.getElementById('team-chat-streaming-text-content');
    if (textEl) {
      textEl.textContent = String(teamChatStreamingState.content || teamChatStreamingState.finalReply || '');
    } else {
      renderActiveTeamChat(teamId, { forceBottom: true });
    }
    const progressEl = document.getElementById('team-chat-streaming-progress-lines');
    if (progressEl) {
      const lines = Array.isArray(teamChatStreamingState.progressLines) ? teamChatStreamingState.progressLines : [];
      progressEl.innerHTML = lines.map((line) => `<div>&bull; ${escHtml(line)}</div>`).join('');
    }
    const processEl = document.getElementById('team-chat-streaming-process-wrapper');
    if (processEl) {
      processEl.innerHTML = renderTeamChatProcessPill(teamChatStreamingState.processEntries || [], 'team_stream_proc');
    }
  }
  requestAnimationFrame(() => {
    const msgs = document.getElementById('team-chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });
}

function refreshTeamChatComposerState(teamId) {
  if (activeTeamId !== teamId || teamBoardTab !== 'chat') return;
  const busy = isTeamChatBusy(teamId);
  const queuedCount = getTeamChatQueue(teamId).length;
  const btn = document.getElementById('team-chat-send-button');
  if (btn) {
    btn.textContent = busy ? 'Stop' : 'Send';
    btn.onclick = () => busy ? abortTeamChat(teamId) : sendTeamChat(teamId);
    btn.style.background = busy ? '#e05c5c' : 'var(--brand)';
    btn.style.boxShadow = busy ? '0 10px 24px rgba(224,92,92,0.24)' : '0 10px 24px rgba(76,141,255,0.24)';
  }
  const badge = document.getElementById('team-chat-queue-badge');
  if (badge) {
    badge.style.display = queuedCount ? 'inline-flex' : 'none';
    badge.textContent = `${queuedCount} queued`;
  }
  const placeholder = document.getElementById('team-chat-input-placeholder');
  if (placeholder) {
    placeholder.textContent = busy
      ? 'Queue a room note, or type @team, @manager, or @someone...'
      : 'Post a room note, or type @team, @manager, or @someone...';
  }
}

function attachTeamStreamingMetadata(messages, streamingState) {
  const list = Array.isArray(messages) ? [...messages] : [];
  if (!streamingState) return list;
  const finalContent = String(streamingState.finalReply || streamingState.content || '').trim();
  let applied = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const msg = list[i];
    if (msg?.from !== 'manager') continue;
    if (finalContent && String(msg.content || '').trim() !== finalContent) continue;
    list[i] = {
      ...msg,
      metadata: {
        ...(msg.metadata || {}),
        processEntries: Array.isArray(streamingState.processEntries) ? [...streamingState.processEntries] : [],
        thinking: String(streamingState.thinking || '').trim() || undefined,
      },
    };
    applied = true;
    break;
  }
  if (!applied && finalContent) {
    list.push({
      id: `team_stream_${Date.now()}`,
      timestamp: Date.now(),
      from: 'manager',
      fromName: 'Manager',
      content: finalContent,
      metadata: {
        processEntries: Array.isArray(streamingState.processEntries) ? [...streamingState.processEntries] : [],
        thinking: String(streamingState.thinking || '').trim() || undefined,
        localStreamingFallback: true,
      },
    });
  }
  return list;
}

function refreshVisibleTeamChat(teamId, forceBottom = false) {
  if (activeTeamId === teamId && teamBoardTab === 'chat') {
    renderActiveTeamChat(teamId, { forceBottom });
  }
}

function toggleTeamDispatchBubble(teamId, taskId) {
  const key = `${teamId}::${taskId}`;
  teamDispatchExpanded[key] = !teamDispatchExpanded[key];
  refreshVisibleTeamChat(teamId, false);
}

function applyTeamDispatchStreamEvent(msg) {
  const teamId = String(msg?.teamId || '').trim();
  const taskId = String(msg?.taskId || '').trim();
  if (!teamId || !taskId) return null;
  const eventType = String(msg?.eventType || '').trim();
  const event = msg?.data && typeof msg.data === 'object' ? msg.data : {};
  const stream = ensureTeamDispatchStream(teamId, taskId, {
    agentId: msg.agentId || '',
    agentName: msg.agentName || msg.agentId || 'Subagent',
    taskSummary: msg.taskSummary || '',
    startedAt: Number(msg.startedAt || Date.now()),
  });
  if (!stream) return null;

  switch (eventType) {
    case 'token': {
      const chunk = String(event.text || '');
      if (chunk) stream.content = `${stream.content || ''}${chunk}`;
      break;
    }
    case 'thinking_delta': {
      const chunk = String(event.thinking || event.text || '');
      if (chunk) {
        stream.thinking = `${stream.thinking || ''}${chunk}`;
        pushTeamDispatchProgressLine(stream, 'Thinking...');
      }
      break;
    }
    case 'thinking':
    case 'agent_thought': {
      const thought = String(event.thinking || event.text || '').trim();
      if (!thought) break;
      stream.thinking = stream.thinking ? `${stream.thinking}\n\n${thought}` : thought;
      addTeamDispatchProcessEntry(stream, 'think', thought, event.actor ? { actor: event.actor } : undefined);
      break;
    }
    case 'info': {
      const info = String(event.message || '').trim();
      if (!info) break;
      pushTeamDispatchProgressLine(stream, info);
      addTeamDispatchProcessEntry(stream, 'info', info, event.actor ? { actor: event.actor } : undefined);
      break;
    }
    case 'heartbeat': {
      const heartbeatMsg = String(event.message || event.current_step || event.state || '').trim();
      if (heartbeatMsg) pushTeamDispatchProgressLine(stream, heartbeatMsg);
      break;
    }
    case 'progress_state': {
      const items = Array.isArray(event.items) ? event.items : [];
      const activeIndex = Number(event.activeIndex || -1);
      const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
      const activeText = String(activeItem?.text || '').trim();
      if (activeText) pushTeamDispatchProgressLine(stream, activeText);
      break;
    }
    case 'tool_call': {
      const action = String(event.action || '').trim();
      if (!action) break;
      const stepNum = Number(event.stepNum || 0);
      const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
      const args = event.args && typeof event.args === 'object' ? event.args : null;
      const argsPreview = args ? JSON.stringify(args).slice(0, 240) : '';
      stream.lastTool = action;
      stream.stepCount = Number(stream.stepCount || 0) + 1;
      pushTeamDispatchProgressLine(stream, `${stepPrefix}Running ${action}...`);
      addTeamDispatchProcessEntry(
        stream,
        'tool',
        `${stepPrefix}${action}${argsPreview ? ` ${argsPreview}` : ''}`,
        (args || event.actor) ? { ...(args || {}), ...(event.actor ? { actor: event.actor } : {}) } : undefined,
      );
      break;
    }
    case 'tool_result': {
      const action = String(event.action || '').trim() || 'tool';
      const stepNum = Number(event.stepNum || 0);
      const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
      const text = String(event.result || '').trim();
      const ok = event.error === true ? false : !/^ERROR:/i.test(text);
      pushTeamDispatchProgressLine(stream, `${stepPrefix}${action} ${ok ? 'complete' : 'failed'}`);
      addTeamDispatchProcessEntry(
        stream,
        ok ? 'result' : 'error',
        `${stepPrefix}${action} => ${text || '(no output)'}`,
        event.actor ? { actor: event.actor } : undefined,
      );
      break;
    }
    case 'tool_progress': {
      const action = String(event.action || '').trim();
      const progressMsg = String(event.message || '').trim();
      if (!action || !progressMsg) break;
      pushTeamDispatchProgressLine(stream, `${action}: ${progressMsg}`);
      addTeamDispatchProcessEntry(stream, 'info', `${action}: ${progressMsg}`, event.actor ? { actor: event.actor } : undefined);
      break;
    }
    case 'final': {
      const reply = String(event.reply || event.text || '').trim();
      if (!reply) break;
      stream.finalReply = reply;
      if (!stream.content) stream.content = reply;
      addTeamDispatchProcessEntry(stream, 'final', reply);
      break;
    }
    case 'done': {
      const reply = String(event.reply || event.text || '').trim();
      if (reply) {
        stream.finalReply = reply;
        if (!stream.content) stream.content = reply;
      }
      if (String(event.thinking || '').trim()) {
        stream.thinking = stream.thinking
          ? `${stream.thinking}\n\n${String(event.thinking).trim()}`
          : String(event.thinking).trim();
      }
      stream.completed = true;
      stream.status = 'finalizing';
      stream.finishedAt = Date.now();
      stream.durationMs = Math.max(Number(stream.durationMs || 0), stream.finishedAt - Number(stream.startedAt || Date.now()));
      break;
    }
    default:
      break;
  }

  stream.updatedAt = Date.now();
  return stream;
}

function renderActiveTeamChat(teamId, opts = {}) {
  if (teamBoardTab !== 'chat' || activeTeamId !== teamId) return;
  const { forceBottom = false } = opts;
  const contentEl = document.getElementById('team-tab-content');
  if (!contentEl) return;
  const team = teamsData.find((t) => t.id === teamId);
  if (!team) return;

  const msgElBefore = document.getElementById('team-chat-messages');
  const inputBefore = document.getElementById('team-chat-input');
  const prevScrollTop = msgElBefore ? msgElBefore.scrollTop : 0;
  const wasNearBottom = msgElBefore
    ? (msgElBefore.scrollHeight - (msgElBefore.scrollTop + msgElBefore.clientHeight)) < 28
    : true;

  // Fast path: chat is already mounted — patch only the messages list. This
  // keeps the composer's textarea, focus, draft, and event listeners intact
  // and avoids the scroll-jump that comes from replacing the whole tab.
  if (msgElBefore && inputBefore) {
    msgElBefore.innerHTML = _renderTeamChatMessagesInner(team);
    refreshTeamChatComposerState(teamId);
    requestAnimationFrame(() => {
      const el = document.getElementById('team-chat-messages');
      if (!el) return;
      if (forceBottom || wasNearBottom) {
        el.scrollTop = el.scrollHeight;
      } else {
        const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = Math.min(prevScrollTop, maxTop);
      }
    });
    return;
  }

  // First mount — full render (sets up the composer too).
  if (inputBefore) {
    teamChatDraftByTeam[teamId] = inputBefore.value || '';
  }
  contentEl.innerHTML = renderTeamChatTab(team);

  const inputAfter = document.getElementById('team-chat-input');
  if (inputAfter) {
    inputAfter.value = teamChatDraftByTeam[teamId] || '';
    inputAfter.addEventListener('input', () => {
      teamChatDraftByTeam[teamId] = inputAfter.value || '';
      resizeTeamChatInput();
      refreshTeamChatMentionState(teamId);
    });
    inputAfter.addEventListener('keydown', (event) => handleTeamChatInputKeydown(event, teamId));
    inputAfter.addEventListener('click', () => refreshTeamChatMentionState(teamId));
    inputAfter.addEventListener('keyup', () => refreshTeamChatMentionState(teamId));
    inputAfter.addEventListener('scroll', () => syncTeamChatInputMirror(teamId));
    resizeTeamChatInput();
    refreshTeamChatMentionState(teamId);
    refreshTeamChatComposerState(teamId);
  } else {
    hideTeamChatMentionPopover();
  }

  requestAnimationFrame(() => {
    const msgElAfter = document.getElementById('team-chat-messages');
    if (!msgElAfter) return;
    // On first mount always land at the bottom (newest messages).
    msgElAfter.scrollTop = msgElAfter.scrollHeight;
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
    teamRoomState = runsData.roomState || null;
    const nextLive = {};
    for (const run of teamRuns) {
      const taskId = String(run?.taskId || '').trim();
      if (!taskId) continue;
      if (_teamRunIsInProgress(run)) {
        nextLive[taskId] = { ...run };
      }
    }
    teamActiveRunsByTeam[teamId] = nextLive;
    teamChatMessages = mergeDispatchMetadataIntoMessages(teamId, chatData.messages || []);
    teamWorkspaceFiles = workspaceData.files || [];
    teamWorkspaceTree = workspaceData.tree || [];
    teamWorkspaceData = workspaceData || null;
    reconcileTeamDispatchStreamsWithMessages(teamId, teamChatMessages);
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
  const tabs = ['context','subagents','workspace','memory','runs','chat'];
  const tabLabels = { context:'Context', subagents:'Subagents', workspace:'Workspace', memory:'Memory', runs:'Runs', chat:'Team Chat' };
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
  teamChatPolling = null;
}

function switchTeamTab(tab, teamId) {
  teamBoardTab = tab;
  renderTeamBoard(teamId);
  if (tab === 'chat') {
    setTimeout(() => renderActiveTeamChat(teamId, { forceBottom: true }), 100);
  }
  if (tab === 'memory') {
    loadTeamMemoryFiles(teamId);
  }
  if (tab === 'workspace' && teamWorkspaceOpenFile && teamWorkspaceOpenFile.teamId === teamId) {
    // Re-mount the CodeMirror editor when returning to the workspace tab
    setTimeout(() => _mountWorkspaceCm(), 50);
  }
  if (tab === 'subagents') {
    // First open: pick the first agent if none selected
    const team = teamsData.find(t => t.id === teamId);
    if (team && !teamSubagentDetailId && (team.subagentIds || []).length > 0) {
      openTeamSubagentDetail(teamId, team.subagentIds[0]);
    }
  }
}

async function loadTeamMemoryFiles(teamId) {
  teamMemoryFiles = { memory: null, lastRun: null, pending: null, loading: true };
  // Re-render to show loading
  if (teamBoardTab === 'memory' && activeTeamId === teamId) {
    const el = document.getElementById('team-tab-content');
    if (el) el.innerHTML = renderTeamTabContent(teamsData.find(t => t.id === teamId) || {});
  }
  const fetchOne = async (name) => {
    try {
      const d = await api(`/api/teams/${teamId}/workspace/${encodeURIComponent(name)}`);
      try { return JSON.parse(d.content || ''); } catch { return { _raw: d.content }; }
    } catch { return null; }
  };
  const [memory, lastRun, pending] = await Promise.all([
    fetchOne('memory.json'),
    fetchOne('last_run.json'),
    fetchOne('pending.json'),
  ]);
  teamMemoryFiles = { memory, lastRun, pending, loading: false };
  if (teamBoardTab === 'memory' && activeTeamId === teamId) {
    const el = document.getElementById('team-tab-content');
    if (el) el.innerHTML = renderTeamTabContent(teamsData.find(t => t.id === teamId) || {});
  }
}

function renderTeamTabContent(team) {
  switch (teamBoardTab) {
    case 'context': return renderTeamContextTab(team);
    case 'subagents': return renderTeamSubagentsTab(team);
    case 'workspace': return renderTeamWorkspaceTab(team);
    case 'memory': return renderTeamMemoryTab(team);
    case 'runs': return renderTeamRunsTab(team);
    case 'chat': return renderTeamChatTab(team);
    default: return '';
  }
}

// --- Workspace file type label (color + 3-letter tag, no emojis) ----------
function _wsFileTag(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  const map = {
    json: ['JSN', '#0d4faf', '#eaf2ff'],
    md:   ['MD',  '#0f6e3a', '#eafaf0'],
    txt:  ['TXT', '#666',    '#f0f0f0'],
    log:  ['LOG', '#7a5a00', '#fff7e0'],
    csv:  ['CSV', '#0f6e3a', '#eafaf0'],
    html: ['HTM', '#b04a00', '#fff1e6'],
    htm:  ['HTM', '#b04a00', '#fff1e6'],
    js:   ['JS',  '#7a5a00', '#fff7e0'],
    ts:   ['TS',  '#0d4faf', '#eaf2ff'],
    jsx:  ['JSX', '#7a5a00', '#fff7e0'],
    tsx:  ['TSX', '#0d4faf', '#eaf2ff'],
    py:   ['PY',  '#0d4faf', '#eaf2ff'],
    sh:   ['SH',  '#444',    '#ececec'],
    png:  ['IMG', '#7a3aa8', '#f3eaff'],
    jpg:  ['IMG', '#7a3aa8', '#f3eaff'],
    jpeg: ['IMG', '#7a3aa8', '#f3eaff'],
    gif:  ['IMG', '#7a3aa8', '#f3eaff'],
    svg:  ['SVG', '#7a3aa8', '#f3eaff'],
    zip:  ['ZIP', '#666',    '#f0f0f0'],
    gz:   ['GZ',  '#666',    '#f0f0f0'],
    env:  ['ENV', '#b42323', '#fff0f0'],
  };
  const [label, fg, bg] = map[ext] || [(ext || 'FIL').slice(0,3).toUpperCase(), '#555', '#eee'];
  return `<span style="font-size:9px;font-weight:800;letter-spacing:0.04em;color:${fg};background:${bg};border-radius:3px;padding:1px 5px;font-family:'IBM Plex Mono',monospace;flex-shrink:0">${label}</span>`;
}

function _teamRoomState() {
  return teamRoomState || {};
}

function _teamAgentName(agentId) {
  const ag = _findAgentInTeam(agentId);
  return ag?.name || agentId || 'agent';
}

function _teamStatePill(label, value, color = 'var(--muted)') {
  return `<span style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:2px 7px;font-size:10px;font-weight:700;color:${color};white-space:nowrap">${escHtml(label)}${value ? `: ${escHtml(value)}` : ''}</span>`;
}

function _renderTeamMemberStatesCompact(roomState) {
  const states = Object.values(roomState?.memberStates || {});
  if (states.length === 0) {
    return `<div style="font-size:11px;color:var(--muted);padding:10px;border:1px dashed var(--line);border-radius:8px;background:var(--panel-2)">No member state updates yet.</div>`;
  }
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
    ${states.map(st => {
      const status = String(st.status || 'idle');
      const color = status === 'blocked' ? '#b42323' : status === 'running' ? '#0d4faf' : status === 'ready' || status === 'done' ? '#0f6e3a' : 'var(--muted)';
      return `<div style="border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:9px;display:flex;flex-direction:column;gap:5px;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
          <div style="font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(_teamAgentName(st.agentId))}</div>
          ${_teamStatePill(status, '', color)}
        </div>
        ${st.currentTask ? `<div style="font-size:11px;color:var(--text);line-height:1.35;overflow-wrap:anywhere">${escHtml(st.currentTask)}</div>` : ''}
        ${st.blockedReason ? `<div style="font-size:11px;color:#b42323;line-height:1.35;overflow-wrap:anywhere">${escHtml(st.blockedReason)}</div>` : ''}
        ${st.lastUpdateAt ? `<div style="font-size:10px;color:var(--muted)">${timeAgo(st.lastUpdateAt)}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function _renderTeamActiveDispatches(roomState) {
  const dispatches = roomState?.activeDispatches || [];
  if (dispatches.length === 0) {
    return `<div style="font-size:11px;color:var(--muted);padding:10px;border:1px dashed var(--line);border-radius:8px;background:var(--panel-2)">No active dispatches.</div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:6px">
    ${dispatches.map(d => `<div style="border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:8px 10px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
        <span style="font-size:12px;font-weight:800">${escHtml(d.agentName || _teamAgentName(d.agentId))}</span>
        ${_teamStatePill(String(d.status || 'queued'), '')}
      </div>
      <div style="font-size:11px;color:var(--text);line-height:1.4;overflow-wrap:anywhere">${escHtml(d.taskSummary || '')}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:4px">${d.startedAt ? `started ${timeAgo(d.startedAt)}` : d.createdAt ? `queued ${timeAgo(d.createdAt)}` : ''}</div>
    </div>`).join('')}
  </div>`;
}

function _renderTeamPlanOwnership(plan) {
  const items = Array.isArray(plan) ? plan : [];
  if (items.length === 0) {
    return `<div style="font-size:11px;color:var(--muted);padding:10px;border:1px dashed var(--line);border-radius:8px;background:var(--panel-2)">No plan ownership yet.</div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:6px">
    ${items.slice(-20).map(item => `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:8px 10px">
      <div style="min-width:0">
        <div style="font-size:12px;font-weight:700;line-height:1.35;overflow-wrap:anywhere">${escHtml(item.description || '')}</div>
        ${item.reason ? `<div style="font-size:10px;color:var(--muted);line-height:1.35;margin-top:3px;overflow-wrap:anywhere">${escHtml(item.reason)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        ${_teamStatePill(String(item.status || 'pending'), '')}
        ${item.ownerAgentId ? _teamStatePill('owner', _teamAgentName(item.ownerAgentId), '#0d4faf') : _teamStatePill('owner', 'unassigned')}
      </div>
    </div>`).join('')}
  </div>`;
}

function _renderTeamEventsList(events, emptyLabel) {
  const list = Array.isArray(events) ? events : [];
  if (list.length === 0) {
    return `<div style="font-size:11px;color:var(--muted);padding:10px;border:1px dashed var(--line);border-radius:8px;background:var(--panel-2)">${escHtml(emptyLabel || 'No events yet.')}</div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:6px">
    ${list.slice().reverse().slice(0, 12).map(ev => `<div style="border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:8px 10px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
        <span style="font-size:11px;font-weight:800">${escHtml(ev.actorName || ev.actorId || 'system')}</span>
        ${ev.metadata?.source ? _teamStatePill(String(ev.metadata.source), '') : ''}
        ${ev.timestamp ? `<span style="font-size:10px;color:var(--muted)">${timeAgo(ev.timestamp)}</span>` : ''}
      </div>
      <div style="font-size:11px;line-height:1.4;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(ev.content || '')}</div>
    </div>`).join('')}
  </div>`;
}

function _renderTeamArtifactsList(artifacts) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  if (list.length === 0) {
    return `<div style="font-size:11px;color:var(--muted);padding:10px;border:1px dashed var(--line);border-radius:8px;background:var(--panel-2)">No shared artifacts yet.</div>`;
  }
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
    ${list.slice().reverse().slice(0, 12).map(a => `<div style="border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:9px;display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;align-items:center;gap:6px">
        ${_teamStatePill(String(a.type || 'artifact'), '')}
        <span style="font-size:10px;color:var(--muted)">${a.createdAt ? timeAgo(a.createdAt) : ''}</span>
      </div>
      <div style="font-size:12px;font-weight:800;overflow-wrap:anywhere">${escHtml(a.name || 'Untitled')}</div>
      ${a.description ? `<div style="font-size:11px;color:var(--muted);line-height:1.35;overflow-wrap:anywhere">${escHtml(a.description)}</div>` : ''}
      ${a.path ? `<div style="font-size:10px;color:var(--muted);font-family:'IBM Plex Mono',monospace;overflow-wrap:anywhere">${escHtml(a.path)}</div>` : ''}
    </div>`).join('')}
  </div>`;
}

function _renderTeamBlockersList(blockers) {
  const list = Array.isArray(blockers) ? blockers : [];
  if (list.length === 0) {
    return `<div style="font-size:11px;color:var(--muted);padding:10px;border:1px dashed var(--line);border-radius:8px;background:var(--panel-2)">No open blockers.</div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:6px">
    ${list.slice().reverse().slice(0, 12).map(b => `<div style="border:1px solid #f2c5c5;background:#fff5f5;border-radius:8px;padding:8px 10px">
      <div style="font-size:11px;font-weight:800;color:#b42323;margin-bottom:3px">${escHtml(b.fromAgentId ? _teamAgentName(b.fromAgentId) : 'Team')}</div>
      <div style="font-size:11px;line-height:1.4;color:#7a1d1d;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(b.content || '')}</div>
      ${b.createdAt ? `<div style="font-size:10px;color:#9d4b4b;margin-top:4px">${timeAgo(b.createdAt)}</div>` : ''}
    </div>`).join('')}
  </div>`;
}

function _wsFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes > 1024*1024) return (bytes/1024/1024).toFixed(1)+'MB';
  if (bytes > 1024) return (bytes/1024).toFixed(1)+'KB';
  return bytes+'B';
}

// Render a workspace tree entry (file or folder) at a given indent depth.
// Clean directory tree, no emojis. Folders are flat rows; files are indented
// under their parent with a left guide line.
function renderWorkspaceTree(entries, depth) {
  if (!entries || entries.length === 0) return '';
  const indent = depth * 14;
  return entries.map(entry => {
    if (entry.isDirectory) {
      const relPath = entry.relativePath || entry.name;
      const isOpen = workspaceFolderExpanded.has(relPath);
      const chevron = isOpen ? '▾' : '▸'; // ▾ ▸
      const count = (entry.children || []).length;
      const childrenHtml = isOpen ? renderWorkspaceTree(entry.children || [], depth + 1) : '';
      return `
        <div>
          <div onclick="toggleWorkspaceFolder('${escHtml(relPath)}')" style="display:flex;align-items:center;gap:7px;padding:5px 8px;padding-left:${indent + 8}px;border-radius:5px;cursor:pointer;user-select:none" onmouseover="this.style.background='var(--panel-2)'" onmouseout="this.style.background='transparent'">
            <span style="color:var(--muted);font-size:10px;width:10px;flex-shrink:0;text-align:center">${chevron}</span>
            <span style="font-size:13px;font-weight:700;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(entry.name)}</span>
            <span style="font-size:10px;color:var(--muted);font-variant-numeric:tabular-nums">${count}</span>
          </div>
          ${isOpen ? `<div style="margin-left:${indent + 13}px;border-left:1px solid var(--line);padding-left:0">${childrenHtml}</div>` : ''}
        </div>`;
    }
    // File row — compact single line with tag, name, size, time. Click to open in viewer.
    const tag = _wsFileTag(entry.name);
    const size = _wsFileSize(entry.size);
    const agentTag = entry.writtenBy ? `<span style="font-size:10px;background:#eaf2ff;color:#0d4faf;border-radius:3px;padding:0 5px;font-weight:600">w: ${escHtml(entry.writtenBy)}</span>` : '';
    const readTags = (entry.readBy || []).slice(0,3).map(id => `<span style="font-size:10px;background:#f0fdf4;color:#166534;border-radius:3px;padding:0 5px">r: ${escHtml(id)}</span>`).join('');
    const rel = (entry.relativePath || entry.name).replace(/'/g, "\\'");
    const isOpen = teamWorkspaceOpenFile && teamWorkspaceOpenFile.relpath === (entry.relativePath || entry.name);
    return `
      <div onclick="openTeamWorkspaceFile('${rel}')" style="display:flex;align-items:center;gap:8px;padding:4px 8px;padding-left:${indent + 8}px;border-radius:5px;font-size:12px;cursor:pointer;${isOpen?'background:var(--panel-2);outline:1px solid var(--brand)':''}" onmouseover="if(!this.dataset.open)this.style.background='var(--panel-2)'" onmouseout="if(!this.dataset.open)this.style.background='${isOpen?'var(--panel-2)':'transparent'}'" data-open="${isOpen?'1':''}" title="${escHtml(entry.relativePath || entry.name)}">
        ${tag}
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)">${escHtml(entry.name)}</span>
        ${agentTag}
        ${readTags}
        ${size ? `<span style="font-size:10px;color:var(--muted);font-variant-numeric:tabular-nums;min-width:48px;text-align:right">${size}</span>` : ''}
        ${entry.modifiedAt ? `<span style="font-size:10px;color:var(--muted);min-width:64px;text-align:right">${timeAgo(entry.modifiedAt)}</span>` : ''}
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
  const treeBody = tree.length === 0
    ? `<div style="text-align:center;color:var(--muted);font-size:12px;padding:24px 12px">
        <div style="font-weight:700;margin-bottom:6px">No workspace files yet</div>
        <div style="line-height:1.6">Agents write shared files here during runs.</div>
      </div>`
    : `<div id="team-workspace-files-${team.id}" style="display:flex;flex-direction:column;gap:0">${renderWorkspaceTree(tree, 0)}</div>`;

  return `
    <div style="display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;height:calc(100vh - 220px)">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:800">Shared Workspace</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;font-family:'IBM Plex Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(teamWorkspaceData?.workspacePath || '')}">${escHtml(teamWorkspaceData?.workspacePath || `teams/${team.id}/workspace`)}</div>
        </div>
        <button onclick="refreshTeamWorkspace('${team.id}');switchTeamTab('workspace','${team.id}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:7px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer">Refresh</button>
      </div>
      <div style="display:flex;gap:10px;flex:1;min-height:0">
        <div style="width:340px;flex-shrink:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px;overflow:auto">${treeBody}</div>
        <div id="team-workspace-viewer" style="flex:1;min-width:0;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden">${renderTeamWorkspaceViewer(team)}</div>
      </div>
    </div>`;
}

function _wsModeFromName(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (['js','jsx','ts','tsx','mjs','cjs'].includes(ext)) return 'javascript';
  if (ext === 'json') return { name: 'javascript', json: true };
  if (['md','markdown'].includes(ext)) return 'markdown';
  if (['html','htm'].includes(ext)) return 'htmlmixed';
  if (ext === 'css') return 'css';
  if (ext === 'xml') return 'xml';
  if (ext === 'py') return 'python';
  return null; // plain text
}

function renderTeamWorkspaceViewer(team) {
  const open = teamWorkspaceOpenFile;
  if (!open || open.teamId !== team.id) {
    return `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;padding:24px;text-align:center">
      <div>
        <div style="font-weight:700;margin-bottom:6px">No file open</div>
        <div style="font-size:12px">Click any file in the tree to view or edit it here.</div>
      </div>
    </div>`;
  }
  if (open.loading) {
    return `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px">Loading ${escHtml(open.name)}…</div>`;
  }
  if (open.error) {
    return `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#b42323;font-size:12px;padding:16px;text-align:center">${escHtml(open.error)}</div>`;
  }
  return `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);background:var(--panel-2);flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(open.relpath)}">${escHtml(open.relpath)}${open.dirty ? ' <span style="color:#b06b00;font-weight:800">●</span>' : ''}</div>
        <div style="font-size:10px;color:var(--muted);font-family:'IBM Plex Mono',monospace">${(open.content || '').length} chars${open.modifiedAt ? ' · modified ' + timeAgo(open.modifiedAt) : ''}</div>
      </div>
      <button onclick="reloadTeamWorkspaceFile('${team.id}')" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer">Reload</button>
      <button onclick="saveTeamWorkspaceFile('${team.id}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;cursor:pointer">Save</button>
      <button onclick="closeTeamWorkspaceFile()" style="border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer">Close</button>
    </div>
    <div id="team-workspace-cm" style="flex:1;min-height:0;overflow:hidden"></div>
    <div id="team-workspace-viewer-status" style="font-size:11px;color:var(--muted);padding:4px 10px;border-top:1px solid var(--line);min-height:18px;flex-shrink:0"></div>`;
}

async function openTeamWorkspaceFile(relpath) {
  if (!activeTeamId) return;
  const teamId = activeTeamId;
  const name = String(relpath).split('/').pop() || relpath;
  teamWorkspaceOpenFile = { teamId, relpath, name, content: '', loading: true, dirty: false };
  _renderWorkspaceViewerOnly();
  try {
    const d = await api(`/api/teams/${teamId}/workspace/${encodeURIComponent(name)}?relpath=${encodeURIComponent(relpath)}`);
    teamWorkspaceOpenFile = {
      teamId, relpath, name,
      content: d.content || '',
      modifiedAt: d.modifiedAt,
      loading: false,
      dirty: false,
      mode: _wsModeFromName(name),
    };
  } catch (err) {
    teamWorkspaceOpenFile = { teamId, relpath, name, loading: false, error: err?.message || String(err) };
  }
  _renderWorkspaceViewerOnly();
  _mountWorkspaceCm();
  // Re-render the tree row highlight
  if (teamBoardTab === 'workspace') {
    const treePane = document.querySelector('#team-tab-content [id^="team-workspace-files-"]');
    if (treePane) treePane.innerHTML = renderWorkspaceTree(teamWorkspaceTree || [], 0);
  }
}

function _renderWorkspaceViewerOnly() {
  const team = teamsData.find((t) => t.id === activeTeamId);
  const viewer = document.getElementById('team-workspace-viewer');
  if (!team || !viewer) return;
  viewer.innerHTML = renderTeamWorkspaceViewer(team);
}

function _mountWorkspaceCm() {
  const open = teamWorkspaceOpenFile;
  if (!open || open.loading || open.error) return;
  const host = document.getElementById('team-workspace-cm');
  if (!host || typeof CodeMirror === 'undefined') return;
  host.innerHTML = '';
  _teamWorkspaceCm = CodeMirror(host, {
    value: open.content || '',
    mode: open.mode || null,
    theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'material-darker' : 'default',
    lineNumbers: true,
    lineWrapping: true,
    viewportMargin: Infinity,
  });
  _teamWorkspaceCm.on('change', () => {
    if (!teamWorkspaceOpenFile) return;
    const next = _teamWorkspaceCm.getValue();
    const wasDirty = teamWorkspaceOpenFile.dirty;
    teamWorkspaceOpenFile.content = next;
    teamWorkspaceOpenFile.dirty = true;
    if (!wasDirty) _refreshWorkspaceViewerHeader();
  });
  setTimeout(() => _teamWorkspaceCm && _teamWorkspaceCm.refresh(), 50);
}

function _refreshWorkspaceViewerHeader() {
  // Cheap header-only refresh — just re-render the viewer header line
  // (without remounting the editor).
  const open = teamWorkspaceOpenFile;
  if (!open) return;
  const viewer = document.getElementById('team-workspace-viewer');
  if (!viewer) return;
  const headerTitle = viewer.querySelector('div > div > div:first-child');
  if (headerTitle) {
    headerTitle.innerHTML = `${escHtml(open.relpath)}${open.dirty ? ' <span style="color:#b06b00;font-weight:800">●</span>' : ''}`;
  }
}

async function reloadTeamWorkspaceFile(teamId) {
  if (!teamWorkspaceOpenFile) return;
  const { relpath, name } = teamWorkspaceOpenFile;
  try {
    const d = await api(`/api/teams/${teamId}/workspace/${encodeURIComponent(name)}?relpath=${encodeURIComponent(relpath)}`);
    teamWorkspaceOpenFile.content = d.content || '';
    teamWorkspaceOpenFile.modifiedAt = d.modifiedAt;
    teamWorkspaceOpenFile.dirty = false;
    if (_teamWorkspaceCm) _teamWorkspaceCm.setValue(d.content || '');
    _refreshWorkspaceViewerHeader();
    const status = document.getElementById('team-workspace-viewer-status');
    if (status) status.textContent = 'Reloaded.';
  } catch (err) {
    const status = document.getElementById('team-workspace-viewer-status');
    if (status) status.textContent = `Error: ${err?.message || err}`;
  }
}

async function saveTeamWorkspaceFile(teamId) {
  if (!teamWorkspaceOpenFile) return;
  const { relpath, name } = teamWorkspaceOpenFile;
  const content = _teamWorkspaceCm ? _teamWorkspaceCm.getValue() : (teamWorkspaceOpenFile.content || '');
  const status = document.getElementById('team-workspace-viewer-status');
  if (status) status.textContent = 'Saving…';
  try {
    await api(`/api/teams/${teamId}/workspace/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, relpath }),
    });
    teamWorkspaceOpenFile.content = content;
    teamWorkspaceOpenFile.dirty = false;
    teamWorkspaceOpenFile.modifiedAt = Date.now();
    _refreshWorkspaceViewerHeader();
    if (status) status.textContent = 'Saved.';
    bgtToast('Saved', `${relpath} updated`);
    // Refresh workspace cache so the tree reflects new size/mtime
    refreshTeamWorkspace(teamId);
  } catch (err) {
    if (status) status.textContent = `Error: ${err?.message || err}`;
  }
}

function closeTeamWorkspaceFile() {
  teamWorkspaceOpenFile = null;
  _teamWorkspaceCm = null;
  _renderWorkspaceViewerOnly();
  if (teamBoardTab === 'workspace' && activeTeamId) {
    const treePane = document.querySelector('#team-tab-content [id^="team-workspace-files-"]');
    if (treePane) treePane.innerHTML = renderWorkspaceTree(teamWorkspaceTree || [], 0);
  }
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
  const roomState = _teamRoomState();

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
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Member States</div>
        ${_renderTeamMemberStatesCompact(roomState)}
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Active Dispatches</div>
        ${_renderTeamActiveDispatches(roomState)}
      </div>
    </div>
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)">Context &amp; Reference</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Each save adds a new card. Cards are injected into manager + subagent runtime context.</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;margin-left:12px">
          <label style="cursor:pointer;border:1px solid var(--line);background:var(--panel-2);border-radius:7px;padding:5px 10px;font-size:11px;font-weight:600;color:var(--muted)">
            📎 Upload File
            <input type="file" style="display:none" onchange="uploadTeamContextFile('${team.id}',this)" />
          </label>
          <button id="ctx-save-btn-${team.id}" onclick="saveTeamContextNotes('${team.id}')" style="border:1px solid var(--brand);background:transparent;color:var(--brand);border-radius:7px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer">Save</button>
        </div>
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

function _memoryFileSection(title, subtitle, value) {
  if (value === null || value === undefined) {
    return `
      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px">
        <div style="font-size:12px;font-weight:800;margin-bottom:2px">${escHtml(title)}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${escHtml(subtitle)}</div>
        <div style="font-size:11px;color:var(--muted);font-style:italic">File not found yet — created on first run.</div>
      </div>`;
  }
  let body = '';
  if (value && value._raw) {
    body = `<pre style="margin:0;font-size:11px;font-family:'IBM Plex Mono',monospace;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px;max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(value._raw)}</pre>`;
  } else {
    const json = JSON.stringify(value, null, 2);
    body = `<pre style="margin:0;font-size:11px;font-family:'IBM Plex Mono',monospace;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px;max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(json)}</pre>`;
  }
  return `
    <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px">
      <div style="font-size:12px;font-weight:800;margin-bottom:2px">${escHtml(title)}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${escHtml(subtitle)}</div>
      ${body}
    </div>`;
}

function _renderMemoryEvents(memory) {
  if (!memory || memory._raw) return '';
  const events = Array.isArray(memory.events) ? memory.events.slice(-20).reverse() : [];
  const decisions = Array.isArray(memory.decisions) ? memory.decisions.slice(-10).reverse() : [];
  const summaries = Array.isArray(memory.runSummaries) ? memory.runSummaries.slice(-5).reverse() : [];
  if (events.length === 0 && decisions.length === 0 && summaries.length === 0) return '';
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Recent Events (${events.length})</div>
        <div style="display:flex;flex-direction:column;gap:5px;max-height:280px;overflow-y:auto">
          ${events.length === 0 ? '<div style="font-size:11px;color:var(--muted);font-style:italic">None.</div>' : events.map(e => `
            <div style="background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:7px 9px">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                <span style="font-size:10px;background:${e.authorType==='manager'?'#eaf2ff':e.authorType==='subagent'?'#f0fff0':'#fff8e6'};color:${e.authorType==='manager'?'#0d4faf':e.authorType==='subagent'?'#0f6e3a':'#7a5a00'};border-radius:3px;padding:0 5px;font-weight:700">${escHtml(e.authorType||'?')}</span>
                <span style="font-size:10px;color:var(--muted);font-weight:600">${escHtml(e.authorId||'')}</span>
                ${e.tag ? `<span style="font-size:10px;color:var(--muted)">· ${escHtml(e.tag)}</span>` : ''}
                <span style="margin-left:auto;font-size:10px;color:var(--muted)">${e.timestamp ? new Date(e.timestamp).toLocaleString() : ''}</span>
              </div>
              <div style="font-size:11px;line-height:1.5;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(String(e.content||''))}</div>
            </div>`).join('')}
        </div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Decisions / Summaries</div>
        <div style="display:flex;flex-direction:column;gap:5px;max-height:280px;overflow-y:auto">
          ${decisions.length === 0 && summaries.length === 0 ? '<div style="font-size:11px;color:var(--muted);font-style:italic">None.</div>' : ''}
          ${summaries.map(s => `
            <div style="background:var(--panel);border:1px solid var(--line);border-left:3px solid #0d4faf;border-radius:6px;padding:7px 9px">
              <div style="font-size:10px;font-weight:700;color:#0d4faf;margin-bottom:2px">RUN SUMMARY</div>
              <div style="font-size:11px;line-height:1.5;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(typeof s === 'string' ? s : JSON.stringify(s))}</div>
            </div>`).join('')}
          ${decisions.map(d => `
            <div style="background:var(--panel);border:1px solid var(--line);border-left:3px solid #0f6e3a;border-radius:6px;padding:7px 9px">
              <div style="font-size:10px;font-weight:700;color:#0f6e3a;margin-bottom:2px">DECISION</div>
              <div style="font-size:11px;line-height:1.5;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere">${escHtml(typeof d === 'string' ? d : JSON.stringify(d))}</div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

function renderTeamMemoryTab(team) {
  const teamId = team.id;
  const { memory, lastRun, pending, loading } = teamMemoryFiles;
  const wsPath = teamWorkspaceData?.workspacePath || `teams/${teamId}/workspace`;
  const pendingChanges = team.pendingChanges || [];
  const roomState = _teamRoomState();
  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:800">Team Memory</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;font-family:'IBM Plex Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(wsPath)}">${escHtml(wsPath)}</div>
        </div>
        <button onclick="loadTeamMemoryFiles('${teamId}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:7px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer">${loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      ${_renderMemoryEvents(memory)}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Artifacts</div>
          ${_renderTeamArtifactsList(roomState.artifacts || [])}
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Blockers</div>
          ${_renderTeamBlockersList(roomState.blockers || [])}
        </div>
      </div>

      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Plan Ownership</div>
        ${_renderTeamPlanOwnership(roomState.plan || [])}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Manager Auto-Wake Events</div>
          ${_renderTeamEventsList(roomState.managerAutoWakeEvents || [], 'No manager auto-wakes yet.')}
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Why Agents Woke Up</div>
          ${_renderTeamEventsList(roomState.memberWakeEvents || [], 'No member wake reasons yet.')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${_memoryFileSection('memory.json', 'Cross-run accumulated knowledge', memory)}
        ${_memoryFileSection('last_run.json', 'Most recent manager run summary', lastRun)}
      </div>
      ${_memoryFileSection('pending.json', 'Unresolved blockers, follow-ups, questions', pending)}

      ${pendingChanges.length > 0 ? `
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#e05c5c;margin-bottom:8px">Pending Changes (${pendingChanges.length})</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${pendingChanges.map(c => `
              <div style="background:var(--panel-2);border:1px solid var(--line);border-left:3px solid ${c.riskLevel==='high'?'#e05c5c':c.riskLevel==='medium'?'#d6a64f':'#31b884'};border-radius:8px;padding:10px 12px">
                <div style="font-size:12px;font-weight:700;margin-bottom:4px">${escHtml(c.description||'')}</div>
                <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Risk: ${escHtml(c.riskLevel||'low')} · ${c.targetSubagentId ? 'Target: ' + escHtml(c.targetSubagentId) : 'Team-wide'}</div>
                <div style="display:flex;gap:6px">
                  <button onclick="applyTeamChangeFn('${teamId}','${escHtml(c.id)}')" style="background:#31b884;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">Apply</button>
                  <button onclick="rejectTeamChangeFn('${teamId}','${escHtml(c.id)}')" style="background:var(--panel);border:1px solid var(--line);color:var(--muted);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer">Reject</button>
                </div>
              </div>`).join('')}
          </div>
        </div>` : ''}

      ${(team.managerNotes||[]).length > 0 ? `
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px">Manager Notes</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${(team.managerNotes||[]).slice().reverse().slice(0,30).map(n => `
              <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                  <span style="font-size:10px;background:${n.type==='decision'?'#eaf2ff':n.type==='analysis'?'#f0fff0':'#fff8e6'};color:${n.type==='decision'?'#0d4faf':n.type==='analysis'?'#0f6e3a':'#7a5a00'};border-radius:4px;padding:2px 6px;font-weight:700">${escHtml(n.type||'note')}</span>
                  <span style="font-size:10px;color:var(--muted)">${timeAgo(n.timestamp)}</span>
                </div>
                <div style="font-size:12px;line-height:1.5;color:var(--text);white-space:pre-wrap">${escHtml(n.content||'')}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}
    </div>`;
}

// ─── Team Subagents Tab ──────────────────────────────────────────────────────

function _findAgentInTeam(agentId) {
  return (window._allAgentsForTeam || []).find(a => a.id === agentId) || { id: agentId, name: agentId };
}

// Refresh team agent cache + re-render detail panel after a model picker save.
registerAgentModelPickerOnSaved('ts-model', async (agentId) => {
  try {
    const data = await api('/api/agents');
    if (data?.agents) window._allAgentsForTeam = data.agents;
  } catch {}
  if (teamSubagentDetailTab === 'overview' && teamSubagentDetailId === agentId) {
    const team = teamsData.find(t => t.id === activeTeamId);
    const body = document.getElementById('team-subagent-detail-body');
    if (body && team) body.innerHTML = renderTeamSubagentDetailBody(team, agentId);
    agentModelPickerHydrate('ts-model', _findAgentInTeam(agentId));
  }
});

function renderTeamSubagentsTab(team) {
  const agentIds = team.subagentIds || [];
  if (agentIds.length === 0) {
    return `<div style="text-align:center;color:var(--muted);font-size:13px;padding:32px 16px">
      <div style="font-weight:700;margin-bottom:6px">No subagents on this team</div>
      <div style="font-size:12px;line-height:1.6">Add agents from the Context tab.</div>
    </div>`;
  }
  const activeId = teamSubagentDetailId && agentIds.includes(teamSubagentDetailId) ? teamSubagentDetailId : agentIds[0];
  const list = agentIds.map(id => {
    const ag = _findAgentInTeam(id);
    const isActive = id === activeId;
    const sched = ag.cronSchedule || '';
    return `<button onclick="openTeamSubagentDetail('${team.id}','${escHtml(id)}')" style="text-align:left;border:1px solid ${isActive?'var(--brand)':'var(--line)'};background:${isActive?'var(--panel)':'var(--panel-2)'};border-radius:8px;padding:8px 10px;cursor:pointer;display:flex;flex-direction:column;gap:2px;width:100%">
      <div style="font-size:12px;font-weight:700;color:${isActive?'var(--brand)':'var(--text)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(ag.name || id)}</div>
      <div style="font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:'IBM Plex Mono',monospace">${escHtml(id)}</div>
      ${sched ? `<div style="font-size:10px;color:#0d4faf;margin-top:2px">${escHtml(sched)}</div>` : ''}
    </button>`;
  }).join('');

  return `
    <div style="display:flex;gap:12px;flex:1;min-height:0;height:calc(100vh - 220px)">
      <div style="width:220px;flex-shrink:0;display:flex;flex-direction:column;gap:6px;overflow-y:auto">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);padding:0 2px 4px">Subagents (${agentIds.length})</div>
        ${list}
      </div>
      <div id="team-subagent-detail-panel" style="flex:1;min-width:0;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:10px;background:var(--panel);overflow:hidden">
        ${renderTeamSubagentDetail(team, activeId)}
      </div>
    </div>`;
}

function renderTeamSubagentDetail(team, agentId) {
  if (!agentId) return '<div style="padding:24px;color:var(--muted);font-size:13px;text-align:center">Select a subagent to view details.</div>';
  const ag = _findAgentInTeam(agentId);
  const tabs = ['overview','systemprompt','heartbeat'];
  const labels = { overview:'Overview', systemprompt:'System Prompt', heartbeat:'Heartbeat' };
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line);flex-shrink:0">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(ag.name || agentId)}</div>
        ${ag.description ? `<div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(ag.description)}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button onclick="runSubagentNow('${escHtml(agentId)}',this,'${team.id}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--brand);border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer">Run Now</button>
      </div>
    </div>
    <div style="display:flex;border-bottom:1px solid var(--line);flex-shrink:0">
      ${tabs.map(t => {
        const active = t === teamSubagentDetailTab;
        return `<button onclick="switchTeamSubagentTab('${team.id}','${escHtml(agentId)}','${t}')" style="padding:9px 14px;font-size:12px;font-weight:${active?'700':'500'};border:none;background:none;cursor:pointer;color:${active?'var(--brand)':'var(--muted)'};border-bottom:2px solid ${active?'var(--brand)':'transparent'};margin-bottom:-1px">${labels[t]}</button>`;
      }).join('')}
    </div>
    <div id="team-subagent-detail-body" style="flex:1;min-height:0;overflow-y:auto;padding:14px">
      ${renderTeamSubagentDetailBody(team, agentId)}
    </div>`;
}

function renderTeamSubagentDetailBody(team, agentId) {
  switch (teamSubagentDetailTab) {
    case 'overview': return renderTeamSubagentOverview(team, agentId);
    case 'systemprompt': return renderTeamSubagentSystemPrompt(team, agentId);
    case 'heartbeat': return renderTeamSubagentHeartbeat(team, agentId);
    default: return '';
  }
}

function renderTeamSubagentOverview(team, agentId) {
  const ag = _findAgentInTeam(agentId);
  const refs = teamSubagentDetail.contextRefs || [];
  const refsHtml = refs.length === 0
    ? `<div style="border:1px dashed var(--line);border-radius:8px;padding:12px;font-size:11px;color:var(--muted);background:var(--panel-2)">No context references for this agent yet.</div>`
    : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">
        ${refs.map(ref => {
          const preview = String(ref.content||'').replace(/\s+/g,' ').slice(0,140);
          return `<div style="border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:9px;display:flex;flex-direction:column;gap:5px;min-height:96px">
            <div style="font-size:11px;font-weight:700;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escHtml(ref.title||'Untitled')}</div>
            <div style="font-size:10px;color:var(--muted);overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical">${escHtml(preview||'(empty)')}</div>
            <button onclick="deleteTeamSubagentCtxRef('${team.id}','${escHtml(agentId)}','${escHtml(ref.id)}')" style="margin-top:auto;align-self:flex-start;border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:5px;padding:2px 8px;font-size:10px;cursor:pointer">Delete</button>
          </div>`;
        }).join('')}
      </div>`;
  return `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:10px 14px">
        <div style="display:grid;grid-template-columns:120px 1fr;gap:6px 12px;font-size:12px">
          <div style="color:var(--muted);font-weight:700">Agent ID</div><div style="font-family:'IBM Plex Mono',monospace">${escHtml(agentId)}</div>
          <div style="color:var(--muted);font-weight:700">Model</div><div>${escHtml(ag.effectiveModel || 'Inherited')}</div>
          <div style="color:var(--muted);font-weight:700">Schedule</div><div>${ag.cronSchedule ? `<code style="background:var(--panel);padding:1px 5px;border-radius:4px">${escHtml(ag.cronSchedule)}</code>` : '<span style="color:var(--muted)">Not scheduled</span>'}</div>
          <div style="color:var(--muted);font-weight:700">Workspace</div><div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(ag.workspace || '')}">${escHtml(ag.workspace || 'Not set')}</div>
        </div>
      </div>

      ${_renderAgentModelPicker(ag, 'ts-model')}

      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div>
            <div style="font-size:12px;font-weight:800">Context &amp; Reference</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">Per-agent reference cards. Injected into this agent's runtime context.</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
          <input id="ts-ctx-title-${escHtml(agentId)}" type="text" placeholder="Reference title" style="border:1px solid var(--line);border-radius:7px;padding:7px 10px;font-size:12px;background:var(--panel-2);color:var(--text)" />
          <textarea id="ts-ctx-content-${escHtml(agentId)}" rows="3" placeholder="Reference content" style="border:1px solid var(--line);border-radius:7px;padding:7px 10px;font-size:12px;font-family:inherit;background:var(--panel-2);color:var(--text);resize:vertical"></textarea>
          <button onclick="saveTeamSubagentCtxRef('${team.id}','${escHtml(agentId)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:7px;padding:6px 14px;font-size:11px;font-weight:700;cursor:pointer;align-self:flex-start">Save Reference</button>
        </div>
        ${refsHtml}
      </div>
    </div>`;
}

function renderTeamSubagentSystemPrompt(team, agentId) {
  return `
    <div style="display:flex;flex-direction:column;gap:10px;height:100%">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:12px;font-weight:800">system_prompt.md</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Defines this agent's persona, role, and constraints</div>
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="reloadTeamSubagentSystemPrompt('${team.id}','${escHtml(agentId)}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:7px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer">Reload</button>
          <button onclick="saveTeamSubagentSystemPrompt('${team.id}','${escHtml(agentId)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:7px;padding:5px 14px;font-size:11px;font-weight:700;cursor:pointer">Save</button>
        </div>
      </div>
      <div id="ts-sysprompt-cm-${escHtml(agentId)}" style="flex:1;min-height:340px;border:1px solid var(--line);border-radius:8px;overflow:hidden"></div>
      <div id="ts-sysprompt-status-${escHtml(agentId)}" style="font-size:11px;color:var(--muted);min-height:14px"></div>
    </div>`;
}

function renderTeamSubagentHeartbeat(team, agentId) {
  const cfg = teamSubagentDetail.heartbeatCfg || { enabled: false, intervalMinutes: 30 };
  return `
    <div style="display:flex;flex-direction:column;gap:12px;height:100%">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:12px;font-weight:800">Heartbeat</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Recurring scheduled task for this agent</div>
        </div>
        <button onclick="tickTeamSubagentHeartbeat('${team.id}','${escHtml(agentId)}')" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:7px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer">Run Now</button>
      </div>

      <div style="display:flex;align-items:center;gap:14px;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:10px 12px">
        <label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="ts-hb-enabled-${escHtml(agentId)}" ${cfg.enabled ? 'checked' : ''} style="width:15px;height:15px" />
          Enabled
        </label>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:12px;color:var(--muted)">Every</span>
          <input type="number" id="ts-hb-interval-${escHtml(agentId)}" min="1" max="1440" value="${cfg.intervalMinutes||30}" style="width:64px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-size:12px;text-align:center;background:var(--panel);color:var(--text)" />
          <span style="font-size:12px;color:var(--muted)">min</span>
        </div>
        <button onclick="saveTeamSubagentHbConfig('${team.id}','${escHtml(agentId)}')" style="margin-left:auto;border:1px solid var(--brand);background:transparent;color:var(--brand);border-radius:7px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer">Save Config</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px;flex:1;min-height:0">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:11px;font-weight:700;color:var(--muted)">HEARTBEAT.md — what this agent does when woken</div>
          <button onclick="saveTeamSubagentHeartbeatMd('${team.id}','${escHtml(agentId)}')" style="border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:7px;padding:5px 14px;font-size:11px;font-weight:700;cursor:pointer">Save HEARTBEAT.md</button>
        </div>
        <div id="ts-heartbeat-cm-${escHtml(agentId)}" style="flex:1;min-height:280px;border:1px solid var(--line);border-radius:8px;overflow:hidden"></div>
        <div id="ts-hb-status-${escHtml(agentId)}" style="font-size:11px;color:var(--muted);min-height:14px"></div>
      </div>
    </div>`;
}

// ─── Team Subagents Tab — interactions ────────────────────────────────────────

function _disposeTeamCmEditors() {
  for (const k of Object.keys(_teamCmEditors)) {
    try { _teamCmEditors[k] = null; } catch {}
  }
  _teamCmEditors = {};
}

function _mountCm(elId, value, mode) {
  const el = document.getElementById(elId);
  if (!el || typeof CodeMirror === 'undefined') return null;
  el.innerHTML = '';
  const cm = CodeMirror(el, {
    value: value || '',
    mode: mode || 'markdown',
    theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'material-darker' : 'default',
    lineNumbers: true,
    lineWrapping: true,
    viewportMargin: Infinity,
  });
  // Force a resize after mount so it fills the container
  setTimeout(() => cm.refresh(), 50);
  return cm;
}

async function openTeamSubagentDetail(teamId, agentId) {
  teamSubagentDetailId = agentId;
  // Reset detail caches when switching agents
  teamSubagentDetail = { systemPrompt: '', heartbeatMd: '', heartbeatCfg: { enabled: false, intervalMinutes: 30 }, contextRefs: [] };
  _disposeTeamCmEditors();

  // Fetch in parallel
  const [sp, hbMd, hbCfg, refs] = await Promise.all([
    api(`/api/agents/${encodeURIComponent(agentId)}/system-prompt-md`).catch(() => ({ content: '' })),
    api(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`).catch(() => ({ content: '' })),
    api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`).catch(() => ({ config: {} })),
    api(`/api/agents/${encodeURIComponent(agentId)}/context-refs`).catch(() => ({ references: [] })),
  ]);
  teamSubagentDetail.systemPrompt = sp.content || '';
  teamSubagentDetail.heartbeatMd = hbMd.content || '';
  const cfg = hbCfg.config || {};
  teamSubagentDetail.heartbeatCfg = { enabled: cfg.enabled === true, intervalMinutes: cfg.intervalMinutes || 30 };
  teamSubagentDetail.contextRefs = refs.references || refs.contextReferences || [];

  // Re-render the detail panel only (preserve list selection state)
  if (teamBoardTab === 'subagents' && activeTeamId === teamId) {
    const team = teamsData.find(t => t.id === teamId);
    const panel = document.getElementById('team-subagent-detail-panel');
    if (panel && team) panel.innerHTML = renderTeamSubagentDetail(team, agentId);
    // Also update the list highlight
    renderTeamBoard(teamId);
    _mountTeamSubagentEditors(agentId);
    if (teamSubagentDetailTab === 'overview') {
      agentModelPickerHydrate('ts-model', _findAgentInTeam(agentId));
    }
  }
}

function switchTeamSubagentTab(teamId, agentId, tab) {
  teamSubagentDetailTab = tab;
  const team = teamsData.find(t => t.id === teamId);
  if (!team) return;
  const body = document.getElementById('team-subagent-detail-body');
  if (body) body.innerHTML = renderTeamSubagentDetailBody(team, agentId);
  _mountTeamSubagentEditors(agentId);
  if (tab === 'overview') {
    agentModelPickerHydrate('ts-model', _findAgentInTeam(agentId));
  }
}

function _mountTeamSubagentEditors(agentId) {
  if (teamSubagentDetailTab === 'systemprompt') {
    const cm = _mountCm(`ts-sysprompt-cm-${agentId}`, teamSubagentDetail.systemPrompt, 'markdown');
    if (cm) _teamCmEditors[`sysprompt:${agentId}`] = cm;
  }
  if (teamSubagentDetailTab === 'heartbeat') {
    const cm = _mountCm(`ts-heartbeat-cm-${agentId}`, teamSubagentDetail.heartbeatMd, 'markdown');
    if (cm) _teamCmEditors[`heartbeat:${agentId}`] = cm;
  }
}

async function saveTeamSubagentSystemPrompt(teamId, agentId) {
  const cm = _teamCmEditors[`sysprompt:${agentId}`];
  if (!cm) return;
  const status = document.getElementById(`ts-sysprompt-status-${agentId}`);
  if (status) status.textContent = 'Saving…';
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/system-prompt-md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: cm.getValue() }),
    });
    teamSubagentDetail.systemPrompt = cm.getValue();
    if (status) status.textContent = 'Saved.';
    bgtToast('Saved', `system_prompt.md updated for ${agentId}`);
  } catch (err) {
    if (status) status.textContent = `Error: ${err?.message || err}`;
  }
}

async function reloadTeamSubagentSystemPrompt(teamId, agentId) {
  try {
    const d = await api(`/api/agents/${encodeURIComponent(agentId)}/system-prompt-md`);
    teamSubagentDetail.systemPrompt = d.content || '';
    const cm = _teamCmEditors[`sysprompt:${agentId}`];
    if (cm) cm.setValue(teamSubagentDetail.systemPrompt);
  } catch {}
}

async function saveTeamSubagentHeartbeatMd(teamId, agentId) {
  const cm = _teamCmEditors[`heartbeat:${agentId}`];
  if (!cm) return;
  const status = document.getElementById(`ts-hb-status-${agentId}`);
  if (status) status.textContent = 'Saving…';
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: cm.getValue() }),
    });
    teamSubagentDetail.heartbeatMd = cm.getValue();
    if (status) status.textContent = 'Saved.';
    bgtToast('Saved', `HEARTBEAT.md updated for ${agentId}`);
  } catch (err) {
    if (status) status.textContent = `Error: ${err?.message || err}`;
  }
}

async function saveTeamSubagentHbConfig(teamId, agentId) {
  const enabledEl = document.getElementById(`ts-hb-enabled-${agentId}`);
  const intervalEl = document.getElementById(`ts-hb-interval-${agentId}`);
  const enabled = !!(enabledEl && enabledEl.checked);
  const intervalMinutes = Math.max(1, Math.min(1440, parseInt(intervalEl?.value || '30', 10) || 30));
  const status = document.getElementById(`ts-hb-status-${agentId}`);
  if (status) status.textContent = 'Saving…';
  try {
    await api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, intervalMinutes }),
    });
    teamSubagentDetail.heartbeatCfg = { enabled, intervalMinutes };
    if (status) status.textContent = 'Saved.';
    bgtToast('Saved', `Heartbeat config updated for ${agentId}`);
  } catch (err) {
    if (status) status.textContent = `Error: ${err?.message || err}`;
  }
}

async function tickTeamSubagentHeartbeat(teamId, agentId) {
  try {
    await api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}/tick`, { method: 'POST' });
    bgtToast('Triggered', `Heartbeat run dispatched for ${agentId}`);
  } catch (err) {
    bgtToast('Error', err?.message || String(err));
  }
}

async function saveTeamSubagentCtxRef(teamId, agentId) {
  const titleEl = document.getElementById(`ts-ctx-title-${agentId}`);
  const contentEl = document.getElementById(`ts-ctx-content-${agentId}`);
  const title = (titleEl?.value || '').trim();
  const content = (contentEl?.value || '').trim();
  if (!title && !content) return;
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/context-refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    if (titleEl) titleEl.value = '';
    if (contentEl) contentEl.value = '';
    const refs = await api(`/api/agents/${encodeURIComponent(agentId)}/context-refs`).catch(() => ({ references: [] }));
    teamSubagentDetail.contextRefs = refs.references || refs.contextReferences || [];
    const body = document.getElementById('team-subagent-detail-body');
    const team = teamsData.find(t => t.id === teamId);
    if (body && team) body.innerHTML = renderTeamSubagentDetailBody(team, agentId);
  } catch (err) {
    bgtToast('Error', err?.message || String(err));
  }
}

async function deleteTeamSubagentCtxRef(teamId, agentId, refId) {
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/context-refs/${encodeURIComponent(refId)}`, { method: 'DELETE' });
    teamSubagentDetail.contextRefs = (teamSubagentDetail.contextRefs || []).filter(r => r.id !== refId);
    const body = document.getElementById('team-subagent-detail-body');
    const team = teamsData.find(t => t.id === teamId);
    if (body && team) body.innerHTML = renderTeamSubagentDetailBody(team, agentId);
  } catch (err) {
    bgtToast('Error', err?.message || String(err));
  }
}

function renderTeamRunsTabLegacy(team) {
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

function renderTeamRunsTab(team) {
  if (teamRuns.length === 0) {
    return '<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px">No runs yet. Runs will appear here once subagents execute.</div>';
  }
  return `
    <div style="display:flex;flex-direction:column;gap:10px">
      ${teamRuns.map(r => {
        const runId = String(r.id || r.taskId || `${r.agentId}-${r.startedAt}`);
        const expanded = teamRunExpanded[runId] === true;
        const snap = r.roomSnapshot || _teamRoomState();
        const successColor = r.inProgress ? '#0d4faf' : r.success ? '#31b884' : '#e05c5c';
        const finalText = String(r.resultPreview || r.taskSummary || r.error || '').trim();
        return `
        <div style="background:var(--panel-2);border:1px solid var(--line);border-left:4px solid ${successColor};border-radius:8px;overflow:hidden">
          <button onclick="toggleTeamRunCard('${escHtml(runId)}')" style="width:100%;border:none;background:transparent;color:inherit;text-align:left;padding:11px 12px;cursor:pointer;font-family:inherit;display:flex;align-items:flex-start;gap:10px">
            <div style="width:58px;flex-shrink:0;font-size:10px;font-weight:800;color:${successColor};text-transform:uppercase;margin-top:2px">${r.inProgress ? 'RUNNING' : r.success ? 'PASS' : 'ATTN'}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
                <span style="font-size:13px;font-weight:800;color:var(--text)">${escHtml(r.agentName||r.agentId)}</span>
                ${_teamStatePill(String(r.trigger || 'run'), '')}
                ${r.taskStatus ? _teamStatePill(String(r.taskStatus), '') : ''}
                ${r.quality?.suspect || r.zeroToolCalls ? _teamStatePill('quality', 'review', '#b06b00') : ''}
              </div>
              <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${r.startedAt ? new Date(r.startedAt).toLocaleString() : ''}${r.durationMs ? ` &middot; ${Math.round(r.durationMs/1000)}s` : ''} &middot; ${r.stepCount||0} steps</div>
              ${finalText ? `<div style="font-size:11px;color:var(--text);line-height:1.4;opacity:0.9;white-space:pre-wrap;overflow-wrap:anywhere;${expanded ? '' : 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden'}">${escHtml(finalText)}</div>` : ''}
            </div>
            <div style="font-size:14px;color:var(--muted);line-height:1">${expanded ? '&#9662;' : '&#9656;'}</div>
          </button>
          ${expanded ? `
            <div style="border-top:1px solid var(--line);padding:12px;display:flex;flex-direction:column;gap:12px;background:var(--panel)">
              <div>
                <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Final Summary</div>
                <div style="border:1px solid var(--line);background:var(--panel-2);border-radius:8px;padding:10px;font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;color:${r.error ? '#b42323' : 'var(--text)'}">${escHtml(finalText || 'No summary captured.')}</div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <div>
                  <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Member States</div>
                  ${_renderTeamMemberStatesCompact(snap)}
                </div>
                <div>
                  <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Active Dispatches</div>
                  ${_renderTeamActiveDispatches(snap)}
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <div>
                  <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Artifacts</div>
                  ${_renderTeamArtifactsList(snap.artifacts || [])}
                </div>
                <div>
                  <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Blockers</div>
                  ${_renderTeamBlockersList(snap.blockers || [])}
                </div>
              </div>
              <div>
                <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Plan Ownership</div>
                ${_renderTeamPlanOwnership(snap.plan || [])}
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <div>
                  <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Manager Auto-Wake Events</div>
                  ${_renderTeamEventsList(snap.managerAutoWakeEvents || [], 'No manager auto-wakes in this snapshot.')}
                </div>
                <div>
                  <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Why This Agent Woke Up</div>
                  ${_renderTeamEventsList(snap.memberWakeEvents || [], 'No wake reason captured for this agent.')}
                </div>
              </div>
              <div>
                <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px">Related Room Events</div>
                ${_renderTeamEventsList(snap.relatedEvents || [], 'No related room events captured.')}
              </div>
            </div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

function toggleTeamRunCard(runId) {
  teamRunExpanded[runId] = teamRunExpanded[runId] !== true;
  if (teamBoardTab === 'runs' && activeTeamId) {
    const team = teamsData.find(t => t.id === activeTeamId);
    const el = document.getElementById('team-tab-content');
    if (team && el) el.innerHTML = renderTeamRunsTab(team);
  }
}

function _renderTeamChatMessagesInner(team) {
  const all = teamChatMessages;
  const visibleCount = Math.max(TEAM_CHAT_INITIAL_VISIBLE, teamChatVisibleCountByTeam[team.id] || TEAM_CHAT_INITIAL_VISIBLE);
  const startIdx = Math.max(0, all.length - visibleCount);
  const msgs = all.slice(startIdx);
  const hiddenCount = startIdx;
  const liveManagerStreams = getTeamManagerStreams(team.id);
  const liveMemberStreams = getTeamMemberStreams(team.id);
  const liveDispatches = getTeamDispatchStreams(team.id);
  const hasBackgroundManagerStream = liveManagerStreams.some((stream) => stream && stream.completed !== true);
  const showMoreBtn = hiddenCount > 0
    ? `<button onclick="showMoreTeamChat('${team.id}')" style="align-self:center;border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:999px;padding:5px 14px;font-size:11px;font-weight:700;cursor:pointer;margin-bottom:4px">+ Show ${Math.min(20, hiddenCount)} earlier ${hiddenCount === 1 ? 'message' : 'messages'} (${hiddenCount} hidden)</button>`
    : '';
  const empty = msgs.length === 0 && !hasBackgroundManagerStream && liveDispatches.length === 0 && liveManagerStreams.length === 0 && liveMemberStreams.length === 0
    ? '<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px">Team room is quiet. Type normally to post a room note, or use @team, @manager, or @someone to address a participant directly.</div>'
    : '';
  return `
    ${showMoreBtn}
    ${empty}
    ${msgs.map((m) => renderTeamChatMessageBubble(m)).join('')}
    ${renderTeamChatStreamingBubble(team)}
    ${liveManagerStreams.map((stream) => renderTeamManagerBackgroundStreamingBubble(stream)).join('')}
    ${liveMemberStreams.map((stream) => renderTeamMemberStreamingBubble(stream)).join('')}
    ${liveDispatches.map((stream) => renderTeamDispatchBubble(team.id, stream)).join('')}`;
}

function showMoreTeamChat(teamId) {
  const cur = teamChatVisibleCountByTeam[teamId] || TEAM_CHAT_INITIAL_VISIBLE;
  teamChatVisibleCountByTeam[teamId] = cur + 20;
  // Preserve scroll position relative to the first currently-visible message
  // so the user's reading anchor doesn't jump when older messages prepend.
  const msgEl = document.getElementById('team-chat-messages');
  const prevScrollHeight = msgEl ? msgEl.scrollHeight : 0;
  const prevScrollTop = msgEl ? msgEl.scrollTop : 0;
  const team = teamsData.find((t) => t.id === teamId);
  if (!team || !msgEl) return;
  msgEl.innerHTML = _renderTeamChatMessagesInner(team);
  requestAnimationFrame(() => {
    const newEl = document.getElementById('team-chat-messages');
    if (!newEl) return;
    const delta = newEl.scrollHeight - prevScrollHeight;
    newEl.scrollTop = prevScrollTop + delta;
  });
}

function renderTeamChatTab(team) {
  const isSending = isTeamChatBusy(team.id);
  const queuedCount = getTeamChatQueue(team.id).length;
  return `
    <div id="team-chat-messages" style="flex:1;display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:calc(100% - 80px)">
      ${_renderTeamChatMessagesInner(team)}
    </div>
    <div id="team-chat-composer-shell" style="flex-shrink:0;border-top:1px solid var(--line);padding:12px 0 0;margin-top:10px;display:flex;gap:10px;align-items:flex-end">
      <div id="team-chat-composer" style="flex:1;position:relative">
        <div id="team-chat-queue-badge" style="display:${queuedCount ? 'inline-flex' : 'none'};align-items:center;border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:999px;padding:3px 9px;font-size:11px;font-weight:800;margin-bottom:6px">${queuedCount} queued</div>
        <div id="team-chat-mention-popover" style="display:none;position:absolute;left:0;right:0;bottom:calc(100% + 10px);z-index:20;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 18px 38px rgba(0,0,0,0.22);overflow:hidden"></div>
        <div style="position:relative;border:1px solid var(--line);border-radius:14px;background:var(--panel-2);box-shadow:0 8px 22px rgba(0,0,0,0.08);overflow:hidden">
          <div id="team-chat-input-mirror" aria-hidden="true" style="position:absolute;inset:0;padding:12px 14px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;pointer-events:none;color:var(--text);overflow:hidden"></div>
          <div id="team-chat-input-placeholder" style="position:absolute;left:14px;right:14px;top:12px;font-size:13px;line-height:1.6;color:var(--muted);pointer-events:none">${isSending ? 'Queue a room note, or type @team, @manager, or @someone...' : 'Post a room note, or type @team, @manager, or @someone...'}</div>
          <textarea id="team-chat-input" rows="3" spellcheck="true" style="position:relative;z-index:1;width:100%;resize:none;border:none;padding:12px 14px;font-size:13px;line-height:1.6;font-family:inherit;background:transparent;color:transparent;caret-color:var(--text);outline:none;min-height:64px"></textarea>
        </div>
      </div>
      <button id="team-chat-send-button" onclick="${isSending ? `abortTeamChat('${team.id}')` : `sendTeamChat('${team.id}')`}" style="background:${isSending ? '#e05c5c' : 'var(--brand)'};color:#fff;border:none;border-radius:12px;padding:10px 16px;font-size:12px;font-weight:800;cursor:pointer;height:42px;min-width:64px;box-shadow:${isSending ? '0 10px 24px rgba(224,92,92,0.24)' : '0 10px 24px rgba(76,141,255,0.24)'}">${isSending ? 'Stop' : 'Send'}</button>
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
async function sendTeamChat(teamId, queuedMessage = null) {
  const inp = document.getElementById('team-chat-input');
  const fromQueue = queuedMessage !== null && queuedMessage !== undefined;
  if (!inp && !fromQueue) return;
  const msg = fromQueue ? String(queuedMessage || '').trim() : String(inp?.value || '').trim();
  if (!msg) return;

  if (isTeamChatBusy(teamId)) {
    const queued = queueTeamChatMessage(teamId, msg);
    if (queued && !fromQueue && inp) {
      inp.value = '';
      teamChatDraftByTeam[teamId] = '';
      resizeTeamChatInput();
    }
    hideTeamChatMentionPopover();
    refreshTeamChatComposerState(teamId);
    renderActiveTeamChat(teamId, { forceBottom: true });
    requestAnimationFrame(() => {
      const newInp = document.getElementById('team-chat-input');
      if (newInp) newInp.focus();
    });
    return;
  }

  const routeTarget = getLeadingTeamChatTarget(msg, teamId);
  if (inp && !fromQueue) inp.value = '';
  if (!fromQueue) teamChatDraftByTeam[teamId] = '';
  hideTeamChatMentionPopover();
  resizeTeamChatInput();
  const streamState = {
    teamId,
    content: '',
    thinking: '',
    processEntries: [],
    progressLines: ['Manager is thinking...'],
    completed: false,
    finalReply: '',
    fallbackTimer: null,
  };
  teamChatStreamingState = streamState;
  const controller = new AbortController();
  teamChatAbortControllersByTeam[teamId] = controller;
  let wasAborted = false;
  renderActiveTeamChat(teamId, { forceBottom: true });
  try {
    const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      signal: controller.signal,
      body: JSON.stringify({
        message: msg,
        targetType: routeTarget.type,
        targetId: routeTarget.targetId || undefined,
        targetLabel: routeTarget.targetLabel || undefined,
        routedMessage: routeTarget.routedMessage || msg,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error('No response body from team stream');

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
        if (teamChatStreamingState !== streamState) continue;

        switch (event.type) {
          case 'token': {
            const chunk = String(event.text || '');
            if (chunk) {
              streamState.content = `${streamState.content || ''}${chunk}`;
              refreshTeamChatStreamingUI(teamId);
            }
            break;
          }
          case 'thinking_delta': {
            const chunk = String(event.thinking || event.text || '');
            if (chunk) {
              streamState.thinking = `${streamState.thinking || ''}${chunk}`;
              pushTeamChatProgressLine('Thinking...');
              refreshTeamChatStreamingUI(teamId);
            }
            break;
          }
          case 'thinking':
          case 'agent_thought': {
            const thought = String(event.thinking || event.text || '').trim();
            if (thought) {
              streamState.thinking = streamState.thinking ? `${streamState.thinking}\n\n${thought}` : thought;
              addTeamChatProcessEntry('think', thought, event.actor ? { actor: event.actor } : undefined);
              refreshTeamChatStreamingUI(teamId, true);
            }
            break;
          }
          case 'info': {
            const info = String(event.message || '').trim();
            if (info) {
              pushTeamChatProgressLine(info);
              addTeamChatProcessEntry('info', info, event.actor ? { actor: event.actor } : undefined);
              refreshTeamChatStreamingUI(teamId, true);
            }
            break;
          }
          case 'heartbeat': {
            const heartbeatMsg = String(event.message || event.current_step || event.state || '').trim();
            if (heartbeatMsg && !/^processing$/i.test(heartbeatMsg)) pushTeamChatProgressLine(heartbeatMsg);
            refreshTeamChatStreamingUI(teamId);
            break;
          }
          case 'progress_state': {
            const items = Array.isArray(event.items) ? event.items : [];
            const activeIndex = Number(event.activeIndex || -1);
            const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
            const activeText = String(activeItem?.text || '').trim();
            if (activeText) pushTeamChatProgressLine(activeText);
            refreshTeamChatStreamingUI(teamId);
            break;
          }
          case 'tool_call': {
            const action = String(event.action || '').trim();
            if (action) {
              const stepNum = Number(event.stepNum || 0);
              const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
              const args = (event.args && typeof event.args === 'object') ? event.args : null;
              const argsPreview = args ? JSON.stringify(args).slice(0, 240) : '';
              pushTeamChatProgressLine(`${stepPrefix}Running ${action}...`);
              addTeamChatProcessEntry('tool', `${stepPrefix}${action}${argsPreview ? ` ${argsPreview}` : ''}`, args || undefined);
              refreshTeamChatStreamingUI(teamId, true);
            }
            break;
          }
          case 'tool_result': {
            const action = String(event.action || '').trim() || 'tool';
            const stepNum = Number(event.stepNum || 0);
            const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
            const text = String(event.result || '').trim();
            const ok = event.error === true ? false : !/^ERROR:/i.test(text);
            pushTeamChatProgressLine(`${stepPrefix}${action} ${ok ? 'complete' : 'failed'}`);
            addTeamChatProcessEntry(ok ? 'result' : 'error', `${stepPrefix}${action} => ${text || '(no output)'}`, event.actor ? { actor: event.actor } : undefined);
            refreshTeamChatStreamingUI(teamId, true);
            break;
          }
          case 'tool_progress': {
            const action = String(event.action || '').trim();
            const progressMsg = String(event.message || '').trim();
            if (action && progressMsg) {
              pushTeamChatProgressLine(`${action}: ${progressMsg}`);
              addTeamChatProcessEntry('info', `${action}: ${progressMsg}`, event.actor ? { actor: event.actor } : undefined);
              refreshTeamChatStreamingUI(teamId, true);
            }
            break;
          }
          case 'final': {
            const reply = String(event.reply || event.text || '').trim();
            if (reply) {
              streamState.finalReply = reply;
              if (!streamState.content) streamState.content = reply;
              addTeamChatProcessEntry('final', reply);
              refreshTeamChatStreamingUI(teamId, true);
            }
            break;
          }
          case 'done': {
            const reply = String(event.reply || event.text || '').trim();
            if (reply) {
              streamState.finalReply = reply;
              if (!streamState.content) streamState.content = reply;
            }
            streamState.completed = true;
            if (streamState.fallbackTimer) clearTimeout(streamState.fallbackTimer);
            streamState.fallbackTimer = setTimeout(() => {
              if (teamChatStreamingState !== streamState) return;
              const finalText = String(streamState.finalReply || streamState.content || '').trim();
              if (finalText && !teamChatMessages.some((entry) => String(entry.content || '').trim() === finalText && entry.from === 'manager')) {
                teamChatMessages.push({
                  id: `team_chat_stream_${Date.now()}`,
                  from: 'manager',
                  fromName: 'Manager',
                  content: finalText,
                  timestamp: Date.now(),
                  metadata: {
                    source: 'team_chat_stream',
                    localStreamingFallback: true,
                    processEntries: Array.isArray(streamState.processEntries) ? [...streamState.processEntries] : [],
                    thinking: String(streamState.thinking || '').trim(),
                  },
                });
                activeTeamChatSignature = getTeamChatSignature(teamChatMessages);
              }
              if (teamChatStreamingState === streamState) teamChatStreamingState = null;
              renderActiveTeamChat(teamId, { forceBottom: true });
              scheduleNextTeamQueuedMessage(teamId);
            }, 450);
            refreshTeamChatStreamingUI(teamId, true);
            break;
          }
          case 'error':
            throw new Error(String(event.message || 'Unknown stream error'));
        }
      }
    }
  } catch (err) {
    wasAborted = controller.signal.aborted || err?.name === 'AbortError';
    if (streamState.fallbackTimer) clearTimeout(streamState.fallbackTimer);
    if (wasAborted) {
      pushTeamChatProgressLine('Stopped by user.');
      streamState.completed = true;
      if (teamChatStreamingState === streamState) teamChatStreamingState = null;
      renderActiveTeamChat(teamId, { forceBottom: true });
    } else {
      if (teamChatStreamingState === streamState) teamChatStreamingState = null;
      teamChatMessages.push({
        id: `team_chat_error_${Date.now()}`,
        from: 'manager',
        fromName: 'Manager',
        content: `Error: ${err?.message || String(err)}`,
        timestamp: Date.now(),
        metadata: { success: false },
      });
      activeTeamChatSignature = getTeamChatSignature(teamChatMessages);
      renderActiveTeamChat(teamId, { forceBottom: true });
      bgtToast('? Error', 'Could not send message');
    }
  } finally {
    if (teamChatAbortControllersByTeam[teamId] === controller) delete teamChatAbortControllersByTeam[teamId];
  }
  if (!wasAborted && !isTeamChatBusy(teamId)) scheduleNextTeamQueuedMessage(teamId);
  requestAnimationFrame(() => {
    const newInp = document.getElementById('team-chat-input');
    if (newInp) {
      newInp.focus();
      resizeTeamChatInput();
    }
  });
}

function abortTeamChat(teamId) {
  const controller = teamChatAbortControllersByTeam[teamId];
  if (controller && !controller.signal.aborted) controller.abort();
  if (teamChatStreamingState && teamChatStreamingState.teamId === teamId) {
    pushTeamChatProgressLine('Stopping...');
    refreshTeamChatStreamingUI(teamId, true);
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

async function uploadTeamContextFile(teamId, input) {
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
        content = e.target.result.split(',')[1];
        encoding = 'base64';
      }
      bgtToast('📎 Uploading…', file.name);
      const res = await api(`/api/teams/${teamId}/context-files`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, content, encoding, title: file.name }),
      });
      // Optimistically update team context refs in memory
      const team = teamsData.find(t => t.id === teamId);
      if (team && res?.ref) {
        team.contextReferences = [...(team.contextReferences || []), res.ref];
      }
      _teamsDataSig = '';
      await refreshTeams();
      if (activeTeamId === teamId) {
        await loadTeamBoardData(teamId);
        renderTeamBoard(teamId);
      }
      bgtToast('✅ Uploaded', `${file.name} added to team workspace`);
    } catch (err) {
      bgtToast('❌ Error', err.message || 'Upload failed');
    }
  };
  if (isText) reader.readAsText(file);
  else reader.readAsDataURL(file);
  input.value = '';
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
  const agentCount = (team.subagentIds || []).length;
  const agentNote = agentCount > 0
    ? `\n\nThis will permanently delete ${agentCount} subagent${agentCount !== 1 ? 's' : ''} and all their files.`
    : '';
  if (!confirm(`Delete team "${team.name}"?${agentNote}\n\nThis cannot be undone.`)) return;
  try {
    const result = await api(`/api/teams/${teamId}`, { method:'DELETE' });
    if (activeTeamId === teamId) closeTeamBoard();
    await refreshTeams();
    const deleted = result.deletedAgents?.length || 0;
    bgtToast('🗑 Team deleted', deleted > 0 ? `${team.name} and ${deleted} agent${deleted !== 1 ? 's' : ''}` : team.name);
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
    bgtToast('▶️ Running!', `${agentId} started — check team chat for live progress`);
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
        startedAt: Number(msg.startedAt || Date.now()),
        success: false,
      };
      ensureTeamDispatchStream(msg.teamId, msg.taskId, {
        agentId: msg.agentId || '',
        agentName: msg.agentName || msg.agentId || 'Subagent',
        taskSummary: msg.taskSummary || '',
        startedAt: Number(msg.startedAt || Date.now()),
        status: 'running',
        completed: false,
        progressLines: ['Working...'],
      });
      if (activeTeamId === msg.teamId) {
        _refreshTeamProgressPanel(msg.teamId);
        refreshVisibleTeamChat(msg.teamId, false);
      }
    }
  }
  if (msg.type === 'task_stream_event') {
    const stream = applyTeamDispatchStreamEvent(msg);
    if (stream) {
      const eventType = String(msg?.eventType || '').trim();
      if (eventType === 'token' || eventType === 'thinking_delta') {
        scheduleTeamDispatchRefresh(stream.teamId, false);
      } else {
        refreshVisibleTeamChat(stream.teamId, false);
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
      const stream = ensureTeamDispatchStream(msg.teamId, msg.taskId, {
        agentId: msg.agentId || '',
        agentName: msg.agentName || msg.agentId || 'Subagent',
        taskSummary: msg.taskSummary || '',
      });
      if (stream) {
        stream.completed = true;
        stream.status = 'finalizing';
        stream.finishedAt = Date.now();
        stream.durationMs = Math.max(Number(stream.durationMs || 0), stream.finishedAt - Number(stream.startedAt || Date.now()));
        if (msg.summary && !stream.finalReply) stream.finalReply = String(msg.summary);
      }
      if (activeTeamId === msg.teamId) {
        if (teamBoardTab === 'chat') {
          _refreshTeamProgressPanel(msg.teamId);
          refreshVisibleTeamChat(msg.teamId, false);
        } else {
          loadTeamBoardData(msg.teamId).then(() => {
            _refreshTeamProgressPanel(msg.teamId);
            if (teamBoardTab === 'runs') renderTeamBoard(msg.teamId);
            else refreshVisibleTeamChat(msg.teamId, false);
          });
        }
      }
    }
  }
  if (msg.type === 'task_failed' || msg.type === 'task_paused') {
    if (msg.teamId && msg.taskId) {
      if (teamActiveRunsByTeam[msg.teamId]?.[msg.taskId]) {
        delete teamActiveRunsByTeam[msg.teamId][msg.taskId];
      }
      const stream = ensureTeamDispatchStream(msg.teamId, msg.taskId, {
        agentId: msg.agentId || '',
        agentName: msg.agentName || msg.agentId || 'Subagent',
        taskSummary: msg.taskSummary || '',
      });
      if (stream) {
        stream.completed = msg.type !== 'task_paused';
        stream.status = msg.type === 'task_failed' ? 'failed' : 'paused';
        stream.finishedAt = Date.now();
        stream.durationMs = Math.max(Number(stream.durationMs || 0), stream.finishedAt - Number(stream.startedAt || Date.now()));
        if (msg.summary) pushTeamDispatchProgressLine(stream, String(msg.summary));
        if (msg.summary && !stream.finalReply) stream.finalReply = String(msg.summary);
      }
      if (activeTeamId === msg.teamId) {
        if (teamBoardTab === 'chat') {
          _refreshTeamProgressPanel(msg.teamId);
          refreshVisibleTeamChat(msg.teamId, false);
        } else {
          loadTeamBoardData(msg.teamId).then(() => {
            _refreshTeamProgressPanel(msg.teamId);
            refreshVisibleTeamChat(msg.teamId, false);
          });
        }
      }
    }
  }
  if (msg.type === 'team_subagent_completed') {
    const icon = msg.success ? '?' : '?';
    bgtToast(`🏠 ${msg.teamName}`, `${icon} ${msg.agentName} completed a task`);
    refreshTeamsDebounced();
    if (activeTeamId === msg.teamId) {
      if (teamBoardTab === 'chat') {
        refreshVisibleTeamChat(msg.teamId, false);
        api(`/api/teams/${msg.teamId}/workspace`).then(d => {
          if (d?.files) {
            teamWorkspaceFiles = d.files;
            teamWorkspaceTree = d.tree || [];
          }
        }).catch(() => {});
      } else {
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
  }
  if (msg.type === 'team_manager_review_done') {
    refreshTeamsDebounced();
    if (activeTeamId === msg.teamId) {
      if (teamBoardTab === 'chat') {
        refreshVisibleTeamChat(msg.teamId, false);
      } else {
        loadTeamBoardData(msg.teamId).then(() => {
          if (teamBoardTab === 'chat') renderActiveTeamChat(msg.teamId, { forceBottom: false });
          else renderTeamBoard(msg.teamId);
        });
      }
    }
  }
  if (msg.type === 'team_manager_stream_start') {
    if (msg.teamId && msg.streamId) {
      ensureTeamManagerStream(msg.teamId, msg.streamId, {
        startedAt: Number(msg.startedAt || Date.now()),
        source: String(msg.source || 'conversation'),
        turn: Number(msg.turn || 1),
        completed: false,
      });
      refreshVisibleTeamChat(msg.teamId, false);
    }
  }
  if (msg.type === 'team_manager_stream_event') {
    const stream = applyTeamManagerStreamEvent(msg);
    if (stream) {
      const eventType = String(msg?.eventType || '').trim();
      if (eventType === 'token' || eventType === 'thinking_delta') {
        scheduleTeamDispatchRefresh(stream.teamId, false);
      } else {
        refreshVisibleTeamChat(stream.teamId, false);
      }
    }
  }
  if (msg.type === 'team_manager_stream_done') {
    if (msg.teamId && msg.streamId) {
      const stream = ensureTeamManagerStream(msg.teamId, msg.streamId, {
        startedAt: Number(msg.startedAt || Date.now()),
        source: String(msg.source || 'conversation'),
        turn: Number(msg.turn || 1),
      });
      if (stream) {
        stream.completed = true;
        stream.finishedAt = Number(msg.completedAt || Date.now());
        stream.durationMs = Math.max(Number(stream.durationMs || 0), Number(msg.durationMs || 0), stream.finishedAt - Number(stream.startedAt || Date.now()));
      }
      setTimeout(() => {
        const stillThere = getTeamManagerStreamMap(msg.teamId)?.[msg.streamId];
        if (!stillThere) return;
        removeTeamManagerStream(msg.teamId, msg.streamId);
        refreshVisibleTeamChat(msg.teamId, false);
      }, 3000);
      refreshVisibleTeamChat(msg.teamId, false);
    }
  }
  if (msg.type === 'team_member_stream_start') {
    if (msg.teamId && msg.streamId) {
      ensureTeamMemberStream(msg.teamId, msg.streamId, {
        agentId: String(msg.agentId || '').trim(),
        agentName: String(msg.agentName || msg.agentId || 'Team Member').trim(),
        startedAt: Number(msg.startedAt || Date.now()),
        completed: false,
      });
      refreshVisibleTeamChat(msg.teamId, false);
    }
  }
  if (msg.type === 'team_member_stream_event') {
    const stream = applyTeamMemberStreamEvent(msg);
    if (stream) {
      const eventType = String(msg?.eventType || '').trim();
      if (eventType === 'token' || eventType === 'thinking_delta') {
        scheduleTeamDispatchRefresh(stream.teamId, false);
      } else {
        refreshVisibleTeamChat(stream.teamId, false);
      }
    }
  }
  if (msg.type === 'team_member_stream_done') {
    if (msg.teamId && msg.streamId) {
      const stream = ensureTeamMemberStream(msg.teamId, msg.streamId, {
        agentId: String(msg.agentId || '').trim(),
        agentName: String(msg.agentName || msg.agentId || 'Team Member').trim(),
        startedAt: Number(msg.startedAt || Date.now()),
      });
      if (stream) {
        stream.completed = true;
        stream.finishedAt = Number(msg.completedAt || Date.now());
        stream.durationMs = Math.max(Number(stream.durationMs || 0), Number(msg.durationMs || 0), stream.finishedAt - Number(stream.startedAt || Date.now()));
      }
      setTimeout(() => {
        const stillThere = getTeamMemberStreamMap(msg.teamId)?.[msg.streamId];
        if (!stillThere) return;
        removeTeamMemberStream(msg.teamId, msg.streamId);
        refreshVisibleTeamChat(msg.teamId, false);
      }, 3000);
      refreshVisibleTeamChat(msg.teamId, false);
    }
  }
  if (msg.type === 'team_dispatch') {
    bgtToast(`📬 ${msg.agentId}`, `Running: ${(msg.task||'').slice(0,80)}`);
  }
  if (msg.type === 'team_dispatch_complete') {
    const icon = msg.success ? '?' : '?';
    bgtToast(`${icon} ${msg.agentId}`, (msg.resultPreview||'').slice(0,100));
    if (msg.teamId && msg.taskId) {
      const stream = ensureTeamDispatchStream(msg.teamId, msg.taskId, {
        agentId: msg.agentId || '',
        agentName: msg.agentName || msg.agentId || 'Subagent',
        durationMs: Number(msg.durationMs || 0),
        stepCount: Number(msg.stepCount || 0),
      });
      if (stream) {
        stream.completed = true;
        stream.status = msg.success ? 'finalizing' : 'failed';
        stream.finishedAt = Date.now();
        stream.durationMs = Math.max(Number(stream.durationMs || 0), stream.finishedAt - Number(stream.startedAt || Date.now()));
        if (msg.resultPreview && !stream.finalReply) stream.finalReply = String(msg.resultPreview);
      }
      setTimeout(() => {
        const stillThere = getTeamDispatchStreamMap(msg.teamId)?.[msg.taskId];
        if (!stillThere) return;
        removeTeamDispatchStream(msg.teamId, msg.taskId);
      }, 3000);
    }
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
    const chatMessage = getTeamEventChatMessage(msg);
    if (chatMessage?.metadata?.taskId) {
      removeTeamDispatchStream(msg.teamId, String(chatMessage.metadata.taskId));
    }
    if (chatMessage?.metadata?.runId) {
      removeTeamManagerStream(msg.teamId, String(chatMessage.metadata.runId));
      removeTeamMemberStream(msg.teamId, String(chatMessage.metadata.runId));
    }
    if (activeTeamId === msg.teamId && teamBoardTab === 'chat') {
      if (!chatMessage) return;
      if (teamChatStreamingState && teamChatStreamingState.teamId === msg.teamId && chatMessage.from === 'manager') {
        if (teamChatStreamingState.fallbackTimer) clearTimeout(teamChatStreamingState.fallbackTimer);
        teamChatStreamingState = null;
        scheduleNextTeamQueuedMessage(msg.teamId);
      }
      if (teamChatMessages.some((entry) => entry.id === chatMessage.id)) return;
      teamChatMessages = teamChatMessages.filter((entry) => !(
        entry?.metadata?.localStreamingFallback
        && chatMessage.from === entry.from
        && String(chatMessage.content || '').trim() === String(entry.content || '').trim()
      ));
      teamChatMessages.push(chatMessage);
      teamChatMessages = mergeDispatchMetadataIntoMessages(msg.teamId, teamChatMessages);
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
  if (msg.type === 'approval_created') {
    bgtToast(`⏳ Command Approval`, (msg.summary || 'New command approval').slice(0, 100));
    const badge = document.getElementById('approvals-badge');
    if (badge) { badge.style.display = 'inline-block'; badge.textContent = '+'; }
    if (currentMode === 'approvals' && typeof loadApprovals === 'function') loadApprovals();
    loadSessionApprovals();
  }
  if (msg.type === 'proposal_approved') {
    if (currentMode === 'proposals') loadProposals();
  }
  if (msg.type === 'approval_approved') {
    if (currentMode === 'approvals' && typeof loadApprovals === 'function') loadApprovals();
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
  if (msg.type === 'approval_executing') {
    bgtToast(`⏳ Executing command`, (msg.summary || 'Approved command running...').slice(0, 100));
    if (currentMode === 'approvals' && typeof loadApprovals === 'function') loadApprovals();
    const execSessionId = msg.sessionId || `approval_${msg.approvalId}`;
    if (execSessionId) {
      const existIdx = chatSessions.findIndex(s => s.id === execSessionId);
      if (existIdx === -1) {
        chatSessions.push({
          id: execSessionId,
          title: `⌘ ${msg.summary || 'Command execution'}`,
          history: [{ role: 'assistant', content: `⏳ **Executing approved command**\n\nThis command is running in the background. Results will appear here when complete.` }],
          processLog: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          automated: true,
          unread: true,
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
  if (msg.type === 'approval_executed') {
    bgtToast(`✅ Command complete`, (msg.summary || 'Approved command complete').slice(0, 100));
    if (currentMode === 'approvals' && typeof loadApprovals === 'function') loadApprovals();
    const execSessionId = msg.sessionId || `approval_${msg.approvalId}`;
    const sessIdx = chatSessions.findIndex(s => s.id === execSessionId);
    const completionMsg = `✅ **Approved command executed**\n\nCheck the Approvals panel for the command output preview.`;
    if (sessIdx !== -1) {
      chatSessions[sessIdx].history.push({ role: 'assistant', content: completionMsg });
      chatSessions[sessIdx].updatedAt = Date.now();
      chatSessions[sessIdx].unread = execSessionId !== activeChatSessionId;
      chatSessions[sessIdx].title = `✅ ${msg.summary || 'Approved command'}`;
    } else {
      chatSessions.push({
        id: execSessionId,
        title: `✅ ${msg.summary || 'Approved command'}`,
        history: [{ role: 'assistant', content: completionMsg }],
        processLog: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        automated: true,
        unread: true,
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
  if (msg.type === 'approval_failed') {
    bgtToast(`❌ Command failed`, ((msg.summary || 'Approved command failed') + (msg.error ? `: ${msg.error}` : '')).slice(0, 100));
    if (currentMode === 'approvals' && typeof loadApprovals === 'function') loadApprovals();
    const execSessionId = msg.sessionId || `approval_${msg.approvalId}`;
    const sessIdx = chatSessions.findIndex(s => s.id === execSessionId);
    const failMsg = `❌ **Approved command failed**\n\n${msg.error || 'An error occurred during execution.'}`;
    if (sessIdx !== -1) {
      chatSessions[sessIdx].history.push({ role: 'assistant', content: failMsg });
      chatSessions[sessIdx].updatedAt = Date.now();
      chatSessions[sessIdx].unread = true;
      chatSessions[sessIdx].title = `❌ ${msg.summary || 'Approved command'}`;
    } else {
      chatSessions.push({
        id: execSessionId,
        title: `❌ ${msg.summary || 'Approved command'}`,
        history: [{ role: 'assistant', content: failMsg }],
        processLog: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        automated: true,
        unread: true,
      });
    }
    saveChatSessions();
    renderSessionsList();
  }
  if (msg.type === 'proposal_denied') {
    if (currentMode === 'proposals') loadProposals();
    checkPendingProposalsBadge();
  }
  if (msg.type === 'approval_denied' || msg.type === 'approval_expired') {
    if (currentMode === 'approvals' && typeof loadApprovals === 'function') loadApprovals();
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
window.toggleTeamRunCard = toggleTeamRunCard;
window.renderTeamChatTab = renderTeamChatTab;
window.renderTeamCharacters = renderTeamCharacters;
window.sendTeamChat = sendTeamChat;
window.abortTeamChat = abortTeamChat;
window.selectTeamChatMention = selectTeamChatMention;
window.triggerManagerReview = triggerManagerReview;
window.runAllTeamAgents = runAllTeamAgents;
window.toggleTeamRunPause = toggleTeamRunPause;
window.saveTeamContextNotes = saveTeamContextNotes;
window.openTeamContextRefModal = openTeamContextRefModal;
window.closeTeamContextRefModal = closeTeamContextRefModal;
window.saveTeamContextReferenceModal = saveTeamContextReferenceModal;
window.deleteTeamContextReferenceCard = deleteTeamContextReferenceCard;
window.uploadTeamContextFile = uploadTeamContextFile;
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
window.loadTeamMemoryFiles = loadTeamMemoryFiles;
window.openTeamWorkspaceFile = openTeamWorkspaceFile;
window.reloadTeamWorkspaceFile = reloadTeamWorkspaceFile;
window.saveTeamWorkspaceFile = saveTeamWorkspaceFile;
window.closeTeamWorkspaceFile = closeTeamWorkspaceFile;
window.renderTeamSubagentsTab = renderTeamSubagentsTab;
window.openTeamSubagentDetail = openTeamSubagentDetail;
window.switchTeamSubagentTab = switchTeamSubagentTab;
window.saveTeamSubagentSystemPrompt = saveTeamSubagentSystemPrompt;
window.reloadTeamSubagentSystemPrompt = reloadTeamSubagentSystemPrompt;
window.saveTeamSubagentHeartbeatMd = saveTeamSubagentHeartbeatMd;
window.saveTeamSubagentHbConfig = saveTeamSubagentHbConfig;
window.tickTeamSubagentHeartbeat = tickTeamSubagentHeartbeat;
window.saveTeamSubagentCtxRef = saveTeamSubagentCtxRef;
window.deleteTeamSubagentCtxRef = deleteTeamSubagentCtxRef;
window.getTeamContextReferences = getTeamContextReferences;
window.renderTeamContextReferenceCards = renderTeamContextReferenceCards;
window.getTeamChatSignature = getTeamChatSignature;
window.renderActiveTeamChat = renderActiveTeamChat;
window.showMoreTeamChat = showMoreTeamChat;
window.toggleTeamChatProcess = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === 'none' || !el.style.display ? 'block' : 'none';
};
window.toggleTeamDispatchBubble = toggleTeamDispatchBubble;
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
