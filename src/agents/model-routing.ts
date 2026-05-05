import { isKnownProviderId } from '../providers/provider-registry.js';

export type ProviderModelRef = {
  providerId: string;
  model: string;
};

export function parseProviderModelRef(ref?: string): ProviderModelRef | null {
  const raw = String(ref || '').trim();
  if (!raw || !raw.includes('/')) return null;
  const slashIdx = raw.indexOf('/');
  if (slashIdx <= 0) return null;
  const providerId = raw.slice(0, slashIdx).trim();
  const model = raw.slice(slashIdx + 1).trim();
  if (!providerId || !model || !isKnownProviderId(providerId)) return null;
  return { providerId, model };
}

export function getPrimaryModelRef(cfg: any): string {
  const provider = String(cfg?.llm?.provider || '').trim();
  const providerModel = provider ? String(cfg?.llm?.providers?.[provider]?.model || '').trim() : '';
  const model = providerModel || String(cfg?.models?.primary || '').trim();
  return provider && model ? `${provider}/${model}` : model;
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
      return ['background_agent', 'background_task'];
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
