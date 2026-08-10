/**
 * Conservative automatic settling for untouched user conversations.
 *
 * This module owns policy timing and bounded orchestration only. The durable
 * state transition remains session.settledAt through session-settlement.ts;
 * no transcript, memory, resource, task, or session file is deleted or
 * rewritten by an auto-settle run.
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';
import { broadcastWS, getLastMainSessionId } from './comms/broadcaster';
import { getCronSchedulerInstance } from './scheduling/cron-scheduler';
import { findProjectBySessionId } from './projects/project-store';
import {
  getSession,
  listAutoSettleCandidates,
  type SessionSummary,
} from './session';
import {
  getSessionSettlementBlockers,
  settleSessionWithGuards,
  SessionSettlementError,
} from './session-settlement';
import { listLiveRuntimes } from './live-runtime-registry';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const AUTO_SETTLE_PRESET_DAYS = [0, 7, 14, 30, 90] as const;
export const AUTO_SETTLE_MAX_DAYS = 3650;
export const AUTO_SETTLE_BATCH_SIZE = 50;
export const AUTO_SETTLE_MAX_BATCHES_PER_RUN = 10;

const LAST_RUN_RELATIVE_PATH = path.join('auto-settle', 'last-run.json');
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

export type AutoSettleMode = 'never' | 'preset' | 'custom';
export type AutoSettleActivationMode = 'apply_existing' | 'start_now';

export interface AutoSettleSettings {
  afterDays: number;
  afterMs: number;
  customDate: string | null;
  customCutoffAt: number | null;
  activationAt: number | null;
  mode: AutoSettleMode;
}

export interface AutoSettleUpdate {
  settings: AutoSettleSettings;
  persisted: Record<string, unknown>;
  applyExisting: boolean;
  immediateCutoffAt: number | null;
}

export interface AutoSettleRunSummary {
  runId: string;
  startedAt: number;
  completedAt: number;
  reason: string;
  dryRun: boolean;
  disabled: boolean;
  afterDays: number;
  cutoffAt: number | null;
  activationAt: number | null;
  scanned: number;
  eligible: number;
  wouldSettle: number;
  settled: number;
  skipped: Record<string, number>;
  errors: number;
  batchSize: number;
  maxBatches: number;
  batches: number;
  truncated: boolean;
  sessionIds: string[];
}

export class AutoSettleSettingsError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AutoSettleSettingsError';
  }
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function strictDateParts(value: unknown): { year: number; month: number; day: number } | null {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

function normalizeTimezoneOffset(value: unknown): number {
  const offset = finiteNumber(value);
  if (offset === null || !Number.isInteger(offset) || offset < -840 || offset > 840) return 0;
  return offset;
}

/** Convert a browser-local calendar date to a stable UTC timestamp. */
export function customDateToCutoffAt(value: unknown, timezoneOffsetMinutes = 0): number {
  const parts = strictDateParts(value);
  if (!parts) throw new AutoSettleSettingsError('Custom auto-settle date must be a valid YYYY-MM-DD calendar date.');
  const offset = normalizeTimezoneOffset(timezoneOffsetMinutes);
  return Date.UTC(parts.year, parts.month - 1, parts.day) + offset * 60 * 1000;
}

function localDayStartAt(now: number, timezoneOffsetMinutes: number): number {
  const offset = normalizeTimezoneOffset(timezoneOffsetMinutes);
  const localNow = new Date(now - offset * 60 * 1000);
  return Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) + offset * 60 * 1000;
}

function normalizePersistedSettings(raw: Record<string, any> | null | undefined, now = Date.now()): AutoSettleSettings {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawDays = finiteNumber(source.autoSettleAfterDays);
  const rawMs = finiteNumber(source.autoSettleAfterMs);
  const afterDays = rawDays === null
    ? 0
    : Math.max(0, Math.min(AUTO_SETTLE_MAX_DAYS, Math.floor(rawDays)));
  const afterMs = afterDays <= 0
    ? 0
    : Math.max(1, Math.min(AUTO_SETTLE_MAX_DAYS * DAY_MS, Math.floor(rawMs && rawMs > 0 ? rawMs : afterDays * DAY_MS)));
  const customDate = strictDateParts(source.autoSettleCustomDate)
    ? String(source.autoSettleCustomDate)
    : null;
  const customCutoffAt = customDate && finiteNumber(source.autoSettleCustomCutoffAt)
    ? Number(source.autoSettleCustomCutoffAt)
    : null;
  const activationAt = afterMs > 0 && finiteNumber(source.autoSettleActivationAt) && Number(source.autoSettleActivationAt) > 0
    ? Number(source.autoSettleActivationAt)
    : null;
  if (afterMs <= 0) {
    return { afterDays: 0, afterMs: 0, customDate: null, customCutoffAt: null, activationAt: null, mode: 'never' };
  }
  return {
    afterDays,
    afterMs,
    customDate,
    customCutoffAt,
    activationAt,
    mode: customDate ? 'custom' : 'preset',
  };
}

