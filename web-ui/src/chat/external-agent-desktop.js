// Desktop agent switcher (stage 3 live agents), bottom-left of the main
// composer card (approved minimal design "C"). Only the switcher is added; the
// rest of the composer is untouched.
//
// - Hidden unless at least one external agent is selectable, so users who never
//   turn an agent on see no change.
// - Editable on a new (empty) chat; locked (shown, not clickable) once the chat
//   is bound; hidden on native chats that already have messages.
// - The original model button is scoped to the selected harness's reported models.
import {
  agentFieldForNewChat, agentName, agentStatusFor, cachedSessionBinding, esc, getAgentChoice,
  handleExternalAgentStreamEvent, loadAgentFolders, loadExternalAgents, loadSessionBinding,
  onExternalAgentsChange, selectableAgents, setAgentChoice, syncExternalAgentRequests,
} from './external-agent-ui.js';

import { mountMinimalAgentComposer } from './external-agent-composer.js';
import { setDesktopAgentModel, agentModelForSend } from './external-agent-desktop-models.js';

const ui = { host: null, menuOpen: false, lastSession: '', lastEmpty: null, folders: [], typed: '' };

function chatView() { return document.getElementById('chat-view'); }
function isEmptyChat() { return !!chatView()?.classList.contains('chat-empty'); }
function activeSession() { return String(window.activeChatSessionId || '').trim(); }

function footerRow() {
  // Main composer only (index.html): the bottom row holding the model switcher.
  const modelBtn = document.getElementById('model-switcher-btn');
  return modelBtn?.closest('.agent-toggle') || null;
}

function ensureHost() {
  const row = footerRow();
  if (!row) return null;
  if (ui.host && row.contains(ui.host)) return ui.host;
  ui.host = document.createElement('div');
  ui.host.className = 'ea-switcher';
  ui.host.id = 'ea-agent-switcher';
  ui.host.hidden = true;
  const plus = row.querySelector('.ea-composer-more');
  if (plus) plus.after(ui.host); else row.insertBefore(ui.host, row.firstChild);
  ui.host.addEventListener('click', onClick);
  ui.host.addEventListener('keydown', onKey);
  return ui.host;
}

function shortPath(p) {
  const s = String(p || '');
  const parts = s.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : s;
}

function setHarnessModel(agentId) {
  document.body.classList.toggle('ea-agent-codex', !!agentId);
  const binding = cachedSessionBinding(activeSession());
  setDesktopAgentModel(agentId ? (binding ? { ...binding, id: agentId, sessionId: activeSession() } : { ...getAgentChoice(), id: agentId }) : null);
}

function render() {
  mountMinimalAgentComposer(selectableAgents().length > 0 || !!cachedSessionBinding(activeSession()));
  const host = ensureHost();
  if (!host) return;
  const sid = activeSession();
  const binding = sid ? cachedSessionBinding(sid) : null;
  const empty = isEmptyChat();
  const agents = selectableAgents();
  if (binding?.agentId) {
    const snap = agentStatusFor(binding.agentId);
    const off = snap && !snap.enabled;
    host.hidden = false;
    host.innerHTML = `<button type="button" class="ea-switcher-btn" disabled aria-label="This chat runs on ${esc(agentName(binding.agentId))}">
        <span class="ea-tile" aria-hidden="true">${esc(snap?.tile || 'Cx')}</span><span>${esc(agentName(binding.agentId))}</span></button>
      <span class="ea-quiet-line">${off ? `${esc(agentName(binding.agentId))} is turned off. Turn it on in Settings &gt; Agents &amp; imports to continue.` : `${esc(agentName(binding.agentId))} runs this chat${binding.cwd ? ` in ${esc(shortPath(binding.cwd))}` : ''}`}</span>`;
    setHarnessModel(binding.agentId);
    return;
  }
  if (!empty || !agents.length) {
    host.hidden = true;
    host.innerHTML = '';
    setHarnessModel(null);
    return;
  }
  const choice = getAgentChoice();
  const chosen = choice.id !== 'prometheus' ? agentStatusFor(choice.id) : null;
  host.hidden = false;
  host.innerHTML = `<button type="button" class="ea-switcher-btn" data-ea="toggle" aria-haspopup="menu" aria-expanded="${ui.menuOpen}" title="Who runs this chat">
      <span class="ea-tile${chosen ? '' : ' ea-tile-prometheus'}" aria-hidden="true">${esc(chosen?.tile || 'Pr')}</span><span>${esc(chosen ? chosen.name : 'Prometheus')}</span><span class="ea-caret" aria-hidden="true">▾</span></button>
    ${chosen ? `<span class="ea-switcher-folder" title="${esc(choice.cwd || 'Default folder')}">${esc(choice.cwd ? shortPath(choice.cwd) : 'Default folder')}</span>` : ''}
    ${ui.menuOpen ? menuHtml(agents, choice) : ''}`;
  setHarnessModel(chosen ? chosen.id : null);
}

