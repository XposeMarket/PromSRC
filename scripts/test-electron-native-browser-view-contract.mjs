import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const {
  getNativeBrowserViewImplementations,
  prepareNativeBrowserWebContents,
} = require('../electron/native-browser-view.js');

class FakeWebContents extends EventEmitter {
  loadURL(url) { return Promise.resolve(url); }
  stop() {}
}

const wc = new FakeWebContents();
const firstController = prepareNativeBrowserWebContents(wc);
const secondController = prepareNativeBrowserWebContents(wc);
assert.ok(firstController, 'navigation controller should be installed');
assert.equal(secondController, firstController, 'preparing the same WebContents must be idempotent');
assert.equal(wc.__prometheusNavigationPrepared, true);

class FakeView {
  constructor() { this.webContents = new FakeWebContents(); }
}
const mainWindow = {
  isDestroyed: () => false,
  contentView: { addChildView() {}, removeChildView() {} },
};
const implementations = getNativeBrowserViewImplementations({
  mainWindow,
  WebContentsView: FakeView,
  BrowserView: null,
});
assert.equal(implementations.length, 1);
const view = new implementations[0].Constructor();
assert.equal(view.webContents.__prometheusNavigationPrepared, true);

// Keep the native-browser contract test close to the view wrapper: these
// routes are intentionally exercised by the gateway without importing the
// Electron main process (which would require a running app).
const mainSource = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
assert.match(mainSource, /function closeNativeBrowserSession\(/, 'native browser must expose an authoritative session close path');
assert.match(mainSource, /pathName === '\/close'/, 'native browser RPC must expose session close');
assert.match(mainSource, /pathName === '\/console'/, 'native browser RPC must expose console diagnostics');
assert.match(mainSource, /pathName === '\/network'/, 'native browser RPC must expose network diagnostics');
assert.match(mainSource, /operationWarning:/, 'native tab creation must preserve successful creation when navigation warns');
assert.match(mainSource, /nativeBrowserNetworkSessions/, 'native network diagnostics must retain bounded per-partition state');

const preloadSource = fs.readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');
assert.match(preloadSource, /native-browser:close/, 'native browser preload bridge must expose session close');

const gatewaySource = fs.readFileSync(new URL('../src/gateway/browser-tools.ts', import.meta.url), 'utf8');
assert.match(gatewaySource, /recoverInHouseSessionMapping\(/, 'gateway must recover native mappings from Electron state');
assert.match(gatewaySource, /callInHouseBrowser\('console'/, 'gateway must route console diagnostics to the native lane');
assert.match(gatewaySource, /callInHouseBrowser\('network'/, 'gateway must route network diagnostics to the native lane');
assert.match(gatewaySource, /browserScrollCollectInHouse\(/, 'gateway must support native bulk scroll collection');
assert.match(gatewaySource, /browserRunSmokeStepsInHouse\(/, 'gateway smoke tests must execute steps in the native lane');
assert.doesNotMatch(gatewaySource, /browserScrollCollect\(.*inHouseUnsupportedToolMessage/s, 'bulk scroll collection must not remain an in-house unsupported stub');
assert.match(gatewaySource, /recoverStuckPrometheusChrome\(/, 'gateway must have a scoped recovery path for wedged managed CDP targets');

console.log('Electron native browser view wrapper contract passed.');
