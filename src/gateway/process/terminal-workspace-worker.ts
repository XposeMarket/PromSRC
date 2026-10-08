import {
  createTerminalWorkspaceTracker,
  isTerminalTrackerExcludedPath,
  resolveTerminalGitRoot,
  type TerminalFileMapCapture,
  type TerminalWorkspaceTracker,
} from '../coding/terminal-change-tracker';
import { ensureWorkspaceWatch, workspaceWatchBarrier, workspaceWatchGeneration } from '../coding/workspace-watch';
import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  boundedRuntimeWorkerError,
  isRuntimeWorkerProtocolMessage,
  type RuntimeWorkerChildMessage,
  type RuntimeWorkerParentMessage,
} from './runtime-worker-protocol';
import {
  sampleRuntimeWorkerResources,
  startRuntimeWorkerResourceHeartbeat,
} from './runtime-worker-resources';

interface ActiveTracker {
  tracker: TerminalWorkspaceTracker;
  /** Watcher generation observed (behind a barrier) when the baseline was taken; null = no watcher. */
  generation: number | null;
}

const trackers = new Map<string, ActiveTracker>();
let activeRequestId: string | undefined;

// Last physical capture per non-Git workspace, valid while the watcher
// generation is unchanged. Lets a begin skip the ~150 ms walk.
const captureCache = new Map<string, { generation: number; capture: TerminalFileMapCapture }>();

function watchKey(workspacePath: string): string {
  return process.platform === 'win32' ? workspacePath.toLowerCase() : workspacePath;
}

/** Generation after all prior fs events are delivered, or null when unprovable. */
async function settledGeneration(workspacePath: string): Promise<number | null> {
  if (!ensureWorkspaceWatch(workspacePath, isTerminalTrackerExcludedPath)) return null;
  if (!(await workspaceWatchBarrier(workspacePath))) return null;
  return workspaceWatchGeneration(workspacePath);
}

async function beginTracker(runId: string, input: Parameters<typeof createTerminalWorkspaceTracker>[0]): Promise<{ active: boolean }> {
  const workspacePath = String(input.workspacePath || '');
  const gitRoot = workspacePath ? resolveTerminalGitRoot(workspacePath) : undefined;
  const generation = workspacePath ? await settledGeneration(workspacePath) : null;
  const cached = workspacePath && !gitRoot && generation !== null ? captureCache.get(watchKey(workspacePath)) : undefined;
  const baseline = cached && cached.generation === generation ? cached.capture : undefined;
  const tracker = createTerminalWorkspaceTracker(input, { gitRoot, baseline });
  if (tracker) {
    trackers.set(runId, { tracker, generation });
    if (!tracker.isGit && generation !== null) {
      captureCache.set(watchKey(tracker.workspacePath), { generation, capture: tracker.baselineCapture });
    }
  }
  return { active: Boolean(tracker) };
}

async function finalizeTracker(runId: string): Promise<unknown> {
  const entry = trackers.get(runId);
  trackers.delete(runId);
  if (!entry) return null;
  const { tracker } = entry;
  const generation = entry.generation === null ? null : await settledGeneration(tracker.workspacePath);
  const unchanged = generation !== null && generation === entry.generation;
  const result = tracker.finalize({ unchanged });
  if (!tracker.isGit && generation !== null) {
    const capture = unchanged ? tracker.baselineCapture : tracker.finalCapture;
    // Keyed by the pre-walk generation: a write during the walk bumps the
    // generation and invalidates this entry.
    if (capture) captureCache.set(watchKey(tracker.workspacePath), { generation, capture });
  }
  return result;
}

function send(message: RuntimeWorkerChildMessage): void {
  if (process.connected && process.send) process.send(message);
}

const heartbeat = startRuntimeWorkerResourceHeartbeat(send, () => activeRequestId);
process.once('disconnect', () => {
  clearInterval(heartbeat);
  process.exit(0);
});

process.on('message', async (raw: unknown) => {
  if (!isRuntimeWorkerProtocolMessage(raw)) return;
  const message = raw as RuntimeWorkerParentMessage;
  if (message.type === 'shutdown') {
    clearInterval(heartbeat);
    trackers.clear();
    try { process.disconnect(); } catch {}
    process.exit(0);
  }
  if (message.type !== 'run') return;
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
    const payload = message.payload && typeof message.payload === 'object'
      ? message.payload as { runId?: string; input?: Parameters<typeof createTerminalWorkspaceTracker>[0] }
      : {};
    const runId = String(payload.runId || '').trim();
    if (!runId) throw new Error('runId is required');
    let result: unknown;
    if (message.kind === 'begin') {
      if (!payload.input || trackers.has(runId)) throw new Error('Invalid or duplicate terminal baseline');
      result = await beginTracker(runId, payload.input);
    } else if (message.kind === 'finalize') {
      result = await finalizeTracker(runId);
    } else {
      throw new Error(`Unsupported terminal workspace action: ${message.kind}`);
    }
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: message.requestId,
      result,
      completedAt: Date.now(),
      resourceSample: sampleRuntimeWorkerResources(),
    });
  } catch (error) {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: message.requestId,
      code: 'TERMINAL_WORKSPACE_ERROR',
      message: boundedRuntimeWorkerError(error),
      completedAt: Date.now(),
      resourceSample: sampleRuntimeWorkerResources(),
    });
  } finally {
    activeRequestId = undefined;
  }
});

send({
  protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
  type: 'ready',
  workerName: 'terminal-workspace',
  pid: process.pid,
  resourceSample: sampleRuntimeWorkerResources(),
});
