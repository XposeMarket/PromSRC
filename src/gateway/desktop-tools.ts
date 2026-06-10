/**
 * desktop-tools.ts
 *
 * Windows desktop automation primitives for Prometheus.
 * Uses PowerShell + Win32 APIs (no native npm dependency required).
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
} from './installed-apps.js';
import {
  desktopBackgroundCommand,
  desktopBackgroundPrepareSandbox,
  desktopBackgroundStatus,
} from './desktop-background.js';
import { normalizeScreenshotBuffer } from './screenshot-normalize.js';
import { parseCanonicalKey, canonicalKeyToSendKeys } from './desktop-keys.js';

const execFileAsync = promisify(execFile);

export interface DesktopWindowInfo {
  pid: number;
  processName: string;
  title: string;
  handle: number;
  /** Window bounds in virtual-screen coordinates when available */
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  /** 0-based index into `monitors` / `Screen.AllScreens` when known */
  monitorIndex?: number;
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
  captureMode?: 'all' | 'primary' | 'monitor';
  /** When captureMode === 'monitor', which display index */
  captureMonitorIndex?: number;
  /** Which monitor holds the foreground window (if known) */
  activeMonitorIndex?: number | null;
  /** Target window metadata for desktop_window_screenshot packets */
  targetWindow?: DesktopWindowInfo;
  somElements?: DesktopSomElement[];
  /** Incremented whenever Prometheus performs an action that may change desktop/window state. */
  actionVersion?: number;
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

interface DesktopSessionState {
  lastPacket?: DesktopAdvisorPacket;
}

const sessions = new Map<string, DesktopSessionState>();
const DESKTOP_PACKET_TTL_MS = 15 * 60 * 1000;
const DESKTOP_SCREENSHOT_FRESH_MS = 2 * 60 * 1000;
const desktopPacketIndex = new Map<string, { sessionId: string; packet: DesktopAdvisorPacket; expiresAt: number }>();
let desktopActionVersion = 0;

function makeDesktopScreenshotId(capturedAt: number, contentHash: string): string {
  return `ds_${capturedAt.toString(36)}_${String(contentHash || '').slice(0, 12)}`;
}

function pruneDesktopPacketIndex(now: number = Date.now()): void {
  for (const [id, entry] of desktopPacketIndex.entries()) {
    if (entry.expiresAt <= now) desktopPacketIndex.delete(id);
  }
}

function registerDesktopPacket(sessionId: string, packet: DesktopAdvisorPacket): void {
  pruneDesktopPacketIndex(packet.capturedAt);
  desktopPacketIndex.set(packet.screenshotId, {
    sessionId,
    packet,
    expiresAt: packet.capturedAt + DESKTOP_PACKET_TTL_MS,
  });
}

function markDesktopStateChanged(): void {
  desktopActionVersion++;
}

function desktopPacketAgeMs(packet: DesktopAdvisorPacket): number {
  const capturedAt = Number(packet.capturedAt);
  return Number.isFinite(capturedAt) ? Date.now() - capturedAt : Number.POSITIVE_INFINITY;
}

function describeFreshScreenshotRequirement(packet: DesktopAdvisorPacket): string {
  const ageSec = Math.max(0, Math.round(desktopPacketAgeMs(packet) / 1000));
  return `screenshot_id "${packet.screenshotId}" is ${ageSec}s old. Capture a fresh focused desktop_window_screenshot before clicking.`;
}

function describeStaleScreenshotRequirement(packet: DesktopAdvisorPacket): string {
  const version = Number(packet.actionVersion);
  if (!Number.isFinite(version)) {
    return `screenshot_id "${packet.screenshotId}" predates desktop action tracking. Capture a fresh desktop_screenshot or desktop_window_screenshot before clicking.`;
  }
  return `screenshot_id "${packet.screenshotId}" is stale because the desktop changed after it was captured. Capture a fresh desktop_screenshot or desktop_window_screenshot and click with that screenshot_id.`;
}

