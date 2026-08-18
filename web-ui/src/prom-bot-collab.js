const GROUPS_KEY = 'prometheus_prom_bot_groups_v1';
const GROUP_HOST_ID = 'prom-bot-group-host';
const GROUP_LIST_ID = 'prom-bot-groups-list';
const GROUP_MODAL_ID = 'prom-bot-group-modal';
const MENTION_MENU_ID = 'prom-bot-mention-menu';
const SEEN_KEY = 'prometheus_prom_bot_seen_v1';
const MAX_GROUPS = 20;
const MAX_GROUP_MESSAGES = 300;
const MAX_GROUP_MEMBERS = 6;
const MAX_GROUP_STREAMS = 3;

let groups = [];
let activeGroupId = '';
let rendererPromise = null;
let directMentionSignature = '';
let directMentionAt = 0;
let chromeObserver = null;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uid(prefix) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${id}`;
}

function normalizeGroup(input) {
  if (!input || typeof input !== 'object') return null;
  const id = String(input.id || '').trim();
  const memberIds = Array.from(new Set((Array.isArray(input.memberIds) ? input.memberIds : [])
    .map((item) => String(item || '').trim()).filter(Boolean))).slice(0, MAX_GROUP_MEMBERS);
  if (!id || memberIds.length < 2) return null;
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .filter((message) => message && typeof message === 'object' && !message.streaming)
    .slice(-MAX_GROUP_MESSAGES)
    .map((message) => ({
      id: String(message.id || uid('msg')),
      role: message.role === 'user' ? 'user' : 'assistant',
      content: String(message.content || '').slice(0, 12000),
      timestamp: Number(message.timestamp || Date.now()) || Date.now(),
      agentId: String(message.agentId || ''),
      workflowLabel: String(message.workflowLabel || ''),
    }));
  return {
    id,
    title: String(input.title || 'Bot group').trim().slice(0, 80) || 'Bot group',
    memberIds,
    messages,
    createdAt: Number(input.createdAt || Date.now()) || Date.now(),
    updatedAt: Number(input.updatedAt || input.createdAt || Date.now()) || Date.now(),
  };
}

function loadGroups() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]');
    groups = (Array.isArray(parsed) ? parsed : []).map(normalizeGroup).filter(Boolean).slice(-MAX_GROUPS);
  } catch {
    groups = [];
  }
}

function saveGroups() {
  const serializable = groups.slice(-MAX_GROUPS).map((group) => ({
    ...group,
    messages: group.messages.filter((message) => !message.streaming).slice(-MAX_GROUP_MESSAGES),
  }));
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify(serializable)); } catch {}
}

function markDirectSeen(agentId) {
  const id = String(agentId || '').trim();
  if (!id) return;
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    const next = seen && typeof seen === 'object' ? seen : {};
    next[id] = Math.max(Number(next[id] || 0), Date.now());
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {}
}

function roster() {
  const fromIntelligence = typeof window.getPromBotRosterMetadata === 'function'
    ? window.getPromBotRosterMetadata()
    : [];
  if (Array.isArray(fromIntelligence) && fromIntelligence.length) {
    return fromIntelligence.map((agent) => ({
      id: String(agent.id || '').trim(),
      name: String(agent.name || agent.id || '').trim(),
      model: String(agent.model || '').trim(),
    })).filter((agent) => agent.id);
  }
  return Array.from(document.querySelectorAll('#prom-bot-subagents-list .prom-bot-agent-row')).map((row) => ({
    id: String(row.dataset.agentId || '').trim(),
    name: String(row.querySelector('.prom-bot-agent-name')?.textContent || row.dataset.agentId || '').trim(),
    model: String(row.querySelector('.prom-bot-agent-meta')?.textContent || '').trim(),
  })).filter((agent) => agent.id);
}

function agentById(id) {
  return roster().find((agent) => agent.id === id) || { id, name: id };
}

function mentionHandle(agent) {
  const source = String(agent?.name || agent?.id || 'bot').trim();
  return source.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || String(agent?.id || 'bot');
}

function mentionAliases(agent) {
  const name = String(agent?.name || '').trim().toLowerCase();
  const id = String(agent?.id || '').trim().toLowerCase();
  return new Set([
    mentionHandle(agent).toLowerCase(),
    id,
    name.replace(/\s+/g, ''),
    name.replace(/\s+/g, '-'),
  ].filter(Boolean));
}

function resolveMentions(text, candidates) {
  const handles = Array.from(String(text || '').matchAll(/@([a-zA-Z0-9_.-]+)/g)).map((match) => match[1].toLowerCase());
  if (!handles.length) return [];
  return (Array.isArray(candidates) ? candidates : []).filter((agent) => {
    const aliases = mentionAliases(agent);
    return handles.some((handle) => aliases.has(handle));
  });
}

async function mapLimit(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor++;
      out[index] = await mapper(list[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function groupById(id) {
  return groups.find((group) => group.id === id) || null;
}

function groupMembers(group) {
  return (group?.memberIds || []).map(agentById).filter((agent) => agent.id);
}

function installStyles() {
  if (document.getElementById('prom-bot-collab-styles')) return;
  const style = document.createElement('style');
  style.id = 'prom-bot-collab-styles';
  style.textContent = `
    .prom-bot-group-actions { display:flex; align-items:center; gap:6px; }
    .prom-bot-new-group { width:100%; border:1px solid var(--sidebar-icon-border,var(--line)); background:transparent; color:var(--sidebar-text,var(--text)); border-radius:8px; padding:6px 8px; font:inherit; font-size:10px; font-weight:750; text-align:left; cursor:pointer; }
    .prom-bot-new-group:hover { background:var(--sidebar-item-hover,var(--panel-2)); }
    .prom-bot-groups-list { display:flex; flex-direction:column; gap:2px; }
    .prom-bot-groups-label { padding:3px 8px 4px; font-size:9px; font-weight:800; letter-spacing:.11em; text-transform:uppercase; color:var(--sidebar-muted,var(--muted)); }
    .prom-bot-group-row.chat-session-item.job-item { width:100%; box-sizing:border-box; display:grid; grid-template-columns:30px minmax(0,1fr) auto; gap:9px; align-items:center; padding:7px 8px; font:inherit; text-align:left; }
    .prom-bot-group-avatar { width:30px; height:30px; display:grid; place-items:center; border-radius:9px; background:var(--sidebar-icon-bg,var(--panel-2)); border:1px solid var(--sidebar-icon-border,var(--line)); color:var(--pm-gold,var(--brand)); font-size:11px; font-weight:850; }
    .prom-bot-group-title { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:700; }
    .prom-bot-group-meta { display:block; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:9px; color:var(--sidebar-muted,var(--muted)); }
    .prom-bot-group-delete { border:0; background:transparent; color:var(--sidebar-muted,var(--muted)); cursor:pointer; border-radius:6px; padding:4px; font-size:13px; }
    #${GROUP_HOST_ID} { position:absolute; inset:0; z-index:14; display:flex; min-width:0; min-height:0; overflow:hidden; background:var(--pm-chat-page-bg,var(--bg)); }
    .prom-bot-group-shell { width:100%; height:100%; min-height:0; display:flex; flex-direction:column; }
    .prom-bot-group-messages { flex:1; min-height:0; overflow-y:auto; padding:16px 0 8px; }
    .prom-bot-group-empty { color:var(--muted); text-align:center; padding:56px 20px; font-size:12px; line-height:1.55; }
    .prom-bot-group-modal { position:fixed; inset:0; z-index:10020; display:grid; place-items:center; background:rgba(0,0,0,.48); backdrop-filter:blur(8px); }
    .prom-bot-group-modal-card { width:min(460px,calc(100vw - 32px)); max-height:min(650px,calc(100vh - 48px)); overflow:auto; border:1px solid var(--line); border-radius:16px; background:var(--panel); color:var(--text); box-shadow:0 28px 90px rgba(0,0,0,.38); padding:16px; }
    .prom-bot-group-modal-title { font-size:15px; font-weight:850; }
    .prom-bot-group-modal-sub { margin-top:4px; font-size:11px; color:var(--muted); }
    .prom-bot-group-title-input { width:100%; box-sizing:border-box; margin-top:12px; border:1px solid var(--line); border-radius:9px; background:var(--panel-2); color:var(--text); padding:8px 10px; font:inherit; }
    .prom-bot-group-picker { display:flex; flex-direction:column; gap:5px; margin-top:10px; }
    .prom-bot-group-choice { display:flex; align-items:center; gap:9px; border:1px solid var(--line); border-radius:9px; padding:8px 9px; background:var(--panel-2); font-size:11px; }
    .prom-bot-group-choice span { flex:1; min-width:0; }
    .prom-bot-group-modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
    .prom-bot-group-modal-actions button { border:1px solid var(--line); border-radius:8px; padding:7px 11px; font:inherit; font-size:11px; font-weight:750; cursor:pointer; background:var(--panel-2); color:var(--text); }
    .prom-bot-group-modal-actions .primary { background:var(--brand); color:#fff; border-color:var(--brand); }
    .prom-bot-mention-menu { position:fixed; z-index:10030; min-width:190px; max-width:280px; border:1px solid var(--line); border-radius:10px; padding:5px; background:var(--panel); box-shadow:0 16px 46px rgba(0,0,0,.28); }
    .prom-bot-mention-option { width:100%; border:0; background:transparent; color:var(--text); border-radius:7px; padding:7px 8px; display:flex; align-items:center; justify-content:space-between; gap:8px; font:inherit; font-size:11px; text-align:left; cursor:pointer; }
    .prom-bot-mention-option:hover { background:var(--panel-2); }
    .prom-bot-mention-handle { color:var(--muted); font-size:9px; }
  `;
  document.head.appendChild(style);
}

async function ensureRenderer() {
  if (window.__PROM_UNIFIED_DESKTOP_CHAT) return window.__PROM_UNIFIED_DESKTOP_CHAT;
  if (!rendererPromise) {
    rendererPromise = import('./pages/ChatPage.js').then(() => window.__PROM_UNIFIED_DESKTOP_CHAT || null).finally(() => {
      if (!window.__PROM_UNIFIED_DESKTOP_CHAT) rendererPromise = null;
    });
  }
  return rendererPromise;
}

function persistGroupMessage(group, message) {
  group.messages.push(message);
  if (group.messages.length > MAX_GROUP_MESSAGES) group.messages.splice(0, group.messages.length - MAX_GROUP_MESSAGES);
  group.updatedAt = Date.now();
  saveGroups();
}

function ensureGroupChrome() {
  const toolbar = document.querySelector('#prom-bot-sidebar-section .prom-bot-roster-toolbar');
  const list = document.getElementById('prom-bot-subagents-list');
  if (!toolbar || !list) return;
  let actions = toolbar.querySelector('.prom-bot-group-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'prom-bot-group-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'prom-bot-new-group';
    button.textContent = '+ Group chat';
    button.addEventListener('click', openGroupCreator);
    actions.appendChild(button);
    toolbar.appendChild(actions);
  }
  let groupsList = document.getElementById(GROUP_LIST_ID);
  if (!groupsList) {
    groupsList = document.createElement('div');
    groupsList.id = GROUP_LIST_ID;
    groupsList.className = 'prom-bot-groups-list';
    list.parentElement?.insertBefore(groupsList, list);
  }
  renderGroupRows();
  bindRosterSearch();
}

function renderGroupRows() {
  const host = document.getElementById(GROUP_LIST_ID);
  if (!host) return;
  host.replaceChildren();
  const search = String(document.getElementById('prom-bot-roster-search')?.value || '').trim().toLowerCase();
  const visible = groups.filter((group) => {
    const memberNames = groupMembers(group).map((agent) => agent.name).join(' ');
    return !search || `${group.title} ${memberNames}`.toLowerCase().includes(search);
  });
  if (!visible.length) return;
  const label = document.createElement('div');
  label.className = 'prom-bot-groups-label';
  label.textContent = 'Groups';
  host.appendChild(label);
  for (const group of visible) {
    const members = groupMembers(group);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `prom-bot-group-row chat-session-item job-item${group.id === activeGroupId ? ' active' : ''}`;
    row.dataset.groupId = group.id;
    row.innerHTML = `<span class="prom-bot-group-avatar">${members.length}</span><span><span class="prom-bot-group-title">${esc(group.title)}</span><span class="prom-bot-group-meta">${esc(members.map((member) => member.name).join(', '))}</span></span><span class="prom-bot-group-delete" title="Delete group" aria-label="Delete group">×</span>`;
    row.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.prom-bot-group-delete')) {
        event.stopPropagation();
        deleteGroup(group.id);
        return;
      }
      void openGroup(group.id);
    });
    host.appendChild(row);
  }
}

function bindRosterSearch() {
  const input = document.getElementById('prom-bot-roster-search');
  if (!input || input.dataset.promBotGroupsBound === '1') return;
  input.dataset.promBotGroupsBound = '1';
  input.addEventListener('input', renderGroupRows);
}

function openGroupCreator() {
  closeGroupCreator();
  const agents = roster();
  if (agents.length < 2) {
    window.showToast?.('Prom Bot groups', 'Create at least two subagents first.', 'warning');
    return;
  }
  const modal = document.createElement('div');
  modal.id = GROUP_MODAL_ID;
  modal.className = 'prom-bot-group-modal';
  modal.innerHTML = `<div class="prom-bot-group-modal-card" role="dialog" aria-modal="true" aria-label="Create Prom Bot group"><div class="prom-bot-group-modal-title">New group chat</div><div class="prom-bot-group-modal-sub">Choose 2–${MAX_GROUP_MEMBERS} bots. @mention members to target a turn; no mention asks the room.</div><input id="prom-bot-group-title-input" class="prom-bot-group-title-input" placeholder="Group name (optional)" maxlength="80"><div class="prom-bot-group-picker">${agents.map((agent) => `<label class="prom-bot-group-choice"><input type="checkbox" value="${esc(agent.id)}"><span><strong>${esc(agent.name)}</strong><br><small>@${esc(mentionHandle(agent))}</small></span></label>`).join('')}</div><div class="prom-bot-group-modal-actions"><button type="button" data-action="cancel">Cancel</button><button type="button" class="primary" data-action="create">Create group</button></div></div>`;
  modal.addEventListener('click', (event) => {
    if (event.target === modal || (event.target instanceof Element && event.target.closest('[data-action="cancel"]'))) closeGroupCreator();
    if (event.target instanceof Element && event.target.closest('[data-action="create"]')) createGroupFromModal();
  });
  document.body.appendChild(modal);
  requestAnimationFrame(() => document.getElementById('prom-bot-group-title-input')?.focus());
}

function closeGroupCreator() {
  document.getElementById(GROUP_MODAL_ID)?.remove();
}

function createGroupFromModal() {
  const modal = document.getElementById(GROUP_MODAL_ID);
  if (!modal) return;
  const selected = Array.from(modal.querySelectorAll('input[type="checkbox"]:checked'))
    .map((input) => String(input.value || '')).filter(Boolean);
  if (selected.length < 2 || selected.length > MAX_GROUP_MEMBERS) {
    window.showToast?.('Prom Bot groups', `Choose between 2 and ${MAX_GROUP_MEMBERS} bots.`, 'warning');
    return;
  }
  const members = selected.map(agentById);
  const titleInput = document.getElementById('prom-bot-group-title-input');
  const title = String(titleInput?.value || '').trim() || members.map((agent) => agent.name).join(' + ');
  const group = normalizeGroup({ id: uid('group'), title, memberIds: selected, messages: [], createdAt: Date.now(), updatedAt: Date.now() });
  if (!group) return;
  groups.push(group);
  groups = groups.slice(-MAX_GROUPS);
  saveGroups();
  closeGroupCreator();
  renderGroupRows();
  void openGroup(group.id);
}

function deleteGroup(groupId) {
  groups = groups.filter((group) => group.id !== groupId);
  saveGroups();
  if (activeGroupId === groupId) closeGroup();
  renderGroupRows();
}

function closeGroup() {
  document.getElementById(GROUP_HOST_ID)?.remove();
  document.getElementById('chat-view')?.classList.remove('prom-bot-group-active');
  activeGroupId = '';
  window.promBotActiveGroupId = '';
  hideMentionMenu();
  renderGroupRows();
}

async function openGroup(groupId) {
  const group = groupById(groupId);
  if (!group) return;
  window.closePromBotChat?.({ keepMode: true });
  if (typeof window.setMode === 'function') window.setMode('chat');
  closeGroup();
  const chatView = document.getElementById('chat-view');
  if (!chatView) return;
  chatView.classList.add('prom-bot-group-active');
  if (getComputedStyle(chatView).position === 'static') chatView.style.position = 'relative';
  const host = document.createElement('div');
  host.id = GROUP_HOST_ID;
  chatView.appendChild(host);
  activeGroupId = group.id;
  window.promBotActiveGroupId = group.id;
  renderGroupRows();
  await renderGroupRoom();
}

function normalizedGroupMessage(message) {
  return {
    ...message,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: String(message.content || ''),
    timestamp: Number(message.timestamp || Date.now()) || Date.now(),
    workflowLabel: message.workflowLabel || (message.agentId ? agentById(message.agentId).name : ''),
  };
}

async function renderGroupRoom() {
  const group = groupById(activeGroupId);
  const host = document.getElementById(GROUP_HOST_ID);
  if (!group || !host) return;
  const renderer = await ensureRenderer();
  if (!renderer || activeGroupId !== group.id || !host.isConnected) return;
  const members = groupMembers(group);
  const stable = group.messages.filter((message) => !message.streaming).map(normalizedGroupMessage);
  const live = group.messages.filter((message) => message.streaming).map(normalizedGroupMessage);
  const sessionId = `prom_bot_group_${group.id}`;
  const historyHtml = stable.length ? renderer.renderHistory(stable, { sessionId, readonly: true, hideSideChatBoundary: true }) : '';
  const liveHtml = live.map((message) => renderer.renderLiveMessage({ ...message, _backgroundAgentLive: true, streaming: true }, { sessionId })).join('');
  host.innerHTML = `<section class="unified-agent-chat-shell prom-bot-group-shell" aria-label="${esc(group.title)} group chat"><header class="unified-agent-chat-header"><div class="side-chat-title-wrap"><div class="side-chat-kicker">Prom Bot group</div><div class="side-chat-title">${esc(group.title)}</div><div class="unified-agent-chat-participants">${esc(members.map((agent) => `${agent.name} · @${mentionHandle(agent)}`).join('   '))}</div></div><button class="side-chat-close" type="button" onclick="closePromBotGroup()" aria-label="Close group">×</button></header><div id="prom-bot-group-messages" class="unified-agent-chat-messages prom-bot-group-messages">${historyHtml || liveHtml ? `${historyHtml}${liveHtml}` : '<div class="prom-bot-group-empty">Start chatting with the room.<br>@mention a bot to target them, or send without a mention to ask everyone.</div>'}</div>${renderer.renderComposer({ inputId: 'prom-bot-group-input', sendButtonId: 'prom-bot-group-send', composerClass: 'unified-agent-chat-composer prom-bot-group-composer', placeholder: 'Message the room or @mention a bot', attachAction: "window.showToast?.('Prom Bot groups','Group attachments are not wired in this lightweight room yet.','info')", voiceAction: 'startPromBotGroupVoice()', sendAction: 'sendPromBotGroupMessage()', inputAttributes: 'oninput="refreshPromBotMentionMenu(this)" onkeydown="handlePromBotGroupKeydown(event)"', footerHint: '@Bot targets members · no mention asks the room' })}</section>`;
  requestAnimationFrame(() => {
    const messages = document.getElementById('prom-bot-group-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    const input = document.getElementById('prom-bot-group-input');
    bindMentionInput(input, () => groupMembers(group));
    input?.focus({ preventScroll: true });
  });
}

function recentRoomTranscript(group, limit = 12) {
  return group.messages.filter((message) => !message.streaming).slice(-limit).map((message) => {
    const actor = message.role === 'user' ? 'User' : (message.workflowLabel || agentById(message.agentId).name || 'Bot');
    return `${actor}: ${String(message.content || '').replace(/\s+/g, ' ').slice(0, 800)}`;
  }).join('\n');
}

function buildRuntimeGroupMessage(group, senderText, target) {
  const members = groupMembers(group);
  const transcript = recentRoomTranscript(group);
  return `[PROM BOT GROUP ROOM: ${group.title}]\nParticipants: ${members.map((agent) => `${agent.name} (@${mentionHandle(agent)})`).join(', ')}\n\nRecent room transcript:\n${transcript || '(new room)'}\n\nCurrent user message:\n${senderText}\n\nYou are ${target.name}. Reply to this room naturally and in-context. If you need a specific teammate, refer to them by @name in your response. If this message is not relevant to you and you have nothing useful to add, reply with exactly [PASS].`;
}

async function consumeAgentStream(agent, message, onUpdate = null, options = {}) {
  const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({
      message,
      visibleMessage: String(options.visibleMessage || message),
      source: String(options.source || 'prom_bot_handoff'),
      attachmentPreviews: [],
      timeoutMs: 300000,
    }),
  });
  if (!res.ok) throw new Error(`${agent.name}: HTTP ${res.status}`);
  if (!res.body) throw new Error(`${agent.name}: no response body`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
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
      if (event.type === 'token') {
        content += String(event.text || '');
        onUpdate?.(content);
      } else if (event.type === 'final' || event.type === 'done') {
        const final = String(event.reply || event.text || '').trim();
        if (final && (!content.trim() || final.length >= content.trim().length)) content = final;
        onUpdate?.(content);
      } else if (event.type === 'error') {
        throw new Error(String(event.message || `${agent.name} stream failed`));
      }
    }
  }
  return content.trim();
}

async function streamGroupReply(group, agent, userText) {
  const pending = { id: uid('reply'), role: 'assistant', content: '', timestamp: Date.now(), agentId: agent.id, workflowLabel: agent.name, streaming: true };
  group.messages.push(pending);
  await renderGroupRoom();
  try {
    const reply = await consumeAgentStream(
      agent,
      buildRuntimeGroupMessage(group, userText, agent),
      (content) => { pending.content = content; void renderGroupRoom(); },
      { visibleMessage: `[Prom Bot group · ${group.title}] ${userText}`, source: `prom_bot_group:${group.id}` },
    );
    if (/^\[PASS\]$/i.test(reply)) {
      group.messages = group.messages.filter((message) => message !== pending);
    } else {
      pending.streaming = false;
      pending.content = reply || '(No response received.)';
      pending.timestamp = Date.now();
      group.updatedAt = Date.now();
    }
    // Group participation is not an unread DM. Keep the direct-chat read cursor
    // ahead of room-generated traffic until room-specific server threads land.
    markDirectSeen(agent.id);
  } catch (error) {
    pending.streaming = false;
    pending.content = `Error: ${error?.message || String(error)}`;
    pending.timestamp = Date.now();
  }
  saveGroups();
  await renderGroupRoom();
}

async function sendGroupMessage() {
  const group = groupById(activeGroupId);
  const input = document.getElementById('prom-bot-group-input');
  const text = String(input?.value || '').trim();
  if (!group || !text) return;
  if (input) input.value = '';
  hideMentionMenu();
  persistGroupMessage(group, { id: uid('user'), role: 'user', content: text, timestamp: Date.now() });
  await renderGroupRoom();
  const members = groupMembers(group);
  const mentioned = resolveMentions(text, members);
  const targets = mentioned.length ? mentioned : members;
  await mapLimit(targets, MAX_GROUP_STREAMS, (agent) => streamGroupReply(group, agent, text));
}

function groupKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void sendGroupMessage();
  }
}

function startGroupVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    window.showToast?.('Voice unavailable', 'Speech recognition is unavailable in this browser.', 'warning');
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.onresult = (event) => {
    const text = Array.from(event.results || []).map((result) => result?.[0]?.transcript || '').join(' ').trim();
    const input = document.getElementById('prom-bot-group-input');
    if (input) input.value = text;
  };
  recognition.onend = () => {
    if (String(document.getElementById('prom-bot-group-input')?.value || '').trim()) void sendGroupMessage();
  };
  recognition.start();
}

function hideMentionMenu() {
  document.getElementById(MENTION_MENU_ID)?.remove();
}

function mentionFragment(input) {
  if (!input) return null;
  const start = Number(input.selectionStart || 0);
  const before = String(input.value || '').slice(0, start);
  const match = before.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);
  if (!match) return null;
  return { query: String(match[1] || '').toLowerCase(), start: start - match[1].length - 1, end: start };
}

function refreshMentionMenu(input) {
  if (!input) return;
  const fragment = mentionFragment(input);
  const provider = input.__promBotMentionCandidates;
  const candidates = typeof provider === 'function' ? provider() : roster();
  if (!fragment) {
    hideMentionMenu();
    return;
  }
  const filtered = candidates.filter((agent) => {
    const handle = mentionHandle(agent);
    return !fragment.query || handle.includes(fragment.query) || String(agent.name || '').toLowerCase().includes(fragment.query);
  }).slice(0, 8);
  if (!filtered.length) {
    hideMentionMenu();
    return;
  }
  let menu = document.getElementById(MENTION_MENU_ID);
  if (!menu) {
    menu = document.createElement('div');
    menu.id = MENTION_MENU_ID;
    menu.className = 'prom-bot-mention-menu';
    document.body.appendChild(menu);
  }
  menu.replaceChildren();
  for (const agent of filtered) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'prom-bot-mention-option';
    option.innerHTML = `<span>${esc(agent.name)}</span><span class="prom-bot-mention-handle">@${esc(mentionHandle(agent))}</span>`;
    option.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const handle = `@${mentionHandle(agent)} `;
      const value = String(input.value || '');
      input.value = `${value.slice(0, fragment.start)}${handle}${value.slice(fragment.end)}`;
      const caret = fragment.start + handle.length;
      input.setSelectionRange?.(caret, caret);
      hideMentionMenu();
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    menu.appendChild(option);
  }
  const rect = input.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 290, rect.left))}px`;
  menu.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 6)}px`;
}

function bindMentionInput(input, candidatesProvider = null) {
  if (!input) return;
  input.__promBotMentionCandidates = candidatesProvider || (() => roster());
  if (input.dataset.promBotMentionBound === '1') return;
  input.dataset.promBotMentionBound = '1';
  input.addEventListener('input', () => refreshMentionMenu(input));
  input.addEventListener('blur', () => setTimeout(hideMentionMenu, 120));
}

async function dispatchDirectMentionHandoff(agent, text, sourceAgent) {
  const sourceLabel = sourceAgent?.name || sourceAgent?.id || 'another Prom Bot';
  const runtimeMessage = `[Prom Bot @mention handoff from ${sourceLabel}]\n${text}\n\nRespond in your direct Prom Bot thread so the user can pick up your reply there.`;
  try {
    await consumeAgentStream(agent, runtimeMessage, null, {
      visibleMessage: `[Handoff from ${sourceLabel}] ${text}`,
      source: 'prom_bot_direct_handoff',
    });
  } catch (error) {
    console.warn('[Prom Bot] mention handoff failed:', error);
  } finally {
    void window.refreshPromBotRosterIntelligence?.({ force: true });
  }
}

function maybeDispatchDirectMentions(text) {
  const raw = String(text || '').trim();
  const currentId = String(window.promBotActiveAgentId || '').trim();
  if (!raw || !currentId || activeGroupId) return;
  const agents = roster();
  const current = agents.find((agent) => agent.id === currentId) || agentById(currentId);
  const targets = resolveMentions(raw, agents).filter((agent) => agent.id !== currentId);
  if (!targets.length) return;
  const signature = `${currentId}|${targets.map((agent) => agent.id).sort().join(',')}|${raw}`;
  if (signature === directMentionSignature && Date.now() - directMentionAt < 1600) return;
  directMentionSignature = signature;
  directMentionAt = Date.now();
  window.showToast?.('Prom Bot handoff', `Sent to ${targets.map((agent) => agent.name).join(', ')}. Replies will appear in their Prom Bot threads.`, 'info');
  void mapLimit(targets, MAX_GROUP_STREAMS, (agent) => dispatchDirectMentionHandoff(agent, raw, current));
}

function bindDirectMentionCapture() {
  document.addEventListener('keydown', (event) => {
    const input = event.target instanceof Element && event.target.id === 'subagent-chat-input' ? event.target : null;
    if (!input) return;
    bindMentionInput(input, () => roster().filter((agent) => agent.id !== String(window.promBotActiveAgentId || '')));
    if (event.key === 'Enter' && !event.shiftKey) maybeDispatchDirectMentions(input.value);
  }, true);
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('#subagent-chat-send-button')) {
      const input = document.getElementById('subagent-chat-input');
      maybeDispatchDirectMentions(input?.value || '');
    }
    if (activeGroupId && target?.closest('#prom-bot-subagents-list .prom-bot-agent-row')) closeGroup();
    if (activeGroupId && target?.closest('#sidebarPromBotToggle') && window.promBotMode) closeGroup();
  }, true);
}

function bindSidebarExit() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.dataset.promBotGroupExitBound === '1') return;
  sidebar.dataset.promBotGroupExitBound = '1';
  sidebar.addEventListener('click', (event) => {
    if (!activeGroupId) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('#prom-bot-sidebar-section') || target.closest('#sidebarPromBotToggle') || target.closest('.sidebar-header-btn')) return;
    closeGroup();
  }, true);
}

function initCollaboration() {
  installStyles();
  loadGroups();
  ensureGroupChrome();
  bindSidebarExit();
  bindDirectMentionCapture();
  chromeObserver = new MutationObserver(() => {
    const chromeMissing = !document.getElementById(GROUP_LIST_ID)
      || !document.querySelector('#prom-bot-sidebar-section .prom-bot-group-actions');
    if (chromeMissing) ensureGroupChrome();
    bindSidebarExit();
    const directInput = document.getElementById('subagent-chat-input');
    if (directInput) bindMentionInput(directInput, () => roster().filter((agent) => agent.id !== String(window.promBotActiveAgentId || '')));
  });
  chromeObserver.observe(document.body, { childList: true, subtree: true });
}

window.openPromBotGroupCreator = openGroupCreator;
window.closePromBotGroupCreator = closeGroupCreator;
window.openPromBotGroup = openGroup;
window.closePromBotGroup = closeGroup;
window.sendPromBotGroupMessage = sendGroupMessage;
window.handlePromBotGroupKeydown = groupKeydown;
window.startPromBotGroupVoice = startGroupVoice;
window.refreshPromBotMentionMenu = refreshMentionMenu;
window.getPromBotGroups = () => groups.map((group) => ({ ...group, memberIds: [...group.memberIds], messages: group.messages.map((message) => ({ ...message })) }));
window.getPromBotGroup = (groupId) => {
  const group = groupById(groupId);
  return group ? { ...group, memberIds: [...group.memberIds], messages: group.messages.map((message) => ({ ...message })) } : null;
};
window.deletePromBotGroup = deleteGroup;
window.promBotMentionHandle = mentionHandle;
window.promBotActiveGroupId = '';

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCollaboration, { once: true });
else initCollaboration();
