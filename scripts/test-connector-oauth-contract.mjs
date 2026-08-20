import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { ConnectionAttemptStore } = await import('../dist/connections/attempt-store.js');
const { ConnectionStore } = await import('../dist/connections/connection-store.js');
const { ConnectionActivityStore } = await import('../dist/connections/activity-store.js');
const { ConnectionAdapterRegistry } = await import('../dist/connections/adapter-registry.js');
const { ConnectionOrchestrator } = await import('../dist/connections/orchestrator.js');
const { ConnectorOAuthConnectionAdapter } = await import('../dist/connections/adapters/connector-oauth.js');
const { accountIdentitiesMatch, buildConnectorCapabilityGrants, classifyConnectorTools } = await import('../dist/connections/connector-contract.js');
const { parseExtensionDescriptor } = await import('../dist/extensions/schema.js');
const { OAuthConnector } = await import('../dist/integrations/oauth-base.js');
const { buildAuthMetadataCandidates, parseResourceMetadataUrl } = await import('../dist/gateway/mcp-oauth.js');

const root = process.cwd();
const manifestPath = path.join(root, 'src', 'extensions', 'bundled', 'connectors', 'github', 'prometheus.extension.json');
const descriptor = parseExtensionDescriptor(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath);
assert.equal(descriptor.connection?.strategies[0]?.adapter, 'connector-oauth');
assert.equal(descriptor.connection?.strategies[0]?.authentication?.pkceRequired, true);
assert.equal(descriptor.connection?.toolPolicy?.defaultExposure, 'read-only');
assert.equal(descriptor.connection?.toolPolicy?.unknownTools, 'blocked');
assert.deepEqual(descriptor.connection?.strategies?.[0]?.config?.registeredTools, [
  'connector_github_list_repos',
  'connector_github_list_issues',
  'connector_github_create_issue',
  'connector_github_create_repo',
  'connector_github_list_prs',
  'connector_github_create_pr',
  'connector_github_merge_pr',
  'connector_github_get_pr',
  'connector_github_list_commits',
  'connector_github_list_check_runs',
  'connector_github_get_file',
  'connector_github_search',
]);

const migratedConnectorIds = ['github', 'gmail', 'google_drive', 'ga4', 'notion', 'slack', 'hubspot', 'salesforce', 'reddit'];
for (const id of migratedConnectorIds) {
  const file = path.join(root, 'src', 'extensions', 'bundled', 'connectors', id, 'prometheus.extension.json');
  const item = parseExtensionDescriptor(JSON.parse(fs.readFileSync(file, 'utf8')), file);
  const strategy = item.connection?.strategies?.find((candidate) => candidate.adapter === 'connector-oauth');
  assert(strategy, `${id} must declare a managed connector OAuth strategy`);
  assert.equal(item.connection?.toolPolicy?.defaultExposure, 'read-only', `${id} must default to read-only exposure`);
  assert.equal(item.connection?.toolPolicy?.unknownTools, 'blocked', `${id} must block unknown tools`);
  assert.equal(strategy.authentication?.callback?.path, item.setup?.callback?.path, `${id} manifest/setup callbacks must agree`);
  assert.equal(strategy.authentication?.callback?.port, item.setup?.callback?.port, `${id} manifest/setup callback ports must agree`);
  assert.equal(item.connection?.providerApp?.externalSetupRequired, true, `${id} must make provider app prerequisites explicit`);
}
for (const id of ['gmail', 'google_drive', 'ga4', 'salesforce']) {
  const file = path.join(root, 'src', 'extensions', 'bundled', 'connectors', id, 'prometheus.extension.json');
  const item = parseExtensionDescriptor(JSON.parse(fs.readFileSync(file, 'utf8')), file);
  assert.equal(item.connection?.strategies?.find((candidate) => candidate.adapter === 'connector-oauth')?.authentication?.nonceRequired, true, `${id} must bind OIDC nonce validation`);
}
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'src', 'extensions', 'bundled', 'connectors', 'google_drive', 'prometheus.extension.json'), 'utf8')).setup.callback.path, '/auth/callback/google-drive');
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'src', 'extensions', 'bundled', 'connectors', 'ga4', 'prometheus.extension.json'), 'utf8')).setup.callback.port, 19429);
assert.equal(parseResourceMetadataUrl('Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"'), 'https://mcp.example.test/.well-known/oauth-protected-resource');
assert(buildAuthMetadataCandidates('https://auth.example.test/tenant', 'https://mcp.example.test').some((candidate) => candidate.includes('oauth-authorization-server')));

