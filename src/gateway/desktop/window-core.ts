import { DesktopMonitorInfo, DesktopWindowInfo, runPowerShell, ensureWindows } from './state.js';
import { captureScreenshotInternal, gatherDesktopContextInternal, shortWindowLabel, findWindowsByName } from './interaction-context.js';
import { normalizedWindowHandle } from './interaction-actions.js';



/**
 * desktop-tools.ts
 *
 * Windows desktop automation primitives for Prometheus.
 * Uses a persistent native Windows helper for the capture/input hot path, with
 * PowerShell + Win32 compatibility fallbacks when the helper is unavailable.
 *
 * NOTE: Current implementation targets Windows only.
 */

import fs from 'fs';

import path from 'path';

import { execFile } from 'child_process';

import { promisify } from 'util';

import crypto from 'crypto';

import Jimp from 'jimp';

import {
  getInstalledAppsInventory,
  searchInstalledApps,
  resolveInstalledAppLaunch,
  resolveInstalledAppLaunchByQuery,
} from '../installed-apps.js';

import {
  desktopBackgroundCommand,
  desktopBackgroundPrepareSandbox,
  desktopBackgroundStatus,
} from '../desktop-background.js';

import os from 'os';

import { normalizeScreenshotBuffer, readImageSize, cropImageBuffer } from '../screenshot-normalize.js';

import { isDesktopPowerShellHostEnabled, runPowerShellInHost, PowerShellHostBusyError, warmDesktopPowerShellHosts } from '../desktop-powershell-host.js';

import { pathToFileURL } from 'url';

import { parseCanonicalKey, canonicalKeyToSendKeys } from '../desktop-keys.js';

import {
  backgroundHelper,
  backgroundUnavailableHint,
  defaultDesktopDispatch,
  describeBackgroundResult,
  guardUserForeground,
  parseKeyCombo,
  resolveDesktopDispatch,
  restoreUserFocus,
  waitForUserQuiet,
  type DesktopDispatchMode,
} from '../desktop-background-dispatch.js';

import type { Win32BackgroundResult } from '../desktop-platform-win32-helper.js';

import { getPlatformDesktopBackend, hasDesktopBackend } from '../desktop-platform.js';

import type { DesktopCaptureRequest } from '../desktop-backend.js';

import {
  DESKTOP_WRAPPER_TOOL_NAME_SET,
  getDesktopWrapperToolDefinitions,
} from '../desktop-wrappers.js';

import {
  getWin32DesktopHelperClient,
  isWin32DesktopHelperAvailable,
} from '../desktop-platform-win32-helper.js';

import {
  desktopAbortableDelay,
  isDesktopCancellationError,
  throwIfDesktopCancelled,
} from '../desktop-cancellation.js';



export interface DesktopContextGathered {
  monitors: DesktopMonitorInfo[];
  virtualScreen: { left: number; top: number; width: number; height: number };
  windows: DesktopWindowInfo[];
  activeWindow: DesktopWindowInfo | null;
  /**
   * Set when the PowerShell desktop probe returned no parseable JSON (timeout,
   * host busy, or PowerShell error). The zeroed monitors/virtualScreen values
   * are placeholders, not a real "0 displays" reading.
   */
  probeFailed?: { reason: string; outputBytes: number };
}


// ─── Send screenshot to Telegram ─────────────────────────────────────────────

