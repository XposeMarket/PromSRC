import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type MemoryAtomKind = 'project_fact' | 'decision' | 'workflow_rule' | 'continuity';

export interface MemoryAtom {
  id: string;
  sourcePath: string;
  sourceSection: string;
  sourceStartLine: number;
  sourceEndLine: number;
  rawText: string;
  contentHash: string;
  kind: MemoryAtomKind;
  authority: 'durable_memory_file';
  durability: 1;
  status: 'active';
  terms: string[];
  entities: string[];
  tags: string[];
}

export interface MemoryAtomMatch {
  atom: MemoryAtom;
  score: number;
  matchedTerms: string[];
  relation: 'direct' | 'related';
  relationReason?: string;
}

export interface MemoryAtomRetrievalResult {
  direct: MemoryAtomMatch[];
  related: MemoryAtomMatch[];
  selected: MemoryAtomMatch[];
  stats: {
    atomCount: number;
    directCandidates: number;
    selectedCount: number;
    durationMs: number;
    cacheHit: boolean;
    sourceMtimeMs?: number;
  };
}

export interface MemoryAtomReferenceOptions {
  maxAtoms?: number;
  maxChars?: number;
  additionalContext?: string;
}

type SourceLine = {
  number: number;
  text: string;
  start: number;
  end: number;
  after: number;
};

type AtomSnapshot = {
  mtimeMs: number;
  size: number;
  atoms: MemoryAtom[];
  termDocumentFrequency: Map<string, number>;
};

const snapshotCache = new Map<string, AtomSnapshot>();
const MAX_ATOM_CACHE_ENTRIES = 8;
// The main prompt intentionally has no arbitrary top-N atom budget. The
// default character budget is derived from the source file so a normal-sized
// MEMORY.md can project all qualifying facts, while an unexpectedly enormous
// file still cannot consume the entire model context by itself. Callers such
// as voice may provide a deliberately tighter budget.
const MIN_REFERENCE_CONTEXT_CHARS = 64_000;
const MAX_REFERENCE_CONTEXT_CHARS = 512_000;

const STOP_WORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'also', 'an', 'and', 'are', 'as', 'at', 'be',
  'because', 'been', 'before', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'for',
  'from', 'get', 'got', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
  'its', 'just', 'like', 'me', 'my', 'of', 'on', 'or', 'our', 'please', 'should', 'so',
  'that', 'the', 'their', 'them', 'there', 'these', 'this', 'to', 'us', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you',
  'tell',
  'your', 'prometheus', 'raul',
]);

const ENTITY_ALIASES: Array<[string, RegExp]> = [
  ['xpose', /\bxpose(?:\s+market)?\b/i],
  ['hyperframes', /\bhyperframes?\b/i],
  ['vita', /\b(?:ps\s*)?vita\b/i],
  ['mobile', /\bmobile\b/i],
  ['voice', /\bvoice|realtime\b/i],
  ['brain', /\bbrain|thought|dream\b/i],
  ['memory', /\bmemory|memory\.md|memory search\b/i],
  ['runtime', /\bruntime|gateway|prompt|worker\b/i],
  ['trading', /\btrading|daytrading|ny open|robinhood\b/i],
  ['browser', /\bbrowser|chrome|scroll\b/i],
  ['release', /\brelease|installer|public build\b/i],
  ['business', /\bbusiness|auto shop|vendor|invoice|connector\b/i],
  ['skills', /\bskill|skill gardener\b/i],
  ['teams', /\bteam|subagent|manager|agent\b/i],
  ['creative', /\bcreative|promo video|image|video\b/i],
];

