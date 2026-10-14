export interface TaskVerificationAssessment {
  failed: boolean;
  reason?: string;
}

/** Classifies verifier output without depending on gateway/runtime state. */
export function assessTaskVerification(result: { text?: unknown; status?: unknown } | null | undefined): TaskVerificationAssessment {
  const text = String(result?.text || '').trim();
  const status = String(result?.status || '').trim().toLowerCase();
  if (/^(?:failed|failure|error|blocked|unable|could_not_complete|incomplete)$/.test(status)) {
    return { failed: true, reason: `structured status: ${status}` };
  }
  if (!text) return { failed: true, reason: 'empty verifier response' };
  if (/^error:/i.test(text)) return { failed: true, reason: 'error response' };
  // Inspect the leading assessment and explicitly labeled summaries, not an
  // entire historical log. Negated failure words are positive evidence, but
  // must not mask a separate failed/blocked acceptance assessment.
  const assessment = text.split(/\r?\n/).filter((line, index) => index < 8 || /^(?:\W*)(?:summary|status|result|verdict)\b/i.test(line)).join('\n')
    .replace(/\b(?:no|without|zero)\s+(?:failed\s+(?:tests?|checks?)|failures?|issues?|blocks?)\b/gi, '')
    .replace(/\bnot\s+blocked\b/gi, '');
  if (/\b(?:failed|could not|unable to|did not meet|acceptance criteria not met|blocked)\b/i.test(assessment)) {
    return { failed: true, reason: 'failure language in verifier response' };
  }
  return { failed: false };
}
