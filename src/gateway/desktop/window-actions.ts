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
import { desktopSendToTelegram, getDesktopAdvisorPacket, launchProcessInternal, resolveDarwinLaunchRequest, desktopLaunchApp, desktopCloseApp, desktopGetProcessList, summarizeInstalledAppLine, desktopListInstalledApps, desktopFindInstalledApp, desktopScreenshotWithHistory, desktopWaitForChange, desktopDiffScreenshot, desktopGetWindowText, desktopWindowScreenshot } from './apps.js';
import type { DarwinLaunchResolution, DesktopWindowScreenshotOptions } from './apps.js';
import { desktopCaptureRequiresPrecisionRecapture, resolveDesktopActionPoint, computeContentHash, createDesktopAdvisorPacket, storeDesktopPacket, computeBinaryHash, normalizedWindowHandle, resolvePreparedWindowPoint, normalizeOcrText, buildProbeRegionAroundPoint, captureDesktopVerificationSnapshot, cleanupDesktopVerificationSnapshot, resolveDesktopVerificationMode, desktopMovePointer, desktopPerformClickAtCurrent, desktopPerformClickAt, desktopPerformScrollAtCurrent, desktopPerformScrollAt, desktopPerformDragInternal, loadSnapshotOcrText, formatDesktopVerification, classifyDesktopVerification, verifyDesktopAction, lastOcrDiagnostic, runOcr, parseSomElementsFromAccessibilityTree, renderSomOverlay, formatSomElements, desktopScreenshot, desktopFindWindow, desktopFocusWindow, writeDesktopFocusThumbnail, desktopWindowMatchesQuery, desktopFocusWindowVerified, desktopWindowControl, windowControlInternal, desktopClick, desktopDrag, desktopWait, toSendKeysSpec, typeTextInternal, pressSendKeysSpecInternal, desktopType, desktopPressKey, getClipboardTextInternal, setClipboardTextInternal, desktopGetClipboard, CLIPBOARD_IMAGE_EXTS, desktopSetClipboard, desktopScroll, desktopTypeRaw, desktopRecordMacro, desktopStopMacro, desktopReplayMacro } from './interaction-actions.js';
import type { DesktopVerificationSnapshot, DesktopSetClipboardArgs } from './interaction-actions.js';



export async function desktopWindowType(
  selector: DesktopWindowSelector,
  text: string,
  raw: boolean = false,
  signal?: AbortSignal,
  options: { dispatch?: DesktopDispatchMode | string; verify?: DesktopVerificationMode | string } = {},
): Promise<string> {
  const dispatch = await resolveDesktopDispatch(options.dispatch);
  if (dispatch.mode === 'foreground') {
    const target = await prepareWindowForBackground(selector, signal);
    const run = () => desktopWindowTypeForeground(selector, text, raw, signal);
    const result = target.ok ? await withForegroundArbitration(target.window.handle, signal, run) : await run();
    return dispatch.note && !result.startsWith('ERROR') ? `${result}\nNote: ${dispatch.note}` : result;
  }
  const prep = await prepareWindowForBackground(selector, signal);
  if (!prep.ok) return desktopFailure(prep.code, prep.message, { selector });
  const helper = await backgroundHelper();
  if (!helper) return desktopFailure('HELPER_UNAVAILABLE', 'Background dispatch needs the native desktop helper.', {});
  return runBackgroundWindowAction(prep.window, 'type', () => helper.backgroundType(prep.window.handle, String(text || ''), signal), { verify: options.verify, signal });
}


