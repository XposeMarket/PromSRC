// Mobile new-chat agent row (stage 3 live agents).
//
// ONE extra row in the existing new-chat dock (#pm-new-chat-context-dock), same
// look as the computer and project rows. Tapping opens a bottom sheet list.
// It leaves with the rest of the dock after the first message. Nothing is
// added to the composer. Hidden unless an agent is selectable.
import {
  agentFieldForNewChat, agentName, agentStatusFor, esc, getAgentChoice, handleExternalAgentStreamEvent,
  loadExternalAgents, loadSessionBinding, onExternalAgentsChange, selectableAgents,
  setAgentChoice, setExternalAgentRequest, syncExternalAgentRequests,
} from './external-agent-ui.js';

import { setAgentModelContext, agentModelForSend, agentEffortForSend } from './external-agent-models.js';
import { agentLogoHtml } from './external-agent-logos.js';


const ui = { row: null, sheet: null, scrim: null, off: null, generation: 0, sessionId: null };

function rowHtml() {
  const choice = getAgentChoice();
  const chosen = choice.id !== 'prometheus' ? agentStatusFor(choice.id) : null;
  return `<span class="pm-new-chat-context-icon" aria-hidden="true">${agentLogoHtml(chosen ? chosen.id : 'prometheus')}</span>
    <span class="pm-new-chat-context-value"><strong>${esc(chosen ? chosen.name : 'Prometheus')}</strong><small>Agent</small></span>
    <span class="pm-new-chat-context-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></span>`;
}

function renderRow() {
  if (!ui.row || !ui.row.isConnected) return;
  const show = selectableAgents().length > 0;
  ui.row.hidden = !show;
  if (show) ui.row.innerHTML = rowHtml();
  const choice = getAgentChoice();
  setAgentModelContext(show && choice.id !== 'prometheus' ? choice : null);
  const dock = document.getElementById('pm-new-chat-context-dock');
  dock?.classList.toggle('ea-new-chat-context', show);
  const computerValue = dock?.querySelector('#pm-chat-target-chip .pm-new-chat-context-value');
  if (show && computerValue && !computerValue.querySelector('small')) {
    const label = document.createElement('small'); label.className = 'ea-computer-label'; label.textContent = 'Computer'; computerValue.appendChild(label);
  } else if (!show) computerValue?.querySelector('.ea-computer-label')?.remove();
  if (!show && ui.sheet) closeSheet();
}

function closeSheet() {
  ui.sheet?.remove();
  ui.scrim?.remove();
  ui.sheet = null;
  ui.scrim = null;
  ui.row?.setAttribute('aria-expanded', 'false');
}

function openSheet() {
  closeSheet();
  const choice = getAgentChoice();
  const agents = selectableAgents();
  const item = (id, name) => `<button type="button" class="ea-menu-item${choice.id === id ? ' is-active' : ''}" data-ea="pick" data-id="${esc(id)}" aria-pressed="${choice.id === id}">
      ${agentLogoHtml(id)}<span>${esc(name)}</span>${choice.id === id ? '<span class="ea-menu-check" aria-hidden="true">✓</span>' : ''}</button>`;
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
    ${item('prometheus', 'Prometheus')}
    ${agents.map((a) => item(a.id, a.name)).join('')}`;
  ui.sheet.addEventListener('click', (event) => {
    const el = event.target.closest('[data-ea="pick"]');
    if (!el) return;
    setAgentChoice(el.getAttribute('data-id'), '');
    closeSheet();
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
  ui.generation++; ui.sessionId = null;
  let row = dock.querySelector('#pm-new-chat-agent');
  if (!row) {
    row = document.createElement('button');
    row.type = 'button';
    row.id = 'pm-new-chat-agent';
    row.className = 'pm-new-chat-context-row';
    row.setAttribute('aria-label', 'Who runs this chat');
    row.setAttribute('aria-expanded', 'false');
    row.hidden = true;
    row.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      // Prometheus is the only choice: the row is hidden and must not open anything.
      if (row.hidden || !selectableAgents().length) return;
      openSheet();
    });
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
  ui.sessionId = sessionId;
  closeSheet();
  return field ? { ...field, ...(agentModelForSend() ? { model: agentModelForSend() } : {}), ...(agentEffortForSend() ? { effort: agentEffortForSend() } : {}) } : field;
}

export function mobileAgentStreamEvent(event, sessionId, request) {
  setExternalAgentRequest(request);
  const handled = handleExternalAgentStreamEvent(event, sessionId);
  if (event?.type === 'external_agent_state' && ui.sessionId === sessionId) {
    const generation = ui.generation;
    loadSessionBinding(sessionId, true).then(binding => {
      if (generation === ui.generation && binding) setAgentModelContext({ ...binding, id: binding.agentId, sessionId });
    }).catch(() => {});
  }
  return handled;
}

/** Opening an existing chat: redraw any request still waiting on the user. */
export async function syncMobileAgentRequests(sessionId, request) {
  setExternalAgentRequest(request);
  const generation = ++ui.generation; ui.sessionId = sessionId;
  const binding = await loadSessionBinding(sessionId);
  if (generation !== ui.generation) return binding;
  setAgentModelContext(binding ? { ...binding, id: binding.agentId, sessionId } : null);
  if (binding) await syncExternalAgentRequests(sessionId);
  return binding;
}

export { agentName };
