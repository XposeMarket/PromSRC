import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';

type JsonRpcId = number;

type PendingRequest = {
  method: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type NotificationWaiter = {
  methods: Set<string>;
  predicate: (params: any) => boolean;
  resolve: (message: { method: string; params: any }) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type CodexRealtimeBridgeStatus = {
  available: boolean;
  executable?: string;
  accountType?: string;
  planType?: string;
  voices?: any;
  error?: string;
};

export type CodexRealtimeBridgeSession = {
  sessionId: string;
  threadId: string;
  sdp: string;
  realtimeSessionId?: string;
};

const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.PROMETHEUS_CODEX_RPC_TIMEOUT_MS || 20_000) || 20_000);
const REALTIME_START_TIMEOUT_MS = Math.max(10_000, Number(process.env.PROMETHEUS_CODEX_REALTIME_START_TIMEOUT_MS || 45_000) || 45_000);
const STATUS_CACHE_TTL_MS = Math.max(2_000, Number(process.env.PROMETHEUS_CODEX_STATUS_CACHE_TTL_MS || 15_000) || 15_000);

function executableCandidates(): string[] {
  const candidates: string[] = [];
  const configured = String(process.env.PROMETHEUS_CODEX_BIN || '').trim();
  if (configured) candidates.push(configured);

  const resourcesPath = String((process as any).resourcesPath || '').trim();
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'codex.exe'));
    candidates.push(path.join(resourcesPath, 'codex'));
  }

  if (process.platform === 'win32') {
    const appData = String(process.env.APPDATA || '').trim();
    if (appData) {
      const npmRoot = path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules');
      candidates.push(path.join(npmRoot, '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'));
      candidates.push(path.join(npmRoot, '@openai', 'codex-win32-arm64', 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe'));
      candidates.push(path.join(appData, 'npm', 'codex.cmd'));
    }
  }

  candidates.push(process.platform === 'win32' ? 'codex.cmd' : 'codex');
  return [...new Set(candidates)];
}

function resolveCodexExecutable(): string {
  const candidates = executableCandidates();
  return candidates.find((candidate) => path.isAbsolute(candidate) && existsSync(candidate))
    || candidates[candidates.length - 1];
}

function rpcError(method: string, value: any): Error {
  const message = String(value?.message || value?.error?.message || value || `Codex app-server request failed: ${method}`);
  const error = new Error(message);
  (error as any).code = value?.code ?? value?.error?.code;
  (error as any).data = value?.data ?? value?.error?.data;
  return error;
}

export function normalizeRealtimeSdp(value: unknown): string {
  const sdp = String(value || '').replace(/\r\n|\r|\n/g, '\n').replace(/\s+$/g, '');
  return sdp ? `${sdp.replace(/\n/g, '\r\n')}\r\n` : '';
}

class CodexAppServerBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private executable = '';
  private nextId = 1;
  private stdoutBuffer = '';
  private pending = new Map<JsonRpcId, PendingRequest>();
  private notificationWaiters = new Set<NotificationWaiter>();
  private starting: Promise<void> | null = null;
  private sessions = new Map<string, { threadId: string }>();
  private cachedStatus: { value: CodexRealtimeBridgeStatus; at: number } | null = null;

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.startProcess().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startProcess(): Promise<void> {
    this.executable = resolveCodexExecutable();
    const useShell = process.platform === 'win32' && /\.cmd$/i.test(this.executable);
    const child = spawn(
      this.executable,
      ['app-server', '--listen', 'stdio://', '--enable', 'realtime_conversation'],
      {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
        shell: useShell,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.child = child;
    this.stdoutBuffer = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      const message = String(chunk || '').trim();
      if (message) console.warn('[codex-realtime-bridge]', message.slice(0, 2000));
    });
    child.on('error', (error) => this.handleProcessEnd(error));
    child.on('exit', (code, signal) => {
      this.handleProcessEnd(new Error(`Codex app-server exited (${signal || code || 'unknown'}).`));
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Codex app-server did not start in time.')), 5_000);
      const onSpawn = () => {
        clearTimeout(timer);
        child.off('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        clearTimeout(timer);
        child.off('spawn', onSpawn);
        reject(error);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });

    await this.request('initialize', {
      clientInfo: { name: 'prometheus-realtime-bridge', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized', {});
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        this.handleMessage(JSON.parse(line));
      } catch (error: any) {
        console.warn('[codex-realtime-bridge] Ignored malformed app-server output:', error?.message || error);
      }
    }
  }

  private handleMessage(message: any): void {
    if (message && Object.prototype.hasOwnProperty.call(message, 'id')) {
      const id = Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(rpcError(pending.method, message.error));
      else pending.resolve(message.result);
      return;
    }

    const method = String(message?.method || '');
    if (!method) return;
    for (const waiter of [...this.notificationWaiters]) {
      if (!waiter.methods.has(method) || !waiter.predicate(message.params)) continue;
      this.notificationWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve({ method, params: message.params });
    }
  }

  private handleProcessEnd(error: Error): void {
    if (!this.child) return;
    this.child = null;
    this.cachedStatus = null;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.notificationWaiters.clear();
  }

  private write(message: any): void {
    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) throw new Error('Codex app-server is not running.');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: any, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private notify(method: string, params: any): void {
    this.write({ method, params });
  }

  private waitForNotification(
    methods: string[],
    predicate: (params: any) => boolean,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<{ method: string; params: any }> {
    return new Promise((resolve, reject) => {
      const waiter: NotificationWaiter = {
        methods: new Set(methods),
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.notificationWaiters.delete(waiter);
          reject(new Error(`Timed out waiting for Codex app-server notification: ${methods.join(' or ')}`));
        }, timeoutMs),
      };
      this.notificationWaiters.add(waiter);
    });
  }

  async status(force = false): Promise<CodexRealtimeBridgeStatus> {
    if (!force && this.cachedStatus && Date.now() - this.cachedStatus.at < STATUS_CACHE_TTL_MS) {
      return this.cachedStatus.value;
    }
    try {
      await this.ensureStarted();
      const [accountResult, voicesResult] = await Promise.all([
        this.request('account/read', { refreshToken: false }),
        this.request('thread/realtime/listVoices', {}),
      ]);
      const account = accountResult?.account;
      if (account?.type !== 'chatgpt') {
        const accountType = String(account?.type || 'none');
        throw new Error(
          accountType === 'apiKey'
            ? 'Codex is currently authenticated with an API key, not ChatGPT OAuth.'
            : 'Codex is not signed in with a ChatGPT account.',
        );
      }
      const value: CodexRealtimeBridgeStatus = {
        available: true,
        executable: this.executable,
        accountType: account.type,
        planType: String(account.planType || ''),
        voices: voicesResult?.voices,
      };
      this.cachedStatus = { value, at: Date.now() };
      return value;
    } catch (error: any) {
      const value: CodexRealtimeBridgeStatus = {
        available: false,
        executable: this.executable || resolveCodexExecutable(),
        error: String(error?.message || error),
      };
      this.cachedStatus = { value, at: Date.now() };
      return value;
    }
  }

  async startRealtimeSession(input: {
    sdp: string;
    prompt: string;
    voice: string;
    cwd: string;
  }): Promise<CodexRealtimeBridgeSession> {
    await this.ensureStarted();
    const account = await this.request('account/read', { refreshToken: true });
    if (account?.account?.type !== 'chatgpt') {
      throw new Error('The Codex OAuth bridge requires Codex to be signed in with ChatGPT.');
    }

    const threadStart = await this.request('thread/start', {
      cwd: path.resolve(input.cwd),
      ephemeral: true,
      threadSource: 'user',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      baseInstructions: input.prompt,
      config: {
        features: {
          realtime_conversation: true,
        },
      },
    });
    const threadId = String(threadStart?.thread?.id || '').trim();
    if (!threadId) throw new Error('Codex app-server did not return a realtime thread ID.');

    const outcomePromise = this.waitForNotification(
      ['thread/realtime/sdp', 'thread/realtime/error'],
      (params) => String(params?.threadId || '') === threadId,
      REALTIME_START_TIMEOUT_MS,
    );
    const startedPromise = this.waitForNotification(
      ['thread/realtime/started'],
      (params) => String(params?.threadId || '') === threadId,
      REALTIME_START_TIMEOUT_MS,
    ).catch(() => null);

    await this.request('thread/realtime/start', {
      threadId,
      outputModality: 'audio',
      voice: input.voice,
      prompt: input.prompt,
      transport: { type: 'webrtc', sdp: input.sdp },
    }, REALTIME_START_TIMEOUT_MS);

    const outcome = await outcomePromise;
    if (outcome.method === 'thread/realtime/error') {
      throw new Error(String(outcome.params?.message || 'Codex realtime session failed.'));
    }
    const answerSdp = normalizeRealtimeSdp(outcome.params?.sdp);
    if (!answerSdp.startsWith('v=')) throw new Error('Codex realtime did not return a valid SDP answer.');

    const started = await Promise.race([
      startedPromise,
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 500);
        timer.unref?.();
      }),
    ]);
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { threadId });
    return {
      sessionId,
      threadId,
      sdp: answerSdp,
      realtimeSessionId: String(started?.params?.realtimeSessionId || '').trim() || undefined,
    };
  }

  async stopRealtimeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    try {
      await this.ensureStarted();
      await this.request('thread/realtime/stop', { threadId: session.threadId });
    } catch (error: any) {
      console.warn('[codex-realtime-bridge] Could not stop realtime session:', error?.message || error);
    }
    return true;
  }

  shutdown(): void {
    const child = this.child;
    this.child = null;
    this.cachedStatus = null;
    if (!child) return;
    try { child.stdin.end(); } catch {}
    try { child.kill(); } catch {}
  }
}

const bridge = new CodexAppServerBridge();

export function getCodexRealtimeBridge(): CodexAppServerBridge {
  return bridge;
}

export function shutdownCodexRealtimeBridge(): void {
  bridge.shutdown();
}
