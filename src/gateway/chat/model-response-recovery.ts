/** A missing answer is not evidence that the user's task is finished. */
export class ModelResponseRecovery {
  private consecutive = 0;
  private total = 0;
  private tokenLimitHits = 0;

  outputBudget(provider: string, model: string): number {
    const anthropic = provider === 'anthropic' || /^claude-/.test(model);
    return anthropic ? Math.min(32768, 16384 * 2 ** this.tokenLimitHits) : 4096;
  }

  inspect(response: { content?: unknown; tool_calls?: unknown[] }, stopReason?: string, aborted = false) {
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
    if (this.consecutive >= 2 || this.total >= 6) return { action: 'exhausted' as const, reason: stopReason || 'empty_response' };
    this.consecutive++;
    this.total++;
    if (stopReason === 'max_tokens') this.tokenLimitHits++;
    return {
      action: 'retry' as const,
      attempt: this.consecutive,
      reason: stopReason || 'empty_response',
      prompt: [
        stopReason === 'max_tokens'
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
