import { runTurnWorker } from './child-runtime.js';
import { TURN_WORKER_PROTOCOL_VERSION } from './protocol.js';

interface SyntheticInput {
  mode?: 'stream' | 'steer' | 'cancel' | 'rpc_cancel' | 'uncooperative_cancel' | 'crash' | 'oversize_output' | 'identity' | 'delay';
  value?: unknown;
  delayMs?: number;
  oversizeChars?: number;
}

let jobsRun = 0;

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    if (!signal) return;
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

runTurnWorker<SyntheticInput, unknown>({
  workerId: process.env.PROMETHEUS_TURN_WORKER_ID,
  maxMessageBytes: Number(process.env.PROMETHEUS_TURN_WORKER_MAX_MESSAGE_BYTES || 0) || undefined,
  maxPayloadBytes: Number(process.env.PROMETHEUS_TURN_WORKER_MAX_PAYLOAD_BYTES || 0) || undefined,
  heartbeatIntervalMs: Number(process.env.PROMETHEUS_TURN_WORKER_HEARTBEAT_INTERVAL_MS || 0) || 100,
  shutdownGraceMs: 500,
  run: async (context) => {
    jobsRun += 1;
    const mode = context.input?.mode || 'identity';
    if (mode === 'stream') {
      await context.emitEvent({ kind: 'progress', step: 1 });
      await context.checkpoint({ cursor: 'after-first-event', jobsRun });
      const rpcResult = await context.callGateway('echo', { value: context.input.value }, {
        idempotencyKey: `${context.jobId}:${context.attempt}:echo`,
      });
      await context.emitEvent({ kind: 'rpc_result', value: rpcResult });
      return { ok: true, rpcResult, pid: process.pid, jobsRun };
    }
    if (mode === 'steer') {
      await context.emitEvent({ kind: 'waiting_for_steer' });
      const steer = await context.nextSteer();
      await context.emitEvent({ kind: 'steered', steerId: steer.steerId, payload: steer.payload });
      return { ok: true, steer, pid: process.pid, jobsRun };
    }
    if (mode === 'cancel') {
      await context.emitEvent({ kind: 'waiting_for_cancel' });
      return waitForAbort(context.signal);
    }
    if (mode === 'rpc_cancel') {
      await context.emitEvent({ kind: 'waiting_for_rpc_cancel' });
      await context.callGateway('wait_for_cancel', {});
      return { ok: true, pid: process.pid, jobsRun };
    }
    if (mode === 'uncooperative_cancel') {
      await context.emitEvent({ kind: 'ignoring_cancel' });
      await new Promise<never>(() => {});
    }
    if (mode === 'crash') {
      await context.emitEvent({ kind: 'crashing', pid: process.pid });
      process.exit(37);
    }
    if (mode === 'oversize_output') {
      if (!process.send || !process.connected) throw new Error('IPC unavailable.');
      await new Promise<void>((resolve, reject) => {
        process.send!({
          protocolVersion: TURN_WORKER_PROTOCOL_VERSION,
          type: 'event',
          jobId: context.jobId,
          attempt: context.attempt,
          sequence: 1,
          event: { text: 'x'.repeat(Math.max(32_000, Number(context.input.oversizeChars || 0))) },
          emittedAt: Date.now(),
        }, (error) => error ? reject(error) : resolve());
      });
      return waitForAbort(context.signal);
    }
    if (mode === 'delay') {
      await delay(Number(context.input.delayMs || 25), context.signal);
    }
    return { ok: true, pid: process.pid, jobsRun, value: context.input?.value };
  },
});
