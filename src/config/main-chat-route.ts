/**
 * Canonical main-chat routing helpers.
 *
 * `llm.provider` + its provider config are the live route.  The main_chat
 * default is deliberately kept as a durable mirror so templates and older
 * callers cannot make the UI describe a different route from the live chat.
 */
import { hasReasoningCapabilityPolicy, normalizeReasoningEffort } from '../providers/reasoning-capabilities.js';

export type MainChatRoute = {
  provider: string;
  model: string;
  reasoningEffort?: string;
  accountId?: string;
};

function normalizeRouteReasoning(provider: string, model: string, value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Ollama and third-party providers may have their own internal thinking
  // vocabulary. Hosted providers covered by the shared capability contract
  // must never retain a value that their selected model cannot accept.
  if (!hasReasoningCapabilityPolicy(provider)) return raw;
  return normalizeReasoningEffort(provider, model, raw) || '';
}

export function readLiveMainChatRoute(config: any): MainChatRoute | null {
  const provider = String(config?.llm?.provider || '').trim();
  const providerConfig = provider ? config?.llm?.providers?.[provider] : null;
  const model = String(providerConfig?.model || config?.models?.primary || '').trim();
  if (!provider || !model) return null;
  const reasoningEffort = normalizeRouteReasoning(provider, model, providerConfig?.reasoning_effort);
  return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

export function parseMainChatRoute(value: unknown, reasoningEffort?: unknown): MainChatRoute | null {
  const raw = String(value || '').trim();
  const slash = raw.indexOf('/');
  if (slash <= 0 || slash === raw.length - 1) return null;
  const provider = raw.slice(0, slash).trim();
  const model = raw.slice(slash + 1).trim();
  if (!provider || !model) return null;
  const effort = String(reasoningEffort || '').trim();
  return { provider, model, ...(effort ? { reasoningEffort: effort } : {}) };
}

export function formatMainChatRoute(route: MainChatRoute | null): string {
  return route ? `${route.provider}/${route.model}` : '';
}

/** Return one atomic config patch that makes a route live and mirrors it into main_chat. */
export function mainChatRoutePatch(config: any, route: MainChatRoute): Record<string, any> {
  const currentLlm = config?.llm || {};
  const currentProviders = currentLlm.providers || {};
  const currentProvider = currentProviders[route.provider] || {};
  const nextProvider = { ...currentProvider, model: route.model };
  const targetAccountId = String(route.accountId || nextProvider.defaultAccountId || '').trim();
  const retainCurrentAccountId = route.provider === String(currentLlm.provider || '').trim();
  const accountId = targetAccountId || (retainCurrentAccountId ? String(currentLlm.accountId || '').trim() : '');
  const requestedReasoning = route.reasoningEffort !== undefined
    ? route.reasoningEffort
    : currentProvider.reasoning_effort;
  const effectiveReasoning = normalizeRouteReasoning(route.provider, route.model, requestedReasoning);
  if (effectiveReasoning) nextProvider.reasoning_effort = effectiveReasoning;
  else delete nextProvider.reasoning_effort;
  const defaults = { ...(config?.agent_model_defaults || {}), main_chat: formatMainChatRoute(route) };
  const reasoning = { ...(config?.agent_model_default_reasoning || {}) };
  if (effectiveReasoning) reasoning.main_chat = effectiveReasoning;
  else delete reasoning.main_chat;
  return {
    llm: {
      ...currentLlm,
      provider: route.provider,
      ...(accountId ? { accountId } : { accountId: undefined }),
      providers: { ...currentProviders, [route.provider]: nextProvider },
    },
    models: {
      ...(config?.models || {}),
      primary: route.model,
      roles: {
        ...(config?.models?.roles || {}),
        manager: route.model,
        executor: route.model,
        verifier: route.model,
      },
    },
    agent_model_defaults: defaults,
    agent_model_default_reasoning: reasoning,
  };
}

/**
 * Keep a connection/provider-settings save from switching the active chat.
 * Provider credentials/endpoints still merge, but the existing live route and
 * its reasoning setting win over the left-hand connection selector.
 */
export function preserveLiveMainChatRoute(config: any, nextLlm: any): any {
  const live = readLiveMainChatRoute(config);
  if (!live) return nextLlm;
  const providers = { ...(nextLlm?.providers || {}) };
  const selected = { ...(providers[live.provider] || {}) };
  selected.model = live.model;
  if (live.reasoningEffort) selected.reasoning_effort = live.reasoningEffort;
  else delete selected.reasoning_effort;
  providers[live.provider] = selected;
  const accountId = String(selected.defaultAccountId || config?.llm?.accountId || '').trim();
  return { ...nextLlm, provider: live.provider, ...(accountId ? { accountId } : {}), providers };
}

/** Reconcile missing or stale legacy main_chat data from the already-live route. */
export function seedLegacyMainChatRoute(config: any): Record<string, any> | null {
  const live = readLiveMainChatRoute(config);
  if (!live) return null;
  const storedRoute = String(config?.agent_model_defaults?.main_chat || '').trim();
  const storedReasoning = String(config?.agent_model_default_reasoning?.main_chat || '').trim();
  if (storedRoute === formatMainChatRoute(live) && storedReasoning === String(live.reasoningEffort || '')) return null;
  return mainChatRoutePatch(config, live);
}
