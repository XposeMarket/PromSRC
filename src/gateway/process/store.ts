import fs from 'fs';
import path from 'path';
import type { ProcessRunRecord } from './types';

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function safeFileName(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export class ProcessRunStore {
  readonly rootDir: string;
  readonly recordsDir: string;
  readonly logsDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.recordsDir = path.join(rootDir, 'records');
    this.logsDir = path.join(rootDir, 'logs');
    ensureDir(this.recordsDir);
    ensureDir(this.logsDir);
  }

  recordPath(runId: string): string {
    return path.join(this.recordsDir, `${safeFileName(runId)}.json`);
  }

  stdoutPath(runId: string): string {
    return path.join(this.logsDir, `${safeFileName(runId)}.stdout.log`);
  }

  stderrPath(runId: string): string {
    return path.join(this.logsDir, `${safeFileName(runId)}.stderr.log`);
  }

  writeRecord(record: ProcessRunRecord): void {
    ensureDir(this.recordsDir);
    const tmp = `${this.recordPath(record.runId)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8');
    fs.renameSync(tmp, this.recordPath(record.runId));
  }

  appendStdout(runId: string, chunk: string): void {
    ensureDir(this.logsDir);
    fs.appendFileSync(this.stdoutPath(runId), chunk, 'utf-8');
  }

  appendStderr(runId: string, chunk: string): void {
    ensureDir(this.logsDir);
    fs.appendFileSync(this.stderrPath(runId), chunk, 'utf-8');
  }

  readLogFile(filePath: string, maxChars = 200_000): { text: string; bytes: number; truncated: boolean } {
    if (!fs.existsSync(filePath)) return { text: '', bytes: 0, truncated: false };
    const stat = fs.statSync(filePath);
    const bytes = stat.size;
    const fd = fs.openSync(filePath, 'r');
    try {
      const readBytes = Math.min(bytes, maxChars);
      const buffer = Buffer.alloc(readBytes);
      fs.readSync(fd, buffer, 0, readBytes, Math.max(0, bytes - readBytes));
      return { text: buffer.toString('utf-8'), bytes, truncated: bytes > readBytes };
    } finally {
      fs.closeSync(fd);
    }
  }

  loadRecord(runId: string): ProcessRunRecord | null {
    try {
      const p = this.recordPath(runId);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as ProcessRunRecord;
    } catch {
      return null;
    }
  }

  listRecords(limit = 100): ProcessRunRecord[] {
    ensureDir(this.recordsDir);
    return fs.readdirSync(this.recordsDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.recordsDir, name), 'utf-8')) as ProcessRunRecord;
        } catch {
          return null;
        }
      })
      .filter((record): record is ProcessRunRecord => Boolean(record))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, Math.max(1, Math.min(500, limit)));
  }
}
