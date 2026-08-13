/**
 * Shared terminal outcome rules for Thought, Dream, and Dream cleanup runs.
 *
 * A run that was interrupted can still be considered successful when its
 * expected artifacts are already verified. An interrupted run with no
 * verified artifacts must remain visibly aborted; it must not be converted
 * into a successful recovery artifact from the synthetic ABORTED response.
 */

export type BrainRunOutcome = 'success' | 'failed' | 'aborted';
export type BrainRunStatus = 'idle' | BrainRunOutcome;

export function resolveBrainRunOutcome(input: {
  verifiedSuccess: boolean;
  wasAborted: boolean;
}): BrainRunOutcome {
  if (input.verifiedSuccess) return 'success';
  return input.wasAborted ? 'aborted' : 'failed';
}

export function brainRunOutcomeError(
  jobLabel: string,
  outcome: BrainRunOutcome,
  fallback: string,
  abortReason?: string,
): string {
  return outcome === 'aborted'
    ? `Brain ${jobLabel} run aborted${abortReason ? ` (${abortReason})` : ''} before verified artifact completion.`
    : fallback;
}
