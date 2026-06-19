import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getConfig } from '../config/config.js';
import { getActiveWorkspace } from './workspace-context.js';
import type { ToolResult } from '../types.js';

const execFileAsync = promisify(execFile);

function getWorkspaceRoot(): string {
  const globalWorkspace = getConfig().getConfig().workspace.path;
  return getActiveWorkspace(globalWorkspace);
}

function ensurePathInWorkspace(workspaceRoot: string, requested: string): string {
  const candidate = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(path.join(workspaceRoot, requested));
  const rel = path.relative(workspaceRoot, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path "${requested}" is outside workspace.`);
  }
  return candidate;
}

/**
 * Normalize a repo spec into a clonable git URL.
 * Accepts:
 *   - owner/repo                          → https://github.com/owner/repo.git
 *   - https://github.com/owner/repo       → ...repo.git
 *   - https://github.com/owner/repo.git   → unchanged
 *   - https://github.com/owner/repo/tree/<ref>/...  → repo.git (+ extracts ref)
 *   - git@github.com:owner/repo.git       → unchanged
 *   - any other https/ssh git URL         → unchanged
 */
export function normalizeRepoSpec(spec: string): { url: string; ref?: string; name: string } {
  const raw = String(spec || '').trim();
  if (!raw) throw new Error('repo is required');

  // owner/repo shorthand (no protocol, no spaces, single slash-ish)
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) {
    const name = raw.split('/')[1].replace(/\.git$/, '');
    return { url: `https://github.com/${raw.replace(/\.git$/, '')}.git`, name };
  }

  // git@host:owner/repo.git — pass through
  if (/^[\w.-]+@[\w.-]+:/.test(raw)) {
    const name = path.basename(raw).replace(/\.git$/, '');
    return { url: raw, name };
  }

  try {
    const u = new URL(raw);
    const parts = u.pathname.replace(/^\/+/, '').split('/');
    const owner = parts[0];
    let repo = (parts[1] || '').replace(/\.git$/, '');
    let ref: string | undefined;
    // github.com/owner/repo/(tree|blob)/<ref>/...
    if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
      ref = parts[3];
    }
    if (owner && repo && /github\.com$/i.test(u.hostname)) {
      return { url: `https://github.com/${owner}/${repo}.git`, ref, name: repo };
    }
    // Other git hosts — keep URL as-is, derive a name.
    const name = (repo || path.basename(u.pathname).replace(/\.git$/, '')) || u.hostname.replace(/\W+/g, '-');
    return { url: raw.replace(/\/(tree|blob)\/.*$/, ''), ref, name };
  } catch {
    // Not a URL and not shorthand — let git try it directly.
    return { url: raw, name: path.basename(raw).replace(/\.git$/, '') || 'repo' };
  }
}

async function gitAvailable(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version'], { timeout: 8_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function listTopLevel(dir: string, limit = 50): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.name !== '.git')
      .slice(0, limit)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  } catch {
    return [];
  }
}

async function countFiles(dir: string, cap = 5000): Promise<number> {
  let count = 0;
  const stack = [dir];
  while (stack.length && count < cap) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === '.git') continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else count += 1;
      if (count >= cap) break;
    }
  }
  return count;
}

type CloneRepoArgs = {
  repo: string;
  dest?: string;
  ref?: string;
  branch?: string;
  depth?: number;
  paths?: string[] | string;
  overwrite?: boolean;
};

/**
 * Clone a git repository (or a subset of its files) into the workspace.
 * Defaults the destination to repos/<name> inside the active workspace.
 * When `paths` is provided, performs a sparse checkout fetching only those files/dirs.
 */
