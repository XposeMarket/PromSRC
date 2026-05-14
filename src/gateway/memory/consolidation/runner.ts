import { refreshMemoryIndexFromAudit } from '../../memory-index';
import { extractMemoryClaims } from './claim-extractor';
import { applyClaimConflicts } from './conflict-detector';
import {
  readConsolidationStore,
  upsertClaims,
  writeAcceptedClaimDocument,
  writeConsolidationStore,
} from './store';
import type { MemoryClaim } from './types';

export function consolidateMemory(workspacePath: string, options?: {
  maxSources?: number;
  maxClaims?: number;
  autoAccept?: boolean;
}): {
  proposed: number;
  accepted: number;
  totalPending: number;
  claims: MemoryClaim[];
} {
  const claims = extractMemoryClaims(workspacePath, options);
  let store = upsertClaims(workspacePath, claims);
  store = applyClaimConflicts(store);
  let accepted = 0;
  if (options?.autoAccept) {
    for (const claim of Object.values(store.claims)) {
      if (claim.status !== 'proposed') continue;
      if (claim.confidence < 0.88 || !['explicit_user_instruction', 'user_correction'].includes(claim.authority)) continue;
      claim.status = 'accepted';
      claim.updatedAt = new Date().toISOString();
      writeAcceptedClaimDocument(workspacePath, claim);
      accepted += 1;
    }
  }
  writeConsolidationStore(workspacePath, store);
  if (accepted > 0) refreshMemoryIndexFromAudit(workspacePath, { force: true, minIntervalMs: 0, maxChangedFiles: 500 });
  const pending = Object.values(store.claims).filter(claim => claim.status === 'proposed');
  return {
    proposed: claims.length,
    accepted,
    totalPending: pending.length,
    claims: pending.slice(0, Math.max(1, Math.min(100, Number(options?.maxClaims || 40)))),
  };
}

export function listMemoryClaims(workspacePath: string, status = 'proposed'): MemoryClaim[] {
  const store = readConsolidationStore(workspacePath);
  return Object.values(store.claims)
    .filter(claim => !status || claim.status === status)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function reviewMemoryClaim(workspacePath: string, claimId: string, action: 'accept' | 'reject' | 'supersede', note?: string): {
  ok: boolean;
  claim?: MemoryClaim;
  error?: string;
  sourcePath?: string;
} {
  const store = readConsolidationStore(workspacePath);
  const claim = store.claims[claimId];
  if (!claim) return { ok: false, error: `Claim not found: ${claimId}` };
  claim.updatedAt = new Date().toISOString();
  claim.reviewNote = note;
  if (action === 'reject') claim.status = 'rejected';
  if (action === 'supersede') claim.status = 'superseded';
  let sourcePath: string | undefined;
  if (action === 'accept') {
    claim.status = 'accepted';
    sourcePath = writeAcceptedClaimDocument(workspacePath, claim);
  }
  writeConsolidationStore(workspacePath, applyClaimConflicts(store));
  if (action === 'accept') refreshMemoryIndexFromAudit(workspacePath, { force: true, minIntervalMs: 0, maxChangedFiles: 500 });
  return { ok: true, claim, sourcePath };
}
