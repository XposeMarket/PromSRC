import { appendAuditEntry } from './audit-log';
import { activateToolCategory, getSessionMutationScope, setSessionMutationScope } from './session';
import { isPublicDistributionBuild } from '../runtime/distribution.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  markCoordinatedDevEditComplete,
  registerCoordinatedDevEdit,
} from './dev-edit-coordinator';

export interface DevSourceEditEvidence {
  file: string;
  lines?: string;
  finding: string;
}

export interface DevSourceEditPlan {
  userRequest?: string;
  reasoning?: string;
  evidence: DevSourceEditEvidence[];
  currentState?: string;
  fix?: string;
  steps: string[];
  verification: string[];
  expectedWorkflow: string[];
  completionNoteTag: string;
}

export interface DevSourceEditScope {
  devEditId: string;
  allowedFiles: string[];
  allowedDirs: string[];
  verificationCommand?: string;
  verificationProfile?: DevSourceVerificationProfile;
  verificationProfiles?: DevSourceVerificationProfile[];
  reason?: string;
  plan?: DevSourceEditPlan;
  planHash?: string;
  expiresAt: number;
  approvalId?: string;
}

export interface DevSourceEditContinuation {
  id: string;
  sessionId: string;
  approvalId?: string;
  planHash?: string;
  status: 'approved' | 'applying_live' | 'complete';
  completionNoteTag: string;
  plan?: DevSourceEditPlan;
  allowedFiles: string[];
  allowedDirs?: string[];
  affectedFiles?: string[];
  changedSurfaces?: string[];
  summary?: string;
  verification?: string[];
  verificationProfile?: DevSourceVerificationProfile;
  verificationProfiles?: DevSourceVerificationProfile[];
  lastVerification?: {
    profileIds: DevSourceVerificationProfile[];
    changedFiles: string[];
    success: boolean;
    summary: string;
    completedAt: number;
  };
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  completionNote?: string;
}

const grants = new Map<string, DevSourceEditScope>();
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const DEV_SOURCE_SELF_DOC_DIRS = ['self', 'workspace/self'];
export type DevSourceVerificationProfile =
  | 'backend_build'
  | 'webui_sync_check'
  | 'full_build'
  | 'route_smoke'
  | 'desktop_ui_smoke'
  | 'mobile_ui_smoke'
  | 'none';

const DEV_SOURCE_VERIFICATION_PROFILES: DevSourceVerificationProfile[] = [
  'backend_build',
  'webui_sync_check',
  'full_build',
  'route_smoke',
  'desktop_ui_smoke',
  'mobile_ui_smoke',
  'none',
];

function normalizePath(input: unknown): string {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

function normalizeAllowedFiles(files: unknown): string[] {
  const rawFiles = Array.isArray(files) ? files : [];
  return Array.from(new Set(
    rawFiles
      .map(normalizePath)
      .filter((file) => file.startsWith('src/') || file.startsWith('web-ui/')),
  ));
}

function normalizeTextArray(value: unknown, fallback: string[] = []): string[] {
  const raw = Array.isArray(value) ? value : fallback;
  return raw.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12);
}

function normalizeAllowedDirs(dirs: unknown): string[] {
  const rawDirs = Array.isArray(dirs) ? dirs : [];
  return Array.from(new Set(
    [...DEV_SOURCE_SELF_DOC_DIRS, ...rawDirs]
      .map(normalizePath)
      .filter((dir) => dir === 'self' || dir.startsWith('self/') || dir === 'workspace/self' || dir.startsWith('workspace/self/')),
  ));
}

export function normalizeDevSourceVerificationProfiles(value: unknown): DevSourceVerificationProfile[] {
  const raw = Array.isArray(value) ? value : [value];
  const profiles = raw
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item): item is DevSourceVerificationProfile => DEV_SOURCE_VERIFICATION_PROFILES.includes(item as DevSourceVerificationProfile));
  return Array.from(new Set(profiles));
}

function normalizeEvidence(value: unknown): DevSourceEditEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    file: normalizePath(item?.file || item?.path),
    lines: String(item?.lines || item?.line || '').trim() || undefined,
    finding: String(item?.finding || item?.reason || item?.summary || '').trim(),
  })).filter((item) => item.file && item.finding).slice(0, 12);
}

function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex').slice(0, 16);
}

