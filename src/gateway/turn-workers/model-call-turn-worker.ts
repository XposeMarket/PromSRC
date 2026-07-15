import { runTurnWorker } from './child-runtime.js';
import type { ModelCallInputEnvelope, ModelCallResultReference } from './model-call-contract.js';
import { runModelCallWorkerJob } from './model-call-handler.js';

runTurnWorker<ModelCallInputEnvelope, ModelCallResultReference>({
  workerId: process.env.PROMETHEUS_TURN_WORKER_ID,
  maxMessageBytes: Number(process.env.PROMETHEUS_TURN_WORKER_MAX_MESSAGE_BYTES || 0) || undefined,
  maxPayloadBytes: Number(process.env.PROMETHEUS_TURN_WORKER_MAX_PAYLOAD_BYTES || 0) || undefined,
  heartbeatIntervalMs: Number(process.env.PROMETHEUS_TURN_WORKER_HEARTBEAT_INTERVAL_MS || 0) || undefined,
  shutdownGraceMs: Number(process.env.PROMETHEUS_TURN_WORKER_SHUTDOWN_GRACE_MS || 0) || 5_000,
  run: runModelCallWorkerJob,
});
