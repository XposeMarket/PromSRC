import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('.');
process.env.PROMETHEUS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-telemetry-'));
const observations = await import(pathToFileURL(path.join(root, 'dist/gateway/tool-observations.js')).href);
const sessionId = 'aggregate_test';
observations.persistToolObservations(sessionId, [
  observations.createToolObservation({ sessionId, turnId: 't1', stepNum: 1, toolName: 'browser_act', args: { action: 'click' }, result: 'ok', extra: { telemetry: { durationMs: 10, argsTokens: 2, resultTokens: 3, totalCostMicros: 5 } } }),
  observations.createToolObservation({ sessionId, turnId: 't1', stepNum: 2, toolName: 'browser_extract', args: { action: 'network' }, result: 'bad', error: true, extra: { telemetry: { durationMs: 30, argsTokens: 4, resultTokens: 6, totalCostMicros: 10 } } }),
]);
const aggregate = observations.buildToolBenchmarkAggregate(sessionId);
assert.equal(aggregate.calls, 2);
assert.equal(aggregate.successes, 1);
assert.equal(aggregate.failures, 1);
assert.equal(aggregate.toolExecutionMs, 40);
assert.equal(aggregate.contextTokens, 15);
assert.ok(aggregate.byTool.browser_act);
assert.ok(aggregate.byAction['browser_extract:network']);
assert.equal(aggregate.largestPayloads.length, 2);
console.log('PASS: automatic tool benchmark aggregation contract');
