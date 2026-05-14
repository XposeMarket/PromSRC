import crypto from 'crypto';
import type { MemoryEmbeddingProvider, MemoryEmbeddingResult, MemoryEmbeddingProviderStatus } from './types';

const DIMENSIONS = 96;
const STOP = new Set([
  'a','an','and','are','as','at','be','by','for','from','had','has','have',
  'i','if','in','is','it','its','of','on','or','that','the','their','them',
  'they','this','to','was','we','were','what','when','where','who','why',
  'will','with','you','your',
]);

function stem(t: string): string {
  let x = t.toLowerCase();
  if (x.endsWith('ing') && x.length > 5) x = x.slice(0, -3);
  else if (x.endsWith('ed') && x.length > 4) x = x.slice(0, -2);
  else if (x.endsWith('s') && x.length > 3) x = x.slice(0, -1);
  return x;
}

function terms(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map(v => stem(v.trim()))
    .filter(v => v.length > 2 && !STOP.has(v));
}

function hashToDim(token: string): number {
  const h = crypto.createHash('sha1').update(token).digest();
  return ((h[0] << 8) + h[1]) % DIMENSIONS;
}

export function embedMemoryHash(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const term of terms(text)) vector[hashToDim(term)] += 1;
  const mag = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(value => Number((value / mag).toFixed(6)));
}

function result(input: string): MemoryEmbeddingResult {
  return {
    vector: embedMemoryHash(input),
    providerId: 'hash',
    model: 'prometheus-hash-terms-v1',
    dimensions: DIMENSIONS,
  };
}

export const hashMemoryEmbeddingProvider: MemoryEmbeddingProvider = {
  id: 'hash',
  label: 'Prometheus hash fallback',
  defaultModel: 'prometheus-hash-terms-v1',
  local: true,

  async status(): Promise<MemoryEmbeddingProviderStatus> {
    return { ok: true, providerId: this.id, model: this.defaultModel, dimensions: DIMENSIONS, local: true };
  },

  async embedQuery(input: string): Promise<MemoryEmbeddingResult> {
    return result(input);
  },

  async embedBatch(inputs: string[]): Promise<MemoryEmbeddingResult[]> {
    return inputs.map(result);
  },
};
