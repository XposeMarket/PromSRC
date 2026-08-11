/**
 * Shared policy for proposals created by the nightly Brain Dream.
 *
 * Dream proposals are intentionally a small shortlist of lightweight plan
 * cards.  The normal proposal store and approval/execution contracts remain
 * unchanged for interactive, action, and code-change proposals.
 */

export const BRAIN_DREAM_TARGET_PROPOSALS = 2;
export const BRAIN_DREAM_MAX_PROPOSALS = 3;

const BRAIN_DREAM_SESSION_RE = /^brain_dream_\d{4}-\d{2}-\d{2}$/i;
const BUDGET_TTL_MS = 12 * 60 * 60 * 1000;

interface ProposalBudget {
  used: number;
  lastSeenAt: number;
}

const proposalBudgets = new Map<string, ProposalBudget>();

export function isBrainDreamSession(sessionId: string): boolean {
  return BRAIN_DREAM_SESSION_RE.test(String(sessionId || '').trim());
}

function pruneBudgets(now = Date.now()): void {
  for (const [sessionId, budget] of proposalBudgets) {
    if (now - budget.lastSeenAt > BUDGET_TTL_MS) proposalBudgets.delete(sessionId);
  }
}

/** Reserve one Dream proposal slot. Release it if proposal creation fails. */
export function claimBrainDreamProposalSlot(sessionId: string): {
  isBrainDream: boolean;
  allowed: boolean;
  used: number;
  remaining: number;
  limit: number;
} {
  if (!isBrainDreamSession(sessionId)) {
    return { isBrainDream: false, allowed: true, used: 0, remaining: BRAIN_DREAM_MAX_PROPOSALS, limit: BRAIN_DREAM_MAX_PROPOSALS };
  }

  const now = Date.now();
  pruneBudgets(now);
  const current = proposalBudgets.get(sessionId) || { used: 0, lastSeenAt: now };
  current.lastSeenAt = now;

  if (current.used >= BRAIN_DREAM_MAX_PROPOSALS) {
    proposalBudgets.set(sessionId, current);
    return {
      isBrainDream: true,
      allowed: false,
      used: current.used,
      remaining: 0,
      limit: BRAIN_DREAM_MAX_PROPOSALS,
    };
  }

  current.used += 1;
  proposalBudgets.set(sessionId, current);
  return {
    isBrainDream: true,
    allowed: true,
    used: current.used,
    remaining: Math.max(0, BRAIN_DREAM_MAX_PROPOSALS - current.used),
    limit: BRAIN_DREAM_MAX_PROPOSALS,
  };
}

export function releaseBrainDreamProposalSlot(sessionId: string): void {
  if (!isBrainDreamSession(sessionId)) return;
  const current = proposalBudgets.get(sessionId);
  if (!current) return;
  current.used = Math.max(0, current.used - 1);
  current.lastSeenAt = Date.now();
  proposalBudgets.set(sessionId, current);
}

export function clearBrainDreamProposalBudget(sessionId: string): void {
  if (isBrainDreamSession(sessionId)) proposalBudgets.delete(sessionId);
}

export function getBrainDreamProposalBudget(sessionId: string): {
  used: number;
  remaining: number;
  limit: number;
} {
  const budget = proposalBudgets.get(sessionId);
  const used = isBrainDreamSession(sessionId) ? (budget?.used || 0) : 0;
  return {
    used,
    remaining: Math.max(0, BRAIN_DREAM_MAX_PROPOSALS - used),
    limit: BRAIN_DREAM_MAX_PROPOSALS,
  };
}
