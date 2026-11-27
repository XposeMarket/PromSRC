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
  // Pending polls must not strand the setup sheet: the sign-in action survives "not yet" answers.
  {
    const { McpOAuthConnectionAdapter } = await import('../dist/connections/adapters/mcp-oauth.js');
    const pollAdapters = new ConnectionAdapterRegistry();
    let flows = 0; let authState = 'pending';
    pollAdapters.register(new McpOAuthConnectionAdapter({
      startOAuth: async () => ({ authorizationUrl: `https://auth.example.test/authorize?state=flow${++flows}` }),
      oauthStatus: async () => (flows === 0 ? { state: 'error', error: 'no flow' } : { state: authState }),
      connectServer: async () => ({ ok: true, tools: ['get_holdings', 'place_order'] }),
    }));
    const pollPlans = { resolve: async ({ serviceId, requestedCapabilities }) => ({ id: 'plan-poll', serviceId, serviceName: 'Poll Fixture', pluginId: 'poll-plugin', strategy: { id: 'poll-mcp-oauth', adapter: 'mcp-oauth', capabilities: requestedCapabilities, readOnly: true, configuration: { desktopRequired: true } }, requestedCapabilities, summary: 'Pending poll plan.', createdAt: new Date().toISOString() }) };
    const poll = new ConnectionOrchestrator({ attempts, connections, adapters: pollAdapters, activity, plans: pollPlans, broadcast: () => {} });
    const pending = poll.create({ serviceId: 'poll-fixture', requestedCapabilities: [], readOnly: true });
    await poll.plan(pending.id);
    const started = await poll.connect(pending.id, { approved: true });
    assert.equal(started.state, 'awaiting_oauth');
    assert.equal(started.requiredUserAction.authorizationUrl, 'https://auth.example.test/authorize?state=flow1');
    assert.equal(started.requiredUserAction.desktopRequired, true);
    const progressBefore = started.progress.length;
    let polled;
    for (let i = 0; i < 3; i++) polled = await poll.continue(pending.id);
    assert.equal(polled.state, 'awaiting_oauth');
    assert.deepEqual(polled.requiredUserAction, started.requiredUserAction, 'a pending poll must keep the sign-in action');
    assert.equal(polled.progress.length, progressBefore, 'unchanged polls must not append progress');
    assert.equal(flows, 1, 'a pending poll must not restart the OAuth flow');
    // An attempt stranded by an older build (action already cleared) gets a fresh flow on the next poll.
    attempts.update(pending.id, { requiredUserAction: undefined });
    const rebuilt = await poll.continue(pending.id);
    assert.equal(rebuilt.state, 'awaiting_oauth');
    assert.equal(rebuilt.requiredUserAction.authorizationUrl, 'https://auth.example.test/authorize?state=flow2');
    // Completion still moves forward and clears the action.
    authState = 'connected';
    const done = await poll.continue(pending.id);
    assert.equal(done.state, 'verifying');
    assert.equal(done.requiredUserAction, undefined);
    assert.deepEqual(connections.get(done.connectionId).exposedTools, ['get_holdings']);
    // An adapter that reports a bare pending state (device code, browser and CLI login do) keeps its action too.
    const bareAdapters = new ConnectionAdapterRegistry();
    bareAdapters.register({ id: 'bare', kind: 'device-code', displayName: 'Bare pending', supports: () => true,
      connect: async () => ({ state: 'awaiting_device_code', userAction: { type: 'device-code', label: 'Enter code', userCode: 'ABCD-1234', verificationUri: 'https://device.example.test/activate' } }),
      continue: async () => ({ state: 'awaiting_device_code' }) });
    const barePlans = { resolve: async ({ serviceId, requestedCapabilities }) => ({ id: 'plan-bare', serviceId, serviceName: 'Bare Fixture', pluginId: 'bare-plugin', strategy: { id: 'bare-device', adapter: 'bare', capabilities: requestedCapabilities, readOnly: true }, requestedCapabilities, summary: 'Bare pending plan.', createdAt: new Date().toISOString() }) };
    const bare = new ConnectionOrchestrator({ attempts, connections, adapters: bareAdapters, activity, plans: barePlans, broadcast: () => {} });
    const bareAttempt = bare.create({ serviceId: 'bare-fixture', requestedCapabilities: [], readOnly: true });
    await bare.plan(bareAttempt.id);
    const bareStarted = await bare.connect(bareAttempt.id, { approved: true });
    assert.equal(bareStarted.requiredUserAction.userCode, 'ABCD-1234');
    const barePolled = await bare.continue(bareAttempt.id);
    assert.equal(barePolled.state, 'awaiting_device_code');
    assert.equal(barePolled.requiredUserAction.userCode, 'ABCD-1234', 'a bare pending result must keep the existing action');
    // A poll is activity: the 15-minute idle rule reads updatedAt. Recently touched attempts are not rewritten,
    // attempts last touched over a minute ago are refreshed, and neither adds a progress entry.
    const recentPoll = await bare.continue(bareAttempt.id);
    assert.equal(recentPoll.updatedAt, barePolled.updatedAt, 'an unchanged poll must not rewrite a recently touched attempt');
    attempts.data.attempts[bareAttempt.id].updatedAt = new Date(Date.now() - 16 * 60_000).toISOString();
    const agedPoll = await bare.continue(bareAttempt.id);
    assert(Date.now() - Date.parse(agedPoll.updatedAt) < 5_000, 'a successful poll must refresh updatedAt so the idle rule sees activity');
    assert.equal(agedPoll.progress.length, barePolled.progress.length, 'refreshing activity must not append progress');
    assert.equal(agedPoll.requiredUserAction.userCode, 'ABCD-1234');
    // Overlapping polls: the real host drops the old sign-in flow before the replacement exists. A second
    // poll landing in that gap used to read "no flow", fail the attempt, and break the first poll's result.
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let gapFlows = 0; let inGap = false; let hold = false; let release = () => {};
    const gapAdapters = new ConnectionAdapterRegistry();
    gapAdapters.register(new McpOAuthConnectionAdapter({
      startOAuth: async () => {
        inGap = true;
        if (hold) await new Promise((resolve) => { release = resolve; });
        inGap = false;
        return { authorizationUrl: `https://auth.example.test/authorize?state=gap${++gapFlows}` };
      },
      oauthStatus: async () => (inGap || gapFlows === 0 ? { state: 'error', error: 'no flow' } : { state: 'pending' }),
      connectServer: async () => ({ ok: true, tools: [] }),
    }));
    const gapPlans = { resolve: async ({ serviceId, requestedCapabilities }) => ({ id: 'plan-gap', serviceId, serviceName: 'Gap Fixture', pluginId: 'gap-plugin', strategy: { id: 'gap-mcp-oauth', adapter: 'mcp-oauth', capabilities: requestedCapabilities, readOnly: true }, requestedCapabilities, summary: 'Overlapping poll plan.', createdAt: new Date().toISOString() }) };
    const gap = new ConnectionOrchestrator({ attempts, connections, adapters: gapAdapters, activity, plans: gapPlans, broadcast: () => {} });
    const gapAttempt = gap.create({ serviceId: 'gap-fixture', requestedCapabilities: [], readOnly: true });
    await gap.plan(gapAttempt.id);
    assert.equal((await gap.connect(gapAttempt.id, { approved: true })).state, 'awaiting_oauth');
    attempts.update(gapAttempt.id, { requiredUserAction: undefined });
    hold = true;
    const firstPoll = gap.continue(gapAttempt.id);
    await sleep(10);
    assert.equal(inGap, true, 'fixture: the first poll must be replacing the flow when the second arrives');
    const secondPoll = gap.continue(gapAttempt.id, {});
    await sleep(10);
    release();
    const [firstResult, secondResult] = await Promise.all([firstPoll, secondPoll]);
    assert.equal(firstResult.state, 'awaiting_oauth');
    assert.equal(secondResult.state, 'awaiting_oauth', 'an overlapping poll must not fail the attempt');
    assert.equal(secondResult.requiredUserAction.authorizationUrl, 'https://auth.example.test/authorize?state=gap2');
    assert.equal(gapFlows, 2, 'overlapping polls must start one replacement flow, not one each');
    assert.equal(attempts.get(gapAttempt.id).error, undefined);
    // Sign-in window: the action carries the flow's expiry, a refresh as the user begins issues a fresh link and
    // window, and a flow that ran out of time fails with its own code instead of a generic failure.
    let winFlows = 0; let winStatus = { state: 'pending' };
    const winAdapters = new ConnectionAdapterRegistry();
    winAdapters.register(new McpOAuthConnectionAdapter({
      startOAuth: async () => ({ authorizationUrl: `https://auth.example.test/authorize?state=win${++winFlows}`, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }),
      oauthStatus: async () => (winFlows === 0 ? { state: 'error', error: 'no flow' } : winStatus),
      connectServer: async () => ({ ok: true, tools: [] }),
    }));
    const winPlans = { resolve: async ({ serviceId, requestedCapabilities }) => ({ id: 'plan-win', serviceId, serviceName: 'Window Fixture', pluginId: 'win-plugin', strategy: { id: 'win-mcp-oauth', adapter: 'mcp-oauth', capabilities: requestedCapabilities, readOnly: true, configuration: { desktopRequired: true } }, requestedCapabilities, summary: 'Sign-in window plan.', createdAt: new Date().toISOString() }) };
    const win = new ConnectionOrchestrator({ attempts, connections, adapters: winAdapters, activity, plans: winPlans, broadcast: () => {} });
    const winAttempt = win.create({ serviceId: 'window-fixture', requestedCapabilities: [], readOnly: true });
    await win.plan(winAttempt.id);
    assert.equal((await win.refreshUserAction(winAttempt.id)).state, 'awaiting_approval', 'refresh must never approve or start an unapproved attempt');
    assert.equal(winFlows, 0);
    const winStarted = await win.connect(winAttempt.id, { approved: true });
    assert(Date.parse(winStarted.requiredUserAction.expiresAt) > Date.now() + 25 * 60_000, 'the sign-in action must carry the flow expiry');
    const winPolled = await win.continue(winAttempt.id);
    assert.equal(winPolled.requiredUserAction.authorizationUrl, 'https://auth.example.test/authorize?state=win1', 'a poll must not refresh the link');
    const refreshed = await win.refreshUserAction(winAttempt.id);
    assert.equal(refreshed.state, 'awaiting_oauth');
    assert.equal(refreshed.requiredUserAction.authorizationUrl, 'https://auth.example.test/authorize?state=win2', 'refresh must issue a fresh sign-in link');
    assert.equal(refreshed.requiredUserAction.desktopRequired, true);
    assert.equal(winFlows, 2);
    winStatus = { state: 'error', error: 'authorization timed out', expired: true };
    const expired = await win.continue(winAttempt.id);
    assert.equal(expired.state, 'failed');
    assert.equal(expired.error.code, 'MCP_OAUTH_EXPIRED', 'an expired sign-in window must be reported as expired');
    assert.equal((await win.refreshUserAction(winAttempt.id)).state, 'failed', 'refresh must not reopen a failed attempt');
    assert.equal(winFlows, 2);
    winStatus = { state: 'error', error: 'Provider authorization error (access_denied)' };
    const deniedAttempt = win.create({ serviceId: 'window-fixture', requestedCapabilities: [], readOnly: true });
    await win.plan(deniedAttempt.id);
    winFlows = 0;
    const deniedStart = await win.connect(deniedAttempt.id, { approved: true });
    assert.equal(deniedStart.state, 'awaiting_oauth');
    assert.equal((await win.continue(deniedAttempt.id)).error.code, 'MCP_OAUTH_FAILED', 'a provider failure keeps the generic code');
    // An adapter with no refresh hook keeps the action it has.
    const bareRefreshed = await bare.refreshUserAction(bareAttempt.id);
    assert.equal(bareRefreshed.state, 'awaiting_device_code');
    assert.equal(bareRefreshed.requiredUserAction.userCode, 'ABCD-1234');
  }
  console.log('PASS: durable connection orchestration, plugin contract, conservative exposure, Robinhood plan, pending polls keep the sign-in action and activity, and overlapping polls are serialized');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
