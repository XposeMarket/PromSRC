// src/gateway/verification-flow.ts
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ToolPermissionCandidate } from './command-permissions';

interface VerificationSession {
  id: string;
  taskId: string;
  currentStep: 'oauth_selection' | 'oauth_redirect' | 'email_verification' | 'completing';
  pendingAction: 'awaiting_user_input' | 'awaiting_browser_completion';
  completedSteps: string[];
  nextPrompt: string;
  createdAt: number;
  expiresAt: number;
}

// ── Phase 5: Policy-enriched approval record ─────────────────────────────────
// These are stored in memory by ApprovalQueue and served to the UI via
// /api/approvals (GET) and /api/approvals/:id (POST approve/reject).

export interface ApprovalRecord {
  id: string;
  /** The chat session or task that triggered this approval */
  sessionId: string;
  /** Background task id when this approval belongs to a task panel */
  taskId?: string;
  agentId?: string;
  originType?: 'main_chat' | 'subagent' | 'background_task' | 'scheduled_task' | 'proposal' | 'unknown';
  originLabel?: string;
  /** The tool that is waiting for approval */
  toolName: string;
  toolArgs: Record<string, any>;
  approvalKind?: 'command' | 'elevated_command' | 'tool' | 'dev_source_edit' | 'dev_apply_live' | 'final_action' | 'path_access';
  /** Path approval fields — populated when approvalKind === 'path_access' */
  pathAccess?: { requestedPath: string };
  /** Human-readable description of what will happen */
  action: string;
  reason?: string;
  /** Exact command/cwd/workspace tuple that can be trusted after approval */
  commandPermissionCandidate?: ToolPermissionCandidate;
  /** Phase 5 policy fields */
  policyTier: 'propose' | 'commit';
  riskScore: number;
  affectedSystems: string[];
  devSourceEdit?: {
    devEditId?: string;
    allowedFiles: string[];
    allowedDirs?: string[];
    verificationCommand?: string;
    verificationProfile?: 'backend_build' | 'webui_sync_check' | 'full_build' | 'route_smoke' | 'desktop_ui_smoke' | 'mobile_ui_smoke' | 'none';
    verificationProfiles?: Array<'backend_build' | 'webui_sync_check' | 'full_build' | 'route_smoke' | 'desktop_ui_smoke' | 'mobile_ui_smoke' | 'none'>;
    reason?: string;
    planHash?: string;
    plan?: {
      userRequest?: string;
      reasoning?: string;
      evidence?: Array<{ file: string; lines?: string; finding: string }>;
      currentState?: string;
      fix?: string;
      steps?: string[];
      verification?: string[];
      expectedWorkflow?: string[];
      completionNoteTag?: string;
    };
    expiresAt?: number;
  };
  finalAction?: {
    actionKind: string;
    targetLabel: string;
    summary: string;
    surface?: string;
    nextToolName?: string;
    nextToolArgs?: Record<string, any>;
    screenshotId?: string;
    expiresAt?: number;
  };
  /** A user-controlled gateway reload for one frozen verified dev-edit batch. */
  devApplyLive?: {
    batchId: string;
    memberIds: string[];
    files: string[];
    expiresAt: number;
  };
  /** ISO timestamp */
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  resolvedAt?: string;
  resolvedBy?: string;
}

type ApprovalResolutionListener = (record: ApprovalRecord, approved: boolean) => void;
const approvalResolutionListeners = new Set<ApprovalResolutionListener>();

/**
 * Cross-cutting one-shot approval effects (for example a dev apply timeout)
 * must run whether resolution comes from the UI, Telegram, or a server timer.
 */
export function registerApprovalResolutionListener(listener: ApprovalResolutionListener): () => void {
  approvalResolutionListeners.add(listener);
  return () => approvalResolutionListeners.delete(listener);
}

function truncateApprovalValue(value: any, max = 4000): any {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => truncateApprovalValue(item, Math.floor(max / 2)));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      out[key] = truncateApprovalValue(item, Math.floor(max / 2));
    }
    return out;
  }
  return String(value);
}

