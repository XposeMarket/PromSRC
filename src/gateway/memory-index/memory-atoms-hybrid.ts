import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getAutomaticMemoryEmbeddingProvider } from '../memory/embeddings/registry.js';
import type { MemoryEmbeddingProvider } from '../memory/embeddings/types.js';
import { rerankMmr } from '../memory/ranking/mmr.js';
import {
  formatMemoryAtomReferenceContext,
  parseMemoryAtoms,
  type MemoryAtom,
  type MemoryAtomMatch,
  type MemoryAtomReferenceOptions,
  type MemoryAtomRetrievalResult,
} from './memory-atoms.js';

const STOP = new Set([
  'a','about','after','again','all','am','an','and','are','as','at','be','because','been','before','but','by','can','could',
  'did','do','does','for','from','get','got','had','has','have','how','i','if','in','into','is','it','its','just','like','me','my',
  'of','on','or','our','please','should','so','that','the','their','them','then','there','these','they','this','to','us','was','we',
  'were','what','when','where','which','who','why','will','with','would','you','your',
  // Conversational retrieval cues are not topical evidence. Removing them here
  // prevents a vague request such as "anything important I should remember" from
  // pulling a durable atom merely because the atom itself is important/helpful.
  'advice','already','any','anything','approach','best','context','continue','decision','focus','help','important','know','learn',
  'matter','memory','previous','project','recall','relevant','remember','remind','safeguard','something','tell','thing','think',
  'through','today','useful','vaguely','work',
]);

const CONCEPT_GROUPS: readonly (readonly string[])[] = [
  ['edit','change','modify','patch','update','refactor','fix'],
  ['code','codebase','source','repo','repository'],
  ['delete','remove','removal','erase','purge','clear'],
  ['file','disk','document','path'],
  ['release','launch','ship','publish','deploy'],
  ['app','application','program','software','client'],
  ['mobile','phone','ios','android'],
  ['memory','remember','recall','continuity'],
  ['schedule','cron','reminder','recurring'],
  ['bug','issue','problem','error','failure','broken'],
  ['agent','subagent','bot','worker'],
  ['approval','permission','signoff','authorize'],
  ['blocked','stuck','waiting','pending'],
  ['legal','lawyer','attorney','counsel'],
  ['database','sqlite','storage','persistence'],
  ['concurrency','concurrent','simultaneous','parallel'],
  ['responsive','snappy','stall','freeze','latency'],
  ['trading','market','position','entry','scalp'],
  ['messaging','conversation','email','reply'],
  ['browser','chrome','web'],
  ['safety','safeguard','backup','preserve','protect'],
  ['sync','synchronize','relay'],
  ['auth','oauth','login','credentials'],
  ['voice','audio','speech','realtime'],
  ['video','promo','commercial','campaign'],
  ['business','company','commercial','customer'],
  ['design','visual','style','theme'],
];

const COMMON_RELATION_TERMS = new Set([
  'prometheus','raul','project','system','user','memory','agent','agents','app','work','working','context','source','file','files',
  'current','future','use','using','used','need','needs','make','making','keep','relevant','runtime','workspace',
]);

const conceptByTerm = new Map<string, string>();
for (const group of CONCEPT_GROUPS) {
  const concept = `concept:${group[0]}`;
  for (const term of group) conceptByTerm.set(term, concept);
}

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bsign[ -]?off\b/g, 'signoff')
    .replace(/[^a-z0-9@._+#/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(term: string): string {
  if (term.length > 5 && term.endsWith('ies')) return `${term.slice(0, -3)}y`;
  if (term.length > 5 && term.endsWith('ing')) return term.slice(0, -3);
  if (term.length > 4 && term.endsWith('ed')) return term.slice(0, -2);
  if (term.length > 4 && term.endsWith('es')) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith('s')) return term.slice(0, -1);
  return term;
}

function literalTerms(value: string): string[] {
  return Array.from(new Set(normalize(value)
    .split(' ')
    .map(stem)
    .filter((term) => term.length >= 2 && !STOP.has(term))));
}

