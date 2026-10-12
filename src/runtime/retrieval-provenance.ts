import crypto from 'crypto';

/** Decisions emitted at retrieval producers, never reconstructed from prompt markers. */
export interface RetrievalCandidate {
  sourceId: string; source: string; rank?: number; score?: number;
  matchedTerms?: string[]; selected: boolean; reason: string;
}
export interface RetrievalTrace {
  source: 'atomic' | 'auto' | 'recall'; state: 'available' | 'unavailable' | 'skipped';
  reason?: string; thresholds: Record<string, number | string | boolean>;
  candidates: RetrievalCandidate[]; candidateCount: number; truncated: boolean;
}
export const retrievalSourceId = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
export function boundRetrievalTrace(trace: RetrievalTrace): RetrievalTrace {
  const { scrubContextText } = require('./context-receipt') as typeof import('./context-receipt');
  const clean = (text: string, limit: number) => scrubContextText(String(text)).slice(0, limit);
  const candidates = trace.candidates.slice(0, 96).map(c => ({ ...c, sourceId: /^[a-z0-9_-]{1,256}$/i.test(String(c.sourceId)) ? String(c.sourceId) : retrievalSourceId(String(c.sourceId)), source: clean(c.source, 80), reason: clean(c.reason, 240), matchedTerms: c.matchedTerms?.slice(0, 12).map(t => clean(t, 80)) }));
  let truncated = trace.truncated || trace.candidates.length > 96 || Object.keys(trace.thresholds).length > 24 || trace.candidates.some(c => String(c.sourceId).length > 256 || String(c.source).length > 80 || String(c.reason).length > 240 || (c.matchedTerms?.length || 0) > 12 || c.matchedTerms?.some(t => String(t).length > 80));
  while (JSON.stringify(candidates).length > 6000) { candidates.pop(); truncated = true; }
  return { ...trace, reason: trace.reason ? clean(trace.reason, 240) : undefined, thresholds: Object.fromEntries(Object.entries(trace.thresholds).slice(0, 24).map(([k,v]) => [clean(k, 80), typeof v === 'string' ? clean(v, 240) : v])), candidateCount: trace.candidateCount, truncated, candidates };
}
