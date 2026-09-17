import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';

export type TeamRunReceiptStatus = 'queued' | 'running' | 'complete' | 'failed' | 'capacity_limited';

export interface TeamRunReceipt {
  runId: string;
  teamId: string;
  agentId: string;
  agentName: string;
  trigger: 'cron' | 'team_dispatch' | 'manual';
  status: TeamRunReceiptStatus;
  queuedAt: number;
  executionStartedAt?: number;
  finishedAt?: number;
  queueWaitMs?: number;
  durationMs?: number;
  stepCount?: number;
  taskId?: string;
  workspacePath?: string;
  expectedOutputPath?: string;
  actualOutputPath?: string;
  errorCategory?: string;
  error?: string;
  sideEffectSummary?: string;
  acceptanceState?: 'pending' | 'accepted' | 'rejected' | 'retryable';
  resultPreview?: string;
}

export interface TeamRunReceiptWriter {
  readonly runId: string;
  readonly queuedAt: number;
  readonly filePath: string;
  update(patch: Partial<TeamRunReceipt>): TeamRunReceipt;
}

function safeId(value: string): string {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'unknown';
}

function receiptRoot(): string {
  return path.join(getConfig().getWorkspacePath(), '.prometheus', 'team-run-receipts');
}

function writeAtomic(filePath: string, value: TeamRunReceipt): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export function createTeamRunReceipt(input: {
  teamId: string;
  agentId: string;
  agentName: string;
  trigger: 'cron' | 'team_dispatch' | 'manual';
}): TeamRunReceiptWriter {
  const queuedAt = Date.now();
  const runId = `teamrun_${queuedAt.toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const filePath = path.join(receiptRoot(), `${safeId(runId)}.json`);
  let receipt: TeamRunReceipt = {
    runId,
    teamId: String(input.teamId || '').trim(),
    agentId: String(input.agentId || '').trim(),
    agentName: String(input.agentName || input.agentId || '').trim(),
    trigger: input.trigger,
    status: 'queued',
    queuedAt,
    acceptanceState: 'pending',
    sideEffectSummary: 'No external side effects declared by the team runtime.',
  };

  try {
    writeAtomic(filePath, receipt);
  } catch (error: any) {
    console.warn(`[TeamReceipt] Could not create central receipt ${runId}:`, error?.message || error);
  }

  return {
    runId,
    queuedAt,
    filePath,
    update(patch: Partial<TeamRunReceipt>): TeamRunReceipt {
      receipt = { ...receipt, ...patch, runId };
      try {
        writeAtomic(filePath, receipt);
      } catch (error: any) {
        console.warn(`[TeamReceipt] Could not update central receipt ${runId}:`, error?.message || error);
      }
      return receipt;
    },
  };
}

/** Read the canonical run ledger for operator dashboards and diagnostics. */
export function listTeamRunReceipts(options: {
  limit?: number;
  teamId?: string;
  agentId?: string;
} = {}): TeamRunReceipt[] {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit) || 100)));
  const teamId = String(options.teamId || '').trim();
  const agentId = String(options.agentId || '').trim();
  try {
    const root = receiptRoot();
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .map((name) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(root, name), 'utf-8')) as TeamRunReceipt;
        } catch {
          return null;
        }
      })
      .filter((receipt): receipt is TeamRunReceipt => Boolean(receipt))
      .filter((receipt) => !teamId || receipt.teamId === teamId)
      .filter((receipt) => !agentId || receipt.agentId === agentId)
      .sort((a, b) => Number(b.queuedAt || 0) - Number(a.queuedAt || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}
