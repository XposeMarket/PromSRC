import { createHash } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type PromRepoToolName = 'prom_repo_push' | 'prom_repo_pull' | 'prom_repo_sync';

export interface PromRepoSyncResult {
  ok: boolean;
  message: string;
}

interface GitResult {
  ok: boolean;
  code: number | null;
  output: string;
  durationMs: number;
}

interface DirtyPath {
  status: string;
  path: string;
}

const DEFAULT_EXCLUDES = [
  'oss-agents/**',
  'workspace/oss agents/**',
  'workspace/oss-agents/**',
  'workspace/audit/**',
  'workspace/downloads/**',
  'workspace/uploads/**',
  'workspace/video-debug/**',
  'workspace/logs/**',
  'workspace/temp/**',
  'workspace/tmp/**',
  'workspace/generated/**',
  'workspace/creative-projects/**',
  'workspace/videos/**',
  'workspace/workspace/**',
  'workspace/scratch/**',
  'workspace/tool-bench-lab/**',
  'workspace/automation-bench-cleanup-*/**',
  'workspace/automation-retest-*/**',
  'workspace/games/**/build*/**',
  'videos/**',
  'captures/**',
  '**/node_modules/**',
  'native/desktop-helper-macos/.build/**',
  '.prometheus/**',
  '.agents/**',
  '.claude/**',
  '*.log',
  '*.tmp',
  '*.bak',
  '*.mp4',
  '*.mov',
  '*.webm',
];

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
}

function normalizeExclude(value: string): string {
  let pattern = normalizePath(String(value || '').trim());
  if (!pattern || pattern.startsWith('#')) return '';
  if (String(value).trim().replace(/\\/g, '/').endsWith('/')) pattern += '/**';
  return pattern;
}

function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      i += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, process.platform === 'win32' ? 'i' : '');
}

