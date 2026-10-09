/**
 * Regression test for scripts/prune-dist.js (legacy cleanup PR-5).
 * Builds a throwaway repo layout and checks that orphaned dist output is
 * reported by --check, removed by the default mode, and that every
 * source-owned file and copied asset survives.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'prune-dist.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-dist-'));

function write(rel, text = 'x') {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
const has = (rel) => fs.existsSync(path.join(root, rel));
const run = (...args) => spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' });

try {
  // Sources
  write('src/cli/index.ts');
  write('src/gateway/chat/view.tsx');
  write('src/config/soul.md');
  write('src/extensions/bundled/connectors/github.json');
  write('src/extensions/bundled/connectors/_runtime/api-request.ts');
  write('src/gateway/creative/renderers/ascii_renderer.py');
  write('extensions/prometheus-personal-chrome/manifest.json');
  write('extensions/prometheus-personal-chrome/service-worker.js');

  // Owned dist output
  const owned = [
    'dist/.tsbuildinfo',
    'dist/cli/index.js', 'dist/cli/index.js.map', 'dist/cli/index.d.ts', 'dist/cli/index.d.ts.map',
    'dist/gateway/chat/view.js',
    'dist/config/soul.md',
    'dist/extensions/bundled/connectors/github.json',
    'dist/extensions/bundled/connectors/_runtime/api-request.ts',
    'dist/extensions/bundled/connectors/_runtime/api-request.js',
    'dist/gateway/creative/renderers/ascii_renderer.py',
    'dist/extensions/prometheus-personal-chrome/manifest.json',
    'dist/extensions/prometheus-personal-chrome/service-worker.js',
  ];
  // Orphans: retired modules, a stale copied asset, a removed chrome file, a stray temp file
  const orphans = [
    'dist/agents/reactor.js', 'dist/agents/reactor.js.map', 'dist/agents/reactor.d.ts', 'dist/agents/reactor.d.ts.map',
    'dist/gateway/turn-workers/protocol.js',
    'dist/config/old-soul.md',
    'dist/extensions/bundled/connectors/_runtime/social-api-request.js',
    'dist/extensions/bundled/connectors/github.json.tmp',
    'dist/extensions/prometheus-personal-chrome/options.js',
  ];
  for (const rel of [...owned, ...orphans]) write(rel);

  // --check reports and changes nothing
  let r = run('--check');
  assert.equal(r.status, 1, '--check must fail when orphans exist');
  assert.match(r.stderr, /9 file\(s\), 6 module\(s\)/);
  assert.ok(orphans.every(has), '--check must not delete anything');

  // default mode prunes exactly the orphans
  r = run();
  assert.equal(r.status, 0, r.stderr);
  for (const rel of orphans) assert.ok(!has(rel), `orphan survived: ${rel}`);
  for (const rel of owned) assert.ok(has(rel), `owned file removed: ${rel}`);
  assert.ok(!has('dist/agents'), 'empty directories are removed');
  assert.ok(!has('dist/gateway/turn-workers'), 'empty nested directories are removed');
  assert.ok(has('dist'), 'dist itself is kept');

  // now clean
  r = run('--check');
  assert.equal(r.status, 0, r.stderr);

  // --all wipes dist
  r = run('--all');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!has('dist'), '--all removes dist');
  assert.ok(has('src/cli/index.ts'), '--all never touches src');

  // missing dist is fine in every mode
  for (const mode of [[], ['--check'], ['--all']]) assert.equal(run(...mode).status, 0);

  // unknown args fail loudly
  assert.equal(run('--bogus').status, 2);

  // package.json wiring: every build path prunes, release paths wipe
  const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
  assert.match(pkg.scripts['build:backend'], /^node scripts\/prune-dist\.js --quiet && tsc/);
  for (const name of ['build:win', 'build:mac', 'prepare:public:desktop']) {
    assert.match(pkg.scripts[name], /^npm run clean:dist && /, `${name} must start from an empty dist`);
  }
  assert.equal(pkg.scripts['clean:dist'], 'node scripts/prune-dist.js --all');
  assert.equal(pkg.scripts['check:dist'], 'node scripts/prune-dist.js --check');

  console.log('prune-dist: all checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
