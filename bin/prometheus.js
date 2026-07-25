#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const entry = path.join(root, 'src', 'cli', 'index.ts');
const tsx = (() => {
  const binDir = path.join(root, 'node_modules', '.bin');
  const unix = path.join(binDir, 'tsx');
  const windows = path.join(binDir, 'tsx.cmd');
  if (require('fs').existsSync(unix)) return unix;
  if (require('fs').existsSync(windows)) return windows;
  return unix;
})();

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
