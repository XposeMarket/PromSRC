#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(repoRoot, 'src', 'gateway', 'creative', 'renderers');
const targetDir = path.join(repoRoot, 'dist', 'gateway', 'creative', 'renderers');

if (!fs.existsSync(sourceDir)) {
  console.warn(`[build] No Creative renderer source directory found: ${sourceDir}`);
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const ext = path.extname(entry.name).toLowerCase();
  if (!['.py'].includes(ext)) continue;
  fs.copyFileSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
}

console.log(`[build] Copied Creative renderers: ${sourceDir} -> ${targetDir}`);
