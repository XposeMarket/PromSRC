// Real router/controller/OAuthConnector lifecycle; loopback-only synthetic OAuth provider.
// Owner proof is injected. This is not physical-phone, packaged-app or real-account proof.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { chromium } = require('playwright');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-oauth-ui-'));
const load = p => require('../dist/' + p);
load('config/config.js').getConfig = () => ({ getConfigDir: () => root });
const { OAuthConnector } = load('integrations/oauth-base.js');
const { ConnectionAttemptStore } = load('connections/attempt-store.js');
const { ConnectionStore } = load('connections/connection-store.js');
const { ConnectionActivityStore } = load('connections/activity-store.js');
const { ConnectionAdapterRegistry } = load('connections/adapter-registry.js');
const { ConnectionOrchestrator } = load('connections/orchestrator.js');
const { ConnectionStartService } = load('connections/start-service.js');
const { PluginConnectionPlanResolver } = load('connections/plugin-plan-resolver.js');
const { ConnectorOAuthConnectionAdapter } = load('connections/adapters/connector-oauth.js');
const owner = load('gateway/routes/secure-access.router.js');
const consent = load('security/secure-access-consent.js');
const OWNER = 'd'.repeat(64), TOKEN = 'synthetic-oauth-token-never-real';
consent.setConsentKeySourceForTests(() => OWNER);
const proof = { ownerToken: () => OWNER, deviceTrusted: () => true, verifyDevice: () => false,
  verifyConsent: req => consent.verifyConsent(req.headers[consent.OWNER_CONSENT_HEADER], req.method, req.originalUrl, req.rawBody).ok };
