import {
  getDevSourceEditContinuation,
  listDevSourceEditContinuations,
  restoreDevSourceEditContinuationAccess,
  type DevSourceEditContinuation,
} from '../dev-source-approvals';
import {
  getCoordinatedDevEdit,
  listCoordinatedDevEdits,
  type CoordinatedDevEdit,
} from '../dev-edit-coordinator';
import { getApprovalQueue, serializeApprovalForClient } from '../verification-flow';
import { getPrometheusQuestionQueue, serializePrometheusQuestionForClient } from '../prometheus-questions';
import { listProposals, loadProposal } from '../proposals/proposal-store';
import { getSession, getSessionDisplayTitle, sessionExists } from '../session';
import { listLiveRuntimes } from '../live-runtime-registry';
import { executePrometheusThreadOps } from '../threads/thread-ops';

type RequestKind = 'dev_source_edit' | 'approval' | 'proposal' | 'question';

export interface PrometheusRequestOpsDeps {
  runInteractiveTurn?: (...args: any[]) => Promise<any>;
  broadcastWS?: (data: any) => void;
}

interface RequestRecord {
  id: string;
  kind: RequestKind;
  status: string;
  sessionId?: string;
  title: string;
  summary: string;
  createdAt?: number | string;
  updatedAt?: number | string;
  recoverable: boolean;
  safeNextAction?: string;
  data: Record<string, any>;
}

const DEV_EDIT_TERMINAL_PHASES = new Set(['complete', 'failed', 'abandoned']);

function cleanList(value: unknown): string[] {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || '').trim().replace(/\\/g, '/'))
      .filter(Boolean),
  ));
}

