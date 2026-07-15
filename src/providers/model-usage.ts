import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';
import type { ChatMessage, ContentPart, ModelUsage } from './LLMProvider';
import { estimateModelUsageCost } from './model-pricing';

export interface ModelUsageEvent {
  timestamp: string;
  provider: string;
  model: string;
  requestedModel?: string;
  actualModel?: string;
  fallbackFrom?: string;
  fallbackReason?: string;
  callType: 'chat' | 'generate';
  sessionId?: string;
  agentId?: string;
  taskId?: string;
  runId?: string;
  teamId?: string;
  jobId?: string;
  attempt?: number;
  phase?: 'queue' | 'model' | 'tool' | 'synthesis' | 'delivery' | 'unknown';
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  source: 'provider' | 'estimated';
  inputCostMicros?: number;
  outputCostMicros?: number;
  reasoningCostMicros?: number;
  cacheReadCostMicros?: number;
  cacheWriteCostMicros?: number;
  totalCostMicros?: number;
  pricingSource?: string;
  pricingVersion?: string;
  durationMs?: number;
  estimatedMessageInputTokens?: number;
  estimatedSystemPromptTokens?: number;
  estimatedConversationTokens?: number;
  estimatedToolSchemaTokens?: number;
  estimatedProviderInputTokens?: number;
  promptManifestId?: string;
  promptManifestHash?: string;
  promptManifestVersion?: number;
  runtimeRole?: string;
  executionMode?: string;
  systemSegmentIds?: string[];
  activeToolCategories?: string[];
}

function usageLogPath(): string {
  try {
    return path.join(getConfig().getConfigDir(), 'model-usage.jsonl');
  } catch {
    return path.join(process.cwd(), '.prometheus', 'model-usage.jsonl');
  }
}

function normalizeCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function normalizeCostMicros(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function contentToString(content: string | ContentPart[] | null | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content.map((part: any) => {
    if (part?.type === 'text') return String(part.text || '');
    if (part?.type === 'image_url') return '[image]';
    return '';
  }).filter(Boolean).join('\n');
}

export function estimateTextTokens(text: unknown): number {
  const value = String(text || '');
  if (!value) return 0;
  return Math.max(1, Math.ceil(value.length / 4));
}

export function estimateMessagesTokens(messages: ChatMessage[] | Array<any> | undefined): number {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, message: any) => {
    const roleCost = estimateTextTokens(message?.role || '');
    const contentCost = estimateTextTokens(contentToString(message?.content));
    const toolCost = Array.isArray(message?.tool_calls)
      ? estimateTextTokens(JSON.stringify(message.tool_calls))
      : 0;
    return sum + roleCost + contentCost + toolCost;
  }, 0);
}

export function estimateToolSchemaTokens(tools: Array<any> | undefined): number {
  if (!Array.isArray(tools) || tools.length === 0) return 0;
  return estimateTextTokens(JSON.stringify(tools));
}

export interface UsageCalibration {
  /** Multiplier to apply to a raw estimate to approximate real provider input tokens. */
  factor: number;
  /** Number of provider-reported samples the factor was derived from. */
  samples: number;
  source: 'calibrated' | 'default';
}

const CALIBRATION_MIN = 0.6;
const CALIBRATION_MAX = 2.5;
const CALIBRATION_WINDOW = 12;
const CALIBRATION_MIN_SAMPLES = 2;

function cacheUsageIsSeparateFromInput(provider: string): boolean {
  return String(provider || '').trim().toLowerCase().includes('anthropic');
}

/**
 * Derive a clamped correction factor by comparing what the provider actually
 * counted as input (input + cache read/write) against what we estimated for the
 * same call. Self-corrects per provider+model so a fixed char/token divisor
 * never silently drifts the context budget. Falls back to 1.0 (no correction)
 * until enough provider-reported calls exist.
 *
 * NOTE: the denominator (estimatedProviderInputTokens) is produced by
 * estimateMessagesTokens + estimateToolSchemaTokens, so the factor is only
 * dimensionally correct when applied to estimates built the same way.
 */
