/**
 * A Codex `response.completed` with no text and no tool calls (after the adapter's
 * own single same-request retry) is a missing answer, not a transport failure.
 * Only that strictly proven class, direct or serialized through the model-call
 * worker (`providerCode` + allowlisted diagnostics), is normalized to an empty
 * response so the caller's existing ModelResponseRecovery budget handles it.
 * Aborts, partial visible text, other Codex classes, and other providers return null.
 */
export function recoverableEmptyCompletionResponse(
  error: unknown,
  options: { aborted?: boolean; visiblePartialText?: string } = {},
): { content: string; tool_calls: [] } | null {
  if (options.aborted || String(options.visiblePartialText || '').trim()) return null;
  const err = error as any;
  if (!err || typeof err !== 'object' || err.name === 'AbortError') return null;
  const codex = err.code === 'CODEX_INCOMPLETE_STREAM' || err.providerCode === 'CODEX_INCOMPLETE_STREAM';
  const diagnostics = err.diagnostics;
  if (!codex || !diagnostics || typeof diagnostics !== 'object') return null;
  if (diagnostics.failureClass !== 'empty_completion' || diagnostics.sawCompleted !== true) return null;
  if (Number(diagnostics.toolCallCount || 0) > 0 || Number(diagnostics.finalTextChars || 0) > 0) return null;
  return { content: '', tool_calls: [] };
}

/** Append a recovery nudge without replaying tools or inserting an empty assistant turn. */
export function appendRecoveryTurn(messages: any[], response: { content?: unknown } | undefined, prompt: string): void {
  // Keep partial visible text, but never insert an empty assistant turn or
  // fabricate a tool result for a call that was not executed.
  if (String(response?.content || '').trim()) messages.push({ role: 'assistant', content: response!.content });
  messages.push({ role: 'user', content: prompt });
}

/** A missing answer is not evidence that the user's task is finished. */
export class ModelResponseRecovery {
  private consecutive = 0;
  private total = 0;
  private tokenLimitHits = 0;

  outputBudget(provider: string, model: string): number {
    const anthropic = provider === 'anthropic' || /^claude-/.test(model);
    return anthropic ? Math.min(32768, 16384 * 2 ** this.tokenLimitHits) : 4096;
  }

  inspect(response: { content?: unknown; tool_calls?: unknown[] }, stopReason?: string, aborted = false, incompleteCause?: string) {
    if (aborted || stopReason === 'refusal') return { action: 'accept' as const };
    if (response.tool_calls?.length) {
      this.consecutive = 0;
      return { action: 'accept' as const };
    }
    const incomplete = ['max_tokens', 'incomplete_stream'].includes(stopReason || '');
    if (String(response.content || '').trim() || stopReason === 'model_context_window_exceeded') {
      if (!incomplete) {
        this.consecutive = 0;
        return { action: 'accept' as const };
      }
    }
    if (this.consecutive >= 2 || this.total >= 6) return { action: 'exhausted' as const, reason: stopReason || 'empty_response', ...(incompleteCause ? { cause: incompleteCause } : {}) } as { action: 'exhausted'; reason: string; cause?: string };
    this.consecutive++;
    this.total++;
    if (stopReason === 'max_tokens') this.tokenLimitHits++;
    return {
      action: 'retry' as const,
      attempt: this.consecutive,
      reason: stopReason || 'empty_response',
      cause: incompleteCause,
      prompt: [
        stopReason === 'incomplete_stream' && (incompleteCause === 'invalid_tool_json' || incompleteCause === 'tool_block_unterminated')
          ? 'Your previous tool call arrived with invalid or truncated JSON arguments, so it was NOT executed. Do not resend the same long inline command. Put long or quote/backslash-heavy commands into a small script file (one short write call), then run that file with a short command. Keep each tool call compact.'
          : stopReason === 'max_tokens'
          ? 'Your previous response hit the output token limit. If you attempted a large tool call or file write, its arguments may have been cut off and the call was NOT executed. Do not repeat that oversized call. Create a small runnable file first, then add content in separate append/insert/patch calls of fewer than 250 lines each; keep each tool call well below the output limit.'
          : stopReason === 'incomplete_stream'
            ? 'Your previous response stream was interrupted before completion. Any unfinished tool call was NOT executed; use a short next action instead of repeating a large output.'
            : 'The previous model response did not finish the active request. Tools remain available.',
        'Continue the already-authorized task from the completed tool results. Do not repeat completed actions.',
        'Take the next necessary action, or give the final answer if the task is actually complete.',
        'Do not ask the user to say go or continue merely because this response needed recovery.',
      ].join(' '),
    };
  }
}
