import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { createWorkspaceSnapshot, toSnapshotRef, type WorkspaceSnapshotRef, type WorkspaceSnapshotRecord } from '../../workspace-history';

export type TerminalWorkspaceChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface TerminalWorkspaceChange {
  path: string;
  displayPath: string;
  status: TerminalWorkspaceChangeStatus;
  insertions: number;
  deletions: number;
  oldPath?: string;
  diffPreview?: string;
  binary?: boolean;
  baselineKind?: 'git-head' | 'turn-snapshot' | 'none';
  baselineId?: string;
}

export interface TerminalWorkspaceChangeResult {
  runId?: string;
  workspacePath: string;
  workspaceChanges: TerminalWorkspaceChange[];
  workspaceSnapshots: WorkspaceSnapshotRef[];
  workspaceChangeSource: 'terminal';
  truncated?: boolean;
}

export interface TerminalWorkspaceTrackerInput {
  workspacePath: string;
  cwd?: string;
  command?: string;
  runId?: string;
  sessionId?: string;
  toolCallId?: string;
}

interface FileFingerprint {
  absolutePath: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  fingerprint: string;
  tracked: boolean;
  baselineKind: 'git-head' | 'turn-snapshot' | 'none';
  baselineId?: string;
  baselineSnapshot?: WorkspaceSnapshotRecord;
}

interface FileMapCapture {
  files: Map<string, FileFingerprint>;
  truncated: boolean;
}

const MAX_FILES = 5000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_HASH_BYTES = 8 * 1024 * 1024;
const MAX_DIFF_BYTES = 512 * 1024;
const MAX_DIFF_PREVIEW = 12_000;
const PARTIAL_HASH_BYTES = 64 * 1024;
const MAX_REPORTED_CHANGES = 200;

// These directories are either generated, dependency-owned, or Prometheus's
// own history. Scanning them makes terminal tracking expensive and produces
// noise without helping a coding turn understand its edits.
const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.prometheus',
  'audit',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.turbo',
  '.vite',
  'out',
  'target',
  'tmp',
  'temp',
  '__pycache__',
]);
const EXCLUDED_FILE_NAMES = new Set(['tool_audit.log']);

function compareKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(compareKey(root), compareKey(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelative(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function displayPath(workspacePath: string, absolutePath: string): string {
  const relative = path.relative(workspacePath, absolutePath).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : absolutePath.replace(/\\/g, '/');
}

function excludedPath(relativePath: string): boolean {
  return normalizeRelative(relativePath).split('/').some((part) => EXCLUDED_DIRECTORY_NAMES.has(part.toLowerCase()));
}

function excludedFilePath(relativePath: string): boolean {
  const normalized = normalizeRelative(relativePath);
  if (excludedPath(normalized)) return true;
  const name = normalized.split('/').pop() || '';
  return EXCLUDED_FILE_NAMES.has(name.toLowerCase());
}

function commandPathHints(command: string | undefined, cwd: string, workspacePath: string): string[] {
  const source = String(command || '');
  if (!source.trim()) return [];
  const candidates = new Set<string>();
  const addCandidate = (rawValue: string): void => {
    let value = String(rawValue || '').trim();
    if (!value || value.startsWith('--') || /^(?:https?|file):\/\//i.test(value)) return;
    value = value
      .replace(/^['"`]+|['"`]+$/g, '')
      .replace(/\\(["'`])/g, '$1')
      .replace(/[;,)}\]]+$/g, '');
    if (!value || value.startsWith('$') || value === '.' || value === '..') return;
    // Only treat values with a path separator, a relative-path prefix, or a
    // file extension as paths. This avoids turning ordinary command text into
    // thousands of false workspace targets.
    if (!/[\\/]/.test(value) && !/^\.?\.?[\\/]/.test(value) && !/\.[a-z0-9]{1,12}$/i.test(value)) return;
    try {
      // Commands can carry paths written for a different shell/OS than the
      // gateway process that is inspecting them (for example PowerShell-style
      // .\\file paths in a cross-platform test or remote command). Normalize
      // separators before resolving the hint so explicit targets are captured
      // ahead of the bounded workspace walk.
      const pathValue = process.platform === 'win32'
        ? value.replace(/\//g, '\\')
        : value.replace(/\\/g, '/');
      const absolute = path.isAbsolute(pathValue) ? path.resolve(pathValue) : path.resolve(cwd, pathValue);
      if (!isInside(workspacePath, absolute)) return;
      const relative = path.relative(workspacePath, absolute);
      if (excludedFilePath(relative)) return;
      candidates.add(compareKey(absolute));
    } catch {}
  };

  const quoted = /(['"`])([\s\S]*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(source)) !== null) addCandidate(match[2]);
  for (const token of source.split(/\s+/)) addCandidate(token);
  return Array.from(candidates);
}

function runGit(root: string, args: string[], options: { maxBuffer?: number; encoding?: BufferEncoding | 'buffer' } = {}): string | Buffer {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: options.encoding || 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: options.maxBuffer || 2 * 1024 * 1024,
      timeout: 15_000,
    }) as string | Buffer;
  } catch (error: any) {
    // Git uses exit code 1 for diffs. Callers that need diff output can still
    // use stdout from the failed invocation.
    if (options.encoding === 'buffer' && Buffer.isBuffer(error?.stdout)) return error.stdout;
    if (typeof error?.stdout === 'string') return error.stdout;
    return options.encoding === 'buffer' ? Buffer.alloc(0) : '';
  }
}

function findGitRoot(candidate: string): string | null {
  let cwd = path.resolve(candidate);
  try {
    if (fs.existsSync(cwd) && fs.statSync(cwd).isFile()) cwd = path.dirname(cwd);
  } catch {}
  try {
    const result = String(runGit(cwd, ['rev-parse', '--show-toplevel'], { maxBuffer: 64 * 1024 }) || '').trim();
    return result ? path.resolve(result) : null;
  } catch {
    return null;
  }
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function fileFingerprint(filePath: string, stat: fs.Stats): string {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      if (stat.size <= MAX_HASH_BYTES) {
        const content = Buffer.alloc(stat.size);
        fs.readSync(fd, content, 0, stat.size, 0);
        return `full:${stat.size}:${hashBuffer(content)}`;
      }
      const head = Buffer.alloc(Math.min(PARTIAL_HASH_BYTES, stat.size));
      const tail = Buffer.alloc(Math.min(PARTIAL_HASH_BYTES, stat.size));
      fs.readSync(fd, head, 0, head.length, 0);
      fs.readSync(fd, tail, 0, tail.length, Math.max(0, stat.size - tail.length));
      return `partial:${stat.size}:${hashBuffer(Buffer.concat([head, tail]))}`;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return `stat:${stat.size}:${Math.round(stat.mtimeMs)}`;
  }
}

function readFileContent(filePath: string): Buffer | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_DIFF_BYTES) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function gitTrackedFiles(gitRoot: string): string[] {
  const raw = runGit(gitRoot, ['ls-files', '-co', '--exclude-standard', '-z'], { maxBuffer: 8 * 1024 * 1024 });
  return String(raw || '')
    .split('\0')
    .map(normalizeRelative)
    .filter(Boolean);
}

function gitStatusPaths(gitRoot: string): Set<string> {
  const raw = String(runGit(gitRoot, ['status', '--porcelain=v1', '--untracked-files=all'], { maxBuffer: 8 * 1024 * 1024 }) || '');
  const result = new Set<string>();
  for (const line of raw.split(/\r?\n/).map((value) => value.trimEnd()).filter(Boolean)) {
    let value = line.slice(3).trim();
    if (value.includes(' -> ')) value = value.split(' -> ').pop() || value;
    if (value) result.add(normalizeRelative(value));
  }
  return result;
}

function captureDirectoryFiles(root: string, relativeRoot = '', priorityPaths: string[] = []): FileMapCapture {
  const files = new Map<string, FileFingerprint>();
  let totalBytes = 0;
  let truncated = false;

  const captureFile = (absolute: string, relative: string): void => {
    if (truncated || files.has(compareKey(absolute)) || excludedFilePath(relative)) return;
    let stat: fs.Stats;
    try { stat = fs.statSync(absolute); } catch { return; }
    if (!stat.isFile()) return;
    if (files.size >= MAX_FILES || totalBytes + stat.size > MAX_TOTAL_BYTES) {
      truncated = true;
      return;
    }
    totalBytes += stat.size;
    files.set(compareKey(absolute), {
      absolutePath: absolute,
      relativePath: relative,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      fingerprint: fileFingerprint(absolute, stat),
      tracked: false,
      baselineKind: 'none',
    });
  };

  const visit = (directory: string, relativeDirectory: string): void => {
    if (truncated) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue;
      const relative = normalizeRelative(path.join(relativeDirectory, entry.name));
      if (excludedFilePath(relative)) continue;
      const absolute = path.join(root, relative);
      if (entry.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      captureFile(absolute, relative);
    }
  };

  // Capture paths named by the command before the bounded workspace walk.
  // This is what makes a command such as `Set-Content .\scratch\page.html`
  // reliable in a large non-Git workspace.
  for (const priorityPath of priorityPaths) {
    if (truncated) break;
    const absolute = path.resolve(priorityPath);
    if (!isInside(root, absolute) || excludedFilePath(path.relative(root, absolute))) continue;
    let stat: fs.Stats;
    try { stat = fs.statSync(absolute); } catch { continue; }
    if (stat.isDirectory()) visit(absolute, normalizeRelative(path.relative(root, absolute)));
    else captureFile(absolute, normalizeRelative(path.relative(root, absolute)));
  }
  visit(path.resolve(root), normalizeRelative(relativeRoot));
  return { files, truncated };
}

function captureGitFiles(scopeRoot: string, gitRoot: string, baselineHead: string, baselineStatus: Set<string>, priorityPaths: string[] = []): FileMapCapture {
  const files = new Map<string, FileFingerprint>();
  let totalBytes = 0;
  let truncated = false;
  const priorityRelative = priorityPaths
    .map((value) => path.resolve(value))
    .filter((absolute) => isInside(scopeRoot, absolute) && isInside(gitRoot, absolute) && !excludedFilePath(path.relative(scopeRoot, absolute)))
    .map((absolute) => normalizeRelative(path.relative(gitRoot, absolute)))
    .filter(Boolean);
  const relativePaths = Array.from(new Set([...priorityRelative, ...gitTrackedFiles(gitRoot)]));
  for (const relativeToGit of relativePaths) {
    const absolute = path.resolve(gitRoot, relativeToGit);
    if (!isInside(scopeRoot, absolute) || excludedFilePath(path.relative(scopeRoot, absolute))) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
      if (!stat.isFile()) continue;
    } catch {
      // A deleted tracked file is represented by the pre-command index/HEAD,
      // so it is not present in the physical file map after execution.
      continue;
    }
    if (files.size >= MAX_FILES || totalBytes + stat.size > MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }
    totalBytes += stat.size;
    const relativeToScope = normalizeRelative(path.relative(scopeRoot, absolute));
    const dirty = baselineStatus.has(normalizeRelative(relativeToGit));
    let snapshot: WorkspaceSnapshotRecord | null = null;
    let baselineKind: FileFingerprint['baselineKind'] = baselineHead && !dirty ? 'git-head' : 'turn-snapshot';
    if ((dirty || !baselineHead) && stat.size <= MAX_DIFF_BYTES) {
      snapshot = createWorkspaceSnapshot({
        workspacePath: scopeRoot,
        targetPath: absolute,
        displayPath: relativeToScope,
        operation: 'terminal_baseline',
      });
      if (!snapshot) baselineKind = 'none';
    }
    files.set(compareKey(absolute), {
      absolutePath: absolute,
      relativePath: relativeToScope,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      fingerprint: fileFingerprint(absolute, stat),
      tracked: true,
      baselineKind,
      ...(snapshot ? { baselineId: snapshot.id, baselineSnapshot: snapshot } : {}),
    });
  }
  // `priorityRelative` also includes command-addressed ignored files. The
  // normal `git ls-files -co --exclude-standard` list includes tracked and non-ignored
  // untracked files. This deliberately avoids a second physical walk: a
  // physical scan would re-introduce ignored files that Git correctly hides.
  return { files, truncated };
}

function readGitHeadContent(gitRoot: string, baselineHead: string, relativeToGit: string): Buffer | null {
  if (!baselineHead || !relativeToGit) return null;
  try {
    return execFileSync('git', ['show', `${baselineHead}:${relativeToGit}`], {
      cwd: gitRoot,
      encoding: 'buffer',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: MAX_DIFF_BYTES,
      timeout: 15_000,
    }) as Buffer;
  } catch {
    return null;
  }
}

function readSnapshotContent(snapshot: WorkspaceSnapshotRecord | undefined, targetPath?: string): Buffer | null {
  if (!snapshot?.contentPath || snapshot.capped || snapshot.kind !== 'file') return null;
  try { return fs.readFileSync(snapshot.contentPath); } catch { return null; }
}

function readDirectorySnapshotContent(snapshot: WorkspaceSnapshotRecord | undefined, targetPath: string): Buffer | null {
  if (!snapshot?.contentPath || snapshot.capped || snapshot.kind !== 'directory') return null;
  const relative = path.relative(snapshot.targetPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try { return fs.readFileSync(path.join(snapshot.contentPath, relative)); } catch { return null; }
}

function makeDiff(display: string, before: Buffer | null, after: Buffer | null): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-terminal-diff-'));
  const beforePath = path.join(tempRoot, 'before');
  const afterPath = path.join(tempRoot, 'after');
  try {
    fs.writeFileSync(beforePath, before || Buffer.alloc(0));
    fs.writeFileSync(afterPath, after || Buffer.alloc(0));
    const raw = runGit(tempRoot, [
      '-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-ext-diff', '--no-color', '--unified=3',
      '--', beforePath, afterPath,
    ], { maxBuffer: MAX_DIFF_BYTES });
    const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
    const normalized = lines
      .filter((line) => !line.startsWith('diff --git ') && !line.startsWith('index '))
      .map((line) => {
        if (line.startsWith('--- ')) return `--- a/${display}`;
        if (line.startsWith('+++ ')) return `+++ b/${display}`;
        return line;
      });
    return normalized.filter((line, index) => line || index < normalized.length - 1).join('\n').trimEnd() + '\n';
  } finally {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
}

function diffStats(diff: string): { insertions: number; deletions: number; binary: boolean } {
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

function isBinary(before: Buffer | null, after: Buffer | null): boolean {
  return [before, after].some((value) => value?.subarray(0, Math.min(value.length, 8192)).includes(0));
}

function uniqueSnapshots(files: FileFingerprint[]): WorkspaceSnapshotRef[] {
  const refs = files
    .map((file) => toSnapshotRef(file.baselineSnapshot))
    .filter((value): value is WorkspaceSnapshotRef => Boolean(value));
  return Array.from(new Map(refs.map((ref) => [ref.id, ref])).values());
}

export class TerminalWorkspaceTracker {
  readonly workspacePath: string;
  readonly cwd: string;
  readonly runId?: string;
  readonly command?: string;
  private readonly gitRoot: string | null;
  private readonly baselineHead: string;
  private readonly commandPathHints: string[];
  private readonly missingBaselines = new Map<string, FileFingerprint>();
  private readonly baseline: FileMapCapture;
  private finalized = false;

  constructor(input: TerminalWorkspaceTrackerInput) {
    this.workspacePath = path.resolve(String(input.workspacePath || process.cwd()));
    const rawCwd = String(input.cwd || '').trim();
    this.cwd = path.resolve(path.isAbsolute(rawCwd) ? rawCwd : path.join(this.workspacePath, rawCwd || '.'));
    this.runId = input.runId;
    this.command = input.command;
    this.commandPathHints = commandPathHints(this.command, this.cwd, this.workspacePath);
    this.gitRoot = findGitRoot(this.workspacePath);
    this.baselineHead = this.gitRoot
      ? String(runGit(this.gitRoot, ['rev-parse', 'HEAD'], { maxBuffer: 64 * 1024 }) || '').trim()
      : '';
    const baselineStatus = this.gitRoot ? gitStatusPaths(this.gitRoot) : new Set<string>();
    if (this.gitRoot) {
      this.baseline = captureGitFiles(this.workspacePath, this.gitRoot, this.baselineHead, baselineStatus, this.commandPathHints);
    } else {
      const capture = captureDirectoryFiles(this.workspacePath, '', this.commandPathHints);
      const capturedBytes = Array.from(capture.files.values()).reduce((sum, file) => sum + file.size, 0);
      const rootSnapshot = !capture.truncated && capturedBytes <= MAX_TOTAL_BYTES
        ? createWorkspaceSnapshot({
            workspacePath: this.workspacePath,
            targetPath: this.workspacePath,
            displayPath: '.',
            operation: 'terminal_baseline',
          })
        : null;
      if (rootSnapshot) {
        for (const file of capture.files.values()) {
          file.baselineKind = 'turn-snapshot';
          file.baselineId = rootSnapshot.id;
          file.baselineSnapshot = rootSnapshot;
        }
      } else {
        // A capped root walk is not safe as one restore/diff source. Keep
        // before-images for command-addressed files only; taking thousands of
        // snapshots for unrelated files both slows the turn and makes the
        // resulting checkpoint noisy.
        for (const file of capture.files.values()) {
          if (!this.commandPathHints.includes(compareKey(file.absolutePath))) continue;
          if (file.size > MAX_DIFF_BYTES) continue;
          const snapshot = createWorkspaceSnapshot({
            workspacePath: this.workspacePath,
            targetPath: file.absolutePath,
            displayPath: file.relativePath,
            operation: 'terminal_baseline',
          });
          if (snapshot) {
            file.baselineKind = 'turn-snapshot';
            file.baselineId = snapshot.id;
            file.baselineSnapshot = snapshot;
          }
        }
      }
      this.baseline = capture;
      if (rootSnapshot) {
        // The root snapshot is not attached to an individual file, so keep it
        // on a synthetic entry solely for result metadata and diff lookup.
        this.baselineSnapshot = rootSnapshot;
      }
    }

    // A command can create a file that did not exist in the baseline. Keep a
    // missing snapshot for each explicit target so Undo can remove it again.
    // A complete root snapshot already contains this information.
    if (!this.baselineSnapshot) {
      for (const hint of this.commandPathHints) {
        if (fs.existsSync(hint) || excludedFilePath(path.relative(this.workspacePath, hint))) continue;
        const snapshot = createWorkspaceSnapshot({
          workspacePath: this.workspacePath,
          targetPath: hint,
          displayPath: displayPath(this.workspacePath, hint),
          operation: 'terminal_baseline',
        });
        if (!snapshot) continue;
        this.missingBaselines.set(compareKey(hint), {
          absolutePath: hint,
          relativePath: displayPath(this.workspacePath, hint),
          size: 0,
          mtimeMs: 0,
          fingerprint: `missing:${compareKey(hint)}`,
          tracked: Boolean(this.gitRoot),
          baselineKind: 'turn-snapshot',
          baselineId: snapshot.id,
          baselineSnapshot: snapshot,
        });
      }
    }
  }

  private baselineSnapshot?: WorkspaceSnapshotRecord;

  finalize(): TerminalWorkspaceChangeResult {
    if (this.finalized) {
      return {
        ...(this.runId ? { runId: this.runId } : {}),
        workspacePath: this.workspacePath,
        workspaceChanges: [],
        workspaceSnapshots: [],
        workspaceChangeSource: 'terminal',
      };
    }
    this.finalized = true;
    const after = this.gitRoot
      ? captureGitFiles(this.workspacePath, this.gitRoot, this.baselineHead, new Set<string>(), this.commandPathHints)
      : captureDirectoryFiles(this.workspacePath, '', this.commandPathHints);
    const changes: TerminalWorkspaceChange[] = [];
    const beforeByFingerprint = new Map<string, FileFingerprint[]>();
    const afterByFingerprint = new Map<string, FileFingerprint[]>();
    for (const file of this.baseline.files.values()) {
      const list = beforeByFingerprint.get(file.fingerprint) || [];
      list.push(file);
      beforeByFingerprint.set(file.fingerprint, list);
    }
    for (const file of after.files.values()) {
      const list = afterByFingerprint.get(file.fingerprint) || [];
      list.push(file);
      afterByFingerprint.set(file.fingerprint, list);
    }

    const removed = new Map<string, FileFingerprint>();
    const added = new Map<string, FileFingerprint>();
    for (const [key, file] of this.baseline.files.entries()) if (!after.files.has(key)) removed.set(key, file);
    for (const [key, file] of after.files.entries()) if (!this.baseline.files.has(key)) added.set(key, file);
    const pairedRemoved = new Set<string>();
    const pairedAdded = new Set<string>();
    for (const [fingerprint, oldFiles] of beforeByFingerprint.entries()) {
      const newFiles = afterByFingerprint.get(fingerprint) || [];
      const oldOnly = oldFiles.filter((file) => removed.has(compareKey(file.absolutePath)));
      const newOnly = newFiles.filter((file) => added.has(compareKey(file.absolutePath)));
      const count = Math.min(oldOnly.length, newOnly.length);
      for (let index = 0; index < count; index += 1) {
        const beforeFile = oldOnly[index];
        const afterFile = newOnly[index];
        pairedRemoved.add(compareKey(beforeFile.absolutePath));
        pairedAdded.add(compareKey(afterFile.absolutePath));
        changes.push(this.buildChange(beforeFile, afterFile, 'renamed', beforeFile.absolutePath));
      }
    }

    for (const [key, beforeFile] of this.baseline.files.entries()) {
      const afterFile = after.files.get(key);
      if (!afterFile || beforeFile.fingerprint === afterFile.fingerprint || pairedRemoved.has(key)) continue;
      changes.push(this.buildChange(beforeFile, afterFile, 'modified'));
    }
    for (const [key, file] of added.entries()) {
      if (pairedAdded.has(key)) continue;
      changes.push(this.buildChange(this.missingBaselines.get(key), file, 'added'));
    }
    for (const [key, file] of removed.entries()) {
      if (pairedRemoved.has(key)) continue;
      changes.push(this.buildChange(file, undefined, 'deleted'));
    }

    const snapshots = [
      ...(this.baselineSnapshot ? [toSnapshotRef(this.baselineSnapshot)] : []),
      ...uniqueSnapshots(Array.from(this.baseline.files.values())),
      ...uniqueSnapshots(Array.from(this.missingBaselines.values())),
    ].filter((value): value is WorkspaceSnapshotRef => Boolean(value));
    const dedupedSnapshots = Array.from(new Map(snapshots.map((ref) => [ref.id, ref])).values());
    const dedupedChanges = Array.from(new Map(changes.map((change) => [compareKey(change.path), change])).values())
      .sort((a, b) => a.displayPath.localeCompare(b.displayPath));
    const reportedChanges = dedupedChanges.slice(0, MAX_REPORTED_CHANGES);
    return {
      ...(this.runId ? { runId: this.runId } : {}),
      workspacePath: this.workspacePath,
      workspaceChanges: reportedChanges,
      workspaceSnapshots: dedupedSnapshots,
      workspaceChangeSource: 'terminal',
      ...(this.baseline.truncated || after.truncated || dedupedChanges.length > reportedChanges.length ? { truncated: true } : {}),
    };
  }

  private buildChange(before: FileFingerprint | undefined, after: FileFingerprint | undefined, status: TerminalWorkspaceChangeStatus, oldPath?: string): TerminalWorkspaceChange {
    const currentPath = after?.absolutePath || before?.absolutePath || '';
    const beforeContent = before
      ? (before.baselineSnapshot?.kind === 'directory'
        ? readDirectorySnapshotContent(before.baselineSnapshot, before.absolutePath)
        : before.baselineSnapshot ? readSnapshotContent(before.baselineSnapshot, before.absolutePath) : this.gitRoot && before.baselineKind === 'git-head'
        ? readGitHeadContent(this.gitRoot, this.baselineHead, normalizeRelative(path.relative(this.gitRoot, before.absolutePath)))
        : readFileContent(before.absolutePath))
      : null;
    const afterContent = after ? readFileContent(after.absolutePath) : null;
    const binary = isBinary(beforeContent, afterContent);
    const diff = binary ? '' : makeDiff(displayPath(this.workspacePath, currentPath), beforeContent, afterContent);
    const stats = diffStats(diff);
    const baselineKind = before?.baselineKind || 'none';
    return {
      path: currentPath,
      displayPath: displayPath(this.workspacePath, currentPath),
      status,
      insertions: stats.insertions,
      deletions: stats.deletions,
      ...(oldPath && status === 'renamed' ? { oldPath } : {}),
      ...(diff ? { diffPreview: diff.slice(0, MAX_DIFF_PREVIEW) } : {}),
      ...(binary || stats.binary ? { binary: true } : {}),
      baselineKind,
      ...(before?.baselineId ? { baselineId: before.baselineId } : {}),
    };
  }
}

export function createTerminalWorkspaceTracker(input: TerminalWorkspaceTrackerInput): TerminalWorkspaceTracker | null {
  try {
    const workspacePath = path.resolve(String(input.workspacePath || '').trim() || process.cwd());
    if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) return null;
    return new TerminalWorkspaceTracker({ ...input, workspacePath });
  } catch (error: any) {
    console.warn('[terminal-change-tracker] baseline capture skipped:', error?.message || error);
    return null;
  }
}
