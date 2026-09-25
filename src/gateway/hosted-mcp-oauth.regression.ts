import assert from 'node:assert/strict';
import { getMcpOAuthRedirectUris, startMcpOAuthFlow, handleMcpOAuthCallback, getMcpOAuthFlowStatus, hasMcpOAuthTokens, setMcpOAuthTestOverrides, clearMcpOAuth } from './mcp-oauth.js';
import { listHostedMcpCatalog } from './hosted-mcp-catalog.js';

async function main(): Promise<void> {
  process.env.MCP_OAUTH_TEST_MODE = '1';
  process.env.MCP_OAUTH_NO_BROWSER = '1';
  const store = new Map<string, string>();
  const publicUrl = 'https://phone.example.test/';
  const redirectUri = 'https://phone.example.test/mcp-oauth/callback';
  setMcpOAuthTestOverrides({ publicUrl, storage: store });
  const originalFetch = globalThis.fetch;
  const registrations: string[][] = [];
  const exchanges: URLSearchParams[] = [];
  const json = (body: object) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://mcp.vercel.com/.well-known/oauth-protected-resource') return json({ authorization_servers: ['https://auth.example.test'] });
    if (url === 'https://auth.example.test/.well-known/oauth-authorization-server') {
      return json({ authorization_endpoint: 'https://auth.example.test/authorize', token_endpoint: 'https://auth.example.test/token', registration_endpoint: 'https://auth.example.test/register' });
    }
    if (url === 'https://auth.example.test/register') {
      const body = JSON.parse(String(init?.body));
      registrations.push(body.redirect_uris);
      return json({ client_id: `test-client-${registrations.length}` });
    }
    if (url === 'https://auth.example.test/token') {
      exchanges.push(new URLSearchParams(String(init?.body)));
      return json({ access_token: 'test-access-token', expires_in: 3600 });
    }
    return new Response('Not found', { status: 404 });
  };

  const id = 'hosted-vercel';
  try {
    const catalog = listHostedMcpCatalog();
    assert.ok(catalog.length >= 8 && catalog.every((entry) => entry.dcr && /^https:\/\//.test(entry.url)));
    assert.equal(new Set(catalog.map((entry) => entry.id)).size, catalog.length, 'hosted ids are unique');
    assert.equal(catalog.find((entry) => entry.id === 'asana')?.publicCallback, false, 'loopback-only providers are marked');
    assert.deepEqual(getMcpOAuthRedirectUris(), ['http://127.0.0.1:19847/mcp-oauth/callback', redirectUri]);
    const started = await startMcpOAuthFlow(id, 'https://mcp.vercel.com', undefined, undefined, { callback: 'public', openBrowser: false });
    assert.equal(started.status, 'pending', started.error);
    const authorize = new URL(started.authorizeUrl!);
    assert.equal(authorize.searchParams.get('redirect_uri'), redirectUri);
    assert.deepEqual(registrations, [getMcpOAuthRedirectUris()]);
    const state = authorize.searchParams.get('state')!;
    assert.equal((await handleMcpOAuthCallback(new URLSearchParams({ code: 'wrong-code', state: 'wrong-state' }))).ok, false);
    assert.equal(getMcpOAuthFlowStatus(id)?.status, 'pending');
    assert.equal(exchanges.length, 0);
    const result = await handleMcpOAuthCallback(new URLSearchParams({ code: 'test-code', state }));
    assert.equal(result.ok, true);
    assert.equal(result.serverId, id);
    assert.equal(exchanges[0].get('redirect_uri'), redirectUri);
    assert.equal(exchanges[0].get('code'), 'test-code');
    assert.equal(getMcpOAuthFlowStatus(id)?.status, 'connected');
    assert.equal(hasMcpOAuthTokens(id), true);
    assert.equal((await handleMcpOAuthCallback(new URLSearchParams({ code: 'replay', state }))).ok, false);
    assert.equal(exchanges.length, 1);
    console.log('PASS hosted MCP OAuth: catalog, DCR redirect set, phone callback, PKCE token exchange, wrong-state and replay rejection, connected status (in-memory vault)');
  } finally {
    clearMcpOAuth(id);
    globalThis.fetch = originalFetch;
    setMcpOAuthTestOverrides(null);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
