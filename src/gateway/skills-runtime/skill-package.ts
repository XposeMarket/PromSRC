import fs from 'fs';
import path from 'path';
import {
  normalizeAssignment,
  normalizeRequires,
  normalizeToolBinding,
  type SkillAssignment,
  type SkillRequires,
  type SkillToolBinding,
} from './skill-eligibility';

export type SkillKind = 'simple' | 'bundle';
export type SkillResourceType = 'template' | 'schema' | 'example' | 'asset' | 'prompt-fragment' | 'doc' | 'data';
export type SkillLifecycleState = 'draft' | 'active' | 'experimental' | 'deprecated' | 'archived';
export type SkillOwnershipState = 'local' | 'imported' | 'upstream-managed' | 'prometheus-owned-overlay';

export interface SkillPermissions {
  browser?: boolean;
  desktop?: boolean;
  workspaceRead?: boolean;
  workspaceWrite?: boolean;
  shell?: boolean;
  externalSideEffects?: boolean;
}

export interface SkillResource {
  path: string;
  type: SkillResourceType;
  description?: string;
  sizeBytes?: number;
}

export interface SkillManifest {
  schemaVersion: string;
  id: string;
  name: string;
  description: string;
  emoji: string;
  version: string;
  entrypoint: string;
  prompt?: string;
  triggers: string[];
  categories: string[];
  requiredTools: string[];
  requires?: SkillRequires;
  assignment?: SkillAssignment;
  toolBinding?: SkillToolBinding;
  permissions: SkillPermissions;
  resources: SkillResource[];
  templates?: Array<{ action?: string; label?: string; command?: string }>;
  status: 'ready' | 'needs_setup' | 'blocked';
  lifecycle: SkillLifecycleState;
  ownership: SkillOwnershipState;
  executionEnabled: boolean;
  riskLevel?: string;
}

export interface LoadedSkillPackage {
  id: string;
  kind: SkillKind;
  name: string;
  description: string;
  emoji: string;
  version: string;
  triggers: string[];
  categories: string[];
  requiredTools: string[];
  requires?: SkillRequires;
  assignment?: SkillAssignment;
  toolBinding?: SkillToolBinding;
  permissions: SkillPermissions;
  status: 'ready' | 'needs_setup' | 'blocked';
  lifecycle: SkillLifecycleState;
  ownership: SkillOwnershipState;
  executionEnabled: boolean;
  riskLevel?: string;
  rootDir: string;
  entrypoint: string;
  filePath: string;
  promptPath?: string;
  instructions: string;
  resources: SkillResource[];
  manifest: SkillManifest;
  manifestSource: 'native' | 'overlay' | 'frontmatter';
  manifestPath?: string;
  overlayPath?: string;
  provenancePath?: string;
  provenance?: Record<string, unknown>;
  validation: {
    ok: boolean;
    warnings: string[];
    errors: string[];
  };
}

export interface SkillFrontmatterParse {
  fm: Record<string, string>;
  body: string;
}

const TEXT_RESOURCE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.csv',
  '.tsv',
  '.html',
  '.htm',
  '.css',
  '.svg',
  '.xml',
  '.js',
  '.mjs',
  '.ts',
  '.tsx',
  '.py',
  '.sh',
]);

export function sanitizeSkillId(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\.(md|markdown)$/i, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'skill';
}

export function parseSkillFrontmatter(content: string): SkillFrontmatterParse {
  const raw = content.trim();
  if (!raw.startsWith('---')) return { fm: {}, body: raw };
  const end = raw.indexOf('---', 3);
  if (end === -1) return { fm: {}, body: raw };

  const fm: Record<string, string> = {};
  for (const line of raw.slice(3, end).split('\n')) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[m[1].trim()] = val;
  }
  return { fm, body: raw.slice(end + 3).trim() };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStatus(value: unknown): 'ready' | 'needs_setup' | 'blocked' {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'blocked' || raw === 'needs_setup') return raw;
  return 'ready';
}

function normalizeLifecycle(value: unknown): SkillLifecycleState {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'draft' || raw === 'experimental' || raw === 'deprecated' || raw === 'archived') return raw;
  return 'active';
}

