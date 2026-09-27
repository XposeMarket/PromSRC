import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../../config/config';

export interface DurableDetachedTurn {
  ownerSessionId: string;
  targetSessionId: string;
  prompt: string;
  queuedAt: number;
  steers: string[];
  supervisionId?: string;
  notifyOnComplete: boolean;
  notifyOnFailure: boolean;
}

function filePath(): string {
  return path.join(getConfig().getConfigDir(), 'detached-turn-continuity.json');
}

export function readDurableDetachedTurns(): DurableDetachedTurn[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DurableDetachedTurn => !!item && typeof item === 'object'
      && typeof item.ownerSessionId === 'string' && typeof item.targetSessionId === 'string'
      && typeof item.prompt === 'string' && Number.isFinite(item.queuedAt));
  } catch { return []; }
}

function writeTurns(turns: DurableDetachedTurn[]): void {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(turns.slice(-250)), 'utf8');
  try { fs.renameSync(temp, target); }
  catch (error: any) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
    fs.copyFileSync(temp, target);
    fs.unlinkSync(temp);
  }
}

export function saveDurableDetachedTurn(turn: DurableDetachedTurn): void {
  writeTurns([...readDurableDetachedTurns().filter((item) => item.targetSessionId !== turn.targetSessionId), turn]);
}

export function removeDurableDetachedTurn(targetSessionId: string, queuedAt?: number): void {
  writeTurns(readDurableDetachedTurns().filter((item) => item.targetSessionId !== targetSessionId
    || (queuedAt !== undefined && item.queuedAt !== queuedAt)));
}
