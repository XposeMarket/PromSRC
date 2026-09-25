// Mobile Plugins page: row building is alphabetical, merges connectors, MCP
// servers and imported plugins, and never double-lists an imported plugin's
// MCP server. Also checks the drawer/route wiring stays mobile-only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// Load buildPluginRows without the browser-only imports.
const src = read('web-ui/src/mobile/mobile-plugins-page.js');
const start = src.indexOf('const collator');
const end = src.indexOf('function logoMarkup');
assert.ok(start > 0 && end > start, 'buildPluginRows block must exist');
const body = src.slice(start, end).replace(/export function /g, 'function ');
const { buildPluginRows, groupPluginRows, letterBucket } = new Function(`${body}; return { buildPluginRows, groupPluginRows, letterBucket };`)();

const rows = buildPluginRows({
  connectors: [
    { id: 'vercel', name: 'Vercel', description: 'Deploy', state: { connected: true } },
    { id: 'gmail', name: 'Gmail', description: 'Mail', state: { connected: true, account: { email: 'a@b.c' } } },
    { id: 'notion', name: 'notion', description: 'Docs', state: { connected: false } },
    { id: 'hubspot', name: 'HubSpot', state: { connected: false, hasCredentials: true } },
  ],
  mcpServers: [
    { id: 'github', name: 'github: github', status: 'disconnected' },
    { id: 'godot-mcp-runtime', name: 'Godot MCP Runtime', status: 'connected', toolCount: 36 },
  ],
  imported: [
    { id: 'github', name: 'GitHub', format: 'codex', skills: ['a', 'b'], mcpServers: [{ id: 'github', enabled: false }], requiredEnv: ['GITHUB_PAT_TOKEN'] },
  ],
});

assert.deepEqual(rows.map((r) => r.name), ['GitHub', 'Gmail', 'Godot MCP Runtime', 'HubSpot', 'notion', 'Vercel'],
  'rows are case-insensitive alphabetical and the imported plugin MCP server is not listed twice');
const gh = rows.find((r) => r.key === 'imported:github');
assert.equal(gh.needsAttention, true, 'imported plugin with a disabled MCP that needs a token needs attention');
assert.match(gh.desc, /Imported from Codex · 2 skills · MCP needs a token/);
assert.equal(rows.find((r) => r.id === 'hubspot').needsAttention, true, 'credentials without a connection need attention');
assert.equal(rows.find((r) => r.id === 'gmail').account, 'a@b.c');
assert.equal(rows.find((r) => r.id === 'godot-mcp-runtime').connected, true);

// Installed rows are split out; the rest are bucketed A–C, D–F, …
assert.equal(letterBucket('Asana'), 'A–C');
assert.equal(letterBucket('figma'), 'D–F');
assert.equal(letterBucket('Zapier'), 'Y–Z');
assert.equal(letterBucket('1Password'), '#');
const grouped = groupPluginRows(rows);
assert.deepEqual(grouped.installed.map((r) => r.name), ['GitHub', 'Gmail', 'Godot MCP Runtime', 'Vercel']);
assert.deepEqual(grouped.groups.map((g) => [g.label, g.rows.map((r) => r.name)]), [['G–I', ['HubSpot']], ['M–O', ['notion']]]);

// Hosted one-tap MCP entries: listed once, DCR-less ones dropped, name clash suffixed.
const withHosted = buildPluginRows({
  connectors: [{ id: 'vercel', name: 'Vercel', state: { connected: true } }],
  mcpServers: [{ id: 'hosted-linear', name: 'Linear', status: 'connected', toolCount: 20 }],
  hosted: [
    { id: 'linear', name: 'Linear', description: 'Issues', dcr: true, installed: true, connected: true },
    { id: 'vercel', name: 'Vercel', dcr: true },
    { id: 'slack', name: 'Slack', dcr: false },
  ],
});
assert.deepEqual(withHosted.map((r) => r.name), ['Linear', 'Vercel', 'Vercel MCP']);
assert.equal(withHosted.find((r) => r.name === 'Vercel MCP').oneTap, true);
assert.equal(withHosted.find((r) => r.name === 'Linear').connected, true);

const drawer = read('web-ui/src/mobile/mobile-data-base.js');
assert.match(drawer, /id: 'more',\s+label: 'Plugins'/, 'mobile drawer More entry is labelled Plugins');
const hub = read('web-ui/src/mobile/mobile-hub-pages.js');
assert.match(hub, /renderMobilePluginsPage/, 'More landing renders the plugins page');
assert.match(hub, /section === 'audit'/, 'Audit sub-route still reachable');
assert.match(read('web-ui/src/mobile/mobile-router.js'), /plugins: 'more'/, '#mobile/plugins aliases to the more route');
assert.equal(read('web-ui/src/pages/ConnectionsPage.js').includes('mobile-plugins-page'), false, 'desktop plugins page is untouched');
console.log('test-mobile-plugins-page: ok');
