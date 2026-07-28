import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type CoordinatedDevEditPhase =
  | 'approved'
  | 'waiting_for_files'
  | 'editing'
  | 'verified_ready'
  | 'verified_handoff'
  | 'apply_pending'
  | 'verified_not_live'
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
  verifiedAt?: number;
  verificationSummary?: string;
  /** Why an unfinished edit stopped; kept for recovery/audit, never for liveness. */
  abandonedAt?: number;
  abandonReason?: string;
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
  /** The cohort is frozen when the first verified edit asks to go live. */
  status: 'awaiting_members' | 'awaiting_approval' | 'applying' | 'applied' | 'not_live' | 'failed';
  leaderId: string;
  approvalId?: string;
  approvalExpiresAt?: number;
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

export interface DevEditVerificationResult {
  edit: CoordinatedDevEdit;
  awakened: CoordinatedDevEdit[];
}

const TERMINAL_PHASES = new Set<CoordinatedDevEditPhase>(['complete', 'failed', 'orphaned', 'abandoned']);
const READY_PHASES = new Set<CoordinatedDevEditPhase>(['verified_handoff', 'apply_pending', 'applying', 'applied', 'complete', 'verified_not_live']);
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

function isLeaseExpired(edit: CoordinatedDevEdit, now = Date.now()): boolean {
  return !TERMINAL_PHASES.has(edit.phase)
    && edit.phase !== 'applying'
    && Number(edit.leaseExpiresAt || 0) > 0
    && Number(edit.leaseExpiresAt) <= now;
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

function activeOwnerForFile(store: CoordinatorStore, file: string, excludeId = ''): CoordinatedDevEdit | undefined {
  return store.edits.find((edit) =>
    edit.id !== excludeId
    && !TERMINAL_PHASES.has(edit.phase)
    && edit.phase !== 'applied'
    && !isLeaseExpired(edit)
    && edit.ownedFiles.includes(file),
  );
}

function editParticipates(edit: CoordinatedDevEdit, now = Date.now()): boolean {
  if (TERMINAL_PHASES.has(edit.phase)) return false;
  if (edit.phase === 'applied') return false;
  if (isLeaseExpired(edit, now)) return false;
  // Reserving a scope during approval protects the files from a concurrent
  // writer, but it is not work that should hold up a shared deployment. A
  // live chat is intentionally not a liveness signal for every old request in
  // that chat; only a heartbeat on this edit extends its lease.
  if (edit.phase === 'approved') return false;
  const superseded = new Set(edit.supersededVerifiedFiles || []);
  return edit.ownedFiles.length > 0
    || edit.touchedFiles.some((file) => !superseded.has(file))
    || edit.inheritedFiles.length > 0
    || edit.waitingFiles.length > 0;
}

function openBatch(store: CoordinatorStore): CoordinatedDevApplyBatch | undefined {
  return store.batches.find((batch) => batch.status === 'awaiting_members' || batch.status === 'awaiting_approval' || batch.status === 'applying');
}

/**
 * Repair persisted coordination state before making a decision. This is both
 * normal lease enforcement and migration for batches created by older gateway
 * versions that could retain completed/stale members indefinitely.
 */
function reconcileStore(store: CoordinatorStore, now = Date.now()): boolean {
  let changed = false;
  for (const edit of store.edits) {
    if (!isLeaseExpired(edit, now)) continue;
    // A timed-out request must not continue to own files. Hand off each file
    // before clearing the record so an already-queued successor can proceed.
    edit.phase = 'abandoned';
    handOffQueuedFiles(store, edit);
    edit.ownedFiles = [];
    edit.waitingFiles = [];
    edit.batchId = undefined;
    edit.updatedAt = now;
    changed = true;
  }

  for (const batch of store.batches) {
    if (!['awaiting_members', 'awaiting_approval', 'applying'].includes(batch.status)) continue;
    // Do not mutate a cohort that has already started its single live apply.
    if (batch.status === 'applying') continue;
    const memberIds = batch.memberIds.filter((id) => {
      const edit = store.edits.find((item) => item.id === id);
      return !!edit && editParticipates(edit, now);
    });
    const membershipChanged = memberIds.length !== batch.memberIds.length;
    if (membershipChanged) {
      batch.memberIds = memberIds;
      changed = true;
      // A prior approval was for a different deployment cohort. Require a
      // fresh readiness boundary and approval after pruning members.
      if (batch.status === 'awaiting_approval') {
        batch.status = 'awaiting_members';
        batch.files = [];
        batch.approvalId = undefined;
        batch.approvalExpiresAt = undefined;
      }
    }
    const memberSet = new Set(memberIds);
    for (const edit of store.edits) {
      if (edit.batchId === batch.id && !memberSet.has(edit.id)) {
        edit.batchId = undefined;
        edit.updatedAt = now;
        changed = true;
      }
    }
    if (!memberIds.length) {
      batch.status = 'not_live';
      batch.memberSessionIds = [];
      batch.files = [];
      batch.approvalId = undefined;
      batch.approvalExpiresAt = undefined;
      changed = true;
      continue;
    }
    const members = store.edits.filter((edit) => memberSet.has(edit.id));
    const sessionIds = Array.from(new Set(members.map((edit) => edit.sessionId)));
    if (JSON.stringify(batch.memberSessionIds) !== JSON.stringify(sessionIds)) {
      batch.memberSessionIds = sessionIds;
      changed = true;
    }
    if (!memberSet.has(batch.leaderId)) {
      const replacement = members
        .filter((edit) => READY_PHASES.has(edit.phase) && verifiedSnapshotIsCurrent(edit))
        .sort((a, b) => (a.verifiedAt || a.updatedAt) - (b.verifiedAt || b.updatedAt) || a.createdAt - b.createdAt)[0]
        || members[0];
      batch.leaderId = replacement.id;
      changed = true;
    }
  }
  return changed;
}

function readReconciledStore(): CoordinatorStore {
  const store = readStore();
  if (reconcileStore(store)) writeStore(store);
  return store;
}

export function registerCoordinatedDevEdit(input: {
  id: string;
  sessionId: string;
  files: string[];
  leaseMs?: number;
}): CoordinatedDevEdit {
  const store = readReconciledStore();
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
      // A declined/expired live apply does not pin verified source forever.
      // With no open batch, the next request receives the verified version and
      // becomes its owner (it still must reread before writing).
      if (owner.phase === 'verified_not_live' && verifiedSnapshotIsCurrent(owner) && !openBatch(store)) {
        owner.ownedFiles = owner.ownedFiles.filter((item) => item !== file);
        owner.supersededVerifiedFiles = Array.from(new Set([...owner.supersededVerifiedFiles, file]));
        owned.add(file);
        waiting.delete(file);
      } else {
        owned.delete(file);
        waiting.add(file);
      }
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
    phase: waiting.size
      ? 'waiting_for_files'
      : (existing && TERMINAL_PHASES.has(existing.phase) ? 'approved' : (existing?.phase || 'approved')),
    verifiedSnapshot: existing?.verifiedSnapshot,
    verifiedAt: existing?.verifiedAt,
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
  const store = readReconciledStore();
  const cleanId = String(id || '').trim();
  const cleanSession = String(sessionId || '').trim();
  const candidates = store.edits
    .filter((edit) => !TERMINAL_PHASES.has(edit.phase))
    .filter((edit) => cleanId ? edit.id === cleanId : !!cleanSession && edit.sessionId === cleanSession)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates[0] ? cloneEdit(candidates[0]) : null;
}

export function listCoordinatedDevEdits(): CoordinatedDevEdit[] {
  return readReconciledStore().edits.map(cloneEdit);
}

export function listCoordinatedRestartBlockers(): CoordinatedDevEdit[] {
  return readReconciledStore().edits
    .filter((edit) => !TERMINAL_PHASES.has(edit.phase) && edit.phase !== 'applied')
    .filter(editParticipates)
    .map(cloneEdit);
}

export function listCoordinatedDevEditPeers(id: string): CoordinatedDevEdit[] {
  return readReconciledStore().edits
    .filter((edit) => edit.id !== id && editParticipates(edit))
    .map(cloneEdit);
}

export function claimCoordinatedDevEditFile(input: {
  id?: string;
  sessionId: string;
  file: string;
}): DevEditWriteDecision {
  const store = readReconciledStore();
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
  edit.verifiedAt = undefined;
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
}): DevEditVerificationResult | null {
  const store = readReconciledStore();
  const edit = store.edits.find((item) => item.id === input.id);
  if (!edit || TERMINAL_PHASES.has(edit.phase)) return null;
  edit.verificationSummary = String(input.summary || '').trim() || undefined;
  let awakened: CoordinatedDevEdit[] = [];
  if (input.success && edit.waitingFiles.length === 0) {
    const files = normalizeFiles(input.files.length ? input.files : edit.touchedFiles);
    edit.verifiedSnapshot = snapshotFiles(files);
    edit.verifiedAt = Date.now();
    edit.phase = 'verified_handoff';
    // Verification, not apply_live, is the safe handoff boundary. The next
    // editor must read the verified version before it writes its own change.
    awakened = handOffQueuedFiles(store, edit);
  } else if (!input.success) {
    edit.phase = 'editing';
    edit.verifiedSnapshot = undefined;
    edit.verifiedAt = undefined;
  }
  edit.updatedAt = Date.now();
  edit.leaseExpiresAt = Date.now() + DEFAULT_LEASE_MS;
  writeStore(store);
  return { edit: cloneEdit(edit), awakened: awakened.map(cloneEdit) };
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
  const store = readReconciledStore();
  const edit = store.edits.find((item) => item.id === String(id || '').trim());
  if (!edit || TERMINAL_PHASES.has(edit.phase)) throw new Error(`Active coordinated dev edit ${id} was not found.`);
  if (edit.waitingFiles.length) {
    throw new Error(`Dev edit ${edit.id} is still waiting for: ${edit.waitingFiles.join(', ')}.`);
  }
  if (!['verified_ready', 'verified_handoff', 'verified_not_live', 'apply_pending'].includes(edit.phase) || !verifiedSnapshotIsCurrent(edit)) {
    edit.phase = 'editing';
    edit.verifiedSnapshot = undefined;
    edit.verifiedAt = undefined;
    edit.updatedAt = Date.now();
    writeStore(store);
    throw new Error(`Dev edit ${edit.id} must pass verify_only against the current file versions before apply_live.`);
  }
  edit.phase = 'verified_handoff';
  edit.updatedAt = Date.now();
  // Keep this here as a recovery backstop for edits verified by older gateway
  // versions; normal handoff happens in record...Verification above.
  const awakened = handOffQueuedFiles(store, edit);
  // A verified handoff can make this edit fully superseded. Reconcile before
  // reusing an open batch so that the successor, not the relinquished edit,
  // is what determines the next deployment cohort.
  reconcileStore(store);
  let batch = openBatch(store);
  if (!batch) {
    const participants = store.edits.filter(editParticipates);
    const leader = participants
      .filter((item) => READY_PHASES.has(item.phase) && verifiedSnapshotIsCurrent(item))
      .sort((a, b) => (a.verifiedAt || a.updatedAt) - (b.verifiedAt || b.updatedAt) || a.createdAt - b.createdAt)[0] || edit;
    batch = {
      id: `dev_batch_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
      memberIds: participants.map((item) => item.id),
      memberSessionIds: Array.from(new Set(participants.map((item) => item.sessionId))),
      files: [],
      createdAt: Date.now(),
      status: 'awaiting_members',
      leaderId: leader.id,
    };
    for (const participant of participants) participant.batchId = batch.id;
    store.batches.push(batch);
  }
  const participants = store.edits.filter((item) => batch!.memberIds.includes(item.id));
  const blockers = participants.filter((item) => !READY_PHASES.has(item.phase) || !verifiedSnapshotIsCurrent(item));
  if (blockers.length) {
    writeStore(store);
    return {
      role: 'waiting',
      edit: cloneEdit(edit),
      blockers: blockers.map(cloneEdit),
      awakened: awakened.map(cloneEdit),
    };
  }
  batch.files = Array.from(new Set(participants.flatMap((item) => item.touchedFiles.length ? item.touchedFiles : item.requestedFiles)));
  batch.status = 'awaiting_approval';
  for (const member of participants) {
    member.phase = 'apply_pending';
    member.batchId = batch.id;
    member.updatedAt = Date.now();
  }
  writeStore(store);
  return {
    role: batch.leaderId === edit.id ? 'leader' : 'waiting',
    edit: cloneEdit(edit),
    batch: JSON.parse(JSON.stringify(batch)),
    blockers: [],
    awakened: awakened.map(cloneEdit),
  };
}

export function markCoordinatedDevApplyBatch(
  batchId: string,
  status: 'applied' | 'not_live' | 'failed',
  failure?: string,
): CoordinatedDevApplyBatch | null {
  const store = readReconciledStore();
  const batch = store.batches.find((item) => item.id === batchId);
  if (!batch) return null;
  batch.status = status;
  batch.failure = status === 'failed' ? String(failure || 'Dev apply batch failed.') : undefined;
  for (const edit of store.edits.filter((item) => item.batchId === batchId)) {
    edit.phase = status === 'applied' ? 'applied' : status === 'not_live' ? 'verified_not_live' : 'verified_handoff';
    if (status === 'failed') edit.batchId = undefined;
    if (status === 'applied') {
      edit.ownedFiles = [];
      edit.waitingFiles = [];
    }
    edit.updatedAt = Date.now();
  }
  if (status === 'not_live') {
    // Let work queued while the batch approval card was visible continue on
    // the verified on-disk version. A waiter receives one file at a time FIFO.
    for (const edit of store.edits.filter((item) => item.batchId === batchId)) {
      handOffQueuedFiles(store, edit);
    }
  }
  writeStore(store);
  return JSON.parse(JSON.stringify(batch));
}

export function setCoordinatedDevApplyBatchApproval(input: {
  batchId: string;
  approvalId: string;
  expiresAt: number;
}): CoordinatedDevApplyBatch | null {
  const store = readReconciledStore();
  const batch = store.batches.find((item) => item.id === input.batchId);
  if (!batch || batch.status !== 'awaiting_approval') return null;
  batch.approvalId = String(input.approvalId || '').trim() || undefined;
  batch.approvalExpiresAt = Number(input.expiresAt || 0) || undefined;
  writeStore(store);
  return JSON.parse(JSON.stringify(batch));
}

export function beginCoordinatedDevApplyBatch(batchId: string): CoordinatedDevApplyBatch | null {
  const store = readReconciledStore();
  const batch = store.batches.find((item) => item.id === batchId);
  if (!batch || batch.status !== 'awaiting_approval') return null;
  batch.status = 'applying';
  for (const edit of store.edits.filter((item) => item.batchId === batchId)) {
    edit.phase = 'applying';
    edit.updatedAt = Date.now();
  }
  writeStore(store);
  return JSON.parse(JSON.stringify(batch));
}

export function markCoordinatedDevEditComplete(id: string): void {
  const store = readReconciledStore();
  const edit = store.edits.find((item) => item.id === id);
  if (!edit) return;
  edit.phase = 'complete';
  edit.updatedAt = Date.now();
  reconcileStore(store);
  writeStore(store);
}

/**
 * End unfinished work explicitly. This intentionally preserves the requested,
 * touched, and verification evidence, but releases file ownership and removes
 * the edit from any not-yet-live deployment cohort. An in-flight apply is
 * deliberately left alone: stopping the chat must not pretend a live build or
 * restart was cancelled after it has already begun.
 */
export function abandonCoordinatedDevEditsForSession(input: {
  sessionId: string;
  reason?: string;
}): CoordinatedDevEdit[] {
  const store = readReconciledStore();
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId) return [];
  const now = Date.now();
  const reason = String(input.reason || 'runtime_aborted').trim().slice(0, 500) || 'runtime_aborted';
  const abandoned: CoordinatedDevEdit[] = [];
  for (const edit of store.edits) {
    if (edit.sessionId !== sessionId || TERMINAL_PHASES.has(edit.phase)) continue;
    if (edit.phase === 'applying' || edit.phase === 'applied') continue;
    handOffQueuedFiles(store, edit);
    edit.phase = 'abandoned';
    edit.ownedFiles = [];
    edit.waitingFiles = [];
    edit.batchId = undefined;
    edit.abandonedAt = now;
    edit.abandonReason = reason;
    edit.updatedAt = now;
    abandoned.push(cloneEdit(edit));
  }
  if (abandoned.length) {
    reconcileStore(store, now);
    writeStore(store);
  }
  return abandoned;
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
