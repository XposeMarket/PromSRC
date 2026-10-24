import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { validateSkillTriggerPolicy } from '../gateway/skills-runtime/skill-package.js';

/**
 * Policy-only, version-aware migration of bundled skill trigger policies into
 * existing installs. Operates on a skills directory and writes ONLY the native
 * skill.json `triggerPolicy` key. Never touches SKILL.md, frontmatter, resources,
 * instructions, or other manifest/overlay fields.
 */

export const TRIGGER_BASELINE_VERSION = 1;

export interface TriggerBaselineEntry {
  /** sha256 of canonical JSON of the bundled skill.json as shipped BEFORE triggerPolicy existed. */
  priorManifestHash: string;
  /** Authored version-2 triggerPolicy; must equal the bundled skill.json policy. */
  triggerPolicy: Record<string, unknown>;
  /** Optional source dir relative to sourceRoot (e.g. connector skill folders). Default: bundledSkillsDir/<id>. No '..' segments. */
  sourceRelDir?: string;
}

export interface TriggerBaselineFile {
  version: typeof TRIGGER_BASELINE_VERSION;
  skills: Record<string, TriggerBaselineEntry>;
}

export type TriggerMigrationStatus =
  | 'add'
  | 'current'
  | 'preserved-custom'
  | 'preserved-overlay'
  | 'manual'
  | 'skipped';

export interface TriggerMigrationItem {
  id: string;
  status: TriggerMigrationStatus;
  target?: string;
  detail: string;
}

export interface TriggerMigrationReport {
  fatal?: string;
  applied: boolean;
  snapshotDir?: string;
  items: TriggerMigrationItem[];
  counts: Record<TriggerMigrationStatus, number>;
}

export interface TriggerMigrationOptions {
  skillsDir: string;
  bundledSkillsDir: string;
  /** Root for entries with sourceRelDir (e.g. repo root). Defaults to bundledSkillsDir. */
  sourceRoot?: string;
  baseline: unknown;
  /** Dry-run unless true. */
  apply?: boolean;
  /** Snapshot root. Default: <dirname(skillsDir)>/.trigger-policy-backups */
  backupRoot?: string;
  now?: Date;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashJson(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Engine validator is authoritative: any reported error fails the baseline closed. */
export function triggerPolicyErrors(policy: unknown): string[] {
  return validateSkillTriggerPolicy(policy).errors;
}

/** Returns an error string, or null when the baseline is safe to use. */
export function validateBaseline(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'baseline must be an object';
  const b = value as Record<string, unknown>;
  if (b.version !== TRIGGER_BASELINE_VERSION) return `unsupported baseline version: ${String(b.version)}`;
  if (!b.skills || typeof b.skills !== 'object' || Array.isArray(b.skills)) return 'baseline.skills must be an object';
  for (const [id, entry] of Object.entries(b.skills as Record<string, unknown>)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id) || id.includes('..')) return `invalid skill id: ${id}`;
    const e = entry as Record<string, unknown> | null;
    if (!e || typeof e.priorManifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(e.priorManifestHash)) {
      return `${id}: priorManifestHash must be a sha256 hex string`;
    }
    if (e.sourceRelDir !== undefined) {
      const rel = e.sourceRelDir;
      if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
        return `${id}: sourceRelDir must be a relative path without '..'`;
      }
    }
    const policyErrors = triggerPolicyErrors(e.triggerPolicy);
    if (policyErrors.length) return `${id}: invalid triggerPolicy (${policyErrors.join(', ')})`;
  }
  return null;
}

type JsonRead =
  | { state: 'missing' }
  | { state: 'malformed'; error: string }
  | { state: 'ok'; data: Record<string, unknown>; raw: string };

