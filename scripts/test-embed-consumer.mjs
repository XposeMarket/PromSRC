#!/usr/bin/env node
// Proves the embedding API works from a separate Node project: copies
// examples/embed-consumer to a temp dir, links this repo in as the
// `prometheus` dependency (as `npm install file:<repo>` would), and runs it
// with plain node. Only the public `prometheus/embed` export is used.
// Requires a prior `npm run build:backend` (test:embed does that).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!fs.existsSync(path.join(repo, 'dist', 'embed', 'index.js'))) {
  console.error('dist/embed/index.js missing: run npm run build:backend first');
  process.exit(1);
}

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-embed-consumer-'));
try {
  const example = path.join(repo, 'examples', 'embed-consumer');
  for (const file of ['index.mjs', 'package.json']) fs.copyFileSync(path.join(example, file), path.join(project, file));
  // Equivalent of `npm install file:<repo>` without copying node_modules:
  // a symlink/junction named node_modules/prometheus pointing at the repo.
  fs.mkdirSync(path.join(project, 'node_modules'), { recursive: true });
  fs.symlinkSync(repo, path.join(project, 'node_modules', 'prometheus'), process.platform === 'win32' ? 'junction' : 'dir');

  const run = spawnSync(process.execPath, ['index.mjs'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  process.stdout.write(run.stdout || '');
  if (run.status !== 0) {
    process.stderr.write(run.stderr || '');
    console.error(`embed consumer failed (exit ${run.status}${run.signal ? `, signal ${run.signal}` : ''})`);
    process.exit(1);
  }
  if (!/embed-consumer: ok/.test(run.stdout || '')) {
    console.error('embed consumer did not report ok');
    process.exit(1);
  }
} finally {
  try { fs.rmSync(project, { recursive: true, force: true, maxRetries: 3 }); } catch {}
}
