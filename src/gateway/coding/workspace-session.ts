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
  const args = ['add', '--', ...(files.length > 0 ? files : ['.'])];
  return runGit(root, args, 30000);
}

export function gitCommit(root: string, message: string): string {
  return runGit(root, ['commit', '-m', message], 60000);
}

export function gitCreateBranch(root: string, branch: string): string {
  return runGit(root, ['checkout', '-b', branch], 30000);
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
  const commits = runGit(root, ['log', '-8', '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s'], 5000)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hashValue, shortHash, author, at, ...messageParts] = line.split('\x1f');
      return {
        hash: String(hashValue || ''),
        shortHash: String(shortHash || ''),
        author: String(author || ''),
        at: String(at || ''),
        message: messageParts.join('\x1f').trim(),
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