export function getUsageCalibration(provider: string, model: string): UsageCalibration {
  try {
    const prov = String(provider || '').trim();
    const mdl = String(model || '').trim();
    const events = readModelUsageEvents().filter((e) =>
      e.source === 'provider'
      && String(e.provider) === prov
      && String(e.model) === mdl
      && Number(e.estimatedProviderInputTokens || 0) > 0,
    );
    const recent = events.slice(-CALIBRATION_WINDOW);
    const ratios = recent
      .map((e) => {
        const provider = String(e.provider || '');
        const realInput = Number(e.inputTokens || 0)
          + (cacheUsageIsSeparateFromInput(provider)
            ? Number(e.cacheReadTokens || 0) + Number(e.cacheWriteTokens || 0)
            : 0);
        const estimate = Number(e.estimatedProviderInputTokens || 0);
        return estimate > 0 ? realInput / estimate : NaN;
      })
      .filter((r) => Number.isFinite(r) && r > 0)
      .sort((a, b) => a - b);
    if (ratios.length < CALIBRATION_MIN_SAMPLES) {
      return { factor: 1, samples: ratios.length, source: 'default' };
    }
    const median = ratios[Math.floor(ratios.length / 2)];
    const factor = Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, median));
    return { factor, samples: ratios.length, source: 'calibrated' };
  } catch {
    return { factor: 1, samples: 0, source: 'default' };
  }
}

/**
 * Canonical input-token estimate for context-budget decisions: the raw
 * message+tool estimate, corrected by real provider usage. Returns both the raw
 * and calibrated figures plus the factor used, so callers can surface either.
 */
export function estimateCalibratedInputTokens(
  messages: ChatMessage[] | Array<any> | undefined,
  tools: Array<any> | undefined,
  provider: string,
  model: string,
): { raw: number; calibrated: number; factor: number; samples: number; source: 'calibrated' | 'default' } {
  const raw = estimateMessagesTokens(messages) + estimateToolSchemaTokens(tools);
  const calibration = getUsageCalibration(provider, model);
  return {
    raw,
    calibrated: Math.round(raw * calibration.factor),
    factor: calibration.factor,
    samples: calibration.samples,
    source: calibration.source,
  };
}

export function normalizeUsage(usage: ModelUsage | undefined, fallback: {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}): Required<ModelUsage> {
  const inputTokens = normalizeCount(usage?.inputTokens ?? fallback.inputTokens);
  const outputTokens = normalizeCount(usage?.outputTokens ?? fallback.outputTokens);
  const reasoningTokens = normalizeCount(usage?.reasoningTokens ?? fallback.reasoningTokens);
  const cacheReadTokens = normalizeCount(usage?.cacheReadTokens);
  const cacheWriteTokens = normalizeCount(usage?.cacheWriteTokens);
  const explicitTotal = normalizeCount(usage?.totalTokens);
  const totalTokens = explicitTotal || inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens;
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    source: usage?.source || 'estimated',
    requestedModel: usage?.requestedModel || '',
    actualModel: usage?.actualModel || '',
    fallbackFrom: usage?.fallbackFrom || '',
    fallbackReason: usage?.fallbackReason || '',
  };
}

