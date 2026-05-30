#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const entry = path.join(root, 'src', 'cli', 'index.ts');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx.cmd');

const result = spawnSync(tsx, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
  shell: true,
});

if (result.error) {
  console.error('[prom] Failed to launch:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 0);
