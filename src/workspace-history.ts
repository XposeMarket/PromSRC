import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

export type WorkspaceSnapshotKind = 'missing' | 'file' | 'directory' | 'other';

export interface WorkspaceSnapshotRecord {
  id: string;
  createdAt: number;
  operation: string;
  workspacePath: string;
  targetPath: string;
  displayPath: string;
  existed: boolean;
  kind: WorkspaceSnapshotKind;
  sizeBytes: number;
  fileCount?: number;
  sha256?: string;
  capped?: boolean;
  contentPath?: string;
  manifestPath: string;
}

export interface WorkspaceSnapshotRef {
  id: string;
  operation?: string;
  targetPath?: string;
  displayPath?: string;
  existed?: boolean;
  kind?: WorkspaceSnapshotKind;
}

export interface WorkspaceTurnCheckpoint {
  id: string;
  createdAt: number;
  sessionId: string;
  workspacePath: string;
  summary: any;
  files: any[];
  snapshots: WorkspaceSnapshotRef[];
  restoreSnapshotIds: string[];
  toolCount: number;
  manifestPath: string;
}

const HISTORY_DIR = '.prometheus/history';
const MAX_FILE_BYTES = 250 * 1024 * 1024;
const MAX_DIRECTORY_BYTES = 250 * 1024 * 1024;
const MAX_DIRECTORY_FILES = 5000;

