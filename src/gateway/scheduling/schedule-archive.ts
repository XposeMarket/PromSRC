import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import type { CronJob } from './cron-scheduler';

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type ArchivedScheduledJob = {
  job: CronJob;
  archivedAt: string;
  expiresAt: string;
};

function archiveDir(): string {
  return path.join(getConfig().getConfigDir(), 'cron', 'archive');
}

function safeId(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function archivePath(id: string): string {
  return path.join(archiveDir(), `${safeId(id)}.json`);
}

function readFile(filePath: string): ArchivedScheduledJob | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed?.job?.id) return null;
    if (new Date(parsed.expiresAt || 0).getTime() <= Date.now()) {
      fs.unlinkSync(filePath);
      return null;
    }
    return parsed as ArchivedScheduledJob;
  } catch {
    return null;
  }
}

export function archiveCompletedScheduledJob(job: CronJob, retentionMs = DEFAULT_RETENTION_MS): void {
  const dir = archiveDir();
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const record: ArchivedScheduledJob = {
    job: { ...job, status: 'completed', enabled: false, nextRun: null },
    archivedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Math.max(60_000, retentionMs)).toISOString(),
  };
  const target = archivePath(job.id);
  const tmp = `${target}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8');
  fs.renameSync(tmp, target);
}

export function findArchivedScheduledJob(idOrName: string): CronJob | null {
  const key = String(idOrName || '').trim();
  if (!key) return null;
  const direct = archivePath(key);
  if (fs.existsSync(direct)) return readFile(direct)?.job || null;
  const dir = archiveDir();
  if (!fs.existsSync(dir)) return null;
  const lower = key.toLowerCase();
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    const record = readFile(path.join(dir, entry));
    if (record && String(record.job.name || '').toLowerCase() === lower) return record.job;
  }
  return null;
}

export function deleteArchivedScheduledJob(id: string): boolean {
  const target = archivePath(id);
  if (!fs.existsSync(target)) return false;
  try {
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}
