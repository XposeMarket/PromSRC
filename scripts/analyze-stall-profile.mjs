#!/usr/bin/env node
/** Print sampled CPU-profile caller stacks for selected function names. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [profilePath, ...needles] = process.argv.slice(2);
if (!profilePath) throw new Error('Usage: node scripts/analyze-stall-profile.mjs <profile.cpuprofile> [name ...]');
const profile = JSON.parse(readFileSync(resolve(profilePath), 'utf8'));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parents = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) {
  const list = parents.get(child) ?? [];
  list.push(node.id); parents.set(child, list);
}
const hits = new Map();
for (const sample of profile.samples ?? []) hits.set(sample, (hits.get(sample) ?? 0) + 1);
const wanted = needles.length ? needles : ['rmdirSync', 'unlinkSync', 'unlink', 'lstatSync', 'lstat', 'spawnSync', 'spawn', 'readSessionFileForSearch'];
function label(id) { const f = nodes.get(id)?.callFrame; return f ? `${f.functionName || '(anonymous)'} @ ${f.url || '<native>'}:${f.lineNumber + 1}:${f.columnNumber + 1}` : String(id); }
function chains(id, trail = [], depth = 0) {
  if (depth >= 256 || trail.includes(id)) return [trail.concat(id)];
  const ps = parents.get(id) ?? [];
  return ps.length ? ps.flatMap((parent) => chains(parent, trail.concat(id), depth + 1)) : [trail.concat(id)];
}
for (const [id, count] of [...hits].sort((a, b) => b[1] - a[1])) {
  const name = nodes.get(id)?.callFrame?.functionName ?? '';
  if (!wanted.some((needle) => name === needle || name.includes(needle))) continue;
  console.log(`\n${name} — ${count} samples`);
  const unique = [...new Set(chains(id).map((chain) => chain.reverse().map(label).join('\n  -> ')))];
  for (const chain of unique.slice(0, 4)) console.log(`  -> ${chain}`);
}
