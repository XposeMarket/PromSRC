export const CODEX_REALTIME_SESSION_MODEL_REJECTED = 'codex_realtime_session_model_rejected';

export type CodexRealtimeStartError = {
  code: string;
  error: string;
  retryable: boolean;
  upstream: boolean;
  technicalDetails?: string;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return String(error.message || error);
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return String(record.message || record.error || record.detail || error);
  }
  return String(error || 'Codex realtime session failed.');
}

export function classifyCodexRealtimeStartError(error: unknown): CodexRealtimeStartError {
  const technicalDetails = errorMessage(error).trim();
  if (/Field [`'"]?session\.model[`'"]? is not allowed for this Codex realtime session/i.test(technicalDetails)) {
    return {
      code: CODEX_REALTIME_SESSION_MODEL_REJECTED,
      error: 'Codex Voice is temporarily unavailable because the upstream Codex realtime service rejected its session configuration. Your Prometheus chat was not lost.',
      retryable: false,
      upstream: true,
      technicalDetails,
    };
  }
  return {
    code: 'codex_realtime_start_failed',
    error: technicalDetails || 'Codex realtime session failed.',
    retryable: true,
    upstream: true,
  };
}
