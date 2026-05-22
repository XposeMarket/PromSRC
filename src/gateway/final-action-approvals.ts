export type FinalActionKind =
  | 'post'
  | 'send'
  | 'publish'
  | 'submit'
  | 'purchase'
  | 'delete'
  | 'transfer'
  | 'other';

export interface FinalActionApprovalRequest {
  actionKind: FinalActionKind;
  targetLabel: string;
  summary: string;
  surface?: string;
  nextToolName?: string;
  nextToolArgs?: Record<string, any>;
  screenshotId?: string;
  expiresAt?: number;
}
interface FinalActionGrant extends FinalActionApprovalRequest {
  approvalId: string;
  sessionId: string;
  grantedAt: number;
  consumedAt?: number;
  grantedBy?: string;
}

const grants = new Map<string, FinalActionGrant>();
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function normalizeToolName(value: unknown): string {
  return String(value || '').trim();
}

function normalizeComparableValue(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeComparableValue);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      if (key === 'final_action_approval_id') continue;
      out[key] = normalizeComparableValue(value[key]);
    }
    return out;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value);
  return value;
}

function expectedArgsMatch(expected: Record<string, any> | undefined, actual: Record<string, any> | undefined): boolean {
  if (!expected || typeof expected !== 'object' || !Object.keys(expected).length) return true;
  const actualObj = actual && typeof actual === 'object' ? actual : {};
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (key === 'final_action_approval_id') continue;
    const left = normalizeComparableValue(expectedValue);
    const right = normalizeComparableValue((actualObj as any)[key]);
    if (JSON.stringify(left) !== JSON.stringify(right)) return false;
  }
  return true;
}

export function createFinalActionApprovalScope(input: {
  actionKind?: string;
  targetLabel?: string;
  summary?: string;
  surface?: string;
  nextToolName?: string;
  nextToolArgs?: Record<string, any>;
  screenshotId?: string;
  ttlMs?: number;
}): FinalActionApprovalRequest {
  const rawKind = String(input.actionKind || 'other').toLowerCase();
  const actionKind = (['post', 'send', 'publish', 'submit', 'purchase', 'delete', 'transfer', 'other'].includes(rawKind)
    ? rawKind
    : 'other') as FinalActionKind;
  const ttlMs = Math.max(30_000, Math.min(60 * 60 * 1000, Number(input.ttlMs || DEFAULT_TTL_MS)));
  return {
    actionKind,
    targetLabel: String(input.targetLabel || '').trim().slice(0, 160) || actionKind,
    summary: String(input.summary || '').trim().slice(0, 1200) || `Approve final ${actionKind} action.`,
    surface: String(input.surface || '').trim().slice(0, 220) || undefined,
    nextToolName: normalizeToolName(input.nextToolName) || undefined,
    nextToolArgs: input.nextToolArgs && typeof input.nextToolArgs === 'object' ? input.nextToolArgs : undefined,
    screenshotId: String(input.screenshotId || '').trim() || undefined,
    expiresAt: Date.now() + ttlMs,
  };
}

export function grantFinalActionApproval(sessionId: string, approvalId: string, scope: FinalActionApprovalRequest, grantedBy = 'approval'): FinalActionGrant {
  const grant: FinalActionGrant = {
    ...scope,
    approvalId,
    sessionId,
    grantedAt: Date.now(),
    grantedBy,
  };
  grants.set(approvalId, grant);
  return grant;
}

export function consumeFinalActionApproval(input: {
  sessionId: string;
  approvalId?: string;
  toolName: string;
  toolArgs?: Record<string, any>;
}): { ok: true; grant: FinalActionGrant } | { ok: false; message: string } {
  const approvalId = String(input.approvalId || '').trim();
  if (!approvalId) return { ok: false, message: 'final_action_approval_id is required for this final action.' };
  const grant = grants.get(approvalId);
  if (!grant) return { ok: false, message: `No approved final-action grant found for ${approvalId}. Request approval first.` };
  if (grant.sessionId !== input.sessionId) return { ok: false, message: 'Final-action approval belongs to a different session.' };
  if (grant.consumedAt) return { ok: false, message: 'Final-action approval was already used.' };
  if (grant.expiresAt && Date.now() > grant.expiresAt) {
    grants.delete(approvalId);
    return { ok: false, message: 'Final-action approval expired. Request approval again.' };
  }
  if (grant.nextToolName && normalizeToolName(grant.nextToolName) !== normalizeToolName(input.toolName)) {
    return { ok: false, message: `Final-action approval is for ${grant.nextToolName}, not ${input.toolName}.` };
  }
  if (!expectedArgsMatch(grant.nextToolArgs, input.toolArgs)) {
    return { ok: false, message: 'Final-action approval does not match this tool call.' };
  }
  grant.consumedAt = Date.now();
  return { ok: true, grant };
}
