export type MemoryEmbeddingProviderStatus = {
  ok: boolean;
  reason?: string;
  providerId: string;
  model: string;
  dimensions?: number;
  local?: boolean;
};

export type MemoryEmbeddingResult = {
  vector: number[];
  providerId: string;
  model: string;
  dimensions: number;
};

export interface MemoryEmbeddingProvider {
  id: string;
  label: string;
  defaultModel: string;
  local: boolean;
  status(): Promise<MemoryEmbeddingProviderStatus>;
  embedQuery(input: string): Promise<MemoryEmbeddingResult>;
  embedBatch(inputs: string[]): Promise<MemoryEmbeddingResult[]>;
}

export type MemoryEmbeddingPreference = 'auto' | 'local-first' | 'cloud' | 'hash' | string;
