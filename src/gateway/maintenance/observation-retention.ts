import fs from 'node:fs/promises';
import path from 'node:path';

export interface RetentionPolicy { enabled: boolean; rawDays: number; scratchDays: number; rawMaxBytes: number; resultMaxBytes: number; scratchMaxBytes: number; maxDeletes: number }
export const DEFAULT_RETENTION: RetentionPolicy = { enabled: false, rawDays: 30, scratchDays: 60, rawMaxBytes: 2 * 1024 ** 3, resultMaxBytes: 512 * 1024 ** 2, scratchMaxBytes: 512 * 1024 ** 2, maxDeletes: 2000 };
export function validateRetentionPolicy(value: unknown): RetentionPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('retention policy must be an object');
  const policy = { ...DEFAULT_RETENTION, ...value } as RetentionPolicy;
  if (typeof policy.enabled !== 'boolean') throw new Error('enabled must be boolean');
  for (const key of ['rawDays', 'scratchDays'] as const) if (!Number.isInteger(policy[key]) || policy[key] < 7 || policy[key] > 3650) throw new Error(`${key} must be 7..3650`);
  for (const key of ['rawMaxBytes', 'resultMaxBytes', 'scratchMaxBytes'] as const) if (!Number.isSafeInteger(policy[key]) || policy[key] < 0) throw new Error(`${key} must be a nonnegative integer (0 disables quota)`);
  if (!Number.isInteger(policy.maxDeletes) || policy.maxDeletes < 1 || policy.maxDeletes > 10000) throw new Error('maxDeletes must be 1..10000');
  for (const key of Object.keys(value)) if (!(key in DEFAULT_RETENTION)) throw new Error(`Unknown retention option ${key}`);
  return policy;
}
export interface RetentionRoot { kind: 'observations' | 'results' | 'scratch'; path: string; days: number; maxBytes: number; protectedDirectories?: Set<string> }
interface Candidate { file: string; size: number; mtimeMs: number; ino: number; dev: number; root: RetentionRoot }
export interface RetentionReport { dryRun: boolean; scanned: number; bytes: number; eligible: number; eligibleBytes: number; removed: number; reclaimedBytes: number; protected: number; errors: number; truncated: boolean; quotaUnmet: boolean; durationMs: number }
const reads = new Map<string, number>();
export async function withRetainedRawRead<T>(file: string, read: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(file); reads.set(resolved, (reads.get(resolved) || 0) + 1);
  try {
    // Renew the grace period before opening; never rely on filesystem atime.
    const now = new Date(); await fs.utimes(resolved, now, now);
    return await read();
  } catch (error: any) {
    if (error?.code === 'ENOENT') throw new Error('Raw tool result has expired or is unavailable. Its saved summary remains; rerun the source tool for exact output.');
    throw error;
  } finally { const count = (reads.get(resolved) || 1) - 1; if (count) reads.set(resolved, count); else reads.delete(resolved); }
}
async function safePath(file: string): Promise<boolean> {
  // Reject symlinks/junctions at every ancestor, not just the final entry.
  let current = path.resolve(file);
  while (true) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) return false;
    const parent = path.dirname(current); if (parent === current) return true; current = parent;
  }
}
let busy = false;
export async function runRetention(roots: RetentionRoot[], policy: RetentionPolicy, dryRun = true, now = Date.now(), stillProtected: (file: string) => boolean = () => false): Promise<RetentionReport> {
  validateRetentionPolicy(policy);
  if (busy) throw new Error('Retention pass already running');
  busy = true;
  const started = Date.now();
  const report: RetentionReport = { dryRun, scanned: 0, bytes: 0, eligible: 0, eligibleBytes: 0, removed: 0, reclaimedBytes: 0, protected: 0, errors: 0, truncated: false, quotaUnmet: false, durationMs: 0 };
  const selected: Candidate[] = [];
  try {
    for (const root of roots) {
      const candidates: Candidate[] = []; let bytes = 0;
      async function walk(dir: string, depth = 0): Promise<void> {
        if (depth > 2 || report.scanned >= 500000 || Date.now() - started > 60000) { report.truncated = true; return; }
        const entries = await fs.opendir(dir);
        for await (const entry of entries) {
          if (report.scanned >= 500000 || Date.now() - started > 60000) report.truncated = true;
          if (report.truncated) break;
          const file = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) { report.protected++; continue; }
          if (entry.isDirectory()) {
            if (root.protectedDirectories?.has(entry.name) || stillProtected(file)) { report.protected++; continue; }
            // Raw roots have one session directory level; scratch roots are flat.
            if (depth === 0 && root.kind !== 'scratch') await walk(file, depth + 1);
            continue;
          }
          if (!entry.isFile() || !entry.name.endsWith('.txt')) continue;
          report.scanned++;
          try {
            const stat = await fs.lstat(file); report.bytes += stat.size; bytes += stat.size;
            if (stat.isSymbolicLink() || stat.nlink !== 1 || reads.has(file) || stillProtected(file)) { report.protected++; continue; }
            if (now - stat.mtimeMs < 7 * 86400000) { report.protected++; continue; }
            candidates.push({ file, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, dev: stat.dev, root });
          } catch { report.errors++; }
          if (report.scanned % 256 === 0) await new Promise<void>(resolve => setImmediate(resolve));
        }
      }
      try { if (!await safePath(root.path)) { report.protected++; continue; } await walk(root.path); }
      catch (error: any) { if (error?.code !== 'ENOENT') report.errors++; }
      candidates.sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));
      for (const candidate of candidates) {
        if (now - candidate.mtimeMs >= root.days * 86400000 || (root.maxBytes > 0 && bytes > root.maxBytes)) {
          selected.push(candidate); bytes -= candidate.size;
        }
      }
      if (root.maxBytes > 0 && bytes > root.maxBytes) report.quotaUnmet = true;
    }
    report.eligible = selected.length; report.eligibleBytes = selected.reduce((sum, file) => sum + file.size, 0);
    if (!dryRun && !report.truncated && report.errors === 0) {
      if (!policy.enabled) throw new Error('Retention is disabled; enable it explicitly before pruning');
      for (const candidate of selected.slice(0, policy.maxDeletes)) {
        try {
          if (reads.has(candidate.file) || stillProtected(candidate.file) || !await safePath(candidate.file)) { report.protected++; continue; }
          const stat = await fs.lstat(candidate.file);
          if (!stat.isFile() || stat.nlink !== 1 || stat.mtimeMs !== candidate.mtimeMs || stat.size !== candidate.size || stat.ino !== candidate.ino || stat.dev !== candidate.dev) { report.protected++; continue; }
          if (reads.has(candidate.file) || stillProtected(candidate.file)) { report.protected++; continue; }
          await fs.unlink(candidate.file); report.removed++; report.reclaimedBytes += candidate.size;
        } catch (error: any) { if (error?.code !== 'ENOENT') report.errors++; }
      }
    }
    return report;
  } finally { report.durationMs = Date.now() - started; busy = false; }
}
