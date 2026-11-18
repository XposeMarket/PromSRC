/**
 * Newline-delimited JSON-RPC 2.0 over a child process's stdio.
 *
 * Shared by the Codex app-server adapter (stage 3) and the ACP client (stage 5).
 * Line framing follows the Codex voice bridge (realtime/codex-app-server-bridge.ts),
 * which stays unchanged. User text and paths only ever travel as JSON params;
 * nothing is interpolated into a command line and no shell is used.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export type JsonRpcId = number | string;

export interface JsonRpcServerRequest {
  id: JsonRpcId;
  method: string;
  params: any;
}

export interface JsonRpcStdioOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  label?: string;
  onNotification?: (method: string, params: any) => void;
  /** Server-to-client requests. Must eventually call respond/respondError. */
  onServerRequest?: (request: JsonRpcServerRequest) => void;
  onExit?: (info: { code: number | null; signal: NodeJS.Signals | null; error?: Error; stderrTail: string }) => void;
  /** Captured for tests: every message this client wrote. */
  onOutgoing?: (message: any) => void;
}

interface Pending {
  method: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class JsonRpcError extends Error {
  code?: number;
  data?: unknown;
  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export class JsonRpcStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<JsonRpcId, Pending>();
  private stderrTail = '';
  private exited = false;
  private exitInfo: { code: number | null; signal: NodeJS.Signals | null; error?: Error } | null = null;

  constructor(private readonly options: JsonRpcStdioOptions) {}

  get alive(): boolean {
    return !!this.child && !this.exited;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  lastStderrLine(): string {
    const lines = this.stderrTail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return (lines[lines.length - 1] || '').slice(0, 300);
  }

  async start(timeoutMs = 10_000): Promise<void> {
    if (this.child) return;
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd || process.cwd(),
      env: this.options.env || process.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4000);
    });
    child.stdin.on('error', () => { /* broken pipe on exit: reported through exit */ });
    child.on('exit', (code, signal) => this.handleExit(code, signal));
    child.on('error', (error) => this.handleExit(null, null, error));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.options.label || 'agent'} did not start in time.`)), timeoutMs);
      child.once('spawn', () => { clearTimeout(timer); resolve(); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null, error?: Error): void {
    if (this.exited) return;
    this.exited = true;
    this.exitInfo = { code, signal, error };
    const reason = error?.message
      || this.lastStderrLine()
      || `${this.options.label || 'agent'} exited (${signal || code || 'unknown'}).`;
    for (const [, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new JsonRpcError(reason.slice(0, 300), -32000));
    }
    this.pending.clear();
    try { this.options.onExit?.({ code, signal, error, stderrTail: this.stderrTail }); } catch { /* listener errors are not fatal */ }
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: any;
      try { message = JSON.parse(line); } catch { continue; }
      this.dispatch(message);
    }
  }

  private dispatch(message: any): void {
    if (!message || typeof message !== 'object') return;
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id') && message.id !== null;
    if (hasId && typeof message.method === 'string') {
      this.options.onServerRequest?.({ id: message.id, method: message.method, params: message.params });
      return;
    }
    if (hasId) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (entry.timer) clearTimeout(entry.timer);
      if (message.error) {
        entry.reject(new JsonRpcError(String(message.error.message || `${entry.method} failed`), message.error.code, message.error.data));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === 'string') {
      this.options.onNotification?.(message.method, message.params);
    }
  }

  private write(message: any): void {
    if (!this.child || this.exited) throw new JsonRpcError(`${this.options.label || 'agent'} is not running.`, -32000);
    this.options.onOutgoing?.(message);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request<T = any>(method: string, params: any, timeoutMs = 0): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = { method, resolve, reject };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new JsonRpcError(`${method} timed out.`, -32001));
        }, timeoutMs);
      }
      this.pending.set(id, entry);
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (error: any) {
        this.pending.delete(id);
        if (entry.timer) clearTimeout(entry.timer);
        reject(error);
      }
    });
  }

  notify(method: string, params?: any): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: JsonRpcId, result: any): void {
    try { this.write({ jsonrpc: '2.0', id, result }); } catch { /* process gone: nothing to answer */ }
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    try { this.write({ jsonrpc: '2.0', id, error: { code, message } }); } catch { /* process gone */ }
  }

  /**
   * Kill the child and wait for it to exit (bounded). Resolves true only once the exit was observed.
   * `tree` also ends the commands the child started (Windows: taskkill /T; a plain kill leaves them running).
   */
  async stop(timeoutMs = 3000, opts: { tree?: boolean } = {}): Promise<boolean> {
    const child = this.child;
    if (!child || this.exited) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let last: NodeJS.Timeout | undefined;
      const done = (gone: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (last) clearTimeout(last);
        resolve(gone);
      };
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        // The forced kill needs a moment to land; only an observed exit counts as stopped.
        last = setTimeout(() => done(this.exited), 2000);
      }, timeoutMs);
      child.once('exit', () => done(true));
      try { child.stdin.end(); } catch { /* ignore */ }
      const plainKill = () => { try { child.kill(); } catch { /* ignore */ } };
      if (opts.tree && process.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', plainKill);
        } catch { plainKill(); }
      } else {
        plainKill();
      }
    });
  }

  get exit(): { code: number | null; signal: NodeJS.Signals | null; error?: Error } | null {
    return this.exitInfo;
  }
}
