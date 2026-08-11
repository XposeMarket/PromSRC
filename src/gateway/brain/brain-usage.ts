/**
 * Brain run usage ledger.
 *
 * Provider model calls already write detailed usage events to the shared
 * model-usage.jsonl stream. This module snapshots the events belonging to one
 * Thought/Dream run and stores a compact, durable per-run record so Brain cost
 * can be compared over time without re-counting provider calls elsewhere.
 */

import fs from 'fs';
import path from 'path';
import { readModelUsageEventsForSession, type ModelUsageEvent } from '../../providers/model-usage';
import { estimateModelUsageCost } from '../../providers/model-pricing';
import { getBrainDir } from './brain-state';

export const BRAIN_JOB_KINDS = ['thought', 'dream', 'dream_cleanup'] as const;
export type BrainJobKind = typeof BRAIN_JOB_KINDS[number];
export type BrainJobOutcome = 'success' | 'failed' | 'aborted';

export interface BrainJobUsageTotals {
  runs: number;
  successfulRuns: number;
  failedRuns: number;
  abortedRuns: number;
  durationMs: number;
  calls: number;
  providerReportedCalls: number;
  estimatedCalls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  inputCostMicros: number;
  outputCostMicros: number;
  reasoningCostMicros: number;
  cacheReadCostMicros: number;
  cacheWriteCostMicros: number;
  totalCostMicros: number;
}

export interface BrainJobModelUsage extends Omit<BrainJobUsageTotals, 'runs' | 'successfulRuns' | 'failedRuns' | 'abortedRuns' | 'durationMs'> {
  provider: string;
  model: string;
  pricingSources: string[];
  pricingVersions: string[];
  costBasis: 'provider' | 'estimated' | 'mixed' | 'none';
}

export interface BrainJobUsageRecord extends Omit<BrainJobUsageTotals, 'runs' | 'successfulRuns' | 'failedRuns' | 'abortedRuns'> {
  schemaVersion: 1;
  id: string;
  runId: string;
  job: BrainJobKind;
  outcome: BrainJobOutcome;
  date: string;
  sessionId: string;
  startedAt: string;
  completedAt: string;
  error?: string;
  costBasis: 'provider' | 'estimated' | 'mixed' | 'none';
  pricingSources: string[];
  pricingVersions: string[];
  models: BrainJobModelUsage[];
}

export interface BrainJobUsageHandle {
  job: BrainJobKind;
  runId: string;
  date: string;
  sessionId: string;
  startedAt: string;
  startedAtMs: number;
  eventCountAtStart: number;
}

export interface BrainUsageDailyTotals extends Omit<BrainJobUsageTotals, 'durationMs'> {
  date: string;
}

export interface BrainUsageSummary extends BrainJobUsageTotals {
  from: string | null;
  through: string | null;
  byJob: Record<BrainJobKind, BrainJobUsageTotals>;
  byDate: BrainUsageDailyTotals[];
}

export interface BrainUsageSnapshot {
  records: BrainJobUsageRecord[];
  summary: BrainUsageSummary;
}

const LEDGER_FILE = 'brain-job-usage.jsonl';

function ledgerPath(): string {
  return path.join(getBrainDir(), 'state', LEDGER_FILE);
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function nonNegativeNumberIncludingZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function isoOrNow(value?: string | number | Date): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  const text = String(value || '').trim();
  if (text && Number.isFinite(Date.parse(text))) return new Date(text).toISOString();
  return new Date().toISOString();
}

function timestampMs(value: unknown): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyTotals(): BrainJobUsageTotals {
  return {
    runs: 0,
    successfulRuns: 0,
    failedRuns: 0,
    abortedRuns: 0,
    durationMs: 0,
    calls: 0,
    providerReportedCalls: 0,
    estimatedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    inputCostMicros: 0,
    outputCostMicros: 0,
    reasoningCostMicros: 0,
    cacheReadCostMicros: 0,
    cacheWriteCostMicros: 0,
    totalCostMicros: 0,
  };
}

function emptyByJob(): Record<BrainJobKind, BrainJobUsageTotals> {
  return {
    thought: emptyTotals(),
    dream: emptyTotals(),
    dream_cleanup: emptyTotals(),
  };
}

