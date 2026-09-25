import { isKnownProviderId } from '../providers/provider-registry.js';
import { normalizeReasoningEffort } from '../providers/reasoning-capabilities.js';

export type ProviderModelRef = {
  providerId: string;
  model: string;
};

export type ResolvedAgentRouting = {
  model: string;
  source: string;
  reasoningEffort?: string;
  reasoningSource?: string;
  providerId?: string;
  modelName?: string;
};

const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
  'fable-5.1': 'claude-fable-5-1',
  'fable-5-1': 'claude-fable-5-1',
  'claude-fable-5.1': 'claude-fable-5-1',
  'fable-5': 'claude-fable-5',
  'claude-fable-5.0': 'claude-fable-5',
  'opus-5.5': 'claude-opus-5-5',
  'opus-5-5': 'claude-opus-5-5',
  'claude-opus-5.5': 'claude-opus-5-5',
  'opus-5': 'claude-opus-5',
  'opus-5.0': 'claude-opus-5',
  'claude-opus-5.0': 'claude-opus-5',
  'opus-4.8': 'claude-opus-4-8',
  'opus-4-8': 'claude-opus-4-8',
  'claude-opus-4.8': 'claude-opus-4-8',
  'opus-4.7': 'claude-opus-4-7',
  'opus-4-7': 'claude-opus-4-7',
  'claude-opus-4.7': 'claude-opus-4-7',
  'haiku-4.5': 'claude-haiku-4-5-20251001',
  'haiku-4-5': 'claude-haiku-4-5-20251001',
  'claude-haiku-4.5': 'claude-haiku-4-5-20251001',
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
  // Sonnet 4.5 shipped 2025-09-29; the "-20250514" suffix was a Sonnet 4 date
  // that Anthropic 404s when combined with the 4.5 slug. Use the dated
  // snapshot Anthropic actually publishes.
  'sonnet-4.5': 'claude-sonnet-4-5-20250929',
  'sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'claude-sonnet-4.5': 'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-5-20250514': 'claude-sonnet-4-5-20250929',
};

const OPENAI_CODEX_MODEL_ALIASES: Record<string, string> = {
  sol: 'gpt-5.6-sol',
  terra: 'gpt-5.6-terra',
  luna: 'gpt-5.6-luna',
  astra: 'gpt-6-astra',
  'sol-6': 'gpt-6-sol',
  'luna-6': 'gpt-6-luna',
  'gpt-6-sol': 'gpt-6-sol',
  'gpt-6-luna': 'gpt-6-luna',
};

export function normalizeProviderModel(providerId: string, model: string): string {
  const normalizedProviderId = String(providerId || '').trim().toLowerCase();
  const rawModel = String(model || '').trim();
  if (!rawModel) return rawModel;

  if (normalizedProviderId === 'anthropic') {
    return ANTHROPIC_MODEL_ALIASES[rawModel.toLowerCase()] || rawModel;
  }
  if (normalizedProviderId === 'openai_codex') {
    return OPENAI_CODEX_MODEL_ALIASES[rawModel.toLowerCase()] || rawModel;
  }

  return rawModel;
}

/**
 * Infer the provider for a bare model id (no "provider/" prefix) only when the
 * id is unambiguous. Agents often pass `gpt-5.6-sol` or `opus-4.8` to spawn tools;
 * without a provider the reasoning-effort gate had nothing to check against and
 * failed with a misleading "Reasoning effort X is not supported". Ambiguous ids
 * (e.g. `gpt-5.5`, which both openai and openai_codex serve) return null.
 */
export function inferProviderForBareModel(model?: string): string | null {
  const raw = String(model || '').trim().toLowerCase();
  if (!raw || raw.includes('/')) return null;
  if (OPENAI_CODEX_MODEL_ALIASES[raw]) return 'openai_codex';
  if (/^gpt-(?:5\.6|6)-(?:sol|luna|terra|astra)(?:$|[-.])/.test(raw)) return 'openai_codex';
  if (ANTHROPIC_MODEL_ALIASES[raw]) return 'anthropic';
  if (/^claude-/.test(raw)) return 'anthropic';
  return null;
}

export function parseProviderModelRef(ref?: string): ProviderModelRef | null {
  const raw = String(ref || '').trim();
  if (!raw || !raw.includes('/')) return null;
  const slashIdx = raw.indexOf('/');
  if (slashIdx <= 0) return null;
  const providerId = raw.slice(0, slashIdx).trim();
  const model = normalizeProviderModel(providerId, raw.slice(slashIdx + 1).trim());
  if (!providerId || !model || !isKnownProviderId(providerId)) return null;
  return { providerId, model };
}

export function getPrimaryModelRef(cfg: any): string {
  const provider = String(cfg?.llm?.provider || '').trim();
  const providerModel = provider ? String(cfg?.llm?.providers?.[provider]?.model || '').trim() : '';
  if (provider && providerModel) return `${provider}/${normalizeProviderModel(provider, providerModel)}`;

  // `agent_model_defaults.main_chat` is the durable Settings route mirror.
  // Older installs can have this value even when llm.providers[provider].model
  // has not been backfilled yet, so it must participate in global inheritance.
  const mainChatDefault = String(cfg?.agent_model_defaults?.main_chat || '').trim();
  if (parseProviderModelRef(mainChatDefault)) return mainChatDefault;

  const model = providerModel || String(cfg?.models?.primary || '').trim();
  return provider && model ? `${provider}/${normalizeProviderModel(provider, model)}` : model;
}

