import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'scripts', 'web-ui-architecture-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const failures = [];

function bytes(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    failures.push(`${relativePath}: missing`);
    return 0;
  }
  return fs.statSync(absolute).size;
}

for (const [relativePath, maxBytes] of Object.entries(baseline.legacySurfaces || {})) {
  const actual = bytes(relativePath);
  if (actual > Number(maxBytes)) {
    failures.push(`${relativePath}: grew to ${actual} bytes (ratchet ${maxBytes})`);
  }
}

const legacy = new Set(Object.keys(baseline.legacySurfaces || {}));
const maxNewModuleBytes = Number(baseline.maxNewModuleBytes || 400000);

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!/\.(?:js|mjs|css)$/i.test(entry.name)) continue;
    const relativePath = path.relative(root, absolute).split(path.sep).join('/');
    if (legacy.has(relativePath)) continue;
    const actual = fs.statSync(absolute).size;
    if (actual > maxNewModuleBytes) {
      failures.push(`${relativePath}: ${actual} bytes exceeds module ceiling ${maxNewModuleBytes}`);
    }
  }
}

walk(path.join(root, 'web-ui', 'src'));

for (const required of [
  'workspace/self/WEB_UI_ARCHITECTURE.md',
  'workspace/self/WEB_UI_ARCHITECTURE_PERFORMANCE_REVIEW_2026-08-19.md',
]) {
  if (!fs.existsSync(path.join(root, required))) failures.push(`${required}: missing architecture documentation`);
}

if (failures.length) {
  console.error('Web UI architecture guardrails failed:\n' + failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('Web UI architecture guardrails passed.');
for (const [relativePath, maxBytes] of Object.entries(baseline.legacySurfaces || {})) {
  console.log(`- ${relativePath}: ${bytes(relativePath)} / ${maxBytes} bytes`);
}
console.log(`- new JS/CSS module ceiling: ${maxNewModuleBytes} bytes`);