export function serializeApprovalForClient(record: ApprovalRecord): Record<string, any> {
  return {
    id: record.id,
    sessionId: record.sessionId,
    sourceSessionId: record.sessionId,
    taskId: record.taskId,
    agentId: record.agentId,
    originType: record.originType,
    originLabel: record.originLabel,
    toolName: record.toolName,
    toolArgs: truncateApprovalValue(record.toolArgs || {}),
    approvalKind: record.approvalKind,
    oneShot: record.approvalKind === 'elevated_command'
      || record.approvalKind === 'dev_source_edit'
      || record.approvalKind === 'dev_apply_live'
      || record.approvalKind === 'final_action',
    action: record.action,
    summary: record.action,
    reason: record.reason,
    policyTier: record.policyTier,
    riskScore: record.riskScore,
    affectedSystems: Array.isArray(record.affectedSystems) ? record.affectedSystems : [],
    commandBoundary: record.commandPermissionCandidate ? {
      scope: record.commandPermissionCandidate.boundaryScope || 'workspace',
      reason: record.commandPermissionCandidate.boundaryReason || '',
      externalPaths: Array.isArray(record.commandPermissionCandidate.externalPaths) ? record.commandPermissionCandidate.externalPaths : [],
      environmentChanges: Array.isArray(record.commandPermissionCandidate.environmentChanges) ? record.commandPermissionCandidate.environmentChanges : [],
      packageManager: record.commandPermissionCandidate.packageManager || '',
      requiresExplicitApproval: record.commandPermissionCandidate.requiresExplicitApproval === true,
      requiresAdmin: record.commandPermissionCandidate.requiresAdmin === true,
    } : record.approvalKind === 'elevated_command' ? {
      scope: 'admin_required',
      reason: 'This exact command will run through the installed administrator broker after one-shot approval. Broker setup may require UAC once.',
      externalPaths: [],
      environmentChanges: [],
      packageManager: '',
      requiresExplicitApproval: true,
      requiresAdmin: true,
    } : undefined,
    devSourceEdit: record.devSourceEdit ? truncateApprovalValue(record.devSourceEdit) : undefined,
    finalAction: record.finalAction ? truncateApprovalValue(record.finalAction) : undefined,
    devApplyLive: record.devApplyLive ? truncateApprovalValue(record.devApplyLive) : undefined,
    createdAt: record.createdAt,
    status: record.status,
    resolvedAt: record.resolvedAt,
    resolvedBy: record.resolvedBy,
  };
}

/**
 * In-memory queue for pending approvals.
 * Entries are persisted to audit-log on resolution.
 */
class ApprovalQueue {
  private records: Map<string, ApprovalRecord> = new Map();
  private callbacks: Map<string, (approved: boolean) => void> = new Map();
  /** Steer-wakeup callbacks: fired when a steer interrupts a waiting approval */
  private steerCallbacks: Map<string, (steerMessage: string) => void> = new Map();

  constructor() {
    this.loadDurableRecords();
  }

