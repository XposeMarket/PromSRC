import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TurnJobBlobStore } from '../turn-jobs/blob-store.js';
import type { JsonValue } from '../turn-jobs/types.js';
import type { TurnWorkerCheckpointMessage, TurnWorkerEventMessage } from './protocol.js';
import { TurnWorkerProcess } from './turn-worker-process.js';
import {
  MODEL_CALL_REQUEST_VERSION,
  type ModelCallResultReference,
  type StoredModelCallResult,
} from './model-call-contract.js';

function workerEntryPath(): string {
  const source = path.join(__dirname, 'model-call-turn-worker.ts');
  if (fs.existsSync(source)) return source;
  return path.join(__dirname, 'model-call-turn-worker.js');
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function main(): Promise<void> {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-model-worker-'));
  const blobRoot = path.join(temporaryRoot, 'blobs');
  const blobs = new TurnJobBlobStore(blobRoot);
  const echoValue = `durable-echo:${'x'.repeat(300_000)}`;
  const request = blobs.putJson({
    version: MODEL_CALL_REQUEST_VERSION,
    operation: 'echo',
    value: echoValue,
  });
  const events: TurnWorkerEventMessage[] = [];
  const checkpoints: TurnWorkerCheckpointMessage[] = [];
  const worker = new TurnWorkerProcess({
    name: 'model-call-regression',
    entryPath: workerEntryPath(),
    startupTimeoutMs: 20_000,
    heartbeatIntervalMs: 100,
    heartbeatTimeoutMs: 5_000,
    cancelGraceMs: 1_000,
  });

  try {
    const handle = await worker.runJob<ModelCallResultReference>({
      jobId: 'model-call-echo-regression',
      attempt: 1,
      input: { blobRoot, requestRef: request.ref },
    }, {
      onEvent: (message) => { events.push(message); },
      onCheckpoint: (message) => { checkpoints.push(message); },
    });
    const started = await handle.started;
    const result = await handle.result;

    assert.notEqual(started.pid, process.pid, 'model call must execute outside the gateway process');
    assert.equal(result.operation, 'echo');
    assert.equal(result.providerId, 'synthetic');
    assert.equal(result.model, 'echo-v1');
    assert.match(result.resultRef, /^turnblob:sha256:[a-f0-9]{64}$/);
    assert.ok(result.resultBytes > echoValue.length, 'full output should be stored in the durable result blob');
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'output'), false, 'terminal IPC must not contain model output');
    assert.ok(JSON.stringify(result).length < 1_024, 'terminal IPC metadata must stay bounded');

    const stored = blobs.getJson<StoredModelCallResult>(result.resultRef);
    assert.equal(stored.operation, 'echo');
    assert.equal(stored.providerId, 'synthetic');
    assert.equal(record(stored.output).value, echoValue);

    const eventPayloads = events.map((message) => record(message.event));
    assert.equal(eventPayloads[0]?.kind, 'model_request');
    assert.equal(eventPayloads[0]?.phase, 'start');
    assert.equal(eventPayloads.at(-1)?.kind, 'model_request');
    assert.equal(eventPayloads.at(-1)?.phase, 'end');
    const streamed = eventPayloads
      .filter((event) => event.kind === 'model_token')
      .map((event) => String(event.text || ''))
      .join('');
    assert.equal(streamed, echoValue, 'large output should stream as bounded token events');
    assert.ok(events.every((message) => Buffer.byteLength(JSON.stringify(message), 'utf8') < 64 * 1024));

    assert.equal(checkpoints.length, 2);
    const startCheckpoint = record(checkpoints[0].checkpoint);
    const endCheckpoint = record(checkpoints[1].checkpoint);
    assert.equal(startCheckpoint.kind, 'model_request_start');
    assert.equal(startCheckpoint.requestRef, request.ref);
    assert.equal(endCheckpoint.kind, 'model_request_end');
    assert.equal(endCheckpoint.resultRef, result.resultRef);

    const serializedRequest = JSON.stringify(blobs.getJson<JsonValue>(request.ref));
    assert.equal(/api[_-]?key|access[_-]?token|authorization/i.test(serializedRequest), false);

    const delayedRequest = blobs.putJson({
      version: MODEL_CALL_REQUEST_VERSION,
      operation: 'echo',
      value: 'should-not-complete',
      delayMs: 10_000,
    });
    const delayedHandle = await worker.runJob<ModelCallResultReference>({
      jobId: 'model-call-cancel-regression',
      attempt: 1,
      input: { blobRoot, requestRef: delayedRequest.ref },
    });
    await delayedHandle.started;
    await delayedHandle.cancel('regression cancellation');
    await assert.rejects(delayedHandle.result, /regression cancellation|cancel/i);

    const recoveryRequest = blobs.putJson({
      version: MODEL_CALL_REQUEST_VERSION,
      operation: 'echo',
      value: 'recovered',
    });
    const recoveryHandle = await worker.runJob<ModelCallResultReference>({
      jobId: 'model-call-recovery-regression',
      attempt: 1,
      input: { blobRoot, requestRef: recoveryRequest.ref },
    });
    const recovered = await recoveryHandle.result;
    assert.equal(record(blobs.getJson<StoredModelCallResult>(recovered.resultRef).output).value, 'recovered');
  } finally {
    await worker.shutdown().catch(() => {});
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log('model-call turn-worker regression checks passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
