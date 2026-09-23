#!/usr/bin/env node
// Guard: ES modules in web-ui/src must not call a top-level function that only
// exists as a bare function in ANOTHER module. Module scope is not global, so
// such calls throw ReferenceError at runtime (e.g. ChatPage calling the legacy
// sidebar's getSessionSortTime aborted desktop startup and chat restore).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const pairs = [
  ['web-ui/src/pages/ChatPage.js', 'web-ui/src/legacy-desktop-bootstrap.js'],
  ['web-ui/src/legacy-desktop-bootstrap.js', 'web-ui/src/pages/ChatPage.js'],
];

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function localNames(src) {
  const names = new Set();
  const patterns = [
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g,
    /\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,|\s+from)/g,
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) names.add(m[1]);
  for (const m of src.matchAll(/\bimport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  // Destructured bindings: const { a, b: c } = ...
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

let failures = 0;
for (const [userRel, ownerRel] of pairs) {
  const user = stripComments(fs.readFileSync(path.join(root, userRel), 'utf8'));
  const owner = fs.readFileSync(path.join(root, ownerRel), 'utf8');
  const defined = localNames(user);
  const ownerFns = [...owner.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  // Bare calls resolve through the global object when the owner publishes the
  // function on window (window.fn = fn, or Object.assign(window, { fn, ... })).
  const exposed = new Set();
  for (const m of owner.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) exposed.add(m[1]);
  for (const m of owner.matchAll(/Object\.assign\(\s*window\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) exposed.add(name);
    }
  }
  const bad = [];
  for (const fn of new Set(ownerFns)) {
    if (defined.has(fn) || exposed.has(fn)) continue;
    const re = new RegExp(`(?<![.\\w$'"\`])${fn.replace(/\$/g, '\\$')}\\s*\\(`, 'g');
    const hits = [...user.matchAll(re)].length;
    if (hits) bad.push(`${fn} (x${hits})`);
  }
  if (bad.length) {
    failures += bad.length;
    console.error(`[check-web-ui-module-globals] ${userRel} calls functions only defined in ${ownerRel}: ${bad.join(', ')}`);
  }
}
if (failures) {
  console.error('Expose them on window (and call window.fn) or import them explicitly.');
  process.exit(1);
}
console.log('[check-web-ui-module-globals] ok');
