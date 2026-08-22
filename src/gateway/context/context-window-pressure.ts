import { deriveContextWindowUsage } from './context-window-usage';

export interface ContextPressureMessageLike {
  content?: unknown;
}

export interface ContextWindowPressureInput {
  history?: ContextPressureMessageLike[];
  latestContextSummary?: unknown;
  contextStartIndex?: unknown;
  contextTokenEstimate?: unknown;
  calibrationFactor?: unknown;
  contextWindowTokens?: unknown;
  compactionThreshold?: unknown;
}

export interface ContextWindowPressureState {
  rawActiveTokens: number;
  pressureTokens: number;
  contextWindowTokens: number;
  compactionTriggerTokens: number;
  calibrationFactor: number;
  compactionThreshold: number;
  activeHistoryMessages: number;
  summaryActive: boolean;
  usage: ReturnType<typeof deriveContextWindowUsage>;
  triggerRatio: number;
  atOrPastCompactionTrigger: boolean;
}

function nonNegativeFinite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function estimateSessionMessageTokens(message: ContextPressureMessageLike): number {
  const content = String(message?.content || '');
  return Math.max(1, Math.ceil(content.length / 3.5)) + 6;
}

/**
 * Mirrors the session pre-turn compaction estimator. The context-window UI used
 * to inspect only the bounded model-call history slice, while session
 * compaction checks the entire active (uncompacted) transcript. Keeping this
 * calculation in one small, testable module lets the UI expose the pressure
 * that can actually trigger compaction without changing the stored transcript.
 */
export function estimateRawActiveSessionTokens(input: ContextWindowPressureInput): {
  tokens: number;
  activeHistoryMessages: number;
  summaryActive: boolean;
} {
  const persistedEstimate = Number(input.contextTokenEstimate);
  const history = Array.isArray(input.history) ? input.history : [];
  const summary = String(input.latestContextSummary || '').trim();

  // Session writes keep this estimate current with the same estimator used by
  // the pre-turn compaction gate. Prefer it when present so the diagnostics
  // endpoint and the gate cannot drift because of duplicate reconstruction.
  if (Number.isFinite(persistedEstimate) && persistedEstimate >= 0) {
    const start = summary
      ? Math.max(0, Math.min(history.length, Math.floor(nonNegativeFinite(input.contextStartIndex))))
      : 0;
    return {
      tokens: persistedEstimate,
      activeHistoryMessages: summary ? Math.max(0, history.length - start) + 1 : history.length,
      summaryActive: !!summary,
    };
  }

  if (!summary) {
    return {
      tokens: history.reduce((total, message) => total + estimateSessionMessageTokens(message), 0),
      activeHistoryMessages: history.length,
      summaryActive: false,
    };
  }

  const start = Math.max(0, Math.min(history.length, Math.floor(nonNegativeFinite(input.contextStartIndex))));
  const summaryMessage = { content: `[Rolling context summary]\n${summary}` };
  const activeHistory = history.slice(start);
  return {
    tokens: estimateSessionMessageTokens(summaryMessage)
      + activeHistory.reduce((total, message) => total + estimateSessionMessageTokens(message), 0),
    activeHistoryMessages: activeHistory.length + 1,
    summaryActive: true,
  };
}

export function buildContextWindowPressure(input: ContextWindowPressureInput): ContextWindowPressureState {
  const contextWindowTokens = Math.floor(nonNegativeFinite(input.contextWindowTokens));
  const calibrationRaw = Number(input.calibrationFactor);
  const calibrationFactor = Number.isFinite(calibrationRaw) && calibrationRaw > 0 ? calibrationRaw : 1;
  const thresholdRaw = Number(input.compactionThreshold);
  const compactionThreshold = Number.isFinite(thresholdRaw) && thresholdRaw >= 0.4 && thresholdRaw <= 0.95
    ? thresholdRaw
    : 0.7;
  const raw = estimateRawActiveSessionTokens(input);
  const pressureTokens = Math.max(0, Math.round(raw.tokens * calibrationFactor));
  const compactionTriggerTokens = contextWindowTokens > 0
    ? Math.floor(contextWindowTokens * compactionThreshold)
    : 0;
  const usage = deriveContextWindowUsage(pressureTokens, contextWindowTokens);
  const triggerRatio = compactionTriggerTokens > 0 ? pressureTokens / compactionTriggerTokens : 0;

  return {
    rawActiveTokens: raw.tokens,
    pressureTokens,
    contextWindowTokens,
    compactionTriggerTokens,
    calibrationFactor,
    compactionThreshold,
    activeHistoryMessages: raw.activeHistoryMessages,
    summaryActive: raw.summaryActive,
    usage,
    triggerRatio,
    atOrPastCompactionTrigger: compactionTriggerTokens > 0 && pressureTokens >= compactionTriggerTokens,
  };
}
