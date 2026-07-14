import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { ConnectionAttemptStore } = await import('../dist/connections/attempt-store.js');
const { ConnectionStore } = await import('../dist/connections/connection-store.js');
const { ConnectionActivityStore } = await import('../dist/connections/activity-store.js');
const { ConnectionAdapterRegistry } = await import('../dist/connections/adapter-registry.js');
const { ConnectionOrchestrator } = await import('../dist/connections/orchestrator.js');
const { ToolClassifierService } = await import('../dist/connections/tool-classifier.js');
const { parseExtensionDescriptor } = await import('../dist/extensions/schema.js');
const { PluginConnectionPlanResolver } = await import('../dist/connections/plugin-plan-resolver.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-connections-v2-'));
try {
  const attempts = new ConnectionAttemptStore(dir);
  const connections = new ConnectionStore(dir);
  const activity = new ConnectionActivityStore(dir);
  const adapters = new ConnectionAdapterRegistry();
  adapters.register({
    id: 'fixture', kind: 'custom-http', displayName: 'Fixture adapter',
    supports: (strategy) => strategy.adapter === 'fixture',
    connect: async () => ({ state: 'verifying', connection: { configured: true, authenticated: true, registered: true, exposed: true, authState: 'healthy', health: 'unknown', registeredTools: ['list_accounts', 'delete_account'], exposedTools: ['list_accounts'], tools: [{ name: 'list_accounts', risk: 'read-only', approved: true }, { name: 'delete_account', risk: 'destructive', approved: false }] } }),
    verify: async (_ctx, connection) => [{ id: 'fixture-check', check: 'safe-read', passed: connection.exposedTools.includes('list_accounts') && !connection.exposedTools.includes('delete_account'), verifiedAt: new Date().toISOString() }],
  });
  const plans = { resolve: async ({ serviceId, requestedCapabilities }) => ({ id: 'plan-1', serviceId, serviceName: 'Fixture', pluginId: 'fixture-plugin', strategy: { id: 'fixture-strategy', adapter: 'fixture', capabilities: requestedCapabilities, readOnly: true }, requestedCapabilities, summary: 'Fixture read-only plan.', createdAt: new Date().toISOString() }) };
  const events = [];
  const orchestrator = new ConnectionOrchestrator({ attempts, connections, adapters, activity, plans, broadcast: (event) => events.push(event) });
  const created = orchestrator.create({ serviceId: 'fixture', requestedCapabilities: ['accounts.read'], readOnly: true });
  assert.equal(created.state, 'requested');
  const planned = await orchestrator.plan(created.id);
  assert.equal(planned.state, 'awaiting_approval');
  const connected = await orchestrator.connect(created.id, { approved: true });
  assert.equal(connected.state, 'verifying');
  assert(connected.connectionId);
  const verified = await orchestrator.verify(created.id);
  assert.equal(verified.state, 'connected');
  const record = connections.get(connected.connectionId);
  assert.equal(record.verified, true);
  assert.deepEqual(record.exposedTools, ['list_accounts']);
  assert(!record.exposedTools.includes('delete_account'));
  assert(events.some((event) => event.type === 'connection_attempt_updated'));
  assert(activity.list({ attemptId: created.id }).length >= 3);

  const classifier = new ToolClassifierService();
  assert.equal((await classifier.classify({ name: 'place_order', description: 'Place a stock order' }, { serviceId: 'robinhood', readOnlyRequested: true })).risk, 'financial-mutation');
  assert.equal((await classifier.classify({ name: 'get_holdings', description: 'List portfolio holdings' }, { serviceId: 'robinhood', readOnlyRequested: true })).risk, 'read-only');

  const robinhoodManifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'extensions', 'bundled', 'mcp_presets', 'robinhood', 'prometheus.extension.json'), 'utf8'));
  const descriptor = parseExtensionDescriptor(robinhoodManifest, 'robinhood-test');
  assert.equal(descriptor.connection.strategies[0].adapter, 'mcp-oauth');
  assert.equal(descriptor.connection.toolPolicy.defaultExposure, 'read-only');
  const robinhoodPlan = await new PluginConnectionPlanResolver(() => []).resolve({ serviceId: 'robinhood-trading', requestedCapabilities: ['portfolio.read'], readOnly: true });
  assert.equal(robinhoodPlan.strategy.adapter, 'mcp-oauth');
  assert.equal(robinhoodPlan.strategy.readOnly, true);
  const resolver = new PluginConnectionPlanResolver(() => []);
  const aliasDiscovery = resolver.discover('Robinhood MCP');
  assert.equal(aliasDiscovery.status, 'resolved');
  assert.equal(aliasDiscovery.canonicalServiceId, 'robinhood-trading');
  const aliasPlan = await resolver.resolve({ serviceId: 'Robinhood MCP', requestedCapabilities: ['portfolio.read'], readOnly: true });
  assert.equal(aliasPlan.serviceId, 'robinhood-trading');
  const unknownDiscovery = resolver.discover('An entirely unknown future service');
  assert.equal(unknownDiscovery.status, 'research_required');
  await assert.rejects(() => resolver.resolve({ serviceId: 'future-service', requestedCapabilities: [], readOnly: true, metadata: { officialSource: true, protocol: 'mcp-oauth' } }), /HTTPS source URL/);
  const researchedPlan = await resolver.resolve({ serviceId: 'future-service', requestedCapabilities: [], readOnly: true, metadata: { officialSource: true, protocol: 'mcp-oauth', endpoint: 'https://api.example.test/mcp', sourceUrls: ['https://docs.example.test/mcp'] } });
  assert.equal(researchedPlan.strategy.adapter, 'mcp-oauth');

  const aliasOrchestrator = new ConnectionOrchestrator({ attempts, connections, adapters, activity, plans: resolver, broadcast: (event) => events.push(event) });
  const aliasAttempt = aliasOrchestrator.create({ serviceId: 'Robinhood MCP', requestedCapabilities: ['portfolio.read'], readOnly: true });
  assert.equal(aliasAttempt.serviceId, 'robinhood-trading');
  const duplicate = aliasOrchestrator.create({ serviceId: 'Robinhood', requestedCapabilities: ['portfolio.read'], readOnly: true });
  assert.equal(duplicate.id, aliasAttempt.id, 'active equivalent attempts should be reused');
  const plannedAlias = await aliasOrchestrator.plan(aliasAttempt.id);
  assert.equal(plannedAlias.state, 'awaiting_approval');
  assert.equal(plannedAlias.serviceName, 'Robinhood Trading MCP');
  console.log('PASS: durable connection orchestration, plugin contract, conservative exposure, and Robinhood plan');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
