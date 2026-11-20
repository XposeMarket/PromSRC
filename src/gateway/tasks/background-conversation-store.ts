/**
 * Durable, owner-bound background worker conversations (locked plan
 * background-review-followups). One record per root background_spawn run.
 *
 * Execution envelopes (background-execution-store) stay prunable; this record
 * keeps only the metadata needed to admit a follow-up in the same worker
 * conversation: owner chat, original scope/routing, bounded tool evidence,
 * per-round immutable links and idempotent request admissions. The worker
 * transcript itself is the ordinary `background_<rootId>` session. Retained
 * until the owning parent chat is deleted.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getConfig } from '../../config/config';
import type { LedgerEvidence } from './background-tool-ledger';

export interface BackgroundConversationRound {
  executionId: string;
  predecessorId?: string;
  requestId?: string;
  parentTurnId?: string;
  state: string;
  startedAt: number;
  completedAt?: number;
}

export interface BackgroundConversation {
  version: 1;
  rootId: string;
  ownerSessionId: string;
  createdAt: number;
  updatedAt: number;
  headId: string;
  rounds: BackgroundConversationRound[];
  /** requestId -> executionId for durable admission dedupe. */
  admissions: Record<string, string>;
  workDir: string;
  scopedWorkDir: boolean;
  allowedWorkPaths?: string[];
  resourceIds?: string[];
  toolCategories: string[];
  /** Original spawn-time ceiling; follow-ups intersect it with the current one. */
  toolCeiling?: string[];
  customTools: boolean;
  joinPolicy: string;
  timeoutMs: number;
  tags?: string[];
  providerId?: string;
  model?: string;
  modelSource?: string;
  reasoningEffort?: string;
  speed?: string;
  /** Bounded, labelled prior tool evidence carried across pruned snapshots. */
  evidence: LedgerEvidence[];
}

export const MAX_CONVERSATION_ROUNDS = 200;
const MAX_ADMISSIONS = 400;
const MAX_EVIDENCE = 40;

function root(): string { return path.join(getConfig().getConfigDir(), 'background-conversations'); }
function target(id: string): string {
  if (!/^bg_[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid background conversation ID');
  return path.join(root(), `${id}.json`);
}

function valid(item: any, id?: string): item is BackgroundConversation {
  return !!item && item.version === 1 && typeof item.rootId === 'string' && (!id || item.rootId === id)
    && typeof item.ownerSessionId === 'string' && !!item.ownerSessionId
    && typeof item.headId === 'string' && Array.isArray(item.rounds)
    && item.rounds.every((r: any) => r && typeof r.executionId === 'string' && typeof r.state === 'string')
    && item.admissions && typeof item.admissions === 'object'
    && typeof item.workDir === 'string' && path.isAbsolute(item.workDir)
    && Array.isArray(item.toolCategories) && Array.isArray(item.evidence)
    && (item.toolCeiling === undefined || (Array.isArray(item.toolCeiling) && item.toolCeiling.length > 0));
}

export function readBackgroundConversation(rootId: string): BackgroundConversation | null {
  try {
    const item = JSON.parse(fs.readFileSync(target(rootId), 'utf8'));
    return valid(item, rootId) ? item : null;
  } catch { return null; }
}

export function listBackgroundConversations(): BackgroundConversation[] {
  let files: string[];
  try { files = fs.readdirSync(root()); } catch { return []; }
  const out: BackgroundConversation[] = [];
  for (const name of files) {
    if (!/^bg_[a-zA-Z0-9-]+\.json$/.test(name)) continue;
    const item = readBackgroundConversation(name.slice(0, -5));
    if (item) out.push(item);
  }
  return out;
}

/** Resolve a conversation from its root id or any round's execution id. */
export function findBackgroundConversation(executionId: string): BackgroundConversation | null {
  const id = String(executionId || '').trim();
  if (!/^bg_[a-zA-Z0-9-]+$/.test(id)) return null;
  const direct = readBackgroundConversation(id);
  if (direct) return direct;
  return listBackgroundConversations().find((conv) => conv.rounds.some((round) => round.executionId === id)) || null;
}

export function saveBackgroundConversation(conv: BackgroundConversation): void {
  fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
  const file = target(conv.rootId);
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const next: BackgroundConversation = {
    ...conv,
    updatedAt: Date.now(),
    rounds: conv.rounds.slice(-MAX_CONVERSATION_ROUNDS),
    evidence: conv.evidence.slice(-MAX_EVIDENCE),
    admissions: Object.fromEntries(Object.entries(conv.admissions || {}).slice(-MAX_ADMISSIONS)),
  };
  try {
    fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* renamed */ }
  }
}

export function deleteBackgroundConversation(rootId: string): void {
  try { fs.unlinkSync(target(rootId)); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
}

/**
 * Serialize conversation head admission across processes with the same SQLite
 * write-lock pattern as execution claims. Throws when the lock is unavailable:
 * unknown/busy ownership never grants admission.
 */
export function withBackgroundConversationLock<T>(fn: () => T): T {
  fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const db = new Database(path.join(root(), 'admission.sqlite'), { timeout: 2000 });
  try {
    db.exec('BEGIN IMMEDIATE');
    const result = fn();
    db.exec('COMMIT');
    return result;
  } finally {
    try { if (db.inTransaction) db.exec('ROLLBACK'); } catch { /* close releases the lock */ }
    try { db.close(); } catch { /* ignore */ }
  }
}

export function mergeConversationEvidence(existing: LedgerEvidence[], added: LedgerEvidence[] | undefined): LedgerEvidence[] {
  const seen = new Set(existing.map((entry) => entry.id));
  const merged = existing.slice();
  for (const entry of added || []) {
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push({ id: String(entry.id), name: String(entry.name), result: String(entry.result ?? '') });
  }
  return merged.slice(-MAX_EVIDENCE);
}