function describeDesktopWindowBounds(windowInfo: DesktopWindowInfo | undefined | null): string {
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

function pointInsideDesktopWindow(x: number, y: number, windowInfo?: DesktopWindowInfo | null): boolean {
  if (!windowInfo) return false;
  const left = Number(windowInfo.left);
  const top = Number(windowInfo.top);
  const width = Number(windowInfo.width);
  const height = Number(windowInfo.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 1 || height < 1) return false;
  return x >= left && y >= top && x < left + width && y < top + height;
}

function sameDesktopWindowHandle(a?: DesktopWindowInfo | null, b?: DesktopWindowInfo | null): boolean {
  const ah = normalizedWindowHandle(a);
  const bh = normalizedWindowHandle(b);
  return ah > 0 && bh > 0 && ah === bh;
}

// ─── Macro Recording ──────────────────────────────────────────────────────────
interface MacroAction {
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

let _activeRecordingName: string | null = null;
let _recordingBuffer: MacroAction[] = [];
let _recordingStartTime = 0;
const _macros = new Map<string, MacroAction[]>();

/** Called by every recorded desktop action to append to the active recording. */
function _macroRecord(action: Omit<MacroAction, 'delay'>): void {
  if (!_activeRecordingName) return;
  _recordingBuffer.push({ ...action, delay: Date.now() - _recordingStartTime } as MacroAction);
}

function clampInt(value: any, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const OCR_CHILD_SCRIPT = `
(async () => {
  const imagePath = process.argv[2];
  try {
    const mod = await import('tesseract.js');
    const createWorker = mod?.createWorker;
    if (typeof createWorker !== 'function') {
      process.stdout.write('{}');
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
    process.stdout.write(JSON.stringify({ text, confidence }));
  } catch {
    process.stdout.write('{}');
  }
})().catch(() => process.stdout.write('{}'));
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

type PlatformId = 'win32' | 'darwin' | 'linux';

const PLATFORM = process.platform as PlatformId;

/**
 * Returns platform-specific error message when a tool is not yet implemented
 * on the current OS. Future implementations can replace the error with the
 * actual platform-native command.
 */
function getPlatformUnsupportedMessage(feature: string): string {
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

function ensureWindows(): void {
  if (PLATFORM !== 'win32') {
    throw new Error(getPlatformUnsupportedMessage('desktop automation'));
  }
}

/**
 * Check if the current platform has any desktop automation support.
 * Returns null if supported, or a human-readable reason string if not.
 */
export function getDesktopPlatformStatus(): string | null {
  if (PLATFORM === 'win32') return null;
  return getPlatformUnsupportedMessage('desktop automation');
}

/**
 * macOS screenshot stub — ready for implementation.
 * Planned: `screencapture -x /tmp/prometheus-desktop-XXXX.png`
 */
async function captureScreenshotMacOS(): Promise<never> {
  throw new Error(getPlatformUnsupportedMessage('desktop_screenshot'));
}

/**
 * Linux screenshot stub — ready for implementation.
 * Planned: `scrot /tmp/prometheus-desktop-XXXX.png` or `import -window root`
 */
async function captureScreenshotLinux(): Promise<never> {
  throw new Error(getPlatformUnsupportedMessage('desktop_screenshot'));
}

function psSingleQuote(value: string): string {
  return String(value || '').replace(/'/g, "''");
}

async function runPowerShell(
  script: string,
  opts?: { timeoutMs?: number; sta?: boolean },
): Promise<string> {
  ensureWindows();
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];
  if (opts?.sta) args.push('-STA');
  args.push('-Command', script);
  const { stdout, stderr } = await execFileAsync('powershell.exe', args, {
    timeout: opts?.timeoutMs ?? 15000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  const out = String(stdout || '').trim();
  const err = String(stderr || '').trim();
  if (err && !out) {
    throw new Error(err.slice(0, 500));
  }
  return out;
}

function parseJsonMaybe(raw: string): any {
  const txt = String(raw || '').trim();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function normalizeWindows(raw: any): DesktopWindowInfo[] {
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return arr
    .map((w: any) => {
      const mi = Number(w?.monitorIndex ?? w?.monitor_index ?? -1);
      const row: DesktopWindowInfo = {
        pid: Number(w?.pid || w?.Id || 0) || 0,
        processName: String(w?.processName || w?.ProcessName || '').trim(),
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

const PS_WINAPI_HEADER = `
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

const PS_INPUTAPI_HEADER = `
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
const PS_DPI_AWARE_HEADER = `
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

export interface DesktopContextGathered {
  monitors: DesktopMonitorInfo[];
  virtualScreen: { left: number; top: number; width: number; height: number };
  windows: DesktopWindowInfo[];
  activeWindow: DesktopWindowInfo | null;
}

function normalizeMonitors(raw: any): DesktopMonitorInfo[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((m: any, i: number) => ({
      index: Number(m?.index ?? i) || i,
      left: Number(m?.left || 0) || 0,
      top: Number(m?.top || 0) || 0,
      width: Number(m?.width || 0) || 0,
      height: Number(m?.height || 0) || 0,
      primary: m?.primary === true,
      deviceName: String(m?.deviceName || m?.device_name || '').trim(),
    }))
    .filter((m) => m.width > 0 && m.height > 0);
}

function normalizeVirtualScreen(raw: any): { left: number; top: number; width: number; height: number } {
  return {
    left: Number(raw?.left || 0) || 0,
    top: Number(raw?.top || 0) || 0,
    width: Number(raw?.width || 0) || 0,
    height: Number(raw?.height || 0) || 0,
  };
}

function normalizeDesktopContext(raw: any): DesktopContextGathered {
  const monitors = normalizeMonitors(raw?.monitors);
  const virtualScreen = normalizeVirtualScreen(raw?.virtualScreen || raw?.virtual_screen);
  const windows = normalizeWindows(raw?.windows);
  let activeWindow: DesktopWindowInfo | null = null;
  const aw = raw?.activeWindow || raw?.active_window;
  if (aw) {
    const h = Number(aw.handle || aw.MainWindowHandle || 0) || 0;
    let title = String(aw.title || '').trim();
    const proc = String(aw.processName || aw.process_name || '').trim();
    if (h !== 0) {
      if (!title) title = proc ? `[${proc}]` : '(foreground window)';
      activeWindow = {
        pid: Number(aw.pid || 0) || 0,
        processName: proc || 'unknown',
        title,
        handle: h,
      };
      const ami = Number(aw.monitorIndex ?? aw.monitor_index ?? -1);
      if (Number.isFinite(ami) && ami >= 0) activeWindow.monitorIndex = Math.floor(ami);
    }
  }
  return { monitors, virtualScreen, windows, activeWindow };
}

/**
 * One PowerShell round-trip: monitors, virtual screen, window list with monitor index, active window.
 */
/** Exported for the Win32 DesktopBackend (desktop-platform-win32.ts). */
export async function gatherDesktopContextInternal(): Promise<DesktopContextGathered> {
  const script = `
${PS_DPI_AWARE_HEADER}
Add-Type -AssemblyName System.Windows.Forms
${PS_WINAPI_HEADER}
$screens = [System.Windows.Forms.Screen]::AllScreens
$monitors = New-Object System.Collections.ArrayList
for ($i = 0; $i -lt $screens.Length; $i++) {
  $s = $screens[$i]
  [void]$monitors.Add([ordered]@{
    index = $i
    left = [int]$s.Bounds.Left
    top = [int]$s.Bounds.Top
    width = [int]$s.Bounds.Width
    height = [int]$s.Bounds.Height
    primary = [bool]$s.Primary
    deviceName = [string]$s.DeviceName
  })
}
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$virtualScreen = [ordered]@{
  left = [int]$vs.Left
  top = [int]$vs.Top
  width = [int]$vs.Width
  height = [int]$vs.Height
}
function Get-MonitorIndex([IntPtr]$hwnd) {
  if ($hwnd -eq [IntPtr]::Zero) { return -1 }
  try {
    $scr = [System.Windows.Forms.Screen]::FromHandle($hwnd)
    for ($i = 0; $i -lt $screens.Length; $i++) {
      if ($screens[$i].DeviceName -eq $scr.DeviceName) { return [int]$i }
    }
  } catch { }
  return -1
}
$winRows = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0
}
$windows = New-Object System.Collections.ArrayList
foreach ($r in $winRows) {
  $hPtr = [IntPtr]::new([Int64]$r.MainWindowHandle)
  $mi = Get-MonitorIndex $hPtr
  $rect = New-Object PrometheusWinApi+RECT
  $okRect = [PrometheusWinApi]::GetWindowRect($hPtr, [ref]$rect)
  $left = if ($okRect) { [int]$rect.Left } else { 0 }
  $top = if ($okRect) { [int]$rect.Top } else { 0 }
  $w = if ($okRect) { [int]($rect.Right - $rect.Left) } else { 0 }
  $h = if ($okRect) { [int]($rect.Bottom - $rect.Top) } else { 0 }
  [void]$windows.Add([ordered]@{
    pid = [int]$r.Id
    processName = [string]$r.ProcessName
    title = [string]$r.MainWindowTitle
    handle = [int64]$r.MainWindowHandle
    monitorIndex = [int]$mi
    left = $left
    top = $top
    width = $w
    height = $h
  })
}
$hFg = [PrometheusWinApi]::GetForegroundWindow()
$apid = [uint32]0
[void][PrometheusWinApi]::GetWindowThreadProcessId($hFg, [ref]$apid)
$aproc = $null
if ($apid -gt 0) { $aproc = Get-Process -Id ([int]$apid) -ErrorAction SilentlyContinue }
$actMi = Get-MonitorIndex $hFg
$winTitle = ''
if ($hFg -ne [IntPtr]::Zero) {
  $tlen = [PrometheusWinApi]::GetWindowTextLength($hFg)
  if ($tlen -gt 0) {
    $sb = New-Object System.Text.StringBuilder ($tlen + 1)
    [void][PrometheusWinApi]::GetWindowText($hFg, $sb, $sb.Capacity)
    $winTitle = $sb.ToString().Trim()
  }
}
if (-not $winTitle -and $aproc) { $winTitle = [string]$aproc.MainWindowTitle }
$procName = if ($aproc) { [string]$aproc.ProcessName } else { 'unknown' }
if (-not $winTitle) { $winTitle = '[' + $procName + ']' }
$activeWindow = $null
if ($hFg -ne [IntPtr]::Zero) {
  $fgRect = New-Object PrometheusWinApi+RECT
  $okFgRect = [PrometheusWinApi]::GetWindowRect($hFg, [ref]$fgRect)
  $fgLeft = if ($okFgRect) { [int]$fgRect.Left } else { 0 }
  $fgTop = if ($okFgRect) { [int]$fgRect.Top } else { 0 }
  $fgWidth = if ($okFgRect) { [int]($fgRect.Right - $fgRect.Left) } else { 0 }
  $fgHeight = if ($okFgRect) { [int]($fgRect.Bottom - $fgRect.Top) } else { 0 }
  $activeWindow = [ordered]@{
    pid = [int]$apid
    processName = $procName
    title = $winTitle
    handle = [int64]$hFg.ToInt64()
    monitorIndex = [int]$actMi
    left = $fgLeft
    top = $fgTop
    width = $fgWidth
    height = $fgHeight
  }
}
[PSCustomObject]@{
  monitors = @($monitors.ToArray())
  virtualScreen = $virtualScreen
  windows = @($windows.ToArray())
  activeWindow = $activeWindow
} | ConvertTo-Json -Compress -Depth 8
`;
  const raw = await runPowerShell(script, { timeoutMs: 14000, sta: true });
  const parsed = parseJsonMaybe(raw);
  if (!parsed) {
    return {
      monitors: [],
      virtualScreen: { left: 0, top: 0, width: 0, height: 0 },
      windows: [],
      activeWindow: null,
    };
  }
  return normalizeDesktopContext(parsed);
}

/**
 * Return connected monitor metadata without taking a screenshot.
 * Useful for UI flows that need monitor selection first (e.g. Telegram buttons).
 */
export async function desktopGetMonitors(): Promise<DesktopMonitorInfo[]> {
  ensureWindows();
  const ctx = await gatherDesktopContextInternal();
  return ctx.monitors;
}

/**
 * Return the monitor index of the active/foreground window, if known.
 */
export async function desktopGetActiveMonitorIndex(): Promise<number | null> {
  ensureWindows();
  const ctx = await gatherDesktopContextInternal();
  const mi = Number(ctx.activeWindow?.monitorIndex);
  if (Number.isFinite(mi) && mi >= 0) return Math.floor(mi);
  return null;
}

export async function desktopGetMonitorsSummary(): Promise<string> {
  ensureWindows();
  const ctx = await gatherDesktopContextInternal();
  const monitors = ctx.monitors || [];
  if (!monitors.length) return 'No monitors detected.';
  const lines = monitors
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((m) => `Monitor ${m.index}: ${m.width}x${m.height} at virtual (${m.left}, ${m.top})${m.primary ? ' [PRIMARY]' : ''}`);
  const vs = ctx.virtualScreen;
  const vsLine = (Number(vs.width) > 0 && Number(vs.height) > 0)
    ? `Virtual desktop: top-left (${vs.left}, ${vs.top}), size ${vs.width}x${vs.height}.`
    : 'Virtual desktop bounds unavailable.';
  return [`Monitors detected: ${monitors.length}.`, vsLine, ...lines].join('\n');
}

export async function desktopDoctor(sessionId: string): Promise<string> {
  const lines: string[] = ['Desktop doctor:'];
  const ok = (label: string, detail: string) => lines.push(`PASS ${label}: ${detail}`);
  const warn = (label: string, detail: string) => lines.push(`WARN ${label}: ${detail}`);
  const fail = (label: string, detail: string) => lines.push(`FAIL ${label}: ${detail}`);

  try {
    ensureWindows();
    ok('Platform', 'Windows desktop automation is supported');
  } catch (err: any) {
    fail('Platform', err?.message || String(err));
    return lines.join('\n');
  }

  let ctx: DesktopContextGathered | null = null;
  try {
    ctx = await gatherDesktopContextInternal();
    ok('Monitor/DPI context', `${ctx.monitors.length || 0} monitor(s), virtual ${ctx.virtualScreen.width}x${ctx.virtualScreen.height} at (${ctx.virtualScreen.left},${ctx.virtualScreen.top})`);
    if (!ctx.monitors.length) warn('Monitor/DPI context', 'no monitor records returned by Windows Forms');
    const bad = ctx.monitors.filter((m) => m.width < 1 || m.height < 1);
    if (bad.length) fail('Monitor bounds', `${bad.length} monitor(s) have invalid dimensions`);
    else ok('Monitor bounds', 'all monitor dimensions are positive');
  } catch (err: any) {
    fail('Monitor/DPI context', err?.message || String(err));
  }

  try {
    const shot = await captureScreenshotInternal({ kind: 'primary' });
    const raw = fs.readFileSync(shot.path);
    try { fs.unlinkSync(shot.path); } catch {}
    const normalized = await normalizeScreenshotBuffer(raw, {
      maxSide: Number(process.env.PROMETHEUS_DESKTOP_SCREENSHOT_MAX_SIDE || process.env.PROMETHEUS_SCREENSHOT_MAX_SIDE || 2400),
      maxBytes: Number(process.env.PROMETHEUS_DESKTOP_SCREENSHOT_MAX_BYTES || process.env.PROMETHEUS_SCREENSHOT_MAX_BYTES || 5 * 1024 * 1024),
      preferJpeg: true,
    });
    ok(
      'Screenshot budget',
      `primary raw=${shot.width}x${shot.height} ${Math.round(raw.byteLength / 1024)}KB, transport=${normalized.width}x${normalized.height} ${normalized.mimeType} ${Math.round(normalized.bytes / 1024)}KB, coordinateScale=${normalized.scaleX.toFixed(3)}x${normalized.scaleY.toFixed(3)}`,
    );
  } catch (err: any) {
    fail('Screenshot budget', err?.message || String(err));
  }

  try {
    const ocrEnabled = String(process.env.PROMETHEUS_DESKTOP_OCR || '1').trim() !== '0';
    if (!ocrEnabled) warn('OCR', 'disabled by PROMETHEUS_DESKTOP_OCR=0');
    else {
      const packet = getDesktopAdvisorPacket(sessionId);
      if (packet?.ocrText) ok('OCR', `last packet has OCR text (${packet.ocrText.length} chars, confidence ${Math.round(packet.ocrConfidence || 0)}%)`);
      else warn('OCR', 'enabled, but no OCR text is cached yet; run desktop_screenshot on a text-heavy window to verify');
    }
  } catch (err: any) {
    fail('OCR', err?.message || String(err));
  }

  try {
    const out = await desktopGetAccessibilityTree(undefined, 2, 40);
    if (out.startsWith('ERROR:')) fail('UI Automation', out);
    else ok('UI Automation', `returned ${out.split(/\r?\n/).length} line(s) from active window`);
  } catch (err: any) {
    fail('UI Automation', err?.message || String(err));
  }

  try {
    const backend = resolveDesktopCaptureBackend();
    (backend.active === 'graphics_capture' ? ok : warn)('Capture backend', `${backend.active} (requested=${backend.requested}). ${backend.reason}`);
  } catch (err: any) {
    warn('Capture backend', err?.message || String(err));
  }

  try {
    const toolNames = getDesktopToolNames();
    ok('Tool registry', `${toolNames.length} desktop tool definitions exposed; canonical model + window-scoped input available`);
  } catch (err: any) {
    warn('Tool registry', err?.message || String(err));
  }

  const packet = getDesktopAdvisorPacket(sessionId);
  if (!packet) {
    warn('Tool session', 'no desktop screenshot packet cached yet');
  } else {
    const ageSec = Math.round(desktopPacketAgeMs(packet) / 1000);
    const stale = packet.actionVersion !== desktopActionVersion;
    (stale ? warn : ok)(
      'Tool session',
      `last screenshot ${packet.screenshotId} is ${ageSec}s old, actionVersion=${packet.actionVersion}, current=${desktopActionVersion}${stale ? ' (stale after desktop action)' : ''}`,
    );
  }

  if (ctx?.activeWindow) ok('Active window', describeDesktopWindowBounds(ctx.activeWindow));
  else warn('Active window', 'no active window metadata available');

  return lines.join('\n');
}

async function listWindowsInternal(): Promise<DesktopWindowInfo[]> {
  const ctx = await gatherDesktopContextInternal();
  return ctx.windows;
}

async function activeWindowInternal(): Promise<DesktopWindowInfo | null> {
  const ctx = await gatherDesktopContextInternal();
  return ctx.activeWindow;
}

export async function getDesktopActiveWindowInfo(): Promise<DesktopWindowInfo | null> {
  return activeWindowInternal();
}

/** Lightweight monitor list for coordinate conversion (desktop_click / scroll).
 *  Exported for the Win32 DesktopBackend (desktop-platform-win32.ts). */
export async function enumerateMonitorsInternal(): Promise<DesktopMonitorInfo[]> {
  const script = `
${PS_DPI_AWARE_HEADER}
Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens
$out = New-Object System.Collections.ArrayList
for ($i = 0; $i -lt $screens.Length; $i++) {
  $s = $screens[$i]
  [void]$out.Add([ordered]@{
    index = $i
    left = [int]$s.Bounds.Left
    top = [int]$s.Bounds.Top
    width = [int]$s.Bounds.Width
    height = [int]$s.Bounds.Height
    primary = [bool]$s.Primary
    deviceName = [string]$s.DeviceName
  })
}
@($out.ToArray()) | ConvertTo-Json -Compress -Depth 4
`;
  const raw = await runPowerShell(script, { timeoutMs: 8000, sta: true });
  return normalizeMonitors(parseJsonMaybe(raw));
}

export type DesktopCaptureMode = { kind: 'all' } | { kind: 'primary' } | { kind: 'monitor'; index: number };

export function parseScreenshotCaptureMode(opts?: DesktopScreenshotOptions): DesktopCaptureMode {
  const c = opts?.capture;
  if (typeof c === 'number' && Number.isFinite(c) && c >= 0) {
    return { kind: 'monitor', index: Math.floor(c) };
  }
  if (c === 'primary') return { kind: 'primary' };
  return { kind: 'all' };
}

export async function captureScreenshotInternal(
  mode: DesktopCaptureMode = { kind: 'all' },
  cropRegion?: [number, number, number, number],
): Promise<{
  path: string;
  width: number;
  height: number;
  left: number;
  top: number;
  captureMode: 'all' | 'primary' | 'monitor';
  captureMonitorIndex?: number;
}> {
  // VirtualScreen spans all monitors. On multi-monitor + DPI scaling, bounds may be
  // in virtual coordinates (not physical pixels). Capture is DPI-aware.
  const modeStr = mode.kind === 'all' ? 'all' : mode.kind === 'primary' ? 'primary' : 'monitor';
  const midx = mode.kind === 'monitor' ? mode.index : 0;
  const script = `
${PS_DPI_AWARE_HEADER}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$mode = '${modeStr}'
$midx = ${midx}
$bounds = $null
if ($mode -eq 'all') {
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
} elseif ($mode -eq 'primary') {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
} else {
  $arr = [System.Windows.Forms.Screen]::AllScreens
  if ($midx -lt 0 -or $midx -ge $arr.Length) {
    [PSCustomObject]@{
      error = 'invalid_monitor_index'
      monitorCount = $arr.Length
      path = $null
      width = 0
      height = 0
      left = 0
      top = 0
    } | ConvertTo-Json -Compress
    return
  }
  $bounds = $arr[$midx].Bounds
}
if ($bounds.Width -lt 1 -or $bounds.Height -lt 1) {
  [PSCustomObject]@{ error = 'bad_bounds'; path = $null; width = 0; height = 0; left = 0; top = 0 } | ConvertTo-Json -Compress
  return
}
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bmp.Size)
$g.Dispose()
# --- Crop region if specified (virtual-screen coords) ---
$cropX1 = ${cropRegion ? Math.round(cropRegion[0]) : -1}
$cropY1 = ${cropRegion ? Math.round(cropRegion[1]) : -1}
$cropX2 = ${cropRegion ? Math.round(cropRegion[2]) : -1}
$cropY2 = ${cropRegion ? Math.round(cropRegion[3]) : -1}
# If monitor capture is selected, allow region to be specified in monitor-local
# coordinates (same style users see in Telegram monitor screenshots).
if ($mode -eq 'monitor' -and $cropX2 -gt $cropX1 -and $cropY2 -gt $cropY1) {
  $looksLocal = (
    $cropX1 -ge 0 -and $cropY1 -ge 0 -and
    $cropX2 -le $bounds.Width -and $cropY2 -le $bounds.Height
  )
  if ($looksLocal) {
    $cropX1 = $cropX1 + $bounds.Left
    $cropY1 = $cropY1 + $bounds.Top
    $cropX2 = $cropX2 + $bounds.Left
    $cropY2 = $cropY2 + $bounds.Top
  }
}
if ($cropX2 -gt $cropX1 -and $cropY2 -gt $cropY1) {
  $cx = [Math]::Max(0, $cropX1 - $bounds.Left)
  $cy = [Math]::Max(0, $cropY1 - $bounds.Top)
  $cw = [Math]::Min($bounds.Width - $cx, $cropX2 - $cropX1)
  $ch = [Math]::Min($bounds.Height - $cy, $cropY2 - $cropY1)
  if ($cw -gt 0 -and $ch -gt 0) {
    $actualLeft = [int]($bounds.Left + $cx)
    $actualTop = [int]($bounds.Top + $cy)
    $cropped = New-Object System.Drawing.Bitmap $cw, $ch
    $gc = [System.Drawing.Graphics]::FromImage($cropped)
    $gc.DrawImage($bmp, 0, 0, [System.Drawing.Rectangle]::new($cx, $cy, $cw, $ch), [System.Drawing.GraphicsUnit]::Pixel)
    $gc.Dispose()
    $bmp.Dispose()
    $bmp = $cropped
    $bounds = [System.Drawing.Rectangle]::new($actualLeft, $actualTop, $cw, $ch)
  }
}
# --- End crop ---
$tmp = Join-Path $env:TEMP ("prometheus-desktop-" + [guid]::NewGuid().ToString() + ".png")
$bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[PSCustomObject]@{
  path = [string]$tmp
  width = [int]$bounds.Width
  height = [int]$bounds.Height
  left = [int]$bounds.Left
  top = [int]$bounds.Top
} | ConvertTo-Json -Compress
`;
  const raw = await runPowerShell(script, { timeoutMs: 18000, sta: true });
  const parsed = parseJsonMaybe(raw) || {};
  if (parsed.error === 'invalid_monitor_index') {
    const n = Number(parsed.monitorCount || 0) || 0;
    throw new Error(
      `Invalid monitor_index ${midx} for this machine (${n} display(s); use 0..${Math.max(0, n - 1)}).`,
    );
  }
  if (parsed.error) {
    throw new Error(String(parsed.error || 'Screenshot capture failed.'));
  }
  const out = {
    path: String(parsed.path || '').trim(),
    width: Number(parsed.width || 0) || 0,
    height: Number(parsed.height || 0) || 0,
    left: Number(parsed.left || 0) || 0,
    top: Number(parsed.top || 0) || 0,
    captureMode: (mode.kind === 'all' ? 'all' : mode.kind === 'primary' ? 'primary' : 'monitor') as
      | 'all'
      | 'primary'
      | 'monitor',
    captureMonitorIndex: mode.kind === 'monitor' ? mode.index : undefined,
  };
  if (!out.path || !fs.existsSync(out.path)) {
    throw new Error('Screenshot capture failed (no output file).');
  }
  return out;
}

function findWindowsByName(allWindows: DesktopWindowInfo[], query: string): DesktopWindowInfo[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return allWindows.filter((w) =>
    w.title.toLowerCase().includes(q) || w.processName.toLowerCase().includes(q),
  );
}

/** Exported for the Win32 DesktopBackend (desktop-platform-win32.ts). */
export async function focusWindowHandle(handle: number): Promise<boolean> {
  const h = Number(handle || 0);
  if (!Number.isFinite(h) || h === 0) return false;
  // Windows restricts SetForegroundWindow from background processes.
  // Multi-step sequence for focus-stealing and stubborn windows.
  const script = `
${PS_WINAPI_HEADER}
$hWnd = [IntPtr]::new([Int64]${h})
$wsh = New-Object -ComObject WScript.Shell

# 1. Restore only if minimized (avoid changing normal window size/position)
if ([PrometheusWinApi]::IsIconic($hWnd)) {
  # SW_RESTORE = 9
  [void][PrometheusWinApi]::ShowWindowAsync($hWnd, 9)
  Start-Sleep -Milliseconds 120
}

# 2. Attach to foreground thread then SetForegroundWindow (bypasses foreground lock)
$fg = [PrometheusWinApi]::GetForegroundWindow()
$procId = 0
$fgTid = 0
$ourTid = [PrometheusWinApi]::GetCurrentThreadId()
if ($fg -ne [IntPtr]::Zero) {
  $fgTid = [PrometheusWinApi]::GetWindowThreadProcessId($fg, [ref]$procId)
  if ($fgTid -ne 0) { [void][PrometheusWinApi]::AttachThreadInput($ourTid, $fgTid, $true) }
}
$wsh.SendKeys('%')
Start-Sleep -Milliseconds 60
$ok = [PrometheusWinApi]::SetForegroundWindow($hWnd)
if ($fgTid -ne 0) { [void][PrometheusWinApi]::AttachThreadInput($ourTid, $fgTid, $false) }

# 3. Fallback: BringWindowToTop
if (-not $ok) {
  $ok = [PrometheusWinApi]::BringWindowToTop($hWnd)
  Start-Sleep -Milliseconds 80
  $ok = $ok -or [PrometheusWinApi]::SetForegroundWindow($hWnd)
}

# 4. Fallback: AppActivate by PID
if (-not $ok) {
  $procs = Get-Process | Where-Object { $_.MainWindowHandle -eq $hWnd }
  if ($procs) { $wsh.AppActivate($procs[0].Id) | Out-Null; $ok = $true }
}

if ($ok) { Write-Output "OK" } else { Write-Output "FAIL" }
`;
  const out = await runPowerShell(script, { timeoutMs: 12000 });
  return out.toUpperCase().includes('OK');
}

function shortWindowLabel(w?: DesktopWindowInfo | null): string {
  if (!w) return 'unknown';
  const title = String(w.title || '').trim() || '(untitled)';
  const proc = String(w.processName || '').trim() || 'process';
  const mon =
    w.monitorIndex !== undefined ? `, monitor=${w.monitorIndex}` : '';
  return `"${title}" (${proc}${mon})`;
}

function compactWindowList(allWindows: DesktopWindowInfo[], maxItems: number = 8): string {
  const lines = allWindows.slice(0, maxItems).map((w, i) => {
    const mon = w.monitorIndex !== undefined ? ` m=${w.monitorIndex}` : '';
    return `${i + 1}. [${w.processName}]${mon} ${w.title} (handle=${w.handle})`;
  });
  return lines.join('\n');
}

function formatMonitorsForReply(monitors: DesktopMonitorInfo[]): string {
  if (!monitors.length) return '';
  const lines = monitors.map(
    (m) =>
      `  Monitor ${m.index}: ${m.width}x${m.height} at virtual (${m.left},${m.top})${m.primary ? ' [PRIMARY]' : ''}`,
  );
  return `Monitors (${monitors.length}):\n${lines.join('\n')}`;
}

async function resolveVirtualPointerCoords(
  x: number,
  y: number,
  opts?: DesktopPointerMonitorOptions,
): Promise<{ ok: true; x: number; y: number } | { ok: false; message: string }> {
  let xx = Math.floor(Number(x));
  let yy = Math.floor(Number(y));
  if (!Number.isFinite(xx) || !Number.isFinite(yy)) {
    return { ok: false, message: 'x and y must be valid numbers.' };
  }
  if (!opts?.monitor_relative) return { ok: true, x: xx, y: yy };
  const idx = Math.floor(Number(opts.monitor_index));
  if (!Number.isFinite(idx) || idx < 0) {
    return {
      ok: false,
      message: 'monitor_relative=true requires monitor_index (0-based display index).',
    };
  }
  const monitors = await enumerateMonitorsInternal();
  const m = monitors.find((mon) => mon.index === idx) ?? monitors[idx];
  if (!m) {
    return {
      ok: false,
      message: `Invalid monitor_index ${idx} (${monitors.length} display(s) connected).`,
    };
  }
  return { ok: true, x: xx + m.left, y: yy + m.top };
}

function normalizeCoordinateSpace(
  target: DesktopCoordinateTarget,
): DesktopCoordinateSpace {
  const raw = String(target.coordinate_space || '').trim().toLowerCase();
  if (raw === 'virtual' || raw === 'monitor' || raw === 'capture' || raw === 'window') {
    return raw;
  }
  if (target.monitor_relative) return 'monitor';
  if (target.screenshot_id) return 'capture';
  if (
    (target.window_name != null && String(target.window_name).trim()) ||
    (target.window_handle != null && Number.isFinite(Number(target.window_handle)) && Number(target.window_handle) > 0)
  ) {
    return 'window';
  }
  return 'virtual';
}

function getDesktopAdvisorPacketByIdInternal(
  sessionId: string,
  screenshotId: string,
): { ok: true; packet: DesktopAdvisorPacket } | { ok: false; message: string } {
  const id = String(screenshotId || '').trim();
  if (!id) return { ok: false, message: 'screenshot_id is required.' };
  pruneDesktopPacketIndex();
  const entry = desktopPacketIndex.get(id);
  if (!entry || entry.sessionId !== sessionId) {
    return {
      ok: false,
      message: `Unknown screenshot_id "${id}". Capture a fresh desktop_screenshot or desktop_window_screenshot first.`,
    };
  }
  if (Date.now() > entry.expiresAt) {
    desktopPacketIndex.delete(id);
    return {
      ok: false,
      message: `screenshot_id "${id}" expired. Capture a fresh desktop_screenshot or desktop_window_screenshot first.`,
    };
  }
  return { ok: true, packet: entry.packet };
}

async function resolveWindowCoordinateBase(
  target: DesktopCoordinateTarget,
  packet?: DesktopAdvisorPacket,
): Promise<{ ok: true; window: DesktopWindowInfo; source: 'live' | 'snapshot' } | { ok: false; message: string }> {
  const handleNum = Number(target.window_handle);
  const hasHandle = Number.isFinite(handleNum) && handleNum > 0;
  const query = String(target.window_name || '').trim();

  let liveWindow: DesktopWindowInfo | undefined;
  if (hasHandle || query || packet?.targetWindow?.handle) {
    const ctx = await gatherDesktopContextInternal();
    if (hasHandle) {
      liveWindow = ctx.windows.find((w) => Number(w.handle) === Math.floor(handleNum));
    }
    if (!liveWindow && query) {
      liveWindow = findWindowsByName(ctx.windows, query)[0];
    }
    if (!liveWindow && packet?.targetWindow?.handle) {
      liveWindow = ctx.windows.find((w) => Number(w.handle) === Number(packet.targetWindow?.handle));
    }
  }

  if (liveWindow) {
    return { ok: true, window: liveWindow, source: 'live' };
  }
  if (packet?.targetWindow) {
    return { ok: true, window: packet.targetWindow, source: 'snapshot' };
  }

  if (hasHandle) {
    return { ok: false, message: `No window found for window_handle=${Math.floor(handleNum)}.` };
  }
  if (query) {
    return { ok: false, message: `No window matching "${query}" found.` };
  }
  return {
    ok: false,
    message: 'coordinate_space="window" requires screenshot_id from desktop_window_screenshot or window_name/window_handle.',
  };
}

export function getDesktopAdvisorPacketById(sessionId: string, screenshotId: string): DesktopAdvisorPacket | null {
  const resolved = getDesktopAdvisorPacketByIdInternal(sessionId, screenshotId);
  return resolved.ok ? resolved.packet : null;
}

export async function resolveDesktopActionPoint(
  sessionId: string,
  target: DesktopCoordinateTarget,
  label: string = 'point',
): Promise<{ ok: true; point: DesktopResolvedActionPoint } | { ok: false; message: string }> {
  const elementIndex = Number((target as any).element);
  if (Number.isFinite(elementIndex) && elementIndex > 0) {
    const screenshotId = String(target.screenshot_id || '').trim();
    if (!screenshotId) {
      return { ok: false, message: `${label}: element targeting requires screenshot_id from a SOM desktop_screenshot or desktop_window_screenshot.` };
    }
    const packetResult = getDesktopAdvisorPacketByIdInternal(sessionId, screenshotId);
    if (!packetResult.ok) return { ok: false, message: `${label}: ${packetResult.message}` };
    const packet = packetResult.packet;
    if (packet.actionVersion !== desktopActionVersion) {
      return { ok: false, message: `${label}: ${describeStaleScreenshotRequirement(packet)}` };
    }
    const element = (packet.somElements || []).find((entry) => entry.index === Math.floor(elementIndex));
    if (!element) {
      return { ok: false, message: `${label}: SOM element #${Math.floor(elementIndex)} was not found in screenshot ${screenshotId}. Capture desktop_screenshot(mode="som") or desktop_window_screenshot(mode="som") again.` };
    }
    if (packet.targetWindow && desktopPacketAgeMs(packet) > DESKTOP_SCREENSHOT_FRESH_MS) {
      return { ok: false, message: `${label}: ${describeFreshScreenshotRequirement(packet)}` };
    }
    return {
      ok: true,
      point: {
        x: element.centerX,
        y: element.centerY,
        coordinateSpace: 'capture',
        screenshotId: packet.screenshotId,
        targetWindow: packet.targetWindow,
        sourceNote: `[SOM #${element.index} ${element.role} "${element.name}" -> virtual (${element.centerX}, ${element.centerY})]`,
      },
    };
  }

  const rawX = Number(target.x);
  const rawY = Number(target.y);
  const x = Math.floor(rawX);
  const y = Math.floor(rawY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, message: `${label}: x and y must be valid numbers.` };
  }

  const coordinateSpace = normalizeCoordinateSpace(target);
  if (coordinateSpace === 'virtual') {
    return {
      ok: true,
      point: {
        x,
        y,
        coordinateSpace,
        sourceNote: '[virtual coordinates]',
      },
    };
  }

  if (coordinateSpace === 'monitor') {
    const resolved = await resolveVirtualPointerCoords(x, y, {
      monitor_relative: true,
      monitor_index: target.monitor_index,
    });
    if (!resolved.ok) return { ok: false, message: `${label}: ${resolved.message}` };
    return {
      ok: true,
      point: {
        x: resolved.x,
        y: resolved.y,
        coordinateSpace,
        sourceNote: `[monitor m=${Math.floor(Number(target.monitor_index))} -> virtual (${resolved.x}, ${resolved.y})]`,
      },
    };
  }

  let packet: DesktopAdvisorPacket | undefined;
  if (target.screenshot_id != null && String(target.screenshot_id).trim()) {
    const packetResult = getDesktopAdvisorPacketByIdInternal(sessionId, String(target.screenshot_id || ''));
    if (!packetResult.ok) return { ok: false, message: `${label}: ${packetResult.message}` };
    packet = packetResult.packet;
    if (packet.actionVersion !== desktopActionVersion) {
      return { ok: false, message: `${label}: ${describeStaleScreenshotRequirement(packet)}` };
    }
  }

  if (coordinateSpace === 'capture') {
    if (!packet) {
      return {
        ok: false,
        message: `${label}: coordinate_space="capture" requires screenshot_id from desktop_screenshot or desktop_window_screenshot.`,
      };
    }
    if (x < 0 || y < 0 || x >= packet.width || y >= packet.height) {
      return {
        ok: false,
        message: `${label}: capture-space point (${x}, ${y}) is outside screenshot ${packet.screenshotId} (${packet.width}x${packet.height}).`,
      };
    }
    if (packet.targetWindow && desktopPacketAgeMs(packet) > DESKTOP_SCREENSHOT_FRESH_MS) {
      return { ok: false, message: `${label}: ${describeFreshScreenshotRequirement(packet)}` };
    }
    const captureRegion = packet.captureRegion || {
      left: 0,
      top: 0,
      width: packet.width,
      height: packet.height,
    };
    const scaleX = Number(packet.coordinateScale?.x);
    const scaleY = Number(packet.coordinateScale?.y);
    const resolvedX = Math.floor(captureRegion.left + x * (Number.isFinite(scaleX) && scaleX > 0 ? scaleX : captureRegion.width / packet.width || 1));
    const resolvedY = Math.floor(captureRegion.top + y * (Number.isFinite(scaleY) && scaleY > 0 ? scaleY : captureRegion.height / packet.height || 1));
    const targetWindow = packet.targetWindow;
    if (targetWindow) {
      const ctx = await gatherDesktopContextInternal();
      const liveTarget = ctx.windows.find((w) => Number(w.handle) === Number(targetWindow.handle));
      if (!liveTarget) {
        return { ok: false, message: `${label}: target window from screenshot is no longer visible. Capture a fresh desktop_window_screenshot.` };
      }
      if (!sameDesktopWindowHandle(ctx.activeWindow, liveTarget)) {
        return {
          ok: false,
          message: `${label}: target window is not active (${shortWindowLabel(ctx.activeWindow)} is active). Use desktop_window_screenshot with focus_first=true and the new screenshot_id before clicking.`,
        };
      }
      if (
        [targetWindow.left, targetWindow.top, liveTarget.left, liveTarget.top].every((n) => Number.isFinite(Number(n))) &&
        (Math.floor(Number(targetWindow.left)) !== Math.floor(Number(liveTarget.left)) ||
          Math.floor(Number(targetWindow.top)) !== Math.floor(Number(liveTarget.top)))
      ) {
        return {
          ok: false,
          message: `${label}: target window moved since screenshot. Capture a fresh focused desktop_window_screenshot and use its screenshot_id.`,
        };
      }
      if (!pointInsideDesktopWindow(resolvedX, resolvedY, liveTarget)) {
        return {
          ok: false,
          message: `${label}: resolved point (${resolvedX}, ${resolvedY}) is outside active target window ${describeDesktopWindowBounds(liveTarget)}. Re-detect the button bounds from a fresh focused window screenshot.`,
        };
      }
    }
    return {
      ok: true,
      point: {
        x: resolvedX,
        y: resolvedY,
        coordinateSpace,
        screenshotId: packet.screenshotId,
        targetWindow: packet.targetWindow,
        sourceNote: `[capture ${packet.screenshotId} (${x}, ${y}) -> virtual (${resolvedX}, ${resolvedY})]`,
      },
    };
  }

  const windowResult = await resolveWindowCoordinateBase(target, packet);
  if (!windowResult.ok) return { ok: false, message: `${label}: ${windowResult.message}` };
  if (packet?.targetWindow && desktopPacketAgeMs(packet) > DESKTOP_SCREENSHOT_FRESH_MS) {
    return { ok: false, message: `${label}: ${describeFreshScreenshotRequirement(packet)}` };
  }
  const windowInfo = windowResult.window;
  const left = Number(windowInfo.left);
  const top = Number(windowInfo.top);
  const width = Number(windowInfo.width);
  const height = Number(windowInfo.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 1 || height < 1) {
    return {
      ok: false,
      message: `${label}: target window bounds are unavailable for ${describeDesktopWindowBounds(windowInfo)}.`,
    };
  }
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return {
      ok: false,
      message: `${label}: window-space point (${x}, ${y}) is outside ${describeDesktopWindowBounds(windowInfo)}.`,
    };
  }
  const resolvedX = Math.floor(left) + x;
  const resolvedY = Math.floor(top) + y;
  if (packet?.targetWindow) {
    const ctx = await gatherDesktopContextInternal();
    const liveTarget = ctx.windows.find((w) => Number(w.handle) === Number(windowInfo.handle));
    if (!liveTarget) {
      return { ok: false, message: `${label}: target window is no longer visible. Capture a fresh desktop_window_screenshot.` };
    }
    if (!sameDesktopWindowHandle(ctx.activeWindow, liveTarget)) {
      return {
        ok: false,
        message: `${label}: target window is not active (${shortWindowLabel(ctx.activeWindow)} is active). Use desktop_window_screenshot with focus_first=true and the new screenshot_id before clicking.`,
      };
    }
    if (
      [packet.targetWindow.left, packet.targetWindow.top, liveTarget.left, liveTarget.top].every((n) => Number.isFinite(Number(n))) &&
      (Math.floor(Number(packet.targetWindow.left)) !== Math.floor(Number(liveTarget.left)) ||
        Math.floor(Number(packet.targetWindow.top)) !== Math.floor(Number(liveTarget.top)))
    ) {
      return {
        ok: false,
        message: `${label}: target window moved since screenshot. Capture a fresh focused desktop_window_screenshot and use its screenshot_id.`,
      };
    }
  }
  const packetWindow = packet?.targetWindow;
  const staleNote =
    packetWindow &&
    windowResult.source === 'live' &&
    [packetWindow.left, packetWindow.top].every((n) => Number.isFinite(Number(n))) &&
    (Math.floor(Number(packetWindow.left)) !== Math.floor(left) ||
      Math.floor(Number(packetWindow.top)) !== Math.floor(top))
      ? ` moved since screenshot to (${Math.floor(left)}, ${Math.floor(top)})`
      : '';
  return {
    ok: true,
    point: {
      x: resolvedX,
      y: resolvedY,
      coordinateSpace,
      screenshotId: packet?.screenshotId,
      targetWindow: windowInfo,
      sourceNote:
        `[window ${describeDesktopWindowBounds(windowInfo)} local (${x}, ${y}) -> virtual (${resolvedX}, ${resolvedY})` +
        `${staleNote}]`,
    },
  };
}

function computeContentHash(base64: string): string {
  return crypto.createHash('sha1').update(base64 || '').digest('hex');
}

function createDesktopAdvisorPacket(input: {
  screenshotBase64: string;
  screenshotMime?: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  capturedAt: number;
  openWindows: DesktopWindowInfo[];
  activeWindow?: DesktopWindowInfo;
  ocrText?: string;
  ocrConfidence?: number;
  monitors?: DesktopMonitorInfo[];
  virtualScreen?: { left: number; top: number; width: number; height: number };
  captureRegion?: { left: number; top: number; width: number; height: number };
  coordinateScale?: { x: number; y: number };
  normalizedScreenshot?: DesktopAdvisorPacket['normalizedScreenshot'];
  captureMode?: 'all' | 'primary' | 'monitor';
  captureMonitorIndex?: number;
  activeMonitorIndex?: number | null;
  targetWindow?: DesktopWindowInfo;
  somElements?: DesktopSomElement[];
  actionVersion?: number;
}): DesktopAdvisorPacket {
  const contentHash = computeContentHash(input.screenshotBase64);
  return {
    screenshotId: makeDesktopScreenshotId(input.capturedAt, contentHash),
    screenshotBase64: input.screenshotBase64,
    screenshotMime: input.screenshotMime || 'image/png',
    width: input.width,
    height: input.height,
    capturedAt: input.capturedAt,
    openWindows: input.openWindows,
    activeWindow: input.activeWindow,
    ocrText: input.ocrText,
    ocrConfidence: input.ocrConfidence,
    contentHash,
    monitors: input.monitors,
    virtualScreen: input.virtualScreen,
    captureRegion: input.captureRegion,
    coordinateScale: input.coordinateScale,
    normalizedScreenshot: input.normalizedScreenshot,
    captureMode: input.captureMode,
    captureMonitorIndex: input.captureMonitorIndex,
    activeMonitorIndex: input.activeMonitorIndex,
    targetWindow: input.targetWindow,
    somElements: input.somElements,
    actionVersion: input.actionVersion ?? desktopActionVersion,
  };
}

function storeDesktopPacket(sessionId: string, packet: DesktopAdvisorPacket): void {
  sessions.set(sessionId, { lastPacket: packet });
  registerDesktopPacket(sessionId, packet);
}

interface DesktopVerificationSnapshot {
  path: string;
  width: number;
  height: number;
  region: { left: number; top: number; width: number; height: number };
  hash: string;
  activeWindow: DesktopWindowInfo | null;
}

function computeBinaryHash(buffer: Buffer): string {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function normalizedWindowHandle(windowInfo?: DesktopWindowInfo | null): number {
  const handle = Number(windowInfo?.handle || 0);
  return Number.isFinite(handle) ? Math.floor(handle) : 0;
}

function normalizeOcrText(text?: string | null): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function buildProbeRegionAroundPoint(
  x: number,
  y: number,
  radiusX: number,
  radiusY: number = radiusX,
): [number, number, number, number] {
  const xx = Math.floor(Number(x));
  const yy = Math.floor(Number(y));
  const rx = Math.max(24, Math.floor(Number(radiusX) || 80));
  const ry = Math.max(24, Math.floor(Number(radiusY) || rx));
  return [xx - rx, yy - ry, xx + rx, yy + ry];
}

async function captureDesktopVerificationSnapshot(
  region: [number, number, number, number],
): Promise<DesktopVerificationSnapshot> {
  const [ctx, shot] = await Promise.all([
    gatherDesktopContextInternal(),
    captureScreenshotInternal({ kind: 'all' }, region),
  ]);
  const png = fs.readFileSync(shot.path);
  return {
    path: shot.path,
    width: shot.width,
    height: shot.height,
    region: {
      left: shot.left,
      top: shot.top,
      width: shot.width,
      height: shot.height,
    },
    hash: computeBinaryHash(png),
    activeWindow: ctx.activeWindow,
  };
}

function cleanupDesktopVerificationSnapshot(snapshot?: DesktopVerificationSnapshot | null): void {
  if (!snapshot?.path) return;
  try { fs.unlinkSync(snapshot.path); } catch {}
}

function isDesktopAutoVerificationPreferred(coordinateSpace?: DesktopCoordinateSpace): boolean {
  return coordinateSpace === 'capture' || coordinateSpace === 'window';
}

export function resolveDesktopVerificationMode(
  value: unknown,
  coordinateSpace?: DesktopCoordinateSpace,
): DesktopVerificationMode {
  if (value === false || value === 'false') return 'off';
  if (value === true || value === 'true') {
    return isDesktopAutoVerificationPreferred(coordinateSpace) ? 'strict' : 'auto';
  }
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'auto' || raw === 'strict') return raw;
  return isDesktopAutoVerificationPreferred(coordinateSpace) ? 'auto' : 'off';
}

export async function desktopMovePointer(x: number, y: number, settleMs: number = 40): Promise<void> {
  const xx = Math.floor(Number(x));
  const yy = Math.floor(Number(y));
  const waitMs = Math.max(0, Math.min(1000, Math.floor(Number(settleMs) || 40)));
  const script = `
${PS_DPI_AWARE_HEADER}
${PS_INPUTAPI_HEADER}
[void][PrometheusInputApi]::SetCursorPos(${xx}, ${yy})
${waitMs > 0 ? `Start-Sleep -Milliseconds ${waitMs}` : ''}
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 4000 });
}

export async function desktopPerformClickAtCurrent(
  button: 'left' | 'right',
  repeat: number,
  modifier?: 'shift' | 'ctrl' | 'alt',
): Promise<void> {
  const btn = button === 'right' ? 'right' : 'left';
  const downFlag = btn === 'right' ? '0x0008' : '0x0002';
  const upFlag = btn === 'right' ? '0x0010' : '0x0004';
  const clicks = Math.max(1, Math.min(4, Math.floor(Number(repeat) || 1)));
  const modVk = modifier === 'shift' ? '0x10' : modifier === 'ctrl' ? '0x11' : modifier === 'alt' ? '0x12' : null;
  const modDown = modVk ? `[PrometheusInputApi]::keybd_event(${modVk}, 0, 0, [UIntPtr]::Zero)` : '';
  const modUp = modVk ? `[PrometheusInputApi]::keybd_event(${modVk}, 0, 0x0002, [UIntPtr]::Zero)` : '';
  const script = `
${PS_DPI_AWARE_HEADER}
${PS_INPUTAPI_HEADER}
${modDown}
for ($i = 0; $i -lt ${clicks}; $i++) {
  [PrometheusInputApi]::mouse_event(${downFlag}, 0, 0, 0, [UIntPtr]::Zero)
  [PrometheusInputApi]::mouse_event(${upFlag}, 0, 0, 0, [UIntPtr]::Zero)
  if ($i -lt ${clicks - 1}) { Start-Sleep -Milliseconds 80 }
}
${modUp}
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 4000 });
}

