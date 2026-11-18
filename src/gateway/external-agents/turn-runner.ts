/**
 * Runs ONE turn of a chat that is bound to a live external agent (stage 3:
 * Codex). Called from runInteractiveTurn BEFORE Prometheus captures a model
 * route, builds a prompt, injects memory, matches skills, compacts or runs
 * any tool. Prometheus only stores the transcript and paints the screen.
 *
 * Tool rows reported by the agent are DISPLAY ONLY (observed: true).
 * Approval cards go back to the exact upstream request (pending-requests.ts)
 * and never touch a Prometheus permission or approval store.
 */
import fs from 'fs';
import path from 'path';

import { getConfig } from '../../config/config';
import { broadcastWS } from '../comms/broadcaster';
import {
  addMessage,
  autoNameSession,
  getSession,
  getSessionExternalAgent,
  setSessionExternalAgent,
  type TurnOrigin,
} from '../session';
import { expandHome } from './executable';
import { createPendingRequest } from './pending-requests';
import { getExternalAgentAdapter, isExternalAgentUsable, registerLiveExternalTurn } from './registry';
import type { ExternalAgentBinding, ExternalAgentEvent, ExternalAgentId, ExternalUserRequest } from './types';

const activeExternalSessions = new Set<string>();

export interface ExternalAgentRequestInput {
  id: ExternalAgentId | 'prometheus';
  cwd?: string;
  model?: string;
  effort?: string;
}

function cleanEffort(value: unknown): string | undefined {
  const effort = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z_-]{1,20}$/.test(effort) ? effort : undefined;
}

export interface ExternalTurnRunParams {
  sessionId: string;
  message: string;
  sendSSE: (event: string, data: any) => void;
  abortSignal?: { aborted: boolean; signal?: AbortSignal };
  turnOrigin?: TurnOrigin;
  clientRequestId?: string;
  attachmentCount?: number;
  attachmentPreviews?: any[];
}

export interface ExternalTurnRunResult {
  type: 'chat';
  text: string;
  externalAgent: { agentId: ExternalAgentId; status: 'completed' | 'interrupted' | 'failed' | 'refused' };
}

export type BindOutcome =
  | { ok: true; binding: ExternalAgentBinding | null; created: boolean }
  | { ok: false; status: 400 | 409; code: 'agent_locked' | 'agent_unavailable' | 'bad_cwd' | 'imported_chat'; error: string };

const AGENT_NAMES: Record<string, string> = { codex: 'Codex', 'claude-code': 'Claude Code', openclaw: 'OpenClaw', hermes: 'Hermes', cursor: 'Cursor' };

export function externalAgentName(id: string): string {
  return AGENT_NAMES[id] || id;
}

function isDirectory(candidate: string): boolean {
  try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
}

/** cwd default order (contract §4.5): picked folder, then the chat's project folder, then the Prometheus workspace. */
export function resolveExternalAgentCwd(sessionId: string, requested?: string): { ok: true; cwd: string } | { ok: false; error: string } {
  const raw = String(requested || '').trim();
  if (raw) {
    const resolved = path.resolve(expandHome(raw));
    if (!isDirectory(resolved)) return { ok: false, error: 'That folder does not exist on this computer.' };
    return { ok: true, cwd: resolved };
  }
  let session: any = null;
  try { session = getSession(sessionId); } catch { session = null; }
  for (const candidate of [session?.canvasProjectRoot, session?.workspace, getConfig().getWorkspacePath()]) {
    const value = String(candidate || '').trim();
    if (value && isDirectory(value)) return { ok: true, cwd: path.resolve(value) };
  }
  return { ok: false, error: 'No folder to run the agent in. Pick a folder first.' };
}

function hasConversation(sessionId: string): boolean {
  try {
    const history = Array.isArray(getSession(sessionId).history) ? getSession(sessionId).history : [];
    return history.some((msg: any) => msg?.role === 'user' || msg?.role === 'assistant');
  } catch {
    return false;
  }
}

/**
 * Decide the agent for this request. Binding happens once, on the first
 * message of a NEW chat. A different agent later gets 409 agent_locked.
 *
 * `dryRun` runs every check and saves nothing. The chat route validates with it
 * first and saves the binding only once the request owns the turn, so a request
 * refused as busy or replayed as a duplicate never changes who runs the chat.
 */
