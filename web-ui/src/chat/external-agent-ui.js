// Live connected agents (stage 3: the user's own Codex) — shared UI.
//
// One module for desktop and mobile:
//   - agent list + the new-chat choice (Prometheus is always first),
//   - the request card for the agent's own approvals/questions,
//   - the desktop agent switcher (bottom-left of the composer card),
//   - the mobile new-chat dock row + bottom sheet.
//
// Rules this file keeps: the choice is for a NEW chat only and is locked after
// the first message; with no selectable agent nothing renders; answers to a
// card go only to that exact upstream request (POST .../respond) and never
// touch a Prometheus approval or permission.

const AGENT_NAMES = { prometheus: 'Prometheus', codex: 'Codex', 'claude-code': 'Claude Code', openclaw: 'OpenClaw', hermes: 'Hermes', cursor: 'Cursor' };

const st = {
  request: null,
  agents: [],
  loadedAt: 0,
  loading: null,
  choice: { id: 'prometheus', cwd: '' },
  folders: new Map(),
  bindings: new Map(), // sessionId -> externalAgent summary | null
  cards: new Map(), // requestId -> { request, el }
  listeners: new Set(),
};

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function agentName(id) {
  return AGENT_NAMES[id] || String(id || 'Agent');
}

export function setExternalAgentRequest(fn) {
  if (typeof fn === 'function') st.request = fn;
}

async function call(path, opts = {}) {
  const next = { ...opts };
  if (next.body && typeof next.body !== 'string') next.body = JSON.stringify(next.body);
  if (next.body) next.headers = { 'Content-Type': 'application/json', ...(next.headers || {}) };
  const fn = st.request || (typeof window !== 'undefined' && typeof window.api === 'function' ? window.api : null);
  if (fn) return fn(path, next);
  const res = await fetch(path, next);
  return res.json();
}

/** JSON request through the active surface's fetch helper (desktop api / mobile gateway fetch). */
export function externalAgentRequest(path, opts) { return call(path, opts); }

function notify() {
  for (const fn of st.listeners) { try { fn(); } catch { /* UI only */ } }
}

export function onExternalAgentsChange(fn) {
  st.listeners.add(fn);
  return () => st.listeners.delete(fn);
}

/** Cached agent list; listing never starts an agent process on the gateway. */
export async function loadExternalAgents(force = false) {
  if (!force && st.loadedAt && Date.now() - st.loadedAt < 30_000) return st.agents;
  if (st.loading) return st.loading;
  st.loading = (async () => {
    try {
      const data = await call('/api/external-agents');
      st.agents = Array.isArray(data?.agents) ? data.agents : [];
    } catch {
      st.agents = [];
    } finally {
      st.loadedAt = Date.now();
      st.loading = null;
    }
    if (st.choice.id !== 'prometheus' && !selectableAgents().some((a) => a.id === st.choice.id)) st.choice = { id: 'prometheus', cwd: '' };
    notify();
    return st.agents;
  })();
  return st.loading;
}

export function selectableAgents() {
  return st.agents.filter((agent) => agent && agent.selectable);
}

export function getAgentChoice() {
  return { ...st.choice };
}

export function setAgentChoice(id, cwd = '') {
  st.choice = { id: id || 'prometheus', cwd: id && id !== 'prometheus' ? String(cwd || '') : '' };
  notify();
}

/** The body field for POST /api/chat, or undefined for a native chat. */
export function agentFieldForNewChat() {
  if (!st.choice.id || st.choice.id === 'prometheus') return undefined;
  return { id: st.choice.id, ...(st.choice.cwd.trim() ? { cwd: st.choice.cwd.trim() } : {}) };
}

export async function loadAgentFolders(id) {
  if (st.folders.has(id)) return st.folders.get(id);
  let folders = [];
  try {
    const data = await call(`/api/external-agents/${encodeURIComponent(id)}/folders`);
    folders = Array.isArray(data?.folders) ? data.folders : [];
  } catch { folders = []; }
  st.folders.set(id, folders);
  return folders;
}

