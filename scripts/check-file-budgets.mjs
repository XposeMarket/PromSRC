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
//   4. webUi: rules 2 and 2b also apply to hand-written web UI source
//      (web-ui/**/*.{js,mjs,cjs,jsx,ts,css,html}, minus vendored and minified
//      files), with its own largeFiles list under the `webUi` key. Hard caps and
//      `any` groups stay src-only. This sits alongside the LF-byte ceilings in
//      scripts/test-web-ui-architecture-guardrails.mjs (six legacy surfaces plus
//      a 472,009-byte cap for other modules): the line rules add a 3,000-line
//      limit for new files and the shrink ratchet.
//
// Usage:
//   node scripts/check-file-budgets.mjs                 check (CI)
//   node scripts/check-file-budgets.mjs --write-baseline  re-record largeFiles (src + webUi) + anyGroups maxima
//   node scripts/check-file-budgets.mjs --self-test       verify the counters and size rules
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

const WEB_UI_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.css', '.html'];

function matchesPrefix(file, prefixes) {
  return prefixes.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));
}

// A scope is one walked tree with its own oversized-file list. `src` is always
// present; `webUi` exists only when the config has that block.
export function buildScopes(config) {
  const scopes = [{
    name: 'src',
    listKey: 'largeFiles',
    roots: ['src'],
    exclude: [],
    extensions: ['.ts'],
    maxNewFileLines: config.maxNewFileLines,
    slackLines: config.slackLines,
    largeFiles: config.largeFiles || {},
  }];
  if (config.webUi) {
    const w = config.webUi;
    scopes.push({
      name: 'web-ui',
      listKey: 'webUi.largeFiles',
      roots: w.roots || ['web-ui'],
      exclude: w.exclude || ['web-ui/vendor/'],
      extensions: w.extensions || WEB_UI_EXTENSIONS,
      maxNewFileLines: w.maxNewFileLines ?? config.maxNewFileLines,
      slackLines: w.slackLines ?? config.slackLines,
      largeFiles: w.largeFiles || {},
    });
  }
  return scopes;
}

// `file` is a repo-relative path with forward slashes.
export function inScope(file, scope) {
  if (!scope.roots.some((r) => file.startsWith(`${r}/`))) return false;
  if (matchesPrefix(file, scope.exclude)) return false;
  if (file.endsWith('.d.ts') || /\.min\.[a-z]+$/.test(file)) return false;
  return scope.extensions.some((e) => file.endsWith(e));
}