function readJsonFile(file: string): JsonRead {
  if (!fs.existsSync(file)) return { state: 'missing' };
  let raw: string;
  try {
    // Strip a UTF-8 BOM so Windows-edited manifests parse; bytes are only rewritten on migrated files.
    raw = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
  } catch (err) {
    return { state: 'malformed', error: String(err) };
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { state: 'malformed', error: 'not a JSON object' };
    }
    return { state: 'ok', data: data as Record<string, unknown>, raw };
  } catch (err) {
    return { state: 'malformed', error: (err as Error).message };
  }
}

function emptyCounts(): Record<TriggerMigrationStatus, number> {
  return { add: 0, current: 0, 'preserved-custom': 0, 'preserved-overlay': 0, manual: 0, skipped: 0 };
}

function serialize(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

interface PlannedWrite {
  id: string;
  target: string;
  before: string;
  after: string;
}

/**
 * Plan (and optionally apply) a policy-only migration. Pure planning happens
 * first; no file is written unless every planned item is safe and apply=true.
 */
export function planTriggerPolicyMigration(opts: TriggerMigrationOptions): { items: TriggerMigrationItem[]; writes: PlannedWrite[]; fatal?: string } {
  const items: TriggerMigrationItem[] = [];
  const writes: PlannedWrite[] = [];

  const baselineError = validateBaseline(opts.baseline);
  if (baselineError) return { items, writes, fatal: `baseline rejected: ${baselineError}` };
  const baseline = opts.baseline as TriggerBaselineFile;

  if (!fs.existsSync(opts.skillsDir)) {
    return { items, writes, fatal: 'installed skills directory not found; nothing to migrate' };
  }

  for (const id of Object.keys(baseline.skills).sort()) {
    const entry = baseline.skills[id];
    const sourceDir = entry.sourceRelDir
      ? path.join(opts.sourceRoot ?? opts.bundledSkillsDir, entry.sourceRelDir)
      : path.join(opts.bundledSkillsDir, id);
    const bundled = readJsonFile(path.join(sourceDir, 'skill.json'));
    if (bundled.state !== 'ok') {
      items.push({ id, status: 'manual', detail: 'bundled skill.json missing or malformed; baseline cannot be verified' });
      continue;
    }
    if (hashJson(bundled.data.triggerPolicy) !== hashJson(entry.triggerPolicy)) {
      items.push({ id, status: 'manual', detail: 'bundled triggerPolicy differs from baseline; regenerate baseline from the reviewed source' });
      continue;
    }

    const installedDir = path.join(opts.skillsDir, id);
    const installed = readJsonFile(path.join(installedDir, 'skill.json'));
    if (installed.state === 'missing') {
      items.push({ id, status: 'skipped', detail: 'not installed as a structured skill.json; frontmatter-only installs are not migrated' });
      continue;
    }
    if (installed.state === 'malformed') {
      items.push({ id, status: 'manual', detail: `installed skill.json malformed (${installed.error}); preserved` });
      continue;
    }

    const overlay = readJsonFile(path.join(opts.skillsDir, '.manifests', `${id}.skill.json`));
    if (overlay.state === 'malformed') {
      items.push({ id, status: 'manual', detail: 'overlay manifest malformed; preserved, no writes' });
      continue;
    }
    // Any v1 or v2 trigger field in the overlay wins or supersedes the native manifest: never migrate over it.
    const OVERLAY_TRIGGER_KEYS = ['triggerPolicy', 'triggers', 'promptSignals'];
    if (overlay.state === 'ok' && OVERLAY_TRIGGER_KEYS.some((k) => k in overlay.data)) {
      items.push({ id, status: 'preserved-overlay', detail: 'overlay defines trigger fields (triggerPolicy/triggers/promptSignals); preserved, no writes' });
      continue;
    }

    const current = installed.data;
    if ('triggerPolicy' in current) {
      const same = hashJson(current.triggerPolicy) === hashJson(entry.triggerPolicy);
      items.push(same
        ? { id, status: 'current', detail: 'triggerPolicy already matches bundled policy' }
        : { id, status: 'preserved-custom', detail: 'installed triggerPolicy differs from bundled; customized policy preserved' });
      continue;
    }

    const { triggerPolicy: _ignored, ...withoutPolicy } = current;
    if (hashJson(withoutPolicy) !== entry.priorManifestHash) {
      items.push({ id, status: 'manual', detail: 'installed manifest differs from the shipped baseline (customized or ambiguous); preserved, add triggerPolicy manually' });
      continue;
    }

    const target = path.join(installedDir, 'skill.json');
    const before = installed.raw;
    const after = serialize({ ...current, triggerPolicy: entry.triggerPolicy });
    writes.push({ id, target, before, after });
    items.push({ id, status: 'add', target, detail: 'unchanged shipped manifest; triggerPolicy will be added' });
  }

  return { items, writes };
}

function countItems(items: TriggerMigrationItem[]): Record<TriggerMigrationStatus, number> {
  const counts = emptyCounts();
  for (const item of items) counts[item.status]++;
  return counts;
}

/**
 * Run the migration. Dry-run unless opts.apply === true.
 * Any malformed input aborts before the first write. Writes are snapshotted
 * first (backupDir/<id>/skill.json + manifest.json) so rollbackTriggerPolicyMigration
 * can restore the exact prior bytes.
 */
export function runTriggerPolicyMigration(opts: TriggerMigrationOptions): TriggerMigrationReport {
  const plan = planTriggerPolicyMigration(opts);
  const base = { applied: false, items: plan.items, counts: countItems(plan.items) };
  if (plan.fatal) return { ...base, fatal: plan.fatal, counts: countItems(plan.items) };
  if (!opts.apply) return base;

  const malformed = plan.items.filter((i) => /malformed/.test(i.detail));
  if (malformed.length > 0) {
    return { ...base, fatal: `refusing to write: ${malformed.map((i) => i.id).join(', ')} malformed`, counts: countItems(plan.items) };
  }
  if (plan.writes.length === 0) return { ...base, applied: true };

  const now = opts.now ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupRoot = opts.backupRoot ?? path.join(path.dirname(opts.skillsDir), '.trigger-policy-backups');
  const snapshotDir = path.join(backupRoot, stamp);
  fs.mkdirSync(snapshotDir, { recursive: true });

  const manifest: Array<{ id: string; target: string; beforeSha256: string; afterSha256: string }> = [];
  for (const write of plan.writes) {
    const dir = path.join(snapshotDir, write.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'skill.json'), write.before, 'utf-8');
    manifest.push({
      id: write.id,
      target: write.target,
      beforeSha256: crypto.createHash('sha256').update(write.before).digest('hex'),
      afterSha256: crypto.createHash('sha256').update(write.after).digest('hex'),
    });
  }
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), `${JSON.stringify({ version: 1, writes: manifest }, null, 2)}\n`, 'utf-8');

  for (const write of plan.writes) {
    const tmp = `${write.target}.trigger-tmp`;
    fs.writeFileSync(tmp, write.after, 'utf-8');
    fs.renameSync(tmp, write.target);
  }

  return { ...base, applied: true, snapshotDir, counts: countItems(plan.items) };
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const sha256Text = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');

