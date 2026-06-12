// ─── DesktopBackend: cross-platform desktop automation contract ───────────────
//
// This is the single seam that makes Prometheus desktop tools dual-capable
// (Windows + macOS, Linux later). The 40+ `desktop_*` tools in desktop-tools.ts
// are thin orchestration — coordinate resolution, click-verification, macro
// recording, monitor math — written ONCE, above this interface. Everything that
// actually touches the OS bottoms out in the ~14 primitives below.
//
// Today (pre-refactor) those primitives are inline PowerShell inside
// desktop-tools.ts. Phase 0 extracts them into a Win32Backend implementing this
// interface, with ZERO behavior change. Phase A adds a DarwinBackend that drives
// an in-house Swift helper (`prometheus-desktop-helper`) over JSON-RPC.
//
// Design rules:
//   1. All coordinates crossing this boundary are LOGICAL units in the virtual
//      desktop space (Windows: virtual-screen pixels at DPI-aware 1:1; macOS:
//      logical points). The backend's capture() reports devicePixelRatio so the
//      orchestration layer can map screenshot pixels -> logical click points.
//      This is the Retina seam — get it right here, once, per backend.
//   2. Backends MUST NOT know about DesktopAdvisorPacket, screenshot_id, SOM
//      overlays, or click-verification. Those are orchestration concepts.
//   3. getAccessibilityTree() is OPTIONAL — a backend MAY throw
//      DesktopUnsupportedError. Callers (SOM, click-verify-by-tree, window-text)
//      must degrade gracefully (plain screenshot / pixel-diff fallback).
//
// See desktop-platform-win32.ts and desktop-platform-darwin.ts for implementations.

import type {
  DesktopWindowInfo,
  DesktopMonitorInfo,
} from './desktop-tools.js';

export type DesktopPlatformId = 'win32' | 'darwin' | 'linux';

/** Thrown by a backend when a primitive is not implemented on this platform.
 *  Callers should catch this and either degrade or surface a clean message —
 *  never a raw stack trace. */
export class DesktopUnsupportedError extends Error {
  readonly platform: DesktopPlatformId;
  readonly primitive: string;
  constructor(platform: DesktopPlatformId, primitive: string, hint?: string) {
    super(
      `Desktop primitive '${primitive}' is not supported on ${platform}.` +
        (hint ? ` ${hint}` : ''),
    );
    this.name = 'DesktopUnsupportedError';
    this.platform = platform;
    this.primitive = primitive;
  }
}

/** Full system context in one round-trip: displays, virtual bounds, windows. */
export interface DesktopContext {
  monitors: DesktopMonitorInfo[];
  virtualScreen: { left: number; top: number; width: number; height: number };
  windows: DesktopWindowInfo[];
  activeWindow: DesktopWindowInfo | null;
}

/** What to capture. `monitor` selects a 0-based display index. `window` selects
 *  a specific window by native handle (HWND / CGWindowID). `region` is an
 *  explicit virtual-coord rect (applied by the backend before transport). */
export type DesktopCaptureRequest =
  | { kind: 'all' }
  | { kind: 'primary' }
  | { kind: 'monitor'; index: number }
  | { kind: 'window'; handle: number }
  | { kind: 'region'; left: number; top: number; width: number; height: number };

/** Raw capture result. The PNG is physical pixels; `devicePixelRatio` and
 *  `bounds` (logical virtual-coord rect the image covers) are what the
 *  orchestration layer needs to map image pixels -> logical click points.
 *  On Windows (DPI-aware) devicePixelRatio is 1.0; on Retina it is typically 2.0
 *  and MAY differ per display in mixed setups. */
export interface DesktopCaptureResult {
  /** PNG bytes, physical resolution. */
  png: Buffer;
  /** Logical virtual-coord rect this image covers (click-space bounds). */
  bounds: { left: number; top: number; width: number; height: number };
  /** Physical pixels per logical point. 1.0 on non-Retina / DPI-aware Windows. */
  devicePixelRatio: number;
}

export type DesktopMouseButton = 'left' | 'right' | 'middle';
export type DesktopModifier = 'shift' | 'ctrl' | 'alt' | 'cmd';

/** A single key press in CANONICAL form — platform-neutral. The SendKeys-syntax
 *  parser (shared, above the backend) produces these; each backend emits them
 *  natively (Win32 -> SendKeys, Darwin -> CGEvent keycodes). */
export interface DesktopCanonicalKey {
  /** Logical key name, lowercase: 'enter', 'tab', 'escape', 'a', 'f5', 'left'… */
  key: string;
  modifiers: DesktopModifier[];
}

export type DesktopWindowAction = 'minimize' | 'maximize' | 'restore' | 'close';

export interface DesktopAppLaunchRequest {
  /** Human-facing app name, e.g. "Calculator". */
  name?: string;
  /** Absolute path to an app or executable. */
  path?: string;
  /** Stable bundle identifier on macOS, e.g. com.apple.calculator. */
  bundleId?: string;
}

/** The cross-platform primitive surface. ~14 methods. Implement once per OS. */
export interface DesktopBackend {
  readonly platform: DesktopPlatformId;

