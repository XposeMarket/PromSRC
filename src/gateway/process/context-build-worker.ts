import {
  DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES,
  RUNTIME_WORKER_PROTOCOL_VERSION,
  boundedRuntimeWorkerError,
  isRuntimeWorkerProtocolMessage,
  runtimeWorkerMessageBytes,
  type RuntimeWorkerChildMessage,
  type RuntimeWorkerParentMessage,
} from './runtime-worker-protocol.js';
import {
  buildPersonalityContext,
  type BuildPersonalityContextOptions,
  type PersonalityContextSnapshot,
} from '../prompt-context.js';

interface ContextBuildPayload {
  sessionId: string;
  workspacePath: string;
  messageText: string;
  executionMode: string;
  historyLength: number;
  extraCats?: string[];
  options: BuildPersonalityContextOptions & { serializedSnapshot: PersonalityContextSnapshot };
}

interface ContextBuildResult {
  context: string;
  rssBytes: number;
}

const MAX_RESULT_BYTES = Math.max(
  DEFAULT_RUNTIME_WORKER_MAX_MESSAGE_BYTES,
  Number(process.env.PROMETHEUS_CONTEXT_BUILD_MAX_RESULT_BYTES || 2 * 1024 * 1024),
);
const workerName = String(process.env.PROMETHEUS_RUNTIME_WORKER_NAME || 'context-build');
let activeRequestId = '';

function send(message: RuntimeWorkerChildMessage): void {
  if (!process.send || !process.connected) return;
  const bytes = runtimeWorkerMessageBytes(message);
  if (bytes > MAX_RESULT_BYTES) {
    process.send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : undefined,
      code: 'IPC_RESULT_TOO_LARGE',
      message: `Context result exceeded the bounded IPC limit (${bytes} bytes; max ${MAX_RESULT_BYTES}).`,
      completedAt: Date.now(),
    } satisfies RuntimeWorkerChildMessage);
    return;
  }
  process.send(message);
}

function shutdown(): void {
  try { process.disconnect(); } catch {}
  process.exit(0);
}

async function execute(payload: ContextBuildPayload): Promise<ContextBuildResult> {
  if (!payload || typeof payload !== 'object') throw new Error('Context build payload is required.');
  if (!payload.options?.serializedSnapshot) throw new Error('Context build requires a serialized gateway snapshot.');
  if (process.env.PROMETHEUS_CONTEXT_BUILD_WORKER_TEST_HOOKS === '1') {
    if (payload.messageText === '__PROMETHEUS_CONTEXT_TEST_CRASH__') process.exit(87);
    if (payload.messageText === '__PROMETHEUS_CONTEXT_TEST_CPU__') {
      const until = Date.now() + Math.max(1, Math.min(5_000, Number(process.env.PROMETHEUS_CONTEXT_BUILD_TEST_CPU_MS || 500)));
      while (Date.now() < until) Math.sqrt(Date.now());
    }
  }
  const fakeSkillsManager = {
    buildTurnContext: () => {
      throw new Error('Context worker attempted to access mutable SkillsManager state.');
    },
  };
  const context = await buildPersonalityContext(
    String(payload.sessionId || ''),
    String(payload.workspacePath || ''),
    String(payload.messageText || ''),
    String(payload.executionMode || 'interactive'),
    Math.max(0, Number(payload.historyLength || 0)),
    fakeSkillsManager as any,
    () => new Map(),
    () => {},
    new Set(Array.isArray(payload.extraCats) ? payload.extraCats.map(String) : []),
    payload.options,
  );
  return { context, rssBytes: process.memoryUsage().rss };
}

process.on('disconnect', () => process.exit(0));
process.on('message', (raw: unknown) => {
  void (async () => {
    if (!isRuntimeWorkerProtocolMessage(raw)) return;
    const message = raw as RuntimeWorkerParentMessage;
    if (message.type === 'shutdown') {
      if (!activeRequestId) shutdown();
      return;
    }
    if (message.type !== 'run') return;
    if (message.kind !== 'build_personality_context') {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'UNKNOWN_JOB_KIND',
        message: `Unsupported context worker job: ${message.kind}`,
        completedAt: Date.now(),
      });
      return;
    }
    if (activeRequestId) {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'WORKER_BUSY',
        message: 'Context worker is already running a job.',
        completedAt: Date.now(),
      });
      return;
    }
    activeRequestId = message.requestId;
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'started',
      requestId: message.requestId,
      kind: message.kind,
      pid: process.pid,
      startedAt: Date.now(),
    });
    try {
      const result = await execute(message.payload as ContextBuildPayload);
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'result',
        requestId: message.requestId,
        result,
        completedAt: Date.now(),
      });
    } catch (error) {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'CONTEXT_BUILD_FAILED',
        message: boundedRuntimeWorkerError(error),
        completedAt: Date.now(),
      });
    } finally {
      activeRequestId = '';
    }
  })();
});

send({
  protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
  type: 'ready',
  workerName,
  pid: process.pid,
});
