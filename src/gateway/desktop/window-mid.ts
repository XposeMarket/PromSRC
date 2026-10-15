import { normalizedWindowHandle, resolveDesktopActionPoint, desktopCaptureRequiresPrecisionRecapture, resolvePreparedWindowPoint, desktopClick } from './interaction-actions.js';
import { desktopWindowScreenshot } from './apps.js';
import { desktopGetAccessibilityTree } from './accessibility.js';



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



/**
 * desktop_list_apps — installed + running apps with their open windows, in the
 * canonical model. Running apps are grouped by process; not-running installed
 * apps come from the installed-apps inventory.
 */
export async function desktopListApps(
  filter: string = '',
  includeWindows: boolean = true,
  options: { scope?: 'running' | 'installed' | 'all'; compact?: boolean; limit?: number; cursor?: number } = {},
): Promise<string> {
  ensureWindows();
  const ctx = await gatherDesktopContextInternal();
  const activeHandle = normalizedWindowHandle(ctx.activeWindow);
  const clean = String(filter || '').trim().toLowerCase();

  // Group running windows by process.
  const runningByApp = new Map<string, DesktopAppState>();
  for (const w of ctx.windows) {
    const appId = appIdForWindow(w);
    let app = runningByApp.get(appId);
    if (!app) {
      app = {
        appId,
        displayName: String(w.appDisplayName || w.processName || '').trim() || w.processName,
        processName: w.processName,
        executablePath: w.appPath,
        isRunning: true,
        windows: [],
      };
      runningByApp.set(appId, app);
    }
    app.windows.push(toDesktopWindowState(w, activeHandle));
  }

  const scope = options.scope || (filter ? 'all' : 'running');
  const compact = options.compact !== false;
  const limit = clampInt(options.limit, 1, 100, 25);
  const cursor = Math.max(0, Math.floor(Number(options.cursor) || 0));

  // Merge installed-app inventory only when requested; the default running-only
  // path avoids a large inventory scan and thousands of low-value output tokens.
  const apps: DesktopAppState[] = [];
  if (scope !== 'running') try {
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
  if (scope !== 'installed') apps.push(...runningByApp.values());

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
  const shown = filtered.slice(cursor, cursor + limit);

  const payload = shown.map((a) => ({
    app_id: a.appId,
    display_name: a.displayName,
    process_name: a.processName,
    ...(!compact && a.executablePath ? { executable_path: a.executablePath } : {}),
    is_running: a.isRunning,
    ...(includeWindows
      ? {
          windows: a.windows.map((w) => ({
            window_id: w.windowId,
            window_token: w.windowToken,
            title: w.title,
            ...(!compact ? { bounds: w.bounds, handle: w.handle } : {}),
            monitor_index: w.monitorIndex,
            is_active: w.isActive,
          })),
        }
      : { window_count: a.windows.length }),
  }));

  return [
    `Apps (${shown.length} shown of ${filtered.length}; scope=${scope}; cursor=${cursor}; next_cursor=${cursor + shown.length < filtered.length ? cursor + shown.length : 'none'}).`,
    JSON.stringify(payload, null, 2),
  ].join('\n');
}


/** desktop_list_windows — flat list of open windows in the canonical model. */
export async function desktopListWindowsCanonical(
  selector: { app_id?: string; process_name?: string; title?: string; filter?: string } = {},
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
  if (selector.filter) {
    const query = String(selector.filter).trim().toLowerCase();
    filtered = filtered.filter((window) => window.title.toLowerCase().includes(query)
      || window.processName.toLowerCase().includes(query)
      || window.appId.toLowerCase().includes(query));
  }
  if (!filtered.length) return 'No open windows matched.';
  const payload = filtered.map((w) => ({
    window_id: w.windowId,
    window_token: w.windowToken,
    handle: w.handle,
    app_id: w.appId,
    process_name: w.processName,
    pid: w.pid,
    process_start_time: w.processStartTime,
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
    window_token?: string;
    window_id?: string;
    window_handle?: number;
    app_id?: string;
    title?: string;
    include_screenshot?: boolean;
    include_text?: boolean;
    focus_first?: boolean;
    signal?: AbortSignal;
  },
): Promise<string> {
  ensureWindows();
  throwIfDesktopCancelled(input.signal);
  const resolved = await resolveCanonicalWindow({
    window_token: input.window_token,
    window_id: input.window_id,
    window_handle: input.window_handle,
    app_id: input.app_id,
    title: input.title,
    active: !input.window_token && !input.window_id && !input.window_handle && !input.app_id && !input.title,
  });
  if (!resolved.ok) return desktopFailure(resolved.code, resolved.message, { selector: input });
  const target = resolved.window;
  const activeHandle = normalizedWindowHandle(resolved.context.activeWindow);
  const state = toDesktopWindowState(target, activeHandle);

  const includeScreenshot = input.include_screenshot !== false;
  const includeText = input.include_text === true;
  const backend = resolveDesktopCaptureBackend();
  let captureBackendUsed: DesktopCaptureBackend = backend.active;

  let screenshotId: string | undefined;
  let screenshotNote = '';
  if (includeScreenshot) {
    const shot = await desktopWindowScreenshot(sessionId, {
      handle: target.handle,
      name: target.title,
      focus_first: input.focus_first === true,
      skipOcr: true,
      resolvedTarget: target,
      resolvedContext: resolved.context,
      signal: input.signal,
    }).catch((e: any) => `ERROR: ${e?.message || e}`);
    const idMatch = String(shot).match(/Screenshot ID:\s*(ds_[^\s.]+)/);
    if (idMatch) {
      screenshotId = idMatch[1];
      const backendMatch = String(shot).match(/Capture backend:\s*(graphics_capture|copy_from_screen|window_crop)/i);
      if (backendMatch) captureBackendUsed = backendMatch[1].toLowerCase() as DesktopCaptureBackend;
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
      window_token: state.windowToken,
      handle: state.handle,
      app_id: state.appId,
      process_name: state.processName,
      pid: state.pid,
      process_start_time: state.processStartTime,
      title: state.title,
      bounds: state.bounds,
      monitor_index: state.monitorIndex,
      is_active: state.isActive,
    },
    screenshot_id: screenshotId,
    capture_backend: captureBackendUsed,
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

export async function desktopFocusWindowCanonical(
  sessionId: string,
  selector: DesktopWindowSelector,
  includeScreenshot = true,
  signal?: AbortSignal,
  options?: { skipOcr?: boolean },
): Promise<string> {
  throwIfDesktopCancelled(signal);
  const resolved = await resolveCanonicalWindow(selector);
  if (!resolved.ok) return desktopFailure(resolved.code, resolved.message, { selector });
  const focused = await focusWindowHandle(resolved.window.handle).catch(() => false);
  if (!focused) return desktopFailure('FOCUS_FAILED', `Could not focus ${shortWindowLabel(resolved.window)}.`, { window_token: createDesktopWindowToken(resolved.window) });
  markDesktopWindowChanged(resolved.window, 'focus_window', { accessibility: true });
  if (!includeScreenshot) {
    return `Focused ${shortWindowLabel(resolved.window)}.\n${JSON.stringify({ ok: true, window_id: windowIdForHandle(resolved.window.handle), window_token: createDesktopWindowToken(resolved.window) }, null, 2)}`;
  }
  const screenshot = await desktopWindowScreenshot(sessionId, {
    window_token: createDesktopWindowToken(resolved.window),
    focus_first: false,
    skipOcr: options?.skipOcr === true,
    signal,
  });
  return screenshot.startsWith('ERROR')
    ? screenshot
    : `Focused ${shortWindowLabel(resolved.window)}.\n${screenshot}`;
}


// ─── Background dispatch helpers ────────────────────────────────────────────

/** Resolve + identity-validate the target window without focusing it. */
export async function prepareWindowForBackground(selector: DesktopWindowSelector, signal?: AbortSignal) {
  return prepareWindowForInput(selector, signal, false);
}


/** Exact-window WGC fingerprint (occlusion-safe) for background verification. */
export async function backgroundWindowFingerprint(handle: number, signal?: AbortSignal): Promise<string | null> {
  try {
    const helper = await backgroundHelper();
    if (!helper) return null;
    const capture = await helper.capture({ kind: 'window', handle: Math.floor(handle) } as DesktopCaptureRequest, signal);
    return crypto.createHash('sha1').update(capture.png).digest('hex');
  } catch {
    return null;
  }
}


export function backgroundUnavailableFailure(result: Win32BackgroundResult, window: DesktopWindowInfo, action: string): string {
  return desktopFailure('BACKGROUND_UNAVAILABLE', `${action} cannot run in the background for ${shortWindowLabel(window)}: ${result.detail || result.reason || 'unsupported target'}`, {
    reason: result.reason,
    target_class: result.targetClass,
    dispatch: 'background',
    next_step: backgroundUnavailableHint(result.reason),
    retry_with: { dispatch: 'foreground' },
  });
}


/**
 * Run one background helper action against an exact window and verify that the
 * window actually changed (WGC frame hash before/after). Posted messages report
 * success even when an app ignores them, so verification is what makes
 * background mode honest. verify='off' skips the before/after capture.
 */
export async function runBackgroundWindowAction(
  window: DesktopWindowInfo,
  action: string,
  run: () => Promise<Win32BackgroundResult>,
  options: { verify?: DesktopVerificationMode | string; signal?: AbortSignal; settleMs?: number } = {},
): Promise<string> {
  const startedAt = performance.now();
  const verifyMode = String(options.verify || 'auto').toLowerCase();
  const verify = verifyMode !== 'off';
  const before = verify ? await backgroundWindowFingerprint(window.handle, options.signal) : null;
  throwIfDesktopCancelled(options.signal);
  let result: Win32BackgroundResult;
  try {
    result = await run();
  } catch (error: any) {
    return desktopFailure('BACKGROUND_FAILED', `${action} failed in background dispatch: ${String(error?.message || error)}`, { dispatch: 'background' });
  }
  if (!result?.ok) {
    if (result?.backgroundUnavailable) return backgroundUnavailableFailure(result, window, action);
    return desktopFailure('BACKGROUND_FAILED', `${action} failed in background dispatch.`, { result });
  }
  const actedAt = performance.now();
  markDesktopWindowChanged(window, `background_${action}`);
  let verification = 'not_checked';
  if (verify && before) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(80, options.settleMs ?? 220)));
    let after = await backgroundWindowFingerprint(window.handle, options.signal);
    if (after === before) {
      // Some apps repaint on their next frame; give one more short chance.
      await new Promise((resolve) => setTimeout(resolve, 350));
      after = await backgroundWindowFingerprint(window.handle, options.signal);
    }
    verification = after == null ? 'capture_unavailable' : after !== before ? 'window_changed' : 'no_visible_change';
  }
  const posted = String(result.method || '').startsWith('post_') || result.method === 'edit_message';
  if (verification === 'no_visible_change' && posted && verifyMode === 'strict') {
    return desktopFailure('BACKGROUND_UNAVAILABLE', `${action} was posted to ${shortWindowLabel(window)} but the window did not visibly change; the app probably ignores background input.`, {
      reason: 'ignored_posted_input', method: result.method, target_class: result.targetClass,
      next_step: backgroundUnavailableHint('ignored'), retry_with: { dispatch: 'foreground' },
    });
  }
  const lines = [
    `Background ${action} on ${shortWindowLabel(window)} (${describeBackgroundResult(result)}). Your cursor and focus were not touched.`,
    `Verification: ${verification}${verification === 'no_visible_change' ? (posted ? ' - the app may have ignored posted input; check state or retry with dispatch="foreground".' : ' - the UIA action succeeded but nothing visibly changed yet.') : ''}`,
    `Timing: action=${Math.round(actedAt - startedAt)}ms, total=${Math.round(performance.now() - startedAt)}ms.`,
  ];
  return lines.join('\n');
}


/** Foreground opt-in: wait for the user to pause, act, then hand focus/cursor back. */
export async function withForegroundArbitration(
  targetHandle: number,
  signal: AbortSignal | undefined,
  act: () => Promise<string>,
): Promise<string> {
  const quiet = await waitForUserQuiet(undefined, undefined, signal);
  if (!quiet.ok) {
    return desktopFailure('FOCUS_FAILED', `You are actively using the mouse/keyboard (waited ${quiet.waitedMs}ms). Foreground input was not sent so it would not fight you.`, {
      dispatch: 'foreground', retryable_after_ms: 1500,
    });
  }
  const result = await act();
  const restore = await restoreUserFocus(quiet.snapshot, targetHandle, focusWindowHandle);
  return restore && !result.startsWith('ERROR') ? `${result}\n${restore}` : result;
}


export async function prepareWindowForInput(
  selector: DesktopWindowSelector,
  signal?: AbortSignal,
  focusFirst: boolean = true,
): Promise<{ ok: true; window: DesktopWindowInfo; hint?: string } | { ok: false; code: DesktopFailureCode; message: string }> {
  throwIfDesktopCancelled(signal);
  // Strong tokens must take the full identity-validation path. Never fast-path
  // their HWND alone, because that would reintroduce the handle-reuse race.
  if (selector.window_token) {
    const token = parseDesktopWindowToken(selector.window_token);
    if (!token) return { ok: false, code: 'INVALID_ARGUMENT', message: 'window_token is malformed or its checksum is invalid. Capture fresh window state.' };
    const live = await getWindowByHandleFast(token.handle);
    if (!live) return { ok: false, code: 'STALE_WINDOW', message: 'The window referenced by window_token is no longer open. Capture fresh window state.' };
    const liveStart = Math.floor(Number(live.processStartTime) || 0);
    if (Number(live.pid) !== token.pid || liveStart !== token.processStartTime) {
      return {
        ok: false,
        code: 'STALE_WINDOW',
        message: `The HWND in window_token now belongs to a different process/window (expected pid=${token.pid}, start=${token.processStartTime}; found pid=${live.pid}, start=${liveStart}).`,
      };
    }
    if (focusFirst) {
      if (live.isActive) return { ok: true, window: live };
      const active = await activeWindowInternal().catch(() => null);
      if (active?.handle === live.handle) return { ok: true, window: { ...live, isActive: true } };
      throwIfDesktopCancelled(signal);
      const focused = await focusWindowHandle(live.handle).catch(() => false);
      if (!focused) return { ok: false, code: 'FOCUS_FAILED', message: `Could not focus ${shortWindowLabel(live)} before input.` };
    }
    return { ok: true, window: live };
  }
  const explicitHandle = Number(selector.window_handle);
  const exactHandle = Number.isFinite(explicitHandle) && explicitHandle > 0
    ? Math.floor(explicitHandle)
    : (parseWindowId(selector.window_id) || 0);
  if (exactHandle > 0) {
    const fastWindow = await getWindowByHandleFast(exactHandle);
    if (fastWindow) {
      if (!focusFirst) return { ok: true, window: fastWindow };
      const active = await activeWindowInternal().catch(() => null);
      if (active?.handle === exactHandle) return { ok: true, window: fastWindow };
      const focused = await focusWindowHandle(exactHandle).catch(() => false);
      if (!focused) {
        return { ok: false, code: 'FOCUS_FAILED', message: `Could not focus ${shortWindowLabel(fastWindow)} before input. Capture fresh window state to confirm it is still open.` };
      }
      return { ok: true, window: fastWindow };
    }
  }
  const resolved = await resolveCanonicalWindow(selector);
  if (!resolved.ok) return resolved;
  if (!focusFirst || resolved.isActive) return resolved;
  throwIfDesktopCancelled(signal);
  // Restore-if-minimized + focus happens inside focusWindowHandle.
  const focused = await focusWindowHandle(resolved.window.handle).catch(() => false);
  if (!focused) {
    return { ok: false, code: 'FOCUS_FAILED', message: `Could not focus ${shortWindowLabel(resolved.window)} before input. Capture fresh window state to confirm it is still open.` };
  }
  return resolved;
}


export interface DesktopFocusedControlEvidence {
  available: boolean;
  editable: boolean;
  role?: string;
  name?: string;
  automation_id?: string;
  value?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}


export async function inspectFocusedControl(signal?: AbortSignal): Promise<DesktopFocusedControlEvidence> {
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
try {
  $e = [System.Windows.Automation.AutomationElement]::FocusedElement
  if (-not $e) { throw 'No focused UI Automation element.' }
  $c = $e.Current
  $vp = $null
  $hasValue = $e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)
  $value = ''
  $readOnly = $true
  if ($hasValue) { $value = [string]$vp.Current.Value; $readOnly = [bool]$vp.Current.IsReadOnly }
  $role = if ($c.ControlType) { $c.ControlType.ProgrammaticName.Replace('ControlType.','') } else { 'Unknown' }
  $r = $c.BoundingRectangle
  [ordered]@{
    available = $true
    editable = (($role -eq 'Edit' -or $role -eq 'Document') -and (-not $hasValue -or -not $readOnly))
    role = $role; name = [string]$c.Name; automation_id = [string]$c.AutomationId
    value = $value; x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height
  } | ConvertTo-Json -Compress
} catch {
  [ordered]@{ available = $false; editable = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
  try {
    const parsed = parseJsonMaybe(await runPowerShell(script, { timeoutMs: 6_000, sta: true, signal }));
    return {
      available: parsed?.available === true,
      editable: parsed?.editable === true,
      role: String(parsed?.role || ''), name: String(parsed?.name || ''),
      automation_id: String(parsed?.automation_id || ''), value: String(parsed?.value || ''),
      ...(parsed?.available ? { bounds: { x: Number(parsed.x) || 0, y: Number(parsed.y) || 0, width: Number(parsed.width) || 0, height: Number(parsed.height) || 0 } } : {}),
    };
  } catch {
    return { available: false, editable: false };
  }
}


export type DesktopWindowClickOptions = { button?: 'left' | 'right'; double_click?: boolean; modifier?: 'shift' | 'ctrl' | 'alt'; verify?: DesktopVerificationMode; focus_first?: boolean; signal?: AbortSignal; allow_broad_grounded?: boolean; dispatch?: DesktopDispatchMode | string };


export async function desktopWindowClick(
  selector: DesktopWindowSelector,
  point: { x: number; y: number; coordinate_space?: DesktopCoordinateSpace; screenshot_id?: string },
  options: DesktopWindowClickOptions = {},
  sessionId: string = '__reactor__',
): Promise<string> {
  const dispatch = await resolveDesktopDispatch(options.dispatch);
  if (dispatch.mode === 'foreground') {
    const target = await prepareWindowForBackground(selector, options.signal);
    const run = () => desktopWindowClickForeground(selector, point, options, sessionId);
    const result = target.ok ? await withForegroundArbitration(target.window.handle, options.signal, run) : await run();
    return dispatch.note && !result.startsWith('ERROR') ? `${result}\nNote: ${dispatch.note}` : result;
  }
  const prep = await prepareWindowForBackground(selector, options.signal);
  if (!prep.ok) return desktopFailure(prep.code, prep.message, { selector });
  if (options.modifier) {
    return backgroundUnavailableFailure({ ok: false, backgroundUnavailable: true, reason: 'modifier_combo', detail: `${options.modifier}+click needs the real modifier key state.` }, prep.window, 'click');
  }
  const resolved = await resolveDesktopActionPoint(sessionId, {
    x: Number(point.x),
    y: Number(point.y),
    coordinate_space: resolveDesktopWindowClickCoordinateSpace(point),
    screenshot_id: point.screenshot_id,
    window_handle: prep.window.handle,
    window_name: prep.window.title,
    prepared_window: prep.window,
    allow_broad_grounded: options.allow_broad_grounded,
    background_dispatch: true,
  }, 'desktop_window_click');
  if (!resolved.ok) return `ERROR: ${resolved.message}`;
  const helper = await backgroundHelper();
  if (!helper) return desktopFailure('HELPER_UNAVAILABLE', 'Background dispatch needs the native desktop helper.', {});
  return runBackgroundWindowAction(prep.window, 'click', () => helper.backgroundClick(prep.window.handle, resolved.point.x, resolved.point.y, {
    button: options.button === 'right' ? 'right' : 'left',
    repeat: options.double_click ? 2 : 1,
  }, options.signal), { verify: options.verify, signal: options.signal });
}


export async function desktopWindowClickForeground(
  selector: DesktopWindowSelector,
  point: { x: number; y: number; coordinate_space?: DesktopCoordinateSpace; screenshot_id?: string },
  options: DesktopWindowClickOptions = {},
  sessionId: string = '__reactor__',
): Promise<string> {
  const startedAt = performance.now();
  if (!options.allow_broad_grounded && (!point.coordinate_space || point.coordinate_space === 'capture') && point.screenshot_id) {
    const anchor = getDesktopAdvisorPacketById(sessionId, point.screenshot_id);
    if (anchor && desktopCaptureRequiresPrecisionRecapture(anchor)) {
      return `ERROR: [PRECISION_CAPTURE_REQUIRED] Screenshot ${anchor.screenshotId} is too broad or was downscaled (${anchor.width}x${anchor.height}) for a reliable click. Capture the relevant panel with desktop_window(action="region_screenshot") and use its fresh screenshot_id.`;
    }
  }
  const screenshotAnchor = point.screenshot_id
    ? getDesktopAdvisorPacketById(sessionId, point.screenshot_id)
    : null;
  const anchorWindow = screenshotAnchor?.targetWindow || screenshotAnchor?.activeWindow || null;
  const anchorTargetHandle = anchorWindow?.handle || 0;
  const selectorToken = selector.window_token ? parseDesktopWindowToken(selector.window_token) : null;
  const anchorAgeMs = screenshotAnchor ? Date.now() - screenshotAnchor.capturedAt : Number.POSITIVE_INFINITY;
  const anchorMatchesSelector = Boolean(
    anchorWindow
    && anchorTargetHandle > 0
    && (
      (selectorToken
        && selectorToken.handle === anchorTargetHandle
        && selectorToken.pid === anchorWindow.pid
        && selectorToken.processStartTime === Math.floor(Number(anchorWindow.processStartTime) || 0))
      || Number(selector.window_handle) === anchorTargetHandle
      || parseWindowId(selector.window_id) === anchorTargetHandle
    )
  );
  // A recent exact-window capture already validated the HWND, PID, process start,
  // bounds, and foreground state. Reuse that identity for its immediately-bound
  // input instead of paying another PowerShell/Win32 discovery round trip. The
  // short TTL preserves safety if the user changes windows outside Prometheus.
  const anchorProvesActiveTarget = Boolean(
    screenshotAnchor
    && anchorAgeMs <= 30_000
    && anchorMatchesSelector
    && (anchorWindow?.isActive === true || screenshotAnchor.activeWindow?.handle === anchorTargetHandle)
  );
  const prep = anchorProvesActiveTarget && anchorWindow
    ? { ok: true as const, window: { ...anchorWindow, isActive: true }, hint: 'Reused fresh screenshot-bound window identity.' }
    : await prepareWindowForInput(selector, options.signal, options.focus_first !== false);
  if (!prep.ok) return desktopFailure(prep.code, prep.message, { selector });
  const preparedAt = performance.now();
  // A screenshot anchor means x/y normally came from that image. Match the
  // global resolver and default to capture space; defaulting to window space
  // silently mis-scaled points from normalized ultrawide/window screenshots.
  const space = resolveDesktopWindowClickCoordinateSpace(point);
  const fastPoint = space === 'window' && !point.screenshot_id
    ? resolvePreparedWindowPoint(prep.window, Number(point.x), Number(point.y), 'desktop_window_click')
    : null;
  const resolvedPoint = fastPoint?.ok
    ? {
        ok: true as const,
        point: {
          x: fastPoint.x,
          y: fastPoint.y,
          coordinateSpace: 'window' as DesktopCoordinateSpace,
          sourceNote: fastPoint.sourceNote,
        },
      }
    : fastPoint
      ? fastPoint
      : await resolveDesktopActionPoint(sessionId, {
          x: Number(point.x),
          y: Number(point.y),
          coordinate_space: space,
          screenshot_id: point.screenshot_id,
          window_handle: prep.window.handle,
          window_name: prep.window.title,
          prepared_window: prep.window,
          allow_broad_grounded: options.allow_broad_grounded,
        }, 'desktop_window_click');
  if (!resolvedPoint.ok) return `ERROR: ${resolvedPoint.message}`;
  const resolvedAt = performance.now();
  throwIfDesktopCancelled(options.signal);
  const result = await desktopClick(
    resolvedPoint.point.x,
    resolvedPoint.point.y,
    options.button === 'right' ? 'right' : 'left',
    options.double_click === true,
    undefined,
    options.modifier,
    `${resolvedPoint.point.sourceNote} [${shortWindowLabel(prep.window)}]`,
    { mode: options.verify, coordinateSpace: resolvedPoint.point.coordinateSpace, windowHandle: prep.window.handle },
  );
  const clickedAt = performance.now();
  if (!result.startsWith('ERROR')) markDesktopWindowChanged(prep.window, 'window_click');
  if (result.startsWith('ERROR')) return result;
  const timing = `Timing: focus=${Math.round(preparedAt - startedAt)}ms, resolve=${Math.round(resolvedAt - preparedAt)}ms, click=${Math.round(clickedAt - resolvedAt)}ms, total=${Math.round(clickedAt - startedAt)}ms.`;
  return `${result}\n${timing}${prep.hint ? `\nNote: ${prep.hint}` : ''}`;
}
