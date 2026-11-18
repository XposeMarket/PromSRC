'use strict';
// Offline contract tests: real compiled adapters/orchestrator/stores; injected external hosts.
// No provider, OAuth callback, browser UI, transport, or credential-vault proof is claimed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-family-tests-'));
const savedEnv = { ...process.env };
for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROMETHEUS_HOME', 'PROMETHEUS_CONFIG_DIR', 'PROMETHEUS_DATA_DIR']) process.env[key] = temp;
// A fail-fast fence prevents accidental external networking even if a host boundary regresses.
const originals = [];
for (const [mod, keys] of [[require('node:http'), ['request', 'get']], [require('node:https'), ['request', 'get']], [require('node:net'), ['connect', 'createConnection']], [require('node:tls'), ['connect']]]) {
  for (const key of keys) { originals.push([mod, key, mod[key]]); mod[key] = () => { throw new Error('NETWORK_FORBIDDEN_IN_FAMILY_TEST'); }; }
}
const oldFetch = global.fetch;
global.fetch = async () => { throw new Error('NETWORK_FORBIDDEN_IN_FAMILY_TEST'); };
const load = file => import(pathToFileURL(path.join(root, 'dist', file + '.js')).href);
const results = [];
async function test(name, run) {
  try { await run(); results.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message.replace(/\n/g, ' | ')); }
}
(async () => {
  const [A, C, E, R, O, P, S, H, B, L, M, K] = await Promise.all([
    load('connections/attempt-store'), load('connections/connection-store'), load('connections/activity-store'),
    load('connections/adapter-registry'), load('connections/orchestrator'), load('connections/plugin-plan-resolver'),
    load('connections/adapters/mcp-stdio'), load('connections/adapters/mcp-oauth'), load('connections/adapters/browser-session'),
    load('connections/adapters/local-resource'), load('connections/adapters/openai-compatible-model'), load('connections/adapters/api-key'),
  ]);
  let serial = 0;
  // Static strategy fixtures are inputs to orchestration, not replacements for adapter logic.
  // Separate resolver cases exercise the actual resolver with injected MCP configuration inventory.
  async function fixture(adapter, configuration = {}, metadata, resolver, serviceId) {
    const dir = path.join(temp, String(++serial)); fs.mkdirSync(dir);
    const attempts = new A.ConnectionAttemptStore(dir), connections = new C.ConnectionStore(dir), activity = new E.ConnectionActivityStore(dir);
    const adapters = new R.ConnectionAdapterRegistry(); adapters.register(adapter);
    const events = [];
    const plans = resolver || { resolve: async input => ({ id: 'fixture-plan', serviceId: input.serviceId, serviceName: 'Offline fixture', pluginId: 'offline-fixture', strategy: { id: 'fixture-strategy', adapter: adapter.id, capabilities: [], readOnly: true, configuration }, requestedCapabilities: [], summary: 'Review offline fixture.', createdAt: new Date().toISOString() }) };
    const orchestrator = new O.ConnectionOrchestrator({ attempts, connections, activity, adapters, plans, broadcast: event => events.push(event), validateCredentialReference: ref => ref === 'fixture-reference-only' });
    const attempt = orchestrator.create({ serviceId: serviceId || 'offline-family-' + serial, requestedCapabilities: [], readOnly: true, metadata });
    await orchestrator.plan(attempt.id);
    return { orchestrator, attempts, connections, activity, events, id: attempt.id, record: () => connections.get(attempts.get(attempt.id).connectionId) };
  }
  async function approved(f) { return f.orchestrator.connect(f.id, { approved: true }); }
  async function disconnected(f) {
    await f.orchestrator.disconnect(f.record().id);
    const record = f.record(); assert.equal(record.enabled, false); assert.equal(record.authenticated, false); assert.equal(record.exposed, false); assert.deepEqual(record.exposedTools, []); assert.deepEqual(record.availableTools, []);
  }
  function stdio(host) { return new S.McpStdioConnectionAdapter(host); }
  function oauthHost(overrides = {}) {
    return { startOAuth: async () => ({ authorizationUrl: 'https://auth.example.invalid/authorize', scopes: ['read'], discoveryVersion: 2 }), oauthStatus: async () => ({ state: 'pending' }), connectServer: async () => ({ ok: true, tools: ['get_profile', 'place_order'] }), ...overrides };
  }
  await test('local MCP: real resolver, approval, exposure, verification, disconnect', async () => {
    let starts = 0, stops = 0;
    const id = 'offline-local-family';
    const resolver = new P.PluginConnectionPlanResolver(() => [{ id, transport: 'stdio', command: 'fixture-no-process' }]);
    const f = await fixture(stdio({ connect: async () => { starts++; return { ok: true, tools: ['list_items', 'delete_item'] }; }, disconnect: async () => { stops++; } }), {}, undefined, resolver, id);
    assert.equal((await f.orchestrator.connect(f.id)).state, 'awaiting_approval');
    assert.equal((await f.orchestrator.continue(f.id, { approved: true })).state, 'awaiting_approval'); assert.equal(starts, 0);
    assert.equal((await approved(f)).state, 'verifying'); assert.equal(starts, 1);
    assert.deepEqual(f.record().exposedTools, ['list_items']); assert(f.record().availableTools.includes('delete_item')); assert.equal(f.record().tools.find(t => t.name === 'delete_item').approved, false);
    assert.equal((await f.orchestrator.verify(f.id)).state, 'connected'); assert.equal(f.record().verified, true);
    assert(f.events.length > 0); assert(f.activity.list({ attemptId: f.id }).length > 0);
    await disconnected(f); assert.equal(stops, 1);
  });
  await test('local MCP: missing command fails before host launch', async () => {
    let starts = 0; const f = await fixture(stdio({ connect: async () => { starts++; return { ok: true, tools: ['list_items'] }; } }));
    const result = await approved(f);
    assert.equal(starts, 0, 'missing command must not call process host'); assert.equal(result.state, 'failed'); assert.equal(result.error.code, 'MCP_COMMAND_REQUIRED');
  });
  await test('local MCP: launch failure is not connected', async () => {
    const f = await fixture(stdio({ connect: async () => ({ ok: false, error: 'fixture process unavailable' }) }), { command: 'fixture' });
    const r = await approved(f); assert.equal(r.state, 'failed'); assert.equal(r.error.code, 'MCP_STDIO_CONNECT_FAILED'); assert.equal(r.connectionId, undefined);
  });
  await test('local MCP: zero tools remains unverified', async () => {
    const f = await fixture(stdio({ connect: async () => ({ ok: true, tools: [] }) }), { command: 'fixture' }); await approved(f);
    assert.equal((await f.orchestrator.verify(f.id)).state, 'degraded'); assert.equal(f.record().verified, false);
  });
  await test('hosted OAuth: pending, registration, safe exposure and cleanup', async () => {
    let state = 'pending', registrations = 0; const cleanup = [];
    const host = oauthHost({ oauthStatus: async () => ({ state }), connectServer: async () => { registrations++; return { ok: true, tools: ['get_profile', 'place_order'] }; }, disconnectServer: async () => { cleanup.push('disconnect'); }, revokeOAuth: async () => { cleanup.push('revoke'); }, clearOAuth: async () => { cleanup.push('clear'); } });
    const resolver = new P.PluginConnectionPlanResolver(() => [{ id: 'offline-hosted-family', transport: 'http', url: 'https://mcp.example.invalid/mcp' }]);
    const f = await fixture(new H.McpOAuthConnectionAdapter(host), {}, undefined, resolver, 'offline-hosted-family');
    const pending = await approved(f); assert.equal(pending.state, 'awaiting_oauth'); assert.equal(pending.requiredUserAction.type, 'oauth'); assert.equal(pending.connectionId, undefined);
    assert.equal((await f.orchestrator.continue(f.id)).state, 'awaiting_oauth'); assert.equal(registrations, 0);
    state = 'connected'; assert.equal((await f.orchestrator.continue(f.id)).state, 'verifying'); assert.deepEqual(f.record().exposedTools, ['get_profile']);
    assert.equal((await f.orchestrator.verify(f.id)).state, 'connected'); await disconnected(f); assert.deepEqual(cleanup, ['disconnect', 'revoke', 'clear']);
  });
  await test('hosted OAuth: cancellation is terminal and cleans pending flow', async () => {
    let cancelled = 0, registered = 0;
    const f = await fixture(new H.McpOAuthConnectionAdapter(oauthHost({ cancelOAuth: async () => { cancelled++; }, connectServer: async () => { registered++; return { ok: true }; } })));
    await approved(f); assert.equal(f.orchestrator.cancel(f.id).state, 'cancelled'); await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.orchestrator.continue(f.id)).state, 'cancelled'); assert.equal(cancelled, 1); assert.equal(registered, 0);
  });
  await test('hosted OAuth: rejection cannot report connected', async () => {
    let state = 'pending'; const f = await fixture(new H.McpOAuthConnectionAdapter(oauthHost({ oauthStatus: async () => ({ state, error: 'fixture denied' }) })));
    await approved(f); state = 'error'; const r = await f.orchestrator.continue(f.id); assert.equal(r.error.code, 'MCP_OAUTH_FAILED'); assert.notEqual(r.state, 'connected'); assert.equal(r.connectionId, undefined);
  });
  await test('hosted OAuth: MCP registration failure cannot report connected', async () => {
    const f = await fixture(new H.McpOAuthConnectionAdapter(oauthHost({ oauthStatus: async () => ({ state: 'connected' }), connectServer: async () => ({ ok: false, error: 'fixture initialize failed' }) })));
    const r = await approved(f); assert.equal(r.error.code, 'MCP_CONNECT_FAILED'); assert.notEqual(r.state, 'connected'); assert.equal(r.connectionId, undefined);
  });
  await test('plugin identity: unknown imported plugin must not fall back to model URL', async () => {
    const resolver = new P.PluginConnectionPlanResolver(() => []);
    await assert.rejects(() => resolver.resolve({ serviceId: 'offline-imported-missing-852', requestedCapabilities: [], readOnly: true, metadata: { pluginKind: 'provider', baseUrl: 'https://model.example.invalid/v1' } }), /unavailable|not found|No installed|identity|plugin/i);
  });
  await test('plugin identity: unqualified custom endpoint remains supported; qualified research cannot substitute', async () => {
    const resolver = new P.PluginConnectionPlanResolver(() => []);
    const input = { serviceId: 'offline-custom-model-852', requestedCapabilities: [], readOnly: true, metadata: { baseUrl: 'https://model.example.invalid/v1' } };
    assert.equal((await resolver.resolve(input)).strategy.adapter, 'openai-compatible-model');
    await assert.rejects(() => resolver.resolve({ ...input, metadata: { ...input.metadata, pluginKind: 'provider', officialSource: true, protocol: 'openai-compatible', sourceUrls: ['https://model.example.invalid/docs'] } }), /No installed/);
  });
  await test('plugin identity: installed unsupported provider stays fail-closed', async () => {
    const resolver = new P.PluginConnectionPlanResolver(() => []);
    await assert.rejects(() => resolver.resolve({ serviceId: 'anthropic', requestedCapabilities: [], readOnly: true, metadata: { pluginKind: 'provider', baseUrl: 'https://model.example.invalid/v1' } }), /SETUP_UNAVAILABLE/);
  });
  await test('browser session: missing URL fails without opening browser', async () => {
    let opened = 0; const f = await fixture(new B.BrowserSessionConnectionAdapter({ open: async () => { opened++; }, status: async () => ({ connected: false }) }));
    const r = await approved(f); assert.equal(r.error.code, 'LOGIN_URL_REQUIRED'); assert.equal(opened, 0);
  });
  await test('browser session: pending, verification, session loss, disconnect', async () => {
    let connected = false, opened = 0, closed = 0;
    const f = await fixture(new B.BrowserSessionConnectionAdapter({ open: async () => { opened++; }, status: async () => ({ connected }), close: async () => { closed++; } }), { loginUrl: 'https://browser.example.invalid/login' });
    assert.equal((await approved(f)).state, 'awaiting_browser_login'); assert.equal(opened, 1); assert.equal(f.record(), undefined);
    assert.equal((await f.orchestrator.continue(f.id)).state, 'awaiting_browser_login'); connected = true; await f.orchestrator.continue(f.id);
    assert.equal((await f.orchestrator.verify(f.id)).state, 'connected'); connected = false;
    assert.equal((await f.orchestrator.verify(f.id)).state, 'degraded'); assert.equal(f.record().verified, false); await disconnected(f); assert.equal(closed, 1);
  });
  await test('browser session: cancellation closes pending browser host', async () => {
    let closed = 0;
    const f = await fixture(new B.BrowserSessionConnectionAdapter({ open: async () => {}, status: async () => ({ connected: false }), close: async () => { closed++; } }), { loginUrl: 'https://browser.example.invalid/login' });
    await approved(f); f.orchestrator.cancel(f.id); await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, 1, 'cancel must release opened browser session'); assert.equal((await f.orchestrator.continue(f.id)).state, 'cancelled');
  });
  await test('local resource: missing selection needs approval without validation', async () => {
    let validated = 0; const f = await fixture(new L.LocalResourceConnectionAdapter({ validate: async () => { validated++; return { ok: false }; } }));
    const r = await approved(f); assert.equal(r.state, 'awaiting_approval'); assert.equal(r.requiredUserAction.type, 'local-resource'); assert.equal(validated, 0);
  });
  await test('local resource: real temp path validation, loss and revoke', async () => {
    const resource = path.join(temp, 'resource'); fs.mkdirSync(resource); let revoked = 0;
    const f = await fixture(new L.LocalResourceConnectionAdapter({ validate: async (_ctx, target) => ({ ok: fs.existsSync(target), error: fs.existsSync(target) ? undefined : 'fixture path missing' }), revoke: async () => { revoked++; } }), { path: resource, resourceKind: 'directory' });
    await approved(f); assert.equal((await f.orchestrator.verify(f.id)).state, 'connected'); fs.rmdirSync(resource);
    assert.equal((await f.orchestrator.verify(f.id)).state, 'degraded'); await disconnected(f); assert.equal(revoked, 1);
  });
  await test('local resource: plugin picker path reaches validation after approval', async () => {
    let target; const f = await fixture(new L.LocalResourceConnectionAdapter({ validate: async (_ctx, p) => { target = p; return { ok: true }; } }), {}, { pluginKind: 'capability' });
    await approved(f); const r = await f.orchestrator.connect(f.id, { approved: true, path: temp }); assert.equal(target, temp, 'approved picker path must survive plugin input filtering'); assert.notEqual(r.state, 'awaiting_approval');
  });
  function modelHost(overrides = {}) { return { createCredentialSession: async () => ({ id: 'offline-card' }), probe: async () => ({ ok: true, models: ['fixture-model'], streaming: true, toolCalling: true }), register: async () => ({ providerId: 'offline-provider', models: ['fixture-model'] }), ...overrides }; }
  await test('model: invalid URL fails before probe', async () => {
    let probes = 0; const f = await fixture(new M.OpenAiCompatibleModelConnectionAdapter(modelHost({ probe: async () => { probes++; return { ok: true }; } })), { baseUrl: 'file:///unsafe', authentication: 'none' });
    const r = await approved(f); assert.equal(r.error.code, 'INVALID_BASE_URL'); assert.equal(probes, 0);
  });
  await test('model: secure input prerequisite, probe, registration, disconnect', async () => {
    let probes = 0, registrations = 0, removed = 0;
    const f = await fixture(new M.OpenAiCompatibleModelConnectionAdapter(modelHost({ probe: async () => { probes++; return { ok: true, models: ['fixture-model'], streaming: true, toolCalling: true }; }, register: async () => { registrations++; return { providerId: 'offline-provider', models: ['fixture-model'] }; }, unregister: async () => { removed++; } })), { baseUrl: 'https://model.example.invalid/v1' });
    assert.equal((await approved(f)).state, 'awaiting_secure_input'); assert.equal(probes, 0); assert.equal(registrations, 0);
    await f.orchestrator.continue(f.id, { credentialRef: 'fixture-reference-only' }); assert.equal(registrations, 1); assert.equal((await f.orchestrator.verify(f.id)).state, 'connected'); assert(probes >= 1); await disconnected(f); assert.equal(removed, 1);
  });
  await test('model: unsuccessful probe never registers provider', async () => {
    let registrations = 0; const f = await fixture(new M.OpenAiCompatibleModelConnectionAdapter(modelHost({ probe: async () => ({ ok: false, error: 'fixture refused' }), register: async () => { registrations++; return { providerId: 'bad', models: [] }; } })), { baseUrl: 'http://127.0.0.1:1/v1', authentication: 'none' });
    const r = await approved(f); assert.equal(r.error.code, 'MODEL_ENDPOINT_PROBE_FAILED'); assert.equal(registrations, 0); assert.equal(r.connectionId, undefined);
  });
  await test('API key: stored reference without verifier is never authenticated', async () => {
    let cleared = 0;
    const f = await fixture(new K.ApiKeyConnectionAdapter({ createCredentialSession: async () => ({ id: 'offline-card' }), clearCredential: async () => { cleared++; } }));
    assert.equal((await approved(f)).state, 'awaiting_secure_input'); assert.equal(f.record(), undefined);
    await f.orchestrator.continue(f.id, { credentialRef: 'fixture-reference-only' }); assert.equal(f.record().authenticated, false); assert.equal(f.record().authState, 'pending');
    assert.equal((await f.orchestrator.verify(f.id)).state, 'degraded'); assert.equal(f.record().verified, false); assert.match(f.record().verification[0].message, /Stored, not verified/); await disconnected(f); assert.equal(cleared, 1);
  });
  const failed = results.filter(result => !result.pass);
  console.log(`SUMMARY ${results.length - failed.length}/${results.length} passed; ${failed.length} failed; offline host simulations, not real-provider proof.`);
  process.exitCode = failed.length ? 1 : 0;
})().catch(error => { console.error('HARNESS ERROR:', error.stack); process.exitCode = 2; }).finally(() => {
  for (const [mod, key, value] of originals) mod[key] = value;
  global.fetch = oldFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  fs.rmSync(temp, { recursive: true, force: true });
});
