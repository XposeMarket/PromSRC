import crypto from 'crypto';
import { getWebSocketClientCount } from '../comms/broadcaster';

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
};

type PendingCreativeCommand = {
  resolve: (result: CreativeCommandResult) => void;
  timer: NodeJS.Timeout;
  createdAt: number;
};

const pendingCreativeCommands = new Map<string, PendingCreativeCommand>();
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
  if (getWebSocketClientCount() <= 0) {
    return {
      commandId,
      sessionId,
      success: false,
      error: 'No connected creative editor client is available. Open the Prometheus web UI/Electron window once, then retry the creative command.',
    };
  }

  const resultPromise = new Promise<CreativeCommandResult>((resolve) => {
    const timer = setTimeout(() => {
      pendingCreativeCommands.delete(commandId);
      resolve({
        commandId,
        sessionId,
        success: false,
        error: `Creative editor did not respond to "${command}" within ${timeoutMs}ms.`,
      });
    }, timeoutMs);
    pendingCreativeCommands.set(commandId, { resolve, timer, createdAt: Date.now() });
  });

  broadcastWS({
    type: 'creative_command',
    commandId,
    sessionId,
    creativeMode: mode,
    command,
    payload: options.payload || {},
    timestamp: Date.now(),
  });

  return resultPromise;
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
