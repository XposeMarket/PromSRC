/**
 * telegram-streaming-message.ts
 *
 * Live token-streaming to Telegram via in-place message edits.
 *
 * Pattern (matches OpenClaw's extensions/telegram/src/draft-stream.ts):
 *   - The caller feeds the FULL accumulated reply text on every update, not
 *     deltas. The stream internally throttles and only commits to the
 *     Telegram API at most once per throttleMs.
 *   - The first commit calls sendMessage and captures the resulting
 *     message_id. Every subsequent commit calls editMessageText against
 *     that same id, so the user sees one bubble that grows in place — just
 *     like watching a person type into a Telegram message in real time.
 *   - When accumulated text crosses maxChars (Telegram's 4096 limit, with a
 *     safety margin), the stream rotates: the existing bubble is left at its
 *     last committed snapshot, and a fresh sendMessage starts a new bubble
 *     carrying the overflow. This is the only point at which a humanDelay-
 *     style pause makes sense — between message boundaries, not between
 *     edits to the same message.
 *   - end() does a final flush so the bubble shows the complete reply even
 *     if the last delta arrived inside the throttle window.
 *
 * This file deliberately does no markdown/HTML rendering — pass a renderText
 * function if the caller wants parse_mode=HTML. The default sends plain text.
 */

const TELEGRAM_HARD_MAX_CHARS = 4096;
const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_THROTTLE_MS = 1000;
const MIN_THROTTLE_MS = 100;

export type TelegramStreamRender = {
  text: string;
  parseMode?: 'HTML';
};

export interface TelegramStreamingMessageOptions {
  /** Telegram Bot API caller — same shape as TelegramChannel#apiCall. */
  apiCall: (method: string, body?: object) => Promise<any>;
  /** Telegram chat id. */
  chatId: number;
  /** Optional thread id for forum chats. */
  messageThreadId?: number;
  /** Optional reply target. */
  replyToMessageId?: number;
  /** Hard ceiling per message bubble. Defaults to 4000 (Telegram cap is 4096). */
  maxChars?: number;
  /** Minimum interval between API calls. Defaults to 1000ms. */
  throttleMs?: number;
  /**
   * Minimum chars before the FIRST sendMessage fires. Prevents a flash of
   * 5–10 chars. On final flush this guard is bypassed. Defaults to 80.
   */
  minInitialChars?: number;
  /**
   * Optional renderer that converts the partial plain-text reply into the
   * payload that will actually be sent. Use this to apply markdown -> HTML +
   * parse_mode. If omitted, text is sent as-is with no parse_mode.
   */
  renderText?: (text: string) => TelegramStreamRender;
  /** Optional logger for verbose diagnostics. */
  log?: (msg: string) => void;
  /** Optional warning logger. */
  warn?: (msg: string) => void;
  /**
   * Optional callback fired when the stream rotates onto a new message.
   * Receives the message id of the message that just finalized. Useful for
   * inserting a humanDelay-style pause between bubbles when the reply
   * overflows 4000 chars.
   */
  onMessageRotated?: (finalizedMessageId: number | undefined) => Promise<void> | void;
}

export interface TelegramStreamingMessage {
  /** Feed the FULL accumulated reply text. Cheap to call on every token. */
  update: (fullText: string) => void;
  /** Force-commit any pending text immediately and wait for it to land. */
  flush: () => Promise<void>;
  /** Final flush + stop. Call once when the model stream ends. */
  end: () => Promise<void>;
  /** Discard the buffer and stop without further commits (e.g. on abort). */
  abort: () => void;
  /** Number of distinct message bubbles created so far (1 = single bubble). */
  bubbleCount: () => number;
  /** True if any text has been committed to Telegram. */
  hasCommitted: () => boolean;
  /** Snapshot of the last text actually delivered (across all bubbles). */
  lastDeliveredText: () => string;
}

interface BubbleState {
  /** Telegram message_id once the first send for this bubble lands. */
  messageId: number | undefined;
  /** Text we last successfully committed (sent or edited) to Telegram. */
  lastSentText: string;
  /** Parse mode active for lastSentText, if any. */
  lastSentParseMode: 'HTML' | undefined;
  /** Char offset into the cumulative reply that THIS bubble represents from. */
  offset: number;
  /** Sealed: no more edits — the bubble overflowed and a new one took over. */
  sealed: boolean;
}

