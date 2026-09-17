import { parseSessionRef, sessionRef } from '../core/gateway-manager.js';
import { mobileV2Haptic } from './haptics.js';

const LONG_PRESS_MS = 480;
const MOVE_CANCEL_PX = 10;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function formatWhen(value) {
  const numeric = Number(new Date(value || 0));
  if (!numeric) return '';
  const delta = Math.max(0, Date.now() - numeric);
  if (delta < 60000) return 'now';
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}h`;
  return `${Math.floor(delta / 86400000)}d`;
}

function normalizeRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.sessions)) return body.sessions;
  return [];
}

function projectRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.projects)) return body.projects;
  return [];
}

function sessionTitle(row) {
  return String(row?.title || row?.name || 'Untitled chat');
}

function decorateSession(row, gateway) {
  const id = String(row?.id || '');
  return {
    ...row,
    _gatewayId: gateway.id,
    _gatewayName: gateway.name,
    _ref: sessionRef(gateway.id, id),
  };
}

function rowMarkup(row, { activeRef = '', context = '' } = {}) {
  const active = activeRef && row._ref === activeRef;
  const pinned = Number(row.pinnedAt || 0) > 0;
  const unread = row.mobileUnread === true;
  const stamp = formatWhen(row.updatedAt || row.lastActivityAt || row.lastMessageAt || row.createdAt);
  return `<button class="pm-session-row pm-v2-session-row${active ? ' is-active-session' : ''}${unread ? ' is-unread' : ''}" type="button" data-session-ref="${escapeHtml(row._ref)}" data-session-title="${escapeHtml(sessionTitle(row))}" data-session-pinned="${pinned ? '1' : '0'}" data-session-settled="${row.settledAt || row.state === 'settled' ? '1' : '0'}"${active ? ' aria-current="page"' : ''}>
    <span class="pm-v2-session-copy"><strong>${pinned ? '<span class="pm-v2-pin" aria-hidden="true">◆</span>' : ''}${escapeHtml(sessionTitle(row))}</strong><small>${context ? `${escapeHtml(context)} · ` : ''}${escapeHtml(row._gatewayName || '')}${stamp ? ` · ${escapeHtml(stamp)}` : ''}</small></span>
    ${unread ? '<span class="pm-v2-unread-dot" aria-label="Unread"></span>' : ''}
    <span class="pm-v2-session-more" aria-hidden="true">•••</span>
  </button>`;
}

export function attachMobileV2DrawerParity({
  drawer,
  list,
  gateways,
  navigate,
  setDrawer,
  showNotice,
  refreshBaseSessions,
  getBaseSessions,
  getActiveSessionRef,
}) {
  if (!drawer || !list) return { refresh: async () => {}, dispose: () => {} };
  let disposed = false;
  let mode = 'active';
  let query = '';
  let pinned = [];
  let settled = [];
  let projects = [];
  let searchResults = [];
  let expandedProjects = new Set();
  let longTimer = null;
  let longTarget = null;
  let startX = 0;
  let startY = 0;

  const chrome = document.createElement('div');
  chrome.className = 'pm-v2-drawer-parity';
  chrome.innerHTML = `<label class="pm-v2-drawer-search"><span aria-hidden="true">⌕</span><input type="search" autocomplete="off" spellcheck="false" placeholder="Search chats…" aria-label="Search chats"></label>
    <div class="pm-v2-drawer-switch" role="tablist" aria-label="Chat state"><button type="button" class="active" data-v2-drawer-mode="active">Chats</button><button type="button" data-v2-drawer-mode="settled">Settled</button></div>
    <section class="pm-v2-drawer-extra" data-v2-pinned-section hidden><div class="pm-v2-drawer-section-title">Pinned</div><div data-v2-pinned-list></div></section>
    <section class="pm-v2-drawer-extra" data-v2-projects-section hidden><div class="pm-v2-drawer-section-title">Projects</div><div data-v2-project-list></div></section>`;
  const label = list.previousElementSibling;
  label?.insertAdjacentElement('afterend', chrome);

  const searchInput = chrome.querySelector('input[type="search"]');
  const pinnedSection = chrome.querySelector('[data-v2-pinned-section]');
  const pinnedList = chrome.querySelector('[data-v2-pinned-list]');
  const projectsSection = chrome.querySelector('[data-v2-projects-section]');
  const projectsList = chrome.querySelector('[data-v2-project-list]');

  const activeRef = () => String(getActiveSessionRef?.() || '');

  function setHeading(text) {
    const heading = list.previousElementSibling;
    if (heading?.classList?.contains('pm-v2-drawer-label')) heading.textContent = text;
  }

  async function loadPinned() {
    const results = await Promise.allSettled(gateways.list().map(async (entry) => {
      const client = gateways.client(entry.id);
      const params = new URLSearchParams({ scope: 'all', limit: '200', offset: '0', includeAutomated: '1', state: 'active', pinned: '1' });
      return normalizeRows(await client.request(`/api/sessions?${params}`)).map((row) => decorateSession(row, entry));
    }));
    pinned = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  }

  async function loadSettled() {
    const results = await Promise.allSettled(gateways.list().map(async (entry) => {
      const body = await gateways.client(entry.id).listSessions({ state: 'settled', limit: 100, offset: 0 });
      return body.sessions.map((row) => decorateSession(row, entry));
    }));
    settled = results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
      .sort((a, b) => Number(new Date(b.updatedAt || b.settledAt || 0)) - Number(new Date(a.updatedAt || a.settledAt || 0)));
  }

  async function loadProjects() {
    const results = await Promise.allSettled(gateways.list().map(async (entry) => {
      const body = await gateways.client(entry.id).request('/api/projects');
      return projectRows(body).map((project) => ({ ...project, _gatewayId: entry.id, _gatewayName: entry.name }));
    }));
    projects = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  }

  async function search(queryText) {
    const q = String(queryText || '').trim();
    if (!q) {
      searchResults = [];
      paint();
      return;
    }
    const results = await Promise.allSettled(gateways.list().map(async (entry) => {
      const params = new URLSearchParams({ q, limit: '100', mode: 'content', scope: 'all', includeAutomated: '1', state: mode });
      const body = await gateways.client(entry.id).request(`/api/sessions/search?${params}`);
      return normalizeRows(body).map((row) => decorateSession(row, entry));
    }));
    if (disposed || q !== query) return;
    searchResults = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    paint();
  }

  function renderProjects() {
    projectsSection.hidden = mode !== 'active' || query.length > 0 || !projects.length;
    if (projectsSection.hidden) return;
    projectsList.innerHTML = projects.map((project) => {
      const id = String(project.id || '');
      const open = expandedProjects.has(`${project._gatewayId}::${id}`);
      const rows = Array.isArray(project.sessions) ? project.sessions : [];
      const gateway = gateways.list().find((entry) => entry.id === project._gatewayId) || { id: project._gatewayId, name: project._gatewayName };
      return `<div class="pm-v2-project"><button type="button" class="pm-v2-project-row" data-project-key="${escapeHtml(`${project._gatewayId}::${id}`)}"><span><strong>${escapeHtml(project.name || project.title || 'Project')}</strong><small>${escapeHtml(project._gatewayName || '')}${rows.length ? ` · ${rows.length} chat${rows.length === 1 ? '' : 's'}` : ''}</small></span><span>${open ? '⌄' : '›'}</span></button>${open ? `<div class="pm-v2-project-sessions">${rows.length ? rows.map((row) => rowMarkup(decorateSession(row, gateway), { activeRef: activeRef(), context: project.name || project.title || 'Project' })).join('') : '<div class="pm-v2-drawer-empty">No project chats.</div>'}</div>` : ''}</div>`;
    }).join('');
  }

  function paint() {
    if (disposed) return;
    const currentActive = activeRef();
    chrome.querySelectorAll('[data-v2-drawer-mode]').forEach((button) => button.classList.toggle('active', button.dataset.v2DrawerMode === mode));

    pinnedSection.hidden = mode !== 'active' || query.length > 0 || !pinned.length;
    if (!pinnedSection.hidden) pinnedList.innerHTML = pinned.map((row) => rowMarkup(row, { activeRef: currentActive })).join('');
    renderProjects();

    if (query) {
      setHeading('Search Results');
      list.innerHTML = searchResults.length ? searchResults.map((row) => rowMarkup(row, { activeRef: currentActive })).join('') : '<div class="pm-v2-drawer-empty">No matching chats.</div>';
      return;
    }
    if (mode === 'settled') {
      setHeading('Settled');
      list.innerHTML = settled.length ? settled.map((row) => rowMarkup(row, { activeRef: currentActive })).join('') : '<div class="pm-v2-drawer-empty">No settled chats.</div>';
      return;
    }
    setHeading('Chats');
    const pinnedRefs = new Set(pinned.map((row) => row._ref));
    const projectRefs = new Set(projects.flatMap((project) => {
      const gateway = gateways.list().find((entry) => entry.id === project._gatewayId) || { id: project._gatewayId };
      return (project.sessions || []).map((row) => sessionRef(gateway.id, row.id));
    }));
    const rows = (getBaseSessions?.() || []).filter((row) => !pinnedRefs.has(row._ref) && !projectRefs.has(row._ref));
    list.innerHTML = rows.length ? rows.map((row) => rowMarkup(row, { activeRef: currentActive })).join('') : '<div class="pm-v2-drawer-empty">No chats yet.</div>';
  }

  async function refresh({ base = false } = {}) {
    if (disposed) return;
    if (base) await refreshBaseSessions?.();
    const work = [loadPinned(), loadProjects()];
    if (mode === 'settled') work.push(loadSettled());
    await Promise.allSettled(work);
    if (query) await search(query);
    else paint();
  }

  async function mutateSession(ref, action, payload) {
    const parsed = parseSessionRef(ref);
    if (!parsed?.gatewayId || !parsed?.sessionId) throw new Error('Could not resolve this chat target.');
    const client = gateways.client(parsed.gatewayId);
    const sid = encodeURIComponent(parsed.sessionId);
    if (action === 'patch') return client.request(`/api/sessions/${sid}`, { method: 'PATCH', body: JSON.stringify(payload || {}) });
    if (action === 'unread') return client.request(`/api/sessions/${sid}/mobile-unread`, { method: 'POST', body: '{}' });
    if (action === 'settle') return client.request(`/api/sessions/${sid}/settle`, { method: 'POST', body: '{}' });
    if (action === 'unsettle') return client.request(`/api/sessions/${sid}/unsettle`, { method: 'POST', body: '{}' });
    if (action === 'delete') return client.request(`/api/sessions/${sid}`, { method: 'DELETE' });
    throw new Error('Unknown chat action.');
  }

  function closeActionSheet() {
    drawer.querySelector('.pm-v2-session-sheet')?.remove();
    document.documentElement.classList.remove('pm-session-long-press-pending');
  }

  function openActionSheet(row) {
    closeActionSheet();
    const ref = row.dataset.sessionRef;
    const title = row.dataset.sessionTitle || 'Chat';
    const pinnedNow = row.dataset.sessionPinned === '1';
    const settledNow = row.dataset.sessionSettled === '1' || mode === 'settled';
    const sheet = document.createElement('div');
    sheet.className = 'pm-v2-session-sheet';
    sheet.innerHTML = `<button type="button" class="pm-v2-session-sheet-scrim" data-close-session-sheet aria-label="Close"></button><section class="pm-msheet pm-msheet-session-context pm-v2-session-actions"><div class="pm-v2-session-action-title">${escapeHtml(title)}</div><button type="button" class="pm-sess-action-row" data-session-action="pin">${pinnedNow ? 'Unpin' : 'Pin'}</button><button type="button" class="pm-sess-action-row" data-session-action="rename">Rename</button><button type="button" class="pm-sess-action-row" data-session-action="unread">Mark as unread</button><button type="button" class="pm-sess-action-row" data-session-action="settle">${settledNow ? 'Unsettle' : 'Settle'}</button><button type="button" class="pm-sess-action-row danger" data-session-action="delete">Delete</button><button type="button" class="pm-sess-action-row" data-close-session-sheet>Cancel</button></section>`;
    drawer.appendChild(sheet);
    requestAnimationFrame(() => sheet.classList.add('open'));

    sheet.addEventListener('click', async (event) => {
      if (event.target.closest('[data-close-session-sheet]')) {
        closeActionSheet();
        return;
      }
      const button = event.target.closest('[data-session-action]');
      if (!button) return;
      const action = button.dataset.sessionAction;
      button.disabled = true;
      try {
        if (action === 'pin') await mutateSession(ref, 'patch', { pinned: !pinnedNow });
        else if (action === 'rename') {
          const value = window.prompt('Rename chat', title);
          if (value?.trim()) await mutateSession(ref, 'patch', { title: value.trim() });
          else { button.disabled = false; return; }
        } else if (action === 'unread') await mutateSession(ref, 'unread');
        else if (action === 'settle') await mutateSession(ref, settledNow ? 'unsettle' : 'settle');
        else if (action === 'delete') {
          if (!window.confirm(`Delete “${title}”?`)) { button.disabled = false; return; }
          await mutateSession(ref, 'delete');
        }
        mobileV2Haptic(10);
        closeActionSheet();
        showNotice?.(`${action === 'pin' ? (pinnedNow ? 'Unpinned' : 'Pinned') : action === 'settle' ? (settledNow ? 'Restored' : 'Settled') : action === 'unread' ? 'Marked unread' : action === 'rename' ? 'Renamed' : 'Deleted'} chat.`);
        await refresh({ base: true });
      } catch (error) {
        button.disabled = false;
        showNotice?.(error?.message || 'Chat action failed.');
      }
    });
  }

  function resolveSessionRow(node) {
    return node?.closest?.('.pm-v2-session-row[data-session-ref]') || null;
  }

  function clearLongPress() {
    if (longTimer) clearTimeout(longTimer);
    longTimer = null;
    longTarget = null;
    document.documentElement.classList.remove('pm-session-long-press-pending');
  }

  function onPointerDown(event) {
    const row = resolveSessionRow(event.target);
    if (!row) return;
    startX = event.clientX;
    startY = event.clientY;
    longTarget = row;
    document.documentElement.classList.add('pm-session-long-press-pending');
    longTimer = window.setTimeout(() => {
      const target = longTarget;
      clearLongPress();
      if (!target) return;
      mobileV2Haptic(12);
      openActionSheet(target);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event) {
    if (!longTarget) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_CANCEL_PX) clearLongPress();
  }

  chrome.addEventListener('click', (event) => {
    const modeButton = event.target.closest('[data-v2-drawer-mode]');
    if (modeButton) {
      mode = modeButton.dataset.v2DrawerMode === 'settled' ? 'settled' : 'active';
      query = '';
      searchInput.value = '';
      if (mode === 'settled') loadSettled().then(paint);
      else paint();
      return;
    }
    const projectButton = event.target.closest('[data-project-key]');
    if (projectButton) {
      const key = projectButton.dataset.projectKey;
      if (expandedProjects.has(key)) expandedProjects.delete(key);
      else expandedProjects.add(key);
      renderProjects();
    }
  });

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    query = String(searchInput.value || '').trim();
    if (searchTimer) clearTimeout(searchTimer);
    if (!query) { searchResults = []; paint(); return; }
    list.innerHTML = '<div class="pm-v2-drawer-empty">Searching…</div>';
    searchTimer = window.setTimeout(() => search(query), 180);
  });

  drawer.addEventListener('pointerdown', onPointerDown);
  drawer.addEventListener('pointermove', onPointerMove);
  drawer.addEventListener('pointerup', clearLongPress);
  drawer.addEventListener('pointercancel', clearLongPress);
  drawer.addEventListener('contextmenu', (event) => {
    if (resolveSessionRow(event.target)) event.preventDefault();
  }, true);

  drawer.addEventListener('click', (event) => {
    const row = resolveSessionRow(event.target);
    if (!row || drawer.querySelector('.pm-v2-session-sheet')) return;
    const ref = row.dataset.sessionRef;
    if (!ref) return;
    setDrawer?.(false);
    navigate?.(`chat/${encodeURIComponent(ref)}`);
  });

  refresh().catch(() => {});
  return {
    refresh,
    dispose() {
      disposed = true;
      clearLongPress();
      if (searchTimer) clearTimeout(searchTimer);
      closeActionSheet();
      chrome.remove();
      drawer.removeEventListener('pointerdown', onPointerDown);
      drawer.removeEventListener('pointermove', onPointerMove);
      drawer.removeEventListener('pointerup', clearLongPress);
      drawer.removeEventListener('pointercancel', clearLongPress);
    },
  };
}
