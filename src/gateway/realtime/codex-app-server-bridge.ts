import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';

type JsonRpcId = string | number;

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
  runtimeVersion?: string;
  voices?: any;
  realtimeVersion?: string;
  voiceVersion?: string;
  activeVoices?: string[];
  defaultVoice?: string;
  error?: string;
};

export type CodexRealtimeBridgeSession = {
  sessionId: string;
  threadId: string;
  sdp: string;
  realtimeSessionId?: string;
  voice?: string;
  realtimeVersion?: string;
  voiceVersion?: string;
};

export type CodexRealtimeBridgeEvent = {
  id: number;
  method: string;
  params: any;
};

type RealtimeEventWaiter = {
  afterId: number;
  resolve: (events: CodexRealtimeBridgeEvent[]) => void;
  timer: NodeJS.Timeout;
};

type BridgeSessionState = {
  threadId: string;
  ownerSessionId: string;
  events: CodexRealtimeBridgeEvent[];
  eventWaiters: Set<RealtimeEventWaiter>;
};

type PendingDynamicToolRequest = {
  requestId: JsonRpcId;
  threadId: string;
  callId: string;
  timer: NodeJS.Timeout;
};

const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.PROMETHEUS_CODEX_RPC_TIMEOUT_MS || 20_000) || 20_000);
const REALTIME_START_TIMEOUT_MS = Math.max(10_000, Number(process.env.PROMETHEUS_CODEX_REALTIME_START_TIMEOUT_MS || 45_000) || 45_000);
const STATUS_CACHE_TTL_MS = Math.max(2_000, Number(process.env.PROMETHEUS_CODEX_STATUS_CACHE_TTL_MS || 15_000) || 15_000);
const REALTIME_CONVERSATION_VERSION = 'v3';
const REALTIME_VOICE_CATALOG_VERSION = 'v1';
const MIN_CODEX_LIVE_VERSION = [0, 146, 0] as const;

function detectCodexRuntimeVersion(executable: string): string {
  const useShell = process.platform === 'win32' && /\.cmd$/i.test(executable);
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
    shell: useShell,
  });
  return String(result.stdout || result.stderr || '').match(/\b(\d+\.\d+\.\d+(?:-[^\s]+)?)\b/)?.[1] || '';
}