export function bindExternalAgentForRequest(sessionId: string, requested: ExternalAgentRequestInput | null | undefined, options: { dryRun?: boolean } = {}): BindOutcome {
  const existing = getSessionExternalAgent(sessionId);
  const wantedId = requested?.id ? String(requested.id) : '';
  if (existing) {
    if (wantedId && wantedId !== existing.agentId) {
      return { ok: false, status: 409, code: 'agent_locked', error: `This chat runs on ${externalAgentName(existing.agentId)}. The agent can't be changed after the first message; start a new chat instead.` };
    }
    if (requested?.model || requested?.effort !== undefined) {
      if (activeExternalSessions.has(sessionId)) return { ok: false, status: 409, code: 'agent_locked', error: 'Wait for this turn to finish before changing models.' };
      if (options.dryRun) return { ok: true, binding: existing, created: false };
      const next: ExternalAgentBinding = { ...existing, ...(requested.model ? { selectedModel: requested.model.slice(0, 200) } : {}) };
      const effort = cleanEffort(requested.effort);
      if (effort) next.selectedEffort = effort; else if (requested.effort !== undefined || requested.model) delete next.selectedEffort;
      return { ok: true, binding: setSessionExternalAgent(sessionId, next) || existing, created: false };
    }
    return { ok: true, binding: existing, created: false };
  }
  if (!wantedId || wantedId === 'prometheus') return { ok: true, binding: null, created: false };
  let session: any = null;
  try { session = getSession(sessionId); } catch { session = null; }
  if (session?.externalImport) {
    return { ok: false, status: 409, code: 'imported_chat', error: 'An imported chat continues in Prometheus and cannot be handed to a live agent.' };
  }
  if (hasConversation(sessionId)) {
    return { ok: false, status: 409, code: 'agent_locked', error: 'This chat already runs on Prometheus. The agent can be chosen only for a new chat.' };
  }
  const adapter = getExternalAgentAdapter(wantedId as ExternalAgentId);
  const usable = adapter ? isExternalAgentUsable(adapter.id) : { ok: false };
  if (!adapter || !usable.ok) {
    return { ok: false, status: 409, code: 'agent_unavailable', error: `${externalAgentName(wantedId)} is not connected. Turn it on in Settings > Agents & imports.` };
  }
  const cwd = resolveExternalAgentCwd(sessionId, requested?.cwd);
  if (!cwd.ok) return { ok: false, status: 400, code: 'bad_cwd', error: cwd.error };
  if (options.dryRun) return { ok: true, binding: null, created: false };
  const binding = setSessionExternalAgent(sessionId, {
    version: 1,
    agentId: adapter.id,
    cwd: cwd.cwd,
    boundAt: new Date().toISOString(),
    ...(requested?.model ? { selectedModel: requested.model.slice(0, 200) } : {}),
    ...(cleanEffort(requested?.effort) ? { selectedEffort: cleanEffort(requested?.effort) } : {}),
  });
  return { ok: true, binding: binding || null, created: true };
}

/** Plain-line refusal for native features that cannot apply to a bound chat. */
export function externalAgentRefusal(binding: ExternalAgentBinding, feature: string): string {
  return `${feature} doesn't apply here: this chat is run by ${externalAgentName(binding.agentId)}.`;
}

const NATIVE_SLASH = /^\s*\/(goal|skill|skills|model|memory|compact|timer|schedule|voice|agent|delegate|team)\b/i;

function sendInfo(sendSSE: ExternalTurnRunParams['sendSSE'], message: string): void {
  sendSSE('info', { message, source: 'external_agent' });
}

