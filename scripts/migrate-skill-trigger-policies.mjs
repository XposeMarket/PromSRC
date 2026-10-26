#!/usr/bin/env node
// Policy-only trigger migration for installed skills.
//
// Dry-run by default. Pass --apply to write, and only into the supplied skills root.
// Run with tsx so the TypeScript migration module loads:
//   node --import tsx scripts/migrate-skill-trigger-policies.mjs --root <promRoot> --bundled-dir <dir> --baseline <file> [--apply] [--json]
//
// Options:
//   --root <dir>          installed workspace root; skills are read from <dir>/skills
//   --skills-dir <dir>    installed skills directory (alternative to --root)
//   --bundled-dir <dir>   shipped skills directory the baseline was generated from
//   --source-root <dir>   root for baseline entries with sourceRelDir (e.g. connector skill folders)
//   --baseline <file>     reviewed trigger baseline JSON (version 1)
//   --backup-root <dir>   snapshot root (default: <skills parent>/.trigger-policy-backups)
//   --apply               write changes (otherwise report only)
//   --json                print the report as JSON
//
// Exit codes: 0 = ok (including manual/preserved items), 1 = usage error, 2 = fatal (nothing written).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error('usage: node --import tsx scripts/migrate-skill-trigger-policies.mjs (--root <dir> | --skills-dir <dir>) --bundled-dir <dir> --baseline <file> [--source-root <dir>] [--backup-root <dir>] [--apply] [--json]');
  process.exit(1);
}

function parseArgs(argv) {
  const out = { apply: false, json: false };
  const valueFlags = new Set(['--root', '--skills-dir', '--bundled-dir', '--source-root', '--baseline', '--backup-root']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--json') out.json = true;
    else if (valueFlags.has(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) usage(`${arg} requires a value`);
      out[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    } else usage(`unknown argument: ${arg}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.skillsDir && !args.root) usage('one of --root or --skills-dir is required');
if (!args.bundledDir) usage('--bundled-dir is required');
if (!args.baseline) usage('--baseline is required');

const skillsDir = path.resolve(args.skillsDir ?? path.join(args.root, 'skills'));
const bundledSkillsDir = path.resolve(args.bundledDir);
const baselinePath = path.resolve(args.baseline);

let baseline;
try {
  // Strip a UTF-8 BOM before parsing.
  baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8').replace(/^\uFEFF/, ''));
} catch (err) {
  console.error(`fatal: cannot read baseline ${baselinePath}: ${err.message}`);
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = pathToFileURL(path.resolve(here, '..', 'src', 'config', 'skill-trigger-migration.ts')).href;
const migration = await import(moduleUrl);

const report = migration.runTriggerPolicyMigration({
  skillsDir,
  bundledSkillsDir,
  sourceRoot: args.sourceRoot ? path.resolve(args.sourceRoot) : undefined,
  baseline,
  apply: args.apply,
  backupRoot: args.backupRoot ? path.resolve(args.backupRoot) : undefined,
});

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`mode: ${args.apply ? 'apply' : 'dry-run'} skills=${skillsDir}`);
  for (const item of report.items) {
    console.log(`${item.status.padEnd(17)} ${item.id}: ${item.detail}`);
  }
  console.log(`counts: ${JSON.stringify(report.counts)}`);
  if (report.snapshotDir) console.log(`snapshot: ${report.snapshotDir}`);
  if (report.fatal) console.log(`fatal: ${report.fatal}`);
  if (!args.apply && report.items.some((i) => i.status === 'add')) console.log('dry-run only: re-run with --apply to write');
}

process.exit(report.fatal ? 2 : 0);
