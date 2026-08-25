import fs from 'fs';
import path from 'path';
import { getBrainDir } from './brain-state';
import type { BrainJobKind, BrainJobUsageRecord } from './brain-usage';

/**
 * Bounded provider diagnostics for Brain runs.
 *
 * These records deliberately contain response shape and usage metadata only.
 * They never persist prompts, tool arguments, assistant text, credentials, or
 * raw provider payloads. The run summary is also the input to the conservative
 * automatic-run circuit breaker below.
 */

export type BrainProviderFailureClass = 'missing_completed' | 'empty_completion';
export type BrainProviderErrorReason =
  | 'missing_completed'
  | 'empty_completion'
  | 'provider_http_error'
  | 'aborted'
  | 'provider_error';

/** Structural error metadata only; arbitrary provider messages are excluded. */
export interface BrainProviderErrorMetadata {
  name?: string;
  code?: string;
  status?: number;
  failureClass?: BrainProviderFailureClass;
  reason: BrainProviderErrorReason;
}

export interface BrainProviderDiagnosticsContext {
  job: BrainJobKind;
  runId: string;
  date: string;
  sessionId: string;
  startedAt: number;
  events: BrainProviderEventDiagnostic[];
}

export interface BrainProviderEventDiagnostic {
  kind: 'provider_event';
  at: string;
  job: BrainJobKind;
  runId: string;
  date: string;
  sessionId: string;
  provider?: string;
  model?: string;
  nativeType: string;
  failureClass?: BrainProviderFailureClass;
  sawCompleted?: boolean;
  eventTypes?: string[];
  outputItemTypes?: string[];
  outputItemCount?: number;
  finalTextChars?: number;
  toolCallCount?: number;
  accountIndex?: number;
  attempt?: number;
  retrying?: boolean;
  durationMs?: number;
  usage?: CompactProviderUsage;
}

export interface BrainProviderRunSummary {
  kind: 'run_summary';
  at: string;
  job: BrainJobKind;
  runId: string;
  date: string;
  sessionId: string;
  outcome: BrainJobUsageRecord['outcome'];
  provider?: string;
  model?: string;
  providers: string[];
  models: string[];
  failureClasses: BrainProviderFailureClass[];
  providerEventCount: number;
  durationMs: number;
  toolCount?: number;
  activityPackageChars?: number;
  resultTextChars?: number;
  usage?: CompactProviderUsage;
  error?: BrainProviderErrorMetadata;
}

export type BrainProviderDiagnosticRecord = BrainProviderEventDiagnostic | BrainProviderRunSummary;

export interface CompactProviderUsage {
  calls?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  totalCostMicros?: number;
}

export interface BrainAutomaticRunGuard {
  defer: boolean;
  reason?: string;
  provider?: string;
  model?: string;
  consecutiveFailures?: number;
}

const DIAGNOSTIC_FILE = 'brain-provider-diagnostics.jsonl';
const MAX_DIAGNOSTIC_BYTES = 8 * 1024 * 1024;
const DEFAULT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FAILURE_THRESHOLD = 2;

function diagnosticPath(): string {
  return path.join(getBrainDir(), 'state', DIAGNOSTIC_FILE);
}

function boundedText(value: unknown, max = 160): string {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function boundedCount(value: unknown, max = 1_000_000_000): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.round(n)) : 0;
}

function boundedOptionalCount(value: unknown, max = 1_000_000_000): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.round(n)) : undefined;
}

function boundedList(value: unknown, maxItems = 40, maxItemChars = 80): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => boundedText(item, maxItemChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function compactUsage(value: unknown): CompactProviderUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = value as Record<string, unknown>;
  const result: CompactProviderUsage = {
    calls: boundedCount(usage.calls),
    inputTokens: boundedCount(usage.inputTokens),
    outputTokens: boundedCount(usage.outputTokens),
    reasoningTokens: boundedCount(usage.reasoningTokens),
    cacheReadTokens: boundedCount(usage.cacheReadTokens),
    cacheWriteTokens: boundedCount(usage.cacheWriteTokens),
    totalTokens: boundedCount(usage.totalTokens),
    totalCostMicros: boundedCount(usage.totalCostMicros),
  };
  return Object.values(result).some((entry) => Number(entry) > 0) ? result : undefined;
}

