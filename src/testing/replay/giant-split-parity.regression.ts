/**
 * PR 0 split safety net. Run: npm run test:giant-split-parity
 * Regenerate (review the diff!): npm run test:giant-split-parity -- --update-golden
 *
 * Routes and ordered SSE types are RUNTIME captures using the existing replay
 * harness (PR #615): isolated temporary data/workspace, workers disabled, no
 * server/listener, scripted provider and stubbed tool. No live config is used.
 *
 * Dispatch is deliberately a STATIC AST fallback: executeTool's testing
 * override runs BEFORE policy/handler selection and would accept unknown names;
 * running every actual handler could touch desktop, network or disk. The real
 * default returns { error: true, result: `Unknown tool: ${name}` }. We inspect
 * name-switch cases recursively across agents-runtime, including handlers and
 * capabilities, plus explicit *_TOOL_NAMES registries (495 finite names), not
 * just the original giant file. This catches name loss while allowing moves.
 * Case-only names are also compared separately so stale name sets cannot hide
 * case loss. This is not reachability. A registry migration must adapt this collector
 * to the real registry (do not regenerate away lost cases). Not proof that a
 * handler is reachable, nor coverage of dynamically installed connector tools.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { bootReplayHarness } from './harness';

const goldenDir = path.join(__dirname, 'goldens');
const update = process.argv.includes('--update-golden') || process.env.UPDATE_GOLDEN === '1';
type Route = { method: string; path: string };

function compareGolden(name: string, actual: unknown): void {
  const file = path.join(goldenDir, `${name}.json`);
  if (update) {
    fs.mkdirSync(goldenDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(actual, null, 2) + '\n');
  }
  const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(actual, expected,
    `${name} parity changed. Review additions/removals/order below; do not update goldens merely to make a split pass. Regenerate with npm run test:giant-split-parity -- --update-golden.`);
}

/** Express 4 layers, recursing through mounted routers, retaining duplicates. */
function routeTable(router: any, prefix = ''): Route[] {
  const result: Route[] = [];
  for (const layer of router.stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of paths) {
        assert.equal(typeof routePath, 'string', 'Explicit support required for RegExp route paths');
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled) result.push({ method: method.toUpperCase(), path: prefix + routePath });
        }
      }
    } else if (layer.handle?.stack) {
      let mount = '';
      if (!layer.regexp.fast_slash) {
        // Express 4 path-to-regexp literal mount, e.g. /^\/api\/?(?=\/|$)/i.
        const source: string = layer.regexp.source;
        const suffix = '\\/?(?=\\/|$)';
        assert.ok(source.startsWith('^') && source.endsWith(suffix), `Unsupported router mount ${source}`);
        mount = source.slice(1, -suffix.length).replace(/\\\//g, '/');
        assert.ok(!/[()[\]*+?]/.test(mount), `Parameterized mount needs explicit support: ${source}`);
      }
      result.push(...routeTable(layer.handle, prefix + mount));
    }
  }
  return result;
}

function dispatchNames(root: string, includeRegistries = true): string[] {
  const names = new Set<string>();
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.name.endsWith('.ts') || /\.(regression|test|spec)\.ts$/.test(entry.name)) continue;
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node): void {
        // Explicit handler/capability name sets are authoritative registries too.
        if (includeRegistries && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
            /TOOL_NAMES$/.test(node.name.text) && node.initializer) {
          const collect = (child: ts.Node): void => {
            if (ts.isStringLiteral(child)) names.add(child.text);
            ts.forEachChild(child, collect);
          };
          collect(node.initializer);
        }
        if (ts.isSwitchStatement(node) &&
            (node.expression.getText(source) === 'name' || node.expression.getText(source) === 'ctx.name')) {
          for (const clause of node.caseBlock.clauses) {
            if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) names.add(clause.expression.text);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  walk(root);
  return [...names].sort();
}

async function main(): Promise<void> {
  const runtime = path.resolve(__dirname, '../../gateway/agents-runtime');
  const names = dispatchNames(runtime);
  assert.ok(names.length > 400, 'Dispatcher capture unexpectedly empty/incomplete');
  compareGolden('executor-tool-names', names);
  // Independently snapshot cases so a stale TOOL_NAMES set cannot hide case loss.
  compareGolden('executor-switch-names', dispatchNames(runtime, false));
  const originalCwd = process.cwd();
  const harness = await bootReplayHarness();
  // Some legacy audit/brain writers resolve relative to cwd rather than data dir.
  process.chdir(harness.root);
  try {
    const { router } = require('../../gateway/routes/chat.router');
    // Collector contract: same-prefix nesting must preserve method/path pairs.
    const express = require('express');
    const parent = express.Router();
    const child = express.Router();
    child.get('/probe', () => {});
    parent.use('/nested', child);
    assert.deepEqual(routeTable(parent), [{ method: 'GET', path: '/nested/probe' }]);
    const routes = routeTable(router);
    assert.ok(routes.length > 50, 'Router capture unexpectedly empty/incomplete');
    compareGolden('chat-routes', routes);
    const run = await harness.runTurn({
      message: 'List coding skills',
      script: [
        { toolCalls: [{ id: 'call_parity', name: 'skill_list', args: { query: 'coding' } }] },
        { text: 'Listed.' },
      ],
      tools: { skill_list: () => ({ result: '{"totalInstalled":1,"skills":[]}' }) },
    });
    assert.equal(run.error, null);
    assert.equal(run.timedOut, false);
    assert.equal(run.result?.text, 'Listed.');
    assert.deepEqual(run.dispatched, ['skill_list']);
    assert.equal(run.provider.requests.length, 2);
    assert.equal(run.finalEvents, 1);
    compareGolden('chat-tool-turn-events', run.eventNames());
    console.log(`PASS giant split parity: ${routes.length} runtime routes, ${names.length} static dispatch names, ${run.events.length} ordered runtime events`);
  } finally {
    process.chdir(originalCwd);
    harness.shutdown();
  }
}
// Runtime imports have background timers; mirror the replay runner's explicit exit.
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