export async function desktopWindowTypeForeground(
  selector: DesktopWindowSelector,
  text: string,
  raw: boolean = false,
  signal?: AbortSignal,
): Promise<string> {
  const prep = await prepareWindowForInput(selector, signal);
  if (!prep.ok) return desktopFailure(prep.code, prep.message, { selector });
  const before = await inspectFocusedControl(signal);
  if (!before.available || !before.editable) {
    return desktopFailure('FOCUS_FAILED', 'Typing target is unknown or non-editable; no text was sent. Focus a specific editable control or use find_and_act(set_value).', {
      window_token: createDesktopWindowToken(prep.window), focused_control: before,
    });
  }
  throwIfDesktopCancelled(signal);
  const result = raw ? await desktopTypeRaw(String(text || '')) : await desktopType(String(text || ''));
  if (!result.startsWith('ERROR')) markDesktopWindowChanged(prep.window, raw ? 'window_type_raw' : 'window_type');
  if (result.startsWith('ERROR')) return result;
  const after = await inspectFocusedControl(signal);
  const assertion = { focused_control: after, input_reached_editable_control: after.available && after.editable, value_changed: before.value !== after.value };
  return `${result}\n${JSON.stringify(assertion, null, 2)}${prep.hint ? `\nNote: ${prep.hint}` : ''}`;
}


export async function desktopWindowPressKey(
  selector: DesktopWindowSelector,
  key: string,
  signal?: AbortSignal,
  options: { dispatch?: DesktopDispatchMode | string; verify?: DesktopVerificationMode | string } = {},
): Promise<string> {
  const dispatch = await resolveDesktopDispatch(options.dispatch);
  if (dispatch.mode === 'foreground') {
    const target = await prepareWindowForBackground(selector, signal);
    const run = () => desktopWindowPressKeyForeground(selector, key, signal);
    const result = target.ok ? await withForegroundArbitration(target.window.handle, signal, run) : await run();
    return dispatch.note && !result.startsWith('ERROR') ? `${result}\nNote: ${dispatch.note}` : result;
  }
  const prep = await prepareWindowForBackground(selector, signal);
  if (!prep.ok) return desktopFailure(prep.code, prep.message, { selector });
  const combo = parseKeyCombo(key);
  if (combo.win) {
    return backgroundUnavailableFailure({ ok: false, backgroundUnavailable: true, reason: 'modifier_combo', detail: 'Windows-key shortcuts are system-wide and need real input.' }, prep.window, 'key');
  }
  const helper = await backgroundHelper();
  if (!helper) return desktopFailure('HELPER_UNAVAILABLE', 'Background dispatch needs the native desktop helper.', {});
  return runBackgroundWindowAction(prep.window, 'key', () => helper.backgroundKey(prep.window.handle, combo.key, combo, signal), { verify: options.verify, signal });
}


export async function desktopWindowPressKeyForeground(
  selector: DesktopWindowSelector,
  key: string,
  signal?: AbortSignal,
): Promise<string> {
  const prep = await prepareWindowForInput(selector, signal);
  if (!prep.ok) return desktopFailure(prep.code, prep.message, { selector });
  throwIfDesktopCancelled(signal);
  const result = await desktopPressKey(String(key || 'Enter'));
  if (!result.startsWith('ERROR')) markDesktopWindowChanged(prep.window, 'window_key');
  if (result.startsWith('ERROR')) return result;
  const after = await inspectFocusedControl(signal);
  return `${result}\n${JSON.stringify({ focused_control: after, target_known: after.available }, null, 2)}${prep.hint ? `\nNote: ${prep.hint}` : ''}`;
}


export type DesktopWindowScrollArgs = { direction: 'up' | 'down' | 'left' | 'right'; amount?: number; x?: number; y?: number; coordinate_space?: DesktopCoordinateSpace; screenshot_id?: string; focus_first?: boolean; dispatch?: DesktopDispatchMode | string; verify?: DesktopVerificationMode | string };


