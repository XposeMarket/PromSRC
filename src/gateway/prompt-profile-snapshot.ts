import fs from 'node:fs';
import path from 'node:path';

type FileSnapshot = {
  mtimeMs: number;
  size: number;
  content: string;
};

type BlockSnapshot = {
  fingerprint: string;
  value: string;
  lastUsedAt: number;
};

const fileSnapshots = new Map<string, FileSnapshot>();
const blockSnapshots = new Map<string, BlockSnapshot>();
const MAX_BLOCK_SNAPSHOTS = 128;
let fileHits = 0;
let fileMisses = 0;
let blockHits = 0;
let blockMisses = 0;

export function readPromptProfileText(filePath: string): string {
  const resolved = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    fileSnapshots.delete(resolved);
    return '';
  }
  if (!stat.isFile()) return '';
  const cached = fileSnapshots.get(resolved);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    fileHits += 1;
    return cached.content;
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  fileSnapshots.set(resolved, { mtimeMs: stat.mtimeMs, size: stat.size, content });
  fileMisses += 1;
  return content;
}

export function memoizePromptProfileBlock(
  key: string,
  fingerprint: string,
  build: () => string,
): string {
  const id = String(key || '').trim();
  const cached = blockSnapshots.get(id);
  if (cached && cached.fingerprint === fingerprint) {
    cached.lastUsedAt = Date.now();
    blockHits += 1;
    return cached.value;
  }
  const value = build();
  blockSnapshots.set(id, { fingerprint, value, lastUsedAt: Date.now() });
  blockMisses += 1;
  if (blockSnapshots.size > MAX_BLOCK_SNAPSHOTS) {
    const oldest = [...blockSnapshots.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0]?.[0];
    if (oldest) blockSnapshots.delete(oldest);
  }
  return value;
}

export function getPromptProfileSnapshotStatus(): {
  files: number;
  blocks: number;
  fileHits: number;
  fileMisses: number;
  blockHits: number;
  blockMisses: number;
} {
  return {
    files: fileSnapshots.size,
    blocks: blockSnapshots.size,
    fileHits,
    fileMisses,
    blockHits,
    blockMisses,
  };
}

export function resetPromptProfileSnapshots(): void {
  fileSnapshots.clear();
  blockSnapshots.clear();
  fileHits = 0;
  fileMisses = 0;
  blockHits = 0;
  blockMisses = 0;
}