function conceptTerms(terms: readonly string[]): string[] {
  return Array.from(new Set(terms.map((term) => conceptByTerm.get(term)).filter((term): term is string => Boolean(term))));
}

function cosine(a?: number[], b?: number[]): number {
  if (!a?.length || !b?.length) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    const av = Number(a[i] || 0);
    const bv = Number(b[i] || 0);
    dot += av * bv;
    ma += av * av;
    mb += bv * bv;
  }
  if (!ma || !mb) return 0;
  return Math.max(-1, Math.min(1, dot / (Math.sqrt(ma) * Math.sqrt(mb))));
}

type HybridSnapshot = {
  hash: string;
  mtimeMs: number;
  size: number;
  atoms: MemoryAtom[];
  literalById: Map<string, string[]>;
  conceptsById: Map<string, string[]>;
  documentFrequency: Map<string, number>;
};

type AtomEmbeddingCache = {
  sourceHash: string;
  providerId: string;
  model: string;
  dimensions: number;
  vectors: Map<string, number[]>;
};

type ScoredAtom = {
  atom: MemoryAtom;
  deterministicScore: number;
  semanticScore: number;
  score: number;
  matchedTerms: string[];
  matchedConcepts: string[];
  vector?: number[];
};

export interface HybridMemoryAtomOptions extends MemoryAtomReferenceOptions {
  /** Test/diagnostic override. Undefined = resolve configured automatic provider; null = deterministic only. */
  embeddingProvider?: MemoryEmbeddingProvider | null;
  /** End-to-end semantic budget. Deterministic retrieval is returned immediately on timeout/failure. */
  semanticBudgetMs?: number;
  /** Candidate pool before relevance gating/diversity rerank. */
  maxCandidates?: number;
  /** Disable semantic retrieval without changing global embedding configuration. */
  disableSemantic?: boolean;
}

export interface HybridMemoryAtomRetrievalResult extends MemoryAtomRetrievalResult {
  hybrid: {
    semanticAttempted: boolean;
    semanticUsed: boolean;
    semanticProvider?: string;
    semanticModel?: string;
    semanticDimensions?: number;
    semanticTimedOut: boolean;
    semanticError?: string;
    candidateCount: number;
  };
}

const snapshotCache = new Map<string, HybridSnapshot>();
const embeddingCache = new Map<string, AtomEmbeddingCache>();
const MAX_WORKSPACE_CACHE = 8;

function trimCache<T>(cache: Map<string, T>, max: number): void {
  while (cache.size > max) {
    const first = cache.keys().next().value;
    if (!first) break;
    cache.delete(first);
  }
}

function loadSnapshot(workspacePath: string): HybridSnapshot {
  const resolved = path.resolve(workspacePath);
  const memoryPath = path.join(resolved, 'MEMORY.md');
  let raw = '';
  let mtimeMs = 0;
  let size = 0;
  try {
    const stat = fs.statSync(memoryPath);
    mtimeMs = stat.mtimeMs;
    size = stat.size;
    const cached = snapshotCache.get(resolved);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached;
    raw = fs.readFileSync(memoryPath, 'utf-8');
  } catch {
    return {
      hash: 'missing',
      mtimeMs: 0,
      size: 0,
      atoms: [],
      literalById: new Map(),
      conceptsById: new Map(),
      documentFrequency: new Map(),
    };
  }
  const hash = crypto.createHash('sha1').update(raw).digest('hex');
  const existing = snapshotCache.get(resolved);
  if (existing?.hash === hash) return existing;
  const atoms = parseMemoryAtoms(raw);
  const literalById = new Map<string, string[]>();
  const conceptsById = new Map<string, string[]>();
  const documentFrequency = new Map<string, number>();
  for (const atom of atoms) {
    // Section headings are metadata, not lexical evidence. This prevents a broad
    // heading such as project_memory from making every atom look like a project hit.
    const literal = literalTerms(atom.rawText);
    const concepts = conceptTerms(literal);
    literalById.set(atom.id, literal);
    conceptsById.set(atom.id, concepts);
    for (const term of new Set(literal)) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }
  const snapshot = { hash, mtimeMs, size, atoms, literalById, conceptsById, documentFrequency };
  snapshotCache.set(resolved, snapshot);
  trimCache(snapshotCache, MAX_WORKSPACE_CACHE);
  return snapshot;
}

