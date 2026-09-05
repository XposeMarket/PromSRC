// Public, selectable reasoning levels. `none` and `minimal` remain accepted
// only as legacy input aliases and are normalized to `low`; they must never
// be advertised as model capabilities or selector options.
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface ReasoningCapability {
  efforts: ReasoningEffort[];
  defaultEffort?: ReasoningEffort;
  thinkingMode?: 'adaptive' | 'manual';
}

const MODEL_CAPABILITY_PROVIDERS = new Set(['openai', 'openai_codex', 'anthropic', 'perplexity', 'xai']);

const OPENAI_MODERN: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const OPENAI_56: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_ULTRA: ReasoningEffort[] = [...OPENAI_56, 'ultra'];
const OPENAI_GPT5: ReasoningEffort[] = ['low', 'medium', 'high'];
const OPENAI_O_SERIES: ReasoningEffort[] = ['low', 'medium', 'high'];
const CLAUDE_BASE: ReasoningEffort[] = ['low', 'medium', 'high'];

function slug(model: string): string {
  const value = String(model || '').trim().toLowerCase();
  return value.includes('/') ? value.split('/').filter(Boolean).pop() || value : value;
}

/**
 * Providers whose model settings are governed by this capability policy.
 *
 * `ultra` remains a valid internal Ollama thinking hint. It is also a
 * supported effort for Codex GPT-5.6 Sol/Terra, but not for GPT-6 Astra,
 * GPT-5.6 Luna (or the direct OpenAI provider). Callers that persist hosted
 * provider settings should use this predicate before treating a value as
 * invalid so custom/local providers can keep their own vocabulary.
 */
export function hasReasoningCapabilityPolicy(provider: string): boolean {
  return MODEL_CAPABILITY_PROVIDERS.has(String(provider || '').trim().toLowerCase());
}

/** Documentation-driven provider/model reasoning capability policy. */
export function getReasoningCapability(provider: string, model: string): ReasoningCapability {
  const id = String(provider || '').trim().toLowerCase();
  const name = slug(model);

  if (id === 'openai_codex') {
    if (/^gpt-6-astra(?:-|$)/.test(name)) return { efforts: [...OPENAI_56], defaultEffort: 'low' };
    // Codex exposes model-specific effort levels. Luna is the fast 5.6
    // variant and does not advertise Ultra; Sol/Terra do.
    if (/^gpt-5\.6-(?:sol|terra)(?:-|$)/.test(name)) return { efforts: [...CODEX_ULTRA], defaultEffort: 'medium' };
    if (/^gpt-5\.6(?:-luna)?(?:-|$)/.test(name)) return { efforts: [...OPENAI_56], defaultEffort: 'medium' };
    if (/^gpt-5\.5(?:-|$)/.test(name)) return { efforts: [...OPENAI_MODERN], defaultEffort: 'medium' };
    if (/^gpt-5\.(?:[234])(?:-|$)/.test(name)) return { efforts: [...OPENAI_MODERN], defaultEffort: 'low' };
    if (/^gpt-5(?:-(?:mini|nano|pro))?(?:-|$)/.test(name)) return { efforts: [...OPENAI_GPT5], defaultEffort: 'medium' };
    if (/^o(?:1|3|4-mini)(?:-|$)/.test(name)) return { efforts: [...OPENAI_O_SERIES], defaultEffort: 'medium' };
    return { efforts: [] };
  }

  if (id === 'openai') {
    if (/^gpt-6-astra(?:-|$)/.test(name)) return { efforts: [...OPENAI_56], defaultEffort: 'low' };
    if (/^gpt-5\.6(?:-(?:sol|terra|luna))?(?:-|$)/.test(name)) return { efforts: [...OPENAI_56], defaultEffort: 'medium' };
    if (/^gpt-5\.5(?:-|$)/.test(name)) return { efforts: [...OPENAI_MODERN], defaultEffort: 'medium' };
    if (/^gpt-5\.(?:[234])(?:-|$)/.test(name)) return { efforts: [...OPENAI_MODERN], defaultEffort: 'low' };
    if (/^gpt-5(?:-(?:mini|nano|pro))?(?:-|$)/.test(name)) return { efforts: [...OPENAI_GPT5], defaultEffort: 'medium' };
    if (/^o(?:1|3|4-mini)(?:-|$)/.test(name)) return { efforts: [...OPENAI_O_SERIES], defaultEffort: 'medium' };
    return { efforts: [] };
  }

  if (id === 'anthropic') {
    const effortCapable = /^claude-(?:fable-5|mythos-(?:5|preview)|opus-4-(?:5|6|7|8)|sonnet-(?:5|4-6))(?:-|$)/.test(name);
    if (!effortCapable) {
      const manual = /^claude-(?:haiku-4-5|sonnet-4-5|opus-4-[01])(?:-|$)/.test(name);
      return { efforts: [], thinkingMode: manual ? 'manual' : undefined };
    }
    const efforts = [...CLAUDE_BASE];
    if (/^claude-(?:fable-5|mythos-5|opus-4-(?:7|8)|sonnet-5)(?:-|$)/.test(name)) efforts.push('xhigh');
    if (!/^claude-opus-4-5(?:-|$)/.test(name)) efforts.push('max');
    const thinkingMode = /^claude-opus-4-5(?:-|$)/.test(name) ? 'manual' : 'adaptive';
    return { efforts, defaultEffort: 'high', thinkingMode };
  }

  if (id === 'perplexity') return { efforts: ['low', 'medium', 'high'] };
  if (id === 'xai') {
    return {
      efforts: /^grok-4\.20-multi-agent(?:-|$)/.test(name)
        ? ['low', 'medium', 'high', 'xhigh']
        : ['low', 'medium', 'high'],
    };
  }

  return { efforts: [] };
}

export function normalizeReasoningEffort(provider: string, model: string, value: unknown): ReasoningEffort | undefined {
  const rawValue = String(value || '').trim().toLowerCase().replace(/^extra[-_ ]high$/, 'xhigh');
  // Older saved routes used these as a disabled/minimal level. Keep them
  // recoverable without allowing either value back into the public contract.
  const raw = (rawValue === 'none' || rawValue === 'minimal' ? 'low' : rawValue) as ReasoningEffort;
  if (!raw) return undefined;
  const capability = getReasoningCapability(provider, model);
  return capability.efforts.includes(raw) ? raw : undefined;
}

export function supportsFastSpeed(provider: string, model: string): boolean {
  const id = String(provider || '').trim().toLowerCase();
  const name = slug(model);
  if (id === 'anthropic') return /^claude-opus-4-(?:7|8)(?:-|$)/.test(name);
  if (id === 'openai' || id === 'openai_codex') {
    return /^(?:gpt-6-astra|gpt-5\.6(?:-(?:sol|terra|luna))?|gpt-5\.5|gpt-5\.4(?:-mini)?|gpt-5\.2|gpt-5\.1|gpt-5(?:-mini)?|gpt-4\.1(?:-mini|-nano)?|gpt-4o(?:-mini)?|o3|o4-mini)(?:-\d{4}.*|$)/.test(name);
  }
  return false;
}

export function normalizeSpeed(provider: string, model: string, value: unknown): 'standard' | 'fast' {
  return String(value || '').trim().toLowerCase() === 'fast' && supportsFastSpeed(provider, model) ? 'fast' : 'standard';
}
