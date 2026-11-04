import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveConfinedStoragePath } from '../storage/storage-paths';

export interface ArtifactFile {
  path: string; sha256: string; size: number; role: 'frame' | 'contact_sheet' | 'audio'; timestampSeconds?: number;
}
export interface AnalysisManifest {
  schemaVersion: 1; runId: string; createdAt: string;
  source: { path: string; sha256: string; size: number; modifiedAt: string };
  coverage: 'sampled_frames'; status: 'extracted' | 'complete';
  analysisPrompt?: string; files: ArtifactFile[];
  transcript: { available: boolean; text?: string; provider?: string | null };
  analysis?: string; observationMode: 'direct' | 'report';
  missing: string[];
}

export async function hashFile(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const part of fs.createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}

/** output_dir is a parent, never a request to overwrite a prior analysis run. */
export function createAnalysisRun(workspace: string, parent: string): { id: string; directory: string } {
  const id = crypto.randomUUID();
  const relativeParent = path.isAbsolute(parent) ? path.relative(workspace, parent) : parent;
  const directory = resolveConfinedStoragePath(workspace, path.join(relativeParent, id), { label: 'analysis run' });
  fs.mkdirSync(directory, { recursive: true });
  return { id, directory };
}

/** Preserve only actual outputs under this run. Do not trust analyzer-returned paths. */
export async function preserveAnalysisArtifacts(input: {
  workspace: string; directory: string; runId: string; sourcePath: string; sourceHash: string;
  frames: Array<{ path: string; timestampSeconds?: number }>; contactSheets: string[]; audioPath?: string; sourceSnapshot?: { size: number; mtimeMs: number };
  transcript?: string; transcriptionProvider?: string | null; analysisPrompt?: string; analysis?: string;
  observationMode: 'direct' | 'report'; status: 'extracted' | 'complete';
}): Promise<{ path: string; manifest: AnalysisManifest }> {
  const sourceRelative = path.isAbsolute(input.sourcePath) ? path.relative(input.workspace, input.sourcePath) : input.sourcePath;
  const sourcePath = resolveConfinedStoragePath(input.workspace, sourceRelative, { label: 'analysis source' });
  // Metadata check only (size+mtime recorded at the single hash); the strict full rehash stays in ReferenceService.saveAnalysis.
  if (input.sourceSnapshot) { const now = fs.statSync(sourcePath); if (now.size !== input.sourceSnapshot.size || now.mtimeMs !== input.sourceSnapshot.mtimeMs) throw new Error('Source changed during analysis; evidence cannot be bound to the original version'); }
  const sourceStat = fs.statSync(sourcePath);
  const files: ArtifactFile[] = []; const missing: string[] = [];
  const requested = [
    ...input.frames.map(item => ({ ...item, role: 'frame' as const })),
    ...input.contactSheets.map(item => ({ path: item, role: 'contact_sheet' as const, timestampSeconds: undefined })),
    ...(input.audioPath ? [{ path: input.audioPath, role: 'audio' as const, timestampSeconds: undefined }] : []),
  ];
  const seen = new Set<string>();
  for (const item of requested) {
    const outputRelative = path.isAbsolute(item.path) ? path.relative(input.directory, item.path) : item.path;
    const file = resolveConfinedStoragePath(input.directory, outputRelative, { label: 'analysis output' });
    if (seen.has(file)) continue;
    seen.add(file);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { missing.push(path.basename(file)); continue; }
    const stat = fs.statSync(file);
    files.push({ path: path.relative(input.workspace, file).replace(/\\/g, '/'), role: item.role,
      size: stat.size, sha256: await hashFile(file),
      ...(Number.isFinite(item.timestampSeconds) && Number(item.timestampSeconds) >= 0 ? { timestampSeconds: item.timestampSeconds } : {}),
    });
  }
  const manifest: AnalysisManifest = {
    schemaVersion: 1, runId: input.runId, createdAt: new Date().toISOString(),
    source: { path: path.relative(input.workspace, sourcePath).replace(/\\/g, '/'), sha256: input.sourceHash, size: sourceStat.size, modifiedAt: sourceStat.mtime.toISOString() },
    coverage: 'sampled_frames', status: input.status, observationMode: input.observationMode,
    analysisPrompt: input.analysisPrompt || undefined, files,
    transcript: { available: Boolean(input.transcript), text: input.transcript || undefined, provider: input.transcriptionProvider },
    analysis: input.analysis, missing,
  };
  const target = path.join(input.directory, `${input.status}.json`);
  const fd = fs.openSync(target, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(manifest, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { path: target, manifest };
}
