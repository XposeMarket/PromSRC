// src/gateway/verification-flow.ts
import crypto from 'crypto';

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
  agentId?: string;
  /** The tool that is waiting for approval */
  toolName: string;
  toolArgs: Record<string, any>;
  /** Human-readable description of what will happen */
  action: string;
  reason?: string;
  /** Phase 5 policy fields */
  policyTier: 'propose' | 'commit';
  riskScore: number;
  affectedSystems: string[];
  /** ISO timestamp */
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  resolvedAt?: string;
  resolvedBy?: string;
}

/**
 * In-memory queue for pending approvals.
 * Entries are persisted to audit-log on resolution.
 */
class ApprovalQueue {
  private records: Map<string, ApprovalRecord> = new Map();
  private callbacks: Map<string, (approved: boolean) => void> = new Map();

  create(partial: Omit<ApprovalRecord, 'id' | 'createdAt' | 'status'>): ApprovalRecord {
    const id = crypto.randomUUID();
    const record: ApprovalRecord = {
      ...partial,
      id,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    this.records.set(id, record);
    console.log(`[ApprovalQueue] Created approval ${id} for "${record.toolName}" (${record.policyTier}, risk=${record.riskScore})`);
    return record;
  }

  get(id: string): ApprovalRecord | null {
    return this.records.get(id) ?? null;
  }

  listPending(): ApprovalRecord[] {
    return [...this.records.values()].filter(r => r.status === 'pending');
  }

  listAll(): ApprovalRecord[] {
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

    console.log(`[ApprovalQueue] ${approved ? 'APPROVED' : 'REJECTED'} approval ${id} for "${record.toolName}"`);
    return record;
  }

  /**
   * Register a callback that fires when the approval is resolved.
   * Used by the commit-tier path in registry.ts so the tool waits for user.
   */
  onResolve(id: string, callback: (approved: boolean) => void): void {
    this.callbacks.set(id, callback);
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
