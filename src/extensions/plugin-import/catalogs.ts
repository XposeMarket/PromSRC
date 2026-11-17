/**
 * Official plugin catalogs, fetched live: Claude official and OpenAI official,
 * plus the user's own Codex personal catalog (~/.agents/plugins/marketplace.json).
 *
 * Only the two hardcoded URLs below are ever fetched. Arbitrary catalog URLs and
 * community registries are deliberately NOT supported. Listing is
 * metadata only: nothing is downloaded or executed until the user installs one
 * entry, and install resolves the entry server-side from its stable id.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fetchPublicUrl } from '../../tools/outbound-url-guard.js';
import { readBodyLimited } from './source.js';
import { getPrometheusLayout } from '../../runtime/storage-layout.js';

export type CatalogId = 'claude-official' | 'openai-official' | 'codex-personal';

export interface CatalogDef {
  id: CatalogId;
  label: string;
  /** Live URL; absent for local-only catalogs. */
  url?: string;
  repo?: string;
  ref?: string;
  /** Local copy to fall back to when offline (another harness's checkout or the user's own file). */
  localFile?: (home: string) => string;
}

export const OFFICIAL_CATALOG_URLS = Object.freeze([
  'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json',
  'https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json',
]);

export const CATALOGS: readonly CatalogDef[] = Object.freeze([
  {
    id: 'claude-official', label: 'Claude official', url: OFFICIAL_CATALOG_URLS[0], repo: 'anthropics/claude-plugins-official', ref: 'main',
    localFile: (h: string) => path.join(h, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', '.claude-plugin', 'marketplace.json'),
  },
  { id: 'openai-official', label: 'OpenAI official', url: OFFICIAL_CATALOG_URLS[1], repo: 'openai/plugins', ref: 'main' },
  { id: 'codex-personal', label: 'Codex personal', localFile: (h: string) => path.join(h, '.agents', 'plugins', 'marketplace.json') },
]);

export type CatalogSource =
  | { kind: 'github'; repo: string; path: string; ref?: string; sha?: string }
  | { kind: 'local'; dir: string }
  | { kind: 'unsupported'; reason: string };

export interface CatalogEntry {
  /** Stable id, `<catalog>:<name>`; pass it to plugin_ops install(entry). */
  id: string;
  catalog: CatalogId;
  catalogLabel: string;
  name: string;
  description: string;
  category?: string;
  source: CatalogSource;
  installable: boolean;
  reason?: string;
  note?: string;
}

export type CatalogBase = { kind: 'github'; repo: string; ref?: string } | { kind: 'local'; dir: string };

const SHA = /^[0-9a-f]{40}$/i;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GH_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i;
const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
const TTL_MS = 6 * 60 * 60 * 1000;

/** Catalog-relative path, or null when it tries to leave the catalog. */
function cleanRel(p: unknown): string | null {
  const s = String(p ?? '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  if (/^[A-Za-z]:|^\//.test(s) || s.split('/').some((seg) => seg === '..')) return null;
  return s === '.' ? '' : s;
}

export function toCatalogSource(s: any, base: CatalogBase): CatalogSource {
  const bad = (reason: string): CatalogSource => ({ kind: 'unsupported', reason });
  const rel = (p: unknown): CatalogSource => {
    const r = cleanRel(p);
    if (r === null) return bad('path escapes the catalog');
    return base.kind === 'github' ? { kind: 'github', repo: base.repo, path: r, ref: base.ref } : { kind: 'local', dir: path.resolve(base.dir, r) };
  };
  if (typeof s === 'string') return rel(s);
  if (!s || typeof s !== 'object') return bad('missing source');
  // A pin that is present but malformed must never degrade into an unpinned install.
  if (s.sha !== undefined && (typeof s.sha !== 'string' || !SHA.test(s.sha))) return bad('catalog pins an invalid commit; refusing to install an unpinned copy');
  const sha = typeof s.sha === 'string' ? s.sha.toLowerCase() : undefined;
  const ref = typeof s.ref === 'string' && s.ref.trim() ? s.ref.trim() : undefined;
  switch (s.source) {
    case 'local':
    case 'relative':
      return rel(s.path);
    case 'github': {
      if (typeof s.repo !== 'string' || !REPO.test(s.repo)) return bad('invalid GitHub repo');
      const p = cleanRel(s.path ?? '');
      return p === null ? bad('path escapes the repo') : { kind: 'github', repo: s.repo, path: p, ref, sha };
    }
    case 'url':
    case 'git':
    case 'git-subdir': {
      const url = String(s.url || '').trim();
      const p = cleanRel(s.path ?? '');
      if (p === null) return bad('path escapes the repo');
      const gh = url.match(GH_URL);
      if (gh) return { kind: 'github', repo: `${gh[1]}/${gh[2]}`, path: p, ref, sha };
      return bad('only GitHub-hosted plugins can be imported');
    }
    case 'command':
      return bad('installs by running a shell command; Prometheus never runs catalog install commands');
    case 'npm':
      return bad('npm-package plugins are not supported');
    default:
      return bad(`source type "${String(s.source)}" is not supported`);
  }
}

/** Parse a Claude (.claude-plugin/marketplace.json) or Codex/OpenAI (.agents/plugins/marketplace.json) catalog. */
export function parseCatalog(raw: any, def: Pick<CatalogDef, 'id' | 'label'>, base: CatalogBase): { entries: CatalogEntry[]; renames: Record<string, string> } {
  const entries: CatalogEntry[] = [];
  for (const p of Array.isArray(raw?.plugins) ? raw.plugins : []) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!name || name.length > 120) continue;
    const source = toCatalogSource(p.source, base);
    const installation = String(p?.policy?.installation || '').toUpperCase();
    const blockedByPolicy = installation === 'NOT_AVAILABLE' || installation === 'DISABLED';
    const auth = String(p?.policy?.authentication || '').toUpperCase();
    entries.push({
      id: `${def.id}:${name}`,
      catalog: def.id as CatalogId,
      catalogLabel: def.label,
      name,
      description: String(p.description || p?.interface?.shortDescription || '').replace(/\s+/g, ' ').slice(0, 240),
      category: typeof p.category === 'string' ? p.category : undefined,
      source,
      installable: source.kind !== 'unsupported' && !blockedByPolicy,
      reason: source.kind === 'unsupported' ? source.reason : blockedByPolicy ? 'the catalog marks it as not installable' : undefined,
      note: auth && auth !== 'NONE' ? 'Signs in to a hosted service, so parts may only run inside ChatGPT/Codex. Inspect shows what imports.' : undefined,
    });
  }
  const renames: Record<string, string> = {};
  if (raw?.renames && typeof raw.renames === 'object') {
    for (const [from, to] of Object.entries(raw.renames)) if (typeof to === 'string') renames[from] = to;
  }
  return { entries, renames };
}