export async function executeCloneRepo(args: CloneRepoArgs): Promise<ToolResult> {
  const workspaceRoot = getWorkspaceRoot();

  let spec: { url: string; ref?: string; name: string };
  try {
    spec = normalizeRepoSpec(String(args?.repo || ''));
  } catch (error: any) {
    return { success: false, error: String(error?.message || error) };
  }

  const ref = String(args.ref || args.branch || spec.ref || '').trim() || undefined;
  const depth = Number.isFinite(args.depth as number) && (args.depth as number) > 0
    ? Math.floor(args.depth as number)
    : (args.depth === 0 ? 0 : 1); // default shallow clone; depth:0 means full history
  const sparsePaths = Array.isArray(args.paths)
    ? args.paths.map((p) => String(p).trim()).filter(Boolean)
    : (typeof args.paths === 'string' && args.paths.trim()
      ? args.paths.split(',').map((p) => p.trim()).filter(Boolean)
      : []);

  const relDest = String(args.dest || `repos/${spec.name}`).trim() || `repos/${spec.name}`;

  let absDest: string;
  try {
    absDest = ensurePathInWorkspace(workspaceRoot, relDest);
  } catch (error: any) {
    return { success: false, error: String(error?.message || error) };
  }

  if (fs.existsSync(absDest)) {
    const hasEntries = (() => {
      try { return fs.readdirSync(absDest).length > 0; } catch { return false; }
    })();
    if (hasEntries) {
      if (args.overwrite !== true) {
        return {
          success: false,
          error: `Destination "${relDest}" already exists and is not empty. Pass overwrite:true to replace it.`,
        };
      }
      await fsp.rm(absDest, { recursive: true, force: true });
    }
  }

  if (!(await gitAvailable())) {
    return {
      success: false,
      error: 'clone_repo requires git on PATH. Install Git, or use download_url for individual raw file URLs.',
    };
  }

  await fsp.mkdir(path.dirname(absDest), { recursive: true });

  const runGit = async (gitArgs: string[], cwd?: string) => {
    return execFileAsync('git', gitArgs, {
      cwd: cwd || workspaceRoot,
      timeout: 10 * 60 * 1000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  };

  try {
    if (sparsePaths.length > 0) {
      // Sparse checkout: fetch only the requested files/dirs.
      const cloneArgs = ['clone', '--no-checkout', '--filter=blob:none'];
      if (depth > 0) cloneArgs.push('--depth', String(depth));
      if (ref) cloneArgs.push('--branch', ref);
      cloneArgs.push(spec.url, absDest);
      await runGit(cloneArgs);
      // --no-cone lets us match individual files, not just directories.
      await runGit(['sparse-checkout', 'set', '--no-cone', ...sparsePaths], absDest);
      await runGit(['checkout'], absDest);
    } else {
      const cloneArgs = ['clone'];
      if (depth > 0) cloneArgs.push('--depth', String(depth));
      if (ref) cloneArgs.push('--branch', ref);
      cloneArgs.push(spec.url, absDest);
      await runGit(cloneArgs);
    }

    const relPath = path.relative(workspaceRoot, absDest).replace(/\\/g, '/');
    const topLevel = await listTopLevel(absDest);
    const fileCount = await countFiles(absDest);

    return {
      success: true,
      stdout: sparsePaths.length
        ? `Cloned ${sparsePaths.length} path(s) from ${spec.url} into ${relPath} (${fileCount} files).`
        : `Cloned ${spec.url} into ${relPath} (${fileCount} files).`,
      data: {
        repo: spec.url,
        ref: ref || null,
        dest: relPath,
        abs_path: absDest,
        sparse_paths: sparsePaths.length ? sparsePaths : null,
        depth: depth || 'full',
        file_count: fileCount,
        top_level: topLevel,
      },
    };
  } catch (error: any) {
    // Clean up a partial clone so the next attempt starts fresh.
    try {
      if (fs.existsSync(absDest)) await fsp.rm(absDest, { recursive: true, force: true });
    } catch {}
    const stderr = String(error?.stderr || error?.message || error).slice(0, 1500);
    return { success: false, error: `clone_repo failed: ${stderr}` };
  }
}

export const cloneRepoTool = {
  name: 'clone_repo',
  description: 'Clone a git repository (or only specific files/dirs via sparse checkout) into the workspace.',
  execute: executeCloneRepo,
  schema: {
    repo: 'Repo URL or owner/repo shorthand',
    dest: 'Optional workspace-relative destination (default: repos/<name>)',
    ref: 'Optional branch/tag/commit',
    depth: 'Optional clone depth (default 1 shallow; 0 for full history)',
    paths: 'Optional list of files/dirs to sparse-checkout',
    overwrite: 'Replace an existing non-empty destination',
  },
  jsonSchema: {
    type: 'object',
    required: ['repo'],
    properties: {
      repo: { type: 'string', description: 'Repo URL or owner/repo shorthand' },
      dest: { type: 'string', description: 'Workspace-relative destination directory' },
      ref: { type: 'string', description: 'Branch, tag, or commit to check out' },
      depth: { type: 'number', description: 'Clone depth (default 1; 0 = full history)' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Specific files/dirs to fetch (sparse checkout)' },
      overwrite: { type: 'boolean', description: 'Replace existing non-empty destination' },
    },
    additionalProperties: false,
  },
};
