#!/usr/bin/env node
// Apply REVIEWED trigger-policy rows to source skill manifests (policy-only).
//
// Dry-run by default. --root is required and explicit; nothing outside it is written.
//   node --import tsx scripts/apply-reviewed-skill-catalog.mjs --root <repoRoot> [--rows <file>] [--fixture-out <dir>] [--apply] [--json]
//
// Rows file: { rows: [...] } or a bare array. Each row:
//   id, triggerPolicy (v2), visibility ('public'|'unspecified'|'local'|'bundled-connector'),
//   localOnly (bool), optional connector ('github'|'gmail'|'google_drive'), optional target ('overlay').
// Only the triggerPolicy key is written. All other manifest fields are preserved.
// localOnly rows never touch source: they are reported as local-pending (policy-only fixture).
//
// Exit codes: 0 ok (manual/preserved items included), 1 usage error, 2 fatal (nothing written).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONNECTOR_DIRS = {
  github: 'src/extensions/bundled/connectors/github/skill',
  gmail: 'src/extensions/bundled/connectors/gmail/skill',
  google_drive: 'src/extensions/bundled/connectors/google_drive/skill',
};
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const VISIBILITIES = new Set(['public', 'personal', 'dev', 'unspecified', 'local', 'bundled-connector']);

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error('usage: node --import tsx scripts/apply-reviewed-skill-catalog.mjs --root <dir> [--rows <file>] [--fixture-out <dir>] [--apply] [--json]');
  process.exit(1);
}

function parseArgs(argv) {
  const out = { root: null, rows: path.join('.pr', 'CATALOG-POLICIES.json'), fixtureOut: null, apply: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--root' || arg === '--rows' || arg === '--fixture-out') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) usage(`${arg} requires a value`);
      if (arg === '--root') out.root = value;
      else if (arg === '--rows') out.rows = value;
      else out.fixtureOut = value;
    } else usage(`unknown argument: ${arg}`);
  }
  if (!out.root) usage('--root is required (explicit source root; no default)');
  return out;
}

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

/** Resolve the target manifest for a row. Returns { kind, file } or { kind: 'manual', detail }. */
const CONNECTOR_IDS = { 'connector-github': 'github', 'connector-gmail': 'gmail', 'connector-google-drive': 'google_drive' };

export function resolveTarget(root, row) {
  const connector = row.connector ?? (row.visibility === 'bundled-connector' ? CONNECTOR_IDS[row.id] : undefined);
  if (connector) {
    const dir = CONNECTOR_DIRS[connector];
    if (!dir) return { kind: 'manual', detail: `unknown connector: ${row.connector}` };
    return { kind: 'connector', file: path.join(root, dir, 'skill.json') };
  }
  const skillsDir = path.join(root, 'workspace', 'skills');
  const canonical = path.join(skillsDir, row.id, 'skill.json');
  const overlay = path.join(skillsDir, '.manifests', `${row.id}.skill.json`);
  if (row.target === 'overlay') return { kind: 'overlay', file: overlay };
  if (fs.existsSync(canonical)) return { kind: 'canonical', file: canonical };
  if (fs.existsSync(overlay)) return { kind: 'overlay', file: overlay };
  return { kind: 'manual', detail: 'no canonical skill.json or .manifests overlay in source' };
}

/** Load reviewed rows from { rows: [...] } or a bare array. Throws on malformed input. */
export function loadRows(file) {
  const data = readJson(file);
  const rows = Array.isArray(data) ? data : data && Array.isArray(data.rows) ? data.rows : null;
  if (!rows) throw new Error('rows file must be an array or an object with a rows array');
  return rows;
}

