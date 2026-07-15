/**
 * core/app.ts — B3 Refactor
 *
 * Express application factory: creates the app instance, applies all
 * middleware, and mounts static file serving.
 *
 * Called once by server-v2.ts. The returned `app` is the same object
 * used everywhere else — nothing changes at runtime.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { getPublicWebUiRoot, hasPublicWebUiBuild, isPublicDistributionBuild, resolvePrometheusRoot } from '../../runtime/distribution.js';
import { buildGatewayCorsOptions } from '../gateway-auth';
import { isModelBusy, getLastMainSessionId } from '../comms/broadcaster';
import { listLiveRuntimes } from '../live-runtime-registry';
import { getMemoryIndexRefreshWorkerStatus } from '../memory-index/refresh-worker-client';
import { getTurnJobRuntimeStatus } from '../turn-jobs/runtime.js';
import { fileResourceLeasesEnabled } from '../turn-jobs/resource-policy.js';
import { getTurnRetentionRuntimeStatus } from '../turn-jobs/retention-client.js';
import { getModelTurnWorkerPoolStatus } from '../turn-workers/model-call-dispatcher.js';
import { getTurnFileChangeWorkerPoolStatus } from '../turn-workers/turn-file-change-dispatcher.js';
import { getContextFootprintWorkerStatus } from '../context-window/context-footprint-client.js';
import { getSessionPersistenceStatus } from '../session.js';
import { getToolObservationPersistenceStatus } from '../tool-observation-persistence-client.js';
import { providerWebhookRawBodyMiddleware, resolveHookConfig } from '../comms/webhook-handler';

const startedAt = Date.now();

function setStaticCacheHeaders(res: express.Response, filePath: string): void {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.endsWith('/index.html')) {
    res.setHeader('Cache-Control', 'no-cache');
    return;
  }
  if (normalized.includes('/static/') || normalized.includes('/vendor/') || normalized.includes('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return;
  }
  res.setHeader('Cache-Control', 'no-cache');
}

export function createApp(): express.Application {
  const app = express();

  app.use(cors(buildGatewayCorsOptions()));
  // Provider routes must enforce their smaller limit before the general JSON
  // parser buffers or parses the request. The raw parser preserves exact HMAC bytes.
  const hookPath = resolveHookConfig().path;
  app.use(`${hookPath}/provider/:provider`, providerWebhookRawBodyMiddleware());
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    const memoryMaintenance = getMemoryIndexRefreshWorkerStatus();
    const turnJournal = getTurnJobRuntimeStatus() as any;
    const turnRetention = getTurnRetentionRuntimeStatus();
    const turnWorkers = getModelTurnWorkerPoolStatus();
    const fileChangeWorkers = getTurnFileChangeWorkerPoolStatus();
    const contextFootprint = getContextFootprintWorkerStatus();
    const sessionPersistence = getSessionPersistenceStatus();
    const toolObservationPersistence = getToolObservationPersistenceStatus();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      uptimeMs: Date.now() - startedAt,
      pid: process.pid,
      timestamp: Date.now(),
      modelBusy: isModelBusy(),
      lastMainSessionId: getLastMainSessionId(),
      activeRuntimes: listLiveRuntimes().map((runtime) => ({
        id: runtime.id,
        kind: runtime.kind,
        label: runtime.label,
        startedAt: runtime.startedAt,
        sessionId: runtime.sessionId,
      })),
      memoryMaintenance: {
        isolation: memoryMaintenance.isolation,
        workerHeapMb: memoryMaintenance.workerHeapMb,
        state: memoryMaintenance.broker.state,
        pid: memoryMaintenance.broker.pid,
        active: !!memoryMaintenance.runningWorkspace,
        activeKind: memoryMaintenance.runningKind,
        queuedWorkspaces: memoryMaintenance.queuedWorkspaces,
        queuedJobs: memoryMaintenance.queuedJobs,
        lastRunStartedAt: memoryMaintenance.lastRunStartedAt,
        lastRunCompletedAt: memoryMaintenance.lastRunCompletedAt,
        lastError: memoryMaintenance.lastError,
      },
      turnRuntime: {
        isolation: 'model-process-pool+file-change-process+context-process+observation-process+durable-turn-journal',
        resourceLeases: {
          sharedWorkspace: true,
          fileRepositoryEnabled: fileResourceLeasesEnabled(),
          singletonResourcesEnabled: true,
        },
        enabled: turnWorkers.enabled,
        maxWorkers: turnWorkers.maxWorkers,
        workerHeapMb: turnWorkers.heapLimitMb,
        queuedJobs: turnWorkers.queuedJobs,
        runningJobs: turnWorkers.runningJobs,
        workers: turnWorkers.workers.map((worker) => ({
          state: worker.state,
          pid: worker.pid,
          active: Boolean(worker.activeJobId),
          lastHeartbeatAt: worker.lastHeartbeatAt,
          jobsCompleted: worker.jobsCompleted,
        })),
        fileChangeWorkers: {
          enabled: fileChangeWorkers.enabled,
          workerOldSpaceMb: fileChangeWorkers.workerOldSpaceMb,
          maxWorkers: fileChangeWorkers.maxWorkers,
          queuedJobs: fileChangeWorkers.queuedJobs,
          runningJobs: fileChangeWorkers.runningJobs,
          workers: fileChangeWorkers.workers.map((worker) => ({
            state: worker.state,
            pid: worker.pid,
            active: Boolean(worker.activeJobId),
            lastHeartbeatAt: worker.lastHeartbeatAt,
            jobsCompleted: worker.jobsCompleted,
          })),
        },
        contextFootprint: {
          isolation: contextFootprint.isolation,
          state: contextFootprint.broker.state,
          pid: contextFootprint.broker.pid,
          queued: contextFootprint.queued,
          running: contextFootprint.running,
          maxQueued: contextFootprint.maxQueued,
          workerHeapMb: contextFootprint.workerHeapMb,
          maxSnapshotBytes: contextFootprint.maxSnapshotBytes,
          lastStartedAt: contextFootprint.lastStartedAt,
          lastCompletedAt: contextFootprint.lastCompletedAt,
          lastError: contextFootprint.lastError,
        },
        sessionPersistence: {
          mode: 'cooperative-async-atomic',
          pendingTimers: sessionPersistence.pendingTimers,
          activeWrites: sessionPersistence.activeWrites,
          indexWriteActive: sessionPersistence.indexWriteActive,
          shuttingDown: sessionPersistence.shuttingDown,
        },
        toolObservationPersistence: {
          isolation: toolObservationPersistence.isolation,
          maxWorkers: toolObservationPersistence.maxWorkers,
          workerHeapMb: toolObservationPersistence.workerHeapMb,
          maxSnapshotBytes: toolObservationPersistence.maxSnapshotBytes,
          queued: toolObservationPersistence.queued,
          running: toolObservationPersistence.running,
          workers: toolObservationPersistence.workers.map((worker) => ({
            state: worker.state,
            pid: worker.pid,
            active: worker.state === 'busy',
            lastHeartbeatAt: worker.lastHeartbeatAt,
          })),
          lastStartedAt: toolObservationPersistence.lastStartedAt,
          lastCompletedAt: toolObservationPersistence.lastCompletedAt,
          lastError: toolObservationPersistence.lastError,
        },
        journal: {
          queued: Number(turnJournal.queued || 0),
          active: Number(turnJournal.active || 0),
          waiting: Number(turnJournal.waiting || 0),
          state: turnJournal.state || 'ready',
          recovery: turnJournal.recovery || {
            mode: 'lease-and-final-state-only',
            scheduled: false,
            running: false,
            turnRedispatch: false,
            channelRedelivery: false,
          },
        },
        retention: {
          isolation: turnRetention.isolation,
          workerHeapMb: turnRetention.workerHeapMb,
          enabled: turnRetention.enabled,
          state: turnRetention.broker.state,
          pid: turnRetention.broker.pid || turnRetention.lastWorkerPid,
          scheduled: turnRetention.scheduled,
          scheduledFor: turnRetention.scheduledFor,
          running: turnRetention.running,
          jobRetentionMs: turnRetention.jobRetentionMs,
          blobRetentionMs: turnRetention.blobRetentionMs,
          catchupDelayMs: turnRetention.catchupDelayMs,
          jobBatchLimit: turnRetention.jobBatchLimit,
          blobScanLimit: turnRetention.blobScanLimit,
          blobDeleteLimit: turnRetention.blobDeleteLimit,
          lastRunStartedAt: turnRetention.lastRunStartedAt,
          lastRunCompletedAt: turnRetention.lastRunCompletedAt,
          jobsDeleted: turnRetention.lastResult?.jobsDeleted,
          blobsDeleted: turnRetention.lastResult?.blobs.deleted,
          lastError: turnRetention.lastError,
        },
      },
    });
  });

  const root = resolvePrometheusRoot();
  const webUiPath = isPublicDistributionBuild() && hasPublicWebUiBuild()
    ? getPublicWebUiRoot()
    : path.join(root, 'web-ui');
  app.use(express.static(webUiPath, { etag: true, lastModified: true, setHeaders: setStaticCacheHeaders }));

  const pretextDistPath = path.join(root, 'node_modules', '@chenglou', 'pretext', 'dist');
  app.use('/vendor/pretext', express.static(pretextDistPath, { etag: true, lastModified: true, maxAge: '1d' }));

  const jsPdfDistPath = path.join(root, 'node_modules', 'jspdf', 'dist');
  app.use('/vendor/jspdf', express.static(jsPdfDistPath, { etag: true, lastModified: true, maxAge: '1d' }));

  // Serve shared assets (icons, images, etc.)
  const assetsPath = path.join(root, 'assets');
  app.use('/assets', express.static(assetsPath));

  return app;
}
