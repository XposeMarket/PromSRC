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
import { captureAllMonitorBuffers, resolveDesktopCaptureBackend, desktopFailure, windowIdForHandle, parseWindowId, createDesktopWindowToken, parseDesktopWindowToken, appIdForProcess, appIdForWindow, launchIdentityForWindow, toDesktopWindowState, desktopListWindowStates, resolveCanonicalWindow } from './window-core.js';
import type { DesktopContextGathered, DesktopCaptureBackend, DesktopWindowState, DesktopFailureCode, DesktopAppState, DesktopWindowTokenParts, DesktopWindowSelector } from './window-core.js';



export const execFileAsync = promisify(execFile);


export interface DesktopWindowInfo {
  pid: number;
  /** Process creation time in Unix milliseconds. Combined with PID + HWND to
   * detect handle reuse between observation and action. */
  processStartTime?: number;
  processName: string;
  appDisplayName?: string;
  bundleId?: string;
  appPath?: string;
  title: string;
  handle: number;
  /** Window bounds in virtual-screen coordinates when available */
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  /** 0-based index into `monitors` / `Screen.AllScreens` when known */
  monitorIndex?: number;
  /** Whether this was the foreground window when the record was captured. */
  isActive?: boolean;
}


export interface DesktopSomElement {
  index: number;
  role: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}


/** Per-display bounds in virtual screen coordinates (Windows Forms / Win32) */
export interface DesktopMonitorInfo {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  primary: boolean;
  deviceName: string;
}


export interface DesktopAdvisorPacket {
  screenshotId: string;
  screenshotBase64: string;
  screenshotMime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  capturedAt: number;
  openWindows: DesktopWindowInfo[];
  activeWindow?: DesktopWindowInfo;
  ocrText?: string;
  ocrConfidence?: number;
  contentHash: string;
  /** All connected displays (virtual coords) */
  monitors?: DesktopMonitorInfo[];
  /** Full virtual desktop bounds */
  virtualScreen?: { left: number; top: number; width: number; height: number };
  /** Region actually captured in this packet (same as top-left used for CopyFromScreen) */
  captureRegion?: { left: number; top: number; width: number; height: number };
  /** Virtual-screen units per screenshot pixel. Normally 1, but explicit for DPI/fallback safety. */
  coordinateScale?: { x: number; y: number };
  normalizedScreenshot?: {
    originalWidth: number;
    originalHeight: number;
    originalBytes: number;
    bytes: number;
  };
  /** How the bitmap maps to virtual-screen clicks */
  captureMode?: 'all' | 'primary' | 'monitor' | 'window';
  /** When captureMode === 'monitor', which display index */
  captureMonitorIndex?: number;
  /** Which monitor holds the foreground window (if known) */
  activeMonitorIndex?: number | null;
  /** Target window metadata for desktop_window_screenshot packets */
  targetWindow?: DesktopWindowInfo;
  somElements?: DesktopSomElement[];
  /** Incremented whenever Prometheus performs an action that may change desktop/window state. */
  actionVersion?: number;
  /** Scoped freshness generations. Exact-window packets use these instead of
   * the global actionVersion so unrelated windows do not invalidate them. */
  globalGeneration?: number;
  windowGeneration?: number;
  accessibilityGeneration?: number;
  generationReason?: string;
  windowToken?: string;
}


export interface DesktopFocusWindowVerification {
  requestedName: string;
  focused: boolean;
  requestedAppActive: boolean;
  matchedWindow: DesktopWindowInfo;
  activeWindow: DesktopWindowInfo | null;
  monitor?: DesktopMonitorInfo;
  screenshotId?: string;
  screenshotPath?: string;
  thumbnailPath?: string;
  screenshotWidth?: number;
  screenshotHeight?: number;
  summary: string;
  screenshotObservation?: string;
}


/** Options for `desktop_screenshot` / `desktopScreenshot` */
export interface DesktopScreenshotOptions {
  /** Omit or `all` = full virtual screen; `primary` = main display only; number = 0-based monitor index */
  capture?: 'all' | 'primary' | number;
  /** Optional crop region in virtual-screen coords: [x1, y1, x2, y2]. Applied after capture. */
  region?: [number, number, number, number];
  /** Overlay numbered UI Automation marks and enable desktop_click(element=N). */
  som?: boolean;
  /** Skip OCR when the caller only needs a visual image packet. */
  skipOcr?: boolean;
  /** Cooperative interruption from the owning chat/runtime turn. */
  signal?: AbortSignal;
}


