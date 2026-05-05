/**
 * brain/brain-state.ts
 *
 * Persistent state for the Brain system.
 * Manages two state files in workspace/Brain/state/:
 *   - latest.json  — cross-session state (last thought time, last dream date, etc.)
 *   - daily-status.json — resets each day: which thoughts ran, dream status
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrainLatestState {
  /** ISO timestamp of the last thought run */
  lastThoughtAt: string | null;
  /** ISO timestamp of the last thought attempt (success or fail) */
  lastThoughtAttemptAt: string | null;
  /** Last known thought outcome */
  lastThoughtStatus: 'idle' | 'success' | 'failed';
  /** Last thought failure error, if any */
  lastThoughtError: string | null;
  /** HH-mm label of the last thought window (e.g. "06-00") */
  lastThoughtWindow: string | null;
  /** YYYY-MM-DD local date of the last dream run */
  lastDreamDate: string | null;
  /** ISO timestamp of the last successful dream completion */
  lastDreamCompletedAt: string | null;
  /** ISO timestamp of the last dream attempt (success or fail) */
  lastDreamAttemptAt: string | null;
  /** YYYY-MM-DD local date the last dream attempt targeted */
  lastDreamAttemptDate: string | null;
  /** Last known dream outcome */
  lastDreamStatus: 'idle' | 'success' | 'failed';
  /** Last dream failure error, if any */
  lastDreamError: string | null;
  /** YYYY-MM-DD local date of the last completed dream cleanup pass */
  lastDreamCleanupDate: string | null;
  /** ISO timestamp of the last successful dream cleanup completion */
  lastDreamCleanupCompletedAt: string | null;
  /** ISO timestamp of the last dream cleanup attempt */
  lastDreamCleanupAttemptAt: string | null;
  /** YYYY-MM-DD local date the last dream cleanup attempt targeted */
  lastDreamCleanupAttemptDate: string | null;
  /** Last known dream cleanup outcome */
  lastDreamCleanupStatus: 'idle' | 'success' | 'failed';
  /** Last dream cleanup failure error, if any */
  lastDreamCleanupError: string | null;
  /** ISO timestamp when the current gateway session started */
  gatewayStartedAt: string;
  /** Proposal IDs submitted in the most recent dream (for dedup) */
  proposalDedupeIds: string[];
  /** Whether thought runs are enabled (default: true) */
  thoughtEnabled: boolean;
  /** Whether dream runs are enabled (default: true) */
  dreamEnabled: boolean;
  /** Model override for thought runs — plain model name e.g. "claude-sonnet-4-6" (empty = use primary) */
  thoughtModel: string;
  /** Model override for dream runs (empty = use primary) */
  dreamModel: string;
}

export interface BrainThoughtEntry {
  /** HH-mm label of the window start (e.g. "06-00") */
  window: string;
  /** Relative path from workspace/Brain/ (e.g. "thoughts/2026-04-08/06-00-thought.md") */
  file: string;
  /** ISO timestamp when this thought completed */
  completedAt: string;
  /** Unique run ID for this thought */
  runId: string;
}

