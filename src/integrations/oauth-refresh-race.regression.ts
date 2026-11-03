// OAuth refresh coordination: the status probe never refreshes a valid token,
// concurrent refreshes share one request, and a late refresh response can
// never overwrite a fresh reconnect or resurrect a disconnected connector.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OAuthConnector, type ConnectorTokens } from './oauth-base.js';

class TestConnector extends OAuthConnector {
  constructor(dir: string) {
    super({
      id: 'race_test', name: 'RaceTest',
      authUrl: 'https://auth.invalid/authorize', tokenUrl: 'https://auth.invalid/token',
      clientId: 'cid', clientSecret: 'csecret', scopes: ['x'], usePkce: false,
      callbackPort: 0, callbackPath: '/cb',
    }, dir);
  }
  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + 3600_000 };
  }
}

const realFetch = globalThis.fetch;
let fetchCalls = 0;
let release: () => void = () => {};
let nextResponse: () => Response = () => new Response('{}', { status: 500 });
globalThis.fetch = (async () => {
  fetchCalls++;
  await new Promise<void>((resolve) => { release = resolve; });
  return nextResponse();
}) as typeof fetch;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-oauth-race-'));
const tick = () => new Promise((r) => setTimeout(r, 20));

async function main(): Promise<void> {
  const c = new TestConnector(root);

  // 1. Probe ignores a token that is near expiry but still valid.
  c.saveTokens({ access_token: 'a1', refresh_token: 'r1', expires_at: Date.now() + 60_000 });
  c.probeExpiredGrant();
  await tick();
  assert.equal(fetchCalls, 0, 'probe must not refresh an unexpired token');

  // 2. Expired: probe and a foreground refresh share one request.
  c.saveTokens({ access_token: 'a1', refresh_token: 'r1', expires_at: Date.now() - 1000 });
  nextResponse = () => new Response(JSON.stringify({ access_token: 'a2', expires_in: 3600 }), { status: 200 });
  c.probeExpiredGrant();
  const fg = c.refreshTokens(c.loadTokens()!);
  await tick();
  assert.equal(fetchCalls, 1, 'concurrent refreshes share one token request');
  release();
  assert.equal((await fg).access_token, 'a2');
  assert.equal(c.loadTokens()?.access_token, 'a2');

  // 3. Reconnect while a refresh that will fail with invalid_grant is in flight.
  fetchCalls = 0;
  c.saveTokens({ access_token: 'old', refresh_token: 'r-old', expires_at: Date.now() - 1000 });
  nextResponse = () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  const stale = c.refreshTokens(c.loadTokens()!).catch((e) => e);
  await tick();
  c.saveTokens({ access_token: 'fresh', refresh_token: 'r-new', expires_at: Date.now() + 3600_000 });
  release();
  assert.ok((await stale) instanceof Error);
  const afterReconnect = c.loadTokens();
  assert.equal(afterReconnect?.access_token, 'fresh', 'late invalid_grant must not overwrite a fresh reconnect');
  assert.equal(afterReconnect?.reauth_required_at, undefined);
  assert.equal(c.authStatus().state, 'connected');

  // 4. Disconnect while a successful refresh is in flight: it must not resurrect tokens.
  c.saveTokens({ access_token: 'x', refresh_token: 'r-x', expires_at: Date.now() - 1000 });
  nextResponse = () => new Response(JSON.stringify({ access_token: 'zombie', expires_in: 3600 }), { status: 200 });
  const pending = c.refreshTokens(c.loadTokens()!).catch((e) => e);
  await tick();
  c.clearTokens();
  release();
  assert.ok((await pending) instanceof Error);
  assert.equal(c.loadTokens(), null, 'late refresh must not recreate disconnected credentials');

  // 5. A real dead grant still gets flagged.
  c.saveTokens({ access_token: 'd', refresh_token: 'r-dead', expires_at: Date.now() - 1000 });
  nextResponse = () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  const dead = c.refreshTokens(c.loadTokens()!).catch((e) => e);
  await tick();
  release();
  assert.match(String((await dead)?.message), /needs to be reconnected/);
  assert.equal(c.authStatus().state, 'reauth_required');
  assert.equal(c.isConnected(), false);
  await assert.rejects(() => c.getValidAccessToken(), /needs to be reconnected/, 'flagged grant fails fast');

  console.log('oauth refresh race regression passed');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    globalThis.fetch = realFetch;
    fs.rmSync(root, { recursive: true, force: true });
  });