/** Optional pointer tools: coords relative to a monitor's top-left */
export interface DesktopPointerMonitorOptions {
  monitor_relative?: boolean;
  monitor_index?: number;
}


export type DesktopCoordinateSpace = 'virtual' | 'monitor' | 'capture' | 'window';


export interface DesktopCoordinateTarget extends DesktopPointerMonitorOptions {
  x?: number;
  y?: number;
  element?: number;
  coordinate_space?: DesktopCoordinateSpace;
  screenshot_id?: string;
  window_name?: string;
  window_handle?: number;
  /** Internal: exact window already identity-validated and focused for this action. */
  prepared_window?: DesktopWindowInfo;
  /** Internal: point came from a confidence-scored visual locator, not a model guess. */
  allow_broad_grounded?: boolean;
  /** Internal: background dispatch does not require the target to be the active window. */
  background_dispatch?: boolean;
}


export interface DesktopResolvedActionPoint {
  x: number;
  y: number;
  coordinateSpace: DesktopCoordinateSpace;
  sourceNote: string;
  screenshotId?: string;
  targetWindow?: DesktopWindowInfo;
}


export type DesktopVerificationMode = 'off' | 'auto' | 'strict';

export type DesktopVerificationStatus = 'confirmed' | 'likely_noop' | 'uncertain' | 'failed';


export interface DesktopVerificationSignal {
  kind: 'active_window' | 'probe_hash' | 'probe_ocr';
  state: 'changed' | 'unchanged' | 'unavailable';
  detail: string;
  strength: 'strong' | 'weak';
}


export interface DesktopActionVerification {
  status: DesktopVerificationStatus;
  summary: string;
  signals: DesktopVerificationSignal[];
}


export interface DesktopActionVerificationOptions {
  mode?: DesktopVerificationMode;
  coordinateSpace?: DesktopCoordinateSpace;
  allowRetryOnLikelyNoop?: boolean;
  /** Exact HWND to re-activate immediately before native input injection. */
  windowHandle?: number;
}


/** Parse `desktop_screenshot` tool args (monitor_index overrides capture). */
export function parseDesktopScreenshotToolArgs(
  args: Record<string, unknown> | undefined | null,
): DesktopScreenshotOptions | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const a = args as Record<string, any>;
  const opts: DesktopScreenshotOptions = {};
  if (a.monitor_index !== undefined && a.monitor_index !== null && Number.isFinite(Number(a.monitor_index))) {
    opts.capture = Math.max(0, Math.floor(Number(a.monitor_index)));
  } else {
    const c = String(a.capture || '').toLowerCase().trim();
    if (c === 'primary') opts.capture = 'primary';
    else if (c === 'all') opts.capture = 'all';
  }
  // Parse region: accept [x1,y1,x2,y2] array or "x1,y1,x2,y2" string
  if (Array.isArray(a.region) && a.region.length === 4) {
    const r = a.region.map(Number);
    if (r.every(Number.isFinite)) opts.region = r as [number, number, number, number];
  } else if (typeof a.region === 'string') {
    const parts = a.region.split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) opts.region = parts as [number, number, number, number];
  }
  const mode = String(a.mode || '').toLowerCase().trim();
  if (a.som === true || a.som === 'true' || mode === 'som' || mode === 'set-of-mark') {
    opts.som = true;
  }
  if (a.skip_ocr === true || a.skipOcr === true) opts.skipOcr = true;
  return Object.keys(opts).length > 0 ? opts : undefined;
}


/** Parse monitor-relative pointer args for click/scroll/drag. */
export function parseDesktopPointerMonitorArgs(
  args: Record<string, unknown> | undefined | null,
): DesktopPointerMonitorOptions | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const a = args as Record<string, any>;
  if (a.monitor_relative !== true && a.monitor_relative !== 'true') return undefined;
  return {
    monitor_relative: true,
    monitor_index: Number(a.monitor_index ?? a.monitorIndex),
  };
}


export interface DesktopSessionState {
  lastPacket?: DesktopAdvisorPacket;
}


export interface SessionHistory {
  prevPacket?: DesktopAdvisorPacket;
  lastPacket?: DesktopAdvisorPacket;
}


export const sessions = new Map<string, DesktopSessionState>();

export const sessionHistory = new Map<string, SessionHistory>();

