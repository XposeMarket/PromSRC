import { AsyncLocalStorage } from 'node:async_hooks';

export interface ToolExecutionContext {
  sessionId: string;
  agentId?: string;
}

const contextStorage = new AsyncLocalStorage<ToolExecutionContext>();
let current: ToolExecutionContext = { sessionId: 'unknown' };

function normalizeContext(sessionId: string, agentId?: string): ToolExecutionContext {
  return {
    sessionId: sessionId || 'unknown',
    agentId,
  };
}

export function setSharedToolExecutionContext(sessionId: string, agentId?: string): void {
  current = normalizeContext(sessionId, agentId);
}

export function clearSharedToolExecutionContext(): void {
  current = { sessionId: 'unknown' };
}

export function getSharedToolExecutionContext(): ToolExecutionContext {
  return { ...(contextStorage.getStore() || current) };
}

/**
 * Preserve per-run tool identity across awaits. Explicit registry callers use
 * this for concurrent batches; the legacy setter remains available for older
 * serial call sites.
 */
export function runWithSharedToolExecutionContext<T>(
  context: ToolExecutionContext,
  callback: () => Promise<T> | T,
): Promise<T> {
  return contextStorage.run(
    normalizeContext(context.sessionId, context.agentId),
    async () => callback(),
  );
}