function normalizeOwnership(value: unknown, manifestSource: LoadedSkillPackage['manifestSource'], provenance?: Record<string, unknown>): SkillOwnershipState {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'imported' || raw === 'upstream-managed' || raw === 'prometheus-owned-overlay' || raw === 'local') {
    return raw;
  }
  if (manifestSource === 'overlay') return 'prometheus-owned-overlay';
  if (provenance?.sourceType || provenance?.source) return 'imported';
  return 'local';
}

function safeRelativePath(raw: unknown, fallback = ''): string {
  const value = String(raw || fallback || '').trim().replace(/\\/g, '/');
  if (!value) return '';
  if (path.isAbsolute(value)) return '';
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') return '';
  return normalized;
}

export function resolveSkillRelativePath(rootDir: string, relPath: string): string | null {
  const safeRel = safeRelativePath(relPath);
  if (!safeRel) return null;
  const root = path.resolve(rootDir);
  const target = path.resolve(rootDir, safeRel);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootWithSep)) return null;
  return target;
}

export function normalizeSkillRelativePathForWrite(relPath: string): string | null {
  return safeRelativePath(relPath);
}

function normalizeResource(entry: unknown, rootDir: string, warnings: string[], errors: string[]): SkillResource | null {
  const rawPath = isPlainObject(entry) ? entry.path : entry;
  const relPath = safeRelativePath(rawPath);
  if (!relPath) {
    errors.push(`Invalid resource path: ${String(rawPath || '')}`);
    return null;
  }
  const abs = resolveSkillRelativePath(rootDir, relPath);
  if (!abs) {
    errors.push(`Resource path escapes skill folder: ${relPath}`);
    return null;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    warnings.push(`Resource not found: ${relPath}`);
  }
  const typeRaw = isPlainObject(entry) ? String(entry.type || '').trim() : '';
  const type = (typeRaw || inferResourceType(relPath)) as SkillResourceType;
  const description = isPlainObject(entry) ? String(entry.description || '').trim() : '';
  let sizeBytes: number | undefined;
  try {
    if (fs.existsSync(abs)) sizeBytes = fs.statSync(abs).size;
  } catch {}
  return {
    path: relPath,
    type,
    description: description || undefined,
    sizeBytes,
  };
}

function inferResourceType(relPath: string): SkillResourceType {
  const parts = relPath.split('/');
  const top = parts[0]?.toLowerCase();
  if (top === 'templates') return 'template';
  if (top === 'schemas') return 'schema';
  if (top === 'examples') return 'example';
  if (top === 'assets') return 'asset';
  if (top === 'prompts' || top === 'prompt-fragments') return 'prompt-fragment';
  if (top === 'data' || top === 'fixtures') return 'data';
  return 'doc';
}

function discoverResources(rootDir: string, entrypoint: string, prompt?: string): SkillResource[] {
  const resources: SkillResource[] = [];
  const skip = new Set(['skill.json', entrypoint, prompt || ''].filter(Boolean).map((p) => p.replace(/\\/g, '/').toLowerCase()));
  const dirs = [
    'templates',
    'schemas',
    'examples',
    'assets',
    'prompts',
    'prompt-fragments',
    'docs',
    'references',
    'palettes',
    'rules',
    'data',
    'fixtures',
    'scripts',
  ];
  for (const dir of dirs) {
    const base = path.join(rootDir, dir);
    if (!fs.existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
        if (skip.has(rel.toLowerCase())) continue;
        let sizeBytes: number | undefined;
        try { sizeBytes = fs.statSync(abs).size; } catch {}
        resources.push({ path: rel, type: inferResourceType(rel), sizeBytes });
      }
    }
  }
  return resources.sort((a, b) => a.path.localeCompare(b.path));
}