// Rules 2 and 2b for one scope. `lineCounts` maps every in-scope file to its
// physical line count. Pure, so the self-test can drive it with synthetic files.
export function evaluateSizes(scope, lineCounts) {
  const failures = [];
  for (const [file, lines] of lineCounts) {
    if (lines <= scope.maxNewFileLines) continue;
    const recorded = scope.largeFiles[file];
    if (recorded === undefined) failures.push(`${file}: ${lines} lines; new files may not exceed ${scope.maxNewFileLines}. Split it into modules.`);
    else if (lines > recorded + scope.slackLines) failures.push(`${file}: ${lines} lines grew past its recorded ${recorded} + ${scope.slackLines} slack. Split before adding more.`);
  }
  for (const [file, recorded] of Object.entries(scope.largeFiles)) {
    const lines = lineCounts.get(file);
    if (lines === undefined) failures.push(`${file}: listed in ${scope.listKey} but missing. Run --write-baseline.`);
    else if (lines <= scope.maxNewFileLines) failures.push(`${file}: ${lines} lines is no longer oversized; remove its ${scope.listKey} exemption (run --write-baseline).`);
    else if (staleAllowance(recorded, lines, scope.slackLines)) failures.push(`${file}: recorded ${recorded} is stale (now ${lines}); the unused allowance lets it regrow. Run --write-baseline.`);
  }
  return failures;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(root, f).split(path.sep).join('/');

function measureScope(scope) {
  const files = [];
  for (const r of scope.roots) {
    for (const full of walk(path.join(root, r))) {
      const file = rel(full);
      if (!inScope(file, scope)) continue;
      const text = fs.readFileSync(full, 'utf8');
      files.push({ file, lines: countLines(text), text });
    }
  }
  return files;
}

function measure(config) {
  const scopes = buildScopes(config).map((scope) => ({ scope, files: measureScope(scope) }));
  const files = scopes[0].files;
  const groups = {};
  for (const [name, group] of Object.entries(config.anyGroups || {})) {
    let count = 0;
    for (const f of files) if (matchesPrefix(f.file, group.paths)) count += countAny(f.text);
    groups[name] = count;
  }
  return { scopes, files, groups };
}

function recordLargeFiles(scope, files) {
  const largeFiles = {};
  for (const f of files.filter((x) => x.lines > scope.maxNewFileLines).sort((a, b) => b.lines - a.lines)) largeFiles[f.file] = f.lines;
  return largeFiles;
}

function selfTest() {
  const assert = (cond, msg) => { if (!cond) { console.error(`self-test FAIL: ${msg}`); process.exit(1); } };
  assert(countAny('let a: any = 1; const b = c as any; type T = Array<any>; let d: any[] = [];') === 4, 'type positions');
  assert(countAny('// any comment\nconst s = "any tool"; const t = `any ${x}`;') === 0, 'comments/strings ignored');
  assert(countAny('function f(x: string, y: any): Record<string, any> { return {}; }') === 2, 'params + generics');
  assert(countAny('const many = 1; const anyway = 2; company: string') === 0, 'word boundaries');
  assert(staleAllowance(5000, 4000, 300) === true && staleAllowance(4200, 4000, 300) === false, 'ratchet');
  assert(countLines('a\nb\n') === 2 && countLines('a\nb') === 2 && countLines('') === 0, 'line counting');

  // Scopes: no webUi block means src only, exactly as before.
  const base = { maxNewFileLines: 3000, slackLines: 300, largeFiles: { 'src/big.ts': 4000 } };
  assert(buildScopes(base).length === 1 && buildScopes(base)[0].name === 'src', 'src-only config keeps one scope');
  const cfg = { ...base, webUi: { largeFiles: { 'web-ui/src/pages/Big.js': 9000, 'web-ui/src/styles/big.css': 5000 } } };
  const [src, web] = buildScopes(cfg);
  assert(web.name === 'web-ui' && web.maxNewFileLines === 3000 && web.slackLines === 300, 'webUi inherits thresholds');
  assert(buildScopes({ ...base, webUi: { slackLines: 50, maxNewFileLines: 2000 } })[1].slackLines === 50, 'webUi can override thresholds');

  // Which files each scope looks at.
  assert(inScope('src/gateway/a.ts', src) && !inScope('src/gateway/a.d.ts', src) && !inScope('src/gateway/a.js', src), 'src scope is .ts only');
  assert(!inScope('web-ui/src/pages/Big.js', src) && !inScope('src/gateway/a.ts', web), 'scopes do not overlap');
  for (const f of ['web-ui/src/pages/Big.js', 'web-ui/src/styles/big.css', 'web-ui/index.html', 'web-ui/src/x.mjs', 'web-ui/src/x.jsx']) assert(inScope(f, web), `web-ui scope includes ${f}`);
  for (const f of ['web-ui/vendor/jsqr/jsQR.js', 'web-ui/src/lib/thing.min.js', 'web-ui/src/icon.svg', 'web-ui/README.md', 'web-ui-old/src/a.js']) assert(!inScope(f, web), `web-ui scope excludes ${f}`);

  // Size rules, both polarities, on the web-ui scope.
  const sizes = (entries) => evaluateSizes(web, new Map(Object.entries(entries)));
  const ok = { 'web-ui/src/pages/Big.js': 9000, 'web-ui/src/styles/big.css': 5000 };
  assert(sizes(ok).length === 0, 'recorded sizes pass');
  assert(sizes({ ...ok, 'web-ui/src/pages/Big.js': 9300, 'web-ui/src/small.js': 3000 }).length === 0, 'growth within slack and files at the limit pass');
  assert(sizes({ ...ok, 'web-ui/src/pages/Big.js': 9301 }).some((m) => m.includes('grew past its recorded 9000 + 300 slack')), 'growth past slack fails');
  assert(sizes({ ...ok, 'web-ui/src/pages/New.js': 3001 }).some((m) => m.startsWith('web-ui/src/pages/New.js: 3001 lines; new files may not exceed 3000')), 'new oversized file fails');
  assert(sizes({ ...ok, 'web-ui/src/pages/Big.js': 8699 }).some((m) => m.includes('recorded 9000 is stale (now 8699)')), 'shrunk file must tighten its allowance');
  assert(sizes({ ...ok, 'web-ui/src/pages/Big.js': 8700 }).length === 0, 'shrink within slack passes');
  assert(sizes({ ...ok, 'web-ui/src/styles/big.css': 2500 }).some((m) => m.includes('no longer oversized; remove its webUi.largeFiles exemption')), 'no-longer-oversized file must be delisted');
  assert(sizes({ 'web-ui/src/pages/Big.js': 9000 }).some((m) => m.includes('listed in webUi.largeFiles but missing')), 'listed file that is gone fails');
  assert(evaluateSizes(src, new Map([['src/big.ts', 4301]]))[0] === 'src/big.ts: 4301 lines grew past its recorded 4000 + 300 slack. Split before adding more.', 'src messages unchanged');
  console.log('file-budgets self-test passed');
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) return selfTest();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const { scopes, files, groups } = measure(config);

  if (args.has('--write-baseline')) {
    const counts = [];
    for (const { scope, files: scopeFiles } of scopes) {
      const largeFiles = recordLargeFiles(scope, scopeFiles);
      if (scope.name === 'src') config.largeFiles = largeFiles;
      else config.webUi.largeFiles = largeFiles;
      counts.push(`${Object.keys(largeFiles).length} large ${scope.name} files`);
    }
    for (const [name, count] of Object.entries(groups)) config.anyGroups[name].max = count;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`baseline written: ${counts.join(', ')}; any groups ${JSON.stringify(groups)}`);
    return;
  }

  const failures = [];
  const byFile = new Map(files.map((f) => [f.file, f.lines]));
  for (const [file, cap] of Object.entries(config.hardCaps || {})) {
    const lines = byFile.get(file);
    if (lines === undefined) failures.push(`${file}: hard-capped file is missing (update scripts/file-budgets.json if it was renamed)`);
    else if (lines > cap) failures.push(`${file}: ${lines} lines exceeds hard cap ${cap}. Move code into a module instead of growing this file.`);
  }
  for (const { scope, files: scopeFiles } of scopes) {
    failures.push(...evaluateSizes(scope, new Map(scopeFiles.map((f) => [f.file, f.lines]))));
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
  const web = scopes.find((s) => s.scope.name === 'web-ui');
  const webSummary = web
    ? `; web-ui ${Object.keys(web.scope.largeFiles).length} oversized files, ${web.files.filter((f) => f.lines > web.scope.maxNewFileLines).reduce((n, f) => n + f.lines, 0)} lines`
    : '';
  console.log(`file budgets passed: ${caps}; any ${Object.entries(groups).map(([n, c]) => `${n} ${c}/${config.anyGroups[n].max}`).join(', ')}${webSummary}`);
}

main();