function requestTimestamp(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function devEditRecord(
  continuation: DevSourceEditContinuation,
  coordinated?: CoordinatedDevEdit | null,
): RequestRecord {
  const requestedFiles = cleanList(coordinated?.requestedFiles?.length
    ? coordinated.requestedFiles
    : continuation.allowedFiles);
  const touchedFiles = cleanList(coordinated?.touchedFiles);
  const remainingFiles = requestedFiles.filter((file) => !touchedFiles.includes(file));
  const phase = String(coordinated?.phase || (continuation.status === 'complete' ? 'complete' : 'approved'));
  const applying = continuation.status === 'applying_live' || phase === 'applying' || phase === 'applied';
  const recoverable = continuation.status !== 'complete'
    && !DEV_EDIT_TERMINAL_PHASES.has(phase)
    && !applying;
  const safeNextAction = continuation.status === 'complete' || phase === 'complete'
    ? 'none_complete'
    : applying
      ? 'wait_for_apply_or_restart_recovery'
      : phase === 'waiting_for_files'
        ? 'resume_existing_request_then_await_file_handoff'
        : touchedFiles.length
          ? 'reread_touched_files_then_resume_existing_request'
          : 'inspect_approved_scope_then_resume_existing_request';
  const userRequest = String(continuation.plan?.userRequest || continuation.summary || '').trim();
  return {
    id: continuation.id,
    kind: 'dev_source_edit',
    status: continuation.status,
    sessionId: continuation.sessionId,
    title: userRequest || `Dev source edit ${continuation.id}`,
    summary: [
      `phase=${phase}`,
      `requested=${requestedFiles.length}`,
      `touched=${touchedFiles.length}`,
      continuation.lastVerification
        ? `verification=${continuation.lastVerification.success ? 'passed' : 'failed'}`
        : 'verification=not_run',
      applying ? 'live_status=applying_or_applied' : 'live_status=not_confirmed',
    ].join('; '),
    createdAt: continuation.createdAt,
    updatedAt: Math.max(Number(continuation.updatedAt || 0), Number(coordinated?.updatedAt || 0)),
    recoverable,
    safeNextAction,
    data: {
      requestId: continuation.id,
      type: 'dev_source_edit',
      sessionId: continuation.sessionId,
      approvalId: continuation.approvalId,
      status: continuation.status,
      phase,
      plan: continuation.plan,
      planHash: continuation.planHash,
      requestedFiles,
      ownedFiles: cleanList(coordinated?.ownedFiles),
      waitingFiles: cleanList(coordinated?.waitingFiles),
      touchedFiles,
      remainingFiles,
      inheritedFiles: cleanList(coordinated?.inheritedFiles),
      verification: continuation.lastVerification || null,
      verificationProfiles: continuation.verificationProfiles || [],
      completionNoteTag: continuation.completionNoteTag,
      appliedLive: continuation.status === 'complete' || phase === 'applied' || phase === 'complete',
      recoverable,
      safeNextAction,
    },
  };
}

function collectRequestRecords(): RequestRecord[] {
  const coordinatedById = new Map(
    listCoordinatedDevEdits().map((edit) => [edit.id, edit]),
  );
  const devEdits = listDevSourceEditContinuations()
    .map((continuation) => devEditRecord(continuation, coordinatedById.get(continuation.id)));
  const approvals = getApprovalQueue().listAll().map((approval): RequestRecord => {
    const serialized = serializeApprovalForClient(approval);
    return {
      id: approval.id,
      kind: 'approval',
      status: approval.status,
      sessionId: approval.sessionId,
      title: String(approval.action || `${approval.toolName} approval`),
      summary: `${approval.approvalKind || 'tool'} approval for ${approval.toolName}`,
      createdAt: approval.createdAt,
      updatedAt: approval.resolvedAt || approval.createdAt,
      recoverable: false,
      safeNextAction: approval.status === 'pending' ? 'await_user_decision' : 'none_resolved',
      data: serialized,
    };
  });
  const proposals = listProposals().map((proposal): RequestRecord => ({
    id: proposal.id,
    kind: 'proposal',
    status: proposal.status,
    sessionId: proposal.sourceSessionId,
    title: proposal.title,
    summary: proposal.summary,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    recoverable: false,
    safeNextAction: proposal.status === 'pending'
      ? 'await_user_decision'
      : ['executing', 'repairing'].includes(proposal.status)
        ? 'inspect_owning_task_or_thread'
        : 'none_terminal',
    data: proposal as any,
  }));
  const questions = getPrometheusQuestionQueue().listAll().map((question): RequestRecord => ({
    id: question.id,
    kind: 'question',
    status: question.status,
    sessionId: question.sessionId,
    title: question.title,
    summary: question.prompt,
    createdAt: question.createdAt,
    updatedAt: question.resolvedAt || question.createdAt,
    recoverable: false,
    safeNextAction: question.status === 'pending' ? 'await_user_answer' : 'none_resolved',
    data: serializePrometheusQuestionForClient(question),
  }));
  return [...devEdits, ...approvals, ...proposals, ...questions]
    .sort((a, b) => requestTimestamp(b.updatedAt || b.createdAt) - requestTimestamp(a.updatedAt || a.createdAt));
}

function publicRecord(record: RequestRecord, full = false): Record<string, any> {
  const base = {
    id: record.id,
    kind: record.kind,
    status: record.status,
    sessionId: record.sessionId,
    title: record.title,
    summary: record.summary,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    recoverable: record.recoverable,
    safeNextAction: record.safeNextAction,
  };
  return full ? { ...base, ...record.data } : base;
}

function matchesRecord(record: RequestRecord, query: string): boolean {
  if (!query) return true;
  const haystack = JSON.stringify(publicRecord(record, true)).toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function findExactRequest(id: string): RequestRecord | null {
  const clean = String(id || '').trim();
  if (!clean) return null;
  if (clean.startsWith('dev_edit_')) {
    const continuation = getDevSourceEditContinuation(clean);
    if (continuation) return devEditRecord(continuation, getCoordinatedDevEdit(clean, continuation.sessionId));
  }
  const proposal = loadProposal(clean);
  if (proposal) {
    return collectRequestRecords().find((record) => record.kind === 'proposal' && record.id === clean) || null;
  }
  return collectRequestRecords().find((record) => record.id === clean) || null;
}

function recoveryPrompt(record: RequestRecord, userMessage = ''): string {
  const data = record.data;
  const plan = data.plan || {};
  return [
    '[PROMETHEUS REQUEST RECOVERY]',
    `The user says this work was cut off and wants the existing request resumed.`,
    `Request ID: ${record.id}`,
    `Request type: ${record.kind}`,
    `Current status: ${record.status}`,
    `Coordination phase: ${data.phase || '(unknown)'}`,
    `Original request: ${String(plan.userRequest || record.title || '').trim()}`,
    `Requested files: ${cleanList(data.requestedFiles).join(', ') || '(none)'}`,
    `Known touched files: ${cleanList(data.touchedFiles).join(', ') || '(none recorded)'}`,
    `Remaining approved files: ${cleanList(data.remainingFiles).join(', ') || '(none)'}`,
    `Waiting files: ${cleanList(data.waitingFiles).join(', ') || '(none)'}`,
    data.verification
      ? `Last verification: ${JSON.stringify(data.verification)}`
      : 'Last verification: not run',
    userMessage ? `User recovery note: ${userMessage}` : '',
    '',
    'Continue under the EXISTING approved dev-edit request. Do not create a duplicate request or claim the changes are live.',
    'First reread every known touched file and reconcile the partial diff. Then inspect the remaining approved files, finish the stored plan, run the approved verification, and use the normal apply_live/restart workflow only after verification succeeds.',
    data.phase === 'waiting_for_files'
      ? `This request is waiting for a coordinated handoff. Use dev_source_edit(action:"await_files", dev_edit_id:"${record.id}") before editing blocked files.`
      : '',
    `Use dev_edit_id="${record.id}" for verification/apply actions and write the completion note only after the coordinator confirms the batch is live.`,
    '[/PROMETHEUS REQUEST RECOVERY]',
  ].filter(Boolean).join('\n');
}

export async function executePrometheusRequestOps(
  ownerSessionId: string,
  args: any,
  deps: PrometheusRequestOpsDeps = {},
): Promise<Record<string, any>> {
  const action = String(args?.action || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(200, Number(args?.limit) || 50));
  const kind = String(args?.kind || args?.type || '').trim().toLowerCase();
  const status = String(args?.status || '').trim().toLowerCase();
  const sessionId = String(args?.session_id || args?.sessionId || '').trim();
  const query = String(args?.query || '').trim();

  if (action === 'list' || action === 'find' || action === 'recovery_candidates') {
    if (action === 'find' && !query) throw new Error('query is required for find.');
    let records = collectRequestRecords();
    if (kind) records = records.filter((record) => record.kind === kind);
    if (status) records = records.filter((record) => record.status.toLowerCase() === status);
    if (sessionId) records = records.filter((record) => record.sessionId === sessionId);
    if (query) records = records.filter((record) => matchesRecord(record, query));
    if (action === 'recovery_candidates') records = records.filter((record) => record.recoverable);
    const selected = records.slice(0, limit);
    return {
      success: true,
      action,
      count: selected.length,
      totalMatched: records.length,
      requests: selected.map((record) => publicRecord(record, action === 'recovery_candidates' || args?.depth === 'full')),
    };
  }

  if (action === 'read' || action === 'status') {
    const requestId = String(args?.request_id || args?.requestId || args?.id || '').trim();
    if (!requestId) throw new Error('request_id is required.');
    const record = findExactRequest(requestId);
    if (!record) throw new Error(`Request not found: ${requestId}`);
    return { success: true, request: publicRecord(record, action === 'read' || args?.depth === 'full') };
  }

  if (action === 'recover') {
    const requestId = String(args?.request_id || args?.requestId || args?.id || '').trim();
    if (!requestId) throw new Error('request_id is required.');
    const record = findExactRequest(requestId);
    if (!record) throw new Error(`Request not found: ${requestId}`);
    if (record.kind !== 'dev_source_edit') throw new Error('Only dev_source_edit requests currently support guarded recovery.');
    if (!record.recoverable) {
      return {
        success: false,
        recovered: false,
        request: publicRecord(record, true),
        reason: `Request is not safely recoverable in status=${record.status}, phase=${record.data.phase || 'unknown'}.`,
        safeNextAction: record.safeNextAction,
      };
    }
    const targetSessionId = String(record.sessionId || '').trim();
    if (!targetSessionId || !sessionExists(targetSessionId)) {
      throw new Error(`Owning session is unavailable for request ${requestId}.`);
    }
    restoreDevSourceEditContinuationAccess(requestId);
    const prompt = recoveryPrompt(record, String(args?.message || args?.reason || '').trim());
    if (targetSessionId === ownerSessionId) {
      return {
        success: true,
        recovered: true,
        handoff: 'current_thread',
        request: publicRecord(record, true),
        recoveryPrompt: prompt,
        instruction: 'Continue this request in the current turn using the recovery prompt and existing dev_edit_id.',
      };
    }

    const targetSession = getSession(targetSessionId);
    const runtime = listLiveRuntimes()
      .filter((item) => item.status === 'running' && String(item.sessionId || '') === targetSessionId)
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
    if (!runtime && targetSession.mainChatGoal?.status === 'restarting') {
      return {
        success: false,
        recovered: false,
        deferred: true,
        request: publicRecord(record, true),
        reason: 'The owning goal is already in restart recovery. Wait for startup recovery instead of launching a duplicate owner.',
      };
    }
    const threadAction = runtime ? 'steer' : 'send';
    const handoff = await executePrometheusThreadOps(ownerSessionId, {
      action: threadAction,
      session_id: targetSessionId,
      message: prompt,
      wait: false,
      requires_response: true,
    }, deps);
    return {
      success: true,
      recovered: true,
      handoff: runtime ? 'steered_active_owner' : 'queued_original_owner',
      ownerSession: {
        id: targetSessionId,
        title: getSessionDisplayTitle(targetSession),
      },
      request: publicRecord(record, true),
      threadResult: handoff,
    };
  }

  throw new Error(`Unsupported prometheus_request_ops action: ${action}`);
}
