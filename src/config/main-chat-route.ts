/**
 * Canonical main-chat routing helpers.
 *
 * `llm.provider` + its provider config are the live route.  The main_chat
 * default is deliberately kept as a durable mirror so templates and older
 * callers cannot make the UI describe a different route from the live chat.
 */
export type MainChatRoute = {
  provider: string;
  model: string;
  reasoningEffort?: string;
};

export function readLiveMainChatRoute(config: any): MainChatRoute | null {
  const provider = String(config?.llm?.provider || '').trim();
  const providerConfig = provider ? config?.llm?.providers?.[provider] : null;
  const model = String(providerConfig?.model || config?.models?.primary || '').trim();
  if (!provider || !model) return null;
  const reasoningEffort = String(providerConfig?.reasoning_effort || '').trim();
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
  const targetAccountId = String(nextProvider.defaultAccountId || '').trim();
  const retainCurrentAccountId = route.provider === String(currentLlm.provider || '').trim();
  const accountId = targetAccountId || (retainCurrentAccountId ? String(currentLlm.accountId || '').trim() : '');
  const effectiveReasoning = route.reasoningEffort !== undefined
    ? route.reasoningEffort
    : String(currentProvider.reasoning_effort || '').trim();
  if (route.reasoningEffort !== undefined) {
    if (route.reasoningEffort) nextProvider.reasoning_effort = route.reasoningEffort;
    else delete nextProvider.reasoning_effort;
  }
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
  const prior = config?.llm?.providers?.[live.provider] || {};
  if (Object.prototype.hasOwnProperty.call(prior, 'reasoning_effort')) selected.reasoning_effort = prior.reasoning_effort;
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
