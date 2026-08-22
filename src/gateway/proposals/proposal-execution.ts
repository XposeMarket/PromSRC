const MAX_PROPOSAL_ERROR_CHARS = 500;

export type ProposalExecutorResponse = {
  type: string;
  text: string;
  thinking?: string;
};

export type ProposalExecutorResponseResult =
  | { ok: true; response: ProposalExecutorResponse }
  | { ok: false; error: string };

function trimForDisplay(value: string, maxChars = MAX_PROPOSAL_ERROR_CHARS): string {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * Convert server/provider errors into a short operator-facing message.
 * Never expose a raw JSON response, stack, or executor payload in the UI.
 */
export function compactProposalError(error: unknown, fallback = 'Proposal execution failed.'): string {
  let raw = error instanceof Error ? error.message : String(error ?? '');
  raw = raw.trim();

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        raw = String(parsed.error || parsed.message || parsed.detail || '').trim();
      }
    } catch {
      // Keep ordinary string errors as-is.
    }
  }

  return trimForDisplay(raw || fallback);
}

/**
 * Normalize the existing handleChat response contract before the runner reads
 * `text`. A missing/non-string text is a failed executor response, not success.
 */
export function normalizeProposalExecutorResponse(response: unknown): ProposalExecutorResponseResult {
  if (!response || typeof response !== 'object') {
    return { ok: false, error: 'Executor returned no usable response.' };
  }

  const candidate = response as Record<string, unknown>;
  const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
  if (!text) {
    return { ok: false, error: 'Executor returned an empty or malformed response.' };
  }

  return {
    ok: true,
    response: {
      type: typeof candidate.type === 'string' ? candidate.type : 'final',
      text,
      thinking: typeof candidate.thinking === 'string' ? candidate.thinking : undefined,
    },
  };
}

export { MAX_PROPOSAL_ERROR_CHARS };
