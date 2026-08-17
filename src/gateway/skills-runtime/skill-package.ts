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
export type SkillHealthState = 'ready' | 'needs_setup' | 'partial' | 'blocked';
export interface SkillHealth {
  state: SkillHealthState;
  reason?: string;
  verifiedCapabilities: string[];
  blockedCapabilities: Record<string, string>;
  lastVerified?: string;
}
export const MAX_SKILL_TRIGGERS = 12;

/**
 * Structured prompt routing signals. These deliberately live beside the
 * legacy `triggers` list: the latter remains a compact discovery index while
 * prompt signals provide a precise, auditable phrase/term matcher.
 */
export interface SkillPromptSignals {
  phrases: string[];
  allOf: string[][];
  anyOf: string[];
  noneOf: string[];
  minScore: number;
}

export interface SkillPromptSignalValidation {
  signals?: SkillPromptSignals;
  rejected: Array<{ signal: string; reason: string }>;
}

export interface SkillPromptSignalMatch {
  configured: boolean;
  matched: boolean;
  excluded: boolean;
  score: number;
  minScore: number;
  matchedPhrases: string[];
  matchedAllOf: string[][];
  matchedAnyOf: string[];
  matchedNoneOf: string[];
}

const MAX_PROMPT_SIGNAL_PHRASES = 256;
const MAX_PROMPT_SIGNAL_ALLOF_GROUPS = 128;
const MAX_PROMPT_SIGNAL_ALLOF_TERMS = 12;
const MAX_PROMPT_SIGNAL_ANYOF = 256;
const MAX_PROMPT_SIGNAL_NONEOF = 256;
const MAX_PROMPT_SIGNAL_LENGTH = 180;

const GENERIC_SINGLE_WORD_TRIGGERS = new Set([
  'agent', 'automation', 'browser', 'code', 'coding', 'creative', 'data', 'desktop', 'document', 'edit',
  'email', 'file', 'help', 'image', 'marketing', 'post', 'project', 'research', 'skill', 'social',
  'task', 'tool', 'video', 'web', 'workflow', 'write', 'writing',
]);

export interface SkillTriggerValidation {
  triggers: string[];
  rejected: Array<{ trigger: string; reason: string }>;
  capped: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizePromptSignalText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function promptSignalArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',');
  return [];
}

function normalizePromptSignalList(
  value: unknown,
  limit: number,
  field: string,
  rejected: SkillPromptSignalValidation['rejected'],
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of promptSignalArray(value).slice(0, limit * 2)) {
    const signal = normalizePromptSignalText(raw);
    if (!signal) continue;
    if (signal.length > MAX_PROMPT_SIGNAL_LENGTH) {
      rejected.push({ signal: String(raw), reason: `${field}_too_long` });
      continue;
    }
    if (seen.has(signal)) continue;
    seen.add(signal);
    if (normalized.length >= limit) {
      rejected.push({ signal: String(raw), reason: `${field}_limit_${limit}` });
      continue;
    }
    normalized.push(signal);
  }
  return normalized;
}

function normalizePromptSignalGroups(
  value: unknown,
  rejected: SkillPromptSignalValidation['rejected'],
): string[][] {
  const groups: string[][] = [];
  for (const rawGroup of promptSignalArray(value).slice(0, MAX_PROMPT_SIGNAL_ALLOF_GROUPS * 2)) {
    const groupValues = Array.isArray(rawGroup) ? rawGroup : [rawGroup];
    const terms = normalizePromptSignalList(
      groupValues,
      MAX_PROMPT_SIGNAL_ALLOF_TERMS,
      'allOf_term',
      rejected,
    );
    if (!terms.length) continue;
    if (groups.length >= MAX_PROMPT_SIGNAL_ALLOF_GROUPS) {
      rejected.push({ signal: JSON.stringify(rawGroup), reason: `allOf_group_limit_${MAX_PROMPT_SIGNAL_ALLOF_GROUPS}` });
      continue;
    }
    groups.push(terms);
  }
  return groups;
}

function promptSignalSource(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  const nested = value.promptSignals || value.prompt_signals;
  if (isPlainObject(nested)) return nested;
  const metadata = value.metadata;
  if (isPlainObject(metadata)) {
    const metadataSignals = metadata.promptSignals || metadata.prompt_signals;
    if (isPlainObject(metadataSignals)) return metadataSignals;
  }
  const directKeys = ['phrases', 'allOf', 'all_of', 'anyOf', 'any_of', 'noneOf', 'none_of', 'minScore', 'min_score'];
  return directKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key)) ? value : {};
}