function termWeight(term: string, snapshot: HybridSnapshot): number {
  const df = snapshot.documentFrequency.get(term) || 0;
  return Math.max(0.18, Math.log((snapshot.atoms.length + 1) / (df + 1)) + 0.25);
}

function exactEntityMatches(atom: MemoryAtom, queryNormalized: string): string[] {
  return atom.entities.filter((entity) => {
    const normalizedEntity = normalize(entity);
    return normalizedEntity.length >= 2 && new RegExp(`(?:^|\\s)${normalizedEntity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`, 'i').test(queryNormalized);
  });
}

function scoreDeterministic(snapshot: HybridSnapshot, atom: MemoryAtom, query: string): ScoredAtom {
  const queryNormalized = normalize(query);
  const queryLiteral = literalTerms(query);
  const queryConcepts = conceptTerms(queryLiteral);
  const atomLiteral = snapshot.literalById.get(atom.id) || [];
  const atomConcepts = snapshot.conceptsById.get(atom.id) || [];
  const atomSet = new Set(atomLiteral);
  const atomConceptSet = new Set(atomConcepts);
  const matchedTerms = queryLiteral.filter((term) => atomSet.has(term));
  const matchedConcepts = queryConcepts.filter((term) => atomConceptSet.has(term));
  const weightedQuery = queryLiteral.reduce((sum, term) => sum + termWeight(term, snapshot), 0);
  const weightedMatched = matchedTerms.reduce((sum, term) => sum + termWeight(term, snapshot), 0);
  const lexicalCoverage = weightedQuery > 0 ? weightedMatched / weightedQuery : 0;
  const conceptCoverage = queryConcepts.length ? matchedConcepts.length / queryConcepts.length : 0;
  const entityMatches = exactEntityMatches(atom, queryNormalized);
  const normalizedAtom = normalize(atom.rawText);
  const exactPhrase = queryNormalized.length >= 12 && normalizedAtom.includes(queryNormalized);

  // A single ambiguous token is weak evidence. Unique identifiers/entities may
  // still retrieve deterministically, but generic one-word queries should not
  // spray a large durable memory section into the prompt.
  const singleLiteralAmbiguous = queryLiteral.length === 1
    && (snapshot.documentFrequency.get(queryLiteral[0]) || 0) > 1
    && entityMatches.length === 0;

  let score = lexicalCoverage * 0.66
    + Math.min(0.16, entityMatches.length * 0.10)
    + (exactPhrase ? 0.16 : 0);
  if (matchedConcepts.length >= 2) score += Math.min(0.16, conceptCoverage * 0.16);
  else if (matchedConcepts.length === 1 && matchedTerms.length > 0) score += 0.04;
  if (singleLiteralAmbiguous) score *= 0.20;

  return {
    atom,
    deterministicScore: Math.min(1, score),
    semanticScore: 0,
    score: Math.min(1, score),
    matchedTerms,
    matchedConcepts,
  };
}

function hybridScore(candidate: ScoredAtom, queryTermCount: number): number {
  const d = candidate.deterministicScore;
  const s = candidate.semanticScore;
  if (s <= 0) return d;
  if (d <= 0) return s * (queryTermCount >= 3 ? 0.72 : 0.48);
  return Math.min(1, (d * 0.60) + (s * 0.40) + Math.min(0.08, candidate.matchedTerms.length * 0.02));
}

