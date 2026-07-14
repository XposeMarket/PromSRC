import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const includeLive = process.argv.includes('--with-live');

function testFilesUnder(relativeRoots) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(full);
    }
  };
  for (const root of relativeRoots) walk(path.join(repoRoot, root));
  return files.sort();
}

const commands = [
  ['skill safety scanner', ['scripts/test-skill-safety-scanner.mjs']],
  ['live catalog routing/trigger gate', ['scripts/test-live-skill-catalog.mjs']],
  ['catalog structure/link/date gate', ['scripts/test-skill-catalog-structure.mjs']],
  ['curator evidence/write-policy gate', ['scripts/test-skill-curator-pipeline.mjs']],
  ['skill routing regression', ['scripts/test-skill-routing.mjs']],
  ['self-repair diagnostics', ['scripts/test-self-repair-diagnostics.mjs']],
  ['phase 3 skill contracts', ['scripts/test-phase3-batch3-skills.mjs']],
  ['phase 3 fail-closed regression', ['scripts/test-phase3-fail-closed.mjs']],
  ['phase 4C operational skills', ['scripts/test-phase4c-operational-skills.mjs']],
  ['database skill', ['scripts/test-database-query-skill.mjs']],
  ['webhook security', ['scripts/test-webhook-provider-security.mjs']],
  ['HyperFrames catalog status', ['scripts/test-hyperframes-catalog-status.mjs']],
  ['HyperFrames roundtrip', ['scripts/test-hyperframes-roundtrip.mjs']],
  ['HyperFrames catalog/render pipeline', ['scripts/test-hyperframes-catalog-pipeline.mjs']],
  ['public skill bundle', ['scripts/prepare-public-build.js', '--skills-only']],
  ['public skill content/boundary gate', ['scripts/test-public-skill-bundle.mjs']],
  ['self-repair public/dev boundary', ['scripts/test-self-repair-skill-boundary.mjs']],
  ['media-use and HyperFrames skill-local unit suite', [
    '--test', '--test-concurrency=1',
    ...testFilesUnder([
      'workspace/skills/media-use',
      'workspace/skills/hyperframes-animation',
      'workspace/skills/hyperframes-creative',
    ]),
  ]],
];

if (includeLive) commands.splice(11, 0, ['live X bounded-read smoke', ['scripts/test-x-live-smoke.mjs']]);

const failed = [];
for (const [label, args] of commands) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, PYTHONUTF8: '1' },
    stdio: 'inherit',
  });
  if (result.status !== 0) failed.push({ label, status: result.status, signal: result.signal });
}

if (failed.length) {
  console.error(`\nSkill revamp closeout failed: ${failed.length}/${commands.length} command groups.`);
  for (const failure of failed) console.error(`- ${failure.label}: ${failure.status ?? failure.signal}`);
  process.exit(1);
}

console.log(`\nSkill revamp closeout passed: ${commands.length}/${commands.length} command groups${includeLive ? ' including live X' : ''}.`);
