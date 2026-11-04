// OAuth callback must refuse to save a connection when the provider reports
// granted scopes that omit a required one (Google granular consent with the
// permission checkboxes left unticked). Missing scope info stays permissive.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OAuthConnector, missingRequiredScopes, type ConnectorTokens } from './oauth-base.js';

const REQ = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];

class TestConnector extends OAuthConnector {
  constructor(dir: string) {
    super({
      id: 'scope_test', name: 'ScopeTest',
      authUrl: 'https://auth.invalid/authorize', tokenUrl: 'https://auth.invalid/token',
      clientId: 'cid', clientSecret: 'csecret', scopes: [...REQ, 'openid'], requiredScopes: REQ,
      usePkce: false, callbackPort: 0, callbackPath: '/cb',
    }, dir);
  }
  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    return { access_token: data.access_token, expires_at: Date.now() + 3600_000, scope: data.scope };
  }
}

// Pure helper.
assert.deepEqual(missingRequiredScopes(REQ, 'openid email'), REQ);
assert.deepEqual(missingRequiredScopes(REQ, `openid ${REQ[0]}`), [REQ[1]]);
assert.deepEqual(missingRequiredScopes(REQ, `${REQ[0]},${REQ[1]}`), []);
assert.deepEqual(missingRequiredScopes(REQ, undefined), [], 'unreported scopes cannot be verified');
assert.deepEqual(missingRequiredScopes(undefined, 'openid'), []);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-oauth-scopes-'));
const realFetch = globalThis.fetch;
let grantedScope = '';
globalThis.fetch = (async () => new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, scope: grantedScope }), { status: 200 })) as typeof fetch;

async function flow(c: TestConnector, scope: string) {
  grantedScope = scope;
  const start = c.startFlow();
  const state = new URL(start.authUrl).searchParams.get('state') || '';
  return c.handleCallback('code', state);
}

async function main(): Promise<void> {
  const c = new TestConnector(root);
  const denied = await flow(c, 'openid email');
  assert.equal(denied.success, false, 'missing required scopes must fail the callback');
  assert.match(denied.error || '', /permission/i);
  assert.equal(c.loadTokens(), null, 'no tokens saved on missing scopes');

  const ok = await flow(c, `openid ${REQ.join(' ')}`);
  assert.equal(ok.success, true);
  assert.equal(c.loadTokens()?.access_token, 'tok');
  console.log('oauth-required-scopes regression: PASS');
}

main().finally(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(root, { recursive: true, force: true });
}).catch((e) => { console.error(e); process.exit(1); });
