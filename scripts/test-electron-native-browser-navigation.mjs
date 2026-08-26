import assert from 'node:assert/strict';
import {
  applyNativeBrowserNavigationFailureState,
  createNativeBrowserNavigationController,
  isNativeBrowserNavigationAbort,
} from '../electron/native-browser-navigation.js';

assert.equal(isNativeBrowserNavigationAbort(new Error('ERR_ABORTED (-3) loading URL')), true);
assert.equal(isNativeBrowserNavigationAbort({ errno: -3 }), true);
assert.equal(isNativeBrowserNavigationAbort(new Error('ERR_FAILED')), false);

let rejectFirst;
let stopCount = 0;
const urls = [];
const view = {
  webContents: {
    loadURL(url) {
      urls.push(url);
      if (urls.length === 1) {
        return new Promise((_resolve, reject) => { rejectFirst = reject; });
      }
      return Promise.resolve();
    },
    stop() {
      stopCount += 1;
      rejectFirst?.(Object.assign(new Error('ERR_ABORTED (-3)'), { errno: -3 }));
    },
  },
};

const navigation = createNativeBrowserNavigationController();
const first = navigation.load(view, 'persist:prometheus-inhouse-browser', 'tab-1', 'http://127.0.0.1:4173/first');
await Promise.resolve();
const second = navigation.load(view, 'persist:prometheus-inhouse-browser', 'tab-1', 'http://127.0.0.1:4173/second');

const [firstResult, secondResult] = await Promise.all([first, second]);
assert.equal(firstResult, null, 'a superseded navigation should settle without an error');
assert.equal(secondResult, undefined, 'the latest navigation should resolve normally');
assert.equal(stopCount, 1, 'superseding a navigation should stop the prior load');
assert.deepEqual(urls, [
  'http://127.0.0.1:4173/first',
  'http://127.0.0.1:4173/second',
]);

// A superseded A navigation may emit did-fail-load(-3) after B is already the
// authoritative page. That late event must not overwrite B's URL or state.
const currentState = {
  url: 'http://127.0.0.1:4173/second',
  title: 'Second page',
  lastError: '',
};
const lateAbort = applyNativeBrowserNavigationFailureState(currentState, {
  errorCode: -3,
  description: 'ERR_ABORTED',
  validatedURL: 'http://127.0.0.1:4173/first',
  currentURL: 'http://127.0.0.1:4173/second',
});
assert.equal(lateAbort.authoritative, false, 'a late superseded failure must be ignored');
assert.deepEqual(currentState, {
  url: 'http://127.0.0.1:4173/second',
  title: 'Second page',
  lastError: '',
}, 'a late A abort must not overwrite current B state');

const genuineFailure = applyNativeBrowserNavigationFailureState(currentState, {
  errorCode: -105,
  description: 'NAME_NOT_RESOLVED',
  validatedURL: 'http://invalid.test/',
  currentURL: 'http://invalid.test/',
});
assert.equal(genuineFailure.authoritative, true, 'a genuine failure must remain authoritative');
assert.equal(currentState.url, 'http://invalid.test/');
assert.equal(currentState.lastError, 'NAME_NOT_RESOLVED');

const failingView = {
  webContents: {
    loadURL() { return Promise.reject(new Error('ERR_FAILED')); },
  },
};
await assert.rejects(
  navigation.load(failingView, 'persist:prometheus-inhouse-browser', 'tab-2', 'http://127.0.0.1:4173/fails'),
  /ERR_FAILED/,
);

console.log('Electron native browser navigation regression passed.');