function matchesExclude(pattern: string, relPath: string): boolean {
  const normalizedPath = normalizePath(relPath);
  const normalizedPattern = normalizeExclude(pattern);
  if (!normalizedPath || !normalizedPattern) return false;
  if (!normalizedPattern.includes('/')) {
    return globToRegExp(normalizedPattern).test(path.posix.basename(normalizedPath));
  }
  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function parsePorcelainZ(output: string): DirtyPath[] {
  const records = String(output || '').split('\0').filter(Boolean);
  const paths: DirtyPath[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const match = records[i].match(/^(.{2}) (.+)$/s);
    if (!match) continue;
    paths.push({ status: match[1], path: normalizePath(match[2]) });
    if ((match[1].includes('R') || match[1].includes('C')) && i + 1 < records.length) i += 1;
  }
  return paths;
}

async function runGit(repoRoot: string, args: string[], timeoutMs = 180_000, env?: NodeJS.ProcessEnv): Promise<GitResult> {
  const startedAt = Date.now();
  return await new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      env: env || process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code: number | null, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Preserve leading spaces and NUL-delimited records for machine-readable Git
      // output such as porcelain status. Callers trim human-readable output where needed.
      const output = [stdout, stderr, extra].filter(Boolean).join('\n');
      resolve({ ok: code === 0, code, output, durationMs: Date.now() - startedAt });
    };
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (code) => finish(code));
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(null, `Timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    timer.unref?.();
  });
}

async function readExcludes(repoRoot: string): Promise<string[]> {
  let configured: string[] = [];
  try {
    configured = (await fs.promises.readFile(path.join(repoRoot, '.prom-repo-sync-ignore'), 'utf8')).split(/\r?\n/);
  } catch {}
  return Array.from(new Set([...DEFAULT_EXCLUDES, ...configured].map(normalizeExclude).filter(Boolean)));
}

async function discoverEmbeddedRepos(repoRoot: string, dirty: DirtyPath[]): Promise<string[]> {
  const found = new Set<string>();
  const skip = new Set(['.git', 'node_modules', 'dist', 'release', 'release-public']);
  const visit = async (absPath: string, relPath: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(absPath); } catch { return; }
    if (!stat.isDirectory()) return;
    try {
      await fs.promises.stat(path.join(absPath, '.git'));
      const normalized = normalizePath(relPath);
      found.add(normalized);
      found.add(`${normalized}/**`);
      return;
    } catch {}
    let entries: fs.Dirent[] = [];
    try { entries = await fs.promises.readdir(absPath, { withFileTypes: true }); } catch { return; }
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !skip.has(entry.name))
      .map((entry) => visit(path.join(absPath, entry.name), `${relPath}/${entry.name}`, depth + 1)));
  };
  for (const item of dirty.filter((entry) => entry.status === '??')) {
    await visit(path.join(repoRoot, item.path), item.path, 0);
  }
  const gitlinks = await runGit(repoRoot, ['ls-files', '--stage'], 60_000);
  if (gitlinks.ok) {
    for (const line of gitlinks.output.split(/\r?\n/)) {
      const match = line.match(/^160000\s+[0-9a-f]+\s+\d+\t(.+)$/i);
      if (!match) continue;
      const normalized = normalizePath(match[1]);
      found.add(normalized);
      found.add(`${normalized}/**`);
    }
  }
  return Array.from(found);
}

async function scanDirty(repoRoot: string): Promise<{ all: DirtyPath[]; eligible: DirtyPath[]; excluded: DirtyPath[]; excludes: string[] }> {
  // `normal` collapses an untracked directory to its parent, which prevents nested
  // exclusion rules (workspace/temp/**, **/node_modules/**, etc.) from matching.
  const status = await runGit(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 60_000);
  if (!status.ok) throw new Error(status.output || 'git status failed');
  const all = parsePorcelainZ(status.output);
  const excludes = Array.from(new Set([...(await readExcludes(repoRoot)), ...(await discoverEmbeddedRepos(repoRoot, all))]));
  const excluded: DirtyPath[] = [];
  const eligible: DirtyPath[] = [];
  for (const item of all) {
    (excludes.some((pattern) => matchesExclude(pattern, item.path)) ? excluded : eligible).push(item);
  }
  return { all, eligible, excluded, excludes };
}

function formatPathList(items: DirtyPath[], limit = 80): string {
  if (!items.length) return '(none)';
  const lines = items.slice(0, limit).map((item) => `${item.status} ${item.path}`);
  if (items.length > limit) lines.push(`… +${items.length - limit} more`);
  return lines.join('\n');
}

async function buildPreview(repoRoot: string): Promise<string> {
  const snapshot = await scanDirty(repoRoot);
  const tracked = snapshot.eligible.filter((item) => item.status !== '??');
  const untracked = snapshot.eligible.filter((item) => item.status === '??');
  const stat = await runGit(repoRoot, ['diff', '--shortstat'], 60_000);
  return [
    '📋 Read-only Prometheus repo sync preview (the Git index was not modified).',
    '',
    `Eligible paths: ${snapshot.eligible.length} (${tracked.length} tracked, ${untracked.length} untracked)`,
    `Excluded/local-only paths: ${snapshot.excluded.length}`,
    stat.output ? `Tracked diff: ${stat.output}` : '',
    '',
    'Eligible changes:',
    formatPathList(snapshot.eligible),
    '',
    'Excluded changes:',
    formatPathList(snapshot.excluded, 40),
    '',
    'Call the same tool again with an accurate commit message to acquire the repo lock, run safety gates, commit, and push.',
  ].filter((line) => line !== '').join('\n');
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function acquireLock(repoRoot: string): Promise<() => Promise<void>> {
  const lockPath = path.join(repoRoot, '.git', 'prom-repo-sync.lock');
  const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  try {
    const handle = await fs.promises.open(lockPath, 'wx');
    await handle.writeFile(payload, 'utf8');
    await handle.close();
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    let owner: any = null;
    try { owner = JSON.parse(await fs.promises.readFile(lockPath, 'utf8')); } catch {}
    let ageMs = 0;
    try { ageMs = Date.now() - (await fs.promises.stat(lockPath)).mtimeMs; } catch {}
    if (ageMs > 15 * 60_000 && !processExists(Number(owner?.pid))) {
      await fs.promises.rm(lockPath, { force: true });
      return await acquireLock(repoRoot);
    }
    throw new Error(`Prometheus repo sync is already running${owner?.pid ? ` in PID ${owner.pid}` : ''}. Wait for it to finish instead of starting another Git operation.`);
  }
  return async () => { await fs.promises.rm(lockPath, { force: true }); };
}

async function stageStableSnapshot(repoRoot: string): Promise<{ snapshot: Awaited<ReturnType<typeof scanDirty>>; attempts: number }> {
  let snapshot = await scanDirty(repoRoot);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const paths = Array.from(new Set(snapshot.eligible.map((item) => item.path)));
    for (let i = 0; i < paths.length; i += 80) {
      const add = await runGit(repoRoot, ['add', '-A', '--', ...paths.slice(i, i + 80)], 120_000);
      if (!add.ok) throw new Error(`git add failed:\n${add.output}`);
    }
    const after = await scanDirty(repoRoot);
    const stillChanging = after.eligible.filter((item) => item.status === '??' || item.status[1] !== ' ');
    if (!stillChanging.length) return { snapshot: after, attempts: attempt };
    snapshot = after;
  }
  throw new Error('Files kept changing while Prometheus was staging them. No commit was created; wait for active editors to finish and retry.');
}

async function stagedPaths(repoRoot: string): Promise<string[]> {
  const result = await runGit(repoRoot, ['diff', '--cached', '--name-only', '-z'], 60_000);
  if (!result.ok) throw new Error(result.output || 'Unable to inspect staged files');
  return result.output.split('\0').map(normalizePath).filter(Boolean);
}

async function runSafetyGates(repoRoot: string, paths: string[]): Promise<string[]> {
  const warnings: string[] = [];
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bghp_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
    /\bsk-[A-Za-z0-9_-]{40,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];
  const secretHits: string[] = [];
  const tooLarge: string[] = [];
  for (const relPath of paths) {
    const absPath = path.join(repoRoot, relPath);
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(absPath); } catch { continue; }
    if (!stat.isFile()) continue;
    if (stat.size >= 95 * 1024 * 1024) tooLarge.push(`${relPath} (${Math.round(stat.size / 1024 / 1024)} MB)`);
    if (stat.size > 2 * 1024 * 1024) continue;
    let content: string;
    try { content = await fs.promises.readFile(absPath, 'utf8'); } catch { continue; }
    if (content.includes('\0')) continue;
    if (secretPatterns.some((pattern) => pattern.test(content))) secretHits.push(relPath);
  }
  if (secretHits.length) throw new Error(`Secret scan blocked the commit. Review these files:\n${secretHits.slice(0, 40).join('\n')}`);
  if (tooLarge.length) throw new Error(`GitHub rejects files near 100 MB. Remove or use Git LFS:\n${tooLarge.join('\n')}`);
  const whitespace = await runGit(repoRoot, ['diff', '--cached', '--check'], 120_000);
  if (!whitespace.ok && whitespace.output) warnings.push(`Whitespace warnings (non-blocking):\n${whitespace.output.split(/\r?\n/).slice(0, 30).join('\n')}`);
  return warnings;
}

function sanitizeOutput(value: string, secret: string): string {
  return secret ? String(value || '').split(secret).join('***') : String(value || '');
}

function authFailure(output: string): boolean {
  return /(authentication failed|could not read username|could not read password|terminal prompts disabled|invalid username or password|permission denied|repository not found|403 forbidden|401 unauthorized|password authentication was removed)/i.test(output);
}

export async function executePromRepoSyncTool(options: {
  name: PromRepoToolName;
  args?: Record<string, any>;
  repoRoot: string;
  configDir?: string;
}): Promise<PromRepoSyncResult> {
  const { name, args = {}, repoRoot } = options;
  const message = String(args.message || '').trim();
  const configDir = options.configDir || path.join(os.homedir(), '.prometheus');
  const patFile = path.join(configDir, 'github-pat');
  const incomingPat = String(args.set_pat || args.pat || '').trim();
  if (incomingPat) {
    await fs.promises.mkdir(configDir, { recursive: true });
    await fs.promises.writeFile(patFile, incomingPat, { encoding: 'utf8', mode: 0o600 });
  }
  let savedPat = '';
  try { savedPat = (await fs.promises.readFile(patFile, 'utf8')).trim(); } catch {}
  const pat = String(process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || incomingPat || savedPat || '').trim();

  if (name !== 'prom_repo_pull' && !message) {
    try { return { ok: true, message: await buildPreview(repoRoot) }; }
    catch (error: any) { return { ok: false, message: `prom repo preview failed: ${error?.message || error}` }; }
  }

  let release: (() => Promise<void>) | null = null;
  let stagingStarted = false;
  let committed = false;
  try {
    release = await acquireLock(repoRoot);
    const branchResult = await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], 30_000);
    if (!branchResult.ok) throw new Error(branchResult.output || 'Unable to resolve branch');
    const branch = branchResult.output.split(/\r?\n/).pop()?.trim() || 'main';
    const remoteResult = await runGit(repoRoot, ['remote', 'get-url', 'origin'], 30_000);
    if (!remoteResult.ok) throw new Error(remoteResult.output || 'Missing origin remote');
    const remoteUrl = remoteResult.output.split(/\r?\n/)[0].trim();
    const authRemote = pat && /^https:\/\/([^@/]*@)?github\.com\//i.test(remoteUrl)
      ? remoteUrl.replace(/^https:\/\/([^@/]*@)?github\.com\//i, `https://x-access-token:${pat}@github.com/`)
      : 'origin';

    if (name === 'prom_repo_pull') {
      const pull = await runGit(repoRoot, ['pull', authRemote, branch, '--no-edit'], 300_000);
      const clean = sanitizeOutput(pull.output, pat);
      if (!pull.ok) {
        const conflicts = await runGit(repoRoot, ['diff', '--name-only', '--diff-filter=U'], 30_000);
        if (conflicts.output) await runGit(repoRoot, ['merge', '--abort'], 30_000);
        throw new Error(clean || 'git pull failed');
      }
      return { ok: true, message: `✅ prom_repo_pull (${branch}) succeeded in ${pull.durationMs}ms.\n${clean || 'Already up to date.'}` };
    }

    const existingIndex = await runGit(repoRoot, ['diff', '--cached', '--quiet'], 30_000);
    if (!existingIndex.ok && existingIndex.code !== 1) throw new Error(existingIndex.output || 'Unable to inspect the Git index');
    if (existingIndex.code === 1) {
      throw new Error('The Git index already contains staged changes. Commit or unstage them before running Prometheus repo sync so the tool never absorbs another workflow\'s partial staging.');
    }
    stagingStarted = true;
    const staged = await stageStableSnapshot(repoRoot);
    const paths = await stagedPaths(repoRoot);
    const warnings = await runSafetyGates(repoRoot, paths);
    const hasStaged = await runGit(repoRoot, ['diff', '--cached', '--quiet'], 30_000);
    if (!hasStaged.ok) {
      const commit = await runGit(repoRoot, ['commit', '-m', message], 300_000);
      if (!commit.ok) throw new Error(`git commit failed:\n${commit.output}`);
      committed = true;
    }

    if (name === 'prom_repo_push') {
      const fetch = await runGit(repoRoot, ['fetch', authRemote, branch], 300_000);
      if (!fetch.ok) throw new Error(sanitizeOutput(fetch.output, pat) || 'git fetch failed');
      const incoming = await runGit(repoRoot, ['rev-list', '--count', 'HEAD..FETCH_HEAD'], 30_000);
      if (!incoming.ok) throw new Error(incoming.output || 'Unable to compare remote history');
      if (Number(incoming.output.trim() || '0') > 0) {
        throw new Error(`origin/${branch} has commits missing locally. Your local commit is safe; run prom_repo_sync to merge before pushing.`);
      }
    } else {
      const pull = await runGit(repoRoot, ['pull', authRemote, branch, '--no-edit'], 300_000);
      if (!pull.ok) {
        const conflicts = await runGit(repoRoot, ['diff', '--name-only', '--diff-filter=U'], 30_000);
        if (conflicts.output) await runGit(repoRoot, ['merge', '--abort'], 30_000);
        throw new Error(`Pull/merge failed; local commit remains safe.\n${sanitizeOutput(pull.output, pat)}`);
      }
    }

    const push = await runGit(repoRoot, ['push', authRemote, branch], 300_000);
    if (!push.ok) {
      const clean = sanitizeOutput(push.output, pat);
      if (authFailure(clean)) throw new Error(`GitHub authentication failed. Provide set_pat with a repository write token, or configure Windows Git Credential Manager.\n${clean}`);
      throw new Error(clean || 'git push failed');
    }
    const head = await runGit(repoRoot, ['rev-parse', 'HEAD'], 30_000);
    return {
      ok: true,
      message: [
        `✅ ${name} completed on ${branch}.`,
        committed ? `Committed: ${message.split(/\r?\n/)[0]}` : 'No new local changes; pushed existing commits.',
        `Stable staging passes: ${staged.attempts}`,
        `Remote SHA: ${head.output.trim()}`,
        push.output ? sanitizeOutput(push.output, pat) : '',
        ...warnings,
      ].filter(Boolean).join('\n\n'),
    };
  } catch (error: any) {
    if (stagingStarted && !committed) {
      // The index was verified clean before this operation, so a mixed reset safely
      // removes only this failed attempt's staging while preserving working files.
      await runGit(repoRoot, ['reset', '--mixed', 'HEAD'], 60_000);
    }
    return { ok: false, message: `❌ ${name} failed: ${sanitizeOutput(String(error?.message || error), pat)}` };
  } finally {
    if (release) await release();
  }
}

export function hashPromRepoSyncPolicy(): string {
  return createHash('sha256').update(DEFAULT_EXCLUDES.join('\n')).digest('hex');
}
