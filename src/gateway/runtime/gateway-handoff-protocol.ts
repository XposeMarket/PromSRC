/**
 * Warm gateway handoff protocol.
 *
 * A planned restart used to interrupt every live runtime, exit, and hope the
 * replacement could resume them from checkpoints. With a warm handoff the old
 * gateway ("host") releases its listeners and schedulers, keeps running the
 * turns it already owns, and streams their runtime state, WebSocket
 * broadcasts, and control results to the replacement gateway ("client") over a
 * local socket until the last owned runtime finishes.
 *
 * Keep this module dependency-free: both processes load it before their heavier
 * runtime modules, and the CLI supervisor reads manifests without the gateway.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const GATEWAY_HANDOFF_PROTOCOL_VERSION = 1 as const;
export const GATEWAY_HANDOFF_MAX_FRAME_BYTES = 1024 * 1024;
export const GATEWAY_HANDOFF_MANIFEST_VERSION = 1 as const;
export const GATEWAY_HANDOFF_MANIFEST_DIRNAME = 'handoff-hosts';
/** IPC message a supervised gateway sends its launcher when it starts draining. */
export const GATEWAY_HANDOFF_IPC_MESSAGE_TYPE = 'gateway_handoff';

export type GatewayHandoffControlOp =
  | 'runtime_abort'
  | 'runtime_steer'
  | 'task_pause'
  | 'task_cancel';

/**
 * A bounded copy of LiveRuntimeSnapshot. The registry type is not imported so
 * this module stays free of gateway dependencies; the client re-validates.
 */
export type GatewayHandoffRuntimeSnapshot = Record<string, unknown> & {
  id: string;
  kind: string;
  label: string;
  startedAt: number;
  status?: string;
  sessionId?: string;
  taskId?: string;
  pid?: number;
};

export interface GatewayHandoffManifest {
  version: typeof GATEWAY_HANDOFF_MANIFEST_VERSION;
  hostPid: number;
  processStartedAt: number;
  socketPath: string;
  startedAt: number;
  reason: string;
  restartTimestamp?: number;
  runtimeIds: string[];
}

export type GatewayHandoffHostMessage =
  | {
    protocolVersion: typeof GATEWAY_HANDOFF_PROTOCOL_VERSION;
    type: 'hello';
    hostPid: number;
    processStartedAt: number;
    /** Authoritative set of runtimes still running in the host at connect time. */
    runtimes: GatewayHandoffRuntimeSnapshot[];
  }
  | {
    protocolVersion: typeof GATEWAY_HANDOFF_PROTOCOL_VERSION;
    type: 'runtime_upsert';
    runtime: GatewayHandoffRuntimeSnapshot;
    eventType: string;
    extra?: Record<string, unknown>;
  }
  | {
    protocolVersion: typeof GATEWAY_HANDOFF_PROTOCOL_VERSION;
    type: 'runtime_delete';
    runtimeId: string;
    eventType: string;
    runtime?: GatewayHandoffRuntimeSnapshot;
    extra?: Record<string, unknown>;
  }
  | {
    protocolVersion: typeof GATEWAY_HANDOFF_PROTOCOL_VERSION;
    type: 'broadcast';
    data: Record<string, unknown>;
  }
  | {
    protocolVersion: typeof GATEWAY_HANDOFF_PROTOCOL_VERSION;
    type: 'session_flushed';
    sessionId: string;
  }
  | {
    protocolVersion: typeof GATEWAY_HANDOFF_PROTOCOL_VERSION;
    type: 'control_result';
    requestId: string;
    ok: boolean;
    error?: string;
    result?: Record<string, unknown>;
  }
  | {
    protocolVersion: typeof GATEWAY_HANDOFF_PROTOCOL_VERSION;
    type: 'heartbeat';
    at: number;
    runningCount: number;
  }
  | {
    protocolVersion: typeof GATEWAY_HANDOFF_PROTOCOL_VERSION;
    type: 'drain_complete';
    at: number;
    /** Runtimes the host had to interrupt because the drain window expired. */
    interruptedRuntimeIds: string[];
  };

export type GatewayHandoffClientMessage =
  | {
    protocolVersion: typeof GATEWAY_HANDOFF_PROTOCOL_VERSION;
    type: 'hello_ack';
    clientPid: number;
  }
  | {
    protocolVersion: typeof GATEWAY_HANDOFF_PROTOCOL_VERSION;
    type: 'control';
    requestId: string;
    op: GatewayHandoffControlOp;
    args: Record<string, unknown>;
  }
  | {
    protocolVersion: typeof GATEWAY_HANDOFF_PROTOCOL_VERSION;
    type: 'heartbeat';
    at: number;
  };

export type GatewayHandoffMessage = GatewayHandoffHostMessage | GatewayHandoffClientMessage;

/** Sent over the launcher IPC channel (or written as a file for pollers). */
export interface GatewayHandoffLauncherNotice {
  type: typeof GATEWAY_HANDOFF_IPC_MESSAGE_TYPE;
  hostPid: number;
  socketPath: string;
  reason: string;
  runtimeCount: number;
}

export function isGatewayHandoffMessage(value: unknown): value is GatewayHandoffMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.protocolVersion === GATEWAY_HANDOFF_PROTOCOL_VERSION && typeof record.type === 'string';
}

