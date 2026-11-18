import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../../config/config';
import { redactResourceText } from '../resources/resource-store';

export interface BackgroundSpawnReceipt {
  id: string;
  spawnerSessionId: string;
  state: string;
  startedAt: number;
  completedAt?: number;
  promptPreview?: string;
  result?: string;
  error?: string;
  joinPolicy?: 'wait_all' | 'wait_until_timeout' | 'best_effort_merge';
  timeoutMs?: number;
  providerId?: string;
  model?: string;
  modelSource?: string;
  reasoningEffort?: string;
  mergedAt?: number;
}

const MAX_RECEIPTS = 500;
const RETENTION_MS = 7 * 24 * 60 * 60_000;

function receiptPath(): string {
  return path.join(getConfig().getConfigDir(), 'background-spawn-continuity.json');
}

function normalizeReceipt(item: any): BackgroundSpawnReceipt | null {
  if (!item || typeof item.id !== 'string' || typeof item.spawnerSessionId !== 'string'
    || !item.id.trim() || !item.spawnerSessionId.trim() || item.id.length > 200 || item.spawnerSessionId.length > 200 || !Number.isFinite(item.startedAt)
    || item.startedAt < Date.now() - RETENTION_MS
    || !['queued', 'in_progress', 'completed', 'failed', 'timed_out'].includes(item.state)) return null;
  const text = (value: unknown, max: number) => redactResourceText(value).slice(0, max) || undefined;
  return {
    id: item.id.slice(0, 200), spawnerSessionId: item.spawnerSessionId.slice(0, 200),
    state: item.state, startedAt: item.startedAt,
    completedAt: Number.isFinite(item.completedAt) ? item.completedAt : undefined,
    mergedAt: Number.isFinite(item.mergedAt) ? item.mergedAt : undefined,
    promptPreview: text(item.promptPreview, 160), result: text(item.result, 8000), error: text(item.error, 4000),
    joinPolicy: ['wait_all', 'wait_until_timeout', 'best_effort_merge'].includes(item.joinPolicy) ? item.joinPolicy : 'wait_all',
    timeoutMs: Number.isFinite(item.timeoutMs) ? Math.max(1, Math.min(1_800_000, item.timeoutMs)) : 120_000,
    providerId: text(item.providerId, 120), model: text(item.model, 200),
    modelSource: text(item.modelSource, 120), reasoningEffort: text(item.reasoningEffort, 40),
  };
}

export function readBackgroundSpawnReceipts(): BackgroundSpawnReceipt[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(receiptPath(), 'utf8'));
    return Array.isArray(parsed) ? parsed.slice(-MAX_RECEIPTS).map(normalizeReceipt).filter((item): item is BackgroundSpawnReceipt => !!item) : [];
  } catch { return []; }
}

export function persistBackgroundSpawnReceipt(receipt: BackgroundSpawnReceipt): void {
  const normalized = normalizeReceipt(receipt);
  if (!normalized) return;
  const target = receiptPath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const cutoff = Date.now() - RETENTION_MS;
    const previous = readBackgroundSpawnReceipts().filter((item) => item.id !== receipt.id && item.startedAt >= cutoff);
    const next = [...previous, normalized].slice(-MAX_RECEIPTS);
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
      // Receipts prove launch/outcome; the full result lives in the receipt
      // store. Keep each line short: this block is repeated on every restart.
      const rawOutcome = String(item.result || item.error || '').replace(/\s+/g, ' ').trim();
      const outcome = rawOutcome.length > 420 ? `${rawOutcome.slice(0, 417)}...` : rawOutcome;
      return `- ${item.id}: ${status}${item.promptPreview ? `; task: ${item.promptPreview.slice(0, 120)}` : ''}${outcome ? `; outcome: ${outcome}` : ''}`;
    }),
  ].join('\n');
}
