/** Locals executeToolRaw passes to extracted handler families. */
export interface ExecutorHandlerContext {
  name: string;
  args: any;
  workspacePath: string;
  deps: any;
  sessionId: string;
}