export const DESKTOP_PACKET_TTL_MS = 15 * 60 * 1000;

export const DESKTOP_SESSION_CACHE_LIMIT = Math.max(2, Number(process.env.PROMETHEUS_DESKTOP_SESSION_CACHE_LIMIT || 24) || 24);

export const DESKTOP_SCREENSHOT_FRESH_MS = 2 * 60 * 1000;

export const desktopPacketIndex = new Map<string, { sessionId: string; packet: DesktopAdvisorPacket; expiresAt: number }>();

export let desktopActionVersion = 0;


export interface DesktopWindowGenerationRecord {
  visual: number;
  accessibility: number;
  geometry: number;
  lastReason: string;
  lastChangedAt: number;
}


export const desktopWindowGenerations = new Map<string, DesktopWindowGenerationRecord>();


export const DESKTOP_CONTEXT_CACHE_MS = Math.max(0, Number(process.env.PROMETHEUS_DESKTOP_CONTEXT_CACHE_MS || 250));

export const desktopContextState: { cache: { capturedAt: number; value: DesktopContextGathered; includeWindows: boolean } | null } = { cache: null };


export type DesktopPerformanceObserver = (
  stage: string,
  fields?: Record<string, number | string | boolean>,
) => void;


export function markDesktopPerformance(
  observer: DesktopPerformanceObserver | undefined,
  stage: string,
  fields: Record<string, number | string | boolean> = {},
): void {
  try { observer?.(stage, fields); } catch { /* telemetry must not affect desktop semantics */ }
}


export interface DesktopWindowFrameCacheEntry {
  capturedAt: number;
  visualGeneration: number;
  bounds: { left: number; top: number; width: number; height: number };
  png: Buffer;
}

export const DESKTOP_WINDOW_FRAME_CACHE_MS = Math.max(0, Number(process.env.PROMETHEUS_DESKTOP_FRAME_CACHE_MS || 500));

export const desktopWindowFrameCache = new Map<string, DesktopWindowFrameCacheEntry>();


export function desktopWindowGenerationKey(window: Pick<DesktopWindowInfo, 'handle' | 'pid' | 'processStartTime'>): string {
  return createDesktopWindowToken(window);
}


export function getDesktopWindowGeneration(window: Pick<DesktopWindowInfo, 'handle' | 'pid' | 'processStartTime'>): DesktopWindowGenerationRecord {
  const key = desktopWindowGenerationKey(window);
  return getDesktopWindowGenerationByKey(key);
}


export function getDesktopWindowGenerationByKey(key: string): DesktopWindowGenerationRecord {
  return desktopWindowGenerations.get(key) || {
    visual: 0,
    accessibility: 0,
    geometry: 0,
    lastReason: 'initial',
    lastChangedAt: 0,
  };
}


export function markDesktopWindowChanged(
  window: Pick<DesktopWindowInfo, 'handle' | 'pid' | 'processStartTime'>,
  reason: string,
  kinds: { visual?: boolean; accessibility?: boolean; geometry?: boolean } = { visual: true, accessibility: true },
): DesktopWindowGenerationRecord {
  const key = desktopWindowGenerationKey(window);
  const current = getDesktopWindowGeneration(window);
  const next: DesktopWindowGenerationRecord = {
    visual: current.visual + (kinds.visual === true ? 1 : 0),
    accessibility: current.accessibility + (kinds.accessibility === true ? 1 : 0),
    geometry: current.geometry + (kinds.geometry === true ? 1 : 0),
    lastReason: reason,
    lastChangedAt: Date.now(),
  };
  desktopWindowGenerations.set(key, next);
  return next;
}


export function makeDesktopScreenshotId(capturedAt: number, contentHash: string): string {
  return `ds_${capturedAt.toString(36)}_${String(contentHash || '').slice(0, 12)}`;
}


export function pruneDesktopPacketIndex(now: number = Date.now()): void {
  for (const [id, entry] of desktopPacketIndex.entries()) {
    if (entry.expiresAt <= now) desktopPacketIndex.delete(id);
  }
}


export function registerDesktopPacket(sessionId: string, packet: DesktopAdvisorPacket): void {
  pruneDesktopPacketIndex(packet.capturedAt);
  desktopPacketIndex.set(packet.screenshotId, {
    sessionId,
    packet,
    expiresAt: packet.capturedAt + DESKTOP_PACKET_TTL_MS,
  });
}


