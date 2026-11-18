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
  return binding;
}

export function cachedSessionBinding(sessionId) {
  return st.bindings.get(String(sessionId || '').trim()) || null;
}

export function agentStatusFor(id) {
  return st.agents.find((agent) => agent.id === id) || null;
}

// ---- request cards ----------------------------------------------------------

function cardHtml(req) {
  const d = req.detail || {};
  const rows = [];
  if (d.command) rows.push(`<pre class="ea-card-cmd">${esc(d.command)}</pre>`);
  if (d.cwd) rows.push(`<div class="ea-card-meta">in ${esc(d.cwd)}</div>`);
  if (Array.isArray(d.files) && d.files.length) rows.push(`<ul class="ea-card-files">${d.files.slice(0, 12).map((f) => `<li>${esc(f)}</li>`).join('')}${d.files.length > 12 ? `<li>…and ${d.files.length - 12} more</li>` : ''}</ul>`);
  if (d.reason) rows.push(`<div class="ea-card-reason">${esc(d.reason)}</div>`);
  if (Array.isArray(d.questions)) {
    for (const q of d.questions) {
      const opts = Array.isArray(q.options) && q.options.length
        ? `<div class="ea-card-choices">${q.options.map((o) => `<label class="ea-card-choice"><input type="radio" name="ea-q-${esc(req.requestId)}-${esc(q.id)}" value="${esc(o.id)}"><span>${esc(o.label)}</span></label>`).join('')}</div>`
        : `<input class="ea-card-input" type="text" data-ea-q="${esc(q.id)}" autocomplete="off">`;
      rows.push(`<div class="ea-card-q" data-ea-qid="${esc(q.id)}"><div class="ea-card-q-prompt">${esc(q.prompt)}</div>${opts}</div>`);
    }
  }
  const buttons = (req.options || []).map((o) => `<button type="button" class="ea-card-btn ea-card-btn-${esc(o.kind)}" data-ea-option="${esc(o.id)}">${esc(o.label)}</button>`).join('');
  return `<div class="ea-card-head"><span class="ea-tile" aria-hidden="true">${esc((agentStatusFor(req.agentId)?.tile) || 'Cx')}</span><strong>${esc(req.title)}</strong></div>
    ${rows.join('')}
    <div class="ea-card-actions">${buttons}</div>
    <div class="ea-card-note">Your answer goes to ${esc(agentName(req.agentId))} only. Prometheus's own permissions are not changed.</div>
    <div class="ea-card-error" hidden></div>`;
}

function collectAnswers(el, req) {
  const answers = {};
  for (const q of (req.detail?.questions || [])) {
    const picked = el.querySelector(`input[name="ea-q-${CSS.escape(req.requestId)}-${CSS.escape(q.id)}"]:checked`);
    const typed = el.querySelector(`input[data-ea-q="${CSS.escape(q.id)}"]`);
    const value = picked ? picked.value : (typed ? typed.value.trim() : '');
    if (value) answers[q.id] = [value];
  }
  return answers;
}

function cardHost() {
  let host = document.getElementById('ea-request-dock');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ea-request-dock';
    host.className = `ea-request-dock ${document.body.classList.contains('pm-mobile-active') ? 'ea-mobile' : 'ea-desktop'}`;
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
}

export function showExternalAgentRequest(req, sessionId) {
  if (!req?.requestId || st.cards.has(req.requestId)) return;
  const el = document.createElement('section');
  el.className = 'ea-card';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', req.title || 'Agent request');
  el.innerHTML = cardHtml(req);
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
  cardHost().appendChild(el);
  st.cards.set(req.requestId, { request: req, el });
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
  section.className = 'ea-card';
  section.innerHTML = '<p>The original agent session could not be found. Your chat history is still here.</p><button type="button">Start a new agent session in this chat</button><p role="status"></p>';
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
  cardHost().appendChild(section);
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
