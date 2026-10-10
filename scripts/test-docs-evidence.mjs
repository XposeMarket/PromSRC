#!/usr/bin/env node
// Keeps the reviewer-facing evidence docs honest: every repository path they
// cite in backticks must exist, and every `npm run <script>` they cite must be
// a real package script. A doc that points at deleted code fails CI.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['ARCHITECTURE.md', 'SECURITY.md', 'TESTING.md', 'README.md'];
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {};

const PATH_RE = /`((?:src|scripts|web-ui|electron|apps|docs|benchmarks|\.github)\/[A-Za-z0-9_./*-]+)`/g;
const NPM_RE = /npm run ([a-z0-9:_-]+)/gi;

export function citedPaths(text) {
  return [...text.matchAll(PATH_RE)].map((m) => m[1].replace(/[.,;:]+$/, ''));
}

export function citedScripts(text) {
  return [...text.matchAll(NPM_RE)].map((m) => m[1]);
}

const problems = [];
let pathCount = 0;
let scriptCount = 0;
for (const doc of DOCS) {
  const file = path.join(root, doc);
  if (!fs.existsSync(file)) { problems.push(`${doc}: missing`); continue; }
  const text = fs.readFileSync(file, 'utf8');
  for (const p of citedPaths(text)) {
    if (p.includes('*') || p.includes('<')) continue;
    pathCount += 1;
    if (!fs.existsSync(path.join(root, p))) problems.push(`${doc}: cites missing path ${p}`);
  }
  for (const s of citedScripts(text)) {
    scriptCount += 1;
    if (!(s in scripts)) problems.push(`${doc}: cites unknown script "npm run ${s}"`);
  }
}

// self-test of the extractors
assert.deepEqual(citedPaths('see `src/a.ts`, and `scripts/b.mjs`.'), ['src/a.ts', 'scripts/b.mjs']);
assert.deepEqual(citedScripts('run `npm run test:replay` then npm run build'), ['test:replay', 'build']);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`docs-evidence: ${pathCount} cited paths and ${scriptCount} cited scripts resolve across ${DOCS.length} docs`);
