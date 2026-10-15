import { runOcr, lastOcrDiagnostic } from './interaction-actions.js';
import { getDesktopAdvisorPacket, desktopWindowScreenshot } from './apps.js';
import { desktopGetAccessibilityTree } from './accessibility.js';
import { getDesktopToolNames } from './window-actions.js';
import { desktopWindowClick } from './window-mid.js';





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
import { execFileAsync, parseDesktopScreenshotToolArgs, parseDesktopPointerMonitorArgs, sessions, sessionHistory, DESKTOP_PACKET_TTL_MS, DESKTOP_SESSION_CACHE_LIMIT, DESKTOP_SCREENSHOT_FRESH_MS, desktopPacketIndex, desktopActionVersion, desktopWindowGenerations, DESKTOP_CONTEXT_CACHE_MS, markDesktopPerformance, DESKTOP_WINDOW_FRAME_CACHE_MS, desktopWindowFrameCache, desktopWindowGenerationKey, getDesktopWindowGeneration, getDesktopWindowGenerationByKey, markDesktopWindowChanged, makeDesktopScreenshotId, pruneDesktopPacketIndex, registerDesktopPacket, pruneDesktopSessionCaches, markDesktopStateChanged, validateDesktopPacketGeneration, desktopPacketAgeMs, describeFreshScreenshotRequirement, describeStaleScreenshotRequirement, describeDesktopWindowBounds, pointInsideDesktopWindow, sameDesktopWindowHandle, _activeRecordingName, _recordingBuffer, _recordingStartTime, _macros, _macroRecord, clampInt, OCR_CHILD_SCRIPT, PLATFORM, getPlatformUnsupportedMessage, DELEGATE_TO_BACKEND, ensureWindows, getDesktopPlatformStatus, captureScreenshotMacOS, captureScreenshotLinux, psSingleQuote, runPowerShell, desktopPowerShellWarmupScheduled, scheduleDesktopPowerShellWarmup, win32HelperAtLeast, runPowerShellSpawned, parseJsonMaybe, normalizeWindows, PS_WINAPI_HEADER, PS_INPUTAPI_HEADER, PS_DPI_AWARE_HEADER } from './state.js';
import type { DesktopWindowInfo, DesktopSomElement, DesktopMonitorInfo, DesktopAdvisorPacket, DesktopFocusWindowVerification, DesktopScreenshotOptions, DesktopPointerMonitorOptions, DesktopCoordinateSpace, DesktopCoordinateTarget, DesktopResolvedActionPoint, DesktopVerificationMode, DesktopVerificationStatus, DesktopVerificationSignal, DesktopActionVerification, DesktopActionVerificationOptions, DesktopSessionState, SessionHistory, DesktopWindowGenerationRecord, DesktopPerformanceObserver, DesktopWindowFrameCacheEntry, MacroAction, PlatformId } from './state.js';