export function pruneDesktopSessionCaches(now: number = Date.now()): void {
  for (const [sessionId, state] of sessions.entries()) {
    const capturedAt = Number(state.lastPacket?.capturedAt || 0);
    if (!capturedAt || capturedAt + DESKTOP_PACKET_TTL_MS <= now) {
      sessions.delete(sessionId);
      sessionHistory.delete(sessionId);
    }
  }

  if (sessions.size > DESKTOP_SESSION_CACHE_LIMIT) {
    const oldest = [...sessions.entries()]
      .sort((a, b) => Number(a[1].lastPacket?.capturedAt || 0) - Number(b[1].lastPacket?.capturedAt || 0));
    for (const [sessionId] of oldest.slice(0, sessions.size - DESKTOP_SESSION_CACHE_LIMIT)) {
      sessions.delete(sessionId);
      sessionHistory.delete(sessionId);
    }
  }

  for (const sessionId of sessionHistory.keys()) {
    if (!sessions.has(sessionId)) sessionHistory.delete(sessionId);
  }
}


export function markDesktopStateChanged(): void {
  desktopActionVersion++;
}


export function validateDesktopPacketGeneration(packet: DesktopAdvisorPacket): { ok: true } | { ok: false; message: string } {
  if (packet.targetWindow) {
    const captured = Number(packet.windowGeneration);
    const current = getDesktopWindowGeneration(packet.targetWindow);
    if (!Number.isFinite(captured)) {
      return { ok: false, message: `screenshot_id "${packet.screenshotId}" predates scoped window generations. Capture a fresh exact-window screenshot.` };
    }
    if (captured !== current.visual) {
      return {
        ok: false,
        message: `screenshot_id "${packet.screenshotId}" is stale for this window: captured window_generation=${captured}, current=${current.visual}. Invalidated by "${current.lastReason}" at ${new Date(current.lastChangedAt).toISOString()}. Capture fresh state for this window.`,
      };
    }
    return { ok: true };
  }
  const captured = Number(packet.globalGeneration ?? packet.actionVersion);
  if (!Number.isFinite(captured) || captured !== desktopActionVersion) {
    return {
      ok: false,
      message: `screenshot_id "${packet.screenshotId}" is stale for the global desktop: captured global_generation=${Number.isFinite(captured) ? captured : 'unknown'}, current=${desktopActionVersion}. Capture a fresh desktop screenshot.`,
    };
  }
  return { ok: true };
}


export function desktopPacketAgeMs(packet: DesktopAdvisorPacket): number {
  const capturedAt = Number(packet.capturedAt);
  return Number.isFinite(capturedAt) ? Date.now() - capturedAt : Number.POSITIVE_INFINITY;
}


export function describeFreshScreenshotRequirement(packet: DesktopAdvisorPacket): string {
  const ageSec = Math.max(0, Math.round(desktopPacketAgeMs(packet) / 1000));
  return `screenshot_id "${packet.screenshotId}" is ${ageSec}s old. Capture a fresh focused desktop_window_screenshot before clicking.`;
}


export function describeStaleScreenshotRequirement(packet: DesktopAdvisorPacket): string {
  const validation = validateDesktopPacketGeneration(packet);
  return validation.ok ? `screenshot_id "${packet.screenshotId}" is still generation-valid.` : validation.message;
}


export function describeDesktopWindowBounds(windowInfo: DesktopWindowInfo | undefined | null): string {
  if (!windowInfo) return 'unknown window';
  const title = String(windowInfo.title || '').trim() || '(untitled)';
  const proc = String(windowInfo.processName || '').trim() || 'process';
  const left = Number(windowInfo.left);
  const top = Number(windowInfo.top);
  const width = Number(windowInfo.width);
  const height = Number(windowInfo.height);
  const bounds =
    [left, top, width, height].every(Number.isFinite) && width >= 0 && height >= 0
      ? ` @ (${Math.floor(left)}, ${Math.floor(top)}) ${Math.floor(width)}x${Math.floor(height)}`
      : '';
  return `"${title}" (${proc}${bounds})`;
}


export function pointInsideDesktopWindow(x: number, y: number, windowInfo?: DesktopWindowInfo | null): boolean {
  if (!windowInfo) return false;
  const left = Number(windowInfo.left);
  const top = Number(windowInfo.top);
  const width = Number(windowInfo.width);
  const height = Number(windowInfo.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 1 || height < 1) return false;
  return x >= left && y >= top && x < left + width && y < top + height;
}


