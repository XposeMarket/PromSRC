function sessionKey(gatewayId, sessionId) {
  return `${String(gatewayId || 'current')}::${String(sessionId || '')}`;
}

function textFromRecord(record) {
  if (typeof record?.content === 'string') return record.content;
  if (typeof record?.text === 'string') return record.text;
  if (Array.isArray(record?.content)) {
    return record.content.map((part) => typeof part === 'string' ? part : (part?.text || '')).join('');
  }
  return '';
}

function interactionId(record, kind) {
  if (!record || typeof record !== 'object') return '';
  if (kind === 'approval') return String(record.id || record.approvalId || record.approval_id || '');
  return String(record.id || record.questionId || record.question_id || '');
}

function normalizeInteraction(record, kind) {
  const source = record && typeof record === 'object' ? record : {};
  const id = interactionId(source, kind);
  return {
    ...source,
    id,
    status: String(source.status || 'pending').toLowerCase(),
  };
}

function normalizeInteractionList(records, kind) {
  return (Array.isArray(records) ? records : [])
    .map((record) => normalizeInteraction(record, kind))
    .filter((record) => record.id);
}

function upsertInteraction(list, record, kind) {
  const next = normalizeInteraction(record, kind);
  if (!next.id) return null;
  const index = list.findIndex((item) => interactionId(item, kind) === next.id);
  if (index >= 0) list[index] = { ...list[index], ...next };
  else list.push(next);
  return index >= 0 ? list[index] : list[list.length - 1];
}

function normalizeHistory(history = []) {
  return (Array.isArray(history) ? history : []).map((record, index) => ({
    id: String(record?.id || record?.messageId || record?.turnId || `history-${index}`),
    role: record?.role === 'user' ? 'user' : 'assistant',
    text: textFromRecord(record),
    createdAt: Number(record?.createdAt || record?.timestamp || Date.now()),
    status: 'done',
    reasoning: '',
    tools: [],
    approvals: normalizeInteractionList(record?.approvals, 'approval'),
    questions: normalizeInteractionList(record?.questions, 'question'),
  })).filter((message) => message.text || message.role === 'assistant' || message.approvals.length || message.questions.length);
}

function freshState(gatewayId, sessionId) {
  return {
    gatewayId,
    sessionId,
    title: 'New Chat',
    messages: [],
    olderCursor: null,
    hasOlder: false,
    loading: false,
    streaming: false,
    error: '',
    revision: 0,
  };
}

export class ChatStore {
  constructor() {
    this.states = new Map();
    this.listeners = new Map();
  }

  key(gatewayId, sessionId) { return sessionKey(gatewayId, sessionId); }

  get(gatewayId, sessionId) {
    const key = this.key(gatewayId, sessionId);
    if (!this.states.has(key)) this.states.set(key, freshState(gatewayId, sessionId));
    return this.states.get(key);
  }

  subscribe(gatewayId, sessionId, listener) {
    const key = this.key(gatewayId, sessionId);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(listener);
    listener(this.get(gatewayId, sessionId));
    return () => this.listeners.get(key)?.delete(listener);
  }

  mutate(gatewayId, sessionId, mutator) {
    const state = this.get(gatewayId, sessionId);
    mutator(state);
    state.revision += 1;
    for (const listener of this.listeners.get(this.key(gatewayId, sessionId)) || []) listener(state);
    return state;
  }

  setLoading(gatewayId, sessionId, loading) {
    return this.mutate(gatewayId, sessionId, (state) => { state.loading = !!loading; });
  }

  hydrate(gatewayId, sessionId, payload) {
    const session = payload?.session || payload || {};
    const history = Array.isArray(session.history) ? session.history : (Array.isArray(payload?.history) ? payload.history : []);
    return this.mutate(gatewayId, sessionId, (state) => {
      state.title = String(session.title || state.title || 'New Chat');
      state.messages = normalizeHistory(history);
      const page = session.historyPage || payload?.historyPage || {};
      const pageInfo = page?.pageInfo || page;
      state.olderCursor = pageInfo?.olderCursor || null;
      state.hasOlder = pageInfo?.hasOlder === true || session.historyTruncated === true;
      state.loading = false;
      state.error = '';
    });
  }