export async function desktopPerformScrollAtCurrent(
  delta: number,
  horizontal: boolean,
): Promise<void> {
  const flag = horizontal ? '0x1000' : '0x0800';
  const script = `
${PS_DPI_AWARE_HEADER}
${PS_INPUTAPI_HEADER}
[PrometheusInputApi]::mouse_event(${flag}, 0, 0, [int]${Math.floor(Number(delta) || 0)}, [UIntPtr]::Zero)
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 4000 });
}

/** Press-drag-release between two resolved virtual-coord points. Extracted from
 *  desktopDrag so the Win32 DesktopBackend can wrap it. Coords are assumed
 *  already resolved/validated; `steps` is clamped here. */
export async function desktopPerformDragInternal(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  steps: number,
): Promise<void> {
  const st = Math.max(2, Math.min(100, Math.floor(Number(steps) || 20)));
  const script = `
${PS_DPI_AWARE_HEADER}
${PS_INPUTAPI_HEADER}
[void][PrometheusInputApi]::SetCursorPos(${fx}, ${fy})
Start-Sleep -Milliseconds 30
[PrometheusInputApi]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
for ($i = 1; $i -le ${st}; $i++) {
  $x = [int](${fx} + ((${tx} - ${fx}) * $i / ${st}))
  $y = [int](${fy} + ((${ty} - ${fy}) * $i / ${st}))
  [void][PrometheusInputApi]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 8
}
[PrometheusInputApi]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 9000 });
}

async function loadSnapshotOcrText(snapshot: DesktopVerificationSnapshot | null | undefined): Promise<string> {
  if (!snapshot?.path) return '';
  const ocr = await runOcr(snapshot.path);
  return normalizeOcrText(ocr?.text);
}

function formatDesktopVerification(
  verification: DesktopActionVerification,
  attempt?: { current: number; total: number },
): string {
  const attemptPrefix =
    attempt && attempt.total > 1
      ? attempt.current > 1
        ? ` after retry ${attempt.current}/${attempt.total}`
        : ' on first attempt'
      : '';
  return `Verification: ${verification.status}${attemptPrefix} (${verification.summary}).`;
}

function classifyDesktopVerification(args: {
  action: 'click' | 'scroll' | 'drag';
  mode: DesktopVerificationMode;
  before: DesktopVerificationSnapshot;
  after: DesktopVerificationSnapshot;
  beforeOcr: string;
  afterOcr: string;
}): DesktopActionVerification {
  const { action, before, after, beforeOcr, afterOcr } = args;
  const signals: DesktopVerificationSignal[] = [];
  const beforeHandle = normalizedWindowHandle(before.activeWindow);
  const afterHandle = normalizedWindowHandle(after.activeWindow);
  const activeWindowChanged = beforeHandle !== afterHandle;
  signals.push({
    kind: 'active_window',
    state: activeWindowChanged ? 'changed' : 'unchanged',
    detail: activeWindowChanged
      ? `${shortWindowLabel(before.activeWindow)} -> ${shortWindowLabel(after.activeWindow)}`
      : `stayed on ${shortWindowLabel(after.activeWindow)}`,
    strength: 'strong',
  });

  const probeHashChanged = before.hash !== after.hash;
  signals.push({
    kind: 'probe_hash',
    state: probeHashChanged ? 'changed' : 'unchanged',
    detail: probeHashChanged
      ? `probe region ${before.region.width}x${before.region.height} changed`
      : `probe region ${before.region.width}x${before.region.height} stayed identical`,
    strength: action === 'drag' ? 'weak' : 'strong',
  });

  const hasOcr = !!beforeOcr || !!afterOcr;
  const probeOcrChanged = hasOcr ? beforeOcr !== afterOcr : false;
  signals.push({
    kind: 'probe_ocr',
    state: hasOcr ? (probeOcrChanged ? 'changed' : 'unchanged') : 'unavailable',
    detail: hasOcr
      ? probeOcrChanged
        ? `OCR changed from "${beforeOcr.slice(0, 60)}" to "${afterOcr.slice(0, 60)}"`
        : 'OCR text stayed unchanged'
      : 'No OCR text detected in the probe region',
    strength: 'weak',
  });

  if (activeWindowChanged) {
    return {
      status: 'confirmed',
      summary: 'active window changed after the action',
      signals,
    };
  }

  if (action === 'drag') {
    if (probeOcrChanged) {
      return {
        status: 'confirmed',
        summary: 'destination region text changed after the drag',
        signals,
      };
    }
    if (probeHashChanged) {
      return {
        status: 'uncertain',
        summary: 'destination region changed after the drag, but drag verification is visually noisy',
        signals,
      };
    }
    return {
      status: 'likely_noop',
      summary: 'no destination-region change detected after the drag',
      signals,
    };
  }

  if (probeHashChanged || probeOcrChanged) {
    return {
      status: 'confirmed',
      summary: probeOcrChanged
        ? 'target region changed and OCR shifted after the action'
        : 'target region changed after the action',
      signals,
    };
  }

  return {
    status: 'likely_noop',
    summary: 'no local change detected and the active window stayed the same',
    signals,
  };
}

async function verifyDesktopAction(options: {
  action: 'click' | 'scroll' | 'drag';
  mode: DesktopVerificationMode;
  targetX: number;
  targetY: number;
  actionFn: () => Promise<void>;
  beforeRadius?: number;
  afterSettleMs?: number;
}): Promise<DesktopActionVerification> {
  const radius = Math.max(32, Math.floor(Number(options.beforeRadius) || (options.action === 'scroll' ? 120 : 84)));
  const region = buildProbeRegionAroundPoint(options.targetX, options.targetY, radius);
  let before: DesktopVerificationSnapshot | null = null;
  let after: DesktopVerificationSnapshot | null = null;
  try {
    before = await captureDesktopVerificationSnapshot(region);
    await options.actionFn();
    await new Promise((resolve) => setTimeout(resolve, Math.max(60, Math.floor(Number(options.afterSettleMs) || 180))));
    after = await captureDesktopVerificationSnapshot(region);
    const shouldCheckOcr =
      options.mode === 'strict' ||
      before.hash === after.hash ||
      options.action === 'drag';
    const [beforeOcr, afterOcr] = shouldCheckOcr
      ? await Promise.all([loadSnapshotOcrText(before), loadSnapshotOcrText(after)])
      : ['', ''];
    return classifyDesktopVerification({
      action: options.action,
      mode: options.mode,
      before,
      after,
      beforeOcr,
      afterOcr,
    });
  } catch (error: any) {
    return {
      status: options.mode === 'strict' ? 'failed' : 'uncertain',
      summary: `verification probe failed: ${error?.message || error}`,
      signals: [],
    };
  } finally {
    cleanupDesktopVerificationSnapshot(before);
    cleanupDesktopVerificationSnapshot(after);
  }
}

async function runOcr(imagePath: string): Promise<{ text: string; confidence: number } | null> {
  try {
    const ocrEnabled = String(process.env.PROMETHEUS_DESKTOP_OCR || '1').trim() !== '0';
    if (!ocrEnabled) return null;
    const timeoutMs = clampInt(process.env.PROMETHEUS_OCR_TIMEOUT_MS, 1000, 120000, 15000);
    const ocrCacheDir = path.join(
      process.env.PROMETHEUS_DATA_DIR ? path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus') : path.join(process.cwd(), '.prometheus'),
      'ocr-cache'
    );
    fs.mkdirSync(ocrCacheDir, { recursive: true });
    const { stdout } = await execFileAsync(
      process.execPath,
      ['-e', OCR_CHILD_SCRIPT, imagePath],
      {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        cwd: ocrCacheDir,
      },
    );
    const parsed = parseJsonMaybe(String(stdout || '').trim()) || {};
    const text = String(parsed?.text || '').trim();
    const confidence = Number(parsed?.confidence || 0) || 0;
    if (!text) return null;
    return { text: text.slice(0, 16000), confidence };
  } catch {
    return null;
  }
}

