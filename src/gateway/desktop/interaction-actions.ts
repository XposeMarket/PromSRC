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
import { execFileAsync, parseDesktopScreenshotToolArgs, parseDesktopPointerMonitorArgs, sessions, sessionHistory, DESKTOP_PACKET_TTL_MS, DESKTOP_SESSION_CACHE_LIMIT, DESKTOP_SCREENSHOT_FRESH_MS, desktopPacketIndex, desktopActionVersion, desktopWindowGenerations, DESKTOP_CONTEXT_CACHE_MS, desktopContextCache, markDesktopPerformance, DESKTOP_WINDOW_FRAME_CACHE_MS, desktopWindowFrameCache, desktopWindowGenerationKey, getDesktopWindowGeneration, getDesktopWindowGenerationByKey, markDesktopWindowChanged, makeDesktopScreenshotId, pruneDesktopPacketIndex, registerDesktopPacket, pruneDesktopSessionCaches, markDesktopStateChanged, validateDesktopPacketGeneration, desktopPacketAgeMs, describeFreshScreenshotRequirement, describeStaleScreenshotRequirement, describeDesktopWindowBounds, pointInsideDesktopWindow, sameDesktopWindowHandle, _macros, _macroRecord, clampInt, OCR_CHILD_SCRIPT, PLATFORM, getPlatformUnsupportedMessage, DELEGATE_TO_BACKEND, ensureWindows, getDesktopPlatformStatus, captureScreenshotMacOS, captureScreenshotLinux, psSingleQuote, runPowerShell, desktopPowerShellWarmupScheduled, scheduleDesktopPowerShellWarmup, win32HelperAtLeast, runPowerShellSpawned, parseJsonMaybe, normalizeWindows, PS_WINAPI_HEADER, PS_INPUTAPI_HEADER, PS_DPI_AWARE_HEADER } from './state.js';
import type { DesktopWindowInfo, DesktopSomElement, DesktopMonitorInfo, DesktopAdvisorPacket, DesktopFocusWindowVerification, DesktopScreenshotOptions, DesktopPointerMonitorOptions, DesktopCoordinateSpace, DesktopCoordinateTarget, DesktopResolvedActionPoint, DesktopVerificationMode, DesktopVerificationStatus, DesktopVerificationSignal, DesktopActionVerification, DesktopActionVerificationOptions, DesktopSessionState, SessionHistory, DesktopWindowGenerationRecord, DesktopPerformanceObserver, DesktopWindowFrameCacheEntry, MacroAction, PlatformId } from './state.js';
import { normalizeMonitors, normalizeVirtualScreen, normalizeDesktopContext, gatherDesktopContextInternal, desktopGetMonitors, desktopGetActiveMonitorIndex, desktopGetMonitorsSummary, desktopDoctor, listWindowsInternal, activeWindowInternal, getDesktopActiveWindowInfo, enumerateMonitorsInternal, parseScreenshotCaptureMode, captureScreenshotInternal, captureScreenshotViaHelper, findWindowsByName, focusWindowHandle, shortWindowLabel, compactWindowList, formatMonitorsForReply, resolveVirtualPointerCoords, normalizeCoordinateSpace, resolveDesktopWindowClickCoordinateSpace, getDesktopAdvisorPacketByIdInternal, getWindowByHandleFast, resolveWindowCoordinateBase, getDesktopAdvisorPacketById, desktopVisualOcrWorkerPromise, desktopVisualOcrQueue, desktopVisualOcrCache, normalizeDesktopVisualText, desktopVisualMatchScore, getDesktopVisualOcrWorker, recognizeDesktopVisualLines, locateDesktopTextInternal, desktopLocateText, desktopClickText } from './interaction-context.js';
import type { DesktopCaptureMode, DesktopVisualTextCandidate } from './interaction-context.js';
import { desktopListApps, desktopListWindowsCanonical, desktopGetWindowState, desktopFocusWindowCanonical, prepareWindowForBackground, backgroundWindowFingerprint, backgroundUnavailableFailure, runBackgroundWindowAction, withForegroundArbitration, prepareWindowForInput, inspectFocusedControl, desktopWindowClick, desktopWindowClickForeground } from './window-mid.js';
import type { DesktopFocusedControlEvidence, DesktopWindowClickOptions } from './window-mid.js';
import { desktopListMacros, desktopGetAccessibilityTree, desktopAccessibilitySnapshots, pruneDesktopAccessibilitySnapshots, CHROMIUM_UIA_MIN_DEPTH, CHROMIUM_ACCESSIBILITY_FLAGS, CHROMIUM_CHROME_ONLY_HINT, withChromiumAccessibilityArgs, desktopGetAccessibilityState, desktopAccessibilityFindAndAct, desktopAccessibilityAction, desktopPixelWatch } from './accessibility.js';
import type { DesktopAccessibilityNode, DesktopAccessibilitySnapshot, DesktopAccessibilityAction } from './accessibility.js';
import { desktopSendToTelegram, getDesktopAdvisorPacket, launchProcessInternal, resolveDarwinLaunchRequest, desktopLaunchApp, desktopCloseApp, desktopGetProcessList, summarizeInstalledAppLine, desktopListInstalledApps, desktopFindInstalledApp, desktopScreenshotWithHistory, desktopWaitForChange, desktopDiffScreenshot, desktopGetWindowText, desktopWindowScreenshot } from './apps.js';
import type { DarwinLaunchResolution, DesktopWindowScreenshotOptions } from './apps.js';



