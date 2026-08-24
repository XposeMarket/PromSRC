import {
  appendFinalResponseDelta,
  reconcileFinalResponse,
} from '../core/final-response.js';

const DEFAULT_IDLE_TTL_MS = 15 * 60_000;
const DEFAULT_SETTLED_TTL_MS = 2 * 60_000;
const DEFAULT_MAX_RUNTIMES = 48;
const MUTATING_ARRAY_METHODS = new Set([
  'copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift',
]);

function cleanId(value, fallback = '') {
  return String(value ?? '').trim() || fallback;
}

function canonicalRole(value) {
  const role = cleanId(value).toLowerCase();
  if (role === 'ai' || role === 'assistant') return 'assistant';
  if (role === 'user') return 'user';
  if (role === 'system') return 'system';
  return role || 'assistant';
}

function hashText(value) {
  // FNV-1a is used only for stable in-memory identity, never for security.
  let hash = 0x811c9dc5;
  const input = String(value ?? '');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function chatRuntimeKey({ gatewayId, sessionId } = {}) {
  const gateway = cleanId(gatewayId, 'gateway:local');
  const session = cleanId(sessionId);
  if (!session) throw new Error('A chat runtime requires a sessionId.');
  return `${encodeURIComponent(gateway)}::${encodeURIComponent(session)}`;
}

export function chatTurnKey(message, index = 0, occurrence = 0) {
  const explicit = cleanId(message?.messageId || message?.turnId || message?.id);
  if (explicit) return `id:${explicit}`;
  const role = canonicalRole(message?.role);
  const clientRequestId = cleanId(message?.clientRequestId || message?._clientRequestId);
  // A request id owns a user/assistant pair, not a single transcript row.
  // Keeping the role in the fallback key prevents the keyed timeline from
  // reusing the assistant DOM node for the optimistic user message while the
  // mobile runtime is still synchronizing its role-scoped message ids.
  if (clientRequestId) return `request:${role}:${clientRequestId}`;
  const timestamp = Number(message?.timestamp || message?.createdAt || message?.timeMs || 0) || 0;
  const content = String(message?.content ?? message?.body?.text ?? '');
  const source = cleanId(message?.source || message?.channel || message?.messageKind);
  const base = `anon:${hashText(`${role}\u0000${timestamp}\u0000${source}\u0000${content}`)}`;
  return occurrence > 0 ? `${base}:${occurrence}` : base;
}

function normalizeTurn(message, key, previous = null) {
  const source = message && typeof message === 'object' ? message : {};
  const content = String(source.content ?? source.body?.text ?? previous?.content ?? '');
  const role = canonicalRole(source.role ?? previous?.role);
  const streaming = source.streaming === true;
  const status = streaming ? 'streaming' : cleanId(source.status, previous?.status || 'complete');
  const messageId = cleanId(source.messageId || source.turnId || previous?.messageId) || null;
  const clientRequestId = cleanId(source.clientRequestId || source._clientRequestId || previous?.clientRequestId) || null;
  const approvalRequest = source.approvalRequest || previous?.approvalRequest || null;
  const questionRequest = source.questionRequest || previous?.questionRequest || null;
  const timestamp = Number(source.timestamp || previous?.timestamp || Date.now()) || Date.now();
  if (previous
    && previous.source === source
    && previous.role === role
    && previous.content === content
    && previous.status === status
    && previous.messageId === messageId
    && previous.clientRequestId === clientRequestId
    && previous.approvalRequest === approvalRequest
    && previous.questionRequest === questionRequest
    && previous.timestamp === timestamp) {
    return previous;
  }
  return Object.freeze({
    key,
    role,
    content,
    timestamp,
    status,
    messageId,
    clientRequestId,
    approvalRequest,
    questionRequest,
    attachments: Object.freeze([
      ...(Array.isArray(source.attachmentPreviews) ? source.attachmentPreviews : []),
      ...(Array.isArray(source.body?.attachments) ? source.body.attachments : []),
    ]),
    source,
    revision: Number(previous?.revision || 0) + 1,
  });
}

function pageInfo(input = {}, fallbackCount = 0) {
  const totalCount = Math.max(fallbackCount, Number(input?.totalCount || 0) || 0);
  return Object.freeze({
    olderCursor: cleanId(input?.olderCursor) || null,
    hasOlder: input?.hasOlder === true,
    totalCount,
    loadedCount: Math.max(0, Number(input?.loadedCount || fallbackCount) || fallbackCount),
    loadingOlder: input?.loadingOlder === true,
    error: cleanId(input?.error) || null,
  });
}

function equalPage(left, right) {
  return left?.olderCursor === right?.olderCursor
    && left?.hasOlder === right?.hasOlder
    && left?.totalCount === right?.totalCount
    && left?.loadedCount === right?.loadedCount
    && left?.loadingOlder === right?.loadingOlder
    && left?.error === right?.error;
}

function pendingRecord(value) {
  return String(value?.status || 'pending').toLowerCase() === 'pending';
}

function activeBackgroundRecord(value) {
  return ['queued', 'running', 'in_progress', 'approval_required', 'paused']
    .includes(String(value?.status || '').toLowerCase());
}

export class ChatRuntime {
  constructor({ gatewayId, sessionId, now = () => Date.now() } = {}) {
    this.gatewayId = cleanId(gatewayId, 'gateway:local');
    this.sessionId = cleanId(sessionId);
    this.key = chatRuntimeKey(this);
    this._now = now;
    this._turns = new Map();
    this._indexByKey = new Map();
    this._order = Object.freeze([]);
    this._sourceHistory = Object.freeze([]);
    this._queue = [];
    this._attachments = [];
    this._queueBridge = this._createArrayBridge(this._queue, 'queue');
    this._attachmentBridge = this._createArrayBridge(this._attachments, 'attachments');
    this._approvals = new Map();
    this._questions = new Map();
    this._background = new Map();
    this._owners = new Map();
    this._subscriptions = new Set();
    this._batchDepth = 0;
    this._dirty = false;
    const createdAt = this._now();
    this._state = Object.freeze({
      lifecycle: Object.freeze({
        phase: 'idle',
        referenceCount: 0,
        settled: false,
        background: false,
        createdAt,
        lastReferencedAt: createdAt,
        lastActivityAt: createdAt,
      }),
      history: Object.freeze({ revision: 0, order: this._order, turns: this._turns }),
      paging: pageInfo(),
      stream: Object.freeze({
        active: false,
        turnKey: null,
        clientRequestId: null,
        text: '',
        reasoning: '',
        startedAt: 0,
        lastChunkAt: 0,
        terminalAt: 0,
      }),
      queue: Object.freeze([]),
      retry: Object.freeze({ attempt: 0, pending: false, reason: '', nextAt: 0 }),
      interruption: Object.freeze({ requested: false, requestedAt: 0, source: '', acknowledged: false }),
      approvals: Object.freeze([]),
      questions: Object.freeze([]),
      attachments: Object.freeze([]),
      background: Object.freeze([]),
    });
  }

  get snapshot() {
    return this._state;
  }

  get referenceCount() {
    return this._state.lifecycle.referenceCount;
  }

  transaction(callback) {
    this._batchDepth += 1;
    try {
      return callback(this);
    } finally {
      this._batchDepth -= 1;
      if (this._batchDepth === 0 && this._dirty) this._emit();
    }
  }

  subscribe(selector, listener, options = {}) {
    if (typeof selector !== 'function' || typeof listener !== 'function') {
      throw new TypeError('subscribe(selector, listener) requires two functions.');
    }
    const subscription = {
      selector,
      listener,
      equals: typeof options.equals === 'function' ? options.equals : Object.is,
      selected: selector(this._state),
    };
    this._subscriptions.add(subscription);
    if (options.fireImmediately === true) listener(subscription.selected, undefined, this._state);
    return () => this._subscriptions.delete(subscription);
  }

  retain(owner = 'view') {
    const id = cleanId(owner, 'view');
    this._owners.set(id, (this._owners.get(id) || 0) + 1);
    this._setLifecycle({
      referenceCount: [...this._owners.values()].reduce((sum, count) => sum + count, 0),
      lastReferencedAt: this._now(),
    });
    return () => this.release(id);
  }

  release(owner = 'view') {
    const id = cleanId(owner, 'view');
    const count = this._owners.get(id) || 0;
    if (count <= 1) this._owners.delete(id);
    else this._owners.set(id, count - 1);
    this._setLifecycle({
      referenceCount: [...this._owners.values()].reduce((sum, value) => sum + value, 0),
      lastReferencedAt: this._now(),
    });
  }

  setLifecycle(patch = {}) {
    this._setLifecycle({
      phase: cleanId(patch.phase, this._state.lifecycle.phase),
      settled: patch.settled === undefined ? this._state.lifecycle.settled : patch.settled === true,
      background: patch.background === undefined ? this._state.lifecycle.background : patch.background === true,
      lastActivityAt: Number(patch.lastActivityAt || this._now()) || this._now(),
    });
  }

  replaceHistory(messages = [], options = {}) {
    const input = Array.isArray(messages) ? messages : [];
    const counts = new Map();
    const nextTurns = new Map();
    const nextIndexByKey = new Map();
    const nextOrder = [];
    const nextSources = [];
    input.forEach((message, index) => {
      const base = chatTurnKey(message, index, 0);
      const occurrence = counts.get(base) || 0;
      counts.set(base, occurrence + 1);
      const key = occurrence > 0 ? `${base}:${occurrence}` : base;
      const previous = this._turns.get(key) || null;
      nextTurns.set(key, normalizeTurn(message, key, previous));
      nextIndexByKey.set(key, index);
      nextOrder.push(key);
      nextSources.push(message);
    });
    this._turns = nextTurns;
    this._indexByKey = nextIndexByKey;
    this._order = Object.freeze(nextOrder);
    this._sourceHistory = Object.freeze(nextSources);
    const nextHistory = Object.freeze({
      revision: this._state.history.revision + 1,
      order: this._order,
      turns: this._turns,
      source: cleanId(options.source, 'hydrate'),
    });
    const nextPaging = pageInfo(options.pageInfo || this._state.paging, nextOrder.length);
    this._replaceState({ history: nextHistory, paging: nextPaging });
    this._touchActivity();
    return this.getSourceHistory();
  }

  prependHistoryPage(messages = [], nextPageInfo = {}) {
    const incoming = Array.isArray(messages) ? messages : [];
    const combined = [...incoming, ...this._sourceHistory];
    const explicitSeen = new Set();
    const deduped = combined.filter((message, index) => {
      const explicit = cleanId(
        message?.messageId || message?.turnId || message?.clientRequestId || message?._clientRequestId || message?.id,
      );
      if (!explicit) return true;
      if (explicitSeen.has(explicit)) return false;
      explicitSeen.add(explicit);
      return true;
    });
    return this.replaceHistory(deduped, {
      source: 'older-page',
      pageInfo: {
        ...nextPageInfo,
        loadedCount: deduped.length,
        loadingOlder: false,
        error: null,
      },
    });
  }

  setPaging(patch = {}) {
    const next = pageInfo({ ...this._state.paging, ...patch }, this._order.length);
    if (!equalPage(next, this._state.paging)) this._replaceState({ paging: next });
  }

  getTurns() {
    return this._order.map((key) => this._turns.get(key)).filter(Boolean);
  }

  getSourceHistory() {
    return this._sourceHistory.slice();
  }

  beginStreaming({ turnId, clientRequestId, text = '', reasoning = '', startedAt } = {}) {
    const now = Number(startedAt || this._now()) || this._now();
    const identity = cleanId(turnId || clientRequestId);
    const key = identity ? `id:${identity}` : `stream:${now}`;
    const source = {
      messageId: cleanId(turnId) || undefined,
      clientRequestId: cleanId(clientRequestId) || undefined,
      role: 'assistant',
      content: String(text || ''),
      timestamp: now,
      streaming: true,
    };
    const existingIndex = this._indexByKey.get(key) ?? -1;
    if (existingIndex >= 0) {
      const history = this.getSourceHistory();
      history[existingIndex] = { ...history[existingIndex], ...source };
      this.replaceHistory(history, { pageInfo: this._state.paging, source: 'stream-begin' });
    } else {
      this.replaceHistory([...this._sourceHistory, source], { pageInfo: this._state.paging, source: 'stream-begin' });
    }
    this._replaceState({
      stream: Object.freeze({
        active: true,
        turnKey: key,
        clientRequestId: cleanId(clientRequestId) || null,
        text: String(text || ''),
        reasoning: String(reasoning || ''),
        startedAt: now,
        lastChunkAt: now,
        terminalAt: 0,
      }),
      interruption: Object.freeze({ requested: false, requestedAt: 0, source: '', acknowledged: false }),
      retry: Object.freeze({ attempt: 0, pending: false, reason: '', nextAt: 0 }),
    });
    this._setLifecycle({ phase: 'streaming', lastActivityAt: now });
    return key;
  }

  appendStreamDelta(delta, options = {}) {
    if (!this._state.stream.active && options.allowStart !== true) return this._state.stream.text;
    if (!this._state.stream.active) this.beginStreaming(options);
    const text = appendFinalResponseDelta(this._state.stream.text, delta);
    const now = this._now();
    this._replaceState({
      stream: Object.freeze({ ...this._state.stream, active: true, text, lastChunkAt: now }),
    });
    this._updateStreamTurn(text, true);
    this._touchActivity(now);
    return text;
  }

  completeStream(canonicalText = '', messagePatch = {}) {
    const text = reconcileFinalResponse(this._state.stream.text, canonicalText);
    const now = this._now();
    this._updateStreamTurn(text, false, messagePatch);
    this._replaceState({
      stream: Object.freeze({
        ...this._state.stream,
        active: false,
        text,
        lastChunkAt: now,
        terminalAt: now,
      }),
      retry: Object.freeze({ attempt: 0, pending: false, reason: '', nextAt: 0 }),
      interruption: Object.freeze({
        ...this._state.interruption,
        acknowledged: this._state.interruption.requested,
      }),
    });
    this._setLifecycle({ phase: 'idle', lastActivityAt: now });
    return text;
  }

  markRetry({ attempt, reason = '', nextAt = 0 } = {}) {
    this._replaceState({
      retry: Object.freeze({
        attempt: Math.max(1, Number(attempt || this._state.retry.attempt + 1) || 1),
        pending: true,
        reason: String(reason || ''),
        nextAt: Math.max(0, Number(nextAt || 0) || 0),
      }),
    });
    this._setLifecycle({ phase: 'retrying', lastActivityAt: this._now() });
  }

  requestInterruption(source = 'view') {
    const now = this._now();
    this._replaceState({
      interruption: Object.freeze({ requested: true, requestedAt: now, source: cleanId(source, 'view'), acknowledged: false }),
    });
    this._setLifecycle({ phase: 'interrupting', lastActivityAt: now });
  }

  replaceQueue(items = []) {
    this._replaceMutableList(this._queue, items, 'queue');
    return this._queueBridge;
  }

  queuePrompt(item) {
    this._queueBridge.push(item);
    return this._queue.length;
  }

  dequeuePrompt() {
    return this._queueBridge.shift();
  }

  getQueueBridge() {
    return this._queueBridge;
  }

  replaceAttachments(items = []) {
    this._replaceMutableList(this._attachments, items, 'attachments');
    return this._attachmentBridge;
  }

  getAttachmentBridge() {
    return this._attachmentBridge;
  }

  upsertApproval(record) {
    return this._upsertRecord(this._approvals, record, 'approvals');
  }

  resolveApproval(id, status = 'approved', patch = {}) {
    return this._resolveRecord(this._approvals, id, status, patch, 'approvals');
  }

  upsertQuestion(record) {
    return this._upsertRecord(this._questions, record, 'questions');
  }

  resolveQuestion(id, status = 'answered', patch = {}) {
    return this._resolveRecord(this._questions, id, status, patch, 'questions');
  }

  upsertBackground(record) {
    return this._upsertRecord(this._background, record, 'background');
  }

  removeBackground(id) {
    const key = cleanId(id);
    if (!key || !this._background.delete(key)) return false;
    this._syncRecordSlice('background');
    return true;
  }

  canEvict(now = this._now(), options = {}) {
    if (this.referenceCount > 0 || this._state.stream.active || this._state.lifecycle.background) return false;
    if (this._queue.length > 0) return false;
    if ([...this._approvals.values()].some(pendingRecord) || [...this._questions.values()].some(pendingRecord)) return false;
    if ([...this._background.values()].some(activeBackgroundRecord)) return false;
    const ttl = this._state.lifecycle.settled
      ? Math.max(0, Number(options.settledTtlMs ?? DEFAULT_SETTLED_TTL_MS))
      : Math.max(0, Number(options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS));
    return now - Math.max(this._state.lifecycle.lastReferencedAt, this._state.lifecycle.lastActivityAt) >= ttl;
  }

  _updateStreamTurn(text, streaming, patch = {}) {
    const key = this._state.stream.turnKey;
    if (!key) return;
    const index = this._indexByKey.get(key) ?? -1;
    if (index < 0) return;
    let source = this._sourceHistory[index] && typeof this._sourceHistory[index] === 'object'
      ? this._sourceHistory[index]
      : {};
    if (!Object.isExtensible(source)) {
      source = { ...source };
      const nextSources = this._sourceHistory.slice();
      nextSources[index] = source;
      this._sourceHistory = Object.freeze(nextSources);
    }
    Object.assign(source, {
      ...patch,
      role: source.role || 'assistant',
      content: String(text || ''),
      streaming,
      ...(streaming ? {} : { workEndedAt: Number(patch.workEndedAt || this._now()) || this._now() }),
    });
    this._turns.set(key, normalizeTurn(source, key, this._turns.get(key) || null));
    this._replaceState({
      history: Object.freeze({
        ...this._state.history,
        revision: this._state.history.revision + 1,
        source: streaming ? 'stream-delta' : 'stream-final',
      }),
    });
  }

  _upsertRecord(map, record, slice) {
    const id = cleanId(record?.id || record?.approvalId || record?.questionId || record?.backgroundId || record?.bgId);
    if (!id) throw new Error(`${slice} records require an id.`);
    const next = Object.freeze({ ...(map.get(id) || {}), ...(record || {}), id });
    map.set(id, next);
    this._syncRecordSlice(slice);
    this._touchActivity();
    return next;
  }

  _resolveRecord(map, id, status, patch, slice) {
    const key = cleanId(id);
    if (!key) return null;
    return this._upsertRecord(map, { ...(map.get(key) || {}), ...(patch || {}), id: key, status }, slice);
  }

  _syncRecordSlice(slice) {
    const map = slice === 'approvals' ? this._approvals : slice === 'questions' ? this._questions : this._background;
    this._replaceState({ [slice]: Object.freeze([...map.values()]) });
  }

  _replaceMutableList(target, values, slice) {
    target.splice(0, target.length, ...(Array.isArray(values) ? values : []));
    this._syncMutableList(slice);
  }

  _createArrayBridge(target, slice) {
    return new Proxy(target, {
      get: (array, property, receiver) => {
        const value = Reflect.get(array, property, receiver);
        if (typeof property === 'string' && MUTATING_ARRAY_METHODS.has(property) && typeof value === 'function') {
          return (...args) => {
            const result = Array.prototype[property].apply(array, args);
            this._syncMutableList(slice);
            this._touchActivity();
            return result;
          };
        }
        return value;
      },
      set: (array, property, value, receiver) => {
        const changed = Reflect.set(array, property, value, receiver);
        if (changed) {
          this._syncMutableList(slice);
          this._touchActivity();
        }
        return changed;
      },
      deleteProperty: (array, property) => {
        const changed = Reflect.deleteProperty(array, property);
        if (changed) this._syncMutableList(slice);
        return changed;
      },
    });
  }

  _syncMutableList(slice) {
    const source = slice === 'queue' ? this._queue : this._attachments;
    this._replaceState({ [slice]: Object.freeze(source.slice()) });
  }

  _setLifecycle(patch) {
    this._replaceState({ lifecycle: Object.freeze({ ...this._state.lifecycle, ...patch }) });
  }

  _touchActivity(at = this._now()) {
    this._setLifecycle({ lastActivityAt: Number(at || this._now()) || this._now() });
  }

  _replaceState(patch) {
    this._state = Object.freeze({ ...this._state, ...patch });
    this._dirty = true;
    if (this._batchDepth === 0) this._emit();
  }

  _emit() {
    this._dirty = false;
    for (const subscription of [...this._subscriptions]) {
      let selected;
      try {
        selected = subscription.selector(this._state);
      } catch (error) {
        queueMicrotask(() => { throw error; });
        continue;
      }
      if (subscription.equals(selected, subscription.selected)) continue;
      const previous = subscription.selected;
      subscription.selected = selected;
      subscription.listener(selected, previous, this._state);
    }
  }
}

const runtimeRegistry = new Map();
let evictionTimer = null;

export function getChatRuntime(identity, options = {}) {
  const key = chatRuntimeKey(identity);
  let runtime = runtimeRegistry.get(key);
  if (!runtime) {
    runtime = new ChatRuntime({ ...identity, now: options.now });
    runtimeRegistry.set(key, runtime);
  }
  return runtime;
}

export function acquireChatRuntime(identity, owner = 'view', options = {}) {
  const runtime = getChatRuntime(identity, options);
  const release = runtime.retain(owner);
  return { runtime, release };
}

export function peekChatRuntime(identity) {
  try {
    return runtimeRegistry.get(chatRuntimeKey(identity)) || null;
  } catch {
    return null;
  }
}

export function deleteChatRuntime(identity, options = {}) {
  const runtime = peekChatRuntime(identity);
  if (!runtime) return false;
  if (options.force !== true && !runtime.canEvict(options.now ?? Date.now(), { idleTtlMs: 0, settledTtlMs: 0 })) return false;
  return runtimeRegistry.delete(runtime.key);
}

export function sweepChatRuntimes(options = {}) {
  const now = Number(options.now ?? Date.now()) || Date.now();
  let evicted = 0;
  for (const [key, runtime] of runtimeRegistry) {
    if (!runtime.canEvict(now, options)) continue;
    runtimeRegistry.delete(key);
    evicted += 1;
  }
  const maxEntries = Math.max(1, Number(options.maxEntries ?? DEFAULT_MAX_RUNTIMES) || DEFAULT_MAX_RUNTIMES);
  if (runtimeRegistry.size > maxEntries) {
    const candidates = [...runtimeRegistry.values()]
      .filter((runtime) => runtime.canEvict(now, { ...options, idleTtlMs: 0, settledTtlMs: 0 }))
      .sort((left, right) => left.snapshot.lifecycle.lastReferencedAt - right.snapshot.lifecycle.lastReferencedAt);
    while (runtimeRegistry.size > maxEntries && candidates.length) {
      const runtime = candidates.shift();
      if (runtimeRegistry.delete(runtime.key)) evicted += 1;
    }
  }
  return { evicted, retained: runtimeRegistry.size };
}

export function installChatRuntimeEvictionLoop(options = {}) {
  if (evictionTimer || typeof setInterval !== 'function') return () => {};
  const intervalMs = Math.max(15_000, Number(options.intervalMs || 60_000) || 60_000);
  evictionTimer = setInterval(() => sweepChatRuntimes(options), intervalMs);
  evictionTimer?.unref?.();
  return () => {
    if (evictionTimer) clearInterval(evictionTimer);
    evictionTimer = null;
  };
}

export function chatRuntimeRegistryStats() {
  return {
    count: runtimeRegistry.size,
    runtimes: [...runtimeRegistry.values()].map((runtime) => ({
      key: runtime.key,
      gatewayId: runtime.gatewayId,
      sessionId: runtime.sessionId,
      references: runtime.referenceCount,
      phase: runtime.snapshot.lifecycle.phase,
      settled: runtime.snapshot.lifecycle.settled,
      turns: runtime.snapshot.history.order.length,
    })),
  };
}

export function resetChatRuntimeRegistryForTests() {
  runtimeRegistry.clear();
  if (evictionTimer) clearInterval(evictionTimer);
  evictionTimer = null;
}
