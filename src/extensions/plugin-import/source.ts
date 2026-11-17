/**
 * Turn an install source into a local plugin directory WITHOUT requiring git
 * for GitHub sources (zip archive via codeload.github.com + JSZip), with hard
 * limits: download size, file count, extracted bytes, path depth, no symlinks,
 * no traversal, no case-colliding paths. Non-GitHub https repos fall back to an
 * async `git clone` (git must be installed for those only).
 */
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fetchPublicUrl } from '../../tools/outbound-url-guard.js';

const execFileAsync = promisify(execFile);

export const ARCHIVE_LIMITS = Object.freeze({
  downloadBytes: 200 * 1024 * 1024,
  extractedBytes: 60 * 1024 * 1024,
  files: 6000,
  depth: 24,
});

export interface Materialized { dir: string; cleanup: () => void; commit?: string; repo?: string; path?: string; ref?: string }

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/i;
const REF = /^(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;

/** Safe repo-relative subpath ('' = repo root), or throws. */
export function safeSubpath(p: unknown): string {
  const s = String(p ?? '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  if (s === '.' || s === '') return '';
  if (/^[A-Za-z]:|^\//.test(s) || s.split('/').some((seg) => seg === '..' || seg === '')) throw new Error(`Unsafe path "${String(p)}"`);
  return s;
}

/** Path inside root (realpath-aware for existing paths); separator-safe prefix check. */
export function isInside(root: string, target: string): boolean {
  const real = (p: string) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const r = real(root); const t = real(target);
  const rel = path.relative(r, t);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Best effort: resolve a branch/tag to a commit so the install is pinned. */
export async function resolveGithubCommit(repo: string, ref: string, fetcher: Fetcher = (u, i) => fetchPublicUrl(u, i)): Promise<string | undefined> {
  try {
    const res = await fetcher(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`, {
      headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'Prometheus-plugin-import' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const sha = (await res.text()).trim();
    return SHA.test(sha) ? sha.toLowerCase() : undefined;
  } catch { return undefined; }
}

export interface ExtractResult { files: number; bytes: number; prefix: string }

/**
 * Extract only `subpath` of a GitHub zipball (top folder "<repo>-<ref>/") into dest.
 * Rejects the whole archive on traversal, symlinks, case collisions or limit overruns.
 */
export async function extractGithubZip(buffer: Buffer, subpath: string, dest: string, limits = ARCHIVE_LIMITS): Promise<ExtractResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const names: string[] = Object.keys(zip.files);
  const prefix = (names[0] || '').split('/')[0];
  if (!prefix) throw new Error('Empty archive');
  const want = subpath ? `${prefix}/${subpath}/` : `${prefix}/`;
  const seen = new Set<string>();
  const plan: Array<{ rel: string; file: any }> = [];
  for (const name of names) {
    const n = name.replace(/\\/g, '/');
    if (!n.startsWith(`${prefix}/`)) throw new Error(`Archive entry outside the top folder: ${n.slice(0, 120)}`);
    if (!n.startsWith(want)) continue;
    const rel = n.slice(want.length).replace(/\/$/, '');
    if (!rel) continue;
    const segs = rel.split('/');
    if (segs.some((s) => s === '..' || s === '' || s === '.') || /^[A-Za-z]:/.test(rel) || rel.includes('\0')) throw new Error(`Unsafe archive path: ${rel.slice(0, 120)}`);
    if (segs.length > limits.depth) throw new Error(`Archive path too deep: ${rel.slice(0, 120)}`);
    const file = zip.files[name];
    const mode = Number(file.unixPermissions || 0);
    if ((mode & 0o170000) === 0o120000) throw new Error(`Archive contains a symlink (${rel.slice(0, 120)}); refusing to import`);
    const key = rel.toLowerCase();
    if (seen.has(key)) throw new Error(`Archive has case-colliding paths (${rel.slice(0, 120)})`);
    seen.add(key);
    if (!file.dir) plan.push({ rel, file });
  }
  if (!plan.length) throw new Error(subpath ? `Path "${subpath}" not found in the archive` : 'Archive has no files');
  if (plan.length > limits.files) throw new Error(`Plugin has ${plan.length} files (limit ${limits.files})`);
  const root = path.resolve(dest);
  let bytes = 0;
  // Sequential writes keep memory bounded and stop at the first overrun.
  for (const { rel, file } of plan) {
    const target = path.resolve(root, ...rel.split('/'));
    if (!isInside(root, path.dirname(target)) && path.dirname(target) !== root) throw new Error(`Unsafe archive path: ${rel.slice(0, 120)}`);
    const content: Buffer = await file.async('nodebuffer');
    bytes += content.length;
    if (bytes > limits.extractedBytes) throw new Error(`Plugin is larger than ${Math.round(limits.extractedBytes / 1048576)} MB unpacked`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return { files: plan.length, bytes, prefix };
}

/** Download repo@ref|sha from GitHub as a zip and extract `subpath`. No git needed. */
export async function materializeGithub(
  src: { repo: string; path?: string; ref?: string; sha?: string },
  stagingDir: string,
  opts: { fetcher?: Fetcher; limits?: typeof ARCHIVE_LIMITS } = {},
): Promise<Materialized> {
  if (!REPO.test(src.repo)) throw new Error(`Invalid GitHub repo "${src.repo}"`);
  const sub = safeSubpath(src.path);
  if (src.ref && !REF.test(src.ref)) throw new Error(`Invalid git ref "${src.ref}"`);
  if (src.sha && !SHA.test(src.sha)) throw new Error(`Invalid pinned commit "${src.sha}"`);
  const fetcher = opts.fetcher || ((u: string, i: RequestInit) => fetchPublicUrl(u, i));
  const commit = src.sha?.toLowerCase() || await resolveGithubCommit(src.repo, src.ref || 'HEAD', fetcher);
  const target = commit || src.ref || 'HEAD';
  const url = `https://codeload.github.com/${src.repo}/zip/${target.split('/').map(encodeURIComponent).join('/')}`;
  const limits = opts.limits || ARCHIVE_LIMITS;
  const res = await fetcher(url, { headers: { 'User-Agent': 'Prometheus-plugin-import' }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed for ${src.repo}@${target}: HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') || 0) > limits.downloadBytes) throw new Error(`Repository archive is larger than ${Math.round(limits.downloadBytes / 1048576)} MB`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limits.downloadBytes) throw new Error(`Repository archive is larger than ${Math.round(limits.downloadBytes / 1048576)} MB`);
  fs.mkdirSync(stagingDir, { recursive: true });
  const dest = fs.mkdtempSync(path.join(stagingDir, 'gh-'));
  const cleanup = () => { try { fs.rmSync(dest, { recursive: true, force: true }); } catch {} };
  try {
    const out = await extractGithubZip(buf, sub, dest, limits);
    // A pinned install must come from exactly that commit; never fall back to a moving branch.
    if (src.sha && !out.prefix.toLowerCase().endsWith(src.sha.toLowerCase())) throw new Error(`Pinned commit ${src.sha} does not match the downloaded archive (${out.prefix})`);
  } catch (err) { cleanup(); throw err; }
  return { dir: dest, cleanup, commit, repo: src.repo, path: sub, ref: src.ref };
}

/** Clone a non-GitHub https repo (async, needs git). Pinned commits are verified. */
export async function materializeGit(src: { url: string; path?: string; ref?: string; sha?: string }, stagingDir: string): Promise<Materialized> {
  if (!/^https:\/\/[^\s@]+$/i.test(src.url)) throw new Error('Only https git URLs without credentials are supported');
  const sub = safeSubpath(src.path);
  if (src.ref && !REF.test(src.ref)) throw new Error(`Invalid git ref "${src.ref}"`);
  fs.mkdirSync(stagingDir, { recursive: true });
  const dest = fs.mkdtempSync(path.join(stagingDir, 'git-'));
  const cleanup = () => { try { fs.rmSync(dest, { recursive: true, force: true }); } catch {} };
  const git = (args: string[]) => execFileAsync('git', args, { cwd: dest, timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  try {
    try { await git(['init', '-q']); } catch (err: any) {
      throw new Error(err?.code === 'ENOENT' ? `Installing from ${src.url} needs git, which is not installed. GitHub sources do not need git.` : String(err?.message || err));
    }
    await git(['remote', 'add', 'origin', src.url]);
    await git(['fetch', '--depth', '1', 'origin', src.sha || src.ref || 'HEAD']);
    await git(['-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD']);
    const head = String((await git(['rev-parse', 'HEAD'])).stdout).trim().toLowerCase();
    if (src.sha && head !== src.sha.toLowerCase()) throw new Error(`Pinned commit ${src.sha} not found (got ${head})`);
    fs.rmSync(path.join(dest, '.git'), { recursive: true, force: true });
    const dir = sub ? path.resolve(dest, ...sub.split('/')) : dest;
    if (!isInside(dest, dir) || !fs.existsSync(dir)) throw new Error(`Path "${sub}" not found in ${src.url}`);
    return { dir, cleanup, commit: head, path: sub, ref: src.ref };
  } catch (err: any) {
    cleanup();
    throw new Error(`git fetch failed for ${src.url}: ${String(err?.stderr || err?.message || err).slice(0, 300)}`);
  }
}
