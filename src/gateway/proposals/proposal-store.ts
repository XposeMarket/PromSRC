/**
 * proposal-store.ts
 *
 * Persistent store for agent-generated proposals that require human approval
 * before execution. Used by the nightly consolidator, feature scout pipeline,
 * and any agent that wants to propose src/ changes or large actions.
 *
 * Storage: workspace/proposals/
 *   pending/   — awaiting human decision
 *   approved/  — approved, awaiting or in execution
 *   denied/    — rejected
 *   archive/   — completed (executed or expired)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import {
  type ProposalRepairContext,
  normalizeProposalRepairContext,
} from './repair-context.js';

// ─── Optional broadcast hook ──────────────────────────────────────────────────
// Set by proposals.router.ts after the WS server is up.
// Allows createProposal() anywhere in the system to push a live WS event.
type BroadcastFn = (msg: Record<string, any>) => void;
let _broadcast: BroadcastFn | null = null;
export function setProposalStoreBroadcast(fn: BroadcastFn): void { _broadcast = fn; }

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ProposalType =
  | 'feature_addition'
  | 'src_edit'
  | 'config_change'
  | 'task_trigger'
  | 'memory_update'
  | 'skill_evolution'
  | 'prompt_mutation'
  | 'general';

export type ProposalStatus = 'pending' | 'approved' | 'denied' | 'executing' | 'repairing' | 'executed' | 'failed' | 'expired';
export type ProposalPriority = 'critical' | 'high' | 'medium' | 'low';
export type ProposalExecutionMode = 'code_change' | 'action' | 'review';

export interface ProposalAffectedFile {
  path: string;
  action: 'create' | 'edit' | 'delete';
  description: string;
}

export type ProposalExecutionStepKind =
  | 'inspect'
  | 'edit'
  | 'write_artifact'
  | 'trigger'
  | 'verify'
  | 'build'
  | 'complete'
  | 'other';

export interface ProposalExecutionStep {
  title: string;
  kind?: ProposalExecutionStepKind;
  description?: string;
  successCriteria?: string;
}

export interface ProposalContentSnapshot {
  executionMode?: ProposalExecutionMode;
  type: ProposalType;
  priority: ProposalPriority;
  title: string;
  summary: string;
  details: string;
  affectedFiles: ProposalAffectedFile[];
  executionSteps?: ProposalExecutionStep[];
  diffPreview?: string;
  estimatedImpact?: string;
  requiresBuild: boolean;
  requiresSrcEdit?: boolean;
  executorAgentId?: string;
  executorPrompt?: string;
  /** Risk tier set by the proposal author. Determines which model runs the execution task. */
  riskTier?: 'low' | 'high';
  /** Provider to use for the execution task (e.g. 'anthropic' for low-risk/Haiku). */
  executorProviderId?: string;
  /** Model to use for the execution task (e.g. 'claude-haiku-4-5-20251001'). */
  executorModel?: string;
  teamExecution?: ProposalTeamExecution;
}

export interface ProposalTeamExecution {
  teamId: string;
  managerSessionId: string;
  executorAgentId: string;
  executorAgentName?: string;
  returnTarget: 'team_chat';
  originatingSessionId?: string;
  notifyMainAgentOnError?: boolean;
}

export interface ProposalRevision {
  version: number;
  editedAt: number;
  editedBy?: string;
  note?: string;
  snapshot: ProposalContentSnapshot;
}

export interface ProposalApprovalSnapshot {
  approvedAt: number;
  approvedVersion: number;
  snapshot: ProposalContentSnapshot;
}