export interface TriggerRollbackReport {
  restored: string[];
  /** Targets changed (or removed) since apply; left untouched so later user edits survive. */
  conflicts: Array<{ id: string; target: string; reason: string }>;
}

/**
 * Restore each file recorded in a snapshot manifest, byte-for-byte, but ONLY
 * where the current file still holds the bytes this migration wrote
 * (afterSha256). Anything edited since apply is reported in conflicts[] and
 * left alone. Snapshot entries, targets and snapshot bytes are validated before
 * any write; each restore is atomic (tmp + rename).
 */
export function rollbackTriggerPolicyMigration(snapshotDir: string): TriggerRollbackReport {
  const manifestPath = path.join(snapshotDir, 'manifest.json');
  const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { version?: unknown; writes?: unknown };
  if (data.version !== 1 || !Array.isArray(data.writes)) {
    throw new Error(`rollback: invalid snapshot manifest at ${manifestPath}`);
  }

  const plan = data.writes.map((raw) => {
    const w = (raw ?? {}) as Record<string, unknown>;
    const id = w.id;
    const target = w.target;
    const beforeSha = w.beforeSha256;
    const afterSha = w.afterSha256;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(id) || id.includes('..')) {
      throw new Error(`rollback: invalid snapshot id ${String(id)}`);
    }
    if (
      typeof target !== 'string' ||
      !path.isAbsolute(target) ||
      path.basename(target) !== 'skill.json' ||
      path.basename(path.dirname(target)) !== id
    ) {
      throw new Error(`rollback: invalid target for ${id}`);
    }
    if (typeof beforeSha !== 'string' || !SHA256_HEX.test(beforeSha) || typeof afterSha !== 'string' || !SHA256_HEX.test(afterSha)) {
      throw new Error(`rollback: invalid sha256 fields for ${id}`);
    }
    const snapFile = path.join(snapshotDir, id, 'skill.json');
    if (!fs.existsSync(snapFile)) throw new Error(`rollback: snapshot bytes missing for ${id}`);
    const before = fs.readFileSync(snapFile, 'utf-8');
    if (sha256Text(before) !== beforeSha) throw new Error(`rollback: snapshot bytes for ${id} fail sha256 check`);
    return { id, target, before, afterSha };
  });

  const restored: string[] = [];
  const conflicts: TriggerRollbackReport['conflicts'] = [];
  for (const p of plan) {
    if (!fs.existsSync(p.target)) {
      conflicts.push({ id: p.id, target: p.target, reason: 'file removed since apply; not recreated' });
      continue;
    }
    const current = fs.readFileSync(p.target, 'utf-8');
    if (sha256Text(current) !== p.afterSha) {
      conflicts.push({ id: p.id, target: p.target, reason: 'changed since apply; later edit preserved' });
      continue;
    }
    const tmp = `${p.target}.rollback-tmp`;
    fs.writeFileSync(tmp, p.before, 'utf-8');
    fs.renameSync(tmp, p.target);
    restored.push(p.target);
  }
  return { restored, conflicts };
}

