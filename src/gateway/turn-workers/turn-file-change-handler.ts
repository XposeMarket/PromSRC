import { TurnJobBlobStore } from '../turn-jobs/blob-store.js';
import type { TurnWorkerRunContext } from './child-runtime.js';
import {
  TURN_FILE_CHANGE_SCAN_VERSION,
  type StoredTurnFileChangeScanRequest,
  type StoredTurnFileChangeScanResult,
  type TurnFileChangeScanInputEnvelope,
  type TurnFileChangeScanResultReference,
} from './turn-file-change-contract.js';
import { collectTurnFileChangesDirect } from './turn-file-change-collector.js';

function normalizeInput(value: unknown): TurnFileChangeScanInputEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('File-change worker input must be an object.');
  }
  const input = value as Record<string, unknown>;
  const blobRoot = String(input.blobRoot || '').trim();
  const requestRef = String(input.requestRef || '').trim();
  if (!blobRoot || !requestRef) throw new Error('File-change worker input is missing blobRoot or requestRef.');
  return { blobRoot, requestRef };
}

function normalizeRequest(value: unknown): StoredTurnFileChangeScanRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored file-change request must be an object.');
  }
  const request = value as Partial<StoredTurnFileChangeScanRequest>;
  if (request.version !== TURN_FILE_CHANGE_SCAN_VERSION) {
    throw new Error(`Unsupported file-change request version: ${String(request.version)}`);
  }
  if (!String(request.workspacePath || '').trim()) {
    throw new Error('Stored file-change request is missing workspacePath.');
  }
  if (!Array.isArray(request.toolResults)) {
    throw new Error('Stored file-change request has invalid toolResults.');
  }
  return request as StoredTurnFileChangeScanRequest;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason;
  throw reason instanceof Error ? reason : new Error(String(reason || 'File-change scan cancelled.'));
}

export async function runTurnFileChangeScanWorkerJob(
  context: TurnWorkerRunContext<TurnFileChangeScanInputEnvelope>,
): Promise<TurnFileChangeScanResultReference> {
  const input = normalizeInput(context.input);
  const blobs = new TurnJobBlobStore(input.blobRoot);
  const request = normalizeRequest(blobs.getJson(input.requestRef));
  const startedAt = Date.now();

  await context.checkpoint({
    kind: 'turn_file_change_scan_start',
    requestRef: input.requestRef,
    startedAt,
  });
  throwIfAborted(context.signal);
  const changes = await collectTurnFileChangesDirect(request.toolResults, request.workspacePath);
  throwIfAborted(context.signal);

  const stored: StoredTurnFileChangeScanResult = {
    version: TURN_FILE_CHANGE_SCAN_VERSION,
    changes: changes || null,
  };
  // The direct collector intentionally uses optional `undefined` fields. Blob
  // JSON is strict, so normalize only at the child persistence boundary.
  const storedJson = JSON.parse(JSON.stringify(stored)) as import('../turn-jobs/types.js').JsonValue;
  const descriptor = await blobs.putJsonAsync(storedJson);
  const completedAt = Date.now();
  await context.checkpoint({
    kind: 'turn_file_change_scan_end',
    requestRef: input.requestRef,
    resultRef: descriptor.ref,
    fileCount: changes?.summary.fileCount || 0,
    completedAt,
    elapsedMs: completedAt - startedAt,
  });
  return {
    version: TURN_FILE_CHANGE_SCAN_VERSION,
    resultRef: descriptor.ref,
    resultBytes: descriptor.sizeBytes,
    fileCount: changes?.summary.fileCount || 0,
  };
}
