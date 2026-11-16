import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  NATIVE_BROWSER_RESOURCE_THRESHOLDS,
  buildNativeBrowserProcessBreakdown,
  buildNativeBrowserResourceRecord,
  classifyNativeBrowserResourcePressure,
  findNativeBrowserProcessMetric,
  getNativeBrowserOSProcessId,
  normalizeElectronProcessMetrics,
} = require('../electron/native-browser-resource-policy.js');

const mainSource = fs.readFileSync(path.join(process.cwd(), 'electron', 'main.js'), 'utf8');

const normal = buildNativeBrowserResourceRecord({
  sessionId: 'session-1',
  tabId: 'tab-1',
  presented: true,
  visible: true,
  processId: 1234,
  processMetric: {
    cpu: { percentCPUUsage: 12.5 },
    memory: { privateBytes: 32 * 1024 * 1024, workingSetSize: 48 * 1024 * 1024 },
  },
  page: {
    visibilityState: 'visible',
    hidden: false,
    canvasCount: 1,
    usedJSHeapBytes: 10,
    totalJSHeapBytes: 100,
    jsHeapLimitBytes: 1000,
  },
});
assert.equal(normal.pressure.level, 'normal');
assert.equal(normal.visible, true);
assert.equal(normal.backgroundThrottling, true);
assert.equal(Object.hasOwn(normal, 'url'), false, 'resource records must not retain page URLs');
assert.equal(Object.hasOwn(normal, 'text'), false, 'resource records must not retain page content');

const cpuPressure = classifyNativeBrowserResourcePressure({
  cpuPercent: NATIVE_BROWSER_RESOURCE_THRESHOLDS.cpuPercent,
  privateBytes: 1,
  page: {},
});
assert.equal(cpuPressure.level, 'elevated');
assert.deepEqual(cpuPressure.reasons, ['cpu']);

const heapPressure = buildNativeBrowserResourceRecord({
  processMetric: { cpu: { percentCPUUsage: 1 }, memory: { privateBytes: 1 } },
  page: { usedJSHeapBytes: 80, totalJSHeapBytes: 100 },
});
assert.equal(heapPressure.pressure.level, 'elevated');
assert.deepEqual(heapPressure.pressure.reasons, ['js-heap']);

const memoryPressure = buildNativeBrowserResourceRecord({
  processMetric: { cpu: { percentCPUUsage: 1 }, memory: { privateBytes: NATIVE_BROWSER_RESOURCE_THRESHOLDS.privateBytes } },
  page: {},
});
assert.equal(memoryPressure.pressure.level, 'elevated');
assert.deepEqual(memoryPressure.pressure.reasons, ['private-memory']);

const rawElectronMetrics = [
  {
    pid: 4242,
    type: 'Tab',
    cpu: { percentCPUUsage: 25 },
    memory: {
      privateBytes: 600 * 1024,
      workingSetSize: 700 * 1024,
      peakWorkingSetSize: 800 * 1024,
    },
  },
  { pid: 1001, type: 'Browser', cpu: { percentCPUUsage: 10 }, memory: { privateBytes: 1000 } },
  { pid: 1002, type: 'GPU', cpu: { percentCPUUsage: 35 }, memory: { privateBytes: 2000 } },
  { pid: 1003, type: 'Utility', cpu: { percentCPUUsage: 5 }, memory: { privateBytes: 3000 } },
];
const normalizedElectronMetrics = normalizeElectronProcessMetrics(rawElectronMetrics);
assert.equal(normalizedElectronMetrics[0].memory.privateBytes, 600 * 1024 * 1024, 'Electron KB memory must normalize to bytes');
assert.equal(normalizedElectronMetrics[0].memory.workingSetSize, 700 * 1024 * 1024, 'working set must normalize to bytes');
assert.equal(normalizedElectronMetrics[0].memory.peakWorkingSetSize, 800 * 1024 * 1024, 'peak working set must normalize to bytes');

const webContents = {
  getProcessId: () => 7,
  getOSProcessId: () => 4242,
};
const osProcessId = getNativeBrowserOSProcessId(webContents);
assert.equal(osProcessId, 4242, 'correlation must use the operating-system PID');
const matchedMetric = findNativeBrowserProcessMetric(normalizedElectronMetrics, osProcessId);
assert.equal(matchedMetric?.pid, 4242, 'renderer metric must match the WebContents OS PID');
assert.notEqual(findNativeBrowserProcessMetric(normalizedElectronMetrics, webContents.getProcessId()), matchedMetric, 'Chromium renderer IDs must not be used as app metric PIDs');

const processBreakdown = buildNativeBrowserProcessBreakdown(normalizedElectronMetrics, osProcessId);
assert.equal(processBreakdown.total.cpuPercent, 75);
assert.deepEqual(processBreakdown.pressure.reasons, ['cpu', 'private-memory']);
assert.equal(processBreakdown.main.cpuPercent, 10);
assert.equal(processBreakdown.activeRenderer.cpuPercent, 25);
assert.equal(processBreakdown.gpu.cpuPercent, 35);
assert.equal(processBreakdown.utility.cpuPercent, 5);
assert.equal(processBreakdown.activeRenderer.memory.privateBytes, 600 * 1024 * 1024);
const normalizedMemoryPressure = buildNativeBrowserResourceRecord({
  processId: osProcessId,
  processMetric: matchedMetric,
  processBreakdown,
  page: {},
});
assert.deepEqual(normalizedMemoryPressure.pressure.reasons, ['private-memory']);
assert.equal(normalizedMemoryPressure.processId, 4242);
assert.equal(normalizedMemoryPressure.processBreakdown.gpu.cpuPercent, 35);

