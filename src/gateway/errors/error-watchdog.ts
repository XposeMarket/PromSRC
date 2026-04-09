/**
 * error-watchdog.ts — Phase 2: Proactive Self-Repair Watchdog
 *
 * Monitors task failures for errors that point to source code bugs.
 * When a task fails with a stack trace pointing to src/ or dist/ paths,
 * automatically triggers self-repair analysis and sends a Telegram notification.
 *
 * Also tracks error frequency: if the same error occurs 3+ times,
 * auto-escalates with a repair proposal.
 *
 * This closes the "proactive self-repair detection" gap identified in the analysis.
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { getErrorHistory } from './error-history';
import type { TaskRecord } from '../tasks/task-store';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WatchdogErrorEntry {
  id: string;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrences: number;
  errorFingerprint: string;    // normalized error signature
  sourceFile: string | null;   // detected src/ file from stack trace
  sourceLine: number | null;
  sampleError: string;         // first occurrence full text
  taskIds: string[];           // tasks that hit this error
  repairProposed: boolean;
  repairId?: string;
}

export interface WatchdogState {
  errors: WatchdogErrorEntry[];
  lastCheckedAt: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const AUTO_ESCALATE_THRESHOLD = 3;   // same error N times → auto-propose repair
const MAX_WATCHDOG_ERRORS = 100;
const FINGERPRINT_MAX_LENGTH = 200;

// ─── Source Error Detection ────────────────────────────────────────────────────

/**
 * Determines if an error message/stack trace points to Prometheus source code.
 * Returns file path and line if detected.
 */
export function detectSourceError(errorText: string): {
  isSourceError: boolean;
  sourceFile: string | null;
  sourceLine: number | null;
  errorType: string;
} {
  const text = String(errorText || '');

  // Look for dist/ or src/ paths in stack traces
  // e.g. "at Object.<anonymous> (D:\Prometheus\dist\gateway\server-v2.js:450:12)"
  const stackPatterns = [
    /(?:dist|src)[\/\\]([a-zA-Z0-9_\-\/\\]+\.(?:ts|js)):(\d+)/,
    /at .+ \(.*(?:dist|src)[\/\\]([^:]+):(\d+):\d+\)/,
    /(?:gateway|agents|tools|orchestration|config|providers)[\/\\]([^:]+\.(?:ts|js)):(\d+)/,
  ];

  for (const pattern of stackPatterns) {
    const match = text.match(pattern);
    if (match) {
      // Normalize dist/ → src/ and .js → .ts
      const rawFile = match[1].replace(/\\/g, '/');
      const sourcePath = rawFile.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      const lineNum = parseInt(match[2], 10) || null;

      return {
        isSourceError: true,
        sourceFile: sourcePath,
        sourceLine: lineNum,
        errorType: detectErrorType(text),
      };
    }
  }

  // Check for common runtime errors that are likely source bugs
  const runtimeBugPatterns = [
    /TypeError: Cannot read propert/i,
    /TypeError: .+ is not a function/i,
    /ReferenceError:/i,
    /SyntaxError:/i,
    /TypeError: Cannot set propert/i,
  ];

  const isRuntimeBug = runtimeBugPatterns.some(p => p.test(text));

  return {
    isSourceError: isRuntimeBug,
    sourceFile: null,
    sourceLine: null,
    errorType: detectErrorType(text),
  };
}

function detectErrorType(text: string): string {
  if (/TypeError/i.test(text)) return 'TypeError';
  if (/ReferenceError/i.test(text)) return 'ReferenceError';
  if (/SyntaxError/i.test(text)) return 'SyntaxError';
  if (/ENOENT/i.test(text)) return 'FileNotFound';
  if (/ECONNREFUSED/i.test(text)) return 'ConnectionRefused';
  if (/EACCES/i.test(text)) return 'PermissionDenied';
  if (/timeout/i.test(text)) return 'Timeout';
  if (/out of memory/i.test(text)) return 'OOM';
  return 'UnknownError';
}

/**
 * Build a normalized fingerprint for deduplicating errors.
 * Strips memory addresses, timestamps, UUIDs, and job IDs.
 */
export function buildErrorFingerprint(errorText: string): string {
  return errorText
    .slice(0, 500)
    // Strip hex addresses like 0x7f3a4b2c
    .replace(/0x[0-9a-f]+/gi, '0xADDR')
    // Strip UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
    // Strip timestamps
    .replace(/\d{13}/g, 'TS')
    // Strip line numbers in stack traces (vary across builds)
    .replace(/:(\d+):(\d+)\)/g, ':LINE:COL)')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FINGERPRINT_MAX_LENGTH);
}

// ─── Watchdog State Store ──────────────────────────────────────────────────────

function getWatchdogStatePath(): string {
  let base: string;
  try {
    base = getConfig().getConfigDir();
  } catch {
    base = path.join(process.cwd(), '.prometheus');
  }
  return path.join(base, 'error-watchdog.json');
}

export function loadWatchdogState(): WatchdogState {
  const p = getWatchdogStatePath();
  if (!fs.existsSync(p)) return { errors: [], lastCheckedAt: 0 };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as WatchdogState;
  } catch {
    return { errors: [], lastCheckedAt: 0 };
  }
}