  private storePath(): string {
    const root = process.env.PROMETHEUS_DATA_DIR
      || process.env.PROMETHEUS_APP_ROOT
      || path.resolve(__dirname, '..', '..');
    const dir = path.join(root, '.prometheus');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'approvals.json');
  }

  private retentionCutoffMs(): number {
    return Date.now() - 24 * 60 * 60 * 1000;
  }

  private shouldRetainRecord(record: ApprovalRecord, cutoff = this.retentionCutoffMs()): boolean {
    if (record.status === 'pending') return true;
    const resolvedAt = new Date(record.resolvedAt || record.createdAt).getTime();
    return Number.isFinite(resolvedAt) && resolvedAt >= cutoff;
  }

  private persistDurableRecords(): void {
    try {
      const records = [...this.records.values()].filter((record) => this.shouldRetainRecord(record));
      const p = this.storePath();
      const tmp = `${p}.tmp-${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify({ approvals: records }, null, 2), 'utf-8');
      fs.renameSync(tmp, p);
    } catch (err: any) {
      console.warn('[ApprovalQueue] Failed to persist approvals:', err?.message || err);
    }
  }

  private loadDurableRecords(): void {
    try {
      const p = this.storePath();
      if (!fs.existsSync(p)) return;
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const approvals = Array.isArray(parsed?.approvals) ? parsed.approvals : [];
      const cutoff = this.retentionCutoffMs();
      let restored = 0;
      let pending = 0;
      let pruned = 0;
      for (const raw of approvals) {
        if (!raw || typeof raw !== 'object') continue;
        const id = String(raw.id || '').trim();
        const sessionId = String(raw.sessionId || '').trim();
        const toolName = String(raw.toolName || '').trim();
        if (!id || !sessionId || !toolName) continue;
        const status = raw.status === 'approved' || raw.status === 'rejected' ? raw.status : 'pending';
        const record = {
          ...raw,
          id,
          sessionId,
          toolName,
          toolArgs: raw.toolArgs && typeof raw.toolArgs === 'object' ? raw.toolArgs : {},
          policyTier: raw.policyTier === 'propose' ? 'propose' : 'commit',
          riskScore: Number.isFinite(Number(raw.riskScore)) ? Number(raw.riskScore) : 0,
          affectedSystems: Array.isArray(raw.affectedSystems) ? raw.affectedSystems.map(String) : [],
          createdAt: String(raw.createdAt || new Date().toISOString()),
          status,
        } as ApprovalRecord;
        if (!this.shouldRetainRecord(record, cutoff)) {
          pruned += 1;
          continue;
        }
        this.records.set(id, record);
        restored += 1;
        if (record.status === 'pending') pending += 1;
      }
      if (approvals.length) {
        const resolved = restored - pending;
        const suffix = pruned ? `; pruned ${pruned} stale resolved approval(s)` : '';
        console.log(`[ApprovalQueue] Restored ${pending} pending approval(s) and ${resolved} recent resolved approval(s)${suffix}`);
      }
      if (pruned) this.persistDurableRecords();
    } catch (err: any) {
      console.warn('[ApprovalQueue] Failed to restore approvals:', err?.message || err);
    }
  }
  create(partial: Omit<ApprovalRecord, 'id' | 'createdAt' | 'status'>): ApprovalRecord {
    const id = crypto.randomUUID();
    const record: ApprovalRecord = {
      ...partial,
      id,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    this.records.set(id, record);
    this.persistDurableRecords();
    console.log(`[ApprovalQueue] Created approval ${id} for "${record.toolName}" (${record.policyTier}, risk=${record.riskScore})`);
    return record;
  }

  get(id: string): ApprovalRecord | null {
    this.expireDueDevApplyApprovals();
    return this.records.get(id) ?? null;
  }

  listPending(): ApprovalRecord[] {
    this.expireDueDevApplyApprovals();
    return [...this.records.values()].filter(r => r.status === 'pending');
  }

  listAll(): ApprovalRecord[] {
    this.expireDueDevApplyApprovals();
    return [...this.records.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  resolve(id: string, approved: boolean, resolvedBy = 'user'): ApprovalRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== 'pending') return null;
    record.status = approved ? 'approved' : 'rejected';
    record.resolvedAt = new Date().toISOString();
    record.resolvedBy = resolvedBy;

    // Fire callback if one was registered (used by commit-tier tool execution)
    const cb = this.callbacks.get(id);
    if (cb) {
      cb(approved);
      this.callbacks.delete(id);
    }

    // Audit the resolution
    try {
      const { appendAuditEntry } = require('../gateway/audit-log.js');
      appendAuditEntry({
        sessionId: record.sessionId,
        agentId: record.agentId,
        actionType: 'approval_resolved',
        toolName: record.toolName,
        toolArgs: record.toolArgs,
        policyTier: record.policyTier,
        approvalStatus: approved ? 'approved' : 'rejected',
        resultSummary: approved ? 'Approved by user' : 'Rejected by user',
      });
    } catch { /* best effort */ }

    for (const listener of approvalResolutionListeners) {
      try { listener(record, approved); } catch (err: any) {
        console.warn('[ApprovalQueue] Resolution listener failed:', err?.message || err);
      }
    }

    console.log(`[ApprovalQueue] ${approved ? 'APPROVED' : 'REJECTED'} approval ${id} for "${record.toolName}"`);
    this.persistDurableRecords();
    return record;
  }

  private expireDueDevApplyApprovals(): void {
    const now = Date.now();
    for (const record of this.records.values()) {
      const expiresAt = Number(record.devApplyLive?.expiresAt || 0);
      if (record.status === 'pending' && expiresAt > 0 && expiresAt <= now) {
        this.resolve(record.id, false, 'policy:timeout');
      }
    }
  }

  hasResolveCallback(id: string): boolean {
    return this.callbacks.has(id);
  }

  /**
   * Register a callback that fires when the approval is resolved.
   * Used by the commit-tier path in registry.ts so the tool waits for user.
   */
  onResolve(id: string, callback: (approved: boolean) => void): void {
    const record = this.records.get(id);
    if (record && record.status !== 'pending') {
      callback(record.status === 'approved');
      return;
    }
    this.callbacks.set(id, callback);
  }

  /**
   * Update mutable fields of a pending approval (plan, reason, files, toolArgs).
   * Returns the updated record or null if not found / already resolved.
   */
  update(id: string, fields: {
    reason?: string;
    action?: string;
    devSourceEdit?: Partial<ApprovalRecord['devSourceEdit']>;
    toolArgs?: Partial<Record<string, any>>;
  }): ApprovalRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== 'pending') return null;
    if (fields.reason !== undefined) record.reason = fields.reason;
    if (fields.action !== undefined) record.action = fields.action;
    if (fields.toolArgs) record.toolArgs = { ...record.toolArgs, ...fields.toolArgs };
    if (fields.devSourceEdit && record.devSourceEdit) {
      record.devSourceEdit = { ...record.devSourceEdit, ...fields.devSourceEdit } as ApprovalRecord['devSourceEdit'];
      if (fields.devSourceEdit.plan !== undefined && record.devSourceEdit) {
        record.devSourceEdit.plan = {
          ...(record.devSourceEdit.plan || {}),
          ...(fields.devSourceEdit.plan || {}),
        };
      }
    }
    console.log(`[ApprovalQueue] Updated pending approval ${id}`);
    this.persistDurableRecords();
    return record;
  }

  /**
   * Register a one-shot callback that fires when notifySteer() is called for this approval.
   * The tool wait loop uses this to wake up when the user sends a steer while waiting.
   */
  onSteer(id: string, callback: (steerMessage: string) => void): void {
    this.steerCallbacks.set(id, callback);
  }

  /** Remove a previously registered steer callback (e.g. when approval resolves first). */
  clearSteerCallback(id: string): void {
    this.steerCallbacks.delete(id);
  }

  /**
   * Wake up the waiting tool Promise for this approval with a steer message.
   * Called by the steer injection path when a steer arrives while an approval is pending.
   */
  notifySteer(id: string, steerMessage: string): boolean {
    const cb = this.steerCallbacks.get(id);
    if (!cb) return false;
    this.steerCallbacks.delete(id);
    cb(steerMessage);
    return true;
  }

  /** Prune resolved records older than 24h */
  cleanup(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, r] of this.records) {
      if (r.status !== 'pending' && new Date(r.createdAt).getTime() < cutoff) {
        this.records.delete(id);
        this.callbacks.delete(id);
      }
    }
    this.persistDurableRecords();
  }
}

// ─── Singletons ───────────────────────────────────────────────────────────────

class VerificationFlowManager {
  private sessions: Map<string, VerificationSession> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  private startCleanupTimer() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let expired = 0;
      for (const [id, session] of this.sessions) {
        if (session.expiresAt < now) {
          this.sessions.delete(id);
          expired++;
        }
      }
      if (expired > 0) {
        console.log(`[VerificationFlowManager] Cleaned up ${expired} expired session(s)`);
      }
    }, 60000);
  }

  createSession(taskId: string, initialStep: 'oauth_selection' | 'oauth_redirect' | 'email_verification' = 'oauth_selection'): VerificationSession {
    const session: VerificationSession = {
      id: crypto.randomUUID(),
      taskId,
      currentStep: initialStep,
      pendingAction: 'awaiting_user_input',
      completedSteps: [],
      nextPrompt: '',
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minute timeout
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): VerificationSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  updateSession(sessionId: string, updates: Partial<VerificationSession>): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;

    Object.assign(session, updates);
    return true;
  }

  completeStep(sessionId: string, stepName: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;

    if (!session.completedSteps.includes(stepName)) {
      session.completedSteps.push(stepName);
    }

    return true;
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  deleteByTask(taskId: string): number {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.taskId === taskId) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
  }
}

let instance: VerificationFlowManager | null = null;

export function getVerificationFlowManager(): VerificationFlowManager {
  if (!instance) {
    instance = new VerificationFlowManager();
  }
  return instance;
}

let approvalQueueInstance: ApprovalQueue | null = null;

export function getApprovalQueue(): ApprovalQueue {
  if (!approvalQueueInstance) approvalQueueInstance = new ApprovalQueue();
  return approvalQueueInstance;
}
