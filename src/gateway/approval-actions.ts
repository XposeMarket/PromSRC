import { appendAuditEntry } from './audit-log';
import {
  addCommandPermissionGrant,
  type CommandPermissionScope,
} from './command-permissions';
import {
  createDevSourceEditApprovalScope,
  grantDevSourceEditApproval,
} from './dev-source-approvals';
import { addPersistentAllowedPath, addSessionAllowedPath } from './path-permissions';
import { getApprovalQueue, type ApprovalRecord } from './verification-flow';

export interface ResolveApprovalDecisionInput {
  approvalId: string;
  decision: 'approved' | 'rejected';
  resolvedBy?: string;
  grantScope?: CommandPermissionScope | '';
}

export interface ResolveApprovalDecisionResult {
  success: boolean;
  statusCode: number;
  error?: string;
  decision?: 'approved' | 'rejected';
  approval?: ApprovalRecord;
  permissionGrant?: any;
  resumePrompt?: string;
  requiresChatResume?: boolean;
}

function isOneShotApproval(approval: ApprovalRecord): boolean {
  return approval.approvalKind === 'dev_source_edit'
    || approval.toolName === 'request_dev_source_edit'
    || approval.approvalKind === 'final_action'
    || approval.toolName === 'request_final_action_approval';
}