function parseSomElementsFromAccessibilityTree(treeText: string, captureRegion: { left: number; top: number; width: number; height: number }): DesktopSomElement[] {
  const interactiveRoles = new Set([
    'Button', 'Edit', 'ComboBox', 'ListItem', 'MenuItem', 'Hyperlink', 'CheckBox', 'RadioButton',
    'TabItem', 'TreeItem', 'DataItem', 'Document', 'Pane', 'Text', 'Slider', 'Thumb',
  ]);
  const out: DesktopSomElement[] = [];
  for (const raw of String(treeText || '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^([A-Za-z][A-Za-z0-9_ -]*)(?::\s*"([^"]*)")?.*\((-?\d+),(-?\d+)\s+(\d+)x(\d+)\)/);
    if (!m) continue;
    const role = String(m[1] || '').trim();
    const name = String(m[2] || '').replace(/\s+/g, ' ').trim();
    const x = Number(m[3]);
    const y = Number(m[4]);
    const width = Number(m[5]);
    const height = Number(m[6]);
    if (![x, y, width, height].every(Number.isFinite) || width < 8 || height < 8) continue;
    if (!interactiveRoles.has(role) && !name) continue;
    const cx = x + width / 2;
    const cy = y + height / 2;
    if (
      cx < captureRegion.left ||
      cy < captureRegion.top ||
      cx >= captureRegion.left + captureRegion.width ||
      cy >= captureRegion.top + captureRegion.height
    ) continue;
    out.push({
      index: out.length + 1,
      role,
      name: name.slice(0, 80),
      x,
      y,
      width,
      height,
      centerX: Math.round(cx),
      centerY: Math.round(cy),
    });
    if (out.length >= 80) break;
  }
  return out;
}

async function renderSomOverlay(
  input: Buffer,
  elements: DesktopSomElement[],
  captureRegion: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  if (!elements.length) return input;
  const image = await Jimp.read(input);
  const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  const scaleX = image.bitmap.width / Math.max(1, captureRegion.width);
  const scaleY = image.bitmap.height / Math.max(1, captureRegion.height);
  const red = Jimp.rgbaToInt(220, 38, 38, 255);
  const yellow = Jimp.rgbaToInt(250, 204, 21, 255);
  const black = Jimp.rgbaToInt(0, 0, 0, 210);

  const drawRect = (x: number, y: number, w: number, h: number, color: number) => {
    const x1 = Math.max(0, Math.min(image.bitmap.width - 1, Math.round(x)));
    const y1 = Math.max(0, Math.min(image.bitmap.height - 1, Math.round(y)));
    const x2 = Math.max(0, Math.min(image.bitmap.width - 1, Math.round(x + w)));
    const y2 = Math.max(0, Math.min(image.bitmap.height - 1, Math.round(y + h)));
    for (let xx = x1; xx <= x2; xx++) {
      image.setPixelColor(color, xx, y1);
      image.setPixelColor(color, xx, y2);
    }
    for (let yy = y1; yy <= y2; yy++) {
      image.setPixelColor(color, x1, yy);
      image.setPixelColor(color, x2, yy);
    }
  };

  for (const el of elements) {
    const x = (el.x - captureRegion.left) * scaleX;
    const y = (el.y - captureRegion.top) * scaleY;
    const w = Math.max(6, el.width * scaleX);
    const h = Math.max(6, el.height * scaleY);
    drawRect(x, y, w, h, yellow);
    const label = String(el.index);
    const labelW = Math.max(22, label.length * 10 + 8);
    const labelH = 20;
    const lx = Math.max(0, Math.min(image.bitmap.width - labelW, Math.round(x)));
    const ly = Math.max(0, Math.min(image.bitmap.height - labelH, Math.round(y)));
    for (let yy = ly; yy < ly + labelH; yy++) {
      for (let xx = lx; xx < lx + labelW; xx++) image.setPixelColor(red, xx, yy);
    }
    drawRect(lx, ly, labelW, labelH, black);
    image.print(font, lx + 5, ly + 1, label);
  }
  return image.getBufferAsync(Jimp.MIME_PNG);
}

function formatSomElements(elements: DesktopSomElement[]): string {
  if (!elements.length) return '';
  const lines = elements.slice(0, 40).map((el) => {
    const name = el.name ? ` "${el.name}"` : '';
    return `#${el.index} ${el.role}${name} @ (${el.x},${el.y}) ${el.width}x${el.height}`;
  });
  return `SOM elements (${elements.length}; click with desktop_click(element:N, screenshot_id:"...")):\n${lines.join('\n')}`;
}

export async function desktopScreenshot(
  sessionId: string,
  options?: DesktopScreenshotOptions,
): Promise<string> {
  ensureWindows();
  let shot: Awaited<ReturnType<typeof captureScreenshotInternal>>;
  let ctx: DesktopContextGathered;
  try {
    const capMode = parseScreenshotCaptureMode(options);
    [ctx, shot] = await Promise.all([
      gatherDesktopContextInternal(),
      captureScreenshotInternal(capMode, options?.region),
    ]);
  } catch (e: any) {
    return `ERROR: ${e?.message || e}`;
  }

  const openWindows = ctx.windows;
  const activeWindow = ctx.activeWindow;
  const ocr = options?.skipOcr === true ? null : await runOcr(shot.path);

  let png: Buffer = fs.readFileSync(shot.path);
  try { fs.unlinkSync(shot.path); } catch {}
  const captureRegion = { left: shot.left, top: shot.top, width: shot.width, height: shot.height };
  let somElements: DesktopSomElement[] = [];
  if (options?.som === true) {
    const treeText = await desktopGetAccessibilityTree(undefined, 5, 500).catch(() => '');
    somElements = parseSomElementsFromAccessibilityTree(treeText, captureRegion);
    png = await renderSomOverlay(png, somElements, captureRegion).catch((): Buffer => png);
  }

  const normalized = await normalizeScreenshotBuffer(png, {
    maxSide: Number(process.env.PROMETHEUS_DESKTOP_SCREENSHOT_MAX_SIDE || process.env.PROMETHEUS_SCREENSHOT_MAX_SIDE || 2400),
    maxBytes: Number(process.env.PROMETHEUS_DESKTOP_SCREENSHOT_MAX_BYTES || process.env.PROMETHEUS_SCREENSHOT_MAX_BYTES || 5 * 1024 * 1024),
    preferJpeg: true,
  }).catch(() => null);
  const imageBuffer = normalized?.buffer || png;
  const imageWidth = normalized?.width || shot.width;
  const imageHeight = normalized?.height || shot.height;
  const screenshotBase64 = imageBuffer.toString('base64');
  const capturedAt = Date.now();
  const vs = ctx.virtualScreen;
  const activeMonitorIndex =
    activeWindow?.monitorIndex !== undefined && activeWindow.monitorIndex >= 0
      ? activeWindow.monitorIndex
      : null;

  const packet = createDesktopAdvisorPacket({
    screenshotBase64,
    screenshotMime: normalized?.mimeType || 'image/png',
    width: imageWidth,
    height: imageHeight,
    capturedAt,
    openWindows,
    activeWindow: activeWindow || undefined,
    ocrText: ocr?.text,
    ocrConfidence: ocr?.confidence,
    monitors: ctx.monitors.length ? ctx.monitors : undefined,
    virtualScreen: vs.width > 0 ? vs : undefined,
    captureRegion,
    coordinateScale: {
      x: shot.width / Math.max(1, imageWidth),
      y: shot.height / Math.max(1, imageHeight),
    },
    normalizedScreenshot: normalized?.normalized
      ? {
          originalWidth: shot.width,
          originalHeight: shot.height,
          originalBytes: normalized.originalBytes,
          bytes: normalized.bytes,
        }
      : undefined,
    captureMode: shot.captureMode,
    captureMonitorIndex: shot.captureMonitorIndex,
    activeMonitorIndex,
    somElements: somElements.length ? somElements : undefined,
  });
  storeDesktopPacket(sessionId, packet);

  const topWindows = compactWindowList(openWindows, 12);
  const ocrPreview = ocr?.text ? ocr.text.slice(0, 400).replace(/\s+/g, ' ').trim() : '';
  const ocrLen = ocr?.text ? ocr.text.length : 0;

  const noOcrHint = !ocrPreview
    ? '\nNo OCR text available. Use desktop_screenshot (vision models see the attached image), then desktop_click / desktop_scroll / desktop_focus_window as needed. Use desktop_window_screenshot to zoom into a specific app window.'
    : '';

  const virtualLine =
    vs.width > 0
      ? `Virtual desktop bounding box: top-left (${vs.left}, ${vs.top}), size ${vs.width}x${vs.height} (all desktop_click coords use this space).`
      : '';

  const captureSummary =
    shot.captureMode === 'all'
      ? 'Capture: full virtual desktop (all monitors).'
      : shot.captureMode === 'primary'
        ? 'Capture: primary monitor only.'
        : `Capture: monitor ${shot.captureMonitorIndex} only.`;

  const coordHint =
    shot.captureMode === 'all'
      ? `Coordinates: (0,0) in this image = virtual top-left (${shot.left}, ${shot.top}). For desktop_click / scroll at screenshot pixel (x,y), use coordinate_space="capture" with screenshot_id="${packet.screenshotId}".`
      : `Coordinates: pixels in this image are relative to capture top-left (${shot.left}, ${shot.top}). For desktop_click / scroll at (x,y), use coordinate_space="capture" with screenshot_id="${packet.screenshotId}" to let the tool convert image coords automatically. If capture mode is monitor N, you can also use coordinate_space="monitor" with monitor_index=N and local monitor coordinates directly.`;

  const activeMonLine =
    activeMonitorIndex !== null
      ? `Active (foreground) window is on monitor ${activeMonitorIndex}.`
      : '';

  const screenshotIdLine = `Screenshot ID: ${packet.screenshotId}.`;
  const screenshotUsageLine =
    `Use desktop_click/desktop_scroll with {x, y, coordinate_space:"capture", screenshot_id:"${packet.screenshotId}"} to target this exact screenshot; recapture after focus or window movement.`;

  return [
    `Desktop screenshot captured (${imageWidth}x${imageHeight}${normalized?.normalized ? `, normalized from ${shot.width}x${shot.height}` : ''}).`,
    screenshotIdLine,
    captureSummary,
    virtualLine,
    formatMonitorsForReply(ctx.monitors),
    activeMonLine,
    coordHint,
    screenshotUsageLine,
    options?.som ? formatSomElements(somElements) || 'SOM mode requested, but no UI Automation elements were found inside this capture.' : '',
    `Active window: ${shortWindowLabel(activeWindow)}.`,
    `Open windows: ${openWindows.length}.`,
    ocrPreview ? `OCR text (${Math.round(ocr?.confidence || 0)}% confidence):\n${ocrPreview}${ocrLen > 400 ? ' ...' : ''}` : `OCR: unavailable.${noOcrHint}`,
    topWindows ? `All visible windows:\n${topWindows}` : '',
  ].filter(Boolean).join('\n');
}

export async function desktopFindWindow(name: string): Promise<string> {
  ensureWindows();
  const query = String(name || '').trim();
  if (!query) return 'ERROR: name is required.';
  const allWindows = await listWindowsInternal();
  const matches = findWindowsByName(allWindows, query);
  if (matches.length === 0) {
    return `No windows matching "${query}" were found.`;
  }
  const lines = matches.slice(0, 20).map((w, i) => {
    const mon = w.monitorIndex !== undefined ? ` m=${w.monitorIndex}` : '';
    return `${i + 1}. [${w.processName}]${mon} ${w.title} (handle=${w.handle})`;
  });
  return `Found ${matches.length} window(s) for "${query}":\n${lines.join('\n')}`;
}

export async function desktopFocusWindow(name: string): Promise<string> {
  ensureWindows();
  const query = String(name || '').trim();
  if (!query) return 'ERROR: name is required.';
  const allWindows = await listWindowsInternal();
  const matches = findWindowsByName(allWindows, query);
  if (matches.length === 0) {
    return `ERROR: No window matching "${query}" found.`;
  }
  const target = matches[0];
  const focused = await focusWindowHandle(target.handle);
  if (!focused) {
    return `ERROR: Failed to focus "${target.title}" (${target.processName}).`;
  }
  markDesktopStateChanged();
  return `Focused window: "${target.title}" (${target.processName}).`;
}

export async function desktopWindowControl(
  action: 'minimize' | 'maximize' | 'restore' | 'close',
  selector?: { name?: string; handle?: number; active?: boolean },
): Promise<string> {
  ensureWindows();
  const query = String(selector?.name || '').trim();
  const handleNum = Number(selector?.handle || 0);
  const hasHandle = Number.isFinite(handleNum) && handleNum > 0;
  const useActive = selector?.active === true || (!query && !hasHandle);
  const ctx = await gatherDesktopContextInternal();
  let target: DesktopWindowInfo | null = null;
  if (hasHandle) target = ctx.windows.find((w) => Number(w.handle) === Math.floor(handleNum)) || null;
  if (!target && query) target = findWindowsByName(ctx.windows, query)[0] || null;
  if (!target && useActive) target = ctx.activeWindow;
  if (!target) {
    return hasHandle
      ? `ERROR: No window found for handle=${Math.floor(handleNum)}.`
      : query
        ? `ERROR: No window matching "${query}" found.`
        : 'ERROR: No active window found.';
  }

  if (action !== 'minimize') {
    await focusWindowHandle(target.handle).catch(() => false);
    await new Promise((r) => setTimeout(r, 120));
  }

  try {
    await windowControlInternal(target.handle, action);
    return `${action[0].toUpperCase()}${action.slice(1)} requested for "${target.title}" (${target.processName}, handle=${target.handle}).`;
  } catch (e: any) {
    return `ERROR: Failed to ${action} "${target.title}" (${target.processName}): ${e?.message || e}`;
  }
}

/** Minimize/maximize/restore via ShowWindowAsync, or close via WM_CLOSE. The
 *  public desktopWindowControl handles target resolution and focus-first;
 *  this primitive just performs the action on a known handle. Exported for the
 *  Win32 DesktopBackend. */
export async function windowControlInternal(
  handle: number,
  action: 'minimize' | 'maximize' | 'restore' | 'close',
): Promise<void> {
  const h = Math.floor(Number(handle));
  const command = action === 'maximize' ? 3 : action === 'minimize' ? 6 : action === 'restore' ? 9 : 0;
  const script = action === 'close'
    ? `
${PS_WINAPI_HEADER}
$hWnd = [IntPtr]::new([Int64]${h})
[void][PrometheusWinApi]::PostMessage($hWnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output "OK"
`
    : `
${PS_WINAPI_HEADER}
$hWnd = [IntPtr]::new([Int64]${h})
[void][PrometheusWinApi]::ShowWindowAsync($hWnd, ${command})
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 5000 });
}

export async function desktopClick(
  x: number,
  y: number,
  button: 'left' | 'right' = 'left',
  doubleClick: boolean = false,
  pointerOpts?: DesktopPointerMonitorOptions,
  modifier?: 'shift' | 'ctrl' | 'alt',
  sourceNote?: string,
  verificationOpts?: DesktopActionVerificationOptions,
): Promise<string> {
  ensureWindows();
  const resolved = await resolveVirtualPointerCoords(x, y, pointerOpts);
  if (!resolved.ok) return `ERROR: ${resolved.message}`;
  let xx = resolved.x;
  let yy = resolved.y;
  const btn = button === 'right' ? 'right' : 'left';
  const repeat = doubleClick ? 2 : 1;
  const verificationMode = resolveDesktopVerificationMode(
    verificationOpts?.mode,
    verificationOpts?.coordinateSpace,
  );
  const attempts = (verificationMode !== 'off'
    && verificationOpts?.allowRetryOnLikelyNoop === true
    && btn === 'left'
    && repeat === 1
    && !modifier)
    ? [
        { x: xx, y: yy },
        { x: xx - 4, y: yy - 4 },
        { x: xx + 4, y: yy + 4 },
      ]
    : [{ x: xx, y: yy }];
  let verificationSummary = '';
  let finalX = xx;
  let finalY = yy;
  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const attempt = attempts[attemptIndex];
    finalX = attempt.x;
    finalY = attempt.y;
    await desktopMovePointer(finalX, finalY, 40);
    if (verificationMode === 'off') {
      await desktopPerformClickAtCurrent(btn, repeat, modifier);
      break;
    }
    const verification = await verifyDesktopAction({
      action: 'click',
      mode: verificationMode,
      targetX: finalX,
      targetY: finalY,
      actionFn: () => desktopPerformClickAtCurrent(btn, repeat, modifier),
      afterSettleMs: 180,
    });
    verificationSummary = formatDesktopVerification(verification, {
      current: attemptIndex + 1,
      total: attempts.length,
    });
    if (verification.status !== 'likely_noop' || attemptIndex === attempts.length - 1) {
      break;
    }
  }
  xx = finalX;
  yy = finalY;
  const monitors = await enumerateMonitorsInternal().catch(() => [] as DesktopMonitorInfo[]);
  const hit = monitors.find((m) =>
    finalX >= m.left && finalX < (m.left + m.width) && finalY >= m.top && finalY < (m.top + m.height),
  );
  const relNote =
    pointerOpts?.monitor_relative && pointerOpts.monitor_index !== undefined
      ? ` [monitor_relative m=${pointerOpts.monitor_index} → virtual (${xx}, ${yy})]`
      : '';
  const monitorNote = hit
    ? ` [monitor m=${hit.index} local=(${xx - hit.left}, ${yy - hit.top}) of ${hit.width}x${hit.height}]`
    : '';
  const modNote = modifier ? ` [+${modifier}]` : '';
  const sourceSuffix = sourceNote ? ` ${sourceNote}` : '';
  // Record for macro replay (use resolved virtual coords so replay is coordinate-safe)
  _macroRecord({ type: doubleClick ? 'double_click' : 'click', x: finalX, y: finalY, button: btn });
  markDesktopStateChanged();
  return `Clicked ${btn} at (${finalX}, ${finalY})${doubleClick ? ' [double]' : ''}${modNote}${sourceSuffix}${relNote}${monitorNote}.${verificationSummary ? ` ${verificationSummary}` : ''}`;
}

export async function desktopDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps: number = 20,
  pointerOpts?: DesktopPointerMonitorOptions,
  sourceNote?: string,
  verificationOpts?: DesktopActionVerificationOptions,
): Promise<string> {
  ensureWindows();
  const r0 = await resolveVirtualPointerCoords(fromX, fromY, pointerOpts);
  if (!r0.ok) return `ERROR: ${r0.message}`;
  const r1 = await resolveVirtualPointerCoords(toX, toY, pointerOpts);
  if (!r1.ok) return `ERROR: ${r1.message}`;
  const fx = r0.x;
  const fy = r0.y;
  const tx = r1.x;
  const ty = r1.y;
  const st = Math.max(2, Math.min(100, Math.floor(Number(steps) || 20)));
  if (![fx, fy, tx, ty].every(Number.isFinite)) {
    return 'ERROR: from_x, from_y, to_x, to_y must be valid numbers.';
  }

  const verificationMode = resolveDesktopVerificationMode(
    verificationOpts?.mode,
    verificationOpts?.coordinateSpace,
  );
  const performDrag = async (): Promise<void> => {
    await desktopPerformDragInternal(fx, fy, tx, ty, st);
  };
  let verificationSummary = '';
  if (verificationMode === 'off') {
    await performDrag();
  } else {
    const verification = await verifyDesktopAction({
      action: 'drag',
      mode: verificationMode,
      targetX: tx,
      targetY: ty,
      actionFn: performDrag,
      beforeRadius: 96,
      afterSettleMs: 220,
    });
    verificationSummary = formatDesktopVerification(verification);
  }
  const monitors = await enumerateMonitorsInternal().catch(() => [] as DesktopMonitorInfo[]);
  const startMon = monitors.find((m) =>
    fx >= m.left && fx < (m.left + m.width) && fy >= m.top && fy < (m.top + m.height),
  );
  const endMon = monitors.find((m) =>
    tx >= m.left && tx < (m.left + m.width) && ty >= m.top && ty < (m.top + m.height),
  );
  const monNote = (startMon || endMon)
    ? ` [start m=${startMon?.index ?? '?'} local=(${startMon ? fx - startMon.left : '?'}, ${startMon ? fy - startMon.top : '?'})` +
      ` -> end m=${endMon?.index ?? '?'} local=(${endMon ? tx - endMon.left : '?'}, ${endMon ? ty - endMon.top : '?'})]`
    : '';
  const sourceSuffix = sourceNote ? ` ${sourceNote}` : '';
  markDesktopStateChanged();
  return `Dragged from (${fx}, ${fy}) to (${tx}, ${ty}) in ${st} steps.${sourceSuffix}${monNote}${verificationSummary ? ` ${verificationSummary}` : ''}`;
}

export async function desktopWait(ms: number = 500): Promise<string> {
  const waitMs = Math.max(50, Math.min(30000, Math.floor(Number(ms) || 500)));
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  markDesktopStateChanged();
  return `Waited ${waitMs} ms.`;
}

/** Map a key spec ("ctrl+s", "enter") to SendKeys syntax. Delegates to the
 *  shared canonical-key model (desktop-keys.ts) so Windows and macOS share one
 *  parser and cannot drift apart. */
function toSendKeysSpec(keyRaw: string): string {
  return canonicalKeyToSendKeys(parseCanonicalKey(keyRaw));
}

/** Type text via clipboard paste (set clipboard -> Ctrl+V -> restore clipboard).
 *  Extracted from desktopType so the Win32 DesktopBackend can wrap it. Caller
 *  handles length limits, macro recording, and return formatting. */
export async function typeTextInternal(payload: string): Promise<void> {
  const escaped = psSingleQuote(payload);
  // Read current clipboard content so we can restore it after pasting.
  // Keep payload on clipboard briefly after Ctrl+V to avoid restore/paste races.
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$payload = '${escaped}'

function Set-ClipboardTextWithRetry([string]$text, [int]$attempts = 12, [int]$delayMs = 50) {
  for ($i = 0; $i -lt $attempts; $i++) {
    try {
      [System.Windows.Forms.Clipboard]::SetText($text)
      Start-Sleep -Milliseconds 35
      if ([System.Windows.Forms.Clipboard]::ContainsText() -and [System.Windows.Forms.Clipboard]::GetText() -ceq $text) {
        return $true
      }
    } catch { }
    Start-Sleep -Milliseconds $delayMs
  }
  return $false
}

$restoreClipboard = {
  param([bool]$hadText, [string]$prevText)
  if ($hadText) {
    [void](Set-ClipboardTextWithRetry -text $prevText -attempts 10 -delayMs 40)
  } else {
    try { [System.Windows.Forms.Clipboard]::Clear() } catch { }
  }
}

# 1. Snapshot existing clipboard (text only)
$prevClip = ''
$hadText = $false
if ([System.Windows.Forms.Clipboard]::ContainsText()) {
  $prevClip = [System.Windows.Forms.Clipboard]::GetText()
  $hadText = $true
}

# 2. Set payload clipboard deterministically
if (-not (Set-ClipboardTextWithRetry -text $payload)) {
  throw "Failed to set clipboard payload for desktop_type."
}

# 3. Paste, then hold payload briefly before restore so target app reads it.
try {
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 280
} finally {
  & $restoreClipboard $hadText $prevClip
}

Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 10000, sta: true });
}

/** Send a pre-built SendKeys spec via SendWait. Extracted from desktopPressKey
 *  for the Win32 DesktopBackend. */
export async function pressSendKeysSpecInternal(spec: string): Promise<void> {
  const escaped = psSingleQuote(spec);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 6000, sta: true });
}

export async function desktopType(text: string): Promise<string> {
  ensureWindows();
  const payload = String(text || '');
  if (!payload) return 'Typed 0 character(s).';

  const MAX_TYPE_LENGTH = 50000;
  if (payload.length > MAX_TYPE_LENGTH) {
    return `ERROR: Text too long (${payload.length} chars). Maximum is ${MAX_TYPE_LENGTH} chars.`;
  }

  await typeTextInternal(payload);
  _macroRecord({ type: 'type', text: payload });
  markDesktopStateChanged();
  return `Typed ${payload.length} character(s) via clipboard paste (clipboard restored).`;
}

export async function desktopPressKey(key: string): Promise<string> {
  ensureWindows();
  await pressSendKeysSpecInternal(toSendKeysSpec(key));
  _macroRecord({ type: 'key', text: key });
  markDesktopStateChanged();
  return `Pressed key: ${key || 'Enter'}.`;
}

/** Raw clipboard text read (empty string if no text). Exported for Win32Backend. */
export async function getClipboardTextInternal(): Promise<string> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
if ([System.Windows.Forms.Clipboard]::ContainsText()) {
  [System.Windows.Forms.Clipboard]::GetText()
}
`;
  return runPowerShell(script, { timeoutMs: 6000, sta: true });
}

/** Raw clipboard text write. Exported for Win32Backend. */
export async function setClipboardTextInternal(text: string): Promise<void> {
  const escaped = psSingleQuote(text);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText('${escaped}')
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 6000, sta: true });
}

export async function desktopGetClipboard(): Promise<string> {
  ensureWindows();
  const out = await getClipboardTextInternal();
  if (!out) return 'Clipboard is empty.';
  if (out.length > 5000) {
    return `Clipboard text (${out.length} chars):\n${out.slice(0, 5000)}\n...(truncated)`;
  }
  return `Clipboard text (${out.length} chars):\n${out}`;
}

const CLIPBOARD_IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.tif', '.tiff',
]);

type DesktopSetClipboardArgs =
  | string
  | {
      text?: string;
      file_path?: string;
      file_paths?: string[];
      mode?: 'auto' | 'text' | 'image' | 'files';
    };

export async function desktopSetClipboard(input: DesktopSetClipboardArgs): Promise<string> {
  ensureWindows();
  const args = typeof input === 'string' ? { text: input, mode: 'text' as const } : (input || {});
  const mode = String(args.mode || 'auto').toLowerCase() as 'auto' | 'text' | 'image' | 'files';
  const textPayload = args.text == null ? '' : String(args.text);
  const filePaths = Array.from(
    new Set(
      [args.file_path, ...(Array.isArray(args.file_paths) ? args.file_paths : [])]
        .map((p) => String(p || '').trim())
        .filter(Boolean)
        .map((p) => path.resolve(p)),
    ),
  );

  if ((mode === 'text' || (mode === 'auto' && !filePaths.length)) && !textPayload) {
    return 'Clipboard updated (0 chars).';
  }

  if ((mode === 'image' || mode === 'files' || (mode === 'auto' && filePaths.length))) {
    if (!filePaths.length) return 'ERROR: file_path or file_paths is required for non-text clipboard modes.';
    for (const filePath of filePaths) {
      if (!fs.existsSync(filePath)) return `ERROR: Clipboard source file not found: ${filePath}`;
    }
  }

  let effectiveMode = mode;
  if (mode === 'auto' && filePaths.length) {
    const allImages = filePaths.every((p) => CLIPBOARD_IMAGE_EXTS.has(path.extname(p).toLowerCase()));
    effectiveMode = allImages && filePaths.length === 1 ? 'image' : 'files';
  }

  if (effectiveMode === 'text') {
    await setClipboardTextInternal(textPayload);
    return `Clipboard updated (${textPayload.length} chars).`;
  }

  if (effectiveMode === 'image') {
    const imagePath = filePaths[0];
    const escapedPath = psSingleQuote(imagePath);
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$path = '${escapedPath}'
if (-not (Test-Path -LiteralPath $path)) { throw "Image file not found: $path" }
$img = [System.Drawing.Image]::FromFile($path)
try {
  [System.Windows.Forms.Clipboard]::SetImage($img)
  Start-Sleep -Milliseconds 50
  if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
    throw "Clipboard did not retain image payload."
  }
} finally {
  $img.Dispose()
}
Write-Output "OK"
`;
    await runPowerShell(script, { timeoutMs: 8000, sta: true });
    return `Clipboard updated with image: ${path.basename(imagePath)}.`;
  }

  if (effectiveMode === 'files') {
    const quotedPaths = filePaths.map((p) => `'${psSingleQuote(p)}'`).join(', ');
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$files = New-Object System.Collections.Specialized.StringCollection
foreach ($p in @(${quotedPaths})) {
  if (-not (Test-Path -LiteralPath $p)) { throw "Clipboard file not found: $p" }
  [void]$files.Add($p)
}
[System.Windows.Forms.Clipboard]::SetFileDropList($files)
Start-Sleep -Milliseconds 50
if (-not [System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
  throw "Clipboard did not retain file list payload."
}
Write-Output "OK"
`;
    await runPowerShell(script, { timeoutMs: 8000, sta: true });
    return `Clipboard updated with ${filePaths.length} file(s).`;
  }

  return `ERROR: Unsupported clipboard mode "${effectiveMode}".`;
}

// ─── Mouse Scroll ────────────────────────────────────────────────────────────

