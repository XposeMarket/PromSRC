import { estimateMessagesTokens, estimateToolSchemaTokens } from '../../providers/model-usage';

/** Hard per-run guard for model-backed Brain Dream and cleanup turns. */
export const DEFAULT_BRAIN_RUN_MAX_MODEL_CALLS = 20;
export const DEFAULT_BRAIN_RUN_MAX_INPUT_TOKENS = 1_500_000;

export interface BrainRunBudgetOptions {
  /** Set by the caller or PROMETHEUS_BRAIN_RUN_MAX_MODEL_CALLS. */
  maxModelCalls?: number;
  /** Set by the caller or PROMETHEUS_BRAIN_RUN_MAX_INPUT_TOKENS. */
  maxInputTokens?: number;
}

export interface BrainRunBudgetSnapshot {
  maxModelCalls: number;
  maxInputTokens: number;
  modelCalls: number;
  inputTokens: number;
  hit?: 'model_calls' | 'input_tokens';
}

export interface BrainRunBudgetDecision {
  allowed: boolean;
  estimatedInputTokens: number;
  hit?: 'model_calls' | 'input_tokens';
  snapshot: BrainRunBudgetSnapshot;
}

export interface BrainRunBudgetUsage {
  inputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Cache tokens are separate from input for Anthropic-style provider usage. */
  cacheUsageSeparate?: boolean;
}

export function providerInputTokensForBrainBudget(usage: BrainRunBudgetUsage): number {
  const input = positiveInteger(usage.inputTokens, 0);
  if (!usage.cacheUsageSeparate) return input;
  return input + positiveInteger(usage.cacheReadTokens, 0) + positiveInteger(usage.cacheWriteTokens, 0);
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

/**
 * Resolve no-UI configuration. Explicit runtime options win over environment;
 * invalid values deliberately fall back to safe production defaults.
 */
export function resolveBrainRunBudgetOptions(options: BrainRunBudgetOptions = {}): Required<BrainRunBudgetOptions> {
  return {
    maxModelCalls: positiveInteger(
      options.maxModelCalls ?? process.env.PROMETHEUS_BRAIN_RUN_MAX_MODEL_CALLS,
      DEFAULT_BRAIN_RUN_MAX_MODEL_CALLS,
    ),
    maxInputTokens: positiveInteger(
      options.maxInputTokens ?? process.env.PROMETHEUS_BRAIN_RUN_MAX_INPUT_TOKENS,
      DEFAULT_BRAIN_RUN_MAX_INPUT_TOKENS,
    ),
  };
}

export function estimateBrainModelInputTokens(messages: Array<any>, tools?: Array<any>): number {
  return Math.max(0, estimateMessagesTokens(messages) + estimateToolSchemaTokens(tools));
}

export class BrainRunBudget {
  private readonly limits: Required<BrainRunBudgetOptions>;
  private modelCalls = 0;
  private inputTokens = 0;
  private lastReservedInputTokens = 0;
  private hit: BrainRunBudgetSnapshot['hit'];

  constructor(options: BrainRunBudgetOptions = {}) {
    this.limits = resolveBrainRunBudgetOptions(options);
  }

  snapshot(): BrainRunBudgetSnapshot {
    return {
      ...this.limits,
      modelCalls: this.modelCalls,
      inputTokens: this.inputTokens,
      ...(this.hit ? { hit: this.hit } : {}),
    };
  }

  /** Reserve exactly one provider request before it starts. */
  tryReserve(messages: Array<any>, tools?: Array<any>): BrainRunBudgetDecision {
    const estimatedInputTokens = estimateBrainModelInputTokens(messages, tools);
    if (this.modelCalls >= this.limits.maxModelCalls) {
      this.hit = 'model_calls';
      return { allowed: false, estimatedInputTokens, hit: this.hit, snapshot: this.snapshot() };
    }
    if (this.inputTokens + estimatedInputTokens > this.limits.maxInputTokens) {
      this.hit = 'input_tokens';
      return { allowed: false, estimatedInputTokens, hit: this.hit, snapshot: this.snapshot() };
    }
    this.modelCalls += 1;
    this.inputTokens += estimatedInputTokens;
    this.lastReservedInputTokens = estimatedInputTokens;
    return { allowed: true, estimatedInputTokens, snapshot: this.snapshot() };
  }

  /**
   * Reconcile the admission estimate after a provider response. A response that
   * reports more input than reserved is allowed to finish, but permanently
   * closes the guard before any following retry/round can start.
   */
  reconcileActualInput(actualInputTokens: number): BrainRunBudgetSnapshot {
    const actual = positiveInteger(actualInputTokens, this.lastReservedInputTokens);
    this.inputTokens = Math.max(0, this.inputTokens - this.lastReservedInputTokens + actual);
    this.lastReservedInputTokens = 0;
    if (this.inputTokens >= this.limits.maxInputTokens) this.hit = 'input_tokens';
    return this.snapshot();
  }
}
