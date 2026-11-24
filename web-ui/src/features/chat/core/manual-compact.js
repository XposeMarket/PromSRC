// Manual `/compact` for native desktop and mobile chats.
//
// The command is a maintenance request, never a model turn. It posts to the
// dedicated gateway route and waits on plain HTTP while the gateway compacts.
// The gateway persists a tagged receipt (`manual_compact_command`) and one
// updating status row (`manual_compact_status`, field `compactStatus`). Both
// surfaces render that status row only through the existing compaction break;
// no assistant prose is created and nothing continues when it finishes. The
// next conversational turn starts only from a new explicit send.

export const MANUAL_COMPACT_COMMAND = '/compact';
export const MANUAL_COMPACT_ENDPOINT = '/api/chat/manual-compact';
export const MANUAL_COMPACT_COMMAND_KIND = 'manual_compact_command';
export const MANUAL_COMPACT_STATUS_KIND = 'manual_compact_status';
export const MANUAL_COMPACT_TIMEOUT_MS = 15 * 60_000;

export const MANUAL_COMPACT_SYNTAX_MESSAGE = 'Send /compact by itself, without extra text or attachments.';
export const MANUAL_COMPACT_UNSUPPORTED_MESSAGE = '/compact is available in native Prometheus chats only.';
export const MANUAL_COMPACT_BUSY_MESSAGE = 'This chat is busy. Send /compact again when it is idle.';
export const MANUAL_COMPACT_ACTIVE_MESSAGE = 'Context is compacting. Your draft is kept; send it when compaction finishes.';
export const MANUAL_COMPACT_ERROR_MESSAGE = 'Manual compaction is unavailable right now.';

export const MANUAL_COMPACT_LABELS = Object.freeze({
  running: 'Compacting context…',
  success: 'Context compacted. Send a message when you’re ready.',
  skipped: 'Nothing new to compact.',
  failed: 'Compaction did not finish. Your previous context is unchanged.',
});

const RESUME_RETRY_MS = 15_000;
const TERMINAL = new Set(['success', 'skipped', 'failed']);
const COMPACT_PREFIX = /^\/compact(?:\s|$)/i;

/**
 * none: ordinary text (including "/compacted" or prose that mentions /compact)
 * compact: a bare, standalone command
 * syntax: the command with arguments or attachments (never silently dropped)
 * unsupported: the chat is bound to an external harness
 */
export function classifyManualCompactInput(message, options = {}) {
  const text = String(message || '').trim();
  if (!COMPACT_PREFIX.test(text)) return { kind: 'none' };
  if (options.external) return { kind: 'unsupported', error: MANUAL_COMPACT_UNSUPPORTED_MESSAGE };
  const attachmentCount = Math.max(0, Number(options.attachmentCount || 0) || 0);
  if (text.toLowerCase() !== MANUAL_COMPACT_COMMAND || attachmentCount > 0) {
    return { kind: 'syntax', error: MANUAL_COMPACT_SYNTAX_MESSAGE };
  }
  return { kind: 'compact' };
}

/** True when the chat is owned by a connected agent / import rather than Prometheus. */
export function isManualCompactExternalSession({ sessionId = '', session = null, binding = null, isDot = false } = {}) {
  const sid = String(sessionId || session?.id || '').trim();
  if (binding && String(binding.agentId || binding.id || 'prometheus') !== 'prometheus') return true;
  if (isDot) return true;
  if (session?.externalAgent || session?.externalImport) return true;
  if (/^(subagent_chat_|voice_room_)/i.test(sid)) return true;
  const source = String(session?.source || session?.channel || '').toLowerCase();
  return source === 'voice_room';
}

export function isManualCompactRow(msg) {
  const kind = String(msg?.messageKind || '').trim();
  return kind === MANUAL_COMPACT_COMMAND_KIND || kind === MANUAL_COMPACT_STATUS_KIND;
}

export function isManualCompactStatusRow(msg) {
  return String(msg?.messageKind || '').trim() === MANUAL_COMPACT_STATUS_KIND;
}

