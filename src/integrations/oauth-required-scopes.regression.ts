// OAuth callback must refuse to save a connection when the provider reports
// granted scopes that omit a required scope of the selected flow. Flows that
// request only a least-privilege plan (e.g. Gmail read-only) must not be
// rejected for capability scopes they never asked for. Missing scope info stays permissive.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OAuthConnector, missingRequiredScopes, type ConnectorTokens } from './oauth-base.js';

const RO = 'https://www.googleapis.com/auth/gmail.readonly';
const SEND = 'https://www.googleapis.com/auth/gmail.send';
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const ID = ['https://www.googleapis.com/auth/userinfo.email', 'openid'];
const REQ = [RO, SEND, MODIFY];
const FULL = [...REQ, ...ID];
const READ_ONLY_PLAN = [RO, ...ID];
const SEND_PLAN = [RO, SEND, ...ID];

class TestConnector extends OAuthConnector {
  constructor(dir: string, withRequired = true) {
    super({
      id: 'scope_test', name: 'ScopeTest',
      authUrl: 'https://auth.invalid/authorize', tokenUrl: 'https://auth.invalid/token',
      clientId: 'cid', clientSecret: 'csecret', scopes: FULL,
      requiredScopes: withRequired ? REQ : undefined,
      usePkce: false, callbackPort: 0, callbackPath: '/cb',
    }, dir);
  }
  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    return { access_token: data.access_token, expires_at: Date.now() + 3600_000, scope: data.scope };
  }
}

// Pure helper.
assert.deepEqual(missingRequiredScopes(REQ, 'openid email'), REQ);
assert.deepEqual(missingRequiredScopes(REQ, `openid ${RO}`), [SEND, MODIFY]);
assert.deepEqual(missingRequiredScopes(REQ, `${RO},${SEND},${MODIFY}`), []);
assert.deepEqual(missingRequiredScopes(REQ, undefined), [], 'unreported scopes cannot be verified');
assert.deepEqual(missingRequiredScopes(undefined, 'openid'), []);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-oauth-scopes-'));
const realFetch = globalThis.fetch;
let grantedScope = '';
let tokenSeq = 0;
globalThis.fetch = (async () => new Response(JSON.stringify({
  access_token: `tok-${++tokenSeq}`, expires_in: 3600, scope: grantedScope,
}), { status: 200 })) as typeof fetch;

function scenarioDir(name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function flow(c: TestConnector, scope: string, requested?: string[]) {
  grantedScope = scope;
  const start = c.startFlow(undefined, requested);
  const state = new URL(start.authUrl).searchParams.get('state') || '';
  return c.handleCallback('code', state);
}

async function main(): Promise<void> {
  // 1. Successful read-only: plan requests only read + identity; grant matches it.
  {
    const c = new TestConnector(scenarioDir('readonly-ok'));
    const ok = await flow(c, `${RO} ${ID.join(' ')}`, READ_ONLY_PLAN);
    assert.equal(ok.success, true, `read-only grant must succeed: ${ok.error}`);
    assert.equal(c.loadTokens()?.access_token?.startsWith('tok-'), true);
    assert.doesNotMatch(c.loadTokens()?.scope || '', /gmail\.send|gmail\.modify/, 'read-only plan must not be expanded');
  }

  // 2. Denied requested: read-only plan granted without gmail.readonly -> rejected, only the requested scope is named.
  {
    const c = new TestConnector(scenarioDir('readonly-denied'));
    const denied = await flow(c, `openid ${ID[0]}`, READ_ONLY_PLAN);
    assert.equal(denied.success, false, 'missing requested read-only scope must fail');
    assert.match(denied.error || '', /permission/i);
    assert.match(denied.error || '', /gmail\.readonly/);
    assert.doesNotMatch(denied.error || '', /gmail\.send|gmail\.modify/, 'must not demand unrequested write scopes');
    assert.equal(c.loadTokens(), null, 'no tokens saved on denied grant');
  }

  // 3. Selected write: send selected and granted -> ok; send selected but omitted -> rejected naming send.
  {
    const c = new TestConnector(scenarioDir('selected-write'));
    const omitted = await flow(c, `${RO} ${ID.join(' ')}`, SEND_PLAN);
    assert.equal(omitted.success, false);
    assert.match(omitted.error || '', /gmail\.send/);
    assert.doesNotMatch(omitted.error || '', /gmail\.modify/);
    const ok = await flow(c, `${RO} ${SEND} ${ID.join(' ')}`, SEND_PLAN);
    assert.equal(ok.success, true, `selected write grant must succeed: ${ok.error}`);
  }

  // 4. Full flow (default full scope): every connector-required scope must be granted.
  {
    const c = new TestConnector(scenarioDir('full-flow'));
    const partial = await flow(c, `${RO} ${ID.join(' ')}`, undefined);
    assert.equal(partial.success, false, 'default full flow must verify all required scopes');
    assert.match(partial.error || '', /gmail\.send/);
    assert.match(partial.error || '', /gmail\.modify/);
    const ok = await flow(c, FULL.join(' '), undefined);
    assert.equal(ok.success, true, `full grant must succeed: ${ok.error}`);
  }

  // 5. No config / omitted scopes compat: no requiredScopes -> never blocks; unreported scopes stay permissive.
  {
    const c = new TestConnector(scenarioDir('no-config'), false);
    const ok = await flow(c, 'openid', READ_ONLY_PLAN);
    assert.equal(ok.success, true, 'connector without requiredScopes must not block');
    const c2 = new TestConnector(scenarioDir('omitted-scope'));
    const omitted = await flow(c2, '', READ_ONLY_PLAN);
    assert.equal(omitted.success, true, 'missing scope report stays permissive');
  }

  // 6. Reconnect preserves prior: a denied reconnect must not overwrite a saved connection.
  {
    const c = new TestConnector(scenarioDir('reconnect'));
    const first = await flow(c, `${RO} ${ID.join(' ')}`, READ_ONLY_PLAN);
    assert.equal(first.success, true, `initial read-only connect must succeed: ${first.error}`);
    const prior = c.loadTokens()?.access_token;
    assert.ok(prior, 'prior tokens saved');
    const denied = await flow(c, `openid ${ID[0]}`, READ_ONLY_PLAN);
    assert.equal(denied.success, false);
    assert.equal(c.loadTokens()?.access_token, prior, 'denied reconnect must preserve prior tokens');
  }

  console.log('oauth-required-scopes regression: PASS');
}

main().finally(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(root, { recursive: true, force: true });
}).catch((e) => { console.error(e); process.exit(1); });
