/**
 * audit-log.ts — Phase 5 Audit Log
 *
 * Appends every tool call (and its policy tier, approval status, result)
 * to workspace/.prometheus/audit-log.jsonl — one JSON object per line.
 *
 * The log is queryable by the UI via /api/audit-log (GET with filters).
 *
 * Format of each line (AuditLogEntry from types.ts):
 * {
 *   timestamp:      ISO string
 *   sessionId:      chat/agent session
 *   agentId?:       which sub-agent (if any)
 *   actionType:     'tool_call' | 'message_sent' | 'file_written' | 'approval_requested' | 'approval_resolved'
 *   toolName?:      name of the tool
 *   toolArgs?:      args (scrubbed of secrets)
 *   policyTier?:    'read' | 'propose' | 'commit'
 *   approvalStatus?: 'auto' | 'auto_allowed' | 'approved' | 'rejected' | 'pending'
 *   resultSummary?: short string summary of the result
 *   error?:         error message if the call failed
 * }
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config.js';
import { AuditLogEntry } from '../types.js';

// ─── Paths ───────────────────────────────────────────────────────────────────

function getAuditLogPath(): string {
  try {
    const config = getConfig();
    const dataDir = config.getConfigDir();
    return path.join(dataDir, 'audit-log.jsonl');
  } catch {
    // Fallback if config not yet initialised
    return path.join(process.cwd(), '.prometheus', 'audit-log.jsonl');
  }
}

// ─── Secret scrubbing ────────────────────────────────────────────────────────

const SECRET_KEYS = new Set([
  'password', 'token', 'secret', 'api_key', 'apikey',
  'auth', 'authorization', 'credential', 'private_key',
  'access_token', 'refresh_token', 'client_secret',
]);

function scrubArgs(args: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!args || typeof args !== 'object') return args;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(args)) {
    const lk = k.toLowerCase();
    if ([...SECRET_KEYS].some(s => lk.includes(s))) {
      out[k] = '***';
    } else if (typeof v === 'string' && v.length > 500) {
      out[k] = v.slice(0, 500) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Writer ──────────────────────────────────────────────────────────────────

let _logPath: string | null = null;
let _lastRotationCheckAt = 0;
let _rotationInProgress = false;
let _rotationPendingLines: string[] = [];

// Tool calls can be very frequent during a long turn. Reading and splitting
// the entire audit log after every call made that normal path synchronous and
// increasingly expensive as the log grew. Check cheaply and infrequently;
// only perform the full read when the file is genuinely large.
const AUDIT_ROTATION_CHECK_INTERVAL_MS = 60_000;
const AUDIT_ROTATION_SIZE_THRESHOLD_BYTES = 32 * 1024 * 1024;

function getOrInitLogPath(): string {
  if (_logPath) return _logPath;
  _logPath = getAuditLogPath();
  try {
    fs.mkdirSync(path.dirname(_logPath), { recursive: true });
  } catch { /* ok */ }
  return _logPath;
}

/**
 * Append a single audit entry to the JSONL log file.
 * Fire-and-forget: errors are silently swallowed so they never break
 * a running tool call.
 */
export function appendAuditEntry(entry: Partial<AuditLogEntry>): void {
  try {
    const full: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: entry.sessionId || 'unknown',
      agentId: entry.agentId,
      actionType: entry.actionType || 'tool_call',
      toolName: entry.toolName,
      toolArgs: scrubArgs(entry.toolArgs),
      policyTier: entry.policyTier,
      approvalStatus: entry.approvalStatus,
      resultSummary: entry.resultSummary
        ? String(entry.resultSummary).slice(0, 300)
        : undefined,
      error: entry.error ? String(entry.error).slice(0, 300) : undefined,
    };
    const logPath = getOrInitLogPath();
    const line = `${JSON.stringify(full)}\n`;
    if (_rotationInProgress) {
      // Rotation is a short, bounded maintenance window. Preserve every entry
      // that arrives while the old file is being replaced, then flush them to
      // the new file. A byte cap here silently lost audit records under heavy
      // tool traffic, which is worse than a transient memory increase.
      _rotationPendingLines.push(line);
      return;
    }
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch {
    // Never throw — audit log is best-effort
  }
}

// ─── Reader / query ──────────────────────────────────────────────────────────

export interface AuditQueryOptions {
  /** ISO date string lower bound (inclusive) */
  from?: string;
  /** ISO date string upper bound (inclusive) */
  to?: string;
  /** Filter by agentId */
  agentId?: string;
  /** Filter by toolName (partial match) */
  toolName?: string;
  /** Filter by policyTier */
  tier?: 'read' | 'propose' | 'commit';
  /** Filter by approvalStatus */
  status?: 'auto' | 'auto_allowed' | 'approved' | 'rejected' | 'pending';
  /** Max number of entries to return (default 200) */
  limit?: number;
  /** Page offset (default 0) */
  offset?: number;
  /** Keep only non-main agent runs */
  nonMainOnly?: boolean;
}

export interface AuditQueryResult {
  entries: AuditLogEntry[];
  total: number;
  hasMore: boolean;
}

function isNonMainEntry(e: AuditLogEntry): boolean {
  const aid = String(e.agentId || '').toLowerCase();
  if (aid && aid !== 'main' && aid !== 'unknown') return true;
  const sid = String(e.sessionId || '');
  const tool = String(e.toolName || '').toLowerCase();
  const action = String(e.actionType || '').toLowerCase();
  if (
    tool === 'request_dev_source_edit'
    || tool.startsWith('proposal_')
    || action === 'approval_requested'
    || action === 'approval_resolved'
  ) {
    return true;
  }
  return (
    sid.startsWith('team_')
    || sid.startsWith('task_')
    || sid.startsWith('bg_')
    || sid.startsWith('proposal_')
    || sid.startsWith('cron_')
    || sid.startsWith('schedule_')
    || sid.startsWith('meta_')
  );
}

