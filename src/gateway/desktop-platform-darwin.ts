// ─── DarwinBackend: macOS desktop automation via the Swift helper ─────────────
//
// Implements DesktopBackend by driving a persistent `prometheus-desktop-helper`
// process (Swift, native/desktop-helper-macos) over newline-delimited JSON-RPC
// on stdin/stdout. One process == one TCC permission identity (Screen Recording
// + Accessibility). See desktop-backend.ts for the wire contract.

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  DesktopUnsupportedError,
  type DesktopBackend,
  type DesktopContext,
  type DesktopCaptureRequest,
  type DesktopCaptureResult,
  type DesktopMouseButton,
  type DesktopModifier,
  type DesktopCanonicalKey,
  type DesktopWindowAction,
  type DesktopPermissionStatus,
  type DesktopAppLaunchRequest,
  type HelperResponse,
} from './desktop-backend.js';
import type { DesktopMonitorInfo } from './desktop-tools.js';

function resolveHelperPath(): string {
  const override = String(process.env.PROMETHEUS_DESKTOP_HELPER_PATH || '').trim();
  if (override) return override;
  const rel = 'native/desktop-helper-macos/.build';
  const resourcesPath = String((process as any).resourcesPath || '').trim();
  const candidates = [
    ...(resourcesPath ? [path.resolve(resourcesPath, 'prometheus-desktop-helper')] : []),
    path.resolve(process.cwd(), 'prometheus-desktop-helper'),
    path.resolve(process.cwd(), 'bin/prometheus-desktop-helper'),
    path.resolve(__dirname, `../../${rel}/prometheus-desktop-helper`),
    path.resolve(process.cwd(), `${rel}/prometheus-desktop-helper`),
    path.resolve(__dirname, `../../${rel}/release/prometheus-desktop-helper`),
    path.resolve(__dirname, `../../${rel}/debug/prometheus-desktop-helper`),
    path.resolve(process.cwd(), `${rel}/release/prometheus-desktop-helper`),
    path.resolve(process.cwd(), `${rel}/debug/prometheus-desktop-helper`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class DarwinBackend implements DesktopBackend {
  readonly platform = 'darwin' as const;

  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private stdoutBuf = '';
  private helperPath = resolveHelperPath();

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.proc && !this.proc.killed) return this.proc;
    if (!fs.existsSync(this.helperPath)) {
      throw new DesktopUnsupportedError(
        'darwin',
        'desktop automation',
        `Helper binary not found at ${this.helperPath}. Build it with ` +
          `\`cd native/desktop-helper-macos && swift build -c release\` or set ` +
          `PROMETHEUS_DESKTOP_HELPER_PATH.`,
      );
    }
    const proc = spawn(this.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    proc.on('exit', () => this.onExit());
    proc.on('error', (err) => this.onExit(err));
    this.proc = proc;
    return proc;
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf('\n')) >= 0) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let msg: HelperResponse;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const p = this.pending.get(Number(msg.id));
      if (!p) continue;
      this.pending.delete(Number(msg.id));
      if (msg.error) {
        if (msg.error.code === 1) {
          p.reject(new DesktopUnsupportedError('darwin', msg.error.message));
        } else {
          const remedy = msg.error.data?.remedy ? ` ${msg.error.data.remedy}` : '';
          p.reject(new Error(`${msg.error.message}${remedy}`));
        }
      } else {
        p.resolve(msg.result);
      }
    }
  }

  private onExit(err?: Error): void {
    const reason = err ? err.message : 'helper process exited';
    for (const [, p] of this.pending) p.reject(new Error(reason));
    this.pending.clear();
    this.proc = null;
    this.stdoutBuf = '';
  }

  private call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const proc = this.ensureProcess();
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n';
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`desktop helper timeout for ${method}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      proc.stdin.write(payload, (e) => {
        if (e && this.pending.delete(id)) { clearTimeout(timer); reject(e); }
      });
    });
  }

  async gatherContext(): Promise<DesktopContext> {
    return this.call<DesktopContext>('gatherContext');
  }
  async enumerateMonitors(): Promise<DesktopMonitorInfo[]> {
    return this.call<DesktopMonitorInfo[]>('enumerateMonitors');
  }
  async capture(req: DesktopCaptureRequest, signal?: AbortSignal): Promise<DesktopCaptureResult> {
    if (signal?.aborted) throw new DOMException('Desktop capture interrupted.', 'AbortError');
    const r = await this.call<{ pngBase64?: string; pngPath?: string; bounds: DesktopCaptureResult['bounds']; devicePixelRatio: number }>(
      'capture',
      req as unknown as Record<string, unknown>,
    );
    let png: Buffer;
    if (r.pngBase64) {
      png = Buffer.from(r.pngBase64, 'base64');
    } else if (r.pngPath) {
      png = await fs.promises.readFile(r.pngPath);
      fs.promises.unlink(r.pngPath).catch(() => {});
    } else {
      throw new Error('capture returned no image payload');
    }
    return { png, bounds: r.bounds, devicePixelRatio: r.devicePixelRatio };
  }

  async movePointer(x: number, y: number): Promise<void> {
    await this.call('movePointer', { x, y });
  }
  async click(button: DesktopMouseButton, repeat: number, modifiers: DesktopModifier[]): Promise<void> {
    await this.call('click', { button, repeat, modifiers });
  }
  async scroll(deltaX: number, deltaY: number): Promise<void> {
    await this.call('scroll', { deltaX, deltaY });
  }
  async drag(fromX: number, fromY: number, toX: number, toY: number, steps: number): Promise<void> {
    await this.call('drag', { fromX, fromY, toX, toY, steps });
  }

  /** Hermes-style host co-work click. This does not move the real cursor or
   * raise/focus the target app because the helper posts directly to the pid. */
  async clickTargeted(pid: number, x: number, y: number, button: DesktopMouseButton, repeat: number, modifiers: DesktopModifier[]): Promise<void> {
    if (!Number.isFinite(pid) || pid <= 0) throw new Error('clickTargeted requires a positive pid.');
    await this.call('click', { pid, x, y, button, repeat, modifiers });
  }

  async scrollTargeted(pid: number, deltaX: number, deltaY: number): Promise<void> {
    if (!Number.isFinite(pid) || pid <= 0) throw new Error('scrollTargeted requires a positive pid.');
    await this.call('scroll', { pid, deltaX, deltaY });
  }

  async dragTargeted(pid: number, fromX: number, fromY: number, toX: number, toY: number, steps: number): Promise<void> {
    if (!Number.isFinite(pid) || pid <= 0) throw new Error('dragTargeted requires a positive pid.');
    await this.call('drag', { pid, fromX, fromY, toX, toY, steps });
  }

  async typeText(text: string): Promise<void> {
    await this.call('typeText', { text });
  }
  async pressKey(key: DesktopCanonicalKey): Promise<void> {
    await this.call('pressKey', { key: key.key, modifiers: key.modifiers });
  }

  async typeTextTargeted(pid: number, text: string): Promise<void> {
    if (!Number.isFinite(pid) || pid <= 0) throw new Error('typeTextTargeted requires a positive pid.');
    await this.call('typeText', { pid, text });
  }

  async pressKeyTargeted(pid: number, key: DesktopCanonicalKey): Promise<void> {
    if (!Number.isFinite(pid) || pid <= 0) throw new Error('pressKeyTargeted requires a positive pid.');
    await this.call('pressKey', { pid, key: key.key, modifiers: key.modifiers });
  }

  async getClipboard(): Promise<string> {
    const r = await this.call<{ text: string }>('getClipboard');
    return r.text ?? '';
  }
  async setClipboard(text: string): Promise<void> {
    await this.call('setClipboard', { text });
  }

  async focusWindow(handle: number): Promise<boolean> {
    const r = await this.call<{ ok: boolean }>('focusWindow', { handle });
    return r.ok === true;
  }
  async windowControl(handle: number, action: DesktopWindowAction): Promise<void> {
    await this.call('windowControl', { handle, action });
  }
  async launchApp(request: DesktopAppLaunchRequest): Promise<void> {
    await this.call('launchApp', {
      name: request.name ?? '',
      path: request.path ?? '',
      bundleId: request.bundleId ?? '',
    });
  }

  async getAccessibilityTree(opts: { windowName?: string; depth: number; maxNodes: number }): Promise<string> {
    const r = await this.call<{ tree: string }>('getAccessibilityTree', {
      windowName: opts.windowName ?? '',
      depth: opts.depth,
      maxNodes: opts.maxNodes,
    });
    return r.tree ?? '';
  }

  async checkPermissions(): Promise<DesktopPermissionStatus[]> {
    return this.call<DesktopPermissionStatus[]>('checkPermissions');
  }

  dispose(): void {
    if (this.proc && !this.proc.killed) {
      try { this.proc.stdin.end(); } catch {}
      try { this.proc.kill(); } catch {}
    }
    this.proc = null;
  }
}