export function sameDesktopWindowHandle(a?: DesktopWindowInfo | null, b?: DesktopWindowInfo | null): boolean {
  const ah = normalizedWindowHandle(a);
  const bh = normalizedWindowHandle(b);
  return ah > 0 && bh > 0 && ah === bh;
}


// ─── Macro Recording ──────────────────────────────────────────────────────────
export interface MacroAction {
  type: 'click' | 'double_click' | 'type' | 'type_raw' | 'key' | 'scroll';
  /** For click/double_click: virtual-screen coords */
  x?: number;
  y?: number;
  button?: 'left' | 'right';
  /** For type / type_raw / key */
  text?: string;
  /** For scroll */
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  horizontal?: boolean;
  /** Milliseconds since recording start — used for timed replay */
  delay: number;
}

export const _macros = new Map<string, MacroAction[]>();


/** Called by every recorded desktop action to append to the active recording. */
export function _macroRecord(action: Omit<MacroAction, 'delay'>): void {
  if (!_activeRecordingName) return;
  _recordingBuffer.push({ ...action, delay: Date.now() - _recordingStartTime } as MacroAction);
}


export function clampInt(value: any, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}


export const OCR_CHILD_SCRIPT = `
(async () => {
  const imagePath = process.argv[1];
  try {
    // The parent passes tesseract.js's resolved entry as a file URL: this
    // child runs as [eval] with cwd=ocr-cache, where a bare specifier cannot
    // resolve the package.
    const mod = await import(process.argv[2] || 'tesseract.js');
    const createWorker = mod?.createWorker || mod?.default?.createWorker;
    if (typeof createWorker !== 'function') {
      process.stdout.write(JSON.stringify({ ok: false, stage: 'module_api', error: 'createWorker unavailable' }));
      return;
    }
    const worker = await createWorker('eng');
    if (worker && typeof worker.loadLanguage === 'function' && typeof worker.initialize === 'function') {
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
    }
    const out = await worker.recognize(imagePath);
    if (worker && typeof worker.terminate === 'function') {
      await worker.terminate();
    }
    const text = String(out?.data?.text || '')
      .replace(/\\r/g, '')
      .replace(/[ \\t]+\\n/g, '\\n')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim();
    const confidence = Number(out?.data?.confidence || 0) || 0;
    process.stdout.write(JSON.stringify({ ok: true, stage: 'recognize', text, confidence }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, stage: 'worker_or_recognition', error: String(error?.stack || error?.message || error) }));
  }
})().catch((error) => process.stdout.write(JSON.stringify({ ok: false, stage: 'child_top_level', error: String(error?.stack || error?.message || error) })));
`;


// ─── Phase 6: Cross-platform support stubs ────────────────────────────────────
//
// The platform strategy pattern is prepared here.
// Windows: PowerShell + Win32 (fully implemented below)
// macOS: screencapture + cliclick (stubs ready, implementation pending)
// Linux: scrot/import + xdotool (stubs ready, implementation pending)
//
// When cross-platform support is implemented, replace ensureWindows() calls
// with getPlatformStrategy().methodName() from this section.

export type PlatformId = 'win32' | 'darwin' | 'linux';


export const PLATFORM = process.platform as PlatformId;


/**
 * Returns platform-specific error message when a tool is not yet implemented
 * on the current OS. Future implementations can replace the error with the
 * actual platform-native command.
 */
export function getPlatformUnsupportedMessage(feature: string): string {
  if (PLATFORM === 'darwin') {
    return (
      `Desktop tool '${feature}' is not yet implemented on macOS. ` +
      `Planned implementation: screencapture (screenshot), cliclick or Swift helper (click/type). ` +
      `Set PROMETHEUS_DESKTOP_PLATFORM=macos once the macOS backend is available.`
    );
  }
  if (PLATFORM === 'linux') {
    return (
      `Desktop tool '${feature}' is not yet implemented on Linux. ` +
      `Planned implementation: scrot/import (screenshot), xdotool (click/type/key). ` +
      `Set PROMETHEUS_DESKTOP_PLATFORM=linux once the Linux backend is available.`
    );
  }
  return `Desktop tool '${feature}' is not supported on platform: ${PLATFORM}.`;
}


