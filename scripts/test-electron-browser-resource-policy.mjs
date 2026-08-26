import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  NATIVE_BROWSER_RESOURCE_THRESHOLDS,
  buildNativeBrowserResourceRecord,
  classifyNativeBrowserResourcePressure,
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

assert.match(mainSource, /backgroundThrottling:\s*true/);
assert.match(mainSource, /setBackgroundThrottling\(true\)/);
assert.match(mainSource, /pathName === '\/metrics'/);
assert.match(mainSource, /sampleNativeBrowserResources/);
assert.match(mainSource, /applyNativeBrowserVisibilityPolicy\(v, isSelected\)/);

console.log('Electron native browser resource policy checks passed.');
