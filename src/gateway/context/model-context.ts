import { getConfig } from '../../config/config';
import { getProviderRuntimeOptions } from '../../providers/provider-registry.js';
import type { ModelInfo } from '../../providers/LLMProvider';

export type TokenizerFamily = 'openai' | 'anthropic' | 'gemini' | 'llama' | 'qwen' | 'heuristic';

export interface ModelContextProfile {
  providerId: string;
  model: string;
  contextWindowTokens: number;
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
  { provider: /^(anthropic)$/i, model: /^(claude-fable-5|claude-opus-4-(?:6|7|8)|claude-sonnet-(?:5|4-6))(?:\b|[-_])/i, profile: { contextWindowTokens: 1000000, maxOutputTokens: 128000, tokenizer: 'anthropic', supportsReasoningTokens: true } },
  { provider: /^(anthropic)$/i, model: /^claude-haiku-4-5(?:\b|[-_])/i, profile: { contextWindowTokens: 200000, maxOutputTokens: 64000, tokenizer: 'anthropic', supportsReasoningTokens: true } },
  { provider: /^(anthropic)$/i, model: /^claude-/i, profile: { contextWindowTokens: 200000, maxOutputTokens: 8192, tokenizer: 'anthropic', supportsReasoningTokens: true } },
  { provider: /^(gemini)$/i, model: /^gemini-2\.5-pro/i, profile: { contextWindowTokens: 1000000, maxOutputTokens: 8192, tokenizer: 'gemini', supportsReasoningTokens: true } },
  { provider: /^(gemini)$/i, model: /^gemini-/i, profile: { contextWindowTokens: 1000000, maxOutputTokens: 8192, tokenizer: 'gemini', supportsReasoningTokens: false } },
  { provider: /^(perplexity)$/i, model: /^sonar-(reasoning|deep-research)/i, profile: { contextWindowTokens: 128000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(perplexity)$/i, model: /^sonar/i, profile: { contextWindowTokens: 128000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: false } },
  { provider: /^(xai)$/i, model: /^grok-composer/i, profile: { contextWindowTokens: 200000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: true } },
  { provider: /^(xai)$/i, model: /^(grok-build-0\.1|grok-code-fast(?:-1)?(?:-\d{4})?)$/i, profile: { contextWindowTokens: 256000, maxOutputTokens: 8192, tokenizer: 'openai', supportsReasoningTokens: true } },
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

function configuredContextOverride(providerId: string): Partial<ModelContextProfile> {
  const raw: any = getConfig().getConfig();
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

function resolveOllamaNumCtx(): number | null {
  const raw: any = getConfig().getConfig();
  const candidates = [
    raw?.llm?.providers?.ollama?.num_ctx,
    raw?.llm?.num_ctx,
    raw?.ollama?.num_ctx,
    process.env.LOCALCLAW_SESSION_NUM_CTX,
    process.env.LOCALCLAW_CHAT_NUM_CTX,
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

export function selectModelInfoForContextProfile(models: ModelInfo[] | undefined, model: string): ModelInfo | undefined {
  if (!Array.isArray(models) || !models.length) return undefined;
  const wanted = String(model || '').trim().toLowerCase();
  if (!wanted) return undefined;
  return models.find((m) => String(m?.name || '').trim().toLowerCase() === wanted);
}

export function resolveActiveModelContextProfile(providerModelInfo?: Partial<ModelInfo>): ModelContextProfile {
  const { providerId, model } = readActiveProviderAndModel();
  const override = configuredContextOverride(providerId);
  const metadataContext = Number(providerModelInfo?.contextWindowTokens);
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
  const ollamaCtx = providerId === 'ollama' ? resolveOllamaNumCtx() : null;
  if (ollamaCtx) source = 'ollama_num_ctx';
  if (Number.isFinite(metadataContext) && metadataContext > 512) source = 'provider_metadata';
  if (override.contextWindowTokens) source = 'config_override';
  const contextWindowTokens = override.contextWindowTokens
    || (Number.isFinite(metadataContext) && metadataContext > 512 ? Math.floor(metadataContext) : undefined)
    || ollamaCtx
    || known.contextWindowTokens
    || (/ollama|llama_cpp|lm_studio/i.test(providerId) ? 8192 : 32768);
  const maxOutputTokens = override.maxOutputTokens
    || (Number.isFinite(metadataOutput) && metadataOutput > 0 ? Math.floor(metadataOutput) : undefined)
    || known.maxOutputTokens
    || Math.min(8192, Math.max(1024, Math.floor(contextWindowTokens * 0.15)));
  const tokenizer = override.tokenizer || normalizeTokenizer(providerModelInfo?.tokenizer) || known.tokenizer || inferTokenizer(providerId, model);
  const supportsReasoningTokens = typeof known.supportsReasoningTokens === 'boolean'
    ? known.supportsReasoningTokens
    : /^(openai|openai_codex|anthropic|xai)$/i.test(providerId);
  const reasoningBudgetTokens = override.reasoningBudgetTokens || (supportsReasoningTokens ? Math.min(10000, Math.floor(contextWindowTokens * 0.08)) : 0);
  return {
    providerId,
    model,
    contextWindowTokens,
    maxOutputTokens,
    tokenizer,
    supportsReasoningTokens,
    reasoningBudgetTokens,
    source,
  };
}

export function buildContextBudget(profile: ModelContextProfile): ContextBudget {
  const safetyHeadroomTokens = Math.max(512, Math.floor(profile.contextWindowTokens * 0.1));
  const reservedOutputTokens = Math.min(profile.maxOutputTokens || 4096, Math.max(1024, Math.floor(profile.contextWindowTokens * 0.2)));
  const reservedReasoningTokens = profile.supportsReasoningTokens ? Math.min(profile.reasoningBudgetTokens || 0, Math.floor(profile.contextWindowTokens * 0.12)) : 0;
  const inputBudgetTokens = Math.max(1024, profile.contextWindowTokens - reservedOutputTokens - reservedReasoningTokens - safetyHeadroomTokens);
  return {
    contextWindowTokens: profile.contextWindowTokens,
    reservedOutputTokens,
    reservedReasoningTokens,
    safetyHeadroomTokens,
    inputBudgetTokens,
    compactionTriggerTokens: Math.floor(inputBudgetTokens * 0.75),
    toolContextBudgetTokens: Math.max(600, Math.floor(inputBudgetTokens * 0.16)),
    summaryBudgetTokens: Math.max(700, Math.floor(inputBudgetTokens * 0.08)),
  };
}
