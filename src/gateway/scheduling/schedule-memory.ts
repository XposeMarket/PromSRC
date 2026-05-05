/**
 * schedule-memory.ts
 *
 * Persistent memory for scheduled agents — survives across runs.
 *
 * Each schedule gets:
 *   - agent-memory.json  — dedup keys, learned context, run summaries, free notes
 *   - run-log.json       — full audit trail of every run
 *
 * Both live at:
 *   .prometheus/schedules/<scheduleId>/agent-memory.json
 *   .prometheus/schedules/<scheduleId>/run-log.json
 *
 * Design rules:
 *   - agent-memory is NOT the evidence bus (bus = ephemeral per-run)
 *   - Memory persists forever with size trimming
 *   - dedup lists: capped at last 500 entries per key
 *   - learnedContext: capped at 20 most-recent items
 *   - runSummaries: capped at 30 entries
 *   - notes: capped at 50 keys, 500 chars each
 *   - run-log: capped at 500 entries
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import { containsObsoleteProductBrand } from '../scheduled-output-guard';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RunSummary {
  runId: string;
  scheduledAt: number;
  completedAt: number;
  success: boolean;
  summary: string;        // max 400 chars
  stepCount: number;
  errorIfAny?: string;
}

export interface ScheduleAgentMemory {
  scheduleId: string;
  agentId?: string;        // which agent handles this schedule
  createdAt: number;
  updatedAt: number;

  /**
   * Deduplication store — persists forever (trimmed to last 500 per key).
   * e.g. { "posted_tweet_ids": ["id1", "id2", ...] }
   */
  dedup: Record<string, string[]>;

  /**
   * What the agent learned from previous runs.
   * Max 20 items, trimmed to most recent.
   */
  learnedContext: string[];

  /**
   * Last N run summaries for the agent to reference.
   * Max 30 entries.
   */
  runSummaries: RunSummary[];

  /**
   * Custom key-value store the agent can freely read/write.
   * Max 50 keys, 500 chars per value.
   */
  notes: Record<string, string>;
}

/**
 * Structured per-run observability record — richer than RunSummary.
 * Keyed by job_id, used by the weekly review to compute aggregate stats.
 */
export interface StructuredRunRecord {
  runId: string;
  jobId: string;          // scheduleId
  jobName: string;
  triggeredAt: number;
  completedAt: number;
  durationMs: number;
  status: 'success' | 'error' | 'skipped';
  errorType?: 'network' | 'auth' | 'dom_selector' | 'timeout' | 'logic' | 'unknown';
  errorMessage?: string;
  attempts: number;       // 1 = first try, >1 = retried
  stepCount: number;
  keyMetrics?: Record<string, string | number>; // e.g. { tweets_posted: 1 }
}

export interface RunLogEntry {
  runId: string;
  scheduledAt: number;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'complete' | 'failed' | 'skipped';
  taskId: string;          // the BackgroundTask ID that handled this run
  agentId?: string;
  summary?: string;
  errorIfAny?: string;
  errorType?: StructuredRunRecord['errorType'];
  attempts?: number;
  evidenceWritten: number; // how many bus entries this run produced
}

export interface RunLog {
  scheduleId: string;
  runs: RunLogEntry[];
}

// ─── Limits ────────────────────────────────────────────────────────────────────

const MAX_DEDUP_PER_KEY = 500;
const MAX_LEARNED_CONTEXT = 20;
const MAX_RUN_SUMMARIES = 30;
const MAX_NOTES_KEYS = 50;
const MAX_NOTE_VALUE_CHARS = 500;
const MAX_RUN_LOG_ENTRIES = 500;

// ─── Paths ─────────────────────────────────────────────────────────────────────