export function desktopCaptureRequiresPrecisionRecapture(packet: Pick<DesktopAdvisorPacket, 'width' | 'height' | 'targetWindow' | 'normalizedScreenshot'>): boolean {
  if (!packet.targetWindow) return false;
  const maxPixels = clampInt(process.env.PROMETHEUS_DESKTOP_MAX_CLICK_CAPTURE_PIXELS, 250_000, 8_000_000, 1_500_000);
  const pixels = Math.max(0, Number(packet.width) || 0) * Math.max(0, Number(packet.height) || 0);
  return !!packet.normalizedScreenshot || pixels > maxPixels;
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
    const packetGeneration = validateDesktopPacketGeneration(packet);
    if (!packetGeneration.ok) return { ok: false, message: `${label}: ${packetGeneration.message}` };
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
    const packetGeneration = validateDesktopPacketGeneration(packet);
    if (!packetGeneration.ok) return { ok: false, message: `${label}: ${packetGeneration.message}` };
  }

  if (coordinateSpace === 'capture') {
    if (!packet) {
      return {
        ok: false,
        message: `${label}: coordinate_space="capture" requires screenshot_id from desktop_screenshot or desktop_window_screenshot.`,
      };
    }
    if (!target.allow_broad_grounded && desktopCaptureRequiresPrecisionRecapture(packet)) {
      return {
        ok: false,
        message: `${label}: [PRECISION_CAPTURE_REQUIRED] Screenshot ${packet.screenshotId} is too broad or was downscaled (${packet.width}x${packet.height}) for a reliable exact-window click. Recapture the relevant sidebar, ribbon, toolbar, or panel with desktop_window(action="region_screenshot") and click from that fresh screenshot_id.`,
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
      // Window-scoped actions already identity-validate and focus the exact token
      // immediately before coordinate resolution. Reuse that live record instead
      // of paying for a second full desktop enumeration on every anchored click.
      const preparedWindow = target.prepared_window;
      let liveTarget: DesktopWindowInfo | null = null;
      if (preparedWindow && sameDesktopWindowHandle(preparedWindow, targetWindow)) {
        liveTarget = preparedWindow;
      } else if (!DELEGATE_TO_BACKEND) {
        liveTarget = await getWindowByHandleFast(targetWindow.handle);
      } else {
        const ctx = await gatherDesktopContextInternal();
        liveTarget = ctx.windows.find((w) => Number(w.handle) === Number(targetWindow.handle)) || null;
      }
      if (!liveTarget) {
        return { ok: false, message: `${label}: target window from screenshot is no longer visible. Capture a fresh desktop_window_screenshot.` };
      }
      if (Number(targetWindow.pid) && Number(liveTarget.pid) !== Number(targetWindow.pid)) {
        return { ok: false, message: `${label}: target window identity changed since screenshot. Capture fresh window state.` };
      }
      const targetStart = Math.floor(Number(targetWindow.processStartTime) || 0);
      const liveStart = Math.floor(Number(liveTarget.processStartTime) || 0);
      if (targetStart && liveStart !== targetStart) {
        return { ok: false, message: `${label}: target window process changed since screenshot. Capture fresh window state.` };
      }
      if (
        [targetWindow.left, targetWindow.top, targetWindow.width, targetWindow.height, liveTarget.left, liveTarget.top, liveTarget.width, liveTarget.height].every((n) => Number.isFinite(Number(n))) &&
        (Math.floor(Number(targetWindow.left)) !== Math.floor(Number(liveTarget.left)) ||
          Math.floor(Number(targetWindow.top)) !== Math.floor(Number(liveTarget.top)) ||
          Math.floor(Number(targetWindow.width)) !== Math.floor(Number(liveTarget.width)) ||
          Math.floor(Number(targetWindow.height)) !== Math.floor(Number(liveTarget.height)))
      ) {
        return {
          ok: false,
          message: `${label}: target window geometry changed since screenshot. Capture a fresh focused desktop_window_screenshot and use its screenshot_id.`,
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
    // macOS: background input doesn't require the window to be active (Hermes model).
    if (!DELEGATE_TO_BACKEND && !target.background_dispatch && !sameDesktopWindowHandle(ctx.activeWindow, liveTarget)) {
      return {
        ok: false,
        message: `${label}: target window is not active (${shortWindowLabel(ctx.activeWindow)} is active). Use desktop_window_screenshot with focus_first=true and the new screenshot_id before clicking.`,
      };
    }
    if (
      [packet.targetWindow.left, packet.targetWindow.top, packet.targetWindow.width, packet.targetWindow.height, liveTarget.left, liveTarget.top, liveTarget.width, liveTarget.height].every((n) => Number.isFinite(Number(n))) &&
      (Math.floor(Number(packet.targetWindow.left)) !== Math.floor(Number(liveTarget.left)) ||
        Math.floor(Number(packet.targetWindow.top)) !== Math.floor(Number(liveTarget.top)) ||
        Math.floor(Number(packet.targetWindow.width)) !== Math.floor(Number(liveTarget.width)) ||
        Math.floor(Number(packet.targetWindow.height)) !== Math.floor(Number(liveTarget.height)))
    ) {
      return {
        ok: false,
        message: `${label}: target window geometry changed since screenshot. Capture a fresh focused desktop_window_screenshot and use its screenshot_id.`,
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


export function computeContentHash(base64: string): string {
  return crypto.createHash('sha1').update(base64 || '').digest('hex');
}


export function createDesktopAdvisorPacket(input: {
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
  captureMode?: 'all' | 'primary' | 'monitor' | 'window';
  captureMonitorIndex?: number;
  activeMonitorIndex?: number | null;
  targetWindow?: DesktopWindowInfo;
  somElements?: DesktopSomElement[];
  actionVersion?: number;
  globalGeneration?: number;
  windowGeneration?: number;
  accessibilityGeneration?: number;
  generationReason?: string;
}): DesktopAdvisorPacket {
  const contentHash = computeContentHash(input.screenshotBase64);
  const scopedWindowGeneration = input.targetWindow ? getDesktopWindowGeneration(input.targetWindow) : null;
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
    globalGeneration: input.globalGeneration ?? desktopActionVersion,
    windowGeneration: input.windowGeneration ?? scopedWindowGeneration?.visual,
    accessibilityGeneration: input.accessibilityGeneration ?? scopedWindowGeneration?.accessibility,
    generationReason: input.generationReason ?? scopedWindowGeneration?.lastReason,
    windowToken: input.targetWindow ? createDesktopWindowToken(input.targetWindow) : undefined,
  };
}


export function storeDesktopPacket(sessionId: string, packet: DesktopAdvisorPacket): void {
  pruneDesktopSessionCaches(packet.capturedAt);
  sessions.set(sessionId, { lastPacket: packet });
  registerDesktopPacket(sessionId, packet);
  pruneDesktopSessionCaches(packet.capturedAt);
}


export interface DesktopVerificationSnapshot {
  path: string;
  width: number;
  height: number;
  region: { left: number; top: number; width: number; height: number };
  hash: string;
  activeWindow: DesktopWindowInfo | null;
}


export function computeBinaryHash(buffer: Buffer): string {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}


export function normalizedWindowHandle(windowInfo?: DesktopWindowInfo | null): number {
  const handle = Number(windowInfo?.handle || 0);
  return Number.isFinite(handle) ? Math.floor(handle) : 0;
}


export function resolvePreparedWindowPoint(
  windowInfo: DesktopWindowInfo,
  x: number,
  y: number,
  label: string,
): { ok: true; x: number; y: number; sourceNote: string } | { ok: false; message: string } {
  const xx = Math.floor(Number(x));
  const yy = Math.floor(Number(y));
  const left = Number(windowInfo.left);
  const top = Number(windowInfo.top);
  const width = Number(windowInfo.width);
  const height = Number(windowInfo.height);
  if (!Number.isFinite(xx) || !Number.isFinite(yy)) {
    return { ok: false, message: `${label}: x and y must be valid numbers.` };
  }
  if (![left, top, width, height].every(Number.isFinite) || width < 1 || height < 1) {
    return { ok: false, message: `${label}: target window bounds are unavailable for ${describeDesktopWindowBounds(windowInfo)}.` };
  }
  if (xx < 0 || yy < 0 || xx >= width || yy >= height) {
    return { ok: false, message: `${label}: window-space point (${xx}, ${yy}) is outside ${describeDesktopWindowBounds(windowInfo)}.` };
  }
  const vx = Math.floor(left) + xx;
  const vy = Math.floor(top) + yy;
  return {
    ok: true,
    x: vx,
    y: vy,
    sourceNote: `[window ${shortWindowLabel(windowInfo)} (${xx}, ${yy}) -> virtual (${vx}, ${vy})]`,
  };
}


export function normalizeOcrText(text?: string | null): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}


export function buildProbeRegionAroundPoint(
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


export async function captureDesktopVerificationSnapshot(
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


export function cleanupDesktopVerificationSnapshot(snapshot?: DesktopVerificationSnapshot | null): void {
  if (!snapshot?.path) return;
  try { fs.unlinkSync(snapshot.path); } catch {}
}


export function resolveDesktopVerificationMode(
  value: unknown,
  coordinateSpace?: DesktopCoordinateSpace,
): DesktopVerificationMode {
  if (value === false || value === 'false') return 'off';
  if (value === true || value === 'true') return 'strict';
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'auto' || raw === 'strict') return raw;
  // Fast default: screenshot/window-anchored desktop actions are already grounded
  // by the prior screenshot. Expensive before/after probes stay opt-in via
  // verify:"auto", verify:"strict", or verify:true.
  return 'off';
}


export async function desktopMovePointer(x: number, y: number, settleMs: number = 40): Promise<void> {
  const xx = Math.floor(Number(x));
  const yy = Math.floor(Number(y));
  if (DELEGATE_TO_BACKEND) {
    await getPlatformDesktopBackend().movePointer(xx, yy);
    return;
  }
  const helper = getWin32DesktopHelperClient();
  if (helper.available) {
    try {
      await helper.movePointer(xx, yy);
      const nativeWaitMs = Math.max(0, Math.min(1000, Math.floor(Number(settleMs) || 40)));
      if (nativeWaitMs > 0) await desktopAbortableDelay(nativeWaitMs);
      return;
    } catch {
      // Compatibility fallback for an unavailable/outdated helper.
    }
  }
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
  if (DELEGATE_TO_BACKEND) {
    const clicks = Math.max(1, Math.min(4, Math.floor(Number(repeat) || 1)));
    await getPlatformDesktopBackend().click(
      button === 'right' ? 'right' : 'left',
      clicks,
      modifier ? [modifier] : [],
    );
    return;
  }
  const helper = getWin32DesktopHelperClient();
  if (helper.available && !modifier) {
    try {
      await helper.clickCurrent(button, repeat);
      return;
    } catch {
      // Modifier input and old helper versions use the compatibility path.
    }
  }
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


export async function desktopPerformClickAt(
  x: number,
  y: number,
  button: 'left' | 'right',
  repeat: number,
  modifier?: 'shift' | 'ctrl' | 'alt',
  settleMs: number = 0,
  windowHandle?: number,
): Promise<void> {
  const xx = Math.floor(Number(x));
  const yy = Math.floor(Number(y));
  if (DELEGATE_TO_BACKEND) {
    await getPlatformDesktopBackend().movePointer(xx, yy);
    await getPlatformDesktopBackend().click(
      button === 'right' ? 'right' : 'left',
      Math.max(1, Math.min(4, Math.floor(Number(repeat) || 1))),
      modifier ? [modifier] : [],
    );
    return;
  }
  const helper = getWin32DesktopHelperClient();
  if (helper.available && !modifier) {
    try {
      if (Number.isFinite(Number(windowHandle)) && Number(windowHandle) > 0) {
        const focused = await helper.focusWindow(Number(windowHandle));
        if (!focused) throw new Error(`Could not activate window ${windowHandle} before click`);
      }
      if (settleMs > 0) {
        await helper.movePointer(xx, yy);
        await desktopAbortableDelay(Math.max(0, Math.min(1000, Math.floor(Number(settleMs) || 0))));
        await helper.clickCurrent(button, repeat);
      } else {
        await helper.clickAt(xx, yy, button, repeat);
      }
      return;
    } catch {
      // Compatibility fallback for an unavailable/outdated helper.
    }
  }
  const btn = button === 'right' ? 'right' : 'left';
  const downFlag = btn === 'right' ? '0x0008' : '0x0002';
  const upFlag = btn === 'right' ? '0x0010' : '0x0004';
  const clicks = Math.max(1, Math.min(4, Math.floor(Number(repeat) || 1)));
  const modVk = modifier === 'shift' ? '0x10' : modifier === 'ctrl' ? '0x11' : modifier === 'alt' ? '0x12' : null;
  const modDown = modVk ? `[PrometheusInputApi]::keybd_event(${modVk}, 0, 0, [UIntPtr]::Zero)` : '';
  const modUp = modVk ? `[PrometheusInputApi]::keybd_event(${modVk}, 0, 0x0002, [UIntPtr]::Zero)` : '';
  const waitMs = Math.max(0, Math.min(1000, Math.floor(Number(settleMs) || 0)));
  const script = `
${PS_DPI_AWARE_HEADER}
${PS_INPUTAPI_HEADER}
[void][PrometheusInputApi]::SetCursorPos(${xx}, ${yy})
${waitMs > 0 ? `Start-Sleep -Milliseconds ${waitMs}` : ''}
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
  if (DELEGATE_TO_BACKEND) {
    const d = Math.floor(Number(delta) || 0);
    await getPlatformDesktopBackend().scroll(horizontal ? d : 0, horizontal ? 0 : d);
    return;
  }
  const helper = getWin32DesktopHelperClient();
  if (helper.available) {
    try {
      const d = Math.floor(Number(delta) || 0);
      await helper.scrollCurrent(horizontal ? d : 0, horizontal ? 0 : d);
      return;
    } catch {
      // Compatibility fallback for an unavailable/outdated helper.
    }
  }
  const flag = horizontal ? '0x1000' : '0x0800';
  const script = `
${PS_DPI_AWARE_HEADER}
${PS_INPUTAPI_HEADER}
[PrometheusInputApi]::mouse_event(${flag}, 0, 0, [int]${Math.floor(Number(delta) || 0)}, [UIntPtr]::Zero)
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 4000 });
}



export async function desktopPerformScrollAt(
  x: number | undefined,
  y: number | undefined,
  delta: number,
  horizontal: boolean,
  settleMs: number = 0,
): Promise<void> {
  if (DELEGATE_TO_BACKEND) {
    if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
      await getPlatformDesktopBackend().movePointer(Math.floor(Number(x)), Math.floor(Number(y)));
    }
    await getPlatformDesktopBackend().scroll(horizontal ? Math.floor(Number(delta) || 0) : 0, horizontal ? 0 : Math.floor(Number(delta) || 0));
    return;
  }
  const helper = getWin32DesktopHelperClient();
  if (helper.available) {
    try {
      const d = Math.floor(Number(delta) || 0);
      const hasNativePoint = Number.isFinite(Number(x)) && Number.isFinite(Number(y));
      if (hasNativePoint) {
        const nativeX = Math.floor(Number(x));
        const nativeY = Math.floor(Number(y));
        if (settleMs > 0) {
          await helper.movePointer(nativeX, nativeY);
          await desktopAbortableDelay(Math.max(0, Math.min(1000, Math.floor(Number(settleMs) || 0))));
          await helper.scrollCurrent(horizontal ? d : 0, horizontal ? 0 : d);
        } else {
          await helper.scrollAt(nativeX, nativeY, horizontal ? d : 0, horizontal ? 0 : d);
        }
      } else {
        await helper.scrollCurrent(horizontal ? d : 0, horizontal ? 0 : d);
      }
      return;
    } catch {
      // Compatibility fallback for an unavailable/outdated helper.
    }
  }
  const flag = horizontal ? '0x1000' : '0x0800';
  const hasPoint = Number.isFinite(Number(x)) && Number.isFinite(Number(y));
  const xx = Math.floor(Number(x));
  const yy = Math.floor(Number(y));
  const waitMs = Math.max(0, Math.min(1000, Math.floor(Number(settleMs) || 0)));
  const script = `
${PS_DPI_AWARE_HEADER}
${PS_INPUTAPI_HEADER}
${hasPoint ? `[void][PrometheusInputApi]::SetCursorPos(${xx}, ${yy})` : ''}
${hasPoint && waitMs > 0 ? `Start-Sleep -Milliseconds ${waitMs}` : ''}
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
  if (DELEGATE_TO_BACKEND) {
    await getPlatformDesktopBackend().drag(fx, fy, tx, ty, st);
    return;
  }
  const helper = getWin32DesktopHelperClient();
  if (helper.available) {
    try {
      await helper.drag(fx, fy, tx, ty, st);
      return;
    } catch {
      // Compatibility fallback for an unavailable/outdated helper.
    }
  }
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


export async function loadSnapshotOcrText(snapshot: DesktopVerificationSnapshot | null | undefined): Promise<string> {
  if (!snapshot?.path) return '';
  const ocr = await runOcr(snapshot.path);
  return normalizeOcrText(ocr?.text);
}


export function formatDesktopVerification(
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


export function classifyDesktopVerification(args: {
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


export async function verifyDesktopAction(options: {
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
    // OCR is diagnostic evidence, not a prerequisite for ordinary pointer
    // verification. In auto mode an unchanged pixel hash used to launch two
    // OCR workers; an unavailable runtime could therefore add ~30 seconds to a
    // single click. Strict mode may use OCR unless a recent runtime failure has
    // opened the short circuit breaker.
    const recentOcrRuntimeFailure = lastOcrDiagnostic
      && (lastOcrDiagnostic.status === 'runtime_error' || lastOcrDiagnostic.status === 'child_process_error')
      && Date.now() - lastOcrDiagnostic.at < 5 * 60_000;
    const shouldCheckOcr = options.mode === 'strict' && !recentOcrRuntimeFailure;
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


export let lastOcrDiagnostic: { status: string; stage: string; error?: string; at: number } | null = null;


export async function runOcr(imagePath: string, timeoutOverrideMs?: number): Promise<{ text: string; confidence: number } | null> {
  try {
    const ocrEnabled = String(process.env.PROMETHEUS_DESKTOP_OCR || '1').trim() !== '0';
    if (!ocrEnabled) {
      lastOcrDiagnostic = { status: 'disabled', stage: 'configuration', at: Date.now() };
      return null;
    }
    const timeoutMs = timeoutOverrideMs == null
      ? clampInt(process.env.PROMETHEUS_OCR_TIMEOUT_MS, 1000, 120000, 15000)
      : clampInt(timeoutOverrideMs, 1000, 120000, 15000);
    const ocrCacheDir = path.join(
      process.env.PROMETHEUS_DATA_DIR ? path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus') : path.join(process.cwd(), '.prometheus'),
      'ocr-cache'
    );
    fs.mkdirSync(ocrCacheDir, { recursive: true });
    let tesseractEntry = '';
    try { tesseractEntry = pathToFileURL(require.resolve('tesseract.js')).href; } catch { /* child reports module_api */ }
    const { stdout } = await execFileAsync(
      process.execPath,
      ['-e', OCR_CHILD_SCRIPT, imagePath, tesseractEntry],
      {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        cwd: ocrCacheDir,
      },
    );
    const parsed = parseJsonMaybe(String(stdout || '').trim()) || {};
    if (parsed?.ok === false) {
      lastOcrDiagnostic = { status: 'runtime_error', stage: String(parsed.stage || 'unknown'), error: String(parsed.error || 'unknown OCR worker error').slice(0, 2000), at: Date.now() };
      return null;
    }
    const text = String(parsed?.text || '').trim();
    const confidence = Number(parsed?.confidence || 0) || 0;
    if (!text) {
      lastOcrDiagnostic = { status: 'available_no_text', stage: String(parsed.stage || 'recognize'), at: Date.now() };
      return null;
    }
    lastOcrDiagnostic = { status: 'available', stage: String(parsed.stage || 'recognize'), at: Date.now() };
    return { text: text.slice(0, 16000), confidence };
  } catch (error: any) {
    lastOcrDiagnostic = { status: 'child_process_error', stage: 'spawn_or_timeout', error: String(error?.stderr || error?.message || error).slice(0, 2000), at: Date.now() };
    return null;
  }
}


export function parseSomElementsFromAccessibilityTree(treeText: string, captureRegion: { left: number; top: number; width: number; height: number }): DesktopSomElement[] {
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


export async function renderSomOverlay(
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


export function formatSomElements(elements: DesktopSomElement[]): string {
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
  throwIfDesktopCancelled(options?.signal);
  let shot: Awaited<ReturnType<typeof captureScreenshotInternal>>;
  let ctx: DesktopContextGathered;
  try {
    const capMode = parseScreenshotCaptureMode(options);
    [ctx, shot] = await Promise.all([
      gatherDesktopContextInternal(options?.signal),
      captureScreenshotInternal(capMode, options?.region, options?.signal),
    ]);
  } catch (e: any) {
    if (isDesktopCancellationError(e) || e?.name === 'AbortError') return desktopFailure('DESKTOP_CANCELLED', 'Desktop screenshot was interrupted.');
    return `ERROR: ${e?.message || e}`;
  }

  const openWindows = ctx.windows;
  const activeWindow = ctx.activeWindow;
  throwIfDesktopCancelled(options?.signal);
  const ocr = options?.skipOcr === true ? null : await runOcr(shot.path);
  if (options?.signal?.aborted) {
    try { fs.unlinkSync(shot.path); } catch { /* best effort */ }
    return desktopFailure('DESKTOP_CANCELLED', 'Desktop screenshot was interrupted during OCR.');
  }

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

  const topWindows = compactWindowList(openWindows, 8);
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

  return [
    `Desktop screenshot captured (${imageWidth}x${imageHeight}${normalized?.normalized ? `, normalized from ${shot.width}x${shot.height}` : ''}).`,
    screenshotIdLine,
    captureSummary,
    virtualLine,
    formatMonitorsForReply(ctx.monitors),
    activeMonLine,
    coordHint,
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
  markDesktopWindowChanged(target, 'focus_window', { accessibility: true });
  return `Focused window: "${target.title}" (${target.processName}).`;
}


export async function writeDesktopFocusThumbnail(packet: DesktopAdvisorPacket): Promise<{ screenshotPath: string; thumbnailPath?: string } | null> {
  const ext = packet.screenshotMime === 'image/jpeg' ? 'jpg' : 'png';
  const basePath = path.join(os.tmpdir(), `prometheus-focus-${packet.screenshotId}.${ext}`);
  const buffer = Buffer.from(packet.screenshotBase64, 'base64');
  fs.writeFileSync(basePath, buffer);

  try {
    const image = await Jimp.read(buffer);
    image.scaleToFit(480, 320);
    const thumbnailPath = path.join(os.tmpdir(), `prometheus-focus-${packet.screenshotId}-thumb.${ext}`);
    await image.writeAsync(thumbnailPath);
    return { screenshotPath: basePath, thumbnailPath };
  } catch {
    return { screenshotPath: basePath };
  }
}


export function desktopWindowMatchesQuery(windowInfo: DesktopWindowInfo | null | undefined, query: string): boolean {
  const q = String(query || '').trim().toLowerCase();
  if (!windowInfo || !q) return false;
  return (
    String(windowInfo.title || '').toLowerCase().includes(q) ||
    String(windowInfo.processName || '').toLowerCase().includes(q) ||
    String(windowInfo.appDisplayName || '').toLowerCase().includes(q)
  );
}


export async function desktopFocusWindowVerified(
  sessionId: string,
  name: string,
  options?: { includeScreenshot?: boolean; skipOcr?: boolean },
): Promise<{ ok: true; verification: DesktopFocusWindowVerification } | { ok: false; message: string }> {
  ensureWindows();
  const query = String(name || '').trim();
  if (!query) return { ok: false, message: 'ERROR: name is required.' };

  const before = await listWindowsInternal();
  const matches = findWindowsByName(before, query);
  if (matches.length === 0) {
    return { ok: false, message: `ERROR: No window matching "${query}" found.` };
  }

  const target = matches[0];
  const focused = await focusWindowHandle(target.handle);
  if (!focused) {
    return { ok: false, message: `ERROR: Failed to focus "${target.title}" (${target.processName}).` };
  }

  markDesktopStateChanged();

  let after = await gatherDesktopContextInternal();
  let activeWindow = after.activeWindow;

  let screenshotId: string | undefined;
  let screenshotPath: string | undefined;
  let thumbnailPath: string | undefined;
  let screenshotWidth: number | undefined;
  let screenshotHeight: number | undefined;
  let screenshotObservation: string | undefined;

  if (options?.includeScreenshot !== false) {
    screenshotObservation = await desktopWindowScreenshot(sessionId, {
      handle: Number(activeWindow?.handle || target.handle),
      focus_first: false,
      padding: 8,
      skipOcr: options?.skipOcr === true,
    }).catch((e: any) => `ERROR: ${e?.message || e}`);
    const packet = getDesktopAdvisorPacket(sessionId);
    if (packet?.screenshotBase64) {
      screenshotId = packet.screenshotId;
      screenshotWidth = packet.width;
      screenshotHeight = packet.height;
      activeWindow = packet.activeWindow || activeWindow;
      after = await gatherDesktopContextInternal().catch(() => after);
      const saved = await writeDesktopFocusThumbnail(packet).catch(() => null);
      screenshotPath = saved?.screenshotPath;
      thumbnailPath = saved?.thumbnailPath;
    }
  }

  const finalActive = activeWindow || after.activeWindow;
  const requestedAppActive =
    sameDesktopWindowHandle(finalActive, target) ||
    desktopWindowMatchesQuery(finalActive, query);
  const activeMonitorIndex = Number(finalActive?.monitorIndex);
  const monitor =
    Number.isFinite(activeMonitorIndex) && activeMonitorIndex >= 0
      ? after.monitors.find((m) => m.index === Math.floor(activeMonitorIndex))
      : undefined;
  const summary = [
    `Focused window: "${target.title}" (${target.processName}).`,
    `Active afterward: ${shortWindowLabel(finalActive)}.`,
    `Requested app active: ${requestedAppActive ? 'yes' : 'no'}.`,
    monitor ? `Monitor: ${monitor.index} (${monitor.width}x${monitor.height} at ${monitor.left},${monitor.top}${monitor.primary ? ', primary' : ''}).` : 'Monitor: unknown.',
    screenshotId ? `Screenshot: ${screenshotId}${thumbnailPath ? ` thumbnail=${thumbnailPath}` : screenshotPath ? ` path=${screenshotPath}` : ''}.` : '',
  ].filter(Boolean).join('\n');

  return {
    ok: true,
    verification: {
      requestedName: query,
      focused,
      requestedAppActive,
      matchedWindow: target,
      activeWindow: finalActive,
      monitor,
      screenshotId,
      screenshotPath,
      thumbnailPath,
      screenshotWidth,
      screenshotHeight,
      summary,
      screenshotObservation,
    },
  };
}


export async function desktopWindowControl(
  action: 'minimize' | 'maximize' | 'restore' | 'close',
  selector?: DesktopWindowSelector & { name?: string; handle?: number },
): Promise<string> {
  ensureWindows();
  if (selector?.window_token || selector?.window_id || selector?.window_handle || selector?.app_id || selector?.title) {
    const resolved = await resolveCanonicalWindow({
      window_token: selector.window_token,
      window_id: selector.window_id,
      window_handle: selector.window_handle,
      app_id: selector.app_id,
      title: selector.title,
      active: selector.active,
    });
    if (!resolved.ok) return desktopFailure(resolved.code, resolved.message, { selector });
    const target = resolved.window;
    if (action !== 'minimize') {
      const focused = await focusWindowHandle(target.handle).catch(() => false);
      if (!focused) return desktopFailure('FOCUS_FAILED', `Could not focus ${shortWindowLabel(target)} before ${action}.`, { window_token: createDesktopWindowToken(target) });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    try {
      await windowControlInternal(target.handle, action);
      markDesktopStateChanged();
      markDesktopWindowChanged(target, `window_${action}`, { visual: true, accessibility: true, geometry: true });
      return `${action[0].toUpperCase()}${action.slice(1)} requested for "${target.title}" (${target.processName}, handle=${target.handle}).`;
    } catch (error: any) {
      return desktopFailure('WINDOW_ACTION_FAILED', `Failed to ${action} "${target.title}": ${String(error?.message || error)}`, { window_token: createDesktopWindowToken(target) });
    }
  }
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
    markDesktopStateChanged();
    markDesktopWindowChanged(target, `window_${action}`, { visual: true, accessibility: true, geometry: true });
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
  if (DELEGATE_TO_BACKEND) {
    await getPlatformDesktopBackend().windowControl(h, action);
    return;
  }
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
  // Never spray neighboring coordinates after an unchanged click. A no-op can
  // be a valid interaction (focus, selection, menu dismissal), and retrying at
  // +/-4px can activate an adjacent dense-toolbar control. Re-observation and
  // semantic re-grounding belong at the model/workflow layer.
  const attempts = [{ x: xx, y: yy }];
  let verificationSummary = '';
  let finalVerification: DesktopActionVerification | null = null;
  let finalX = xx;
  let finalY = yy;
  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const attempt = attempts[attemptIndex];
    finalX = attempt.x;
    finalY = attempt.y;
    if (verificationMode === 'off') {
      await desktopPerformClickAt(finalX, finalY, btn, repeat, modifier, 0, verificationOpts?.windowHandle);
      break;
    }
    await desktopMovePointer(finalX, finalY, 40);
    const verification = await verifyDesktopAction({
      action: 'click',
      mode: verificationMode,
      targetX: finalX,
      targetY: finalY,
      actionFn: () => desktopPerformClickAtCurrent(btn, repeat, modifier),
      afterSettleMs: 180,
    });
    finalVerification = verification;
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
  const monitors = verificationMode === 'off'
    ? [] as DesktopMonitorInfo[]
    : await enumerateMonitorsInternal().catch(() => [] as DesktopMonitorInfo[]);
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
  if (verificationMode === 'strict' && finalVerification?.status !== 'confirmed') {
    return `ERROR: [ACTION_NOT_CONFIRMED] Click was issued at (${finalX}, ${finalY}), but strict verification returned ${finalVerification?.status || 'unknown'} (${finalVerification?.summary || 'no confirmation evidence'}). Do not claim the requested UI action succeeded. Re-observe and identify the exact target; do not retry neighboring pixels.${sourceSuffix}`;
  }
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


export async function desktopWait(ms: number = 500, signal?: AbortSignal): Promise<string> {
  const waitMs = Math.max(50, Math.min(30000, Math.floor(Number(ms) || 500)));
  try {
    await desktopAbortableDelay(waitMs, signal);
  } catch (error) {
    if (isDesktopCancellationError(error)) return desktopFailure('DESKTOP_CANCELLED', 'Desktop wait was interrupted.');
    throw error;
  }
  return `Waited ${waitMs} ms.`;
}


/** Map a key spec ("ctrl+s", "enter") to SendKeys syntax. Delegates to the
 *  shared canonical-key model (desktop-keys.ts) so Windows and macOS share one
 *  parser and cannot drift apart. */
export function toSendKeysSpec(keyRaw: string): string {
  return canonicalKeyToSendKeys(parseCanonicalKey(keyRaw));
}


/** Type text via clipboard paste (set clipboard -> Ctrl+V -> restore clipboard).
 *  Extracted from desktopType so the Win32 DesktopBackend can wrap it. Caller
 *  handles length limits, macro recording, and return formatting. */
export async function typeTextInternal(payload: string): Promise<void> {
  if (DELEGATE_TO_BACKEND) {
    await getPlatformDesktopBackend().typeText(payload);
    return;
  }
  const helper = getWin32DesktopHelperClient();
  if (helper.available) {
    try {
      await helper.typeText(payload);
      return;
    } catch {
      // Compatibility fallback for an unavailable/outdated helper.
    }
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
  return `Typed ${payload.length} character(s).`;
}


export async function desktopPressKey(key: string): Promise<string> {
  const raw = String(key || '').trim();
  const parsedKey = parseCanonicalKey(raw);
  const modifierTokens = new Set(['ctrl', 'control', 'cmd', 'command', 'shift', 'alt', 'option']);
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && parts.slice(0, -1).some((part) => !modifierTokens.has(part.toLowerCase()))) {
    return desktopFailure('INVALID_ARGUMENT', `Composite text "${raw}" is not one key chord. Use desktop type for text, or send one named key/chord per call.`, {
      supplied: raw,
      normalized: parsedKey,
    });
  }
  ensureWindows();
  if (DELEGATE_TO_BACKEND) {
    await getPlatformDesktopBackend().pressKey(parsedKey);
  } else {
    const helper = getWin32DesktopHelperClient();
    if (helper.available) {
      try {
        await helper.pressKey(parsedKey.key || 'enter', parsedKey.modifiers);
      } catch {
        await pressSendKeysSpecInternal(toSendKeysSpec(key));
      }
    } else {
      await pressSendKeysSpecInternal(toSendKeysSpec(key));
    }
  }
  _macroRecord({ type: 'key', text: key });
  markDesktopStateChanged();
  return JSON.stringify({ ok: true, pressed: raw || 'Enter', normalized: parsedKey });
}


/** Raw clipboard text read (empty string if no text). Exported for Win32Backend. */
export async function getClipboardTextInternal(): Promise<string> {
  if (DELEGATE_TO_BACKEND) return getPlatformDesktopBackend().getClipboard();
  const fastHelper = await win32HelperAtLeast(5);
  if (fastHelper) {
    try {
      const result = await fastHelper.getClipboardText();
      return result.hasText ? result.text.trim() : '';
    } catch { /* PowerShell fallback */ }
  }
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
  if (DELEGATE_TO_BACKEND) {
    await getPlatformDesktopBackend().setClipboard(text);
    return;
  }
  const fastHelper = await win32HelperAtLeast(5);
  if (fastHelper) {
    try {
      await fastHelper.setClipboardText(text);
      return;
    } catch { /* PowerShell fallback */ }
  }
  const escaped = psSingleQuote(text);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText('${escaped}')
Write-Output "OK"
`;
  await runPowerShell(script, { timeoutMs: 6000, sta: true });
}


export async function desktopGetClipboard(options: {
  query?: string;
  max_chars?: number;
  head?: number;
  tail?: number;
  metadata_only?: boolean;
  include_length?: boolean;
} = {}): Promise<string> {
  ensureWindows();
  const out = await getClipboardTextInternal();
  if (!out) return 'Clipboard is empty.';
  const query = String(options.query || '').trim();
  const includeLength = options.include_length !== false;
  if (options.metadata_only === true) return `Clipboard contains text${includeLength ? ` (${out.length} chars)` : ''}.`;

  let selected = out;
  let label = 'Clipboard text';
  if (query) {
    const matching = out.split(/\r?\n/).filter((line) => line.toLowerCase().includes(query.toLowerCase()));
    selected = matching.join('\n');
    label = `Clipboard matches for "${query}"`;
    if (!selected) return `Clipboard has no text matching "${query}"${includeLength ? ` (${out.length} chars total)` : ''}.`;
  }
  const explicitHead = Number(options.head);
  const explicitTail = Number(options.tail);
  if (Number.isFinite(explicitHead) && explicitHead > 0) selected = selected.slice(0, Math.floor(explicitHead));
  if (Number.isFinite(explicitTail) && explicitTail > 0) selected = selected.slice(-Math.floor(explicitTail));
  const maxChars = clampInt(options.max_chars, 32, 20_000, 1_000);
  const truncated = selected.length > maxChars;
  const visible = truncated ? selected.slice(0, maxChars) : selected;
  return `${label}${includeLength ? ` (${out.length} chars total)` : ''}:\n${visible}${truncated ? '\n...(truncated; raise max_chars for more)' : ''}`;
}


export const CLIPBOARD_IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.tif', '.tiff',
]);


export type DesktopSetClipboardArgs =
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
  // Plain text with the default mode used to fall through to
  // 'Unsupported clipboard mode "auto"'.
  if (mode === 'auto' && !filePaths.length) effectiveMode = 'text';
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
  const performScroll = async (settleMs: number = 75): Promise<void> => {
    await desktopPerformScrollAt(mx, my, delta, horizontal, settleMs);
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
    await performScroll(0);
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
  signal?: AbortSignal,
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
      throwIfDesktopCancelled(signal);
      const waitMs = Math.round((action.delay - lastDelay) / speed);
      if (waitMs > 0) await desktopAbortableDelay(waitMs, signal);
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
  } catch (error) {
    if (isDesktopCancellationError(error)) return desktopFailure('DESKTOP_CANCELLED', `Macro "${macroName}" was interrupted.`);
    throw error;
  } finally {
    // Restore recording state if it was active before replay
    _activeRecordingName = wasRecording;
  }
  return `Macro "${macroName}" replayed — ${actions.length} action(s) at ${speed}× speed.`;
}




export let _activeRecordingName: string | null = null;

export let _recordingBuffer: MacroAction[] = [];

export let _recordingStartTime = 0;