export function getAutoSettleSettings(now = Date.now()): AutoSettleSettings {
  const session = ((getConfig().getConfig() as any)?.session || {}) as Record<string, any>;
  return normalizePersistedSettings(session, now);
}

export function getAutoSettleClientSettings(now = Date.now()): Record<string, unknown> {
  const settings = getAutoSettleSettings(now);
  return {
    ...settings,
    enabled: settings.afterMs > 0,
    effectiveCutoffAt: settings.afterMs > 0 ? now - settings.afterMs : null,
  };
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function hasAutoSettleInput(value: unknown): boolean {
  if (!isObject(value)) return false;
  return ['afterDays', 'customDate', 'activationMode', 'customDateOffsetMinutes'].some((key) => (
    Object.prototype.hasOwnProperty.call(value, key)
  ));
}

export function resolveAutoSettleUpdate(input: unknown, now = Date.now()): AutoSettleUpdate {
  if (!isObject(input)) throw new AutoSettleSettingsError('Auto-settle settings must be an object.');
  const rawAfter = input.afterDays;
  const afterText = String(rawAfter ?? '').trim().toLowerCase();
  const isNever = rawAfter === 0 || afterText === '0' || afterText === 'never';
  if (isNever) {
    return {
      settings: { afterDays: 0, afterMs: 0, customDate: null, customCutoffAt: null, activationAt: null, mode: 'never' },
      persisted: {
        autoSettleAfterDays: 0,
        autoSettleAfterMs: 0,
        autoSettleCustomDate: undefined,
        autoSettleCustomCutoffAt: undefined,
        autoSettleActivationAt: undefined,
      },
      applyExisting: false,
      immediateCutoffAt: null,
    };
  }

  const activationMode: AutoSettleActivationMode = input.activationMode === 'apply_existing'
    ? 'apply_existing'
    : 'start_now';
  const wantsCustom = afterText === 'custom' || String(input.customDate || '').trim().length > 0;
  if (wantsCustom) {
    const customDate = String(input.customDate || '').trim();
    const timezoneOffsetMinutes = normalizeTimezoneOffset(input.customDateOffsetMinutes);
    const customCutoffAt = customDateToCutoffAt(customDate, timezoneOffsetMinutes);
    const todayStartAt = localDayStartAt(now, timezoneOffsetMinutes);
    if (customCutoffAt >= todayStartAt) {
      throw new AutoSettleSettingsError('Choose a custom date before today; same-day auto-settle is intentionally blocked for safety.');
    }
    const afterMs = now - customCutoffAt;
    if (!Number.isFinite(afterMs) || afterMs <= 0 || afterMs > AUTO_SETTLE_MAX_DAYS * DAY_MS) {
      throw new AutoSettleSettingsError(`Custom auto-settle dates must be within ${AUTO_SETTLE_MAX_DAYS} days.`);
    }
    const afterDays = Math.max(1, Math.min(AUTO_SETTLE_MAX_DAYS, Math.ceil(afterMs / DAY_MS)));
    const settings: AutoSettleSettings = {
      afterDays,
      afterMs: Math.floor(afterMs),
      customDate,
      customCutoffAt,
      activationAt: activationMode === 'start_now' ? now : null,
      mode: 'custom',
    };
    return {
      settings,
      persisted: {
        autoSettleAfterDays: settings.afterDays,
        autoSettleAfterMs: settings.afterMs,
        autoSettleCustomDate: settings.customDate,
        autoSettleCustomCutoffAt: settings.customCutoffAt,
        autoSettleActivationAt: settings.activationAt || undefined,
      },
      applyExisting: activationMode === 'apply_existing',
      immediateCutoffAt: activationMode === 'apply_existing' ? customCutoffAt : null,
    };
  }

  const days = finiteNumber(rawAfter);
  if (days === null || !AUTO_SETTLE_PRESET_DAYS.includes(Math.floor(days) as (typeof AUTO_SETTLE_PRESET_DAYS)[number]) || Math.floor(days) <= 0) {
    throw new AutoSettleSettingsError('Auto-settle must be Never, 7, 14, 30, 90 days, or Custom.');
  }
  const afterDays = Math.floor(days);
  const afterMs = afterDays * DAY_MS;
  const settings: AutoSettleSettings = {
    afterDays,
    afterMs,
    customDate: null,
    customCutoffAt: null,
    activationAt: activationMode === 'start_now' ? now : null,
    mode: 'preset',
  };
  return {
    settings,
    persisted: {
      autoSettleAfterDays: afterDays,
      autoSettleAfterMs: afterMs,
      autoSettleCustomDate: undefined,
      autoSettleCustomCutoffAt: undefined,
      autoSettleActivationAt: settings.activationAt || undefined,
    },
    applyExisting: activationMode === 'apply_existing',
    immediateCutoffAt: activationMode === 'apply_existing' ? now - afterMs : null,
  };
}

function getLastRunPath(): string {
  return path.join(getConfig().getConfigDir(), LAST_RUN_RELATIVE_PATH);
}

let lastRunLoaded = false;
let lastRun: AutoSettleRunSummary | null = null;

function loadLastRun(): AutoSettleRunSummary | null {
  if (lastRunLoaded) return lastRun;
  lastRunLoaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(getLastRunPath(), 'utf-8'));
    if (parsed && typeof parsed === 'object' && typeof parsed.runId === 'string') lastRun = parsed as AutoSettleRunSummary;
  } catch {
    lastRun = null;
  }
  return lastRun;
}