export function isManualCompactCommandRow(msg) {
  return String(msg?.messageKind || '').trim() === MANUAL_COMPACT_COMMAND_KIND;
}

/** The gateway's `compactStatus` is authoritative; text is only a fallback. */
export function manualCompactRowStatus(msg) {
  const explicit = String(msg?.compactStatus || '').trim().toLowerCase();
  if (explicit === 'running' || TERMINAL.has(explicit)) return explicit;
  const text = String(msg?.content || msg?.body?.text || '').toLowerCase();
  if (/compacting/.test(text)) return 'running';
  if (/nothing new|skipped/.test(text)) return 'skipped';
  if (/\bcompacted\b/.test(text)) return 'success';
  return 'failed';
}

export function manualCompactIdFromRow(msg) {
  const match = String(msg?.messageId || '').match(/^manual_compact:(.+):(?:status|command)$/);
  return match ? match[1] : '';
}

export function manualCompactRowIds(clientMessageId) {
  const id = String(clientMessageId || '').trim();
  return { command: `manual_compact:${id}:command`, status: `manual_compact:${id}:status` };
}

/** One entry for the surface's existing compaction-break renderer. */
export function manualCompactTraceEntry(msg) {
  const status = manualCompactRowStatus(msg);
  const traceStatus = status === 'running' ? 'compacting' : status === 'success' ? 'compacted' : status;
  const text = String(msg?.content || msg?.body?.text || '').trim() || MANUAL_COMPACT_LABELS[status];
  return {
    id: `manual-compact:${String(msg?.messageId || msg?.timestamp || '')}`,
    type: 'compaction',
    status: traceStatus,
    text,
    timestamp: Number(msg?.timestamp || 0) || undefined,
    extra: { action: 'context_compaction', status: traceStatus, manual: true },
  };
}

/** The latest status row decides whether this chat is compacting now. */
export function findRunningManualCompact(history) {
  const rows = Array.isArray(history) ? history : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!isManualCompactStatusRow(row)) continue;
    if (manualCompactRowStatus(row) !== 'running') return null;
    return { index, row, clientMessageId: manualCompactIdFromRow(row) };
  }
  return null;
}

/** Rows a client may echo back in a history replacement: terminal, server-shaped rows only. */
export function isManualCompactRowPersistable(msg) {
  if (!isManualCompactRow(msg)) return true;
  if (msg?._manualCompactLocal === true) return false;
  if (isManualCompactStatusRow(msg)) return TERMINAL.has(String(msg?.compactStatus || '').toLowerCase());
  return true;
}

/** Merge key so equal status text in two separate compactions never collapses. */
export function manualCompactMergeKey(msg) {
  if (!isManualCompactRow(msg)) return '';
  const id = String(msg?.messageId || '').trim();
  return id ? `manual_compact|${id}` : '';
}

export function newManualCompactClientMessageId(sessionId = '') {
  const random = (() => {
    try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  })();
  const sid = String(sessionId || '').replace(/[^\w.~-]/g, '').slice(-40);
  return `compact-${sid ? `${sid}-` : ''}${random}`.slice(0, 160);
}

function parseHttpError(error) {
  const status = Number(error?.status || error?.statusCode || 0)
    || Number(String(error?.message || '').match(/^API (\d{3})\b/)?.[1] || 0);
  const raw = String(error?.body?.error || error?.message || '').replace(/^API \d{3}:\s*/, '').trim();
  return { status, message: raw };
}

/**
 * Post the command. `request(path, opts)` is the surface's authed JSON helper;
 * it resolves to the JSON body or throws (`API <status>: <error>`).
 */
