import path from 'path';
import { RuntimeWorkerBroker } from './runtime-worker-broker';
import type {
  TerminalWorkspaceChangeResult,
  TerminalWorkspaceTrackerInput,
} from '../coding/terminal-change-tracker';

/** The shell is already a child process; this worker keeps workspace scans off the gateway loop. */
const broker = new RuntimeWorkerBroker({
  name: 'terminal-workspace',
  entryBasename: 'terminal-workspace-worker',
  defaultJobTimeoutMs: 120_000,
  maxMessageBytes: 8 * 1024 * 1024,
  // A baseline must remain in the worker until its command exits, even if the
  // command is quiet for a long time.
  idleTtlMs: 0,
});

let queued: Promise<unknown> = Promise.resolve();
let activeTrackers = 0;

function releaseTracker(): void {
  activeTrackers = Math.max(0, activeTrackers - 1);
  if (activeTrackers === 0) broker.unref();
}

function runSerial<T>(kind: string, payload: unknown): Promise<T> {
  const next = queued.then(() => {
    broker.ref();
    return broker.run<T>(kind, payload);
  });
  queued = next.catch(() => undefined);
  return next;
}

export interface ManagedTerminalWorkspaceTracker {
  workspacePath: string;
  finalize(): Promise<TerminalWorkspaceChangeResult | null>;
}

export async function createManagedTerminalWorkspaceTracker(
  input: TerminalWorkspaceTrackerInput,
): Promise<ManagedTerminalWorkspaceTracker | null> {
  const runId = String(input.runId || '').trim();
  if (!runId) return null;
  try {
    const result = await runSerial<{ active: boolean }>('begin', { runId, input });
    if (!result?.active) {
      if (activeTrackers === 0) broker.unref();
      return null;
    }
    activeTrackers += 1;
  } catch (error: any) {
    console.warn(`[ProcessSupervisor] workspace baseline unavailable for ${runId}:`, error?.message || error);
    if (activeTrackers === 0) broker.unref();
    return null;
  }
  let finalized = false;
  return {
    workspacePath: path.resolve(input.workspacePath),
    async finalize() {
      if (finalized) return null;
      finalized = true;
      try {
        return await runSerial<TerminalWorkspaceChangeResult | null>('finalize', { runId });
      } finally {
        releaseTracker();
      }
    },
  };
}
