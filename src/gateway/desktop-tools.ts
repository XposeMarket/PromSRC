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
  screenshotBase64: string;
  screenshotMime: 'image/png';
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
  /** How the bitmap maps to virtual-screen clicks */
  captureMode?: 'all' | 'primary' | 'monitor';
  /** When captureMode === 'monitor', which display index */
  captureMonitorIndex?: number;
  /** Which monitor holds the foreground window (if known) */
  activeMonitorIndex?: number | null;
}

/** Options for `desktop_screenshot` / `desktopScreenshot` */
export interface DesktopScreenshotOptions {
  /** Omit or `all` = full virtual screen; `primary` = main display only; number = 0-based monitor index */
  capture?: 'all' | 'primary' | number;
  /** Optional crop region in virtual-screen coords: [x1, y1, x2, y2]. Applied after capture. */
  region?: [number, number, number, number];
}

/** Optional pointer tools: coords relative to a monitor's top-left */
export interface DesktopPointerMonitorOptions {
  monitor_relative?: boolean;
  monitor_index?: number;
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

interface DesktopContextGathered {
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
async function gatherDesktopContextInternal(): Promise<DesktopContextGathered> {
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
  $activeWindow = [ordered]@{
    pid = [int]$apid
    processName = $procName
    title = $winTitle
    handle = [int64]$hFg.ToInt64()
    monitorIndex = [int]$actMi
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

async function listWindowsInternal(): Promise<DesktopWindowInfo[]> {
  const ctx = await gatherDesktopContextInternal();
  return ctx.windows;
}

async function activeWindowInternal(): Promise<DesktopWindowInfo | null> {
  const ctx = await gatherDesktopContextInternal();
  return ctx.activeWindow;
}

/** Lightweight monitor list for coordinate conversion (desktop_click / scroll). */
async function enumerateMonitorsInternal(): Promise<DesktopMonitorInfo[]> {
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

type DesktopCaptureMode = { kind: 'all' } | { kind: 'primary' } | { kind: 'monitor'; index: number };

function parseScreenshotCaptureMode(opts?: DesktopScreenshotOptions): DesktopCaptureMode {
  const c = opts?.capture;
  if (typeof c === 'number' && Number.isFinite(c) && c >= 0) {
    return { kind: 'monitor', index: Math.floor(c) };
  }
  if (c === 'primary') return { kind: 'primary' };
  return { kind: 'all' };
}

async function captureScreenshotInternal(
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
    $cropped = New-Object System.Drawing.Bitmap $cw, $ch
    $gc = [System.Drawing.Graphics]::FromImage($cropped)
    $gc.DrawImage($bmp, 0, 0, [System.Drawing.Rectangle]::new($cx, $cy, $cw, $ch), [System.Drawing.GraphicsUnit]::Pixel)
    $gc.Dispose()
    $bmp.Dispose()
    $bmp = $cropped
    $bounds = [System.Drawing.Rectangle]::new($cropX1, $cropY1, $cw, $ch)
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

async function focusWindowHandle(handle: number): Promise<boolean> {
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

function computeContentHash(base64: string): string {
  return crypto.createHash('sha1').update(base64 || '').digest('hex');
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
  const ocr = await runOcr(shot.path);

  const png = fs.readFileSync(shot.path);
  try { fs.unlinkSync(shot.path); } catch {}

  const screenshotBase64 = png.toString('base64');
  const capturedAt = Date.now();
  const vs = ctx.virtualScreen;
  const activeMonitorIndex =
    activeWindow?.monitorIndex !== undefined && activeWindow.monitorIndex >= 0
      ? activeWindow.monitorIndex
      : null;

  const packet: DesktopAdvisorPacket = {
    screenshotBase64,
    screenshotMime: 'image/png',
    width: shot.width,
    height: shot.height,
    capturedAt,
    openWindows,
    activeWindow: activeWindow || undefined,
    ocrText: ocr?.text,
    ocrConfidence: ocr?.confidence,
    contentHash: computeContentHash(screenshotBase64),
    monitors: ctx.monitors.length ? ctx.monitors : undefined,
    virtualScreen: vs.width > 0 ? vs : undefined,
    captureRegion: { left: shot.left, top: shot.top, width: shot.width, height: shot.height },
    captureMode: shot.captureMode,
    captureMonitorIndex: shot.captureMonitorIndex,
    activeMonitorIndex,
  };
  sessions.set(sessionId, { lastPacket: packet });

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
      ? 'Coordinates: (0,0) in this image = virtual top-left above.'
      : `Coordinates: pixels in this image are relative to capture top-left (${shot.left}, ${shot.top}). For desktop_click / scroll at (x,y), use virtual coords: x_virtual = image_x + ${shot.left}, y_virtual = image_y + ${shot.top}. If capture mode is monitor N, you can also use monitor_relative=true with monitor_index=N and local monitor coordinates directly.`;

  const activeMonLine =
    activeMonitorIndex !== null
      ? `Active (foreground) window is on monitor ${activeMonitorIndex}.`
      : '';

  return [
    `Desktop screenshot captured (${shot.width}x${shot.height}).`,
    captureSummary,
    virtualLine,
    formatMonitorsForReply(ctx.monitors),
    activeMonLine,
    coordHint,
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
  return `Focused window: "${target.title}" (${target.processName}).`;
}

export async function desktopClick(
  x: number,
  y: number,
  button: 'left' | 'right' = 'left',
  doubleClick: boolean = false,
  pointerOpts?: DesktopPointerMonitorOptions,
  modifier?: 'shift' | 'ctrl' | 'alt',
): Promise<string> {
  ensureWindows();
  const resolved = await resolveVirtualPointerCoords(x, y, pointerOpts);
  if (!resolved.ok) return `ERROR: ${resolved.message}`;
  const xx = resolved.x;
  const yy = resolved.y;
  const btn = button === 'right' ? 'right' : 'left';
  const downFlag = btn === 'right' ? '0x0008' : '0x0002';
  const upFlag = btn === 'right' ? '0x0010' : '0x0004';
  const repeat = doubleClick ? 2 : 1;
  // Modifier key VK codes: Shift=0x10, Ctrl=0x11, Alt=0x12
  const modVk = modifier === 'shift' ? '0x10' : modifier === 'ctrl' ? '0x11' : modifier === 'alt' ? '0x12' : null;
  const modDown = modVk ? `[PrometheusInputApi]::keybd_event(${modVk}, 0, 0, [UIntPtr]::Zero)` : '';
  const modUp = modVk ? `[PrometheusInputApi]::keybd_event(${modVk}, 0, 0x0002, [UIntPtr]::Zero)` : '';

  const script = `
${PS_INPUTAPI_HEADER}
[void][PrometheusInputApi]::SetCursorPos(${xx}, ${yy})
Start-Sleep -Milliseconds 40
${modDown}
for ($i = 0; $i -lt ${repeat}; $i++) {
  [PrometheusInputApi]::mouse_event(${downFlag}, 0, 0, 0, [UIntPtr]::Zero)
  [PrometheusInputApi]::mouse_event(${upFlag}, 0, 0, 0, [UIntPtr]::Zero)
  if ($i -lt ${repeat - 1}) { Start-Sleep -Milliseconds 80 }
}
${modUp}
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 6000 });
  const monitors = await enumerateMonitorsInternal().catch(() => [] as DesktopMonitorInfo[]);
  const hit = monitors.find((m) =>
    xx >= m.left && xx < (m.left + m.width) && yy >= m.top && yy < (m.top + m.height),
  );
  const relNote =
    pointerOpts?.monitor_relative && pointerOpts.monitor_index !== undefined
      ? ` [monitor_relative m=${pointerOpts.monitor_index} → virtual (${xx}, ${yy})]`
      : '';
  const monitorNote = hit
    ? ` [monitor m=${hit.index} local=(${xx - hit.left}, ${yy - hit.top}) of ${hit.width}x${hit.height}]`
    : '';
  const modNote = modifier ? ` [+${modifier}]` : '';
  // Record for macro replay (use resolved virtual coords so replay is coordinate-safe)
  _macroRecord({ type: doubleClick ? 'double_click' : 'click', x: xx, y: yy, button: btn });
  return `Clicked ${btn} at (${xx}, ${yy})${doubleClick ? ' [double]' : ''}${modNote}${relNote}${monitorNote}.`;
}

export async function desktopDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps: number = 20,
  pointerOpts?: DesktopPointerMonitorOptions,
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

  const script = `
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
  return `Dragged from (${fx}, ${fy}) to (${tx}, ${ty}) in ${st} steps.${monNote}`;
}

export async function desktopWait(ms: number = 500): Promise<string> {
  const waitMs = Math.max(50, Math.min(30000, Math.floor(Number(ms) || 500)));
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return `Waited ${waitMs} ms.`;
}

function toSendKeysSpec(keyRaw: string): string {
  const raw = String(keyRaw || '').trim();
  if (!raw) return '{ENTER}';

  const mapBase = (token: string): string => {
    const t = token.toLowerCase();
    if (t === 'enter' || t === 'return') return '{ENTER}';
    if (t === 'escape' || t === 'esc') return '{ESC}';
    if (t === 'tab') return '{TAB}';
    if (t === 'space') return ' ';
    if (t === 'backspace') return '{BACKSPACE}';
    if (t === 'delete' || t === 'del') return '{DEL}';
    if (t === 'up' || t === 'arrowup') return '{UP}';
    if (t === 'down' || t === 'arrowdown') return '{DOWN}';
    if (t === 'left' || t === 'arrowleft') return '{LEFT}';
    if (t === 'right' || t === 'arrowright') return '{RIGHT}';
    if (t === 'pagedown' || t === 'pgdn') return '{PGDN}';
    if (t === 'pageup' || t === 'pgup') return '{PGUP}';
    if (t === 'home') return '{HOME}';
    if (t === 'end') return '{END}';
    if (t === 'insert' || t === 'ins') return '{INS}';
    const fn = t.match(/^f([1-9]|1[0-2])$/);
    if (fn) return `{F${fn[1]}}`;
    if (/^[a-z0-9]$/i.test(token)) return token;
    return token;
  };

  const parts = raw.split('+').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return mapBase(parts[0] || raw);

  const base = mapBase(parts[parts.length - 1]);
  let mods = '';
  for (const m of parts.slice(0, -1)) {
    const mm = m.toLowerCase();
    if (mm === 'ctrl' || mm === 'control' || mm === 'cmd' || mm === 'command') mods += '^';
    else if (mm === 'shift') mods += '+';
    else if (mm === 'alt' || mm === 'option') mods += '%';
  }
  return `${mods}${base}`;
}

export async function desktopType(text: string): Promise<string> {
  ensureWindows();
  const payload = String(text || '');
  if (!payload) return 'Typed 0 character(s).';

  const MAX_TYPE_LENGTH = 50000;
  if (payload.length > MAX_TYPE_LENGTH) {
    return `ERROR: Text too long (${payload.length} chars). Maximum is ${MAX_TYPE_LENGTH} chars.`;
  }

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
  _macroRecord({ type: 'type', text: payload });
  return `Typed ${payload.length} character(s) via clipboard paste (clipboard restored).`;
}

export async function desktopPressKey(key: string): Promise<string> {
  ensureWindows();
  const spec = toSendKeysSpec(key);
  const escaped = psSingleQuote(spec);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 6000, sta: true });
  _macroRecord({ type: 'key', text: key });
  return `Pressed key: ${key || 'Enter'}.`;
}

export async function desktopGetClipboard(): Promise<string> {
  ensureWindows();
  const script = `
Add-Type -AssemblyName System.Windows.Forms
if ([System.Windows.Forms.Clipboard]::ContainsText()) {
  [System.Windows.Forms.Clipboard]::GetText()
}
`;
  const out = await runPowerShell(script, { timeoutMs: 6000, sta: true });
  if (!out) return 'Clipboard is empty.';
  if (out.length > 5000) {
    return `Clipboard text (${out.length} chars):\n${out.slice(0, 5000)}\n...(truncated)`;
  }
  return `Clipboard text (${out.length} chars):\n${out}`;
}

export async function desktopSetClipboard(text: string): Promise<string> {
  ensureWindows();
  const payload = String(text || '');
  const escaped = psSingleQuote(payload);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText('${escaped}')
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 6000, sta: true });
  return `Clipboard updated (${payload.length} chars).`;
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
): Promise<string> {
  ensureWindows();
  const ticks = Math.max(1, Math.min(50, Math.floor(Number(amount) || 3)));
  const isUpOrLeft = direction === 'up' || direction === 'left';
  const delta = isUpOrLeft ? 120 * ticks : -120 * ticks;
  // MOUSEEVENTF_WHEEL = 0x0800 (vertical), MOUSEEVENTF_HWHEEL = 0x1000 (horizontal)
  const flag = horizontal ? '0x1000' : '0x0800';
  let mx: number | undefined;
  let my: number | undefined;
  if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
    const r = await resolveVirtualPointerCoords(Number(x), Number(y), pointerOpts);
    if (!r.ok) return `ERROR: ${r.message}`;
    mx = r.x;
    my = r.y;
  }
  const movePart =
    mx !== undefined && my !== undefined
      ? `[void][PrometheusInputApi]::SetCursorPos(${mx}, ${my}); Start-Sleep -Milliseconds 75;`
      : '';
  const script = `
${PS_INPUTAPI_HEADER}
${movePart}
[PrometheusInputApi]::mouse_event(${flag}, 0, 0, [int]${delta}, [UIntPtr]::Zero)
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 6000 });
  const axisLabel = horizontal ? 'horizontal' : 'vertical';
  const dirLabel = direction;
  const at =
    mx !== undefined && my !== undefined ? ` at virtual (${mx}, ${my})` : '';
  _macroRecord({ type: 'scroll', direction, amount: ticks, horizontal, x: mx, y: my });
  return `Scrolled ${axisLabel} ${dirLabel} ${ticks} tick(s)${at}.`;
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
    $hwnd = [System.Windows.Forms.Form]::ActiveForm
    $fgWnd = [System.Runtime.InteropServices.Marshal]::GetActiveObject
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
    const out = await runPowerShell(script, { timeoutMs: 20000 });
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
    const buf = fs.readFileSync(captured.path);
    try { fs.unlinkSync(captured.path); } catch { /* best effort */ }
    results.push({ buf, width: captured.width, height: captured.height });
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

/**
 * Launch a desktop application by name or path and wait for a window to appear.
 * Returns a status string with the window handle once visible.
 */
export async function desktopLaunchApp(
  app: string,
  appArgs: string = '',
  waitMs: number = 6000,
): Promise<string> {
  ensureWindows();
  const appSafe = psSingleQuote(String(app || '').trim());
  const argsSafe = psSingleQuote(String(appArgs || '').trim());
  const pollMs = 400;
  const maxPolls = Math.max(1, Math.floor(clampInt(waitMs, 200, 60000, 6000) / pollMs));

  // Console apps (cmd, powershell, etc.) need -WindowStyle Normal to get a visible window.
  // For all other apps the parameter is harmless.
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
    return `ERROR: Failed to launch '${app}': ${launchOut.slice(6)}`;
  }
  const launchedPid = Number(launchOut.replace('LAUNCHED:', '').trim()) || 0;

  // Poll for window appearance
  // Console apps (cmd, powershell) are hosted by conhost.exe — their PID in the window list
  // may be the conhost PID, not the cmd.exe PID. We use a multi-strategy search.
  const appLower = String(app || '').toLowerCase().replace(/\.exe$/i, '');
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
          w.processName.toLowerCase().includes(appLower) ||
          w.title.toLowerCase().includes(appLower),
        );
      }

      if (match) {
        lastHandle = match.handle;
        return `Launched '${app}' (PID ${launchedPid || match.pid}). Window: "${match.title}" (${match.processName}) handle=${match.handle}.`;
      }
    } catch {
      // continue polling
    }
  }
  if (launchedPid > 0) {
    return `Launched '${app}' (PID ${launchedPid}) but no window appeared within ${waitMs}ms. App may still be starting. Use desktop_get_process_list to check.`;
  }
  return `ERROR: Failed to launch '${app}' or detect its window within ${waitMs}ms.`;
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
try {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = if ('${query}') {
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty, '${query}',
      [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase
    )
  } else {
    [System.Windows.Automation.Condition]::TrueCondition
  }
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  $target = if ($wins.Count -gt 0) { $wins[0] } else {
    # Fall back to foreground window
    $hnd = (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).MainWindowHandle
    if ($hnd) { [System.Windows.Automation.AutomationElement]::FromHandle($hnd) } else { $null }
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
    const out = await runPowerShell(script, { timeoutMs: 10000 });
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
  const focusFirst = options?.focus_first === true;
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

  const png = fs.readFileSync(shot.path);
  try { fs.unlinkSync(shot.path); } catch {}

  const screenshotBase64 = png.toString('base64');
  const capturedAt = Date.now();
  const vs = ctx.virtualScreen;
  const activeMonitorIndex =
    activeWindow?.monitorIndex !== undefined && activeWindow.monitorIndex >= 0
      ? activeWindow.monitorIndex
      : null;

  const packet: DesktopAdvisorPacket = {
    screenshotBase64,
    screenshotMime: 'image/png',
    width: shot.width,
    height: shot.height,
    capturedAt,
    openWindows,
    activeWindow: activeWindow || undefined,
    ocrText: ocr?.text,
    ocrConfidence: ocr?.confidence,
    contentHash: computeContentHash(screenshotBase64),
    monitors: ctx.monitors.length ? ctx.monitors : undefined,
    virtualScreen: vs.width > 0 ? vs : undefined,
    captureRegion: { left: shot.left, top: shot.top, width: shot.width, height: shot.height },
    captureMode: shot.captureMode,
    captureMonitorIndex: shot.captureMonitorIndex,
    activeMonitorIndex,
  };
  sessions.set(sessionId, { lastPacket: packet });

  const ocrPreview = ocr?.text ? ocr.text.slice(0, 400).replace(/\s+/g, ' ').trim() : '';
  const ocrLen = ocr?.text ? ocr.text.length : 0;

  return [
    `Window screenshot captured (${shot.width}x${shot.height}).`,
    `Target window: "${target.title}" (${target.processName}, handle=${target.handle}).`,
    `Window bounds: left=${Math.floor(left)}, top=${Math.floor(top)}, width=${Math.floor(width)}, height=${Math.floor(height)}.`,
    `Capture region: [${x1}, ${y1}] to [${x2}, ${y2}] (padding ${padding}px).`,
    `Active window: ${shortWindowLabel(activeWindow)}.`,
    ocrPreview ? `OCR text (${Math.round(ocr?.confidence || 0)}% confidence):\n${ocrPreview}${ocrLen > 400 ? ' ...' : ''}` : 'OCR: unavailable.',
  ].join('\n');
}

export function getDesktopToolDefinitions(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'desktop_screenshot',
        description:
          'Capture desktop screenshot with monitor layout, active-window monitor, and window list (each window tagged with monitor index m=N). ' +
          'Default: full virtual screen (all monitors). Use capture=primary for main display only, or monitor_index=0,1,... for a single display. ' +
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
        name: 'desktop_window_screenshot',
        description:
          'Capture only one app window (cropped from the virtual desktop) and attach that screenshot for vision-capable models. ' +
          'Select a target with name, handle, or active=true. Use focus_first=true to bring it forward before capture.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Partial window title or process name to capture.' },
            handle: { type: 'number', description: 'Exact window handle (HWND) to capture.' },
            active: { type: 'boolean', description: 'Capture currently active window (default when no selector provided).' },
            focus_first: { type: 'boolean', description: 'Focus target window before screenshot (default false).' },
            padding: { type: 'number', description: 'Extra pixels around the window bounds (0-120, default 8).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_click',
        description:
          'Click at Windows virtual-screen coordinates (see desktop_screenshot output for bounds and per-monitor layout). ' +
          'Optional monitor_relative=true with monitor_index: x,y are relative to that display top-left. ' +
          'Use modifier to hold Shift/Ctrl/Alt during click. Use verify=true to auto-capture a screenshot 300ms after clicking.',
        parameters: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            x: { type: 'number', description: 'X in virtual screen pixels, or monitor-relative if monitor_relative' },
            y: { type: 'number', description: 'Y in virtual screen pixels, or monitor-relative if monitor_relative' },
            button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button (default left)' },
            double_click: { type: 'boolean', description: 'Double-click instead of single-click' },
            modifier: { type: 'string', enum: ['shift', 'ctrl', 'alt'], description: 'Hold this modifier key during the click (e.g. shift for multi-select, ctrl for Ctrl+click)' },
            verify: { type: 'boolean', description: 'If true, capture a screenshot 300ms after clicking and return it inline to confirm the click had effect.' },
            monitor_relative: {
              type: 'boolean',
              description: 'If true, x/y are relative to monitor_index top-left (requires monitor_index).',
            },
            monitor_index: { type: 'integer', description: '0-based display index when monitor_relative is true' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_drag',
        description:
          'Drag between virtual-screen coordinates. Same monitor_relative + monitor_index rules as desktop_click (applies to both endpoints).',
        parameters: {
          type: 'object',
          required: ['from_x', 'from_y', 'to_x', 'to_y'],
          properties: {
            from_x: { type: 'number', description: 'Start X' },
            from_y: { type: 'number', description: 'Start Y' },
            to_x: { type: 'number', description: 'End X' },
            to_y: { type: 'number', description: 'End Y' },
            steps: { type: 'number', description: 'Interpolation steps (default 20)' },
            monitor_relative: { type: 'boolean', description: 'Interpret coords as monitor-local for monitor_index' },
            monitor_index: { type: 'integer', description: '0-based display when monitor_relative' },
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
        description: 'Write text to clipboard.',
        parameters: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', description: 'Clipboard text' },
          },
        },
      },
    },
    // Phase 4: App launch / process control
    {
      type: 'function',
      function: {
        name: 'desktop_launch_app',
        description: 'Launch a desktop application by name or path and wait for its window to appear.',
        parameters: {
          type: 'object',
          required: ['app'],
          properties: {
            app: { type: 'string', description: 'Application name or full path, e.g. notepad, code, calc' },
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
            x: { type: 'number', description: 'Optional X before scroll (virtual or monitor-relative)' },
            y: { type: 'number', description: 'Optional Y before scroll' },
            axis: { type: 'string', enum: ['vertical', 'horizontal'], description: 'Override axis (inferred from direction if omitted)' },
            monitor_relative: { type: 'boolean', description: 'Apply monitor_index offset to x,y when both set' },
            monitor_index: { type: 'integer', description: '0-based display when monitor_relative' },
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
  ];
}