export function appendModelUsageEvent(event: Omit<ModelUsageEvent, 'timestamp'> & { timestamp?: string }): void {
  try {
    const base: ModelUsageEvent = {
      timestamp: event.timestamp || new Date().toISOString(),
      provider: String(event.provider || 'unknown'),
      model: String(event.model || 'unknown'),
      requestedModel: event.requestedModel ? String(event.requestedModel) : undefined,
      actualModel: event.actualModel ? String(event.actualModel) : undefined,
      fallbackFrom: event.fallbackFrom ? String(event.fallbackFrom) : undefined,
      fallbackReason: event.fallbackReason ? String(event.fallbackReason) : undefined,
      callType: event.callType,
      sessionId: event.sessionId,
      agentId: event.agentId,
      taskId: event.taskId ? String(event.taskId) : undefined,
      runId: event.runId ? String(event.runId) : undefined,
      teamId: event.teamId ? String(event.teamId) : undefined,
      jobId: event.jobId ? String(event.jobId) : undefined,
      attempt: normalizeCount(event.attempt),
      phase: event.phase || 'unknown',
      inputTokens: normalizeCount(event.inputTokens),
      outputTokens: normalizeCount(event.outputTokens),
      reasoningTokens: normalizeCount(event.reasoningTokens),
      cacheReadTokens: normalizeCount(event.cacheReadTokens),
      cacheWriteTokens: normalizeCount(event.cacheWriteTokens),
      totalTokens: normalizeCount(event.totalTokens),
      source: event.source || 'estimated',
      durationMs: normalizeCount(event.durationMs),
      estimatedMessageInputTokens: normalizeCount(event.estimatedMessageInputTokens),
      estimatedSystemPromptTokens: normalizeCount(event.estimatedSystemPromptTokens),
      estimatedConversationTokens: normalizeCount(event.estimatedConversationTokens),
      estimatedToolSchemaTokens: normalizeCount(event.estimatedToolSchemaTokens),
      estimatedProviderInputTokens: normalizeCount(event.estimatedProviderInputTokens),
    };
    const cost = estimateModelUsageCost(base);
    const full: ModelUsageEvent = {
      ...base,
      inputCostMicros: normalizeCostMicros((event as any).inputCostMicros ?? cost.inputCostMicros),
      outputCostMicros: normalizeCostMicros((event as any).outputCostMicros ?? cost.outputCostMicros),
      reasoningCostMicros: normalizeCostMicros((event as any).reasoningCostMicros ?? cost.reasoningCostMicros),
      cacheReadCostMicros: normalizeCostMicros((event as any).cacheReadCostMicros ?? cost.cacheReadCostMicros),
      cacheWriteCostMicros: normalizeCostMicros((event as any).cacheWriteCostMicros ?? cost.cacheWriteCostMicros),
      totalCostMicros: normalizeCostMicros((event as any).totalCostMicros ?? cost.totalCostMicros),
      pricingSource: String((event as any).pricingSource || cost.pricingSource || ''),
      pricingVersion: String((event as any).pricingVersion || cost.pricingVersion || ''),
    };
    if (full.totalTokens <= 0) return;
    // Phase 0 instrumentation: one concise, human-readable line per provider-reported
    // call so prompt-cache behavior is observable live. Only logged when the provider
    // actually returns usage (source === 'provider'); estimates are silent to avoid noise.
    if (full.source === 'provider') {
      const cacheableInput = full.inputTokens + full.cacheReadTokens;
      const hitRatio = cacheableInput > 0
        ? Math.round((full.cacheReadTokens / cacheableInput) * 100)
        : 0;
      console.log(
        `[cache] ${full.provider}/${full.model} `
        + `in=${full.inputTokens} cacheRead=${full.cacheReadTokens} `
        + `cacheWrite=${full.cacheWriteTokens} out=${full.outputTokens} `
        + `hit=${hitRatio}%`,
      );
    }
    const filePath = usageLogPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(full) + '\n', 'utf-8');
  } catch {
    // Usage telemetry must never break a model call.
  }
}

let _usageReadCachePath = '';
let _usageReadCacheMtimeMs = 0;
let _usageReadCacheSize = 0;
let _usageReadCacheEvents: ModelUsageEvent[] = [];

export function readModelUsageEvents(): ModelUsageEvent[] {
  try {
    const filePath = usageLogPath();
    let st: fs.Stats;
    try { st = fs.statSync(filePath); } catch { return []; }
    if (
      filePath === _usageReadCachePath
      && st.mtimeMs === _usageReadCacheMtimeMs
      && st.size === _usageReadCacheSize
    ) {
      return _usageReadCacheEvents;
    }
    const events = fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try { return JSON.parse(line) as ModelUsageEvent; } catch { return null; }
      })
      .filter((event): event is ModelUsageEvent => !!event);
    _usageReadCachePath = filePath;
    _usageReadCacheMtimeMs = st.mtimeMs;
    _usageReadCacheSize = st.size;
    _usageReadCacheEvents = events;
    return events;
  } catch {
    return [];
  }
}