function isDirectCandidate(candidate: ScoredAtom, queryTermCount: number, semanticUsed: boolean): boolean {
  if (candidate.deterministicScore >= 0.20) return true;
  if (!semanticUsed || queryTermCount < 3) return false;
  // Pure semantic recall deliberately has a high gate. Durable memory is more
  // damaging when falsely injected than when a marginal candidate is omitted.
  if (candidate.semanticScore >= 0.54) return true;
  if (candidate.semanticScore >= 0.48 && candidate.deterministicScore >= 0.08) return true;
  return false;
}

function relationAnchors(snapshot: HybridSnapshot, direct: ScoredAtom[], queryTerms: Set<string>): { terms: Set<string>; entities: Set<string> } {
  const terms = new Set<string>();
  const entities = new Set<string>();
  for (const hit of direct.slice(0, 4)) {
    for (const term of snapshot.literalById.get(hit.atom.id) || []) {
      if (queryTerms.has(term) || COMMON_RELATION_TERMS.has(term)) continue;
      if ((snapshot.documentFrequency.get(term) || 0) <= Math.max(2, Math.ceil(snapshot.atoms.length * 0.08))) terms.add(term);
    }
    for (const entity of hit.atom.entities) {
      const normalizedEntity = normalize(entity);
      if (!normalizedEntity || COMMON_RELATION_TERMS.has(normalizedEntity)) continue;
      entities.add(normalizedEntity);
    }
  }
  return { terms, entities };
}

function buildRelated(snapshot: HybridSnapshot, direct: ScoredAtom[], all: ScoredAtom[], queryTerms: Set<string>): MemoryAtomMatch[] {
  if (!direct.length) return [];
  const directIds = new Set(direct.map((entry) => entry.atom.id));
  const anchors = relationAnchors(snapshot, direct, queryTerms);
  const related: MemoryAtomMatch[] = [];
  for (const entry of all) {
    if (directIds.has(entry.atom.id)) continue;
    const literal = snapshot.literalById.get(entry.atom.id) || [];
    const sharedTerms = literal.filter((term) => anchors.terms.has(term));
    const sharedEntities = entry.atom.entities
      .map(normalize)
      .filter((entity) => anchors.entities.has(entity));
    const strongAnchor = sharedEntities.length > 0 || sharedTerms.length >= 2;
    if (!strongAnchor) continue;
    const relationBoost = Math.min(0.18, sharedEntities.length * 0.10 + sharedTerms.length * 0.035);
    const score = Math.min(1, entry.score + relationBoost);
    if (score < 0.30) continue;
    related.push({
      atom: entry.atom,
      score,
      matchedTerms: entry.matchedTerms,
      relation: 'related',
      relationReason: sharedEntities.length
        ? `shared_entity:${sharedEntities[0]}`
        : 'shared_rare_memory_terms',
    });
  }
  return related
    .sort((a, b) => b.score - a.score || a.atom.sourceStartLine - b.atom.sourceStartLine)
    .slice(0, 2);
}

function capSelection(entries: MemoryAtomMatch[], snapshot: HybridSnapshot, options: HybridMemoryAtomOptions): MemoryAtomMatch[] {
  const requestedAtoms = Number(options.maxAtoms);
  const maxAtoms = Number.isFinite(requestedAtoms) && requestedAtoms > 0
    ? Math.max(1, Math.floor(requestedAtoms))
    : 6;
  const requestedChars = Number(options.maxChars);
  const maxChars = Number.isFinite(requestedChars) && requestedChars > 0
    ? Math.max(800, Math.floor(requestedChars))
    : Math.min(14_000, Math.max(4_000, snapshot.size));
  const selected: MemoryAtomMatch[] = [];
  let chars = 0;
  for (const entry of entries) {
    if (selected.length >= maxAtoms) break;
    if (selected.some((match) => match.atom.id === entry.atom.id)) continue;
    const cost = entry.atom.rawText.length + 180;
    if (chars + cost > maxChars) continue;
    selected.push(entry);
    chars += cost;
  }
  return selected;
}

