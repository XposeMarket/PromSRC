import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { getConfig } from '../../config/config';

export type PackageManagerKind = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'uv' | 'cargo' | 'go' | 'dotnet' | 'unknown';

export interface CodingWorkspaceSession {
  id: string;
  root: string;
  name: string;
  branch?: string;
  packageManager: PackageManagerKind;
  dirtyFiles: string[];
  testCommand?: string;
  buildCommand?: string;
  devCommand?: string;
  previewUrl?: string;
}

export interface CodingRepositoryActivity {
  hash: string;
  shortHash: string;
  author: string;
  message: string;
  at: string;
}

export interface CodingRepositorySnapshot {
  root: string;
  connected: boolean;
  name: string;
  branch?: string;
  defaultBranch?: string;
  remoteName?: string;
  remoteUrl?: string;
  repoFullName?: string;
  provider?: string;
  htmlUrl?: string;
  cloneUrl?: string;
  statusText: string;
  dirtyFiles: string[];
  stagedFiles: number;
  unstagedFiles: number;
  untrackedFiles: number;
  ahead: number;
  behind: number;
  commitCount: number;
  commits: CodingRepositoryActivity[];
}

export interface CodingRepositoryBranch {
  name: string;
  current: boolean;
  upstream?: string;
  commit?: string;
}

function runGit(root: string, args: string[], timeout = 5000): string {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
      windowsHide: true,
    }).trim();
  } catch {
    return '';
  }
}

function runGitCommand(root: string, args: string[], timeout = 30000): string {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      windowsHide: true,
    }).trim();
  } catch (error: any) {
    const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : String(error?.stderr || '');
    const stdout = Buffer.isBuffer(error?.stdout) ? error.stdout.toString('utf8') : String(error?.stdout || '');
    const detail = (stderr || stdout || error?.message || 'Git command failed').trim();
    throw new Error(detail.slice(0, 2000));
  }
}

function splitGitRecord(line: string): string[] {
  return String(line || '').replace(/%x1f/g, '\t').split('\t');
}

function gitRepositoryRoot(root: string): string {
  const detected = runGit(root, ['rev-parse', '--show-toplevel'], 5000);
  if (!detected) throw new Error('Selected workspace is not a Git repository');
  return path.resolve(detected);
}

function normalizeGitPathspec(root: string, rawPath: string): string {
  const repoRoot = gitRepositoryRoot(root);
  const candidate = path.resolve(path.isAbsolute(rawPath) ? rawPath : path.join(repoRoot, rawPath));
  const relative = path.relative(repoRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Git file is outside the selected repository');
  }
  return relative.replace(/\\/g, '/');
}