/** True when the current platform delegates primitives to a non-Windows backend
 *  (i.e. the Swift helper on macOS). The internal primitives below check this and
 *  route to getPlatformDesktopBackend() instead of running inline PowerShell. */
export const DELEGATE_TO_BACKEND = PLATFORM !== 'win32';


/** Guard at the top of every public desktop_* function. Allows any platform that
 *  has a DesktopBackend (win32 inline, darwin via helper); throws on the rest. */
export function ensureWindows(): void {
  if (!hasDesktopBackend()) {
    throw new Error(getPlatformUnsupportedMessage('desktop automation'));
  }
}


/**
 * Check if the current platform has any desktop automation support.
 * Returns null if supported, or a human-readable reason string if not.
 */
export function getDesktopPlatformStatus(): string | null {
  if (hasDesktopBackend()) return null;
  return getPlatformUnsupportedMessage('desktop automation');
}


/**
 * macOS screenshot stub — ready for implementation.
 * Planned: `screencapture -x /tmp/prometheus-desktop-XXXX.png`
 */
export async function captureScreenshotMacOS(): Promise<never> {
  throw new Error(getPlatformUnsupportedMessage('desktop_screenshot'));
}


/**
 * Linux screenshot stub — ready for implementation.
 * Planned: `scrot /tmp/prometheus-desktop-XXXX.png` or `import -window root`
 */
export async function captureScreenshotLinux(): Promise<never> {
  throw new Error(getPlatformUnsupportedMessage('desktop_screenshot'));
}


export function psSingleQuote(value: string): string {
  return String(value || '').replace(/'/g, "''");
}


export async function runPowerShell(
  script: string,
  opts?: { timeoutMs?: number; sta?: boolean; signal?: AbortSignal },
): Promise<string> {
  ensureWindows();
  // Persistent hosts remove the 230-440 ms powershell.exe start per call.
  // Fall back to a fresh process only when the host itself could not run
  // (spawn failure / crash), never for script errors, timeouts or aborts.
  if (isDesktopPowerShellHostEnabled()) {
    scheduleDesktopPowerShellWarmup();
    try {
      return await runPowerShellInHost(script, opts || {});
    } catch (error: any) {
      // Only "every host is busy" falls back. A script that started in a host
      // and then failed must not run a second time (input side effects).
      if (!(error instanceof PowerShellHostBusyError)) throw error;
    }
  }
  return runPowerShellSpawned(script, opts);
}


export let desktopPowerShellWarmupScheduled = false;

/** Pre-start the hosts and pre-compile the shared Add-Type headers so the
 *  first real screenshot / window / UIA call does not pay that cost. */
export function scheduleDesktopPowerShellWarmup(): void {
  if (desktopPowerShellWarmupScheduled) return;
  desktopPowerShellWarmupScheduled = true;
  setTimeout(() => {
    warmDesktopPowerShellHosts([
      { sta: true, script: `${PS_DPI_AWARE_HEADER}\nAdd-Type -AssemblyName System.Windows.Forms\nAdd-Type -AssemblyName System.Drawing\n${PS_WINAPI_HEADER}\n'ok'` },
      // Touching RootElement pays the one-time UIA client/COM connection cost
      // (~2.5 s cold) here instead of in the first accessibility call.
      { sta: true, script: `Add-Type -AssemblyName System.Windows.Forms\nAdd-Type -AssemblyName UIAutomationClient\nAdd-Type -AssemblyName UIAutomationTypes\n${PS_INPUTAPI_HEADER}\ntry { [void][System.Windows.Automation.AutomationElement]::RootElement.Current.Name; $c = New-Object System.Windows.Automation.CacheRequest; [void]$c } catch { }\n'ok'` },
      { sta: false, script: `${PS_DPI_AWARE_HEADER}\nAdd-Type -AssemblyName System.Windows.Forms\n${PS_WINAPI_HEADER}\n'ok'` },
    ]);
  }, 250).unref?.();
}


/** The persistent native helper when it speaks at least `version` of the
 *  protocol (v3: screen capture + window info, v4: process identity +
 *  desktop_context). Null means: use the PowerShell path. */
export async function win32HelperAtLeast(version: number): Promise<ReturnType<typeof getWin32DesktopHelperClient> | null> {
  if (DELEGATE_TO_BACKEND || process.platform !== 'win32') return null;
  if (String(process.env.PROMETHEUS_DESKTOP_HELPER_FASTPATH ?? '1').trim() === '0') return null;
  const helper = getWin32DesktopHelperClient();
  if (!helper.available) return null;
  try {
    return (await helper.protocolVersion()) >= version ? helper : null;
  } catch {
    return null;
  }
}


export async function runPowerShellSpawned(
  script: string,
  opts?: { timeoutMs?: number; sta?: boolean; signal?: AbortSignal },
): Promise<string> {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];
  if (opts?.sta) args.push('-STA');
  args.push('-Command', script);
  const { stdout, stderr } = await execFileAsync('powershell.exe', args, {
    timeout: opts?.timeoutMs ?? 15000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    signal: opts?.signal,
  });
  const out = String(stdout || '').trim();
  const err = String(stderr || '').trim();
  if (err && !out) {
    throw new Error(err.slice(0, 500));
  }
  return out;
}