async function withBudget<T>(promise: Promise<T>, budgetMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`Atomic semantic retrieval timed out after ${budgetMs}ms.`);
          error.name = 'TimeoutError';
          reject(error);
        }, budgetMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function providerCacheKey(workspacePath: string, snapshot: HybridSnapshot, provider: MemoryEmbeddingProvider): string {
  return `${path.resolve(workspacePath)}|${snapshot.hash}|${provider.id}|${provider.defaultModel}`;
}

async function atomEmbeddings(
  workspacePath: string,
  snapshot: HybridSnapshot,
  provider: MemoryEmbeddingProvider,
): Promise<AtomEmbeddingCache> {
  const key = providerCacheKey(workspacePath, snapshot, provider);
  const cached = embeddingCache.get(key);
  if (cached) return cached;
  const results = await provider.embedBatch(snapshot.atoms.map((atom) => `${atom.sourceSection}\n${atom.rawText}`));
  const vectors = new Map<string, number[]>();
  for (let i = 0; i < snapshot.atoms.length; i += 1) {
    const vector = results[i]?.vector;
    if (Array.isArray(vector) && vector.length) vectors.set(snapshot.atoms[i].id, vector);
  }
  const first = results.find((result) => Array.isArray(result?.vector) && result.vector.length);
  const cache: AtomEmbeddingCache = {
    sourceHash: snapshot.hash,
    providerId: first?.providerId || provider.id,
    model: first?.model || provider.defaultModel,
    dimensions: first?.dimensions || first?.vector?.length || 0,
    vectors,
  };
  embeddingCache.set(key, cache);
  trimCache(embeddingCache, MAX_WORKSPACE_CACHE * 3);
  return cache;
}

async function resolveProvider(options: HybridMemoryAtomOptions): Promise<MemoryEmbeddingProvider | null> {
  if (options.disableSemantic || options.embeddingProvider === null) return null;
  if (options.embeddingProvider) return options.embeddingProvider;
  const provider = await getAutomaticMemoryEmbeddingProvider();
  if (!provider || provider.id === 'hash') return null;
  return provider;
}

function emptyResult(snapshot: HybridSnapshot, startedAt: number, hybrid: HybridMemoryAtomRetrievalResult['hybrid']): HybridMemoryAtomRetrievalResult {
  return {
    direct: [],
    related: [],
    selected: [],
    stats: {
      atomCount: snapshot.atoms.length,
      directCandidates: 0,
      selectedCount: 0,
      durationMs: Date.now() - startedAt,
      cacheHit: false,
      sourceMtimeMs: snapshot.mtimeMs,
    },
    hybrid,
  };
}