function safeIdPart(value: string, fallback = 'item'): string {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const base = normalizeForCompare(basePath);
  const target = normalizeForCompare(targetPath);
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function historyRoot(workspacePath: string): string {
  return path.join(path.resolve(workspacePath), HISTORY_DIR);
}

function displayPathFor(workspacePath: string, targetPath: string, explicit?: string): string {
  if (explicit) return String(explicit).replace(/\\/g, '/');
  try {
    const rel = path.relative(path.resolve(workspacePath), path.resolve(targetPath)).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  } catch {}
  return path.resolve(targetPath).replace(/\\/g, '/');
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
      if (bytesRead > 0) hash.update(buf.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function walkAndCopyDirectory(srcRoot: string, destRoot: string): { fileCount: number; sizeBytes: number; capped: boolean } {
  let fileCount = 0;
  let sizeBytes = 0;
  let capped = false;

  const walk = (dir: string): void => {
    if (capped) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (capped) return;
      const src = path.join(dir, entry.name);
      const rel = path.relative(srcRoot, src);
      if (!rel || rel.split(path.sep).includes('.git') || rel.replace(/\\/g, '/').startsWith(HISTORY_DIR)) continue;
      const dest = path.join(destRoot, rel);
      if (entry.isDirectory()) {
        walk(src);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(src);
      } catch {
        continue;
      }
      if (fileCount + 1 > MAX_DIRECTORY_FILES || sizeBytes + stat.size > MAX_DIRECTORY_BYTES) {
        capped = true;
        return;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      fileCount += 1;
      sizeBytes += stat.size;
    }
  };

  walk(path.resolve(srcRoot));
  return { fileCount, sizeBytes, capped };
}

export function createWorkspaceSnapshot(input: {
  workspacePath: string;
  targetPath: string;
  operation: string;
  displayPath?: string;
}): WorkspaceSnapshotRecord | null {
  try {
    const workspacePath = path.resolve(input.workspacePath);
    const targetPath = path.resolve(input.targetPath);
    const root = historyRoot(workspacePath);
    if (isPathInside(root, targetPath)) return null;

    const displayPath = displayPathFor(workspacePath, targetPath, input.displayPath);
    const id = `snap_${stamp()}_${safeIdPart(input.operation || 'op')}_${createHash('sha1').update(`${targetPath}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 10)}`;
    const snapshotDir = path.join(root, 'snapshots', id);
    const contentPath = path.join(snapshotDir, 'content');
    fs.mkdirSync(snapshotDir, { recursive: true });

    const exists = fs.existsSync(targetPath);
    const base: WorkspaceSnapshotRecord = {
      id,
      createdAt: Date.now(),
      operation: String(input.operation || 'mutation'),
      workspacePath,
      targetPath,
      displayPath,
      existed: exists,
      kind: 'missing',
      sizeBytes: 0,
      manifestPath: path.join(snapshotDir, 'manifest.json'),
    };

    if (!exists) {
      fs.writeFileSync(base.manifestPath, JSON.stringify(base, null, 2), 'utf-8');
      return base;
    }

    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
      const next: WorkspaceSnapshotRecord = {
        ...base,
        kind: 'file',
        sizeBytes: stat.size,
        sha256: stat.size <= MAX_FILE_BYTES ? sha256File(targetPath) : undefined,
        capped: stat.size > MAX_FILE_BYTES,
        contentPath,
      };
      if (!next.capped) fs.copyFileSync(targetPath, contentPath);
      fs.writeFileSync(next.manifestPath, JSON.stringify(next, null, 2), 'utf-8');
      return next;
    }

    if (stat.isDirectory()) {
      const result = walkAndCopyDirectory(targetPath, contentPath);
      const next: WorkspaceSnapshotRecord = {
        ...base,
        kind: 'directory',
        fileCount: result.fileCount,
        sizeBytes: result.sizeBytes,
        capped: result.capped,
        contentPath,
      };
      fs.writeFileSync(next.manifestPath, JSON.stringify(next, null, 2), 'utf-8');
      return next;
    }

    const next: WorkspaceSnapshotRecord = {
      ...base,
      kind: 'other',
      sizeBytes: stat.size,
      capped: true,
    };
    fs.writeFileSync(next.manifestPath, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  } catch (err: any) {
    console.warn('[workspace-history] snapshot failed:', err?.message || err);
    return null;
  }
}

export function toSnapshotRef(snapshot: WorkspaceSnapshotRecord | null | undefined): WorkspaceSnapshotRef | null {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    operation: snapshot.operation,
    targetPath: snapshot.targetPath,
    displayPath: snapshot.displayPath,
    existed: snapshot.existed,
    kind: snapshot.kind,
  };
}

export function collectSnapshotRefsFromToolResults(toolResults: any[] | undefined): WorkspaceSnapshotRef[] {
  const refs: WorkspaceSnapshotRef[] = [];
  for (const result of Array.isArray(toolResults) ? toolResults : []) {
    const sources = [result?.extra, result?.data, result].filter((source) => source && typeof source === 'object');
    for (const source of sources) {
      const values = [
        source.snapshot,
        source.workspaceSnapshot,
        source.workspace_snapshot,
        ...(Array.isArray(source.snapshots) ? source.snapshots : []),
        ...(Array.isArray(source.workspaceSnapshots) ? source.workspaceSnapshots : []),
        ...(Array.isArray(source.workspace_snapshots) ? source.workspace_snapshots : []),
      ];
      for (const value of values) {
        if (!value || typeof value !== 'object') continue;
        const id = String(value.id || value.snapshot_id || '').trim();
        if (!id) continue;
        refs.push({
          id,
          operation: value.operation ? String(value.operation) : undefined,
          targetPath: value.targetPath ? String(value.targetPath) : undefined,
          displayPath: value.displayPath ? String(value.displayPath) : undefined,
          existed: typeof value.existed === 'boolean' ? value.existed : undefined,
          kind: value.kind,
        });
      }
    }
  }
  return Array.from(new Map(refs.map((ref) => [ref.id, ref])).values());
}

export function createWorkspaceTurnCheckpoint(input: {
  workspacePath: string;
  sessionId: string;
  fileChanges: any;
  toolResults?: any[];
}): WorkspaceTurnCheckpoint | null {
  try {
    const snapshots = collectSnapshotRefsFromToolResults(input.toolResults);
    const files = Array.isArray(input.fileChanges?.files) ? input.fileChanges.files : [];
    if (!files.length || !snapshots.length) return null;

    const firstByTarget = new Map<string, WorkspaceSnapshotRef>();
    for (const snapshot of snapshots) {
      const key = String(snapshot.targetPath || snapshot.displayPath || snapshot.id);
      if (!firstByTarget.has(key)) firstByTarget.set(key, snapshot);
    }

    const id = `turn_${stamp()}_${safeIdPart(input.sessionId || 'default')}_${createHash('sha1').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 8)}`;
    const root = historyRoot(input.workspacePath);
    const checkpointDir = path.join(root, 'checkpoints');
    fs.mkdirSync(checkpointDir, { recursive: true });
    const manifestPath = path.join(checkpointDir, `${id}.json`);
    const checkpoint: WorkspaceTurnCheckpoint = {
      id,
      createdAt: Date.now(),
      sessionId: String(input.sessionId || 'default'),
      workspacePath: path.resolve(input.workspacePath),
      summary: input.fileChanges?.summary || {},
      files,
      snapshots,
      restoreSnapshotIds: Array.from(firstByTarget.values()).map((snapshot) => snapshot.id),
      toolCount: Array.isArray(input.toolResults) ? input.toolResults.length : 0,
      manifestPath,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    return checkpoint;
  } catch (err: any) {
    console.warn('[workspace-history] checkpoint failed:', err?.message || err);
    return null;
  }
}

export function attachWorkspaceCheckpoint(fileChanges: any, checkpoint: WorkspaceTurnCheckpoint | null): any {
  if (!fileChanges || !checkpoint) return fileChanges;
  return {
    ...fileChanges,
    checkpoint: {
      id: checkpoint.id,
      createdAt: checkpoint.createdAt,
      snapshotCount: checkpoint.snapshots.length,
      restoreSnapshotIds: checkpoint.restoreSnapshotIds,
      path: path.relative(checkpoint.workspacePath, checkpoint.manifestPath).replace(/\\/g, '/'),
    },
  };
}

function findSnapshotManifest(workspacePath: string, snapshotId: string): string | null {
  const direct = path.join(historyRoot(workspacePath), 'snapshots', snapshotId, 'manifest.json');
  if (fs.existsSync(direct)) return direct;
  return null;
}

function findCheckpointManifest(workspacePath: string, checkpointId: string): string | null {
  const direct = path.join(historyRoot(workspacePath), 'checkpoints', `${checkpointId}.json`);
  if (fs.existsSync(direct)) return direct;
  return null;
}

export function listWorkspaceHistory(workspacePath: string): Array<{ id: string; kind: 'checkpoint' | 'snapshot'; createdAt: number; path: string }> {
  const root = historyRoot(workspacePath);
  const rows: Array<{ id: string; kind: 'checkpoint' | 'snapshot'; createdAt: number; path: string }> = [];
  const checkpointDir = path.join(root, 'checkpoints');
  if (fs.existsSync(checkpointDir)) {
    for (const entry of fs.readdirSync(checkpointDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const manifestPath = path.join(checkpointDir, entry.name);
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        rows.push({ id: String(raw.id || entry.name.replace(/\.json$/, '')), kind: 'checkpoint', createdAt: Number(raw.createdAt || 0), path: manifestPath });
      } catch {}
    }
  }
  const snapshotDir = path.join(root, 'snapshots');
  if (fs.existsSync(snapshotDir)) {
    for (const entry of fs.readdirSync(snapshotDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(snapshotDir, entry.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        rows.push({ id: String(raw.id || entry.name), kind: 'snapshot', createdAt: Number(raw.createdAt || 0), path: manifestPath });
      } catch {}
    }
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export function restoreWorkspaceSnapshot(workspacePath: string, snapshotId: string, options: { dryRun?: boolean } = {}): {
  ok: boolean;
  restored: string[];
  deleted: string[];
  error?: string;
  preview?: any;
} {
  try {
    const manifestPath = findSnapshotManifest(workspacePath, snapshotId);
    if (!manifestPath) return { ok: false, restored: [], deleted: [], error: `snapshot not found: ${snapshotId}` };
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as WorkspaceSnapshotRecord;
    const preview = {
      id: manifest.id,
      operation: manifest.operation,
      targetPath: manifest.targetPath,
      displayPath: manifest.displayPath,
      existed: manifest.existed,
      kind: manifest.kind,
      capped: manifest.capped === true,
    };
    if (options.dryRun) return { ok: true, restored: [], deleted: [], preview };
    if (manifest.capped) return { ok: false, restored: [], deleted: [], error: `snapshot ${snapshotId} is capped and cannot be safely restored automatically` };

    const targetPath = path.resolve(manifest.targetPath);
    if (!manifest.existed) {
      if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
      return { ok: true, restored: [], deleted: [targetPath] };
    }

    if (!manifest.contentPath || !fs.existsSync(manifest.contentPath)) {
      return { ok: false, restored: [], deleted: [], error: `snapshot content missing: ${snapshotId}` };
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (manifest.kind === 'directory') {
      fs.rmSync(targetPath, { recursive: true, force: true });
      fs.cpSync(manifest.contentPath, targetPath, { recursive: true });
    } else {
      fs.copyFileSync(manifest.contentPath, targetPath);
    }
    return { ok: true, restored: [targetPath], deleted: [] };
  } catch (err: any) {
    return { ok: false, restored: [], deleted: [], error: err?.message || String(err) };
  }
}

export function restoreWorkspaceCheckpoint(workspacePath: string, checkpointId: string, options: { dryRun?: boolean } = {}): {
  ok: boolean;
  restored: string[];
  deleted: string[];
  error?: string;
  preview?: any;
} {
  try {
    const manifestPath = findCheckpointManifest(workspacePath, checkpointId);
    if (!manifestPath) return { ok: false, restored: [], deleted: [], error: `checkpoint not found: ${checkpointId}` };
    const checkpoint = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as WorkspaceTurnCheckpoint;
    const ids = Array.isArray(checkpoint.restoreSnapshotIds) ? checkpoint.restoreSnapshotIds : [];
    const preview = {
      id: checkpoint.id,
      fileCount: checkpoint.files?.length || 0,
      snapshotCount: ids.length,
      files: (checkpoint.files || []).map((file: any) => file.displayPath || file.path).slice(0, 200),
      truncated: (checkpoint.files?.length || 0) > 200,
    };
    if (options.dryRun) return { ok: true, restored: [], deleted: [], preview };
    const restored: string[] = [];
    const deleted: string[] = [];
    for (const id of ids.slice().reverse()) {
      const result = restoreWorkspaceSnapshot(workspacePath, id);
      if (!result.ok) return { ok: false, restored, deleted, error: result.error || `restore failed for ${id}` };
      restored.push(...result.restored);
      deleted.push(...result.deleted);
    }
    return { ok: true, restored, deleted };
  } catch (err: any) {
    return { ok: false, restored: [], deleted: [], error: err?.message || String(err) };
  }
}
