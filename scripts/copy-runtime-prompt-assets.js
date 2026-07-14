#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(repoRoot, 'src', 'config');
const targetDir = path.join(repoRoot, 'dist', 'config');
const promptFiles = [
  'soul.md',
  'subagent-soul.md', // legacy rollback fallback; not injected by current agent paths
  'prometheus-runtime-contract.md',
  'voice-soul.md',
];

fs.mkdirSync(targetDir, { recursive: true });
for (const filename of promptFiles) {
  const source = path.join(sourceDir, filename);
  if (!fs.existsSync(source)) throw new Error(`[build] Missing runtime prompt asset: ${source}`);
  fs.copyFileSync(source, path.join(targetDir, filename));
}

console.log(`[build] Copied runtime prompt assets: ${promptFiles.join(', ')}`);