const CONCEPT_GROUPS: Record<string, string[]> = {
  modify: ['edit', 'editing', 'change', 'changing', 'modify', 'modifying', 'patch', 'update', 'refactor', 'revise', 'rewrite', 'fix'],
  code: ['code', 'codebase', 'source', 'repo', 'repository'],
  create: ['create', 'creating', 'add', 'adding', 'make', 'making', 'generate', 'generating'],
  remove: ['delete', 'deleting', 'remove', 'removing', 'removal', 'erase', 'erasing', 'purge', 'clear'],
  file: ['file', 'files', 'disk', 'document', 'documents', 'path', 'paths'],
  search: ['search', 'searching', 'find', 'finding', 'lookup', 'retrieve', 'retrieval'],
  release: ['release', 'launch', 'ship', 'shipping', 'publish', 'publishing', 'deploy', 'deploying', 'deployment'],
  app: ['app', 'application', 'program', 'software', 'client'],
  mobile: ['mobile', 'phone', 'handset'],
  memory: ['memory', 'remember', 'recall', 'recollection'],
  schedule: ['schedule', 'scheduled', 'cron', 'recurring', 'reminder', 'remind'],
  problem: ['bug', 'issue', 'problem', 'error', 'failure', 'failed', 'broken'],
  agent: ['agent', 'subagent', 'bot', 'worker'],
  team: ['team', 'group', 'collaboration', 'crew'],
  approval: ['approval', 'approve', 'approved', 'permission', 'signoff', 'authorize', 'authorization'],
  blocked: ['blocked', 'blocking', 'stuck', 'waiting', 'pending', 'hold'],
  legal: ['legal', 'lawyer', 'lawyers', 'attorney', 'attorneys', 'counsel'],
  storage: ['database', 'db', 'sqlite', 'storage', 'persistence', 'persistent'],
  concurrency: ['concurrent', 'concurrency', 'simultaneous', 'parallel'],
  responsive: ['responsive', 'snappy', 'stall', 'stalling', 'freeze', 'frozen', 'latency'],
  trading: ['trade', 'trading', 'market', 'position', 'positions', 'entry', 'entries', 'scalp', 'scalping'],
  messaging: ['message', 'messages', 'conversation', 'conversations', 'email', 'mail', 'reply'],
  browser: ['browser', 'chrome', 'website', 'webpage', 'web'],
  safety: ['safe', 'safely', 'safeguard', 'safeguards', 'backup', 'preserve', 'protect', 'protection'],
  sync: ['sync', 'syncing', 'synchronize', 'synchronizing', 'relay'],
  auth: ['auth', 'authentication', 'oauth', 'login', 'signin', 'credential', 'credentials'],
};

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bsign\s+off\b/g, ' signoff ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(value: string): string {
  let token = String(value || '').toLowerCase();
  if (token.endsWith('ies') && token.length > 5) token = `${token.slice(0, -3)}y`;
  else if (token.endsWith('ing') && token.length > 5) token = token.slice(0, -3);
  else if (token.endsWith('ed') && token.length > 4) token = token.slice(0, -2);
  else if (token.endsWith('s') && token.length > 3) token = token.slice(0, -1);
  return token;
}

const CONCEPT_BY_TERM = (() => {
  const out = new Map<string, string>();
  for (const [concept, variants] of Object.entries(CONCEPT_GROUPS)) {
    for (const variant of variants) out.set(stem(variant), `concept_${concept}`);
  }
  return out;
})();

function tokenizeBase(value: string): string[] {
  return Array.from(new Set(
    normalizeText(value)
      .split(' ')
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
      .map(stem)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  ));
}

function tokenize(value: string): string[] {
  const base = tokenizeBase(value);
  const expanded = [...base];
  for (const token of base) {
    const concept = CONCEPT_BY_TERM.get(token);
    if (concept) expanded.push(concept);
  }
  return Array.from(new Set(expanded));
}

function isConceptTerm(term: string): boolean {
  return term.startsWith('concept_');
}

