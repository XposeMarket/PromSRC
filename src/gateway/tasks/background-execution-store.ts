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
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(envelope)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  // Node rename replaces the target on supported Windows/Unix filesystems. Never
  // fall back to deleting/copying over authoritative executable state.
  fs.renameSync(temp, file);
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
        || !Number.isSafeInteger(item.ownerPid) || typeof item.ownerToken !== 'string'
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
/** Lock + re-read + owner liveness: no two replacement gateways may claim. */
export function claimBackgroundExecution(item: BackgroundExecutionEnvelope): boolean {
  const file = target(item.id);
  let fd: number;
  try {
    fd = fs.openSync(`${file}.claim`, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token: ownerToken }));
    fs.fsyncSync(fd);
  } catch { return false; }
  try {
    const current = JSON.parse(fs.readFileSync(file, 'utf8')) as BackgroundExecutionEnvelope;
    if (current.ownerToken !== item.ownerToken || alive(current.ownerPid)) return false;
    saveBackgroundExecution(current.record);
    return true;
  } finally { fs.closeSync(fd); fs.unlinkSync(`${file}.claim`); }
}