export function createTelegramStreamingMessage(
  options: TelegramStreamingMessageOptions,
): TelegramStreamingMessage {
  const maxChars = Math.min(
    Math.max(1, Math.floor(options.maxChars ?? DEFAULT_MAX_CHARS)),
    TELEGRAM_HARD_MAX_CHARS,
  );
  const throttleMs = Math.max(MIN_THROTTLE_MS, Math.floor(options.throttleMs ?? DEFAULT_THROTTLE_MS));
  const renderText = options.renderText;

  let stopped = false;
  let aborted = false;
  let accumulatedText = '';
  let pendingChanged = false; // true when accumulatedText differs from the last commit
  let lastDeliveredText = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastCommittedAt = 0;
  let inFlight: Promise<void> | undefined;
  let bubbles: BubbleState[] = [{
    messageId: undefined,
    lastSentText: '',
    lastSentParseMode: undefined,
    offset: 0,
    sealed: false,
  }];

  const currentBubble = (): BubbleState => bubbles[bubbles.length - 1];

  const render = (text: string): TelegramStreamRender => {
    if (renderText) {
      try {
        return renderText(text);
      } catch (err) {
        options.warn?.(`renderText failed, falling back to plain: ${String(err)}`);
      }
    }
    return { text };
  };

  /**
   * Commit the current accumulatedText to Telegram. Returns when the API call
   * resolves (or fails — failures are logged but never throw to the caller).
   *
   * Handles three cases:
   *   1. First commit for the current bubble → sendMessage, capture id
   *   2. Subsequent commit while still within maxChars → editMessageText
   *   3. Commit would push us past maxChars → seal current bubble (leave it
   *      at its last committed state), rotate to a new bubble, sendMessage
   *      the overflow text into that bubble. The caller's onMessageRotated
   *      hook fires between the seal and the new send.
   */
  const commit = async (): Promise<void> => {
    if (aborted) return;
    const bubble = currentBubble();
    const slice = accumulatedText.slice(bubble.offset);
    const rendered = render(slice);
    const text = rendered.text.trimEnd();
    if (!text) {
      pendingChanged = false;
      return;
    }

    // Hold off sending the first bubble until there's a tiny amount of text.
    // We keep this very low (default 1) so the bubble appears almost immediately
    // and the user sees a real-time stream rather than a delayed dump.
    // CRITICAL: clear pendingChanged so drain() exits cleanly — without this,
    // drain() spins forever and starves the Node event loop.
    const minInitialChars = options.minInitialChars ?? 1;
    if (bubble.messageId === undefined && !stopped && text.length < minInitialChars) {
      pendingChanged = false;
      lastCommittedAt = Date.now();
      return;
    }

    // Overflow → seal current bubble, rotate to a new one.
    if (text.length > maxChars && bubble.lastSentText) {
      bubble.sealed = true;
      const finalizedId = bubble.messageId;
      if (options.onMessageRotated) {
        try { await options.onMessageRotated(finalizedId); } catch (err) {
          options.warn?.(`onMessageRotated threw: ${String(err)}`);
        }
      }
      bubbles.push({
        messageId: undefined,
        lastSentText: '',
        lastSentParseMode: undefined,
        // The new bubble carries what already landed in the old one as the
        // starting offset, so its first commit doesn't re-include text the
        // user already saw.
        offset: bubble.offset + bubble.lastSentText.length,
        sealed: false,
      });
      // Recurse with the rotated bubble — its slice will be smaller now.
      return commit();
    }

    // Single-bubble overflow case (first commit of a bubble is already too long).
    // Hard-truncate so we don't get rejected. This is an edge case; typically
    // the stream catches overflow long before this point.
    const safeText = text.length > maxChars ? text.slice(0, maxChars) : text;

    // Nothing new to send (text == lastSentText).
    if (safeText === bubble.lastSentText && rendered.parseMode === bubble.lastSentParseMode) {
      pendingChanged = false;
      return;
    }

    try {
      if (bubble.messageId === undefined) {
        // First commit for this bubble → sendMessage.
        const body: Record<string, unknown> = {
          chat_id: options.chatId,
          text: safeText,
        };
        if (options.messageThreadId) body.message_thread_id = options.messageThreadId;
        if (options.replyToMessageId && bubbles.length === 1) {
          // Only attach reply on the very first bubble of the stream.
          body.reply_to_message_id = options.replyToMessageId;
          body.allow_sending_without_reply = true;
        }
        if (rendered.parseMode) body.parse_mode = rendered.parseMode;
        const result = await options.apiCall('sendMessage', body);
        const id = typeof result?.message_id === 'number' ? result.message_id : undefined;
        if (id !== undefined) bubble.messageId = id;
      } else {
        // Subsequent commit → editMessageText.
        const body: Record<string, unknown> = {
          chat_id: options.chatId,
          message_id: bubble.messageId,
          text: safeText,
        };
        if (rendered.parseMode) body.parse_mode = rendered.parseMode;
        await options.apiCall('editMessageText', body);
      }
      bubble.lastSentText = safeText;
      bubble.lastSentParseMode = rendered.parseMode;
      lastDeliveredText = accumulatedText.slice(0, bubble.offset) + safeText;
      pendingChanged = accumulatedText.slice(bubble.offset).trimEnd() !== safeText;
      lastCommittedAt = Date.now();
    } catch (err: any) {
      const msg = String(err?.message || err);
      // Treat "message is not modified" as a successful no-op (Telegram returns
      // an error when you edit with identical content; harmless).
      if (/message is not modified/i.test(msg)) {
        bubble.lastSentText = safeText;
        bubble.lastSentParseMode = rendered.parseMode;
        pendingChanged = false;
        lastCommittedAt = Date.now();
        return;
      }
      // Try a HTML→plain fallback if we tried HTML and it failed at parse time.
      if (rendered.parseMode === 'HTML' && /parse|entity|tag/i.test(msg)) {
        const plain = safeText
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trimEnd();
        if (plain && plain !== bubble.lastSentText) {
          try {
            if (bubble.messageId === undefined) {
              const result = await options.apiCall('sendMessage', {
                chat_id: options.chatId,
                text: plain,
                ...(options.messageThreadId ? { message_thread_id: options.messageThreadId } : {}),
              });
              const id = typeof result?.message_id === 'number' ? result.message_id : undefined;
              if (id !== undefined) bubble.messageId = id;
            } else {
              await options.apiCall('editMessageText', {
                chat_id: options.chatId,
                message_id: bubble.messageId,
                text: plain,
              });
            }
            bubble.lastSentText = plain;
            bubble.lastSentParseMode = undefined;
            lastDeliveredText = accumulatedText.slice(0, bubble.offset) + plain;
            pendingChanged = false;
            lastCommittedAt = Date.now();
            return;
          } catch (err2: any) {
            options.warn?.(`stream plain-fallback failed: ${err2?.message || err2}`);
          }
        }
      }
      options.warn?.(`telegram stream commit failed: ${msg}`);
      // Don't poison the stream — leave pendingChanged set so the next tick can
      // retry with whatever has arrived in the meantime.
    }
  };

  const drain = async (): Promise<void> => {
    while (!stopped && !aborted && pendingChanged) {
      const next = commit().finally(() => {
        if (inFlight === next) inFlight = undefined;
      });
      inFlight = next;
      await next;
    }
  };

  const schedule = () => {
    if (stopped || aborted || timer) return;
    const delay = Math.max(0, throttleMs - (Date.now() - lastCommittedAt));
    timer = setTimeout(() => {
      timer = undefined;
      void drain();
    }, delay);
    timer.unref?.();
  };

  const update = (fullText: string): void => {
    if (stopped || aborted) return;
    const next = String(fullText ?? '');
    if (next === accumulatedText) return;
    accumulatedText = next;
    pendingChanged = true;
    if (inFlight) {
      // A commit is already running; it will see the new accumulatedText on its
      // next loop iteration via drain(). Just make sure a timer is armed in
      // case drain finishes before our next update.
      schedule();
      return;
    }
    // Eager-fire if we're past the throttle window already.
    if (!timer && Date.now() - lastCommittedAt >= throttleMs) {
      void drain();
      return;
    }
    schedule();
  };

  const flush = async (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (inFlight) {
      try { await inFlight; } catch { /* swallow */ }
    }
    if (pendingChanged) await drain();
    if (inFlight) {
      try { await inFlight; } catch { /* swallow */ }
    }
  };

  const end = async (): Promise<void> => {
    if (aborted) {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = undefined; }
      return;
    }
    await flush();
    stopped = true;
    if (timer) { clearTimeout(timer); timer = undefined; }
  };

  const abort = (): void => {
    aborted = true;
    stopped = true;
    if (timer) { clearTimeout(timer); timer = undefined; }
    pendingChanged = false;
  };

  return {
    update,
    flush,
    end,
    abort,
    bubbleCount: () => bubbles.length,
    hasCommitted: () => bubbles.some(b => b.messageId !== undefined),
    lastDeliveredText: () => lastDeliveredText,
  };
}