function sanitizeDiagnosticError(error: unknown): BrainProviderErrorMetadata | undefined {
  if (error === undefined || error === null || error === '') return undefined;
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const nestedDiagnostics = value.diagnostics && typeof value.diagnostics === 'object'
    ? value.diagnostics as Record<string, unknown>
    : {};
  const failureClass = nestedDiagnostics.failureClass === 'missing_completed' || nestedDiagnostics.failureClass === 'empty_completion'
    ? nestedDiagnostics.failureClass
    : value.failureClass === 'missing_completed' || value.failureClass === 'empty_completion'
      ? value.failureClass
      : undefined;
  const message = typeof error === 'string'
    ? error
    : typeof value.message === 'string' ? value.message : '';
  const normalizedMessage = message.toLowerCase();
  const reason: BrainProviderErrorReason = failureClass
    || (/response\.completed[^.]*no assistant text|empty completion/i.test(normalizedMessage) ? 'empty_completion'
      : /ended before response\.completed|missing completed/i.test(normalizedMessage) ? 'missing_completed'
        : /\bapi(?:\s+error)?\s+\d{3}\b|\bhttp(?:s)?\b|\bstatus\s*[:=]?\s*\d{3}\b/i.test(normalizedMessage) ? 'provider_http_error'
          : /\babort(?:ed|ing)?\b|\bcancel(?:led|ed)?\b/i.test(normalizedMessage) ? 'aborted'
            : 'provider_error');
  const metadata: BrainProviderErrorMetadata = {
    ...(boundedText(value.name, 80) ? { name: boundedText(value.name, 80) } : {}),
    ...(boundedText(value.code, 80) ? { code: boundedText(value.code, 80) } : {}),
    ...(boundedOptionalCount(value.status, 599) !== undefined ? { status: boundedOptionalCount(value.status, 599) } : {}),
    ...(failureClass ? { failureClass } : {}),
    reason,
  };
  return metadata;
}

function appendDiagnostic(record: BrainProviderDiagnosticRecord): void {
  try {
    const filePath = diagnosticPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf-8');
    const size = fs.statSync(filePath).size;
    if (size > MAX_DIAGNOSTIC_BYTES) {
      const retained = fs.readFileSync(filePath, 'utf-8').slice(-Math.floor(MAX_DIAGNOSTIC_BYTES / 2));
      fs.writeFileSync(filePath, retained, 'utf-8');
    }
  } catch (error: any) {
    // Diagnostics must never convert a Brain result into a failed run.
    console.warn('[BrainDiagnostics] Could not persist provider diagnostic:', error?.message || error);
  }
}

export function createBrainProviderDiagnosticsContext(input: {
  job: BrainJobKind;
  runId: string;
  date: string;
  sessionId: string;
  startedAt?: number;
}): BrainProviderDiagnosticsContext {
  return {
    job: input.job,
    runId: boundedText(input.runId, 120),
    date: boundedText(input.date, 32),
    sessionId: boundedText(input.sessionId, 200),
    startedAt: Number(input.startedAt || Date.now()),
    events: [],
  };
}

/** Capture only provider-level response-shape events from a model stream. */
export function captureBrainProviderEvent(context: BrainProviderDiagnosticsContext, event: unknown): void {
  if (!event || typeof event !== 'object') return;
  const value = event as Record<string, unknown>;
  if (String(value.type || '').trim() !== 'provider_event') return;
  const nativeType = boundedText(value.nativeType, 120);
  if (!nativeType) return;
  const data = value.data && typeof value.data === 'object' ? value.data as Record<string, unknown> : {};
  const failureClass = data.failureClass === 'missing_completed' || data.failureClass === 'empty_completion'
    ? data.failureClass
    : undefined;
  const record: BrainProviderEventDiagnostic = {
    kind: 'provider_event',
    at: new Date().toISOString(),
    job: context.job,
    runId: context.runId,
    date: context.date,
    sessionId: context.sessionId,
    provider: boundedText(value.provider, 80) || undefined,
    model: boundedText(value.model, 160) || undefined,
    nativeType,
    ...(failureClass ? { failureClass } : {}),
    ...(typeof data.sawCompleted === 'boolean' ? { sawCompleted: data.sawCompleted } : {}),
    ...(data.eventTypes ? { eventTypes: boundedList(data.eventTypes) } : {}),
    ...(data.outputItemTypes ? { outputItemTypes: boundedList(data.outputItemTypes, 24) } : {}),
    ...(data.outputItemCount !== undefined ? { outputItemCount: boundedCount(data.outputItemCount) } : {}),
    ...(data.finalTextChars !== undefined ? { finalTextChars: boundedCount(data.finalTextChars) } : {}),
    ...(data.toolCallCount !== undefined ? { toolCallCount: boundedCount(data.toolCallCount) } : {}),
    ...(data.accountIndex !== undefined ? { accountIndex: boundedOptionalCount(data.accountIndex, 64) } : {}),
    ...(data.attempt !== undefined ? { attempt: boundedCount(data.attempt, 10) } : {}),
    ...(typeof data.retrying === 'boolean' ? { retrying: data.retrying } : {}),
    ...(data.durationMs !== undefined ? { durationMs: boundedCount(data.durationMs, 24 * 60 * 60 * 1000) } : {}),
    ...(data.usage ? { usage: compactUsage(data.usage) } : {}),
  };
  context.events.push(record);
  if (context.events.length > 100) context.events.splice(0, context.events.length - 100);
  appendDiagnostic(record);
}

function usageForRecord(usage: unknown): CompactProviderUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const value = usage as Record<string, unknown>;
  return compactUsage(value);
}

