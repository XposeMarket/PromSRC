#!/usr/bin/env node
// Regression guard: every `_helper(` called inside the mobile voice runtime
// modules must be declared locally or destructured from the injected scope.
// A missing destructure (e.g. _mobileRealtimeProviderKeyFromSettings after
// #704) throws a ReferenceError only at call time on the device.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// The realtime runtime receives every helper through one destructured `scope`
// object, so an omitted name is a guaranteed device-only ReferenceError.
const files = [
  'web-ui/src/mobile/mobile-voice-realtime-runtime.js',
];

let failures = 0;
for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const declared = new Set();
  for (const m of src.matchAll(/\bfunction\s+(_[A-Za-z]\w*)\s*\(/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+(_[A-Za-z]\w*)\b/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\bimport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(/\s+as\s+/).pop().trim();
      if (name.startsWith('_')) declared.add(name);
    }
  }
  // Destructured scope blocks: `const { a, b, c } = scope`.
  for (const m of src.matchAll(/const\s*\{([\s\S]*?)\}\s*=\s*scope\b/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().split('=')[0].trim();
      if (name.startsWith('_')) declared.add(name);
    }
  }
  const missing = new Set();
  for (const m of src.matchAll(/(?<![.\w$'"`])(_[A-Za-z]\w*)\s*(?:\?\.)?\(/g)) {
    if (!declared.has(m[1])) missing.add(m[1]);
  }
  if (missing.size) {
    failures += missing.size;
    console.error(`${rel}: undeclared helpers called: ${[...missing].sort().join(', ')}`);
  }
}
if (failures) process.exit(1);
console.log('mobile voice scope refs: ok');