export function normalizeMonitors(raw: any): DesktopMonitorInfo[] {
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


export function normalizeVirtualScreen(raw: any): { left: number; top: number; width: number; height: number } {
  return {
    left: Number(raw?.left || 0) || 0,
    top: Number(raw?.top || 0) || 0,
    width: Number(raw?.width || 0) || 0,
    height: Number(raw?.height || 0) || 0,
  };
}


export function normalizeDesktopContext(raw: any): DesktopContextGathered {
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
        processStartTime: Number(aw.processStartTime ?? aw.process_start_time ?? 0) || undefined,
        processName: proc || 'unknown',
        appDisplayName: String(aw.appDisplayName || aw.app_display_name || proc || '').trim() || undefined,
        bundleId: String(aw.bundleId || aw.bundle_id || '').trim() || undefined,
        appPath: String(aw.appPath || aw.app_path || '').trim() || undefined,
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
export async function gatherDesktopContextInternal(
  signal?: AbortSignal,
  options?: { includeWindows?: boolean; onPerformanceStage?: DesktopPerformanceObserver },
): Promise<DesktopContextGathered> {
  const includeWindows = options?.includeWindows !== false;
  const observer = options?.onPerformanceStage;
  const startedAt = Date.now();
  markDesktopPerformance(observer, 'context_start', { includeWindows });
  throwIfDesktopCancelled(signal);
  const now = Date.now();
  if (desktopContextCache
    && now - desktopContextCache.capturedAt <= DESKTOP_CONTEXT_CACHE_MS
    && (includeWindows ? desktopContextCache.includeWindows : true)) {
    markDesktopPerformance(observer, 'context_cache_hit', {
      includeWindows,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    return desktopContextCache.value;
  }
  if (DELEGATE_TO_BACKEND) {
    const ctx = await getPlatformDesktopBackend().gatherContext();
    const gathered = {
      monitors: ctx.monitors,
      virtualScreen: ctx.virtualScreen,
      windows: ctx.windows,
      activeWindow: ctx.activeWindow,
    };
    desktopContextCache = { capturedAt: Date.now(), value: gathered, includeWindows: true };
    markDesktopPerformance(observer, 'context_done', {
      includeWindows,
      durationMs: Math.max(0, Date.now() - startedAt),
      monitorCount: gathered.monitors.length,
      windowCount: gathered.windows.length,
    });
    return gathered;
  }
  // Native helper (protocol v4): monitors, virtual screen, foreground and
  // window list in well under a millisecond instead of ~800 ms of PowerShell.
  const fastHelper = await win32HelperAtLeast(4);
  if (fastHelper) {
    try {
      const gathered = normalizeDesktopContext(await fastHelper.desktopContext(includeWindows, signal));
      if (gathered.monitors.length > 0 && gathered.virtualScreen.width > 0) {
        desktopContextCache = { capturedAt: Date.now(), value: gathered, includeWindows };
        markDesktopPerformance(observer, 'context_done', {
          includeWindows,
          durationMs: Math.max(0, Date.now() - startedAt),
          monitorCount: gathered.monitors.length,
          windowCount: gathered.windows.length,
        });
        return gathered;
      }
    } catch (error: any) {
      if (isDesktopCancellationError(error) || error?.name === 'AbortError') throw error;
      // Fall through to the PowerShell probe.
    }
  }
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
$windows = New-Object System.Collections.ArrayList
$winRows = @()
if (${includeWindows ? '$true' : '$false'}) {
  $winRows = Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0
  }
}
foreach ($r in @($winRows)) {
  $hPtr = [IntPtr]::new([Int64]$r.MainWindowHandle)
  $mi = Get-MonitorIndex $hPtr
  $rect = New-Object PrometheusWinApi+RECT
  $okRect = [PrometheusWinApi]::GetWindowRect($hPtr, [ref]$rect)
  $left = if ($okRect) { [int]$rect.Left } else { 0 }
  $top = if ($okRect) { [int]$rect.Top } else { 0 }
  $w = if ($okRect) { [int]($rect.Right - $rect.Left) } else { 0 }
  $h = if ($okRect) { [int]($rect.Bottom - $rect.Top) } else { 0 }
  $processStartTime = 0
  try { $processStartTime = [DateTimeOffset]::new($r.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() } catch { }
  [void]$windows.Add([ordered]@{
    pid = [int]$r.Id
    processStartTime = [int64]$processStartTime
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
$activeProcessStartTime = 0
try { if ($aproc) { $activeProcessStartTime = [DateTimeOffset]::new($aproc.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() } } catch { }
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
    processStartTime = [int64]$activeProcessStartTime
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
  const powerShellStartedAt = Date.now();
  markDesktopPerformance(observer, 'powershell_start', { includeWindows });
  const raw = await runPowerShell(script, { timeoutMs: includeWindows ? 14000 : 8000, sta: true, signal });
  markDesktopPerformance(observer, 'powershell_done', {
    includeWindows,
    durationMs: Math.max(0, Date.now() - powerShellStartedAt),
    outputBytes: Buffer.byteLength(raw, 'utf8'),
  });
  const parsed = parseJsonMaybe(raw);
  if (!parsed) {
    const trimmedRaw = String(raw || '').trim();
    const empty: DesktopContextGathered = {
      monitors: [],
      virtualScreen: { left: 0, top: 0, width: 0, height: 0 },
      windows: [],
      activeWindow: null,
      probeFailed: {
        reason: trimmedRaw
          ? `desktop probe output was not JSON (${trimmedRaw.slice(0, 160)}${trimmedRaw.length > 160 ? '…' : ''})`
          : 'desktop probe returned no output (PowerShell timed out or the host was busy)',
        outputBytes: Buffer.byteLength(raw, 'utf8'),
      },
    };
    markDesktopPerformance(observer, 'context_done', {
      includeWindows,
      durationMs: Math.max(0, Date.now() - startedAt),
      monitorCount: 0,
      windowCount: 0,
      parseFailed: true,
    });
    return empty;
  }
  const gathered = normalizeDesktopContext(parsed);
  if (includeWindows) desktopContextCache = { capturedAt: Date.now(), value: gathered, includeWindows: true };
  else if (!desktopContextCache || Date.now() - desktopContextCache.capturedAt > DESKTOP_CONTEXT_CACHE_MS) {
    desktopContextCache = { capturedAt: Date.now(), value: gathered, includeWindows: false };
  }
  markDesktopPerformance(observer, 'context_done', {
    includeWindows,
    durationMs: Math.max(0, Date.now() - startedAt),
    monitorCount: gathered.monitors.length,
    windowCount: gathered.windows.length,
  });
  return gathered;
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


export async function desktopDoctor(
  sessionId: string,
  options: { deep?: boolean; signal?: AbortSignal; onPerformanceStage?: DesktopPerformanceObserver } = {},
): Promise<string> {
  const deep = options.deep === true;
  const observer = options.onPerformanceStage;
  const doctorStartedAt = Date.now();
  markDesktopPerformance(observer, 'doctor_start', { deep });
  const lines: string[] = [`Desktop doctor (${deep ? 'deep' : 'fast'}):`];
  const ok = (label: string, detail: string) => lines.push(`PASS ${label}: ${detail}`);
  const warn = (label: string, detail: string) => lines.push(`WARN ${label}: ${detail}`);
  const fail = (label: string, detail: string) => lines.push(`FAIL ${label}: ${detail}`);
  const markDoctorStage = (stage: string, startedAt: number, fields: Record<string, number | string | boolean> = {}) => {
    markDesktopPerformance(observer, `doctor_${stage}`, {
      deep,
      durationMs: Math.max(0, Date.now() - startedAt),
      ...fields,
    });
  };

  try {
    ensureWindows();
    ok('Platform', `${PLATFORM} desktop automation is supported`);
  } catch (err: any) {
    fail('Platform', err?.message || String(err));
    return lines.join('\n');
  }

  // macOS: report TCC permission status (Screen Recording + Accessibility), which
  // gate capture and input respectively. These must be granted in System Settings.
  if (DELEGATE_TO_BACKEND) {
    try {
      const perms = await getPlatformDesktopBackend().checkPermissions();
      for (const p of perms) {
        if (p.granted) ok(`Permission: ${p.name}`, 'granted');
        else fail(`Permission: ${p.name}`, p.remedy || 'not granted');
      }
    } catch (err: any) {
      warn('Permissions', err?.message || String(err));
    }
  }

  let ctx: DesktopContextGathered | null = null;
  try {
    // Fast doctor only needs monitor geometry and the foreground window. The
    // full window list is useful to discovery tools, but it is an avoidable
    // Get-Process + GetWindowRect sweep on the health-check path.
    ctx = await gatherDesktopContextInternal(options.signal, {
      includeWindows: deep,
      onPerformanceStage: observer,
    });
    if (ctx.probeFailed) {
      // Zeroed monitors/virtualScreen here are placeholders from a failed probe,
      // not a real reading. Report the probe failure instead of "0 monitors PASS".
      warn('Monitor/DPI context', `desktop probe failed: ${ctx.probeFailed.reason}. Monitor and virtual-screen values are unknown; retry doctor when the host is idle.`);
    } else {
      ok('Monitor/DPI context', `${ctx.monitors.length || 0} monitor(s), virtual ${ctx.virtualScreen.width}x${ctx.virtualScreen.height} at (${ctx.virtualScreen.left},${ctx.virtualScreen.top})`);
      if (!ctx.monitors.length) warn('Monitor/DPI context', 'no monitor records returned by Windows Forms');
    }
    const bad = ctx.monitors.filter((m) => m.width < 1 || m.height < 1);
    if (bad.length) fail('Monitor bounds', `${bad.length} monitor(s) have invalid dimensions`);
    else ok('Monitor bounds', 'all monitor dimensions are positive');
  } catch (err: any) {
    fail('Monitor/DPI context', err?.message || String(err));
  }

  let ocrProbe: { text: string; confidence: number } | null | undefined;
  let ocrProbeError = '';
  if (deep) try {
    const probeStartedAt = Date.now();
    markDesktopPerformance(observer, 'doctor_screenshot_probe_start', { deep });
    const shot = await captureScreenshotInternal({ kind: 'primary' });
    const raw = fs.readFileSync(shot.path);
    if (String(process.env.PROMETHEUS_DESKTOP_OCR || '1').trim() !== '0') {
      const ocrStartedAt = Date.now();
      const doctorOcrTimeoutMs = clampInt(process.env.PROMETHEUS_DESKTOP_DOCTOR_OCR_TIMEOUT_MS, 1000, 30000, 5000);
      markDesktopPerformance(observer, 'doctor_ocr_probe_start', { deep, timeoutMs: doctorOcrTimeoutMs });
      try {
        ocrProbe = await runOcr(shot.path, doctorOcrTimeoutMs);
        markDoctorStage('ocr_probe_done', ocrStartedAt, { ocrAvailable: ocrProbe !== null, timeoutMs: doctorOcrTimeoutMs });
      } catch (error: any) {
        ocrProbeError = String(error?.message || error);
        markDoctorStage('ocr_probe_done', ocrStartedAt, { error: true, errorCode: 'ocr_probe_failed', timeoutMs: doctorOcrTimeoutMs });
      }
    }
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
    markDoctorStage('screenshot_probe_done', probeStartedAt, {
      rawBytes: raw.byteLength,
      width: shot.width,
      height: shot.height,
    });
  } catch (err: any) {
    markDesktopPerformance(observer, 'doctor_screenshot_probe_done', { deep, error: true, errorCode: 'screenshot_probe_failed' });
    fail('Screenshot budget', err?.message || String(err));
  }

  if (deep) try {
    const ocrStatusStartedAt = Date.now();
    markDesktopPerformance(observer, 'doctor_ocr_status_start', { deep });
    const ocrEnabled = String(process.env.PROMETHEUS_DESKTOP_OCR || '1').trim() !== '0';
    if (!ocrEnabled) warn('OCR', 'disabled by PROMETHEUS_DESKTOP_OCR=0');
    else {
      const packet = getDesktopAdvisorPacket(sessionId);
      if (ocrProbeError) fail('OCR', `runtime probe failed: ${ocrProbeError}`);
      else if (ocrProbe?.text) ok('OCR', `runtime available; probe read ${ocrProbe.text.length} chars at ${Math.round(ocrProbe.confidence || 0)}% confidence`);
      else if (ocrProbe === null && lastOcrDiagnostic?.status === 'available_no_text') warn('OCR', `runtime available; probe completed at stage=${lastOcrDiagnostic.stage} but detected no text`);
      else if (ocrProbe === null && lastOcrDiagnostic) fail('OCR', `status=${lastOcrDiagnostic.status}, stage=${lastOcrDiagnostic.stage}${lastOcrDiagnostic.error ? `, error=${lastOcrDiagnostic.error.split(/\r?\n/)[0]}` : ''}`);
      else if (ocrProbe === null) fail('OCR', 'runtime returned unavailable without a diagnostic');
      else if (packet?.ocrText) ok('OCR', `runtime previously returned ${packet.ocrText.length} cached chars (confidence ${Math.round(packet.ocrConfidence || 0)}%)`);
      else warn('OCR', 'runtime probe completed but detected no text in the primary-screen sample');
    }
    markDoctorStage('ocr_status_done', ocrStatusStartedAt, { ocrEnabled });
  } catch (err: any) {
    markDesktopPerformance(observer, 'doctor_ocr_status_done', { deep, error: true, errorCode: 'ocr_status_failed' });
    fail('OCR', err?.message || String(err));
  }

  if (deep) try {
    const uiAutomationStartedAt = Date.now();
    markDesktopPerformance(observer, 'doctor_ui_automation_start', { deep });
    const out = await desktopGetAccessibilityTree(undefined, 2, 40);
    if (out.startsWith('ERROR:')) fail('UI Automation', out);
    else ok('UI Automation', `returned ${out.split(/\r?\n/).length} line(s) from active window`);
    markDoctorStage('ui_automation_done', uiAutomationStartedAt, { error: out.startsWith('ERROR') });
  } catch (err: any) {
    markDesktopPerformance(observer, 'doctor_ui_automation_done', { deep, error: true, errorCode: 'ui_automation_failed' });
    fail('UI Automation', err?.message || String(err));
  }

  if (!deep) ok('Deep probes', 'skipped; call doctor with deep=true for live screenshot/OCR/UI Automation probes');

  try {
    const captureBackendStartedAt = Date.now();
    const backend = resolveDesktopCaptureBackend();
    (backend.active === 'graphics_capture' ? ok : warn)('Capture backend', `${backend.active} (requested=${backend.requested}). ${backend.reason}`);
    markDoctorStage('capture_backend_done', captureBackendStartedAt, { backend: backend.active });
  } catch (err: any) {
    markDesktopPerformance(observer, 'doctor_capture_backend_done', { deep, error: true, errorCode: 'capture_backend_failed' });
    warn('Capture backend', err?.message || String(err));
  }

  try {
    const registryStartedAt = Date.now();
    const toolNames = getDesktopToolNames();
    ok('Tool registry', `${toolNames.length} desktop tool definitions exposed; canonical model + window-scoped input available`);
    markDoctorStage('tool_registry_done', registryStartedAt, { toolCount: toolNames.length });
  } catch (err: any) {
    markDesktopPerformance(observer, 'doctor_tool_registry_done', { deep, error: true, errorCode: 'tool_registry_failed' });
    warn('Tool registry', err?.message || String(err));
  }

  const packet = getDesktopAdvisorPacket(sessionId);
  if (!packet) {
    warn('Tool session', 'no desktop screenshot packet cached yet');
  } else {
    const ageSec = Math.round(desktopPacketAgeMs(packet) / 1000);
    const generationStatus = validateDesktopPacketGeneration(packet);
    const stale = !generationStatus.ok;
    (stale ? warn : ok)(
      'Tool session',
      `last screenshot ${packet.screenshotId} is ${ageSec}s old, global_generation=${packet.globalGeneration ?? packet.actionVersion}, window_generation=${packet.windowGeneration ?? 'n/a'}${stale ? ` (${generationStatus.ok ? 'stale' : generationStatus.message})` : ' (fresh)'}`,
    );
  }

  if (ctx?.activeWindow) ok('Active window', describeDesktopWindowBounds(ctx.activeWindow));
  else warn('Active window', 'no active window metadata available');

  markDesktopPerformance(observer, 'doctor_done', {
    deep,
    durationMs: Math.max(0, Date.now() - doctorStartedAt),
    monitorCount: ctx?.monitors.length || 0,
    windowCount: ctx?.windows.length || 0,
  });
  return lines.join('\n');
}


export async function listWindowsInternal(): Promise<DesktopWindowInfo[]> {
  const ctx = await gatherDesktopContextInternal();
  return ctx.windows;
}


export async function activeWindowInternal(): Promise<DesktopWindowInfo | null> {
  const ctx = await gatherDesktopContextInternal();
  return ctx.activeWindow;
}


export async function getDesktopActiveWindowInfo(): Promise<DesktopWindowInfo | null> {
  return activeWindowInternal();
}


/** Lightweight monitor list for coordinate conversion (desktop_click / scroll).
 *  Exported for the Win32 DesktopBackend (desktop-platform-win32.ts). */
export async function enumerateMonitorsInternal(): Promise<DesktopMonitorInfo[]> {
  if (DELEGATE_TO_BACKEND) return getPlatformDesktopBackend().enumerateMonitors();
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
  signal?: AbortSignal,
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

  if (DELEGATE_TO_BACKEND) {
    let req: DesktopCaptureRequest;
    if (cropRegion) {
      const [x1, y1, x2, y2] = cropRegion;
      req = { kind: 'region', left: Math.min(x1, x2), top: Math.min(y1, y2),
              width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    } else if (mode.kind === 'monitor') {
      req = { kind: 'monitor', index: mode.index };
    } else if (mode.kind === 'primary') {
      req = { kind: 'primary' };
    } else {
      req = { kind: 'all' };
    }
    const result = await getPlatformDesktopBackend().capture(req, signal);
    // Downscale physical -> logical pixels so capture pixels == virtual-screen
    // coordinates (1:1), matching the Windows DPI-aware assumption that all the
    // downstream coordinate/SOM/verification math relies on. (Retina seam.)
    let buf = result.png;
    const logicalW = result.bounds.width || 1;
    const logicalH = result.bounds.height || 1;
    if (result.devicePixelRatio && Math.abs(result.devicePixelRatio - 1) > 0.01) {
      const img = await Jimp.read(buf);
      img.resize(logicalW, logicalH, Jimp.RESIZE_BILINEAR);
      buf = await img.getBufferAsync(Jimp.MIME_PNG);
    }
    const outPath = path.join(os.tmpdir(), `prometheus-desktop-${crypto.randomUUID()}.png`);
    fs.writeFileSync(outPath, buf);
    return {
      path: outPath,
      width: logicalW,
      height: logicalH,
      left: result.bounds.left,
      top: result.bounds.top,
      captureMode: modeStr,
      captureMonitorIndex: mode.kind === 'monitor' ? mode.index : undefined,
    };
  }

  const fastShot = await captureScreenshotViaHelper(mode, midx, modeStr, cropRegion, signal);
  if (fastShot) return fastShot;

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
# Report the REAL saved bitmap pixel dimensions, not the logical $bounds size.
# On DPI-scaled / partial-DPI-aware processes, the bitmap (physical pixels captured
# via CopyFromScreen) can diverge from $bounds (logical/virtual-screen coords). Using
# $bmp.Width/$bmp.Height keeps the downstream coordinateScale (shot.width / imageWidth)
# exact so capture-space clicks resolve to the correct virtual desktop coordinates.
$realWidth = [int]$bmp.Width
$realHeight = [int]$bmp.Height
$bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[PSCustomObject]@{
  path = [string]$tmp
  width = $realWidth
  height = $realHeight
  left = [int]$bounds.Left
  top = [int]$bounds.Top
} | ConvertTo-Json -Compress
`;
  const raw = await runPowerShell(script, { timeoutMs: 18000, sta: true, signal });
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


/**
 * Native-helper screen capture (GDI BitBlt + WIC, ~100 ms for 3440x1440 vs
 * ~520 ms for the PowerShell CopyFromScreen path). Mirrors the PowerShell
 * script's bounds, monitor-local crop and clamping exactly. Returns null to
 * fall back to PowerShell.
 */
export async function captureScreenshotViaHelper(
  mode: DesktopCaptureMode,
  midx: number,
  modeStr: 'all' | 'primary' | 'monitor',
  cropRegion: [number, number, number, number] | undefined,
  signal?: AbortSignal,
): Promise<{ path: string; width: number; height: number; left: number; top: number; captureMode: 'all' | 'primary' | 'monitor'; captureMonitorIndex?: number } | null> {
  const helper = await win32HelperAtLeast(4);
  if (!helper) return null;
  let raw: any;
  try {
    raw = await helper.desktopContext(false, signal);
  } catch (error: any) {
    if (isDesktopCancellationError(error) || error?.name === 'AbortError') throw error;
    return null;
  }
  const monitors = normalizeMonitors(raw?.monitors);
  const vs = normalizeVirtualScreen(raw?.virtualScreen);
  let bounds: { left: number; top: number; width: number; height: number } | undefined;
  if (mode.kind === 'all') bounds = vs;
  else if (mode.kind === 'primary') bounds = monitors.find((m) => m.primary) || monitors[0];
  else {
    if (midx < 0 || midx >= monitors.length) {
      const n = monitors.length;
      throw new Error(`Invalid monitor_index ${midx} for this machine (${n} display(s); use 0..${Math.max(0, n - 1)}).`);
    }
    bounds = monitors[midx];
  }
  if (!bounds || bounds.width < 1 || bounds.height < 1) return null;
  let rect = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  if (cropRegion) {
    let [x1, y1, x2, y2] = cropRegion.map((v) => Math.round(Number(v)));
    if (mode.kind === 'monitor' && x2 > x1 && y2 > y1
      && x1 >= 0 && y1 >= 0 && x2 <= bounds.width && y2 <= bounds.height) {
      x1 += bounds.left; x2 += bounds.left; y1 += bounds.top; y2 += bounds.top;
    }
    if (x2 > x1 && y2 > y1) {
      const cx = Math.max(0, x1 - bounds.left);
      const cy = Math.max(0, y1 - bounds.top);
      const cw = Math.min(bounds.width - cx, x2 - x1);
      const ch = Math.min(bounds.height - cy, y2 - y1);
      if (cw > 0 && ch > 0) rect = { left: bounds.left + cx, top: bounds.top + cy, width: cw, height: ch };
    }
  }
  let png: Buffer;
  try {
    png = (await helper.capture({ kind: 'region', ...rect } as DesktopCaptureRequest, signal)).png;
  } catch (error: any) {
    if (isDesktopCancellationError(error) || error?.name === 'AbortError') throw error;
    return null;
  }
  const size = await readImageSize(png);
  const outPath = path.join(os.tmpdir(), `prometheus-desktop-${crypto.randomUUID()}.png`);
  await fs.promises.writeFile(outPath, png);
  return {
    path: outPath,
    width: size.width,
    height: size.height,
    left: rect.left,
    top: rect.top,
    captureMode: modeStr,
    captureMonitorIndex: mode.kind === 'monitor' ? mode.index : undefined,
  };
}


export function findWindowsByName(allWindows: DesktopWindowInfo[], query: string): DesktopWindowInfo[] {
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
  if (DELEGATE_TO_BACKEND) return getPlatformDesktopBackend().focusWindow(h);
  const helper = getWin32DesktopHelperClient();
  if (helper.available) {
    try {
      return await helper.focusWindow(h);
    } catch {
      // Compatibility fallback for a missing, outdated, or failed helper.
    }
  }
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


export function shortWindowLabel(w?: DesktopWindowInfo | null): string {
  if (!w) return 'unknown';
  const title = String(w.title || '').trim() || '(untitled)';
  const proc = String(w.processName || '').trim() || 'process';
  const mon =
    w.monitorIndex !== undefined ? `, monitor=${w.monitorIndex}` : '';
  return `"${title}" (${proc}${mon})`;
}


export function compactWindowList(allWindows: DesktopWindowInfo[], maxItems: number = 8): string {
  const lines = allWindows.slice(0, maxItems).map((w, i) => {
    const mon = w.monitorIndex !== undefined ? ` m=${w.monitorIndex}` : '';
    return `${i + 1}. [${w.processName}]${mon} ${w.title}`;
  });
  return lines.join('\n');
}


export function formatMonitorsForReply(monitors: DesktopMonitorInfo[]): string {
  if (!monitors.length) return '';
  const lines = monitors.map(
    (m) =>
      `  Monitor ${m.index}: ${m.width}x${m.height} at virtual (${m.left},${m.top})${m.primary ? ' [PRIMARY]' : ''}`,
  );
  return `Monitors (${monitors.length}):\n${lines.join('\n')}`;
}


export async function resolveVirtualPointerCoords(
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


export function normalizeCoordinateSpace(
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


export function resolveDesktopWindowClickCoordinateSpace(point: {
  coordinate_space?: DesktopCoordinateSpace;
  screenshot_id?: string;
}): DesktopCoordinateSpace {
  return point.coordinate_space || (point.screenshot_id ? 'capture' : 'window');
}


export function getDesktopAdvisorPacketByIdInternal(
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


export async function getWindowByHandleFast(handle: number): Promise<DesktopWindowInfo | null> {
  const h = Math.floor(Number(handle || 0));
  if (!Number.isFinite(h) || h <= 0 || DELEGATE_TO_BACKEND) return null;
  const fastHelper = await win32HelperAtLeast(4);
  if (fastHelper) {
    try {
      const w: any = await fastHelper.windowInfo(h);
      if (!w?.exists || !(Number(w.pid) > 0)) return null;
      const mi = Number(w.monitorIndex);
      const name = String(w.processName || '').trim() || 'unknown';
      return {
        pid: Number(w.pid) || 0,
        processStartTime: Number(w.processStartTime || 0) || undefined,
        processName: name,
        appDisplayName: name,
        title: String(w.title || '').trim() || '(untitled)',
        handle: h,
        left: Number(w.left || 0) || 0,
        top: Number(w.top || 0) || 0,
        width: Number(w.width || 0) || 0,
        height: Number(w.height || 0) || 0,
        isActive: w.isActive === true,
        ...(Number.isFinite(mi) && mi >= 0 ? { monitorIndex: Math.floor(mi) } : {}),
      };
    } catch {
      // Fall through to PowerShell.
    }
  }
  const script = `
${PS_DPI_AWARE_HEADER}
Add-Type -AssemblyName System.Windows.Forms
${PS_WINAPI_HEADER}
$hWnd = [IntPtr]::new([Int64]${h})
$rect = New-Object PrometheusWinApi+RECT
$okRect = [PrometheusWinApi]::GetWindowRect($hWnd, [ref]$rect)
$targetPid = 0
[void][PrometheusWinApi]::GetWindowThreadProcessId($hWnd, [ref]$targetPid)
$title = ''
$tlen = [PrometheusWinApi]::GetWindowTextLength($hWnd)
if ($tlen -gt 0) {
  $sb = New-Object System.Text.StringBuilder ($tlen + 1)
  [void][PrometheusWinApi]::GetWindowText($hWnd, $sb, $sb.Capacity)
  $title = [string]$sb.ToString()
}
$proc = $null
try { if ($targetPid -gt 0) { $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue } } catch { }
$processStartTime = 0
try { if ($proc) { $processStartTime = [DateTimeOffset]::new($proc.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() } } catch { }
$mi = -1
try {
  $scr = [System.Windows.Forms.Screen]::FromHandle($hWnd)
  $screens = [System.Windows.Forms.Screen]::AllScreens
  for ($i = 0; $i -lt $screens.Length; $i++) {
    if ($screens[$i].DeviceName -eq $scr.DeviceName) { $mi = [int]$i; break }
  }
} catch { }
[ordered]@{
  ok = [bool]($okRect -and $targetPid -gt 0)
  pid = [int]$targetPid
  processStartTime = [int64]$processStartTime
  processName = if ($proc) { [string]$proc.ProcessName } else { 'unknown' }
  appDisplayName = if ($proc) { [string]$proc.ProcessName } else { 'unknown' }
  title = [string]$title
  handle = [Int64]${h}
  left = if ($okRect) { [int]$rect.Left } else { 0 }
  top = if ($okRect) { [int]$rect.Top } else { 0 }
  width = if ($okRect) { [int]($rect.Right - $rect.Left) } else { 0 }
  height = if ($okRect) { [int]($rect.Bottom - $rect.Top) } else { 0 }
  monitorIndex = [int]$mi
  isActive = [bool]([PrometheusWinApi]::GetForegroundWindow() -eq $hWnd)
} | ConvertTo-Json -Compress
`;
  const parsed = parseJsonMaybe(await runPowerShell(script, { timeoutMs: 4000 }).catch(() => ''));
  if (!parsed?.ok) return null;
  const mi = Number(parsed.monitorIndex);
  return {
    pid: Number(parsed.pid || 0) || 0,
    processStartTime: Number(parsed.processStartTime || 0) || undefined,
    processName: String(parsed.processName || 'unknown') || 'unknown',
    appDisplayName: String(parsed.appDisplayName || parsed.processName || '').trim() || undefined,
    title: String(parsed.title || '').trim() || '(untitled)',
    handle: h,
    left: Number(parsed.left || 0) || 0,
    top: Number(parsed.top || 0) || 0,
    width: Number(parsed.width || 0) || 0,
    height: Number(parsed.height || 0) || 0,
    isActive: parsed.isActive === true,
    ...(Number.isFinite(mi) && mi >= 0 ? { monitorIndex: Math.floor(mi) } : {}),
  };
}


export async function resolveWindowCoordinateBase(
  target: DesktopCoordinateTarget,
  packet?: DesktopAdvisorPacket,
): Promise<{ ok: true; window: DesktopWindowInfo; source: 'live' | 'snapshot' } | { ok: false; message: string }> {
  const handleNum = Number(target.window_handle);
  const hasHandle = Number.isFinite(handleNum) && handleNum > 0;
  const query = String(target.window_name || '').trim();

  let liveWindow: DesktopWindowInfo | undefined;
  if (hasHandle && !packet?.targetWindow) {
    liveWindow = await getWindowByHandleFast(Math.floor(handleNum)) || undefined;
  }
  if (hasHandle || query || packet?.targetWindow?.handle) {
    const ctx = liveWindow ? null : await gatherDesktopContextInternal();
    if (hasHandle) {
      liveWindow = liveWindow || ctx!.windows.find((w) => Number(w.handle) === Math.floor(handleNum));
    }
    if (!liveWindow && query) {
      liveWindow = findWindowsByName(ctx!.windows, query)[0];
    }
    if (!liveWindow && packet?.targetWindow?.handle) {
      liveWindow = ctx!.windows.find((w) => Number(w.handle) === Number(packet.targetWindow?.handle));
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


export interface DesktopVisualTextCandidate {
  text: string;
  ocr_confidence: number;
  match_score: number;
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
}


export let desktopVisualOcrWorkerPromise: Promise<any> | null = null;

export let desktopVisualOcrQueue: Promise<unknown> = Promise.resolve();

export const desktopVisualOcrCache = new Map<string, { at: number; lines: Array<{ text: string; confidence: number; bbox: any }> }>();


export function normalizeDesktopVisualText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”‘’`'\"…]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


export function desktopVisualMatchScore(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (candidate === query) return 1;
  if (candidate.includes(query)) return 0.97;
  if (query.includes(candidate) && candidate.length >= Math.max(6, query.length * 0.55)) return 0.9;
  const queryTokens = query.split(' ').filter(Boolean);
  const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
  const overlap = queryTokens.filter((token) => candidateTokens.has(token)).length;
  const coverage = overlap / Math.max(1, queryTokens.length);
  const orderPrefix = queryTokens.slice(0, overlap).join(' ');
  const prefixBonus = orderPrefix && candidate.startsWith(orderPrefix) ? 0.08 : 0;
  return Math.min(0.89, coverage * 0.82 + prefixBonus);
}


export async function getDesktopVisualOcrWorker(): Promise<any> {
  if (!desktopVisualOcrWorkerPromise) {
    desktopVisualOcrWorkerPromise = (async () => {
      const mod: any = await import('tesseract.js');
      const createWorker = mod?.createWorker || mod?.default?.createWorker;
      if (typeof createWorker !== 'function') throw new Error('tesseract.js createWorker is unavailable');
      const worker = await createWorker('eng');
      if (typeof worker.setParameters === 'function') {
        await worker.setParameters({
          tessedit_pageseg_mode: '11',
          preserve_interword_spaces: '1',
          user_defined_dpi: '144',
        });
      }
      return worker;
    })().catch((error) => {
      desktopVisualOcrWorkerPromise = null;
      throw error;
    });
  }
  return desktopVisualOcrWorkerPromise;
}


export async function recognizeDesktopVisualLines(png: Buffer, cacheKey: string): Promise<Array<{ text: string; confidence: number; bbox: any }>> {
  const cached = desktopVisualOcrCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DESKTOP_PACKET_TTL_MS) return cached.lines;
  const task = desktopVisualOcrQueue.then(async () => {
    const worker = await getDesktopVisualOcrWorker();
    let ocrInput = png;
    let coordinateScale = 1;
    try {
      const image = await Jimp.read(png);
      let luminanceTotal = 0;
      const sampleStep = Math.max(1, Math.floor(Math.min(image.bitmap.width, image.bitmap.height) / 96));
      let sampleCount = 0;
      image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
        if (x % sampleStep || y % sampleStep) return;
        luminanceTotal += (image.bitmap.data[idx] * 299 + image.bitmap.data[idx + 1] * 587 + image.bitmap.data[idx + 2] * 114) / 1000;
        sampleCount += 1;
      });
      const darkTheme = sampleCount > 0 && luminanceTotal / sampleCount < 128;
      coordinateScale = 2;
      image.greyscale().contrast(0.55);
      if (darkTheme) image.invert();
      image.resize(image.bitmap.width * coordinateScale, image.bitmap.height * coordinateScale, Jimp.RESIZE_BICUBIC);
      ocrInput = await image.getBufferAsync(Jimp.MIME_PNG);
    } catch {
      coordinateScale = 1;
      ocrInput = png;
    }
    const collectNestedOcrLines = (value: any): any[] => {
      if (!value || typeof value !== 'object') return [];
      if (Array.isArray(value)) return value.flatMap(collectNestedOcrLines);
      if (Array.isArray(value.lines)) return value.lines.flatMap(collectNestedOcrLines);
      if (Array.isArray(value.paragraphs)) return value.paragraphs.flatMap(collectNestedOcrLines);
      if (Array.isArray(value.blocks)) return value.blocks.flatMap(collectNestedOcrLines);
      if (value.text && value.bbox) return [value];
      return [];
    };
    const collectNestedOcrNodes = (value: any, depth = 0, seen = new WeakSet<object>()): any[] => {
      if (!value || typeof value !== 'object' || depth > 12 || seen.has(value)) return [];
      seen.add(value);
      if (Array.isArray(value)) return value.flatMap((entry) => collectNestedOcrNodes(entry, depth + 1, seen));
      const own = value.text && value.bbox ? [value] : [];
      return own.concat(Object.values(value).flatMap((entry) => collectNestedOcrNodes(entry, depth + 1, seen)));
    };
    const mapOcrResult = (result: any, scale: number): Array<{ text: string; confidence: number; bbox: any }> => {
      const data = result?.data || {};
      let lines: any[] = Array.isArray(data.lines)
        ? data.lines
        : collectNestedOcrLines(data.blocks);

      // Tesseract output shapes vary by version and output configuration. Rebuild
      // visual lines from TSV words when structured line/block arrays are absent.
      if (!lines.length && typeof data.tsv === 'string' && data.tsv.trim()) {
        const rows = data.tsv.split(/\r?\n/).slice(1);
        const grouped = new Map<string, { words: string[]; confidence: number[]; x0: number; y0: number; x1: number; y1: number }>();
        for (const row of rows) {
          const columns = row.split('\t');
          if (columns.length < 12 || Number(columns[0]) !== 5) continue;
          const text = columns.slice(11).join('\t').replace(/\s+/g, ' ').trim();
          const left = Number(columns[6]);
          const top = Number(columns[7]);
          const width = Number(columns[8]);
          const height = Number(columns[9]);
          const confidence = Number(columns[10]);
          if (!text || !Number.isFinite(left) || !Number.isFinite(top) || width <= 0 || height <= 0) continue;
          const key = columns.slice(1, 5).join(':');
          const group = grouped.get(key) || { words: [], confidence: [], x0: left, y0: top, x1: left + width, y1: top + height };
          group.words.push(text);
          if (Number.isFinite(confidence) && confidence >= 0) group.confidence.push(confidence);
          group.x0 = Math.min(group.x0, left);
          group.y0 = Math.min(group.y0, top);
          group.x1 = Math.max(group.x1, left + width);
          group.y1 = Math.max(group.y1, top + height);
          grouped.set(key, group);
        }
        lines = Array.from(grouped.values()).map((group) => ({
          text: group.words.join(' '),
          confidence: group.confidence.length ? group.confidence.reduce((sum, value) => sum + value, 0) / group.confidence.length : 0,
          bbox: { x0: group.x0, y0: group.y0, x1: group.x1, y1: group.y1 },
        }));
      }

      // hOCR is stable across Tesseract.js result-shape changes and carries explicit
      // line boxes. Use it only after structured and TSV output produced nothing.
      if (!lines.length && typeof data.hocr === 'string' && data.hocr.trim()) {
        const decodeHocrText = (value: string): string => value
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&#39;/gi, "'")
          .replace(/&quot;/gi, '"')
          .replace(/\s+/g, ' ')
          .trim();
        const hocrLines: any[] = [];
        const linePattern = /<span\b[^>]*class=["'][^"']*\bocr(?:x_)?line\b[^"']*["'][^>]*title=["'][^"']*\bbbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
        for (const match of data.hocr.matchAll(linePattern)) {
          const text = decodeHocrText(match[5]);
          if (!text) continue;
          const confidenceValues = Array.from(match[5].matchAll(/\bx_wconf\s+(\d+(?:\.\d+)?)/gi), (entry: RegExpMatchArray) => Number(entry[1])).filter(Number.isFinite);
          hocrLines.push({
            text,
            confidence: confidenceValues.length ? confidenceValues.reduce((sum: number, value: number) => sum + value, 0) / confidenceValues.length : 70,
            bbox: { x0: Number(match[1]), y0: Number(match[2]), x1: Number(match[3]), y1: Number(match[4]) },
          });
        }
        lines = hocrLines;
      }

      if (!lines.length && Array.isArray(data.words)) lines = data.words;
      if (!lines.length) lines = collectNestedOcrNodes(data);
      return lines.map((line: any) => ({
        text: String(line?.text || '').replace(/\s+/g, ' ').trim(),
        confidence: Number(line?.confidence ?? line?.conf ?? 0),
        bbox: {
          x0: Number(line?.bbox?.x0 ?? line?.x0 ?? line?.left ?? 0) / scale,
          y0: Number(line?.bbox?.y0 ?? line?.y0 ?? line?.top ?? 0) / scale,
          x1: Number(line?.bbox?.x1 ?? line?.x1 ?? ((line?.left ?? 0) + (line?.width ?? 0))) / scale,
          y1: Number(line?.bbox?.y1 ?? line?.y1 ?? ((line?.top ?? 0) + (line?.height ?? 0))) / scale,
        },
      })).filter((line: any) => line.text && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0);
    };

    const outputOptions = { text: true, blocks: true, tsv: true, hocr: true };
    let result = await worker.recognize(ocrInput, {}, outputOptions);
    let mapped = mapOcrResult(result, coordinateScale);
    // High-contrast/inversion helps most application chrome, but can erase thin
    // antialiased glyphs on some GPU-rendered surfaces. Retry the untouched crop
    // once only when the enhanced pass produced no bounded text.
    if (!mapped.length && coordinateScale !== 1) {
      result = await worker.recognize(png, {}, outputOptions);
      mapped = mapOcrResult(result, 1);
    }
    // Do not make a transient empty OCR result authoritative for the packet TTL.
    if (mapped.length) {
      while (desktopVisualOcrCache.size >= 32) desktopVisualOcrCache.delete(desktopVisualOcrCache.keys().next().value as string);
      desktopVisualOcrCache.set(cacheKey, { at: Date.now(), lines: mapped });
    }
    return mapped;
  });
  desktopVisualOcrQueue = task.then(() => undefined, () => undefined);
  return task as Promise<Array<{ text: string; confidence: number; bbox: any }>>;
}


export async function locateDesktopTextInternal(args: {
  sessionId: string;
  screenshotId: string;
  query: string;
  minConfidence?: number;
}): Promise<{ ok: true; packet: DesktopAdvisorPacket; match: DesktopVisualTextCandidate; candidates: DesktopVisualTextCandidate[]; elapsedMs: number } | { ok: false; code: string; message: string; candidates?: DesktopVisualTextCandidate[] }> {
  const startedAt = performance.now();
  const packetResult = getDesktopAdvisorPacketByIdInternal(args.sessionId, args.screenshotId);
  if (!packetResult.ok) return { ok: false, code: 'SCREENSHOT_NOT_FOUND', message: packetResult.message };
  const packet = packetResult.packet;
  const generation = validateDesktopPacketGeneration(packet);
  if (!generation.ok) return { ok: false, code: 'STATE_STALE', message: generation.message };
  const query = normalizeDesktopVisualText(args.query);
  if (!query) return { ok: false, code: 'INVALID_ARGUMENT', message: 'query is required' };
  try {
    const lines = await recognizeDesktopVisualLines(Buffer.from(packet.screenshotBase64, 'base64'), packet.contentHash);
    const recognizedSamples: DesktopVisualTextCandidate[] = lines.slice(0, 12).map((line) => {
      const x = Math.max(0, Math.round(line.bbox.x0));
      const y = Math.max(0, Math.round(line.bbox.y0));
      const width = Math.max(1, Math.round(line.bbox.x1 - line.bbox.x0));
      const height = Math.max(1, Math.round(line.bbox.y1 - line.bbox.y0));
      const ocrConfidence = Math.max(0, Math.min(100, Number(line.confidence) || 0));
      return {
        text: String(line.text || '').slice(0, 160),
        ocr_confidence: Math.round(ocrConfidence * 10) / 10,
        match_score: 0,
        confidence: Math.round((ocrConfidence / 100) * 0.22 * 1000) / 1000,
        bounds: { x, y, width, height },
        center: { x: Math.round(x + width / 2), y: Math.round(y + height / 2) },
      };
    });
    const candidates = lines.map((line) => {
      const normalized = normalizeDesktopVisualText(line.text);
      const matchScore = desktopVisualMatchScore(query, normalized);
      const ocrConfidence = Math.max(0, Math.min(100, Number(line.confidence) || 0));
      const confidence = Math.max(0, Math.min(1, matchScore * 0.78 + (ocrConfidence / 100) * 0.22));
      const x = Math.max(0, Math.round(line.bbox.x0));
      const y = Math.max(0, Math.round(line.bbox.y0));
      const width = Math.max(1, Math.round(line.bbox.x1 - line.bbox.x0));
      const height = Math.max(1, Math.round(line.bbox.y1 - line.bbox.y0));
      return {
        text: line.text,
        ocr_confidence: Math.round(ocrConfidence * 10) / 10,
        match_score: Math.round(matchScore * 1000) / 1000,
        confidence: Math.round(confidence * 1000) / 1000,
        bounds: { x, y, width, height },
        center: { x: Math.round(x + width / 2), y: Math.round(y + height / 2) },
      };
    }).filter((candidate) => candidate.match_score >= 0.45)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
    const best = candidates[0];
    const threshold = Math.max(0.5, Math.min(0.98, Number(args.minConfidence) || 0.72));
    if (!best || best.confidence < threshold) {
      return {
        ok: false,
        code: 'VISUAL_TARGET_NOT_FOUND',
        message: `No text match for "${args.query}" met confidence ${threshold}. OCR recognized ${lines.length} bounded text line(s). Do not guess a neighboring control.`,
        candidates: candidates.length ? candidates : recognizedSamples,
      };
    }
    if (candidates[1] && best.confidence - candidates[1].confidence < 0.04) {
      return { ok: false, code: 'VISUAL_TARGET_AMBIGUOUS', message: `Multiple text matches for "${args.query}" have nearly equal confidence. Tighten the crop before clicking.`, candidates };
    }
    return { ok: true, packet, match: best, candidates, elapsedMs: Math.round(performance.now() - startedAt) };
  } catch (error: any) {
    return { ok: false, code: 'VISUAL_OCR_FAILED', message: String(error?.message || error) };
  }
}


export async function desktopLocateText(sessionId: string, args: { screenshot_id: string; query: string; min_confidence?: number }): Promise<string> {
  const located = await locateDesktopTextInternal({
    sessionId,
    screenshotId: String(args.screenshot_id || ''),
    query: String(args.query || ''),
    minConfidence: args.min_confidence,
  });
  if (!located.ok) return desktopFailure(located.code as DesktopFailureCode, located.message, { candidates: located.candidates || [] });
  return JSON.stringify({
    ok: true,
    screenshot_id: located.packet.screenshotId,
    query: args.query,
    match: located.match,
    alternatives: located.candidates.slice(1),
    elapsed_ms: located.elapsedMs,
    click_contract: 'Use this exact screenshot_id and match.center in coordinate_space="capture". Recapture after any scroll or layout change.',
  }, null, 2);
}


export async function desktopClickText(
  sessionId: string,
  args: { screenshot_id: string; query: string; min_confidence?: number; button?: 'left' | 'right'; verify?: DesktopVerificationMode },
  signal?: AbortSignal,
): Promise<string> {
  const located = await locateDesktopTextInternal({
    sessionId,
    screenshotId: String(args.screenshot_id || ''),
    query: String(args.query || ''),
    minConfidence: args.min_confidence,
  });
  if (!located.ok) return desktopFailure(located.code as DesktopFailureCode, located.message, { candidates: located.candidates || [] });
  const target = located.packet.targetWindow;
  if (!target) return desktopFailure('INVALID_ARGUMENT', 'click_text requires a screenshot from an exact window region.');
  const click = await desktopWindowClick({ window_token: createDesktopWindowToken(target) }, {
    x: located.match.center.x,
    y: located.match.center.y,
    coordinate_space: 'capture',
    screenshot_id: located.packet.screenshotId,
  }, { button: args.button || 'left', verify: args.verify || 'off', focus_first: true, signal, allow_broad_grounded: true }, sessionId);
  if (click.startsWith('ERROR')) return click;
  const after = await desktopWindowScreenshot(sessionId, {
    handle: target.handle,
    focus_first: false,
    skipOcr: true,
    signal,
  });
  return [
    `Visual text target "${args.query}" located and clicked with confidence ${located.match.confidence}.`,
    `Matched OCR text: "${located.match.text}" at center (${located.match.center.x}, ${located.match.center.y}) in screenshot ${located.packet.screenshotId}.`,
    click,
    'Post-action full-window evidence:',
    after,
    'The click target was grounded; verify the requested destination identity in the attached post-action image before claiming completion.',
  ].join('\n');
}



export let desktopContextCache: { capturedAt: number; value: DesktopContextGathered; includeWindows: boolean } | null = null;