function getSchedulesDir(): string {
  let base: string;
  try {
    base = getConfig().getConfigDir();
  } catch {
    base = path.join(process.cwd(), '.prometheus');
  }
  const dir = path.join(base, 'schedules');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getScheduleDir(scheduleId: string): string {
  const dir = path.join(getSchedulesDir(), scheduleId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function memoryFilePath(scheduleId: string): string {
  return path.join(getScheduleDir(scheduleId), 'agent-memory.json');
}

function runLogFilePath(scheduleId: string): string {
  return path.join(getScheduleDir(scheduleId), 'run-log.json');
}

// ─── Agent Memory CRUD ─────────────────────────────────────────────────────────

export function loadScheduleMemory(scheduleId: string): ScheduleAgentMemory | null {
  const p = memoryFilePath(scheduleId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ScheduleAgentMemory;
  } catch {
    return null;
  }
}

function getOrCreateScheduleMemory(scheduleId: string): ScheduleAgentMemory {
  const existing = loadScheduleMemory(scheduleId);
  if (existing) return existing;
  const mem: ScheduleAgentMemory = {
    scheduleId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dedup: {},
    learnedContext: [],
    runSummaries: [],
    notes: {},
  };
  saveScheduleMemory(mem);
  return mem;
}

function saveScheduleMemory(mem: ScheduleAgentMemory): void {
  mem.updatedAt = Date.now();
  fs.writeFileSync(memoryFilePath(mem.scheduleId), JSON.stringify(mem, null, 2), 'utf-8');
}

/**
 * Add a value to a dedup list. Returns true if written, false if already present.
 */
export function addDedupKey(scheduleId: string, key: string, value: string): boolean {
  const mem = getOrCreateScheduleMemory(scheduleId);
  if (!mem.dedup[key]) mem.dedup[key] = [];
  if (mem.dedup[key].includes(value)) return false;
  mem.dedup[key].push(value);
  // Trim to last 500
  if (mem.dedup[key].length > MAX_DEDUP_PER_KEY) {
    mem.dedup[key] = mem.dedup[key].slice(-MAX_DEDUP_PER_KEY);
  }
  saveScheduleMemory(mem);
  return true;
}

/**
 * Check if a value is in a dedup list.
 */
export function isDedupPresent(scheduleId: string, key: string, value: string): boolean {
  const mem = loadScheduleMemory(scheduleId);
  if (!mem) return false;
  return (mem.dedup[key] || []).includes(value);
}

/**
 * Add a learned context item.
 */
export function addLearnedContext(scheduleId: string, insight: string): void {
  const mem = getOrCreateScheduleMemory(scheduleId);
  const trimmed = String(insight || '').trim().slice(0, 300);
  if (!trimmed) return;
  // Avoid exact duplicates
  if (mem.learnedContext.includes(trimmed)) return;
  mem.learnedContext.push(trimmed);
  if (mem.learnedContext.length > MAX_LEARNED_CONTEXT) {
    mem.learnedContext = mem.learnedContext.slice(-MAX_LEARNED_CONTEXT);
  }
  saveScheduleMemory(mem);
}

/**
 * Set a persistent note (key=value).
 */
export function setNote(scheduleId: string, key: string, value: string): void {
  const mem = getOrCreateScheduleMemory(scheduleId);
  const trimmedKey = String(key || '').trim().slice(0, 80);
  const trimmedValue = String(value || '').trim().slice(0, MAX_NOTE_VALUE_CHARS);
  if (!trimmedKey) return;
  mem.notes[trimmedKey] = trimmedValue;
  // Trim to 50 keys (keep most recently written)
  const keys = Object.keys(mem.notes);
  if (keys.length > MAX_NOTES_KEYS) {
    const toDelete = keys.slice(0, keys.length - MAX_NOTES_KEYS);
    for (const k of toDelete) delete mem.notes[k];
  }
  saveScheduleMemory(mem);
}

/**
 * Append a run summary.
 */
export function appendRunSummary(scheduleId: string, summary: RunSummary): void {
  const mem = getOrCreateScheduleMemory(scheduleId);
  mem.runSummaries.push({
    ...summary,
    summary: String(summary.summary || '').slice(0, 400),
  });
  if (mem.runSummaries.length > MAX_RUN_SUMMARIES) {
    mem.runSummaries = mem.runSummaries.slice(-MAX_RUN_SUMMARIES);
  }
  saveScheduleMemory(mem);
}

/**
 * Promote dedup_key entries from the evidence bus into persistent schedule memory.
 * Called at the end of a scheduled task run.
 */
export function promoteBusEntriesToMemory(
  scheduleId: string,
  busEntries: Array<{ category: string; key?: string; value: string }>,
): void {
  for (const e of busEntries) {
    if (e.category === 'dedup_key' && e.key) {
      addDedupKey(scheduleId, e.key, e.value);
    }
  }
}

/**
 * Format schedule memory as a human-readable string for injection into agent prompts.
 * Only injects actionable context (dedup keys, learned insights, notes).
 * Run summaries are deliberately excluded — they contain raw output that can confuse the agent.
 */
export function formatScheduleMemoryForPrompt(mem: ScheduleAgentMemory | null): string {
  if (!mem) return '';

  const sections: string[] = [];

  // Dedup keys — things to skip to avoid duplicate actions
  const dedupKeys = Object.keys(mem.dedup);
  if (dedupKeys.length > 0) {
    const keyLines: string[] = [];
    for (const k of dedupKeys.slice(0, 10)) {
      const vals = mem.dedup[k];
      const preview = vals.slice(-5).join(', ');
      keyLines.push(`  ${k}: [${preview}]${vals.length > 5 ? ` (+${vals.length - 5} more)` : ''}`);
    }
    sections.push('Already actioned (skip these to avoid duplicates):\n' + keyLines.join('\n'));
  }

  // Learned context — insights from prior runs
  if (mem.learnedContext.length > 0) {
    const ctxLines = mem.learnedContext
      .filter(c => !containsObsoleteProductBrand(c))
      .map(c => `  - ${c}`)
      .join('\n');
    if (ctxLines) sections.push('Learned from prior runs:\n' + ctxLines);
  }

  // Notes — custom key/value written by the agent
  const noteKeys = Object.keys(mem.notes);
  if (noteKeys.length > 0) {
    const noteLines = noteKeys
      .slice(0, 10)
      .map(k => `  ${k}: ${mem.notes[k]}`)
      .filter(line => !containsObsoleteProductBrand(line))
      .join('\n');
    if (noteLines) sections.push('Persistent notes:\n' + noteLines);
  }

  if (sections.length === 0) return '';

  return '[SCHEDULE CONTEXT from prior runs — use to improve this run]\n' + sections.join('\n\n') + '\n[/SCHEDULE CONTEXT]';
}

// ─── Run Log ───────────────────────────────────────────────────────────────────

export function loadRunLog(scheduleId: string): RunLog {
  const p = runLogFilePath(scheduleId);
  if (!fs.existsSync(p)) return { scheduleId, runs: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as RunLog;
  } catch {
    return { scheduleId, runs: [] };
  }
}

function saveRunLog(log: RunLog): void {
  fs.writeFileSync(runLogFilePath(log.scheduleId), JSON.stringify(log, null, 2), 'utf-8');
}

export function appendRunLog(scheduleId: string, entry: RunLogEntry): void {
  const log = loadRunLog(scheduleId);
  log.runs.push(entry);
  if (log.runs.length > MAX_RUN_LOG_ENTRIES) {
    log.runs = log.runs.slice(-MAX_RUN_LOG_ENTRIES);
  }
  saveRunLog(log);
}

export function updateRunLogEntry(
  scheduleId: string,
  runId: string,
  updates: Partial<Pick<RunLogEntry, 'completedAt' | 'status' | 'summary' | 'errorIfAny' | 'errorType' | 'attempts' | 'evidenceWritten'>>,
): void {
  const log = loadRunLog(scheduleId);
  const entry = log.runs.find(r => r.runId === runId);
  if (!entry) return;
  Object.assign(entry, updates);
  saveRunLog(log);
}

/**
 * Create a new run log entry (called when a scheduled task starts).
 * Returns the runId for later updates.
 */
export function startRunLogEntry(input: {
  scheduleId: string;
  taskId: string;
  scheduledAt: number;
  agentId?: string;
}): string {
  const runId = crypto.randomUUID();
  appendRunLog(input.scheduleId, {
    runId,
    scheduledAt: input.scheduledAt,
    startedAt: Date.now(),
    status: 'running',
    taskId: input.taskId,
    agentId: input.agentId,
    evidenceWritten: 0,
  });
  return runId;
}

// ─── Structured Observability Log ────────────────────────────────────────────
// One JSON file per schedule: .prometheus/schedules/<id>/structured-log.json
// Capped at 200 entries. Used by weekly review for richer aggregation.

const MAX_STRUCTURED_LOG = 200;

function structuredLogPath(scheduleId: string): string {
  return path.join(getScheduleDir(scheduleId), 'structured-log.json');
}

export function loadStructuredLog(scheduleId: string): StructuredRunRecord[] {
  const p = structuredLogPath(scheduleId);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return []; }
}

export function appendStructuredRecord(record: StructuredRunRecord): void {
  const existing = loadStructuredLog(record.jobId);
  existing.push(record);
  const trimmed = existing.slice(-MAX_STRUCTURED_LOG);
  fs.writeFileSync(structuredLogPath(record.jobId), JSON.stringify(trimmed, null, 2), 'utf-8');
}

/** Aggregate stats across all structured log records for a schedule — used by weekly review. */
export interface StructuredStats {
  jobId: string;
  jobName: string;
  totalRuns: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgDurationMs: number;
  avgStepCount: number;
  avgAttempts: number;
  errorTypes: Record<string, number>; // e.g. { network: 3, dom_selector: 1 }
  errorMessages: string[];            // last 5 unique error messages
  keyMetricAggregates: Record<string, number>; // summed numeric key metrics
  weekOverWeekDelta?: number;         // success rate change vs prior week (if data exists)
}

export function aggregateStructuredStats(
  scheduleId: string,
  periodStartMs: number,
  periodEndMs: number,
): StructuredStats | null {
  const records = loadStructuredLog(scheduleId).filter(
    r => r.completedAt >= periodStartMs && r.completedAt <= periodEndMs
  );
  if (records.length === 0) return null;

  const jobName = records[0].jobName;
  const success = records.filter(r => r.status === 'success');
  const errors = records.filter(r => r.status === 'error');

  const errorTypes: Record<string, number> = {};
  for (const r of errors) {
    const t = r.errorType || 'unknown';
    errorTypes[t] = (errorTypes[t] || 0) + 1;
  }

  const errorMessages = [...new Set(errors.map(r => r.errorMessage || '').filter(Boolean))].slice(-5);

  const keyMetricAggregates: Record<string, number> = {};
  for (const r of records) {
    for (const [k, v] of Object.entries(r.keyMetrics || {})) {
      if (typeof v === 'number') {
        keyMetricAggregates[k] = (keyMetricAggregates[k] || 0) + v;
      }
    }
  }

  const avgDurationMs = records.reduce((s, r) => s + r.durationMs, 0) / records.length;
  const avgStepCount = records.reduce((s, r) => s + r.stepCount, 0) / records.length;
  const avgAttempts = records.reduce((s, r) => s + r.attempts, 0) / records.length;

  // Week-over-week: compare to the 7 days before periodStart
  const priorStart = periodStartMs - (periodEndMs - periodStartMs);
  const priorRecords = loadStructuredLog(scheduleId).filter(
    r => r.completedAt >= priorStart && r.completedAt < periodStartMs
  );
  let weekOverWeekDelta: number | undefined;
  if (priorRecords.length >= 2) {
    const priorRate = priorRecords.filter(r => r.status === 'success').length / priorRecords.length;
    const currentRate = success.length / records.length;
    weekOverWeekDelta = currentRate - priorRate;
  }

  return {
    jobId: scheduleId,
    jobName,
    totalRuns: records.length,
    successCount: success.length,
    errorCount: errors.length,
    successRate: success.length / records.length,
    avgDurationMs,
    avgStepCount,
    avgAttempts,
    errorTypes,
    errorMessages,
    keyMetricAggregates,
    weekOverWeekDelta,
  };
}

/**
 * Complete a run log entry and write the run summary to agent-memory.
 * Also promotes any dedup_key bus entries to persistent memory.
 */
export function completeScheduledRun(input: {
  scheduleId: string;
  runId: string;
  taskId: string;
  success: boolean;
  summary: string;
  stepCount: number;
  errorIfAny?: string;
  errorType?: StructuredRunRecord['errorType'];
  attempts?: number;
  jobName?: string;
  keyMetrics?: Record<string, string | number>;
  scheduledAt: number;
  busEntries?: Array<{ category: string; key?: string; value: string }>;
  memoryUpdates?: Array<{ category: 'dedup_key' | 'learned_context' | 'note'; key?: string; value: string }>;
}): void {
  const completedAt = Date.now();

  const startedAt = Date.now() - (input.stepCount * 2000); // rough estimate if not available

  // Update run log
  updateRunLogEntry(input.scheduleId, input.runId, {
    completedAt,
    status: input.success ? 'complete' : 'failed',
    summary: input.summary.slice(0, 400),
    errorIfAny: input.errorIfAny,
    errorType: input.errorType,
    attempts: input.attempts || 1,
    evidenceWritten: (input.busEntries || []).length,
  });

  // Write structured observability record
  try {
    appendStructuredRecord({
      runId: input.runId,
      jobId: input.scheduleId,
      jobName: input.jobName || input.scheduleId,
      triggeredAt: input.scheduledAt,
      completedAt,
      durationMs: completedAt - input.scheduledAt,
      status: input.success ? 'success' : 'error',
      errorType: input.errorType,
      errorMessage: input.errorIfAny ? input.errorIfAny.slice(0, 200) : undefined,
      attempts: input.attempts || 1,
      stepCount: input.stepCount,
      keyMetrics: input.keyMetrics,
    });
  } catch { /* non-critical */ }

  // Write run summary to agent-memory
  appendRunSummary(input.scheduleId, {
    runId: input.runId,
    scheduledAt: input.scheduledAt,
    completedAt,
    success: input.success,
    summary: input.summary.slice(0, 400),
    stepCount: input.stepCount,
    errorIfAny: input.errorIfAny,
  });

  // Promote bus dedup_key entries to persistent memory
  if (input.busEntries && input.busEntries.length > 0) {
    promoteBusEntriesToMemory(input.scheduleId, input.busEntries);
  }

  // Apply explicit memory updates (from Manager verify suggestions or update_schedule_memory tool)
  if (input.memoryUpdates && input.memoryUpdates.length > 0) {
    for (const update of input.memoryUpdates) {
      if (update.category === 'dedup_key' && update.key) {
        addDedupKey(input.scheduleId, update.key, update.value);
      } else if (update.category === 'learned_context') {
        addLearnedContext(input.scheduleId, update.value);
      } else if (update.category === 'note' && update.key) {
        setNote(input.scheduleId, update.key, update.value);
      }
    }
  }
}