export async function requestManualCompact({ request, sessionId, clientMessageId, signal } = {}) {
  if (typeof request !== 'function') throw new Error('Manual compaction needs a request helper.');
  try {
    const data = await request(MANUAL_COMPACT_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ sessionId, message: MANUAL_COMPACT_COMMAND, clientMessageId }),
      timeoutMs: MANUAL_COMPACT_TIMEOUT_MS,
      signal,
    });
    const status = String(data?.status || '').toLowerCase();
    if (TERMINAL.has(status)) {
      return { outcome: status, message: String(data?.message || MANUAL_COMPACT_LABELS[status]) };
    }
    return { outcome: 'error', message: String(data?.error || MANUAL_COMPACT_ERROR_MESSAGE) };
  } catch (error) {
    const parsed = parseHttpError(error);
    if (parsed.status === 409 || parsed.status === 400) {
      return { outcome: 'refused', httpStatus: parsed.status, message: parsed.message || MANUAL_COMPACT_BUSY_MESSAGE };
    }
    return { outcome: 'error', httpStatus: parsed.status, message: parsed.message || MANUAL_COMPACT_ERROR_MESSAGE };
  }
}

function setRowText(row, text) {
  row.content = text;
  if (row.body && typeof row.body === 'object') row.body.text = text;
}

/**
 * Shared lifecycle. The adapter supplies surface details:
 *   request(path, opts)        authed JSON helper
 *   getThread(sessionId)       mutable transcript array for that chat
 *   makeRow(fields)            surface row shape (default: desktop shape)
 *   commit(sessionId)          persist locally + render
 *   toast(message, tone)
 *   restoreDraft(sessionId, text)   only used when the command is refused
 *   refresh(sessionId)         re-read the tagged transcript (optional)
 * The controller never sends, queues, steers or resumes anything.
 */
