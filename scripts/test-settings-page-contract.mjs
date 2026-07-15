import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const settings = read('web-ui/src/pages/SettingsPage.js');
const index = read('web-ui/index.html');
const mobileRouter = read('web-ui/src/mobile/mobile-router.js');
const serviceWorker = read('web-ui/service-worker.js');

assert.match(
  settings,
  /^function syncGoalRoutingReasoning\(type, selectedValue\)/m,
  'goal-routing reasoning helper must be a module-scoped declaration',
);
assert.doesNotMatch(
  settings,
  /^\s*\+\s*\nfunction syncGoalRoutingReasoning/m,
  'a unary + must not turn the exported helper into an isolated function expression',
);
assert.match(index, /applySettingsTabFallback/, 'settings tabs need an immediate shell fallback');
assert.match(index, /window\.closeSettings = closeSettingsShim/, 'the lazy settings shell must always be closable');
assert.match(index, /SettingsPage\.js\?v=settings-boot-recovery-v12/, 'desktop must load the repaired settings module version');
assert.match(mobileRouter, /SettingsPage\.js\?v=settings-boot-recovery-v12/, 'mobile must load the repaired settings module version');
assert.match(mobileRouter, /document\.body\.appendChild\(modal\)/, 'mobile must lift the shared modal out of the hidden desktop app shell');
assert.match(mobileRouter, /window\.openSettings\(tab \|\| undefined\)/, 'mobile must open the shared desktop settings controller');
assert.match(serviceWorker, /pm-v157-2026-07-14-settings-boot-recovery/, 'PWA cache must roll forward for the settings repair');

const showModalAt = index.indexOf("modal.style.display = 'flex'", index.indexOf('const openSettingsShim'));
const awaitControllerAt = index.indexOf('await window.__PROM_LOAD_SETTINGS()', index.indexOf('const openSettingsShim'));
assert.ok(showModalAt >= 0 && showModalAt < awaitControllerAt, 'settings shell must open before awaiting the controller');

console.log('[settings-page-contract] settings boot and navigation contract passed');
