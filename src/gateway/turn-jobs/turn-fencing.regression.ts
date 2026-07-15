import assert from 'assert';
import { getBrowserToolDefinitions } from '../browser-tools.js';
import {
  DurableTurnFenceError,
  assertDurableTurnLease,
  createDurableTurnAbortView,
  failDurableTurn,
  fenceDurableTurnExecution,
  recordDurableTurnEvent,
  toTurnJsonValueAsync,
  type DurableTurnExecution,
} from './execution-context.js';
import { TurnJobLeaseLostError } from './store.js';

function fakeExecution(id: string): DurableTurnExecution {
  const fenceController = new AbortController();
  return {
    jobId: id,
    sessionId: 'fence-regression-session',
    kind: 'interactive',
    attempt: 1,
    leaseToken: 'lease-token',
    leaseOwner: 'fence-regression',
    payloadRef: `turnblob:sha256:${'a'.repeat(64)}`,
    nextToolSequence: 1,
    nextModelSequence: 1,
    heartbeatTimer: null,
    fenceController,
    signal: fenceController.signal,
    fencedAt: null,
    fenceReason: null,
    fenceError: null,
    finalRef: null,
    settled: false,
    replayed: false,
  };
}

async function main(): Promise<void> {
  const sharedSchema = [{ type: 'string' }];
  const repeatedSchema = await toTurnJsonValueAsync({
    first: sharedSchema,
    second: sharedSchema,
  });
  assert.deepEqual(repeatedSchema, {
    first: [{ type: 'string' }],
    second: [{ type: 'string' }],
  }, 'shared schema objects must not be mistaken for circular references');
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.deepEqual(await toTurnJsonValueAsync(circular), {
    self: { $prometheus: 'cycle_omitted' },
  }, 'true ancestor cycles must still be bounded');
  const browserSchemas = await toTurnJsonValueAsync(getBrowserToolDefinitions());
  assert.equal(
    JSON.stringify(browserSchemas).includes('cycle_omitted'),
    false,
    'real browser tool schemas must preserve shared enum arrays',
  );
  const browserObserve = (browserSchemas as any[]).find((tool) => tool?.function?.name === 'browser_observe');
  assert(Array.isArray(browserObserve?.function?.parameters?.properties?.observe?.enum));

  const mobilePayload = await toTurnJsonValueAsync({
    message: 'Hey',
    requestMeta: { clientRequestId: undefined },
    flags: { optional: undefined, streaming: true },
  });
  assert.deepEqual(mobilePayload, {
    message: 'Hey',
    requestMeta: {},
    flags: { streaming: true },
  }, 'optional request fields must be normalized before durable JSON persistence');
  const mobileOrigin = await toTurnJsonValueAsync({
    channel: 'mobile',
    clientRequestId: undefined,
    nested: { optional: undefined },
  });
  assert.deepEqual(mobileOrigin, {
    channel: 'mobile',
    nested: {},
  }, 'optional actor-context fields must be normalized before durable store admission');

  const execution = fakeExecution('job-fenced');
  let timerFired = false;
  execution.heartbeatTimer = setTimeout(() => { timerFired = true; }, 25);
  const fence = fenceDurableTurnExecution(
    execution,
    new TurnJobLeaseLostError(execution.jobId),
    'heartbeat renewal failed',
  );

  assert(fence instanceof DurableTurnFenceError);
  assert.equal(fence.code, 'TURN_LEASE_FENCED');
  assert.equal(execution.signal.aborted, true, 'lease loss must synchronously abort in-flight work');
  assert.equal(execution.signal.reason, fence, 'the abort reason must retain the observable fence error');
  assert.equal(execution.heartbeatTimer, null, 'fencing must stop lease heartbeats');
  assert.throws(() => assertDurableTurnLease(execution), DurableTurnFenceError);
  assert.throws(
    () => recordDurableTurnEvent('token', { text: 'late' }, execution),
    DurableTurnFenceError,
    'even non-persisted token boundaries must reject stale continuation work',
  );

  const repeated = fenceDurableTurnExecution(execution, new Error('later failure'));
  assert.equal(repeated, fence, 'the first fence cause must remain authoritative');
  failDurableTurn(new Error('outer turn failure'), true, execution);
  assert.equal(execution.settled, true, 'a fenced attempt must settle locally without mutating a replacement lease');

  const upstream = new AbortController();
  const second = fakeExecution('job-combined-abort');
  const view = createDurableTurnAbortView(second, { aborted: false, signal: upstream.signal });
  upstream.abort(new Error('client disconnected'));
  assert.equal(view.state.aborted, true);
  assert.equal(view.state.signal.aborted, true, 'client cancellation must reach provider/tool cancellation signals');
  view.dispose();

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(timerFired, false, 'the stopped heartbeat timer must not run after fencing');
  console.log('turn fencing regression passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
