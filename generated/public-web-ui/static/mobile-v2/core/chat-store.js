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

function normalizeHistory(history = []) {
  return (Array.isArray(history) ? history : []).map((record, index) => ({
    id: String(record?.id || record?.messageId || record?.turnId || `history-${index}`),
    role: record?.role === 'user' ? 'user' : 'assistant',
    text: textFromRecord(record),
    createdAt: Number(record?.createdAt || record?.timestamp || Date.now()),
    status: 'done',
    reasoning: '',
    tools: [],
  })).filter((message) => message.text || message.role === 'assistant');
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
      state.olderCursor = page?.pageInfo?.olderCursor || null;
      state.hasOlder = page?.pageInfo?.hasOlder === true || session.historyTruncated === true;
      state.loading = false;
      state.error = '';
    });
  }

  prependHistory(gatewayId, sessionId, page) {
    return this.mutate(gatewayId, sessionId, (state) => {
      const older = normalizeHistory(page?.items || []);
      const existing = new Set(state.messages.map((message) => message.id));
      state.messages = [...older.filter((message) => !existing.has(message.id)), ...state.messages];
      state.olderCursor = page?.pageInfo?.olderCursor || null;
      state.hasOlder = page?.pageInfo?.hasOlder === true;
    });
  }

  appendUser(gatewayId, sessionId, { id, text }) {
    return this.mutate(gatewayId, sessionId, (state) => {
      state.error = '';
      state.messages.push({ id, role: 'user', text, createdAt: Date.now(), status: 'done', reasoning: '', tools: [] });
    });
  }

  beginAssistant(gatewayId, sessionId, id) {
    return this.mutate(gatewayId, sessionId, (state) => {
      state.streaming = true;
      state.messages.push({ id, role: 'assistant', text: '', createdAt: Date.now(), status: 'streaming', reasoning: '', tools: [] });
    });
  }

  applyStreamEvent(gatewayId, sessionId, assistantId, event) {
    return this.mutate(gatewayId, sessionId, (state) => {
      const message = state.messages.find((item) => item.id === assistantId);
      if (!message) return;
      if (event.type === 'assistant.delta') message.text += event.text || '';
      if (event.type === 'reasoning.summary.delta') message.reasoning += event.text || '';
      if (event.type === 'tool.activity') {
        const last = message.tools[message.tools.length - 1];
        if (last && last.name === event.name) Object.assign(last, event);
        else message.tools.push({ ...event });
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
