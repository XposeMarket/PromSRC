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
