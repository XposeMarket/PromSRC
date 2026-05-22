/**
 * message-coalescer.ts
 *
 * Per-key trailing debounce buffer for inbound messages. Lets the user
 * fire-and-forget multiple messages in rapid succession and have Prometheus
 * receive them as a single combined turn instead of triggering N independent
 * model runs.
 *
 * Behavior:
 *   1. User sends msg A → buffer for key created with [A], countdown starts
 *   2. User sends msg B within debounceMs → buffer becomes [A, B], countdown
 *      RESETS (trailing debounce)
 *   3. User stops typing → countdown expires → onFlush([A, B, ...]) fires once
 *
 * The key is per-conversation (e.g. `tg:${userId}:${chatId}`), so different
 * users / different chats don't merge into each other's buffers.
 *
 * Inspired by OpenClaw's src/auto-reply/inbound-debounce.ts.
 */

const DEFAULT_DEBOUNCE_MS = 1500;
const DEFAULT_MAX_TRACKED_KEYS = 2048;

interface CoalescerBuffer {
  messages: string[];
  timer: ReturnType<typeof setTimeout> | null;
  firstEnqueuedAt: number;
}

export interface MessageCoalescerOptions {
  /** Trailing debounce window in milliseconds. Defaults to 1500. */
  debounceMs?: number;
  /** Maximum number of active buffer keys. When exceeded, new keys flush immediately. */
  maxTrackedKeys?: number;
  /**
   * Called once after the debounce window expires with all messages buffered
   * for that key. Receives the key and the in-order list of messages.
   */
  onFlush: (key: string, messages: string[]) => Promise<void> | void;
  /** Optional error handler. */
  onError?: (err: unknown, key: string, messages: string[]) => void;
}

export interface MessageCoalescer {
  /** Add a message to the buffer for `key`. Re-arms the debounce timer. */
  enqueue: (key: string, message: string) => void;
  /** Cancel any pending flush for `key` without firing onFlush. Returns true if a buffer was dropped. */
  cancel: (key: string) => boolean;
  /** Immediately fire onFlush for `key` (if buffered) without waiting for the timer. */
  flushNow: (key: string) => Promise<void>;
  /** Inspect whether a buffer is currently pending for `key`. */
  hasPending: (key: string) => boolean;
  /** Returns the count of buffered messages waiting on a key (0 if none). */
  pendingCount: (key: string) => number;
  /** Diagnostics: total tracked keys. */
  size: () => number;
}

export function createMessageCoalescer(options: MessageCoalescerOptions): MessageCoalescer {
  const debounceMs = Math.max(0, Math.floor(options.debounceMs ?? DEFAULT_DEBOUNCE_MS));
  const maxKeys = Math.max(1, Math.floor(options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS));
  const buffers = new Map<string, CoalescerBuffer>();

  const fireFlush = async (key: string, messages: string[]) => {
    try {
      await options.onFlush(key, messages);
    } catch (err) {
      try {
        options.onError?.(err, key, messages);
      } catch {
        /* swallow so the coalescer keeps running */
      }
    }
  };

  const flushBuffer = async (key: string, buf: CoalescerBuffer) => {
    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    // Detach buffer before firing so any messages enqueued during onFlush start
    // a fresh debounce window rather than joining a draining buffer.
    if (buffers.get(key) === buf) buffers.delete(key);
    const messages = buf.messages.splice(0);
    if (messages.length === 0) return;
    await fireFlush(key, messages);
  };

  const scheduleFlush = (key: string, buf: CoalescerBuffer) => {
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = setTimeout(() => {
      void flushBuffer(key, buf);
    }, debounceMs);
    // Don't keep the Node event loop alive just for pending debounce timers.
    buf.timer.unref?.();
  };

  const enqueue = (key: string, message: string): void => {
    if (typeof key !== 'string' || !key) return;
    if (debounceMs <= 0) {
      // Debounce disabled — fire immediately
      void fireFlush(key, [message]);
      return;
    }
    const existing = buffers.get(key);
    if (existing) {
      existing.messages.push(message);
      scheduleFlush(key, existing); // resets countdown
      return;
    }
    if (buffers.size >= maxKeys) {
      // Saturated: don't grow the map further. Fire immediately so the
      // message isn't lost, but skip buffering.
      void fireFlush(key, [message]);
      return;
    }
    const buf: CoalescerBuffer = {
      messages: [message],
      timer: null,
      firstEnqueuedAt: Date.now(),
    };
    buffers.set(key, buf);
    scheduleFlush(key, buf);
  };

  const cancel = (key: string): boolean => {
    const buf = buffers.get(key);
    if (!buf) return false;
    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    buf.messages.length = 0;
    buffers.delete(key);
    return true;
  };

  const flushNow = async (key: string): Promise<void> => {
    const buf = buffers.get(key);
    if (buf) await flushBuffer(key, buf);
  };

  const hasPending = (key: string): boolean => buffers.has(key);

  const pendingCount = (key: string): number => {
    const buf = buffers.get(key);
    return buf ? buf.messages.length : 0;
  };

  const size = (): number => buffers.size;

  return { enqueue, cancel, flushNow, hasPending, pendingCount, size };
}