function costForEvent(event: ModelUsageEvent): {
  inputCostMicros: number;
  outputCostMicros: number;
  reasoningCostMicros: number;
  cacheReadCostMicros: number;
  cacheWriteCostMicros: number;
  totalCostMicros: number;
  pricingSource: string;
  pricingVersion: string;
} {
  const estimated = estimateModelUsageCost({
    provider: event.provider,
    model: event.model,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    reasoningTokens: event.reasoningTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheWriteTokens: event.cacheWriteTokens,
  });
  const value = (key: keyof typeof estimated): number => {
    const raw = (event as any)[key];
    return raw === undefined || raw === null
      ? nonNegativeNumberIncludingZero(estimated[key])
      : nonNegativeNumberIncludingZero(raw);
  };
  return {
    inputCostMicros: value('inputCostMicros'),
    outputCostMicros: value('outputCostMicros'),
    reasoningCostMicros: value('reasoningCostMicros'),
    cacheReadCostMicros: value('cacheReadCostMicros'),
    cacheWriteCostMicros: value('cacheWriteCostMicros'),
    totalCostMicros: value('totalCostMicros'),
    pricingSource: String((event as any).pricingSource || estimated.pricingSource || '').trim() || 'unknown',
    pricingVersion: String((event as any).pricingVersion || estimated.pricingVersion || '').trim() || 'unknown',
  };
}

function costBasis(sources: Set<'provider' | 'estimated'>): 'provider' | 'estimated' | 'mixed' | 'none' {
  if (sources.size === 0) return 'none';
  if (sources.size > 1) return 'mixed';
  return sources.has('provider') ? 'provider' : 'estimated';
}

function modelKey(event: ModelUsageEvent): string {
  return `${String(event.provider || 'unknown').trim() || 'unknown'}\u0000${String(event.model || 'unknown').trim() || 'unknown'}`;
}

function aggregateEvents(events: ModelUsageEvent[]): {
  totals: Omit<BrainJobUsageRecord, 'schemaVersion' | 'id' | 'runId' | 'job' | 'outcome' | 'date' | 'sessionId' | 'startedAt' | 'completedAt' | 'error' | 'models'>;
  models: BrainJobModelUsage[];
} {
  const totals = emptyTotals();
  const sources = new Set<'provider' | 'estimated'>();
  const pricingSources = new Set<string>();
  const pricingVersions = new Set<string>();
  const models = new Map<string, {
    totals: BrainJobModelUsage;
    sources: Set<'provider' | 'estimated'>;
    pricingSources: Set<string>;
    pricingVersions: Set<string>;
  }>();

  for (const event of events) {
    const inputTokens = nonNegativeNumber(event.inputTokens);
    const outputTokens = nonNegativeNumber(event.outputTokens);
    const reasoningTokens = nonNegativeNumber(event.reasoningTokens);
    const cacheReadTokens = nonNegativeNumber(event.cacheReadTokens);
    const cacheWriteTokens = nonNegativeNumber(event.cacheWriteTokens);
    const totalTokens = nonNegativeNumber(event.totalTokens)
      || inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens;
    const cost = costForEvent(event);
    const source: 'provider' | 'estimated' = event.source === 'provider' ? 'provider' : 'estimated';

    totals.calls += 1;
    if (source === 'provider') totals.providerReportedCalls += 1;
    else totals.estimatedCalls += 1;
    totals.inputTokens += inputTokens;
    totals.outputTokens += outputTokens;
    totals.reasoningTokens += reasoningTokens;
    totals.cacheReadTokens += cacheReadTokens;
    totals.cacheWriteTokens += cacheWriteTokens;
    totals.totalTokens += totalTokens;
    totals.inputCostMicros += cost.inputCostMicros;
    totals.outputCostMicros += cost.outputCostMicros;
    totals.reasoningCostMicros += cost.reasoningCostMicros;
    totals.cacheReadCostMicros += cost.cacheReadCostMicros;
    totals.cacheWriteCostMicros += cost.cacheWriteCostMicros;
    totals.totalCostMicros += cost.totalCostMicros;
    sources.add(source);
    pricingSources.add(cost.pricingSource);
    pricingVersions.add(cost.pricingVersion);

    const key = modelKey(event);
    let model = models.get(key);
    if (!model) {
      model = {
        totals: {
          ...emptyTotals(),
          provider: String(event.provider || 'unknown').trim() || 'unknown',
          model: String(event.model || 'unknown').trim() || 'unknown',
          pricingSources: [],
          pricingVersions: [],
          costBasis: 'none',
        },
        sources: new Set(),
        pricingSources: new Set(),
        pricingVersions: new Set(),
      };
      models.set(key, model);
    }
    const target = model.totals;
    target.calls += 1;
    if (source === 'provider') target.providerReportedCalls += 1;
    else target.estimatedCalls += 1;
    target.inputTokens += inputTokens;
    target.outputTokens += outputTokens;
    target.reasoningTokens += reasoningTokens;
    target.cacheReadTokens += cacheReadTokens;
    target.cacheWriteTokens += cacheWriteTokens;
    target.totalTokens += totalTokens;
    target.inputCostMicros += cost.inputCostMicros;
    target.outputCostMicros += cost.outputCostMicros;
    target.reasoningCostMicros += cost.reasoningCostMicros;
    target.cacheReadCostMicros += cost.cacheReadCostMicros;
    target.cacheWriteCostMicros += cost.cacheWriteCostMicros;
    target.totalCostMicros += cost.totalCostMicros;
    model.sources.add(source);
    model.pricingSources.add(cost.pricingSource);
    model.pricingVersions.add(cost.pricingVersion);
  }

  const modelRows = Array.from(models.values()).map((entry) => ({
    ...entry.totals,
    pricingSources: Array.from(entry.pricingSources).sort(),
    pricingVersions: Array.from(entry.pricingVersions).sort(),
    costBasis: costBasis(entry.sources),
  })).sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    totals: {
      ...totals,
      costBasis: costBasis(sources),
      pricingSources: Array.from(pricingSources).sort(),
      pricingVersions: Array.from(pricingVersions).sort(),
    },
    models: modelRows,
  };
}

