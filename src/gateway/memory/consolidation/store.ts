import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ConsolidationStore, MemoryClaim } from './types';

const VERSION = 1;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function consolidationPaths(workspacePath: string) {
  const root = path.join(workspacePath, 'audit', '_index', 'memory', 'consolidation');
  return {
    root,
    store: path.join(root, 'claims.json'),
    acceptedRoot: path.join(workspacePath, 'audit', 'memory', 'files', 'curated-claims'),
  };
}

export function claimId(input: string): string {
  return `claim_${crypto.createHash('sha1').update(input).digest('hex').slice(0, 16)}`;
}

export function readConsolidationStore(workspacePath: string): ConsolidationStore {
  const { store } = consolidationPaths(workspacePath);
  try {
    if (fs.existsSync(store)) return JSON.parse(fs.readFileSync(store, 'utf-8')) as ConsolidationStore;
  } catch {}
  return { version: VERSION, updatedAt: new Date(0).toISOString(), claims: {} };
}

export function writeConsolidationStore(workspacePath: string, store: ConsolidationStore): void {
  const paths = consolidationPaths(workspacePath);
  ensureDir(paths.root);
  fs.writeFileSync(paths.store, JSON.stringify({ ...store, version: VERSION, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
}

export function upsertClaims(workspacePath: string, claims: MemoryClaim[]): ConsolidationStore {
  const store = readConsolidationStore(workspacePath);
  for (const claim of claims) {
    const existing = store.claims[claim.id];
    if (existing?.status === 'accepted' || existing?.status === 'rejected') continue;
    store.claims[claim.id] = { ...existing, ...claim, status: existing?.status || claim.status };
  }
  writeConsolidationStore(workspacePath, store);
  return store;
}

export function writeAcceptedClaimDocument(workspacePath: string, claim: MemoryClaim): string {
  const { acceptedRoot } = consolidationPaths(workspacePath);
  ensureDir(acceptedRoot);
  const filename = `${claim.id}.md`;
  const relPath = `memory/files/curated-claims/${filename}`;
  const absPath = path.join(acceptedRoot, filename);
  const meta = {
    id: claim.id,
    title: claim.title,
    description: claim.summary,
    createdAt: claim.createdAt,
    projectId: claim.projectId || undefined,
    claimType: claim.type,
    canonicalKey: claim.canonicalKey,
    authority: claim.authority,
    sourceRefs: claim.sourceRefs,
  };
  const doc = [
    '<!-- PROMETHEUS_MEMORY_META',
    JSON.stringify(meta, null, 2),
    '-->',
    '',
    `# ${claim.title}`,
    '',
    claim.summary,
    '',
    `Type: ${claim.type}`,
    `Authority: ${claim.authority}`,
    `Canonical key: ${claim.canonicalKey}`,
    '',
    '## Memory',
    '',
    claim.body || claim.summary,
    '',
  ].join('\n');
  fs.writeFileSync(absPath, doc, 'utf-8');
  return relPath;
}
