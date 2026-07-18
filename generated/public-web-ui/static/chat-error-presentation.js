/**
 * Converts transport/runtime failures into a small, user-facing presentation.
 * Raw responses stay available in `technicalDetails` for diagnostics, but must
 * never be used as assistant prose or a toast body.
 */
const MAX_TECHNICAL_DETAILS = 4000;

function oneLine(value, max = 220) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseErrorPayload(value) {
  if (value && typeof value === 'object') return value;
  const raw = String(value || '').trim();
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try { return JSON.parse(raw.slice(jsonStart)); } catch {}
  }
  return {};
}

function errorTechnicalDetails(error, payload) {
  const raw = typeof error === 'string'
    ? error
    : String(error?.rawBody || error?.message || 'Unknown chat error');
  const structured = payload && Object.keys(payload).length ? JSON.stringify(payload, null, 2) : raw;
  return String(structured || raw).slice(0, MAX_TECHNICAL_DETAILS);
}

/** @returns {{key:string, severity:string, title:string, summary:string, technicalDetails:string, code:string, httpStatus:number|null}} */
export function presentChatError(error) {
  const raw = String(typeof error === 'string' ? error : error?.message || error || '').trim();
  const payload = parseErrorPayload(error?.payload || error?.rawBody || raw);
  const code = String(error?.code || payload?.code || '').trim();
  const httpMatch = raw.match(/\bHTTP\s+(\d{3})\b/i);
  const httpStatus = Number(error?.httpStatus || payload?.status || httpMatch?.[1]) || null;
  const technicalDetails = errorTechnicalDetails(error, payload);

  if (code === 'SESSION_TURN_ACTIVE' || /another turn is already active|session.turn.active/i.test(raw)) {
    return {
      key: 'session-turn-active', code: 'SESSION_TURN_ACTIVE', httpStatus,
      severity: 'warning', title: 'Another request is still running',
      summary: 'Wait for it to finish, or stop the active request before trying again.',
      technicalDetails,
    };
  }
  if (/session lease|journal lease|resource lease|could not acquire.*lease|was fenced/i.test(raw)) {
    return {
      key: 'session-lease-unavailable', code: code || 'SESSION_LEASE_UNAVAILABLE', httpStatus,
      severity: 'warning', title: 'This chat is temporarily unavailable',
      summary: 'Prometheus lost its session lease. Try again in a moment.',
      technicalDetails,
    };
  }
  if (error?.mobileStreamDisconnected) {
    return {
      key: 'chat-connection-dropped', code: 'STREAM_DISCONNECTED', httpStatus,
      severity: 'warning', title: 'Connection dropped',
      summary: 'Recovery is checking whether Prometheus is still working.',
      technicalDetails,
    };
  }
  return {
    key: code ? `chat-${code.toLowerCase()}` : `chat-http-${httpStatus || 'error'}`,
    code: code || 'CHAT_REQUEST_FAILED', httpStatus,
    severity: 'error', title: httpStatus ? 'Could not send your message' : 'Chat error',
    summary: oneLine(payload?.error || payload?.message || 'Please try again.'),
    technicalDetails,
  };
}

export function presentGoalAction(action, result = {}) {
  const goal = result?.goal || {};
  const turns = Math.max(0, Number(goal.turnsUsed || 0) || 0);
  const stopped = action === 'done' || goal?.lastVerdict === 'stopped';
  if (stopped) {
    return {
      key: `goal-stopped-${goal?.id || 'current'}`,
      severity: 'info',
      title: 'Goal stopped',
      summary: turns === 0 ? 'No work was run.' : `Stopped by you after ${turns} ${turns === 1 ? 'turn' : 'turns'}.`,
      technicalDetails: String(result?.message || ''),
    };
  }
  return {
    key: `goal-${action || 'updated'}-${goal?.id || 'current'}`,
    severity: action === 'status' ? 'info' : 'success',
    title: action === 'status' ? 'Goal status' : 'Goal updated',
    summary: oneLine(result?.message || 'Goal updated.'),
    technicalDetails: String(result?.message || ''),
  };
}
