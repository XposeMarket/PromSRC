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
    if (this.consecutive >= 2 || this.total >= 6) return { action: 'exhausted' as const };
    this.consecutive++;
    this.total++;
    if (stopReason === 'max_tokens') this.tokenLimitHits++;
    return {
      action: 'retry' as const,
      attempt: this.consecutive,
      reason: stopReason || 'empty_response',
      prompt: [
        'The previous model response did not finish the active request. Tools remain available.',
        'Continue the already-authorized task from the completed tool results. Do not repeat completed actions.',
        'Take the next necessary action, or give the final answer if the task is actually complete.',
        'Do not ask the user to say go or continue merely because this response needed recovery.',
      ].join(' '),
    };
  }
}