export interface Proposal {
  id: string;
  executionMode?: ProposalExecutionMode;
  type: ProposalType;
  priority: ProposalPriority;
  title: string;
  summary: string;
  details: string;
  sourceAgentId: string;
  sourceTeamId?: string;
  sourcePipeline?: string;
  affectedFiles: ProposalAffectedFile[];
  executionSteps?: ProposalExecutionStep[];
  diffPreview?: string;
  estimatedImpact?: string;
  requiresBuild: boolean;
  requiresSrcEdit?: boolean;   // true = execution session gets src-edit tools (find_replace_source etc.)
  executorAgentId?: string;
  executorPrompt?: string;
  riskTier?: 'low' | 'high';
  executorProviderId?: string;
  executorModel?: string;
  teamExecution?: ProposalTeamExecution;
  status: ProposalStatus;
  version: number;
  revisionHistory: ProposalRevision[];
  approvalSnapshot?: ProposalApprovalSnapshot;
  createdAt: number;
  updatedAt: number;
  decidedAt?: number;
  executedAt?: number;
  executorTaskId?: string;
  executionResult?: string;
  notes?: string;
  sourceSessionId?: string;
  repairContext?: ProposalRepairContext;
}

export interface ProposalUpdateInput {
  executionMode?: ProposalExecutionMode;
  type?: ProposalType;
  priority?: ProposalPriority;
  title?: string;
  summary?: string;
  details?: string;
  affectedFiles?: ProposalAffectedFile[];
  executionSteps?: ProposalExecutionStep[];
  diffPreview?: string;
  estimatedImpact?: string;
  requiresBuild?: boolean;
  requiresSrcEdit?: boolean;
  executorAgentId?: string;
  executorPrompt?: string;
  teamExecution?: ProposalTeamExecution;
}

export type UpdatePendingProposalError = 'not_found' | 'not_pending' | 'validation_failed';

export type UpdatePendingProposalResult =
  | { ok: true; proposal: Proposal; changed: boolean }
  | { ok: false; error: UpdatePendingProposalError; proposal?: Proposal; missingSections?: string[] };

// ─── Paths ─────────────────────────────────────────────────────────────────────

function getProposalsRoot(): string {
  const ws = getConfig().getWorkspacePath();
  const root = path.join(ws, 'proposals');
  ['pending', 'approved', 'denied', 'archive'].forEach(d =>
    fs.mkdirSync(path.join(root, d), { recursive: true })
  );
  return root;
}

function statusToBucket(status: ProposalStatus): string {
  if (status === 'pending') return 'pending';
  if (status === 'approved' || status === 'executing' || status === 'repairing') return 'approved';
  if (status === 'denied') return 'denied';
  return 'archive';
}

function proposalPath(status: ProposalStatus, id: string): string {
  return path.join(getProposalsRoot(), statusToBucket(status), `${id}.json`);
}