/** Plan one row without writing. Returns { id, status, target?, detail, policy? }. */
export function planRow(root, row, validatePolicy) {
  const id = typeof row.id === 'string' ? row.id : '';
  if (!ID_RE.test(id) || id.includes('..')) return { id: String(row.id), status: 'manual', detail: 'invalid id' };
  if (!VISIBILITIES.has(row.visibility)) return { id, status: 'manual', detail: `unknown visibility: ${row.visibility}` };
  if (row.localOnly === true || row.visibility === 'local') {
    // Runtime-only: no source write, no private instructions copied. Policy stays in the reviewed fixture.
    return { id, status: 'local-pending', detail: 'runtime-only; policy recorded in fixture, not applied to source' };
  }
  const errors = validatePolicy(row.triggerPolicy);
  if (errors.length > 0) return { id, status: 'manual', detail: `invalid triggerPolicy: ${errors[0]}` };
  const target = resolveTarget(root, row);
  if (target.kind === 'manual') return { id, status: 'manual', detail: target.detail };
  if (!fs.existsSync(target.file)) return { id, status: 'manual', detail: `target not found: ${path.relative(root, target.file)}` };
  let manifest;
  try {
    manifest = readJson(target.file);
  } catch (err) {
    return { id, status: 'manual', detail: `target malformed: ${err.message}` };
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { id, status: 'manual', detail: 'target is not a JSON object' };
  }
  const rel = path.relative(root, target.file).replace(/\\/g, '/');
  // Source overlays are canonical reviewed input: v1 triggers/promptSignals are kept as-is and v2 is added beside them.
  if (JSON.stringify(manifest.triggerPolicy) === JSON.stringify(row.triggerPolicy)) {
    return { id, status: 'current', target: rel, detail: 'already has reviewed triggerPolicy' };
  }
  if (manifest.triggerPolicy !== undefined) {
    return { id, status: 'manual', target: rel, detail: 'existing triggerPolicy differs; preserved, not overwritten' };
  }
  return { id, status: 'add', target: rel, detail: 'adds reviewed triggerPolicy', policy: row.triggerPolicy };
}

async function loadValidator() {
  const mod = await import(pathToFileURL(path.join(SCRIPT_DIR, '..', 'src', 'gateway', 'skills-runtime', 'skill-package.ts')).href);
  if (typeof mod.validateSkillTriggerPolicy !== 'function') throw new Error('validateSkillTriggerPolicy not exported');
  return (policy) => mod.validateSkillTriggerPolicy(policy).errors;
}

function writeAtomic(file, text) {
  const tmp = `${file}.catalog-tmp`;
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, file);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(opts.root);
  if (!fs.existsSync(root)) {
    console.error(`fatal: root not found: ${root}`);
    process.exit(2);
  }
  let rows;
  let validatePolicy;
  try {
    rows = loadRows(path.resolve(root, opts.rows));
    validatePolicy = await loadValidator();
  } catch (err) {
    console.error(`fatal: ${err.message}`);
    process.exit(2);
  }

  const items = rows.map((row) => planRow(root, row, validatePolicy));
  const counts = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;

  const writes = items.filter((item) => item.status === 'add');
  if (opts.apply) {
    for (const item of writes) {
      const file = path.join(root, item.target);
      const manifest = readJson(file);
      manifest.triggerPolicy = item.policy;
      writeAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }

  if (opts.fixtureOut) {
    // Policy-only fixture: never includes SKILL.md or private instructions.
    const fixture = {
      version: 1,
      generated: new Date().toISOString(),
      localPending: items.filter((i) => i.status === 'local-pending').map((i) => i.id),
      policies: rows.filter((r) => r.localOnly === true || r.visibility === 'local')
        .map((r) => ({ id: r.id, triggerPolicy: r.triggerPolicy })),
    };
    fs.mkdirSync(path.resolve(opts.fixtureOut), { recursive: true });
    writeAtomic(path.join(path.resolve(opts.fixtureOut), 'local-pending.json'), `${JSON.stringify(fixture, null, 2)}\n`);
  }

  const report = { applied: opts.apply, root, counts, items: items.map(({ policy, ...rest }) => rest) };
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${opts.apply ? 'APPLIED' : 'DRY-RUN'} ${root}`);
    for (const item of report.items) console.log(`  ${item.status.padEnd(16)} ${item.id}  ${item.detail}`);
    console.log(JSON.stringify(counts));
  }
  process.exit(0);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) main();
