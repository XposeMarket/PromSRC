import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const stateStart = source.indexOf('let mainWindow ');
const stateEnd = source.indexOf('function normalizeTitlebarColor', stateStart);
const startupStart = source.indexOf('app.whenReady().then(async () => {');
const startupEnd = source.indexOf("app.on('window-all-closed'", startupStart);
assert.ok(stateStart >= 0 && stateEnd > stateStart && startupStart >= 0 && startupEnd > startupStart);
const lifecycle = new vm.Script(source.slice(stateStart, stateEnd) + source.slice(startupStart, startupEnd), {
  filename: fileURLToPath(new URL('../electron/main.js', import.meta.url)),
});

function windowFixture({ destroyed = false, minimized = false } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
}

function harness({ lock = true, waitForGateway = async () => {} } = {}) {
  const handlers = new Map();
  let startup;
  let windows = 0;
  let gateways = 0;
  let quits = 0;
  let startupErrors = 0;
  const context = vm.createContext({
    crypto,
    autoUpdater: null,
    IS_PACKAGED_RUNTIME: false,
    GATEWAY_LOG_PATH: 'fixture.log',
    app: {
      requestSingleInstanceLock: () => lock,
      quit: () => { quits++; },
      on: (event, handler) => handlers.set(event, handler),
      whenReady: () => ({ then: (callback) => { startup = callback; } }),
    },
    needsDependencySetup: () => false,
    getMissingPackages: () => [],
    createLoadingWindow: () => ({ close() {} }),
    completePendingCanonicalValidation: async () => {},
    startNativeBrowserRpcServer: async () => {},
    startGateway: async () => { gateways++; },
    waitForGateway,
    prepareSourceElectronRenderer: async () => {},
    createWindow: () => {
      windows++;
      context.fixtureWindow = windowFixture();
      vm.runInContext('mainWindow = fixtureWindow;', context);
    },
    setupAutoUpdater() {},
    startCanonicalUpdateWatcher() {},
    writeGatewayLog() {},
    getLastGatewayOutput: () => '',
    dialog: { showErrorBox: () => { startupErrors++; } },
  });
  lifecycle.runInContext(context);
  return {
    context, handlers,
    start: () => startup(),
    counts: () => ({ windows, gateways, quits, startupErrors }),
    setWindow: (window) => {
      context.fixtureWindow = window;
      vm.runInContext('mainWindow = fixtureWindow;', context);
    },
  };
}

let releaseGateway;
const fixture = harness({ waitForGateway: () => new Promise(resolve => { releaseGateway = resolve; }) });
fixture.handlers.get('second-instance')();
assert.equal(fixture.counts().windows, 0, 'a second launch must not create a window before startup');
const starting = fixture.start();
await new Promise(resolve => setImmediate(resolve));
fixture.handlers.get('second-instance')();
fixture.handlers.get('activate')?.();
assert.equal(fixture.counts().windows, 0, 'activation must wait for gateway readiness');
releaseGateway();
await starting;
assert.deepEqual(fixture.counts(), { windows: 1, gateways: 1, quits: 0, startupErrors: 0 });

const minimized = windowFixture({ minimized: true });
fixture.setWindow(minimized);
fixture.handlers.get('second-instance')();
assert.deepEqual(minimized.calls, ['restore', 'show', 'focus']);
assert.equal(fixture.counts().windows, 1, 'an existing window must be reused');

for (const missing of [null, windowFixture({ destroyed: true })]) {
  fixture.setWindow(missing);
  const before = fixture.counts().windows;
  fixture.handlers.get('second-instance')();
  fixture.handlers.get('second-instance')();
  assert.equal(fixture.counts().windows, before + 1, 'repeated launches must reopen exactly one window');
  assert.equal(fixture.counts().gateways, 1, 'reopening must reuse the running gateway');
}
const hidden = windowFixture();
fixture.setWindow(hidden);
fixture.handlers.get('activate')();
assert.deepEqual(hidden.calls, ['show', 'focus']);

fixture.setWindow(null);
fixture.handlers.get('activate')();
assert.equal(fixture.counts().windows, 4, 'OS activation must also recreate a closed main window');

fixture.setWindow(null);
vm.runInContext('isQuitting = true;', fixture.context);
fixture.handlers.get('second-instance')();
fixture.handlers.get('activate')();
assert.equal(fixture.counts().windows, 4, 'activation must not reopen the app during shutdown');

const secondary = harness({ lock: false });
await secondary.start();
assert.equal(secondary.handlers.size, 0, 'a secondary process must leave activation to the lock owner');
assert.deepEqual(secondary.counts(), { windows: 0, gateways: 0, quits: 1, startupErrors: 0 });

const failed = harness({ waitForGateway: async () => { throw new Error('fixture startup failure'); } });
await failed.start();
failed.handlers.get('second-instance')();
assert.deepEqual(failed.counts(), { windows: 0, gateways: 1, quits: 1, startupErrors: 1 });
console.log('electron window lifecycle: ok (startup, restore, reopen, activate, shutdown, single-instance)');
