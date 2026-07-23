import { getConfig } from '../../config/config';
import { buildProviderForLLM, getProviderRuntimeIdentity } from '../../providers/factory';
import type { LLMProvider } from '../../providers/LLMProvider';
import { normalizeReasoningEffort, type ReasoningEffort } from '../../providers/reasoning-capabilities';
import { buildContextBudget, resolveModelContextProfile, type ContextBudget, type ModelContextProfile } from '../context/model-context';

export interface TurnRouteSnapshot {
  readonly providerId: string;
  readonly model: string;
  readonly accountId?: string;
  readonly reasoningEffort?: ReasoningEffort;
  /** A private immutable config copy used to create this turn's client. */
  readonly llm: any;
  /** The exact provider/client instance used for every ordinary model call. */
  readonly provider: LLMProvider;
  readonly contextProfile: Readonly<ModelContextProfile>;
  readonly contextBudget: Readonly<ContextBudget>;
}

/**
 * A resolved route can come from Main Chat today and from a future thread pin
 * later.  This module deliberately does not persist or select thread pins.
 */
export interface ResolvedTurnRouteSource {
  config?: any;
  providerId?: string;
  model?: string;
  reasoningEffort?: unknown;
  accountId?: string;
}

function cloneAndFreeze<T>(value: T): T {
  const clone = value === undefined ? value : JSON.parse(JSON.stringify(value));
  const freeze = (item: any): any => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item;
    Object.freeze(item);
    for (const child of Object.values(item)) freeze(child);
    return item;
  };
  return freeze(clone);
}

function resolveModel(raw: any, providerId: string, requestedModel?: string): string {
  return String(requestedModel || raw?.llm?.providers?.[providerId]?.model || raw?.models?.primary || '').trim();
}

function resolveAccount(raw: any, providerId: string, sameProviderAccount?: string): string | undefined {
  const providerCfg = raw?.llm?.providers?.[providerId] || {};
  const defaultAccountId = String(providerCfg?.defaultAccountId || '').trim();
  // A top-level account is route-owned only when it already belongs to this provider.
  return defaultAccountId || (String(raw?.llm?.provider || '').trim() === providerId ? String(sameProviderAccount || raw?.llm?.accountId || '').trim() : '') || undefined;
}

export function captureTurnRouteSnapshot(
  input: ResolvedTurnRouteSource = {},
  dependencies?: { buildProvider?: (llm: any) => LLMProvider },
): TurnRouteSnapshot {
  const raw = input.config || getConfig().getConfig();
  const providerId = String(input.providerId || raw?.llm?.provider || 'ollama').trim() || 'ollama';
  const model = resolveModel(raw, providerId, input.model);
  const requestedAccountId = String(input.accountId || '').trim();
  const accountId = requestedAccountId || resolveAccount(raw, providerId);
  const llm = cloneAndFreeze({
    ...(raw?.llm || {}),
    provider: providerId,
    ...(accountId ? { accountId } : { accountId: undefined }),
  });
  const provider = (dependencies?.buildProvider || buildProviderForLLM)(llm);
  const identity = getProviderRuntimeIdentity(provider);
  const configuredReasoning = input.reasoningEffort === undefined
    ? raw?.agent_model_default_reasoning?.main_chat
    : input.reasoningEffort;
  const reasoningEffort = normalizeReasoningEffort(providerId, model, configuredReasoning);
  const contextProfile = cloneAndFreeze(resolveModelContextProfile(providerId, model, undefined, raw));
  const contextBudget = cloneAndFreeze(buildContextBudget(contextProfile));
  return Object.freeze({
    providerId,
    model,
    accountId: identity?.accountId || accountId,
    reasoningEffort,
    llm,
    provider,
    contextProfile,
    contextBudget,
  });
}

/** Capture the live main route at admission, before any async work begins. */
export function captureMainChatTurnRouteSnapshot(): TurnRouteSnapshot {
  const raw = getConfig().getConfig() as any;
  return captureTurnRouteSnapshot({
    config: raw,
    providerId: raw?.llm?.provider,
    model: raw?.llm?.providers?.[raw?.llm?.provider]?.model,
    reasoningEffort: raw?.agent_model_default_reasoning?.main_chat,
  });
}
