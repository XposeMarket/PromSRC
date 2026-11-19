/**
 * Upstream approval/question requests waiting on the user.
 *
 * Memory only. Each entry keeps the exact upstream answer path in a closure
 * (`resolve`), so a user answer goes ONLY to the request it came from. Nothing
 * here creates, widens or records a Prometheus permission, trusted command or
 * approval; the Prometheus approvals store is never touched.
 */
import crypto from 'crypto';

import type { ExternalAgentId, ExternalUserRequest, ExternalUserResponse } from './types';

interface PendingEntry {
  request: ExternalUserRequest;
  createdAt: number;
  resolve: (response: ExternalUserResponse) => void;
  notify?: (event: 'external_agent_request_resolved', data: any) => void;
}

const pending = new Map<string, PendingEntry>();
const answered = new Set<string>();

export type RespondOutcome =
  | { ok: true; request: ExternalUserRequest }
  | { ok: false; status: 404 | 409 | 400; error: string };

export function createPendingRequest(
  base: Omit<ExternalUserRequest, 'requestId'>,
  hooks: {
    onRequest?: (request: ExternalUserRequest) => void;
    onResolved?: (data: { requestId: string; sessionId: string; optionId: string; reason?: string }) => void;
    signal?: AbortSignal;
    /** What to answer if the turn is stopped before the user does. */
    cancelResponse: ExternalUserResponse;
  },
): Promise<ExternalUserResponse> {
  const requestId = crypto.randomUUID();
  const request: ExternalUserRequest = { ...base, requestId };
  return new Promise<ExternalUserResponse>((resolve) => {
    let settled = false;
    const finish = (response: ExternalUserResponse, reason?: string) => {
      if (settled) return;
      settled = true;
      pending.delete(requestId);
      answered.add(requestId);
      if (answered.size > 2000) answered.delete(answered.values().next().value as string);
      hooks.signal?.removeEventListener('abort', onAbort);
      try { hooks.onResolved?.({ requestId, sessionId: request.sessionId, optionId: response.optionId, ...(reason ? { reason } : {}) }); } catch { /* UI notice only */ }
      resolve(response);
    };
    const onAbort = () => finish(hooks.cancelResponse, 'cancelled');
    pending.set(requestId, { request, createdAt: Date.now(), resolve: (response) => finish(response) });
    if (hooks.signal?.aborted) { onAbort(); return; }
    hooks.signal?.addEventListener('abort', onAbort, { once: true });
    try { hooks.onRequest?.(request); } catch { /* UI notice only */ }
  });
}

export function listPendingRequests(sessionId?: string): ExternalUserRequest[] {
  return [...pending.values()]
    .filter((entry) => !sessionId || entry.request.sessionId === sessionId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((entry) => entry.request);
}

/**
 * Answer one request. `expected` narrows it to the session and agent the
 * caller believes it belongs to; mismatches change nothing.
 */
export function respondToPendingRequest(
  requestId: string,
  response: ExternalUserResponse,
  expected: { sessionId?: string; agentId?: ExternalAgentId } = {},
): RespondOutcome {
  const id = String(requestId || '').trim();
  const entry = pending.get(id);
  if (!entry) {
    return answered.has(id)
      ? { ok: false, status: 409, error: 'This request was already answered.' }
      : { ok: false, status: 404, error: 'Unknown request.' };
  }
  if (expected.sessionId && expected.sessionId !== entry.request.sessionId) return { ok: false, status: 404, error: 'Unknown request.' };
  if (expected.agentId && expected.agentId !== entry.request.agentId) return { ok: false, status: 404, error: 'Unknown request.' };
  const option = entry.request.options.find((candidate) => candidate.id === String(response?.optionId || ''));
  if (!option) return { ok: false, status: 400, error: 'That option was not offered by the agent.' };
  const answers: Record<string, string[]> = {};
  if (response?.answers && typeof response.answers === 'object') {
    for (const [key, value] of Object.entries(response.answers)) {
      if (!Array.isArray(value)) continue;
      answers[String(key).slice(0, 200)] = value.map((item) => String(item ?? '').slice(0, 4000)).slice(0, 20);
    }
  }
  entry.resolve({
    optionId: option.id,
    ...(Object.keys(answers).length ? { answers } : {}),
    ...(typeof response?.text === 'string' ? { text: response.text.slice(0, 8000) } : {}),
  });
  return { ok: true, request: entry.request };
}

/** Stop/shutdown: every pending request for the session (or all) gets its cancel answer. */
export function cancelPendingRequests(filter: { sessionId?: string; agentId?: ExternalAgentId } = {}): number {
  let count = 0;
  for (const entry of [...pending.values()]) {
    if (filter.sessionId && entry.request.sessionId !== filter.sessionId) continue;
    if (filter.agentId && entry.request.agentId !== filter.agentId) continue;
    const cancel = entry.request.options.find((option) => option.kind === 'cancel')
      || entry.request.options.find((option) => option.kind === 'deny');
    entry.resolve({ optionId: cancel?.id || 'cancel' });
    count += 1;
  }
  return count;
}