export type CatalogFetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface CatalogLoadOptions {
  refresh?: boolean;
  cacheDir?: string;
  home?: string;
  fetcher?: CatalogFetcher;
  now?: number;
}

export interface CatalogLoadResult {
  id: CatalogId;
  label: string;
  entries: CatalogEntry[];
  renames: Record<string, string>;
  fetchedAt?: string;
  /** live = fetched now; cache = fresh cache; stale = old cache or local copy used because the fetch failed; none = unavailable. */
  origin: 'live' | 'cache' | 'stale' | 'local' | 'none';
  error?: string;
}

function defaultCacheDir(): string {
  try { return path.join(getPrometheusLayout().runtime.cache, 'plugin-catalogs'); } catch { return path.join(os.tmpdir(), 'prometheus-plugin-catalogs'); }
}

const defaultFetcher: CatalogFetcher = (url, init) => fetchPublicUrl(url, init);
const inflight = new Map<string, Promise<CatalogLoadResult>>();

function readCache(file: string): { fetchedAt: string; raw: any } | null {
  try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); return c && c.raw ? c : null; } catch { return null; }
}

function readLocal(file: string | undefined): any {
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

async function fetchCatalogJson(url: string, fetcher: CatalogFetcher): Promise<any> {
  if (!OFFICIAL_CATALOG_URLS.includes(url)) throw new Error('catalog URL is not on the built-in allowlist');
  const res = await fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await readBodyLimited(res, MAX_CATALOG_BYTES, 'Catalog');
  return JSON.parse(body.toString('utf8').replace(/^\uFEFF/, ''));
}

/** Load one catalog: fresh cache -> live fetch -> stale cache -> another harness's local copy -> unavailable. */
export async function loadCatalog(id: CatalogId, opts: CatalogLoadOptions = {}): Promise<CatalogLoadResult> {
  const def = CATALOGS.find((c) => c.id === id);
  if (!def) throw new Error(`Unknown catalog "${id}". Catalogs: ${CATALOGS.map((c) => c.id).join(', ')}`);
  const home = opts.home || os.homedir();
  const localFile = def.localFile?.(home);
  const build = (raw: any, origin: CatalogLoadResult['origin'], fetchedAt?: string, error?: string): CatalogLoadResult => {
    const base: CatalogBase = def.repo && origin !== 'local'
      ? { kind: 'github', repo: def.repo, ref: def.ref }
      : { kind: 'local', dir: localFile ? (def.id === 'codex-personal' ? home : path.resolve(path.dirname(localFile), '..')) : home };
    const parsed = parseCatalog(raw, def, base);
    return { id: def.id, label: def.label, ...parsed, origin, fetchedAt, error };
  };

  // Local-only catalog (the user's own Codex personal marketplace).
  if (!def.url) {
    const raw = readLocal(localFile);
    return raw ? build(raw, 'local') : { id: def.id, label: def.label, entries: [], renames: {}, origin: 'none', error: 'not present on this computer' };
  }

  const cacheDir = opts.cacheDir || defaultCacheDir();
  const cacheFile = path.join(cacheDir, `${def.id}.json`);
  const cached = readCache(cacheFile);
  const now = opts.now ?? Date.now();
  if (!opts.refresh && cached && now - Date.parse(cached.fetchedAt) < TTL_MS) return build(cached.raw, 'cache', cached.fetchedAt);

  const key = `${def.id}:${cacheDir}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const run = (async () => {
    try {
      const raw = await fetchCatalogJson(def.url!, opts.fetcher || defaultFetcher);
      if (!Array.isArray(raw?.plugins)) throw new Error('catalog has no plugins list');
      const fetchedAt = new Date(now).toISOString();
      try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify({ fetchedAt, raw }), 'utf8'); } catch { /* cache is best effort */ }
      return build(raw, 'live', fetchedAt);
    } catch (err: any) {
      const reason = String(err?.message || err).slice(0, 200);
      // A failed refresh never replaces a valid cache.
      if (cached) return build(cached.raw, 'stale', cached.fetchedAt, `live fetch failed (${reason}); showing the copy from ${cached.fetchedAt}`);
      const local = readLocal(localFile);
      if (local) return build(local, 'local', undefined, `live fetch failed (${reason}); showing the copy saved by another app on this computer`);
      return { id: def.id, label: def.label, entries: [], renames: {}, origin: 'none' as const, error: `catalog unavailable: ${reason}` };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

export async function loadCatalogs(opts: CatalogLoadOptions & { catalog?: string } = {}): Promise<CatalogLoadResult[]> {
  const ids = opts.catalog ? [opts.catalog as CatalogId] : CATALOGS.map((c) => c.id);
  return Promise.all(ids.map((id) => loadCatalog(id, opts)));
}

export function filterCatalogEntries(results: CatalogLoadResult[], query = ''): CatalogEntry[] {
  const q = String(query || '').toLowerCase().trim();
  const all = results.flatMap((r) => r.entries);
  return q ? all.filter((e) => `${e.name} ${e.description} ${e.category || ''} ${e.catalog}`.toLowerCase().includes(q)) : all;
}

/** Resolve a stable entry id (`<catalog>:<name>`), honoring the catalog's renames map. */
export async function resolveCatalogEntry(entryId: string, opts: CatalogLoadOptions = {}): Promise<CatalogEntry> {
  const m = String(entryId || '').trim().match(/^([a-z-]+):(.+)$/);
  if (!m) throw new Error(`entry must look like "<catalog>:<plugin name>", e.g. "claude-official:${'feature-dev'}"`);
  const result = await loadCatalog(m[1] as CatalogId, opts);
  let name = m[2];
  for (let i = 0; i < 5 && result.renames[name]; i++) name = result.renames[name];
  const entry = result.entries.find((e) => e.name === name);
  if (!entry) throw new Error(`No "${m[2]}" in ${result.label}${result.error ? ` (${result.error})` : ''}.`);
  return entry;
}
