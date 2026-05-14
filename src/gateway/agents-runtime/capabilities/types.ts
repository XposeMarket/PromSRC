import type { ToolResult } from '../../tool-builder';
import type { ExecuteToolDeps } from '../subagent-executor';

export interface CapabilityExecutionContext {
  name: string;
  args: any;
  workspacePath: string;
  deps: ExecuteToolDeps;
  sessionId: string;
}

export interface CapabilityExecutor {
  id: string;
  canHandle(name: string): boolean;
  execute(ctx: CapabilityExecutionContext): Promise<ToolResult>;
}

export type CapabilityDispatchResult =
  | { handled: true; result: ToolResult }
  | { handled: false };