function normalizeGitRemote(remote: string): { remoteUrl?: string; repoFullName?: string; provider?: string; htmlUrl?: string; cloneUrl?: string } {
  const value = String(remote || '').trim();
  if (!value) return {};
  const normalized = value.replace(/^git\+/, '').replace(/\.git(?:#.*)?$/i, '');
  const match = normalized.match(/^(?:https?:\/\/|ssh:\/\/git@|git@)([^/:]+)[/:](.+)$/i);
  if (!match) return { remoteUrl: value };
  const host = match[1].toLowerCase();
  const repoFullName = match[2].replace(/^\/+/, '').replace(/\.git$/i, '');
  const provider = host.includes('github') ? 'GitHub' : host.includes('gitlab') ? 'GitLab' : host.includes('bitbucket') ? 'Bitbucket' : host;
  const htmlUrl = host.includes('github') || host.includes('gitlab') || host.includes('bitbucket')
    ? `https://${host}/${repoFullName}`
    : undefined;
  return {
    remoteUrl: value,
    repoFullName,
    provider,
    htmlUrl,
    cloneUrl: htmlUrl ? `${htmlUrl}.git` : value,
  };
}

function parseGitStatusLines(root: string): { dirtyFiles: string[]; stagedFiles: number; unstagedFiles: number; untrackedFiles: number } {
  const lines = runGit(root, ['status', '--porcelain=v1', '--untracked-files=all'])
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter(Boolean);
  let stagedFiles = 0;
  let unstagedFiles = 0;
  let untrackedFiles = 0;
  const dirtyFiles: string[] = [];
  for (const line of lines) {
    const indexStatus = line.slice(0, 1);
    const worktreeStatus = line.slice(1, 2);
    const displayPath = line.slice(3).trim();
    if (indexStatus === '?' && worktreeStatus === '?') untrackedFiles += 1;
    else {
      if (indexStatus && indexStatus !== ' ') stagedFiles += 1;
      if (worktreeStatus && worktreeStatus !== ' ') unstagedFiles += 1;
    }
    if (displayPath) dirtyFiles.push(displayPath);
  }
  return { dirtyFiles: Array.from(new Set(dirtyFiles)), stagedFiles, unstagedFiles, untrackedFiles };
}

function readJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function resolveCodingRoot(rawRoot?: string): string {
  const workspace = path.resolve(getConfig().getWorkspacePath() || process.cwd());
  if (!rawRoot) return workspace;
  const resolved = path.resolve(path.isAbsolute(rawRoot) ? rawRoot : path.join(workspace, rawRoot));
  return resolved;
}

/**
 * Repository lookups may be scoped to a file rather than a directory. Git
 * requires a directory as its cwd, so walk to the nearest existing directory
 * before asking Git for the repository root. This also handles a newly-created
 * file whose parent directory already exists.
 */
function resolveGitStartPath(candidatePath: string): string {
  let current = path.resolve(candidatePath);
  try {
    if (fs.statSync(current).isFile()) return path.dirname(current);
    if (fs.existsSync(current)) return current;
  } catch {
    // Continue walking toward an existing parent.
  }
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function detectPackageManager(root: string): PackageManagerKind {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
  if (fs.existsSync(path.join(root, 'package-lock.json')) || fs.existsSync(path.join(root, 'package.json'))) return 'npm';
  if (fs.existsSync(path.join(root, 'uv.lock'))) return 'uv';
  if (fs.existsSync(path.join(root, 'requirements.txt')) || fs.existsSync(path.join(root, 'pyproject.toml'))) return 'pip';
  if (fs.existsSync(path.join(root, 'Cargo.toml'))) return 'cargo';
  if (fs.existsSync(path.join(root, 'go.mod'))) return 'go';
  if (fs.readdirSync(root).some((name) => name.endsWith('.csproj') || name.endsWith('.sln'))) return 'dotnet';
  return 'unknown';
}

function packageScriptCommand(pm: PackageManagerKind, script: string): string {
  if (pm === 'pnpm') return `pnpm ${script}`;
  if (pm === 'yarn') return `yarn ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return `npm run ${script}`;
}

export function detectCommands(root: string, pm: PackageManagerKind): Pick<CodingWorkspaceSession, 'testCommand' | 'buildCommand' | 'devCommand'> {
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg?.scripts && typeof pkg.scripts === 'object') {
    return {
      testCommand: pkg.scripts.test ? packageScriptCommand(pm, 'test') : undefined,
      buildCommand: pkg.scripts.build ? packageScriptCommand(pm, 'build') : undefined,
      devCommand: pkg.scripts.dev ? packageScriptCommand(pm, 'dev') : pkg.scripts.start ? packageScriptCommand(pm, 'start') : undefined,
    };
  }
  if (pm === 'cargo') return { testCommand: 'cargo test', buildCommand: 'cargo build' };
  if (pm === 'go') return { testCommand: 'go test ./...', buildCommand: 'go build ./...' };
  if (pm === 'uv') return { testCommand: 'uv run pytest' };
  if (pm === 'pip') return { testCommand: 'pytest' };
  if (pm === 'dotnet') return { testCommand: 'dotnet test', buildCommand: 'dotnet build' };
  return {};
}

export function getDirtyFiles(root: string): string[] {
  const status = runGit(root, ['status', '--porcelain=v1'], 5000);
  if (!status) return [];
  return status.split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

export function getCodingWorkspaceSession(rawRoot?: string): CodingWorkspaceSession {
  const root = resolveCodingRoot(rawRoot);
  const pm = detectPackageManager(root);
  const branch = runGit(root, ['branch', '--show-current'], 5000) || undefined;
  const commands = detectCommands(root, pm);
  return {
    id: Buffer.from(root).toString('base64url'),
    root,
    name: path.basename(root),
    branch,
    packageManager: pm,
    dirtyFiles: getDirtyFiles(root),
    ...commands,
  };
}

export function getGitDiff(root: string, file?: string): string {
  const args = ['diff', '--'];
  if (file) args.push(file);
  return runGit(root, args, 30000);
}

export function gitStage(root: string, files: string[]): string {
  const args = ['add', '--', ...(files.length > 0 ? files.map((file) => normalizeGitPathspec(root, file)) : ['.'])];
  return runGitCommand(root, args, 30000);
}

export function gitUnstage(root: string, files: string[]): string {
  const selected = files.length > 0 ? files.map((file) => normalizeGitPathspec(root, file)) : ['.'];
  try {
    return runGitCommand(root, ['restore', '--staged', '--', ...selected], 30000);
  } catch {
    return runGitCommand(root, ['reset', 'HEAD', '--', ...selected], 30000);
  }
}

export function gitCommit(root: string, message: string): string {
  return runGitCommand(root, ['commit', '-m', message], 60000);
}

export function gitCreateBranch(root: string, branch: string): string {
  const name = String(branch || '').trim();
  if (!name || name.length > 200 || !runGit(root, ['check-ref-format', '--branch', name], 5000)) {
    throw new Error('Invalid Git branch name');
  }
  return runGitCommand(root, ['checkout', '-b', name], 30000);
}

export function gitListBranches(root: string): CodingRepositoryBranch[] {
  return runGit(root, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)\t%(HEAD)\t%(upstream:short)\t%(objectname:short)',
    'refs/heads',
  ], 10000)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, head, upstream, commit] = splitGitRecord(line);
      return {
        name: String(name || '').trim(),
        current: String(head || '').trim() === '*',
        ...(String(upstream || '').trim() ? { upstream: String(upstream).trim() } : {}),
        ...(String(commit || '').trim() ? { commit: String(commit).trim() } : {}),
      };
    })
    .filter((branch) => branch.name);
}

export function gitCheckoutBranch(root: string, branch: string): string {
  const name = String(branch || '').trim();
  if (!name || name.length > 200 || !runGit(root, ['check-ref-format', '--branch', name], 5000)) {
    throw new Error('Invalid Git branch name');
  }
  return runGitCommand(root, ['checkout', name], 30000);
}

function validateGitRemoteName(value: string): string {
  const name = String(value || '').trim();
  if (!name || name.length > 120 || !/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Invalid Git remote name');
  return name;
}

export function gitPush(root: string, remote = 'origin', branch?: string): string {
  const remoteName = validateGitRemoteName(remote || 'origin');
  const branchName = String(branch || runGit(root, ['branch', '--show-current'], 5000)).trim();
  if (!branchName || !runGit(root, ['check-ref-format', '--branch', branchName], 5000)) throw new Error('A valid current branch is required before pushing');
  return runGitCommand(root, ['push', '--set-upstream', remoteName, branchName], 120000);
}

export function gitPull(root: string, remote = 'origin', branch?: string): string {
  const remoteName = validateGitRemoteName(remote || 'origin');
  const branchName = String(branch || runGit(root, ['branch', '--show-current'], 5000)).trim();
  if (!branchName || !runGit(root, ['check-ref-format', '--branch', branchName], 5000)) throw new Error('A valid current branch is required before pulling');
  return runGitCommand(root, ['pull', '--ff-only', remoteName, branchName], 120000);
}

export function getGitFileHistory(root: string, file: string, limit = 20): CodingRepositoryActivity[] {
  const rawTarget = String(file || '').trim();
  if (!rawTarget) return [];
  const target = normalizeGitPathspec(root, rawTarget);
  const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)));
  return runGit(root, ['log', `-${safeLimit}`, '--date=iso-strict', '--pretty=format:%H\t%h\t%an\t%ad\t%s', '--', target], 15000)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, author, at, ...messageParts] = splitGitRecord(line);
      return {
        hash: String(hash || ''),
        shortHash: String(shortHash || ''),
        author: String(author || ''),
        at: String(at || ''),
        message: messageParts.join('\t').trim(),
      };
    })
    .filter((item) => item.hash && item.message);
}

export function gitCurrentStatus(root: string): { branch?: string; dirtyFiles: string[]; statusText: string } {
  return {
    branch: runGit(root, ['branch', '--show-current'], 5000) || undefined,
    dirtyFiles: getDirtyFiles(root),
    statusText: runGit(root, ['status', '--short', '--branch'], 5000),
  };
}

export function getCodingRepositorySnapshot(rawRoot?: string): CodingRepositorySnapshot {
  const requestedRoot = resolveCodingRoot(rawRoot);
  const gitStartPath = resolveGitStartPath(requestedRoot);
  const gitRoot = runGit(gitStartPath, ['rev-parse', '--show-toplevel'], 5000);
  const root = path.resolve(gitRoot || gitStartPath);
  const name = path.basename(root) || 'Workspace';
  const status = parseGitStatusLines(root);
  const statusText = runGit(root, ['status', '--short', '--branch'], 5000);
  const branch = runGit(root, ['branch', '--show-current'], 5000) || undefined;
  const remoteName = runGit(root, ['remote'], 5000).split(/\r?\n/).map((item) => item.trim()).find(Boolean) || undefined;
  const remote = remoteName ? normalizeGitRemote(runGit(root, ['remote', 'get-url', remoteName], 5000)) : {};
  const defaultBranch = runGit(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], 5000)
    .replace(/^origin\//, '') || undefined;
  const upstreamCounts = runGit(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], 5000)
    .split(/\s+/)
    .map((value) => Number(value));
  const ahead = Number.isFinite(upstreamCounts[0]) ? Math.max(0, upstreamCounts[0]) : 0;
  const behind = Number.isFinite(upstreamCounts[1]) ? Math.max(0, upstreamCounts[1]) : 0;
  const commitCount = Number(runGit(root, ['rev-list', '--count', '--all'], 5000)) || 0;
  const commits = runGit(root, ['log', '-8', '--date=iso-strict', '--pretty=format:%H\t%h\t%an\t%ad\t%s'], 5000)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hashValue, shortHash, author, at, ...messageParts] = splitGitRecord(line);
      return {
        hash: String(hashValue || ''),
        shortHash: String(shortHash || ''),
        author: String(author || ''),
        at: String(at || ''),
        message: messageParts.join('\t').trim(),
      };
    })
    .filter((item) => item.hash && item.message);

  return {
    root,
    connected: Boolean(gitRoot),
    name,
    branch,
    defaultBranch,
    remoteName,
    ...remote,
    statusText,
    dirtyFiles: status.dirtyFiles,
    stagedFiles: status.stagedFiles,
    unstagedFiles: status.unstagedFiles,
    untrackedFiles: status.untrackedFiles,
    ahead,
    behind,
    commitCount,
    commits,
  };
}
