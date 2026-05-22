export interface ToolExecutionContext {
  sessionId: string;
  agentId?: string;
}

let current: ToolExecutionContext = { sessionId: 'unknown' };

export function setSharedToolExecutionContext(sessionId: string, agentId?: string): void {
  current = {
    sessionId: sessionId || 'unknown',
    agentId,
  };
}

export function clearSharedToolExecutionContext(): void {
  current = { sessionId: 'unknown' };
}

export function getSharedToolExecutionContext(): ToolExecutionContext {
  return { ...current };
}
