/**
 * session-wake.ts
 *
 * Async wake-up for main-chat sessions. Long-running work (video jobs, peer
 * thread turns) can end the originating agent turn and later "wake" that
 * session with a synthetic user-like message. Reuses the exact injection path
 * the MainChatTimerRunner uses (runInteractiveTurn + broadcastWS SSE relay),
 * wired from server-v2.ts with the same deps. Wakes are serialized per session
 * and deferred while that session already has a live main-chat turn.
 */
import type { MainChatTimerRunnerDeps } from './timers/timer-runner';

export type SessionWakeRunTurn = MainChatTimerRunnerDeps['runInteractiveTurn'];

export interface SessionWakeDeps {
  runInteractiveTurn: SessionWakeRunTurn;
  broadcast?: (payload: any) => void;
  /** Returns true when the session currently has a live main-chat turn. */
  isSessionBusy?: (sessionId: string) => boolean;
  /** Optional push notifier; defaults to web-push sendWebPushToAll when available. */
  notify?: (title: string, body: string, sessionId: string) => Promise<void> | void;
  busyPollMs?: number;
}

export interface SessionWakeMeta { source: string; key?: string }

export interface SessionWakeResult { queued: boolean; deduped?: boolean; reason?: string }

let deps: SessionWakeDeps | null = null;
const DEDUPE_TTL_MS = 10 * 60 * 1000;
const seenKeys = new Map<string, number>();
const queues = new Map<string, Array<{ message: string; meta: SessionWakeMeta }>>();
const draining = new Set<string>();

export function initSessionWake(input: SessionWakeDeps): void {
  deps = input;
  // Flush anything queued before init.
  for (const sessionId of queues.keys()) void drain(sessionId);
}

/** Test/reset helper. */
export function resetSessionWakeForTests(): void {
  deps = null; seenKeys.clear(); queues.clear(); draining.clear(); threadCallbacks.clear();
}

function pruneKeys(now: number): void {
  for (const [k, at] of seenKeys) if (now - at > DEDUPE_TTL_MS) seenKeys.delete(k);
}

export function wakeSession(sessionId: string, message: string, meta?: SessionWakeMeta): SessionWakeResult {
  const sid = String(sessionId || '').trim();
  const text = String(message || '').trim();
  if (!sid || !text) return { queued: false, reason: 'sessionId and message are required' };
  const m: SessionWakeMeta = { source: meta?.source || 'wake', key: meta?.key };
  const now = Date.now();
  pruneKeys(now);
  if (m.key) {
    const dk = `${sid}::${m.key}`;
    if (seenKeys.has(dk)) return { queued: false, deduped: true };
    seenKeys.set(dk, now);
  }
  const q = queues.get(sid) || [];
  q.push({ message: text, meta: m });
  queues.set(sid, q);
  if (deps) void drain(sid);
  return { queued: true, ...(deps ? {} : { reason: 'session wake not initialized yet; will run after init' }) };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => { const t = setTimeout(r, ms); (t as any).unref?.(); });
}

async function drain(sessionId: string): Promise<void> {
  if (draining.has(sessionId) || !deps) return;
  draining.add(sessionId);
  try {
    while (deps && (queues.get(sessionId)?.length || 0) > 0) {
      const d = deps;
      // Wait (bounded) while the user/agent is mid-turn in this session.
      const deadline = Date.now() + 30 * 60 * 1000;
      while (d.isSessionBusy?.(sessionId) && Date.now() < deadline) await sleep(d.busyPollMs ?? 3000);
      const item = queues.get(sessionId)!.shift()!;
      await runWake(d, sessionId, item.message, item.meta);
    }
  } finally {
    draining.delete(sessionId);
    if (!(queues.get(sessionId)?.length)) queues.delete(sessionId);
  }
}

async function defaultNotify(title: string, body: string, sessionId: string): Promise<void> {
  try {
    const mod: any = await import('./notifications/web-push');
    if (typeof mod?.sendWebPushToAll === 'function') {
      await mod.sendWebPushToAll({ title, body, tag: `wake_${sessionId}`, data: { sessionId } });
    }
  } catch { /* no push available: skip silently */ }
}

async function runWake(d: SessionWakeDeps, sessionId: string, message: string, meta: SessionWakeMeta): Promise<void> {
  const firstLine = message.split(/\r?\n/)[0].slice(0, 180);
  try { await (d.notify || defaultNotify)('Prometheus', firstLine, sessionId); } catch { /* ignore */ }
  d.broadcast?.({ type: 'session_wake', sessionId, source: meta.source, key: meta.key, preview: firstLine });
  const controller = new AbortController();
  const sendSSE = (event: string, data: any) => {
    d.broadcast?.({
      type: 'timer_sse', // same client relay the timer runner uses
      timerId: `wake_${meta.source}`,
      sessionId,
      eventType: event,
      ...(data && typeof data === 'object' ? data : { message: String(data ?? '') }),
    });
  };
  try {
    await d.runInteractiveTurn(
      message,
      sessionId,
      sendSSE,
      undefined,
      { aborted: false, signal: controller.signal },
      `[Session wake: ${meta.source}] Background work started earlier in this chat has settled. Treat this as a user turn in this same session and continue the plan.`,
    );
  } catch (err: any) {
    console.warn(`[SessionWake] wake failed for ${sessionId}:`, err?.message || err);
  }
}

// ─── Peer-thread reply callbacks ──────────────────────────────────────────

const threadCallbacks = new Map<string, Set<string>>(); // target -> origins

export function registerThreadCallback(originSessionId: string, targetSessionId: string): void {
  const o = String(originSessionId || '').trim();
  const t = String(targetSessionId || '').trim();
  if (!o || !t || o === t) return;
  const set = threadCallbacks.get(t) || new Set<string>();
  set.add(o);
  threadCallbacks.set(t, set);
}

export function hasThreadCallback(targetSessionId: string): boolean {
  return (threadCallbacks.get(targetSessionId)?.size || 0) > 0;
}

/** Call when the target session's turn settles. Wakes every registered origin once. */
export function fireThreadCallbacks(targetSessionId: string, threadTitle: string, finalReply: string): number {
  const origins = threadCallbacks.get(targetSessionId);
  if (!origins || origins.size === 0) return 0;
  threadCallbacks.delete(targetSessionId);
  const reply = String(finalReply || '').trim();
  const clipped = reply.length > 600 ? `${reply.slice(0, 600)}…` : (reply || '(no text reply)');
  let n = 0;
  for (const origin of origins) {
    const r = wakeSession(origin, `[thread reply] ${threadTitle || 'Thread'} finished: ${clipped}`, {
      source: 'thread_reply',
      key: `thread:${targetSessionId}:${Date.now()}`,
    });
    if (r.queued) n++;
  }
  return n;
}