const requireOwner = owner.requireProtectedOwner;
owner.requireProtectedOwner = (req, res, next) => requireOwner(req, res, next, proof, () => true);
let url, runtime, connector, result = null, attemptOwner, mode = 'success', tokenReads = 0, safeReads = 0;
let holdToken, releaseToken;
const pending = new Map();
class FixtureConnector extends OAuthConnector {
  callbackUrl() { return url + '/callback'; }
  async buildTokens(data) { return { access_token: data.access_token, expires_at: Date.now() + 3600000, scope: data.scope, account_id: 'fixture-account' }; }
}
const bridge = {
  id: 'gmail', name: 'Fixture OAuth',
  start: (expected, scopes, id) => { attemptOwner = id; result = null; return connector.startFlow(expected, ['read']); },
  poll: async id => { assert.equal(id, attemptOwner); return result; },
  metadata: () => connector.getOAuthMetadata(),
  isConnected: () => connector.isConnected(),
  verify: async () => { const r = await fetch(url + '/me', { headers: { Authorization: 'Bearer ' + connector.loadTokens()?.access_token } }); if (!r.ok) throw new Error('Safe read failed (' + r.status + ')'); return { account: await r.json() }; },
  cancel: id => { assert.equal(id, attemptOwner); connector.cancelFlow(); },
  clear: () => connector.clearTokens(), credentialReference: () => connector.credentialReference(),
};
const adapters = new ConnectionAdapterRegistry();
adapters.register(new ConnectorOAuthConnectionAdapter({ gmail: bridge }));
function restore() {
  const orchestrator = new ConnectionOrchestrator({ attempts: new ConnectionAttemptStore(root), connections: new ConnectionStore(root), activity: new ConnectionActivityStore(root), adapters, plans: new PluginConnectionPlanResolver(() => []) });
  runtime = { orchestrator, adapters, start: new ConnectionStartService(orchestrator) };
}
restore(); load('connections/runtime.js').getConnectionRuntime = () => runtime;
const app = express();
app.use(express.json({ verify: (req, res, b) => { req.rawBody = Buffer.from(b); } }));
app.use(express.urlencoded({ extended: false }));
app.get('/api/secure-access/status', (req, res) => res.json({ owner: owner.ownerSurfaceState(req, proof) }));
app.use('/api', (req, res, next) => { const json = res.json.bind(res); res.json = value => { assert(!JSON.stringify(value).includes(TOKEN), 'token echoed to UI'); return json(value); }; next(); });
app.use(load('gateway/routes/connections-v2.router.js').router);
app.get('/authorize', (req, res) => {
  assert.equal(req.query.code_challenge_method, 'S256');
  const code = crypto.randomUUID(); pending.set(code, { challenge: req.query.code_challenge });
  const callback = new URL(req.query.redirect_uri); assert.equal(callback.origin, url);
  callback.searchParams.set('state', req.query.state);
  callback.searchParams.set(mode === 'denied' ? 'error' : 'code', mode === 'denied' ? 'access_denied' : code);
  res.type('html').send(`<h1>Synthetic provider consent</h1><a id="approve" href="${callback.href}">Authorize fixture</a>`);
});
app.post('/token', async (req, res) => {
  tokenReads++;
  const code = pending.get(req.body.code); assert(code, 'unknown authorization code'); pending.delete(req.body.code);
  assert.equal(crypto.createHash('sha256').update(req.body.code_verifier).digest('base64url'), code.challenge, 'PKCE mismatch');
  assert.equal(req.body.redirect_uri, url + '/callback');
  if (mode === 'rate-limit') return res.status(429).json({ error: 'synthetic_rate_limit' });
  if (mode === 'late-cancel') { holdToken(); await new Promise(r => { releaseToken = r; }); }
  res.json({ access_token: TOKEN, scope: mode === 'scope-denied' ? 'other' : 'read', token_type: 'Bearer' });
});
app.get('/callback', async (req, res) => {
  try { result = req.query.error ? { success: false, error: String(req.query.error) } : await connector.handleCallback(String(req.query.code), String(req.query.state)); res.type('text').send(result.success ? 'Authorized fixture' : result.error); }
  catch (e) { res.status(500).send(e.message); }
});
app.get('/me', (req, res) => { safeReads++; assert.equal(req.headers.authorization, 'Bearer ' + TOKEN); if (mode === 'read-denied') return res.sendStatus(403); res.json({ provider: 'gmail', providerAccountId: 'fixture-account' }); });
app.use('/src', express.static(path.resolve(__dirname, '../web-ui/src')));
app.get('/', (req, res) => res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;background:#151719;color:#eee;--panel:#242729;--text:#eee}button{padding:10px;margin:5px}</style><h1>Isolated OAuth lifecycle test</h1><button id="connect">Connect fixture</button><script type="module">import{openConnectFlow}from'/src/features/connectors/connect-flow.js';window.calls=[];window.prometheusOwnerConsent={request:args=>window.fixtureConsent(args)};window.openPrometheusExternalLink=url=>window.authUrl=url;async function api(p,o={}){window.calls.push(p);const r=await fetch(p,{...o,headers:{'Content-Type':'application/json',...o.headers}});const v=await r.json();if(!r.ok)throw Error(v.error||r.status);return v}document.querySelector('#connect').onclick=()=>openConnectFlow(api,{serviceId:'gmail',kind:'connector',attemptId:new URLSearchParams(location.search).get('attemptId')||undefined});</script>`));
(async () => {
  let browser, server;
  try {
    server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); url = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true });
    for (const [label, width, height] of [['desktop', 1440, 960], ['mobile', 390, 844]]) {
      for (mode of ['success', 'denied', 'rate-limit', 'scope-denied', 'read-denied', 'late-cancel']) {
        connector?.cancelFlow(); connector?.clearTokens();
        for (const name of ['connection-attempts.json', 'connections.json']) fs.rmSync(path.join(root, name), { force: true });
        restore(); result = null;
        connector = new FixtureConnector({ id: 'gmail', name: 'Fixture OAuth', clientId: 'synthetic-client', authUrl: 'https://fixture.invalid/authorize', tokenUrl: url + '/token', scopes: ['read'], requiredScopes: ['read'], usePkce: true, callbackPort: server.address().port, callbackPath: '/callback' }, root);
        const context = await browser.newContext({ viewport: { width, height } });
        await context.addCookies([{ name: 'prom_sa_owner', value: OWNER, url }]);
        const page = await context.newPage(), errors = []; page.setDefaultTimeout(7000); console.log('RUN OAuth UI', label, mode);
        page.on('pageerror', e => errors.push(e.message));
        await page.exposeFunction('fixtureConsent', args => ({ approved: true, header: consent.mintConsent(OWNER, args.method, args.path, consent.sha256Hex(args.body)) }));
        await page.goto(url); await page.click('#connect'); await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
        await page.getByRole('button', { name: 'Check authorization', exact: true }).waitFor();
        const attempt = runtime.orchestrator.listAttempts(1)[0];
        let authUrl;
        if (label === 'desktop') { await page.getByRole('button', { name: 'Sign in with Fixture OAuth', exact: true }).click(); authUrl = await page.evaluate(() => window.authUrl); }
        else { await page.getByText('Finish on your computer.', { exact: false }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Sign in with Fixture OAuth', exact: true }).count(), 0); authUrl = attempt.requiredUserAction?.authorizationUrl; }
        // Phone consent uses a separate browser page on this PC, not a fictitious phone-local callback.
        if (!authUrl) authUrl = runtime.orchestrator.getAttempt(attempt.id).requiredUserAction?.authorizationUrl;
        assert(authUrl, 'OAuth authorization URL missing');
        const authorization = new URL(authUrl); assert.equal(authorization.origin, 'https://fixture.invalid');
        const before = tokenReads;
        const wrong = await connector.handleCallback('never-issued', 'wrong-state'); assert.equal(wrong.success, false); assert.equal(tokenReads, before);
        const provider = await context.newPage(); await provider.goto(url + authorization.pathname + authorization.search);
        if (mode === 'late-cancel') {
          const requested = new Promise(r => { holdToken = r; });
          const click = provider.click('#approve'); await requested;
          await page.getByRole('button', { name: 'Cancel connection', exact: true }).click(); releaseToken(); await click;
          await page.getByText('cancelled', { exact: true }).waitFor(); assert.equal(connector.loadTokens(), null); assert.equal(runtime.orchestrator.getAttempt(attempt.id).state, 'cancelled');
        } else {
          await provider.click('#approve'); await provider.waitForURL(url + '/callback**');
          await page.getByRole('button', { name: 'Check authorization', exact: true }).click();
          if (mode === 'success' || mode === 'read-denied') {
            await page.getByRole('button', { name: 'Verify connection', exact: true }).click();
            await page.getByText(mode === 'success' ? 'connected' : 'degraded', { exact: true }).waitFor();
            if (mode === 'success') {
              const replay = await connector.handleCallback('replay', authorization.searchParams.get('state')); assert.equal(replay.success, false);
              restore(); await page.goto(url + '?attemptId=' + attempt.id); await page.click('#connect'); await page.getByText('connected', { exact: true }).waitFor();
              const out = process.env.PLUGIN_PROOF_DIR; if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, label + '-oauth-e2e.png') }); }
            }
          } else { await page.getByText('failed', { exact: true }).waitFor(); const failed = runtime.orchestrator.getAttempt(attempt.id); assert.equal(failed.error.code, 'OAUTH_FAILED'); assert.match(failed.error.message, mode === 'denied' ? /access_denied/ : mode === 'rate-limit' ? /429/ : /permissions/); assert.equal(connector.loadTokens(), null); }
        }
        assert.equal(errors.length, 0, errors.join('\n')); assert(!(await page.content()).includes(TOKEN)); assert(!(await page.evaluate(() => JSON.stringify(window.calls))).includes('chat'));
        await context.close(); console.log('PASS OAuth UI', label, mode);
      }
    }
    assert(safeReads >= 4); console.log('PASS real OAuth PKCE/state/token exchange/vault/safe-read/controller/reload; owner and provider fixtures, phone viewport only.');
  } finally { connector?.cancelFlow(); if (browser) await browser.close(); if (server) await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
