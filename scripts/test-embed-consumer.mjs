#!/usr/bin/env node
// Verify the public export from an installed npm tarball, never a source junction.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-embed-packed-'));
function npm(args, cwd) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd, encoding: 'utf8', timeout: 300_000, shell: process.platform === 'win32',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
  });
  if (result.status !== 0) {
    const detail = String(result.error || result.stderr || result.stdout);
    if (process.env.GITHUB_ACTIONS === 'true') console.error(`::error title=Packed consumer install::${detail.slice(-6000).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
    throw new Error(`npm ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout;
}
try {
  if (!fs.existsSync(path.join(repo, 'dist/embed/index.js'))) throw new Error('Run npm run build:backend first');
  for (const file of ['index.mjs', 'package.json']) fs.copyFileSync(path.join(repo, 'examples/embed-consumer', file), path.join(project, file));
  const packed = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', project], repo));
  const tarball = path.join(project, packed[0].filename);
  if (!packed[0].files.some(file => file.path === 'dist/embed/index.js')) throw new Error('Packed public embedding export is missing');
  if (process.argv.includes('--shared-dependencies')) {
    // Explicit cache-independent diagnostic: real packed bytes, host dependency tree.
    // This is not evidence of an independent npm dependency installation.
    const target = path.join(project, 'node_modules/prometheus');
    fs.mkdirSync(target, { recursive: true });
    const unpack = spawnSync('tar', ['-xzf', tarball, '--strip-components=1', '-C', target], { encoding: 'utf8', timeout: 120_000 });
    if (unpack.status !== 0) throw new Error(`Tar extraction failed: ${unpack.error || unpack.stderr}`);
  } else {
    npm(['install', ...(process.argv.includes('--online-install') ? ['--prefer-online'] : ['--offline']), '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund', tarball], project);
    // node-pty ships a Windows binary, but Unix requires its native lifecycle
    // build. Keep general install scripts disabled and build this dependency
    // explicitly in the isolated consumer, as the CI checkout does.
    if (process.platform !== 'win32') npm(['rebuild', 'node-pty'], project);
  }
  const installed = path.join(project, 'node_modules/prometheus');
  if (fs.lstatSync(installed).isSymbolicLink()) throw new Error('Expected installed package, not source link');
  const run = spawnSync(process.execPath, ['index.mjs'], {
    cwd: project, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, NODE_ENV: 'production', ...(process.argv.includes('--shared-dependencies') ? { NODE_PATH: path.join(repo, 'node_modules') } : {}) },
  });
  process.stdout.write(run.stdout || '');
  if (run.status !== 0 || !/embed-consumer: ok/.test(run.stdout || '')) {
    const detail = String(run.error || run.stderr || run.status);
    if (process.env.GITHUB_ACTIONS === 'true') console.error(`::error title=Packed consumer runtime::${detail.slice(0, 6000).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
    throw new Error(`Consumer failed: ${detail}`);
  }
  console.log(`packed consumer: PASS (${packed[0].filename}; ${process.argv.includes('--shared-dependencies') ? 'shared external dependencies (not independent install)' : process.argv.includes('--online-install') ? 'registry-assisted install; runtime network denied' : 'offline install'}; public export; no source link)`);
} finally {
  try { fs.rmSync(project, { recursive: true, force: true, maxRetries: 3 }); } catch {}
}
