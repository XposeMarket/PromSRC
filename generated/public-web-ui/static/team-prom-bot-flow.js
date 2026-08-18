const TEAM_CHAT_ROUTE_RE = /\/api\/teams\/([^/?#]+)\/chat(?:\/stream)?(?:[?#]|$)/;
const CONVERT_MODAL_ID = 'prom-bot-convert-team-modal';
const TEAM_CHAT_DECORATION_ID = 'team-prom-bot-routing';

let nativeFetch = null;
let uiObserver = null;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function explicitMention(text) {
  return /(?:^|\s)@[a-zA-Z0-9_.-]+/.test(String(text || ''));
}

function installManagedTeamDefaultRoute() {
  if (nativeFetch || typeof window.fetch !== 'function') return;
  nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(init?.method || (typeof input === 'object' ? input?.method : '') || 'GET').toUpperCase();
    if (method === 'POST' && TEAM_CHAT_ROUTE_RE.test(url) && typeof init?.body === 'string') {
      try {
        const payload = JSON.parse(init.body);
        const message = String(payload?.message || '');
        const targetType = String(payload?.targetType || '').toLowerCase();
        // Managed Teams are manager-led conversations. Existing explicit
        // @manager / @team / @member routing remains authoritative; only the
        // no-mention default is promoted from a room broadcast to the manager.
        if (!explicitMention(message) && (targetType === 'team' || targetType === 'room' || !targetType)) {
          payload.targetType = 'manager';
          payload.targetId = undefined;
          payload.targetLabel = 'manager';
          payload.routedMessage = String(payload.routedMessage || message).trim() || message;
          init = { ...init, body: JSON.stringify(payload) };
        }
      } catch {}
    }
    return nativeFetch(input, init);
  };
}

function mentionHandle(value) {
  const source = String(value || '').trim();
  if (typeof window.promBotMentionHandle === 'function') {
    return window.promBotMentionHandle({ id: source, name: source });
  }
  return source.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'bot';
}

function activeTeamFromOverlay() {
  const overlay = document.getElementById('team-unified-chat-overlay');
  if (!overlay) return null;
  const close = overlay.querySelector('.side-chat-close');
  const onclick = String(close?.getAttribute('onclick') || '');
  const match = onclick.match(/closeUnifiedTeamChat\((['"])(.*?)\1\)/);
  const teamId = String(match?.[2] || '').trim();
  const teams = Array.isArray(window.teamsData) ? window.teamsData : [];
  if (teamId) return teams.find((team) => String(team?.id || '') === teamId) || { id: teamId, subagentIds: [] };
  const title = String(overlay.querySelector('.side-chat-title')?.textContent || '').trim();
  return teams.find((team) => String(team?.name || '').trim() === title) || null;
}

function teamAgentName(agentId) {
  const id = String(agentId || '').trim();
  const known = Array.isArray(window._allAgentsForTeam) ? window._allAgentsForTeam : [];
  return String(known.find((agent) => String(agent?.id || '') === id)?.name || id).trim();
}

function insertTeamMention(handle) {
  const input = document.getElementById('team-chat-input');
  if (!input) return;
  const token = `@${String(handle || '').replace(/^@/, '')} `;
  const start = Number(input.selectionStart ?? input.value.length);
  const end = Number(input.selectionEnd ?? start);
  const before = String(input.value || '').slice(0, start);
  const after = String(input.value || '').slice(end);
  const needsSpace = before && !/\s$/.test(before);
  input.value = `${before}${needsSpace ? ' ' : ''}${token}${after}`;
  const caret = before.length + (needsSpace ? 1 : 0) + token.length;
  input.setSelectionRange?.(caret, caret);
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function installStyles() {
  if (document.getElementById('team-prom-bot-flow-styles')) return;
  const style = document.createElement('style');
  style.id = 'team-prom-bot-flow-styles';
  style.textContent = `
    .team-prom-bot-routing { display:flex; flex-wrap:wrap; align-items:center; gap:5px; margin-top:5px; }
    .team-prom-bot-routing-label { font-size:9px; color:var(--muted); }
    .team-prom-bot-mention-btn { border:0; border-radius:6px; padding:2px 5px; background:transparent; color:var(--muted); font:inherit; font-size:9px; cursor:pointer; }
    .team-prom-bot-mention-btn:hover { background:var(--panel-2); color:var(--text); }
    .team-prom-bot-manager-default { color:var(--sidebar-muted,var(--muted)); font-size:9px; }
    .prom-bot-convert-team-btn { border:1px solid var(--line); background:var(--panel-2); color:var(--text); border-radius:8px; padding:6px 9px; font:inherit; font-size:10px; font-weight:750; cursor:pointer; margin-left:auto; margin-right:6px; }
    .prom-bot-convert-team-modal { position:fixed; inset:0; z-index:10040; display:grid; place-items:center; background:rgba(0,0,0,.48); backdrop-filter:blur(8px); }
    .prom-bot-convert-team-card { width:min(480px,calc(100vw - 32px)); border:1px solid var(--line); border-radius:16px; background:var(--panel); color:var(--text); box-shadow:0 28px 90px rgba(0,0,0,.38); padding:16px; }
    .prom-bot-convert-team-card h3 { margin:0; font-size:15px; }
    .prom-bot-convert-team-card p { margin:5px 0 12px; color:var(--muted); font-size:11px; line-height:1.45; }
    .prom-bot-convert-team-card label { display:block; margin-top:9px; font-size:10px; font-weight:750; color:var(--muted); }
    .prom-bot-convert-team-card input,.prom-bot-convert-team-card textarea { width:100%; box-sizing:border-box; margin-top:4px; border:1px solid var(--line); border-radius:9px; background:var(--panel-2); color:var(--text); padding:8px 10px; font:inherit; font-size:11px; }
    .prom-bot-convert-team-card textarea { min-height:90px; resize:vertical; }
    .prom-bot-convert-team-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
    .prom-bot-convert-team-actions button { border:1px solid var(--line); border-radius:8px; padding:7px 11px; background:var(--panel-2); color:var(--text); font:inherit; font-size:11px; font-weight:750; cursor:pointer; }
    .prom-bot-convert-team-actions .primary { background:var(--brand); border-color:var(--brand); color:#fff; }
  `;
  document.head.appendChild(style);
}

function decorateTeamChat() {
  const overlay = document.getElementById('team-unified-chat-overlay');
  if (!overlay) return;
  const team = activeTeamFromOverlay();
  const titleWrap = overlay.querySelector('.side-chat-title-wrap');
  if (!titleWrap || titleWrap.querySelector(`#${TEAM_CHAT_DECORATION_ID}`)) return;

  const kicker = titleWrap.querySelector('.side-chat-kicker');
  if (kicker) kicker.textContent = 'Managed Prom Bot room';

  const routing = document.createElement('div');
  routing.id = TEAM_CHAT_DECORATION_ID;
  routing.className = 'team-prom-bot-routing';
  const defaultLabel = document.createElement('span');
  defaultLabel.className = 'team-prom-bot-manager-default';
  defaultLabel.textContent = 'No mention → manager';
  routing.appendChild(defaultLabel);

  const targets = [
    { handle: 'manager', label: '@manager' },
    { handle: 'team', label: '@team' },
    ...(Array.isArray(team?.subagentIds) ? team.subagentIds : []).map((id) => {
      const name = teamAgentName(id);
      return { handle: mentionHandle(name || id), label: `@${name || id}` };
    }),
  ];
  for (const target of targets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'team-prom-bot-mention-btn';
    button.textContent = target.label;
    button.addEventListener('click', () => insertTeamMention(target.handle));
    routing.appendChild(button);
  }
  titleWrap.appendChild(routing);

  const input = document.getElementById('team-chat-input');
  if (input) input.setAttribute('placeholder', 'Message the manager, @team, or @Bot');
}

function groupTranscript(group) {
  const messages = Array.isArray(group?.messages) ? group.messages : [];
  return messages.slice(-120).map((message) => {
    const actor = message.role === 'user' ? 'You' : String(message.workflowLabel || message.agentId || 'Bot');
    return `${actor}: ${String(message.content || '').trim()}`;
  }).filter(Boolean).join('\n\n').slice(0, 24000);
}

function closeConvertModal() {
  document.getElementById(CONVERT_MODAL_ID)?.remove();
}

function openConvertModal(groupId) {
  closeConvertModal();
  const group = window.getPromBotGroup?.(groupId);
  if (!group) return;
  const members = (group.memberIds || []).map((id) => teamAgentName(id) || id);
  const modal = document.createElement('div');
  modal.id = CONVERT_MODAL_ID;
  modal.className = 'prom-bot-convert-team-modal';
  modal.innerHTML = `<div class="prom-bot-convert-team-card" role="dialog" aria-modal="true" aria-label="Convert Prom Bot group to team"><h3>Convert to Team</h3><p>Keep ${esc(members.join(', '))} together, add a dedicated manager, shared mission/workspace, runs and autonomous coordination. The existing group transcript is imported as Team context.</p><label>Team name<input id="prom-bot-convert-name" maxlength="80" value="${esc(group.title || 'New Team')}"></label><label>Purpose<textarea id="prom-bot-convert-purpose" placeholder="What should this team own or accomplish?"></textarea></label><div class="prom-bot-convert-team-actions"><button type="button" data-action="cancel">Cancel</button><button type="button" class="primary" data-action="convert">Convert to Team</button></div></div>`;
  modal.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.target === modal || target?.closest('[data-action="cancel"]')) closeConvertModal();
    if (target?.closest('[data-action="convert"]')) void convertGroupToTeam(group.id);
  });
  document.body.appendChild(modal);
  requestAnimationFrame(() => document.getElementById('prom-bot-convert-purpose')?.focus());
}

async function convertGroupToTeam(groupId) {
  const group = window.getPromBotGroup?.(groupId);
  if (!group) return;
  const name = String(document.getElementById('prom-bot-convert-name')?.value || group.title || 'New Team').trim();
  const purpose = String(document.getElementById('prom-bot-convert-purpose')?.value || '').trim();
  if (!name || !purpose) {
    window.showToast?.('Convert to Team', 'Team name and purpose are required.', 'warning');
    return;
  }
  const button = document.querySelector(`#${CONVERT_MODAL_ID} [data-action="convert"]`);
  if (button) { button.disabled = true; button.textContent = 'Converting…'; }
  try {
    const createRes = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: purpose.slice(0, 300),
        emoji: '👥',
        subagentIds: Array.isArray(group.memberIds) ? group.memberIds : [],
        teamContext: purpose,
        kickoffInitialReview: false,
      }),
    });
    const data = await createRes.json();
    if (!createRes.ok || !data?.team?.id) throw new Error(data?.error || `HTTP ${createRes.status}`);
    const team = data.team;
    const transcript = groupTranscript(group);
    if (transcript) {
      await fetch(`/api/teams/${encodeURIComponent(team.id)}/context-references`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Prom Bot group history — ${group.title || name}`,
          content: transcript,
          actor: 'prom_bot_group_conversion',
        }),
      }).catch(() => null);
    }
    window.deletePromBotGroup?.(group.id);
    window.closePromBotGroup?.();
    closeConvertModal();
    window.showToast?.('Team created', `${name} is now a managed Prom Bot room.`, 'success');
    window.setMode?.('teams');
    setTimeout(async () => {
      try { await window.refreshTeams?.(); } catch {}
      try { await window.openTeamBoard?.(team.id); } catch {}
      try { window.switchTeamTab?.('chat', team.id); } catch {}
    }, 180);
  } catch (error) {
    window.showToast?.('Convert to Team', error?.message || String(error), 'error');
    if (button) { button.disabled = false; button.textContent = 'Convert to Team'; }
  }
}

function decoratePromBotGroup() {
  const host = document.getElementById('prom-bot-group-host');
  const header = host?.querySelector('.unified-agent-chat-header');
  if (!header || header.querySelector('.prom-bot-convert-team-btn')) return;
  const groupId = String(window.promBotActiveGroupId || '').trim();
  if (!groupId) return;
  const close = header.querySelector('.side-chat-close');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'prom-bot-convert-team-btn';
  button.textContent = 'Convert to Team';
  button.addEventListener('click', () => openConvertModal(groupId));
  if (close) header.insertBefore(button, close);
  else header.appendChild(button);
}

function decorate() {
  decorateTeamChat();
  decoratePromBotGroup();
}

function initTeamPromBotFlow() {
  installStyles();
  installManagedTeamDefaultRoute();
  decorate();
  uiObserver = new MutationObserver(() => queueMicrotask(decorate));
  uiObserver.observe(document.body, { childList: true, subtree: true });
}

window.insertTeamPromBotMention = insertTeamMention;
window.openPromBotGroupTeamConversion = openConvertModal;
window.convertPromBotGroupToTeam = convertGroupToTeam;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTeamPromBotFlow, { once: true });
else initTeamPromBotFlow();