const classified = classifyConnectorTools([
  'connector_github_list_repos',
  'connector_github_create_issue',
  'connector_github_merge_pr',
  'connector_unknown_tool',
], true);
assert.deepEqual(classified.exposedTools, ['connector_github_list_repos']);
assert.equal(classified.tools.find((tool) => tool.name === 'connector_github_create_issue')?.approved, false);
assert.equal(classified.tools.find((tool) => tool.name === 'connector_github_merge_pr')?.approved, false);
assert.equal(classified.tools.find((tool) => tool.name === 'connector_unknown_tool')?.risk, 'unknown');

const grants = buildConnectorCapabilityGrants([
  { id: 'repositories.read', risk: 'read' },
  { id: 'issues.write', risk: 'write' },
], ['repositories.read'], true);
assert.deepEqual(grants.grantedCapabilities, ['repositories.read']);
assert.equal(grants.capabilityGrants.find((grant) => grant.id === 'issues.write')?.approvalRequired, true);
assert.equal(accountIdentitiesMatch({ provider: 'github', providerAccountId: '1' }, { provider: 'github', providerAccountId: '2' }), false);
assert.equal(accountIdentitiesMatch({ provider: 'github', email: 'USER@example.test' }, { provider: 'github', email: 'user@example.test' }), true);

const oauthSecurityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-oauth-security-'));
try {
  class SecurityFixtureConnector extends OAuthConnector {
    constructor() {
      super({ id: 'oauth-security-fixture', name: 'OAuth fixture', authUrl: 'https://provider.test/authorize', tokenUrl: 'https://provider.test/token', revokeUrl: 'https://provider.test/revoke', clientId: 'public-client-id', scopes: ['read'], usePkce: true, useNonce: true, callbackPort: 19499, callbackPath: '/oauth/callback' }, oauthSecurityDir);
    }
    async buildTokens() { return { access_token: 'fixture-token', expires_at: Date.now() + 60_000, account_id: 'fixture-account' }; }
  }
  const fixture = new SecurityFixtureConnector();
  const first = fixture.startFlow(undefined, ['read']);
  const authorization = new URL(first.authUrl);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert(authorization.searchParams.get('code_challenge'));
  assert(authorization.searchParams.get('nonce'));
  assert.equal(authorization.searchParams.get('scope'), 'read');
  const collision = fixture.startFlow();
  assert.match(collision.error || '', /already in progress/);
  const mismatch = await fixture.handleCallback('unused', 'wrong-state');
  assert.match(mismatch.error || '', /State mismatch/);
  assert.match(fixture.startFlow().error || '', /already in progress/, 'state mismatch must not replace a valid pending flow');
  const originalFetch = globalThis.fetch;
  const nonce = authorization.searchParams.get('nonce');
  const idTokenPayload = Buffer.from(JSON.stringify({ nonce }), 'utf8').toString('base64url');
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://provider.test/token');
    return new Response(JSON.stringify({ access_token: 'fixture-token', expires_in: 3600, id_token: `header.${idTokenPayload}.signature` }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const completed = await fixture.handleCallback('fixture-code', authorization.searchParams.get('state') || '');
    assert.equal(completed.success, true, 'matching OIDC nonce must allow the callback to complete');
  } finally {
    globalThis.fetch = originalFetch;
  }
  fixture.saveCredentials('public-client-id', 'public-client-secret');
  fixture.saveTokens({ access_token: 'old-access', refresh_token: 'old-refresh', expires_at: Date.now() - 1000 });
  const lifecycleFetch = globalThis.fetch;
  const lifecycleCalls = [];
  globalThis.fetch = async (url) => {
    lifecycleCalls.push(String(url));
    if (String(url) === 'https://provider.test/token') {
      return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('', { status: 200 });
  };
  try {
    const refreshed = await fixture.refreshTokens(fixture.loadTokens());
    assert.equal(refreshed.access_token, 'new-access', 'refresh must replace the access token without losing lifecycle state');
    await fixture.revokeAccess();
    assert.deepEqual(lifecycleCalls, ['https://provider.test/token', 'https://provider.test/revoke']);
  } finally {
    globalThis.fetch = lifecycleFetch;
  }
} finally {
  fs.rmSync(oauthSecurityDir, { recursive: true, force: true });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-connector-oauth-'));
try {
  const attempts = new ConnectionAttemptStore(dir);
  const connections = new ConnectionStore(dir);
  const activity = new ConnectionActivityStore(dir);
  const adapters = new ConnectionAdapterRegistry();
  let pollCount = 0;
  let revoked = false;
  let cleared = false;
  let expectedAccountReceived;
  const bridge = {
    id: 'github',
    name: 'GitHub',
    start: (expectedAccountId, requestedScopes) => { expectedAccountReceived = expectedAccountId; requestedScopesReceived = requestedScopes; return { success: false, authUrl: 'https://github.test/authorize?state=opaque', flowId: 'github' }; },
    poll: async () => {
      pollCount += 1;
      return pollCount === 1 ? null : { success: true, account_email: 'dev@example.test' };
    },
    metadata: () => ({
      account: { providerAccountId: 'account-1', displayName: 'Dev Account', username: 'dev', email: 'dev@example.test' },
      grantedScopes: ['repo', 'read:user'],
      refreshAvailable: true,
      clientIdConfigured: true,
      clientSecretConfigured: true,
    }),
    verify: async () => ({
      account: { provider: 'github', providerAccountId: 'account-1', displayName: 'Dev Account', username: 'dev', email: 'dev@example.test' },
      resources: [{ kind: 'account', id: 'account-1', displayName: 'Dev Account' }],
    }),
    revoke: async () => { revoked = true; },
    clear: () => { cleared = true; },
    credentialReference: () => 'vault:integration.github.oauth_tokens',
  };
  let requestedScopesReceived;
  const notionBridge = {
    id: 'notion',
    name: 'Notion',
    start: () => ({ success: false, authUrl: 'https://notion.test/authorize', flowId: 'notion' }),
    poll: async () => null,
    metadata: () => ({ refreshAvailable: false, clientIdConfigured: true, clientSecretConfigured: true }),
    verify: async () => ({ account: { provider: 'notion', providerAccountId: 'workspace-user' }, resources: [{ kind: 'workspace', id: 'workspace-1' }] }),
    clear: () => {},
  };
  adapters.register(new ConnectorOAuthConnectionAdapter({ github: bridge, notion: notionBridge }));
  const plans = {
    resolve: async ({ serviceId, requestedCapabilities }) => ({
      id: 'github-plan', serviceId, serviceName: 'GitHub', pluginId: 'github',
      strategy: {
        id: 'github-oauth-pkce', adapter: 'connector-oauth', capabilities: requestedCapabilities, readOnly: true,
        capabilityContracts: descriptor.connection.requestedCapabilities,
        authentication: {
          type: 'oauth2-pkce', scopes: ['repo'], pkceRequired: true,
          callback: { host: 'localhost', port: 19422, path: '/auth/callback/github' },
        },
        configuration: {
          registeredTools: descriptor.ownership.tools,
          providerApp: descriptor.connection.providerApp,
        },
      },
      requestedCapabilities, summary: 'GitHub read-only test plan.', createdAt: new Date().toISOString(),
    }),
  };
  const orchestrator = new ConnectionOrchestrator({ attempts, connections, adapters, activity, plans });
  const created = orchestrator.create({ serviceId: 'github', requestedCapabilities: ['repositories.read', 'issues.read'], readOnly: true, metadata: { expectedAccountId: 'account-1' } });
  const planned = await orchestrator.plan(created.id);
  assert.equal(planned.state, 'awaiting_approval');
  const started = await orchestrator.connect(created.id, { approved: true });
  assert.equal(started.state, 'awaiting_oauth');
  assert.equal(expectedAccountReceived, 'account-1');
  assert.deepEqual(requestedScopesReceived, ['repo']);
  assert.equal(started.requiredUserAction?.type, 'oauth');
  const pending = await orchestrator.continue(created.id);
  assert.equal(pending.state, 'awaiting_oauth');
  const registering = await orchestrator.continue(created.id);
  assert.equal(registering.state, 'registering');
  const recordId = registering.connectionId;
  assert(recordId);
  const record = connections.get(recordId);
  assert.equal(record.contractVersion, 2);
  assert.equal(record.account?.providerAccountId, 'account-1');
  assert.deepEqual(record.resources?.map((resource) => resource.id), ['account-1']);
  assert(record.exposedTools.includes('connector_github_list_repos'));
  assert(!record.exposedTools.includes('connector_github_create_issue'));
  assert.equal(record.capabilityGrants?.find((grant) => grant.id === 'issues.write')?.granted, false);
  assert.equal(record.providerApp?.pkceRequired, true);
  assert(!JSON.stringify(record).includes('access_token'));
  const legacyRecord = connections.create({
    serviceId: 'legacy-gmail', serviceName: 'Legacy Gmail', pluginId: 'legacy-gmail', strategyId: 'legacy-compatibility', adapterId: 'legacy',
    installed: true, enabled: true, configured: true, authenticated: true, registered: false, exposed: false, verified: false,
    authState: 'healthy', health: 'unknown', contractVersion: 1,
    migration: { source: 'legacy', target: 'connection-v2', version: 2, migratedAt: new Date().toISOString(), rollbackSupported: true, legacyReadable: true },
    account: { provider: 'gmail', providerAccountId: 'legacy-account' }, grantedCapabilities: [], registeredTools: [], exposedTools: [],
  });
  assert.equal(connections.get(legacyRecord.id)?.contractVersion, 1, 'legacy v1 records must remain readable');
  const verified = await orchestrator.verify(created.id);
  assert.equal(verified.state, 'connected');
  assert.equal(connections.get(recordId).verified, true);
  await orchestrator.disconnect(recordId);
  assert.equal(revoked, true);
  assert.equal(cleared, true);
  assert.equal(connections.get(recordId).enabled, false);

  const selected = await adapters.get('connector-oauth').connect({
    attempt: {
      id: 'notion-map-attempt', schemaVersion: 1, serviceId: 'notion', serviceName: 'Notion', requestedCapabilities: [],
      readOnly: true, state: 'awaiting_approval', progress: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      plan: { id: 'notion-plan', serviceId: 'notion', serviceName: 'Notion', pluginId: 'notion', requestedCapabilities: [],
        strategy: { id: 'notion-oauth', adapter: 'connector-oauth', capabilities: [], readOnly: true, authentication: { type: 'oauth2', scopes: [] }, configuration: {} },
        summary: 'Notion map test', createdAt: new Date().toISOString() },
    },
  });
  assert.equal(selected.configuration.oauthProvider, 'notion', 'shared adapter must resolve the bridge by service id');

  const oauthSource = fs.readFileSync(path.join(root, 'src', 'integrations', 'oauth-base.ts'), 'utf8');
  const githubSource = fs.readFileSync(path.join(root, 'src', 'integrations', 'connectors', 'github.ts'), 'utf8');
  assert.match(githubSource, /usePkce:\s*true/);
  assert.match(oauthSource, /code_challenge_method/);
  assert.match(oauthSource, /url\.pathname !== this\.cfg\.callbackPath/);
  assert.match(oauthSource, /if \(returnedState !== flow\.state\) \{\s*return \{ success: false, error: 'State mismatch/);
  assert.match(oauthSource, /Do not consume a valid pending flow/);
  assert.match(oauthSource, /let finished = false/);
  assert.match(oauthSource, /escapeHtml/);
  assert.match(oauthSource, /readIdTokenNonce/);
  assert.match(oauthSource, /Nonce validation failed/);
  const notionSource = fs.readFileSync(path.join(root, 'src', 'integrations', 'connectors', 'notion.ts'), 'utf8');
  assert.match(notionSource, /tokenAuthMethod:\s*'basic'/, 'Notion token exchange must use Basic client authentication');
  assert.match(oauthSource, /applyClientAuthentication/);
  const mcpOAuthSource = fs.readFileSync(path.join(root, 'src', 'gateway', 'mcp-oauth.ts'), 'utf8');
  assert.match(mcpOAuthSource, /url\.pathname !== REDIRECT_PATH/);
  assert.match(mcpOAuthSource, /revocation_endpoint/);
  assert.match(mcpOAuthSource, /function safeOAuthError/);
  assert.match(mcpOAuthSource, /code_challenge_method/);
  console.log('PASS: connector OAuth contract, PKCE/state/callback safeguards, account continuity, grants, safe exposure, and revoke lifecycle');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
