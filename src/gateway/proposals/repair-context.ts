export interface ProposalRepairContext {
  repairOnly?: boolean;
  rootProposalId?: string;
  rootTaskId?: string;
  parentProposalId?: string;
  parentTaskId?: string;
  resumeOriginalTaskId?: string;
  failedAtStepIndex?: number;
  failedStepDescription?: string;
  failedWorkspaceRoot?: string;
  canonicalBuildCommand?: string;
  capturedFailureCommand?: string;
  repairDepth?: number;
  handoffSummary?: string;
  handedOffAt?: number;
}

export function normalizeProposalRepairContext(raw: any): ProposalRepairContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const normalizeString = (value: any): string | undefined => {
    const text = String(value || '').trim();
    return text || undefined;
  };
  const normalizeNumber = (value: any): number | undefined => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : undefined;
  };
  const context: ProposalRepairContext = {
    repairOnly: raw.repairOnly === true || undefined,
    rootProposalId: normalizeString(raw.rootProposalId),
    rootTaskId: normalizeString(raw.rootTaskId),
    parentProposalId: normalizeString(raw.parentProposalId),
    parentTaskId: normalizeString(raw.parentTaskId),
    resumeOriginalTaskId: normalizeString(raw.resumeOriginalTaskId),
    failedAtStepIndex: normalizeNumber(raw.failedAtStepIndex),
    failedStepDescription: normalizeString(raw.failedStepDescription),
    failedWorkspaceRoot: normalizeString(raw.failedWorkspaceRoot),
    canonicalBuildCommand: normalizeString(raw.canonicalBuildCommand),
    capturedFailureCommand: normalizeString(raw.capturedFailureCommand),
    repairDepth: normalizeNumber(raw.repairDepth),
    handoffSummary: normalizeString(raw.handoffSummary),
    handedOffAt: normalizeNumber(raw.handedOffAt),
  };
  return Object.values(context).some((value) => value !== undefined) ? context : undefined;
}
