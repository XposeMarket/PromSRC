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
  acquire(jobId: string, slot: string | undefined, timeoutMs: number, now = Date.now()): (() => void) | null {
    fs.mkdirSync(this.root, { recursive: true });
    const key = crypto.createHash('sha256').update(jobId).digest('hex');
    const leasePath = path.join(this.root, `${key}.lease`);
    const dedupePath = path.join(this.root, `${key}.slots.json`);
    const token = crypto.randomUUID();
    let fd: number;
    try { fd = fs.openSync(leasePath, 'wx'); }
    catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      const recoveryPath = `${leasePath}.recover`;
      let recovery: number;
      try { recovery = fs.openSync(recoveryPath, 'wx'); } catch { return null; }
      try {
        let lease: { expiresAt: number; pid: number };
        try { lease = JSON.parse(fs.readFileSync(leasePath, 'utf8')); } catch { return null; }
        if (lease.expiresAt > now) return null;
        // A live owner may still be unwinding cancellation. Never overlap it.
        try { process.kill(lease.pid, 0); return null; } catch (e: any) { if (e.code !== 'ESRCH') return null; }
        try { fs.unlinkSync(leasePath); } catch { return null; }
        try { fd = fs.openSync(leasePath, 'wx'); } catch { return null; }
      } finally { fs.closeSync(recovery); fs.unlinkSync(recoveryPath); }
    }
    const release = () => {
      try {
        if (JSON.parse(fs.readFileSync(leasePath, 'utf8')).token === token) fs.unlinkSync(leasePath);
      } catch { /* already recovered */ }
    };
    try {
      fs.writeFileSync(fd, JSON.stringify({ jobId, token, pid: process.pid, expiresAt: now + timeoutMs }));
      fs.closeSync(fd);
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
    } catch (err) { try { fs.closeSync(fd); } catch {} release(); throw err; }
  }
}

export function validateScheduledExecution(job: Pick<CronJob, 'kind' | 'command' | 'misfire_policy' | 'timeoutMs'>): void {
  if (job.kind !== undefined && job.kind !== 'agent' && job.kind !== 'script') throw new Error('kind must be agent or script');
  if (job.misfire_policy !== undefined && !['skip', 'run_once', 'run_all'].includes(job.misfire_policy)) throw new Error('Invalid misfire_policy');
  if (job.kind === 'script' && (typeof job.command !== 'string' || !job.command.trim())) throw new Error('Script jobs require command');
  if (job.timeoutMs !== undefined && (!Number.isInteger(job.timeoutMs) || job.timeoutMs < 1 || job.timeoutMs > 3600000)) throw new Error('timeoutMs must be 1..3600000');
}
