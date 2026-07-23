import { getConfig } from '../../config/config';
import { isKnownProviderId } from '../../providers/provider-registry.js';
import { normalizeReasoningEffort } from '../../providers/reasoning-capabilities';
import { getChatModelRoute, type ChatModelRoute } from '../session';
import { captureTurnRouteSnapshot, type ResolvedTurnRouteSource, type TurnRouteSnapshot } from './turn-route-snapshot';

export type ChatModelRouteState = {
  mode: 'explicit' | 'inherited';
  override?: ChatModelRoute;
  effective: { providerId: string; model: string; reasoningEffort?: string; accountId?: string };
  availability: 'ready' | 'unavailable';
  error?: string;
};

export class ChatModelRouteUnavailableError extends Error {
  constructor(public readonly state: ChatModelRouteState) {
    super(state.error || 'This chat model route is unavailable.');
    this.name = 'ChatModelRouteUnavailableError';
  }
}

function globalSource(raw: any): ResolvedTurnRouteSource {
  const providerId = String(raw?.llm?.provider || 'ollama').trim() || 'ollama';
  return {
    config: raw,
    providerId,
    model: String(raw?.llm?.providers?.[providerId]?.model || raw?.models?.primary || '').trim(),
    reasoningEffort: raw?.agent_model_default_reasoning?.main_chat,
    accountId: raw?.llm?.accountId,
  };
}

export function resolveChatModelRouteSource(sessionId: string): { source: ResolvedTurnRouteSource; state: ChatModelRouteState } {
  const raw = getConfig().getConfig() as any;
  const override = getChatModelRoute(sessionId);
  const source = override
    ? { config: raw, providerId: override.providerId, model: override.model, reasoningEffort: override.reasoningEffort, accountId: override.accountId }
    : globalSource(raw);
  const providerId = String(source.providerId || '').trim();
  const model = String(source.model || '').trim();
  const reasoningEffort = normalizeReasoningEffort(providerId, model, source.reasoningEffort);
  const state: ChatModelRouteState = {
    mode: override ? 'explicit' : 'inherited',
    ...(override ? { override } : {}),
    effective: { providerId, model, ...(reasoningEffort ? { reasoningEffort } : {}), ...(source.accountId ? { accountId: String(source.accountId) } : {}) },
    availability: 'ready',
  };
  if (override && !isKnownProviderId(providerId)) {
    state.availability = 'unavailable';
    state.error = `The saved provider "${providerId}" is no longer available. Reconnect it, choose another model, or use Main Chat default.`;
  }
  const accounts = raw?.llm?.providers?.[providerId]?.accounts;
  if (override?.accountId && (!accounts || !accounts[override.accountId])) {
    state.availability = 'unavailable';
    state.error = `The saved account "${override.accountId}" is unavailable for this chat. Reconnect it, choose another account, or use Main Chat default.`;
  }
  return { source, state };
}

export function captureChatTurnRouteSnapshot(sessionId: string): { snapshot: TurnRouteSnapshot; state: ChatModelRouteState } {
  const { source, state } = resolveChatModelRouteSource(sessionId);
  if (state.availability !== 'ready') throw new ChatModelRouteUnavailableError(state);
  try {
    const snapshot = captureTurnRouteSnapshot(source);
    state.effective = {
      providerId: snapshot.providerId,
      model: snapshot.model,
      ...(snapshot.reasoningEffort ? { reasoningEffort: snapshot.reasoningEffort } : {}),
      ...(snapshot.accountId ? { accountId: snapshot.accountId } : {}),
    };
    return { snapshot, state };
  } catch (error: any) {
    if (state.mode === 'explicit') {
      state.availability = 'unavailable';
      state.error = `This chat's saved model route cannot be used: ${String(error?.message || error)}. Reconnect it, choose another model, or use Main Chat default.`;
      throw new ChatModelRouteUnavailableError(state);
    }
    throw error;
  }
}

/** Validate an explicit route before persisting it without changing global Main Chat. */
export function validateChatModelRoute(route: Omit<ChatModelRoute, 'version' | 'updatedAt'>): ChatModelRouteState {
  const raw = getConfig().getConfig() as any;
  const source: ResolvedTurnRouteSource = {
    config: raw,
    providerId: route.providerId,
    model: route.model,
    reasoningEffort: route.reasoningEffort,
    accountId: route.accountId,
  };
  const state: ChatModelRouteState = {
    mode: 'explicit',
    override: { version: 1, ...route, updatedAt: Date.now() },
    effective: { providerId: route.providerId, model: route.model, ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}), ...(route.accountId ? { accountId: route.accountId } : {}) },
    availability: 'ready',
  };
  if (!isKnownProviderId(String(route.providerId || ''))) {
    state.availability = 'unavailable';
    state.error = `Unknown provider "${route.providerId}".`;
    return state;
  }
  const accounts = raw?.llm?.providers?.[route.providerId]?.accounts;
  if (route.accountId && (!accounts || !accounts[route.accountId])) {
    state.availability = 'unavailable';
    state.error = `Account "${route.accountId}" is not configured for ${route.providerId}.`;
    return state;
  }
  const requestedReasoning = String(route.reasoningEffort || '').trim();
  if (requestedReasoning && !normalizeReasoningEffort(route.providerId, route.model, requestedReasoning)) {
    state.availability = 'unavailable';
    state.error = `Reasoning effort "${requestedReasoning}" is not supported by ${route.model}.`;
    return state;
  }
  try {
    const snapshot = captureTurnRouteSnapshot(source);
    state.effective = { providerId: snapshot.providerId, model: snapshot.model, ...(snapshot.reasoningEffort ? { reasoningEffort: snapshot.reasoningEffort } : {}), ...(snapshot.accountId ? { accountId: snapshot.accountId } : {}) };
  } catch (error: any) {
    state.availability = 'unavailable';
    state.error = String(error?.message || error);
  }
  return state;
}
