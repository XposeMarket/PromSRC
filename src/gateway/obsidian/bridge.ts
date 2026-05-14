import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import { refreshMemoryIndexFromAudit } from '../memory-index';

export type ObsidianBridgeMode = 'read_only' | 'assisted' | 'full';

export type ObsidianVaultConfig = {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  mode: ObsidianBridgeMode;
  include: string[];
  exclude: string[];
  writebackFolder: string;
  connectedAt: string;
  lastSyncedAt?: string;
  lastSync?: ObsidianSyncResult;
};

export type ObsidianBridgeState = {
  version: number;
  vaults: ObsidianVaultConfig[];
};

type ManifestNote = {
  sourcePath: string;
  auditPath: string;
  mtimeMs: number;
  size: number;
  hash: string;
};

type ObsidianBridgeManifest = {
  version: number;
  notes: Record<string, ManifestNote>;
};

export type ObsidianSyncResult = {
  syncedAt: string;
  vaults: number;
  scanned: number;
  indexed: number;
  skipped: number;
  removed: number;
  errors: Array<{ vaultId: string; path?: string; message: string }>;
};

export type ObsidianWritebackResult = {
  success: true;
  vaultId: string;
  relativePath: string;
  absPath: string;
};

const STATE_VERSION = 1;
const DEFAULT_INCLUDE = ['**/*.md'];
const DEFAULT_EXCLUDE = ['.obsidian/**', '.trash/**', 'node_modules/**'];
const DEFAULT_WRITEBACK_FOLDER = 'Prometheus/Inbox';
const MAX_NOTE_BYTES = 750000;

function bridgeStatePath(): string {
  return path.join(getConfig().getConfigDir(), 'obsidian-bridge.json');
}

function bridgeManifestPath(): string {
  return path.join(getConfig().getConfigDir(), 'obsidian-bridge-manifest.json');
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function sha(input: string, length = 16): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, length);
}

function normalizeSlashes(value: string): string {
  return String(value || '').replace(/\\/g, '/');
}

function normalizePathForCompare(value: string): string {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right);
}

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

function sanitizePathSegment(value: string): string {
  return path.basename(String(value || '').trim()).replace(/[^a-zA-Z0-9._\-() ]/g, '_');
}

function getWorkspaceAuditRoot(): string {
  return path.join(getConfig().getWorkspacePath(), 'audit');
}

function relToAuditAbs(relPath: string): string {
  return path.join(getWorkspaceAuditRoot(), relPath.replace(/\//g, path.sep));
}

function vaultIdFor(vaultPath: string): string {
  return `obs_${sha(path.resolve(vaultPath), 12)}`;
}

function noteKey(vaultId: string, sourceRel: string): string {
  return `${vaultId}:${normalizeSlashes(sourceRel)}`;
}

function auditRelForNote(vaultId: string, sourceRel: string): string {
  const normalizedRel = normalizeSlashes(sourceRel);
  const ext = path.extname(normalizedRel) || '.md';
  const base = slugify(path.basename(normalizedRel, ext)) || 'note';
  return `obsidian/vaults/${vaultId}/notes/${base}--${sha(normalizedRel, 12)}.md`;
}

function listFilesRecursive(rootDir: string): string[] {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) out.push(abs);
    }
  }
  return out;
}

function globToRegex(glob: string): RegExp {
  const normalized = normalizeSlashes(glob).replace(/^\.\//, '');
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '::DOUBLE_STAR_SLASH::')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR_SLASH::/g, '(?:.*/)?')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesAny(relPath: string, globs: string[]): boolean {
  const normalized = normalizeSlashes(relPath).replace(/^\.\//, '');
  return globs.some((glob) => {
    const g = String(glob || '').trim();
    if (!g) return false;
    if (g.endsWith('/**')) {
      const prefix = g.slice(0, -3);
      return normalized === prefix || normalized.startsWith(`${prefix}/`);
    }
    return globToRegex(g).test(normalized);
  });
}

function shouldIncludeNote(relPath: string, vault: ObsidianVaultConfig): boolean {
  const normalized = normalizeSlashes(relPath);
  if (!normalized.toLowerCase().endsWith('.md')) return false;
  if (matchesAny(normalized, vault.exclude || DEFAULT_EXCLUDE)) return false;
  const include = vault.include?.length ? vault.include : DEFAULT_INCLUDE;
  return matchesAny(normalized, include);
}

type ParsedFrontmatter = {
  frontmatter: Record<string, any>;
  body: string;
};

function parseScalar(value: string): any {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^\[.*\]$/.test(trimmed)) {
    return trimmed.slice(1, -1).split(',').map((part) => part.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, '');
}

export function parseObsidianFrontmatter(raw: string): ParsedFrontmatter {
  const text = String(raw || '').replace(/\r/g, '\n');
  if (!text.startsWith('---\n')) return { frontmatter: {}, body: text.trim() };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: {}, body: text.trim() };
  const block = text.slice(4, end).trim();
  const body = text.slice(end + 4).trim();
  const frontmatter: Record<string, any> = {};
  let activeKey = '';
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trimEnd();
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && activeKey) {
      if (!Array.isArray(frontmatter[activeKey])) frontmatter[activeKey] = [];
      frontmatter[activeKey].push(parseScalar(listMatch[1]));
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    activeKey = match[1];
    frontmatter[activeKey] = match[2] ? parseScalar(match[2]) : [];
  }
  return { frontmatter, body };
}

