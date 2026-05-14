import type { ConsolidationStore, MemoryClaim } from './types';

const AUTHORITY_RANK: Record<string, number> = {
  user_correction: 100,
  explicit_user_instruction: 92,
  durable_memory_file: 84,
  verified_task_outcome: 72,
  project_state: 64,
  assistant_inference: 38,
  raw_transcript: 18,
  raw_evidence: 12,
};

function authorityRank(claim: MemoryClaim): number {
  return AUTHORITY_RANK[claim.authority] ?? 30;
}

function contradicts(a: MemoryClaim, b: MemoryClaim): boolean {
  const left = `${a.summary} ${a.body}`.toLowerCase();
  const right = `${b.summary} ${b.body}`.toLowerCase();
  const negators = ['not ', 'never ', 'instead ', 'no longer ', 'rather than '];
  if (a.canonicalKey === b.canonicalKey && a.id !== b.id && left !== right) return true;
  return negators.some(token => left.includes(token) && !right.includes(token)) ||
    negators.some(token => right.includes(token) && !left.includes(token));
}

export function applyClaimConflicts(store: ConsolidationStore): ConsolidationStore {
  const claims = Object.values(store.claims);
  for (const claim of claims) {
    if (claim.status === 'rejected') continue;
    const conflicts = claims.filter(other => other.id !== claim.id && other.status !== 'rejected' && contradicts(claim, other));
    for (const other of conflicts) {
      if (authorityRank(claim) >= authorityRank(other)) {
        if (!claim.supersedes.includes(other.id)) claim.supersedes.push(other.id);
        if (!other.supersededBy.includes(claim.id)) other.supersededBy.push(claim.id);
        if (other.status === 'proposed' || other.status === 'accepted') other.status = 'superseded';
      }
    }
  }
  return store;
}