/** Capture each connected monitor separately and return their buffers. */
export async function captureAllMonitorBuffers(): Promise<Array<{ buf: Buffer; width: number; height: number }>> {
  // Get monitor count first
  const countRaw = await runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens.Length`,
    { timeoutMs: 8000 },
  );
  const monitorCount = parseInt(countRaw.trim(), 10) || 1;

  const results: Array<{ buf: Buffer; width: number; height: number }> = [];
  for (let i = 0; i < monitorCount; i++) {
    const captured = await captureScreenshotInternal({ kind: 'monitor', index: i });
    const raw = fs.readFileSync(captured.path);
    try { fs.unlinkSync(captured.path); } catch { /* best effort */ }
    const normalized = await normalizeScreenshotBuffer(raw, {
      maxSide: Number(process.env.PROMETHEUS_DESKTOP_SCREENSHOT_MAX_SIDE || process.env.PROMETHEUS_SCREENSHOT_MAX_SIDE || 2400),
      maxBytes: Number(process.env.PROMETHEUS_DESKTOP_SCREENSHOT_MAX_BYTES || process.env.PROMETHEUS_SCREENSHOT_MAX_BYTES || 5 * 1024 * 1024),
      preferJpeg: true,
    }).catch(() => null);
    results.push({
      buf: normalized?.buffer || raw,
      width: normalized?.width || captured.width,
      height: normalized?.height || captured.height,
    });
  }
  return results;
}


export {
  desktopBackgroundCommand,
  desktopBackgroundPrepareSandbox,
  desktopBackgroundStatus,
};


// ════════════════════════════════════════════════════════════════════════════
// Canonical desktop state model (Codex-style app / window / state abstraction)
//
// This layer gives Prometheus one coherent object model on top of the existing
// PowerShell internals: a stable window id, an app grouping, and a window-state
// snapshot that ties together screenshot, bounds, and accessibility text. New
// window-scoped input tools (desktop_window_click, etc.) resolve a window from
// this model before acting, so the LLM can target an exact window handle rather
// than juggling screenshot ids, coordinates, and title matching.
// ════════════════════════════════════════════════════════════════════════════

/** Canonical capture backend identifiers. */
export type DesktopCaptureBackend = 'graphics_capture' | 'copy_from_screen' | 'window_crop';


/**
 * Resolve the configured capture backend. A persistent native helper provides
 * occlusion-safe Windows.Graphics.Capture when built/installed; otherwise the
 * stable CopyFromScreen/window-crop path remains available. The env var lets
 * operators force a backend for diagnostics.
 */
export function resolveDesktopCaptureBackend(): { requested: DesktopCaptureBackend | 'auto'; active: DesktopCaptureBackend; reason: string } {
  const raw = String(process.env.PROMETHEUS_DESKTOP_CAPTURE_BACKEND || 'auto').trim().toLowerCase();
  const requested: DesktopCaptureBackend | 'auto' =
    raw === 'graphics_capture' || raw === 'copy_from_screen' || raw === 'window_crop' ? raw : 'auto';
  const helperAvailable = process.platform === 'win32' && isWin32DesktopHelperAvailable();
  if (requested === 'copy_from_screen' || requested === 'window_crop') {
    return {
      requested,
      active: requested,
      reason: `${requested} forced by PROMETHEUS_DESKTOP_CAPTURE_BACKEND.`,
    };
  }
  if (helperAvailable) {
    return {
      requested,
      active: 'graphics_capture',
      reason: 'Persistent Windows helper is available; using Windows.Graphics.Capture for per-window screenshots.',
    };
  }
  if (requested === 'graphics_capture') {
    return {
      requested,
      active: 'copy_from_screen',
      reason: 'graphics_capture requested but the native helper is unavailable; using CopyFromScreen fallback.',
    };
  }
  return {
    requested,
    active: 'copy_from_screen',
    reason: requested === 'auto'
      ? 'auto resolved to copy_from_screen because the native Windows.Graphics.Capture helper is unavailable.'
      : `${requested} active.`,
  };
}


export interface DesktopWindowState {
  windowId: string;
  /** Strong point-in-time identity: HWND + PID + process creation time. */
  windowToken: string;
  handle: number;
  appId: string;
  processName: string;
  pid: number;
  processStartTime?: number;
  title: string;
  bounds: { left: number; top: number; width: number; height: number };
  monitorIndex?: number;
  isActive: boolean;
}


export type DesktopFailureCode =
  | 'WINDOW_NOT_FOUND'
  | 'STALE_WINDOW'
  | 'FOCUS_FAILED'
  | 'INVALID_ARGUMENT'
  | 'STATE_STALE'
  | 'ELEMENT_NOT_FOUND'
  | 'ACTION_UNSUPPORTED'
  | 'ACCESSIBILITY_FAILED'
  | 'WINDOW_ACTION_FAILED'
  | 'CAPTURE_FAILED'
  | 'HELPER_UNAVAILABLE'
  | 'DESKTOP_CANCELLED'
  | 'BACKGROUND_TIMEOUT'
  | 'BACKGROUND_FAILED'
  | 'BACKGROUND_UNAVAILABLE';


/** Machine-readable failure envelope that preserves the legacy ERROR prefix. */
export function desktopFailure(
  code: DesktopFailureCode,
  message: string,
  details: Record<string, unknown> = {},
): string {
  return [
    `ERROR: [${code}] ${message}`,
    JSON.stringify({
      ok: false,
      code,
      message,
      retryable: ['WINDOW_NOT_FOUND', 'STALE_WINDOW', 'FOCUS_FAILED', 'STATE_STALE', 'CAPTURE_FAILED', 'HELPER_UNAVAILABLE', 'DESKTOP_CANCELLED', 'BACKGROUND_TIMEOUT'].includes(code),
      details,
    }, null, 2),
  ].join('\n');
}


export interface DesktopAppState {
  appId: string;
  displayName: string;
  processName?: string;
  executablePath?: string;
  isRunning: boolean;
  windows: DesktopWindowState[];
}


/** Compatibility id derived from HWND. Prefer windowToken for actions because
 * Windows may eventually reuse an HWND after its original window closes. */
export function windowIdForHandle(handle: number): string {
  return `win_${Math.floor(Number(handle) || 0)}`;
}


export function parseWindowId(windowId?: string | null): number | null {
  const m = String(windowId || '').trim().match(/^win_(\d+)$/);
  if (!m) return null;
  const h = Number(m[1]);
  return Number.isFinite(h) && h > 0 ? h : null;
}


export interface DesktopWindowTokenParts {
  handle: number;
  pid: number;
  processStartTime: number;
}


export function createDesktopWindowToken(window: Pick<DesktopWindowInfo, 'handle' | 'pid' | 'processStartTime'>): string {
  const handle = Math.max(0, Math.floor(Number(window.handle) || 0));
  const pid = Math.max(0, Math.floor(Number(window.pid) || 0));
  const processStartTime = Math.max(0, Math.floor(Number(window.processStartTime) || 0));
  const payload = `${handle}.${pid}.${processStartTime}`;
  const checksum = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 12);
  return `wt_${handle}_${pid}_${processStartTime.toString(36)}_${checksum}`;
}


export function parseDesktopWindowToken(token?: string | null): DesktopWindowTokenParts | null {
  const match = String(token || '').trim().match(/^wt_(\d+)_(\d+)_([0-9a-z]+)_([0-9a-f]{12})$/i);
  if (!match) return null;
  const handle = Number(match[1]);
  const pid = Number(match[2]);
  const processStartTime = Number.parseInt(match[3], 36);
  if (![handle, pid, processStartTime].every(Number.isFinite) || handle <= 0 || pid <= 0) return null;
  const expected = createDesktopWindowToken({ handle, pid, processStartTime });
  return expected.toLowerCase() === String(token).trim().toLowerCase()
    ? { handle, pid, processStartTime }
    : null;
}


export interface DesktopWindowSelector {
  /** Strong selector returned by desktop_window(action="state") / list_windows. */
  window_token?: string;
  /** Compatibility selector derived from HWND. */
  window_id?: string;
  window_handle?: number;
  app_id?: string;
  title?: string;
  active?: boolean;
}


/** Stable app id for a running process group. */
export function appIdForProcess(processName: string): string {
  return `proc:${String(processName || 'unknown').toLowerCase()}`;
}


export function appIdForWindow(window: Pick<DesktopWindowInfo, 'processName' | 'bundleId'>): string {
  const bundleId = String(window.bundleId || '').trim().toLowerCase();
  if (bundleId) return `bundle:${bundleId}`;
  return appIdForProcess(window.processName);
}


export function launchIdentityForWindow(window: Pick<DesktopWindowInfo, 'processName' | 'appDisplayName' | 'bundleId' | 'appPath'>): {
  bundleId?: string;
  path?: string;
  name?: string;
} {
  const bundleId = String(window.bundleId || '').trim();
  const appPath = String(window.appPath || '').trim();
  const appDisplayName = String(window.appDisplayName || '').trim();
  const processName = String(window.processName || '').trim();
  return {
    bundleId: bundleId || undefined,
    path: appPath || undefined,
    name: appDisplayName || processName || undefined,
  };
}


export function toDesktopWindowState(w: DesktopWindowInfo, activeHandle: number): DesktopWindowState {
  const handle = normalizedWindowHandle(w);
  return {
    windowId: windowIdForHandle(handle),
    windowToken: createDesktopWindowToken(w),
    handle,
    appId: appIdForWindow(w),
    processName: w.processName,
    pid: Number(w.pid) || 0,
    processStartTime: Number(w.processStartTime) || undefined,
    title: w.title,
    bounds: {
      left: Number(w.left) || 0,
      top: Number(w.top) || 0,
      width: Number(w.width) || 0,
      height: Number(w.height) || 0,
    },
    monitorIndex: w.monitorIndex,
    isActive: handle > 0 && handle === activeHandle,
  };
}


/** List currently open windows in the canonical model. */
export async function desktopListWindowStates(): Promise<DesktopWindowState[]> {
  ensureWindows();
  const ctx = await gatherDesktopContextInternal();
  const activeHandle = normalizedWindowHandle(ctx.activeWindow);
  return ctx.windows.map((w) => toDesktopWindowState(w, activeHandle));
}


/**
 * Resolve a canonical window target from any of the supported selectors.
 * Preference order: window_id / window_handle (exact) → app_id → title.
 */
export async function resolveCanonicalWindow(
  selector: DesktopWindowSelector,
  knownContext?: DesktopContextGathered,
): Promise<{ ok: true; window: DesktopWindowInfo; hint?: string; isActive?: boolean; context: DesktopContextGathered } | { ok: false; code: DesktopFailureCode; message: string }> {
  ensureWindows();
  const ctx = knownContext || await gatherDesktopContextInternal();
  const windows = ctx.windows;
  const activeHandle = normalizedWindowHandle(ctx.activeWindow);
  const resolvedWindow = (window: DesktopWindowInfo, hint?: string) => ({
    ok: true as const,
    window,
    ...(hint ? { hint } : {}),
    isActive: normalizedWindowHandle(window) === activeHandle,
    context: ctx,
  });
  const byHandle = (h: number) => windows.find((w) => normalizedWindowHandle(w) === Math.floor(h)) || null;

  const token = selector.window_token ? parseDesktopWindowToken(selector.window_token) : null;
  if (selector.window_token && !token) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: 'window_token is malformed or its checksum is invalid. Capture fresh window state.' };
  }
  if (token) {
    const live = byHandle(token.handle);
    if (!live) {
      return { ok: false, code: 'STALE_WINDOW', message: 'The window referenced by window_token is no longer open. Capture fresh window state.' };
    }
    const liveStart = Math.floor(Number(live.processStartTime) || 0);
    if (Number(live.pid) !== token.pid || liveStart !== token.processStartTime) {
      return {
        ok: false,
        code: 'STALE_WINDOW',
        message: `The HWND in window_token now belongs to a different process/window (expected pid=${token.pid}, start=${token.processStartTime}; found pid=${live.pid}, start=${liveStart}).`,
      };
    }
    return resolvedWindow(live);
  }

  const explicitHandle = Number(selector.window_handle);
  const idHandle = parseWindowId(selector.window_id);
  const handle = Number.isFinite(explicitHandle) && explicitHandle > 0
    ? Math.floor(explicitHandle)
    : (idHandle ?? 0);

  if (handle > 0) {
    const w = byHandle(handle);
    if (w) return resolvedWindow(w);
    return { ok: false, code: 'WINDOW_NOT_FOUND', message: `No open window for ${selector.window_id ? `window_id="${selector.window_id}"` : `window_handle=${handle}`}. Capture fresh window state or list_windows.` };
  }

  if (selector.app_id) {
    const appId = String(selector.app_id).trim().toLowerCase();
    const matches = windows.filter((w) => appIdForWindow(w) === appId || appIdForProcess(w.processName) === appId);
    if (matches.length === 1) return resolvedWindow(matches[0]);
    if (matches.length > 1) {
      const active = matches.find((w) => normalizedWindowHandle(w) === normalizedWindowHandle(ctx.activeWindow));
      return resolvedWindow(active || matches[0], `app_id "${selector.app_id}" has ${matches.length} windows; targeting ${shortWindowLabel(active || matches[0])}. Pass window_id for an exact window.`);
    }
    return { ok: false, code: 'WINDOW_NOT_FOUND', message: `No open window for app_id "${selector.app_id}".` };
  }

  if (selector.title) {
    const matches = findWindowsByName(windows, String(selector.title));
    if (matches.length >= 1) {
      return resolvedWindow(matches[0], matches.length > 1
        ? `${matches.length} windows match "${selector.title}"; targeting ${shortWindowLabel(matches[0])}. Pass window_id (from desktop_list_windows) for deterministic targeting.`
        : `Resolved by title; prefer window_id from desktop_list_windows for deterministic targeting.`);
    }
    return { ok: false, code: 'WINDOW_NOT_FOUND', message: `No open window matching title "${selector.title}".` };
  }

  if (selector.active === true && ctx.activeWindow) {
    return resolvedWindow(ctx.activeWindow);
  }

  return { ok: false, code: 'INVALID_ARGUMENT', message: 'Provide window_token, window_id, window_handle, app_id, or title to identify the window.' };
}
