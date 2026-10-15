import { desktopScreenshot, runOcr, parseSomElementsFromAccessibilityTree, renderSomOverlay, createDesktopAdvisorPacket, storeDesktopPacket, formatSomElements } from './interaction-actions.js';

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
import { execFileAsync, parseDesktopScreenshotToolArgs, parseDesktopPointerMonitorArgs, sessions, sessionHistory, DESKTOP_PACKET_TTL_MS, DESKTOP_SESSION_CACHE_LIMIT, DESKTOP_SCREENSHOT_FRESH_MS, desktopPacketIndex, desktopActionVersion, desktopWindowGenerations, DESKTOP_CONTEXT_CACHE_MS, desktopContextCache, markDesktopPerformance, DESKTOP_WINDOW_FRAME_CACHE_MS, desktopWindowFrameCache, desktopWindowGenerationKey, getDesktopWindowGeneration, getDesktopWindowGenerationByKey, markDesktopWindowChanged, makeDesktopScreenshotId, pruneDesktopPacketIndex, registerDesktopPacket, pruneDesktopSessionCaches, markDesktopStateChanged, validateDesktopPacketGeneration, desktopPacketAgeMs, describeFreshScreenshotRequirement, describeStaleScreenshotRequirement, describeDesktopWindowBounds, pointInsideDesktopWindow, sameDesktopWindowHandle, _activeRecordingName, _recordingBuffer, _recordingStartTime, _macros, _macroRecord, clampInt, OCR_CHILD_SCRIPT, PLATFORM, getPlatformUnsupportedMessage, DELEGATE_TO_BACKEND, ensureWindows, getDesktopPlatformStatus, captureScreenshotMacOS, captureScreenshotLinux, psSingleQuote, runPowerShell, desktopPowerShellWarmupScheduled, scheduleDesktopPowerShellWarmup, win32HelperAtLeast, runPowerShellSpawned, parseJsonMaybe, normalizeWindows, PS_WINAPI_HEADER, PS_INPUTAPI_HEADER, PS_DPI_AWARE_HEADER } from './state.js';
import type { DesktopWindowInfo, DesktopSomElement, DesktopMonitorInfo, DesktopAdvisorPacket, DesktopFocusWindowVerification, DesktopScreenshotOptions, DesktopPointerMonitorOptions, DesktopCoordinateSpace, DesktopCoordinateTarget, DesktopResolvedActionPoint, DesktopVerificationMode, DesktopVerificationStatus, DesktopVerificationSignal, DesktopActionVerification, DesktopActionVerificationOptions, DesktopSessionState, SessionHistory, DesktopWindowGenerationRecord, DesktopPerformanceObserver, DesktopWindowFrameCacheEntry, MacroAction, PlatformId } from './state.js';
import { normalizeMonitors, normalizeVirtualScreen, normalizeDesktopContext, gatherDesktopContextInternal, desktopGetMonitors, desktopGetActiveMonitorIndex, desktopGetMonitorsSummary, desktopDoctor, listWindowsInternal, activeWindowInternal, getDesktopActiveWindowInfo, enumerateMonitorsInternal, parseScreenshotCaptureMode, captureScreenshotInternal, captureScreenshotViaHelper, findWindowsByName, focusWindowHandle, shortWindowLabel, compactWindowList, formatMonitorsForReply, resolveVirtualPointerCoords, normalizeCoordinateSpace, resolveDesktopWindowClickCoordinateSpace, getDesktopAdvisorPacketByIdInternal, getWindowByHandleFast, resolveWindowCoordinateBase, getDesktopAdvisorPacketById, desktopVisualOcrWorkerPromise, desktopVisualOcrQueue, desktopVisualOcrCache, normalizeDesktopVisualText, desktopVisualMatchScore, getDesktopVisualOcrWorker, recognizeDesktopVisualLines, locateDesktopTextInternal, desktopLocateText, desktopClickText } from './interaction-context.js';
import type { DesktopCaptureMode, DesktopVisualTextCandidate } from './interaction-context.js';
import { desktopListApps, desktopListWindowsCanonical, desktopGetWindowState, desktopFocusWindowCanonical, prepareWindowForBackground, backgroundWindowFingerprint, backgroundUnavailableFailure, runBackgroundWindowAction, withForegroundArbitration, prepareWindowForInput, inspectFocusedControl, desktopWindowClick, desktopWindowClickForeground } from './window-mid.js';
import type { DesktopFocusedControlEvidence, DesktopWindowClickOptions } from './window-mid.js';
import { desktopListMacros, desktopGetAccessibilityTree, desktopAccessibilitySnapshots, pruneDesktopAccessibilitySnapshots, CHROMIUM_UIA_MIN_DEPTH, CHROMIUM_ACCESSIBILITY_FLAGS, CHROMIUM_CHROME_ONLY_HINT, withChromiumAccessibilityArgs, desktopGetAccessibilityState, desktopAccessibilityFindAndAct, desktopAccessibilityAction, desktopPixelWatch } from './accessibility.js';
import type { DesktopAccessibilityNode, DesktopAccessibilitySnapshot, DesktopAccessibilityAction } from './accessibility.js';



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
  pruneDesktopSessionCaches();
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


