import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

import { getConfig } from '../../config/config';
import { findProjectBySessionId } from '../projects/project-store';
import { listProposals } from '../proposals/proposal-store';
import { getSession, sessionExists } from '../session';
import { listTaskSummaries } from '../tasks/task-store';
import { getProcessSupervisor } from '../process/supervisor';
import { getCodingRepositorySnapshot, resolveCodingRoot } from './workspace-session';

export type CodingScope = 'thread' | 'project';
export type CodingBaselineKind = 'git-head' | 'git-index' | 'turn-snapshot' | 'session-snapshot' | 'none';
export type CodingFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'observed';

export interface CodingWorkspaceFile {
  id: string;
  path: string;
  displayPath: string;
  repoRoot?: string;
  status: CodingFileStatus;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  insertions: number;
  deletions: number;
  binary?: boolean;
  baselineKind: CodingBaselineKind;
  baselineId?: string;
  updatedAt?: number;
  sizeBytes?: number;
}

export interface CodingWorkspaceRoot {
  id: string;
  root: string;
  label: string;
  source: 'project' | 'thread' | 'file';
  repository: any;
  files: CodingWorkspaceFile[];
}

export interface CodingWorkItem {
  id: string;
  type: 'task' | 'proposal' | 'subagent';
  title: string;
  status: string;
  createdAt?: number;
  updatedAt?: number;
  sessionId?: string;
  originatingSessionId?: string;
  parentId?: string;
  agentId?: string;
}

export interface CodingWorkspaceContext {
  sessionId?: string;
  projectId?: string;
  scope: CodingScope;
  root: string;
  roots: CodingWorkspaceRoot[];
  repositories: any[];
  files: CodingWorkspaceFile[];
  work: CodingWorkItem[];
  counts: {
    files: number;
    staged: number;
    unstaged: number;
    untracked: number;
    repositories: number;
  };
  baseline: { kind: CodingBaselineKind; label: string };
  generatedAt: number;
}

function relatedWork(sessionId?: string): CodingWorkItem[] {
  const sid = String(sessionId || '').trim();
  if (!sid) return [];
  const cached = relatedWorkCache.get(sid);
  if (cached && Date.now() - cached.at < 750) return cached.items;
  const summaries = listTaskSummaries({ limit: 500 });
  const directTaskIds = new Set(summaries
    .filter((task) => String(task.sessionId || '') === sid || String(task.originatingSessionId || '') === sid)
    .map((task) => task.id));
  const linkedTaskIds = new Set(directTaskIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const task of summaries) {
      const parentId = String(task.parentTaskId || '').trim();
      if (parentId && linkedTaskIds.has(parentId) && !linkedTaskIds.has(task.id)) {
        linkedTaskIds.add(task.id);
        expanded = true;
      }
    }
  }
  const work: CodingWorkItem[] = [];
  for (const task of summaries) {
    if (!linkedTaskIds.has(task.id)) continue;
    const agentId = String(task.subagentProfile || task.teamSubagent?.agentId || '').trim() || undefined;
    work.push({
      id: task.id,
      type: agentId ? 'subagent' : 'task',
      title: String(task.title || 'Background task').trim(),
      status: String(task.status || 'unknown'),
      createdAt: Number(task.startedAt || 0) || undefined,
      updatedAt: Number(task.completedAt || task.lastProgressAt || task.startedAt || 0) || undefined,
      sessionId: task.sessionId,
      originatingSessionId: task.originatingSessionId,
      ...(task.parentTaskId ? { parentId: task.parentTaskId } : {}),
      ...(agentId ? { agentId } : {}),
    });
  }
  for (const proposal of listProposals()) {
    const teamOrigin = String(proposal.teamExecution?.originatingSessionId || '').trim();
    if (String(proposal.sourceSessionId || '') !== sid && teamOrigin !== sid) continue;
    work.push({
      id: proposal.id,
      type: 'proposal',
      title: String(proposal.title || 'Proposal').trim(),
      status: String(proposal.status || 'unknown'),
      createdAt: Number(proposal.createdAt || 0) || undefined,
      updatedAt: Number(proposal.updatedAt || proposal.createdAt || 0) || undefined,
      sessionId: proposal.sourceSessionId,
      originatingSessionId: teamOrigin || undefined,
    });
  }
  const items = work.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)).slice(0, 100);
  relatedWorkCache.set(sid, { at: Date.now(), items });
  return items;
}