export function isGatewayHandoffLauncherNotice(value: unknown): value is GatewayHandoffLauncherNotice {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.type === GATEWAY_HANDOFF_IPC_MESSAGE_TYPE
    && Number.isInteger(record.hostPid)
    && Number(record.hostPid) > 0
    && typeof record.socketPath === 'string';
}

export function gatewayHandoffFrameBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return Buffer.byteLength(serialized === undefined ? '' : serialized, 'utf-8') + 1;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Newline-delimited JSON. Returns null when the frame exceeds the bound. */
export function encodeGatewayHandoffFrame(message: GatewayHandoffMessage, maxBytes = GATEWAY_HANDOFF_MAX_FRAME_BYTES): string | null {
  const serialized = JSON.stringify(message);
  if (serialized === undefined) return null;
  if (Buffer.byteLength(serialized, 'utf-8') + 1 > maxBytes) return null;
  return `${serialized}\n`;
}

export interface GatewayHandoffFrameParser {
  push(chunk: Buffer | string): void;
  /** Bytes buffered for the frame currently being assembled. */
  readonly pendingBytes: number;
}

/**
 * Incremental NDJSON parser. A frame that grows past the bound is discarded
 * and reported once instead of buffering the rest of the stream forever.
 */
export function createGatewayHandoffFrameParser(
  onMessage: (message: GatewayHandoffMessage) => void,
  onError: (error: Error) => void,
  maxBytes = GATEWAY_HANDOFF_MAX_FRAME_BYTES,
): GatewayHandoffFrameParser {
  let buffer = '';
  let discarding = false;
  return {
    get pendingBytes() {
      return Buffer.byteLength(buffer, 'utf-8');
    },
    push(chunk) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (discarding) {
          discarding = false;
        } else if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            if (isGatewayHandoffMessage(parsed)) onMessage(parsed);
            else onError(new Error('Unrecognized gateway handoff frame.'));
          } catch (error: any) {
            onError(error instanceof Error ? error : new Error(String(error)));
          }
        }
        newline = buffer.indexOf('\n');
      }
      if (!discarding && Buffer.byteLength(buffer, 'utf-8') > maxBytes) {
        discarding = true;
        buffer = '';
        onError(new Error(`Gateway handoff frame exceeded ${maxBytes} bytes and was dropped.`));
      }
    },
  };
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/**
 * Windows named pipes live in a flat namespace, so the state directory is
 * hashed into the name. POSIX sockets use the temp directory because macOS
 * limits socket paths to ~104 bytes and state directories can be long.
 */
export function resolveGatewayHandoffSocketPath(stateDir: string, hostPid: number, platform = process.platform): string {
  const key = shortHash(path.resolve(stateDir));
  if (platform === 'win32') return `\\\\.\\pipe\\prometheus-handoff-${key}-${hostPid}`;
  return path.join(os.tmpdir(), `prometheus-handoff-${key}-${hostPid}.sock`);
}

export function getGatewayHandoffManifestDir(stateDir: string): string {
  return path.join(stateDir, 'runtimes', GATEWAY_HANDOFF_MANIFEST_DIRNAME);
}

export function getGatewayHandoffManifestPath(stateDir: string, hostPid: number): string {
  return path.join(getGatewayHandoffManifestDir(stateDir), `${hostPid}.json`);
}

export function writeGatewayHandoffManifest(stateDir: string, manifest: GatewayHandoffManifest): string {
  const filePath = getGatewayHandoffManifestPath(stateDir, manifest.hostPid);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
  return filePath;
}

export function removeGatewayHandoffManifest(stateDir: string, hostPid: number): void {
  try { fs.rmSync(getGatewayHandoffManifestPath(stateDir, hostPid), { force: true }); } catch {}
}

export function readGatewayHandoffManifests(stateDir: string): GatewayHandoffManifest[] {
  const dir = getGatewayHandoffManifestDir(stateDir);
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const manifests: GatewayHandoffManifest[] = [];
  for (const entry of entries) {
    if (!/^\d+\.json$/.test(entry)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf-8'));
      if (parsed?.version !== GATEWAY_HANDOFF_MANIFEST_VERSION) continue;
      const hostPid = Number(parsed.hostPid);
      if (!Number.isInteger(hostPid) || hostPid <= 0 || typeof parsed.socketPath !== 'string') continue;
      manifests.push({
        version: GATEWAY_HANDOFF_MANIFEST_VERSION,
        hostPid,
        processStartedAt: Number(parsed.processStartedAt) || 0,
        socketPath: parsed.socketPath,
        startedAt: Number(parsed.startedAt) || 0,
        reason: String(parsed.reason || ''),
        restartTimestamp: Number(parsed.restartTimestamp) || undefined,
        runtimeIds: Array.isArray(parsed.runtimeIds) ? parsed.runtimeIds.map(String) : [],
      });
    } catch {}
  }
  return manifests.sort((a, b) => a.startedAt - b.startedAt);
}

export function isGatewayHandoffPidAlive(pid: number, kill: (pid: number, signal: number) => unknown = process.kill): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return pid === process.pid;
  try {
    kill(pid, 0);
    return true;
  } catch (error: any) {
    // EPERM means the process exists but belongs to another user.
    return error?.code === 'EPERM';
  }
}
