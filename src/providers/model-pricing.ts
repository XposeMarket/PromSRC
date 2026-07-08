import { getConfig } from '../config/config';

export const MODEL_PRICING_VERSION = '2026-06-estimates-v1';

export interface ResolvedModelPricing {
  provider: string;
  model: string;
  inputMicrosPerToken: number;
  outputMicrosPerToken: number;
  reasoningMicrosPerToken: number;
  cacheReadMicrosPerToken: number;
  cacheWriteMicrosPerToken: number;
  source: 'config' | 'built_in_estimate' | 'fallback_estimate' | 'local';
  pricingVersion: string;
}

export interface ModelUsageCostEstimate {
  inputCostMicros: number;
  outputCostMicros: number;
  reasoningCostMicros: number;
  cacheReadCostMicros: number;
  cacheWriteCostMicros: number;
  totalCostMicros: number;
  pricingSource: string;
  pricingVersion: string;
}

type PricingRule = {
  provider?: RegExp;
  model: RegExp;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  source?: ResolvedModelPricing['source'];
};

// Rates are USD per 1M tokens. Because cost is stored in micro-dollars,
// the per-token micro-dollar rate has the same numeric value.
const BUILT_IN_RULES: PricingRule[] = [
  { provider: /^(ollama|llama_cpp|lm_studio)$/i, model: /.*/, input: 0, output: 0, source: 'local' },

  { provider: /^(openai|openai_codex)$/i, model: /^gpt-5\.5/i, input: 5.00, output: 30.00, cacheRead: 0.50 },
  { provider: /^(openai|openai_codex)$/i, model: /^gpt-5\.4-nano/i, input: 0.20, output: 1.25, cacheRead: 0.020 },
  { provider: /^(openai|openai_codex)$/i, model: /^gpt-5\.4-mini/i, input: 0.75, output: 4.50, cacheRead: 0.075 },
  { provider: /^(openai|openai_codex)$/i, model: /^gpt-5\.4/i, input: 2.50, output: 15.00, cacheRead: 0.25 },
  { provider: /^(openai|openai_codex)$/i, model: /^gpt-5-nano/i, input: 0.05, output: 0.40, cacheRead: 0.005 },
  { provider: /^(openai|openai_codex)$/i, model: /^gpt-5-mini/i, input: 0.25, output: 2.00, cacheRead: 0.025 },
  { provider: /^(openai|openai_codex)$/i, model: /(?:mini|spark)/i, input: 0.25, output: 2.00, cacheRead: 0.025 },
  { provider: /^(openai|openai_codex)$/i, model: /(?:nano)/i, input: 0.10, output: 0.40, cacheRead: 0.010 },
  { provider: /^(openai|openai_codex)$/i, model: /^gpt-4\.1/i, input: 2.00, output: 8.00, cacheRead: 0.50 },
  { provider: /^(openai|openai_codex)$/i, model: /^gpt-5/i, input: 1.25, output: 10.00, cacheRead: 0.125 },
  { provider: /^(openai|openai_codex)$/i, model: /^o[134]/i, input: 2.50, output: 10.00, cacheRead: 1.25 },

  { provider: /^anthropic$/i, model: /fable/i, input: 10.00, output: 50.00, cacheRead: 1.00, cacheWrite: 12.50 },
  { provider: /^anthropic$/i, model: /opus-4-(6|7|8)|opus-4\.(6|7|8)/i, input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite: 6.25 },
  { provider: /^anthropic$/i, model: /opus/i, input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  { provider: /^anthropic$/i, model: /sonnet/i, input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  { provider: /^anthropic$/i, model: /haiku/i, input: 1.00, output: 5.00, cacheRead: 0.10, cacheWrite: 1.25 },

  { provider: /^xai$/i, model: /^(grok-build-0\.1|grok-code-fast)/i, input: 1.00, output: 2.00, cacheRead: 0.20 },
  { provider: /^xai$/i, model: /^grok-4\.5/i, input: 2.00, output: 6.00, cacheRead: 0.20 },
  { provider: /^xai$/i, model: /^grok-4\.(?:3|20)|^grok-latest/i, input: 1.25, output: 2.50, cacheRead: 0.20 },
  { provider: /^xai$/i, model: /grok/i, input: 1.25, output: 2.50, cacheRead: 0.20 },
  { provider: /^gemini$/i, model: /flash|lite/i, input: 0.35, output: 1.05 },
  { provider: /^gemini$/i, model: /pro/i, input: 1.25, output: 10.00 },
  { provider: /^perplexity$/i, model: /.*/, input: 1.00, output: 1.00 },
];

function normalizeProvider(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeModel(value: unknown): string {
  return String(value || '').trim();
}

function normalizeRate(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function readConfigPricing(provider: string, model: string): Partial<ResolvedModelPricing> | null {
  try {
    const cfg = getConfig().getConfig() as any;
    const pricing = cfg?.usage_pricing || cfg?.model_pricing || cfg?.pricing;
    const models = pricing?.models || pricing?.model_prices || {};
    const raw =
      models?.[`${provider}/${model}`]
      || models?.[`${provider}:${model}`]
      || models?.[model]
      || models?.[provider]?.[model]
      || null;
    if (!raw || typeof raw !== 'object') return null;
    const rates = raw.per_million_usd || raw.usd_per_million || raw;
    const input = normalizeRate(rates.input ?? rates.input_usd_per_million ?? rates.prompt);
    const output = normalizeRate(rates.output ?? rates.output_usd_per_million ?? rates.completion);
    if (input == null && output == null) return null;
    return {
      inputMicrosPerToken: input ?? output ?? 0,
      outputMicrosPerToken: output ?? input ?? 0,
      reasoningMicrosPerToken: normalizeRate(rates.reasoning ?? rates.reasoning_usd_per_million) ?? output ?? input ?? 0,
      cacheReadMicrosPerToken: normalizeRate(rates.cache_read ?? rates.cached_input ?? rates.cacheRead) ?? input ?? output ?? 0,
      cacheWriteMicrosPerToken: normalizeRate(rates.cache_write ?? rates.cache_creation ?? rates.cacheWrite) ?? input ?? output ?? 0,
      source: 'config',
    };
  } catch {
    return null;
  }
}

function isLocalProvider(provider: string): boolean {
  return /^(ollama|llama_cpp|lm_studio)$/i.test(provider);
}

function findBuiltInRule(provider: string, model: string): PricingRule | null {
  return BUILT_IN_RULES.find((rule) => {
    if (rule.provider && !rule.provider.test(provider)) return false;
    return rule.model.test(model);
  }) || null;
}

export function resolveModelPricing(providerValue: unknown, modelValue: unknown): ResolvedModelPricing {
  const provider = normalizeProvider(providerValue) || 'unknown';
  const model = normalizeModel(modelValue) || 'unknown';
  const configured = readConfigPricing(provider, model);
  if (configured) {
    const input = configured.inputMicrosPerToken ?? 0;
    const output = configured.outputMicrosPerToken ?? input;
    return {
      provider,
      model,
      inputMicrosPerToken: input,
      outputMicrosPerToken: output,
      reasoningMicrosPerToken: configured.reasoningMicrosPerToken ?? output,
      cacheReadMicrosPerToken: configured.cacheReadMicrosPerToken ?? input,
      cacheWriteMicrosPerToken: configured.cacheWriteMicrosPerToken ?? input,
      source: 'config',
      pricingVersion: MODEL_PRICING_VERSION,
    };
  }

  const rule = findBuiltInRule(provider, model);
  if (rule) {
    return {
      provider,
      model,
      inputMicrosPerToken: rule.input,
      outputMicrosPerToken: rule.output,
      reasoningMicrosPerToken: rule.reasoning ?? rule.output,
      cacheReadMicrosPerToken: rule.cacheRead ?? rule.input,
      cacheWriteMicrosPerToken: rule.cacheWrite ?? rule.input,
      source: rule.source || 'built_in_estimate',
      pricingVersion: MODEL_PRICING_VERSION,
    };
  }

  if (isLocalProvider(provider)) {
    return {
      provider,
      model,
      inputMicrosPerToken: 0,
      outputMicrosPerToken: 0,
      reasoningMicrosPerToken: 0,
      cacheReadMicrosPerToken: 0,
      cacheWriteMicrosPerToken: 0,
      source: 'local',
      pricingVersion: MODEL_PRICING_VERSION,
    };
  }

  return {
    provider,
    model,
    inputMicrosPerToken: 1.00,
    outputMicrosPerToken: 5.00,
    reasoningMicrosPerToken: 5.00,
    cacheReadMicrosPerToken: 1.00,
    cacheWriteMicrosPerToken: 1.00,
    source: 'fallback_estimate',
    pricingVersion: MODEL_PRICING_VERSION,
  };
}

function normalizeTokenCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function roundMicros(tokens: number, microsPerToken: number): number {
  if (!Number.isFinite(tokens) || !Number.isFinite(microsPerToken) || tokens <= 0 || microsPerToken <= 0) return 0;
  return Math.max(0, Math.round(tokens * microsPerToken));
}

function cacheReadIsIncludedInInput(provider: string): boolean {
  return /^(openai|openai_codex|xai|gemini|perplexity)$/i.test(provider);
}

export function estimateModelUsageCost(input: {
  provider: unknown;
  model: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  reasoningTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheWriteTokens?: unknown;
}): ModelUsageCostEstimate {
  const pricing = resolveModelPricing(input.provider, input.model);
  const inputTokens = normalizeTokenCount(input.inputTokens);
  const outputTokens = normalizeTokenCount(input.outputTokens);
  const reasoningTokens = normalizeTokenCount(input.reasoningTokens);
  const cacheReadTokens = normalizeTokenCount(input.cacheReadTokens);
  const cacheWriteTokens = normalizeTokenCount(input.cacheWriteTokens);
  const billableInputTokens = cacheReadIsIncludedInInput(pricing.provider)
    ? Math.max(0, inputTokens - cacheReadTokens)
    : inputTokens;
  const inputCostMicros = roundMicros(billableInputTokens, pricing.inputMicrosPerToken);
  const outputCostMicros = roundMicros(outputTokens, pricing.outputMicrosPerToken);
  const reasoningCostMicros = roundMicros(reasoningTokens, pricing.reasoningMicrosPerToken);
  const cacheReadCostMicros = roundMicros(cacheReadTokens, pricing.cacheReadMicrosPerToken);
  const cacheWriteCostMicros = roundMicros(cacheWriteTokens, pricing.cacheWriteMicrosPerToken);
  const totalCostMicros = inputCostMicros
    + outputCostMicros
    + reasoningCostMicros
    + cacheReadCostMicros
    + cacheWriteCostMicros;
  return {
    inputCostMicros,
    outputCostMicros,
    reasoningCostMicros,
    cacheReadCostMicros,
    cacheWriteCostMicros,
    totalCostMicros,
    pricingSource: pricing.source,
    pricingVersion: pricing.pricingVersion,
  };
}

export function estimateContextCostMicros(tokensValue: unknown, provider: unknown, model: unknown): number {
  const tokens = normalizeTokenCount(tokensValue);
  const pricing = resolveModelPricing(provider, model);
  return roundMicros(tokens, pricing.inputMicrosPerToken);
}

export function costMicrosToUsd(microsValue: unknown): number {
  const micros = Number(microsValue);
  return Number.isFinite(micros) ? micros / 1_000_000 : 0;
}