/**
 * Real mouse-wheel scroll using Win32 mouse_event MOUSEEVENTF_WHEEL (vertical)
 * or MOUSEEVENTF_HWHEEL (horizontal).
 * direction: 'up' | 'down' | 'left' | 'right'
 * amount: wheel ticks (1-50, default 3). More granular than before for fine control.
 * Optionally moves cursor to (x, y) before scrolling (essential for multi-pane apps).
 * Wheel delta is signed (±120 × ticks); P/Invoke must use int dwData or Electron/Chromium ignores scroll.
 */
export async function desktopScroll(
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number = 3,
  x?: number,
  y?: number,
  horizontal: boolean = false,
  pointerOpts?: DesktopPointerMonitorOptions,
  sourceNote?: string,
  verificationOpts?: DesktopActionVerificationOptions,
): Promise<string> {
  ensureWindows();
  const ticks = Math.max(1, Math.min(50, Math.floor(Number(amount) || 3)));
  const isUpOrLeft = direction === 'up' || direction === 'left';
  const delta = isUpOrLeft ? 120 * ticks : -120 * ticks;
  let mx: number | undefined;
  let my: number | undefined;
  if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
    const r = await resolveVirtualPointerCoords(Number(x), Number(y), pointerOpts);
    if (!r.ok) return `ERROR: ${r.message}`;
    mx = r.x;
    my = r.y;
  }
  const verificationMode = resolveDesktopVerificationMode(
    verificationOpts?.mode,
    verificationOpts?.coordinateSpace,
  );
  const performScroll = async (): Promise<void> => {
    if (mx !== undefined && my !== undefined) {
      await desktopMovePointer(mx, my, 75);
    }
    await desktopPerformScrollAtCurrent(delta, horizontal);
  };
  let verificationSummary = '';
  if (verificationMode !== 'off' && mx !== undefined && my !== undefined) {
    const verification = await verifyDesktopAction({
      action: 'scroll',
      mode: verificationMode,
      targetX: mx,
      targetY: my,
      actionFn: performScroll,
      beforeRadius: 120,
      afterSettleMs: 240,
    });
    verificationSummary = formatDesktopVerification(verification);
  } else if (verificationMode !== 'off') {
    await performScroll();
    verificationSummary = formatDesktopVerification({
      status: 'uncertain',
      summary: 'no explicit x/y target was provided, so scroll verification could not probe a local region',
      signals: [],
    });
  } else {
    await performScroll();
  }
  const axisLabel = horizontal ? 'horizontal' : 'vertical';
  const dirLabel = direction;
  const at =
    mx !== undefined && my !== undefined ? ` at virtual (${mx}, ${my})` : '';
  const sourceSuffix = sourceNote ? ` ${sourceNote}` : '';
  _macroRecord({ type: 'scroll', direction, amount: ticks, horizontal, x: mx, y: my });
  markDesktopStateChanged();
  return `Scrolled ${axisLabel} ${dirLabel} ${ticks} tick(s)${at}${sourceSuffix}.${verificationSummary ? ` ${verificationSummary}` : ''}`;
}

// ─── Raw key-by-key typing fallback ──────────────────────────────────────────

/**
 * Type text using raw SendKeys character by character.
 * Slower than clipboard paste but works in apps that block paste
 * (password fields, some Electron apps, terminal emulators).
 */
export async function desktopTypeRaw(text: string): Promise<string> {
  ensureWindows();
  const payload = String(text || '');
  if (!payload) return 'Typed 0 character(s).';
  if (payload.length > 2000) {
    return 'ERROR: desktopTypeRaw limited to 2000 chars. Use desktop_type for longer text.';
  }
  // Escape SendKeys special chars: + ^ % ~ { } [ ] ( )
  const escaped = payload
    .replace(/[+^%~{}\[\]()]/g, (c) => `{${c}}`)
    .replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: Math.max(8000, payload.length * 40), sta: true });
  _macroRecord({ type: 'type_raw', text: payload });
  markDesktopStateChanged();
  return `Typed ${payload.length} character(s) via raw key input.`;
}

// ─── desktop_record_macro / desktop_stop_macro / desktop_replay_macro ─────────

/**
 * Start recording a desktop macro. All subsequent desktop_click, desktop_type,
 * desktop_press_key, and desktop_scroll calls will be logged with their delays.
 * Call desktop_stop_macro() to save the recording as a named macro.
 */
export function desktopRecordMacro(name: string): string {
  const macroName = String(name || '').trim();
  if (!macroName) return 'ERROR: name is required.';
  _activeRecordingName = macroName;
  _recordingBuffer = [];
  _recordingStartTime = Date.now();
  return `Recording started for macro "${macroName}". All desktop_click, desktop_type, desktop_press_key, and desktop_scroll actions will be logged. Call desktop_stop_macro() when done.`;
}

/**
 * Stop the active macro recording and save it.
 * If name is given it overrides the name set in desktop_record_macro().
 */
export function desktopStopMacro(name?: string): string {
  if (!_activeRecordingName) return 'ERROR: No active recording. Call desktop_record_macro first.';
  const macroName = (name && String(name).trim()) || _activeRecordingName;
  const actions = [..._recordingBuffer];
  _macros.set(macroName, actions);
  _activeRecordingName = null;
  _recordingBuffer = [];
  return `Macro "${macroName}" saved — ${actions.length} action(s) recorded. Use desktop_replay_macro(name="${macroName}") to replay.`;
}

/**
 * Replay a saved macro. speed_multiplier=2.0 plays at 2× speed (shorter delays),
 * 0.5 plays at half speed. Does NOT record over the replaying — recording state
 * is paused during replay to avoid capturing the replay itself.
 */
export async function desktopReplayMacro(
  name: string,
  speedMultiplier = 1.0,
): Promise<string> {
  const macroName = String(name || '').trim();
  if (!macroName) return 'ERROR: name is required.';
  const actions = _macros.get(macroName);
  if (!actions) {
    const available = [..._macros.keys()].join(', ') || 'none';
    return `ERROR: No macro named "${macroName}". Available: ${available}`;
  }
  if (actions.length === 0) return `Macro "${macroName}" is empty.`;

  const speed = Math.max(0.1, Math.min(10, Number(speedMultiplier) || 1.0));
  // Pause recording during replay so the replay doesn't get re-recorded
  const wasRecording = _activeRecordingName;
  _activeRecordingName = null;

  let lastDelay = 0;
  try {
    for (const action of actions) {
      const waitMs = Math.round((action.delay - lastDelay) / speed);
      if (waitMs > 0) await new Promise<void>(r => setTimeout(r, waitMs));
      lastDelay = action.delay;

      switch (action.type) {
        case 'click':
        case 'double_click':
          if (action.x !== undefined && action.y !== undefined) {
            await desktopClick(action.x, action.y, action.button || 'left', action.type === 'double_click');
          }
          break;
        case 'type':
          if (action.text !== undefined) await desktopType(action.text);
          break;
        case 'type_raw':
          if (action.text !== undefined) await desktopTypeRaw(action.text);
          break;
        case 'key':
          if (action.text !== undefined) await desktopPressKey(action.text);
          break;
        case 'scroll':
          if (action.direction) {
            await desktopScroll(
              action.direction,
              action.amount || 3,
              action.x,
              action.y,
              action.horizontal || false,
            );
          }
          break;
      }
    }
  } finally {
    // Restore recording state if it was active before replay
    _activeRecordingName = wasRecording;
  }
  return `Macro "${macroName}" replayed — ${actions.length} action(s) at ${speed}× speed.`;
}

/**
 * List saved macros and the action count for each.
 */
export function desktopListMacros(): string {
  if (_macros.size === 0) return 'No macros saved.';
  const lines = [..._macros.entries()].map(([n, a]) => `  "${n}": ${a.length} action(s)`);
  const activeNote = _activeRecordingName ? `\n[Recording in progress: "${_activeRecordingName}" — ${_recordingBuffer.length} actions so far]` : '';
  return `Saved macros:\n${lines.join('\n')}${activeNote}`;
}

// ─── desktop_get_accessibility_tree ──────────────────────────────────────────

/**
 * Return a full structured accessibility tree for a window using Windows
 * UI Automation. Each node includes: role, name, enabled/focused state,
 * bounding box, and children. Much richer than desktop_get_window_text.
 */
export async function desktopGetAccessibilityTree(
  windowName?: string,
  maxDepth = 5,
  maxNodes = 300,
): Promise<string> {
  ensureWindows();
  const safeDepth = Math.min(Math.max(Number(maxDepth) || 5, 1), 10);
  const safeMax = Math.min(Math.max(Number(maxNodes) || 300, 10), 1000);

  // Find the target window handle (or 0 = active window)
  let handle = 0;
  if (windowName && String(windowName).trim()) {
    const query = String(windowName).trim();
    const allWindows = await listWindowsInternal();
    const match = findWindowsByName(allWindows, query)[0];
    if (!match) return `ERROR: No window matching "${query}" found.`;
    handle = match.handle;
  }

  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$maxDepth = ${safeDepth}
$maxNodes = ${safeMax}
$nodeCount = 0

function Get-UiaTree {
  param($element, $depth)
  if ($depth -gt $maxDepth) { return $null }
  if ($script:nodeCount -ge $maxNodes) { return $null }
  $script:nodeCount++
  try {
    $cp = [System.Windows.Automation.AutomationElement]::ControlTypeProperty
    $np = [System.Windows.Automation.AutomationElement]::NameProperty
    $ep = [System.Windows.Automation.AutomationElement]::IsEnabledProperty
    $fp = [System.Windows.Automation.AutomationElement]::HasKeyboardFocusProperty
    $name = $element.GetCurrentPropertyValue($np)
    $ctrl = $element.GetCurrentPropertyValue($cp)
    $enabled = $element.GetCurrentPropertyValue($ep)
    $focused = $element.GetCurrentPropertyValue($fp)
    $rect = $element.Current.BoundingRectangle
    $ctrlName = if ($ctrl) { $ctrl.ProgrammaticName.Replace('ControlType.','') } else { 'Unknown' }
    $node = @{
      role = $ctrlName
      name = if ($name) { $name } else { '' }
      enabled = [bool]$enabled
      focused = [bool]$focused
      x = [int]$rect.X; y = [int]$rect.Y; w = [int]$rect.Width; h = [int]$rect.Height
      children = @()
    }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($element)
    while ($child -ne $null -and $script:nodeCount -lt $maxNodes) {
      $childNode = Get-UiaTree $child ($depth + 1)
      if ($childNode) { $node.children += $childNode }
      $child = $walker.GetNextSibling($child)
    }
    return $node
  } catch { return $null }
}

function Format-Tree {
  param($node, $indent)
  if (-not $node) { return }
  $line = (' ' * $indent) + $node.role
  if ($node.name) { $line += ': "' + $node.name.Substring(0, [Math]::Min(60, $node.name.Length)) + '"' }
  $flags = @()
  if (-not $node.enabled) { $flags += 'disabled' }
  if ($node.focused) { $flags += 'FOCUSED' }
  if ($node.w -gt 0) { $flags += "($($node.x),$($node.y) $($node.w)x$($node.h))" }
  if ($flags.Count -gt 0) { $line += ' [' + ($flags -join ', ') + ']' }
  Write-Output $line
  foreach ($child in $node.children) { Format-Tree $child ($indent + 2) }
}

try {
  if (${handle} -ne 0) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]${handle})
  } else {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinFGHelper {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
    $fgHandle = [WinFGHelper]::GetForegroundWindow()
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($fgHandle)
  }
  if (-not $root) { Write-Output "ERROR: Could not get window element."; exit }
  $tree = Get-UiaTree $root 0
  if ($tree) {
    Write-Output "=== Accessibility Tree (depth=${safeDepth}, max=${safeMax} nodes, captured: $script:nodeCount) ==="
    Format-Tree $tree 0
  } else { Write-Output "ERROR: Tree walk returned null." }
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
`;

  try {
    const out = await runPowerShell(script, { timeoutMs: 20000, sta: true });
    if (!out || !out.trim()) return 'ERROR: Accessibility tree returned empty output.';
    if (out.startsWith('ERROR:')) return out.trim();
    return out.trim().slice(0, 20000);
  } catch (err: any) {
    return `ERROR: desktop_get_accessibility_tree failed: ${err.message}`;
  }
}

// ─── desktop_pixel_watch ──────────────────────────────────────────────────────

/**
 * Poll a specific virtual-screen pixel until its color changes from the initial
 * sample (or matches a target color), then return. Uses PowerShell
 * Graphics.CopyFromScreen to sample a 1×1 region — much cheaper than a full screenshot.
 * color format: "#RRGGBB" hex or null to watch for ANY change from the initial color.
 */
export async function desktopPixelWatch(
  x: number,
  y: number,
  targetColor?: string,
  timeoutMs = 15000,
  pollMs = 500,
): Promise<string> {
  ensureWindows();
  const vx = Math.round(Number(x) || 0);
  const vy = Math.round(Number(y) || 0);
  const safeTimeout = Math.min(Math.max(Number(timeoutMs) || 15000, 500), 120_000);
  const safePoll = Math.min(Math.max(Number(pollMs) || 500, 100), 5000);

  // PowerShell snippet to sample one pixel and return its hex color
  const sampleScript = (px: number, py: number) => `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(1, 1)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen([System.Drawing.Point]::new(${px}, ${py}), [System.Drawing.Point]::Zero, [System.Drawing.Size]::new(1, 1))
$g.Dispose()
$col = $bmp.GetPixel(0, 0)
$bmp.Dispose()
Write-Output ('#' + $col.R.ToString('X2') + $col.G.ToString('X2') + $col.B.ToString('X2'))
`;

  try {
    // Sample initial color
    const initialColor = (await runPowerShell(sampleScript(vx, vy), { timeoutMs: 5000 })).trim();
    const watchFor = targetColor
      ? String(targetColor).toUpperCase().replace(/^#?/, '#')
      : null;

    const deadline = Date.now() + safeTimeout;
    let iterations = 0;
    while (Date.now() < deadline) {
      await new Promise<void>(r => setTimeout(r, safePoll));
      iterations++;
      const current = (await runPowerShell(sampleScript(vx, vy), { timeoutMs: 5000 })).trim();
      if (watchFor) {
        if (current.toUpperCase() === watchFor) {
          return `Pixel at (${vx}, ${vy}) matched target color ${watchFor} after ${iterations} polls (initial: ${initialColor}).`;
        }
      } else {
        if (current !== initialColor) {
          return `Pixel at (${vx}, ${vy}) changed: ${initialColor} → ${current} after ${iterations} polls.`;
        }
      }
    }
    const lastColor = (await runPowerShell(sampleScript(vx, vy), { timeoutMs: 5000 })).trim();
    return `ERROR: Timed out after ${safeTimeout}ms. Pixel at (${vx}, ${vy}) is still ${lastColor}${watchFor ? ` (target: ${watchFor})` : ` (initial: ${initialColor})`}.`;
  } catch (err: any) {
    return `ERROR: desktop_pixel_watch failed: ${err.message}`;
  }
}

// ─── Send screenshot to Telegram ─────────────────────────────────────────────

/** Capture each connected monitor separately and return their buffers. */
async function captureAllMonitorBuffers(): Promise<Array<{ buf: Buffer; width: number; height: number }>> {
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

/**
 * Grab the most recent screenshot from the session packet and send it
 * to all allowed Telegram users as a photo.
 * If multiple monitors are detected, each is sent as a separate image in an album.
 */
export async function desktopSendToTelegram(
  sessionId: string,
  caption: string = 'Desktop screenshot',
  telegramChannel?: any,
  freshCapture: boolean = true,
): Promise<string> {
  if (!telegramChannel) {
    return 'ERROR: Telegram channel not available.';
  }
  try {
    const monitors = await captureAllMonitorBuffers();

    if (monitors.length === 1) {
      // Single monitor — send as inline photo
      await telegramChannel.sendPhotoToAllowed(monitors[0].buf, caption);
      return `Screenshot sent to Telegram. (${monitors[0].width}x${monitors[0].height})`;
    }

    // Multiple monitors — send as a media group album, one image per monitor
    const items = monitors.map((m, i) => ({
      buf: m.buf,
      label: `Monitor ${i + 1}/${monitors.length} (${m.width}×${m.height})`,
    }));
    if (typeof telegramChannel.sendMonitorGroupToAllowed === 'function') {
      await telegramChannel.sendMonitorGroupToAllowed(items, caption);
    } else {
      for (let i = 0; i < monitors.length; i++) {
        const m = monitors[i];
        const perCaption = `${caption} - Monitor ${i + 1}/${monitors.length} (${m.width}x${m.height})`;
        await telegramChannel.sendPhotoToAllowed(m.buf, perCaption);
      }
    }
    const dims = monitors.map((m, i) => `M${i + 1}: ${m.width}×${m.height}`).join(', ');
    return `Screenshots sent to Telegram — ${monitors.length} monitors. ${dims}`;
  } catch (err: any) {
    // Fallback: try the old single-capture path
    if (freshCapture) {
      try { await desktopScreenshot(sessionId); } catch { /* ignore */ }
    }
    const packet = getDesktopAdvisorPacket(sessionId);
    if (packet?.screenshotBase64) {
      try {
        await telegramChannel.sendPhotoToAllowed(
          Buffer.from(packet.screenshotBase64, 'base64'),
          caption,
          { asDocument: true },
        );
        const ts = new Date(packet.capturedAt).toLocaleTimeString();
        return `Screenshot sent to Telegram (fallback). Captured at ${ts} (${packet.width}x${packet.height}).`;
      } catch { /* fall through */ }
    }
    return `ERROR: Failed to send screenshot to Telegram: ${err?.message || err}`;
  }
}

export function getDesktopAdvisorPacket(sessionId: string): DesktopAdvisorPacket | null {
  const state = sessions.get(sessionId);
  if (!state?.lastPacket) return null;
  return state.lastPacket;
}

// ─── Phase 4: App Launch / Process Control ────────────────────────────────────

/** Spawn a process via Start-Process and return its PID (throws on failure).
 *  Extracted from desktopLaunchApp so the Win32 DesktopBackend can wrap it; the
 *  public function keeps installed-app resolution and window-appearance polling. */
export async function launchProcessInternal(target: string, args: string): Promise<number> {
  const appSafe = psSingleQuote(target);
  const argsSafe = psSingleQuote(args);
  // Console apps (cmd, powershell, etc.) need -WindowStyle Normal to get a visible
  // window. For all other apps the parameter is harmless.
  const script = `
$procArgs = '${argsSafe}'
$startParams = @{ FilePath = '${appSafe}'; PassThru = $true; WindowStyle = 'Normal' }
if ($procArgs) { $startParams.ArgumentList = $procArgs }
try {
  $proc = Start-Process @startParams -ErrorAction Stop
  Write-Output ("LAUNCHED:" + $proc.Id)
} catch {
  Write-Output ("ERROR:" + $_.Exception.Message)
}
`;
  const launchOut = await runPowerShell(script, { timeoutMs: 10000 });
  if (launchOut.startsWith('ERROR:')) {
    throw new Error(launchOut.slice(6));
  }
  return Number(launchOut.replace('LAUNCHED:', '').trim()) || 0;
}

/**
 * Launch a desktop application by name or path and wait for a window to appear.
 * Returns a status string with the window handle once visible.
 */
export async function desktopLaunchApp(
  app: string,
  appArgs: string = '',
  waitMs: number = 6000,
  appId?: string,
): Promise<string> {
  ensureWindows();
  const rawApp = String(app || '').trim();
  const rawAppId = String(appId || '').trim();
  const rawArgs = String(appArgs || '').trim();
  if (!rawApp && !rawAppId) return 'ERROR: app or app_id is required.';

  let launchTarget = rawApp;
  let launchArgs = rawArgs;
  let launchLabel = rawApp || rawAppId;
  let matchHints = [rawApp || rawAppId].filter(Boolean).map((value) => String(value).toLowerCase());

  if (rawAppId) {
    const resolved = await resolveInstalledAppLaunch(rawAppId);
    if (!resolved) {
      return `ERROR: No installed app found for app_id "${rawAppId}". Run desktop_find_installed_app first.`;
    }
    launchLabel = `${resolved.app.displayName} [${resolved.app.id}]`;
    matchHints = [
      resolved.app.displayName,
      ...resolved.app.aliases,
      ...resolved.app.processNameHints,
      ...resolved.app.windowTitleHints,
    ].map((value) => String(value || '').toLowerCase()).filter(Boolean);
    if (resolved.method.type === 'aumid') {
      launchTarget = 'explorer.exe';
      launchArgs = `shell:AppsFolder\\${resolved.method.target}${rawArgs ? ` ${rawArgs}` : ''}`.trim();
    } else {
      launchTarget = resolved.method.target;
      launchArgs = [resolved.method.args, rawArgs].filter(Boolean).join(' ').trim();
    }
  } else if (rawApp && !path.isAbsolute(rawApp) && !/[\\/]/.test(rawApp)) {
    const resolved = await resolveInstalledAppLaunchByQuery(rawApp).catch(() => null);
    if (resolved) {
      launchLabel = `${resolved.app.displayName} [${resolved.app.id}]`;
      matchHints = [
        resolved.app.displayName,
        ...resolved.app.aliases,
        ...resolved.app.processNameHints,
        ...resolved.app.windowTitleHints,
      ].map((value) => String(value || '').toLowerCase()).filter(Boolean);
      if (resolved.method.type === 'aumid') {
        launchTarget = 'explorer.exe';
        launchArgs = `shell:AppsFolder\\${resolved.method.target}${rawArgs ? ` ${rawArgs}` : ''}`.trim();
      } else {
        launchTarget = resolved.method.target;
        launchArgs = [resolved.method.args, rawArgs].filter(Boolean).join(' ').trim();
      }
    }
  }

  const pollMs = 400;
  const maxPolls = Math.max(1, Math.floor(clampInt(waitMs, 200, 60000, 6000) / pollMs));

  let launchedPid = 0;
  try {
    launchedPid = await launchProcessInternal(launchTarget, launchArgs);
  } catch (e: any) {
    return `ERROR: Failed to launch '${launchLabel}': ${e?.message || e}`;
  }

  // Poll for window appearance
  // Console apps (cmd, powershell) are hosted by conhost.exe — their PID in the window list
  // may be the conhost PID, not the cmd.exe PID. We use a multi-strategy search.
  const appLower = path.parse(String(launchTarget || launchLabel || '')).name.toLowerCase().replace(/\.exe$/i, '');
  const CONSOLE_APPS = new Set(['cmd', 'powershell', 'pwsh', 'wt', 'bash', 'git-bash']);
  const isConsoleApp = CONSOLE_APPS.has(appLower);

  let lastHandle = 0;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    try {
      const windows = await listWindowsInternal();
      let match: typeof windows[0] | undefined;

      if (launchedPid > 0) {
        // Strategy 1: exact PID match
        match = windows.find((w) => w.pid === launchedPid);
      }

      if (!match && isConsoleApp) {
        // Strategy 2: for console apps, match by process name (cmd, powershell, etc.)
        match = windows.find((w) => w.processName.toLowerCase().includes(appLower));
      }

      if (!match) {
        // Strategy 3: fuzzy match on process name or title
        match = windows.find((w) =>
          matchHints.some((hint) =>
            hint && (
              w.processName.toLowerCase().includes(hint)
              || w.title.toLowerCase().includes(hint)
            ),
          ) || w.processName.toLowerCase().includes(appLower) || w.title.toLowerCase().includes(appLower),
        );
      }

      if (match) {
        lastHandle = match.handle;
        return `Launched '${launchLabel}' (PID ${launchedPid || match.pid}). Window: "${match.title}" (${match.processName}) handle=${match.handle}.`;
      }
    } catch {
      // continue polling
    }
  }
  if (launchedPid > 0) {
    return `Launched '${launchLabel}' (PID ${launchedPid}) but no window appeared within ${waitMs}ms. App may still be starting. Use desktop_get_process_list or desktop_find_window to check.`;
  }
  return `ERROR: Failed to launch '${launchLabel}' or detect its window within ${waitMs}ms.`;
}

/**
 * Close a window or application gracefully, or force-kill the process.
 */
export async function desktopCloseApp(name: string, force: boolean = false): Promise<string> {
  ensureWindows();
  const query = String(name || '').trim();
  if (!query) return 'ERROR: name is required.';

  const allWindows = await listWindowsInternal();
  const matches = findWindowsByName(allWindows, query);
  if (matches.length === 0) {
    return `ERROR: No window matching "${query}" found.`;
  }
  const target = matches[0];

  if (force) {
    const script = `Stop-Process -Id ${target.pid} -Force -ErrorAction SilentlyContinue; Write-Output "OK"`;
    await runPowerShell(script, { timeoutMs: 8000 });
    return `Force-killed process '${target.processName}' (PID ${target.pid}).`;
  }

  // Graceful: post WM_CLOSE
  const script = `
${PS_WINAPI_HEADER}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PrometheusClose {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@ -Language CSharp -ErrorAction SilentlyContinue
$hWnd = [IntPtr]::new([Int64]${target.handle})
[void][PrometheusClose]::PostMessage($hWnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 8000 });
  return `Sent close signal to '${target.title}' (${target.processName}, PID ${target.pid}).`;
}

