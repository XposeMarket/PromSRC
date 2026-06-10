// ─── Win32Backend: Windows implementation of DesktopBackend ───────────────────
//
// Phase 0 of the macOS port. Wraps the existing inline-PowerShell primitives in
// desktop-tools.ts behind the DesktopBackend interface, with ZERO behavior
// change. Primitives are extracted incrementally; until a method is wired here,
// the public desktop_* functions keep calling the internals directly, so Windows
// stays fully working throughout the refactor.
//
// STATUS:
//   ✅ wired: gatherContext, enumerateMonitors, capture
//   ⏳ pending extraction: pointer, keyboard, clipboard, window, launch, a11y
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

/** Map the platform-neutral capture request onto the existing Win32 capture.
 *  Windows capture is DPI-aware (1:1 virtual coords), so devicePixelRatio = 1.0.
 *  `window` capture is not yet a Win32 primitive (windows are captured by region
 *  via the screenshot tools today); it is left to Phase B. */
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
        'Per-window capture is not yet exposed as a Win32 backend primitive (Phase B).',
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

  async capture(req: DesktopCaptureRequest): Promise<DesktopCaptureResult> {
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
  async launchApp(name: string): Promise<void> {
    await launchProcessInternal(name, '');
  }
  async getAccessibilityTree(opts: { windowName?: string; depth: number; maxNodes: number }): Promise<string> {
    return desktopGetAccessibilityTree(opts.windowName, opts.depth, opts.maxNodes);
  }

  async checkPermissions(): Promise<DesktopPermissionStatus[]> {
    // Windows requires no TCC-style grants; desktop automation works once the
    // process is running. desktop_doctor reports its own deeper health checks.
    return [{ name: 'Windows desktop automation', granted: true }];
  }
}