function slug(value: string): string {
  return normalizeText(value).replace(/\s+/g, '_').slice(0, 80) || 'root';
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function splitSourceLines(raw: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let offset = 0;
  let number = 1;
  while (offset < raw.length) {
    const start = offset;
    while (offset < raw.length && raw[offset] !== '\n' && raw[offset] !== '\r') offset += 1;
    const end = offset;
    if (raw[offset] === '\r' && raw[offset + 1] === '\n') offset += 2;
    else if (offset < raw.length) offset += 1;
    lines.push({ number, text: raw.slice(start, end), start, end, after: offset });
    number += 1;
  }
  if (!lines.length && raw.length === 0) lines.push({ number: 1, text: '', start: 0, end: 0, after: 0 });
  return lines;
}

function classifyAtom(section: string, text: string): MemoryAtomKind {
  const normalizedSection = normalizeText(section);
  if (normalizedSection.includes('decision')) return 'decision';
  if (normalizedSection.includes('rule') || normalizedSection.includes('runbook')) return 'workflow_rule';
  if (normalizedSection.includes('long term') || normalizedSection.includes('continuity')) return 'continuity';
  if (/\b(?:decided|decision|agreed|chose|guardrail|direction|thesis|positioning)\b/i.test(text)) return 'decision';
  return 'project_fact';
}

function extractEntities(text: string): string[] {
  return ENTITY_ALIASES
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

function atomTags(section: string, text: string, kind: MemoryAtomKind): string[] {
  return Array.from(new Set([
    slug(section),
    kind,
    ...extractEntities(text),
    ...(text.match(/\b(?:20\d{2}-\d{2}-\d{2})\b/g) || []),
  ]));
}

function finalizeAtom(raw: string, lines: SourceLine[], startIndex: number, endIndex: number, section: string): MemoryAtom | null {
  if (startIndex < 0 || endIndex < startIndex || !section) return null;
  const first = lines[startIndex];
  const last = lines[endIndex];
  if (!first || !last || !/^\s*[-*+]\s+/.test(first.text)) return null;
  const rawText = raw.slice(first.start, last.end);
  if (!rawText.trim()) return null;
  const contentHash = hash(rawText);
  const kind = classifyAtom(section, rawText);
  const entities = extractEntities(rawText);
  return {
    id: `matom_${hash(`workspace/MEMORY.md:${first.number}-${last.number}:${contentHash}`)}`,
    sourcePath: 'workspace/MEMORY.md',
    sourceSection: section,
    sourceStartLine: first.number,
    sourceEndLine: last.number,
    rawText,
    contentHash,
    kind,
    authority: 'durable_memory_file',
    durability: 1,
    status: 'active',
    // Section labels remain available as metadata/tags and as a small positive
    // disambiguator during scoring, but they are not lexical atom content. A
    // query such as "project" must not match every bullet in project_memory.
    terms: tokenize(rawText),
    entities,
    tags: atomTags(section, rawText, kind),
  };
}

export function parseMemoryAtoms(raw: string): MemoryAtom[] {
  const source = String(raw || '');
  const lines = splitSourceLines(source);
  const atoms: MemoryAtom[] = [];
  let section = '';
  let startIndex = -1;
  let lastMeaningfulIndex = -1;

  const flush = () => {
    const atom = finalizeAtom(source, lines, startIndex, lastMeaningfulIndex, section);
    if (atom) {
      atoms.push(atom);
    }
    startIndex = -1;
    lastMeaningfulIndex = -1;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.text.match(/^#{2,6}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      section = heading[1].trim();
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line.text)) {
      flush();
      startIndex = index;
      lastMeaningfulIndex = index;
      continue;
    }

    if (startIndex >= 0 && line.text.trim()) lastMeaningfulIndex = index;
  }
  flush();
  return atoms;
}

function buildTermDocumentFrequency(atoms: MemoryAtom[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const atom of atoms) {
    for (const term of new Set(atom.terms)) counts.set(term, (counts.get(term) || 0) + 1);
  }
  return counts;
}

function loadSnapshot(workspacePath: string): { snapshot: AtomSnapshot; cacheHit: boolean } {
  const resolvedWorkspace = path.resolve(workspacePath);
  const memoryPath = path.join(resolvedWorkspace, 'MEMORY.md');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(memoryPath);
  } catch {
    const empty: AtomSnapshot = { mtimeMs: 0, size: 0, atoms: [], termDocumentFrequency: new Map() };
    return { snapshot: empty, cacheHit: false };
  }

  const cached = snapshotCache.get(resolvedWorkspace);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return { snapshot: cached, cacheHit: true };
  }

  const raw = fs.readFileSync(memoryPath, 'utf-8');
  const atoms = parseMemoryAtoms(raw);
  const snapshot: AtomSnapshot = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    atoms,
    termDocumentFrequency: buildTermDocumentFrequency(atoms),
  };
  snapshotCache.set(resolvedWorkspace, snapshot);
  while (snapshotCache.size > MAX_ATOM_CACHE_ENTRIES) {
    const oldest = snapshotCache.keys().next().value;
    if (!oldest) break;
    snapshotCache.delete(oldest);
  }
  return { snapshot, cacheHit: false };
}

