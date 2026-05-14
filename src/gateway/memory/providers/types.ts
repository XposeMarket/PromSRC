import type { MemorySearchHit, MemorySearchParams, MemorySearchResult, ResolvedMemoryRecord } from '../../memory-index';

export type MemoryProviderStatus = {
  id: string;
  label: string;
  ok: boolean;
  reason?: string;
  records?: number;
  chunks?: number;
  indexedAt?: string;
  capabilities: MemoryProviderCapabilities;
};

export type MemoryProviderCapabilities = {
  search: boolean;
  read: boolean;
  write: boolean;
  sync: boolean;
  vectorSearch: boolean;
  graph: boolean;
};

export type MemorySyncOptions = {
  force?: boolean;
  limit?: number;
};

export type MemorySyncResult = {
  ok: boolean;
  providerId: string;
  indexed?: number;
  updated?: number;
  skipped?: number;
  error?: string;
};

export type MemoryWriteInput = {
  title: string;
  body: string;
  type?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
};

export interface MemoryProvider {
  id: string;
  label: string;
  capabilities: MemoryProviderCapabilities;
  status(): Promise<MemoryProviderStatus>;
  sync?(options?: MemorySyncOptions): Promise<MemorySyncResult>;
  search?(query: MemorySearchParams): Promise<MemorySearchResult>;
  read?(recordId: string): Promise<ResolvedMemoryRecord | null>;
  write?(record: MemoryWriteInput): Promise<MemorySyncResult>;
  related?(recordId: string, limit?: number): Promise<MemorySearchHit[]>;
}
