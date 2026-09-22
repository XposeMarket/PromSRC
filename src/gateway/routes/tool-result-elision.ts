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
//  - Results from the most recent provider round(s) are never shortened. The
//    model has not seen them yet: a batch of parallel calls from the round
//    that just executed must reach it verbatim, regardless of how many tool
//    messages that batch contains.

// A result must stay readable for several rounds, not one: the model's
// reasoning from earlier calls is not carried forward, so a result elided one
// round after it arrived is effectively lost and gets re-requested, costing a
// full extra provider round each time (measured 2026-09-22: ~15 re-reads in a
// single turn with keepRecentRounds=1).
export const TOOL_RESULT_ELISION_KEEP_RECENT = 8;
export const TOOL_RESULT_ELISION_KEEP_RECENT_ROUNDS = 4;
// Beyond the round/count guarantees, keep the newest results verbatim until
// this many characters of recent tool output are retained. Only output older
// than this working window is shortened.
export const TOOL_RESULT_ELISION_RECENT_BUDGET_CHARS = 60_000;
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
    'This result is from several rounds ago and falls outside the recent working window, so',
    'it was shortened to keep the context small. The full output remains in tool logs/raw',
    'storage; re-run the tool or use a targeted read if the exact payload is needed again.',
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
 * Group tool messages into provider rounds.
 *
 * A round is anchored by an assistant message that carries `tool_calls`; every
 * tool message that follows it (until the next assistant message) belongs to
 * that round. Tool messages with no anchor (legacy/degenerate shapes) are each
 * treated as their own round so the message-count fallback still applies.
 */
function groupToolMessagesByRound(messages: Array<any>): number[][] {
  const rounds: number[][] = [];
  let current: number[] | null = null;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = msg?.role;
    if (role === 'assistant') {
      const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
      current = hasToolCalls ? [] : null;
      if (hasToolCalls) rounds.push(current as number[]);
      continue;
    }
    if (role !== 'tool') {
      // Any non-tool, non-assistant message closes the current round.
      if (role !== undefined) current = null;
      continue;
    }
    if (current) {
      current.push(i);
    } else {
      rounds.push([i]);
    }
  }
  return rounds;
}

/**
 * Shorten tool results that older rounds already consumed.
 *
 * Elision is keyed on provider rounds, not raw tool-message count: the most
 * recent `keepRecentRounds` rounds stay verbatim in full, so a batch of
 * parallel tool calls from the round that just executed is never shortened
 * before the model has seen it once. `keepRecent` additionally guarantees a
 * minimum number of newest tool messages stay verbatim regardless of rounds.
 *
 * Mutates `messages` in place and returns how many messages were elided and
 * roughly how many characters were removed from the next provider request.
 */
export function elideStaleToolResults(
  messages: Array<any>,
  options: { keepRecent?: number; keepRecentRounds?: number; recentBudgetChars?: number } = {},
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
  const keepRecentRounds = Math.max(
    1,
    Number.isFinite(Number(options.keepRecentRounds))
      ? Math.floor(Number(options.keepRecentRounds))
      : TOOL_RESULT_ELISION_KEEP_RECENT_ROUNDS,
  );

  const rounds = groupToolMessagesByRound(messages);
  const toolIndexes = rounds.flat();
  if (toolIndexes.length <= keepRecent) return { elidedCount: 0, savedChars: 0 };

  const protectedIndexes = new Set<number>();
  for (const round of rounds.slice(-keepRecentRounds)) {
    for (const index of round) protectedIndexes.add(index);
  }
  if (keepRecent > 0) {
    // slice(-0) would return the whole array, so guard the zero case.
    for (const index of toolIndexes.slice(-keepRecent)) protectedIndexes.add(index);
  }
  const recentBudgetChars = Math.max(
    0,
    Number.isFinite(Number(options.recentBudgetChars))
      ? Math.floor(Number(options.recentBudgetChars))
      : TOOL_RESULT_ELISION_RECENT_BUDGET_CHARS,
  );
  if (recentBudgetChars > 0) {
    // Walk newest -> oldest and keep results verbatim while the recent window
    // still has room. Stops at the first result that would overflow it so the
    // protected window stays contiguous.
    let used = 0;
    for (let k = toolIndexes.length - 1; k >= 0; k--) {
      const index = toolIndexes[k];
      const content = messages[index]?.content;
      const size = typeof content === 'string' ? content.length : JSON.stringify(content ?? '').length;
      if (!protectedIndexes.has(index) && used + size > recentBudgetChars) break;
      used += size;
      protectedIndexes.add(index);
    }
  }

  let elidedCount = 0;
  let savedChars = 0;
  for (const index of toolIndexes) {
    if (protectedIndexes.has(index)) continue;
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
