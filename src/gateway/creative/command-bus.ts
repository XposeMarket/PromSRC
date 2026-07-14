import crypto from 'crypto';

export type CreativeCommandResult = {
  commandId: string;
  sessionId?: string;
  success: boolean;
  error?: string;
  data?: any;
  sceneSummary?: any;
  selectedElement?: any;
  snapshot?: any;
  snapshots?: any[];
  code?: 'CREATIVE_EDITOR_UNAVAILABLE' | 'CREATIVE_EDITOR_TIMEOUT';
  readiness?: 'unavailable' | 'unresponsive';
};

type PendingCreativeCommand = {
  resolve: (result: CreativeCommandResult) => void;
  timer: NodeJS.Timeout;
  createdAt: number;
  retryTimer?: NodeJS.Timeout;
  acknowledgedAt?: number;
};

const pendingCreativeCommands = new Map<string, PendingCreativeCommand>();
let creativeBridgeReadyAt = 0;
let creativeBridgeDetails: { bridgeId?: string; sessionId?: string; mode?: string; surface?: string } = {};
const CREATIVE_BRIDGE_READY_TTL_MS = 45_000;
const DEFAULT_CREATIVE_COMMAND_TIMEOUT_MS = 8000;
const MAX_CREATIVE_COMMAND_TIMEOUT_MS = 720000;