function saveWatchdogState(state: WatchdogState): void {
  fs.writeFileSync(getWatchdogStatePath(), JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Core Watchdog Logic ───────────────────────────────────────────────────────

export interface WatchdogDecision {
  action: 'none' | 'notify' | 'auto_escalate';
  message: string;
  sourceFile: string | null;
  sourceLine: number | null;
  errorEntry: WatchdogErrorEntry | null;
  shouldTriggerRepair: boolean;
}

/**
 * Main entry point: called when a task fails.
 * Analyzes the error, tracks frequency, and decides what action to take.
 */
export function processTaskFailure(
  task: TaskRecord,
  errorText: string,
): WatchdogDecision {
  const detection = detectSourceError(errorText);
  const fingerprint = buildErrorFingerprint(errorText);

  // Load current watchdog state
  const state = loadWatchdogState();

  // Find or create error entry
  let entry = state.errors.find(e => e.errorFingerprint === fingerprint);

  if (!entry) {
    entry = {
      id: `we_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      occurrences: 1,
      errorFingerprint: fingerprint,
      sourceFile: detection.sourceFile,
      sourceLine: detection.sourceLine,
      sampleError: errorText.slice(0, 800),
      taskIds: [task.id],
      repairProposed: false,
    };
    state.errors.push(entry);
  } else {
    entry.lastSeenAt = Date.now();
    entry.occurrences++;
    if (!entry.taskIds.includes(task.id)) {
      entry.taskIds = [...entry.taskIds, task.id].slice(-10);
    }
  }

  // Trim state
  if (state.errors.length > MAX_WATCHDOG_ERRORS) {
    state.errors = state.errors
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, MAX_WATCHDOG_ERRORS);
  }

  state.lastCheckedAt = Date.now();
  saveWatchdogState(state);

  // Decide what action to take
  if (!detection.isSourceError && entry.occurrences < AUTO_ESCALATE_THRESHOLD) {
    return {
      action: 'none',
      message: '',
      sourceFile: null,
      sourceLine: null,
      errorEntry: entry,
      shouldTriggerRepair: false,
    };
  }

  // Source bug detected on first occurrence → notify
  if (detection.isSourceError && entry.occurrences === 1) {
    const file = detection.sourceFile ? `src/${detection.sourceFile.replace(/^src\//, '')}` : 'unknown file';
    const lineInfo = detection.sourceLine ? ` (line ${detection.sourceLine})` : '';
    const message = `🔍 Task "${task.title}" failed with what looks like a source bug in ${file}${lineInfo}.\n\nError: ${errorText.slice(0, 300)}\n\nWant me to analyze it and propose a fix?`;

    return {
      action: 'notify',
      message,
      sourceFile: detection.sourceFile,
      sourceLine: detection.sourceLine,
      errorEntry: entry,
      shouldTriggerRepair: false,
    };
  }

  // Same error 3+ times → auto-escalate with repair proposal
  if (entry.occurrences >= AUTO_ESCALATE_THRESHOLD && !entry.repairProposed) {
    const file = detection.sourceFile ? `src/${detection.sourceFile.replace(/^src\//, '')}` : 'unknown';
    const message = `⚠️ Error has occurred ${entry.occurrences} times across ${entry.taskIds.length} task(s).\n\nFile: ${file}\nError pattern: ${errorText.slice(0, 200)}\n\nThis recurring error is now being automatically analyzed for a self-repair proposal.`;

    return {
      action: 'auto_escalate',
      message,
      sourceFile: detection.sourceFile,
      sourceLine: detection.sourceLine,
      errorEntry: entry,
      shouldTriggerRepair: true,
    };
  }

  return {
    action: 'none',
    message: '',
    sourceFile: null,
    sourceLine: null,
    errorEntry: entry,
    shouldTriggerRepair: false,
  };
}

/**
 * Mark a watchdog error entry as having had a repair proposed.
 */
export function markRepairProposed(errorFingerprint: string, repairId: string): void {
  const state = loadWatchdogState();
  const entry = state.errors.find(e => e.errorFingerprint === errorFingerprint);
  if (entry) {
    entry.repairProposed = true;
    entry.repairId = repairId;
    saveWatchdogState(state);
  }
}

/**
 * Build a self-repair trigger prompt for auto-escalation cases.
 * This prompt is sent to handleChat to trigger the read_source + propose_repair flow.
 */
export function buildSelfRepairTriggerPrompt(
  errorText: string,
  sourceFile: string | null,
  sourceLine: number | null,
  taskTitle: string,
): string {
  const fileInfo = sourceFile
    ? `The stack trace points to: ${sourceFile}${sourceLine ? ` around line ${sourceLine}` : ''}.`
    : 'No specific file was identified in the stack trace.';

  return `A recurring source code bug has been detected. This error has now occurred ${AUTO_ESCALATE_THRESHOLD}+ times.

Task that failed: "${taskTitle}"
${fileInfo}

Full error:
${errorText.slice(0, 600)}

Your job:
1. Use read_source to read the relevant file(s) near the error location
2. Identify the root cause of the bug
3. Use propose_repair to generate a patch and send it for approval

Do NOT just describe the error. Use the tools to actually look at the code and propose a fix.
After proposing the repair, summarize what you found and what the fix does.`;
}

/**
 * Get a summary of recurring errors for display in the web UI or Telegram.
 */
export function getErrorWatchdogSummary(): {
  totalTracked: number;
  sourceErrors: number;
  recurring: number;
  repairsProposed: number;
  topErrors: Array<{ file: string | null; count: number; lastSeen: string }>;
} {
  const state = loadWatchdogState();
  const sourceErrors = state.errors.filter(e => e.sourceFile !== null);
  const recurring = state.errors.filter(e => e.occurrences >= AUTO_ESCALATE_THRESHOLD);
  const repairsProposed = state.errors.filter(e => e.repairProposed);

  const topErrors = state.errors
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 5)
    .map(e => ({
      file: e.sourceFile,
      count: e.occurrences,
      lastSeen: new Date(e.lastSeenAt).toISOString(),
    }));

  return {
    totalTracked: state.errors.length,
    sourceErrors: sourceErrors.length,
    recurring: recurring.length,
    repairsProposed: repairsProposed.length,
    topErrors,
  };
}
