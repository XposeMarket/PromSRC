/**
 * Turn an install source into a local plugin directory WITHOUT requiring git
 * for GitHub sources (zip archive via codeload.github.com + JSZip), with hard
 * limits: download size, file count, extracted bytes, path depth, no symlinks,
 * no traversal, no case-colliding paths. Only GitHub is supported as a remote
 * host: every byte comes through the guarded public fetch (no git, no other hosts).
 */
import fs from 'fs';
import path from 'path';
import { fetchPublicUrl } from '../../tools/outbound-url-guard.js';

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

const mb = (n: number) => `${Math.max(0.1, Math.round((n / 1048576) * 10) / 10)} MB`;

/** Read a response body, aborting as soon as it passes `limit` bytes (never buffers past the limit). */
export async function readBodyLimited(res: Response, limit: number, what = 'Download'): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > limit) throw new Error(`${what} is larger than ${mb(limit)}`);
  if (!res.body) return Buffer.alloc(0);
  const reader = (res.body as any).getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch { /* already closed */ }
      throw new Error(`${what} is larger than ${mb(limit)}`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

/** Inflate one zip entry, stopping as soon as it passes `budget` bytes. */
function inflateLimited(file: any, budget: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    let settled = false;
    const stream = file.internalStream('nodebuffer');
    stream
      .on('data', (chunk: Buffer) => {
        if (settled) return;
        n += chunk.length;
        if (n > budget) { settled = true; try { stream.pause(); } catch { /* ignore */ } reject(new Error('over budget')); return; }
        chunks.push(chunk);
      })
      .on('error', (err: unknown) => { if (!settled) { settled = true; reject(err); } })
      .on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks, n)); } })
      .resume();
  });
}

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
  const plan: Array<{ rel: string; file: any; mode: number }> = [];
  for (const name of names) {
    // JSZip normalizes names like "a/../../x"; judge the ORIGINAL archive path, not the cleaned one.
    const original = String(zip.files[name]?.unsafeOriginalName ?? name);
    if (original !== name || original.includes('\\')) throw new Error(`Unsafe archive path: ${original.slice(0, 120)}`);
    const n = name;
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
    if (!file.dir) plan.push({ rel, file, mode });
  }
  if (!plan.length) throw new Error(subpath ? `Path "${subpath}" not found in the archive` : 'Archive has no files');
  if (plan.length > limits.files) throw new Error(`Plugin has ${plan.length} files (limit ${limits.files})`);
  const root = path.resolve(dest);
  let bytes = 0;
  // Sequential writes keep memory bounded and stop at the first overrun.
  for (const { rel, file, mode } of plan) {
    const target = path.resolve(root, ...rel.split('/'));
    if (!isInside(root, path.dirname(target)) && path.dirname(target) !== root) throw new Error(`Unsafe archive path: ${rel.slice(0, 120)}`);
    let content: Buffer;
    try { content = await inflateLimited(file, limits.extractedBytes - bytes); }
    catch (err: any) {
      if (String(err?.message) === 'over budget') throw new Error(`Plugin is larger than ${mb(limits.extractedBytes)} unpacked`);
      throw err;
    }
    bytes += content.length;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    // Keep executable bits so bundled MCP launchers still start on macOS/Linux.
    if (process.platform !== 'win32' && (mode & 0o111)) { try { fs.chmodSync(target, 0o755); } catch { /* best effort */ } }
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
  const buf = await readBodyLimited(res, limits.downloadBytes, 'Repository archive');
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

