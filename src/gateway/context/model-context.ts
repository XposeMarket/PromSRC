import { getConfig } from '../../config/config';
import { getProviderRuntimeOptions } from '../../providers/provider-registry.js';
import type { ModelInfo } from '../../providers/LLMProvider';

export type TokenizerFamily = 'openai' | 'anthropic' | 'gemini' | 'llama' | 'qwen' | 'heuristic';

export interface ModelContextProfile {
  providerId: string;
  model: string;
  contextWindowTokens: number;
  standardContextWindowTokens?: number;
  maxContextWindowTokens?: number;
  contextSelectionMode?: 'standard' | 'maximum' | 'custom' | 'legacy';
  contextUsageWarning?: string;
  contextAccountId?: string;
  maxOutputTokens: number;
  tokenizer: TokenizerFamily;
  supportsReasoningTokens: boolean;
  reasoningBudgetTokens: number;
  source: 'config_override' | 'provider_metadata' | 'known_table' | 'ollama_num_ctx' | 'fallback';
}

export interface ContextBudget {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  reservedReasoningTokens: number;
  safetyHeadroomTokens: number;
  inputBudgetTokens: number;
  compactionTriggerTokens: number;
  toolContextBudgetTokens: number;
  summaryBudgetTokens: number;
}

type KnownModelProfile = Partial<Omit<ModelContextProfile, 'providerId' | 'model' | 'source'>>;