export async function desktopWindowScroll(
  selector: DesktopWindowSelector,
  args: DesktopWindowScrollArgs,
  sessionId: string = '__reactor__',
  signal?: AbortSignal,
): Promise<string> {
  const dispatch = await resolveDesktopDispatch(args.dispatch);
  if (dispatch.mode === 'foreground') {
    const target = await prepareWindowForBackground(selector, signal);
    const run = () => desktopWindowScrollForeground(selector, args, sessionId, signal);
    const result = target.ok ? await withForegroundArbitration(target.window.handle, signal, run) : await run();
    return dispatch.note && !result.startsWith('ERROR') ? `${result}\nNote: ${dispatch.note}` : result;
  }
  const prep = await prepareWindowForBackground(selector, signal);
  if (!prep.ok) return desktopFailure(prep.code, prep.message, { selector });
  let px = Number(prep.window.left) + Math.floor(Number(prep.window.width) / 2);
  let py = Number(prep.window.top) + Math.floor(Number(prep.window.height) / 2);
  if (args.x !== undefined && args.y !== undefined) {
    const resolved = await resolveDesktopActionPoint(sessionId, {
      x: Number(args.x),
      y: Number(args.y),
      coordinate_space: args.coordinate_space || (args.screenshot_id ? 'capture' : 'window'),
      screenshot_id: args.screenshot_id,
      window_handle: prep.window.handle,
      window_name: prep.window.title,
      prepared_window: prep.window,
      background_dispatch: true,
    }, 'desktop_window_scroll');
    if (!resolved.ok) return `ERROR: ${resolved.message}`;
    px = resolved.point.x;
    py = resolved.point.y;
  }
  const ticks = Math.max(1, Math.min(50, Math.floor(Number(args.amount) || 3)));
  const dir = args.direction;
  const delta = (dir === 'up' || dir === 'left' ? 120 : -120) * ticks;
  // Horizontal wheel convention: positive = right.
  const deltaX = dir === 'left' ? -120 * ticks : dir === 'right' ? 120 * ticks : 0;
  const deltaY = dir === 'up' || dir === 'down' ? delta : 0;
  const helper = await backgroundHelper();
  if (!helper) return desktopFailure('HELPER_UNAVAILABLE', 'Background dispatch needs the native desktop helper.', {});
  return runBackgroundWindowAction(prep.window, 'scroll', () => helper.backgroundScroll(prep.window.handle, px, py, deltaX, deltaY, signal), { verify: args.verify, signal });
}


export async function desktopWindowScrollForeground(
  selector: DesktopWindowSelector,
  args: DesktopWindowScrollArgs,
  sessionId: string = '__reactor__',
  signal?: AbortSignal,
): Promise<string> {
  const prep = await prepareWindowForInput(selector, signal, args.focus_first !== false);
  if (!prep.ok) return desktopFailure(prep.code, prep.message, { selector });
  const dir = args.direction;
  const horizontal = dir === 'left' || dir === 'right';
  let x: number | undefined;
  let y: number | undefined;
  let space: DesktopCoordinateSpace | undefined;
  if (args.x !== undefined && args.y !== undefined) {
    const requestedSpace = args.coordinate_space || 'window';
    const fastPoint = requestedSpace === 'window' && !args.screenshot_id
      ? resolvePreparedWindowPoint(prep.window, Number(args.x), Number(args.y), 'desktop_window_scroll')
      : null;
    if (fastPoint?.ok) {
      x = fastPoint.x;
      y = fastPoint.y;
      space = 'window';
    } else if (fastPoint) {
      return `ERROR: ${fastPoint.message}`;
    } else {
      const resolvedPoint = await resolveDesktopActionPoint(sessionId, {
        x: Number(args.x),
        y: Number(args.y),
        coordinate_space: requestedSpace,
        screenshot_id: args.screenshot_id,
        window_handle: prep.window.handle,
        window_name: prep.window.title,
      }, 'desktop_window_scroll');
      if (!resolvedPoint.ok) return `ERROR: ${resolvedPoint.message}`;
      x = resolvedPoint.point.x;
      y = resolvedPoint.point.y;
      space = resolvedPoint.point.coordinateSpace;
    }
  }
  throwIfDesktopCancelled(signal);
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
  if (!result.startsWith('ERROR')) markDesktopWindowChanged(prep.window, 'window_scroll');
  return prep.hint && !result.startsWith('ERROR') ? `${result}\nNote: ${prep.hint}` : result;
}


export type DesktopWindowDragArgs = { from_x: number; from_y: number; to_x: number; to_y: number; steps?: number; coordinate_space?: DesktopCoordinateSpace; screenshot_id?: string; focus_first?: boolean; dispatch?: DesktopDispatchMode | string };


