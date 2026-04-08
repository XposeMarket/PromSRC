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
 *   approvalStatus?: 'auto' | 'approved' | 'rejected' | 'pending'
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
    fs.appendFileSync(logPath, JSON.stringify(full) + '\n', 'utf-8');
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
  status?: 'auto' | 'approved' | 'rejected' | 'pending';
  /** Max number of entries to return (default 200) */
  limit?: number;
  /** Page offset (default 0) */
  offset?: number;
  /** Keep only non-main agent runs */
  nonMainOnly?: boolean;
}

function isNonMainEntry(e: AuditLogEntry): boolean {
  const aid = String(e.agentId || '').toLowerCase();
  if (aid && aid !== 'main' && aid !== 'unknown') return true;
  const sid = String(e.sessionId || '');
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

/**
 * Read audit log entries, most-recent first, with optional filtering.
 */
export function queryAuditLog(opts: AuditQueryOptions = {}): {
  entries: AuditLogEntry[];
  total: number;
  hasMore: boolean;
} {
  const logPath = getOrInitLogPath();
  if (!fs.existsSync(logPath)) {
    return { entries: [], total: 0, hasMore: false };
  }

  const lines = fs.readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter(l => l.trim());

  const allEntries: AuditLogEntry[] = [];
  for (const line of lines) {
    try {
      allEntries.push(JSON.parse(line) as AuditLogEntry);
    } catch { /* skip malformed lines */ }
  }

  // Reverse so newest first
  allEntries.reverse();

  // Filter
  const filtered = allEntries.filter(e => {
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
export function maybeRotateLog(maxLines = 10_000): void {
  try {
    const logPath = getOrInitLogPath();
    if (!fs.existsSync(logPath)) return;
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(l => l.trim());
    if (lines.length <= maxLines) return;
    const trimmed = lines.slice(lines.length - maxLines);
    fs.writeFileSync(logPath, trimmed.join('\n') + '\n', 'utf-8');
    console.log(`[AuditLog] Rotated log to ${trimmed.length} entries`);
  } catch { /* best-effort */ }
}
