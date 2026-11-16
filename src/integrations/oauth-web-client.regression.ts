// Regression: optional Google "web" OAuth client routes sign-in through the public gateway callback.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GmailConnector } from './connectors/gmail.js';
import { GoogleAnalyticsConnector } from './connectors/google-analytics.js';
import { setGatewayPublicOriginOverride } from './gateway-oauth-callback.js';

delete process.env.GMAIL_CLIENT_ID; delete process.env.GMAIL_CLIENT_SECRET;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-webclient-'));
const gmail = new GmailConnector(dir);

// No clients at all -> not configured.
setGatewayPublicOriginOverride('https://example.ts.net');
assert.ok(gmail.startFlow().error, 'no client -> error');
assert.equal(gmail.webSignInAvailable(), false);

gmail.saveWebClientCredentials('web-id.apps.googleusercontent.com', 'web-secret');
assert.equal(gmail.webSignInAvailable(), true);
const web = gmail.startFlow();
assert.equal(web.error, undefined);
assert.equal(web.web, true);
const u = new URL(web.authUrl);
assert.equal(u.searchParams.get('client_id'), 'web-id.apps.googleusercontent.com');
assert.equal(u.searchParams.get('redirect_uri'), 'https://example.ts.net/oauth/connector/callback/gmail');
assert.ok(!web.authUrl.includes('web-secret'), 'secret never in URL');
gmail.cancelFlow();

// GA4 reuses Gmail's web client with its own callback path.
const ga = new GoogleAnalyticsConnector(dir);
const gaStart = ga.startFlow();
assert.equal(gaStart.web, true);
assert.equal(new URL(gaStart.authUrl).searchParams.get('redirect_uri'), 'https://example.ts.net/oauth/connector/callback/ga4');
ga.cancelFlow();

// No public origin -> web client unusable, falls back to primary (desktop/loopback) client.
setGatewayPublicOriginOverride(null);
assert.equal(gmail.webSignInAvailable(), false);
gmail.saveCredentials('desktop-id', 'desktop-secret');
const desk = gmail.startFlow();
assert.equal(desk.web, undefined);
assert.equal(new URL(desk.authUrl).searchParams.get('client_id'), 'desktop-id');
assert.match(new URL(desk.authUrl).searchParams.get('redirect_uri') || '', /^http:\/\/localhost:19420\//);
gmail.cancelFlow();

// With an origin, web wins even when a desktop client exists (phone-finishable).
setGatewayPublicOriginOverride('https://example.ts.net');
assert.equal(gmail.startFlow().web, true);
gmail.cancelFlow();
gmail.clearWebClientCredentials();
assert.equal(gmail.startFlow().web, undefined);
gmail.cancelFlow();
setGatewayPublicOriginOverride(undefined);
console.log('PASS oauth-web-client: web client + gateway callback, GA4 fallback, desktop fallback, clear');
