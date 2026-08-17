import { RuntimeWorkerBroker } from '../process/runtime-worker-broker.js';

const WORKER_TIMEOUT_MS = Math.max(5_000, Math.min(60_000, Number(process.env.PROMETHEUS_AUDIT_OPS_TIMEOUT_MS) || 15_000));
const IDLE_SHUTDOWN_MS = Math.max(250, Math.min(60_000, Number(process.env.PROMETHEUS_AUDIT_OPS_IDLE_SHUTDOWN_MS) || 2_000));

const broker = new RuntimeWorkerBroker({
  name: 'audit-ops',
  entryBasename: '../audit/audit-ops-worker',
  maxMessageBytes: 4 * 1024 * 1024,
  startupTimeoutMs: 30_000,
  defaultJobTimeoutMs: WORKER_TIMEOUT_MS,
  env: { PROMETHEUS_AUDIT_OPS_WORKER: '1' },
});

interface QueuedAuditJob {
  ownerSessionId: string;
  args: any;
  resolve: (value: Record<string, any>) => void;
  reject: (error: Error) => void;
}

const queue: QueuedAuditJob[] = [];
let active = false;
let idleShutdownTimer: NodeJS.Timeout | null = null;

function clearIdleShutdown(): void {
  if (!idleShutdownTimer) return;
  clearTimeout(idleShutdownTimer);
  idleShutdownTimer = null;
}

function scheduleIdleShutdown(): void {
  clearIdleShutdown();
  idleShutdownTimer = setTimeout(() => {
    idleShutdownTimer = null;
    if (active || queue.length) return;
    void broker.shutdown().catch(() => undefined);
  }, IDLE_SHUTDOWN_MS);
  idleShutdownTimer.unref?.();
}

function scheduleDrain(): void {
  setImmediate(() => void drain());
}

async function drain(): Promise<void> {
  if (active) return;
  const job = queue.shift();
  if (!job) return;
  active = true;
  try {
    const result = await broker.run<Record<string, any>>('audit_ops', {
      ownerSessionId: job.ownerSessionId,
      args: job.args,
    }, WORKER_TIMEOUT_MS);
    job.resolve(result || {});
  } catch (error: any) {
    job.reject(error instanceof Error ? error : new Error(String(error)));
  } finally {
    active = false;
    if (queue.length) scheduleDrain();
    else {
      broker.unref();
      scheduleIdleShutdown();
    }
  }
}

export function executePrometheusAuditOpsInWorker(ownerSessionId: string, args: any): Promise<Record<string, any>> {
  clearIdleShutdown();
  return new Promise((resolve, reject) => {
    queue.push({ ownerSessionId: String(ownerSessionId || ''), args, resolve, reject });
    scheduleDrain();
  });
}

export async function shutdownAuditOpsWorker(): Promise<void> {
  clearIdleShutdown();
  queue.splice(0).forEach((job) => job.reject(new Error('Audit worker shut down.')));
  active = false;
  await broker.shutdown();
}

export function getAuditOpsWorkerStatus(): ReturnType<RuntimeWorkerBroker['getStatus']> {
  return broker.getStatus();
}
