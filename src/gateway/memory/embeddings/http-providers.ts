import { getConfig } from '../../../config/config';
import type { MemoryEmbeddingProvider, MemoryEmbeddingProviderStatus, MemoryEmbeddingResult } from './types';

type HttpProviderOptions = {
  id: string;
  label: string;
  local: boolean;
  defaultModel: string;
  endpoint: string;
  apiKey?: () => string | undefined;
  buildBody: (input: string | string[], model: string) => any;
  parseVectors: (json: any) => number[][];
  headers?: () => Record<string, string>;
};

function normalizeEndpoint(endpoint: string, suffix: string): string {
  const base = String(endpoint || '').replace(/\/+$/, '');
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}

function assertVectors(vectors: number[][], providerId: string): number[][] {
  if (!Array.isArray(vectors) || !vectors.length || !Array.isArray(vectors[0]) || !vectors[0].length) {
    throw new Error(`${providerId} returned no embedding vectors`);
  }
  return vectors.map(vector => vector.map(value => Number(value || 0)));
}

function createHttpEmbeddingProvider(options: HttpProviderOptions): MemoryEmbeddingProvider {
  return {
    id: options.id,
    label: options.label,
    defaultModel: options.defaultModel,
    local: options.local,

    async status(): Promise<MemoryEmbeddingProviderStatus> {
      const key = options.apiKey?.();
      if (!options.local && !key) {
        return { ok: false, reason: 'missing api key', providerId: options.id, model: options.defaultModel, local: options.local };
      }
      return { ok: true, providerId: options.id, model: options.defaultModel, local: options.local };
    },

    async embedQuery(input: string): Promise<MemoryEmbeddingResult> {
      const [result] = await this.embedBatch([input]);
      return result;
    },

    async embedBatch(inputs: string[]): Promise<MemoryEmbeddingResult[]> {
      const model = options.defaultModel;
      const apiKey = options.apiKey?.();
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(options.headers?.() || {}),
      };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;

      const response = await fetch(options.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(options.buildBody(inputs, model)),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${options.id} embedding request failed: HTTP ${response.status}${text ? ` ${text.slice(0, 240)}` : ''}`);
      }
      const json = await response.json();
      const vectors = assertVectors(options.parseVectors(json), options.id);
      return vectors.map(vector => ({
        vector,
        providerId: options.id,
        model,
        dimensions: vector.length,
      }));
    },
  };
}

export function createOpenAiEmbeddingProvider(): MemoryEmbeddingProvider {
  const cfg = getConfig();
  const data = cfg.getConfig();
  const providerCfg = (data as any).memory?.embeddings?.providers?.openai || (data as any).llm?.providers?.openai || {};
  const endpoint = normalizeEndpoint(String(providerCfg.endpoint || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'), '/embeddings');
  return createHttpEmbeddingProvider({
    id: 'openai',
    label: 'OpenAI embeddings',
    local: false,
    defaultModel: String(providerCfg.embedding_model || providerCfg.model_embedding || process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'),
    endpoint,
    apiKey: () => cfg.resolveSecret(providerCfg.api_key || (process.env.OPENAI_API_KEY ? 'env:OPENAI_API_KEY' : '')),
    buildBody: (input, model) => ({ model, input }),
    parseVectors: (json) => (json?.data || []).map((item: any) => item?.embedding || []),
  });
}

export function createOllamaEmbeddingProvider(): MemoryEmbeddingProvider {
  const data = getConfig().getConfig() as any;
  const providerCfg = data.memory?.embeddings?.providers?.ollama || data.llm?.providers?.ollama || data.ollama || {};
  const endpoint = normalizeEndpoint(String(providerCfg.endpoint || process.env.OLLAMA_HOST || 'http://localhost:11434'), '/api/embed');
  return createHttpEmbeddingProvider({
    id: 'ollama',
    label: 'Ollama embeddings',
    local: true,
    defaultModel: String(providerCfg.embedding_model || process.env.OLLAMA_EMBEDDING_MODEL || data.memory?.embedding_model || 'nomic-embed-text'),
    endpoint,
    buildBody: (input, model) => ({ model, input }),
    parseVectors: (json) => json?.embeddings || (json?.embedding ? [json.embedding] : []),
  });
}

export function createLmStudioEmbeddingProvider(): MemoryEmbeddingProvider {
  const cfg = getConfig();
  const data = cfg.getConfig() as any;
  const providerCfg = data.memory?.embeddings?.providers?.lmstudio || data.llm?.providers?.lm_studio || {};
  const endpoint = normalizeEndpoint(String(providerCfg.endpoint || process.env.LM_STUDIO_ENDPOINT || 'http://localhost:1234/v1'), '/embeddings');
  return createHttpEmbeddingProvider({
    id: 'lmstudio',
    label: 'LM Studio embeddings',
    local: true,
    defaultModel: String(providerCfg.embedding_model || providerCfg.model || process.env.LM_STUDIO_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5'),
    endpoint,
    apiKey: () => cfg.resolveSecret(providerCfg.api_key || process.env.LM_STUDIO_API_KEY || ''),
    buildBody: (input, model) => ({ model, input }),
    parseVectors: (json) => (json?.data || []).map((item: any) => item?.embedding || []),
  });
}

export function createVoyageEmbeddingProvider(): MemoryEmbeddingProvider {
  const cfg = getConfig();
  const data = cfg.getConfig() as any;
  const providerCfg = data.memory?.embeddings?.providers?.voyage || {};
  return createHttpEmbeddingProvider({
    id: 'voyage',
    label: 'Voyage embeddings',
    local: false,
    defaultModel: String(providerCfg.model || process.env.VOYAGE_EMBEDDING_MODEL || 'voyage-3-lite'),
    endpoint: String(providerCfg.endpoint || process.env.VOYAGE_ENDPOINT || 'https://api.voyageai.com/v1/embeddings'),
    apiKey: () => cfg.resolveSecret(providerCfg.api_key || (process.env.VOYAGE_API_KEY ? 'env:VOYAGE_API_KEY' : '')),
    buildBody: (input, model) => ({ model, input }),
    parseVectors: (json) => (json?.data || []).map((item: any) => item?.embedding || []),
  });
}

export function createJinaEmbeddingProvider(): MemoryEmbeddingProvider {
  const cfg = getConfig();
  const data = cfg.getConfig() as any;
  const providerCfg = data.memory?.embeddings?.providers?.jina || {};
  return createHttpEmbeddingProvider({
    id: 'jina',
    label: 'Jina embeddings',
    local: false,
    defaultModel: String(providerCfg.model || process.env.JINA_EMBEDDING_MODEL || 'jina-embeddings-v3'),
    endpoint: String(providerCfg.endpoint || process.env.JINA_ENDPOINT || 'https://api.jina.ai/v1/embeddings'),
    apiKey: () => cfg.resolveSecret(providerCfg.api_key || (process.env.JINA_API_KEY ? 'env:JINA_API_KEY' : '')),
    buildBody: (input, model) => ({ model, input }),
    parseVectors: (json) => (json?.data || []).map((item: any) => item?.embedding || []),
  });
}