function supportsCodexLiveV3(version: string): boolean {
  const parts = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!parts) return true;
  const actual = parts.slice(1).map(Number);
  for (let index = 0; index < MIN_CODEX_LIVE_VERSION.length; index += 1) {
    if (actual[index] !== MIN_CODEX_LIVE_VERSION[index]) {
      return actual[index] > MIN_CODEX_LIVE_VERSION[index];
    }
  }
  return true;
}

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

  if (process.platform === 'darwin') {
    // macOS app bundles do not add their embedded executables to PATH. A
    // gateway launched independently from ChatGPT/Codex therefore cannot
    // resolve plain `codex`, even though the desktop app is installed and
    // authenticated. Search the standard per-user and system app locations so
    // Realtime voice can reuse that OAuth session automatically on launch.
    const applicationRoots = [
      path.join(os.homedir(), 'Applications'),
      '/Applications',
    ];
    for (const applicationRoot of applicationRoots) {
      candidates.push(path.join(applicationRoot, 'ChatGPT.app', 'Contents', 'Resources', 'codex'));
      candidates.push(path.join(applicationRoot, 'Codex.app', 'Contents', 'Resources', 'codex'));
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
  private runtimeVersion = '';
  private nextId = 1;
  private stdoutBuffer = '';
  private pending = new Map<JsonRpcId, PendingRequest>();
  private notificationWaiters = new Set<NotificationWaiter>();
  private starting: Promise<void> | null = null;
  private sessions = new Map<string, BridgeSessionState>();
  // Realtime starts emitting notifications while the SDP exchange is still in
  // flight. Keep the small pre-session tail by thread ID, then adopt it once a
  // browser-facing session ID has been created.
  private pendingRealtimeEvents = new Map<string, CodexRealtimeBridgeEvent[]>();
  private pendingDynamicToolRequests = new Map<string, PendingDynamicToolRequest>();
  private nextRealtimeEventId = 1;
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
    this.runtimeVersion = detectCodexRuntimeVersion(this.executable);
    if (!supportsCodexLiveV3(this.runtimeVersion)) {
      throw new Error(
        `Codex ${this.runtimeVersion} is too old for Codex Voice/Live v3. `
        + 'Upgrade @openai/codex to 0.146.0 or newer; refusing to fall back to public Realtime Voice v2.',
      );
    }
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
      const id = message.id as JsonRpcId;
      const method = String(message?.method || '');
      if (method) {
        if (method === 'item/tool/call') this.captureDynamicToolRequest(id, message.params);
        return;
      }
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
    this.captureRealtimeEvent(method, message.params);
    for (const waiter of [...this.notificationWaiters]) {
      if (!waiter.methods.has(method) || !waiter.predicate(message.params)) continue;
      this.notificationWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve({ method, params: message.params });
    }
  }

  private captureDynamicToolRequest(requestId: JsonRpcId, params: any): void {
    const threadId = String(params?.threadId || '').trim();
    const callId = String(params?.callId || '').trim();
    const tool = String(params?.tool || '').trim();
    if (!threadId || !callId || !tool) {
      this.write({
        id: requestId,
        result: {
          contentItems: [{ type: 'inputText', text: 'Invalid Prometheus voice tool request.' }],
          success: false,
        },
      });
      return;
    }
    const requestKey = String(requestId);
    const prior = this.pendingDynamicToolRequests.get(requestKey);
    if (prior) clearTimeout(prior.timer);
    const timer = setTimeout(() => {
      const pending = this.pendingDynamicToolRequests.get(requestKey);
      if (!pending) return;
      this.pendingDynamicToolRequests.delete(requestKey);
      try {
        this.write({
          id: requestId,
          result: {
            contentItems: [{ type: 'inputText', text: 'Prometheus voice tool timed out before returning a result.' }],
            success: false,
          },
        });
      } catch {}
    }, Math.max(30_000, Number(process.env.PROMETHEUS_CODEX_DYNAMIC_TOOL_TIMEOUT_MS || 120_000) || 120_000));
    timer.unref?.();
    this.pendingDynamicToolRequests.set(requestKey, { requestId, threadId, callId, timer });
    this.captureRealtimeEvent('thread/realtime/tool/call', {
      ...params,
      threadId,
      callId,
      tool,
      requestId: requestKey,
    });
  }

  private captureRealtimeEvent(method: string, params: any): void {
    // v3 emits transcript notifications as well as client-managed handoff and
    // item events. Keep the bounded event tail for all of them so the browser
    // can render transcripts promptly and route action handoffs to Prometheus.
    if (!/^thread\/realtime\//.test(method)) return;
    const threadId = String(params?.threadId || '').trim();
    if (!threadId) return;
    const event: CodexRealtimeBridgeEvent = {
      id: this.nextRealtimeEventId++,
      method,
      params,
    };
    const session = [...this.sessions.values()].find((candidate) => candidate.threadId === threadId);
    const target = session?.events || this.pendingRealtimeEvents.get(threadId) || [];
    target.push(event);
    // A completed voice turn is tiny, so retaining a short bounded tail makes
    // polling resilient to a tab briefly being backgrounded without retaining
    // a conversation indefinitely in the gateway process.
    if (target.length > 256) target.splice(0, target.length - 256);
    if (!session) {
      this.pendingRealtimeEvents.set(threadId, target);
      return;
    }
    for (const waiter of [...session.eventWaiters]) {
      if (event.id <= waiter.afterId) continue;
      session.eventWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(session.events.filter((candidate) => candidate.id > waiter.afterId));
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
    for (const pending of this.pendingDynamicToolRequests.values()) clearTimeout(pending.timer);
    this.pendingDynamicToolRequests.clear();
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
        runtimeVersion: this.runtimeVersion,
        voices: voicesResult?.voices,
        realtimeVersion: REALTIME_CONVERSATION_VERSION,
        // Frameless Bidi v3 deliberately preserves the original Codex Voice
        // behavior and therefore uses the listVoices `v1` catalog.
        voiceVersion: REALTIME_VOICE_CATALOG_VERSION,
        activeVoices: Array.isArray(voicesResult?.voices?.v1) ? voicesResult.voices.v1 : [],
        defaultVoice: String(voicesResult?.voices?.defaultV1 || ''),
      };
      this.cachedStatus = { value, at: Date.now() };
      return value;
    } catch (error: any) {
      const value: CodexRealtimeBridgeStatus = {
        available: false,
        executable: this.executable || resolveCodexExecutable(),
        runtimeVersion: this.runtimeVersion || undefined,
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
    ownerSessionId?: string;
    tools?: any[];
  }): Promise<CodexRealtimeBridgeSession> {
    await this.ensureStarted();
    const bridgeStatus = await this.status();
    if (!bridgeStatus.available) {
      throw new Error(bridgeStatus.error || 'The Codex OAuth realtime bridge is unavailable.');
    }
    const activeVoices = Array.isArray(bridgeStatus.activeVoices)
      ? bridgeStatus.activeVoices.map((voice) => String(voice || '').trim()).filter(Boolean)
      : [];
    const requestedVoice = String(input.voice || '').trim();
    const resolvedVoice = activeVoices.includes(requestedVoice)
      ? requestedVoice
      : (String(bridgeStatus.defaultVoice || '').trim() || activeVoices[0] || 'cove');
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
      dynamicTools: Array.isArray(input.tools) ? input.tools : [],
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
      // Frameless Bidi v3 uses the original Codex Voice (`v1`) catalog.
      version: REALTIME_CONVERSATION_VERSION,
      outputModality: 'audio',
      voice: resolvedVoice,
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
    const events = this.pendingRealtimeEvents.get(threadId) || [];
    this.pendingRealtimeEvents.delete(threadId);
    this.sessions.set(sessionId, {
      threadId,
      ownerSessionId: String(input.ownerSessionId || '').trim(),
      events,
      eventWaiters: new Set(),
    });
    return {
      sessionId,
      threadId,
      sdp: answerSdp,
      realtimeSessionId: String(started?.params?.realtimeSessionId || '').trim() || undefined,
      voice: resolvedVoice,
      realtimeVersion: REALTIME_CONVERSATION_VERSION,
      voiceVersion: REALTIME_VOICE_CATALOG_VERSION,
    };
  }

  async submitDynamicToolOutput(input: {
    sessionId: string;
    requestId: string;
    output: string;
    success: boolean;
    previewDataUrl?: string;
  }): Promise<boolean> {
    const session = this.sessions.get(String(input.sessionId || '').trim());
    const requestKey = String(input.requestId || '').trim();
    const pending = this.pendingDynamicToolRequests.get(requestKey);
    if (!session || !pending || pending.threadId !== session.threadId) return false;
    this.pendingDynamicToolRequests.delete(requestKey);
    clearTimeout(pending.timer);
    const contentItems: any[] = [{
      type: 'inputText',
      text: String(input.output || ''),
    }];
    const previewDataUrl = String(input.previewDataUrl || '').trim();
    if (/^data:image\//i.test(previewDataUrl)) {
      contentItems.push({ type: 'inputImage', imageUrl: previewDataUrl });
    }
    await this.ensureStarted();
    this.write({
      id: pending.requestId,
      result: {
        contentItems,
        success: input.success !== false,
      },
    });
    return true;
  }

  /**
   * Inject server-originated, speakable status text into the *existing* AVAS
   * realtime thread.  AVAS v3 intentionally does not accept the public
   * Realtime `conversation.item.create` / `response.create` protocol on the
   * browser data channel, so this is the supported route for a completed
   * Prometheus thread to speak back through the voice session that created it.
   */
  async appendRealtimeSpeech(sessionId: string, text: string): Promise<boolean> {
    const session = this.sessions.get(String(sessionId || '').trim());
    const speakable = String(text || '').replace(/\s+/g, ' ').trim();
    if (!session || !speakable) return false;
    await this.ensureStarted();
    await this.request('thread/realtime/appendSpeech', {
      threadId: session.threadId,
      text: speakable.slice(0, 8_000),
    });
    return true;
  }

  /**
   * Route a server-side event back into the active Voice Agent that owns the
   * Prometheus chat. Appending text wakes AVAS itself; it does not launch the
   * normal chat Worker for the owner session.
   */
  async appendRealtimeTextForOwner(ownerSessionId: string, text: string): Promise<boolean> {
    const owner = String(ownerSessionId || '').trim();
    const input = String(text || '').trim();
    if (!owner || !input) return false;
    const session = [...this.sessions.values()]
      .reverse()
      .find((candidate) => candidate.ownerSessionId === owner);
    if (!session) return false;
    return this.appendRealtimeTextForSession(session, input);
  }

  /**
   * Append a user turn to one specific live AVAS bridge session.  This is the
   * server-side equivalent of a public Realtime conversation-item/create, but
   * is intentionally scoped to an app-server session because AVAS v3 does not
   * accept that public protocol over its browser data channel.
   */
  async appendRealtimeText(sessionId: string, text: string): Promise<boolean> {
    const session = this.sessions.get(String(sessionId || '').trim());
    const input = String(text || '').trim();
    if (!session || !input) return false;
    return this.appendRealtimeTextForSession(session, input);
  }

  private async appendRealtimeTextForSession(session: BridgeSessionState, input: string): Promise<boolean> {
    await this.ensureStarted();
    await this.request('thread/realtime/appendText', {
      threadId: session.threadId,
      text: input.slice(0, 16_000),
      role: 'user',
    });
    return true;
  }

  /**
   * Keep an already-running AVAS session attached to the durable Prometheus
   * mobile thread that owns it. Mobile can begin Voice/Live from a temporary
   * draft and materialize or rotate the chat id without restarting WebRTC.
   */
  rebindRealtimeSessionOwner(sessionId: string, ownerSessionId: string): boolean {
    const sessionKey = String(sessionId || '').trim();
    const owner = String(ownerSessionId || '').trim();
    if (!sessionKey || !owner) return false;
    const session = this.sessions.get(sessionKey);
    if (!session) return false;
    session.ownerSessionId = owner;
    return true;
  }

  async stopRealtimeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    for (const waiter of session.eventWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve([]);
    }
    session.eventWaiters.clear();
    for (const [requestId, pending] of this.pendingDynamicToolRequests) {
      if (pending.threadId !== session.threadId) continue;
      this.pendingDynamicToolRequests.delete(requestId);
      clearTimeout(pending.timer);
      try {
        this.write({
          id: pending.requestId,
          result: {
            contentItems: [{ type: 'inputText', text: 'Realtime voice session closed before the tool completed.' }],
            success: false,
          },
        });
      } catch {}
    }
    try {
      await this.ensureStarted();
      await this.request('thread/realtime/stop', { threadId: session.threadId });
    } catch (error: any) {
      console.warn('[codex-realtime-bridge] Could not stop realtime session:', error?.message || error);
    }
    return true;
  }

  getRealtimeEvents(sessionId: string, afterId = 0): CodexRealtimeBridgeEvent[] {
    const session = this.sessions.get(String(sessionId || '').trim());
    if (!session) return [];
    const cursor = Number.isFinite(Number(afterId)) ? Number(afterId) : 0;
    return session.events.filter((event) => event.id > cursor);
  }

  waitForRealtimeEvents(sessionId: string, afterId = 0, timeoutMs = 20_000): Promise<CodexRealtimeBridgeEvent[]> {
    const session = this.sessions.get(String(sessionId || '').trim());
    if (!session) return Promise.resolve([]);
    const cursor = Number.isFinite(Number(afterId)) ? Number(afterId) : 0;
    const available = session.events.filter((event) => event.id > cursor);
    if (available.length) return Promise.resolve(available);
    return new Promise((resolve) => {
      const waiter: RealtimeEventWaiter = {
        afterId: cursor,
        resolve,
        timer: setTimeout(() => {
          session.eventWaiters.delete(waiter);
          resolve([]);
        }, timeoutMs),
      };
      session.eventWaiters.add(waiter);
    });
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
