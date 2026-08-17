import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'web-ui/src/mobile/mobile-gateway-catalog.js');
const generatedPath = path.join(root, 'generated/public-web-ui/static/mobile/mobile-gateway-catalog.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const generated = fs.readFileSync(generatedPath, 'utf8');

assert.equal(generated, source, 'generated mobile gateway catalog must stay synchronized with source');

const startMarker = 'export async function loadMobileGatewayPinnedSessions';
const endMarker = 'export async function searchMobileGatewaySessions';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
assert.ok(start >= 0 && end > start, 'pinned-session loader must exist before gateway search');

const functionSource = source.slice(start, end).replace(/^export\s+/, '');
assert.match(functionSource, /\/api\/sessions\?/, 'pinned loader must query the server-side session filter');
assert.match(functionSource, /pinned:\s*'1'/, 'pinned loader must request pinned sessions before pagination');
assert.doesNotMatch(functionSource, /loadMobileGatewaySessionPage\(/, 'pinned loader must not infer pins from the bounded ordinary timeline page');

const requests = [];
const gateways = [
  { gatewayId: 'gw-mac', name: 'Mac' },
  { gatewayId: 'gw-desktop', name: 'Desktop' },
];
const context = {
  URLSearchParams,
  console,
  _loadOnlineSelectedGatewayEntries: async () => gateways,
  targetNamespacedId: (gatewayId, sessionId) => `${gatewayId}::${sessionId}`,
  gatewayFetchJson: async (entry, requestPath) => {
    requests.push({ gatewayId: entry.gatewayId, requestPath });
    const url = new URL(requestPath, 'https://gateway.example');
    assert.equal(url.pathname, '/api/sessions');
    assert.equal(url.searchParams.get('scope'), 'all');
    assert.equal(url.searchParams.get('includeAutomated'), '1');
    assert.equal(url.searchParams.get('state'), 'active');
    assert.equal(url.searchParams.get('pinned'), '1');
    // Simulate an old pinned chat that is not part of the ordinary newest-chat
    // page, plus a defensive stray unpinned row from an older gateway.
    return {
      sessions: [
        { id: 'old-pinned', title: `${entry.name} pinned`, pinnedAt: entry.gatewayId === 'gw-mac' ? 20 : 10, lastMessageAt: 1 },
        { id: 'not-pinned', title: 'ordinary chat', pinnedAt: null, lastMessageAt: 999 },
      ],
    };
  },
};
vm.runInNewContext(`${functionSource}\nthis.loadPinned = loadMobileGatewayPinnedSessions;`, context, {
  filename: 'mobile-gateway-pinned-session-loader.js',
});

const pinned = await context.loadPinned({ state: 'active' });
assert.equal(requests.length, 2, 'each live selected gateway must be queried for pinned sessions');
assert.deepEqual(
  Array.from(pinned, (session) => session.id),
  ['gw-mac::old-pinned', 'gw-desktop::old-pinned'],
  'old pinned chats from each gateway must survive independently of ordinary timeline pagination',
);
assert.ok(pinned.every((session) => Number(session.pinnedAt || 0) > 0), 'defensive filtering must exclude unpinned rows');
assert.deepEqual(
  Array.from(pinned, (session) => session.targetSessionId),
  ['old-pinned', 'old-pinned'],
  'gateway-local session ids must be preserved for subsequent target-scoped actions',
);

console.log('[test-mobile-pinned-session-filter] passed: pinned chats are server-filtered before pagination and stay gateway-namespaced');
