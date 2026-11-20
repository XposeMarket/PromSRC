import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type MobileChatQueueRequest = {
  id: string;
  sessionId: string;
  deviceId: string;
  body: { message: string } & Record<string, unknown>;
};
type State = 'pending' | 'claimed' | 'uncertain' | 'accepted' | 'cancelled';
type Receipt = Omit<MobileChatQueueRequest, 'body'> & {
  fingerprint: string;
  state: State;
  body?: MobileChatQueueRequest['body'];
};
type QueueData = { version: 1; receipts: Receipt[]; pauses: Record<string, string> };
type EnqueueResult = 'queued' | 'duplicate' | 'conflict' | 'full' | 'invalid';
export const isMobileQueueRequestId = (id: unknown): boolean => typeof id === 'string' && /^mq_[A-Za-z0-9_-]{8,100}$/.test(id);
const MAX_PER_SESSION = 8;
const MAX_PENDING = 128;
const MAX_RECEIPTS = 20_000;
const MAX_PAYLOAD_BYTES = 48 * 1024;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const active = (receipt: Receipt) => receipt.state !== 'accepted' && receipt.state !== 'cancelled';
const receiptKey = (id: string) => `chat:${id}`;

/** Single writer: one gateway process, one instance. Fail closed on unreadable data. */
export function createMobileMainChatQueue(file: string) {
  let data: QueueData;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as QueueData;
    if (raw.version !== 1 || !Array.isArray(raw.receipts) || !raw.pauses || Array.isArray(raw.pauses)) {
      throw new Error('Invalid mobile chat queue file');
    }
    data = raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    data = { version: 1, receipts: [], pauses: {} };
  }

  function update<T>(mutate: (next: QueueData) => T): T {
    const next = structuredClone(data);
    const result = mutate(next);
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(fd, JSON.stringify(next));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, file);
      data = next;
      return result;
    } finally {
      try { rmSync(temporary, { force: true }); } catch { /* preserve the original error */ }
    }
  }

  const forSession = (source: QueueData, sid: string) => source.receipts.filter((item) => item.sessionId === sid);
  const find = (source: QueueData, sid: string, id: string) => source.receipts.find((item) => item.sessionId === sid && item.id === id);
  function terminal(item: Receipt, state: 'accepted' | 'cancelled') {
    item.state = state;
    delete item.body;
  }

  return {
    enqueue(request: MobileChatQueueRequest): EnqueueResult {
      if (![request.id, request.sessionId, request.deviceId].every((id) => KEY.test(id)) || !request.body.message?.trim()) return 'invalid';
      const payload = JSON.stringify(request.body);
      if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) return 'invalid';
      const fingerprint = createHash('sha256').update(payload).digest('hex');
      const previous = find(data, request.sessionId, request.id);
      if (previous) return previous.fingerprint === fingerprint && previous.deviceId === request.deviceId ? 'duplicate' : 'conflict';
      if (forSession(data, request.sessionId).filter(active).length >= MAX_PER_SESSION
        || data.receipts.filter(active).length >= MAX_PENDING || data.receipts.length >= MAX_RECEIPTS) return 'full';
      return update((next) => {
        next.receipts.push({ ...request, body: JSON.parse(payload) as MobileChatQueueRequest['body'], fingerprint, state: 'pending' });
        return 'queued';
      });
    },
    list(sessionId: string) {
      return { paused: data.pauses[receiptKey(sessionId)] ?? null, items: structuredClone(forSession(data, sessionId).filter(active)) };
    },
    hasActive(sessionId: string): boolean { return data.receipts.some(item => item.sessionId === sessionId && active(item)); },
    pendingSessions(): string[] {
      return [...new Set(data.receipts.filter(active).map((item) => item.sessionId))];
    },
    claim(sessionId: string, steerId?: string): MobileChatQueueRequest | null {
      if (data.pauses[receiptKey(sessionId)]) return null;
      const head = steerId ? find(data, sessionId, steerId) : forSession(data, sessionId).find(active);
      if (!head || head.state !== 'pending' || !head.body) return null;
      return update((next) => {
        find(next, sessionId, head.id)!.state = 'claimed';
        return structuredClone({ id: head.id, sessionId, deviceId: head.deviceId, body: head.body! });
      });
    },
    hasReceipt(sessionId: string, id: string, deviceId: string): boolean { return find(data, sessionId, id)?.deviceId === deviceId; },
    edit(sessionId: string, id: string, message: string): boolean {
      const item = find(data, sessionId, id);
      const trimmed = message.trim();
      if (item?.state !== 'pending' || !item.body || !trimmed
        || Buffer.byteLength(JSON.stringify({ ...item.body, message: trimmed })) > MAX_PAYLOAD_BYTES) return false;
      return update((next) => { find(next, sessionId, id)!.body!.message = trimmed; return true; });
    },
    cancel(sessionId: string, id: string): boolean {
      const item = find(data, sessionId, id);
      if (!item || !['pending', 'uncertain'].includes(item.state)) return false;
      return update((next) => {
        terminal(find(next, sessionId, id)!, 'cancelled');
        if (!forSession(next, sessionId).some(active)) delete next.pauses[receiptKey(sessionId)];
        return true;
      });
    },
    pause(sessionId: string, reason: string): void {
      if (forSession(data, sessionId).some(active) && data.pauses[receiptKey(sessionId)] !== reason) {
        update((next) => { next.pauses[receiptKey(sessionId)] = reason; });
      }
    },
    resume(sessionId: string): boolean {
      if (!data.pauses[receiptKey(sessionId)] || forSession(data, sessionId).some((item) => item.state === 'uncertain')) return false;
      return update((next) => { delete next.pauses[receiptKey(sessionId)]; return true; });
    },
    finish(sessionId: string, id: string, outcome: 'accepted' | 'not_started' | 'uncertain' | 'return_to_queue', reason?: string): void {
      if (find(data, sessionId, id)?.state !== 'claimed') return;
      update((next) => {
        const item = find(next, sessionId, id)!;
        if (outcome === 'accepted') terminal(item, 'accepted');
        else {
          item.state = outcome === 'uncertain' ? 'uncertain' : 'pending';
          if (outcome !== 'return_to_queue') next.pauses[receiptKey(sessionId)] = outcome === 'uncertain' ? 'delivery_uncertain' : (reason || 'not_started');
        }
      });
    },
    recoverClaims(hasDurableUserMessage: (sessionId: string, id: string) => boolean): void {
      if (!data.receipts.some((item) => item.state === 'claimed')) return;
      update((next) => {
        for (const item of next.receipts) {
          if (item.state !== 'claimed') continue;
          if (hasDurableUserMessage(item.sessionId, item.id)) terminal(item, 'accepted');
          else {
            item.state = 'uncertain';
            next.pauses[receiptKey(item.sessionId)] = 'delivery_uncertain';
          }
        }
      });
    },
  };
}