function persistLastRun(summary: AutoSettleRunSummary): void {
  lastRun = summary;
  lastRunLoaded = true;
  try {
    const target = getLastRunPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(summary, null, 2), 'utf-8');
    fs.renameSync(tmp, target);
  } catch (error: any) {
    console.warn('[AutoSettle] Could not persist run summary:', error?.message || error);
  }
}

export function getAutoSettleStatus(now = Date.now()): { settings: Record<string, unknown>; lastRun: AutoSettleRunSummary | null } {
  return { settings: getAutoSettleClientSettings(now), lastRun: loadLastRun() };
}

function protectedScheduledSessionIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const scheduler = getCronSchedulerInstance();
    const jobs = scheduler?.getJobs() || [];
    for (const job of jobs) {
      const outputId = String(job.lastOutputSessionId || '').trim();
      if (outputId) ids.add(outputId);
      const active = job.enabled === true && ['scheduled', 'queued', 'running'].includes(String(job.status || ''));
      if (active && job.sessionTarget === 'main') ids.add(String(getLastMainSessionId() || 'default').trim() || 'default');
    }
  } catch {
    // A missing scheduler is not a reason to fail the entire sweep. Active
    // tasks/runtimes are still checked by the settlement guard.
  }
  return ids;
}

function addSkip(summary: AutoSettleRunSummary, code: string): void {
  summary.skipped[code] = (summary.skipped[code] || 0) + 1;
}