export function createManualCompactController(adapter = {}) {
  const active = new Map();
  const resumed = new Map();
  const makeRow = typeof adapter.makeRow === 'function' ? adapter.makeRow : (fields) => ({ ...fields });
  const commit = (sid) => { try { adapter.commit?.(sid); } catch {} };
  const toast = (message, tone = 'info') => { try { adapter.toast?.(message, tone); } catch {} };
  const threadFor = (sid) => {
    const thread = adapter.getThread?.(sid);
    return Array.isArray(thread) ? thread : [];
  };

  function isActive(sessionId) {
    const sid = String(sessionId || '').trim();
    return active.has(sid) || !!findRunningManualCompact(threadFor(sid));
  }

  /** Non-empty when a normal send/queue/steer must wait; the caller keeps the draft. */
  function sendBlockReason(sessionId) {
    return isActive(sessionId) ? MANUAL_COMPACT_ACTIVE_MESSAGE : '';
  }

  function placeRows(sid, clientMessageId) {
    const ids = manualCompactRowIds(clientMessageId);
    const thread = threadFor(sid);
    const at = Date.now();
    if (!thread.some((row) => row?.messageId === ids.command)) {
      thread.push(makeRow({ role: 'user', messageKind: MANUAL_COMPACT_COMMAND_KIND, messageId: ids.command,
        content: MANUAL_COMPACT_COMMAND, timestamp: at, _manualCompactLocal: true }));
    }
    if (!thread.some((row) => row?.messageId === ids.status)) {
      thread.push(makeRow({ role: 'assistant', messageKind: MANUAL_COMPACT_STATUS_KIND, messageId: ids.status,
        compactStatus: 'running', content: MANUAL_COMPACT_LABELS.running, timestamp: at + 1, _manualCompactLocal: true }));
    }
  }

  function removeLocalRows(sid, clientMessageId) {
    const ids = manualCompactRowIds(clientMessageId);
    const thread = threadFor(sid);
    for (let index = thread.length - 1; index >= 0; index -= 1) {
      const row = thread[index];
      if (row?._manualCompactLocal === true && (row.messageId === ids.command || row.messageId === ids.status)) thread.splice(index, 1);
    }
  }

  function settleRows(sid, clientMessageId, status, message) {
    const ids = manualCompactRowIds(clientMessageId);
    for (const row of threadFor(sid)) {
      if (row?.messageId === ids.status) {
        row.compactStatus = status;
        setRowText(row, message || MANUAL_COMPACT_LABELS[status]);
        delete row._manualCompactLocal;
      } else if (row?.messageId === ids.command) {
        delete row._manualCompactLocal;
      }
    }
  }

  function run(sessionId, clientMessageId, { optimistic = true } = {}) {
    const sid = String(sessionId || '').trim();
    const existing = active.get(sid);
    if (existing) return existing.promise;
    const id = String(clientMessageId || '').trim() || newManualCompactClientMessageId(sid);
    const promise = (async () => {
      if (optimistic) placeRows(sid, id);
      commit(sid);
      const request = () => requestManualCompact({ request: adapter.request, sessionId: sid, clientMessageId: id });
      let result = await request();
      if (result.outcome === 'error' && adapter.readStatus) {
        // A lost HTTP response is not a failed checkpoint. Only rejoin if a GET confirms this exact receipt exists.
        const saved = await Promise.resolve().then(() => adapter.readStatus(sid, manualCompactRowIds(id).status)).catch(() => null);
        if (saved?.compactStatus === 'running') result = await request();
        else if (TERMINAL.has(saved?.compactStatus)) result = { outcome: saved.compactStatus, message: saved.content };
        if (result.outcome === 'error') result.message = 'Could not confirm compaction status. Reopen this chat to check.';
      }
      if (TERMINAL.has(result.outcome)) {
        if (!optimistic && !threadFor(sid).some((row) => row?.messageId === manualCompactRowIds(id).status)) placeRows(sid, id);
        settleRows(sid, id, result.outcome, result.message);
        if (result.outcome === 'failed') toast(result.message, 'error');
      } else {
        removeLocalRows(sid, id);
        toast(result.message, result.outcome === 'refused' ? 'warn' : 'error');
        if (optimistic && result.outcome === 'refused') {
          try { adapter.restoreDraft?.(sid, MANUAL_COMPACT_COMMAND); } catch {}
        }
      }
      return { ...result, clientMessageId: id };
    })().finally(() => {
      if (active.get(sid)?.promise === promise) active.delete(sid);
      commit(sid);
      // Read the tagged transcript; the gateway copy is the durable truth.
      Promise.resolve().then(() => adapter.refresh?.(sid)).catch(() => {});
    });
    active.set(sid, { clientMessageId: id, promise });
    return promise;
  }

  /**
   * Called for every explicit composer send before queue/steer/model routing.
   * Returns { handled:false } for ordinary text. When handled, keepDraft says
   * whether the composer text must stay (refusals) or may clear (started).
   */
  function handleComposerSend(sessionId, message, options = {}) {
    const verdict = classifyManualCompactInput(message, options);
    if (verdict.kind === 'none') return { handled: false };
    if (verdict.kind !== 'compact') {
      toast(verdict.error, 'warn');
      return { handled: true, keepDraft: true, refused: verdict.kind };
    }
    const busyReason = String(options.busyReason || '').trim();
    if (busyReason || isActive(sessionId)) {
      toast(isActive(sessionId) ? MANUAL_COMPACT_ACTIVE_MESSAGE : (busyReason || MANUAL_COMPACT_BUSY_MESSAGE), 'warn');
      return { handled: true, keepDraft: true, refused: 'busy' };
    }
    const promise = run(sessionId, options.clientMessageId, { optimistic: true });
    return { handled: true, keepDraft: false, started: true, promise };
  }

  /** After a reload: join a still-running command by its id (the gateway joins the same operation). */
  function resumeFromTranscript(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid || active.has(sid)) return null;
    const running = findRunningManualCompact(threadFor(sid));
    if (!running?.clientMessageId) return null;
    // A failed join refreshes the transcript, which calls back here. Never spin.
    const last = resumed.get(sid);
    const now = Date.now();
    if (last?.id === running.clientMessageId && now - last.at < RESUME_RETRY_MS) return null;
    resumed.set(sid, { id: running.clientMessageId, at: now });
    return run(sid, running.clientMessageId, { optimistic: false });
  }

  return { isActive, sendBlockReason, handleComposerSend, resumeFromTranscript, run, _active: active };
}
