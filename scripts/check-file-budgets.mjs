#!/usr/bin/env node
// Source-size and `any` guardrails from the giant-file split (PRs #647-#655).
//
// Rules (configured in scripts/file-budgets.json):
//   1. hardCaps: the split entry files may never exceed a fixed line cap again.
//   2. New oversized files: any src/**/*.ts over maxNewFileLines must already be
//      listed in largeFiles. Listed files may grow by at most slackLines over their
//      recorded size, so ordinary edits pass but a file cannot quietly balloon.
//   2b. Ratchet: a recorded size may not sit more than slackLines ABOVE the
//      file's real size (or list a file that is no longer oversized). Shrinking
//      a file must tighten its allowance, never leave the old one available.
//   3. anyGroups: the number of `any` type annotations inside each split area
//      (chat router family, tool executor family) may not grow. Remove an `any`
//      elsewhere in the group or type the new code properly.
//
// Usage:
//   node scripts/check-file-budgets.mjs                 check (CI)
//   node scripts/check-file-budgets.mjs --write-baseline  re-record largeFiles + anyGroups maxima
//   node scripts/check-file-budgets.mjs --self-test       verify the counters
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'scripts', 'file-budgets.json');

export function countLines(text) {
  if (!text) return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

// Counts `any` in type positions: `: any`, `as any`, `<any>`, `any[]`, `, any`,
// `| any`, `(any`. Comments and string/template literals are stripped first so
// prose like "any tool" does not count.
export function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; else if (src[i] === '\n' && q !== '`') break; i++; }
      i++; out += '""'; continue;
    }
    out += c; i++;
  }
  return out;
}

const ANY_RE = /(?:[:<,|(&]|\bas|\bextends|\bkeyof)\s*any\b(?![\w$])|\bany\s*\[\]/g;
export function countAny(src) {
  return (stripCommentsAndStrings(src).match(ANY_RE) || []).length;
}

export function staleAllowance(recorded, lines, slack) { return recorded - lines > slack; }

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(root, f).split(path.sep).join('/');

function inGroup(file, prefixes) {
  return prefixes.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));
}

function measure(config) {
  const files = walk(path.join(root, 'src')).map((f) => {
    const text = fs.readFileSync(f, 'utf8');
    return { file: rel(f), lines: countLines(text), text };
  });
  const groups = {};
  for (const [name, group] of Object.entries(config.anyGroups || {})) {
    let count = 0;
    for (const f of files) if (inGroup(f.file, group.paths)) count += countAny(f.text);
    groups[name] = count;
  }
  return { files, groups };
}

function selfTest() {
  const assert = (cond, msg) => { if (!cond) { console.error(`self-test FAIL: ${msg}`); process.exit(1); } };
  assert(countAny('let a: any = 1; const b = c as any; type T = Array<any>; let d: any[] = [];') === 4, 'type positions');
  assert(countAny('// any comment\nconst s = "any tool"; const t = `any ${x}`;') === 0, 'comments/strings ignored');
  assert(countAny('function f(x: string, y: any): Record<string, any> { return {}; }') === 2, 'params + generics');
  assert(countAny('const many = 1; const anyway = 2; company: string') === 0, 'word boundaries');
  assert(staleAllowance(5000, 4000, 300) === true && staleAllowance(4200, 4000, 300) === false, 'ratchet');
  assert(countLines('a\nb\n') === 2 && countLines('a\nb') === 2 && countLines('') === 0, 'line counting');
  console.log('file-budgets self-test passed');
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) return selfTest();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const { files, groups } = measure(config);

  if (args.has('--write-baseline')) {
    const largeFiles = {};
    for (const f of files.filter((x) => x.lines > config.maxNewFileLines).sort((a, b) => b.lines - a.lines)) largeFiles[f.file] = f.lines;
    config.largeFiles = largeFiles;
    for (const [name, count] of Object.entries(groups)) config.anyGroups[name].max = count;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`baseline written: ${Object.keys(largeFiles).length} large files; any groups ${JSON.stringify(groups)}`);
    return;
  }

  const failures = [];
  const byFile = new Map(files.map((f) => [f.file, f.lines]));
  for (const [file, cap] of Object.entries(config.hardCaps || {})) {
    const lines = byFile.get(file);
    if (lines === undefined) failures.push(`${file}: hard-capped file is missing (update scripts/file-budgets.json if it was renamed)`);
    else if (lines > cap) failures.push(`${file}: ${lines} lines exceeds hard cap ${cap}. Move code into a module instead of growing this file.`);
  }
  for (const f of files) {
    if (f.lines <= config.maxNewFileLines) continue;
    const recorded = config.largeFiles?.[f.file];
    if (recorded === undefined) failures.push(`${f.file}: ${f.lines} lines; new files may not exceed ${config.maxNewFileLines}. Split it into modules.`);
    else if (f.lines > recorded + config.slackLines) failures.push(`${f.file}: ${f.lines} lines grew past its recorded ${recorded} + ${config.slackLines} slack. Split before adding more.`);
  }
  for (const [file, recorded] of Object.entries(config.largeFiles || {})) {
    const lines = byFile.get(file);
    if (lines === undefined) failures.push(`${file}: listed in largeFiles but missing. Run --write-baseline.`);
    else if (lines <= config.maxNewFileLines) failures.push(`${file}: ${lines} lines is no longer oversized; remove its largeFiles exemption (run --write-baseline).`);
    else if (recorded - lines > config.slackLines) failures.push(`${file}: recorded ${recorded} is stale (now ${lines}); the unused allowance lets it regrow. Run --write-baseline.`);
  }
  for (const [name, group] of Object.entries(config.anyGroups || {})) {
    if (groups[name] > group.max) failures.push(`any budget "${name}": ${groups[name]} \`any\` annotations > baseline ${group.max}. Type the new code (or remove an existing any in ${group.paths.join(', ')}).`);
  }

  if (failures.length) {
    console.error(`file budgets FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  const caps = Object.entries(config.hardCaps).map(([f, c]) => `${path.basename(f)} ${byFile.get(f)}/${c}`).join(', ');
  console.log(`file budgets passed: ${caps}; any ${Object.entries(groups).map(([n, c]) => `${n} ${c}/${config.anyGroups[n].max}`).join(', ')}`);
}

main();