function newRunSummary(options: {
  settings: AutoSettleSettings;
  reason: string;
  dryRun: boolean;
  cutoffAt: number | null;
  maxBatches: number;
}): AutoSettleRunSummary {
  return {
    runId: `autosettle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
    completedAt: 0,
    reason: options.reason,
    dryRun: options.dryRun,
    disabled: options.cutoffAt === null,
    afterDays: options.settings.afterDays,
    cutoffAt: options.cutoffAt,
    activationAt: options.settings.activationAt,
    scanned: 0,
    eligible: 0,
    wouldSettle: 0,
    settled: 0,
    skipped: {},
    errors: 0,
    batchSize: AUTO_SETTLE_BATCH_SIZE,
    maxBatches: options.maxBatches,
    batches: 0,
    truncated: false,
    sessionIds: [],
  };
}

async function executeAutoSettleSweep(options: {
  dryRun?: boolean;
  reason?: string;
  cutoffAtOverride?: number;
  settingsOverride?: AutoSettleSettings;
  maxBatches?: number;
} = {}): Promise<AutoSettleRunSummary> {
  const now = Date.now();
  const settings = options.settingsOverride || getAutoSettleSettings(now);
  const cutoffAt = Number.isFinite(Number(options.cutoffAtOverride))
    ? Number(options.cutoffAtOverride)
    : settings.afterMs > 0 ? now - settings.afterMs : null;
  const maxBatches = Math.max(1, Math.min(AUTO_SETTLE_MAX_BATCHES_PER_RUN, Math.floor(Number(options.maxBatches) || 1)));
  const summary = newRunSummary({
    settings,
    reason: String(options.reason || 'scheduled'),
    dryRun: options.dryRun === true,
    cutoffAt,
    maxBatches,
  });
  if (cutoffAt === null) {
    summary.completedAt = Date.now();
    return summary;
  }

  // Read one sentinel candidate beyond the work budget so the result can
  // explain that another bounded run is needed. The query is keyset/ordered
  // rather than offset-paginated, so a concurrent settle cannot make later
  // rows disappear behind an offset.
  const candidateLimit = AUTO_SETTLE_BATCH_SIZE * maxBatches + 1;
  const candidates = listAutoSettleCandidates({
    cutoffAt,
    activationAt: settings.activationAt || undefined,
    limit: candidateLimit,
  });
  const runtimeRecords = listLiveRuntimes();
  const scheduledSessionIds = protectedScheduledSessionIds();
  let cursor = 0;
  while (cursor < candidates.length && summary.batches < maxBatches) {
    const batch = candidates.slice(cursor, cursor + AUTO_SETTLE_BATCH_SIZE);
    cursor += batch.length;
    summary.batches += 1;
    for (const candidate of batch) {
      summary.scanned += 1;
      const sessionId = String(candidate.id || '').trim();
      try {
        const session = getSession(sessionId);
        const expectedLastActiveAt = Number(session.lastActiveAt || session.createdAt || 0);
        const projectSessionIds = findProjectBySessionId(sessionId) ? new Set([sessionId]) : new Set<string>();
        const guardOptions = {
          automatic: true,
          expectedLastActiveAt,
          cutoffAt,
          activationAt: settings.activationAt || undefined,
          projectSessionIds,
          scheduledSessionIds,
          runtimeRecords,
        };
        const blockers = getSessionSettlementBlockers(sessionId, guardOptions);
        if (blockers.length) {
          for (const blocker of blockers) addSkip(summary, blocker.code);
          continue;
        }
        summary.eligible += 1;
        if (options.dryRun === true) {
          summary.wouldSettle += 1;
          if (summary.sessionIds.length < 100) summary.sessionIds.push(sessionId);
          continue;
        }
        const settled = settleSessionWithGuards(sessionId, guardOptions);
        if (settled?.settled === true) {
          summary.settled += 1;
          if (summary.sessionIds.length < 100) summary.sessionIds.push(sessionId);
          broadcastWS({
            type: 'session_state_changed',
            sessionId,
            state: 'settled',
            session: settled,
            source: 'auto',
            reason: 'untouched',
            undoAvailable: true,
          });
        }
      } catch (error: any) {
        if (error instanceof SessionSettlementError) {
          addSkip(summary, error.code);
        } else {
          summary.errors += 1;
        }
      }
    }
    if (cursor < candidates.length) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  summary.truncated = cursor < candidates.length;
  summary.completedAt = Date.now();
  persistLastRun(summary);
  broadcastWS({ type: 'auto_settle_run', summary });
  return summary;
}

let activeSweep: Promise<AutoSettleRunSummary> | null = null;

export function runAutoSettleSweep(options: {
  dryRun?: boolean;
  reason?: string;
  cutoffAtOverride?: number;
  settingsOverride?: AutoSettleSettings;
  maxBatches?: number;
} = {}): Promise<AutoSettleRunSummary> {
  if (activeSweep) return activeSweep;
  const run = executeAutoSettleSweep(options);
  activeSweep = run.finally(() => {
    activeSweep = null;
  });
  return activeSweep;
}

let schedulerInterval: NodeJS.Timeout | null = null;
let schedulerInitialRun: NodeJS.Timeout | null = null;

function schedulerIntervalMs(): number {
  const configuredMinutes = Number(process.env.PROMETHEUS_AUTO_SETTLE_INTERVAL_MINUTES || 15);
  if (!Number.isFinite(configuredMinutes) || configuredMinutes <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Math.floor(configuredMinutes * 60 * 1000)));
}

export function startAutoSettleScheduler(): void {
  if (schedulerInterval) return;
  const tick = () => {
    runAutoSettleSweep({ reason: 'scheduled', maxBatches: 1 }).catch((error: any) => {
      console.warn('[AutoSettle] Scheduled sweep failed:', error?.message || error);
    });
  };
  schedulerInitialRun = setTimeout(tick, 5000);
  schedulerInitialRun.unref?.();
  schedulerInterval = setInterval(tick, schedulerIntervalMs());
  schedulerInterval.unref?.();
  console.log(`[AutoSettle] Scheduler started; checking every ${Math.round(schedulerIntervalMs() / 60000)} minute(s).`);
}

export function stopAutoSettleScheduler(): void {
  if (schedulerInitialRun) clearTimeout(schedulerInitialRun);
  if (schedulerInterval) clearInterval(schedulerInterval);
  schedulerInitialRun = null;
  schedulerInterval = null;
}
