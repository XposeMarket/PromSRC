import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const policy = await import(pathToFileURL(path.join(root, 'web-ui', 'src', 'link-routing-policy.mjs')).href);

const baseUrl = 'http://127.0.0.1:18789/?desktop=1';
const common = { baseUrl, currentOrigin: 'http://127.0.0.1:18789', gatewayOrigin: 'http://127.0.0.1:18789' };

assert.equal(policy.normalizePrometheusLink('https://example.com/docs', common).kind, 'external');
assert.equal(policy.normalizePrometheusLink('http://example.com/docs', common).kind, 'external');
assert.equal(policy.normalizePrometheusLink('/settings?tab=browser', common).kind, 'internal');
assert.equal(policy.normalizePrometheusLink('http://localhost:18789/?desktop=1', common).kind, 'internal');
assert.equal(policy.normalizePrometheusLink('http://[::1]:18789/chat', common).kind, 'internal');
assert.equal(policy.normalizePrometheusLink('mailto:hello@example.com', common).kind, 'passthrough');
assert.equal(policy.normalizePrometheusLink('tel:+15551212', common).kind, 'passthrough');

for (const unsafe of ['javascript:alert(1)', 'data:text/html,owned', 'https://user:pass@example.com/']) {
  assert.equal(policy.normalizePrometheusLink(unsafe, common).kind, 'blocked', unsafe);
}
assert.equal(policy.normalizePrometheusLink('file:///C:/secret.txt', common).kind, 'ignored');
assert.equal(policy.normalizePrometheusLink('javascript:void(0)', { ...common, allowExplicitSafeFlow: true }).reason, 'explicit_safe_flow');

assert.equal(policy.classifyPrometheusLink({ ...common, rawUrl: 'https://example.com/file.zip', download: true }).reason, 'download');
assert.equal(policy.classifyPrometheusLink({ ...common, rawUrl: 'https://example.com/docs', explicitExternal: true }).reason, 'explicit_external');

assert.equal(policy.choosePrometheusBrowserLane({ browserTarget: 'user_chrome', inhouseAvailable: false }), 'prometheus');
assert.equal(policy.choosePrometheusBrowserLane({ browserTarget: 'user_chrome', inhouseAvailable: true }), 'prometheus');
assert.equal(policy.choosePrometheusBrowserLane({ browserTarget: 'inhouse', inhouseAvailable: true }), 'inhouse');
assert.equal(policy.choosePrometheusBrowserLane({ electron: true, inhouseAvailable: true, browserTarget: 'user' }), 'inhouse');
assert.equal(policy.choosePrometheusBrowserLane({ electron: true, inhouseAvailable: false }), 'prometheus');

const routerSource = fs.readFileSync(path.join(root, 'web-ui', 'src', 'link-router.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(root, 'web-ui', 'src', 'pages', 'ChatPage.js'), 'utf8');
const gatewaySource = fs.readFileSync(path.join(root, 'src', 'gateway', 'core', 'server.ts'), 'utf8');
const browserSource = fs.readFileSync(path.join(root, 'src', 'gateway', 'browser-tools.ts'), 'utf8');
assert.match(routerSource, /Open externally/);
assert.match(routerSource, /type: 'browser:link_open'/);
assert.match(routerSource, /metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey/);
assert.match(routerSource, /allowExplicitSafeFlow/);
assert.match(routerSource, /event\.key === 'Escape'/);
assert.match(chatSource, /window\.openPrometheusBrowserLink = openPrometheusBrowserLink/);
assert.match(gatewaySource, /msg\?\.type === 'browser:link_open'/);
assert.match(browserSource, /::prometheus-link/);
assert.match(browserSource, /target === 'user'/);
assert.match(browserSource, /browserSessionInitInFlight/);
assert.match(browserSource, /browserLinkNavigationInFlight/);
assert.match(browserSource, /browserOpenUiLink/);

console.log('Prometheus desktop link routing policy tests passed.');
