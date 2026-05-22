/**
 * block-chunker.ts
 *
 * Live-stream chunker for outbound replies. Accumulates token deltas as the
 * model generates and fires natural-feeling "block" messages instead of one
 * monolithic reply. The model writes one continuous stream; this turns it into
 * paragraph-sized bubbles that arrive separately.
 *
 * Flush conditions (whichever fires first):
 *   1. The buffer hits maxChars (hard ceiling) — flush immediately.
 *   2. The buffer is >= minChars AND contains a paragraph break ("\n\n") —
 *      flush everything up to (and including) the last paragraph break.
 *   3. No new tokens for idleMs — the model has paused, send what's buffered.
 *
 * At end of stream, any remaining text is flushed unconditionally via end().
 *
 * The model has zero awareness of this. It produces one continuous stream;
 * this watches the stream and decides where natural break points are.
 *
 * Inspired by OpenClaw's src/auto-reply/reply/block-reply-coalescer.ts.
 */

const DEFAULT_MIN_CHARS = 800;
const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_IDLE_MS = 1000;

export interface BlockChunkerOptions {
  /** Minimum buffered chars before a paragraph-break flush is allowed. Default: 800. */
  minChars?: number;
  /** Hard ceiling — force-flush when the buffer reaches this. Default: 1200. */
  maxChars?: number;
  /** Idle window — if no token arrives within this many ms, flush. Default: 1000. */
  idleMs?: number;
  /**
   * Fired for every completed block. Sequential (the chunker awaits each call
   * before processing the next flush) so receivers can apply humanDelay etc.
   */
  onBlock: (text: string, meta: { index: number; reason: BlockFlushReason }) => Promise<void> | void;
  /** Optional error handler. */
  onError?: (err: unknown) => void;
}

export type BlockFlushReason = 'paragraph' | 'maxChars' | 'idle' | 'end';

export interface BlockChunker {
  /** Feed a token delta. Safe to call rapidly from a streaming callback. */
  push: (token: string) => void;
  /** Final flush: emit any remaining buffered text. Call once after the LLM stream completes. */
  end: () => Promise<void>;
  /** Abort: discard the buffer and stop processing. Idempotent. */
  abort: () => void;
  /** True if any text is currently buffered. */
  hasBuffered: () => boolean;
  /** Number of blocks emitted so far. */
  blockCount: () => number;
  /** Snapshot the buffered (un-flushed) text without modifying state. */
  peek: () => string;
}

export function createBlockChunker(options: BlockChunkerOptions): BlockChunker {
  const minChars = Math.max(1, Math.floor(options.minChars ?? DEFAULT_MIN_CHARS));
  const maxChars = Math.max(minChars, Math.floor(options.maxChars ?? DEFAULT_MAX_CHARS));
  const idleMs = Math.max(0, Math.floor(options.idleMs ?? DEFAULT_IDLE_MS));

  let buffer = '';
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let aborted = false;
  let emittedCount = 0;
  // Sequential flush chain — ensures onBlock() callbacks run one at a time so
  // any per-block delay (e.g. humanDelay) is honored in order.
  let flushChain: Promise<void> = Promise.resolve();

  const clearIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const armIdle = () => {
    if (idleMs <= 0) return;
    clearIdle();
    idleTimer = setTimeout(() => {
      // Idle expired — force a flush of whatever's buffered.
      void flush('idle', /* force */ true);
    }, idleMs);
    idleTimer.unref?.();
  };

  const dispatchBlock = (text: string, reason: BlockFlushReason) => {
    const index = emittedCount++;
    flushChain = flushChain.then(async () => {
      if (aborted) return;
      try {
        await options.onBlock(text, { index, reason });
      } catch (err) {
        try { options.onError?.(err); } catch { /* ignore */ }
      }
    });
  };

  /**
   * Try to emit one or more complete blocks from the buffer based on the
   * current state. With `force`, emits the entire buffer even if it's below
   * minChars (used for idle expiry and end-of-stream).
   */
  const flush = async (reason: BlockFlushReason, force: boolean): Promise<void> => {
    clearIdle();
    if (aborted || !buffer) return;

    // Hard ceiling: emit a single maxChars-sized block.
    if (buffer.length >= maxChars) {
      // Try to break at a sensible point near the limit: paragraph > newline > space.
      const window = buffer.slice(0, maxChars);
      let cutAt = window.lastIndexOf('\n\n');
      if (cutAt < minChars) cutAt = window.lastIndexOf('\n');
      if (cutAt < minChars) cutAt = window.lastIndexOf(' ');
      if (cutAt < minChars) cutAt = maxChars; // give up on natural breaks
      const chunk = buffer.slice(0, cutAt).trimEnd();
      buffer = buffer.slice(cutAt).replace(/^\s+/, '');
      if (chunk) dispatchBlock(chunk, 'maxChars');
      // If we still have a lot buffered, recurse to flush more.
      if (buffer.length >= maxChars) return flush('maxChars', false);
      // Arm idle for the remainder unless force.
      if (!force) armIdle();
      else if (buffer) {
        const remaining = buffer.trimEnd();
        buffer = '';
        if (remaining) dispatchBlock(remaining, reason);
      }
      return;
    }

    // Paragraph-break flush after minChars.
    if (buffer.length >= minChars) {
      const lastBreak = buffer.lastIndexOf('\n\n');
      if (lastBreak > 0) {
        const chunk = buffer.slice(0, lastBreak).trimEnd();
        buffer = buffer.slice(lastBreak + 2).replace(/^\s+/, '');
        if (chunk) dispatchBlock(chunk, 'paragraph');
        if (!force) armIdle();
        else if (buffer) {
          const remaining = buffer.trimEnd();
          buffer = '';
          if (remaining) dispatchBlock(remaining, reason);
        }
        return;
      }
    }

    // Forced flush — emit whatever's buffered regardless of size.
    if (force) {
      const remaining = buffer.trimEnd();
      buffer = '';
      if (remaining) dispatchBlock(remaining, reason);
      return;
    }

    // Otherwise, wait for more tokens.
    armIdle();
  };

  const push = (token: string): void => {
    if (aborted || !token) return;
    buffer += token;
    // Try to flush opportunistically without forcing.
    if (buffer.length >= maxChars) {
      void flush('maxChars', false);
      return;
    }
    if (buffer.length >= minChars && buffer.includes('\n\n')) {
      void flush('paragraph', false);
      return;
    }
    armIdle();
  };

  const end = async (): Promise<void> => {
    if (aborted) {
      buffer = '';
      clearIdle();
      await flushChain;
      return;
    }
    clearIdle();
    if (buffer) {
      await flush('end', true);
    }
    await flushChain;
  };

  const abort = (): void => {
    aborted = true;
    clearIdle();
    buffer = '';
  };

  return {
    push,
    end,
    abort,
    hasBuffered: () => buffer.length > 0,
    blockCount: () => emittedCount,
    peek: () => buffer,
  };
}