export function invalidateMemoryAtomSnapshot(workspacePath: string): void {
  snapshotCache.delete(path.resolve(workspacePath));
}

export function warmMemoryAtomSnapshot(workspacePath: string): number {
  return loadSnapshot(workspacePath).snapshot.atoms.length;
}

function termWeight(term: string, documentFrequency: Map<string, number>, totalAtoms: number): number {
  const df = documentFrequency.get(term) || 0;
  const weight = Math.max(0.15, Math.log((totalAtoms + 1) / (df + 1)) + 0.2);
  // Concept terms exist to bridge paraphrases, not to outrank literal evidence.
  // Keeping them weaker than concrete tokens prevents one loose synonym from
  // turning every fact in a broad concept family into a direct match.
  return isConceptTerm(term) ? weight * 0.65 : weight;
}

function scoreAtom(
  atom: MemoryAtom,
  queryTerms: string[],
  queryText: string,
  documentFrequency: Map<string, number>,
  totalAtoms: number,
  additionalContext: string,
): { score: number; matchedTerms: string[] } {
  const atomTerms = new Set(atom.terms);
  const contextTerms = new Set(tokenize(`${queryText} ${additionalContext}`));
  const matchedTerms = queryTerms.filter((term) => atomTerms.has(term));
  const weightedQuery = queryTerms.reduce((sum, term) => sum + termWeight(term, documentFrequency, totalAtoms), 0);
  const weightedMatched = matchedTerms.reduce((sum, term) => sum + termWeight(term, documentFrequency, totalAtoms), 0);
  const lexical = weightedQuery ? weightedMatched / weightedQuery : 0;
  const entityMatches = atom.entities.filter((entity) => contextTerms.has(stem(entity))).length;
  const exactPhrase = normalizeText(atom.rawText).includes(normalizeText(queryText)) && normalizeText(queryText).length >= 12;
  const sectionMatch = tokenize(atom.sourceSection).some((term) => contextTerms.has(term));
  const score = Math.min(
    1,
    lexical * 0.72
      + Math.min(0.18, entityMatches * 0.09)
      + (exactPhrase ? 0.16 : 0)
      + (sectionMatch ? 0.04 : 0),
  );
  return { score, matchedTerms };
}

function isAmbiguousSingleTermQuery(
  baseQueryTerms: string[],
  expandedQueryTerms: string[],
  documentFrequency: Map<string, number>,
): boolean {
  if (baseQueryTerms.length !== 1) return false;
  // A literal token can be unique while its semantic concept is broad (for
  // example "launch" when many memories concern release/deploy/publish). Treat
  // that as ambiguous too; unique names without a concept alias remain usable.
  return expandedQueryTerms.some((term) => (documentFrequency.get(term) || 0) > 1);
}