export async function loadSessionBinding(sessionId, force = false) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  if (!force && st.bindings.get(sid)) return st.bindings.get(sid);
  let binding = null;
  try {
    const data = await call(`/api/external-agents/sessions/${encodeURIComponent(sid)}`);
    binding = data?.externalAgent || null;
  } catch { binding = null; }
  st.bindings.set(sid, binding);
  if (binding?.upstreamMissing) showMissingSession(sid);
  return binding;
}

export function cachedSessionBinding(sessionId) {
  return st.bindings.get(String(sessionId || '').trim()) || null;
}

export function agentStatusFor(id) {
  return st.agents.find((agent) => agent.id === id) || null;
}

// ---- request cards ----------------------------------------------------------

// The card markup (external-agent-card.js) loads only when a harness actually asks something,
// so ordinary chats do not carry it.
let cardModule = null;
function loadCard() {
  if (!cardModule) cardModule = import('./external-agent-card.js').catch((error) => { cardModule = null; throw error; });
  return cardModule;
}


function collectAnswers(el, req) {
  const answers = {};
  for (const q of (req.detail?.questions || [])) {
    const picked = [...el.querySelectorAll(`input[name="ea-q-${CSS.escape(req.requestId)}-${CSS.escape(q.id)}"]:checked`)];
    const typed = el.querySelector(`input[data-ea-q="${CSS.escape(q.id)}"]`);
    const values = picked.length ? picked.map((input) => input.value) : (typed?.value.trim() ? [typed.value.trim()] : []);
    if (values.length) answers[q.id] = values;
  }
  return answers;
}

export function showExternalAgentRequest(req, sessionId) {
  if (!req?.requestId || st.cards.has(req.requestId)) return;
  const el = document.createElement('section');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', req.title || 'Agent request');
  el.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-ea-option]');
    if (!btn) return;
    const optionId = btn.getAttribute('data-ea-option');
    el.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const err = el.querySelector('.ea-card-error');
    try {
      const data = await call(`/api/external-agents/requests/${encodeURIComponent(req.requestId)}/respond`, {
        method: 'POST',
        body: { sessionId: sessionId || req.sessionId, optionId, answers: collectAnswers(el, req) },
      });
      if (data && data.success === false) throw new Error(data.error || 'Not sent.');
      removeExternalAgentRequest(req.requestId);
    } catch (error) {
      el.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      if (err) { err.hidden = false; err.textContent = String(error?.message || error).replace(/^API \d+:\s*/, ''); }
    }
  });
  // Claimed before the card markup loads, so the same request is never shown twice.
  st.cards.set(req.requestId, { request: req, el });
  loadOrFallback(el, agentName(req.agentId), (card) => {
    el.className = card.cardClass();
    el.innerHTML = card.cardHtml(req);
    card.cardHost().appendChild(el);
    el.scrollIntoView?.({ block: 'nearest' });
  }, () => st.cards.get(req.requestId)?.el === el);
}

// The request stays claimed while the card loads or fails: a failed load shows a fallback
// (no Allow button) instead of dropping the request the harness is waiting on.
const CARD_RETRY_MS = [500, 1500];
function loadCardWithRetry() {
  return loadCard().catch(async (error) => {
    let last = error;
    for (const ms of CARD_RETRY_MS) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      try { return await loadCard(); } catch (e) { last = e; }
    }
    throw last;
  });
}

// Same spots as the card host (phone: end of chat, desktop: top of composer, else body).
function placeFallback(el) {
  const phone = document.body.classList.contains('pm-mobile-active');
  const chat = phone ? document.getElementById('pm-chat-body') : null;
  const composer = phone ? null : document.querySelector('#chat-view > .chat-input-area:not([data-canonical-secondary-composer])');
  if (chat) chat.appendChild(el);
  else if (composer) composer.prepend(el);
  else { el.classList.add('ea-card-fallback-float'); document.body.appendChild(el); }
}

// Built with createElement/textContent only: no request data goes through innerHTML.
function fallbackNodes(name, retry) {
  const title = document.createElement('strong');
  title.className = 'ea-card-fallback-title';
  title.textContent = `${name} needs your attention, but the card could not load.`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ea-card-fallback-btn';
  btn.textContent = 'Try again';
  btn.addEventListener('click', () => { btn.disabled = true; retry(); });
  return [title, btn];
}