export async function desktopWindowDrag(
  selector: DesktopWindowSelector,
  args: DesktopWindowDragArgs,
  sessionId: string = '__reactor__',
  signal?: AbortSignal,
): Promise<string> {
  const dispatch = await resolveDesktopDispatch(args.dispatch);
  const target = await prepareWindowForBackground(selector, signal);
  if (dispatch.mode === 'background') {
    if (!target.ok) return desktopFailure(target.code, target.message, { selector });
    // Drags depend on real button-held mouse capture; posted messages are unreliable.
    return backgroundUnavailableFailure({ ok: false, backgroundUnavailable: true, reason: 'drag', detail: 'Drag-and-drop needs real mouse input.' }, target.window, 'drag');
  }
  const run = () => desktopWindowDragForeground(selector, args, sessionId, signal);
  const result = target.ok ? await withForegroundArbitration(target.window.handle, signal, run) : await run();
  return dispatch.note && !result.startsWith('ERROR') ? `${result}\nNote: ${dispatch.note}` : result;
}


export async function desktopWindowDragForeground(
  selector: DesktopWindowSelector,
  args: DesktopWindowDragArgs,
  sessionId: string = '__reactor__',
  signal?: AbortSignal,
): Promise<string> {
  const prep = await prepareWindowForInput(selector, signal, args.focus_first !== false);
  if (!prep.ok) return desktopFailure(prep.code, prep.message, { selector });
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
  throwIfDesktopCancelled(signal);
  const result = await desktopDrag(
    from.point.x, from.point.y, to.point.x, to.point.y,
    Number(args.steps || 20), undefined,
    `${from.point.sourceNote} -> ${to.point.sourceNote} [${shortWindowLabel(prep.window)}]`,
    { coordinateSpace: from.point.coordinateSpace },
  );
  if (!result.startsWith('ERROR')) markDesktopWindowChanged(prep.window, 'window_drag');
  return prep.hint && !result.startsWith('ERROR') ? `${result}\nNote: ${prep.hint}` : result;
}


/**
 * Single source of truth for the desktop tool name set. Used by the desktop
 * parity checks so the gateway definitions, the chat dispatch, and the
 * wrapper action map can never silently drift apart.
 */
export function getDesktopToolNames(): string[] {
  return getDesktopToolDefinitions().map((d: any) => d?.function?.name).filter(Boolean);
}


/** Public/model-facing desktop surface. Internal granular handlers stay available
 * through getDesktopToolDefinitions() for compatibility and dispatch parity. */
export function getDesktopModelToolDefinitions(): any[] {
  return getDesktopWrapperToolDefinitions();
}


export function getDesktopModelToolNames(): string[] {
  return getDesktopModelToolDefinitions().map((d: any) => d?.function?.name).filter(Boolean);
}


export function getDesktopInternalHandlerNames(): string[] {
  return getDesktopToolDefinitions()
    .map((d: any) => String(d?.function?.name || ''))
    .filter((name: string) => name && !DESKTOP_WRAPPER_TOOL_NAME_SET.has(name));
}