export function validateSkillPromptSignals(value: unknown): SkillPromptSignalValidation {
  if (isPlainObject(value)) {
    const nestedKey = Object.prototype.hasOwnProperty.call(value, 'promptSignals')
      ? 'promptSignals'
      : Object.prototype.hasOwnProperty.call(value, 'prompt_signals')
        ? 'prompt_signals'
        : '';
    if (nestedKey && !isPlainObject(value[nestedKey])) {
      return { signals: undefined, rejected: [{ signal: String(value[nestedKey]), reason: 'promptSignals_must_be_object' }] };
    }
    const metadata = value.metadata;
    if (isPlainObject(metadata)) {
      const metadataKey = Object.prototype.hasOwnProperty.call(metadata, 'promptSignals')
        ? 'promptSignals'
        : Object.prototype.hasOwnProperty.call(metadata, 'prompt_signals')
          ? 'prompt_signals'
          : '';
      if (metadataKey && !isPlainObject(metadata[metadataKey])) {
        return { signals: undefined, rejected: [{ signal: String(metadata[metadataKey]), reason: 'promptSignals_must_be_object' }] };
      }
    }
  }
  const source = promptSignalSource(value);
  if (!Object.keys(source).length) return { signals: undefined, rejected: [] };
  const rejected: SkillPromptSignalValidation['rejected'] = [];
  const phrases = normalizePromptSignalList(source.phrases, MAX_PROMPT_SIGNAL_PHRASES, 'phrases', rejected);
  const allOf = normalizePromptSignalGroups(source.allOf || source.all_of, rejected);
  const anyOf = normalizePromptSignalList(source.anyOf || source.any_of, MAX_PROMPT_SIGNAL_ANYOF, 'anyOf', rejected);
  const noneOf = normalizePromptSignalList(source.noneOf || source.none_of, MAX_PROMPT_SIGNAL_NONEOF, 'noneOf', rejected);
  const rawMinScore = Number(source.minScore ?? source.min_score ?? 4);
  const minScore = Number.isFinite(rawMinScore)
    ? Math.max(1, Math.min(100, Math.round(rawMinScore)))
    : 4;
  if (source.minScore !== undefined || source.min_score !== undefined) {
    if (!Number.isFinite(rawMinScore) || rawMinScore < 1 || rawMinScore > 100) {
      rejected.push({ signal: String(source.minScore ?? source.min_score), reason: 'minScore_clamped_to_1_100' });
    }
  }
  if (!phrases.length && !allOf.length && !anyOf.length && !noneOf.length) {
    return { signals: undefined, rejected };
  }
  return {
    signals: { phrases, allOf, anyOf, noneOf, minScore },
    rejected,
  };
}

function exactPromptSignalMatch(term: string, normalizedText: string): boolean {
  const normalizedTerm = normalizePromptSignalText(term);
  if (!normalizedTerm || !normalizedText) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i').test(normalizedText);
}

export function evaluateSkillPromptSignals(
  signals: SkillPromptSignals | undefined,
  rawText: string,
): SkillPromptSignalMatch {
  const normalizedText = normalizePromptSignalText(rawText);
  const empty: SkillPromptSignalMatch = {
    configured: false,
    matched: false,
    excluded: false,
    score: 0,
    minScore: 4,
    matchedPhrases: [],
    matchedAllOf: [],
    matchedAnyOf: [],
    matchedNoneOf: [],
  };
  if (!signals) return empty;

  const matchedPhrases = signals.phrases.filter((phrase) => exactPromptSignalMatch(phrase, normalizedText));
  const matchedAllOf = signals.allOf.filter((group) =>
    group.length > 0 && group.every((term) => exactPromptSignalMatch(term, normalizedText))
  );
  const matchedAnyOf = signals.anyOf.filter((term) => exactPromptSignalMatch(term, normalizedText));
  const matchedNoneOf = signals.noneOf.filter((term) => exactPromptSignalMatch(term, normalizedText));
  // A direct phrase is a strong signal, a conjunction is two points per term,
  // and anyOf terms are deliberately cheap so minScore can suppress generic
  // one-word noise. Each allOf group is an alternative conjunction.
  const score = matchedPhrases.length * 4
    + matchedAllOf.reduce((sum, group) => sum + group.length * 2, 0)
    + matchedAnyOf.length;
  const excluded = matchedNoneOf.length > 0;
  return {
    configured: true,
    matched: !excluded && score >= signals.minScore,
    excluded,
    score,
    minScore: signals.minScore,
    matchedPhrases,
    matchedAllOf,
    matchedAnyOf,
    matchedNoneOf,
  };
}

function triggerQuality(trigger: string): number {
  const words = trigger.split(/\s+/).filter(Boolean);
  const distinctive = words.filter((word) => !GENERIC_SINGLE_WORD_TRIGGERS.has(word));
  return Math.min(5, words.length) * 10 + Math.min(20, trigger.length) + distinctive.length * 8;
}

