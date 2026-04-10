#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distCli = path.join(rootDir, 'dist', 'cli', 'index.js');

if (fs.existsSync(distCli)) {
  require(distCli);
  process.exit(0);
}

const isWin = process.platform === 'win32';
const tsxBin = path.join(rootDir, 'node_modules', '.bin', isWin ? 'tsx.cmd' : 'tsx');
const launcher = fs.existsSync(tsxBin) ? tsxBin : 'npx';
const launcherArgs = fs.existsSync(tsxBin)
  ? ['src/cli/index.ts', ...process.argv.slice(2)]
  : ['tsx', 'src/cli/index.ts', ...process.argv.slice(2)];

const result = spawnSync(launcher, launcherArgs, {
  cwd: rootDir,
  stdio: 'inherit',
  shell: isWin && launcher.endsWith('.cmd'),
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

if (result.error) {
  console.error(`[prom] Failed to launch CLI: ${result.error.message}`);
} else {
  console.error('[prom] Failed to launch CLI.');
}
process.exit(1);
