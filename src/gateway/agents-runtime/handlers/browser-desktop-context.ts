/** Locals executeToolRaw passes to the extracted browser/desktop handlers. */
export interface BrowserDesktopHandlerContext {
  name: string;
  args: any;
  workspacePath: string;
  deps: any;
  sessionId: string;
  broadcastBrowserStatus: (toolName: string, options?: { includeFrame?: boolean }) => Promise<any>;
  maybeBroadcastBrowserStatus: (...args: any[]) => any;
}
