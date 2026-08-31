import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'scripts', 'web-ui-architecture-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const failures = [];

// These ceilings are code-owned review boundaries, not values loaded from the
// editable baseline document. The JSON ratchet can move down as owners leave a
// legacy surface, but raising it alone can never make a growth regression pass.
// A ceiling change therefore appears as executable policy in review.
const CODE_OWNED_LEGACY_CEILINGS = Object.freeze({
  'web-ui/src/pages/ChatPage.js': 2334533,
  'web-ui/src/mobile/mobile-pages.js': 899829,
  'web-ui/src/mobile/mobile-chat-renderer-runtime.js': 231112,
  'web-ui/src/styles/mobile.css': 585898,
  'web-ui/src/styles/components.css': 284925,
  'web-ui/index.html': 558138,
});
const CODE_OWNED_NEW_MODULE_CEILING = 400000;

if (baseline.version !== 3) failures.push(`architecture baseline version must be 3 (received ${baseline.version})`);
for (const [relativePath, ceiling] of Object.entries(CODE_OWNED_LEGACY_CEILINGS)) {
  const configured = Number(baseline.legacySurfaces?.[relativePath]);
  if (!Number.isFinite(configured)) {
    failures.push(`${relativePath}: missing JSON ratchet`);
  } else if (configured > ceiling) {
    failures.push(`${relativePath}: JSON ratchet ${configured} exceeds code-owned ceiling ${ceiling}`);
  }
}
if (Number(baseline.maxNewModuleBytes) > CODE_OWNED_NEW_MODULE_CEILING) {
  failures.push(`new module JSON ceiling ${baseline.maxNewModuleBytes} exceeds code-owned ceiling ${CODE_OWNED_NEW_MODULE_CEILING}`);
}

function bytes(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    failures.push(`${relativePath}: missing`);
    return 0;
  }
  // Git may materialize text as CRLF on Windows. Architecture budgets measure
  // canonical LF bytes so the same commit has the same result on every runner.
  if (/\.(?:js|mjs|css|html)$/i.test(relativePath)) {
    return Buffer.byteLength(fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n'));
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
const maxNewModuleBytes = Math.min(
  Number(baseline.maxNewModuleBytes || CODE_OWNED_NEW_MODULE_CEILING),
  CODE_OWNED_NEW_MODULE_CEILING,
);

function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function validateChatFeatureDependencies(absolute, relativePath) {
  if (!/^web-ui\/src\/features\/chat\/.+\.(?:js|mjs)$/i.test(relativePath)) return;
  const source = fs.readFileSync(absolute, 'utf8');
  for (const specifier of importSpecifiers(source)) {
    if (!specifier.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(absolute), specifier).split(path.sep).join('/');
    const relativeTarget = path.relative(root, resolved).split(path.sep).join('/');
    if (relativeTarget.startsWith('web-ui/src/pages/') || relativeTarget === 'web-ui/src/mobile/mobile-pages.js') {
      failures.push(`${relativePath}: chat features must not import page owner ${relativeTarget}`);
    }
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!/\.(?:js|mjs|css)$/i.test(entry.name)) continue;
    const relativePath = path.relative(root, absolute).split(path.sep).join('/');
    validateChatFeatureDependencies(absolute, relativePath);
    if (legacy.has(relativePath)) continue;
    const actual = bytes(relativePath);
    if (actual > maxNewModuleBytes) {
      failures.push(`${relativePath}: ${actual} bytes exceeds module ceiling ${maxNewModuleBytes}`);
    }
  }
}

walk(path.join(root, 'web-ui', 'src'));

for (const required of [
  'workspace/self/WEB_UI_ARCHITECTURE.md',
  'workspace/self/WEB_UI_ARCHITECTURE_PERFORMANCE_REVIEW_2026-08-19.md',
  'workspace/self/WEB_UI_PERFORMANCE_PROGRAM_2026-08-22.md',
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
