import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getConfig } from '../../config/config';

/** Private executable state, not the bounded public launch receipt. */
export interface BackgroundExecutionEnvelope {
  version: 1;
  id: string;
  ownerPid: number;
  ownerToken: string;
  savedAt: number;
  record: Record<string, any>;
}
const ownerToken = crypto.randomUUID();
function root(): string { return path.join(getConfig().getConfigDir(), 'background-executions'); }
function target(id: string): string {
  if (!/^bg_[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid background execution ID');
  return path.join(root(), `${id}.json`);
}
function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return true; // unknown ownership fails closed
  try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code !== 'ESRCH'; }
}
export function saveBackgroundExecution(record: Record<string, any>): void {
  fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
  const file = target(record.id);
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const { promise, abortSignal, abortController, backgroundStream, ...serializable } = record;
  const envelope: BackgroundExecutionEnvelope = {
    version: 1, id: record.id, ownerPid: process.pid, ownerToken, savedAt: Date.now(), record: serializable,
  };
  let fd: number | undefined;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(envelope)); fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    // Never delete/copy over authoritative executable state.
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* preserve original error */ } }
    try { fs.unlinkSync(temp); } catch { /* renamed or failed creation */ }
  }
}
export function readBackgroundExecutions(): BackgroundExecutionEnvelope[] {
  let files: string[];
  try { files = fs.readdirSync(root()); } catch { return []; }
  const records: BackgroundExecutionEnvelope[] = [];
  for (const file of files.filter((name) => /^bg_[a-zA-Z0-9-]+\.json$/.test(name))) {
    try {
      const item = JSON.parse(fs.readFileSync(path.join(root(), file), 'utf8'));
      const r = item?.record;
      if (item.version !== 1 || item.id !== file.slice(0, -5) || r?.id !== item.id
        || !['queued', 'in_progress', 'completed', 'failed', 'timed_out'].includes(r.state)
        || typeof r.prompt !== 'string' || !r.prompt.trim() || !Number.isFinite(r.startedAt)
        || !Number.isFinite(r.timeoutMs) || !['wait_all', 'wait_until_timeout', 'best_effort_merge'].includes(r.joinPolicy)
        || !Array.isArray(r.toolCategories) || (r.toolCeiling !== undefined && (!Array.isArray(r.toolCeiling) || !r.toolCeiling.length))
        || !Array.isArray(r.outstandingTools) || typeof r.workDir !== 'string' || !path.isAbsolute(r.workDir)
        || !Number.isSafeInteger(item.ownerPid) || item.ownerPid < 1 || typeof item.ownerToken !== 'string' || !item.ownerToken
        || !r.toolCategories.every((v: any) => typeof v === 'string')
        || (r.toolCeiling !== undefined && !r.toolCeiling.every((v: any) => typeof v === 'string' && v.length > 0))
        || (r.allowedWorkPaths !== undefined && (!Array.isArray(r.allowedWorkPaths) || !r.allowedWorkPaths.every((v: any) => typeof v === 'string' && path.isAbsolute(v))))
        || (r.resourceIds !== undefined && (!Array.isArray(r.resourceIds) || !r.resourceIds.every((v: any) => typeof v === 'string')))
        || ['providerId', 'model', 'modelSource', 'reasoningEffort'].some((key) => r[key] !== undefined && typeof r[key] !== 'string')
        || (r.speed !== undefined && !['fast', 'standard'].includes(r.speed))
        || (r.continuationHistory !== undefined && (!Array.isArray(r.continuationHistory) || !r.continuationHistory.every((v: any) => v && typeof v.role === 'string')))
        || !r.outstandingTools.every((v: any) => v && typeof v.id === 'string' && typeof v.name === 'string')) continue;
      records.push(item);
    } catch { /* Corrupt/unsupported state is never executable. */ }
  }
  return records;
}
/** SQLite's process lock is automatically released even when a claimant dies. */
export function claimBackgroundExecution(item: BackgroundExecutionEnvelope): boolean {
  let db: import('better-sqlite3').Database | undefined;
  try {
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    db = new Database(path.join(root(), 'claims.sqlite'), { timeout: 1000 });
    db.exec('BEGIN IMMEDIATE');
    // The JSON envelope remains authoritative. Serialize the complete re-read,
    // owner-liveness check and atomic owner rewrite across replacement processes.
    const current = readBackgroundExecutions().find((entry) => entry.id === item.id);
    if (!current || current.ownerToken !== item.ownerToken || current.ownerPid !== item.ownerPid
      || alive(current.ownerPid)) return false;
    saveBackgroundExecution(current.record);
    db.exec('COMMIT');
    return true;
  } catch { return false; } // unknown/busy ownership is never permission to execute
  finally {
    if (db) {
      try { if (db.inTransaction) db.exec('ROLLBACK'); } catch { /* close still releases the OS lock */ }
      try { db.close(); } catch { /* failed cleanup never grants execution */ }
    }
  }
}
