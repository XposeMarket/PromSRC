import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

function walk(dir) {
  const absolute = path.join(root, dir);
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

const html = read('web-ui/mobile-v2.html');
const entry = read('web-ui/src/mobile-v2/mobile-v2-entry.js');
const router = read('web-ui/src/mobile-v2/app/router.js');
const gateway = read('web-ui/src/mobile-v2/core/gateway-client.js');
const gateways = read('web-ui/src/mobile-v2/core/gateway-manager.js');
const features = read('web-ui/src/mobile-v2/core/feature-client.js');
const store = read('web-ui/src/mobile-v2/core/chat-store.js');
const shell = read('web-ui/src/mobile-v2/ui/shell.js');
const drawerBootstrap = read('web-ui/src/mobile-v2/ui/drawer-bootstrap.js');
const drawerParity = read('web-ui/src/mobile-v2/ui/drawer-parity.js');
const pageKit = read('web-ui/src/mobile-v2/ui/page-kit.js');
const chat = read('web-ui/src/mobile-v2/features/chat/chat-page.js');
const css = read('web-ui/src/mobile-v2/mobile-v2.css');
const gatewayServer = read('src/gateway/core/server.ts');
const pwa = read('web-ui/src/mobile-v2/core/pwa.js');
const theme = read('web-ui/src/mobile-v2/core/theme.js');
const haptics = read('web-ui/src/mobile-v2/ui/haptics.js');
const manifestV2 = read('web-ui/manifest-v2.webmanifest');
const serviceWorkerV2 = read('web-ui/service-worker-v2.js');
const legacyServiceWorker = read('web-ui/service-worker.js');
const productionBuilder = read('scripts/build-web-ui-production.mjs');
const productionBuild = read('scripts/build-web-ui-production.mjs');

assert.match(html, /mobile-v2-root/);
assert.match(html, /src\/mobile-v2\/mobile-v2-entry\.js/);
assert.match(entry, /GatewayManager/);
assert.match(entry, /FeatureClient/);
assert.match(entry, /ChatStore/);
assert.match(entry, /createMobileV2Router/);
assert.match(entry, /attachMobileV2DrawerBootstrap/);

for (const route of ['voice', 'tasks', 'hub', 'schedule', 'teams', 'subagents', 'proposals', 'more', 'creative', 'gateways', 'pair', 'settings']) {
  assert.match(router, new RegExp(route), `Mobile V2 router must own ${route}.`);
}

const featureFiles = [
  'web-ui/src/mobile-v2/features/voice/voice-page.js',
  'web-ui/src/mobile-v2/features/tasks/tasks-page.js',
  'web-ui/src/mobile-v2/features/hub/hub-page.js',
  'web-ui/src/mobile-v2/features/schedule/schedule-page.js',
  'web-ui/src/mobile-v2/features/teams/teams-page.js',
  'web-ui/src/mobile-v2/features/subagents/subagents-page.js',
  'web-ui/src/mobile-v2/features/proposals/proposals-page.js',
  'web-ui/src/mobile-v2/features/more/more-page.js',
  'web-ui/src/mobile-v2/features/gateways/gateways-page.js',
  'web-ui/src/mobile-v2/features/pairing/pairing-page.js',
  'web-ui/src/mobile-v2/features/settings/settings-page.js',
  'web-ui/src/mobile-v2/features/shared/stream-chat-panel.js',
];
for (const file of featureFiles) assert.equal(exists(file), true, `Missing Mobile V2 feature: ${file}`);

assert.match(gateway, /X-Pairing-Token/);
assert.match(gateway, /\/api\/chat/);
assert.match(gateway, /history-page/);
assert.match(gateway, /upload-binary/);
assert.match(gateway, /reasoning_summary/);
assert.doesNotMatch(gateway, /thinking_delta[\s\S]{0,120}assistant\.reasoning/, 'Raw private thinking must not be promoted to public reasoning.');

assert.match(gateways, /pm_mobile_gateway_catalog_v1/);
assert.match(gateways, /pm_mobile_gateway_token_v1/);
assert.match(gateways, /sessionRef/);
assert.match(gateways, /parseSessionRef/);
assert.match(gateways, /bindSession/);
assert.match(features, /\/api\/bg-tasks/);
assert.match(features, /\/api\/schedules/);
assert.match(features, /\/api\/teams/);
assert.match(features, /\/api\/agents/);
assert.match(features, /\/api\/proposals/);
assert.match(store, /gatewayId/);
assert.match(store, /sessionId/);

assert.match(shell, /pm-tabbar/);
assert.match(shell, /pm-drawer/);
assert.match(shell, /pm-session-row/);
assert.match(shell, /Promise\.allSettled/);
assert.match(shell, /Gateway Connections/);
assert.match(drawerBootstrap, /attachMobileV2DrawerParity/);
assert.match(drawerBootstrap, /refreshBaseSessions/);
assert.match(drawerBootstrap, /onSessionClickCapture/);
assert.match(drawerParity, /Search chats/);
assert.match(drawerParity, /Settled/);
assert.match(drawerParity, /Pinned/);
assert.match(drawerParity, /Projects/);
assert.match(chat, /uploadBinaryFile/);
assert.match(chat, /pm-v2-attachment/);
assert.match(chat, /voice/);
assert.match(pageKit, /pm-v2-page-heading/);
assert.match(css, /@import '\.\.\/styles\/mobile\.css'/);
assert.match(css, /pm-v2-page-heading/);
assert.match(css, /pm-v2-card/);
assert.match(css, /pm-v2-field/);

assert.match(gatewayServer, /pathname === '\/mobile-v2'/);
assert.match(gatewayServer, /pathname\.startsWith\('\/mobile-v2\/'\)/);
assert.match(gatewayServer, /push\(webUiRoot, 'mobile-v2\.html'\)/);

// Mobile V2 is copied and checked as raw parallel modules, not bundled into the
// legacy desktop/mobile esbuild artifacts. V2 edits must therefore not churn
// the legacy asset build id or service-worker cache namespace.
assert.match(productionBuild, /relative !== 'mobile-v2\.html'/);
assert.match(productionBuild, /!relative\.startsWith\('src\/mobile-v2\/'\)/);

assert.match(html, /manifest-v2\.webmanifest/);
assert.match(pwa, /service-worker-v2\.js/);
assert.match(pwa, /scope:\s*['"]\/mobile-v2\//);
assert.match(theme, /Prometheus One/);
assert.match(theme, /base:\s*['"]light['"]/);
assert.match(haptics, /input\.setAttribute\(['"]switch['"]/);
assert.match(manifestV2, /"id"\s*:\s*"\/mobile-v2\/"/);
assert.match(manifestV2, /"start_url"\s*:\s*"\/mobile-v2\/chat"/);
assert.match(manifestV2, /"scope"\s*:\s*"\/mobile-v2\/"/);
assert.match(serviceWorkerV2, /CACHE_PREFIX = 'pm-mobile-v2-'/);
assert.match(serviceWorkerV2, /drawer-bootstrap\.js/);
assert.match(serviceWorkerV2, /mobile-v2-drawer\.css/);
assert.doesNotMatch(serviceWorkerV2, /CACHE_PREFIX = 'prometheus-/, 'V2 cache prefix must not be owned by the legacy worker.');
assert.match(legacyServiceWorker, /k\.startsWith\('prometheus-'\)/);
assert.doesNotMatch('pm-mobile-v2-static-test', /^prometheus-/, 'V2 cache names must remain outside the legacy purge prefix.');
assert.match(productionBuilder, /manifest-v2\.webmanifest/);
assert.match(productionBuilder, /service-worker-v2\.js/);

const allV2JavaScript = walk('web-ui/src/mobile-v2').filter((file) => file.endsWith('.js'));
assert.ok(allV2JavaScript.length >= 18, 'Expected the complete Mobile V2 module graph.');
for (const file of allV2JavaScript) {
  const source = read(file);
  assert.doesNotMatch(source, /window\.__pm/, `${file} must not adopt legacy mobile global state.`);
  assert.doesNotMatch(source, /mobile-pages\.js|mobile-router\.js|mobile-api\.js/, `${file} must not import legacy mobile runtime owners.`);
  assert.doesNotMatch(source, /from\s+['"][^'"]*\/mobile\//, `${file} must stay runtime-isolated from legacy mobile modules.`);
}

console.log(`mobile-v2 complete-app contract passed: ${allV2JavaScript.length} isolated modules, full route surface, target-aware transport, isolated PWA`);
