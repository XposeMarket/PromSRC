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

let onceCalls = 0;
wc.once('did-fail-load', () => { onceCalls += 1; });
wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://invalid.test/');
wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://invalid.test/');
assert.equal(onceCalls, 1, 'once must remain one-shot after navigation failure filtering');

let addListenerCalls = 0;
const added = () => { addListenerCalls += 1; };
wc.addListener('did-fail-load', added);
wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://invalid.test/');
assert.equal(addListenerCalls, 1, 'addListener must use the same authoritative failure filter as on');
wc.removeListener('did-fail-load', added);
wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://invalid.test/');
assert.equal(addListenerCalls, 1, 'removeListener must also remove addListener registrations');

let duplicateCalls = 0;
const duplicate = () => { duplicateCalls += 1; };
wc.on('did-fail-load', duplicate);
wc.on('did-fail-load', duplicate);
wc.removeListener('did-fail-load', duplicate);
wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://invalid.test/');
assert.equal(duplicateCalls, 1, 'one removeListener call must remove exactly one duplicate registration');
wc.removeListener('did-fail-load', duplicate);
wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://invalid.test/');
assert.equal(duplicateCalls, 1, 'repeated removeListener calls must remove every duplicate wrapped registration');

let offCalls = 0;
const offListener = () => { offCalls += 1; };
wc.on('did-fail-load', offListener);
wc.off('did-fail-load', offListener);
wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://invalid.test/');
assert.equal(offCalls, 0, 'off must remove the wrapped did-fail-load listener just like removeListener');

console.log('Electron native browser navigation listener wrapper passed.');