export function resolveApprovalDecision(input: ResolveApprovalDecisionInput): ResolveApprovalDecisionResult {
  const approvalId = String(input.approvalId || '').trim();
  const decision = input.decision;
  const resolvedBy = String(input.resolvedBy || 'user').trim() || 'user';
  const grantScope = input.grantScope === 'session' || input.grantScope === 'always' ? input.grantScope : '';

  if (!approvalId) {
    return { success: false, statusCode: 400, error: 'Approval id is required' };
  }
  if (decision !== 'approved' && decision !== 'rejected') {
    return { success: false, statusCode: 400, error: 'decision must be one of: approved, rejected' };
  }
  if (input.grantScope && !grantScope) {
    return { success: false, statusCode: 400, error: 'grantScope must be one of: session, always' };
  }

  const queue = getApprovalQueue();
  const approval = queue.get(approvalId);
  if (!approval) {
    return { success: false, statusCode: 404, error: 'Approval not found' };
  }
  if (approval.status !== 'pending') {
    return { success: false, statusCode: 409, error: `Approval already ${approval.status}` };
  }
  if (decision === 'approved' && grantScope && isOneShotApproval(approval)) {
    return {
      success: false,
      statusCode: 400,
      error: 'One-shot approvals cannot be saved as session or always permissions.',
    };
  }

  if (decision === 'approved' && approval.approvalKind === 'path_access' && approval.pathAccess?.requestedPath) {
    try {
      if (grantScope === 'always') addPersistentAllowedPath(approval.pathAccess.requestedPath);
      else addSessionAllowedPath(approval.sessionId, approval.pathAccess.requestedPath);
    } catch (err: any) {
      console.warn('[approvals] Could not add allowed path:', err?.message || err);
    }
  }

  const hadLiveWaiter = typeof (queue as any).hasResolveCallback === 'function'
    ? (queue as any).hasResolveCallback(approvalId)
    : false;
  const resolved = queue.resolve(approvalId, decision === 'approved', resolvedBy);
  if (!resolved) {
    return { success: false, statusCode: 409, error: 'Approval could not be resolved' };
  }

  let permissionGrant: any = null;
  let resumePrompt = '';

  if (
    decision === 'approved'
    && !hadLiveWaiter
    && approval.commandPermissionCandidate
    && !isOneShotApproval(approval)
  ) {
    try {
      permissionGrant = addCommandPermissionGrant(
        approval.commandPermissionCandidate,
        'session',
        `${resolvedBy}:restart_recovery`,
      );
      const command = String(approval.toolArgs?.command || '').trim();
      resumePrompt = [
        `The pending command approval "${approval.id}" was approved after a gateway restart.`,
        command ? `Approved command: ${command}` : `Approved tool: ${approval.toolName}`,
        'Continue the interrupted work from the gateway checkpoint and process log already saved in this chat.',
        'Do not recreate the approval. Re-run only the approved command/action if it is still needed, then continue the original plan.',
      ].join('\n');
    } catch (err: any) {
      resumePrompt = `The command approval "${approval.id}" was approved after restart, but Prometheus could not restore the command permission automatically: ${String(err?.message || err)}. Continue from the checkpoint and request a fresh approval only if needed.`;
    }
  }

  if (decision === 'approved' && !hadLiveWaiter && (
    approval.approvalKind === 'dev_source_edit'
    || approval.toolName === 'request_dev_source_edit'
  )) {
    try {
      const dev: any = approval.devSourceEdit || {};
      const scope = createDevSourceEditApprovalScope({
        sessionId: approval.sessionId,
        files: dev.allowedFiles || approval.toolArgs?.files || [],
        verificationCommand: dev.verificationCommand || approval.toolArgs?.verification_command,
        verificationProfile: dev.verificationProfile || approval.toolArgs?.verification_profile,
        verificationProfiles: dev.verificationProfiles || approval.toolArgs?.verification_profiles,
        reason: dev.reason || approval.reason,
        plan: dev.plan || approval.toolArgs?.plan,
        approvalId: approval.id,
        devEditId: dev.devEditId || approval.toolArgs?.dev_edit_id,
      });
      grantDevSourceEditApproval(approval.sessionId, scope, resolvedBy);
      resumePrompt = [
        `The pending dev source edit approval "${approval.id}" was approved after a gateway restart.`,
        `Dev edit id: ${scope.devEditId}.`,
        `Approved files: ${scope.allowedFiles.join(', ')}.`,
        'Continue the interrupted dev-edit plan from the gateway checkpoint and process log already saved in this chat.',
        `Do not recreate the approval. Proceed as if await_dev_source_edit_approval(approval_id:"${approval.id}") just returned approved.`,
        'Reread changed areas if needed, apply the scoped edits, run approved verification, then finalize with prom_apply_dev_changes and the completion note.',
      ].join('\n');
    } catch (err: any) {
      resumePrompt = `The dev source edit approval "${approval.id}" was approved after restart, but Prometheus could not restore the edit grant automatically: ${String(err?.message || err)}. Inspect the approval and request a repaired dev source edit if needed.`;
    }
  }

  if (decision === 'approved' && grantScope && approval.commandPermissionCandidate) {
    try {
      permissionGrant = addCommandPermissionGrant(approval.commandPermissionCandidate, grantScope, resolvedBy);
      appendAuditEntry({
        sessionId: approval.sessionId,
        agentId: approval.agentId,
        actionType: 'approval_resolved',
        toolName: approval.toolName,
        toolArgs: approval.toolArgs,
        policyTier: approval.policyTier,
        approvalStatus: 'auto_allowed' as any,
        resultSummary: `Created ${grantScope} scoped tool permission ${permissionGrant.id}`,
      });
    } catch (err: any) {
      return {
        success: false,
        statusCode: 500,
        error: `Approval resolved, but command permission could not be saved: ${err?.message || err}`,
      };
    }
  }

  import('../security/log-scrubber').then(({ log }) => {
    log.security('[approvals]', decision.toUpperCase(), 'approval-id:', approvalId, 'action:', approval.action);
  }).catch(() => {});

  try {
    const { broadcastWS } = require('./comms/broadcaster');
    broadcastWS({
      type: decision === 'approved' ? 'approval_approved' : 'approval_denied',
      sessionId: approval.sessionId,
      approvalId: approval.id,
      approval: resolved,
      resumePrompt: resumePrompt || undefined,
      requiresChatResume: !!resumePrompt,
    });
  } catch {}

  return {
    success: true,
    statusCode: 200,
    decision,
    approval: resolved,
    permissionGrant,
    resumePrompt,
    requiresChatResume: !!resumePrompt,
  };
}