/**
 * List running processes that have visible windows.
 */
export async function desktopGetProcessList(filter: string = ''): Promise<string> {
  ensureWindows();
  const allWindows = await listWindowsInternal();
  const q = String(filter || '').trim().toLowerCase();
  const filtered = q
    ? allWindows.filter(
        (w) => w.title.toLowerCase().includes(q) || w.processName.toLowerCase().includes(q),
      )
    : allWindows;

  if (filtered.length === 0) {
    return q ? `No windows matching "${filter}" found.` : 'No windows with visible titles found.';
  }
  const lines = filtered.slice(0, 60).map((w, i) => {
    const mon = w.monitorIndex !== undefined ? ` monitor=${w.monitorIndex}` : '';
    return `${i + 1}. [${w.processName}]${mon} PID=${w.pid} handle=${w.handle}\n   Title: ${w.title}`;
  });
  return `${filtered.length} window(s)${q ? ` matching "${filter}"` : ''}:\n${lines.join('\n')}`;
}

// ─── Phase 3: Screenshot Diffing / Change Detection ───────────────────────────

function summarizeInstalledAppLine(
  index: number,
  app: {
    id: string;
    displayName: string;
    aliases: string[];
    processNameHints: string[];
    windowTitleHints: string[];
    installSources: string[];
    executablePath?: string;
    shortcutPath?: string;
    appUserModelId?: string;
    launchMethods: Array<{ type: 'shortcut' | 'exe' | 'aumid'; target: string }>;
  },
  extra?: { score?: number; matchedOn?: string[] },
): string {
  const lines: string[] = [];
  const launchSummary = app.launchMethods.map((method) => method.type).join(', ');
  const scorePart = extra?.score ? ` score=${Math.round(extra.score)}` : '';
  lines.push(`${index}. ${app.displayName} [app_id=${app.id}]${scorePart}${launchSummary ? ` launch=${launchSummary}` : ''}`);
  if (extra?.matchedOn?.length) lines.push(`   Matched on: ${extra.matchedOn.join(', ')}`);
  if (app.aliases.length) lines.push(`   Aliases: ${app.aliases.slice(0, 8).join(', ')}`);
  if (app.processNameHints.length) lines.push(`   Process hints: ${app.processNameHints.slice(0, 6).join(', ')}`);
  if (app.windowTitleHints.length) lines.push(`   Window hints: ${app.windowTitleHints.slice(0, 4).join(', ')}`);
  if (app.installSources.length) lines.push(`   Sources: ${app.installSources.join(', ')}`);
  if (app.executablePath) lines.push(`   Executable: ${app.executablePath}`);
  if (app.shortcutPath) lines.push(`   Shortcut: ${app.shortcutPath}`);
  if (app.appUserModelId) lines.push(`   AppUserModelID: ${app.appUserModelId}`);
  return lines.join('\n');
}

export async function desktopListInstalledApps(
  filter: string = '',
  limit: number = 40,
  refresh: boolean = false,
): Promise<string> {
  ensureWindows();
  const safeLimit = Math.min(Math.max(Math.floor(Number(limit) || 40), 1), 200);
  const inventory = await getInstalledAppsInventory({ refresh });
  const cleanFilter = String(filter || '').trim();
  const apps = cleanFilter
    ? (await searchInstalledApps(cleanFilter, { limit: safeLimit, refresh: false })).map(({ score: _score, matchedOn: _matchedOn, ...app }) => app)
    : inventory.apps.slice(0, safeLimit);
  if (!apps.length) {
    return cleanFilter
      ? `No installed apps matched "${filter}".`
      : 'No installed apps were discovered.';
  }
  const header = cleanFilter
    ? `Installed apps matching "${filter}" (${apps.length} of ${inventory.apps.length} total):`
    : `Installed apps (${apps.length} shown of ${inventory.apps.length} total):`;
  const lines = apps.map((row, idx) => summarizeInstalledAppLine(idx + 1, row));
  return [
    header,
    ...lines,
    `Scanned at: ${new Date(inventory.generatedAt).toISOString()}.`,
    refresh ? 'Inventory was refreshed before listing.' : 'Use refresh=true to force a rescan.',
    'Use desktop_find_installed_app(query) for ranked fuzzy search, then desktop_launch_app({ app_id }) for deterministic launch.',
  ].join('\n');
}

export async function desktopFindInstalledApp(
  query: string,
  limit: number = 10,
  refresh: boolean = false,
): Promise<string> {
  ensureWindows();
  const clean = String(query || '').trim();
  if (!clean) return 'ERROR: query is required.';
  const safeLimit = Math.min(Math.max(Math.floor(Number(limit) || 10), 1), 50);
  const matches = await searchInstalledApps(clean, { limit: safeLimit, refresh });
  if (!matches.length) {
    return `No installed apps matched "${clean}". Use desktop_list_installed_apps with a broad filter or refresh=true to rescan.`;
  }
  return [
    `Found ${matches.length} installed app match(es) for "${clean}":`,
    ...matches.map((row, idx) => summarizeInstalledAppLine(idx + 1, row, { score: row.score, matchedOn: row.matchedOn })),
    'Use desktop_launch_app({ app_id: "..." }) to launch the exact match.',
  ].join('\n');
}

interface SessionHistory {
  prevPacket?: DesktopAdvisorPacket;
  lastPacket?: DesktopAdvisorPacket;
}

const sessionHistory = new Map<string, SessionHistory>();

/**
 * Override of sessions.set to also maintain history.
 * We monkey-patch this by extending desktopScreenshot to track prevPacket.
 */
export async function desktopScreenshotWithHistory(
  sessionId: string,
  options?: DesktopScreenshotOptions,
): Promise<string> {
  // Capture previous packet before overwriting
  const existing = sessions.get(sessionId);
  if (existing?.lastPacket) {
    sessionHistory.set(sessionId, { prevPacket: existing.lastPacket });
  }
  return desktopScreenshot(sessionId, options);
}

/**
 * Poll until the screen content hash changes or timeout is reached.
 */
export async function desktopWaitForChange(
  sessionId: string,
  timeoutMs: number = 10000,
  pollMs: number = 800,
): Promise<string> {
  ensureWindows();
  const clampedTimeout = clampInt(timeoutMs, 500, 120000, 10000);
  const clampedPoll = clampInt(pollMs, 200, 5000, 800);

  // Capture baseline
  const baselineResult = await desktopScreenshot(sessionId);
  const baselinePacket = getDesktopAdvisorPacket(sessionId);
  const baselineHash = baselinePacket?.contentHash || '';

  const deadline = Date.now() + clampedTimeout;
  let polls = 0;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, clampedPoll));
    polls++;
    try {
      await desktopScreenshot(sessionId);
      const newPacket = getDesktopAdvisorPacket(sessionId);
      const newHash = newPacket?.contentHash || '';
      if (newHash && newHash !== baselineHash) {
        const elapsed = clampedTimeout - (deadline - Date.now());
        return (
          `Screen changed after ${Math.round(elapsed)}ms (${polls} poll(s)).\n` +
          `Active window: ${newPacket?.activeWindow ? `"${newPacket.activeWindow.title}"` : 'unknown'}.\n` +
          `OCR preview: ${(newPacket?.ocrText || '').slice(0, 200).replace(/\s+/g, ' ').trim() || '(none)'}`
        );
      }
    } catch {
      // transient capture failure — keep polling
    }
  }
  return `Timed out after ${clampedTimeout}ms (${polls} poll(s)) — screen content did not change.`;
}

/**
 * Return a textual diff of what changed between the last two screenshots.
 */
