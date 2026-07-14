// ─── Win32Backend: Windows implementation of DesktopBackend ───────────────────
//
// Windows DesktopBackend. Capture and ordinary input share one persistent
// native helper; inline PowerShell remains a compatibility fallback.
//
// STATUS:
//   ✅ backend seam wired for context, monitor capture, pointer, keyboard,
//      clipboard, window control, launch, and accessibility
//   ✅ persistent native helper for WGC capture + SendInput focus/input
//   ↩ PowerShell/Win32 compatibility primitives remain as fallback
//
// The macOS counterpart is desktop-platform-darwin.ts (DarwinBackend), which
// drives the in-house Swift helper over the JSON-RPC protocol in
// desktop-backend.ts.

import { readFile, unlink } from 'fs/promises';

import type {
  DesktopBackend,
  DesktopContext,
  DesktopCaptureRequest,
  DesktopCaptureResult,
  DesktopMouseButton,
  DesktopModifier,
  DesktopCanonicalKey,
  DesktopWindowAction,
  DesktopPermissionStatus,
  DesktopAppLaunchRequest,
} from './desktop-backend.js';
import { DesktopUnsupportedError } from './desktop-backend.js';
import {
  gatherDesktopContextInternal,
  enumerateMonitorsInternal,
  captureScreenshotInternal,
  desktopMovePointer,
  desktopPerformClickAtCurrent,
  desktopPerformScrollAtCurrent,
  desktopPerformDragInternal,
  getClipboardTextInternal,
  setClipboardTextInternal,
  typeTextInternal,
  pressSendKeysSpecInternal,
  focusWindowHandle,
  windowControlInternal,
  launchProcessInternal,
  desktopGetAccessibilityTree,
  type DesktopMonitorInfo,
  type DesktopCaptureMode,
} from './desktop-tools.js';
import { canonicalKeyToSendKeys } from './desktop-keys.js';
import { getWin32DesktopHelperClient, resolveWin32DesktopHelperPath } from './desktop-platform-win32-helper.js';

/** Windows mouse_event supports left/right; middle is not a Win32 primitive
 *  today, so it falls back to left (matching prior tool behavior, which never
 *  offered middle-click). */
function toWin32Button(button: DesktopMouseButton): 'left' | 'right' {
  return button === 'right' ? 'right' : 'left';
}

/** The inline Win32 click primitive takes a single VK modifier (shift/ctrl/alt)
 *  and has no 'cmd'. Map the first applicable modifier; 'cmd' has no Windows
 *  equivalent and is dropped. */
function toWin32Modifier(modifiers: DesktopModifier[]): 'shift' | 'ctrl' | 'alt' | undefined {
  for (const m of modifiers) {
    if (m === 'shift' || m === 'ctrl' || m === 'alt') return m;
  }
  return undefined;
}

/** Map non-window capture requests onto the existing Win32 visible-screen
 * capture. Per-window capture routes through the persistent WGC helper. */
function toCaptureMode(req: DesktopCaptureRequest): {
  mode: DesktopCaptureMode;
  crop?: [number, number, number, number];
} {
  switch (req.kind) {
    case 'all':
      return { mode: { kind: 'all' } };
    case 'primary':
      return { mode: { kind: 'primary' } };
    case 'monitor':
      return { mode: { kind: 'monitor', index: req.index } };
    case 'region':
      return {
        mode: { kind: 'all' },
        crop: [req.left, req.top, req.left + req.width, req.top + req.height],
      };
    case 'window':
      throw new DesktopUnsupportedError(
        'win32',
        'capture(window)',
        'The Windows.Graphics.Capture helper is not installed.',
      );
  }
}

export class Win32Backend implements DesktopBackend {
  readonly platform = 'win32' as const;

  async gatherContext(): Promise<DesktopContext> {
    // DesktopContextGathered is structurally identical to DesktopContext.
    return gatherDesktopContextInternal();
  }

  async enumerateMonitors(): Promise<DesktopMonitorInfo[]> {
    return enumerateMonitorsInternal();
  }

  async capture(req: DesktopCaptureRequest, signal?: AbortSignal): Promise<DesktopCaptureResult> {
    if (req.kind === 'window') {
      const helper = getWin32DesktopHelperClient();
      if (!helper.available) {
        throw new DesktopUnsupportedError(
          'win32',
          'capture(window)',
          `Build or install the helper at ${resolveWin32DesktopHelperPath()}, or use the CopyFromScreen fallback.`,
        );
      }
      return helper.capture(req, signal);
    }
    const { mode, crop } = toCaptureMode(req);
    const shot = await captureScreenshotInternal(mode, crop);
    const png = await readFile(shot.path);
    // captureScreenshotInternal writes to a temp path; consumers historically
    // re-read it, but the backend owns the buffer now — clean up best-effort.
    await unlink(shot.path).catch(() => {});
    return {
      png,
      bounds: { left: shot.left, top: shot.top, width: shot.width, height: shot.height },
      devicePixelRatio: 1.0,
    };
  }

  async movePointer(x: number, y: number): Promise<void> {
    await desktopMovePointer(x, y);
  }

  async click(button: DesktopMouseButton, repeat: number, modifiers: DesktopModifier[]): Promise<void> {
    await desktopPerformClickAtCurrent(toWin32Button(button), repeat, toWin32Modifier(modifiers));
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    // Win32 scrolls one axis per mouse_event; emit vertical and/or horizontal.
    if (deltaY) await desktopPerformScrollAtCurrent(deltaY, false);
    if (deltaX) await desktopPerformScrollAtCurrent(deltaX, true);
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number, steps: number): Promise<void> {
    await desktopPerformDragInternal(fromX, fromY, toX, toY, steps);
  }

  async typeText(text: string): Promise<void> {
    await typeTextInternal(text);
  }
  async pressKey(key: DesktopCanonicalKey): Promise<void> {
    await pressSendKeysSpecInternal(canonicalKeyToSendKeys(key));
  }
  async getClipboard(): Promise<string> {
    return getClipboardTextInternal();
  }
  async setClipboard(text: string): Promise<void> {
    await setClipboardTextInternal(text);
  }
  async focusWindow(handle: number): Promise<boolean> {
    return focusWindowHandle(handle);
  }
  async windowControl(handle: number, action: DesktopWindowAction): Promise<void> {
    await windowControlInternal(handle, action);
  }
  async launchApp(request: DesktopAppLaunchRequest): Promise<void> {
    const target = String(request.path || request.name || '').trim();
    if (!target) {
      throw new Error('launchApp requires a name or path on Windows.');
    }
    await launchProcessInternal(target, '');
  }
  async getAccessibilityTree(opts: { windowName?: string; depth: number; maxNodes: number }): Promise<string> {
    return desktopGetAccessibilityTree(opts.windowName, opts.depth, opts.maxNodes);
  }

  async checkPermissions(): Promise<DesktopPermissionStatus[]> {
    // Windows requires no TCC-style grants; desktop automation works once the
    // process is running. desktop_doctor reports its own deeper health checks.
    const helper = getWin32DesktopHelperClient();
    return [
      { name: 'Windows desktop automation', granted: true },
      {
        name: 'Windows.Graphics.Capture helper',
        granted: helper.available,
        remedy: helper.available ? undefined : `Build/install ${resolveWin32DesktopHelperPath()} for occlusion-safe window capture.`,
      },
    ];
  }
}