function filterAuditEntries(allEntries: AuditLogEntry[], opts: AuditQueryOptions): AuditQueryResult {
  // Reverse a copy so newest entries are returned first without mutating a
  // caller-owned array.
  const newestFirst = allEntries.slice().reverse();
  const filtered = newestFirst.filter(e => {
    if (opts.from && e.timestamp < opts.from) return false;
    if (opts.to   && e.timestamp > opts.to)   return false;
    if (opts.agentId && e.agentId !== opts.agentId) return false;
    if (opts.toolName && !String(e.toolName || '').includes(opts.toolName)) return false;
    if (opts.tier   && e.policyTier !== opts.tier) return false;
    if (opts.status && e.approvalStatus !== opts.status) return false;
    if (opts.nonMainOnly && !isNonMainEntry(e)) return false;
    return true;
  });

  const limit  = Math.min(opts.limit  ?? 200, 500);
  const offset = opts.offset ?? 0;
  const page   = filtered.slice(offset, offset + limit);

  return {
    entries: page,
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
  };
}

function parseAuditEntries(contents: string): AuditLogEntry[] {
  const allEntries: AuditLogEntry[] = [];
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue;
    try {
      allEntries.push(JSON.parse(line) as AuditLogEntry);
    } catch { /* skip malformed lines */ }
  }
  return allEntries;
}

async function parseAuditEntriesAsync(contents: string): Promise<AuditLogEntry[]> {
  const allEntries: AuditLogEntry[] = [];
  const lines = contents.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim()) {
      try {
        allEntries.push(JSON.parse(line) as AuditLogEntry);
      } catch { /* skip malformed lines */ }
    }
    if (index > 0 && index % 512 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return allEntries;
}

/**
 * Read audit log entries, most-recent first, with optional filtering.
 * Synchronous form is retained for internal callers that explicitly need it.
 */
export function queryAuditLog(opts: AuditQueryOptions = {}): AuditQueryResult {
  const logPath = getOrInitLogPath();
  if (!fs.existsSync(logPath)) {
    return { entries: [], total: 0, hasMore: false };
  }
  return filterAuditEntries(parseAuditEntries(fs.readFileSync(logPath, 'utf-8')), opts);
}

/**
 * Non-blocking gateway-facing query path. File I/O is asynchronous and JSON
 * parsing yields periodically so a large audit page cannot monopolize the
 * gateway event loop.
 */
export async function queryAuditLogAsync(opts: AuditQueryOptions = {}): Promise<AuditQueryResult> {
  const logPath = getOrInitLogPath();
  let contents: string;
  try {
    contents = await fs.promises.readFile(logPath, 'utf-8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { entries: [], total: 0, hasMore: false };
    throw error;
  }
  const entries = await parseAuditEntriesAsync(contents);
  return filterAuditEntries(entries, opts);
}

/**
 * Return a short summary of the last N entries (for the UI log panel).
 */
export function getRecentAuditSummary(n = 50): AuditLogEntry[] {
  return queryAuditLog({ limit: n }).entries;
}

/**
 * Rotate the log — keep only the last `maxLines` entries.
 * Called automatically when the log exceeds 10 000 lines.
 */
async function flushRotationPending(logPath: string): Promise<void> {
  while (_rotationPendingLines.length > 0) {
    const lines = _rotationPendingLines;
    _rotationPendingLines = [];
    await fs.promises.appendFile(logPath, lines.join(''), 'utf8');
  }
}

async function rotateLogAsync(logPath: string, maxLines: number): Promise<void> {
  const temporaryPath = `${logPath}.${process.pid}.${Date.now()}.rotate.tmp`;
  try {
    const contents = await fs.promises.readFile(logPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.trim());
    if (lines.length > maxLines) {
      const trimmed = lines.slice(lines.length - maxLines);
      await fs.promises.writeFile(temporaryPath, `${trimmed.join('\n')}\n`, 'utf8');
      await fs.promises.rename(temporaryPath, logPath);
      console.log(`[AuditLog] Rotated log to ${trimmed.length} entries`);
    }
  } catch {
    // Best effort; rotation must never affect a running tool call.
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    try { await flushRotationPending(logPath); } catch { /* telemetry is best-effort */ }
    _rotationInProgress = false;
  }
}

export function maybeRotateLog(maxLines = 10_000): void {
  const defaultCall = arguments.length === 0;
  const now = Date.now();
  if (defaultCall) {
    if (now - _lastRotationCheckAt < AUDIT_ROTATION_CHECK_INTERVAL_MS) return;
    _lastRotationCheckAt = now;
  }
  if (_rotationInProgress) return;

  try {
    const logPath = getOrInitLogPath();
    const stat = fs.statSync(logPath);
    if (defaultCall && stat.size < AUDIT_ROTATION_SIZE_THRESHOLD_BYTES) return;

    if (defaultCall) {
      _rotationInProgress = true;
      void rotateLogAsync(logPath, maxLines);
      return;
    }

    _rotationInProgress = true;
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(l => l.trim());
    if (lines.length <= maxLines) return;
    const trimmed = lines.slice(lines.length - maxLines);
    fs.writeFileSync(logPath, trimmed.join('\n') + '\n', 'utf-8');
    console.log(`[AuditLog] Rotated log to ${trimmed.length} entries`);
  } catch { /* best-effort */
  } finally {
    _rotationInProgress = false;
  }
}
