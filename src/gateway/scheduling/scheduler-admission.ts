import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { CronJob } from './cron-scheduler';
import { Cron } from 'croner';

export interface ScheduledSlot { scheduledAt: string; reason: 'scheduled' | 'catch_up'; missedCount: number }
export function planDueSlots(job: CronJob, now: Date): { slots: ScheduledSlot[]; nextRun: string | null; missedCount: number } {
  if (!job.nextRun || Date.parse(job.nextRun) > +now) return { slots: [], nextRun: job.nextRun, missedCount: 0 };
  let cursor = new Date(job.nextRun);
  const recent: string[] = [];
  let count = 0;
  while (+cursor <= +now) {
    count++;
    recent.push(cursor.toISOString());
    if (recent.length > 3) recent.shift();
    if (job.type === 'one-shot') break;
    const next = new Cron(job.schedule!, { timezone: job.tz, paused: true }).nextRun(cursor);
    if (!next) throw new Error('Schedule has no next occurrence');
    if (+next <= +cursor) throw new Error('Schedule must advance');
    cursor = next;
    // Bound synchronous recovery work. Leave remaining occurrences for the next tick.
    if (count >= 100000) { cursor = new Cron(job.schedule!, { timezone: job.tz, paused: true }).nextRun(now)!; break; }
  }
  const missed = count > 1 || +now - Date.parse(job.nextRun) >= 60000;
  const missedCount = missed ? count : 0;
  const policy = job.misfire_policy || 'run_once';
  const selected = missed && policy === 'skip' ? [] : missed && policy === 'run_all' ? recent : recent.slice(-1);
  return {
    slots: selected.map(scheduledAt => ({ scheduledAt, reason: missed ? 'catch_up' : 'scheduled', missedCount })),
    nextRun: job.type === 'one-shot' ? null : cursor.toISOString(), missedCount,
  };
}

