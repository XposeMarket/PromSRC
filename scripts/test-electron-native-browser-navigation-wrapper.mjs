import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prepareNativeBrowserWebContents } = require('../electron/native-browser-view.js');

class FakeWebContents extends EventEmitter {
  loadURL(url) { return Promise.resolve(url); }
  stop() {}
}

const wc = new FakeWebContents();
prepareNativeBrowserWebContents(wc);
let calls = 0;
const listener = () => { calls += 1; };
wc.on('did-fail-load', listener);
wc.removeListener('did-fail-load', listener);
wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://invalid.test/');
assert.equal(calls, 0, 'removeListener must remove the wrapped did-fail-load listener');

console.log('Electron native browser navigation listener wrapper passed.');