export function inferAgentModelDefaultType(
  agent: any,
  opts?: {
    agentType?: string;
    isManager?: boolean;
    isTeamMember?: boolean;
  },
): string {
  const explicitType = String(opts?.agentType || '').trim();
  if (explicitType) return explicitType;
  if (String(agent?.id || '').trim() === 'main') return 'main_chat';
  if (opts?.isManager || agent?.isTeamManager === true) return 'team_manager';
  if (opts?.isTeamMember) return 'team_subagent';
  return 'subagent';
}

export function getAgentModelDefaultKeys(
  agent: any,
  opts?: {
    agentType?: string;
    isManager?: boolean;
    isTeamMember?: boolean;
  },
): string[] {
  const typeKey = inferAgentModelDefaultType(agent, opts);
  const roleType = String(agent?.roleType || '').trim().toLowerCase();
  const roleKey = roleType ? `subagent_${roleType}` : '';

  switch (typeKey) {
    case 'team_manager':
      return ['team_manager', 'manager'];
    case 'manager':
      return ['manager'];
    case 'team_subagent':
      return [...(roleKey ? [roleKey] : []), 'team_subagent', 'subagent'];
    case 'subagent':
      return [...(roleKey ? [roleKey] : []), 'subagent'];
    case 'background_agent':
      return ['main_chat'];
    default:
      return [typeKey];
  }
}

export function resolveConfiguredAgentModel(
  cfg: any,
  agent: any,
  opts?: {
    explicitModel?: string;
    agentType?: string;
    isManager?: boolean;
    isTeamMember?: boolean;
    fallbackToPrimary?: boolean;
  },
): { model: string; source: string } {
  const explicit = String(opts?.explicitModel ?? agent?.model ?? '').trim();
  if (explicit) return { model: explicit, source: 'agent_override' };

  const defaults = cfg?.agent_model_defaults || {};
  const defaultKeys = getAgentModelDefaultKeys(agent, opts);
  for (const key of defaultKeys) {
    const defaultModel = String(defaults?.[key] || '').trim();
    if (defaultModel) return { model: defaultModel, source: `agent_model_defaults.${key}` };
  }

  if (opts?.fallbackToPrimary === false) {
    return { model: '', source: 'unset' };
  }

  return { model: getPrimaryModelRef(cfg), source: 'primary' };
}

function resolveModelRoute(cfg: any, modelRef: string): ProviderModelRef | null {
  const parsed = parseProviderModelRef(modelRef);
  if (parsed) return parsed;
  const model = String(modelRef || '').trim();
  const provider = String(cfg?.llm?.provider || '').trim();
  return provider && model
    ? { providerId: provider, model: normalizeProviderModel(provider, model) }
    : null;
}

function routeMatches(left: string, right: string): boolean {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

/**
 * Resolve the complete route used by a subagent, including inherited
 * reasoning. Empty agent fields intentionally remain inheritance-only; this
 * function never turns an inherited Settings route into a per-agent override.
 */
export function resolveConfiguredAgentRouting(
  cfg: any,
  agent: any,
  opts?: {
    explicitModel?: string;
    explicitReasoning?: string;
    agentType?: string;
    isManager?: boolean;
    isTeamMember?: boolean;
    fallbackToPrimary?: boolean;
  },
): ResolvedAgentRouting {
  const modelResolution = resolveConfiguredAgentModel(cfg, agent, opts);
  const model = String(modelResolution.model || '').trim();
  const route = resolveModelRoute(cfg, model);
  const providerId = route?.providerId || '';
  const modelName = route?.model || '';
  const explicitReasoning = String(opts?.explicitReasoning ?? agent?.reasoning_effort ?? '').trim().toLowerCase();

  if (explicitReasoning && providerId && modelName) {
    const normalized = normalizeReasoningEffort(providerId, modelName, explicitReasoning);
    if (normalized) {
      return {
        ...modelResolution,
        reasoningEffort: normalized,
        reasoningSource: 'agent_override',
        providerId,
        modelName,
      };
    }
  }

  const defaults = cfg?.agent_model_defaults || {};
  const reasoning = cfg?.agent_model_default_reasoning || {};
  const defaultKeys = Array.from(new Set([
    ...getAgentModelDefaultKeys(agent, opts),
    'main_chat',
  ]));
  const activeRoute = providerId && modelName ? `${providerId}/${modelName}` : '';
  const matchingKey = activeRoute
    ? defaultKeys.find((key) => routeMatches(defaults[key], activeRoute) && String(reasoning[key] || '').trim())
    : undefined;
  const configuredReasoning = matchingKey
    ? String(reasoning[matchingKey] || '').trim().toLowerCase()
    : providerId
      ? String(cfg?.llm?.providers?.[providerId]?.reasoning_effort || '').trim().toLowerCase()
      : '';
  const normalizedInherited = providerId && modelName && configuredReasoning
    ? normalizeReasoningEffort(providerId, modelName, configuredReasoning)
    : undefined;

  return {
    ...modelResolution,
    ...(normalizedInherited ? {
      reasoningEffort: normalizedInherited,
      reasoningSource: matchingKey ? `agent_model_default_reasoning.${matchingKey}` : `llm.providers.${providerId}`,
    } : {}),
    ...(providerId ? { providerId } : {}),
    ...(modelName ? { modelName } : {}),
  };
}
