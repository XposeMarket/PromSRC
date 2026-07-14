import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type CoordinatedDevEditPhase =
  | 'approved'
  | 'waiting_for_files'
  | 'editing'
  | 'verified_ready'
  | 'verified_handoff'
  | 'applying'
  | 'applied'
  | 'complete'
  | 'failed'
  | 'orphaned'
  | 'abandoned';

export interface CoordinatedDevEdit {
  id: string;
  sessionId: string;
  requestedFiles: string[];
  ownedFiles: string[];
  waitingFiles: string[];
  touchedFiles: string[];
  inheritedFiles: string[];
  supersededVerifiedFiles: string[];
  phase: CoordinatedDevEditPhase;
  verifiedSnapshot?: Record<string, string>;
  verificationSummary?: string;
  batchId?: string;
  createdAt: number;
  updatedAt: number;
  leaseExpiresAt: number;
}

export interface CoordinatedDevApplyBatch {
  id: string;
  memberIds: string[];
  memberSessionIds: string[];
  files: string[];
  createdAt: number;
  status: 'applying' | 'applied' | 'failed';
  failure?: string;
}

interface CoordinatorStore {
  version: 1;
  revision: number;
  edits: CoordinatedDevEdit[];
  batches: CoordinatedDevApplyBatch[];
}

export interface DevEditWriteDecision {
  allowed: boolean;
  edit?: CoordinatedDevEdit;
  reason?: string;
  ownerEditId?: string;
  ownerSessionId?: string;
}

export interface DevEditApplyDecision {
  role: 'waiting' | 'leader';
  edit: CoordinatedDevEdit;
  batch?: CoordinatedDevApplyBatch;
  blockers: CoordinatedDevEdit[];
  awakened: CoordinatedDevEdit[];
}

const TERMINAL_PHASES = new Set<CoordinatedDevEditPhase>(['complete', 'failed', 'abandoned']);
const READY_PHASES = new Set<CoordinatedDevEditPhase>(['verified_handoff', 'applying', 'applied', 'complete']);
const DEFAULT_LEASE_MS = 2 * 60 * 60 * 1000;

function stateRoot(): string {
  if (process.env.PROMETHEUS_DATA_DIR) return process.env.PROMETHEUS_DATA_DIR;
  if (process.env.PROMETHEUS_APP_ROOT) return process.env.PROMETHEUS_APP_ROOT;
  return path.resolve(__dirname, '..', '..');
}

function projectRoot(): string {
  if (process.env.PROMETHEUS_APP_ROOT) return process.env.PROMETHEUS_APP_ROOT;
  return path.resolve(__dirname, '..', '..');
}

function storePath(): string {
  const dir = path.join(stateRoot(), '.prometheus');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'dev-edit-coordination.json');
}

function emptyStore(): CoordinatorStore {
  return { version: 1, revision: 0, edits: [], batches: [] };
}

function normalizeFile(value: unknown): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/{2,}/g, '/');
}

function normalizeFiles(value: unknown): string[] {
  return Array.from(new Set((Array.isArray(value) ? value : []).map(normalizeFile).filter(Boolean)));
}