export interface BrainDailyStatus {
  /** YYYY-MM-DD local date this status covers */
  date: string;
  /** All thought runs completed today */
  thoughts: BrainThoughtEntry[];
  /** Whether the dream has run today */
  dreamRan: boolean;
  /** Relative path of today's dream file, or null */
  dreamFile: string | null;
  /** ISO timestamp when today's dream completed, or null */
  dreamCompletedAt: string | null;
  /** Whether the second-pass dream cleanup has run today */
  dreamCleanupRan: boolean;
  /** Relative path of today's dream cleanup file, or null */
  dreamCleanupFile: string | null;
  /** ISO timestamp when today's dream cleanup completed, or null */
  dreamCleanupCompletedAt: string | null;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

export function getBrainDir(): string {
  return path.join(getConfig().getWorkspacePath(), 'Brain');
}

export function ensureBrainDirs(): void {
  const base = getBrainDir();
  for (const sub of ['thoughts', 'dreams', 'state', path.join('state', 'daily')]) {
    fs.mkdirSync(path.join(base, sub), { recursive: true });
  }
}

// ─── Atomic write helper ──────────────────────────────────────────────────────

function safeWrite(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

// ─── Latest state ─────────────────────────────────────────────────────────────

function getLatestStatePath(): string {
  return path.join(getBrainDir(), 'state', 'latest.json');
}

function defaultLatestState(): BrainLatestState {
  return {
    lastThoughtAt: null,
    lastThoughtAttemptAt: null,
    lastThoughtStatus: 'idle',
    lastThoughtError: null,
    lastThoughtWindow: null,
    lastDreamDate: null,
    lastDreamCompletedAt: null,
    lastDreamAttemptAt: null,
    lastDreamAttemptDate: null,
    lastDreamStatus: 'idle',
    lastDreamError: null,
    lastDreamCleanupDate: null,
    lastDreamCleanupCompletedAt: null,
    lastDreamCleanupAttemptAt: null,
    lastDreamCleanupAttemptDate: null,
    lastDreamCleanupStatus: 'idle',
    lastDreamCleanupError: null,
    gatewayStartedAt: new Date().toISOString(),
    proposalDedupeIds: [],
    thoughtEnabled: true,
    dreamEnabled: true,
    thoughtModel: '',
    dreamModel: '',
  };
}

export function loadLatestState(): BrainLatestState {
  try {
    const p = getLatestStatePath();
    if (!fs.existsSync(p)) return defaultLatestState();
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return { ...defaultLatestState(), ...raw };
  } catch {
    return defaultLatestState();
  }
}

export function saveLatestState(state: BrainLatestState): void {
  safeWrite(getLatestStatePath(), state);
}

export function markGatewayStarted(): void {
  const state = loadLatestState();
  state.gatewayStartedAt = new Date().toISOString();
  saveLatestState(state);
}

// ─── Daily status ─────────────────────────────────────────────────────────────

function getLegacyDailyStatusPath(): string {
  return path.join(getBrainDir(), 'state', 'daily-status.json');
}

function getDailyStatusPath(date: string): string {
  return path.join(getBrainDir(), 'state', 'daily', `${date}.json`);
}

function defaultDailyStatus(date: string): BrainDailyStatus {
  return {
    date,
    thoughts: [],
    dreamRan: false,
    dreamFile: null,
    dreamCompletedAt: null,
    dreamCleanupRan: false,
    dreamCleanupFile: null,
    dreamCleanupCompletedAt: null,
  };
}

export function loadDailyStatus(date: string): BrainDailyStatus {
  try {
    const nextPath = getDailyStatusPath(date);
    if (fs.existsSync(nextPath)) {
      const stored = JSON.parse(fs.readFileSync(nextPath, 'utf-8')) as BrainDailyStatus;
      return { ...defaultDailyStatus(date), ...stored, date };
    }

    const legacyPath = getLegacyDailyStatusPath();
    if (!fs.existsSync(legacyPath)) return defaultDailyStatus(date);
    const stored = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')) as BrainDailyStatus;
    if (stored.date !== date) return defaultDailyStatus(date);
    return { ...defaultDailyStatus(date), ...stored, date };
  } catch {
    return defaultDailyStatus(date);
  }
}

export function saveDailyStatus(status: BrainDailyStatus): void {
  safeWrite(getDailyStatusPath(status.date), status);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Returns local date as YYYY-MM-DD */
export function getLocalDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Returns HH-mm label for a window start time */
export function getWindowLabel(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}-${m}`;
}

/** Format a Date as "YYYY-MM-DD HH:MM UTC" */
export function fmtUtc(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** Format a Date as "YYYY-MM-DD HH:MM local" */
export function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day} ${h}:${mi} local`;
}