export function validateSkillTriggers(value: unknown): SkillTriggerValidation {
  const seen = new Set<string>();
  const accepted: string[] = [];
  const rejected: SkillTriggerValidation['rejected'] = [];
  for (const raw of asStringArray(value)) {
    const trigger = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!trigger || seen.has(trigger)) continue;
    seen.add(trigger);
    const words = trigger.split(/\s+/).filter(Boolean);
    if (words.length === 1 && (words[0].length < 5 || GENERIC_SINGLE_WORD_TRIGGERS.has(words[0]))) {
      rejected.push({ trigger, reason: 'generic_or_short_single_word' });
      continue;
    }
    if (trigger.length < 4) {
      rejected.push({ trigger, reason: 'too_short' });
      continue;
    }
    accepted.push(trigger);
  }
  const ranked = accepted
    .map((trigger, index) => ({ trigger, index, score: triggerQuality(trigger) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const triggers = ranked.slice(0, MAX_SKILL_TRIGGERS).map((item) => item.trigger);
  const capped = ranked.slice(MAX_SKILL_TRIGGERS).map((item) => item.trigger);
  return { triggers, rejected, capped };
}

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
  promptSignals?: SkillPromptSignals;
  categories: string[];
  requiredTools: string[];
  requires?: SkillRequires;
  assignment?: SkillAssignment;
  toolBinding?: SkillToolBinding;
  permissions: SkillPermissions;
  resources: SkillResource[];
  templates?: Array<{ action?: string; label?: string; command?: string }>;
  status: 'ready' | 'needs_setup' | 'blocked';
  health: SkillHealth;
  lifecycle: SkillLifecycleState;
  ownership: SkillOwnershipState;
  executionEnabled: boolean;
  implicitInvocation: boolean;
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
  promptSignals?: SkillPromptSignals;
  categories: string[];
  requiredTools: string[];
  requires?: SkillRequires;
  assignment?: SkillAssignment;
  toolBinding?: SkillToolBinding;
  permissions: SkillPermissions;
  status: 'ready' | 'needs_setup' | 'blocked';
  health: SkillHealth;
  lifecycle: SkillLifecycleState;
  ownership: SkillOwnershipState;
  executionEnabled: boolean;
  implicitInvocation: boolean;
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
  data: Record<string, unknown>;
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
  if (!raw.startsWith('---')) return { fm: {}, data: {}, body: raw };
  const end = raw.indexOf('---', 3);
  if (end === -1) return { fm: {}, data: {}, body: raw };

  const fm: Record<string, string> = {};
  const source = raw.slice(3, end);
  let data: Record<string, unknown> = {};
  try {
    // js-yaml is already part of the Prometheus toolchain. Keep this loaded
    // defensively so a minimal runtime can still use scalar frontmatter.
    const yaml = require('js-yaml') as { load?: (value: string) => unknown };
    const parsed = yaml.load?.(source);
    if (isPlainObject(parsed)) data = parsed;
  } catch {}
  for (const line of source.split('\n')) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[m[1].trim()] = val;
  }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      fm[key] = String(value);
    }
  }
  return { fm, data, body: raw.slice(end + 3).trim() };
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

function normalizeStatus(value: unknown): 'ready' | 'needs_setup' | 'blocked' {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'blocked' || raw === 'needs_setup') return raw;
  return 'ready';
}

