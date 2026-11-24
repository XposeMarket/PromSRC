/**
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-plugin-reference-dispatch.ts
 * Isolated integration regression, NOT full gateway/LLM/browser E2E.
 * Uses the actual settings-router registration (AST-extracted to avoid unrelated
 * router startup), real auth, runtime registry/catalog, reference helper,
 * tool_call executor, policy and durable approval queue. Only extension bootstrap
 * is replaced: no bundled/user connectors may load. An anonymous local fixture
 * supplies its own connection status, never credentials or a real account.
 * Approval is always denied; the fixture's execution body must never run.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(__dirname, '..');
const childFlag = '--isolated-plugin-reference-fixture';

if (!process.argv.includes(childFlag)) {
  const evidenceRoot = path.join(repo, '.pr');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(evidenceRoot, 'plugin-reference-dispatch-'));
  // Deliberately do not inherit provider tokens, login state, proxy settings,
  // NODE_OPTIONS, connector configuration, or the user's home directory.
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root,
    TEMP: root, TMP: root, PROMETHEUS_DATA_DIR: root,
    PROMETHEUS_APP_DATA_DIR: root, PROMETHEUS_APP_ROOT: root,
    PROMETHEUS_RUNTIME_DIR: path.join(root, 'runtime'),
    PROMETHEUS_WORKSPACE_DIR: path.join(root, 'workspace'),
    PROMETHEUS_STORAGE_LAYOUT: 'canonical',
    PLUGIN_REFERENCE_FIXTURE_ROOT: root,
  });
  try {
    const child = spawnSync(process.execPath, [
      path.join(repo, 'node_modules/tsx/dist/cli.mjs'), __filename, childFlag,
    ], { cwd: root, env, encoding: 'utf8', timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
    process.stdout.write(child.stdout || '');
    process.stderr.write(child.stderr || '');
    if (child.error) throw child.error;
    assert.equal(child.status, 0, `isolated fixture failed (signal ${child.signal})`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
} else {
  main().then(() => process.exit(0)).catch(error => {
    console.error('FAIL plugin reference dispatch:', error?.stack || error);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const root = process.env.PLUGIN_REFERENCE_FIXTURE_ROOT!;
  assert.equal(process.cwd(), root);
  assert.ok(root.startsWith(path.join(repo, '.pr') + path.sep));
  fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR!, { recursive: true });

  // Fail closed before importing gateway modules. Permit only the one local
  // HTTP fixture listener; never permit DNS, remote sockets, or subprocesses.
  const net = require('node:net');
  const tls = require('node:tls');
  const dns = require('node:dns');
  const cp = require('node:child_process');
  let forbiddenAttempts = 0;
  let fixturePort = 0;
  const forbidden = () => { forbiddenAttempts++; throw new Error('Fixture forbids external I/O'); };
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args: any[]) {
    const first = args[0];
    const options = Array.isArray(first) ? first[0] : first;
    if (!options || typeof options !== 'object' || options.host !== '127.0.0.1'
      || Number(options.port) !== fixturePort || !fixturePort) return forbidden();
    return originalConnect.apply(this, args);
  };
  tls.connect = forbidden;
  const originalLookup = dns.lookup;
  dns.lookup = function (hostname: string, ...args: any[]) {
    if (hostname !== '127.0.0.1') return forbidden();
    // Node's listen() calls lookup even for numeric loopback; this performs no DNS.
    return originalLookup.call(this, hostname, ...args);
  };
  dns.resolve = forbidden;
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = forbidden;

  // The sole substituted boundary: prevent runtime auto-loading of any real
  // connector. Catalog, registry, policy, executor, and approval are NOT mocked.
  const bootstrapPath = require.resolve('../src/extensions/extension-bootstrap');
  require.cache[bootstrapPath] = {
    id: bootstrapPath, filename: bootstrapPath, loaded: true,
    exports: { ensurePrometheusExtensionRuntimeLoaded() {} },
  } as NodeModule;

  const express = require('express');
  const ts = require('typescript');
  const vm = require('node:vm');
  const { getConfig } = require('../src/config/config');
  const cm = getConfig();
  const token = 'local-anonymous-plugin-reference-fixture';
  cm.updateConfig({ gateway: { auth: { enabled: true, token } },
    tools: { permissions: { shell: { approval_mode: 'default' } } } });
  assert.ok(path.resolve(cm.getConfigDir()).startsWith(root + path.sep));
  const { requireGatewayAuth } = require('../src/gateway/gateway-auth');
  const { getExtensionRuntimeRegistry } = require('../src/extensions/runtime-registry');
  const registry = getExtensionRuntimeRegistry();
  assert.equal(registry.listConnectors().length, 0);
  const pluginId = 'fixture_local';
  const toolName = 'connector_fixture_local_update_record';
  let executions = 0;
  registry.registerConnector('fixture-only', { id: pluginId, name: 'Anonymous Local Fixture',
    authType: 'none', toolNames: [toolName], isConnected: () => true, hasCredentials: () => false });
  registry.registerTool('fixture-only', { name: toolName, connectorId: pluginId,
    description: 'Update a synthetic local fixture record; never execute in this test.',
    parameters: { type: 'object', required: ['record'], properties: { record: { type: 'string' } } },
    execute: async () => { executions++; throw new Error('Approval must prevent fixture execution'); },
  });
  const { buildToolCatalog, invalidateToolCatalog } = require('../src/gateway/tool-search');
  invalidateToolCatalog();
  const catalog = buildToolCatalog({ force: true });
  assert.deepEqual(catalog.map((entry: any) => entry.name), [toolName], 'only local fixture is callable');
  const { pluginReferenceHint } = require('../src/gateway/chat/plugin-references');
  const message = `/${pluginId} update the synthetic record`;
  const hint = pluginReferenceHint(message);
  assert.ok(hint.includes(toolName));
  assert.match(hint, /normal approvals apply/);
  assert.equal(pluginReferenceHint('/unknown_fixture'), '');
  assert.equal(pluginReferenceHint(`https://example.invalid/${pluginId}`), '');

  // Execute the production registration statement unchanged, rather than
  // duplicating its handler in the test. Other settings routes are not booted.
  const routerFile = path.join(repo, 'src/gateway/routes/settings.router.ts');
  const source = fs.readFileSync(routerFile, 'utf8');
  const ast = ts.createSourceFile(routerFile, source, ts.ScriptTarget.Latest, true);
  const routes = ast.statements.filter((statement: any) => {
    const call = ts.isExpressionStatement(statement) && statement.expression;
    return call && ts.isCallExpression(call) && call.expression.getText(ast) === 'router.get'
      && call.arguments[0]?.text === '/api/chat/plugin-references';
  });
  assert.equal(routes.length, 1, 'exactly one production reference route');
  const router = express.Router();
  const routeJs = ts.transpileModule(routes[0].getText(ast), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(routeJs, { router, requireGatewayAuth,
    require: (name: string) => {
      assert.equal(name, '../chat/plugin-references');
      return require('../src/gateway/chat/plugin-references');
    },
  }, { filename: routerFile });
  const app = express();
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  fixturePort = server.address().port;
  const url = `http://127.0.0.1:${fixturePort}/api/chat/plugin-references`;
  try {
    assert.equal((await fetch(url)).status, 401, 'real auth refuses missing fixture token');
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { plugins: [{ id: pluginId, title: 'Anonymous Local Fixture' }] });

    const { executeTool } = require('../src/gateway/agents-runtime/subagent-executor');
    const { getApprovalQueue } = require('../src/gateway/verification-flow');
    const { getPolicyEngine } = require('../src/gateway/policy');
    const session = 'plugin-reference-local-fixture-session';
    const args = { record: 'anonymous-synthetic-record' };
    assert.notEqual(getPolicyEngine().evaluateAction(session, toolName, args).tier, 'read');
    const queue = getApprovalQueue();
    assert.equal(queue.listPending().length, 0);
    const events: any[] = [];
    let settled = false;
    const dispatch = executeTool('tool_call', { name: toolName, arguments: args },
      process.env.PROMETHEUS_WORKSPACE_DIR!, { broadcastWS: (event: any) => events.push(event) }, session)
      .then((result: any) => { settled = true; return result; });
    const deadline = Date.now() + 10_000;
    while (!queue.listPending().length && !settled && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const pending = queue.listPending();
    assert.equal(pending.length, 1, 'real executor must queue an approval');
    assert.equal(pending[0].toolName, toolName, 'approval binds resolved tool, not tool_call');
    assert.equal(pending[0].sessionId, session);
    assert.deepEqual(pending[0].toolArgs, args);
    assert.equal(pending[0].status, 'pending');
    assert.equal(pending[0].policyTier, 'commit');
    assert.equal(settled, false, 'dispatch waits at approval gate');
    assert.equal(executions, 0);
    assert.ok(events.some(event => event.type === 'approval_created' && event.approvalId === pending[0].id));
    queue.resolve(pending[0].id, false, 'fixture-test-denial');
    const result = await dispatch;
    assert.equal(result.error, true);
    assert.match(result.result, /denied|rejected/i);
    assert.equal(queue.get(pending[0].id).status, 'rejected');
    assert.equal(queue.listPending().length, 0);
    assert.equal(executions, 0, 'no connector execution before or after denial');
    assert.equal(forbiddenAttempts, 0, 'no external I/O attempted');
    console.log('PASS authenticated production reference route: missing token 401; fixture token 200; fixture discovered.');
    console.log('PASS real reference helper -> callable catalog -> tool_call -> executor -> policy -> pending approval for resolved fixture tool.');
    console.log('PASS approval denial settles dispatch; fixture executions=0; forbidden external I/O attempts=0.');
    console.log('SCOPE: isolated route/core integration, AST-extracted route; fixture-only bootstrap; no full chat POST, LLM, UI, live account, or approved execution.');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