export function beginBrainJobUsage(input: {
  job: BrainJobKind;
  runId: string;
  date: string;
  sessionId: string;
  startedAt?: string | number | Date;
}): BrainJobUsageHandle {
  const startedAtMs = input.startedAt instanceof Date
    ? input.startedAt.getTime()
    : typeof input.startedAt === 'number'
      ? input.startedAt
      : Date.parse(String(input.startedAt || '')) || Date.now();
  return {
    job: input.job,
    runId: String(input.runId || '').trim(),
    date: String(input.date || '').trim(),
    sessionId: String(input.sessionId || '').trim(),
    startedAt: isoOrNow(input.startedAt || startedAtMs),
    startedAtMs,
    eventCountAtStart: readModelUsageEventsForSession(input.sessionId).length,
  };
}

export function finishBrainJobUsage(
  handle: BrainJobUsageHandle,
  input: {
    outcome: BrainJobOutcome;
    completedAt?: string | number | Date;
    error?: string | null;
  },
): BrainJobUsageRecord {
  const completedAt = isoOrNow(input.completedAt);
  const completedAtMs = timestampMs(completedAt) || Date.now();
  const sessionEvents = readModelUsageEventsForSession(handle.sessionId);
  const events = sessionEvents.slice(Math.max(0, handle.eventCountAtStart));
  const aggregate = aggregateEvents(events);
  const durationMs = Math.max(0, completedAtMs - handle.startedAtMs);
  const outcome = input.outcome;
  const record: BrainJobUsageRecord = {
    schemaVersion: 1,
    id: `brain_usage_${handle.job}_${handle.runId || Date.now().toString(36)}`,
    runId: handle.runId,
    job: handle.job,
    outcome,
    date: handle.date,
    sessionId: handle.sessionId,
    startedAt: handle.startedAt,
    completedAt,
    ...(String(input.error || '').trim() ? { error: String(input.error).trim().slice(0, 1000) } : {}),
    durationMs,
    calls: aggregate.totals.calls,
    providerReportedCalls: aggregate.totals.providerReportedCalls,
    estimatedCalls: aggregate.totals.estimatedCalls,
    inputTokens: aggregate.totals.inputTokens,
    outputTokens: aggregate.totals.outputTokens,
    reasoningTokens: aggregate.totals.reasoningTokens,
    cacheReadTokens: aggregate.totals.cacheReadTokens,
    cacheWriteTokens: aggregate.totals.cacheWriteTokens,
    totalTokens: aggregate.totals.totalTokens,
    inputCostMicros: aggregate.totals.inputCostMicros,
    outputCostMicros: aggregate.totals.outputCostMicros,
    reasoningCostMicros: aggregate.totals.reasoningCostMicros,
    cacheReadCostMicros: aggregate.totals.cacheReadCostMicros,
    cacheWriteCostMicros: aggregate.totals.cacheWriteCostMicros,
    totalCostMicros: aggregate.totals.totalCostMicros,
    costBasis: aggregate.totals.costBasis,
    pricingSources: aggregate.totals.pricingSources,
    pricingVersions: aggregate.totals.pricingVersions,
    models: aggregate.models,
  };

  try {
    const filePath = ledgerPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch (err: any) {
    // Brain telemetry must never turn a completed run into a failed run.
    console.warn('[BrainUsage] Could not persist job usage:', err?.message || err);
  }

  return record;
}

function isBrainJobKind(value: unknown): value is BrainJobKind {
  return (BRAIN_JOB_KINDS as readonly string[]).includes(String(value || '').trim() as BrainJobKind);
}

export function readBrainJobUsage(options: {
  job?: BrainJobKind;
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
} = {}): BrainJobUsageRecord[] {
  let raw = '';
  try {
    raw = fs.readFileSync(ledgerPath(), 'utf-8');
  } catch {
    return [];
  }

  const records: BrainJobUsageRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as BrainJobUsageRecord;
      if (!isBrainJobKind(value?.job)) continue;
      if (!value.sessionId || !value.completedAt) continue;
      if (options.job && value.job !== options.job) continue;
      const completedMs = timestampMs(value.completedAt);
      if (Number.isFinite(options.sinceMs) && completedMs < Number(options.sinceMs)) continue;
      if (Number.isFinite(options.untilMs) && completedMs >= Number(options.untilMs)) continue;
      records.push(value);
    } catch {
      // Ignore a partial/corrupt row so one bad record cannot hide history.
    }
  }

  records.sort((a, b) => timestampMs(b.completedAt) - timestampMs(a.completedAt));
  const limit = Number(options.limit);
  return Number.isFinite(limit) && limit > 0 ? records.slice(0, Math.floor(limit)) : records;
}

