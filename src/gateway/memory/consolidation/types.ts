export type MemoryClaimType =
  | 'preference'
  | 'user_correction'
  | 'decision'
  | 'project_fact'
  | 'rule'
  | 'task_outcome'
  | 'open_loop'
  | 'entity_fact';

export type MemoryClaimStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded';

export type MemoryClaim = {
  id: string;
  type: MemoryClaimType;
  canonicalKey: string;
  title: string;
  summary: string;
  body: string;
  sourceRefs: Array<{
    sourceType: string;
    sourcePath: string;
    confidence: number;
    sourceSection?: string;
    sourceStartLine?: number;
    sourceEndLine?: number;
  }>;
  confidence: number;
  authority: string;
  status: MemoryClaimStatus;
  supersedes: string[];
  supersededBy: string[];
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
  entities: Record<string, string[]>;
  reviewNote?: string;
};

export type ConsolidationStore = {
  version: number;
  updatedAt: string;
  claims: Record<string, MemoryClaim>;
};
