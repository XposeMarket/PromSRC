#!/usr/bin/env node
/**
 * @hyperframes/core 0.5.3 ships its dist with extensionless relative imports
 * (e.g. `from "./core.types"`). Node's CJS require() resolves those fine, but
 * Node's strict ESM loader rejects them. Our gateway compiles to CJS so it is
 * unaffected — but the round-trip test and any future ESM consumer (browser
 * bundler, vite, .mjs scripts) will fail.
 *
 * This script rewrites every `from "./..."` and `from "../..."` import in the
 * package's dist to add `.js` if no extension is present. It is idempotent.
 *
 * Run via npm postinstall, or manually after upgrades:
 *   node scripts/patch-hyperframes-esm.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOTS = [
  path.resolve('node_modules/@hyperframes/core/dist'),
  path.resolve('node_modules/@hyperframes/player/dist'),
];

const RELATIVE_IMPORT_RE = /(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g;
const DYNAMIC_IMPORT_RE = /(import\(\s*["'])(\.{1,2}\/[^"']+?)(["']\s*\))/g;
const SIDE_EFFECT_IMPORT_RE = /(\bimport\s+["'])(\.{1,2}\/[^"']+?)(["'])/g;

function isAlreadyExtensioned(spec) {
  return /\.(js|mjs|cjs|json|wasm|css)$/i.test(spec);
}

function fixSpecifier(spec, fileDir) {
  if (isAlreadyExtensioned(spec)) return spec;
  // If the resolved target is a directory, use /index.js. Otherwise add .js.
  const candidatePath = path.resolve(fileDir, spec);
  try {
    const stat = fs.statSync(candidatePath);
    if (stat.isDirectory()) return `${spec}/index.js`;
  } catch {}
  return `${spec}.js`;
}

function patchFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const dir = path.dirname(filePath);
  const replacer = (re) => (match, prefix, spec, suffix) => `${prefix}${fixSpecifier(spec, dir)}${suffix}`;
  let next = original;
  next = next.replace(RELATIVE_IMPORT_RE, replacer(RELATIVE_IMPORT_RE));
  next = next.replace(DYNAMIC_IMPORT_RE, replacer(DYNAMIC_IMPORT_RE));
  next = next.replace(SIDE_EFFECT_IMPORT_RE, replacer(SIDE_EFFECT_IMPORT_RE));
  if (next !== original) {
    fs.writeFileSync(filePath, next, 'utf8');
    return true;
  }
  return false;
}

function walk(dir, onFile) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

let patched = 0;
let scanned = 0;
for (const root of ROOTS) {
  walk(root, (filePath) => {
    if (!/\.(js|mjs)$/.test(filePath)) return;
    scanned += 1;
    if (patchFile(filePath)) patched += 1;
  });
}
console.log(`patch-hyperframes-esm: scanned ${scanned} files, patched ${patched}.`);