function summarize(text: string, max = 60): string {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).trim()}…`;
}

function refuse(params: ExternalTurnRunParams, binding: ExternalAgentBinding, text: string): ExternalTurnRunResult {
  sendInfo(params.sendSSE, text);
  return { type: 'chat', text, externalAgent: { agentId: binding.agentId, status: 'refused' } };
}

export async function runExternalAgentTurn(params: ExternalTurnRunParams, binding: ExternalAgentBinding): Promise<ExternalTurnRunResult> {
  const { sessionId, sendSSE } = params;
  const agentName = externalAgentName(binding.agentId);
  const adapter = getExternalAgentAdapter(binding.agentId);
  const usable = isExternalAgentUsable(binding.agentId);
  if (!adapter || !usable.ok) {
    return refuse(params, binding, usable.reason === 'disabled'
      ? `${agentName} is turned off. Turn ${agentName} back on in Settings > Agents & imports to continue this chat.`
      : `${agentName} isn't ready. Open Settings > Agents & imports and Check again.`);
  }
  if (NATIVE_SLASH.test(params.message)) {
    return refuse(params, binding, externalAgentRefusal(binding, `${params.message.trim().split(/\s+/)[0]}`));
  }
  if ((params.attachmentCount || 0) > 0 && !adapter.capabilities.images) {
    return refuse(params, binding, `${agentName} chats in Prometheus can't take attachments yet. Send the text on its own.`);
  }

  if (binding.selectedModel && (binding.agentId === 'codex' || binding.agentId === 'claude-code')) {
    try {
      const catalog = await adapter.listModels?.({ cwd: binding.cwd, upstreamSessionId: binding.upstreamSessionId });
      const entry = catalog?.models.find(model => model.id === binding.selectedModel);
      if (!entry) return refuse(params, binding, 'That model is not available in this agent. Choose a model from its own list.');
      if (binding.selectedEffort && Array.isArray(entry.efforts) && !entry.efforts.includes(binding.selectedEffort)) return refuse(params, binding, 'That reasoning level is not available for this model. Choose another level.');
    } catch { return refuse(params, binding, 'Could not verify this agent model. Check its connection and choose again.'); }
  }
  if (activeExternalSessions.has(sessionId)) return refuse(params, binding, 'This agent is still working on the previous message.');
  if (params.abortSignal?.aborted || params.abortSignal?.signal?.aborted) return refuse(params, binding, 'Stopped before sending to the agent.');
  if (!isExternalAgentUsable(binding.agentId).ok) return refuse(params, binding, 'This agent was disconnected.');
  const startedAt = Date.now();
  const origin = params.turnOrigin;
  addMessage(sessionId, {
    role: 'user',
    content: params.message,
    timestamp: startedAt,
    ...(params.clientRequestId ? { clientRequestId: params.clientRequestId } : {}),
    ...(origin ? { channel: origin.channel, channelLabel: origin.label || origin.channel, origin } : {}),
    ...(Array.isArray(params.attachmentPreviews) && params.attachmentPreviews.length ? { attachmentPreviews: params.attachmentPreviews } : {}),
  } as any, { disableCompactionCheck: true, disableMemoryFlushCheck: true });

  // Name the chat from the first message without a model call.
  try {
    const session = getSession(sessionId);
    if (session.autoTitleLocked !== true) {
      const title = summarize(params.message);
      if (title && autoNameSession(sessionId, title)) {
        broadcastWS({ type: 'session_title', sessionId, title, autoTitleLocked: true });
      }
    }
  } catch { /* naming is cosmetic */ }

  const controller = new AbortController();
  const outer = params.abortSignal?.signal;
  const onOuterAbort = () => controller.abort(outer?.reason || 'operator_abort');
  if (outer?.aborted || params.abortSignal?.aborted) controller.abort('operator_abort');
  else outer?.addEventListener('abort', onOuterAbort, { once: true });
  const unregister = registerLiveExternalTurn(binding.agentId, () => controller.abort('agent_disabled'));
  activeExternalSessions.add(sessionId);

  let streamed = '';
  const emit = (event: ExternalAgentEvent) => {
    switch (event.type) {
      case 'state':
        sendSSE('external_agent_state', { agentId: binding.agentId, phase: event.phase });
        return;
      case 'text_delta':
        streamed += event.text;
        sendSSE('token', { text: event.text });
        return;
      case 'reasoning_delta':
        sendSSE('thinking_delta', { thinking: event.text, text: event.text, source: 'external', visibility: 'user', agentId: binding.agentId });
        return;
      case 'item_started':
        sendSSE('tool_call', {
          action: event.title, name: event.title, args: event.detail ? { detail: event.detail } : {},
          external: true, observed: true, agentId: binding.agentId, itemId: event.itemId, kind: event.kind,
        });
        return;
      case 'item_completed':
        sendSSE('tool_result', {
          action: event.title || event.kind, result: event.summary, error: !event.ok,
          external: true, observed: true, agentId: binding.agentId, itemId: event.itemId, kind: event.kind,
          ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
        });
        return;
      case 'usage':
        sendSSE('info', { source: 'external_agent_usage', agentId: binding.agentId, usedTokens: event.usedTokens, maxTokens: event.maxTokens });
        return;
      case 'notice':
        sendInfo(sendSSE, event.text);
        return;
      default:
        return;
    }
  };

  const requestUser = (card: Omit<ExternalUserRequest, 'requestId' | 'agentId' | 'sessionId'>, opts?: { signal?: AbortSignal; cancelResponse?: { optionId: string } }) =>
    createPendingRequest({ ...card, agentId: binding.agentId, sessionId }, {
      signal: opts?.signal || controller.signal,
      cancelResponse: opts?.cancelResponse || { optionId: 'cancel' },
      onRequest: (request) => {
        sendSSE('external_agent_request', { request });
        broadcastWS({ type: 'external_agent_request', sessionId, request });
      },
      onResolved: (data) => {
        sendSSE('external_agent_request_resolved', data);
        broadcastWS({ type: 'external_agent_request_resolved', ...data });
      },
    });

  let result;
  try {
    result = await adapter.runTurn({
      sessionId,
      ...(binding.upstreamSessionId ? { upstreamSessionId: binding.upstreamSessionId } : {}),
      cwd: binding.cwd,
      text: params.message,
      ...(binding.selectedModel ? { model: binding.selectedModel } : {}),
      ...(binding.selectedEffort ? { effort: binding.selectedEffort } : {}),
      signal: controller.signal,
      emit,
      requestUser,
      onSessionBound: (upstreamSessionId) => {
        const current = getSessionExternalAgent(sessionId) || binding;
        setSessionExternalAgent(sessionId, { ...current, upstreamSessionId });
      },
    });
  } catch (error: any) {
    result = { upstreamSessionId: binding.upstreamSessionId || '', status: 'failed' as const, finalText: '', error: String(error?.message || error).slice(0, 300) };
  } finally {
    outer?.removeEventListener('abort', onOuterAbort);
    unregister();
    activeExternalSessions.delete(sessionId);
  }

  const endedAt = Date.now();
  const latest = getSessionExternalAgent(sessionId) || binding;
  setSessionExternalAgent(sessionId, {
    ...latest,
    ...(result.model ? { currentModel: result.model } : {}),
    // A missing upstream session is kept so the user can explicitly start a new one.
    ...(result.upstreamSessionId ? { upstreamSessionId: result.upstreamSessionId } : {}),
    lastTurn: {
      status: result.status,
      ...(result.upstreamMissing ? { upstreamMissing: true } : {}),
      ...(result.upstreamTurnId ? { upstreamTurnId: result.upstreamTurnId } : {}),
      endedAt: new Date(endedAt).toISOString(),
      ...(result.error ? { error: result.error } : {}),
    },
  });

  const body = String(result.finalText || streamed || '').trim();
  let text = body;
  if (result.upstreamMissing) {
    text = `${agentName} can't find this session any more.`;
    sendSSE('external_agent_state', { agentId: binding.agentId, phase: 'upstream_missing' });
  } else if (result.status === 'interrupted') {
    text = body ? `${body}\n\n_Stopped._` : '_Stopped._';
  } else if (result.status === 'failed') {
    text = [body, `${agentName} couldn't finish: ${result.error || 'unknown error'}`].filter(Boolean).join('\n\n');
  }

  addMessage(sessionId, {
    role: 'assistant',
    content: text,
    timestamp: endedAt,
    workStartedAt: startedAt,
    workEndedAt: endedAt,
    workDurationMs: Math.max(0, endedAt - startedAt),
    ...(params.clientRequestId ? { clientRequestId: params.clientRequestId } : {}),
    ...(origin ? { channel: origin.channel, channelLabel: origin.label || origin.channel } : {}),
    externalAgent: {
      agentId: binding.agentId,
      status: result.status,
      ...(result.model ? { model: result.model } : {}),
      ...(result.upstreamMissing ? { upstreamMissing: true } : {}),
    },
  } as any, { disableCompactionCheck: true, disableMemoryFlushCheck: true });

  return { type: 'chat', text, externalAgent: { agentId: binding.agentId, status: result.status } };
}

/** Explicit user action after "can't find this session": the next message starts a fresh upstream session. */
export function startFreshUpstreamSession(sessionId: string): ExternalAgentBinding | null {
  const binding = getSessionExternalAgent(sessionId);
  if (!binding || activeExternalSessions.has(sessionId)) return null;
  const { upstreamSessionId: _drop, lastTurn: _last, ...rest } = binding;
  return setSessionExternalAgent(sessionId, { ...rest }) || null;
}
