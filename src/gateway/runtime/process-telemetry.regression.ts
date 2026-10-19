import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createSampleBuffer, createExitRecord, isHeapPressure, type ProcessSample } from './process-telemetry.js';

const ring = createSampleBuffer(3);
assert.equal(ring.latest(), null);
for (let i = 1; i <= 5; i++) ring.push({ heapUsed: i } as ProcessSample);
assert.deepEqual(ring.values().map(x => x.heapUsed), [3, 4, 5]);
assert.equal(ring.latest()?.heapUsed, 5);
const copy = ring.values(); copy.pop();
assert.equal(ring.values().length, 3);
assert.throws(() => createSampleBuffer(0), RangeError);
assert.equal(isHeapPressure(84, 100), false);
assert.equal(isHeapPressure(85, 100), true);
assert.equal(isHeapPressure(100, 0), false);
assert.equal(createExitRecord('SIGTERM', ring.latest()).lastSample?.heapUsed, 5);
assert.equal(createExitRecord('SIGTERM', ring.latest()).reason, 'SIGTERM');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-telemetry-'));
try {
  const moduleUrl = pathToFileURL(path.resolve('src/gateway/runtime/process-telemetry.ts')).href;
  for (const crash of [false, true]) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `import { installProcessTelemetry } from ${JSON.stringify(moduleUrl)}; installProcessTelemetry(); installProcessTelemetry(); ${crash ? 'throw new Error("telemetry regression crash")' : 'process.exit(7)'}`], {
      env: { ...process.env, PROMETHEUS_RUNTIME_DIR: temp }, encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, crash ? 1 : 7, child.stderr);
    const record = JSON.parse(fs.readFileSync(path.join(temp, 'logs', 'gateway-process-telemetry-last.json'), 'utf8'));
    assert.equal(record.reason, crash ? 'uncaughtException' : 'natural_exit');
    assert.equal(record.code, crash ? 1 : 7);
    assert.equal(record.pid, record.lastSample.pid);
    assert.ok(record.lastSample.heapLimit > 0);
    assert.ok(record.lastSample.rss > 0);
    assert.ok(record.lastSample.eventLoopDelayMs.max >= 0);
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log('process telemetry regression: PASS');
