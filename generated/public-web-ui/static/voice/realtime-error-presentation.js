export const CODEX_REALTIME_SESSION_MODEL_REJECTED = 'codex_realtime_session_model_rejected';

const CODEX_SESSION_MODEL_REJECTED_PATTERN = /Field [`'"]?session\.model[`'"]? is not allowed for this Codex realtime session/i;

function errorBody(value) {
  return value?.body && typeof value.body === 'object' ? value.body : value;
}

export function realtimeVoiceErrorFromResponse(body, status = 0, fallback = 'Realtime voice failed.') {
  const payload = body && typeof body === 'object' ? body : {};
  const error = new Error(String(payload.error || fallback));
  error.status = Number(status || 0);
  error.body = payload;
  if (payload.code) error.code = String(payload.code);
  if (typeof payload.retryable === 'boolean') error.retryable = payload.retryable;
  return error;
}

export function presentRealtimeVoiceError(value) {
  const body = errorBody(value) || {};
  const code = String(value?.code || body?.code || '').trim();
  const raw = String(value?.message || body?.error || value || 'Realtime voice failed.').trim();
  if (code === CODEX_REALTIME_SESSION_MODEL_REJECTED || CODEX_SESSION_MODEL_REJECTED_PATTERN.test(raw)) {
    return {
      code: CODEX_REALTIME_SESSION_MODEL_REJECTED,
      title: 'Codex Voice temporarily unavailable',
      message: 'The upstream Codex realtime service rejected its session configuration. Your chat is safe; use another configured voice provider or try Codex Voice again after the service is updated.',
      retryable: false,
    };
  }
  return {
    code: code || 'realtime_voice_failed',
    title: 'Realtime voice failed',
    message: raw || 'Realtime voice failed.',
    retryable: value?.retryable !== false && body?.retryable !== false,
  };
}
