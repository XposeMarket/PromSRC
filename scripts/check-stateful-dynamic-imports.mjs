#!/usr/bin/env node
// check-stateful-dynamic-imports.mjs
//
// Guards the tsx-source gateway bug class: a dynamic import('./x') from a NON-entry
// module loads a second instance of x. Static imports and require() share one instance.
// If x holds module-level mutable state the copies diverge. Use require() or a static
// import, or keep the state in a process singleton (processSingleton) inside x.
//
// Detection uses the TypeScript AST (typescript is a repo dependency).
//   Dynamic import: a CallExpression whose callee is the import keyword, with a first
//     argument that is a string literal or no-substitution template starting with ./ or ../.
//     Multi-line calls count. Type-only `typeof import('./x')` and `import('./x').T` are
//     ImportTypeNodes and do NOT count.
//   Stateful target: only TOP-LEVEL statements are inspected:
//     - a VariableStatement declared with let or var (declare skipped)
//     - a const whose initializer (through parens / as / satisfies / non-null) is
//       new Map|Set|WeakMap|WeakSet|EventEmitter(...), typed or not
//     - an ExpressionStatement calling process.on / process.once / process.addListener
//   A module whose state lives in processSingleton(...) has none of these shapes, so it
//   passes on its own. There is no processSingleton exemption.
//
// Scan: src/**/*.ts excluding *.regression.ts, *.test.ts, *.d.ts, *.fixture.ts and any
// __fixtures__ directory. Specifiers resolve by stripping .js, then <base>.ts, then <base>/index.ts.
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
import ts from 'typescript';

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

const STATEFUL_CTORS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet', 'EventEmitter']);
const PROCESS_LISTENER_METHODS = new Set(['on', 'once', 'addListener']);

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
      // __fixtures__ holds deliberate probes; they are not production imports.
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

function parseSource(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Dynamic import() calls with a relative string/template specifier. ImportType nodes are skipped. */
function dynamicImports(sf) {
  const out = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg) && /^\.\.?\//.test(arg.text)) {
        out.push({ spec: arg.text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function unwrap(expr) {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) {
    e = e.expression;
  }
  return e;
}

function hasDeclareModifier(node) {
  return (node.modifiers || []).some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
}

/** Returns a short reason when the module has top-level mutable state, else null. */
function statefulReason(sf) {
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt) && !hasDeclareModifier(stmt)) {
      const flags = stmt.declarationList.flags;
      if (!(flags & ts.NodeFlags.Const)) {
        return `top-level ${flags & ts.NodeFlags.Let ? 'let' : 'var'}`;
      }
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer && unwrap(decl.initializer);
        if (init && ts.isNewExpression(init) && ts.isIdentifier(init.expression)
          && STATEFUL_CTORS.has(init.expression.text)) {
          return `top-level const = new ${init.expression.text}`;
        }
      }
    }
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const callee = stmt.expression.expression;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
        && callee.expression.text === 'process' && PROCESS_LISTENER_METHODS.has(callee.name.text)) {
        return `top-level process.${callee.name.text}()`;
      }
    }
  }
  return null;
}

const statefulCache = new Map();
function statefulReasonFor(file) {
  if (!statefulCache.has(file)) {
    statefulCache.set(file, statefulReason(parseSource(file, fs.readFileSync(file, 'utf8'))));
  }
  return statefulCache.get(file);
}

function collect() {
  const all = [];
  const violations = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const sf = parseSource(file, fs.readFileSync(file, 'utf8'));
    for (const { spec, line } of dynamicImports(sf)) {
      const target = resolveTarget(file, spec);
      if (!target) continue;
      const reason = statefulReasonFor(target);
      const entry = { file: rel(file), line, spec, target: rel(target), reason };
      all.push(entry);
      if (reason) violations.push(entry);
    }
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
      console.log(`${e.file}:${e.line} -> ${e.target}${e.reason ? `  [stateful: ${e.reason}]` : ''}`);
    }
    console.log(`${all.length} dynamic imports; ${violations.length} hit a stateful target`);
  }

  if (WRITE_BASELINE) {
    const violationsOut = [...current.values()]
      .map(({ file, target, count }) => ({ file, target, count }))
      .sort((a, b) => a.file.localeCompare(b.file) || a.target.localeCompare(b.target));
    const out = {
      generatedBy: 'node scripts/check-stateful-dynamic-imports.mjs --write-baseline',
      note: "Today's violations. Stale entries warn only. Remove an entry when its import is fixed.",
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
    console.error('Fix: use require() or a static import, or keep the module state in a process singleton (processSingleton).');
    console.error('Type-only imports (typeof import(...), import(...).T) are not counted. Run with --print to list every dynamic import.');
    return 1;
  }

  console.log(`check-stateful-dynamic-imports: ok (${all.length} dynamic imports; ${current.size} stateful pairs, all in baseline)`);
  return 0;
}

process.exitCode = main();