assert.match(mainSource, /backgroundThrottling:\s*true/);
assert.match(mainSource, /wc\.setBackgroundThrottling\(throttled\)/);
assert.match(mainSource, /hostWC\.setBackgroundThrottling\(throttled\)/);
assert.match(mainSource, /NATIVE_BROWSER_MAX_LEASES = 2/);
assert.match(mainSource, /setTimeout\(\(\) => releaseNativeBrowserLease\(view\), NATIVE_BROWSER_LEASE_MS\)/);
assert.match(mainSource, /parkNativeBrowserView\(view\)/);
assert.ok(mainSource.includes('Native capture returned a zero-size frame.'));
assert.ok(mainSource.includes('Compositor capture returned a zero-size frame.'));
assert.match(mainSource, /surface_not_rendered:/);
assert.ok(mainSource.includes('host.showInactive()'));
assert.ok(mainSource.includes('meta.automationHost.hide()'));
assert.match(mainSource, /pathName === '\/metrics'/);
assert.match(mainSource, /sampleNativeBrowserResources/);
assert.match(mainSource, /applyNativeBrowserVisibilityPolicy\(v, isSelected\)/);
assert.match(mainSource, /getNativeBrowserOSProcessId\(wc\)/);
assert.match(mainSource, /normalizeElectronProcessMetrics\(app\.getAppMetrics\(\)\)/);
assert.match(mainSource, /isHardwareAccelerationEnabled/);
assert.match(mainSource, /getGPUFeatureStatus/);
assert.match(mainSource, /buildNativeBrowserProcessBreakdown/);

// Idle hidden tabs are closed by age; presented and leased tabs never are.
const policy = require('../electron/native-browser-resource-policy.js');
const HOUR = 60 * 60 * 1000;
assert.equal(policy.resolveNativeBrowserIdleCloseMs(undefined), 24 * HOUR);
assert.equal(policy.resolveNativeBrowserIdleCloseMs(''), 24 * HOUR);
assert.equal(policy.resolveNativeBrowserIdleCloseMs('6'), 6 * HOUR);
assert.equal(policy.resolveNativeBrowserIdleCloseMs('0'), 0, '0 disables idle closing');
assert.equal(policy.resolveNativeBrowserIdleCloseMs('nope'), 24 * HOUR);
assert.equal(policy.resolveNativeBrowserIdleCloseMs('-3'), 24 * HOUR);
const idleBase = { presented: false, leaseActive: false, lastActivityAt: 1_000, now: 1_000 + 25 * HOUR, idleCloseMs: 24 * HOUR };
assert.equal(policy.shouldCloseIdleNativeBrowserView(idleBase), true);
assert.equal(policy.shouldCloseIdleNativeBrowserView({ ...idleBase, now: 1_000 + 23 * HOUR }), false, 'still inside the idle limit');
assert.equal(policy.shouldCloseIdleNativeBrowserView({ ...idleBase, presented: true }), false, 'the visible tab is never closed');
assert.equal(policy.shouldCloseIdleNativeBrowserView({ ...idleBase, leaseActive: true }), false, 'a tab in use is never closed');
assert.equal(policy.shouldCloseIdleNativeBrowserView({ ...idleBase, idleCloseMs: 0 }), false, 'disabled');
assert.equal(policy.shouldCloseIdleNativeBrowserView({ ...idleBase, lastActivityAt: 0 }), false, 'unknown activity time is kept');
assert.equal(policy.shouldCloseIdleNativeBrowserView(), false);

// Hidden tabs log on their own pressure change, then only on the long interval.
const logBase = { presented: false, pressureLevel: 'elevated', processPressureLevel: 'elevated', lastPressureKey: 'elevated:elevated', lastLogAt: 0, now: 61_000, visibleIntervalMs: 60_000, hiddenIntervalMs: 1_800_000 };
assert.equal(policy.shouldLogNativeBrowserResource(logBase), false, 'unchanged hidden tab stays quiet after one minute');
assert.equal(policy.shouldLogNativeBrowserResource({ ...logBase, presented: true }), true, 'visible tab keeps the one-minute cadence');
assert.equal(policy.shouldLogNativeBrowserResource({ ...logBase, now: 1_800_000 }), true, 'hidden tab repeats on the long interval');
assert.equal(policy.shouldLogNativeBrowserResource({ ...logBase, lastPressureKey: 'normal' }), true, 'hidden tab logs when it first comes under pressure');
assert.equal(policy.shouldLogNativeBrowserResource({ ...logBase, pressureLevel: 'high', lastPressureKey: 'elevated:elevated' }), true, 'hidden tab logs when its own level changes');
assert.equal(policy.shouldLogNativeBrowserResource({ ...logBase, pressureLevel: 'normal', lastPressureKey: 'normal:normal' }), false, 'app-wide pressure alone does not make a hidden tab log every minute');
assert.equal(policy.shouldLogNativeBrowserResource({ ...logBase, pressureLevel: 'normal', processPressureLevel: 'normal' }), false, 'nothing to log when normal');
assert.match(mainSource, /closeIdleNativeBrowserViews\(\);/);
assert.match(mainSource, /nativeViewMeta\(view\)\.lastActivityAt = Date\.now\(\)/);
assert.match(mainSource, /shouldLogNativeBrowserResource\(\{/);

await import('./test-electron-native-browser-navigation.mjs');
await import('./test-electron-native-browser-view-contract.mjs');
await import('./test-electron-native-browser-navigation-wrapper.mjs');

console.log('Electron native browser resource policy checks passed.');
