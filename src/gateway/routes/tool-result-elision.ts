// ── Stale tool-result elision ───────────────────────────────────────────────
// A tool result is re-sent to the provider on every subsequent round of the
// same turn. A 15-call turn therefore re-transmits round 1's full output ~15
// times, which makes input-token cost grow quadratically with tool count and
// slows time-to-first-token on every round.
//
// Once a result has been consumed by at least one later reasoning round, the
// model has already extracted what it needed. Replace the body of those older
// tool messages with a compact placeholder while keeping the most recent
// results verbatim.
//
// Invariants:
//  - Tool messages are never dropped or reordered. Providers require every
//    tool_call_id to stay paired with its assistant tool_call, so only the
//    message *content* is shortened.
//  - Errors stay verbatim regardless of age: they drive retry decisions.
//  - Short results stay verbatim; eliding them costs more than it saves.
//  - Multimodal image parts are untouched so vision grounding still works.

export const TOOL_RESULT_ELISION_KEEP_RECENT = 3;
export const TOOL_RESULT_ELISION_MIN_CHARS = 1200;
export const TOOL_RESULT_ELISION_PREVIEW_CHARS = 220;
export const TOOL_RESULT_ELISION_MARKER = '[TOOL_RESULT_ELIDED]';

// Results whose content the model legitimately needs verbatim for the whole
// turn, even once older rounds have passed.
export const TOOL_RESULT_ELISION_EXEMPT_TOOLS = new Set([
  'skill_read',
  'skill_resource_read',
  'memory_read_record',
  'tool_result_read',
]);

export function toolResultTextLooksLikeError(text: string): boolean {
  const head = String(text || '').slice(0, 400).toLowerCase();
  return head.includes('[error]')
    || head.includes('error:')
    || head.includes('exception')
    || head.includes('traceback')
    || head.includes('blocked:')
    || /\bexit\s*(code\s*)?[1-9]/.test(head);
}

export function buildElidedToolResultText(text: string, toolName: string): string {
  const preview = text
    .slice(0, TOOL_RESULT_ELISION_PREVIEW_CHARS)
    .replace(/\s+/g, ' ')
    .trim();
  return [
    `${TOOL_RESULT_ELISION_MARKER} tool=${toolName || 'tool'} original_chars=${text.length}`,
    `preview: ${preview}`,
    'This older result was already consumed in an earlier round of this turn and has been',
    'shortened to keep the context small. The full output remains in tool logs/raw storage;',
    're-run the tool or use a targeted read if the exact payload is needed again.',
  ].join('\n');
}

export function elideToolMessageContent(
  content: any,
  toolName: string,
): { content: any; savedChars: number } {
  if (typeof content === 'string') {
    if (content.length < TOOL_RESULT_ELISION_MIN_CHARS) return { content, savedChars: 0 };
    if (content.startsWith(TOOL_RESULT_ELISION_MARKER)) return { content, savedChars: 0 };
    if (toolResultTextLooksLikeError(content)) return { content, savedChars: 0 };
    const next = buildElidedToolResultText(content, toolName);
    if (next.length >= content.length) return { content, savedChars: 0 };
    return { content: next, savedChars: content.length - next.length };
  }
  if (!Array.isArray(content)) return { content, savedChars: 0 };
  let savedChars = 0;
  const mapped = content.map((part: any) => {
    if (!part || typeof part !== 'object' || part.type !== 'text') return part;
    const text = String(part.text || '');
    const elided = elideToolMessageContent(text, toolName);
    savedChars += elided.savedChars;
    return elided.savedChars > 0 ? { ...part, text: elided.content } : part;
  });
  return savedChars > 0 ? { content: mapped, savedChars } : { content, savedChars: 0 };
}

/**
 * Shorten tool results that older rounds already consumed.
 *
 * Mutates `messages` in place and returns how many messages were elided and
 * roughly how many characters were removed from the next provider request.
 */
export function elideStaleToolResults(
  messages: Array<any>,
  options: { keepRecent?: number } = {},
): { elidedCount: number; savedChars: number } {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { elidedCount: 0, savedChars: 0 };
  }
  const keepRecent = Math.max(
    0,
    Number.isFinite(Number(options.keepRecent))
      ? Math.floor(Number(options.keepRecent))
      : TOOL_RESULT_ELISION_KEEP_RECENT,
  );

  const toolIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'tool') toolIndexes.push(i);
  }
  if (toolIndexes.length <= keepRecent) return { elidedCount: 0, savedChars: 0 };

  const elidable = toolIndexes.slice(0, toolIndexes.length - keepRecent);
  let elidedCount = 0;
  let savedChars = 0;
  for (const index of elidable) {
    const msg = messages[index];
    const toolName = String(msg?.tool_name || '').trim();
    if (TOOL_RESULT_ELISION_EXEMPT_TOOLS.has(toolName)) continue;
    const result = elideToolMessageContent(msg.content, toolName);
    if (result.savedChars <= 0) continue;
    msg.content = result.content;
    elidedCount++;
    savedChars += result.savedChars;
  }
  return { elidedCount, savedChars };
}
