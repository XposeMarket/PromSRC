import crypto from 'crypto';

export interface SessionTurnLease {
  sessionId: string;
  leaseId: string;
  acquiredAt: number;
}

type TurnWaiter = {
  resolve: (lease: SessionTurnLease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export type TurnAdmissionDecision =
  | { kind: 'new' }
  | { kind: 'duplicate'; streamId: string }
  | { kind: 'busy'; streamId?: string }
  | { kind: 'idempotency_conflict'; streamId: string };

export function decideTurnAdmission(input: {
  active: boolean;
  activeStreamId?: string;
  clientRequestId?: string;
  fingerprint: string;
  previous?: { streamId: string; fingerprint: string } | null;
}): TurnAdmissionDecision {
  const requestId = String(input.clientRequestId || '').trim();
  if (requestId && input.previous) {
    if (input.previous.fingerprint !== input.fingerprint) {
      return { kind: 'idempotency_conflict', streamId: input.previous.streamId };
    }
    return { kind: 'duplicate', streamId: input.previous.streamId };
  }
  if (input.active) return { kind: 'busy', streamId: input.activeStreamId };
  return { kind: 'new' };
}

export class SessionTurnCoordinator {
  private readonly active = new Map<string, SessionTurnLease>();
  private readonly waiters = new Map<string, TurnWaiter[]>();

  isActive(sessionId: string): boolean {
    return this.active.has(this.normalizeSessionId(sessionId));
  }

  getActive(sessionId: string): SessionTurnLease | null {
    return this.active.get(this.normalizeSessionId(sessionId)) || null;
  }

  tryAcquire(sessionId: string): SessionTurnLease | null {
    const sid = this.normalizeSessionId(sessionId);
    if (this.active.has(sid)) return null;
    const lease = this.createLease(sid);
    this.active.set(sid, lease);
    return lease;
  }

  acquire(sessionId: string, signal?: AbortSignal): Promise<SessionTurnLease> {
    const sid = this.normalizeSessionId(sessionId);
    if (signal?.aborted) return Promise.reject(this.abortError());
    const immediate = this.tryAcquire(sid);
    if (immediate) return Promise.resolve(immediate);
    return new Promise<SessionTurnLease>((resolve, reject) => {
      const waiter: TurnWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const queue = this.waiters.get(sid) || [];
          const index = queue.indexOf(waiter);
          if (index >= 0) queue.splice(index, 1);
          if (!queue.length) this.waiters.delete(sid);
          reject(this.abortError());
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      const queue = this.waiters.get(sid) || [];
      queue.push(waiter);
      this.waiters.set(sid, queue);
    });
  }

  release(lease: SessionTurnLease): boolean {
    const sid = this.normalizeSessionId(lease?.sessionId);
    const current = this.active.get(sid);
    if (!current || current.leaseId !== lease?.leaseId) return false;
    this.active.delete(sid);
    this.promoteNext(sid);
    return true;
  }

  private promoteNext(sessionId: string): void {
    const queue = this.waiters.get(sessionId) || [];
    while (queue.length) {
      const waiter = queue.shift()!;
      if (waiter.signal?.aborted) continue;
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
      const lease = this.createLease(sessionId);
      this.active.set(sessionId, lease);
      if (!queue.length) this.waiters.delete(sessionId);
      else this.waiters.set(sessionId, queue);
      waiter.resolve(lease);
      return;
    }
    this.waiters.delete(sessionId);
  }

  private createLease(sessionId: string): SessionTurnLease {
    return { sessionId, leaseId: crypto.randomUUID(), acquiredAt: Date.now() };
  }

  private normalizeSessionId(sessionId: string): string {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('Session id is required for turn coordination.');
    return sid;
  }

  private abortError(): Error {
    const error = new Error('Turn coordination was aborted.');
    error.name = 'AbortError';
    return error;
  }
}

export const mainChatTurnCoordinator = new SessionTurnCoordinator();
