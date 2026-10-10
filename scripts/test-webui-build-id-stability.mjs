#!/usr/bin/env node
// The web-UI build id must not change when only npm scripts change in
// package.json (every PR adds test:* scripts; hashing them forced a web-ui
// resync on every open PR after any merge). It must still change when a
// dependency changes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const original = fs.readFileSync(pkgPath, 'utf8');
const manifestPath = path.join(root, 'generated', 'public-web-ui', 'asset-manifest.json');
const swPath = path.join(root, 'generated', 'public-web-ui', 'service-worker.js');
const savedManifest = fs.readFileSync(manifestPath);
const savedSw = fs.readFileSync(swPath);

function buildId() {
  const run = spawnSync(process.execPath, ['scripts/build-web-ui-production.mjs'], { cwd: root, encoding: 'utf8', timeout: 180_000 });
  if (run.status !== 0) throw new Error(`build failed: ${run.stderr || run.stdout}`);
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')).buildId;
}

try {
  const base = buildId();
  const pkg = JSON.parse(original);

  pkg.scripts = { ...pkg.scripts, 'test:build-id-probe': 'node -e "0"' };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  assert.equal(buildId(), base, 'adding an npm script must not change the web-ui build id');

  pkg.dependencies = { ...pkg.dependencies, 'left-pad-build-id-probe': '1.0.0' };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  assert.notEqual(buildId(), base, 'changing dependencies must change the web-ui build id');

  console.log(`web-ui build id stability: scripts-only change keeps ${base}; dependency change rotates it`);
} finally {
  fs.writeFileSync(pkgPath, original);
  fs.writeFileSync(manifestPath, savedManifest);
  fs.writeFileSync(swPath, savedSw);
}