  // ── Context / capture ──────────────────────────────────────────────────────
  gatherContext(): Promise<DesktopContext>;
  enumerateMonitors(): Promise<DesktopMonitorInfo[]>;
  capture(req: DesktopCaptureRequest): Promise<DesktopCaptureResult>;

  // ── Pointer ────────────────────────────────────────────────────────────────
  /** Move the pointer to a logical virtual-coord point (no click). */
  movePointer(x: number, y: number): Promise<void>;
  /** Click at the current pointer location. `repeat` 2 = double-click. */
  click(button: DesktopMouseButton, repeat: number, modifiers: DesktopModifier[]): Promise<void>;
  /** Scroll at the current pointer location (logical wheel deltas). */
  scroll(deltaX: number, deltaY: number): Promise<void>;
  /** Press-drag-release from -> to in logical virtual coords. */
  drag(fromX: number, fromY: number, toX: number, toY: number, steps: number): Promise<void>;

  // ── Keyboard ───────────────────────────────────────────────────────────────
  typeText(text: string): Promise<void>;
  pressKey(key: DesktopCanonicalKey): Promise<void>;

  // ── Clipboard ────────────────────────────────────────────────────────────────
  getClipboard(): Promise<string>;
  setClipboard(text: string): Promise<void>;

  // ── Windows / apps ───────────────────────────────────────────────────────────
  focusWindow(handle: number): Promise<boolean>;
  windowControl(handle: number, action: DesktopWindowAction): Promise<void>;
  launchApp(request: DesktopAppLaunchRequest): Promise<void>;

  // ── Accessibility (OPTIONAL — may throw DesktopUnsupportedError) ──────────────
  /** Returns a text dump of the accessibility/UIA tree, depth- and node-bounded.
   *  Targets a window by name/title (empty = active window). Used by SOM overlays,
   *  window-text extraction, and tree-based click-verify. Backends without a11y
   *  support throw DesktopUnsupportedError; callers degrade. */
  getAccessibilityTree(opts: { windowName?: string; depth: number; maxNodes: number }): Promise<string>;

  // ── Health ───────────────────────────────────────────────────────────────────
  /** Platform permission/health probe for desktop_doctor. Each entry is one
   *  check (e.g. macOS "Screen Recording", "Accessibility"). MUST be safe to call
   *  before any permission is granted (do not trip ungranted probes). */
  checkPermissions(): Promise<DesktopPermissionStatus[]>;
}

export interface DesktopPermissionStatus {
  name: string;
  granted: boolean;
  /** How to fix when not granted (e.g. System Settings deep-link / instructions). */
  remedy?: string;
}

// ─── JSON-RPC wire protocol: prometheus-desktop-helper (macOS, in-house Swift) ──
//
// The DarwinBackend spawns ONE persistent Swift helper and talks newline-
// delimited JSON-RPC 2.0 over stdin/stdout. One process = one TCC permission
// identity (Screen Recording + Accessibility), no per-call spawn latency, DPR
// conversion owned in Swift. The helper is built in-house (SwiftPM, universal
// binary, vendored in bin/), signed under Prometheus's identity. Apple APIs:
// ScreenCaptureKit (capture), CGEvent (input), CGWindowList (enumerate),
// AXUIElement (focus/tree), NSPasteboard (clipboard), NSWorkspace (launch).
//
// This block is the CONTRACT the Swift side implements. Keep it in lockstep with
// the Swift request/response structs; snapshot-test the JSON shape.

/** Method names the helper understands. 1:1 with DesktopBackend primitives. */
export type HelperMethod =
  | 'gatherContext'
  | 'enumerateMonitors'
  | 'capture'
  | 'movePointer'
  | 'click'
  | 'scroll'
  | 'drag'
  | 'typeText'
  | 'pressKey'
  | 'getClipboard'
  | 'setClipboard'
  | 'focusWindow'
  | 'windowControl'
  | 'launchApp'
  | 'getAccessibilityTree'
  | 'checkPermissions'
  | 'ping';

export interface HelperRequest {
  jsonrpc: '2.0';
  id: number;
  method: HelperMethod;
  params?: Record<string, unknown>;
}

export interface HelperResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  /** Present on success. */
  result?: T;
  /** Present on failure. code -32601 = method not found; code 1 = unsupported
   *  primitive (-> DesktopUnsupportedError); code 2 = permission denied
   *  (surface remedy); code 3 = generic helper error. */
  error?: { code: number; message: string; data?: { remedy?: string } };
}

/** Binary capture payload note: `capture` returns PNG bytes base64-encoded in
 *  the JSON result (`pngBase64`) alongside `bounds` and `devicePixelRatio`. If
 *  capture payloads prove too large for the JSON channel, the helper MAY instead
 *  write the PNG to a temp path and return `pngPath`; the adapter reads + unlinks.
 *  Both shapes are allowed; the adapter handles whichever is present. */
export interface HelperCaptureResult {
  pngBase64?: string;
  pngPath?: string;
  bounds: { left: number; top: number; width: number; height: number };
  devicePixelRatio: number;
}