function isRelationAnchorTerm(
  term: string,
  queryTerms: Set<string>,
  documentFrequency: Map<string, number>,
  rareDocumentFrequency: number,
): boolean {
  if (!term || isConceptTerm(term) || queryTerms.has(term)) return false;
  if (/^20\d{2}(?:\d{2})?(?:\d{2})?$/.test(term)) return false;
  return (documentFrequency.get(term) || 0) > 0 && (documentFrequency.get(term) || 0) <= rareDocumentFrequency;
}

export function retrieveMemoryAtoms(
  workspacePath: string,
  query: string,
  options: MemoryAtomReferenceOptions = {},
): MemoryAtomRetrievalResult {
  const startedAt = Date.now();
  const { snapshot, cacheHit } = loadSnapshot(workspacePath);
  const queryText = String(query || '').trim();
  const additionalContext = String(options.additionalContext || '').trim();
  // Score lexical relevance against the user's query only. Project/other
  // additional context is positive-only supporting context inside scoreAtom
  // (entity/section disambiguation); it must not dilute a direct memory match.
  const baseQueryTerms = tokenizeBase(queryText);
  const queryTerms = tokenize(queryText);
  if (!queryTerms.length || !snapshot.atoms.length) {
    return {
      direct: [],
      related: [],
      selected: [],
      stats: {
        atomCount: snapshot.atoms.length,
        directCandidates: 0,
        selectedCount: 0,
        durationMs: Date.now() - startedAt,
        cacheHit,
        sourceMtimeMs: snapshot.mtimeMs,
      },
    };
  }

  const scoredAll = snapshot.atoms
    .map((atom) => {
      const result = scoreAtom(atom, queryTerms, queryText, snapshot.termDocumentFrequency, snapshot.atoms.length, additionalContext);
      return { atom, ...result };
    })
    .sort((a, b) => b.score - a.score || a.atom.sourceStartLine - b.atom.sourceStartLine);

  // A one-word query that occurs across a durable topic family is not enough
  // evidence to decide which personal fact belongs in the prompt. Specific
  // one-word identifiers still work when they uniquely identify an atom.
  const directScored = isAmbiguousSingleTermQuery(baseQueryTerms, queryTerms, snapshot.termDocumentFrequency)
    ? []
    : scoredAll.filter((entry) => entry.matchedTerms.length > 0 && entry.score >= 0.13);

  const direct = directScored
    .filter((entry) => entry.score >= 0.16)
    .map((entry) => ({ ...entry, relation: 'direct' as const }));
  const directIds = new Set(direct.map((entry) => entry.atom.id));

  // Related recall is a second pass across ALL atoms, not just records that
  // already matched the query. Rare non-query terms from a direct hit become
  // anchors, so a query can recall one fact and then bring in a tightly linked
  // sibling fact (for example, another durable rule about the same project).
  const queryTermSet = new Set(queryTerms);
  const rareDocumentFrequency = Math.max(2, Math.ceil(snapshot.atoms.length * 0.06));
  const anchorTerms = new Set(direct.flatMap((entry) => entry.atom.terms.filter((term) =>
    isRelationAnchorTerm(term, queryTermSet, snapshot.termDocumentFrequency, rareDocumentFrequency),
  )));
  const anchorEntities = new Set(direct.flatMap((entry) => entry.atom.entities));
  const directSections = new Set(direct.map((entry) => entry.atom.sourceSection));
  const related = scoredAll
    .filter((entry) => !directIds.has(entry.atom.id))
    .map((entry) => {
      const sharedTerms = entry.atom.terms.filter((term) => anchorTerms.has(term));
      const sharedEntities = entry.atom.entities.filter((entity) => anchorEntities.has(entity));
      const sameSection = directSections.has(entry.atom.sourceSection);
      const relationReason = sharedEntities.length
        ? `shared_entity:${sharedEntities[0]}`
        : sharedTerms.length
          ? `shared_anchor_term:${sharedTerms[0]}`
          : undefined;
      const relationScore = relationReason
        ? Math.min(
          0.52,
          0.18
            + Math.min(0.20, sharedTerms.length * 0.07)
            + Math.min(0.18, sharedEntities.length * 0.10)
            + (sameSection ? 0.03 : 0),
        )
        : 0;
      return {
        ...entry,
        score: Math.min(1, relationScore + entry.score * 0.15),
        relation: 'related' as const,
        relationReason,
      };
    })
    .filter((entry) => entry.relationReason && entry.score >= 0.20)
    .sort((a, b) => b.score - a.score || a.atom.sourceStartLine - b.atom.sourceStartLine);

  const requestedMaxAtoms = Number(options.maxAtoms);
  const maxAtoms = Number.isFinite(requestedMaxAtoms) && requestedMaxAtoms > 0
    ? Math.max(1, Math.floor(requestedMaxAtoms))
    : Number.POSITIVE_INFINITY;
  const requestedMaxChars = Number(options.maxChars);
  const derivedMaxChars = Math.min(
    MAX_REFERENCE_CONTEXT_CHARS,
    Math.max(MIN_REFERENCE_CONTEXT_CHARS, snapshot.size * 2 + 8_000),
  );
  const maxChars = Number.isFinite(requestedMaxChars) && requestedMaxChars > 0
    ? Math.max(800, Math.floor(requestedMaxChars))
    : derivedMaxChars;
  const selected: MemoryAtomMatch[] = [];
  let selectedChars = 0;
  for (const entry of [...direct, ...related]) {
    if (selected.some((hit) => hit.atom.id === entry.atom.id)) continue;
    const cost = entry.atom.rawText.length + 180;
    if (selected.length >= maxAtoms || selectedChars + cost > maxChars) continue;
    selected.push(entry);
    selectedChars += cost;
  }

  return {
    direct,
    related,
    selected,
    stats: {
      atomCount: snapshot.atoms.length,
      directCandidates: directScored.length,
      selectedCount: selected.length,
      durationMs: Date.now() - startedAt,
      cacheHit,
      sourceMtimeMs: snapshot.mtimeMs,
    },
  };
}