/**
 * Derive a version-1 baseline from the shipped bundle itself, so callers need no
 * extra packaging file. For each shipped skill.json that carries a valid
 * triggerPolicy: priorManifestHash = hash of that same manifest WITHOUT
 * triggerPolicy (the pre-v2 shape an install was seeded with). Skills whose
 * shipped policy fails the engine validator are excluded and listed.
 */
export function deriveTriggerBaseline(bundledSkillsDir: string): { baseline: TriggerBaselineFile; excluded: string[] } {
  const skills: Record<string, TriggerBaselineEntry> = {};
  const excluded: string[] = [];
  if (!fs.existsSync(bundledSkillsDir)) return { baseline: { version: TRIGGER_BASELINE_VERSION, skills }, excluded };

  for (const entry of fs.readdirSync(bundledSkillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(entry.name) || entry.name.includes('..')) continue;
    const read = readJsonFile(path.join(bundledSkillsDir, entry.name, 'skill.json'));
    if (read.state !== 'ok' || !('triggerPolicy' in read.data)) continue;
    const policy = read.data.triggerPolicy as Record<string, unknown>;
    if (triggerPolicyErrors(policy).length > 0) {
      excluded.push(entry.name);
      continue;
    }
    const prior: Record<string, unknown> = { ...read.data };
    delete prior.triggerPolicy;
    skills[entry.name] = { priorManifestHash: hashJson(prior), triggerPolicy: policy };
  }
  return { baseline: { version: TRIGGER_BASELINE_VERSION, skills }, excluded };
}