function normalizeHealth(value: unknown, status: 'ready' | 'needs_setup' | 'blocked'): SkillHealth {
  const raw = isPlainObject(value) ? value : {};
  const requested = String(raw.state || '').trim().toLowerCase();
  const state: SkillHealthState = ['ready', 'needs_setup', 'partial', 'blocked'].includes(requested)
    ? requested as SkillHealthState
    : status;
  const blockedCapabilities: Record<string, string> = {};
  const blockedRaw = raw.blockedCapabilities || raw.blocked_capabilities;
  if (isPlainObject(blockedRaw)) {
    for (const [key, reason] of Object.entries(blockedRaw)) {
      blockedCapabilities[String(key)] = String(reason || '').trim();
    }
  }
  return {
    state,
    reason: String(raw.reason || '').trim() || undefined,
    verifiedCapabilities: asStringArray(raw.verifiedCapabilities || raw.verified_capabilities),
    blockedCapabilities,
    lastVerified: String(raw.lastVerified || raw.last_verified || '').trim() || undefined,
  };
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
  const overlayManifest = readManifest(overlayPath);
  const manifestRaw = nativeManifest && overlayManifest
    ? { ...nativeManifest, ...overlayManifest }
    : nativeManifest || overlayManifest;
  const manifestSource: LoadedSkillPackage['manifestSource'] = nativeManifest
    ? overlayManifest ? 'overlay' : 'native'
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
  const { fm, data: frontmatterData, body } = parseSkillFrontmatter(entryContent);

  const id = sanitizeSkillId(String(manifestRaw?.id || fm.id || fallbackId || path.basename(rootDir)));
  const name = String(manifestRaw?.name || fm.name || id).trim();
  const description = String(manifestRaw?.description || fm.description || '').trim();
  const emoji = '';
  const version = String(manifestRaw?.version || fm.version || (kind === 'bundle' ? '1.0.0' : '0.0.0')).trim();
  const triggerValidation = validateSkillTriggers(manifestRaw?.triggers ?? frontmatterData.triggers ?? fm.triggers);
  const triggers = triggerValidation.triggers;
  if (triggerValidation.rejected.length) {
    warnings.push(`Ignored invalid triggers: ${triggerValidation.rejected.map((item) => `${item.trigger} (${item.reason})`).join(', ')}`);
  }
  if (triggerValidation.capped.length) {
    warnings.push(`Trigger cap ${MAX_SKILL_TRIGGERS}: ignored ${triggerValidation.capped.length} lower-specificity trigger(s).`);
  }
  const manifestPromptSignalSource = promptSignalSource(manifestRaw);
  const frontmatterPromptSignalSource = promptSignalSource(frontmatterData);
  const promptSignalValidation = validateSkillPromptSignals(
    Object.keys(manifestPromptSignalSource).length ? manifestRaw : frontmatterData,
  );
  const promptSignals = promptSignalValidation.signals;
  if (promptSignalValidation.rejected.length) {
    warnings.push(`Ignored invalid prompt signals: ${promptSignalValidation.rejected.map((item) => `${item.signal} (${item.reason})`).join(', ')}`);
  }
  if (!Object.keys(manifestPromptSignalSource).length && Object.keys(frontmatterPromptSignalSource).length && !promptSignals) {
    warnings.push('Prompt signals were present in frontmatter but could not be normalized.');
  }
  const categories = asStringArray(manifestRaw?.categories ?? frontmatterData.categories).map((t) => t.toLowerCase());
  const requiredTools = asStringArray(
    manifestRaw?.requiredTools
      ?? manifestRaw?.required_tools
      ?? manifestRaw?.required_tool_categories
      ?? frontmatterData.requiredTools
      ?? frontmatterData.required_tools,
  );
  const requires = normalizeRequires(manifestRaw?.requires || manifestRaw?.requirements);
  const assignment = normalizeAssignment(manifestRaw?.assignment || manifestRaw?.assignments);
  const toolBinding = normalizeToolBinding(manifestRaw?.toolBinding || manifestRaw?.tool_binding, requiredTools);
  const permissions = isPlainObject(manifestRaw?.permissions) ? manifestRaw.permissions as SkillPermissions : {};
  const status = normalizeStatus(manifestRaw?.status);
  const health = normalizeHealth(manifestRaw?.health, status);
  const executionEnabled = typeof manifestRaw?.execution_enabled === 'boolean'
    ? manifestRaw.execution_enabled
    : typeof manifestRaw?.executionEnabled === 'boolean'
      ? manifestRaw.executionEnabled
      : true;
  const explicitImplicitInvocation = typeof manifestRaw?.implicitInvocation === 'boolean'
    ? manifestRaw.implicitInvocation
    : typeof manifestRaw?.implicit_invocation === 'boolean'
      ? manifestRaw.implicit_invocation
      : /^(true|false)$/i.test(String(fm.implicitInvocation || fm.implicit_invocation || '').trim())
        ? String(fm.implicitInvocation || fm.implicit_invocation).trim().toLowerCase() === 'true'
        : undefined;
  const invocationPolicy = String(manifestRaw?.invocationPolicy || manifestRaw?.invocation_policy || '').trim().toLowerCase();
  const broadOrManualSkill = categories.some((category) => ['style', 'role', 'persona', 'manual', 'guidelines'].includes(category))
    || /(?:^|-)(?:style|guidelines|operator|manager|strategist|persona|mode)(?:-|$)/i.test(`${id} ${name}`);
  const implicitInvocation = explicitImplicitInvocation !== undefined
    ? explicitImplicitInvocation
    : invocationPolicy === 'explicit'
      ? false
      : invocationPolicy === 'implicit'
        ? true
        : !broadOrManualSkill;
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
    promptSignals,
    categories,
    requiredTools,
    requires,
    assignment,
    toolBinding,
    permissions,
    resources,
    templates: Array.isArray(manifestRaw?.templates) ? manifestRaw.templates as Array<{ action?: string; label?: string; command?: string }> : undefined,
    status,
    health,
    lifecycle,
    ownership,
    executionEnabled,
    implicitInvocation,
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
    promptSignals,
    categories,
    requiredTools,
    requires,
    assignment,
    toolBinding,
    permissions,
    status,
    health,
    lifecycle,
    ownership,
    executionEnabled,
    implicitInvocation,
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