function createCommandId(): string {
  if (typeof crypto.randomUUID === 'function') return `creative_${crypto.randomUUID()}`;
  return `creative_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function sendCreativeCommand(
  broadcastWS: (payload: any) => void,
  options: {
    sessionId: string;
    mode: string;
    command: string;
    payload?: any;
    timeoutMs?: number;
  },
): Promise<CreativeCommandResult> {
  const sessionId = String(options.sessionId || '').trim();
  const command = String(options.command || '').trim();
  const mode = String(options.mode || '').trim().toLowerCase();
  if (!sessionId) {
    return { commandId: '', sessionId, success: false, error: 'creative command requires sessionId' };
  }
  if (!command) {
    return { commandId: '', sessionId, success: false, error: 'creative command requires command' };
  }

  const commandId = createCommandId();
  const timeoutMs = normalizeCreativeCommandTimeoutMs(options.timeoutMs);
  const bridgeAgeMs = creativeBridgeReadyAt ? Date.now() - creativeBridgeReadyAt : Number.POSITIVE_INFINITY;
  if (bridgeAgeMs > CREATIVE_BRIDGE_READY_TTL_MS) {
    return {
      commandId,
      sessionId,
      success: false,
      code: 'CREATIVE_EDITOR_UNAVAILABLE',
      readiness: 'unavailable',
      error: 'CREATIVE_EDITOR_UNAVAILABLE: No live UI client has registered the Creative editor command handler. Open or reload the Prometheus Chat/Creative page, then retry. A generic WebSocket connection is not sufficient. CLI HyperFrames tools remain available without the editor bridge.',
      data: { bridge: { ready: false, lastReadyAt: creativeBridgeReadyAt || null, ...creativeBridgeDetails } },
    };
  }

  const resultPromise = new Promise<CreativeCommandResult>((resolve) => {
    const timer = setTimeout(() => {
      const pending = pendingCreativeCommands.get(commandId);
      if (pending?.retryTimer) clearInterval(pending.retryTimer);
      pendingCreativeCommands.delete(commandId);
      resolve({
        commandId,
        sessionId,
        success: false,
        code: 'CREATIVE_EDITOR_TIMEOUT',
        readiness: 'unresponsive',
        error: pending?.acknowledgedAt
          ? `CREATIVE_EDITOR_TIMEOUT: Creative bridge ${creativeBridgeDetails.bridgeId || '(unknown)'} received "${command}" but did not finish within ${timeoutMs}ms. The editor handler may have crashed or hung.`
          : `CREATIVE_EDITOR_DELIVERY_TIMEOUT: Creative bridge ${creativeBridgeDetails.bridgeId || '(unknown)'} registered but never acknowledged "${command}" within ${timeoutMs}ms. Reload the Prometheus Chat/Creative page and retry.`,
        data: { bridge: { ...creativeBridgeDetails, acknowledged: !!pending?.acknowledgedAt, acknowledgedAt: pending?.acknowledgedAt || null } },
      });
    }, timeoutMs);
    pendingCreativeCommands.set(commandId, { resolve, timer, createdAt: Date.now() });
  });

  const wireMessage = {
    type: 'creative_command',
    commandId,
    sessionId,
    creativeMode: mode,
    command,
    payload: options.payload || {},
    targetBridgeId: creativeBridgeDetails.bridgeId,
    timestamp: Date.now(),
  };
  broadcastWS(wireMessage);
  const pending = pendingCreativeCommands.get(commandId);
  if (pending) {
    pending.retryTimer = setInterval(() => {
      const current = pendingCreativeCommands.get(commandId);
      if (!current || current.acknowledgedAt) {
        if (current?.retryTimer) clearInterval(current.retryTimer);
        return;
      }
      broadcastWS({ ...wireMessage, retry: true, timestamp: Date.now() });
    }, 750);
  }

  return resultPromise;
}

export function markCreativeBridgeReady(message: any): void {
  creativeBridgeReadyAt = Date.now();
  creativeBridgeDetails = {
    bridgeId: String(message?.bridgeId || '').trim() || undefined,
    sessionId: String(message?.sessionId || '').trim() || undefined,
    mode: String(message?.creativeMode || '').trim() || undefined,
    surface: String(message?.surface || '').trim() || undefined,
  };
}

export function handleCreativeCommandAck(message: any): boolean {
  const commandId = String(message?.commandId || '').trim();
  const bridgeId = String(message?.bridgeId || '').trim();
  const pending = pendingCreativeCommands.get(commandId);
  if (!pending || (creativeBridgeDetails.bridgeId && bridgeId !== creativeBridgeDetails.bridgeId)) return false;
  pending.acknowledgedAt = Date.now();
  if (pending.retryTimer) clearInterval(pending.retryTimer);
  pending.retryTimer = undefined;
  return true;
}

export function getCreativeBridgeReadiness(): { ready: boolean; lastReadyAt: number | null; ageMs: number | null; details: typeof creativeBridgeDetails } {
  const ageMs = creativeBridgeReadyAt ? Date.now() - creativeBridgeReadyAt : null;
  return { ready: ageMs != null && ageMs <= CREATIVE_BRIDGE_READY_TTL_MS, lastReadyAt: creativeBridgeReadyAt || null, ageMs, details: { ...creativeBridgeDetails } };
}

export function normalizeCreativeCommandTimeoutMs(input: any): number {
  const requested = Number(input);
  const base = Number.isFinite(requested) && requested > 0
    ? requested
    : DEFAULT_CREATIVE_COMMAND_TIMEOUT_MS;
  return Math.max(500, Math.min(MAX_CREATIVE_COMMAND_TIMEOUT_MS, Math.floor(base)));
}

export function handleCreativeCommandResult(message: any): boolean {
  const commandId = String(message?.commandId || '').trim();
  if (!commandId) return false;
  const pending = pendingCreativeCommands.get(commandId);
  if (!pending) return false;
  pendingCreativeCommands.delete(commandId);
  clearTimeout(pending.timer);
  if (pending.retryTimer) clearInterval(pending.retryTimer);
  pending.resolve({
    commandId,
    sessionId: typeof message?.sessionId === 'string' ? message.sessionId : undefined,
    success: message?.success === true,
    error: message?.error ? String(message.error) : undefined,
    data: message?.data,
    sceneSummary: message?.sceneSummary,
    selectedElement: message?.selectedElement,
    snapshot: message?.snapshot,
    snapshots: Array.isArray(message?.snapshots) ? message.snapshots : undefined,
  });
  return true;
}

export function getPendingCreativeCommandCount(): number {
  return pendingCreativeCommands.size;
}