export function getDesktopToolDefinitions(): any[] {
  const definitions: any[] = [
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
        description:
          'Bring a matching window to foreground/focus and verify the active window afterward. Returns focused title, process, monitor, requested-app-active boolean, and screenshot_id/path when capture is enabled.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Partial window title or process name to focus' },
            include_screenshot: { type: 'boolean', description: 'Capture a verification screenshot after focus (default true)' },
          },
          additionalProperties: false,
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
            modifier: { type: 'string', enum: ['none', 'shift', 'ctrl', 'alt'], default: 'none', description: 'Default none. Rarely use shift/ctrl/alt, and only when the user explicitly wants a modified click such as Shift+click or Ctrl+click.' },
            verify: {
              type: 'string',
              enum: ['off', 'auto', 'strict'],
              description: 'Verification mode. Default is off for speed. Use auto/strict when you need before/after probe confirmation; strict always probes for confirmation.',
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
              description: 'Verification mode. Default is off for speed. Use auto/strict when you need before/after probe confirmation.',
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
            enable_accessibility: { type: 'boolean', description: 'Chromium/Electron apps (Codex, Claude, Teams, VS Code, Discord): add --force-renderer-accessibility=complete --enable-features=UiaProvider so the page is visible to accessibility actions. Close the running instance first; a second instance usually just hands off to the first.' },
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
              description: 'Verification mode. Default is off for speed. Use auto/strict when you need before/after probe confirmation.',
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
          'Click inside a specific window identified by window_id (preferred), window_handle, app_id, or title. Restores + focuses the window first, then clicks. With screenshot_id, omitted coordinate_space defaults to capture so normalized image pixels are scaled correctly; without screenshot_id it defaults to logical window-space. Prefer this over desktop_click when you know the target window.',
        parameters: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            window_id: { type: 'string', description: 'Stable window id (win_<handle>).' },
            window_handle: { type: 'number', description: 'Exact window handle (HWND).' },
            app_id: { type: 'string', description: 'Target app_id (resolves to its active/only window).' },
            title: { type: 'string', description: 'Partial window title/process name (least precise).' },
            x: { type: 'number', description: 'X coordinate in the declared/default coordinate space.' },
            y: { type: 'number', description: 'Y coordinate in the declared/default coordinate space.' },
            coordinate_space: { type: 'string', enum: ['window', 'capture', 'virtual', 'monitor'], description: 'Defaults to capture when screenshot_id is present; otherwise window.' },
            screenshot_id: { type: 'string', description: 'Required for capture space. Supplying it makes capture the default coordinate space.' },
            button: { type: 'string', enum: ['left', 'right'] },
            double_click: { type: 'boolean' },
            modifier: { type: 'string', enum: ['none', 'shift', 'ctrl', 'alt'], default: 'none', description: 'Default none. Only use shift/ctrl/alt when explicitly requested.' },
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
  definitions.push(
    {
      type: 'function',
      function: {
        name: 'desktop_locate_text',
        description: 'Locate visible text inside a fresh exact-window screenshot crop and return a confidence-scored capture-relative bounding box. Never guesses below the confidence threshold.',
        parameters: {
          type: 'object',
          required: ['screenshot_id', 'query'],
          properties: {
            screenshot_id: { type: 'string' },
            query: { type: 'string' },
            min_confidence: { type: 'number', minimum: 0.5, maximum: 0.98 },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_click_text',
        description: 'Locate visible text inside a fresh exact-window crop, reject low-confidence or ambiguous matches, click its center through the same screenshot anchor, and return a fresh full-window verification screenshot.',
        parameters: {
          type: 'object',
          required: ['screenshot_id', 'query'],
          properties: {
            screenshot_id: { type: 'string' },
            query: { type: 'string' },
            min_confidence: { type: 'number', minimum: 0.5, maximum: 0.98 },
            button: { type: 'string', enum: ['left', 'right'] },
            verify: { type: 'string', enum: ['off', 'auto', 'strict'] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_get_accessibility_state',
        description: 'Return a flat structured UI Automation snapshot with state_id, snapshot-scoped element_id values, bounds, and supported semantic patterns.',
        parameters: {
          type: 'object',
          properties: {
            window_token: { type: 'string' },
            window_id: { type: 'string' },
            window_handle: { type: 'number' },
            app_id: { type: 'string' },
            title: { type: 'string' },
            max_depth: { type: 'integer' },
            max_nodes: { type: 'integer' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_accessibility_action',
        description: 'Perform one semantic UIA action against an element from a fresh accessibility state.',
        parameters: {
          type: 'object',
          required: ['state_id', 'element_id', 'semantic_action'],
          properties: {
            state_id: { type: 'string' },
            element_id: { type: 'string' },
            semantic_action: { type: 'string', enum: ['invoke', 'set_value', 'select', 'toggle', 'expand', 'collapse', 'focus', 'secondary_action'] },
            value: { type: 'string' },
          },
        },
      },
    },
  );
  return [
    ...getDesktopWrapperToolDefinitions(),
    ...definitions.filter((definition: any) => !DESKTOP_WRAPPER_TOOL_NAME_SET.has(String(definition?.function?.name || ''))),
  ];
}