export function parseJsonMaybe(raw: string): any {
  const txt = String(raw || '').trim();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}


export function normalizeWindows(raw: any): DesktopWindowInfo[] {
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return arr
    .map((w: any) => {
      const mi = Number(w?.monitorIndex ?? w?.monitor_index ?? -1);
      const row: DesktopWindowInfo = {
        pid: Number(w?.pid || w?.Id || 0) || 0,
        processStartTime: Number(w?.processStartTime ?? w?.process_start_time ?? 0) || undefined,
        processName: String(w?.processName || w?.ProcessName || '').trim(),
        appDisplayName: String(w?.appDisplayName || w?.app_display_name || '').trim() || undefined,
        bundleId: String(w?.bundleId || w?.bundle_id || '').trim() || undefined,
        appPath: String(w?.appPath || w?.app_path || '').trim() || undefined,
        title: String(w?.title || w?.MainWindowTitle || '').trim(),
        handle: Number(w?.handle || w?.MainWindowHandle || 0) || 0,
      };
      const left = Number(w?.left);
      const top = Number(w?.top);
      const width = Number(w?.width);
      const height = Number(w?.height);
      if ([left, top, width, height].every(Number.isFinite)) {
        row.left = Math.floor(left);
        row.top = Math.floor(top);
        row.width = Math.max(0, Math.floor(width));
        row.height = Math.max(0, Math.floor(height));
      }
      if (Number.isFinite(mi) && mi >= 0) row.monitorIndex = Math.floor(mi);
      return row;
    })
    .filter((w) => w.handle !== 0 && !!w.title)
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 120);
}


// ─── Cached Add-Type headers (must appear before gatherDesktopContextInternal) ─
//
// PowerShell compiles Add-Type C# on each new process; guard pattern limits cost.

export const PS_WINAPI_HEADER = `
if (-not ([System.Management.Automation.PSTypeName]'PrometheusWinApi').Type) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PrometheusWinApi {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern uint GetCurrentThreadId();
}
"@ -Language CSharp
}
`;


export const PS_INPUTAPI_HEADER = `
if (-not ([System.Management.Automation.PSTypeName]'PrometheusInputApi').Type) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PrometheusInputApi {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  // dwData must be signed for MOUSEEVENTF_WHEEL / MOUSEEVENTF_HWHEEL (e.g. -120 per tick down).
  // Using uint breaks negative deltas and Chromium/Electron apps often ignore the scroll.
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
  // KEYEVENTF_KEYUP = 0x0002; bVk: Shift=0x10, Ctrl=0x11, Alt=0x12
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@ -Language CSharp
}
`;


// Ensure PowerShell process is DPI-aware before reading monitor bounds/capturing.
// Without this, multi-monitor bounds can be scaled/virtualized on high-DPI setups,
// causing side monitors to be clipped in "all monitors" screenshots.
export const PS_DPI_AWARE_HEADER = `
if (-not ([System.Management.Automation.PSTypeName]'PrometheusDpiApi').Type) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PrometheusDpiApi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);
}
"@ -Language CSharp -ErrorAction SilentlyContinue
}
try {
  # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
  [void][PrometheusDpiApi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
} catch {
  try { [void][PrometheusDpiApi]::SetProcessDPIAware() } catch {}
}
`;

export { _activeRecordingName, _recordingBuffer, _recordingStartTime } from './interaction-actions.js';
import { _activeRecordingName, _recordingBuffer, _recordingStartTime } from './interaction-actions.js';

export { desktopContextCache } from './interaction-context.js';
import { desktopContextCache } from './interaction-context.js';