export function finishBrainProviderDiagnostics(
  context: BrainProviderDiagnosticsContext,
  input: {
    outcome: BrainJobUsageRecord['outcome'];
    error?: unknown;
    usage?: unknown;
    toolCount?: number;
    activityPackageChars?: number;
    resultTextChars?: number;
    completedAt?: number;
  },
): BrainProviderRunSummary {
  const providers = [...new Set(context.events.map((event) => boundedText(event.provider, 80)).filter(Boolean))].slice(0, 8);
  const models = [...new Set(context.events.map((event) => boundedText(event.model, 160)).filter(Boolean))].slice(0, 8);
  const failureClasses = [...new Set(context.events.map((event) => event.failureClass).filter(Boolean))] as BrainProviderFailureClass[];
  const summary: BrainProviderRunSummary = {
    kind: 'run_summary',
    at: new Date(Number(input.completedAt || Date.now())).toISOString(),
    job: context.job,
    runId: context.runId,
    date: context.date,
    sessionId: context.sessionId,
    outcome: input.outcome,
    provider: providers[0],
    model: models[0],
    providers,
    models,
    failureClasses,
    providerEventCount: context.events.length,
    durationMs: Math.max(0, Number(input.completedAt || Date.now()) - context.startedAt),
    ...(input.toolCount !== undefined ? { toolCount: boundedCount(input.toolCount) } : {}),
    ...(input.activityPackageChars !== undefined ? { activityPackageChars: boundedCount(input.activityPackageChars) } : {}),
    ...(input.resultTextChars !== undefined ? { resultTextChars: boundedCount(input.resultTextChars) } : {}),
    ...(usageForRecord(input.usage) ? { usage: usageForRecord(input.usage) } : {}),
    ...(sanitizeDiagnosticError(input.error) ? { error: sanitizeDiagnosticError(input.error) } : {}),
  };
  appendDiagnostic(summary);
  return summary;
}

export function readBrainProviderDiagnosticRecords(): BrainProviderDiagnosticRecord[] {
  let raw = '';
  try {
    raw = fs.readFileSync(diagnosticPath(), 'utf-8');
  } catch {
    return [];
  }
  const records: BrainProviderDiagnosticRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as BrainProviderDiagnosticRecord;
      if (value?.kind === 'provider_event' || value?.kind === 'run_summary') records.push(value);
    } catch {
      // Ignore a partial rotated line or one corrupt row.
    }
  }
  return records;
}

function envInt(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

/**
 * Automatic Thought/Dream work pauses after repeated empty provider runs.
 * Manual `runNow` calls pass allowForeground and intentionally bypass this
 * guard so diagnosis can continue without re-enabling the scheduler.
 */
export function shouldDeferAutomaticBrainJob(job: BrainJobKind, now = Date.now()): BrainAutomaticRunGuard {
  const windowMs = envInt('PROMETHEUS_BRAIN_PROVIDER_FAILURE_WINDOW_MS', DEFAULT_FAILURE_WINDOW_MS, 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);
  const threshold = envInt('PROMETHEUS_BRAIN_PROVIDER_FAILURE_THRESHOLD', DEFAULT_FAILURE_THRESHOLD, 1, 10);
  const summaries = readBrainProviderDiagnosticRecords()
    .filter((record): record is BrainProviderRunSummary => record.kind === 'run_summary' && record.job === job)
    .filter((record) => {
      const at = Date.parse(record.at);
      return Number.isFinite(at) && now - at >= 0 && now - at <= windowMs;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const keys = new Set<string>();
  for (const summary of summaries) {
    for (const provider of summary.providers.length ? summary.providers : [summary.provider || '']) {
      for (const model of summary.models.length ? summary.models : [summary.model || '']) {
        const key = `${provider}\u0000${model}`;
        if (provider || model) keys.add(key);
      }
    }
  }

  for (const key of keys) {
    const [provider, model] = key.split('\u0000');
    let consecutiveFailures = 0;
    for (const summary of summaries) {
      const summaryKeys = new Set<string>();
      for (const summaryProvider of summary.providers.length ? summary.providers : [summary.provider || '']) {
        for (const summaryModel of summary.models.length ? summary.models : [summary.model || '']) {
          summaryKeys.add(`${summaryProvider}\u0000${summaryModel}`);
        }
      }
      if (!summaryKeys.has(key)) continue;
      if (summary.outcome === 'success') break;
      if (!summary.failureClasses.includes('empty_completion')) break;
      consecutiveFailures += 1;
      if (consecutiveFailures >= threshold) {
        return {
          defer: true,
          provider,
          model,
          consecutiveFailures,
          reason: `automatic ${job} paused after ${consecutiveFailures} consecutive empty provider completions from ${provider || 'unknown provider'} / ${model || 'unknown model'}; use a manual run to investigate`,
        };
      }
    }
  }
  return { defer: false };
}