export function buildMemoryAtomReferenceContext(
  workspacePath: string,
  query: string,
  options: MemoryAtomReferenceOptions = {},
): string {
  const result = retrieveMemoryAtoms(workspacePath, query, options);
  return formatMemoryAtomReferenceContext(result);
}

/**
 * Render a previously retrieved result without scanning MEMORY.md again.
 * Read-only telemetry surfaces use this to measure the exact same reference
 * text and selected direct/related atoms that the prompt compiler would use.
 */
export function formatMemoryAtomReferenceContext(result: MemoryAtomRetrievalResult): string {
  if (!result.selected.length) return '';
  const lines = [
    '[MEMORY_REFERENCE]',
    'Selected durable memory atoms from workspace/MEMORY.md. Preserve the cited meaning and prefer a directly matching atom over a weak association. The source file remains authoritative; use memory_read when the user asks for the complete file or exact historical evidence.',
    `atom_count=${result.selected.length} | source_atoms=${result.stats.atomCount}`,
  ];
  lines.push(formatMemoryAtomReferenceEntries(result.selected));
  return lines.join('\n');
}

/** Format only the cited atom entries, without the shared reference header. */
export function formatMemoryAtomReferenceEntries(matches: MemoryAtomMatch[]): string {
  const lines: string[] = [];
  for (const match of matches) {
    const atom = match.atom;
    lines.push(`atom=${atom.id} | kind=${atom.kind} | section=${atom.sourceSection} | source=${atom.sourcePath}:${atom.sourceStartLine}-${atom.sourceEndLine} | relation=${match.relation}${match.relationReason ? `:${match.relationReason}` : ''}`);
    lines.push(atom.rawText);
  }
  return lines.join('\n');
}

export function getMemoryAtomCacheStatus(): { workspaces: number; atoms: number } {
  let atoms = 0;
  for (const snapshot of snapshotCache.values()) atoms += snapshot.atoms.length;
  return { workspaces: snapshotCache.size, atoms };
}
