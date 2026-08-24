import fs from 'fs';
import path from 'path';
import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  boundedRuntimeWorkerError,
  isRuntimeWorkerProtocolMessage,
  runtimeWorkerMessageBytes,
  type RuntimeWorkerChildMessage,
  type RuntimeWorkerParentMessage,
} from '../process/runtime-worker-protocol.js';
import {
  sampleRuntimeWorkerResources,
  startRuntimeWorkerResourceHeartbeat,
} from '../process/runtime-worker-resources.js';

const workerName = String(process.env.PROMETHEUS_RUNTIME_WORKER_NAME || 'session-history-search');
const MAX_IPC_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_QUERY_CHARS = 16_000;
const MAX_MATCHED_CONTENT_CHARS = 4_000;
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,200}$/;
let activeRequestId = '';

interface SessionSearchWorkerPayload {
  sessionDir?: unknown;
  query?: unknown;
  candidateIds?: unknown;
  limit?: unknown;
  maxFiles?: unknown;
  maxBytes?: unknown;
  maxFileBytes?: unknown;
  maxDurationMs?: unknown;
}

interface SessionSearchWorkerMatch {
  id: string;
  matchedRole: 'user' | 'assistant';
  matchedContent: string;
  matchedIndex: number;
}

interface SessionSearchWorkerResult {
  matches: SessionSearchWorkerMatch[];
  scannedFiles: number;
  scannedBytes: number;
  skippedFiles: number;
  truncated: boolean;
  elapsedMs: number;
  rssBytes: number;
}

function send(message: RuntimeWorkerChildMessage): void {
  if (!process.send || !process.connected) return;
  if (runtimeWorkerMessageBytes(message) > MAX_IPC_MESSAGE_BYTES) {
    process.send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : undefined,
      code: 'IPC_RESULT_TOO_LARGE',
      message: `Session search result exceeded the bounded IPC limit (${MAX_IPC_MESSAGE_BYTES} bytes).`,
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

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function boundedPath(value: unknown): string {
  const sessionDir = String(value || '').trim();
  if (!sessionDir || !path.isAbsolute(sessionDir)) throw new Error('Session search worker requires an absolute session directory.');
  return sessionDir;
}

function boundedMatchContent(content: string, queryIndex: number, queryLength: number): { content: string; index: number } {
  if (content.length <= MAX_MATCHED_CONTENT_CHARS) return { content, index: queryIndex };
  const before = 1000;
  const start = Math.max(0, queryIndex - before);
  const end = Math.min(content.length, start + MAX_MATCHED_CONTENT_CHARS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return {
    content: `${prefix}${content.slice(start, end)}${suffix}`,
    index: queryIndex - start + prefix.length,
  };
}

function executeSearch(payload: SessionSearchWorkerPayload): SessionSearchWorkerResult {
  const startedAt = Date.now();
  const sessionDir = boundedPath(payload.sessionDir);
  const query = String(payload.query || '').trim().slice(0, MAX_QUERY_CHARS);
  const q = query.toLowerCase();
  if (!q) {
    return { matches: [], scannedFiles: 0, scannedBytes: 0, skippedFiles: 0, truncated: false, elapsedMs: 0, rssBytes: process.memoryUsage().rss };
  }

  const candidateIds = Array.isArray(payload.candidateIds)
    ? [...new Set(payload.candidateIds.map((id) => String(id || '').trim()).filter((id) => SAFE_SESSION_ID.test(id)))]
    : [];
  const limit = boundedInt(payload.limit, 50, 1, 200);
  const maxFiles = boundedInt(payload.maxFiles, 250, 1, 5000);
  const maxBytes = boundedInt(payload.maxBytes, 64 * 1024 * 1024, 1 * 1024 * 1024, 512 * 1024 * 1024);
  const maxFileBytes = boundedInt(payload.maxFileBytes, 8 * 1024 * 1024, 64 * 1024, 64 * 1024 * 1024);
  const maxDurationMs = boundedInt(payload.maxDurationMs, 8_000, 250, 60_000);
  const matches: SessionSearchWorkerMatch[] = [];
  let scannedFiles = 0;
  let scannedBytes = 0;
  let skippedFiles = 0;
  let truncated = false;

  for (const id of candidateIds) {
    if (matches.length >= limit) break;
    if (scannedFiles >= maxFiles || Date.now() - startedAt >= maxDurationMs) {
      truncated = true;
      break;
    }

    const filePath = path.join(sessionDir, `${id}.json`);
    let fileBytes = 0;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        skippedFiles++;
        continue;
      }
      fileBytes = stat.size;
    } catch {
      skippedFiles++;
      continue;
    }
    if (fileBytes > maxFileBytes) {
      skippedFiles++;
      continue;
    }
    if (scannedBytes + fileBytes > maxBytes) {
      truncated = true;
      break;
    }

    scannedFiles++;
    scannedBytes += fileBytes;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const history = Array.isArray(data?.history) ? data.history : [];
      const matchedMessage = history.find((message: any) => String(message?.content || '').toLowerCase().includes(q));
      if (!matchedMessage) continue;
      const rawContent = String(matchedMessage.content || '');
      const queryIndex = rawContent.toLowerCase().indexOf(q);
      const bounded = boundedMatchContent(rawContent, queryIndex < 0 ? 0 : queryIndex, q.length);
      matches.push({
        id,
        matchedRole: matchedMessage.role === 'assistant' ? 'assistant' : 'user',
        matchedContent: bounded.content,
        matchedIndex: bounded.index,
      });
    } catch {
      skippedFiles++;
    }
  }

  return {
    matches,
    scannedFiles,
    scannedBytes,
    skippedFiles,
    truncated,
    elapsedMs: Date.now() - startedAt,
    rssBytes: process.memoryUsage().rss,
  };
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
    if (activeRequestId) {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'WORKER_BUSY',
        message: 'Session history search worker is already running a job.',
        completedAt: Date.now(),
      });
      return;
    }
    if (message.kind !== 'session_history_search') {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'UNKNOWN_JOB_KIND',
        message: `Unsupported session search job: ${message.kind}`,
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
      const result = executeSearch((message.payload || {}) as SessionSearchWorkerPayload);
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'result',
        requestId: message.requestId,
        result,
        completedAt: Date.now(),
        resourceSample: sampleRuntimeWorkerResources(),
      });
    } catch (error: any) {
      send({
        protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'SESSION_SEARCH_FAILED',
        message: boundedRuntimeWorkerError(error),
        completedAt: Date.now(),
      });
    } finally {
      activeRequestId = '';
    }
  })().catch((error) => {
    send({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: activeRequestId || undefined,
      code: 'SESSION_SEARCH_UNHANDLED',
      message: boundedRuntimeWorkerError(error),
      completedAt: Date.now(),
    });
    activeRequestId = '';
  });
});

send({
  protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
  type: 'ready',
  workerName,
  pid: process.pid,
  resourceSample: sampleRuntimeWorkerResources(),
});

const resourceHeartbeat = startRuntimeWorkerResourceHeartbeat(send, () => activeRequestId || undefined);
process.once('disconnect', () => clearInterval(resourceHeartbeat));
