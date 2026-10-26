import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';

// Execute the real modules with a closed dependency allowlist. No gateway, vault,
// disk mutation, real timers, browser launches or network imports are permitted.
function fixture(file: string) {
  const values = new Map<string, string>();
  const writes: string[] = [], deletes: string[] = [], requests: any[] = [];
  const servers: any[] = [], timers: any[] = [], opened: string[] = [];
  let now = 1_000_000;
  let fetcher = async (url: string, init?: any): Promise<any> => {
    if (url.includes('openid-configuration')) return response({ authorization_endpoint: 'https://auth.x.ai/authorize', token_endpoint: 'https://auth.x.ai/token' });
    if (url.includes('/users/me')) return response({ data: { username: 'fixture', id: '123' } });
    if (init?.body?.includes('token-exchange')) return response({}, 400);
    return response({ access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 3600,
      id_token: `a.${Buffer.from(JSON.stringify({ sub: 'fixture' })).toString('base64url')}.b` });
  };
  const vault = {
    get: (key: string) => values.has(key) ? { expose: () => values.get(key)! } : null,
    set: (key: string, value: string) => { writes.push(key); values.set(key, value); },
    delete: (key: string) => { deletes.push(key); values.delete(key); },
  };
  const fakeHttp = { createServer(handler: any) {
    const server: any = { handler, closed: 0, events: {},
      on(event: string, cb: any) { this.events[event] = cb; return this; },
      listen(...args: any[]) { this.listenArgs = args; args.at(-1)(); return this; },
      close() { this.closed++; return this; },
    };
    servers.push(server); return server;
  } };
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ URL, URLSearchParams, Buffer, Date: Clock, console,
    process: { env: {}, platform: 'win32' }, AbortSignal: { timeout: () => undefined },
    fetch: (url: string, init?: any) => { requests.push({ url, init }); return fetcher(url, init); },
    setTimeout: (cb: any, ms: number) => { const timer = { cb, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: (timer: any) => { if (timer) timer.cleared = true; },
    setInterval: () => { throw new Error('unexpected keepalive'); }, clearInterval() {},
  });
  const cache = new Map<string, any>();
  const load = (name: string): any => {
    if (cache.has(name)) return cache.get(name);
    const exports = {}; cache.set(name, exports);
    const source = process.env.OAUTH_REGRESSION_BASE_REF
      ? execFileSync('git', ['show', `${process.env.OAUTH_REGRESSION_BASE_REF}:src/auth/${name}.ts`], { encoding: 'utf8', cwd: path.join(__dirname, '../..') })
      : fs.readFileSync(path.join(__dirname, name + '.ts'), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const requireMock = (id: string): any => {
      if (id === 'crypto') return crypto;
      if (id === 'path') return path;
      if (id === 'http') return fakeHttp;
      if (id === 'fs') return { existsSync: () => false, readFileSync: () => { throw new Error('unexpected disk read'); } };
      if (id === 'os') return { homedir: () => '/fixture' };
      if (id === 'child_process') return { exec: (cmd: string) => opened.push(cmd) };
      if (id === '../security/vault') return { getVault: () => vault };
      if (id === '../security/log-scrubber') return { log: { security() {}, warn() {} } };
      if (id === '../gateway/runtime/preview-mode') return { assertTokenRefreshAllowed() {} };
      if (id === '../extensions/xai-extension-adapter') return { refreshXAITools() {} };
      if (id === './oauth-callback-lifecycle') return load('oauth-callback-lifecycle');
      throw new Error(`Unexpected dependency: ${id}`);
    };
    vm.runInContext(`(function(require,exports){${js}\n})`, context, { filename: name + '.ts' })(requireMock, exports);
    return exports;
  };
  const api = load(file);
  values.set('x.api.oauth_credentials', JSON.stringify({ client_id: 'fixture-client', redirect_uri: 'http://localhost:8080/callback', scopes: ['tweet.read'], stored_at: now }));
  return { api, values, writes, deletes, requests, servers, timers, opened,
    setFetch(fn: typeof fetcher) { fetcher = fn; }, advance(ms: number) { now += ms; } };
}
function response(data: any, status = 200) { return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) }; }
function deferred() { let resolve!: (v: any) => void; const promise = new Promise<any>(r => resolve = r); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const kinds = ['openai-blocking', 'openai-background', 'xai', 'x-api'] as const;
type Kind = typeof kinds[number];
async function flow(kind: Kind) {
  const file = kind.startsWith('openai') ? 'openai-oauth' : kind + '-oauth';
  const f = fixture(file); let outcome: any;
  const start = async () => {
    outcome = undefined;
    let result: any;
    if (kind === 'openai-blocking') {
      void f.api.startOAuthFlow('/fixture', 'test').then((r: any) => { outcome = r; });
      await flush();
      const command = f.opened.at(-1)!;
      return new URL(command.slice(command.indexOf('https://'), -1));
    }
    if (kind === 'openai-background') result = f.api.startOAuthFlowBackground('/fixture', 'test');
    if (kind === 'xai') result = await f.api.startXAIOAuthFlowBackground('/fixture', 'test');
    if (kind === 'x-api') result = await f.api.startXApiOAuthFlowBackground('/fixture');
    assert.ok(result.authUrl, JSON.stringify(result)); return new URL(result.authUrl);
  };
  const poll = () => kind === 'openai-blocking' ? outcome : kind === 'openai-background' ? f.api.pollOAuthBackground() : kind === 'xai' ? f.api.pollXAIOAuthBackground() : f.api.pollXApiOAuthBackground();
  const auth = await start();
  const callback = async (params: Record<string, string>, server = f.servers.at(-1)) => {
    const res: any = { status: 0, body: '', writeHead(status: number) { this.status = status; }, end(body = '') { this.body = body; } };
    const pathname = new URL(auth.searchParams.get('redirect_uri')!).pathname;
    await server.handler({ url: pathname + '?' + new URLSearchParams(params) }, res); await flush(); return res;
  };
  return { ...f, start, poll, callback, state: auth.searchParams.get('state')!, auth };
}
const cases: [string, () => Promise<void>][] = [];
const test = (name: string, fn: () => Promise<void>) => cases.push([name, fn]);
for (const kind of kinds) {
  for (const state of ['', 'wrong']) test(`${kind}: invalid ${state ? 'mismatched' : 'missing'} state preserves login`, async () => {
    const f = await flow(kind); const before = f.requests.length;
    const res = await f.callback({ error: '<script>attack()</script>', ...(state ? { state } : {}) });
    assert.equal(res.status, 400); assert.ok(!res.body.includes('<script>'));
    assert.equal(f.servers[0].closed, 0); assert.ok(!f.poll()?.done && !f.poll()?.success);
    assert.equal(f.requests.length, before);
    await f.callback({ state: f.state, code: 'good' }); assert.equal(f.poll()?.success, true);
  });
  test(`${kind}: authenticated error escapes HTML and settles`, async () => {
    const f = await flow(kind); const res = await f.callback({ state: f.state, error: '<img src=x onerror=attack()>' });
    assert.ok(res.body.includes('&lt;img')); assert.ok(!res.body.includes('<img'));
    assert.equal(f.poll()?.success, false); assert.ok(f.servers[0].closed); assert.ok(f.timers[0].cleared);
  });
  test(`${kind}: success clears timeout and old events cannot cancel B`, async () => {
    const f = await flow(kind); const old = f.servers[0], timer = f.timers[0];
    await f.callback({ state: f.state, code: 'good' }); assert.equal(f.poll()?.success, true);
    const b = await f.start();
    timer.cb(); old.events.error(new Error('late error')); await flush();
    assert.equal(f.servers[1].closed, 0); assert.ok(!f.poll()?.done && !f.poll()?.success); assert.ok(timer.cleared);
    await f.callback({ state: b.searchParams.get('state')!, code: 'good' }); assert.equal(f.poll()?.success, true);
  });
  test(`${kind}: current server error cleans listener and timer`, async () => {
    const f = await flow(kind); f.servers[0].events.error(new Error('listener failed')); await flush();
    assert.equal(f.poll()?.success, false); assert.ok(f.servers[0].closed); assert.ok(f.timers[0].cleared);
    if (kind === 'openai-blocking') {
      assert.equal(f.poll().needsManualPaste, true);
      const result = await f.api.exchangeManualCodeFromPending('/fixture', `http://localhost/callback?state=${f.state}&code=manual`, 'test');
      assert.equal(result.success, true);
    }
  });
  test(`${kind}: current timeout settles failure`, async () => {
    const f = await flow(kind); f.timers[0].cb(); await flush();
    assert.equal(f.poll()?.success, false); assert.ok(f.servers[0].closed);
  });
  test(`${kind}: late exchange cannot overwrite B`, async () => {
    const f = await flow(kind), pending = deferred(); f.setFetch(async () => pending.promise);
    const callback = f.callback({ state: f.state, code: 'slow' }); await flush();
    f.timers[0].cb(); await flush();
    f.setFetch(async url => url.includes('openid-configuration') ? response({ authorization_endpoint: 'https://auth.x.ai/authorize', token_endpoint: 'https://auth.x.ai/token' }) : response({}));
    await f.start(); const writes = f.writes.length;
    pending.resolve(response({ access_token: 'late', refresh_token: 'late', id_token: 'a.e30.b' })); await callback;
    assert.equal(f.writes.length, writes); assert.equal(f.servers[1].closed, 0); assert.ok(!f.poll()?.done && !f.poll()?.success);
  });
  test(`${kind}: duplicate callback does not exchange twice`, async () => {
    const f = await flow(kind), pending = deferred(); f.setFetch(async () => pending.promise);
    const a = f.callback({ state: f.state, code: 'once' }); await flush(); const count = f.requests.length;
    const b = f.callback({ state: f.state, code: 'twice' }); await flush();
    assert.equal(f.requests.length, count); f.timers[0].cb(); pending.resolve(response({}, 400)); await Promise.all([a, b]);
  });
  test(`${kind}: manual completion cleans listener and timer`, async () => {
    const f = await flow(kind); let result: any;
    if (kind.startsWith('openai')) result = await f.api.exchangeManualCodeFromPending('/fixture', `http://localhost/callback?state=${f.state}&code=manual`, 'test');
    else if (kind === 'xai') result = await f.api.completeXAIOAuthWithCode('/fixture', 'manual', 'test');
    else result = await f.api.completeXApiOAuthWithCode('/fixture', 'manual');
    assert.equal(result.success, true); assert.ok(f.servers[0].closed); assert.ok(f.timers[0].cleared);
  });
}
for (const kind of ['openai-blocking', 'openai-background'] as const) test(`${kind}: malformed manual input preserves pending login`, async () => {
  const f = await flow(kind); const before = f.requests.length;
  const result = await f.api.exchangeManualCodeFromPending('/fixture', 'not-a-url', 'test');
  assert.equal(result.success, false); assert.equal(f.requests.length, before); assert.equal(f.servers[0].closed, 0);
  assert.ok(!f.timers[0].cleared); assert.ok(!f.poll()?.done && !f.poll()?.success);
  await f.callback({ state: f.state, code: 'good' }); assert.equal(f.poll().success, true);
});
test('X API default localhost binds explicit loopback', async () => {
  const f = await flow('x-api'); assert.equal(f.servers[0].listenArgs[1], '127.0.0.1');
  assert.equal(new URL(f.auth.searchParams.get('redirect_uri')!).hostname, 'localhost');
});
function refreshFixture() {
  const f = fixture('xai-oauth'); const key = 'xai.oauth_tokens.test';
  const tokens = { access_token: 'old-access', refresh_token: 'old-refresh', expires_at: 1, token_endpoint: 'https://auth.x.ai/token' };
  f.values.set(key, JSON.stringify(tokens)); return { ...f, key, tokens };
}
test('xAI same-account refresh singleflight and atomic rotation', async () => {
  const f = refreshFixture(), d = deferred(); f.setFetch(async () => d.promise);
  const a = f.api.refreshXAITokens('/fixture', 'test'), b = f.api.refreshXAITokens('/fixture/.', 'test'); await flush();
  assert.equal(f.requests.length, 1); d.resolve(response({ access_token: 'rotated', refresh_token: 'rotated' }));
  const results = await Promise.all([a, b]); assert.equal(results[0].refresh_token, 'rotated'); assert.equal(results[1].refresh_token, 'rotated');
  assert.equal(f.writes.length, 1); assert.equal(f.deletes.length, 0);
});
test('xAI shared rejection clears once and releases singleflight for retry', async () => {
  const f = refreshFixture(), d = deferred(); f.setFetch(async () => d.promise);
  const a = f.api.refreshXAITokens('/fixture', 'test').catch(() => null), b = f.api.refreshXAITokens('/fixture', 'test').catch(() => null);
  await flush(); assert.equal(f.requests.length, 1); d.resolve(response({ error: 'invalid_grant' }, 400)); await Promise.all([a, b]);
  assert.equal(f.deletes.length, 1); f.values.set(f.key, JSON.stringify(f.tokens));
  f.setFetch(async () => response({ access_token: 'retry', refresh_token: 'retry' }));
  assert.equal((await f.api.refreshXAITokens('/fixture', 'test')).access_token, 'retry'); assert.equal(f.requests.length, 2);
});
test('xAI accounts refresh independently', async () => {
  const f = refreshFixture(); f.values.set('xai.oauth_tokens.other', JSON.stringify(f.tokens));
  await Promise.all([f.api.refreshXAITokens('/fixture', 'test'), f.api.refreshXAITokens('/fixture', 'other')]); assert.equal(f.requests.length, 2);
});
for (const status of ['stale-rejection', 'stale-success', 'disconnected-success', 'current-rejection', 'transient-rejection']) test(`xAI ${status}`, async () => {
  const f = refreshFixture(), d = deferred(); f.setFetch(async () => d.promise);
  const pending = f.api.refreshXAITokens('/fixture', 'test'); const settled = pending.catch(() => null); await flush();
  if (status.startsWith('stale')) f.values.set(f.key, JSON.stringify({ ...f.tokens, refresh_token: 'replacement' }));
  if (status === 'disconnected-success') f.values.delete(f.key);
  d.resolve(status.endsWith('success') ? response({ access_token: 'late', refresh_token: 'late' }) : response({ error: status === 'transient-rejection' ? 'server_error' : 'invalid_grant' }, 400));
  await settled;
  if (status.startsWith('stale')) assert.equal(JSON.parse(f.values.get(f.key)!).refresh_token, 'replacement');
  if (status === 'disconnected-success' || status === 'current-rejection') assert.equal(f.values.has(f.key), false);
  if (status === 'transient-rejection') assert.equal(JSON.parse(f.values.get(f.key)!).refresh_token, 'old-refresh');
});
(async () => {
  let failed = 0;
  for (const [name, run] of cases) { try { await run(); console.log(`PASS ${name}`); } catch (e: any) { failed++; console.error(`FAIL ${name}: ${e.message}`); } }
  console.log(`RESULT ${cases.length - failed}/${cases.length} passed; ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(err => { console.error(err); process.exitCode = 1; });