export function normalizeDevSourceEditPlan(input: {
  plan?: unknown;
  userRequest?: unknown;
  reasoning?: unknown;
  evidence?: unknown;
  currentState?: unknown;
  fix?: unknown;
  steps?: unknown;
  verification?: unknown;
  expectedWorkflow?: unknown;
  completionNoteTag?: unknown;
  allowedFiles: string[];
  reason?: string;
  verificationCommand?: string;
  verificationProfile?: DevSourceVerificationProfile;
  verificationProfiles?: DevSourceVerificationProfile[];
}): DevSourceEditPlan {
  const raw = input.plan && typeof input.plan === 'object' ? input.plan as any : {};
  const userRequest = String(raw.user_request || raw.userRequest || input.userRequest || '').trim();
  const reasoning = String(raw.reasoning || raw.reason || input.reasoning || input.reason || '').trim();
  const evidence = normalizeEvidence(raw.evidence || input.evidence);
  const currentState = String(raw.current_state || raw.currentState || input.currentState || '').trim();
  const fix = String(raw.fix || input.fix || '').trim();
  const verificationFallback = [
    input.verificationCommand,
    ...(input.verificationProfiles && input.verificationProfiles.length
      ? input.verificationProfiles.map((profile) => `verification_profile:${profile}`)
      : [input.verificationProfile ? `verification_profile:${input.verificationProfile}` : '']),
  ].filter(Boolean).map(String);
  const steps = normalizeTextArray(raw.steps || raw.plan_steps || input.steps, [
    'Inspect the approved source files and confirm the existing behavior.',
    'Apply the smallest scoped patch that satisfies the request.',
    'Run the selected verification.',
    'Apply live dev changes with prom_apply_dev_changes.',
    'Write the dev_edit_complete note and summarize the result.',
  ]);
  const verification = normalizeTextArray(raw.verification || raw.verify || input.verification, verificationFallback);
  const expectedWorkflow = normalizeTextArray(raw.expected_workflow || raw.expectedWorkflow || raw.after_edit_workflow || raw.afterEditWorkflow || input.expectedWorkflow, [
    'After approval, Prometheus unlocks source-write tools only for the approved files in this chat/session.',
    'Prometheus applies the scoped patch, rereads the changed areas when useful, and runs the approved verification or verify_only preflight.',
    'When verification is clean, prom_apply_dev_changes apply_live syncs/builds and restarts or reloads the affected Prometheus surfaces.',
    'After restart/reload, Prometheus writes the approved completion note, closes the declared dev-edit plan, and replies with what changed plus live status.',
  ]);
  const completionNoteTag = String(raw.completion_note_tag || raw.completionNoteTag || input.completionNoteTag || 'dev_edit_complete')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase() || 'dev_edit_complete';

  return {
    userRequest: userRequest || undefined,
    reasoning: reasoning || input.reason || undefined,
    evidence,
    currentState: currentState || undefined,
    fix: fix || undefined,
    steps,
    verification,
    expectedWorkflow,
    completionNoteTag,
  };
}

function getLifecycleStateRoot(): string {
  if (process.env.PROMETHEUS_DATA_DIR) return process.env.PROMETHEUS_DATA_DIR;
  if (process.env.PROMETHEUS_APP_ROOT) return process.env.PROMETHEUS_APP_ROOT;
  return path.resolve(__dirname, '..', '..');
}

function getContinuationStorePath(): string {
  const dir = path.join(getLifecycleStateRoot(), '.prometheus');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'dev-edit-continuations.json');
}

function readContinuationStore(): { continuations: DevSourceEditContinuation[] } {
  const p = getContinuationStorePath();
  if (!fs.existsSync(p)) return { continuations: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return { continuations: Array.isArray(parsed?.continuations) ? parsed.continuations : [] };
  } catch {
    return { continuations: [] };
  }
}

