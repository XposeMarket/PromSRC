import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createNativeBrowserNavigationController,
  isNativeBrowserNavigationAbort,
} = require('../electron/native-browser-navigation.js');
const {
  getNativeBrowserViewImplementations,
  prepareNativeBrowserWebContents,
} = require('../electron/native-browser-view.js');

assert.equal(isNativeBrowserNavigationAbort(new Error('ERR_ABORTED (-3) loading URL')), true);
assert.equal(isNativeBrowserNavigationAbort({ errno: -3 }), true);
assert.equal(isNativeBrowserNavigationAbort(new Error('ERR_FAILED')), false);

let rejectFirst;
let stopCount = 0;
const rawLoads = [];
const controller = createNativeBrowserNavigationController({
  loadURL(url) {
    rawLoads.push(url);
    if (rawLoads.length === 1) {
      return new Promise((_resolve, reject) => { rejectFirst = reject; });
    }
    return Promise.resolve(`loaded:${url}`);
  },
  stop() {
    stopCount += 1;
    rejectFirst?.(Object.assign(new Error('ERR_ABORTED (-3)'), { errno: -3 }));
  },
});

const first = controller.load('https://example.test/first');
await Promise.resolve();
const second = controller.load('https://example.test/second');
const [firstResult, secondResult] = await Promise.all([first, second]);
assert.equal(firstResult, null, 'only the superseded request should absorb its expected abort');
assert.equal(secondResult, 'loaded:https://example.test/second');
assert.equal(stopCount, 1);
assert.equal(controller.classifyFailure({
  errorCode: -3,
  validatedURL: 'https://example.test/first',
}).authoritative, false, 'late A abort should be ignored once B owns the view');
assert.equal(controller.classifyFailure({
  errorCode: -3,
  validatedURL: 'https://example.test/second',
}).authoritative, true, 'the current request abort must remain authoritative');

let rejectSame;
let sameCalls = 0;
const sameController = createNativeBrowserNavigationController({
  loadURL(url) {
    sameCalls += 1;
    if (sameCalls === 1) return new Promise((_resolve, reject) => { rejectSame = reject; });
    return Promise.resolve(url);
  },
  stop() { rejectSame?.(Object.assign(new Error('ERR_ABORTED (-3)'), { errno: -3 })); },
});
const sameA = sameController.load('https://example.test/same');
await Promise.resolve();
const sameB = sameController.load('https://example.test/same');
await Promise.all([sameA, sameB]);
assert.equal(sameController.classifyFailure({
  errorCode: -3,
  validatedURL: 'https://example.test/same',
}).authoritative, true, 'same-URL A→B abort identity is ambiguous and must fail conservatively');
assert.equal(sameController.classifyFailure({
  errorCode: -105,
  validatedURL: 'https://invalid.test/',
}).authoritative, true, 'genuine failures remain authoritative');

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.urls = [];
    this.pendingReject = null;
    this.stops = 0;
  }
  loadURL(url) {
    this.urls.push(url);
    if (this.urls.length === 1) {
      return new Promise((_resolve, reject) => { this.pendingReject = reject; });
    }
    return Promise.resolve(url);
  }
  stop() {
    this.stops += 1;
    this.emit('did-fail-load', {}, -3, 'ERR_ABORTED', this.urls[0]);
    this.pendingReject?.(Object.assign(new Error('ERR_ABORTED (-3)'), { errno: -3 }));
  }
}

const wc = new FakeWebContents();
prepareNativeBrowserWebContents(wc);
let surfacedFailures = 0;
wc.on('did-fail-load', () => { surfacedFailures += 1; });
const wrappedA = wc.loadURL('https://example.test/a');
await Promise.resolve();
const wrappedB = wc.loadURL('https://example.test/b');
await Promise.all([wrappedA, wrappedB]);
assert.equal(wc.stops, 1);
assert.equal(surfacedFailures, 0, 'known superseded did-fail-load must not reach main state handling');
wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.test/b');
assert.equal(surfacedFailures, 1, 'unsuperseded abort must still reach main state handling');

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
const wrappedView = new implementations[0].Constructor();
assert.equal(wrappedView.webContents.__prometheusNavigationPrepared, true, 'native view constructors must be navigation-aware');

const preloadSource = fs.readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');
assert.match(
  preloadSource,
  /navigate:\s*async\s*\(payload = \{\}\) => \{[\s\S]*native-browser:attach[\s\S]*native-browser:navigate/,
  'manual browser navigation must reattach the hidden native canvas before navigating',
);
assert.doesNotMatch(
  preloadSource,
  /ipcRenderer\.invoke\('native-browser:attach',\s*payload\)/,
  'reattach must not forward the navigation URL/action payload and cause a duplicate initial load',
);
assert.match(preloadSource, /sessionId:\s*payload\?\.sessionId/);
assert.match(preloadSource, /tabId:\s*payload\?\.tabId/);
assert.match(preloadSource, /profile:\s*payload\?\.profile/);

console.log('Electron native browser navigation recovery checks passed.');