function addTotals(target: BrainJobUsageTotals, record: BrainJobUsageRecord): void {
  target.runs += 1;
  if (record.outcome === 'success') target.successfulRuns += 1;
  else if (record.outcome === 'aborted') target.abortedRuns += 1;
  else target.failedRuns += 1;
  target.durationMs += nonNegativeNumber(record.durationMs);
  for (const key of [
    'calls', 'providerReportedCalls', 'estimatedCalls', 'inputTokens', 'outputTokens',
    'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens',
    'inputCostMicros', 'outputCostMicros', 'reasoningCostMicros',
    'cacheReadCostMicros', 'cacheWriteCostMicros', 'totalCostMicros',
  ] as const) {
    target[key] += nonNegativeNumber((record as any)[key]);
  }
}

export function summarizeBrainJobUsage(records: BrainJobUsageRecord[]): BrainUsageSummary {
  const totals = emptyTotals();
  const byJob = emptyByJob();
  const byDate = new Map<string, BrainJobUsageTotals>();
  let from: string | null = null;
  let through: string | null = null;

  for (const record of Array.isArray(records) ? records : []) {
    addTotals(totals, record);
    if (isBrainJobKind(record.job)) addTotals(byJob[record.job], record);
    const date = String(record.date || '').trim() || record.completedAt.slice(0, 10);
    if (date) {
      const day = byDate.get(date) || emptyTotals();
      addTotals(day, record);
      byDate.set(date, day);
    }
    if (!from || timestampMs(record.completedAt) < timestampMs(from)) from = record.completedAt;
    if (!through || timestampMs(record.completedAt) > timestampMs(through)) through = record.completedAt;
  }

  const daily: BrainUsageDailyTotals[] = Array.from(byDate.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, value]) => ({ date, ...value }));

  return { ...totals, from, through, byJob, byDate: daily };
}

export function getBrainUsageSnapshot(options: {
  job?: BrainJobKind;
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
} = {}): BrainUsageSnapshot {
  const all = readBrainJobUsage({
    job: options.job,
    sinceMs: options.sinceMs,
    untilMs: options.untilMs,
  });
  return {
    records: Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
      ? all.slice(0, Math.floor(Number(options.limit)))
      : all,
    summary: summarizeBrainJobUsage(all),
  };
}

export function getLatestBrainJobUsage(job: BrainJobKind): BrainJobUsageRecord | null {
  return readBrainJobUsage({ job, limit: 1 })[0] || null;
}

export function resetBrainUsageLedgerForTests(): void {
  try {
    fs.rmSync(ledgerPath(), { force: true });
  } catch {}
}