function menuHtml(agents, choice) {
  const item = (id, tile, name, note) => `<button type="button" role="menuitemradio" aria-checked="${choice.id === id}" class="ea-menu-item${choice.id === id ? ' is-active' : ''}" data-ea="pick" data-id="${esc(id)}">
      <span class="ea-tile" aria-hidden="true">${esc(tile)}</span><span>${esc(name)}<small>${esc(note)}</small></span></button>`;
  const folderPart = choice.id !== 'prometheus' ? `<div class="ea-menu-sep"></div><div class="ea-menu-label">Folder</div>
      <button type="button" class="ea-menu-item${!choice.cwd ? ' is-active' : ''}" data-ea="folder" data-path="">Default folder<small>The chat's project folder, or the Prometheus workspace</small></button>
      ${ui.folders.slice(0, 6).map((f) => `<button type="button" class="ea-menu-item${choice.cwd === f.path ? ' is-active' : ''}" data-ea="folder" data-path="${esc(f.path)}" title="${esc(f.path)}">${esc(f.label || shortPath(f.path))}<small>${esc(shortPath(f.path))}</small></button>`).join('')}
      <input class="ea-menu-input" data-ea="path" type="text" placeholder="Or type a folder path, then Enter" value="${esc(ui.typed)}" autocomplete="off">` : '';
  return `<div class="ea-menu" role="menu">
      ${item('prometheus', 'P', 'Prometheus', 'Prometheus runs the chat')}
      ${agents.map((a) => item(a.id, a.tile || a.name[0], a.name, `Your own ${a.name}: its login, model and tools`)).join('')}
      ${folderPart}
    </div>`;
}

async function onClick(event) {
  event.stopPropagation(); // Rendering replaces the clicked node; do not treat it as an outside click.
  const el = event.target.closest('[data-ea]');
  if (!el) return;
  const act = el.getAttribute('data-ea');
  if (act === 'toggle') { ui.menuOpen = !ui.menuOpen; render(); return; }
  if (act === 'pick') {
    const id = el.getAttribute('data-id');
    setAgentChoice(id, '');
    ui.typed = '';
    ui.folders = id !== 'prometheus' ? await loadAgentFolders(id) : [];
    ui.menuOpen = id !== 'prometheus';
    render();
    return;
  }
  if (act === 'folder') { setAgentChoice(getAgentChoice().id, el.getAttribute('data-path') || ''); ui.menuOpen = false; render(); }
}

function onKey(event) {
  const el = event.target;
  if (el?.getAttribute?.('data-ea') === 'path') {
    ui.typed = el.value;
    if (event.key === 'Enter') { event.preventDefault(); setAgentChoice(getAgentChoice().id, ui.typed.trim()); ui.menuOpen = false; render(); }
  }
  if (event.key === 'Escape' && ui.menuOpen) { ui.menuOpen = false; render(); }
}

async function tick() {
  const sid = activeSession();
  const empty = isEmptyChat();
  if (sid !== ui.lastSession || empty !== ui.lastEmpty) {
    const changedSession = sid !== ui.lastSession;
    ui.lastSession = sid;
    ui.lastEmpty = empty;
    if (changedSession && !empty) setAgentChoice('prometheus');
    ui.menuOpen = false;
    if (sid && !empty) await loadSessionBinding(sid);
    void syncExternalAgentRequests(sid);
    render();
  }
}

/** Hooks the desktop send runtime calls (window, so no page module grows). */
window.__promExternalAgent = {
  fieldForSend(sessionId) {
    if (cachedSessionBinding(sessionId)) return undefined; // already bound: the server knows
    const field = agentFieldForNewChat();
    if (!field) return undefined;
    return { ...field, ...(agentModelForSend() ? { model: agentModelForSend() } : {}) };
  },
  onStreamEvent(event, sessionId) {
    const handled = handleExternalAgentStreamEvent(event, sessionId);
    if (event?.type === 'done' || event?.type === 'final') loadSessionBinding(sessionId, true).then(render).catch(() => {});
    return handled;
  },
};

onExternalAgentsChange(render);
document.addEventListener('click', (event) => {
  if (ui.menuOpen && ui.host && !ui.host.contains(event.target)) { ui.menuOpen = false; render(); }
});
loadExternalAgents().then(() => { ui.lastSession = null; tick(); }).catch(() => {});
setInterval(() => { void tick(); }, 700);
window.addEventListener('focus', () => { void loadExternalAgents(true); });