export interface CodingWorkspaceDiff {
  root: string;
  file: string;
  displayPath: string;
  view: 'working' | 'staged' | 'turn';
  baselineKind: CodingBaselineKind;
  baselineId?: string;
  status: CodingFileStatus;
  insertions: number;
  deletions: number;
  binary?: boolean;
  diff: string;
}

const MAX_CONTEXT_FILES = 500;
const MAX_TREE_ENTRIES = 300;
const MAX_DIFF_BYTES = 8 * 1024 * 1024;
const SKIPPED_TREE_DIRS = new Set([
  '.git',
  '.prometheus',
  'node_modules',
  '.next',
  '.turbo',
  'coverage',
]);
const relatedWorkCache = new Map<string, { at: number; items: CodingWorkItem[] }>();

function normalized(value: string): string {
  return path.resolve(String(value || '')).replace(/\\/g, '/');
}

function comparePath(value: string): string {
  const result = normalized(value);
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(comparePath(root), comparePath(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function displayPath(root: string, filePath: string): string {
  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : filePath.replace(/\\/g, '/');
}

function safeRoot(rawRoot?: string): string {
  return resolveCodingRoot(rawRoot);
}

function runGit(root: string, args: string[], maxBuffer = MAX_DIFF_BYTES): string {
  try {
    return String(execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer,
      timeout: 15_000,
    }) || '');
  } catch (err: any) {
    // `git diff --no-index` exits with 1 when differences exist. Preserve its
    // stdout so the caller can still render the patch.
    return typeof err?.stdout === 'string' ? err.stdout : '';
  }
}

function startPathFor(candidate: string): string {
  let current = path.resolve(candidate);
  try {
    if (fs.existsSync(current) && fs.statSync(current).isFile()) return path.dirname(current);
    if (fs.existsSync(current)) return current;
  } catch {}
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function findCodingGitRoot(candidate: string): string | null {
  const start = startPathFor(candidate);
  const value = runGit(start, ['rev-parse', '--show-toplevel'], 256 * 1024).trim();
  return value ? path.resolve(value) : null;
}

function fileContent(filePath: string): Buffer | null {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_DIFF_BYTES) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function isBinary(buffer: Buffer | null): boolean {
  return !!buffer && buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function parseDiffStats(diff: string): { insertions: number; deletions: number; binary: boolean } {
  let insertions = 0;
  let deletions = 0;
  let binary = false;
  for (const line of String(diff || '').split(/\r?\n/)) {
    if (/^Binary files /.test(line)) binary = true;
    else if (line.startsWith('+') && !line.startsWith('+++')) insertions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { insertions, deletions, binary };
}

function makeNoIndexDiff(display: string, before: Buffer | null, after: Buffer | null): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-coding-diff-'));
  const beforePath = path.join(tempRoot, 'before');
  const afterPath = path.join(tempRoot, 'after');
  try {
    if (before) fs.writeFileSync(beforePath, before);
    if (after) fs.writeFileSync(afterPath, after || Buffer.alloc(0));
    const diff = runGit(tempRoot, [
      '-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-ext-diff', '--no-color', '--unified=3',
      '--', before ? beforePath : '/dev/null', after ? afterPath : '/dev/null',
    ]);
    const lines = String(diff || '').replace(/\r\n/g, '\n').split('\n');
    const normalizedLines = lines
      .filter((line) => !line.startsWith('diff --git ') && !line.startsWith('index '))
      .map((line) => {
        if (line.startsWith('--- ')) return `--- a/${display}`;
        if (line.startsWith('+++ ')) return `+++ b/${display}`;
        return line;
      });
    return normalizedLines.filter((line, index) => line || index < normalizedLines.length - 1).join('\n').trimEnd() + '\n';
  } finally {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
}

function parseStatus(root: string): Array<{ path: string; status: CodingFileStatus; staged: boolean; unstaged: boolean; untracked: boolean; oldPath?: string }> {
  const rows: Array<{ path: string; status: CodingFileStatus; staged: boolean; unstaged: boolean; untracked: boolean; oldPath?: string }> = [];
  const raw = runGit(root, ['status', '--porcelain=v1', '--untracked-files=all'], 2 * 1024 * 1024);
  for (const line of raw.split(/\r?\n/).map((item) => item.trimEnd()).filter(Boolean)) {
    const indexStatus = line.slice(0, 1);
    const worktreeStatus = line.slice(1, 2);
    let display = line.slice(3).trim();
    let oldPath: string | undefined;
    if (display.includes(' -> ')) {
      const parts = display.split(' -> ');
      oldPath = parts[0].trim();
      display = parts[parts.length - 1].trim();
    }
    if (!display) continue;
    const untracked = indexStatus === '?' && worktreeStatus === '?';
    const status: CodingFileStatus = untracked || indexStatus === 'A' || worktreeStatus === 'A'
      ? 'added'
      : indexStatus === 'D' || worktreeStatus === 'D'
        ? 'deleted'
        : indexStatus === 'R' || worktreeStatus === 'R'
          ? 'renamed'
          : 'modified';
    rows.push({
      path: display.replace(/\\/g, '/'),
      status,
      staged: !untracked && indexStatus !== ' ' && indexStatus !== '?',
      unstaged: !untracked && worktreeStatus !== ' ',
      untracked,
      ...(oldPath ? { oldPath } : {}),
    });
  }
  return rows;
}

function readSessionFileChanges(sessionId: string, workspaceRoot: string): Array<{ path: string; displayPath: string; updatedAt: number; status?: CodingFileStatus; insertions?: number; deletions?: number; baselineId?: string; baselineKind?: CodingBaselineKind; diffPreview?: string }> {
  if (!sessionId || !sessionExists(sessionId)) return [];
  const session = getSession(sessionId);
  const rows: Array<{ path: string; displayPath: string; updatedAt: number; status?: CodingFileStatus; insertions?: number; deletions?: number; baselineId?: string; baselineKind?: CodingBaselineKind; diffPreview?: string }> = [];
  for (const message of Array.isArray(session.history) ? session.history : []) {
    const payload = message?.fileChanges;
    for (const file of Array.isArray(payload?.files) ? payload.files : []) {
      const raw = String(file?.path || file?.absPath || file?.displayPath || '').trim();
      if (!raw) continue;
      const absolute = path.resolve(path.isAbsolute(raw) ? raw : path.join(session.workspace || workspaceRoot, raw));
      rows.push({
        path: absolute,
        displayPath: String(file?.displayPath || displayPath(workspaceRoot, absolute)).replace(/\\/g, '/'),
        updatedAt: Number(payload?.generatedAt || message?.timestamp || 0),
        status: file?.status,
        insertions: Number(file?.insertions || 0),
        deletions: Number(file?.deletions || 0),
        baselineKind: file?.baselineKind,
        baselineId: String(file?.baselineId || file?.snapshotId || '').trim() || undefined,
        diffPreview: String(file?.diffPreview || '').trim() || undefined,
      });
    }
  }
  try {
    for (const run of getProcessSupervisor().list(500)) {
      if (String(run.sessionId || '').trim() !== sessionId) continue;
      const changes = Array.isArray(run.workspaceChanges) ? run.workspaceChanges : [];
      for (const file of changes) {
        const raw = String(file?.path || file?.absPath || file?.displayPath || '').trim();
        if (!raw) continue;
        const absolute = path.resolve(path.isAbsolute(raw) ? raw : path.join(run.workspacePath || workspaceRoot, raw));
        if (!isInside(workspaceRoot, absolute)) continue;
        rows.push({
          path: absolute,
          displayPath: String(file?.displayPath || displayPath(workspaceRoot, absolute)).replace(/\\/g, '/'),
          updatedAt: Number(run.completedAt ? Date.parse(run.completedAt) : Date.parse(run.updatedAt || run.startedAt || '')) || Date.now(),
          status: String(file?.status || '').trim() as CodingFileStatus || undefined,
          insertions: Number(file?.insertions || 0),
          deletions: Number(file?.deletions || 0),
          baselineKind: String(file?.baselineKind || '').trim() as CodingBaselineKind || undefined,
          baselineId: String(file?.baselineId || '').trim() || undefined,
          diffPreview: String(file?.diffPreview || '').trim() || undefined,
        });
      }
    }
  } catch {}
  return Array.from(new Map(rows.map((row) => [comparePath(row.path), row])).values());
}

function readSnapshotManifest(workspaceRoot: string, snapshotId: string, targetPath?: string): any | null {
  if (!snapshotId || !workspaceRoot) return null;
  const candidates = [path.resolve(workspaceRoot)];
  if (targetPath) {
    let current = path.dirname(path.resolve(targetPath));
    while (true) {
      if (!candidates.some((candidate) => comparePath(candidate) === comparePath(current))) candidates.push(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  for (const candidate of candidates) {
    const manifest = path.join(candidate, '.prometheus', 'history', 'snapshots', snapshotId, 'manifest.json');
    try { return JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch {}
  }
  return null;
}

function findLatestSnapshot(workspaceRoot: string, targetPath: string, preferredId?: string): any | null {
  const forTarget = (manifest: any): any | null => {
    if (!manifest) return null;
    if (comparePath(manifest.targetPath) === comparePath(targetPath)) return manifest;
    if (manifest.kind !== 'directory' || !manifest.contentPath || !isInside(manifest.targetPath, targetPath)) return null;
    const relative = path.relative(manifest.targetPath, targetPath);
    const contentPath = path.join(manifest.contentPath, relative);
    const existed = fs.existsSync(contentPath);
    return {
      ...manifest,
      targetPath,
      displayPath: displayPath(workspaceRoot, targetPath),
      existed,
      kind: 'file',
      contentPath,
      capped: manifest.capped === true,
    };
  };
  if (preferredId) {
    const direct = readSnapshotManifest(workspaceRoot, preferredId, targetPath);
    const preferred = forTarget(direct);
    if (preferred) return preferred;
  }
  const snapshotRoot = path.join(workspaceRoot, '.prometheus', 'history', 'snapshots');
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(snapshotRoot, { withFileTypes: true }); } catch { return null; }
  const candidates: any[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(snapshotRoot, entry.name, 'manifest.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const candidate = forTarget(manifest);
      if (candidate) candidates.push(candidate);
    } catch {}
  }
  return candidates.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] || null;
}

function snapshotBeforeContent(manifest: any): Buffer | null {
  if (!manifest || manifest.kind !== 'file' || manifest.capped || !manifest.contentPath) return null;
  try { return fs.readFileSync(manifest.contentPath); } catch { return null; }
}

function makeFileId(root: string, filePath: string): string {
  return `${comparePath(root)}:${comparePath(filePath)}`;
}

function fileRecord(input: {
  root: string;
  repoRoot?: string;
  path: string;
  status: CodingFileStatus;
  staged?: boolean;
  unstaged?: boolean;
  untracked?: boolean;
  insertions?: number;
  deletions?: number;
  binary?: boolean;
  baselineKind?: CodingBaselineKind;
  baselineId?: string;
  updatedAt?: number;
}): CodingWorkspaceFile {
  let sizeBytes: number | undefined;
  try { sizeBytes = fs.statSync(input.path).size; } catch {}
  return {
    id: makeFileId(input.root, input.path),
    path: input.path,
    displayPath: displayPath(input.root, input.path),
    ...(input.repoRoot ? { repoRoot: input.repoRoot } : {}),
    status: input.status,
    staged: input.staged === true,
    unstaged: input.unstaged === true,
    untracked: input.untracked === true,
    insertions: Math.max(0, Number(input.insertions || 0)),
    deletions: Math.max(0, Number(input.deletions || 0)),
    ...(input.binary ? { binary: true } : {}),
    baselineKind: input.baselineKind || (input.repoRoot ? 'git-head' : 'none'),
    ...(input.baselineId ? { baselineId: input.baselineId } : {}),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
  };
}

function changedFilesForRoot(root: string, repoRoot: string | null, historyFiles: ReturnType<typeof readSessionFileChanges>, scope: CodingScope, requestedPaths: string[] = []): CodingWorkspaceFile[] {
  const selectedHistory = historyFiles.filter((file) => isInside(root, file.path));
  const statusRows = repoRoot ? parseStatus(repoRoot) : [];
  const selectedPaths = scope === 'thread'
    ? new Set([
      ...selectedHistory.map((file) => comparePath(file.path)),
      ...requestedPaths.filter((file) => isInside(root, file)).map((file) => comparePath(file)),
    ])
    : null;
  const output = new Map<string, CodingWorkspaceFile>();

  for (const status of statusRows) {
    const absolute = path.resolve(repoRoot!, status.path);
    if (selectedPaths && !selectedPaths.has(comparePath(absolute))) continue;
    const history = selectedHistory.find((file) => comparePath(file.path) === comparePath(absolute));
    const baseline = status.staged && !status.unstaged ? 'git-index' : 'git-head';
    const record = fileRecord({
      root,
      repoRoot: repoRoot || undefined,
      path: absolute,
      status: status.status,
      staged: status.staged,
      unstaged: status.unstaged || status.untracked,
      untracked: status.untracked,
      insertions: history?.insertions,
      deletions: history?.deletions,
      baselineKind: history?.baselineKind || baseline,
      baselineId: history?.baselineId,
      updatedAt: history?.updatedAt,
    });
    output.set(comparePath(absolute), record);
  }

  for (const history of selectedHistory) {
    if (output.has(comparePath(history.path))) continue;
    if (!fs.existsSync(history.path) && !history.status) continue;
    output.set(comparePath(history.path), fileRecord({
      root,
      repoRoot: repoRoot || undefined,
      path: history.path,
      status: history.status || (fs.existsSync(history.path) ? 'observed' : 'deleted'),
      insertions: history.insertions,
      deletions: history.deletions,
      baselineKind: history.baselineKind || (history.baselineId ? 'turn-snapshot' : 'none'),
      baselineId: history.baselineId,
      updatedAt: history.updatedAt,
    }));
  }

  if (!repoRoot) {
    for (const requestedPath of requestedPaths.filter((file) => isInside(root, file))) {
      if (output.has(comparePath(requestedPath)) || !fs.existsSync(requestedPath)) continue;
      output.set(comparePath(requestedPath), fileRecord({
        root,
        path: requestedPath,
        status: 'observed',
        baselineKind: 'none',
      }));
    }
  }

  return Array.from(output.values()).sort((a, b) => a.displayPath.localeCompare(b.displayPath));
}

function rootForSession(sessionId: string | undefined, scope: CodingScope, rawRoot?: string): { root: string; projectId?: string } {
  const sid = String(sessionId || '').trim();
  const project = sid ? findProjectBySessionId(sid) : null;
  const session = sid && sessionExists(sid) ? getSession(sid) : null;
  const projectRoot = String(project?.workspacePath || '').trim();
  const selected = String(rawRoot || '').trim();
  if (selected) return { root: safeRoot(selected), projectId: project?.id };
  if (scope === 'project' && projectRoot) return { root: safeRoot(projectRoot), projectId: project?.id };
  if (projectRoot) return { root: safeRoot(projectRoot), projectId: project?.id };
  const canvasRoot = String(session?.canvasProjectRoot || '').trim();
  if (canvasRoot) return { root: safeRoot(canvasRoot) };
  return { root: safeRoot(String(session?.workspace || getConfig().getWorkspacePath() || '')) };
}

function collectRoots(baseRoot: string, historyFiles: ReturnType<typeof readSessionFileChanges>, scope: CodingScope, explicitPaths: string[]): Array<{ root: string; source: 'project' | 'thread' | 'file' }> {
  const paths = Array.from(new Set([
    ...historyFiles.map((file) => file.path),
    ...explicitPaths.map((value) => path.resolve(value)),
  ].filter(Boolean)));
  if (!paths.length) return [{ root: baseRoot, source: scope === 'project' ? 'project' : 'thread' }];
  const roots = new Map<string, { root: string; source: 'project' | 'thread' | 'file' }>();
  if (scope === 'project') roots.set(comparePath(baseRoot), { root: baseRoot, source: 'project' });
  for (const filePath of paths) {
    const repoRoot = findCodingGitRoot(filePath);
    const selected = repoRoot || (isInside(baseRoot, filePath) ? baseRoot : path.dirname(filePath));
    if (!roots.has(comparePath(selected))) roots.set(comparePath(selected), { root: selected, source: repoRoot ? 'thread' : 'file' });
  }
  return Array.from(roots.values());
}

export function getCodingWorkspaceContext(input: { sessionId?: string; scope?: CodingScope; root?: string; paths?: string[] }): CodingWorkspaceContext {
  const scope: CodingScope = input.scope === 'project' ? 'project' : 'thread';
  const resolved = rootForSession(input.sessionId, scope, input.root);
  const historyFiles = input.sessionId ? readSessionFileChanges(input.sessionId, resolved.root) : [];
  const explicitPaths = (Array.isArray(input.paths) ? input.paths : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => path.resolve(path.isAbsolute(value) ? value : path.join(resolved.root, value)));
  const sid = String(input.sessionId || '').trim();
  const session = sid && sessionExists(sid) ? getSession(sid) : null;
  const project = sid ? findProjectBySessionId(sid) : null;
  const configuredRoot = safeRoot(getConfig().getWorkspacePath());
  const sessionWorkspace = String(session?.workspace || '').trim();
  const hasScopedRoot = Boolean(
    String(input.root || '').trim()
    || String(project?.workspacePath || '').trim()
    || String(session?.canvasProjectRoot || '').trim()
    || (sessionWorkspace && comparePath(sessionWorkspace) !== comparePath(configuredRoot)),
  );
  if (scope === 'thread' && !hasScopedRoot && !historyFiles.length && !explicitPaths.length) {
    return {
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(resolved.projectId ? { projectId: resolved.projectId } : {}),
      scope,
      root: '',
      roots: [],
      repositories: [],
      files: [],
      work: relatedWork(input.sessionId),
      counts: { files: 0, staged: 0, unstaged: 0, untracked: 0, repositories: 0 },
      baseline: { kind: 'none', label: 'No workspace selected' },
      generatedAt: Date.now(),
    };
  }
  const roots = collectRoots(resolved.root, historyFiles, scope, explicitPaths);
  const contextRoots: CodingWorkspaceRoot[] = [];
  for (const item of roots.slice(0, 12)) {
    const root = path.resolve(item.root);
    const repoRoot = findCodingGitRoot(root);
    const repository = getCodingRepositorySnapshot(repoRoot || root);
    const files = changedFilesForRoot(root, repoRoot, historyFiles, scope, explicitPaths);
    contextRoots.push({
      id: comparePath(root),
      root,
      label: path.basename(root) || root,
      source: item.source,
      repository: {
        ...repository,
        vcs: { kind: repoRoot ? 'git' : 'none', remoteConnected: Boolean(repository.remoteUrl) },
      },
      files,
    });
  }
  const sortedRoots = contextRoots.sort((a, b) => {
    const fileDelta = b.files.length - a.files.length;
    if (fileDelta) return fileDelta;
    if (a.source === 'thread' && b.source !== 'thread') return -1;
    if (b.source === 'thread' && a.source !== 'thread') return 1;
    return a.root.localeCompare(b.root);
  });
  const files = sortedRoots.flatMap((item) => item.files).slice(0, MAX_CONTEXT_FILES);
  const repositories = sortedRoots.map((item) => item.repository).filter((repository) => repository?.vcs?.kind === 'git');
  const primary = sortedRoots[0];
  const staged = files.filter((file) => file.staged).length;
  const unstaged = files.filter((file) => file.unstaged).length;
  const untracked = files.filter((file) => file.untracked).length;
  const hasSnapshot = files.some((file) => file.baselineKind === 'turn-snapshot' || file.baselineKind === 'session-snapshot');
  return {
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(resolved.projectId ? { projectId: resolved.projectId } : {}),
    scope,
    root: primary?.root || resolved.root,
    roots: sortedRoots,
    repositories,
    files,
    work: relatedWork(input.sessionId),
    counts: { files: files.length, staged, unstaged, untracked, repositories: repositories.length },
    baseline: {
      kind: repositories.length ? 'git-head' : hasSnapshot ? 'turn-snapshot' : 'none',
      label: repositories.length ? 'Git working tree' : hasSnapshot ? 'Prometheus snapshot' : 'No baseline',
    },
    generatedAt: Date.now(),
  };
}

function resolveFile(root: string, rawFile: string): string {
  const candidate = path.resolve(path.isAbsolute(rawFile) ? rawFile : path.join(root, rawFile));
  if (!isInside(root, candidate)) throw new Error('File is outside the selected coding workspace');
  return candidate;
}

export function getCodingWorkspaceDiff(input: { root?: string; file: string; sessionId?: string; view?: 'working' | 'staged' | 'turn' }): CodingWorkspaceDiff {
  const root = safeRoot(input.root);
  const filePath = resolveFile(root, String(input.file || '').trim());
  const repoRoot = findCodingGitRoot(filePath);
  const relative = repoRoot ? path.relative(repoRoot, filePath).replace(/\\/g, '/') : path.relative(root, filePath).replace(/\\/g, '/');
  const view = input.view === 'staged' ? 'staged' : input.view === 'turn' ? 'turn' : 'working';
  const current = fileContent(filePath);
  let status: CodingFileStatus = current ? 'modified' : 'deleted';
  let baselineKind: CodingBaselineKind = 'none';
  let baselineId: string | undefined;
  let diff = '';

  if (repoRoot) {
    const sessionFile = input.sessionId
      ? readSessionFileChanges(input.sessionId, root).find((item) => comparePath(item.path) === comparePath(filePath))
      : undefined;
    if (view === 'turn' && sessionFile) {
      baselineKind = sessionFile.baselineKind || (sessionFile.baselineId ? 'turn-snapshot' : 'git-head');
      baselineId = sessionFile.baselineId;
      status = sessionFile.status || status;
      const manifest = sessionFile.baselineId ? findLatestSnapshot(root, filePath, sessionFile.baselineId) : null;
      const before = snapshotBeforeContent(manifest);
      if (manifest) diff = makeNoIndexDiff(relative, before, current);
      else if (sessionFile.diffPreview) diff = sessionFile.diffPreview;
    } else if (view === 'turn') {
      baselineKind = 'none';
      diff = '';
    }
    if (view === 'turn' && sessionFile) {
      // Turn diffs are based on the terminal/native tool's immediate before
      // image. Do not fall through to `git diff HEAD`, which includes dirty
      // work from before this turn.
    } else if (view === 'turn') {
      // There is no session-scoped change record for this file.
    } else {
    const statusRow = parseStatus(repoRoot).find((item) => comparePath(path.resolve(repoRoot, item.path)) === comparePath(filePath));
    status = statusRow?.status || status;
    baselineKind = view === 'staged' ? 'git-index' : 'git-head';
    if (statusRow?.untracked) {
      baselineKind = 'git-head';
      diff = makeNoIndexDiff(relative, null, current);
    } else {
      const args = view === 'staged'
        ? ['diff', '--cached', '--no-color', '--no-ext-diff', '--unified=3', '--', relative]
        : ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--unified=3', '--', relative];
      diff = runGit(repoRoot, args);
      if (!diff.trim() && view === 'working') diff = runGit(repoRoot, ['diff', '--no-color', '--no-ext-diff', '--unified=3', '--', relative]);
    }
    }
  } else {
    const sessionFile = input.sessionId
      ? readSessionFileChanges(input.sessionId, root).find((item) => comparePath(item.path) === comparePath(filePath))
      : undefined;
    const manifest = findLatestSnapshot(root, filePath, sessionFile?.baselineId);
    const before = snapshotBeforeContent(manifest);
    if (manifest) {
      baselineKind = sessionFile?.baselineId ? 'turn-snapshot' : 'session-snapshot';
      baselineId = String(manifest.id || '').trim() || undefined;
      status = current ? (manifest.existed ? 'modified' : 'added') : manifest.existed ? 'deleted' : 'observed';
      diff = makeNoIndexDiff(relative, before, current);
    } else if (sessionFile?.diffPreview) {
      baselineKind = 'turn-snapshot';
      baselineId = sessionFile.baselineId;
      diff = sessionFile.diffPreview;
      status = sessionFile.status || status;
    }
  }

  const stats = parseDiffStats(diff);
  return {
    root: repoRoot || root,
    file: filePath,
    displayPath: repoRoot ? relative : displayPath(root, filePath),
    view,
    baselineKind,
    ...(baselineId ? { baselineId } : {}),
    status,
    insertions: stats.insertions,
    deletions: stats.deletions,
    ...(stats.binary || isBinary(current) ? { binary: true } : {}),
    diff: String(diff || '').slice(0, MAX_DIFF_BYTES),
  };
}

export function getCodingWorkspaceTree(input: { root?: string; relativePath?: string; depth?: number }): { root: string; path: string; entries: Array<{ name: string; path: string; type: 'file' | 'directory'; hasChildren?: boolean; sizeBytes?: number }> } {
  const root = safeRoot(input.root);
  const relativePath = String(input.relativePath || '').trim();
  const directory = resolveFile(root, relativePath || '.');
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error('Workspace tree path is not a directory');
  const depth = Math.max(0, Math.min(2, Math.floor(Number(input.depth) || 1)));
  const entries: Array<{ name: string; path: string; type: 'file' | 'directory'; hasChildren?: boolean; sizeBytes?: number }> = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_TREE_ENTRIES)) {
    if (entry.isDirectory() && SKIPPED_TREE_DIRS.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replace(/\\/g, '/');
    let sizeBytes: number | undefined;
    if (entry.isFile()) {
      try { sizeBytes = fs.statSync(absolute).size; } catch {}
    }
    entries.push({
      name: entry.name,
      path: relative,
      type: entry.isDirectory() ? 'directory' : 'file',
      ...(entry.isDirectory() && depth > 0 ? { hasChildren: true } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    });
  }
  return { root, path: relativePath.replace(/\\/g, '/'), entries };
}
