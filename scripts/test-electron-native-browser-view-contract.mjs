import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

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

console.log('Electron native browser view wrapper contract passed.');