function readManifest(manifestPath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(manifestPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getSkillOverlayPath(rootDir: string, skillIdOrFolder?: string): string {
  const folderName = sanitizeSkillId(skillIdOrFolder || path.basename(rootDir));
  return path.join(path.dirname(rootDir), '.manifests', `${folderName}.skill.json`);
}

export function getSkillProvenancePath(rootDir: string, skillIdOrFolder?: string): string {
  const folderName = sanitizeSkillId(skillIdOrFolder || path.basename(rootDir));
  return path.join(path.dirname(rootDir), '.manifests', `${folderName}.source.json`);
}

function readSkillProvenance(rootDir: string, skillIdOrFolder?: string): { path?: string; data?: Record<string, unknown> } {
  const p = getSkillProvenancePath(rootDir, skillIdOrFolder);
  const data = readManifest(p);
  return data ? { path: p, data } : {};
}

export function loadSkillPackage(rootDir: string, fallbackId?: string): LoadedSkillPackage | null {
  const manifestPath = path.join(rootDir, 'skill.json');
  const nativeManifest = readManifest(manifestPath);
  const overlayPath = getSkillOverlayPath(rootDir, fallbackId || path.basename(rootDir));
  const overlayManifest = nativeManifest ? null : readManifest(overlayPath);
  const manifestRaw = nativeManifest || overlayManifest;
  const manifestSource: LoadedSkillPackage['manifestSource'] = nativeManifest
    ? 'native'
    : overlayManifest
      ? 'overlay'
      : 'frontmatter';
  const legacySkillPath = path.join(rootDir, 'SKILL.md');
  const lowercaseSkillPath = path.join(rootDir, 'skill.md');

  if (!manifestRaw && !fs.existsSync(legacySkillPath) && !fs.existsSync(lowercaseSkillPath)) return null;

  const errors: string[] = [];
  const warnings: string[] = [];
  const kind: SkillKind = manifestRaw ? 'bundle' : 'simple';
  let entrypoint = safeRelativePath(manifestRaw?.entrypoint, 'SKILL.md') || 'SKILL.md';
  if (!manifestRaw && entrypoint === 'SKILL.md' && !fs.existsSync(legacySkillPath) && fs.existsSync(lowercaseSkillPath)) {
    entrypoint = 'skill.md';
  }
  const prompt = safeRelativePath(manifestRaw?.prompt || manifestRaw?.promptPath || undefined);
  const entrypointPath = resolveSkillRelativePath(rootDir, entrypoint);
  if (!entrypointPath || !fs.existsSync(entrypointPath)) {
    errors.push(`Missing entrypoint: ${entrypoint}`);
  }

  const entryContent = entrypointPath && fs.existsSync(entrypointPath)
    ? fs.readFileSync(entrypointPath, 'utf-8')
    : '';
  const { fm, body } = parseSkillFrontmatter(entryContent);

  const id = sanitizeSkillId(String(manifestRaw?.id || fm.id || fallbackId || path.basename(rootDir)));
  const name = String(manifestRaw?.name || fm.name || id).trim();
  const description = String(manifestRaw?.description || fm.description || '').trim();
  const emoji = '';
  const version = String(manifestRaw?.version || fm.version || (kind === 'bundle' ? '1.0.0' : '0.0.0')).trim();
  const triggers = asStringArray(manifestRaw?.triggers || fm.triggers).map((t) => t.toLowerCase());
  const categories = asStringArray(manifestRaw?.categories).map((t) => t.toLowerCase());
  const requiredTools = asStringArray(manifestRaw?.requiredTools || manifestRaw?.required_tools || manifestRaw?.required_tool_categories);
  const requires = normalizeRequires(manifestRaw?.requires || manifestRaw?.requirements);
  const assignment = normalizeAssignment(manifestRaw?.assignment || manifestRaw?.assignments);
  const toolBinding = normalizeToolBinding(manifestRaw?.toolBinding || manifestRaw?.tool_binding, requiredTools);
  const permissions = isPlainObject(manifestRaw?.permissions) ? manifestRaw.permissions as SkillPermissions : {};
  const status = normalizeStatus(manifestRaw?.status);
  const executionEnabled = typeof manifestRaw?.execution_enabled === 'boolean'
    ? manifestRaw.execution_enabled
    : typeof manifestRaw?.executionEnabled === 'boolean'
      ? manifestRaw.executionEnabled
      : true;
  const riskLevel = isPlainObject(manifestRaw?.risk)
    ? String(manifestRaw.risk.level || '').trim() || undefined
    : String(manifestRaw?.riskLevel || '').trim() || undefined;

  if (manifestRaw?.id && sanitizeSkillId(String(manifestRaw.id)) !== sanitizeSkillId(path.basename(rootDir))) {
    warnings.push(`Manifest id "${String(manifestRaw.id)}" differs from folder "${path.basename(rootDir)}".`);
  }

  const resourceWarnings: string[] = [];
  const resourceErrors: string[] = [];
  const declared = Array.isArray(manifestRaw?.resources)
    ? manifestRaw.resources
      .map((entry) => normalizeResource(entry, rootDir, resourceWarnings, resourceErrors))
      .filter((entry): entry is SkillResource => !!entry)
    : [];
  warnings.push(...resourceWarnings);
  errors.push(...resourceErrors);
  const discovered = discoverResources(rootDir, entrypoint, prompt);
  const resources = mergeResources(discovered, declared);

  const promptPath = prompt ? resolveSkillRelativePath(rootDir, prompt) || undefined : undefined;
  if (prompt && (!promptPath || !fs.existsSync(promptPath))) warnings.push(`Prompt file not found: ${prompt}`);
  const provenance = readSkillProvenance(rootDir, id);
  const lifecycle = normalizeLifecycle(manifestRaw?.lifecycle || manifestRaw?.lifecycleState || manifestRaw?.state);
  const ownership = normalizeOwnership(manifestRaw?.ownership || manifestRaw?.ownershipState, manifestSource, provenance.data);

  const normalizedManifest: SkillManifest = {
    schemaVersion: String(manifestRaw?.schemaVersion || manifestRaw?.schema_version || 'prometheus-skill-bundle-v1'),
    id,
    name,
    description,
    emoji,
    version,
    entrypoint,
    prompt: prompt || undefined,
    triggers,
    categories,
    requiredTools,
    requires,
    assignment,
    toolBinding,
    permissions,
    resources,
    templates: Array.isArray(manifestRaw?.templates) ? manifestRaw.templates as Array<{ action?: string; label?: string; command?: string }> : undefined,
    status,
    lifecycle,
    ownership,
    executionEnabled,
    riskLevel,
  };

  return {
    id,
    kind,
    name,
    description,
    emoji,
    version,
    triggers,
    categories,
    requiredTools,
    requires,
    assignment,
    toolBinding,
    permissions,
    status,
    lifecycle,
    ownership,
    executionEnabled,
    riskLevel,
    rootDir,
    entrypoint,
    filePath: entrypointPath || (fs.existsSync(legacySkillPath) ? legacySkillPath : lowercaseSkillPath),
    promptPath: promptPath && fs.existsSync(promptPath) ? promptPath : undefined,
    instructions: body || entryContent.trim(),
    resources,
    manifest: normalizedManifest,
    manifestSource,
    manifestPath: nativeManifest ? manifestPath : overlayManifest ? overlayPath : undefined,
    overlayPath,
    provenancePath: provenance.path,
    provenance: provenance.data,
    validation: {
      ok: errors.length === 0,
      warnings,
      errors,
    },
  };
}

export function canReadSkillResource(relPath: string): boolean {
  return TEXT_RESOURCE_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

function mergeResources(discovered: SkillResource[], declared: SkillResource[]): SkillResource[] {
  const byPath = new Map<string, SkillResource>();
  for (const resource of discovered) byPath.set(resource.path, resource);
  for (const resource of declared) {
    byPath.set(resource.path, {
      ...byPath.get(resource.path),
      ...resource,
    });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function readSkillResourceText(
  skill: Pick<LoadedSkillPackage, 'rootDir'>,
  relPath: string,
  maxChars?: number,
): { ok: true; path: string; content: string; truncated: boolean } | { ok: false; error: string } {
  const safeRel = safeRelativePath(relPath);
  if (!safeRel) return { ok: false, error: 'Invalid resource path.' };
  if (!canReadSkillResource(safeRel)) return { ok: false, error: `Resource type is not readable as text: ${path.extname(safeRel) || '(no extension)'}` };
  const abs = resolveSkillRelativePath(skill.rootDir, safeRel);
  if (!abs) return { ok: false, error: 'Resource path escapes the skill folder.' };
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { ok: false, error: `Resource not found: ${safeRel}` };
  const raw = fs.readFileSync(abs, 'utf-8');
  const limit = Number(maxChars);
  if (!Number.isFinite(limit) || limit <= 0 || raw.length <= limit) {
    return { ok: true, path: safeRel, content: raw, truncated: false };
  }
  return { ok: true, path: safeRel, content: raw.slice(0, limit), truncated: true };
}
