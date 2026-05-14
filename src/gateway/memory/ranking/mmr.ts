export type MmrCandidate<T> = T & {
  score: number;
  vector?: number[];
  text?: string;
};

export type MmrConfig = {
  enabled: boolean;
  lambda: number;
  candidatePool: number;
};

export const DEFAULT_MMR_CONFIG: MmrConfig = {
  enabled: true,
  lambda: 0.72,
  candidatePool: 50,
};

function cosine(a?: number[], b?: number[]): number {
  if (!a?.length || !b?.length) return 0;
  let dot = 0;
  let ma = 0;
  let mb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += Number(a[i] || 0) * Number(b[i] || 0);
    ma += Number(a[i] || 0) * Number(a[i] || 0);
    mb += Number(b[i] || 0) * Number(b[i] || 0);
  }
  if (!ma || !mb) return 0;
  return dot / (Math.sqrt(ma) * Math.sqrt(mb));
}

function textSimilarity(a?: string, b?: string): number {
  const left = new Set(String(a || '').toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2));
  const right = new Set(String(b || '').toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / Math.sqrt(left.size * right.size);
}

function similarity<T>(a: MmrCandidate<T>, b: MmrCandidate<T>): number {
  return Math.max(cosine(a.vector, b.vector), textSimilarity(a.text, b.text));
}

export function rerankMmr<T>(items: Array<MmrCandidate<T>>, limit: number, config?: Partial<MmrConfig>): Array<MmrCandidate<T> & { mmrScore?: number }> {
  const cfg = { ...DEFAULT_MMR_CONFIG, ...(config || {}) };
  if (!cfg.enabled || items.length <= 2) return items.slice(0, limit);
  const pool = items.slice(0, Math.max(limit, cfg.candidatePool));
  const selected: Array<MmrCandidate<T> & { mmrScore?: number }> = [];
  const remaining = [...pool];
  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      const noveltyPenalty = selected.length
        ? Math.max(...selected.map(item => similarity(candidate, item)))
        : 0;
      const mmrScore = (cfg.lambda * candidate.score) - ((1 - cfg.lambda) * noveltyPenalty);
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = i;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    selected.push({ ...chosen, mmrScore: Number(bestScore.toFixed(4)) });
  }
  return selected;
}