const KNOWN_MODEL_PROFILES: Array<{ provider: RegExp; model: RegExp; profile: KnownModelProfile }> = [
  // Verified Codex catalog maximum; the default working window is not the maximum.
  // ChatGPT web backend (openai_codex/chatgpt). Without this it fell through to
  // the small default and compacted at ~30k (2026-09-25).
  { provider: /^openai_codex$/i, model: /^chatgpt$/i, profile: { contextWindowTokens: 196000, maxOutputTokens: 32000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(openai|openai_codex)$/i, model: /^gpt-6\.1-terra(?:-|$)/i, profile: { contextWindowTokens: 272000, maxContextWindowTokens: 1050000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^openai_codex$/i, model: /^gpt-6(?:\.1)?-(?:astra|sol|luna)(?:-|$)/i, profile: { contextWindowTokens: 872000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^openai_codex$/i, model: /^gpt-5\.6-(?:sol|terra|luna)(?:-|$)/i, profile: { contextWindowTokens: 872000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^openai$/i, model: /^gpt-6(?:\.1)?-(?:astra|sol|luna)(?:-|$)/i, profile: { contextWindowTokens: 1050000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(openai|openai_codex)$/i, model: /^gpt-5(?:\.\d+)?-chat/i, profile: { contextWindowTokens: 128000, maxOutputTokens: 16384, tokenizer: 'openai', supportsReasoningTokens: false } },
  { provider: /^openai_codex$/i, model: /^gpt-5\.3-codex-spark$/i, profile: { contextWindowTokens: 128000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^openai_codex$/i, model: /^gpt-5/i, profile: { contextWindowTokens: 272000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^openai$/i, model: /^gpt-5\.(?:5|4)(?:-pro)?(?:-\d{4}-\d{2}-\d{2})?$/i, profile: { contextWindowTokens: 1050000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^openai$/i, model: /^gpt-5\.4-(?:mini|nano)(?:-|$)/i, profile: { contextWindowTokens: 400000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^openai$/i, model: /^gpt-5\.\d+(?:-|$)/i, profile: { contextWindowTokens: 400000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^openai$/i, model: /^gpt-5-(?:mini|nano|pro)(?:-|$)/i, profile: { contextWindowTokens: 400000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^openai$/i, model: /^gpt-5(?:$|-)/i, profile: { contextWindowTokens: 400000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(openai|openai_codex)$/i, model: /codex/i, profile: { contextWindowTokens: 272000, maxOutputTokens: 128000, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(openai|openai_codex)$/i, model: /^gpt-4\.1/i, profile: { contextWindowTokens: 1047576, maxOutputTokens: 32768, tokenizer: 'openai', supportsReasoningTokens: false } },
  { provider: /^(openai|openai_codex)$/i, model: /^(gpt-4o|o[134])/i, profile: { contextWindowTokens: 128000, maxOutputTokens: 16384, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(anthropic)$/i, model: /^(claude-fable-5|claude-opus-(?:5|4-(?:6|7|8))|claude-sonnet-(?:5|4-6)|claude-haiku-5)(?:\b|[-_])/i, profile: { contextWindowTokens: 1000000, maxOutputTokens: 128000, tokenizer: 'anthropic', supportsReasoningTokens: true } },
  { provider: /^(anthropic)$/i, model: /^claude-haiku-4-5(?:\b|[-_])/i, profile: { contextWindowTokens: 200000, maxOutputTokens: 64000, tokenizer: 'anthropic', supportsReasoningTokens: true } },
  { provider: /^(anthropic)$/i, model: /^claude-/i, profile: { contextWindowTokens: 200000, maxOutputTokens: 8192, tokenizer: 'anthropic', supportsReasoningTokens: true } },
  { provider: /^(gemini)$/i, model: /^gemini-2\.5-pro/i, profile: { contextWindowTokens: 1000000, maxOutputTokens: 8192, tokenizer: 'gemini', supportsReasoningTokens: true } },
  { provider: /^(gemini)$/i, model: /^gemini-/i, profile: { contextWindowTokens: 1000000, maxOutputTokens: 8192, tokenizer: 'gemini', supportsReasoningTokens: false } },
  { provider: /^(perplexity)$/i, model: /^sonar-(reasoning|deep-research)/i, profile: { contextWindowTokens: 128000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(perplexity)$/i, model: /^sonar/i, profile: { contextWindowTokens: 128000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: false } },
  { provider: /^(xai)$/i, model: /^grok-composer/i, profile: { contextWindowTokens: 200000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(xai)$/i, model: /^(grok-build-0\.1|grok-code-fast(?:-1)?(?:-\d{4})?)$/i, profile: { contextWindowTokens: 256000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(xai)$/i, model: /^grok-4\.5(?:-latest)?$/i, profile: { contextWindowTokens: 500000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(xai)$/i, model: /^grok-4\.6(?:-latest)?$/i, profile: { contextWindowTokens: 500000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(xai)$/i, model: /^grok-4\.7(?:-latest)?$/i, profile: { contextWindowTokens: 500000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(xai)$/i, model: /^(grok-4\.3(?:-latest)?|grok-latest)$/i, profile: { contextWindowTokens: 1000000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(xai)$/i, model: /^grok-4\.20-(?:.*non-reasoning)/i, profile: { contextWindowTokens: 1000000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: false } },
  { provider: /^(xai)$/i, model: /^grok-4\.20(?:$|-)/i, profile: { contextWindowTokens: 1000000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(xai)$/i, model: /^grok/i, profile: { contextWindowTokens: 128000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: false } },
];

function readActiveProviderAndModel(): { providerId: string; model: string } {
  const raw: any = getConfig().getConfig();
  const providerId = String(raw?.llm?.provider || 'ollama').trim() || 'ollama';
  const providerCfg = raw?.llm?.providers?.[providerId] || {};
  const model = String(providerCfg?.model || raw?.models?.primary || getProviderRuntimeOptions(providerId)?.staticModels?.[0] || 'qwen3:4b').trim();
  return { providerId, model };
}

function configuredContextOverride(providerId: string, raw: any = getConfig().getConfig()): Partial<ModelContextProfile> {
  const providerCfg = raw?.llm?.providers?.[providerId] || {};
  const sessionCfg = raw?.session || {};
  const out: Partial<ModelContextProfile> = {};
  const contextRaw = providerCfg.context_window ?? providerCfg.contextWindowTokens ?? sessionCfg.contextWindowTokens;
  const outputRaw = providerCfg.max_output_tokens ?? providerCfg.maxOutputTokens ?? sessionCfg.maxOutputTokens;
  const reasoningRaw = providerCfg.reasoning_budget_tokens ?? providerCfg.thinking_budget ?? sessionCfg.reasoningBudgetTokens;
  if (Number.isFinite(Number(contextRaw)) && Number(contextRaw) > 512) out.contextWindowTokens = Math.floor(Number(contextRaw));
  if (Number.isFinite(Number(outputRaw)) && Number(outputRaw) > 0) out.maxOutputTokens = Math.floor(Number(outputRaw));
  if (Number.isFinite(Number(reasoningRaw)) && Number(reasoningRaw) > 0) out.reasoningBudgetTokens = Math.floor(Number(reasoningRaw));
  if (typeof providerCfg.tokenizer === 'string') out.tokenizer = providerCfg.tokenizer as TokenizerFamily;
  return out;
}

function resolveOllamaNumCtx(raw: any = getConfig().getConfig()): number | null {
  const candidates = [
    raw?.llm?.providers?.ollama?.num_ctx,
    raw?.llm?.num_ctx,
    raw?.ollama?.num_ctx,
    process.env.PROMETHEUS_SESSION_NUM_CTX,
    process.env.PROMETHEUS_CHAT_NUM_CTX,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 512) return Math.floor(n);
  }
  return null;
}

function inferTokenizer(providerId: string, model: string): TokenizerFamily {
  if (/anthropic/i.test(providerId) || /^claude-/i.test(model)) return 'anthropic';
  if (/gemini/i.test(providerId) || /^gemini-/i.test(model)) return 'gemini';
  if (/qwen/i.test(model)) return 'qwen';
  if (/ollama|llama|lm_studio|llama_cpp/i.test(providerId) || /llama|mistral|deepseek/i.test(model)) return 'llama';
  if (/openai|codex|xai|perplexity/i.test(providerId) || /^(gpt|o\d|grok|sonar)/i.test(model)) return 'openai';
  return 'heuristic';
}

function normalizeTokenizer(value: unknown): TokenizerFamily | undefined {
  const raw = String(value || '').trim();
  if (raw === 'openai' || raw === 'anthropic' || raw === 'gemini' || raw === 'llama' || raw === 'qwen' || raw === 'heuristic') return raw;
  return undefined;
}

export function estimateTextTokensForModel(text: unknown, tokenizer: TokenizerFamily = 'heuristic'): number {
  const value = String(text || '');
  if (!value) return 0;
  const codeOrLogDensity = /[{}[\]();]|(^|\n)(stdout|stderr|error|at\s+\w+|diff --git|@@|\d+:\s)/i.test(value);
  const divisor = codeOrLogDensity ? 3.1 : tokenizer === 'qwen' || tokenizer === 'llama' ? 3.4 : 4;
  return Math.max(1, Math.ceil(value.length / divisor));
}

export function estimateMessagesTokensForModel(messages: Array<any> | undefined, profile: Pick<ModelContextProfile, 'tokenizer'>): number {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, msg: any) => {
    const role = estimateTextTokensForModel(msg?.role || '', profile.tokenizer);
    const content = Array.isArray(msg?.content)
      ? msg.content.map((part: any) => part?.type === 'text' ? String(part.text || '') : '[image]').join('\n')
      : String(msg?.content || '');
    const toolCalls = Array.isArray(msg?.tool_calls) ? JSON.stringify(msg.tool_calls) : '';
    return sum + role + estimateTextTokensForModel(content, profile.tokenizer) + estimateTextTokensForModel(toolCalls, profile.tokenizer) + 6;
  }, 0);
}

export function estimateMessageTokenBreakdownForModel(
  messages: Array<any> | undefined,
  profile: Pick<ModelContextProfile, 'tokenizer'>,
): {
  totalTokens: number;
  messageCount: number;
  byRole: Record<string, number>;
  largestMessages: Array<{ index: number; role: string; tokens: number; chars: number; toolName?: string }>;
} {
  if (!Array.isArray(messages)) return { totalTokens: 0, messageCount: 0, byRole: {}, largestMessages: [] };
  const byRole: Record<string, number> = {};
  const largestMessages: Array<{ index: number; role: string; tokens: number; chars: number; toolName?: string }> = [];
  let totalTokens = 0;
  messages.forEach((msg: any, index) => {
    const roleText = String(msg?.role || 'unknown');
    const content = Array.isArray(msg?.content)
      ? msg.content.map((part: any) => part?.type === 'text' ? String(part.text || '') : '[image]').join('\n')
      : String(msg?.content || '');
    const toolCalls = Array.isArray(msg?.tool_calls) ? JSON.stringify(msg.tool_calls) : '';
    const tokens = estimateTextTokensForModel(roleText, profile.tokenizer)
      + estimateTextTokensForModel(content, profile.tokenizer)
      + estimateTextTokensForModel(toolCalls, profile.tokenizer)
      + 6;
    totalTokens += tokens;
    byRole[roleText] = (byRole[roleText] || 0) + tokens;
    largestMessages.push({
      index,
      role: roleText,
      tokens,
      chars: content.length + toolCalls.length,
      toolName: msg?.tool_name ? String(msg.tool_name).slice(0, 80) : undefined,
    });
  });
  largestMessages.sort((a, b) => b.tokens - a.tokens);
  return {
    totalTokens,
    messageCount: messages.length,
    byRole,
    largestMessages: largestMessages.slice(0, 5),
  };
}

const providerContextMetadata = new Map<string, Partial<ModelInfo>>();
function contextExecutionAccount(providerId: string, raw: any, executionAccountId?: string): string {
  return String(executionAccountId || raw?.llm?.providers?.[providerId]?.defaultAccountId || (raw?.llm?.provider === providerId ? raw?.llm?.accountId : '') || 'default');
}
function contextMetadataKey(providerId: string, model: string, raw: any, executionAccountId?: string): string {
  const cfg = raw?.llm?.providers?.[providerId] || {};
  return JSON.stringify([providerId, model, contextExecutionAccount(providerId, raw, executionAccountId), cfg.base_url || cfg.baseUrl || cfg.baseURL || cfg.endpoint || 'default']);
}
/** Capacity metadata is scoped to execution account and provider endpoint. */
export function rememberProviderContextMetadata(providerId: string, info: Partial<ModelInfo> & { name: string }, configSnapshot?: any, executionAccountId?: string): void {
  const raw = configSnapshot || getConfig().getConfig();
  providerContextMetadata.set(contextMetadataKey(providerId, info.name, raw, executionAccountId), { ...info });
}

export function selectModelInfoForContextProfile(models: ModelInfo[] | undefined, model: string): ModelInfo | undefined {
  if (!Array.isArray(models) || !models.length) return undefined;
  const wanted = String(model || '').trim().toLowerCase();
  if (!wanted) return undefined;
  return models.find((m) => String(m?.name || '').trim().toLowerCase() === wanted);
}

/**
 * Resolve a context profile from an explicit route and config snapshot.  Callers
 * executing a long-lived turn should use this form so a later Settings save
 * cannot change that turn's context/token budget mid-flight.
 */
export function resolveModelContextProfile(
  providerId: string,
  model: string,
  providerModelInfo?: Partial<ModelInfo>,
  configSnapshot?: any,
  executionAccountId?: string,
): ModelContextProfile {
  const raw = configSnapshot || getConfig().getConfig();
  providerModelInfo = providerModelInfo || providerContextMetadata.get(contextMetadataKey(providerId, model, raw, executionAccountId));
  const override = configuredContextOverride(providerId, raw);
  // Some catalogs expose both the default working window and a supported maximum.
  const metadata: any = providerModelInfo;
  const metadataContext = [metadata?.maxContextWindowTokens, metadata?.maxSupportedContextWindowTokens,
    metadata?.max_context_window, metadata?.max_supported_context_window,
    metadata?.contextWindowTokens, metadata?.context_window]
    .map(Number).find(value => Number.isFinite(value) && value > 512) ?? NaN;
  const metadataOutput = Number(providerModelInfo?.maxOutputTokens);
  let source: ModelContextProfile['source'] = 'fallback';
  let known: KnownModelProfile = {};
  for (const entry of KNOWN_MODEL_PROFILES) {
    if (entry.provider.test(providerId) && entry.model.test(model)) {
      known = entry.profile;
      source = 'known_table';
      break;
    }
  }
  const ollamaCtx = providerId === 'ollama' ? resolveOllamaNumCtx(raw) : null;
  if (ollamaCtx) source = 'ollama_num_ctx';
  if (Number.isFinite(metadataContext) && metadataContext > 512) source = 'provider_metadata';
  if (override.contextWindowTokens) source = 'config_override';
  const supportedContextWindowTokens = (Number.isFinite(metadataContext) && metadataContext > 512 ? Math.floor(metadataContext) : undefined)
    || ollamaCtx
    || known.contextWindowTokens
    || (/ollama|llama_cpp|lm_studio/i.test(providerId) ? 8192 : 32768);
  const maxContextWindowTokens = Math.max(supportedContextWindowTokens, Number(known.maxContextWindowTokens) || 0, Number(metadata?.maxContextWindowTokens || metadata?.max_context_window) || 0);
  const standardMetadata = Number(metadata?.defaultContextWindowTokens || metadata?.contextWindowTokens || metadata?.context_window);
  const standardContextWindowTokens = Math.min(maxContextWindowTokens,
    Number.isFinite(standardMetadata) && standardMetadata > 512 ? Math.floor(standardMetadata)
      : providerId === 'openai_codex' && /^gpt-(?:6|5\.(?:4|5|6))/.test(model) ? Math.min(272000, maxContextWindowTokens)
      : maxContextWindowTokens);
  // Haiku 5.5 follows the other 1M Claude models (standard = full window). Its API
  // long-prompt tier above 100k is surfaced in contextUsageWarning, and users who
  // want to stay under it can pick a custom 100k budget.
  const usageSafeStandard = providerId === 'openai' && /^gpt-(?:6|5\.(?:4|5|6))(?:[.-]|$)/.test(model) && maxContextWindowTokens > 400000 ? Math.min(272000, standardContextWindowTokens)
    : standardContextWindowTokens;
  const accountId = contextExecutionAccount(providerId, raw, executionAccountId);
  const selection = raw?.session?.contextSelections?.[`${providerId}/${model}/${accountId}`];
  const contextSelectionMode: ModelContextProfile['contextSelectionMode'] = selection?.mode || (override.contextWindowTokens ? 'legacy' : 'standard');
  const extendedAccepted = selection?.extendedAcknowledged === true;
  const requestedRaw = selection?.mode === 'maximum' ? maxContextWindowTokens : selection?.mode === 'custom' ? Number(selection.tokens) : usageSafeStandard;
  const requested = Number.isFinite(requestedRaw) ? requestedRaw : usageSafeStandard;
  const contextWindowTokens = selection
    ? Math.max(1024, Math.min(maxContextWindowTokens, extendedAccepted ? requested : Math.min(requested, usageSafeStandard)))
    : override.contextWindowTokens || usageSafeStandard;
  const contextUsageWarning = providerId === 'openai_codex'
    ? 'Extended context can consume more subscription allowance. OpenAI documents 2x usage above the standard 272k window for GPT-5.4; the exact multiplier for other models is not verified. This is a local request budget, not a billing setting.'
    : providerId === 'anthropic'
      ? /^claude-haiku-5-5(?:$|-)/.test(model)
        ? 'Haiku 5.5 has a 1M window. On API keys, prompts over 100,000 tokens use a 5x pricing tier (input, output and cache); pick Custom 100k to stay under it. Claude subscription allowance is separate from API pricing.'
        : 'Current Claude 1M models, including Opus 5.5, use standard API rates throughout the window (Haiku 5.5 is the exception). More tokens still use more allowance. Claude subscription limits are account-specific, not API prices.'
      : providerId === 'openai' && /^gpt-(?:6|5\.(?:4|5|6))/.test(model)
        ? 'OpenAI API long-context categories can cost 2x input/cache and 1.5x output. GPT-5.4 documents the boundary above 272k input; the exact GPT-6 boundary is not verified here. These API tariffs are not Codex subscription usage. Check current pricing before large requests.'
      : 'Larger requests use more input tokens. Long-context pricing and availability depend on this provider, model and account; no universal surcharge is assumed.';
  const maxOutputTokens = override.maxOutputTokens
    || (Number.isFinite(metadataOutput) && metadataOutput > 0 ? Math.floor(metadataOutput) : undefined)
    || known.maxOutputTokens
    || Math.min(8192, Math.max(1024, Math.floor(contextWindowTokens * 0.15)));
  const tokenizer = override.tokenizer || normalizeTokenizer(providerModelInfo?.tokenizer) || known.tokenizer || inferTokenizer(providerId, model);
  const supportsReasoningTokens = providerModelInfo?.supportsReasoningTokens ?? (typeof known.supportsReasoningTokens === 'boolean'
    ? known.supportsReasoningTokens
    : /^(openai|openai_codex|anthropic|xai)$/i.test(providerId));
  const reasoningBudgetTokens = override.reasoningBudgetTokens || (supportsReasoningTokens ? Math.min(10000, Math.floor(contextWindowTokens * 0.08)) : 0);
  return {
    providerId,
    model,
    contextWindowTokens,
    standardContextWindowTokens: usageSafeStandard,
    maxContextWindowTokens,
    contextSelectionMode,
    contextUsageWarning,
    contextAccountId: accountId,
    maxOutputTokens,
    tokenizer,
    supportsReasoningTokens,
    reasoningBudgetTokens,
    source,
  };
}

export function resolveCompactionThreshold(value: unknown, mode?: unknown): number | 'auto' {
  // Authorized legacy-default migration; manual marker preserves an explicit 70% choice.
  if (mode === 'auto' || (mode !== 'manual' && Number(value) === 0.7)) return 'auto';
  if (value === 'auto' || value === undefined || value === null) return 'auto';
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0.4 && numeric <= 0.95 ? numeric : 'auto';
}

export function resolveCompactionTriggerTokens(windowTokens: number, inputBudgetTokens: number, threshold: unknown = 'auto', mode?: unknown): number {
  const policy = resolveCompactionThreshold(threshold, mode);
  return policy === 'auto' ? inputBudgetTokens : Math.min(inputBudgetTokens, Math.floor(windowTokens * policy));
}

export function buildContextBudget(profile: ModelContextProfile, sessionPolicy?: { compactionThreshold?: unknown; compactionThresholdMode?: unknown }): ContextBudget {
  // One estimation margin only. Output/reasoning remain genuine generation reserves.
  const safetyHeadroomTokens = Math.min(Math.floor(profile.contextWindowTokens * 0.05), 4096);
  const reservedOutputTokens = Math.min(
    profile.maxOutputTokens || 4096,
    Math.floor(profile.contextWindowTokens * 0.5),
    Math.max(4096, Math.min(32768, Math.floor(profile.contextWindowTokens * 0.08))),
  );
  const reservedReasoningTokens = profile.supportsReasoningTokens ? Math.min(profile.reasoningBudgetTokens || 0, Math.floor(profile.contextWindowTokens * 0.12)) : 0;
  const inputBudgetTokens = Math.max(1, profile.contextWindowTokens - reservedOutputTokens - reservedReasoningTokens - safetyHeadroomTokens);
  const policy = sessionPolicy ?? (getConfig().getConfig() as any)?.session;
  return {
    contextWindowTokens: profile.contextWindowTokens,
    reservedOutputTokens,
    reservedReasoningTokens,
    safetyHeadroomTokens,
    inputBudgetTokens,
    compactionTriggerTokens: resolveCompactionTriggerTokens(profile.contextWindowTokens, inputBudgetTokens, policy?.compactionThreshold, policy?.compactionThresholdMode),
    toolContextBudgetTokens: Math.max(600, Math.floor(inputBudgetTokens * 0.16)),
    summaryBudgetTokens: Math.max(700, Math.floor(inputBudgetTokens * 0.08)),
  };
}

export function resolveActiveModelContextProfile(providerModelInfo?: Partial<ModelInfo>): ModelContextProfile {
  const { providerId, model } = readActiveProviderAndModel();
  return resolveModelContextProfile(providerId, model, providerModelInfo);
}
