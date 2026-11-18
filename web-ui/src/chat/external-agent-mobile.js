// Mobile new-chat agent row (stage 3 live agents).
//
// ONE extra row in the existing new-chat dock (#pm-new-chat-context-dock), same
// look as the computer and project rows. Tapping opens a bottom sheet list.
// It leaves with the rest of the dock after the first message. Nothing is
// added to the composer. Hidden unless an agent is selectable.
import {
  agentFieldForNewChat, agentName, agentStatusFor, esc, getAgentChoice, handleExternalAgentStreamEvent,
  loadAgentFolders, loadExternalAgents, loadSessionBinding, onExternalAgentsChange, selectableAgents,
  setAgentChoice, setExternalAgentRequest, syncExternalAgentRequests,
} from './external-agent-ui.js';

const ui = { row: null, sheet: null, scrim: null, off: null };

function rowHtml() {
  const choice = getAgentChoice();
  const chosen = choice.id !== 'prometheus' ? agentStatusFor(choice.id) : null;
  const sub = chosen ? (choice.cwd ? choice.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/') : 'Default folder') : 'Agent';
  return `<span class="pm-new-chat-context-icon" aria-hidden="true"><span class="ea-tile">${esc(chosen?.tile || 'P')}</span></span>
    <span class="pm-new-chat-context-value"><strong>${esc(chosen ? chosen.name : 'Prometheus')}</strong><small>${esc(sub)}</small></span>
    <span class="pm-new-chat-context-chevron" aria-hidden="true">›</span>`;
}

function renderRow() {
  if (!ui.row || !ui.row.isConnected) return;
  const show = selectableAgents().length > 0;
  ui.row.hidden = !show;
  if (show) ui.row.innerHTML = rowHtml();
}

function closeSheet() {
  ui.sheet?.remove();
  ui.scrim?.remove();
  ui.sheet = null;
  ui.scrim = null;
  ui.row?.setAttribute('aria-expanded', 'false');
}

async function openSheet() {
  closeSheet();
  const choice = getAgentChoice();
  const agents = selectableAgents();
  const folders = choice.id !== 'prometheus' ? await loadAgentFolders(choice.id) : [];
  const item = (id, tile, name, note) => `<button type="button" class="ea-menu-item${choice.id === id ? ' is-active' : ''}" data-ea="pick" data-id="${esc(id)}" aria-pressed="${choice.id === id}">
      <span class="ea-tile" aria-hidden="true">${esc(tile)}</span><span>${esc(name)}<small>${esc(note)}</small></span></button>`;
  ui.scrim = document.createElement('button');
  ui.scrim.type = 'button';
  ui.scrim.className = 'ea-sheet-scrim';
  ui.scrim.setAttribute('aria-label', 'Close');
  ui.scrim.addEventListener('click', closeSheet);
  ui.sheet = document.createElement('section');
  ui.sheet.className = 'ea-sheet';
  ui.sheet.setAttribute('role', 'dialog');
  ui.sheet.setAttribute('aria-label', 'Who runs this chat');
  ui.sheet.innerHTML = `<div class="ea-sheet-handle"></div><h3 class="ea-sheet-title">Who runs this chat</h3>
    ${item('prometheus', 'P', 'Prometheus', 'Prometheus runs the chat')}
    ${agents.map((a) => item(a.id, a.tile || a.name[0], a.name, `Your own ${a.name}: its login, model and tools`)).join('')}
    ${choice.id !== 'prometheus' ? `<div class="ea-menu-sep"></div><div class="ea-menu-label">Folder</div>
      <button type="button" class="ea-menu-item${!choice.cwd ? ' is-active' : ''}" data-ea="folder" data-path="">Default folder<small>The Prometheus workspace</small></button>
      ${folders.slice(0, 6).map((f) => `<button type="button" class="ea-menu-item${choice.cwd === f.path ? ' is-active' : ''}" data-ea="folder" data-path="${esc(f.path)}">${esc(f.label || f.path)}<small>${esc(f.path)}</small></button>`).join('')}
      <input class="ea-menu-input" data-ea="path" type="text" placeholder="Or type a folder path" autocomplete="off" enterkeyhint="done">` : ''}`;
  ui.sheet.addEventListener('click', async (event) => {
    const el = event.target.closest('[data-ea]');
    if (!el) return;
    const act = el.getAttribute('data-ea');
    if (act === 'pick') {
      const id = el.getAttribute('data-id');
      setAgentChoice(id, '');
      if (id === 'prometheus') closeSheet(); else openSheet();
    } else if (act === 'folder') {
      setAgentChoice(getAgentChoice().id, el.getAttribute('data-path') || '');
      closeSheet();
    }
  });
  ui.sheet.addEventListener('keydown', (event) => {
    const el = event.target;
    if (el?.getAttribute?.('data-ea') === 'path' && event.key === 'Enter') {
      event.preventDefault();
      setAgentChoice(getAgentChoice().id, el.value.trim());
      closeSheet();
    }
  });
  document.body.append(ui.scrim, ui.sheet);
  ui.row?.setAttribute('aria-expanded', 'true');
}

/**
 * Mount the row as the FIRST row of the dock. `request` is the mobile JSON
 * fetch helper (mobileGatewayFetch). Safe to call on every new-chat render.
 */
export function mountMobileAgentRow(dock, { request } = {}) {
  setExternalAgentRequest(request);
  if (!dock) return;
  let row = dock.querySelector('#pm-new-chat-agent');
  if (!row) {
    row = document.createElement('button');
    row.type = 'button';
    row.id = 'pm-new-chat-agent';
    row.className = 'pm-new-chat-context-row';
    row.setAttribute('aria-label', 'Who runs this chat');
    row.setAttribute('aria-expanded', 'false');
    row.hidden = true;
    row.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openSheet(); });
    dock.insertBefore(row, dock.firstChild);
  }
  ui.row = row;
  if (!ui.off) ui.off = onExternalAgentsChange(renderRow);
  renderRow();
  loadExternalAgents(true).then(renderRow).catch(() => {});
}

/** Field for the first message, or undefined. Clears the choice once used. */
export function mobileAgentFieldForSend(sessionId) {
  const field = agentFieldForNewChat();
  closeSheet();
  return field;
}

export function mobileAgentStreamEvent(event, sessionId, request) {
  setExternalAgentRequest(request);
  return handleExternalAgentStreamEvent(event, sessionId);
}

/** Opening an existing chat: redraw any request still waiting on the user. */
export async function syncMobileAgentRequests(sessionId, request) {
  setExternalAgentRequest(request);
  const binding = await loadSessionBinding(sessionId);
  if (binding) await syncExternalAgentRequests(sessionId);
  return binding;
}

export { agentName };
