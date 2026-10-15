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

  if (DELEGATE_TO_BACKEND) {
    return getPlatformDesktopBackend().getAccessibilityTree({
      windowName: windowName && String(windowName).trim() ? String(windowName).trim() : undefined,
      depth: safeDepth,
      maxNodes: safeMax,
    });
  }

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

# One cross-process round trip per node via CacheRequest.
$AE = [System.Windows.Automation.AutomationElement]
$cr = New-Object System.Windows.Automation.CacheRequest
$cr.TreeFilter = [System.Windows.Automation.Automation]::ControlViewCondition
foreach ($p in @($AE::NameProperty, $AE::ControlTypeProperty, $AE::IsEnabledProperty, $AE::HasKeyboardFocusProperty, $AE::BoundingRectangleProperty)) { $cr.Add($p) }
$treeWalker = New-Object System.Windows.Automation.TreeWalker ([System.Windows.Automation.Automation]::ControlViewCondition)

function Get-UiaTree {
  param($element, $depth)
  if ($depth -gt $maxDepth) { return $null }
  if ($script:nodeCount -ge $maxNodes) { return $null }
  $script:nodeCount++
  try {
    $name = $element.Cached.Name
    $ctrl = $element.Cached.ControlType
    $enabled = $element.Cached.IsEnabled
    $focused = $element.Cached.HasKeyboardFocus
    $rect = $element.Cached.BoundingRectangle
    $ctrlName = if ($ctrl) { $ctrl.ProgrammaticName.Replace('ControlType.','') } else { 'Unknown' }
    $node = @{
      role = $ctrlName
      name = if ($name) { $name } else { '' }
      enabled = [bool]$enabled
      focused = [bool]$focused
      x = [int]$rect.X; y = [int]$rect.Y; w = [int]$rect.Width; h = [int]$rect.Height
      children = (New-Object System.Collections.ArrayList)
    }
    if ($depth -lt $maxDepth) {
      $child = $treeWalker.GetFirstChild($element, $cr)
      while ($child -ne $null -and $script:nodeCount -lt $maxNodes) {
        $childNode = Get-UiaTree $child ($depth + 1)
        if ($childNode) { [void]$node.children.Add($childNode) }
        $child = $treeWalker.GetNextSibling($child, $cr)
      }
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
  $root = $root.GetUpdatedCache($cr)
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


// ─── Structured UI Automation state + semantic actions ──────────────────────

export interface DesktopAccessibilityNode {
  elementId: string;
  index: number;
  parentIndex: number | null;
  depth: number;
  runtimeId: string;
  role: string;
  name: string;
  automationId: string;
  className: string;
  enabled: boolean;
  focused: boolean;
  offscreen: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  patterns: string[];
  value?: string;
}


export interface DesktopAccessibilitySnapshot {
  stateId: string;
  windowToken: string;
  windowId: string;
  handle: number;
  capturedAt: number;
  windowGeneration: number;
  accessibilityGeneration: number;
  nodes: DesktopAccessibilityNode[];
}


export const desktopAccessibilitySnapshots = new Map<string, DesktopAccessibilitySnapshot>();


export function pruneDesktopAccessibilitySnapshots(): void {
  const now = Date.now();
  const ttl = Math.max(5_000, Number(process.env.PROMETHEUS_DESKTOP_UIA_STATE_TTL_MS || 60_000));
  for (const [id, state] of desktopAccessibilitySnapshots) {
    if (now - state.capturedAt > ttl || desktopAccessibilitySnapshots.size > 80) {
      desktopAccessibilitySnapshots.delete(id);
    }
  }
}


/** Minimum UIA walk depth for Chromium/Electron windows (content sits ~9-11 deep). */
export const CHROMIUM_UIA_MIN_DEPTH = 14;


/**
 * Launch flags that make Chromium/Electron expose the full page through UI
 * Automation. Plain --force-renderer-accessibility is not enough on Electron 33:
 * the native UIA provider has to be enabled too.
 */
export const CHROMIUM_ACCESSIBILITY_FLAGS = '--force-renderer-accessibility=complete --enable-features=UiaProvider';


export const CHROMIUM_CHROME_ONLY_HINT =
  'Chromium/Electron app with its page hidden from UI Automation. Background clicks/typing/scroll by coordinates still work (they go to the render widget). '
  + 'For named accessibility targeting, relaunch the app with desktop_apps(action="launch_app", enable_accessibility=true) (restarts the app; some packaged apps ignore the flags).';


/** Append the Chromium accessibility flags to a launch argument string once. */
export function withChromiumAccessibilityArgs(args: string): string {
  const base = String(args || '').trim();
  if (/--force-renderer-accessibility/i.test(base)) return base;
  return [CHROMIUM_ACCESSIBILITY_FLAGS, base].filter(Boolean).join(' ');
}


/** Return flat, machine-readable UIA nodes with snapshot-scoped element IDs. */
export async function desktopGetAccessibilityState(
  selector: DesktopWindowSelector,
  maxDepth = 7,
  maxNodes = 500,
  signal?: AbortSignal,
  options: { cursor?: number; limit?: number; compact?: boolean } = {},
): Promise<string> {
  ensureWindows();
  throwIfDesktopCancelled(signal);
  const resolved = await resolveCanonicalWindow({ ...selector, active: !selector.window_token && !selector.window_id && !selector.window_handle && !selector.app_id && !selector.title });
  if (!resolved.ok) return desktopFailure(resolved.code, resolved.message, { selector });
  const target = resolved.window;
  const safeDepth = Math.min(Math.max(Number(maxDepth) || 7, 1), 12);
  const safeMax = Math.min(Math.max(Number(maxNodes) || 500, 10), 1500);
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$maxDepth = ${safeDepth}
# Chromium/Electron nest page content ~9-11 levels below the frame, so the
# default depth would stop above every button and field.
$chromiumMinDepth = ${CHROMIUM_UIA_MIN_DEPTH}
$chromium = $false
$maxNodes = ${safeMax}
$nodes = New-Object System.Collections.ArrayList
$errors = New-Object System.Collections.ArrayList

function Convert-SafeInt($value, [string]$field, [int]$nodeIndex) {
  try {
    $number = [double]$value
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return $null }
    if ($number -gt [int]::MaxValue -or $number -lt [int]::MinValue) {
      [void]$errors.Add("node=$nodeIndex field=$field value_out_of_int32_range")
      return $null
    }
    return [int][Math]::Round($number)
  } catch {
    [void]$errors.Add("node=$nodeIndex field=$field conversion_failed")
    return $null
  }
}

# One cross-process round trip per node: every property and pattern-availability
# flag is fetched through a CacheRequest instead of ~12 separate UIA calls.
$AE = [System.Windows.Automation.AutomationElement]
$cr = New-Object System.Windows.Automation.CacheRequest
$cr.TreeFilter = [System.Windows.Automation.Automation]::ControlViewCondition
foreach ($p in @($AE::NameProperty, $AE::AutomationIdProperty, $AE::ClassNameProperty, $AE::ControlTypeProperty, $AE::IsEnabledProperty, $AE::HasKeyboardFocusProperty, $AE::IsOffscreenProperty, $AE::BoundingRectangleProperty, $AE::RuntimeIdProperty, $AE::IsInvokePatternAvailableProperty, $AE::IsValuePatternAvailableProperty, $AE::IsSelectionItemPatternAvailableProperty, $AE::IsTogglePatternAvailableProperty, $AE::IsExpandCollapsePatternAvailableProperty, [System.Windows.Automation.ValuePattern]::ValueProperty)) { $cr.Add($p) }
$walker = New-Object System.Windows.Automation.TreeWalker ([System.Windows.Automation.Automation]::ControlViewCondition)

function Get-Cached($element, $property, $fallback) {
  try {
    $v = $element.GetCachedPropertyValue($property, $true)
    if ($null -eq $v -or [object]::ReferenceEquals($v, $AE::NotSupported)) { return $fallback }
    return $v
  } catch { return $fallback }
}

function Add-UiaNode($element, [int]$parentIndex, [int]$depth) {
  if ($depth -gt $maxDepth -or $nodes.Count -ge $maxNodes) { return }
  try {
    $index = [int]$nodes.Count
    $current = $element.Cached
    $rect = $current.BoundingRectangle
    $runtime = ''
    try { $rid = Get-Cached $element $AE::RuntimeIdProperty $null; if ($rid) { $runtime = (($rid | ForEach-Object { [string]$_ }) -join '.') } } catch { }
    $patterns = New-Object System.Collections.ArrayList
    if ([bool](Get-Cached $element $AE::IsInvokePatternAvailableProperty $false)) { [void]$patterns.Add('invoke') }
    if ([bool](Get-Cached $element $AE::IsValuePatternAvailableProperty $false)) { [void]$patterns.Add('set_value') }
    if ([bool](Get-Cached $element $AE::IsSelectionItemPatternAvailableProperty $false)) { [void]$patterns.Add('select') }
    if ([bool](Get-Cached $element $AE::IsTogglePatternAvailableProperty $false)) { [void]$patterns.Add('toggle') }
    if ([bool](Get-Cached $element $AE::IsExpandCollapsePatternAvailableProperty $false)) { [void]$patterns.Add('expand_collapse') }
    $value = ''
    if ($patterns.Contains('set_value')) { $value = [string](Get-Cached $element ([System.Windows.Automation.ValuePattern]::ValueProperty) '') }
    $role = if ($current.ControlType) { $current.ControlType.ProgrammaticName.Replace('ControlType.','') } else { 'Unknown' }
    [void]$nodes.Add([ordered]@{
      index = $index
      parentIndex = if ($parentIndex -ge 0) { $parentIndex } else { $null }
      depth = $depth
      runtimeId = $runtime
      role = [string]$role
      name = [string]$current.Name
      automationId = [string]$current.AutomationId
      className = [string]$current.ClassName
      enabled = [bool]$current.IsEnabled
      focused = [bool]$current.HasKeyboardFocus
      offscreen = [bool]$current.IsOffscreen
      x = Convert-SafeInt $rect.X 'bounds.x' $index
      y = Convert-SafeInt $rect.Y 'bounds.y' $index
      width = Convert-SafeInt $rect.Width 'bounds.width' $index
      height = Convert-SafeInt $rect.Height 'bounds.height' $index
      patterns = @($patterns.ToArray())
      value = $value
    })
    if ($depth -ge $maxDepth) { return }
    $child = $walker.GetFirstChild($element, $cr)
    while ($child -ne $null -and $nodes.Count -lt $maxNodes) {
      Add-UiaNode $child $index ($depth + 1)
      $child = $walker.GetNextSibling($child, $cr)
    }
  } catch { [void]$errors.Add($_.Exception.Message) }
}

try {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([Int64]${Math.floor(target.handle)}))
  if (-not $root) { throw 'Could not resolve the target UI Automation root.' }
  $root = $root.GetUpdatedCache($cr)
  try { if ([string]$root.Cached.ClassName -like 'Chrome_WidgetWin*') { $chromium = $true; if ($maxDepth -lt $chromiumMinDepth) { $maxDepth = $chromiumMinDepth } } } catch { }
  Add-UiaNode $root -1 0
  [ordered]@{ ok = $true; chromium = $chromium; max_depth = $maxDepth; nodes = @($nodes.ToArray()); errors = @($errors.ToArray()); truncated = ($nodes.Count -ge $maxNodes) } | ConvertTo-Json -Compress -Depth 8
} catch {
  [ordered]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;
  let parsed: any;
  try {
    parsed = parseJsonMaybe(await runPowerShell(script, { timeoutMs: 25_000, sta: true, signal }));
  } catch (error: any) {
    if (isDesktopCancellationError(error) || error?.name === 'AbortError') return desktopFailure('DESKTOP_CANCELLED', 'Structured accessibility capture was interrupted.');
    return desktopFailure('ACCESSIBILITY_FAILED', `Structured accessibility capture failed: ${String(error?.message || error)}`, { window_token: createDesktopWindowToken(target) });
  }
  if (!parsed?.ok || !Array.isArray(parsed.nodes)) {
    const legacy = await desktopGetAccessibilityTree(target.title, Math.min(safeDepth, 7), Math.min(safeMax, 500)).catch(() => '');
    return JSON.stringify({ ok: true, mode: 'legacy_fallback', partial: true, structured_error: String(parsed?.error || 'Structured accessibility capture returned invalid data.'), window_token: createDesktopWindowToken(target), legacy_tree: legacy }, null, 2);
  }

  const nonce = crypto.randomBytes(5).toString('hex');
  const nodes: DesktopAccessibilityNode[] = parsed.nodes.map((node: any, index: number) => ({
    elementId: `uia_${nonce}_${index}`,
    index,
    parentIndex: node.parentIndex == null
      ? null
      : (Number.isFinite(Number(node.parentIndex)) ? Number(node.parentIndex) : null),
    depth: Number(node.depth) || 0,
    runtimeId: String(node.runtimeId || ''),
    role: String(node.role || 'Unknown'),
    name: String(node.name || ''),
    automationId: String(node.automationId || ''),
    className: String(node.className || ''),
    enabled: node.enabled === true,
    focused: node.focused === true,
    offscreen: node.offscreen === true,
    bounds: {
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      width: Math.max(0, Number(node.width) || 0),
      height: Math.max(0, Number(node.height) || 0),
    },
    patterns: Array.isArray(node.patterns) ? node.patterns.map(String) : [],
    ...(String(node.value || '') ? { value: String(node.value) } : {}),
  }));
  const stateId = `uia_state_${Date.now().toString(36)}_${nonce}`;
  const capturedGeneration = getDesktopWindowGeneration(target);
  const snapshot: DesktopAccessibilitySnapshot = {
    stateId,
    windowToken: createDesktopWindowToken(target),
    windowId: windowIdForHandle(target.handle),
    handle: target.handle,
    capturedAt: Date.now(),
    windowGeneration: capturedGeneration.visual,
    accessibilityGeneration: capturedGeneration.accessibility,
    nodes,
  };
  pruneDesktopAccessibilitySnapshots();
  desktopAccessibilitySnapshots.set(stateId, snapshot);
  const cursor = Math.max(0, Math.floor(Number(options.cursor) || 0));
  const pageLimit = clampInt(options.limit, 1, safeMax, options.compact === false ? safeMax : 100);
  const page = nodes.slice(cursor, cursor + pageLimit);
  const meaningfulNodes = nodes.filter((node) => {
    const role = node.role.toLowerCase();
    const name = node.name.trim().toLowerCase();
    if (role === 'window' || role === 'pane') return false;
    if (role === 'button' && ['minimize', 'maximize', 'restore', 'close'].includes(name)) return false;
    return !!name || node.patterns.length > 0;
  });
  const chromeOnly = nodes.length > 0 && meaningfulNodes.length === 0;
  return JSON.stringify({
    ok: true,
    state_id: stateId,
    captured_at: snapshot.capturedAt,
    window_id: snapshot.windowId,
    window_token: snapshot.windowToken,
    node_count: nodes.length,
    returned_count: page.length,
    cursor,
    next_cursor: cursor + page.length < nodes.length ? cursor + page.length : null,
    truncated: parsed.truncated === true,
    partial: Array.isArray(parsed.errors) && parsed.errors.length > 0,
    capture_errors: Array.isArray(parsed.errors) ? [...new Set(parsed.errors.map(String))].slice(0, 5) : [],
    surface_classification: chromeOnly ? 'chrome_only' : 'structured',
    ...(parsed.chromium === true ? { chromium: true, walked_depth: Number(parsed.max_depth) || safeDepth } : {}),
    ...(chromeOnly
      ? { routing_hint: parsed.chromium === true ? CHROMIUM_CHROME_ONLY_HINT : 'This app exposes only window chrome through UI Automation. Prefer a native screenshot plus OCR/text targeting; avoid a second full accessibility_tree probe.' }
      : {}),
    nodes: page.map((node) => options.compact !== false
      ? {
          element_id: node.elementId,
          role: node.role,
          ...(node.name ? { name: node.name } : {}),
          ...(node.automationId ? { automation_id: node.automationId } : {}),
          ...(node.patterns.length ? { patterns: node.patterns } : {}),
        }
      : {
          element_id: node.elementId,
          index: node.index,
          parent_index: node.parentIndex,
          depth: node.depth,
          role: node.role,
          name: node.name,
          automation_id: node.automationId,
          class_name: node.className,
          enabled: node.enabled,
          focused: node.focused,
          offscreen: node.offscreen,
          bounds: node.bounds,
          patterns: node.patterns,
          ...(node.value !== undefined ? { value: node.value } : {}),
        }),
  }, null, 2);
}


export type DesktopAccessibilityAction = 'invoke' | 'set_value' | 'select' | 'toggle' | 'expand' | 'collapse' | 'focus' | 'secondary_action';


/** Atomic semantic helper: capture, locate, act, and return a compact result in one call. */
export async function desktopAccessibilityFindAndAct(input: {
  selector: DesktopWindowSelector;
  name?: string;
  automation_id?: string;
  role?: string;
  match_mode?: 'exact' | 'contains';
  action: DesktopAccessibilityAction;
  value?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const captured = await desktopGetAccessibilityState(input.selector, 8, 800, input.signal, { compact: false, limit: 800 });
  let state: any;
  try { state = JSON.parse(captured); } catch { return captured; }
  if (!state?.ok || !state.state_id || !Array.isArray(state.nodes)) return captured;
  const name = String(input.name || '').trim().toLowerCase();
  const automationId = String(input.automation_id || '').trim().toLowerCase();
  const role = String(input.role || '').trim().toLowerCase();
  const textMatches = (actual: unknown, wanted: string) => {
    const normalized = String(actual || '').trim().toLowerCase();
    return !wanted || (input.match_mode === 'contains' ? normalized.includes(wanted) : normalized === wanted);
  };
  const matches = state.nodes.filter((node: any) =>
    textMatches(node.name, name)
    && (!automationId || String(node.automation_id || '').toLowerCase() === automationId)
    && (!role || String(node.role || '').toLowerCase() === role),
  );
  if (!matches.length) return desktopFailure('ELEMENT_NOT_FOUND', 'No accessibility element matched the supplied semantic selector.', { name: input.name, automation_id: input.automation_id, role: input.role });
  if (matches.length > 1) return desktopFailure('INVALID_ARGUMENT', 'Semantic selector matched multiple elements; add automation_id or role.', { match_count: matches.length, candidates: matches.slice(0, 8).map((node: any) => ({ name: node.name, automation_id: node.automation_id, role: node.role })) });
  let target = matches[0];
  const expectedPattern = input.action === 'expand' || input.action === 'collapse' ? 'expand_collapse' : input.action;
  if (input.action !== 'focus' && (!Array.isArray(target.patterns) || !target.patterns.includes(expectedPattern))) {
    // Chromium/Electron commonly exposes visible labels as Text descendants of
    // an actionable ListItem/Button. Walk upward before falling back to a
    // grounded center click on the visible text bounds.
    let parentIndex = target.parent_index;
    while (parentIndex != null) {
      const parent = state.nodes.find((candidate: any) => candidate.index === parentIndex);
      if (!parent) break;
      if (Array.isArray(parent.patterns) && parent.patterns.includes(expectedPattern)) {
        target = parent;
        break;
      }
      parentIndex = parent.parent_index;
    }
  }
  if (input.action === 'invoke' && (!Array.isArray(target.patterns) || !target.patterns.includes('invoke'))) {
    const bounds = target.bounds;
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const snapshot = desktopAccessibilitySnapshots.get(state.state_id);
      if (snapshot) {
        return desktopWindowClick(
          { window_token: snapshot.windowToken },
          { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, coordinate_space: 'virtual' },
          { verify: 'auto', signal: input.signal },
        );
      }
    }
  }
  return desktopAccessibilityAction({ state_id: state.state_id, element_id: target.element_id, action: input.action, value: input.value, signal: input.signal });
}


/** Act on a specific node from a fresh structured accessibility snapshot. */
export async function desktopAccessibilityAction(input: {
  state_id: string;
  element_id: string;
  action: DesktopAccessibilityAction;
  value?: string;
  signal?: AbortSignal;
}): Promise<string> {
  throwIfDesktopCancelled(input.signal);
  const stateId = String(input.state_id || '').trim();
  const elementId = String(input.element_id || '').trim();
  const action = String(input.action || '').trim().toLowerCase() as DesktopAccessibilityAction;
  const state = desktopAccessibilitySnapshots.get(stateId);
  if (!state) return desktopFailure('STATE_STALE', 'Unknown or expired accessibility state_id. Capture accessibility_state again.', { state_id: stateId });
  const ttl = Math.max(5_000, Number(process.env.PROMETHEUS_DESKTOP_UIA_STATE_TTL_MS || 60_000));
  const currentGeneration = getDesktopWindowGenerationByKey(state.windowToken);
  if (Date.now() - state.capturedAt > ttl || state.accessibilityGeneration !== currentGeneration.accessibility) {
    desktopAccessibilitySnapshots.delete(stateId);
    return desktopFailure('STATE_STALE', 'Accessibility state expired or the target window changed. Capture accessibility_state again.', {
      state_id: stateId,
      captured_accessibility_generation: state.accessibilityGeneration,
      current_accessibility_generation: currentGeneration.accessibility,
      invalidated_by: currentGeneration.lastReason,
    });
  }
  const node = state.nodes.find((candidate) => candidate.elementId === elementId);
  if (!node) return desktopFailure('ELEMENT_NOT_FOUND', 'element_id does not exist in the supplied accessibility state.', { state_id: stateId, element_id: elementId });
  if (!['invoke', 'set_value', 'select', 'toggle', 'expand', 'collapse', 'focus', 'secondary_action'].includes(action)) {
    return desktopFailure('INVALID_ARGUMENT', `Unsupported accessibility action "${action}".`, { action });
  }
  if (action === 'set_value' && input.value == null) {
    return desktopFailure('INVALID_ARGUMENT', 'set_value requires value.', { element_id: elementId });
  }

  const live = await resolveCanonicalWindow({ window_token: state.windowToken });
  if (!live.ok) return desktopFailure(live.code, live.message, { state_id: stateId, window_token: state.windowToken });

  if (action === 'secondary_action') {
    const centerX = node.bounds.x + node.bounds.width / 2 - (Number(live.window.left) || 0);
    const centerY = node.bounds.y + node.bounds.height / 2 - (Number(live.window.top) || 0);
    return desktopWindowClick(
      { window_token: state.windowToken },
      { x: centerX, y: centerY, coordinate_space: 'window' },
      { button: 'right', verify: 'auto', signal: input.signal },
    );
  }

  const expectedPattern = action === 'expand' || action === 'collapse' ? 'expand_collapse' : action;
  if (action !== 'focus' && !node.patterns.includes(expectedPattern)) {
    return desktopFailure('ACTION_UNSUPPORTED', `Element does not expose the ${expectedPattern} UIA pattern.`, {
      element_id: elementId,
      role: node.role,
      patterns: node.patterns,
    });
  }
  const runtimeId = psSingleQuote(node.runtimeId);
  const value = psSingleQuote(String(input.value ?? ''));
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$targetRuntimeId = '${runtimeId}'
$action = '${psSingleQuote(action)}'
$value = '${value}'
$found = $null
$visited = 0
function Find-Element($element) {
  if (-not $element -or $script:found -or $script:visited -ge 3000) { return }
  $script:visited++
  try {
    $rid = (($element.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '.')
    if ($rid -eq $targetRuntimeId) { $script:found = $element; return }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($element)
    while ($child -ne $null -and -not $script:found) {
      Find-Element $child
      $child = $walker.GetNextSibling($child)
    }
  } catch { }
}
try {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([Int64]${Math.floor(state.handle)}))
  Find-Element $root
  if (-not $found) { throw 'The UIA element no longer exists.' }
  if ($action -eq 'focus') {
    $found.SetFocus()
  } elseif ($action -eq 'invoke') {
    $pattern = $found.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
  } elseif ($action -eq 'set_value') {
    $pattern = $found.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $pattern.SetValue($value)
  } elseif ($action -eq 'select') {
    $pattern = $found.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $pattern.Select()
  } elseif ($action -eq 'toggle') {
    $pattern = $found.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $pattern.Toggle()
  } elseif ($action -eq 'expand' -or $action -eq 'collapse') {
    $pattern = $found.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($action -eq 'expand') { $pattern.Expand() } else { $pattern.Collapse() }
  }
  [ordered]@{ ok = $true; action = $action; visited = $visited } | ConvertTo-Json -Compress
} catch {
  [ordered]@{ ok = $false; error = $_.Exception.Message; action = $action; visited = $visited } | ConvertTo-Json -Compress
}
`;
  let parsed: any;
  let focusRestored: boolean | undefined;
  try {
    const runAction = async () => parseJsonMaybe(await runPowerShell(script, { timeoutMs: 20_000, sta: true, signal: input.signal }));
    if (defaultDesktopDispatch() === 'background') {
      // UIA invoke/toggle/select can make UWP apps activate themselves; give the
      // user's window back so semantic actions stay background like clicks do.
      const guarded = await guardUserForeground(Math.floor(state.handle), runAction, focusWindowHandle, { signal: input.signal });
      parsed = guarded.result;
      focusRestored = guarded.focusRestored;
    } else {
      parsed = await runAction();
    }
  } catch (error: any) {
    if (isDesktopCancellationError(error) || error?.name === 'AbortError') return desktopFailure('DESKTOP_CANCELLED', 'UI Automation action was interrupted.');
    return desktopFailure('ACCESSIBILITY_FAILED', String(error?.message || error), { state_id: stateId, element_id: elementId, action });
  }
  if (!parsed?.ok) {
    return desktopFailure(String(parsed?.error || '').includes('no longer exists') ? 'STATE_STALE' : 'ACTION_UNSUPPORTED', String(parsed?.error || 'UI Automation action failed.'), { state_id: stateId, element_id: elementId, action });
  }
  markDesktopStateChanged();
  markDesktopWindowChanged(live.window, `accessibility_${action}`, { visual: true, accessibility: true });
  desktopAccessibilitySnapshots.delete(stateId);
  return JSON.stringify({
    ok: true, action, state_id: stateId, element_id: elementId, element: { role: node.role, name: node.name }, visited: parsed.visited,
    ...(focusRestored === undefined ? {} : { focus_restored: focusRestored }),
  }, null, 2);
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
  signal?: AbortSignal,
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
    throwIfDesktopCancelled(signal);
    // Sample initial color
    const initialColor = (await runPowerShell(sampleScript(vx, vy), { timeoutMs: 5000 })).trim();
    const watchFor = targetColor
      ? String(targetColor).toUpperCase().replace(/^#?/, '#')
      : null;

    const deadline = Date.now() + safeTimeout;
    let iterations = 0;
    while (Date.now() < deadline) {
      await desktopAbortableDelay(safePoll, signal);
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
    if (isDesktopCancellationError(err)) return desktopFailure('DESKTOP_CANCELLED', 'Pixel watch was interrupted.');
    return `ERROR: desktop_pixel_watch failed: ${err.message}`;
  }
}
