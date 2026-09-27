import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../../config/config';

export interface BackgroundSpawnReceipt {
  id: string;
  spawnerSessionId: string;
  state: string;
  startedAt: number;
  completedAt?: number;
  promptPreview?: string;
  result?: string;
  error?: string;
}

const MAX_RECEIPTS = 500;
const RETENTION_MS = 7 * 24 * 60 * 60_000;

function receiptPath(): string {
  return path.join(getConfig().getConfigDir(), 'background-spawn-continuity.json');
}

export function readBackgroundSpawnReceipts(): BackgroundSpawnReceipt[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(receiptPath(), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.spawnerSessionId) : [];
  } catch { return []; }
}

export function persistBackgroundSpawnReceipt(receipt: BackgroundSpawnReceipt): void {
  if (!receipt.spawnerSessionId) return;
  const target = receiptPath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const cutoff = Date.now() - RETENTION_MS;
    const previous = readBackgroundSpawnReceipts().filter((item) => item.id !== receipt.id && item.startedAt >= cutoff);
    const next = [...previous, {
      ...receipt,
      promptPreview: String(receipt.promptPreview || '').slice(0, 160),
      result: String(receipt.result || '').slice(0, 8000) || undefined,
      error: String(receipt.error || '').slice(0, 4000) || undefined,
    }].slice(-MAX_RECEIPTS);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next), 'utf8');
    try { fs.renameSync(temp, target); }
    catch (error: any) {
      // Windows rename does not replace an existing file atomically. Keep the
      // prior receipt on replacement failure rather than deleting it first.
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
      fs.copyFileSync(temp, target);
      fs.unlinkSync(temp);
    }
  } catch (error) {
    console.warn(`[Background Agent] Could not persist receipt ${receipt.id}:`, error);
  }
}

export function backgroundSpawnContinuityForSession(sessionId: string, since = 0): BackgroundSpawnReceipt[] {
  const sid = String(sessionId || '').trim();
  if (!sid) return [];
  return readBackgroundSpawnReceipts()
    .filter((item) => item.spawnerSessionId === sid && item.startedAt >= since)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function formatBackgroundSpawnContinuity(sessionId: string, since = 0): string {
  const receipts = backgroundSpawnContinuityForSession(sessionId, since);
  if (!receipts.length) return '';
  return [
    'Background agents spawned by this session (durable receipts; do not claim they were not launched):',
    ...receipts.slice(-12).map((item) => {
      const status = item.state === 'queued' || item.state === 'in_progress'
        ? 'started; completion not yet verified (check current live status after a restart)'
        : item.state;
      const outcome = String(item.result || item.error || '').replace(/\s+/g, ' ').slice(0, 1100);
      return `- ${item.id}: ${status}${item.promptPreview ? `; task: ${item.promptPreview.slice(0, 160)}` : ''}${outcome ? `; outcome: ${outcome}` : ''}`;
    }),
  ].join('\n');
}