  prependHistory(gatewayId, sessionId, page) {
    return this.mutate(gatewayId, sessionId, (state) => {
      const older = normalizeHistory(page?.items || []);
      const existing = new Set(state.messages.map((message) => message.id));
      state.messages = [...older.filter((message) => !existing.has(message.id)), ...state.messages];
      const pageInfo = page?.pageInfo || page;
      state.olderCursor = pageInfo?.olderCursor || null;
      state.hasOlder = pageInfo?.hasOlder === true;
    });
  }

  appendUser(gatewayId, sessionId, { id, text }) {
    return this.mutate(gatewayId, sessionId, (state) => {
      state.error = '';
      state.messages.push({ id, role: 'user', text, createdAt: Date.now(), status: 'done', reasoning: '', tools: [], approvals: [], questions: [] });
    });
  }

  beginAssistant(gatewayId, sessionId, id) {
    return this.mutate(gatewayId, sessionId, (state) => {
      state.streaming = true;
      state.messages.push({ id, role: 'assistant', text: '', createdAt: Date.now(), status: 'streaming', reasoning: '', tools: [], approvals: [], questions: [] });
    });
  }

  updateInteraction(gatewayId, sessionId, kind, id, patch = {}) {
    const listKey = kind === 'approval' ? 'approvals' : 'questions';
    const targetId = String(id || '');
    if (!targetId) return this.get(gatewayId, sessionId);
    return this.mutate(gatewayId, sessionId, (state) => {
      for (let index = state.messages.length - 1; index >= 0; index -= 1) {
        const message = state.messages[index];
        const list = Array.isArray(message[listKey]) ? message[listKey] : (message[listKey] = []);
        const current = list.find((item) => interactionId(item, kind) === targetId);
        if (!current) continue;
        Object.assign(current, patch || {}, { id: targetId });
        return;
      }
    });
  }

  upsertInteraction(gatewayId, sessionId, kind, record) {
    const listKey = kind === 'approval' ? 'approvals' : 'questions';
    const normalized = normalizeInteraction(record, kind);
    if (!normalized.id) return this.get(gatewayId, sessionId);
    return this.mutate(gatewayId, sessionId, (state) => {
      let message = [...state.messages].reverse().find((item) => (
        item.role === 'assistant'
        && (Array.isArray(item[listKey]) ? item[listKey] : []).some((entry) => interactionId(entry, kind) === normalized.id)
      ));
      message ||= [...state.messages].reverse().find((item) => item.role === 'assistant');
      if (!message) {
        message = {
          id: `interaction-${kind}-${normalized.id}`,
          role: 'assistant',
          text: '',
          createdAt: Date.now(),
          status: 'done',
          reasoning: '',
          tools: [],
          approvals: [],
          questions: [],
        };
        state.messages.push(message);
      }
      if (!Array.isArray(message[listKey])) message[listKey] = [];
      upsertInteraction(message[listKey], normalized, kind);
    });
  }

  applyStreamEvent(gatewayId, sessionId, assistantId, event) {
    return this.mutate(gatewayId, sessionId, (state) => {
      const message = state.messages.find((item) => item.id === assistantId);
      if (!message) return;
      if (!Array.isArray(message.approvals)) message.approvals = [];
      if (!Array.isArray(message.questions)) message.questions = [];
      if (event.type === 'assistant.delta') message.text += event.text || '';
      if (event.type === 'reasoning.summary.delta') message.reasoning += event.text || '';
      if (event.type === 'tool.activity') {
        const last = message.tools[message.tools.length - 1];
        if (last && last.name === event.name) Object.assign(last, event);
        else message.tools.push({ ...event });
      }
      if (event.type === 'approval.required') {
        upsertInteraction(message.approvals, event.approval || event.raw?.approval || event.raw || {}, 'approval');
      }
      if (event.type === 'question.required') {
        upsertInteraction(message.questions, event.question || event.raw?.question || event.raw || {}, 'question');
      }
      if (event.type === 'assistant.done') {
        if (event.text && !message.text) message.text = event.text;
        message.status = 'done';
        state.streaming = false;
      }
      if (event.type === 'assistant.error') {
        message.status = 'error';
        state.streaming = false;
        state.error = event.message || 'Chat failed.';
      }
    });
  }

  failStream(gatewayId, sessionId, assistantId, error) {
    return this.applyStreamEvent(gatewayId, sessionId, assistantId, {
      type: 'assistant.error',
      message: String(error?.message || error || 'Chat failed.'),
    });
  }
}