/** Exclusive filesystem leases also protect overlapping gateway processes during handoff. */
export class SchedulerAdmission {
  private root: string;
  constructor(storePath: string) { this.root = `${storePath}.admission`; }
  isLeased(jobId: string): boolean {
    const key = crypto.createHash('sha256').update(jobId).digest('hex');
    return fs.existsSync(path.join(this.root, `${key}.lease`));
  }
  isConsumed(jobId: string, slot: string): boolean {
    const key = crypto.createHash('sha256').update(jobId).digest('hex');
    try { return JSON.parse(fs.readFileSync(path.join(this.root, `${key}.slots.json`), 'utf8')).includes(slot); }
    catch { return false; }
  }
  /**
   * Crash-safe ownership protocol:
   *  - Leases and the recovery lock are published atomically: metadata is written
   *    and fsynced to a private temp file, then hard-linked into place (link fails
   *    with EEXIST, so it is an exclusive create that never exposes empty or partial
   *    metadata). Filesystems without hard links fall back to `wx` + write.
   *  - An unreadable lease/lock can therefore only be residue of a crash (or an old
   *    build) between create and write. It is reclaimed only after LOCK_GRACE_MS of
   *    no modification, so a live writer is never raced.
   *  - Stealers are serialized by `.lease.recover`. An abandoned recovery lock is
   *    reclaimed when its owner pid is dead, it is older than RECOVERY_MAX_AGE_MS,
   *    or it is unreadable past the grace window.
   *  - Every steal is compare-and-delete: rename the file aside, confirm it still
   *    holds the exact bytes judged stale, and put it back otherwise.
   *  - A lease whose owner pid is alive is never reclaimed, even after expiry.
   */
  acquire(jobId: string, slot: string | undefined, timeoutMs: number, now = Date.now()): (() => void) | null {
    fs.mkdirSync(this.root, { recursive: true });
    const key = crypto.createHash('sha256').update(jobId).digest('hex');
    const leasePath = path.join(this.root, `${key}.lease`);
    const dedupePath = path.join(this.root, `${key}.slots.json`);
    const token = crypto.randomUUID();
    const body = JSON.stringify({ jobId, token, pid: process.pid, expiresAt: now + timeoutMs });
    if (!publishExclusive(leasePath, body)) {
      if (!recoverStaleLease(leasePath, now)) return null;
      if (!publishExclusive(leasePath, body)) return null; // another replacement won the race
    }
    const release = () => {
      try {
        if (JSON.parse(fs.readFileSync(leasePath, 'utf8')).token === token) fs.unlinkSync(leasePath);
      } catch { /* already recovered */ }
    };
    try {
      if (slot) {
        let slots: string[] = [];
        try { slots = JSON.parse(fs.readFileSync(dedupePath, 'utf8')); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
        if (slots.includes(slot)) { release(); return null; }
        slots.push(slot);
        const tmp = `${dedupePath}.${token}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(slots.slice(-256)));
        fs.renameSync(tmp, dedupePath);
      }
      return release;
    } catch (err) { release(); throw err; }
  }
}

/** A live writer finishes create+write in microseconds; unreadable files older than this are crash residue. */
export const LOCK_GRACE_MS = 30_000;
/** The recovery critical section is synchronous and takes milliseconds; a holder this old is abandoned (covers pid reuse). */
export const RECOVERY_MAX_AGE_MS = 10 * 60_000;

/** Exclusive create that only ever exposes complete, fsynced metadata. Returns false if the target exists. */
export function publishExclusive(target: string, body: string): boolean {
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx');
  try { fs.writeSync(fd, body); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    fs.linkSync(tmp, target);
    return true;
  } catch (err: any) {
    if (err.code === 'EEXIST') return false;
    if (!['EPERM', 'ENOTSUP', 'ENOSYS', 'EXDEV', 'EOPNOTSUPP', 'EINVAL'].includes(err.code)) throw err;
    // No hard links here: plain exclusive create; the grace rule covers its crash window.
    let wfd: number;
    try { wfd = fs.openSync(target, 'wx'); } catch (e: any) { if (e.code === 'EEXIST') return false; throw e; }
    try { fs.writeSync(wfd, body); fs.fsyncSync(wfd); } finally { fs.closeSync(wfd); }
    return true;
  } finally { try { fs.unlinkSync(tmp); } catch { /* best effort */ } }
}

function readLock(file: string): { raw: Buffer; data: any | null; mtimeMs: number } | null {
  try {
    const raw = fs.readFileSync(file);
    const mtimeMs = fs.statSync(file).mtimeMs;
    let data: any = null;
    try { data = JSON.parse(raw.toString('utf8')); } catch { data = null; }
    if (!data || typeof data !== 'object' || typeof data.pid !== 'number') data = null;
    return { raw, data, mtimeMs };
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function ownerDead(pid: number): boolean {
  if (pid === process.pid) return false;
  try { process.kill(pid, 0); return false; } catch (e: any) { return e.code === 'ESRCH'; }
}

/** Compare-and-delete: remove `file` only if it still holds exactly `expected`. */
function removeIfUnchanged(file: string, expected: Buffer): boolean {
  const aside = `${file}.stale-${crypto.randomUUID()}`;
  try { fs.renameSync(file, aside); } catch { return false; }
  let same = false;
  try { same = fs.readFileSync(aside).equals(expected); } catch { same = false; }
  if (same) { try { fs.unlinkSync(aside); } catch { /* best effort */ } return true; }
  // We moved a newer owner's file: put it back without clobbering anything.
  try { fs.linkSync(aside, file); } catch { /* a newer file exists; ours is stale data */ }
  try { fs.unlinkSync(aside); } catch { /* best effort */ }
  return false;
}

function acquireRecoveryLock(recoveryPath: string, now: number): string | null {
  const token = crypto.randomUUID();
  const body = JSON.stringify({ token, pid: process.pid, at: now });
  if (publishExclusive(recoveryPath, body)) return token;
  const held = readLock(recoveryPath);
  if (!held) return publishExclusive(recoveryPath, body) ? token : null;
  const age = now - (held.data && typeof held.data.at === 'number' ? held.data.at : held.mtimeMs);
  const abandoned = held.data
    ? ownerDead(held.data.pid) || age > RECOVERY_MAX_AGE_MS
    : now - held.mtimeMs > LOCK_GRACE_MS;
  if (!abandoned || !removeIfUnchanged(recoveryPath, held.raw)) return null;
  return publishExclusive(recoveryPath, body) ? token : null;
}

function releaseRecoveryLock(recoveryPath: string, token: string): void {
  const held = readLock(recoveryPath);
  if (held?.data?.token === token) removeIfUnchanged(recoveryPath, held.raw);
}

/** Returns true when the existing lease was proven stale and removed (caller then re-publishes). */
function recoverStaleLease(leasePath: string, now: number): boolean {
  const recoveryPath = `${leasePath}.recover`;
  const recoveryToken = acquireRecoveryLock(recoveryPath, now);
  if (!recoveryToken) return false;
  try {
    const lease = readLock(leasePath);
    if (!lease) return true; // released while we waited
    if (lease.data) {
      if (typeof lease.data.expiresAt === 'number' && lease.data.expiresAt > now) return false;
      // A live owner may still be unwinding cancellation. Never overlap it.
      if (!ownerDead(lease.data.pid)) return false;
    } else if (now - lease.mtimeMs <= LOCK_GRACE_MS) {
      return false; // possibly a live writer mid-create; reclaim only after the grace window
    }
    return removeIfUnchanged(leasePath, lease.raw);
  } finally { releaseRecoveryLock(recoveryPath, recoveryToken); }
}

export function validateScheduledExecution(job: Pick<CronJob, 'kind' | 'command' | 'misfire_policy' | 'timeoutMs'>): void {
  if (job.kind !== undefined && job.kind !== 'agent' && job.kind !== 'script') throw new Error('kind must be agent or script');
  if (job.misfire_policy !== undefined && !['skip', 'run_once', 'run_all'].includes(job.misfire_policy)) throw new Error('Invalid misfire_policy');
  if (job.kind === 'script' && (typeof job.command !== 'string' || !job.command.trim())) throw new Error('Script jobs require command');
  if (job.timeoutMs !== undefined && (!Number.isInteger(job.timeoutMs) || job.timeoutMs < 1 || job.timeoutMs > 3600000)) throw new Error('timeoutMs must be 1..3600000');
}
