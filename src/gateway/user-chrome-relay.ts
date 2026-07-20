/** Authenticated loopback relay for the Prometheus Personal Chrome extension. */
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { getConfig } from '../config/config.js';

export type UserChromeRelayStatus = { running: boolean; connected: boolean; authenticated: boolean; extensionVersion?: string; connectedAt?: number; lastSeenAt?: number; port: number; pairingFile: string; extensionPath: string };
type Pending = { resolve: (value: any) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout };
type AuthState = { clientNonce: string; serverNonce: string; extensionVersion: string };
const PORT = 9234;
const LOOPBACKS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROTOCOL = 'prometheus-personal-chrome/v1';

function pairingFile() { return path.join(getConfig().getConfigDir(), 'user-chrome-extension-pairing.json'); }
function secret() { return crypto.randomBytes(32).toString('base64url'); }
function hmac(key: string, domain: string, ...parts: string[]) { return crypto.createHmac('sha256', key).update([PROTOCOL, domain, ...parts].join('\0')).digest('base64url'); }
function safeEqual(a: unknown, b: unknown) { const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function nonce(value: unknown) { return typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value); }
function stableJson(value: any) { return JSON.stringify(value ?? {}); }
function readPairing(): { secret: string; createdAt: number } {
  try { const value = JSON.parse(fs.readFileSync(pairingFile(), 'utf8')); if (typeof value?.secret === 'string' && value.secret.length >= 32) return value; } catch {}
  const value = { secret: secret(), createdAt: Date.now() };
  fs.mkdirSync(path.dirname(pairingFile()), { recursive: true });
  fs.writeFileSync(pairingFile(), JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  return value;
}

export function resolveUserChromeExtensionPath(options: {
  resourcesPath?: string;
  moduleDir?: string;
  exists?: (manifestPath: string) => boolean;
} = {}): string {
  const resourcesPath = String(options.resourcesPath || '').trim();
  const moduleDir = String(options.moduleDir || __dirname);
  const exists = options.exists || fs.existsSync;
  // Electron patches fs so app.asar paths may appear to exist. When a
  // resourcesPath is present we are packaged and must never consider those
  // virtual paths: Chrome can load only the real app.asar.unpacked directory.
  const candidates = resourcesPath
    ? [
      path.join(resourcesPath, 'app.asar.unpacked', 'dist', 'extensions', 'prometheus-personal-chrome'),
      path.join(resourcesPath, 'app.asar.unpacked', 'extensions', 'prometheus-personal-chrome'),
    ]
    : [
      path.resolve(moduleDir, '..', '..', 'extensions', 'prometheus-personal-chrome'),
      path.resolve(moduleDir, '..', 'extensions', 'prometheus-personal-chrome'),
    ];
  return candidates.find((candidate) => exists(path.join(candidate, 'manifest.json'))) || candidates[0];
}

export function getUserChromeExtensionPath(): string {
  return resolveUserChromeExtensionPath({ resourcesPath: String((process as any).resourcesPath || '').trim() });
}

export class UserChromeRelay {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private peer: WebSocket | null = null;
  private peerMeta: { extensionVersion?: string; connectedAt: number; lastSeenAt: number } | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly eventHandlers = new Set<(event: any) => void>();
  private readonly pairingSecret: string;
  private readonly port: number;
  private peerAuth: AuthState | null = null;

  /** Port/secret overrides are test-only; production is always the fixed 9234 loopback relay. */
  constructor(options?: { port?: number; pairingSecret?: string }) {
    this.port = Number.isInteger(options?.port) ? Number(options?.port) : PORT;
    this.pairingSecret = String(options?.pairingSecret || readPairing().secret);
  }

  ensureStarted(): void {
    if (this.server) return;
    const server = http.createServer((_req, res) => { res.statusCode = 404; res.end(); });
    const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
    const clearServer = () => { if (this.server === server) { this.server = null; this.wss = null; } };
    server.on('upgrade', (req, socket, head) => {
      const pathname = new URL(String(req.url || '/'), 'http://127.0.0.1').pathname;
      if (!LOOPBACKS.has(String(req.socket.remoteAddress || '')) || pathname !== '/prometheus-user-chrome') return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    wss.on('connection', (ws: WebSocket) => this.handleConnection(ws));
    server.on('error', (err) => { console.error('[User Chrome relay]', err.message); clearServer(); });
    server.on('close', clearServer);
    server.listen(this.port, '127.0.0.1');
    this.server = server; this.wss = wss;
  }

  private rejectPending(reason: string): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(reason)); }
    this.pending.clear();
  }
  private clearPeer(ws: WebSocket, reason: string): void {
    if (this.peer !== ws) return;
    this.peer = null; this.peerMeta = null; this.peerAuth = null; this.rejectPending(reason);
  }
  private handleConnection(ws: WebSocket): void {
    let state: 'hello' | 'proof' | 'authenticated' = 'hello';
    let auth: AuthState | null = null;
    const timer = setTimeout(() => { if (state !== 'authenticated') ws.close(4001, 'mutual authentication required'); }, 5_000);
    ws.on('message', (raw) => {
      let message: any; try { message = JSON.parse(String(raw)); } catch { ws.close(4002, 'invalid JSON'); return; }
      if (state === 'hello') {
        if (message?.kind !== 'client_hello' || !nonce(message.clientNonce)) { ws.close(4003, 'invalid client hello'); return; }
        auth = { clientNonce: message.clientNonce, serverNonce: crypto.randomBytes(32).toString('base64url'), extensionVersion: String(message.extensionVersion || '') };
        state = 'proof';
        ws.send(JSON.stringify({ kind: 'server_challenge', protocol: PROTOCOL, serverNonce: auth.serverNonce, proof: hmac(this.pairingSecret, 'server-proof', auth.clientNonce, auth.serverNonce) }));
        return;
      }
      if (state === 'proof') {
        if (!auth || message?.kind !== 'client_proof' || !safeEqual(message.proof, hmac(this.pairingSecret, 'client-proof', auth.clientNonce, auth.serverNonce))) { ws.close(4004, 'client proof failed'); return; }
        if (this.peer && this.peer !== ws) { this.rejectPending('Personal Chrome extension connection was superseded.'); this.peer.close(4005, 'superseded by reconnect'); }
        state = 'authenticated'; clearTimeout(timer); this.peer = ws; this.peerAuth = auth;
        this.peerMeta = { extensionVersion: auth.extensionVersion, connectedAt: Date.now(), lastSeenAt: Date.now() };
        ws.send(JSON.stringify({ kind: 'authenticated', proof: hmac(this.pairingSecret, 'server-final', auth.clientNonce, auth.serverNonce) }));
        return;
      }
      if (this.peer !== ws || !this.peerAuth) return;
      if (this.peerMeta) this.peerMeta.lastSeenAt = Date.now();
      const commandProof = (domain: string, id: string, value: any) => hmac(this.pairingSecret, domain, this.peerAuth!.clientNonce, this.peerAuth!.serverNonce, id, stableJson(value));
      if (message?.kind === 'event') {
        if (!safeEqual(message.mac, commandProof('event', String(message.id || ''), message.eventPayload))) { ws.close(4006, 'event MAC failed'); return; }
        for (const handler of this.eventHandlers) { try { handler(message.eventPayload); } catch {} }
      } else if (message?.kind === 'result' && typeof message.id === 'string') {
        if (!safeEqual(message.mac, commandProof('result', message.id, { ok: !!message.ok, result: message.result, error: message.error || '' }))) { ws.close(4007, 'result MAC failed'); return; }
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        message.ok ? pending.resolve(message.result) : pending.reject(new Error(String(message.error || 'Extension request failed.')));
      }
    });
    ws.on('close', () => { clearTimeout(timer); this.clearPeer(ws, 'Personal Chrome extension disconnected.'); });
    ws.on('error', () => {});
  }
  onEvent(handler: (event: any) => void) { this.eventHandlers.add(handler); return () => this.eventHandlers.delete(handler); }
  getStatus(): UserChromeRelayStatus { return { running: !!this.server?.listening, connected: !!this.peer && this.peer.readyState === WebSocket.OPEN, authenticated: !!this.peerAuth && !!this.peer && this.peer.readyState === WebSocket.OPEN, extensionVersion: this.peerMeta?.extensionVersion, connectedAt: this.peerMeta?.connectedAt, lastSeenAt: this.peerMeta?.lastSeenAt, port: this.port, pairingFile: pairingFile(), extensionPath: getUserChromeExtensionPath() }; }
  async request(method: string, params: Record<string, any> = {}, timeoutMs = 15_000): Promise<any> {
    this.ensureStarted();
    if (!this.peer || this.peer.readyState !== WebSocket.OPEN || !this.peerAuth) throw new Error(`Prometheus Personal Chrome extension is not connected. ${getUserChromeExtensionOnboarding().replace(/\n/g, ' ')}`);
    const id = crypto.randomUUID();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Personal Chrome extension timed out handling ${method}. It may have been suspended or detached; retry safely.`)); }, Math.max(500, timeoutMs));
      this.pending.set(id, { resolve, reject, timer });
      const payload = { id, method, params };
      const mac = hmac(this.pairingSecret, 'command', this.peerAuth!.clientNonce, this.peerAuth!.serverNonce, id, stableJson({ method, params }));
      try { this.peer!.send(JSON.stringify({ kind: 'command', ...payload, mac })); } catch (err: any) { clearTimeout(timer); this.pending.delete(id); reject(err instanceof Error ? err : new Error(String(err))); }
    });
  }
}
let singleton: UserChromeRelay | null = null;
export function getUserChromeRelay() { singleton ||= new UserChromeRelay(); singleton.ensureStarted(); return singleton; }
export function getUserChromeExtensionOnboarding(): string {
  const status = getUserChromeRelay().getStatus();
  return ['Personal Chrome uses the Prometheus Personal Chrome extension, not CDP port 9223.', '1. In Chrome, open chrome://extensions, enable Developer mode, then choose Load unpacked.', `2. Select this real folder (never app.asar): ${status.extensionPath}.`, `3. Open Extension options and paste the pairing code from ${status.pairingFile}.`, `4. Keep Chrome running. The extension connects only to ws://127.0.0.1:${status.port}/prometheus-user-chrome and reconnects after service-worker suspension.`, 'Grant debugger permission when Chrome asks. Incognito requires enabling "Allow in incognito" in Extension details.'].join('\n');
}