function findProposalFile(id: string): string | null {
  const root = getProposalsRoot();
  for (const bucket of ['pending', 'approved', 'denied', 'archive']) {
    const p = path.join(root, bucket, `${id}.json`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ─── Src proposal validation ───────────────────────────────────────────────────
// Proposals that touch src/ MUST include these exact sections in details/plan.
export const SRC_PROPOSAL_REQUIRED_SECTIONS = [
  'Why this change',
  'Exact source edits',
  'Deterministic behavior after patch',
  'Acceptance tests',
  'Risks and compatibility',
] as const;

function isSrcPath(filePath: string): boolean {
  const normalized = String(filePath || '').replace(/\\/g, '/').trim();
  return normalized.startsWith('src/') || normalized.startsWith('./src/') || normalized.includes('/src/');
}

export function hasSrcAffectedFiles(affectedFiles: ProposalAffectedFile[]): boolean {
  if (!Array.isArray(affectedFiles)) return false;
  return affectedFiles.some(f => isSrcPath(typeof f === 'object' ? (f as any).path : String(f)));
}

/** Returns missing section names if details does not include all required sections. */
export function validateSrcProposalDetails(details: string, affectedFiles: ProposalAffectedFile[]): string[] {
  if (!hasSrcAffectedFiles(affectedFiles)) return [];
  const text = (details || '').toLowerCase();
  const missing: string[] = [];
  for (const section of SRC_PROPOSAL_REQUIRED_SECTIONS) {
    if (!text.includes(section.toLowerCase())) missing.push(section);
  }
  return missing;
}

function validateSrcProposalReadiness(partial: Pick<Proposal, 'type' | 'details' | 'affectedFiles' | 'executorPrompt' | 'riskTier' | 'sourcePipeline'>): string[] {
  const affectedFiles = partial.affectedFiles || [];
  if (!hasSrcAffectedFiles(affectedFiles)) return [];

  const missing: string[] = validateSrcProposalDetails(partial.details || '', affectedFiles);
  const sourcePipeline = String(partial.sourcePipeline || '');
  const isBuildRepair = sourcePipeline.startsWith('proposal_build_failure');
  const detailsText = String(partial.details || '').toLowerCase();
  const executorText = String(partial.executorPrompt || '').toLowerCase();

  if (partial.type !== 'src_edit') {
    missing.push('type must be src_edit');
  }
  if (partial.riskTier !== 'low' && partial.riskTier !== 'high') {
    missing.push('riskTier must be low or high');
  }
  if (!String(partial.executorPrompt || '').trim()) {
    missing.push('executorPrompt');
  }

  // Build-failure repair proposals are generated from compiler output after an
  // approved task is already blocked, so they may not have a fresh read_source
  // citation. Normal src proposals must prove the plan came from current code.
  if (!isBuildRepair && !/read_source|grep_source|source_stats|read_webui_source|read_prom_file/.test(`${detailsText}\n${executorText}`)) {
    missing.push('source-read evidence');
  }

  const affectedSrcPaths = affectedFiles
    .map(f => String((f as any)?.path || '').replace(/\\/g, '/').replace(/^\.?\//, '').trim())
    .filter(p => p.startsWith('src/'));
  for (const filePath of affectedSrcPaths) {
    if (!detailsText.includes(filePath.toLowerCase()) && !executorText.includes(filePath.toLowerCase())) {
      missing.push(`affected file plan for ${filePath}`);
    }
  }

  return Array.from(new Set(missing));
}

// ─── CRUD helpers ──────────────────────────────────────────────────────────────

function cloneAffectedFiles(files: ProposalAffectedFile[] | undefined): ProposalAffectedFile[] {
  if (!Array.isArray(files)) return [];
  return files.map(f => ({
    path: String((f as any)?.path || ''),
    action: ((f as any)?.action === 'create' || (f as any)?.action === 'delete') ? (f as any).action : 'edit',
    description: String((f as any)?.description || ''),
  }));
}

function normalizeExecutionStepKind(raw: any): ProposalExecutionStepKind | undefined {
  const value = String(raw || '').trim().toLowerCase();
  if ([
    'inspect',
    'edit',
    'write_artifact',
    'trigger',
    'verify',
    'build',
    'complete',
    'other',
  ].includes(value)) {
    return value as ProposalExecutionStepKind;
  }
  return undefined;
}

function normalizeProposalExecutionMode(raw: any): ProposalExecutionMode | undefined {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'code_change' || value === 'action' || value === 'review') {
    return value as ProposalExecutionMode;
  }
  return undefined;
}

function cloneExecutionSteps(steps: ProposalExecutionStep[] | undefined): ProposalExecutionStep[] | undefined {
  if (!Array.isArray(steps)) return undefined;
  const normalized = steps
    .map((step: any) => {
      const title = String(step?.title || step?.description || '').trim().slice(0, 240);
      if (!title) return null;
      const kind = normalizeExecutionStepKind(step?.kind);
      const description = String(step?.description || '').trim().slice(0, 1000);
      const successCriteria = String(step?.successCriteria || step?.success_criteria || '').trim().slice(0, 1000);
      return {
        title,
        kind,
        description: description || undefined,
        successCriteria: successCriteria || undefined,
      } as ProposalExecutionStep;
    })
    .filter(Boolean) as ProposalExecutionStep[];
  return normalized.length > 0 ? normalized.slice(0, 12) : undefined;
}

function normalizeProposalTeamExecution(raw: any): ProposalTeamExecution | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const teamId = String(raw.teamId || '').trim();
  const executorAgentId = String(raw.executorAgentId || '').trim();
  if (!teamId || !executorAgentId) return undefined;
  const managerSessionId = String(raw.managerSessionId || `team_coord_${teamId}`).trim();
  return {
    teamId,
    managerSessionId,
    executorAgentId,
    executorAgentName: raw.executorAgentName == null ? undefined : String(raw.executorAgentName).slice(0, 120),
    returnTarget: 'team_chat',
    originatingSessionId: raw.originatingSessionId == null ? undefined : String(raw.originatingSessionId),
    notifyMainAgentOnError: raw.notifyMainAgentOnError !== false,
  };
}

function buildProposalContentSnapshot(proposal: Pick<Proposal, keyof ProposalContentSnapshot>): ProposalContentSnapshot {
  return {
    executionMode: normalizeProposalExecutionMode((proposal as any).executionMode),
    type: proposal.type,
    priority: proposal.priority,
    title: proposal.title,
    summary: proposal.summary,
    details: proposal.details,
    affectedFiles: cloneAffectedFiles(proposal.affectedFiles),
    executionSteps: cloneExecutionSteps((proposal as any).executionSteps),
    diffPreview: proposal.diffPreview,
    estimatedImpact: proposal.estimatedImpact,
    requiresBuild: proposal.requiresBuild,
    requiresSrcEdit: proposal.requiresSrcEdit,
    executorAgentId: proposal.executorAgentId,
    executorPrompt: proposal.executorPrompt,
    riskTier: proposal.riskTier,
    executorProviderId: proposal.executorProviderId,
    executorModel: proposal.executorModel,
    teamExecution: normalizeProposalTeamExecution((proposal as any).teamExecution),
  };
}

function normalizeRevision(raw: any): ProposalRevision {
  const snapshotRaw = (raw && typeof raw.snapshot === 'object') ? raw.snapshot : {};
  const snapshot: ProposalContentSnapshot = {
    executionMode: normalizeProposalExecutionMode(snapshotRaw.executionMode || snapshotRaw.execution_mode),
    type: (snapshotRaw.type || 'general') as ProposalType,
    priority: (snapshotRaw.priority || 'medium') as ProposalPriority,
    title: String(snapshotRaw.title || ''),
    summary: String(snapshotRaw.summary || ''),
    details: String(snapshotRaw.details || ''),
    affectedFiles: cloneAffectedFiles(snapshotRaw.affectedFiles),
    executionSteps: cloneExecutionSteps(snapshotRaw.executionSteps),
    diffPreview: snapshotRaw.diffPreview == null ? undefined : String(snapshotRaw.diffPreview),
    estimatedImpact: snapshotRaw.estimatedImpact == null ? undefined : String(snapshotRaw.estimatedImpact),
    requiresBuild: snapshotRaw.requiresBuild === true,
    requiresSrcEdit: snapshotRaw.requiresSrcEdit === true ? true : undefined,
    executorAgentId: snapshotRaw.executorAgentId == null ? undefined : String(snapshotRaw.executorAgentId),
    executorPrompt: snapshotRaw.executorPrompt == null ? undefined : String(snapshotRaw.executorPrompt),
    riskTier: snapshotRaw.riskTier === 'low' ? 'low' : snapshotRaw.riskTier === 'high' ? 'high' : undefined,
    executorProviderId: snapshotRaw.executorProviderId == null ? undefined : String(snapshotRaw.executorProviderId),
    executorModel: snapshotRaw.executorModel == null ? undefined : String(snapshotRaw.executorModel),
    teamExecution: normalizeProposalTeamExecution(snapshotRaw.teamExecution),
  };
  return {
    version: Math.max(1, Math.floor(Number(raw?.version) || 1)),
    editedAt: Math.floor(Number(raw?.editedAt) || Date.now()),
    editedBy: raw?.editedBy == null ? undefined : String(raw.editedBy),
    note: raw?.note == null ? undefined : String(raw.note),
    snapshot,
  };
}

function normalizeProposal(raw: Proposal): Proposal {
  const normalized: Proposal = {
    ...raw,
    executionMode: normalizeProposalExecutionMode((raw as any).executionMode || (raw as any).execution_mode),
    type: (raw.type || 'general') as ProposalType,
    priority: (raw.priority || 'medium') as ProposalPriority,
    title: String(raw.title || ''),
    summary: String(raw.summary || ''),
    details: String(raw.details || ''),
    affectedFiles: cloneAffectedFiles(raw.affectedFiles),
    executionSteps: cloneExecutionSteps((raw as any).executionSteps),
    requiresBuild: raw.requiresBuild === true,
    teamExecution: normalizeProposalTeamExecution((raw as any).teamExecution),
    version: Number.isFinite(Number((raw as any).version)) && Number((raw as any).version) > 0
      ? Math.floor(Number((raw as any).version))
      : 1,
    repairContext: normalizeProposalRepairContext((raw as any).repairContext),
    revisionHistory: Array.isArray((raw as any).revisionHistory)
      ? (raw as any).revisionHistory.map((r: any) => normalizeRevision(r))
      : [],
    approvalSnapshot: undefined,
  };

  if ((raw as any).approvalSnapshot && typeof (raw as any).approvalSnapshot === 'object') {
    const approval = (raw as any).approvalSnapshot;
    normalized.approvalSnapshot = {
      approvedAt: Math.floor(Number(approval.approvedAt) || Date.now()),
      approvedVersion: Math.max(1, Math.floor(Number(approval.approvedVersion) || normalized.version)),
      snapshot: normalizeRevision({ version: normalized.version, editedAt: Date.now(), snapshot: approval.snapshot }).snapshot,
    };
  }

  if (normalized.revisionHistory.length === 0) {
    normalized.revisionHistory = [{
      version: normalized.version,
      editedAt: Number(normalized.createdAt || Date.now()),
      editedBy: normalized.sourceAgentId || 'system',
      note: 'Initial proposal content',
      snapshot: buildProposalContentSnapshot(normalized),
    }];
  }

  return normalized;
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

export function createProposal(
  partial: Omit<Proposal, 'id' | 'status' | 'version' | 'revisionHistory' | 'approvalSnapshot' | 'createdAt' | 'updatedAt'>
): Proposal {
  const missing = validateSrcProposalReadiness(partial);
  if (missing.length > 0) {
    throw new Error(
      `[ProposalStore] Proposals that edit src/ must be approval-ready implementation plans. ` +
      `Required details sections: ${SRC_PROPOSAL_REQUIRED_SECTIONS.join(', ')}. ` +
      `Missing: ${missing.join(', ')}. ` +
      `Read the current source, include exact affected src/ paths and an executorPrompt, then resubmit.`,
    );
  }

  const id = `prop_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const proposalBase: Proposal = {
    ...partial,
    id,
    status: 'pending',
    version: 1,
    revisionHistory: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const proposal = normalizeProposal(proposalBase);

  const filePath = proposalPath('pending', id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2), 'utf-8');
  console.log(`[ProposalStore] Created "${proposal.title}" (${id})`);

  // Broadcast live event so UI right-column + Proposals page update instantly
  try {
    _broadcast?.({
      type: 'proposal_created',
      proposalId: proposal.id,
      title: proposal.title,
      priority: proposal.priority,
      sourceAgentId: proposal.sourceAgentId,
      sourceTeamId: proposal.sourceTeamId || proposal.teamExecution?.teamId,
      sessionId: proposal.sourceSessionId,
    });
  } catch { /* broadcast is best-effort */ }

  return proposal;
}

export function loadProposal(id: string): Proposal | null {
  const filePath = findProposalFile(id);
  if (!filePath) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Proposal;
    return normalizeProposal(parsed);
  } catch {
    return null;
  }
}

export function saveProposal(proposal: Proposal): void {
  const normalized = normalizeProposal(proposal);
  normalized.updatedAt = Date.now();
  const currentFile = findProposalFile(normalized.id);
  const targetFile = proposalPath(normalized.status, normalized.id);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, JSON.stringify(normalized, null, 2), 'utf-8');
  if (currentFile && currentFile !== targetFile) {
    try { fs.unlinkSync(currentFile); } catch { /* ok */ }
  }
}

export function listProposals(statusFilter?: ProposalStatus | ProposalStatus[]): Proposal[] {
  const root = getProposalsRoot();
  const statuses = statusFilter
    ? (Array.isArray(statusFilter) ? statusFilter : [statusFilter])
    : ['pending', 'approved', 'denied', 'executing', 'repairing', 'executed', 'failed', 'expired'];
  const buckets = [...new Set((statuses as ProposalStatus[]).map(statusToBucket))];
  const results: Proposal[] = [];
  const seen = new Set<string>();
  for (const bucket of buckets) {
    const dir = path.join(root, bucket);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const p = normalizeProposal(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as Proposal);
        if (!seen.has(p.id)) { seen.add(p.id); results.push(p); }
      } catch { /* skip */ }
    }
  }
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

export function updatePendingProposal(
  id: string,
  updates: ProposalUpdateInput,
  options?: { editedBy?: string; note?: string },
): UpdatePendingProposalResult {
  const proposal = loadProposal(id);
  if (!proposal) return { ok: false, error: 'not_found' };
  if (proposal.status !== 'pending') return { ok: false, error: 'not_pending', proposal };

  const before = buildProposalContentSnapshot(proposal);
  const next: Proposal = { ...proposal };

  if (updates.type !== undefined) next.type = updates.type;
  if (updates.executionMode !== undefined || (updates as any).execution_mode !== undefined) {
    next.executionMode = normalizeProposalExecutionMode(updates.executionMode || (updates as any).execution_mode);
  }
  if (updates.priority !== undefined) next.priority = updates.priority;
  if (updates.title !== undefined) next.title = updates.title;
  if (updates.summary !== undefined) next.summary = updates.summary;
  if (updates.details !== undefined) next.details = updates.details;
  if (updates.affectedFiles !== undefined) next.affectedFiles = cloneAffectedFiles(updates.affectedFiles);
  if (updates.executionSteps !== undefined) next.executionSteps = cloneExecutionSteps(updates.executionSteps);
  if (updates.diffPreview !== undefined) next.diffPreview = updates.diffPreview || undefined;
  if (updates.estimatedImpact !== undefined) next.estimatedImpact = updates.estimatedImpact || undefined;
  if (updates.requiresBuild !== undefined) next.requiresBuild = updates.requiresBuild === true;
  if (updates.requiresSrcEdit !== undefined) next.requiresSrcEdit = updates.requiresSrcEdit === true ? true : undefined;
  if (updates.executorAgentId !== undefined) next.executorAgentId = updates.executorAgentId || undefined;
  if (updates.executorPrompt !== undefined) next.executorPrompt = updates.executorPrompt || undefined;
  if (updates.teamExecution !== undefined) next.teamExecution = normalizeProposalTeamExecution(updates.teamExecution);

  const missing = validateSrcProposalReadiness(next);
  if (missing.length > 0) {
    return { ok: false, error: 'validation_failed', missingSections: missing, proposal };
  }

  const after = buildProposalContentSnapshot(next);
  const changed = JSON.stringify(before) !== JSON.stringify(after);

  if (!changed) {
    return { ok: true, proposal, changed: false };
  }

  next.version = Math.max(1, Math.floor(Number(next.version) || 1)) + 1;
  next.revisionHistory = [
    ...(Array.isArray(next.revisionHistory) ? next.revisionHistory : []),
    {
      version: next.version,
      editedAt: Date.now(),
      editedBy: options?.editedBy,
      note: options?.note,
      snapshot: after,
    },
  ];

  saveProposal(next);
  return { ok: true, proposal: next, changed: true };
}

export function approveProposal(id: string, notes?: string): Proposal | null {
  const p = loadProposal(id);
  if (!p) return null;

  const approvedAt = Date.now();
  p.status = 'approved';
  p.decidedAt = approvedAt;
  p.approvalSnapshot = {
    approvedAt,
    approvedVersion: Math.max(1, Math.floor(Number(p.version) || 1)),
    snapshot: buildProposalContentSnapshot(p),
  };
  if (notes) p.notes = notes;
  saveProposal(p);
  return p;
}

export function denyProposal(id: string, notes?: string): Proposal | null {
  const p = loadProposal(id);
  if (!p) return null;
  p.status = 'denied';
  p.decidedAt = Date.now();
  if (notes) p.notes = notes;
  saveProposal(p);
  return p;
}

export function markProposalExecuting(id: string, taskId: string): Proposal | null {
  const p = loadProposal(id);
  if (!p) return null;
  p.status = 'executing';
  p.executorTaskId = taskId;
  saveProposal(p);
  return p;
}

export function markProposalRepairing(id: string, reason: string, taskId?: string): Proposal | null {
  const p = loadProposal(id);
  if (!p) return null;
  p.status = 'repairing';
  if (taskId) p.executorTaskId = taskId;
  p.executionResult = reason.slice(0, 1000);
  saveProposal(p);
  return p;
}

export function markProposalExecuted(id: string, result: string): Proposal | null {
  const p = loadProposal(id);
  if (!p) return null;
  p.status = 'executed';
  p.executedAt = Date.now();
  p.executionResult = result.slice(0, 1000);
  saveProposal(p);
  return p;
}

export function markProposalFailed(id: string, reason: string): Proposal | null {
  const p = loadProposal(id);
  if (!p) return null;
  p.status = 'failed';
  p.executionResult = reason.slice(0, 500);
  saveProposal(p);
  return p;
}

export function archiveOldProposals(maxAgeDays = 7): number {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const terminal: ProposalStatus[] = ['executed', 'failed', 'expired', 'denied'];
  const old = listProposals(terminal).filter(p => p.updatedAt < cutoff);
  for (const p of old) { p.status = 'expired'; saveProposal(p); }
  return old.length;
}

/** Import a JSON file dropped by an agent into proposals/pending/ */
export function importProposalFromFile(filePath: string): Proposal | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!raw.title || !raw.summary) return null;
    const proposal = createProposal({
      type: raw.type || 'general',
      executionMode: normalizeProposalExecutionMode(raw.executionMode || raw.execution_mode),
      priority: raw.priority || 'medium',
      title: String(raw.title).slice(0, 120),
      summary: String(raw.summary).slice(0, 500),
      details: String(raw.details || ''),
      sourceAgentId: String(raw.sourceAgentId || 'unknown'),
      sourcePipeline: raw.sourcePipeline,
      affectedFiles: Array.isArray(raw.affectedFiles) ? raw.affectedFiles : [],
      executionSteps: Array.isArray(raw.executionSteps) ? raw.executionSteps : undefined,
      diffPreview: raw.diffPreview,
      estimatedImpact: raw.estimatedImpact,
      requiresBuild: raw.requiresBuild === true,
      requiresSrcEdit: raw.requiresSrcEdit === true,
      executorAgentId: raw.executorAgentId,
      executorPrompt: raw.executorPrompt,
      teamExecution: normalizeProposalTeamExecution(raw.teamExecution),
    });
    try { fs.unlinkSync(filePath); } catch { /* ok */ }
    return proposal;
  } catch {
    return null;
  }
}

/** Scan proposals/pending/ for raw JSON files dropped by agents and import them */
export function scanAndImportAgentProposals(): number {
  const ws = getConfig().getWorkspacePath();
  const watchDir = path.join(ws, 'proposals', 'pending');
  if (!fs.existsSync(watchDir)) return 0;
  let imported = 0;
  for (const file of fs.readdirSync(watchDir)) {
    if (!file.endsWith('.json') || file.startsWith('prop_')) continue;
    const p = importProposalFromFile(path.join(watchDir, file));
    if (p) imported++;
  }
  return imported;
}