function readStore(): CoordinatorStore {
  const p = storePath();
  if (!fs.existsSync(p)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return {
      version: 1,
      revision: Number(parsed?.revision || 0),
      edits: Array.isArray(parsed?.edits) ? parsed.edits : [],
      batches: Array.isArray(parsed?.batches) ? parsed.batches : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: CoordinatorStore): void {
  const p = storePath();
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  store.revision = Number(store.revision || 0) + 1;
  store.edits = store.edits.slice(-200);
  store.batches = store.batches.slice(-100);
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

function hashFile(file: string): string {
  const root = path.resolve(projectRoot());
  const abs = path.resolve(root, normalizeFile(file));
  if (!abs.startsWith(root) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return 'missing';
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function snapshotFiles(files: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of normalizeFiles(files)) out[file] = hashFile(file);
  return out;
}

function cloneEdit(edit: CoordinatedDevEdit): CoordinatedDevEdit {
  return JSON.parse(JSON.stringify(edit));
}

function isLiveSession(sessionId: string): boolean {
  try {
    // Dynamic require avoids making approval/bootstrap modules depend eagerly on
    // the live runtime registry during gateway startup.
    const { listLiveRuntimes } = require('./live-runtime-registry') as typeof import('./live-runtime-registry');
    return listLiveRuntimes().some((runtime) => runtime.sessionId === sessionId && runtime.status === 'running');
  } catch {
    return false;
  }
}

function activeOwnerForFile(store: CoordinatorStore, file: string, excludeId = ''): CoordinatedDevEdit | undefined {
  return store.edits.find((edit) =>
    edit.id !== excludeId
    && !TERMINAL_PHASES.has(edit.phase)
    && edit.phase !== 'applied'
    && edit.ownedFiles.includes(file),
  );
}

function editParticipates(edit: CoordinatedDevEdit): boolean {
  if (TERMINAL_PHASES.has(edit.phase)) return false;
  if (edit.phase === 'applied') return false;
  return edit.touchedFiles.length > 0
    || edit.inheritedFiles.length > 0
    || edit.waitingFiles.length > 0
    || edit.phase !== 'approved'
    || isLiveSession(edit.sessionId);
}

export function registerCoordinatedDevEdit(input: {
  id: string;
  sessionId: string;
  files: string[];
  leaseMs?: number;
}): CoordinatedDevEdit {
  const store = readStore();
  const id = String(input.id || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  const files = normalizeFiles(input.files);
  const now = Date.now();
  const existingIndex = store.edits.findIndex((edit) => edit.id === id);
  const existing = existingIndex >= 0 ? store.edits[existingIndex] : undefined;
  const owned = new Set(existing?.ownedFiles || []);
  const waiting = new Set(existing?.waitingFiles || []);
  for (const file of files) {
    const owner = activeOwnerForFile(store, file, id);
    if (owner) {
      owned.delete(file);
      waiting.add(file);
    } else {
      waiting.delete(file);
      owned.add(file);
    }
  }
  const edit: CoordinatedDevEdit = {
    id,
    sessionId,
    requestedFiles: Array.from(new Set([...(existing?.requestedFiles || []), ...files])),
    ownedFiles: Array.from(owned),
    waitingFiles: Array.from(waiting),
    touchedFiles: existing?.touchedFiles || [],
    inheritedFiles: existing?.inheritedFiles || [],
    supersededVerifiedFiles: existing?.supersededVerifiedFiles || [],
    phase: waiting.size ? 'waiting_for_files' : (existing?.phase || 'approved'),
    verifiedSnapshot: existing?.verifiedSnapshot,
    verificationSummary: existing?.verificationSummary,
    batchId: existing?.batchId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    leaseExpiresAt: now + Math.max(60_000, Number(input.leaseMs || DEFAULT_LEASE_MS)),
  };
  if (existingIndex >= 0) store.edits[existingIndex] = edit;
  else store.edits.push(edit);
  writeStore(store);
  return cloneEdit(edit);
}

export function getCoordinatedDevEdit(id?: string, sessionId?: string): CoordinatedDevEdit | null {
  const store = readStore();
  const cleanId = String(id || '').trim();
  const cleanSession = String(sessionId || '').trim();
  const candidates = store.edits
    .filter((edit) => !TERMINAL_PHASES.has(edit.phase))
    .filter((edit) => cleanId ? edit.id === cleanId : !!cleanSession && edit.sessionId === cleanSession)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates[0] ? cloneEdit(candidates[0]) : null;
}

export function listCoordinatedDevEdits(): CoordinatedDevEdit[] {
  return readStore().edits.map(cloneEdit);
}

export function listCoordinatedRestartBlockers(): CoordinatedDevEdit[] {
  return readStore().edits
    .filter((edit) => !TERMINAL_PHASES.has(edit.phase) && edit.phase !== 'applied')
    .filter(editParticipates)
    .map(cloneEdit);
}

export function listCoordinatedDevEditPeers(id: string): CoordinatedDevEdit[] {
  return readStore().edits
    .filter((edit) => edit.id !== id && editParticipates(edit))
    .map(cloneEdit);
}

export function claimCoordinatedDevEditFile(input: {
  id?: string;
  sessionId: string;
  file: string;
}): DevEditWriteDecision {
  const store = readStore();
  const file = normalizeFile(input.file);
  const cleanId = String(input.id || '').trim();
  const candidates = store.edits
    .filter((edit) => !TERMINAL_PHASES.has(edit.phase))
    .filter((edit) => cleanId ? edit.id === cleanId : edit.sessionId === input.sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const edit = candidates[0];
  if (!edit) return { allowed: false, reason: 'No active coordinated dev edit is registered for this session.' };
  const owner = activeOwnerForFile(store, file, edit.id);
  if (owner || edit.waitingFiles.includes(file) || !edit.ownedFiles.includes(file)) {
    return {
      allowed: false,
      edit: cloneEdit(edit),
      ownerEditId: owner?.id,
      ownerSessionId: owner?.sessionId,
      reason: owner
        ? `File ${file} is queued behind dev edit ${owner.id}. Wait for its verified handoff before writing.`
        : `File ${file} is not currently owned by dev edit ${edit.id}.`,
    };
  }
  edit.touchedFiles = Array.from(new Set([...edit.touchedFiles, file]));
  edit.phase = 'editing';
  edit.verifiedSnapshot = undefined;
  edit.verificationSummary = undefined;
  edit.updatedAt = Date.now();
  edit.leaseExpiresAt = Date.now() + DEFAULT_LEASE_MS;
  writeStore(store);
  return { allowed: true, edit: cloneEdit(edit) };
}

export function recordCoordinatedDevEditVerification(input: {
  id: string;
  files: string[];
  success: boolean;
  summary?: string;
}): CoordinatedDevEdit | null {
  const store = readStore();
  const edit = store.edits.find((item) => item.id === input.id);
  if (!edit || TERMINAL_PHASES.has(edit.phase)) return null;
  edit.verificationSummary = String(input.summary || '').trim() || undefined;
  if (input.success && edit.waitingFiles.length === 0) {
    const files = normalizeFiles(input.files.length ? input.files : edit.touchedFiles);
    edit.verifiedSnapshot = snapshotFiles(files);
    edit.phase = 'verified_ready';
  } else if (!input.success) {
    edit.phase = 'editing';
    edit.verifiedSnapshot = undefined;
  }
  edit.updatedAt = Date.now();
  edit.leaseExpiresAt = Date.now() + DEFAULT_LEASE_MS;
  writeStore(store);
  return cloneEdit(edit);
}

function verifiedSnapshotIsCurrent(edit: CoordinatedDevEdit): boolean {
  if (!edit.verifiedSnapshot) return false;
  const superseded = new Set(edit.supersededVerifiedFiles || []);
  return Object.entries(edit.verifiedSnapshot).every(([file, expected]) => superseded.has(file) || hashFile(file) === expected);
}

function handOffQueuedFiles(store: CoordinatorStore, owner: CoordinatedDevEdit): CoordinatedDevEdit[] {
  const awakened: CoordinatedDevEdit[] = [];
  for (const file of [...owner.ownedFiles]) {
    const waiter = store.edits
      .filter((edit) => edit.id !== owner.id && !TERMINAL_PHASES.has(edit.phase) && edit.waitingFiles.includes(file))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!waiter) continue;
    owner.ownedFiles = owner.ownedFiles.filter((item) => item !== file);
    owner.supersededVerifiedFiles = Array.from(new Set([...owner.supersededVerifiedFiles, file]));
    waiter.waitingFiles = waiter.waitingFiles.filter((item) => item !== file);
    waiter.ownedFiles = Array.from(new Set([...waiter.ownedFiles, file]));
    waiter.inheritedFiles = Array.from(new Set([...waiter.inheritedFiles, file]));
    waiter.phase = 'editing';
    waiter.updatedAt = Date.now();
    waiter.leaseExpiresAt = Date.now() + DEFAULT_LEASE_MS;
    awakened.push(waiter);
  }
  return awakened;
}

export function requestCoordinatedDevEditApply(id: string): DevEditApplyDecision {
  const store = readStore();
  const edit = store.edits.find((item) => item.id === String(id || '').trim());
  if (!edit || TERMINAL_PHASES.has(edit.phase)) throw new Error(`Active coordinated dev edit ${id} was not found.`);
  if (edit.waitingFiles.length) {
    throw new Error(`Dev edit ${edit.id} is still waiting for: ${edit.waitingFiles.join(', ')}.`);
  }
  if (edit.phase !== 'verified_ready' || !verifiedSnapshotIsCurrent(edit)) {
    edit.phase = 'editing';
    edit.verifiedSnapshot = undefined;
    edit.updatedAt = Date.now();
    writeStore(store);
    throw new Error(`Dev edit ${edit.id} must pass verify_only against the current file versions before apply_live.`);
  }
  edit.phase = 'verified_handoff';
  edit.updatedAt = Date.now();
  const awakened = handOffQueuedFiles(store, edit);
  const participants = store.edits.filter(editParticipates);
  const blockers = participants.filter((item) => !READY_PHASES.has(item.phase));
  if (blockers.length) {
    writeStore(store);
    return {
      role: 'waiting',
      edit: cloneEdit(edit),
      blockers: blockers.map(cloneEdit),
      awakened: awakened.map(cloneEdit),
    };
  }
  const members = participants.filter((item) => READY_PHASES.has(item.phase));
  const batch: CoordinatedDevApplyBatch = {
    id: `dev_batch_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
    memberIds: members.map((item) => item.id),
    memberSessionIds: Array.from(new Set(members.map((item) => item.sessionId))),
    files: Array.from(new Set(members.flatMap((item) => item.touchedFiles.length ? item.touchedFiles : item.requestedFiles))),
    createdAt: Date.now(),
    status: 'applying',
  };
  for (const member of members) {
    member.phase = 'applying';
    member.batchId = batch.id;
    member.updatedAt = Date.now();
  }
  store.batches.push(batch);
  writeStore(store);
  return {
    role: 'leader',
    edit: cloneEdit(edit),
    batch: JSON.parse(JSON.stringify(batch)),
    blockers: [],
    awakened: awakened.map(cloneEdit),
  };
}

export function markCoordinatedDevApplyBatch(
  batchId: string,
  status: 'applied' | 'failed',
  failure?: string,
): CoordinatedDevApplyBatch | null {
  const store = readStore();
  const batch = store.batches.find((item) => item.id === batchId);
  if (!batch) return null;
  batch.status = status;
  batch.failure = status === 'failed' ? String(failure || 'Dev apply batch failed.') : undefined;
  for (const edit of store.edits.filter((item) => item.batchId === batchId)) {
    edit.phase = status === 'applied' ? 'applied' : 'verified_handoff';
    if (status === 'failed') edit.batchId = undefined;
    if (status === 'applied') {
      edit.ownedFiles = [];
      edit.waitingFiles = [];
    }
    edit.updatedAt = Date.now();
  }
  writeStore(store);
  return JSON.parse(JSON.stringify(batch));
}

export function markCoordinatedDevEditComplete(id: string): void {
  const store = readStore();
  const edit = store.edits.find((item) => item.id === id);
  if (!edit) return;
  edit.phase = 'complete';
  edit.updatedAt = Date.now();
  writeStore(store);
}

export async function waitForCoordinatedDevEditFiles(
  id: string,
  timeoutMs = 15 * 60_000,
): Promise<CoordinatedDevEdit | null> {
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  while (Date.now() < deadline) {
    const edit = getCoordinatedDevEdit(id);
    if (!edit) return null;
    if (edit.waitingFiles.length === 0) return edit;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return getCoordinatedDevEdit(id);
}