export async function desktopDiffScreenshot(sessionId: string): Promise<string> {
  ensureWindows();
  const current = getDesktopAdvisorPacket(sessionId);
  const history = sessionHistory.get(sessionId);
  const prev = history?.prevPacket;

  if (!current) {
    return 'No screenshot available yet. Call desktop_screenshot first.';
  }
  if (!prev) {
    return 'Only one screenshot captured so far — no diff available. Call desktop_screenshot again to compare.';
  }

  const lines: string[] = [];

  // Hash change
  if (current.contentHash === prev.contentHash) {
    lines.push('Screen content: UNCHANGED (identical pixel hash).');
  } else {
    lines.push('Screen content: CHANGED.');
  }

  // Active window change
  const prevTitle = prev.activeWindow?.title || '(none)';
  const curTitle = current.activeWindow?.title || '(none)';
  if (prevTitle !== curTitle) {
    lines.push(`Active window changed: "${prevTitle}" → "${curTitle}".`);
  } else {
    lines.push(`Active window: "${curTitle}" (unchanged).`);
  }

  const prevMon = prev.activeMonitorIndex;
  const curMon = current.activeMonitorIndex;
  if (prevMon !== curMon && (prevMon !== undefined || curMon !== undefined)) {
    lines.push(
      `Active monitor index: ${prevMon === null || prevMon === undefined ? '(unknown)' : prevMon} → ${curMon === null || curMon === undefined ? '(unknown)' : curMon}.`,
    );
  }

  // Window count
  const prevCount = prev.openWindows.length;
  const curCount = current.openWindows.length;
  if (prevCount !== curCount) {
    lines.push(`Window count: ${prevCount} → ${curCount} (${curCount > prevCount ? '+' : ''}${curCount - prevCount}).`);
    // Identify new/closed windows
    const prevTitles = new Set(prev.openWindows.map((w) => w.title));
    const curTitles = new Set(current.openWindows.map((w) => w.title));
    const opened = current.openWindows.filter((w) => !prevTitles.has(w.title)).map((w) => w.title);
    const closed = prev.openWindows.filter((w) => !curTitles.has(w.title)).map((w) => w.title);
    if (opened.length) lines.push(`  Opened: ${opened.slice(0, 5).join(', ')}`);
    if (closed.length) lines.push(`  Closed: ${closed.slice(0, 5).join(', ')}`);
  } else {
    lines.push(`Window count: ${curCount} (unchanged).`);
  }

  // OCR diff (simple — look for added/removed lines)
  const prevOcr = (prev.ocrText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const curOcr = (current.ocrText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const prevOcrSet = new Set(prevOcr);
  const curOcrSet = new Set(curOcr);
  const addedText = curOcr.filter((l) => !prevOcrSet.has(l)).slice(0, 6);
  const removedText = prevOcr.filter((l) => !curOcrSet.has(l)).slice(0, 6);
  if (addedText.length) lines.push(`New text on screen:\n  + ${addedText.join('\n  + ')}`);
  if (removedText.length) lines.push(`Text no longer visible:\n  - ${removedText.join('\n  - ')}`);
  if (!addedText.length && !removedText.length && current.contentHash !== prev.contentHash) {
    lines.push('OCR content similar (pixel-level changes detected but text lines unchanged).');
  }

  return lines.join('\n');
}

// ─── Window Text Reader (UI Automation) ───────────────────────────────────────

/**
 * Extract readable text from a window using PowerShell UI Automation.
 * More reliable than OCR for text-based UIs — returns structured text content.
 * If no windowName given, reads the currently active/foreground window.
 */
export async function desktopGetWindowText(windowName?: string): Promise<string> {
  ensureWindows();
  const query = String(windowName || '').trim();
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinFGHelperGWT {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@ -ErrorAction SilentlyContinue
try {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = if ('${psSingleQuote(query)}') {
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty, '${psSingleQuote(query)}',
      [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase
    )
  } else {
    [System.Windows.Automation.Condition]::TrueCondition
  }
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  $target = if ($wins.Count -gt 0) { $wins[0] } else {
    # Fall back to actual foreground window via Win32
    $fgHwnd = [WinFGHelperGWT]::GetForegroundWindow()
    if ($fgHwnd -ne [IntPtr]::Zero) { [System.Windows.Automation.AutomationElement]::FromHandle($fgHwnd) } else { $null }
  }
  if (-not $target) { Write-Output 'ERROR: No window found.'; exit 0 }
  $title = $target.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NameProperty)
  $textCond = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text
  )
  $editCond = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $orCond = [System.Windows.Automation.OrCondition]::new($textCond, $editCond)
  $elements = $target.FindAll([System.Windows.Automation.TreeScope]::Subtree, $orCond)
  $lines = @("Window: $title")
  foreach ($el in $elements) {
    $name = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NameProperty)
    $val = try { ($el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value } catch { $null }
    $text = if ($val) { $val } elseif ($name) { $name } else { $null }
    if ($text -and $text.Trim()) { $lines += $text.Trim() }
  }
  $lines -join "\`n"
} catch {
  Write-Output "ERROR: $_"
}
`;
  try {
    const out = await runPowerShell(script, { timeoutMs: 10000, sta: true });
    const text = String(out || '').trim();
    if (!text) return 'No text content found in window.';
    return text.slice(0, 8000);
  } catch (e: any) {
    return `ERROR: ${e?.message || e}`;
  }
}

// ─── Phase 1: Vision-Guided Composite Tool ────────────────────────────────────

/**
 * Refreshes the desktop screenshot and echoes the goal for the **same** (primary) model.
 * Does not call a secondary planner — the host attaches the PNG to the conversation when
 * the model supports vision; you then use desktop_click, desktop_scroll, etc.
 */
export interface DesktopWindowScreenshotOptions {
  name?: string;
  handle?: number;
  active?: boolean;
  focus_first?: boolean;
  padding?: number;
  mode?: 'normal' | 'som';
  som?: boolean;
}

export async function desktopWindowScreenshot(
  sessionId: string,
  options?: DesktopWindowScreenshotOptions,
): Promise<string> {
  ensureWindows();
  const query = String(options?.name || '').trim();
  const handleNum = Number(options?.handle || 0);
  const hasHandle = Number.isFinite(handleNum) && handleNum > 0;
  const useActive = options?.active === true || (!query && !hasHandle);
  const focusFirst = options?.focus_first !== false;
  const padding = clampInt(options?.padding, 0, 120, 8);

  let ctx = await gatherDesktopContextInternal();
  const resolveTarget = (context: DesktopContextGathered): DesktopWindowInfo | null => {
    if (hasHandle) {
      const byHandle = context.windows.find((w) => Number(w.handle) === Math.floor(handleNum));
      if (byHandle) return byHandle;
    }
    if (query) {
      const byQuery = findWindowsByName(context.windows, query);
      if (byQuery.length > 0) return byQuery[0];
    }
    if (useActive && context.activeWindow) return context.activeWindow;
    return null;
  };

  let target = resolveTarget(ctx);
  if (!target) {
    return hasHandle
      ? `ERROR: No window found for handle=${Math.floor(handleNum)}.`
      : query
        ? `ERROR: No window matching "${query}" found.`
        : 'ERROR: No active window found.';
  }

  if (focusFirst) {
    const focused = await focusWindowHandle(target.handle);
    if (!focused) {
      return `ERROR: Failed to focus target window "${target.title}" (${target.processName}).`;
    }
    await new Promise((r) => setTimeout(r, 220));
    ctx = await gatherDesktopContextInternal();
    const refreshed = ctx.windows.find((w) => w.handle === target!.handle);
    target = refreshed || resolveTarget(ctx) || target;
  }

  const left = Number(target.left);
  const top = Number(target.top);
  const width = Number(target.width);
  const height = Number(target.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 2 || height < 2) {
    return `ERROR: Target window bounds unavailable for "${target.title}" (${target.processName}). Try desktop_focus_window first.`;
  }

  const x1 = Math.floor(left - padding);
  const y1 = Math.floor(top - padding);
  const x2 = Math.floor(left + width + padding);
  const y2 = Math.floor(top + height + padding);
  if (x2 <= x1 || y2 <= y1) return 'ERROR: Computed window crop region is invalid.';

  let shot: Awaited<ReturnType<typeof captureScreenshotInternal>>;
  try {
    shot = await captureScreenshotInternal({ kind: 'all' }, [x1, y1, x2, y2]);
  } catch (e: any) {
    return `ERROR: ${e?.message || e}`;
  }

  const openWindows = ctx.windows;
  const activeWindow = ctx.activeWindow;
  const ocr = await runOcr(shot.path);

  let png: Buffer = fs.readFileSync(shot.path);
  try { fs.unlinkSync(shot.path); } catch {}
  const captureRegion = { left: shot.left, top: shot.top, width: shot.width, height: shot.height };
  let somElements: DesktopSomElement[] = [];
  if (options?.som === true || options?.mode === 'som') {
    const treeText = await desktopGetAccessibilityTree(undefined, 5, 500).catch(() => '');
    somElements = parseSomElementsFromAccessibilityTree(treeText, captureRegion);
    png = await renderSomOverlay(png, somElements, captureRegion).catch((): Buffer => png);
  }

  const normalized = await normalizeScreenshotBuffer(png, {
    maxSide: Number(process.env.PROMETHEUS_DESKTOP_SCREENSHOT_MAX_SIDE || process.env.PROMETHEUS_SCREENSHOT_MAX_SIDE || 2400),
    maxBytes: Number(process.env.PROMETHEUS_DESKTOP_SCREENSHOT_MAX_BYTES || process.env.PROMETHEUS_SCREENSHOT_MAX_BYTES || 5 * 1024 * 1024),
    preferJpeg: true,
  }).catch(() => null);
  const imageBuffer = normalized?.buffer || png;
  const imageWidth = normalized?.width || shot.width;
  const imageHeight = normalized?.height || shot.height;
  const screenshotBase64 = imageBuffer.toString('base64');
  const capturedAt = Date.now();
  const vs = ctx.virtualScreen;
  const activeMonitorIndex =
    activeWindow?.monitorIndex !== undefined && activeWindow.monitorIndex >= 0
      ? activeWindow.monitorIndex
      : null;

  const packet = createDesktopAdvisorPacket({
    screenshotBase64,
    screenshotMime: normalized?.mimeType || 'image/png',
    width: imageWidth,
    height: imageHeight,
    capturedAt,
    openWindows,
    activeWindow: activeWindow || undefined,
    ocrText: ocr?.text,
    ocrConfidence: ocr?.confidence,
    monitors: ctx.monitors.length ? ctx.monitors : undefined,
    virtualScreen: vs.width > 0 ? vs : undefined,
    captureRegion,
    coordinateScale: {
      x: shot.width / Math.max(1, imageWidth),
      y: shot.height / Math.max(1, imageHeight),
    },
    normalizedScreenshot: normalized?.normalized
      ? {
          originalWidth: shot.width,
          originalHeight: shot.height,
          originalBytes: normalized.originalBytes,
          bytes: normalized.bytes,
        }
      : undefined,
    captureMode: shot.captureMode,
    captureMonitorIndex: shot.captureMonitorIndex,
    activeMonitorIndex,
    targetWindow: target,
    somElements: somElements.length ? somElements : undefined,
  });
  storeDesktopPacket(sessionId, packet);

  const ocrPreview = ocr?.text ? ocr.text.slice(0, 400).replace(/\s+/g, ' ').trim() : '';
  const ocrLen = ocr?.text ? ocr.text.length : 0;
  const screenshotIdLine = `Screenshot ID: ${packet.screenshotId}.`;
  const captureUsageLine =
    `Use coordinate_space="capture" with screenshot_id="${packet.screenshotId}" for clicks based on this cropped image; recapture if focus/window geometry changes.`;
  const windowUsageLine =
    `Use coordinate_space="window" with screenshot_id="${packet.screenshotId}" for coordinates relative to the window's own top-left. For minimize/maximize/restore/close, use desktop_window_control.`;

  return [
    `Window screenshot captured (${imageWidth}x${imageHeight}${normalized?.normalized ? `, normalized from ${shot.width}x${shot.height}` : ''}).`,
    screenshotIdLine,
    `Target window: "${target.title}" (${target.processName}, handle=${target.handle}).`,
    `Window bounds: left=${Math.floor(left)}, top=${Math.floor(top)}, width=${Math.floor(width)}, height=${Math.floor(height)}.`,
    `Capture region: [${x1}, ${y1}] to [${x2}, ${y2}] (padding ${padding}px).`,
    captureUsageLine,
    windowUsageLine,
    (options?.som === true || options?.mode === 'som') ? formatSomElements(somElements) || 'SOM mode requested, but no UI Automation elements were found inside this window capture.' : '',
    `Active window: ${shortWindowLabel(activeWindow)}.`,
    ocrPreview ? `OCR text (${Math.round(ocr?.confidence || 0)}% confidence):\n${ocrPreview}${ocrLen > 400 ? ' ...' : ''}` : 'OCR: unavailable.',
  ].join('\n');
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
 * Resolve the configured capture backend. Windows.Graphics.Capture is the
 * long-term goal (it can capture occluded windows); until a native helper is
 * installed we always fall back to the stable CopyFromScreen path. The env var
 * lets operators force a backend for diagnostics.
 */
export function resolveDesktopCaptureBackend(): { requested: DesktopCaptureBackend | 'auto'; active: DesktopCaptureBackend; reason: string } {
  const raw = String(process.env.PROMETHEUS_DESKTOP_CAPTURE_BACKEND || 'auto').trim().toLowerCase();
  const requested: DesktopCaptureBackend | 'auto' =
    raw === 'graphics_capture' || raw === 'copy_from_screen' || raw === 'window_crop' ? raw : 'auto';
  // Windows.Graphics.Capture helper is not yet bundled; only CopyFromScreen and
  // its window_crop variant are wired up today.
  if (requested === 'graphics_capture') {
    return {
      requested,
      active: 'copy_from_screen',
      reason: 'graphics_capture requested but the Windows.Graphics.Capture helper is not installed; using copy_from_screen fallback.',
    };
  }
  return {
    requested,
    active: 'copy_from_screen',
    reason: requested === 'auto'
      ? 'auto resolved to copy_from_screen (Windows.Graphics.Capture helper not installed).'
      : `${requested} active.`,
  };
}

export interface DesktopWindowState {
  windowId: string;
  handle: number;
  appId: string;
  processName: string;
  pid: number;
  title: string;
  bounds: { left: number; top: number; width: number; height: number };
  monitorIndex?: number;
  isActive: boolean;
}

export interface DesktopAppState {
  appId: string;
  displayName: string;
  processName?: string;
  executablePath?: string;
  isRunning: boolean;
  windows: DesktopWindowState[];
}

/** Stable window id derived from the HWND. Persists while the window is open. */
function windowIdForHandle(handle: number): string {
  return `win_${Math.floor(Number(handle) || 0)}`;
}

function parseWindowId(windowId?: string | null): number | null {
  const m = String(windowId || '').trim().match(/^win_(\d+)$/);
  if (!m) return null;
  const h = Number(m[1]);
  return Number.isFinite(h) && h > 0 ? h : null;
}

/** Stable app id for a running process group. */
function appIdForProcess(processName: string): string {
  return `proc:${String(processName || 'unknown').toLowerCase()}`;
}

function toDesktopWindowState(w: DesktopWindowInfo, activeHandle: number): DesktopWindowState {
  const handle = normalizedWindowHandle(w);
  return {
    windowId: windowIdForHandle(handle),
    handle,
    appId: appIdForProcess(w.processName),
    processName: w.processName,
    pid: Number(w.pid) || 0,
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
  selector: { window_id?: string; window_handle?: number; app_id?: string; title?: string; active?: boolean },
): Promise<{ ok: true; window: DesktopWindowInfo; hint?: string } | { ok: false; message: string }> {
  ensureWindows();
  const ctx = await gatherDesktopContextInternal();
  const windows = ctx.windows;
  const byHandle = (h: number) => windows.find((w) => normalizedWindowHandle(w) === Math.floor(h)) || null;

  const explicitHandle = Number(selector.window_handle);
  const idHandle = parseWindowId(selector.window_id);
  const handle = Number.isFinite(explicitHandle) && explicitHandle > 0
    ? Math.floor(explicitHandle)
    : (idHandle ?? 0);

  if (handle > 0) {
    const w = byHandle(handle);
    if (w) return { ok: true, window: w };
    return { ok: false, message: `No open window for ${selector.window_id ? `window_id="${selector.window_id}"` : `window_handle=${handle}`}. Capture a fresh desktop_get_window_state or desktop_list_windows.` };
  }

  if (selector.app_id) {
    const appId = String(selector.app_id).trim().toLowerCase();
    const matches = windows.filter((w) => appIdForProcess(w.processName) === appId);
    if (matches.length === 1) return { ok: true, window: matches[0] };
    if (matches.length > 1) {
      const active = matches.find((w) => normalizedWindowHandle(w) === normalizedWindowHandle(ctx.activeWindow));
      return {
        ok: true,
        window: active || matches[0],
        hint: `app_id "${selector.app_id}" has ${matches.length} windows; targeting ${shortWindowLabel(active || matches[0])}. Pass window_id for an exact window.`,
      };
    }
    return { ok: false, message: `No open window for app_id "${selector.app_id}".` };
  }

  if (selector.title) {
    const matches = findWindowsByName(windows, String(selector.title));
    if (matches.length >= 1) {
      return {
        ok: true,
        window: matches[0],
        hint: matches.length > 1
          ? `${matches.length} windows match "${selector.title}"; targeting ${shortWindowLabel(matches[0])}. Pass window_id (from desktop_list_windows) for deterministic targeting.`
          : `Resolved by title; prefer window_id from desktop_list_windows for deterministic targeting.`,
      };
    }
    return { ok: false, message: `No open window matching title "${selector.title}".` };
  }

  if (selector.active === true && ctx.activeWindow) {
    return { ok: true, window: ctx.activeWindow };
  }

  return { ok: false, message: 'Provide window_id, window_handle, app_id, or title to identify the window.' };
}

/**
 * desktop_list_apps — installed + running apps with their open windows, in the
 * canonical model. Running apps are grouped by process; not-running installed
 * apps come from the installed-apps inventory.
 */
export async function desktopListApps(
  filter: string = '',
  includeWindows: boolean = true,
): Promise<string> {
  ensureWindows();
  const ctx = await gatherDesktopContextInternal();
  const activeHandle = normalizedWindowHandle(ctx.activeWindow);
  const clean = String(filter || '').trim().toLowerCase();

  // Group running windows by process.
  const runningByApp = new Map<string, DesktopAppState>();
  for (const w of ctx.windows) {
    const appId = appIdForProcess(w.processName);
    let app = runningByApp.get(appId);
    if (!app) {
      app = { appId, displayName: w.processName, processName: w.processName, isRunning: true, windows: [] };
      runningByApp.set(appId, app);
    }
    app.windows.push(toDesktopWindowState(w, activeHandle));
  }

  // Merge installed-app inventory for richer display names / not-running apps.
  const apps: DesktopAppState[] = [];
  try {
    const inventory = await getInstalledAppsInventory({ refresh: false });
    const runningProcs = new Set(Array.from(runningByApp.keys()));
    for (const rec of inventory.apps) {
      const matchedRunning = rec.processNameHints
        .map((h) => appIdForProcess(h))
        .find((id) => runningProcs.has(id));
      if (matchedRunning) {
        const app = runningByApp.get(matchedRunning)!;
        app.displayName = rec.displayName || app.displayName;
        app.executablePath = rec.executablePath;
        // Use the stable installed-app id when known.
        app.appId = rec.id;
      } else {
        apps.push({
          appId: rec.id,
          displayName: rec.displayName,
          executablePath: rec.executablePath,
          isRunning: false,
          windows: [],
        });
      }
    }
  } catch {
    /* inventory optional */
  }
  apps.push(...runningByApp.values());

  let filtered = apps;
  if (clean) {
    filtered = apps.filter((a) =>
      a.displayName.toLowerCase().includes(clean) ||
      (a.processName || '').toLowerCase().includes(clean) ||
      a.windows.some((w) => w.title.toLowerCase().includes(clean)),
    );
  }
  // Running apps first, then alphabetical.
  filtered.sort((a, b) => (Number(b.isRunning) - Number(a.isRunning)) || a.displayName.localeCompare(b.displayName));
  const shown = filtered.slice(0, 120);

  const payload = shown.map((a) => ({
    app_id: a.appId,
    display_name: a.displayName,
    process_name: a.processName,
    executable_path: a.executablePath,
    is_running: a.isRunning,
    ...(includeWindows
      ? {
          windows: a.windows.map((w) => ({
            window_id: w.windowId,
            handle: w.handle,
            title: w.title,
            bounds: w.bounds,
            monitor_index: w.monitorIndex,
            is_active: w.isActive,
          })),
        }
      : { window_count: a.windows.length }),
  }));

  return [
    `Apps (${shown.length}${filtered.length > shown.length ? ` of ${filtered.length}` : ''}; running first). Pass app_id to desktop_launch_app or window_id to desktop_get_window_state / desktop_window_click.`,
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

/** desktop_list_windows — flat list of open windows in the canonical model. */
export async function desktopListWindowsCanonical(
  selector: { app_id?: string; process_name?: string; title?: string } = {},
): Promise<string> {
  const states = await desktopListWindowStates();
  let filtered = states;
  if (selector.app_id) {
    const id = String(selector.app_id).trim().toLowerCase();
    filtered = filtered.filter((w) => w.appId.toLowerCase() === id || appIdForProcess(w.processName) === id);
  }
  if (selector.process_name) {
    const p = String(selector.process_name).trim().toLowerCase();
    filtered = filtered.filter((w) => w.processName.toLowerCase().includes(p));
  }
  if (selector.title) {
    const t = String(selector.title).trim().toLowerCase();
    filtered = filtered.filter((w) => w.title.toLowerCase().includes(t));
  }
  if (!filtered.length) return 'No open windows matched.';
  const payload = filtered.map((w) => ({
    window_id: w.windowId,
    handle: w.handle,
    app_id: w.appId,
    process_name: w.processName,
    pid: w.pid,
    title: w.title,
    bounds: w.bounds,
    monitor_index: w.monitorIndex,
    is_active: w.isActive,
  }));
  return [
    `Open windows (${filtered.length}). Use window_id with desktop_get_window_state / desktop_window_click / desktop_window_type.`,
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

/**
 * desktop_get_window_state — canonical point-in-time snapshot of one window:
 * resolved window metadata, an optional screenshot (reusing the window crop
 * path and its screenshot_id), and optional accessibility text. This is the
 * single object the LLM should reason over before window-scoped actions.
 */
export async function desktopGetWindowState(
  sessionId: string,
  input: {
    window_id?: string;
    window_handle?: number;
    app_id?: string;
    title?: string;
    include_screenshot?: boolean;
    include_text?: boolean;
    focus_first?: boolean;
  },
): Promise<string> {
  ensureWindows();
  const resolved = await resolveCanonicalWindow({
    window_id: input.window_id,
    window_handle: input.window_handle,
    app_id: input.app_id,
    title: input.title,
    active: !input.window_id && !input.window_handle && !input.app_id && !input.title,
  });
  if (!resolved.ok) return `ERROR: ${resolved.message}`;
  const target = resolved.window;
  const activeHandle = normalizedWindowHandle((await gatherDesktopContextInternal()).activeWindow);
  const state = toDesktopWindowState(target, activeHandle);

  const includeScreenshot = input.include_screenshot !== false;
  const includeText = input.include_text === true;
  const backend = resolveDesktopCaptureBackend();

  let screenshotId: string | undefined;
  let screenshotNote = '';
  if (includeScreenshot) {
    const shot = await desktopWindowScreenshot(sessionId, {
      handle: target.handle,
      name: target.title,
      focus_first: input.focus_first === true,
    }).catch((e: any) => `ERROR: ${e?.message || e}`);
    const idMatch = String(shot).match(/Screenshot ID:\s*(ds_[^\s.]+)/);
    if (idMatch) {
      screenshotId = idMatch[1];
      screenshotNote = `\n${shot}`;
    } else {
      screenshotNote = `\nScreenshot capture failed: ${String(shot).slice(0, 200)}`;
    }
  }

  let accessibility: string | undefined;
  if (includeText) {
    const tree = await desktopGetAccessibilityTree(target.title, 5, 300).catch((e: any) => `ERROR: ${e?.message || e}`);
    accessibility = String(tree);
  }

  const header = {
    state_id: `ws_${state.windowId}_${Date.now().toString(36)}`,
    window: {
      window_id: state.windowId,
      handle: state.handle,
      app_id: state.appId,
      process_name: state.processName,
      pid: state.pid,
      title: state.title,
      bounds: state.bounds,
      monitor_index: state.monitorIndex,
      is_active: state.isActive,
    },
    screenshot_id: screenshotId,
    capture_backend: backend.active,
    captured_at: Date.now(),
  };

  return [
    resolved.hint ? `Note: ${resolved.hint}` : '',
    JSON.stringify(header, null, 2),
    screenshotNote,
    includeText ? `\nAccessibility tree:\n${accessibility}` : '',
  ].filter(Boolean).join('\n');
}

// ─── Window-scoped input (Phase 2) ──────────────────────────────────────────
// Thin wrappers that resolve an exact window first (restoring + focusing it),
// then delegate to the existing input primitives. They make the intended
// "act on this window handle" model explicit and reject stale/foreign targets.

async function prepareWindowForInput(
  selector: { window_id?: string; window_handle?: number; app_id?: string; title?: string },
): Promise<{ ok: true; window: DesktopWindowInfo; hint?: string } | { ok: false; message: string }> {
  const resolved = await resolveCanonicalWindow(selector);
  if (!resolved.ok) return resolved;
  // Restore-if-minimized + focus happens inside focusWindowHandle.
  const focused = await focusWindowHandle(resolved.window.handle).catch(() => false);
  if (!focused) {
    return { ok: false, message: `Could not focus ${shortWindowLabel(resolved.window)} before input. Try desktop_get_window_state to confirm it is still open.` };
  }
  markDesktopStateChanged();
  await new Promise((r) => setTimeout(r, 100));
  return resolved;
}

export async function desktopWindowClick(
  selector: { window_id?: string; window_handle?: number; app_id?: string; title?: string },
  point: { x: number; y: number; coordinate_space?: DesktopCoordinateSpace; screenshot_id?: string },
  options: { button?: 'left' | 'right'; double_click?: boolean; modifier?: 'shift' | 'ctrl' | 'alt'; verify?: DesktopVerificationMode } = {},
  sessionId: string = '__reactor__',
): Promise<string> {
  const prep = await prepareWindowForInput(selector);
  if (!prep.ok) return `ERROR: ${prep.message}`;
  const space = point.coordinate_space || 'window';
  const resolvedPoint = await resolveDesktopActionPoint(sessionId, {
    x: Number(point.x),
    y: Number(point.y),
    coordinate_space: space,
    screenshot_id: point.screenshot_id,
    window_handle: prep.window.handle,
    window_name: prep.window.title,
  }, 'desktop_window_click');
  if (!resolvedPoint.ok) return `ERROR: ${resolvedPoint.message}`;
  const result = await desktopClick(
    resolvedPoint.point.x,
    resolvedPoint.point.y,
    options.button === 'right' ? 'right' : 'left',
    options.double_click === true,
    undefined,
    options.modifier,
    `${resolvedPoint.point.sourceNote} [${shortWindowLabel(prep.window)}]`,
    { mode: options.verify, coordinateSpace: resolvedPoint.point.coordinateSpace },
  );
  return prep.hint && !result.startsWith('ERROR') ? `${result}\nNote: ${prep.hint}` : result;
}

export async function desktopWindowType(
  selector: { window_id?: string; window_handle?: number; app_id?: string; title?: string },
  text: string,
  raw: boolean = false,
): Promise<string> {
  const prep = await prepareWindowForInput(selector);
  if (!prep.ok) return `ERROR: ${prep.message}`;
  const result = raw ? await desktopTypeRaw(String(text || '')) : await desktopType(String(text || ''));
  return prep.hint && !result.startsWith('ERROR') ? `${result}\nNote: ${prep.hint}` : result;
}

export async function desktopWindowPressKey(
  selector: { window_id?: string; window_handle?: number; app_id?: string; title?: string },
  key: string,
): Promise<string> {
  const prep = await prepareWindowForInput(selector);
  if (!prep.ok) return `ERROR: ${prep.message}`;
  const result = await desktopPressKey(String(key || 'Enter'));
  return prep.hint && !result.startsWith('ERROR') ? `${result}\nNote: ${prep.hint}` : result;
}

export async function desktopWindowScroll(
  selector: { window_id?: string; window_handle?: number; app_id?: string; title?: string },
  args: { direction: 'up' | 'down' | 'left' | 'right'; amount?: number; x?: number; y?: number; coordinate_space?: DesktopCoordinateSpace; screenshot_id?: string },
  sessionId: string = '__reactor__',
): Promise<string> {
  const prep = await prepareWindowForInput(selector);
  if (!prep.ok) return `ERROR: ${prep.message}`;
  const dir = args.direction;
  const horizontal = dir === 'left' || dir === 'right';
  let x: number | undefined;
  let y: number | undefined;
  let space: DesktopCoordinateSpace | undefined;
  if (args.x !== undefined && args.y !== undefined) {
    const resolvedPoint = await resolveDesktopActionPoint(sessionId, {
      x: Number(args.x),
      y: Number(args.y),
      coordinate_space: args.coordinate_space || 'window',
      screenshot_id: args.screenshot_id,
      window_handle: prep.window.handle,
      window_name: prep.window.title,
    }, 'desktop_window_scroll');
    if (!resolvedPoint.ok) return `ERROR: ${resolvedPoint.message}`;
    x = resolvedPoint.point.x;
    y = resolvedPoint.point.y;
    space = resolvedPoint.point.coordinateSpace;
  }
  const result = await desktopScroll(
    dir === 'up' || dir === 'left' ? dir : (dir === 'right' ? 'right' : 'down'),
    Number(args.amount || 3),
    x,
    y,
    horizontal,
    undefined,
    `[${shortWindowLabel(prep.window)}]`,
    { coordinateSpace: space },
  );
  return prep.hint && !result.startsWith('ERROR') ? `${result}\nNote: ${prep.hint}` : result;
}

export async function desktopWindowDrag(
  selector: { window_id?: string; window_handle?: number; app_id?: string; title?: string },
  args: { from_x: number; from_y: number; to_x: number; to_y: number; steps?: number; coordinate_space?: DesktopCoordinateSpace; screenshot_id?: string },
  sessionId: string = '__reactor__',
): Promise<string> {
  const prep = await prepareWindowForInput(selector);
  if (!prep.ok) return `ERROR: ${prep.message}`;
  const shared = {
    coordinate_space: args.coordinate_space || 'window' as DesktopCoordinateSpace,
    screenshot_id: args.screenshot_id,
    window_handle: prep.window.handle,
    window_name: prep.window.title,
  };
  const from = await resolveDesktopActionPoint(sessionId, { x: Number(args.from_x), y: Number(args.from_y), ...shared }, 'desktop_window_drag.from');
  if (!from.ok) return `ERROR: ${from.message}`;
  const to = await resolveDesktopActionPoint(sessionId, { x: Number(args.to_x), y: Number(args.to_y), ...shared }, 'desktop_window_drag.to');
  if (!to.ok) return `ERROR: ${to.message}`;
  const result = await desktopDrag(
    from.point.x, from.point.y, to.point.x, to.point.y,
    Number(args.steps || 20), undefined,
    `${from.point.sourceNote} -> ${to.point.sourceNote} [${shortWindowLabel(prep.window)}]`,
    { coordinateSpace: from.point.coordinateSpace },
  );
  return prep.hint && !result.startsWith('ERROR') ? `${result}\nNote: ${prep.hint}` : result;
}

/**
 * Single source of truth for the desktop tool name set. Used by registry
 * parity checks so the gateway definitions, the chat dispatch, and the
 * ToolRegistry wrappers can never silently drift apart.
 */
export function getDesktopToolNames(): string[] {
  return getDesktopToolDefinitions().map((d: any) => d?.function?.name).filter(Boolean);
}

export function getDesktopToolDefinitions(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'desktop_doctor',
        description:
          'Diagnose Prometheus Windows desktop automation health: monitor/DPI metadata, screenshot transport budget and coordinate scale, OCR status, UI Automation availability, active window, and stale screenshot session state. Read-only except for a tiny primary-screen probe capture.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_screenshot',
        description:
          'Capture desktop screenshot with monitor layout, active-window monitor, and window list (each window tagged with monitor index m=N). ' +
          'Default: full virtual screen (all monitors). Use capture=primary for main display only, or monitor_index=0,1,... for a single display. Returns a screenshot_id that later desktop_click/desktop_scroll calls can reuse with coordinate_space="capture". ' +
          'Use region=[x1,y1,x2,y2] to crop to a specific area of the virtual screen at full resolution — ideal for zooming in on one app or section on a multi-monitor setup.',
        parameters: {
          type: 'object',
          properties: {
            capture: {
              type: 'string',
              enum: ['all', 'primary'],
              description: 'all=entire virtual desktop (default). primary=main monitor only. Ignored if monitor_index is set.',
            },
            monitor_index: {
              type: 'integer',
              description: 'Optional 0-based display index to capture only that monitor (overrides capture).',
            },
            region: {
              type: 'array',
              items: { type: 'number' },
              description: 'Optional crop region [x1, y1, x2, y2] in virtual-screen coords. Crops the captured image to this rectangle at full resolution. Use to zoom in on a specific area.',
            },
            mode: { type: 'string', enum: ['normal', 'som'], description: 'Use som to overlay numbered UI Automation elements and enable desktop_click(element=N).' },
            som: { type: 'boolean', description: 'Alias for mode="som".' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_get_monitors',
        description:
          'List connected monitors and virtual-desktop bounds (index, size, and virtual top-left for each monitor). ' +
          'Use this before desktop_screenshot/desktop_click on multi-monitor setups to pick correct monitor_index and coordinates.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_find_window',
        description: 'Find open windows by title or process name.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Partial window title or process name, e.g. "Visual Studio Code"' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_focus_window',
        description: 'Bring a matching window to foreground/focus.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Partial window title or process name to focus' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_window_control',
        description:
          'Safely minimize, maximize, restore, or close a window using native Windows APIs. Prefer this over clicking title-bar chrome hit targets.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['minimize', 'maximize', 'restore', 'close'], description: 'Window action to perform.' },
            name: { type: 'string', description: 'Partial window title or process name.' },
            handle: { type: 'number', description: 'Exact window handle (HWND).' },
            active: { type: 'boolean', description: 'Use the current active window when no name/handle is supplied.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_window_screenshot',
        description:
          'Capture only one app window (cropped from the virtual desktop) and attach that screenshot for vision-capable models. ' +
          'Select a target with name, handle, or active=true. Focuses the window before capture unless focus_first=false is explicitly passed. Returns a screenshot_id that supports coordinate_space="capture" and coordinate_space="window".',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Partial window title or process name to capture.' },
            handle: { type: 'number', description: 'Exact window handle (HWND) to capture.' },
            active: { type: 'boolean', description: 'Capture currently active window (default when no selector provided).' },
            focus_first: { type: 'boolean', description: 'Focus target window before screenshot (default true).' },
            padding: { type: 'number', description: 'Extra pixels around the window bounds (0-120, default 8).' },
            mode: { type: 'string', enum: ['normal', 'som'], description: 'Use som to overlay numbered UI Automation elements and enable desktop_click(element=N).' },
            som: { type: 'boolean', description: 'Alias for mode="som".' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_click',
        description:
          'Perform an actual mouse click at Windows desktop coordinates using virtual, monitor, capture, or window space. ' +
          'Provide x/y coordinates, or provide element=N from a SOM screenshot. If you do not know the target yet, call desktop_screenshot or desktop_window_screenshot first. ' +
          'For screenshot-driven clicks, pass the fresh screenshot_id with coordinate_space="capture" or "window"; avoid raw virtual coordinates after any focus/window movement. ' +
          'For maximize/minimize/restore/close, prefer desktop_window_control instead of clicking window chrome. ' +
          'Use modifier to hold Shift/Ctrl/Alt during click. Returns verification status (`confirmed`, `likely_noop`, `uncertain`, or `failed`) when verification is enabled.',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate in the chosen coordinate space. Omit when using element.' },
            y: { type: 'number', description: 'Y coordinate in the chosen coordinate space. Omit when using element.' },
            element: { type: 'number', description: 'Numbered UI element from desktop_screenshot(mode="som") or desktop_window_screenshot(mode="som"). Requires screenshot_id.' },
            button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button (default left)' },
            double_click: { type: 'boolean', description: 'Double-click instead of single-click' },
            modifier: { type: 'string', enum: ['shift', 'ctrl', 'alt'], description: 'Rare. Only use when the user explicitly wants a modified click such as Shift+click or Ctrl+click.' },
            verify: {
              type: 'string',
              enum: ['off', 'auto', 'strict'],
              description: 'Verification mode. auto defaults on for capture/window targeting and off otherwise. strict always probes for confirmation.',
            },
            coordinate_space: {
              type: 'string',
              enum: ['virtual', 'monitor', 'capture', 'window'],
              description: 'virtual=global desktop coords. monitor=coords relative to monitor_index. capture=coords relative to screenshot_id image. window=coords relative to target window top-left. Prefer capture/window with a fresh screenshot_id.',
            },
            screenshot_id: {
              type: 'string',
              description: 'Screenshot ID returned by desktop_screenshot or desktop_window_screenshot. Required for coordinate_space="capture"; optional but recommended for coordinate_space="window".',
            },
            window_name: {
              type: 'string',
              description: 'Optional window title/process name when coordinate_space="window".',
            },
            window_handle: {
              type: 'number',
              description: 'Optional exact window handle when coordinate_space="window".',
            },
            monitor_relative: {
              type: 'boolean',
              description: 'Legacy alias for coordinate_space="monitor". If true, x/y are relative to monitor_index top-left.',
            },
            monitor_index: { type: 'integer', description: '0-based display index when using monitor coordinates' },
            final_action_approval_id: { type: 'string', description: 'One-shot approval id from request_final_action_approval when this click triggers a final post/send/publish/purchase/delete/submit action.' },
            capture_after: { type: 'boolean', description: 'If true, capture a fresh desktop screenshot after the click and include it in the result.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_drag',
        description:
          'Drag between two points using virtual, monitor, capture, or window space. coordinate_space, screenshot_id, and window targeting apply to both endpoints. Returns verification status when verification is enabled.',
        parameters: {
          type: 'object',
          required: ['from_x', 'from_y', 'to_x', 'to_y'],
          properties: {
            from_x: { type: 'number', description: 'Start X in the chosen coordinate space' },
            from_y: { type: 'number', description: 'Start Y in the chosen coordinate space' },
            to_x: { type: 'number', description: 'End X in the chosen coordinate space' },
            to_y: { type: 'number', description: 'End Y in the chosen coordinate space' },
            steps: { type: 'number', description: 'Interpolation steps (default 20)' },
            verify: {
              type: 'string',
              enum: ['off', 'auto', 'strict'],
              description: 'Verification mode. auto defaults on for capture/window targeting and off otherwise.',
            },
            coordinate_space: {
              type: 'string',
              enum: ['virtual', 'monitor', 'capture', 'window'],
              description: 'Coordinate space shared by both drag endpoints.',
            },
            screenshot_id: {
              type: 'string',
              description: 'Screenshot ID returned by desktop_screenshot or desktop_window_screenshot.',
            },
            window_name: { type: 'string', description: 'Optional window title/process name when coordinate_space="window".' },
            window_handle: { type: 'number', description: 'Optional exact window handle when coordinate_space="window".' },
            monitor_relative: { type: 'boolean', description: 'Legacy alias for coordinate_space="monitor".' },
            monitor_index: { type: 'integer', description: '0-based display when using monitor coordinates' },
            capture_after: { type: 'boolean', description: 'If true, capture a fresh desktop screenshot after the drag and include it in the result.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_wait',
        description: 'Pause execution for a number of milliseconds.',
        parameters: {
          type: 'object',
          properties: {
            ms: { type: 'number', description: 'Milliseconds to wait (50-30000)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_type',
        description: 'Type text into the currently focused desktop window (via clipboard paste).',
        parameters: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', description: 'Text to type' },
            capture_after: { type: 'boolean', description: 'If true, capture a fresh desktop screenshot after typing and include it in the result.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_press_key',
        description: 'Press a key in the focused desktop window. Supports Enter, Escape, Tab, PageDown, Ctrl+C, Ctrl+V, etc.',
        parameters: {
          type: 'object',
          required: ['key'],
          properties: {
            key: { type: 'string', description: 'Key or combo, e.g. Enter, Escape, Ctrl+C, Alt+Tab' },
            final_action_approval_id: { type: 'string', description: 'One-shot approval id from request_final_action_approval when this keypress triggers a final post/send/publish/purchase/delete/submit action.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_get_clipboard',
        description: 'Read clipboard text.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_set_clipboard',
        description: 'Write text, an image file, or a file list to the clipboard. For a single image file, use mode="image" or mode="auto" and then paste with Ctrl+V.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Clipboard text' },
            file_path: { type: 'string', description: 'Single file path to place on the clipboard' },
            file_paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Multiple file paths to place on the clipboard as a file-drop list',
            },
            mode: {
              type: 'string',
              enum: ['auto', 'text', 'image', 'files'],
              description: 'auto chooses image for one image file, otherwise files.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_list_installed_apps',
        description:
          'List installed desktop apps discovered from Start Menu shortcuts, Get-StartApps, App Paths, and common install directories. ' +
          'Returns stable app_id values you can pass to desktop_launch_app for deterministic launching.',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'string', description: 'Optional substring filter for names, aliases, process hints, or window hints.' },
            limit: { type: 'number', description: 'Max apps to return (default 40, max 200).' },
            refresh: { type: 'boolean', description: 'If true, force a fresh Windows scan before listing.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_find_installed_app',
        description:
          'Rank installed app matches for a fuzzy query such as "claude", "codex", or "vscode". ' +
          'Use this before desktop_launch_app when you need an exact app_id.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Fuzzy app query, e.g. "claude", "cursor", "visual studio code".' },
            limit: { type: 'number', description: 'Max ranked matches to return (default 10, max 50).' },
            refresh: { type: 'boolean', description: 'If true, force a fresh Windows scan before searching.' },
          },
        },
      },
    },
    // Phase 4: App launch / process control
    {
      type: 'function',
      function: {
        name: 'desktop_launch_app',
        description:
          'Launch a desktop application and wait for its window to appear. ' +
          'Prefer app_id from desktop_find_installed_app or desktop_list_installed_apps for deterministic launches; app still accepts a raw executable name or path for backwards compatibility.',
        parameters: {
          type: 'object',
          properties: {
            app_id: { type: 'string', description: 'Stable installed-app ID returned by desktop_find_installed_app or desktop_list_installed_apps.' },
            app: { type: 'string', description: 'Raw application name or full path, e.g. notepad, code, calc. Optional when app_id is provided.' },
            args: { type: 'string', description: 'Optional command-line arguments' },
            wait_ms: { type: 'number', description: 'Max ms to wait for window (default 6000)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_close_app',
        description: 'Close a window or application by title/process name. Use force=true to kill immediately.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Partial window title or process name' },
            force: { type: 'boolean', description: 'Force-kill instead of graceful close' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_get_process_list',
        description: 'List running processes with visible windows. Optionally filter by name.',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'string', description: 'Optional partial name/title filter' },
          },
        },
      },
    },
    // Phase 3: Screenshot diffing
    {
      type: 'function',
      function: {
        name: 'desktop_wait_for_change',
        description: 'Wait until the screen content changes or timeout. Useful for waiting for loading spinners or dialogs.',
        parameters: {
          type: 'object',
          properties: {
            timeout_ms: { type: 'number', description: 'Max wait in ms (default 10000)' },
            poll_ms: { type: 'number', description: 'Poll interval in ms (default 800)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_diff_screenshot',
        description: 'Describe what changed between the last two desktop screenshots (OCR + window diff). Call desktop_screenshot first.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_background_status',
        description:
          'Check the non-interrupting background desktop setup. Explains why host desktop tools are foreground-only and reports Windows Sandbox/Hyper-V/RDP/bridge readiness.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_background_prepare_sandbox',
        description:
          'Create a Windows Sandbox .wsb profile, mapped bridge folder, and PowerShell worker so Prometheus can control an isolated desktop without stealing host mouse/keyboard focus. Pass launch=true to open it.',
        parameters: {
          type: 'object',
          properties: {
            launch: { type: 'boolean', description: 'Open Windows Sandbox after generating the profile.' },
            networking: { type: 'string', enum: ['enable', 'disable', 'default'], description: 'Sandbox networking setting.' },
            vgpu: { type: 'string', enum: ['enable', 'disable', 'default'], description: 'Sandbox virtual GPU setting.' },
            memory_mb: { type: 'number', description: 'Sandbox memory in MB. Default 4096.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_background_command',
        description:
          'Send a command to the isolated background desktop worker through the folder bridge. Supported actions: screenshot, click, type, key, run, wait. This does not target the host desktop.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['screenshot', 'click', 'type', 'key', 'run', 'wait'] },
            x: { type: 'number', description: 'X coordinate for click inside the background desktop.' },
            y: { type: 'number', description: 'Y coordinate for click inside the background desktop.' },
            text: { type: 'string', description: 'Text for type action.' },
            key: { type: 'string', description: 'PowerShell SendKeys syntax, e.g. {ENTER}, {TAB}, ^s.' },
            command: { type: 'string', description: 'Command for run action inside the background desktop.' },
            ms: { type: 'number', description: 'Milliseconds for wait action.' },
            timeout_ms: { type: 'number', description: 'Milliseconds to wait for worker response.' },
          },
        },
      },
    },
    // Window text reader via UI Automation
    {
      type: 'function',
      function: {
        name: 'desktop_get_window_text',
        description:
          'Extract readable text from a window using Windows UI Automation. More reliable than OCR for text-based UIs (terminals, editors, forms). ' +
          'Returns all visible text labels and input values from the window. If no window name given, reads the active foreground window.',
        parameters: {
          type: 'object',
          properties: {
            window_name: { type: 'string', description: 'Partial window title or process name. Leave empty for active window.' },
          },
        },
      },
    },
    // Scroll
    {
      type: 'function',
      function: {
        name: 'desktop_scroll',
        description:
          'Scroll the mouse wheel at optional (x,y). Coordinates use virtual screen unless monitor_relative + monitor_index (same as desktop_click). Move the cursor over the scrollable area first (e.g. click the chat pane in Electron apps) — wheel events go to whatever control is under the pointer. Essential for multi-pane and multi-monitor targeting.',
        parameters: {
          type: 'object',
          required: ['direction'],
          properties: {
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction (left/right = horizontal)' },
            amount: { type: 'number', description: 'Wheel ticks 1-50 (default 3). Fine-grained for subtle scroll.' },
            x: { type: 'number', description: 'Optional X in the chosen coordinate space' },
            y: { type: 'number', description: 'Optional Y in the chosen coordinate space' },
            axis: { type: 'string', enum: ['vertical', 'horizontal'], description: 'Override axis (inferred from direction if omitted)' },
            verify: {
              type: 'string',
              enum: ['off', 'auto', 'strict'],
              description: 'Verification mode. auto defaults on for capture/window targeting and off otherwise.',
            },
            coordinate_space: {
              type: 'string',
              enum: ['virtual', 'monitor', 'capture', 'window'],
              description: 'Coordinate space for x/y when provided.',
            },
            screenshot_id: {
              type: 'string',
              description: 'Screenshot ID returned by desktop_screenshot or desktop_window_screenshot.',
            },
            window_name: { type: 'string', description: 'Optional window title/process name when coordinate_space="window".' },
            window_handle: { type: 'number', description: 'Optional exact window handle when coordinate_space="window".' },
            monitor_relative: { type: 'boolean', description: 'Legacy alias for coordinate_space="monitor".' },
            monitor_index: { type: 'integer', description: '0-based display when using monitor coordinates' },
            capture_after: { type: 'boolean', description: 'If true, capture a fresh desktop screenshot after scrolling and include it in the result.' },
          },
        },
      },
    },
    // Raw typing fallback
    {
      type: 'function',
      function: {
        name: 'desktop_type_raw',
        description: 'Type text character-by-character using raw key events. Use when desktop_type (clipboard paste) is rejected by the app — e.g. password fields, terminals, or apps that intercept clipboard. Slower, max 2000 chars.',
        parameters: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', description: 'Text to type (max 2000 chars)' },
          },
        },
      },
    },
    // Send screenshot to Telegram
    {
      type: 'function',
      function: {
        name: 'desktop_send_to_telegram',
        description: 'Send the most recently captured desktop screenshot to Telegram. Must call desktop_screenshot first. Use to share your screen state with the user mid-task or on completion.',
        parameters: {
          type: 'object',
          properties: {
            caption: { type: 'string', description: 'Optional caption for the photo (default: "Desktop screenshot")' },
          },
        },
      },
    },
    // ─ NEW POWER TOOLS ──────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'desktop_get_accessibility_tree',
        description:
          'Return the full Windows UI Automation accessibility tree for a window. ' +
          'Far richer than desktop_get_window_text — includes roles (Button, Edit, TreeItem, etc.), ' +
          'names, enabled/focused state, and bounding boxes. ' +
          'Use to understand precise UI structure, find controls by role/name, or check disabled states ' +
          'without relying on OCR or screenshots. ' +
          'If window_name is omitted, reads the active foreground window.',
        parameters: {
          type: 'object',
          properties: {
            window_name: { type: 'string', description: 'Partial window title or process name. Leave empty for active window.' },
            max_depth: { type: 'integer', description: 'Max tree depth to walk (1-10, default 5). Reduce if output is very large.' },
            max_nodes: { type: 'integer', description: 'Max total nodes to return (10-1000, default 300).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_pixel_watch',
        description:
          'Poll a specific pixel on the virtual desktop until its color changes (or matches a target color). ' +
          'Use instead of polling full screenshots — 100× cheaper on tokens. ' +
          'Example uses: wait for a loading spinner to disappear (color change), wait for a status indicator to go green. ' +
          'Samples a 1×1 pixel region every poll_ms milliseconds.',
        parameters: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            x: { type: 'number', description: 'Virtual-screen X coordinate of the pixel to watch' },
            y: { type: 'number', description: 'Virtual-screen Y coordinate of the pixel to watch' },
            target_color: {
              type: 'string',
              description: 'Optional hex color to wait FOR (e.g. "#00FF00"). If omitted, waits for ANY color change from the initial sample.',
            },
            timeout_ms: { type: 'number', description: 'Max wait in ms (default 15000, max 120000).' },
            poll_ms: { type: 'number', description: 'Poll interval in ms (default 500, min 100).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_record_macro',
        description:
          'Start recording a desktop macro. All subsequent desktop_click, desktop_type, desktop_press_key, ' +
          'and desktop_scroll calls will be captured with their timing. ' +
          'Call desktop_stop_macro() when done. Then use desktop_replay_macro(name) to replay. ' +
          'Use to automate repetitive multi-step workflows that run many times.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Name to save the macro under (e.g. "login-flow", "daily-report")' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_stop_macro',
        description: 'Stop the active macro recording and save it. Must call desktop_record_macro first.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Optional override name (defaults to the name given to desktop_record_macro)' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_replay_macro',
        description:
          'Replay a saved desktop macro. Actions are executed with their original timing by default. ' +
          'speed_multiplier=2.0 plays twice as fast, 0.5 at half speed. ' +
          'Use desktop_list_macros() to see available macros.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Macro name to replay' },
            speed_multiplier: { type: 'number', description: 'Playback speed (0.1–10.0, default 1.0). Higher = faster.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_list_macros',
        description: 'List all saved desktop macros and their action counts.',
        parameters: { type: 'object', properties: {} },
      },
    },
    // ─ Canonical app / window / state model (Phase 1) ────────────────────────
    {
      type: 'function',
      function: {
        name: 'desktop_list_apps',
        description:
          'List installed and running apps in the canonical model. Running apps come first, each with their open windows (window_id, handle, bounds, is_active). Returns stable app_id values for desktop_launch_app and window_id values for desktop_get_window_state / desktop_window_click. Prefer this for app discovery.',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'string', description: 'Optional substring filter across app names, processes, and window titles.' },
            include_windows: { type: 'boolean', description: 'Include each app\'s open windows (default true). Set false for a lighter list.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_list_windows',
        description:
          'Flat list of currently open windows in the canonical model: window_id, handle, app_id, process_name, title, bounds, monitor_index, is_active. Use window_id with desktop_get_window_state and the desktop_window_* input tools for deterministic targeting.',
        parameters: {
          type: 'object',
          properties: {
            app_id: { type: 'string', description: 'Filter to one app_id (from desktop_list_apps).' },
            process_name: { type: 'string', description: 'Filter by process name substring.' },
            title: { type: 'string', description: 'Filter by window title substring.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_get_window_state',
        description:
          'Canonical point-in-time snapshot of one window: resolved metadata, an optional screenshot (with a screenshot_id reusable for coordinate_space="capture"/"window"), and optional accessibility text. Identify the window by window_id (preferred), window_handle, app_id, or title; with no selector it captures the active window. This is the object to reason over before window-scoped actions.',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: 'Stable window id (win_<handle>) from desktop_list_windows / desktop_list_apps.' },
            window_handle: { type: 'number', description: 'Exact window handle (HWND).' },
            app_id: { type: 'string', description: 'Target an app_id; resolves to its active/only window.' },
            title: { type: 'string', description: 'Partial window title or process name.' },
            include_screenshot: { type: 'boolean', description: 'Capture and attach a window screenshot (default true).' },
            include_text: { type: 'boolean', description: 'Include the UI Automation accessibility tree (default false).' },
            focus_first: { type: 'boolean', description: 'Focus the window before capture (default false; passive inspection).' },
          },
        },
      },
    },
    // ─ Window-scoped input (Phase 2) ─────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'desktop_window_click',
        description:
          'Click inside a specific window identified by window_id (preferred), window_handle, app_id, or title. Restores + focuses the window first, then clicks. Coordinates default to window-space (top-left of the window is 0,0); pass coordinate_space + screenshot_id to use capture-space image pixels. Prefer this over desktop_click when you know the target window.',
        parameters: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            window_id: { type: 'string', description: 'Stable window id (win_<handle>).' },
            window_handle: { type: 'number', description: 'Exact window handle (HWND).' },
            app_id: { type: 'string', description: 'Target app_id (resolves to its active/only window).' },
            title: { type: 'string', description: 'Partial window title/process name (least precise).' },
            x: { type: 'number', description: 'X coordinate (window-space by default).' },
            y: { type: 'number', description: 'Y coordinate (window-space by default).' },
            coordinate_space: { type: 'string', enum: ['window', 'capture', 'virtual', 'monitor'], description: 'Defaults to window.' },
            screenshot_id: { type: 'string', description: 'Required when coordinate_space="capture".' },
            button: { type: 'string', enum: ['left', 'right'] },
            double_click: { type: 'boolean' },
            modifier: { type: 'string', enum: ['shift', 'ctrl', 'alt'] },
            verify: { type: 'string', enum: ['off', 'auto', 'strict'] },
            final_action_approval_id: { type: 'string', description: 'One-shot approval id when this click is a final post/send/publish/purchase/delete/submit action.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_window_type',
        description:
          'Type text into a specific window identified by window_id (preferred), window_handle, app_id, or title. Focuses the window first, then types via clipboard paste (or raw key events when raw=true). Prefer over desktop_type when you know the target window.',
        parameters: {
          type: 'object',
          required: ['text'],
          properties: {
            window_id: { type: 'string' },
            window_handle: { type: 'number' },
            app_id: { type: 'string' },
            title: { type: 'string' },
            text: { type: 'string', description: 'Text to type.' },
            raw: { type: 'boolean', description: 'Use raw character-by-character key events instead of clipboard paste.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_window_press_key',
        description:
          'Press a key/combo in a specific window identified by window_id (preferred), window_handle, app_id, or title. Focuses the window first. Examples: Enter, Escape, Ctrl+S, Alt+Tab.',
        parameters: {
          type: 'object',
          required: ['key'],
          properties: {
            window_id: { type: 'string' },
            window_handle: { type: 'number' },
            app_id: { type: 'string' },
            title: { type: 'string' },
            key: { type: 'string', description: 'Key or combo, e.g. Enter, Ctrl+C.' },
            final_action_approval_id: { type: 'string', description: 'One-shot approval id when this keypress is a final post/send/publish/purchase/delete/submit action.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_window_scroll',
        description:
          'Scroll inside a specific window identified by window_id (preferred), window_handle, app_id, or title. Focuses the window first. Provide x/y (window-space by default) to position the cursor over the scrollable pane before scrolling.',
        parameters: {
          type: 'object',
          required: ['direction'],
          properties: {
            window_id: { type: 'string' },
            window_handle: { type: 'number' },
            app_id: { type: 'string' },
            title: { type: 'string' },
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
            amount: { type: 'number', description: 'Wheel ticks (default 3).' },
            x: { type: 'number', description: 'Optional X to position cursor (window-space by default).' },
            y: { type: 'number', description: 'Optional Y to position cursor (window-space by default).' },
            coordinate_space: { type: 'string', enum: ['window', 'capture', 'virtual', 'monitor'] },
            screenshot_id: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_window_drag',
        description:
          'Drag between two points inside a specific window identified by window_id (preferred), window_handle, app_id, or title. Focuses the window first. Both endpoints default to window-space.',
        parameters: {
          type: 'object',
          required: ['from_x', 'from_y', 'to_x', 'to_y'],
          properties: {
            window_id: { type: 'string' },
            window_handle: { type: 'number' },
            app_id: { type: 'string' },
            title: { type: 'string' },
            from_x: { type: 'number' },
            from_y: { type: 'number' },
            to_x: { type: 'number' },
            to_y: { type: 'number' },
            steps: { type: 'number', description: 'Interpolation steps (default 20).' },
            coordinate_space: { type: 'string', enum: ['window', 'capture', 'virtual', 'monitor'] },
            screenshot_id: { type: 'string' },
          },
        },
      },
    },
  ];
}
