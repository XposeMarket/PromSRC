import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const index = read('web-ui/index.html');
const app = read('web-ui/src/app.js');
const connections = read('web-ui/src/pages/ConnectionsPage.js');
const pagesCss = read('web-ui/src/styles/pages.css');
const desktopDocs = read('workspace/self/17-desktop-web-ui.md');
const connectorDocs = read('workspace/self/feature-index/18-settings-plugins-connectors.md');

assert.match(index, /id="nav-plugins"[\s\S]*?setMode\('plugins'\)/, 'More must expose Plugins navigation');
assert.match(index, /id="plugins-view"/, 'Plugins page view must exist');
assert.match(index, /id="plugins-search"/, 'Plugins page must expose a search input');
assert.match(index, /id="plugins-grid"/, 'Plugins page must expose a catalog grid');
assert.match(index, /id="plugins-mcp-section"/, 'Configured MCP must have a separate page section');
assert.doesNotMatch(index, /id="connections-section"/, 'The retired right-panel connector section must be removed');
assert.doesNotMatch(index, /id="connections-grid"/, 'The retired right-panel connector grid must be removed');
assert.doesNotMatch(index, /__connectionsBootstrapped/, 'Chat boot must not fetch the plugin catalog');

assert.match(app, /'plugins'/, 'plugins must be a valid desktop mode');
assert.match(app, /plugins:\s*\['Plugins',/, 'plugins must have page title metadata');
assert.match(app, /plugins:\s*'\.\/pages\/ConnectionsPage\.js'/, 'plugins must lazy-load ConnectionsPage');
assert.match(app, /plugins:\s*'plugins-view'/, 'plugins mode must show the Plugins view');
assert.match(app, /window\.pluginsPageActivate\(\)/, 'Plugins mode must activate its page loader');
assert.match(app, /closeConnectorView\(\)/, 'mode changes must close the shared detail surface');

assert.match(connections, /EXTENSIONS_CATALOG\}\?kind=connector/, 'catalog adapter must use connector kind only');
assert.match(connections, /new Intl\.Collator\('en-US'/, 'catalog sort must use an explicit deterministic collator');
assert.match(connections, /\.sort\(\(a, b\) => connectorNameCollator\.compare\(a\.name, b\.name\)/, 'visible catalog must sort by user-facing name');
assert.match(connections, /const connectorLetterGroups = Object\.freeze/, 'catalog must define fixed three-letter ranges');
for (const range of ['A–C', 'D–F', 'G–I', 'J–L', 'M–O', 'P–R', 'S–U', 'V–X', 'Y–Z']) {
  assert.match(connections, new RegExp(range), `catalog must define the ${range} range`);
}
assert.match(connections, /plugin-letter-group/, 'catalog must render grouped letter sections');
assert.match(connections, /connectorSearchText/, 'search must use a page-owned metadata adapter');
for (const term of ['description', 'category', 'trustLevel', 'ownership.tools', 'connection.requestedCapabilities']) {
  assert.match(connections, new RegExp(term.replace('.', '\\.'), 's'), `search adapter must include ${term}`);
}
for (const route of [
  '/api/connection-attempts?limit=200',
  '/api/connection-secure-input/',
  "'repair'",
  "'verify'",
  'CONNECTIONS_DISCONNECT',
  'startOAuthFlow',
  'renderCredentialForm',
  'startBrowserLogin',
  'openMcpServerView',
]) {
  assert.match(connections, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `connection flow must preserve ${route}`);
}
assert.match(connections, /function startCanonicalConnection\(id\)/, 'managed connector flow must start through the host-owned attempt API');
assert.match(connections, /function disconnectCanonicalConnection\(connectionId, id\)/, 'managed disconnect must use the canonical connection route');
assert.match(connections, /function renderManagedOAuthActions\(connector, isConnected\)/, 'native OAuth cards must share one managed renderer');
assert.match(connections, /if \(hasCanonicalOAuthStrategy\(connector\)\) \{\s*renderManagedOAuthActions\(connector, isConnected\);\s*return;/, 'native OAuth cards must route through the managed renderer');
const mcpRenderer = connections.slice(connections.indexOf('function renderMcpServers()'), connections.indexOf('// Full detail view for an MCP server'));
assert.doesNotMatch(mcpRenderer, /renderManagedOAuthActions|hasCanonicalOAuthStrategy\(connector\)/, 'MCP list rendering must not reference connector-card state');
assert.match(connections, /expectedAccountId/, 'managed connector flow must carry account continuity metadata');
assert.match(connections, /capabilityGrants/, 'connector detail must display canonical capability grants');
assert.match(connections, /availableTools/, 'connector detail must expose the canonical model-facing tool allowlist');
assert.match(connections, /saveConnectorToolAvailability/, 'connector detail must persist tool access through the canonical route');
assert.match(connections, /saveMcpToolAvailability/, 'MCP detail must persist tool access through the canonical route');
assert.match(connections, /api\/connections-v2\//, 'connector detail must use the v2 connection tool contract');
for (const statusLabel of ['Needs verification', 'Admin approval required', 'Degraded', 'Reauthorize', 'Disconnected']) {
  assert.match(connections, new RegExp(statusLabel.replace(/\s+/g, '\\s+')), `Plugins must expose the ${statusLabel} state`);
}
assert.match(connections, /function pluginsPageActivate\(\)/, 'Plugins page must load data on activation');
assert.match(connections, /No plugins match/, 'search must render a no-match state');
assert.doesNotMatch(connections, /kind=provider/, 'connector catalog must not fetch model providers');
assert.match(connections, /--connector-logo-url/, 'bundled brand marks must use the real local SVG as the logo source');

for (const slug of [
  'github', 'gmail', 'googledrive', 'notion', 'slack', 'hubspot', 'googleanalytics',
  'salesforce', 'x', 'reddit', 'instagram', 'linkedin', 'obsidian', 'stripe',
  'tiktok', 'vercel',
]) {
  const logo = path.join(root, 'web-ui/src/assets/connectors', `${slug}.svg`);
  assert.ok(fs.existsSync(logo), `bundled brand mark must exist for ${slug}`);
  assert.match(fs.readFileSync(logo, 'utf8'), /<path\b/, `bundled brand mark for ${slug} must be SVG artwork`);
}

for (const selector of ['.plugins-page-shell', '.plugins-search-input', '.plugins-grid', '.plugin-card', '.cv-connection-state']) {
  assert.match(pagesCss, new RegExp(selector.replace('.', '\\.'), 's'), `Plugins CSS must define ${selector}`);
}
assert.match(pagesCss, /\.plugins-grid\s*\{[\s\S]*?display:\s*flex/, 'Plugins catalog must be vertically stacked');
assert.match(pagesCss, /\.plugin-letter-heading\s*\{[\s\S]*?border-bottom:/, 'letter groups must be separated by dividers');
assert.match(pagesCss, /mask-image:\s*var\(--connector-logo-url\)/, 'logo artwork must be colorized from the local SVG path');

assert.match(desktopDocs, /More → Plugins/, 'desktop self-docs must describe Plugins navigation');
assert.match(desktopDocs, /ConnectionsPage\.js.*lazy-loaded/, 'desktop self-docs must describe lazy ownership');
assert.match(connectorDocs, /connector-only/, 'connector self-docs must record provider exclusion');
assert.match(connectorDocs, /no-search-match/, 'connector self-docs must record catalog states');
assert.match(connectorDocs, /OAuth connector audit/, 'connector self-docs must record the OAuth audit');
assert.match(connectorDocs, /Vercel and Stripe are not OAuth/, 'connector self-docs must classify API-key connectors correctly');
assert.match(desktopDocs, /availableTools/, 'desktop self-docs must describe the canonical tool allowlist');

console.log('[test-plugins-page-contract] Plugins navigation, grouped catalog, brand marks, lifecycle hooks, and docs contract passed');
