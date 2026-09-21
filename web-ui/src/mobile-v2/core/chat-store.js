function sessionKey(gatewayId, sessionId) {
  return `${String(gatewayId || 'current')}::${String(sessionId || '')}`;
}

function textFromRecord(record) {
  if (typeof record?.content === 'string') return record.content;
  if (typeof record?.text === 'string') return record.text;
  if (typeof record?.body?.text === 'string') return record.body.text;
  if (typeof record?.body?.content === 'string') return record.body.content;
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

function historyId(record, role, text) {
  const explicit = String(record?.id || record?.messageId || record?.turnId || '').trim();
  if (explicit) return explicit;
  // Page-relative array indexes repeat for every history request. Use stable
  // record data so an earlier page cannot collide with the loaded tail.
  const stamp = String(record?.timestamp || record?.createdAt || record?.workStartedAt || 'undated');
  const seed = `${role}|${stamp}|${text}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `history-${role}-${stamp}-${(hash >>> 0).toString(36)}`;
}

function upsertInteraction(list, record, kind) {
  const next = normalizeInteraction(record, kind);
  if (!next.id) return null;
  const index = list.findIndex((item) => interactionId(item, kind) === next.id);
  if (index >= 0) list[index] = { ...list[index], ...next };
  else list.push(next);
  return index >= 0 ? list[index] : list[list.length - 1];
}

function mergeHistoryInteractions(target, incoming) {
  for (const approval of incoming.approvals || []) upsertInteraction(target.approvals, approval, 'approval');
  for (const question of incoming.questions || []) upsertInteraction(target.questions, question, 'question');
  for (const key of [
    'body', 'attachmentPreviews', 'files', 'generatedImages', 'generated_images',
    'generatedVideos', 'generated_videos', 'richArtifacts', 'artifacts', 'tools',
    'reasoning', 'liveTraceEntries', 'processEntries', 'voiceWorkgroup',
    'goalCompletionReport', 'fileChanges', 'backgroundWork', 'backgroundAgents',
  ]) {
    if (incoming[key] !== undefined) target[key] = incoming[key];
  }
}

function dedupeAssistantHistory(messages) {
  const result = [];
  const byId = new Map();
  const assistantTextByTurn = new Map();
  let turn = 0;

  for (const message of messages) {
    const identity = `${message.role}:${message.id}`;
    const sameId = byId.get(identity);
    if (sameId) {
      mergeHistoryInteractions(sameId, message);
      continue;
    }

    if (message.role === 'user') {
      turn += 1;
      result.push(message);
      byId.set(identity, message);
      continue;
    }

    const contentKey = String(message.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const duplicate = contentKey ? assistantTextByTurn.get(`${turn}:${contentKey}`) : null;
    if (duplicate) {
      mergeHistoryInteractions(duplicate, message);
      continue;
    }

    result.push(message);
    byId.set(identity, message);
    if (contentKey) assistantTextByTurn.set(`${turn}:${contentKey}`, message);
  }

  return result;
}

function normalizeHistory(history = []) {
  const messages = (Array.isArray(history) ? history : []).flatMap((record) => {
    const text = textFromRecord(record);
    const role = record?.role === 'user' ? 'user' : 'assistant';
    const label = String(record?.channelLabel || record?.channel || record?.source || '').trim().toLowerCase();
    const messageKind = String(record?.messageKind || '').trim().toLowerCase();
    const internalRestartPacket = /^Restart Context Packet\b/i.test(text) && !Array.isArray(record?.fileChanges?.files);
    const internalRestartCheckpoint = role === 'assistant' && (
      messageKind === 'restart_checkpoint'
      || /^\[Hot restart checkpoint: planned by this chat\]/i.test(text)
    );
    if (record?.sideChatBoundary === true || label === 'internal_watch' || /^\[Internal watch\b/i.test(text) || internalRestartPacket || internalRestartCheckpoint) return [];

    return [{
      ...record,
      id: historyId(record, role, text),
      role,
      text,
      body: {
        ...(record?.body && typeof record.body === 'object' ? record.body : {}),
        text: String(record?.body?.text || text),
      },
      createdAt: Number(record?.createdAt || record?.timestamp || Date.now()),
      status: 'done',
      reasoning: String(record?.reasoning || ''),
      tools: Array.isArray(record?.tools) ? record.tools : [],
      approvals: normalizeInteractionList(record?.approvals || record?.pendingApprovals, 'approval'),
      questions: normalizeInteractionList(record?.questions || record?.pendingQuestions, 'question'),
    }];
  }).filter((message) => message.text || message.role === 'assistant' || message.approvals.length || message.questions.length);

  return dedupeAssistantHistory(messages);
}

function freshState(gatewayId, sessionId) {
  return {
    gatewayId,
    sessionId,
    title: 'New Chat',
    messages: [],
    olderCursor: null,
    hasOlder: false,
    historyExpanded: false,
    olderLoading: false,
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
      const expandedCursor = state.olderCursor;
      const expandedHasOlder = state.hasOlder;
      state.title = String(session.title || state.title || 'New Chat');
      const incoming = normalizeHistory(history);
      if (state.historyExpanded && state.messages.length) {
        const byId = new Map(incoming.map((message) => [`${message.role}:${message.id}`, message]));
        const retained = state.messages.map((message) => {
          const key = `${message.role}:${message.id}`;
          const fresh = byId.get(key);
          byId.delete(key);
          return fresh || message;
        });
        state.messages = dedupeAssistantHistory([...retained, ...byId.values()]);
      } else {
        state.messages = incoming;
      }
      const page = session.historyPage || payload?.historyPage || {};
      const pageInfo = page?.pageInfo || page;
      state.olderCursor = state.historyExpanded ? expandedCursor : (pageInfo?.olderCursor || null);
      state.hasOlder = state.historyExpanded ? expandedHasOlder : (pageInfo?.hasOlder === true || session.historyTruncated === true);
      state.loading = false;
      state.error = '';
    });
  }

  prependHistory(gatewayId, sessionId, page) {
    return this.mutate(gatewayId, sessionId, (state) => {
      const older = normalizeHistory(page?.items || []);
      const existing = new Set(state.messages.map((message) => message.id));
      state.messages = dedupeAssistantHistory([...older.filter((message) => !existing.has(message.id)), ...state.messages]);
      state.historyExpanded = true;
      const pageInfo = page?.pageInfo || page;
      state.olderCursor = pageInfo?.olderCursor || null;
      state.hasOlder = pageInfo?.hasOlder === true;
    });
  }

  appendUser(gatewayId, sessionId, { id, text, attachments = [] }) {
    return this.mutate(gatewayId, sessionId, (state) => {
      state.error = '';
      state.messages.push({
        id, role: 'user', text,
        body: { text, attachments: Array.isArray(attachments) ? attachments.map((item) => ({ ...item })) : [] },
        attachments: Array.isArray(attachments) ? attachments.map((item) => ({ ...item })) : [],
        createdAt: Date.now(), status: 'done', reasoning: '', tools: [], approvals: [], questions: [],
      });
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
      if (!Array.isArray(message.events)) message.events = [];
      const raw = event.raw && typeof event.raw === 'object' ? event.raw : null;
      const capturePayload = (source) => {
        if (!source || typeof source !== 'object') return;
        for (const key of [
          'richArtifacts', 'artifacts', 'files', 'generatedImages', 'generated_images',
          'generatedVideos', 'generated_videos', 'voiceWorkgroup', 'voice_workgroup',
          'goalCompletionReport', 'goal_completion_report', 'fileChanges', 'file_changes',
          'browseState', 'browse_state', 'actions', 'backgroundWork', 'backgroundAgents',
          'productCarousel', 'attachmentPreviews', 'attachment_previews', 'image',
        ]) {
          if (source[key] !== undefined) message[key] = source[key];
        }
      };
      capturePayload(raw);
      capturePayload(raw?.extra);
      let resultPayload = raw?.result;
      if (typeof resultPayload === 'string') {
        try { resultPayload = JSON.parse(resultPayload); } catch {}
      }
      capturePayload(resultPayload);
      if (raw && event.type !== 'assistant.delta') {
        message.events.push({ type: raw.type || event.type, raw });
        if (message.events.length > 160) message.events.splice(0, message.events.length - 160);
      }
      if (event.type === 'assistant.delta') message.text += event.text || '';
      if (event.type === 'reasoning.summary.delta') {
        message.reasoning += event.text || '';
        if (raw) {
          if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
          message.liveTraceEntries.push({ type: raw.type || 'reasoning_summary', ...raw });
          if (message.liveTraceEntries.length > 160) message.liveTraceEntries.splice(0, message.liveTraceEntries.length - 160);
        }
      }
      if (event.type === 'tool.activity') {
        const last = message.tools[message.tools.length - 1];
        if (last && last.name === event.name && last.phase === event.phase) Object.assign(last, event);
        else message.tools.push({ ...event, raw });
        if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
        message.liveTraceEntries.push({ type: raw?.type || event.phase || 'tool_activity', activity: { kind: 'operation', name: event.name, ...raw }, ...raw });
        if (message.liveTraceEntries.length > 160) message.liveTraceEntries.splice(0, message.liveTraceEntries.length - 160);
      }
      if (event.type === 'approval.required') {
        upsertInteraction(message.approvals, event.approval || event.raw?.approval || event.raw || {}, 'approval');
      }
      if (event.type === 'question.required') {
        upsertInteraction(message.questions, event.question || event.raw?.question || event.raw || {}, 'question');
      }
      if (event.type === 'status' && event.text) message.statusText = String(event.text);
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