export async function retrieveHybridMemoryAtoms(
  workspacePath: string,
  query: string,
  options: HybridMemoryAtomOptions = {},
): Promise<HybridMemoryAtomRetrievalResult> {
  const startedAt = Date.now();
  const snapshot = loadSnapshot(workspacePath);
  const queryText = String(query || '').trim();
  const queryTerms = literalTerms(queryText);
  const baseHybrid: HybridMemoryAtomRetrievalResult['hybrid'] = {
    semanticAttempted: false,
    semanticUsed: false,
    semanticTimedOut: false,
    candidateCount: 0,
  };
  if (!queryTerms.length || !snapshot.atoms.length) return emptyResult(snapshot, startedAt, baseHybrid);

  const scored = snapshot.atoms.map((atom) => scoreDeterministic(snapshot, atom, queryText));
  const budgetMs = Math.max(40, Math.min(750, Number(options.semanticBudgetMs || process.env.PROMETHEUS_ATOMIC_MEMORY_SEMANTIC_BUDGET_MS || 300) || 300));
  let semanticUsed = false;
  let semanticError = '';
  let semanticTimedOut = false;
  let provider: MemoryEmbeddingProvider | null = null;
  let embeddingMeta: AtomEmbeddingCache | null = null;

  if (!options.disableSemantic && options.embeddingProvider !== null) {
    baseHybrid.semanticAttempted = true;
    try {
      const semantic = await withBudget((async () => {
        const resolved = await resolveProvider(options);
        if (!resolved) return null;
        const [queryEmbedding, atoms] = await Promise.all([
          resolved.embedQuery(queryText),
          atomEmbeddings(workspacePath, snapshot, resolved),
        ]);
        return { resolved, queryEmbedding, atoms };
      })(), budgetMs);
      if (semantic?.queryEmbedding?.vector?.length && semantic.atoms.vectors.size) {
        provider = semantic.resolved;
        embeddingMeta = semantic.atoms;
        semanticUsed = true;
        for (const candidate of scored) {
          const vector = semantic.atoms.vectors.get(candidate.atom.id);
          candidate.vector = vector;
          candidate.semanticScore = Math.max(0, cosine(semantic.queryEmbedding.vector, vector));
          candidate.score = hybridScore(candidate, queryTerms.length);
        }
      }
    } catch (error: any) {
      semanticError = String(error?.message || error).slice(0, 300);
      semanticTimedOut = error?.name === 'TimeoutError' || /timed out/i.test(semanticError);
      // Deterministic retrieval is intentionally the fail-safe path. A cloud or
      // local embedding outage must never make durable memory disappear entirely.
    }
  }

  if (!semanticUsed) {
    for (const candidate of scored) candidate.score = hybridScore(candidate, queryTerms.length);
  }

  const directCandidates = scored
    .filter((candidate) => isDirectCandidate(candidate, queryTerms.length, semanticUsed))
    .sort((a, b) => b.score - a.score || b.semanticScore - a.semanticScore || a.atom.sourceStartLine - b.atom.sourceStartLine);
  const maxCandidates = Math.max(6, Math.min(50, Number(options.maxCandidates || 24) || 24));
  const reranked = rerankMmr(
    directCandidates.slice(0, maxCandidates).map((candidate) => ({ ...candidate, text: candidate.atom.rawText })),
    Math.min(maxCandidates, directCandidates.length),
    { enabled: semanticUsed, lambda: 0.82, candidatePool: maxCandidates },
  );
  const direct: MemoryAtomMatch[] = reranked.map((entry) => ({
    atom: entry.atom,
    score: entry.score,
    matchedTerms: entry.matchedTerms,
    relation: 'direct' as const,
  }));
  const related = buildRelated(snapshot, directCandidates, scored, new Set(queryTerms));
  const selected = capSelection([...direct, ...related], snapshot, options);

  return {
    direct,
    related,
    selected,
    stats: {
      atomCount: snapshot.atoms.length,
      directCandidates: directCandidates.length,
      selectedCount: selected.length,
      durationMs: Date.now() - startedAt,
      cacheHit: Boolean(embeddingMeta && embeddingCache.has(providerCacheKey(workspacePath, snapshot, provider!))),
      sourceMtimeMs: snapshot.mtimeMs,
    },
    hybrid: {
      semanticAttempted: baseHybrid.semanticAttempted,
      semanticUsed,
      semanticProvider: provider?.id || embeddingMeta?.providerId,
      semanticModel: embeddingMeta?.model,
      semanticDimensions: embeddingMeta?.dimensions,
      semanticTimedOut,
      semanticError: semanticError || undefined,
      candidateCount: directCandidates.length,
    },
  };
}

export async function buildHybridMemoryAtomReferenceContext(
  workspacePath: string,
  query: string,
  options: HybridMemoryAtomOptions = {},
): Promise<string> {
  const result = await retrieveHybridMemoryAtoms(workspacePath, query, options);
  return formatMemoryAtomReferenceContext(result);
}

export function clearHybridMemoryAtomCache(workspacePath?: string): void {
  if (!workspacePath) {
    snapshotCache.clear();
    embeddingCache.clear();
    return;
  }
  const prefix = `${path.resolve(workspacePath)}|`;
  snapshotCache.delete(path.resolve(workspacePath));
  for (const key of [...embeddingCache.keys()]) {
    if (key.startsWith(prefix)) embeddingCache.delete(key);
  }
}