function normalizeTags(value: any, body: string): string[] {
  const tags = new Set<string>();
  const add = (item: any) => {
    const tag = String(item || '').replace(/^#/, '').trim();
    if (tag) tags.add(tag);
  };
  if (Array.isArray(value)) value.forEach(add);
  else if (typeof value === 'string') value.split(/[,\s]+/).forEach(add);
  for (const match of String(body || '').matchAll(/(^|\s)#([A-Za-z0-9_/-]+)/g)) add(match[2]);
  return [...tags].sort();
}

function extractWikiLinks(body: string): string[] {
  const links = new Set<string>();
  for (const match of String(body || '').matchAll(/\[\[([^\]\n|#]+)(?:[|#][^\]\n]+)?\]\]/g)) {
    const link = match[1].trim();
    if (link) links.add(link);
  }
  return [...links].sort();
}

function extractMarkdownTitle(body: string, filePath: string, frontmatter: Record<string, any>): string {
  const explicit = String(frontmatter.title || frontmatter.name || '').trim();
  if (explicit) return explicit;
  const match = String(body || '').match(/^#\s+(.+)$/m);
  if (match?.[1]) return match[1].trim();
  return path.basename(filePath, path.extname(filePath));
}

function buildAuditDocument(input: {
  vault: ObsidianVaultConfig;
  sourceRel: string;
  sourceAbs: string;
  raw: string;
  mtimeMs: number;
  hash: string;
}): string {
  const parsed = parseObsidianFrontmatter(input.raw);
  const tags = normalizeTags(parsed.frontmatter.tags, parsed.body);
  const wikilinks = extractWikiLinks(parsed.body);
  const title = extractMarkdownTitle(parsed.body, input.sourceRel, parsed.frontmatter);
  const meta = {
    source: 'obsidian',
    vaultId: input.vault.id,
    vaultName: input.vault.name,
    vaultPath: input.vault.path,
    relativePath: normalizeSlashes(input.sourceRel),
    absPath: input.sourceAbs,
    title,
    tags,
    wikilinks,
    frontmatter: parsed.frontmatter,
    obsidianMemory: Boolean(
      parsed.frontmatter['prometheus-memory']
      || parsed.frontmatter.prometheus_memory
      || parsed.frontmatter.prometheusMemory
      || tags.some((tag) => /^prometheus(\/|$)/i.test(tag)),
    ),
    memoryType: String(
      parsed.frontmatter['prometheus-memory-type']
      || parsed.frontmatter.prometheus_memory_type
      || parsed.frontmatter.prometheusMemoryType
      || '',
    ).trim(),
    projectId: String(parsed.frontmatter.projectId || parsed.frontmatter.project || '').trim() || undefined,
    sourceMtimeMs: input.mtimeMs,
    sourceHash: input.hash,
    indexedAt: new Date().toISOString(),
  };

  return [
    '<!-- PROMETHEUS_OBSIDIAN_META',
    JSON.stringify(meta, null, 2),
    '-->',
    '',
    `# ${title}`,
    '',
    `Source: Obsidian vault "${input.vault.name}" / ${normalizeSlashes(input.sourceRel)}`,
    tags.length ? `Tags: ${tags.map((tag) => `#${tag}`).join(' ')}` : '',
    wikilinks.length ? `Links: ${wikilinks.map((link) => `[[${link}]]`).join(', ')}` : '',
    '',
    '## Obsidian Note',
    '',
    parsed.body || '(empty note)',
    '',
  ].filter((part) => part !== '').join('\n');
}

export function loadObsidianBridgeState(): ObsidianBridgeState {
  const state = readJson<ObsidianBridgeState>(bridgeStatePath(), { version: STATE_VERSION, vaults: [] });
  return {
    version: STATE_VERSION,
    vaults: Array.isArray(state.vaults) ? state.vaults.map((vault) => ({
      ...vault,
      enabled: vault.enabled !== false,
      mode: vault.mode === 'full' || vault.mode === 'assisted' ? vault.mode : 'read_only',
      include: Array.isArray(vault.include) && vault.include.length ? vault.include : DEFAULT_INCLUDE,
      exclude: Array.isArray(vault.exclude) ? vault.exclude : DEFAULT_EXCLUDE,
      writebackFolder: String(vault.writebackFolder || DEFAULT_WRITEBACK_FOLDER).trim() || DEFAULT_WRITEBACK_FOLDER,
    })) : [],
  };
}

function saveObsidianBridgeState(state: ObsidianBridgeState): ObsidianBridgeState {
  const next = { version: STATE_VERSION, vaults: state.vaults };
  writeJson(bridgeStatePath(), next);
  return next;
}

function loadManifest(): ObsidianBridgeManifest {
  const manifest = readJson<ObsidianBridgeManifest>(bridgeManifestPath(), { version: STATE_VERSION, notes: {} });
  return { version: STATE_VERSION, notes: manifest.notes && typeof manifest.notes === 'object' ? manifest.notes : {} };
}

function saveManifest(manifest: ObsidianBridgeManifest): void {
  writeJson(bridgeManifestPath(), { version: STATE_VERSION, notes: manifest.notes });
}

export function upsertObsidianVault(input: {
  path: string;
  name?: string;
  mode?: ObsidianBridgeMode;
  enabled?: boolean;
  include?: string[];
  exclude?: string[];
  writebackFolder?: string;
}): ObsidianVaultConfig {
  const resolvedPath = path.resolve(String(input.path || '').trim());
  if (!resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error('Obsidian vault path must be an existing directory.');
  }
  const state = loadObsidianBridgeState();
  const existing = state.vaults.find((vault) => samePath(vault.path, resolvedPath));
  const now = new Date().toISOString();
  const next: ObsidianVaultConfig = {
    id: existing?.id || vaultIdFor(resolvedPath),
    name: String(input.name || existing?.name || path.basename(resolvedPath) || 'Obsidian Vault').trim(),
    path: resolvedPath,
    enabled: input.enabled ?? existing?.enabled ?? true,
    mode: input.mode || existing?.mode || 'read_only',
    include: input.include?.length ? input.include : (existing?.include?.length ? existing.include : DEFAULT_INCLUDE),
    exclude: input.exclude ?? existing?.exclude ?? DEFAULT_EXCLUDE,
    writebackFolder: String(input.writebackFolder || existing?.writebackFolder || DEFAULT_WRITEBACK_FOLDER).trim() || DEFAULT_WRITEBACK_FOLDER,
    connectedAt: existing?.connectedAt || now,
    lastSyncedAt: existing?.lastSyncedAt,
    lastSync: existing?.lastSync,
  };
  state.vaults = existing
    ? state.vaults.map((vault) => (vault.id === existing.id ? next : vault))
    : [...state.vaults, next];
  saveObsidianBridgeState(state);
  return next;
}

export function removeObsidianVault(vaultId: string, opts?: { removeIndexedNotes?: boolean }): ObsidianBridgeState {
  const id = String(vaultId || '').trim();
  const state = loadObsidianBridgeState();
  const vault = state.vaults.find((item) => item.id === id);
  state.vaults = state.vaults.filter((item) => item.id !== id);
  const manifest = loadManifest();
  for (const [key, note] of Object.entries(manifest.notes)) {
    if (!key.startsWith(`${id}:`)) continue;
    if (opts?.removeIndexedNotes !== false) {
      try { fs.rmSync(relToAuditAbs(note.auditPath), { force: true }); } catch {}
    }
    delete manifest.notes[key];
  }
  saveManifest(manifest);
  saveObsidianBridgeState(state);
  if (vault) refreshMemoryIndexFromAudit(getConfig().getWorkspacePath(), { force: true, minIntervalMs: 0, maxChangedFiles: 500 });
  return state;
}

export function syncObsidianVaults(options?: { vaultId?: string; force?: boolean }): ObsidianSyncResult {
  const state = loadObsidianBridgeState();
  const manifest = loadManifest();
  const nowIso = new Date().toISOString();
  const result: ObsidianSyncResult = {
    syncedAt: nowIso,
    vaults: 0,
    scanned: 0,
    indexed: 0,
    skipped: 0,
    removed: 0,
    errors: [],
  };
  const activeVaults = state.vaults.filter((vault) => vault.enabled !== false && (!options?.vaultId || vault.id === options.vaultId));
  result.vaults = activeVaults.length;

  for (const vault of activeVaults) {
    if (!fs.existsSync(vault.path)) {
      result.errors.push({ vaultId: vault.id, message: 'Vault path no longer exists.' });
      continue;
    }
    const seenKeys = new Set<string>();
    const files = listFilesRecursive(vault.path);
    for (const abs of files) {
      const sourceRel = normalizeSlashes(path.relative(vault.path, abs));
      if (!shouldIncludeNote(sourceRel, vault)) continue;
      result.scanned += 1;
      const key = noteKey(vault.id, sourceRel);
      seenKeys.add(key);
      try {
        const stat = fs.statSync(abs);
        let raw = fs.readFileSync(abs, 'utf-8');
        if (raw.length > MAX_NOTE_BYTES) raw = `${raw.slice(0, MAX_NOTE_BYTES)}\n\n[...truncated_for_prometheus_obsidian_bridge]`;
        const hash = sha(raw, 40);
        const previous = manifest.notes[key];
        if (!options?.force && previous && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size && previous.hash === hash) {
          result.skipped += 1;
          continue;
        }
        const auditPath = previous?.auditPath || auditRelForNote(vault.id, sourceRel);
        const auditAbs = relToAuditAbs(auditPath);
        fs.mkdirSync(path.dirname(auditAbs), { recursive: true });
        fs.writeFileSync(auditAbs, buildAuditDocument({
          vault,
          sourceRel,
          sourceAbs: abs,
          raw,
          mtimeMs: stat.mtimeMs,
          hash,
        }), 'utf-8');
        manifest.notes[key] = { sourcePath: sourceRel, auditPath, mtimeMs: stat.mtimeMs, size: stat.size, hash };
        result.indexed += 1;
      } catch (err: any) {
        result.errors.push({ vaultId: vault.id, path: sourceRel, message: err?.message || 'Failed to index note.' });
      }
    }

    for (const [key, note] of Object.entries(manifest.notes)) {
      if (!key.startsWith(`${vault.id}:`)) continue;
      if (seenKeys.has(key)) continue;
      try { fs.rmSync(relToAuditAbs(note.auditPath), { force: true }); } catch {}
      delete manifest.notes[key];
      result.removed += 1;
    }
  }

  saveManifest(manifest);
  const nextState = loadObsidianBridgeState();
  nextState.vaults = nextState.vaults.map((vault) => {
    if (!activeVaults.some((active) => active.id === vault.id)) return vault;
    return { ...vault, lastSyncedAt: nowIso, lastSync: result };
  });
  saveObsidianBridgeState(nextState);
  if (result.indexed || result.removed || options?.force) {
    refreshMemoryIndexFromAudit(getConfig().getWorkspacePath(), { force: true, minIntervalMs: 0, maxChangedFiles: 800 });
  }
  return result;
}

export function writePrometheusNoteToObsidian(input: {
  vaultId: string;
  title: string;
  content: string;
  folder?: string;
  tags?: string[];
  sourceRecordId?: string;
}): ObsidianWritebackResult {
  const state = loadObsidianBridgeState();
  const vault = state.vaults.find((item) => item.id === String(input.vaultId || '').trim());
  if (!vault) throw new Error('Obsidian vault not found.');
  if (vault.mode === 'read_only') throw new Error('Vault is in read-only mode. Switch to assisted or full bridge before writing back.');
  const title = String(input.title || '').trim() || 'Prometheus Memory';
  const content = String(input.content || '').trim();
  if (!content) throw new Error('content is required.');
  const folder = normalizeSlashes(String(input.folder || vault.writebackFolder || DEFAULT_WRITEBACK_FOLDER).trim()).replace(/^\/+|\/+$/g, '');
  const noteId = `prom_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const filename = `${slugify(title) || noteId}--${noteId}.md`;
  const relativePath = normalizeSlashes(path.join(folder, sanitizePathSegment(filename)));
  const absPath = path.join(vault.path, relativePath.replace(/\//g, path.sep));
  const tags = Array.from(new Set(['prometheus', ...(input.tags || []).map((tag) => String(tag || '').replace(/^#/, '').trim()).filter(Boolean)]));
  const frontmatter = [
    '---',
    `prometheus_id: ${noteId}`,
    input.sourceRecordId ? `prometheus_record_id: ${input.sourceRecordId}` : '',
    'prometheus_source: generated',
    `prometheus_synced_at: ${new Date().toISOString()}`,
    'tags:',
    ...tags.map((tag) => `  - ${tag}`),
    '---',
  ].filter(Boolean).join('\n');
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${frontmatter}\n\n# ${title}\n\n${content}\n`, 'utf-8');
  syncObsidianVaults({ vaultId: vault.id, force: true });
  return { success: true, vaultId: vault.id, relativePath, absPath };
}
