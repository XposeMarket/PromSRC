import crypto from 'crypto';

const CURSOR_VERSION = 1;
const CURSOR_NAMESPACE = 'prometheus-chat-history-cursor-v1';

type CursorPayload = {
  v: number;
  session: string;
  anchor: string;
  indexHint: number;
};

export type ChatHistoryPageInfo = {
  olderCursor: string | null;
  hasOlder: boolean;
  totalCount: number;
  startIndex: number;
  endIndex: number;
  startKey: string | null;
  endKey: string | null;
};

export class ChatHistoryCursorError extends Error {
  readonly code = 'INVALID_CHAT_HISTORY_CURSOR';

  constructor(message = 'Invalid chat history cursor.') {
    super(message);
    this.name = 'ChatHistoryCursorError';
  }
}

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sessionDigest(sessionId: string): string {
  return digest(`session\0${String(sessionId || '')}`).slice(0, 20);
}

function cursorChecksum(body: string): string {
  return digest(`${CURSOR_NAMESPACE}\0${body}`).slice(0, 16);
}

export function historyMessageCursorKey(message: any): string {
  const explicit = String(
    message?.messageId
    || message?.turnId
    || message?.clientRequestId
    || message?._clientRequestId
    || message?.id
    || '',
  ).trim();
  if (explicit) return `id:${digest(explicit).slice(0, 24)}`;
  const canonical = JSON.stringify({
    role: String(message?.role || ''),
    timestamp: Number(message?.timestamp || message?.createdAt || 0) || 0,
    source: String(message?.source || message?.channel || message?.messageKind || ''),
    content: String(message?.content ?? message?.body?.text ?? ''),
  });
  return `anon:${digest(canonical).slice(0, 24)}`;
}

export function encodeChatHistoryCursor(sessionId: string, anchor: string, indexHint: number): string {
  const payload: CursorPayload = {
    v: CURSOR_VERSION,
    session: sessionDigest(sessionId),
    anchor: String(anchor || ''),
    indexHint: Math.max(0, Math.floor(Number(indexHint) || 0)),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${cursorChecksum(body)}`;
}

export function decodeChatHistoryCursor(cursor: string, sessionId: string): CursorPayload {
  const value = String(cursor || '').trim();
  if (!value || value.length > 2048) throw new ChatHistoryCursorError();
  const [body, checksum, ...extra] = value.split('.');
  if (!body || !checksum || extra.length || checksum !== cursorChecksum(body)) throw new ChatHistoryCursorError();
  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload;
  } catch {
    throw new ChatHistoryCursorError();
  }
  if (payload?.v !== CURSOR_VERSION
    || payload?.session !== sessionDigest(sessionId)
    || !String(payload?.anchor || '').trim()
    || !Number.isFinite(Number(payload?.indexHint))) {
    throw new ChatHistoryCursorError();
  }
  return payload;
}

function resolveAnchorIndex(history: any[], payload: CursorPayload): number {
  const matches: number[] = [];
  history.forEach((message, index) => {
    if (historyMessageCursorKey(message) === payload.anchor) matches.push(index);
  });
  if (!matches.length) return Math.min(history.length, Math.max(0, payload.indexHint));
  return matches.reduce((best, candidate) => (
    Math.abs(candidate - payload.indexHint) < Math.abs(best - payload.indexHint) ? candidate : best
  ), matches[0]);
}

export function paginateChatHistory(
  sessionId: string,
  history: any[],
  options: { limit?: number; before?: string } = {},
): { items: any[]; pageInfo: ChatHistoryPageInfo } {
  const source = Array.isArray(history) ? history : [];
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit) || 50)));
  const before = String(options.before || '').trim();
  const endIndex = before
    ? resolveAnchorIndex(source, decodeChatHistoryCursor(before, sessionId))
    : source.length;
  const startIndex = Math.max(0, endIndex - limit);
  const items = source.slice(startIndex, endIndex);
  const startKey = items.length ? historyMessageCursorKey(items[0]) : null;
  const endKey = items.length ? historyMessageCursorKey(items[items.length - 1]) : null;
  return {
    items,
    pageInfo: {
      olderCursor: startIndex > 0 && startKey
        ? encodeChatHistoryCursor(sessionId, startKey, startIndex)
        : null,
      hasOlder: startIndex > 0,
      totalCount: source.length,
      startIndex,
      endIndex,
      startKey,
      endKey,
    },
  };
}