export interface DarwinLaunchResolution {
  request: { name?: string; path?: string; bundleId?: string };
  label: string;
  matchHints: string[];
}


export async function resolveDarwinLaunchRequest(
  app: string,
  appId?: string,
): Promise<DarwinLaunchResolution> {
  const rawApp = String(app || '').trim();
  const rawAppId = String(appId || '').trim();
  if (rawApp) {
    const isPath = rawApp.startsWith('/') || /[\\/]/.test(rawApp);
    const request = isPath ? { path: rawApp } : { name: rawApp };
    const hint = path.parse(rawApp).name || rawApp;
    return {
      request,
      label: rawApp,
      matchHints: [rawApp, hint].map((value) => String(value || '').toLowerCase()).filter(Boolean),
    };
  }
  if (!rawAppId) {
    throw new Error('app or app_id is required.');
  }
  const lowerId = rawAppId.toLowerCase();
  if (lowerId.startsWith('bundle:')) {
    const bundleId = rawAppId.slice('bundle:'.length).trim();
    if (!bundleId) throw new Error('bundle app_id is missing its bundle identifier.');
    return {
      request: { bundleId },
      label: rawAppId,
      matchHints: [bundleId, bundleId.split('.').pop() || ''].map((value) => String(value || '').toLowerCase()).filter(Boolean),
    };
  }
  if (lowerId.startsWith('proc:')) {
    const processName = rawAppId.slice('proc:'.length).trim();
    if (!processName) throw new Error('proc app_id is missing its process name.');
    return {
      request: { name: processName },
      label: rawAppId,
      matchHints: [processName].map((value) => String(value || '').toLowerCase()).filter(Boolean),
    };
  }

  const installed = await resolveInstalledAppLaunch(rawAppId).catch(() => null);
  if (installed) {
    const target = String(installed.method.target || '').trim();
    const isBundlePath = /\.app$/i.test(target) || target.startsWith('/');
    return {
      request: isBundlePath ? { path: target } : { name: installed.app.displayName },
      label: `${installed.app.displayName} [${installed.app.id}]`,
      matchHints: [
        installed.app.displayName,
        ...installed.app.aliases,
        ...installed.app.processNameHints,
        ...installed.app.windowTitleHints,
        target ? path.parse(target).name : '',
      ].map((value) => String(value || '').toLowerCase()).filter(Boolean),
    };
  }

  const ctx = await gatherDesktopContextInternal();
  const match = ctx.windows.find((w) => appIdForWindow(w).toLowerCase() === lowerId);
  if (match) {
    const identity = launchIdentityForWindow(match);
    return {
      request: identity,
      label: `${match.appDisplayName || match.processName} [${rawAppId}]`,
      matchHints: [
        match.bundleId,
        match.appDisplayName,
        match.processName,
        match.title,
      ].map((value) => String(value || '').toLowerCase()).filter(Boolean),
    };
  }

  throw new Error(
    `Unknown macOS app_id "${rawAppId}". Use desktop_list_apps to get a launchable bundle:... or proc:... app_id on macOS.`,
  );
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
  options: { enableAccessibility?: boolean } = {},
): Promise<string> {
  ensureWindows();
  const rawApp = String(app || '').trim();
  const rawAppId = String(appId || '').trim();
  const rawArgs = options.enableAccessibility ? withChromiumAccessibilityArgs(String(appArgs || '')) : String(appArgs || '').trim();
  if (!rawApp && !rawAppId) return 'ERROR: app or app_id is required.';

  if (DELEGATE_TO_BACKEND) {
    let resolved: DarwinLaunchResolution;
    try {
      resolved = await resolveDarwinLaunchRequest(rawApp, rawAppId);
    } catch (e: any) {
      return `ERROR: ${e?.message || e}`;
    }
    try {
      await getPlatformDesktopBackend().launchApp(resolved.request);
    } catch (e: any) {
      return `ERROR: Failed to launch '${resolved.label}': ${e?.message || e}`;
    }
    // Poll briefly for a window from the launched app to confirm visibility.
    const wait = clampInt(waitMs, 200, 60000, 6000);
    const deadline = Date.now() + wait;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      const windows = await listWindowsInternal().catch(() => [] as DesktopWindowInfo[]);
      const match = windows.find((w) =>
        (resolved.request.bundleId && String(w.bundleId || '').trim().toLowerCase() === resolved.request.bundleId.toLowerCase())
        || resolved.matchHints.some((hint) =>
          hint && (
            String(w.bundleId || '').toLowerCase().includes(hint)
            || String(w.appDisplayName || '').toLowerCase().includes(hint)
            || w.processName.toLowerCase().includes(hint)
            || w.title.toLowerCase().includes(hint)
          ),
        ),
      );
      if (match) {
        return `Launched '${resolved.label}'. Window: "${match.title}" (${match.appDisplayName || match.processName}, handle=${match.handle}).`;
      }
    }
    return `Launched '${resolved.label}' (no matching window detected within ${wait}ms; it may still be starting or may not expose a normal on-screen window yet).`;
  }

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
  const beforeWindows = await listWindowsInternal().catch(() => [] as DesktopWindowInfo[]);
  const beforeHandles = new Set(beforeWindows.map((window) => Number(window.handle)));

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
        return JSON.stringify({
          ok: true,
          launched: true,
          label: launchLabel,
          pid: launchedPid || match.pid,
          reused_existing_instance: beforeHandles.has(Number(match.handle)),
          clean_state_guaranteed: false,
          window: { title: match.title, process_name: match.processName, handle: match.handle, window_token: createDesktopWindowToken(match) },
        }, null, 2);
      }
    } catch {
      // continue polling
    }
  }
  if (launchedPid > 0) {
    return JSON.stringify({ ok: true, launched: true, label: launchLabel, pid: launchedPid, window_detected: false, reused_existing_instance: null, clean_state_guaranteed: false, waited_ms: waitMs }, null, 2);
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

export function summarizeInstalledAppLine(
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
  exact: boolean = false,
): Promise<string> {
  ensureWindows();
  const clean = String(query || '').trim();
  if (!clean) return 'ERROR: query is required.';
  const safeLimit = Math.min(Math.max(Math.floor(Number(limit) || 10), 1), 50);
  const ranked = await searchInstalledApps(clean, { limit: Math.max(safeLimit, 50), refresh });
  const normalized = clean.toLowerCase();
  const matches = ranked.filter((row) => {
    const exactName = row.displayName.toLowerCase() === normalized
      || row.aliases.some((alias) => alias.toLowerCase() === normalized)
      || row.id.toLowerCase() === normalized;
    return exact ? exactName : exactName || row.score >= 50;
  }).slice(0, safeLimit);
  if (!matches.length) {
    return `No installed apps matched "${clean}". Use desktop_list_installed_apps with a broad filter or refresh=true to rescan.`;
  }
  return [
    `Found ${matches.length} installed app match(es) for "${clean}":`,
    ...matches.map((row, idx) => summarizeInstalledAppLine(idx + 1, row, { score: row.score, matchedOn: row.matchedOn })),
    'Use desktop_launch_app({ app_id: "..." }) to launch the exact match.',
  ].join('\n');
}



/**
 * Override of sessions.set to also maintain history.
 * We monkey-patch this by extending desktopScreenshot to track prevPacket.
 */
export async function desktopScreenshotWithHistory(
  sessionId: string,
  options?: DesktopScreenshotOptions,
): Promise<string> {
  // Capture previous packet before overwriting. Expired session images are
  // discarded first so history never revives a packet past its cache lifetime.
  pruneDesktopSessionCaches();
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
  signal?: AbortSignal,
): Promise<string> {
  ensureWindows();
  throwIfDesktopCancelled(signal);
  const clampedTimeout = clampInt(timeoutMs, 500, 120000, 10000);
  const clampedPoll = clampInt(pollMs, 200, 5000, 800);
  const startedAt = Date.now();
  const deadline = startedAt + clampedTimeout;
  const deadlineController = new AbortController();
  const forwardAbort = () => deadlineController.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const deadlineTimer = setTimeout(() => deadlineController.abort(), clampedTimeout);

  let polls = 0;
  let captureMs = 0;
  try {
    const baselineStarted = Date.now();
    // Change detection hashes pixels; OCR would add seconds per poll.
    await desktopScreenshot(sessionId, { signal: deadlineController.signal, skipOcr: true });
    captureMs += Date.now() - baselineStarted;
    const baselinePacket = getDesktopAdvisorPacket(sessionId);
    const baselineHash = baselinePacket?.contentHash || '';

    while (Date.now() < deadline) {
      const remainingBeforeDelay = deadline - Date.now();
      if (remainingBeforeDelay <= 0) break;
    try {
      await desktopAbortableDelay(Math.min(clampedPoll, remainingBeforeDelay), deadlineController.signal);
    } catch (error) {
      if (signal?.aborted) return desktopFailure('DESKTOP_CANCELLED', 'Screen-change wait was interrupted.');
      if (isDesktopCancellationError(error)) break;
      throw error;
    }
    if (Date.now() >= deadline) break;
    polls++;
    try {
      const captureStarted = Date.now();
      await desktopScreenshot(sessionId, { signal: deadlineController.signal, skipOcr: true });
      captureMs += Date.now() - captureStarted;
      const newPacket = getDesktopAdvisorPacket(sessionId);
      const newHash = newPacket?.contentHash || '';
      if (newHash && newHash !== baselineHash) {
        const elapsed = Date.now() - startedAt;
        return (
          `Screen changed after ${Math.round(elapsed)}ms (${polls} poll(s)).\n` +
          `Requested timeout: ${clampedTimeout}ms; capture time: ${captureMs}ms.\n` +
          `Active window: ${newPacket?.activeWindow ? `"${newPacket.activeWindow.title}"` : 'unknown'}.\n` +
          `OCR preview: ${(newPacket?.ocrText || '').slice(0, 200).replace(/\s+/g, ' ').trim() || '(none)'}`
        );
      }
    } catch (error) {
      if (signal?.aborted) return desktopFailure('DESKTOP_CANCELLED', 'Screen-change wait was interrupted.');
      if (deadlineController.signal.aborted) break;
      // transient capture failure — keep polling
    }
  }
    return JSON.stringify({
      ok: false,
      code: 'TIMEOUT',
      changed: false,
      requested_timeout_ms: clampedTimeout,
      actual_elapsed_ms: Date.now() - startedAt,
      poll_count: polls,
      capture_ms: captureMs,
      average_capture_ms: polls >= 0 ? Math.round(captureMs / (polls + 1)) : captureMs,
    }, null, 2);
  } finally {
    clearTimeout(deadlineTimer);
    signal?.removeEventListener('abort', forwardAbort);
  }
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
export async function desktopGetWindowText(
  windowName?: string,
  options: { query?: string; max_chars?: number; max_lines?: number } = {},
): Promise<string> {
  ensureWindows();
  const query = String(windowName || '').trim();
  const textQuery = String(options.query || '').trim().toLowerCase();
  const maxChars = clampInt(options.max_chars, 64, 20_000, 4_000);
  const maxLines = clampInt(options.max_lines, 1, 2_000, 200);
  const boundText = (value: string): string => {
    let lines = String(value || '').trim().split(/\r?\n/);
    if (textQuery) lines = lines.filter((line) => line.toLowerCase().includes(textQuery));
    const bounded = lines.slice(0, maxLines).join('\n').slice(0, maxChars).trim();
    return bounded || (textQuery ? `No text matching "${options.query}" found in window.` : 'No text content found in window.');
  };
  if (DELEGATE_TO_BACKEND) {
    try {
      const out = await desktopGetAccessibilityTree(query || undefined, 6, 500);
      return boundText(String(out || ''));
    } catch (e: any) {
      return `ERROR: ${e?.message || e}`;
    }
  }
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
    return boundText(String(out || ''));
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
  window_token?: string;
  window_id?: string;
  window_handle?: number;
  app_id?: string;
  title?: string;
  name?: string;
  handle?: number;
  active?: boolean;
  focus_first?: boolean;
  padding?: number;
  /** Window-relative logical crop [x1,y1,x2,y2], applied before normalization. */
  region?: [number, number, number, number];
  mode?: 'normal' | 'som';
  som?: boolean;
  /** Skip OCR for a fast vision-first capture. */
  skipOcr?: boolean;
  signal?: AbortSignal;
  /** Internal fast-path inputs supplied by a caller that already resolved the window. */
  resolvedTarget?: DesktopWindowInfo;
  resolvedContext?: DesktopContextGathered;
}


export async function desktopWindowScreenshot(
  sessionId: string,
  options?: DesktopWindowScreenshotOptions,
): Promise<string> {
  ensureWindows();
  throwIfDesktopCancelled(options?.signal);
  const query = String(options?.name || '').trim();
  const handleNum = Number(options?.window_handle || options?.handle || 0);
  const hasHandle = Number.isFinite(handleNum) && handleNum > 0;
  const hasCanonicalSelector = !!(options?.window_token || options?.window_id || options?.app_id || options?.title);
  const useActive = options?.active === true || (!query && !hasHandle && !hasCanonicalSelector);
  const configuredCaptureBackend = resolveDesktopCaptureBackend();
  // WGC captures an occluded window without stealing focus. The legacy screen
  // crop must focus by default so another app does not cover the target pixels.
  const focusFirst = options?.focus_first == null
    ? configuredCaptureBackend.active !== 'graphics_capture'
    : options.focus_first === true;
  const padding = clampInt(options?.padding, 0, 120, 8);

  let ctx = options?.resolvedContext || await gatherDesktopContextInternal(options?.signal);
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

  let target: DesktopWindowInfo | null = options?.resolvedTarget || null;
  if (!target) {
    if (hasCanonicalSelector) {
      const resolved = await resolveCanonicalWindow({
        window_token: options?.window_token,
        window_id: options?.window_id,
        window_handle: options?.window_handle,
        app_id: options?.app_id,
        title: options?.title,
      }, ctx);
      if (!resolved.ok) return desktopFailure(resolved.code, resolved.message, { selector: options });
      target = resolved.window;
    } else {
      target = resolveTarget(ctx);
    }
  }
  if (!target) {
    return hasHandle
      ? `ERROR: No window found for handle=${Math.floor(handleNum)}.`
      : query
        ? `ERROR: No window matching "${query}" found.`
        : 'ERROR: No active window found.';
  }

  if (focusFirst) {
    if (!sameDesktopWindowHandle(ctx.activeWindow, target)) {
      const focused = await focusWindowHandle(target.handle);
      if (!focused) {
        return `ERROR: Failed to focus target window "${target.title}" (${target.processName}).`;
      }
      await desktopAbortableDelay(220, options?.signal);
      ctx = await gatherDesktopContextInternal(options?.signal);
      const refreshed = ctx.windows.find((w) => w.handle === target!.handle);
      target = refreshed || resolveTarget(ctx) || target;
    }
  }

  const left = Number(target.left);
  const top = Number(target.top);
  const width = Number(target.width);
  const height = Number(target.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 2 || height < 2) {
    return `ERROR: Target window bounds unavailable for "${target.title}" (${target.processName}). Try desktop_focus_window first.`;
  }

  let requestedRegion: [number, number, number, number] | undefined;
  if (Array.isArray(options?.region) && options.region.length === 4) {
    const raw = options.region.map(Number);
    if (!raw.every(Number.isFinite)) return 'ERROR: Window screenshot region must contain four finite numbers.';
    const rx1 = Math.max(0, Math.min(width, Math.floor(raw[0])));
    const ry1 = Math.max(0, Math.min(height, Math.floor(raw[1])));
    const rx2 = Math.max(0, Math.min(width, Math.ceil(raw[2])));
    const ry2 = Math.max(0, Math.min(height, Math.ceil(raw[3])));
    if (rx2 <= rx1 || ry2 <= ry1) {
      return `ERROR: Window screenshot region [${raw.join(', ')}] is empty or outside the ${Math.floor(width)}x${Math.floor(height)} window.`;
    }
    requestedRegion = [rx1, ry1, rx2, ry2];
  }

  let x1 = requestedRegion ? Math.floor(left + requestedRegion[0]) : Math.floor(left - padding);
  let y1 = requestedRegion ? Math.floor(top + requestedRegion[1]) : Math.floor(top - padding);
  let x2 = requestedRegion ? Math.ceil(left + requestedRegion[2]) : Math.floor(left + width + padding);
  let y2 = requestedRegion ? Math.ceil(top + requestedRegion[3]) : Math.floor(top + height + padding);
  if (x2 <= x1 || y2 <= y1) return 'ERROR: Computed window crop region is invalid.';

  let shot: {
    path: string;
    width: number;
    height: number;
    left: number;
    top: number;
    captureMode: 'all' | 'primary' | 'monitor' | 'window';
    captureMonitorIndex?: number;
    logicalWidth?: number;
    logicalHeight?: number;
  };
  let captureBackendUsed: DesktopCaptureBackend = configuredCaptureBackend.active;
  let captureFallbackNote = '';
  let shotBuffer: Buffer | null = null;
  if (configuredCaptureBackend.active === 'graphics_capture') {
    try {
      const windowToken = createDesktopWindowToken(target);
      const visualGeneration = getDesktopWindowGeneration(target).visual;
      const cachedFrame = desktopWindowFrameCache.get(windowToken);
      const canReuseFrame = !!cachedFrame
        && Date.now() - cachedFrame.capturedAt <= DESKTOP_WINDOW_FRAME_CACHE_MS
        && cachedFrame.visualGeneration === visualGeneration
        && cachedFrame.bounds.left === left
        && cachedFrame.bounds.top === top
        && cachedFrame.bounds.width === width
        && cachedFrame.bounds.height === height;
      const capture = canReuseFrame
        ? { png: cachedFrame!.png, bounds: cachedFrame!.bounds, devicePixelRatio: 1 }
        : await getPlatformDesktopBackend().capture({ kind: 'window', handle: target.handle }, options?.signal);
      if (!canReuseFrame) {
        desktopWindowFrameCache.set(windowToken, {
          capturedAt: Date.now(), visualGeneration,
          bounds: { left: capture.bounds.left, top: capture.bounds.top, width: capture.bounds.width, height: capture.bounds.height },
          png: capture.png,
        });
        if (desktopWindowFrameCache.size > 12) {
          const oldest = [...desktopWindowFrameCache.entries()].sort((a, b) => a[1].capturedAt - b[1].capturedAt)[0];
          if (oldest) desktopWindowFrameCache.delete(oldest[0]);
        }
      }
      const decoded = { bitmap: await readImageSize(capture.png) };
      const tempPath = path.join(os.tmpdir(), `prometheus-window-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`);
      shotBuffer = capture.png;
      x1 = Math.floor(capture.bounds.left);
      y1 = Math.floor(capture.bounds.top);
      x2 = Math.floor(capture.bounds.left + capture.bounds.width);
      y2 = Math.floor(capture.bounds.top + capture.bounds.height);
      shot = {
        path: tempPath,
        width: decoded.bitmap.width,
        height: decoded.bitmap.height,
        left: capture.bounds.left,
        top: capture.bounds.top,
        captureMode: 'window',
        logicalWidth: capture.bounds.width,
        logicalHeight: capture.bounds.height,
      };
    } catch (error: any) {
      if (isDesktopCancellationError(error) || error?.name === 'AbortError') {
        return desktopFailure('DESKTOP_CANCELLED', 'Window screenshot was interrupted.');
      }
      captureBackendUsed = 'window_crop';
      captureFallbackNote = `Windows.Graphics.Capture failed (${String(error?.message || error).slice(0, 180)}); used visible screen crop fallback.`;
      try {
        shot = await captureScreenshotInternal({ kind: 'all' }, [x1, y1, x2, y2], options?.signal);
      } catch (fallbackError: any) {
        if (isDesktopCancellationError(fallbackError) || fallbackError?.name === 'AbortError') {
          return desktopFailure('DESKTOP_CANCELLED', 'Window screenshot was interrupted.');
        }
        return desktopFailure('CAPTURE_FAILED', String(fallbackError?.message || fallbackError), {
          graphics_capture_error: String(error?.message || error),
          window_token: createDesktopWindowToken(target),
        });
      }
    }
  } else {
    try {
      shot = await captureScreenshotInternal({ kind: 'all' }, [x1, y1, x2, y2], options?.signal);
    } catch (error: any) {
      if (isDesktopCancellationError(error) || error?.name === 'AbortError') {
        return desktopFailure('DESKTOP_CANCELLED', 'Window screenshot was interrupted.');
      }
      return desktopFailure('CAPTURE_FAILED', String(error?.message || error), { window_token: createDesktopWindowToken(target) });
    }
  }

  // Windows.Graphics.Capture returns the entire native window. Crop it here,
  // before OCR and transport normalization, so dense ribbons/sidebars retain
  // their original pixels and the packet still maps clicks to logical coords.
  if (requestedRegion && shot.captureMode === 'window') {
    try {
      const sourceBuffer = shotBuffer || fs.readFileSync(shot.path);
      const nativeImage = { bitmap: await readImageSize(sourceBuffer) };
      const logicalWidth = Math.max(1, Number(shot.logicalWidth ?? width));
      const logicalHeight = Math.max(1, Number(shot.logicalHeight ?? height));
      const scaleX = nativeImage.bitmap.width / logicalWidth;
      const scaleY = nativeImage.bitmap.height / logicalHeight;
      const pixelX = Math.max(0, Math.min(nativeImage.bitmap.width - 1, Math.floor(requestedRegion[0] * scaleX)));
      const pixelY = Math.max(0, Math.min(nativeImage.bitmap.height - 1, Math.floor(requestedRegion[1] * scaleY)));
      const pixelX2 = Math.max(pixelX + 1, Math.min(nativeImage.bitmap.width, Math.ceil(requestedRegion[2] * scaleX)));
      const pixelY2 = Math.max(pixelY + 1, Math.min(nativeImage.bitmap.height, Math.ceil(requestedRegion[3] * scaleY)));
      shotBuffer = await cropImageBuffer(sourceBuffer, pixelX, pixelY, pixelX2 - pixelX, pixelY2 - pixelY);
      shot.width = pixelX2 - pixelX;
      shot.height = pixelY2 - pixelY;
      shot.left = left + requestedRegion[0];
      shot.top = top + requestedRegion[1];
      shot.logicalWidth = requestedRegion[2] - requestedRegion[0];
      shot.logicalHeight = requestedRegion[3] - requestedRegion[1];
      x1 = Math.floor(shot.left);
      y1 = Math.floor(shot.top);
      x2 = Math.ceil(shot.left + shot.logicalWidth);
      y2 = Math.ceil(shot.top + shot.logicalHeight);
    } catch (error: any) {
      try { fs.unlinkSync(shot.path); } catch {}
      return desktopFailure('CAPTURE_FAILED', `Native window region crop failed: ${String(error?.message || error)}`);
    }
  }

  const openWindows = ctx.windows;
  const activeWindow = ctx.activeWindow;
  if (shotBuffer && options?.skipOcr !== true) fs.writeFileSync(shot.path, shotBuffer);
  const ocr = options?.skipOcr === true ? null : await runOcr(shot.path);
  if (options?.signal?.aborted) {
    try { fs.unlinkSync(shot.path); } catch { /* best effort */ }
    return desktopFailure('DESKTOP_CANCELLED', 'Window screenshot was interrupted during OCR.');
  }

  let png: Buffer = shotBuffer || fs.readFileSync(shot.path);
  try { fs.unlinkSync(shot.path); } catch {}
  const captureRegion = {
    left: shot.left,
    top: shot.top,
    width: shot.logicalWidth ?? shot.width,
    height: shot.logicalHeight ?? shot.height,
  };
  let somElements: DesktopSomElement[] = [];
  if (options?.som === true || options?.mode === 'som') {
    const treeText = await desktopGetAccessibilityTree(target.title, 5, 500).catch(() => '');
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
      x: captureRegion.width / Math.max(1, imageWidth),
      y: captureRegion.height / Math.max(1, imageHeight),
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
    `For a point chosen from this image, use coordinate_space="capture" with screenshot_id="${packet.screenshotId}". Use coordinate_space="window" only for independently known logical window coordinates. Recapture if the window moves. For minimize/maximize/restore/close, use desktop_window_control.`;

  return [
    `Window screenshot captured (${imageWidth}x${imageHeight}${normalized?.normalized ? `, normalized from ${shot.width}x${shot.height}` : ''}).`,
    screenshotIdLine,
    `Target window: "${target.title}" (${target.processName}).`,
    `Window bounds: left=${Math.floor(left)}, top=${Math.floor(top)}, width=${Math.floor(width)}, height=${Math.floor(height)}.`,
    ...(requestedRegion ? [`Requested window-relative region: [${requestedRegion.join(', ')}].`] : []),
    `Capture region: [${x1}, ${y1}] to [${x2}, ${y2}]${shot.captureMode === 'window' ? ' (native window capture)' : ` (padding ${padding}px)`}.`,
    `Capture backend: ${captureBackendUsed}.`,
    captureFallbackNote,
    captureUsageLine,
    (options?.som === true || options?.mode === 'som') ? formatSomElements(somElements) || 'SOM mode requested, but no UI Automation elements were found inside this window capture.' : '',
    `Active window: ${shortWindowLabel(activeWindow)}.`,
    ocrPreview ? `OCR text (${Math.round(ocr?.confidence || 0)}% confidence):\n${ocrPreview}${ocrLen > 400 ? ' ...' : ''}` : 'OCR: unavailable.',
  ].join('\n');
}
