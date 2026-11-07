#!/usr/bin/env node
// check-stateful-dynamic-imports.mjs
//
// Guards the tsx-source gateway bug class: a dynamic import('./x') from a NON-entry
// module loads a second instance of x. Static imports and require() share one instance.
// If x holds module-level mutable state (registries, hooks, flags, process listeners)
// the copies diverge. Use require() or a static import, or make the state a process singleton.
//
// Heuristic (line-based, deliberately simple):
//   A target .ts file is STATEFUL when any line starts at column 0 (no indentation, so it is
//   top-level and outside functions/classes in normally formatted code) and matches:
//     - `let ...` or `var ...` (optionally after `export `)
//     - `const X = new Map|Set|WeakMap|EventEmitter` (optionally typed, optionally exported)
//     - `process.on(`
//   Known limits: a column-0 line inside a multi-line template string counts; a `let` at
//   column 0 inside a block comment counts. Both are rare and fail toward reporting.
//
// Scan: src/**/*.ts excluding *.regression.ts, *.test.ts and *.d.ts. Only string-literal
// dynamic imports whose specifier starts with ./ or ../ are considered. Specifiers resolve
// by stripping a .js suffix, then trying <base>.ts, then <base>/index.ts.
//
// Baseline: scripts/stateful-dynamic-imports.baseline.json, shape {"violations":[{file,target,count}]}.
//   NEW pair or higher count -> exit 1.  Stale entries -> warning only.
//
// Usage:
//   node scripts/check-stateful-dynamic-imports.mjs                 check the repo
//   node scripts/check-stateful-dynamic-imports.mjs --print         list every dynamic import
//   node scripts/check-stateful-dynamic-imports.mjs --root <dir>    scan <dir>/src (fixtures)
//   node scripts/check-stateful-dynamic-imports.mjs --baseline <f>  override baseline path
//   node scripts/check-stateful-dynamic-imports.mjs --write-baseline  re-record the baseline

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(argValue('--root') || path.join(SCRIPT_DIR, '..'));
const PRINT = args.includes('--print');
const WRITE_BASELINE = args.includes('--write-baseline');
const BASELINE_PATH = path.resolve(
  argValue('--baseline') || path.join(ROOT, 'scripts', 'stateful-dynamic-imports.baseline.json'),
);

const IMPORT_RE = /\bimport\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g;
const STATEFUL_PATTERNS = [
  /^(export\s+)?(let|var)\s/,
  /^(export\s+)?const\s+\w+\s*(:[^=]+)?=\s*new\s+(Map|Set|WeakMap|EventEmitter)\b/,
  /^process\.on\(/,
];

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const pairKey = (file, target) => `${file}\u0000${target}`;

function isScannable(name) {
  return name.endsWith('.ts')
    && !name.endsWith('.regression.ts')
    && !name.endsWith('.test.ts')
    && !name.endsWith('.d.ts')
    && !name.endsWith('.fixture.ts');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // __fixtures__ holds deliberate probes (e.g. a dynamic import that tests a singleton fix).
      if (entry.name !== 'node_modules' && entry.name !== '__fixtures__') walk(full, out);
    } else if (isScannable(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function resolveTarget(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const statefulCache = new Map();
function statefulReason(file) {
  if (statefulCache.has(file)) return statefulCache.get(file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  // Steer rule: a module that keeps its state in processSingleton(...) is a process
  // singleton, so duplicate instances agree. Skip it when it has no top-level let/var.
  if (/processSingleton\(/.test(lines.join('\n')) && !lines.some((line) => /^(export\s+)?(let|var)\s/.test(line))) {
    statefulCache.set(file, null);
    return null;
  }
  const hit = lines.find((line) => STATEFUL_PATTERNS.some((re) => re.test(line)));
  const reason = hit ? hit.trim().slice(0, 120) : null;
  statefulCache.set(file, reason);
  return reason;
}

function collect() {
  const all = [];
  const violations = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      const re = new RegExp(IMPORT_RE.source, 'g');
      let match;
      while ((match = re.exec(line)) !== null) {
        const target = resolveTarget(file, match[2]);
        if (!target) continue;
        const entry = { file: rel(file), line: idx + 1, spec: match[2], target: rel(target) };
        all.push(entry);
        const reason = statefulReason(target);
        if (reason) violations.push({ ...entry, reason });
      }
    });
  }
  return { all, violations };
}

function aggregate(violations) {
  const map = new Map();
  for (const v of violations) {
    const key = pairKey(v.file, v.target);
    const cur = map.get(key) || { file: v.file, target: v.target, count: 0, lines: [] };
    cur.count += 1;
    cur.lines.push(v.line);
    map.set(key, cur);
  }
  return map;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  return new Map((parsed.violations || []).map((e) => [pairKey(e.file, e.target), e]));
}

function main() {
  const { all, violations } = collect();
  const current = aggregate(violations);

  if (PRINT) {
    for (const e of all) {
      const reason = statefulReason(path.join(ROOT, e.target));
      console.log(`${e.file}:${e.line} -> ${e.target}${reason ? `  [STATEFUL: ${reason}]` : ''}`);
    }
    console.log(`dynamic imports: ${all.length}; stateful targets hit: ${violations.length}`);
    return 0;
  }

  if (WRITE_BASELINE) {
    const violationsOut = [...current.values()]
      .map(({ file, target, count }) => ({ file, target, count }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
    const out = {
      generatedBy: 'node scripts/check-stateful-dynamic-imports.mjs --write-baseline',
      note: 'Today\'s violations. Stale entries warn only. Remove an entry when its import is fixed.',
      violations: violationsOut,
    };
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`baseline written: ${rel(BASELINE_PATH)} (${violationsOut.length} pairs, ${violations.length} imports)`);
    return 0;
  }

  const baseline = readBaseline();
  const newViolations = [];
  for (const [key, cur] of current) {
    const base = baseline.get(key);
    if (!base || cur.count > base.count) newViolations.push({ ...cur, allowed: base ? base.count : 0 });
  }
  for (const [key, base] of baseline) {
    if (!current.has(key)) {
      console.warn(`warning: stale baseline entry (no longer violating): ${base.file} -> ${base.target}`);
    }
  }

  if (newViolations.length > 0) {
    console.error('check-stateful-dynamic-imports: NEW dynamic import() of a stateful module:');
    for (const v of newViolations) {
      console.error(`  ${v.file}:${v.lines.join(',')} -> ${v.target}  (count ${v.count}, baseline allows ${v.allowed})`);
    }
    console.error('Fix: use require() or a static import, or make the module state a process singleton (processSingleton).');
    console.error('Run with --print to list every dynamic import.');
    return 1;
  }

  console.log(`check-stateful-dynamic-imports: ok (${all.length} dynamic imports; ${current.size} stateful pairs, all in baseline)`);
  return 0;
}

process.exitCode = main();