function writeContinuationStore(store: { continuations: DevSourceEditContinuation[] }): void {
  const p = getContinuationStorePath();
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

export function upsertDevSourceEditContinuation(record: DevSourceEditContinuation): DevSourceEditContinuation {
  const store = readContinuationStore();
  const idx = store.continuations.findIndex((item) => item.id === record.id);
  const next = { ...record, updatedAt: Date.now() };
  if (idx >= 0) store.continuations[idx] = { ...store.continuations[idx], ...next };
  else store.continuations.push(next);
  store.continuations = store.continuations.slice(-100);
  writeContinuationStore(store);
  return next;
}

export function getLatestPendingDevSourceEditContinuation(sessionId?: string): DevSourceEditContinuation | null {
  const sid = String(sessionId || '').trim();
  const items = readContinuationStore().continuations
    .filter((item) => item && item.status !== 'complete')
    .filter((item) => !sid || item.sessionId === sid)
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  return items[0] || null;
}

export function getDevSourceEditContinuation(id?: string): DevSourceEditContinuation | null {
  const clean = String(id || '').trim();
  if (!clean) return null;
  return readContinuationStore().continuations.find((item) => item.id === clean) || null;
}

export function listDevSourceEditContinuations(): DevSourceEditContinuation[] {
  return readContinuationStore().continuations
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .map((item) => JSON.parse(JSON.stringify(item)));
}

export function restoreDevSourceEditContinuationAccess(
  continuationOrId: DevSourceEditContinuation | string,
  restoredBy = 'request_recovery',
): DevSourceEditScope {
  if (isPublicDistributionBuild()) {
    throw new Error('Dev source edit approvals are disabled in the public distribution build.');
  }
  const continuation = typeof continuationOrId === 'string'
    ? getDevSourceEditContinuation(continuationOrId)
    : continuationOrId;
  if (!continuation) throw new Error('Dev source edit continuation not found.');
  if (continuation.status !== 'approved') {
    throw new Error(`Dev source edit ${continuation.id} cannot restore access in status=${continuation.status}.`);
  }
  const sid = String(continuation.sessionId || '').trim();
  if (!sid) throw new Error(`Dev source edit ${continuation.id} has no owning session.`);
  const allowedFiles = normalizeAllowedFiles(continuation.allowedFiles);
  const allowedDirs = normalizeAllowedDirs(continuation.allowedDirs);
  if (allowedFiles.length === 0) {
    throw new Error(`Dev source edit ${continuation.id} has no restorable source files.`);
  }
  const currentScope = getSessionMutationScope(sid);
  const mergedFiles = Array.from(new Set([...(currentScope?.allowedFiles || []), ...allowedFiles]));
  const mergedDirs = Array.from(new Set([...(currentScope?.allowedDirs || []), ...allowedDirs]));
  const scope: DevSourceEditScope = {
    devEditId: continuation.id,
    allowedFiles: mergedFiles,
    allowedDirs: mergedDirs,
    verificationProfile: continuation.verificationProfile,
    verificationProfiles: continuation.verificationProfiles,
    plan: continuation.plan,
    planHash: continuation.planHash,
    approvalId: continuation.approvalId,
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  };
  setSessionMutationScope(sid, { allowedFiles: mergedFiles, allowedDirs: mergedDirs });
  activateToolCategory(sid, 'prometheus_source_read');
  activateToolCategory(sid, 'prometheus_source_write');
  grants.set(sid, scope);
  registerCoordinatedDevEdit({
    id: continuation.id,
    sessionId: sid,
    files: allowedFiles,
    leaseMs: DEFAULT_TTL_MS,
  });
  appendAuditEntry({
    sessionId: sid,
    actionType: 'approval_resolved',
    toolName: 'prometheus_request_ops',
    toolArgs: {
      action: 'restore_existing_dev_edit_access',
      devEditId: continuation.id,
      allowedFiles,
      restoredBy,
    },
    policyTier: 'commit',
    approvalStatus: 'approved',
    resultSummary: `Restored the existing approved dev-edit scope for ${allowedFiles.length} file(s); no new request or approval was created.`,
  });
  return scope;
}

export function markDevSourceEditContinuationComplete(input: {
  id?: string;
  sessionId?: string;
  tag?: string;
  note?: string;
}): DevSourceEditContinuation | null {
  const tag = String(input.tag || '').trim().replace(/\s+/g, '_').toLowerCase();
  const direct = getDevSourceEditContinuation(input.id);
  const pending = direct || getLatestPendingDevSourceEditContinuation(input.sessionId);
  if (!pending) return null;
  if (tag && tag !== String(pending.completionNoteTag || '').trim().toLowerCase()) return null;
  const completed = upsertDevSourceEditContinuation({
    ...pending,
    status: 'complete',
    completedAt: Date.now(),
    completionNote: String(input.note || '').trim() || undefined,
  });
  try { markCoordinatedDevEditComplete(completed.id); } catch {}
  return completed;
}

export function createDevSourceEditApprovalScope(input: {
  sessionId: string;
  files: unknown;
  allowedDirs?: unknown;
  verificationCommand?: unknown;
  verificationProfile?: unknown;
  verificationProfiles?: unknown;
  reason?: unknown;
  plan?: unknown;
  userRequest?: unknown;
  reasoning?: unknown;
  evidence?: unknown;
  currentState?: unknown;
  fix?: unknown;
  steps?: unknown;
  verification?: unknown;
  expectedWorkflow?: unknown;
  completionNoteTag?: unknown;
  approvalId?: string;
  devEditId?: string;
  ttlMs?: number;
}): DevSourceEditScope {
  if (isPublicDistributionBuild()) {
    throw new Error('Dev source edit approvals are disabled in the public distribution build.');
  }
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId) throw new Error('sessionId is required');
  const allowedFiles = normalizeAllowedFiles(input.files);
  const allowedDirs = normalizeAllowedDirs(input.allowedDirs);
  if (allowedFiles.length === 0) {
    throw new Error('At least one src/ or web-ui/ file is required.');
  }
  const requestedProfiles = normalizeDevSourceVerificationProfiles((input as any).verificationProfiles || input.verificationProfile);
  const verificationProfile = requestedProfiles[0] || undefined;
  const verificationProfiles = requestedProfiles.length ? requestedProfiles : undefined;
  const verificationCommand = String(input.verificationCommand || '').trim() || undefined;
  const reason = String(input.reason || '').trim() || undefined;
  const plan = normalizeDevSourceEditPlan({
    plan: input.plan,
    userRequest: input.userRequest,
    reasoning: input.reasoning,
    evidence: input.evidence,
    currentState: input.currentState,
    fix: input.fix,
    steps: input.steps,
    verification: input.verification,
    expectedWorkflow: input.expectedWorkflow,
    completionNoteTag: input.completionNoteTag,
    allowedFiles,
    reason,
    verificationCommand,
    verificationProfile,
    verificationProfiles,
  });
  const planHash = stableHash(plan);
  const devEditId = String(input.devEditId || '').trim() || `dev_edit_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  return {
    devEditId,
    allowedFiles,
    allowedDirs,
    verificationCommand,
    verificationProfile,
    verificationProfiles,
    reason,
    plan,
    planHash,
    approvalId: input.approvalId,
    expiresAt: Date.now() + Math.max(60_000, Number(input.ttlMs || DEFAULT_TTL_MS) || DEFAULT_TTL_MS),
  };
}

export function grantDevSourceEditApproval(sessionId: string, scope: DevSourceEditScope, approvedBy = 'user'): DevSourceEditScope {
  if (isPublicDistributionBuild()) {
    throw new Error('Dev source edit approvals are disabled in the public distribution build.');
  }
  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('sessionId is required');
  const currentScope = getSessionMutationScope(sid);
  const mergedFiles = Array.from(new Set([
    ...(currentScope?.allowedFiles || []),
    ...scope.allowedFiles,
  ]));
  const mergedDirs = Array.from(new Set([
    ...(currentScope?.allowedDirs || []),
    ...scope.allowedDirs,
  ].map(normalizePath).filter(Boolean)));
  setSessionMutationScope(sid, { allowedFiles: mergedFiles, allowedDirs: mergedDirs });
  activateToolCategory(sid, 'prometheus_source_read');
  activateToolCategory(sid, 'prometheus_source_write');
  const grant = { ...scope, allowedFiles: mergedFiles, allowedDirs: mergedDirs };
  grants.set(sid, grant);
  upsertDevSourceEditContinuation({
    id: grant.devEditId,
    sessionId: sid,
    approvalId: grant.approvalId,
    planHash: grant.planHash,
    status: 'approved',
    completionNoteTag: grant.plan?.completionNoteTag || 'dev_edit_complete',
    plan: grant.plan,
    allowedFiles: grant.allowedFiles,
    allowedDirs: grant.allowedDirs,
    verification: grant.plan?.verification,
    verificationProfile: grant.verificationProfile,
    verificationProfiles: grant.verificationProfiles,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  registerCoordinatedDevEdit({
    id: grant.devEditId,
    sessionId: sid,
    files: grant.allowedFiles,
    leaseMs: Math.max(60_000, grant.expiresAt - Date.now()),
  });
  appendAuditEntry({
    sessionId: sid,
    actionType: 'approval_resolved',
    toolName: 'request_dev_source_edit',
    toolArgs: {
      allowedFiles: scope.allowedFiles,
      allowedDirs: scope.allowedDirs,
      verificationCommand: scope.verificationCommand,
      verificationProfile: scope.verificationProfile,
      verificationProfiles: scope.verificationProfiles,
      devEditId: scope.devEditId,
      planHash: scope.planHash,
      approvedBy,
    },
    policyTier: 'commit',
    approvalStatus: 'approved',
    resultSummary: `Granted dev source edit scope for ${scope.allowedFiles.length} file(s) and ${scope.allowedDirs.length} workspace doc dir(s).`,
  });
  return grant;
}

export function getDevSourceEditGrant(sessionId: string): DevSourceEditScope | null {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const grant = grants.get(sid);
  if (!grant) return null;
  if (grant.expiresAt <= Date.now()) {
    grants.delete(sid);
    return null;
  }
  return grant;
}

export function hasDevSourceEditGrant(sessionId: string): boolean {
  return !!getDevSourceEditGrant(sessionId);
}
