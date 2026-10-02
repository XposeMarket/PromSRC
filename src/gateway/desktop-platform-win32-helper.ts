/**
 * Persistent Windows desktop helper transport.
 *
 * The native helper owns Windows.Graphics.Capture and stays alive across calls,
 * avoiding PowerShell/Add-Type startup on the capture hot path. The protocol is
 * newline-delimited JSON-RPC 2.0, matching the macOS helper contract.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { DesktopCaptureRequest, DesktopCaptureResult, HelperResponse } from './desktop-backend.js';
import { DesktopCancellationError, throwIfDesktopCancelled } from './desktop-cancellation.js';

/** Window record returned by list_windows / window_info / foreground_window (helper protocol v3+). */
export interface Win32HelperWindowInfo {
  exists: boolean;
  handle: number;
  pid?: number;
  title?: string;
  className?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  isMinimized?: boolean;
  isActive?: boolean;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  cleanupAbort?: () => void;
}

export function resolveWin32DesktopHelperPath(): string {
  const override = String(
    process.env.PROMETHEUS_DESKTOP_WINDOWS_HELPER_PATH
      || process.env.PROMETHEUS_DESKTOP_HELPER_PATH
      || '',
  ).trim();
  if (override) return path.resolve(override);
  const candidates = [
    path.resolve(String((process as any).resourcesPath || process.cwd()), 'prometheus-desktop-helper.exe'),
    path.resolve(String((process as any).resourcesPath || process.cwd()), 'bin', 'prometheus-desktop-helper.exe'),
    path.resolve(process.cwd(), 'bin', 'prometheus-desktop-helper.exe'),
    path.resolve(__dirname, '../../bin/prometheus-desktop-helper.exe'),
    path.resolve(process.cwd(), 'native', 'desktop-helper-windows', 'build', 'Release', 'prometheus-desktop-helper.exe'),
    path.resolve(__dirname, '../../native/desktop-helper-windows/build/Release/prometheus-desktop-helper.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

export function isWin32DesktopHelperAvailable(): boolean {
  return process.platform === 'win32' && fs.existsSync(resolveWin32DesktopHelperPath());
}

export class Win32DesktopHelperClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private stdoutBuffer = '';
  private pending = new Map<number, PendingCall>();
  private readonly helperPath = resolveWin32DesktopHelperPath();

  get available(): boolean {
    return process.platform === 'win32' && fs.existsSync(this.helperPath);
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.proc && !this.proc.killed) return this.proc;
    if (!this.available) throw new Error(`Windows desktop helper not found at ${this.helperPath}`);
    const proc = spawn(this.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    proc.on('exit', () => this.onExit(new Error('Windows desktop helper exited.')));
    proc.on('error', (error) => this.onExit(error));
    // Drain stderr so a verbose native failure cannot block the helper pipe.
    proc.stderr.on('data', () => {});
    this.proc = proc;
    return proc;
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      newline = this.stdoutBuffer.indexOf('\n');
      if (!line) continue;
      let message: HelperResponse;
      try { message = JSON.parse(line); } catch { continue; }
      const id = Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.cleanupAbort?.();
      if (message.error) pending.reject(new Error(`${message.error.message}${message.error.data?.remedy ? ` ${message.error.data.remedy}` : ''}`));
      else pending.resolve(message.result);
    }
  }

  private onExit(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.cleanupAbort?.();
      pending.reject(error);
    }
    this.pending.clear();
    this.proc = null;
    this.stdoutBuffer = '';
  }

  call<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    throwIfDesktopCancelled(signal);
    const proc = this.ensureProcess();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.cleanupAbort?.();
        reject(new Error(`Windows desktop helper timed out during ${method}.`));
      }, 30_000);
      const onAbort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new DesktopCancellationError());
      };
      const cleanupAbort = signal
        ? () => signal.removeEventListener('abort', onAbort)
        : undefined;
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        timer,
        cleanupAbort,
        resolve: (value) => resolve(value as T),
        reject,
      });
      const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
      proc.stdin.write(payload, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(timer);
        cleanupAbort?.();
        reject(error);
      });
    });
  }

  async ping(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.call('ping', {}, signal);
  }

  private pingInfoPromise: Promise<Record<string, unknown> | null> | null = null;

  /** Cached ping result (null when the helper failed to answer). */
  private pingInfo(): Promise<Record<string, unknown> | null> {
    if (!this.pingInfoPromise) {
      this.pingInfoPromise = this.ping().catch(() => {
        this.pingInfoPromise = null; // allow a later retry
        return null;
      });
    }
    return this.pingInfoPromise;
  }

  /** Protocol version reported by ping (0 when unavailable / not answering). */
  async protocolVersion(): Promise<number> {
    if (!this.available) return 0;
    const info = await this.pingInfo();
    return Number(info?.protocolVersion) || 0;
  }

  /** Monitors, virtual screen, foreground window and titled top-level windows
   *  in one call (protocol v4+). Shape matches gatherDesktopContextInternal. */
  async desktopContext(includeWindows: boolean = true, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.call('desktop_context', { includeWindows: includeWindows ? 1 : 0 }, signal);
  }

  /** Clipboard text via Win32 (protocol v5+). */
  async getClipboardText(signal?: AbortSignal): Promise<{ hasText: boolean; text: string }> {
    const result = await this.call<{ hasText?: boolean; text?: string }>('get_clipboard_text', {}, signal);
    return { hasText: result?.hasText === true, text: String(result?.text || '') };
  }

  async setClipboardText(text: string, signal?: AbortSignal): Promise<void> {
    await this.call('set_clipboard_text', { textBase64: Buffer.from(String(text || ''), 'utf8').toString('base64') }, signal);
  }

  /** True when the helper supports capture(kind=primary|all|monitor|region)
   *  and window enumeration (protocolVersion >= 3). Old helpers return false. */
  async supportsScreenCapture(): Promise<boolean> {
    if (!this.available) return false;
    const info = await this.pingInfo();
    return Number(info?.protocolVersion) >= 3;
  }

  /** Visible, uncloaked, non-zero-size top-level windows (protocol v3+). */
  async listWindows(signal?: AbortSignal): Promise<Win32HelperWindowInfo[]> {
    const result = await this.call<{ windows?: Win32HelperWindowInfo[] }>('list_windows', {}, signal);
    return Array.isArray(result?.windows) ? result.windows : [];
  }

  /** Info for one HWND; `exists:false` when the handle is no longer a window (protocol v3+). */
  async windowInfo(handle: number, signal?: AbortSignal): Promise<Win32HelperWindowInfo> {
    return this.call<Win32HelperWindowInfo>('window_info', { handle: Math.floor(handle) }, signal);
  }

  /** Info for GetForegroundWindow() (protocol v3+). */
  async foregroundWindow(signal?: AbortSignal): Promise<Win32HelperWindowInfo> {
    return this.call<Win32HelperWindowInfo>('foreground_window', {}, signal);
  }

  async capture(request: DesktopCaptureRequest, signal?: AbortSignal): Promise<DesktopCaptureResult> {
    const result = await this.call<{
      pngBase64?: string;
      pngPath?: string;
      bounds: DesktopCaptureResult['bounds'];
      devicePixelRatio?: number;
    }>('capture', request as unknown as Record<string, unknown>, signal);
    let png: Buffer;
    if (result.pngBase64) png = Buffer.from(result.pngBase64, 'base64');
    else if (result.pngPath) {
      png = await fs.promises.readFile(result.pngPath);
      await fs.promises.unlink(result.pngPath).catch(() => {});
    } else throw new Error('Windows desktop helper capture returned no PNG payload.');
    return {
      png,
      bounds: result.bounds,
      devicePixelRatio: Number(result.devicePixelRatio) || 1,
    };
  }

  async focusWindow(handle: number, signal?: AbortSignal): Promise<boolean> {
    const result = await this.call<{ focused?: boolean }>('focus_window', { handle: Math.floor(handle) }, signal);
    return result?.focused === true;
  }

  async clickAt(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left', repeat: number = 1, signal?: AbortSignal): Promise<void> {
    await this.call('click', {
      x: Math.floor(x), y: Math.floor(y), button,
      repeat: Math.max(1, Math.min(4, Math.floor(repeat || 1))),
    }, signal);
  }

  async movePointer(x: number, y: number, signal?: AbortSignal): Promise<void> {
    await this.call('move_pointer', { x: Math.floor(x), y: Math.floor(y) }, signal);
  }

  async clickCurrent(button: 'left' | 'right' | 'middle' = 'left', repeat: number = 1, signal?: AbortSignal): Promise<void> {
    await this.call('click_current', {
      button, repeat: Math.max(1, Math.min(4, Math.floor(repeat || 1))),
    }, signal);
  }

  async scrollAt(x: number, y: number, deltaX: number, deltaY: number, signal?: AbortSignal): Promise<void> {
    await this.call('scroll', {
      x: Math.floor(x), y: Math.floor(y),
      deltaX: Math.floor(deltaX || 0), deltaY: Math.floor(deltaY || 0),
    }, signal);
  }

  async scrollCurrent(deltaX: number, deltaY: number, signal?: AbortSignal): Promise<void> {
    await this.call('scroll_current', {
      deltaX: Math.floor(deltaX || 0), deltaY: Math.floor(deltaY || 0),
    }, signal);
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number, steps: number = 20, signal?: AbortSignal): Promise<void> {
    await this.call('drag', {
      fromX: Math.floor(fromX), fromY: Math.floor(fromY),
      toX: Math.floor(toX), toY: Math.floor(toY),
      steps: Math.max(2, Math.min(100, Math.floor(steps || 20))),
    }, signal);
  }

  async typeText(text: string, signal?: AbortSignal): Promise<void> {
    await this.call('type_text', {
      textBase64: Buffer.from(String(text || ''), 'utf8').toString('base64'),
    }, signal);
  }

  async pressKey(
    key: string,
    modifiers: Array<'ctrl' | 'cmd' | 'shift' | 'alt'> = [],
    signal?: AbortSignal,
  ): Promise<void> {
    await this.call('press_key', {
      key: String(key || 'enter'),
      ctrl: modifiers.includes('ctrl') || modifiers.includes('cmd') ? 1 : 0,
      shift: modifiers.includes('shift') ? 1 : 0,
      alt: modifiers.includes('alt') ? 1 : 0,
    }, signal);
  }

  dispose(): void {
    if (this.proc && !this.proc.killed) {
      try { this.proc.stdin.end(); } catch { /* best effort */ }
      try { this.proc.kill(); } catch { /* best effort */ }
    }
    this.proc = null;
  }
}

let sharedClient: Win32DesktopHelperClient | null = null;

export function getWin32DesktopHelperClient(): Win32DesktopHelperClient {
  if (!sharedClient) sharedClient = new Win32DesktopHelperClient();
  return sharedClient;
}