function loadOrFallback(el, name, paint, isCurrent) {
  const run = () => loadCardWithRetry().then((card) => {
    if (isCurrent()) paint(card);
  }, () => {
    if (!isCurrent()) return;
    el.hidden = false;
    el.className = 'ea-card-fallback';
    el.replaceChildren(...fallbackNodes(name, run));
    placeFallback(el);
  });
  return run();
}


export function removeExternalAgentRequest(requestId) {
  const entry = st.cards.get(requestId);
  if (!entry) return;
  entry.el.remove();
  st.cards.delete(requestId);
}

/** Redraw cards still waiting for this session (reconnect, phone/desktop switch). */
export async function syncExternalAgentRequests(sessionId) {
  const sid = String(sessionId || '').trim();
  for (const [id, entry] of st.cards) if (entry.request.sessionId !== sid) removeExternalAgentRequest(id);
  for (const recovery of document.querySelectorAll('[data-ea-recovery-session]')) if (recovery.dataset.eaRecoverySession !== sid) recovery.remove();
  if (!sid || !cachedSessionBinding(sid)) return;
  try {
    const data = await call(`/api/external-agents/requests?sessionId=${encodeURIComponent(sid)}`);
    const live = new Set();
    for (const req of (Array.isArray(data?.requests) ? data.requests : [])) { live.add(req.requestId); showExternalAgentRequest(req, sid); }
    for (const id of [...st.cards.keys()]) if (!live.has(id)) removeExternalAgentRequest(id);
  } catch { /* keep what is shown */ }
}

function showMissingSession(sessionId) {
  const id = `ea-missing-${sessionId}`;
  if (document.getElementById(id)) return;
  const section = document.createElement('section');
  section.id = id;
  section.dataset.eaRecoverySession = sessionId;
  section.setAttribute('role', 'dialog');
  section.setAttribute('aria-label', 'Agent session ended');
  // Claimed before the card markup loads, so a second event cannot add a second notice.
  section.hidden = true;
  document.body.appendChild(section);
  loadOrFallback(section, agentName(st.bindings.get(String(sessionId))?.agentId), (card) => {
    section.className = card.cardClass();
    section.innerHTML = card.missingHtml();
    section.querySelector('button').addEventListener('click', async (event) => {
      event.target.disabled = true;
      try {
        const data = await call(`/api/external-agents/sessions/${encodeURIComponent(sessionId)}/new-upstream`, { method: 'POST', body: {} });
        if (data?.success === false) throw new Error(data.error || 'Could not start fresh.');
        st.bindings.delete(String(sessionId));
        section.remove();
        await loadSessionBinding(sessionId, true);
        notify();
      } catch (error) { section.querySelector('[role=status]').textContent = error.message; event.target.disabled = false; }
    });
    card.cardHost().appendChild(section);
    section.hidden = false;
  }, () => section.isConnected);
}



/** Stream hook: returns true when the event was an external-agent event. */
export function handleExternalAgentStreamEvent(event, sessionId) {
  if (!event || typeof event !== 'object') return false;
  if (event.type === 'external_agent_request' && event.request) {
    st.bindings.set(String(sessionId || ''), st.bindings.get(String(sessionId || '')) || { agentId: event.request.agentId });
    showExternalAgentRequest(event.request, sessionId);
    return true;
  }
  if (event.type === 'external_agent_request_resolved') {
    removeExternalAgentRequest(event.requestId);
    return true;
  }
  if (event.type === 'external_agent_state') {
    // The backend emits this only after binding. Do not clear selection on a failed send.
    setAgentChoice('prometheus');
    loadSessionBinding(sessionId, true).then(() => { notify(); }).catch(() => {});
    if (event.phase === 'upstream_missing') showMissingSession(sessionId);
    return true;
  }
  if (event.type === 'done' || event.type === 'error') {
    for (const [id, entry] of st.cards) if (entry.request.sessionId === sessionId) removeExternalAgentRequest(id);
  }
  return false;
}
