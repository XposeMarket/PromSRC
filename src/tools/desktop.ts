/**
 * desktop.ts — ToolRegistry wrappers for desktop automation tools.
 *
 * Bridges the Gateway desktop-tools layer into the Reactor / background-task
 * ToolRegistry so that sub-agents and scheduled tasks can use desktop tools
 * without going through a live chat session.
 *
 * Phase 2 of the Prometheus feature expansion plan.
 */

import type { Tool } from './registry.js';
import type { ToolResult } from '../types.js';

// ─── Lazy imports ─────────────────────────────────────────────────────────────
// Desktop tools import heavy PS/OCR machinery; we import lazily so the
// registry can be constructed on any platform without hard-failing at import
// time.  Individual tool calls will throw an informative error on non-Windows.

async function dt() {
  return import('../gateway/desktop-tools.js');
}

// ─── Helper ───────────────────────────────────────────────────────────────────

const DESKTOP_SESSION = '__reactor__';

function ok(stdout: string): ToolResult {
  return { success: true, stdout };
}

function fail(error: string): ToolResult {
  return { success: false, error };
}

function wrapResult(raw: string): ToolResult {
  return raw.startsWith('ERROR') ? fail(raw) : ok(raw);
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const desktopScreenshotTool: Tool = {
  name: 'desktop_screenshot',
  description:
    'Capture desktop screenshot with OCR, monitor layout, and per-window monitor indices. ' +
    'Optional capture=all|primary or monitor_index for one display. Returns a screenshot_id for later capture-space clicks. Always call first for desktop tasks.',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: {
      capture: { type: 'string', enum: ['all', 'primary'], description: 'Virtual desktop vs primary only' },
      monitor_index: { type: 'integer', description: '0-based display to capture (overrides capture)' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopScreenshot, parseDesktopScreenshotToolArgs } = await dt();
      const opts = parseDesktopScreenshotToolArgs(args);
      return ok(await desktopScreenshot(DESKTOP_SESSION, opts));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopGetMonitorsTool: Tool = {
  name: 'desktop_get_monitors',
  description:
    'List connected monitors and virtual-desktop bounds (index, dimensions, top-left). ' +
    'Use on multi-monitor systems to choose correct monitor_index and coordinates.',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  execute: async (): Promise<ToolResult> => {
    try {
      const { desktopGetMonitorsSummary } = await dt();
      return ok(await desktopGetMonitorsSummary());
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopWindowScreenshotTool: Tool = {
  name: 'desktop_window_screenshot',
  description:
    'Capture only a specific app window (cropped from virtual desktop). ' +
    'Select by name, handle, or active=true. Optional focus_first and padding. Returns a screenshot_id usable with capture-space or window-space targeting.',
  schema: {
    name: 'Optional partial window title/process name',
    handle: 'Optional exact window handle (HWND)',
    active: 'true to capture current foreground window',
    focus_first: 'true to focus the target window before capture',
    padding: 'Extra pixels around the window bounds (default 8)',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      handle: { type: 'number' },
      active: { type: 'boolean' },
      focus_first: { type: 'boolean' },
      padding: { type: 'number' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopWindowScreenshot } = await dt();
      return wrapResult(
        await desktopWindowScreenshot(DESKTOP_SESSION, {
          name: args?.name == null ? undefined : String(args.name),
          handle: args?.handle == null ? undefined : Number(args.handle),
          active: args?.active === true,
          focus_first: args?.focus_first === true,
          padding: args?.padding == null ? undefined : Number(args.padding),
        }),
      );
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopFindWindowTool: Tool = {
  name: 'desktop_find_window',
  description: 'Find open windows by title or process name.',
  schema: {
    name: 'Partial window title or process name to search for',
  },
  jsonSchema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'Partial window title or process name' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopFindWindow } = await dt();
      return wrapResult(await desktopFindWindow(String(args?.name || '')));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopFocusWindowTool: Tool = {
  name: 'desktop_focus_window',
  description: 'Bring a matching window to foreground/focus.',
  schema: {
    name: 'Partial window title or process name to focus',
  },
  jsonSchema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'Partial window title or process name' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopFocusWindow } = await dt();
      return wrapResult(await desktopFocusWindow(String(args?.name || '')));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopClickTool: Tool = {
  name: 'desktop_click',
  description:
    'Perform an actual mouse click using virtual, monitor, capture, or window coordinates. When choosing a point from a screenshot, always pass that screenshot_id with coordinate_space="capture"; screenshots become stale after focus, wait, key, click, drag, scroll, or type actions.',
  schema: {
    x: 'Target X coordinate in the chosen coordinate space',
    y: 'Target Y coordinate in the chosen coordinate space',
    button: 'Mouse button: left or right (default left)',
    double_click: 'true to double-click instead of single-click',
    verify: 'Verification mode: off | auto | strict',
    coordinate_space: 'virtual | monitor | capture | window. Use capture with screenshot_id for image-pixel coordinates.',
    screenshot_id: 'Fresh screenshot anchor from desktop_screenshot or desktop_window_screenshot. Required for capture-space clicks.',
    window_name: 'Optional window name when using window-space coordinates',
    window_handle: 'Optional window handle when using window-space coordinates',
    monitor_relative: 'Legacy alias for coordinate_space="monitor"',
    monitor_index: 'Monitor index when using monitor coordinates',
  },
  jsonSchema: {
    type: 'object',
    required: ['x', 'y'],
    properties: {
      x: { type: 'number', description: 'Required X coordinate for the mouse click' },
      y: { type: 'number', description: 'Required Y coordinate for the mouse click' },
      button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button (default left)' },
      double_click: { type: 'boolean', description: 'Double-click flag' },
      modifier: { type: 'string', enum: ['shift', 'ctrl', 'alt'], description: 'Rare. Only use when the user explicitly wants a modified click like Shift+click or Ctrl+click' },
      verify: { type: 'string', enum: ['off', 'auto', 'strict'], description: 'Verification mode (default auto for capture/window, off otherwise)' },
      coordinate_space: { type: 'string', enum: ['virtual', 'monitor', 'capture', 'window'] },
      screenshot_id: { type: 'string', description: 'Screenshot ID returned by desktop_screenshot or desktop_window_screenshot' },
      window_name: { type: 'string', description: 'Optional target window name for window-space coordinates' },
      window_handle: { type: 'number', description: 'Optional target window handle for window-space coordinates' },
      monitor_relative: { type: 'boolean' },
      monitor_index: { type: 'integer' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const mod = await dt();
      const resolved = await mod.resolveDesktopActionPoint(DESKTOP_SESSION, {
        x: Number(args?.x),
        y: Number(args?.y),
        coordinate_space: args?.coordinate_space,
        screenshot_id: args?.screenshot_id == null ? undefined : String(args.screenshot_id),
        window_name: args?.window_name == null ? undefined : String(args.window_name),
        window_handle: args?.window_handle == null ? undefined : Number(args.window_handle),
        ...mod.parseDesktopPointerMonitorArgs(args),
      }, 'desktop_click');
      const result = !resolved.ok
        ? `ERROR: ${resolved.message}`
        : await mod.desktopClick(
            resolved.point.x,
            resolved.point.y,
            String(args?.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
            args?.double_click === true,
            undefined,
            args?.modifier === 'shift' || args?.modifier === 'ctrl' || args?.modifier === 'alt'
              ? args.modifier
              : undefined,
            resolved.point.sourceNote,
            {
              mode: args?.verify,
              coordinateSpace: resolved.point.coordinateSpace,
              allowRetryOnLikelyNoop: args?.verify === 'strict',
            },
          );
      return wrapResult(result);
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopDragTool: Tool = {
  name: 'desktop_drag',
  description: 'Drag from one point to another using virtual, monitor, capture, or window coordinates. When using screenshot pixels, pass a fresh screenshot_id with coordinate_space="capture".',
  schema: {
    from_x: 'Start X coordinate in the chosen coordinate space',
    from_y: 'Start Y coordinate in the chosen coordinate space',
    to_x: 'End X coordinate in the chosen coordinate space',
    to_y: 'End Y coordinate in the chosen coordinate space',
    steps: 'Interpolation steps (default 20)',
    verify: 'Verification mode: off | auto | strict',
    coordinate_space: 'virtual | monitor | capture | window',
    screenshot_id: 'Screenshot anchor from desktop_screenshot or desktop_window_screenshot',
    window_name: 'Optional window name when using window-space coordinates',
    window_handle: 'Optional window handle when using window-space coordinates',
  },
  jsonSchema: {
    type: 'object',
    required: ['from_x', 'from_y', 'to_x', 'to_y'],
    properties: {
      from_x: { type: 'number' },
      from_y: { type: 'number' },
      to_x: { type: 'number' },
      to_y: { type: 'number' },
      steps: { type: 'number', description: 'Interpolation steps (default 20)' },
      verify: { type: 'string', enum: ['off', 'auto', 'strict'], description: 'Verification mode (default auto for capture/window, off otherwise)' },
      coordinate_space: { type: 'string', enum: ['virtual', 'monitor', 'capture', 'window'] },
      screenshot_id: { type: 'string', description: 'Screenshot ID returned by desktop_screenshot or desktop_window_screenshot' },
      window_name: { type: 'string', description: 'Optional target window name for window-space coordinates' },
      window_handle: { type: 'number', description: 'Optional target window handle for window-space coordinates' },
      monitor_relative: { type: 'boolean' },
      monitor_index: { type: 'integer' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const mod = await dt();
      const sharedTarget = {
        coordinate_space: args?.coordinate_space,
        screenshot_id: args?.screenshot_id == null ? undefined : String(args.screenshot_id),
        window_name: args?.window_name == null ? undefined : String(args.window_name),
        window_handle: args?.window_handle == null ? undefined : Number(args.window_handle),
        ...mod.parseDesktopPointerMonitorArgs(args),
      };
      const fromPoint = await mod.resolveDesktopActionPoint(DESKTOP_SESSION, {
        x: Number(args?.from_x),
        y: Number(args?.from_y),
        ...sharedTarget,
      }, 'desktop_drag.from');
      const toPoint = fromPoint.ok
        ? await mod.resolveDesktopActionPoint(DESKTOP_SESSION, {
            x: Number(args?.to_x),
            y: Number(args?.to_y),
            ...sharedTarget,
          }, 'desktop_drag.to')
        : fromPoint;
      const result = !fromPoint.ok
        ? `ERROR: ${fromPoint.message}`
        : !toPoint.ok
          ? `ERROR: ${toPoint.message}`
          : await mod.desktopDrag(
              fromPoint.point.x,
              fromPoint.point.y,
              toPoint.point.x,
              toPoint.point.y,
              Number(args?.steps || 20),
              undefined,
              `${fromPoint.point.sourceNote} -> ${toPoint.point.sourceNote}`,
              {
                mode: args?.verify,
                coordinateSpace: fromPoint.point.coordinateSpace,
              },
            );
      return wrapResult(result);
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopScrollTool: Tool = {
  name: 'desktop_scroll',
  description:
    'Scroll the mouse wheel, optionally at a specific target point. ' +
    'Supports virtual, monitor, capture, or window-space targeting.',
  schema: {
    direction: 'Scroll direction: up, down, left, or right',
    amount: 'Wheel ticks (default 3)',
    x: 'Optional target X coordinate in the chosen coordinate space',
    y: 'Optional target Y coordinate in the chosen coordinate space',
    axis: 'Optional axis override: vertical or horizontal',
    verify: 'Verification mode: off | auto | strict',
    coordinate_space: 'virtual | monitor | capture | window',
    screenshot_id: 'Screenshot anchor from desktop_screenshot or desktop_window_screenshot',
    window_name: 'Optional window name when using window-space coordinates',
    window_handle: 'Optional window handle when using window-space coordinates',
  },
  jsonSchema: {
    type: 'object',
    required: ['direction'],
    properties: {
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
      amount: { type: 'number', description: 'Wheel ticks (default 3)' },
      x: { type: 'number', description: 'Optional target X coordinate' },
      y: { type: 'number', description: 'Optional target Y coordinate' },
      axis: { type: 'string', enum: ['vertical', 'horizontal'] },
      verify: { type: 'string', enum: ['off', 'auto', 'strict'], description: 'Verification mode (default auto for capture/window, off otherwise)' },
      coordinate_space: { type: 'string', enum: ['virtual', 'monitor', 'capture', 'window'] },
      screenshot_id: { type: 'string', description: 'Screenshot ID returned by desktop_screenshot or desktop_window_screenshot' },
      window_name: { type: 'string', description: 'Optional target window name for window-space coordinates' },
      window_handle: { type: 'number', description: 'Optional target window handle for window-space coordinates' },
      monitor_relative: { type: 'boolean' },
      monitor_index: { type: 'integer' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const mod = await dt();
      const dir = String(args?.direction || 'down').toLowerCase();
      const horizontal = String(args?.axis || '').toLowerCase() === 'horizontal' || dir === 'left' || dir === 'right';
      const hasTargetingArgs =
        args?.x !== undefined ||
        args?.y !== undefined ||
        args?.coordinate_space !== undefined ||
        args?.screenshot_id !== undefined ||
        args?.window_name !== undefined ||
        args?.window_handle !== undefined ||
        args?.monitor_relative === true ||
        args?.monitor_relative === 'true';
      let result: string;
      if (hasTargetingArgs) {
        if (args?.x === undefined || args?.y === undefined) {
          result = 'ERROR: desktop_scroll coordinate targeting requires both x and y.';
        } else {
          const resolved = await mod.resolveDesktopActionPoint(DESKTOP_SESSION, {
            x: Number(args.x),
            y: Number(args.y),
            coordinate_space: args?.coordinate_space,
            screenshot_id: args?.screenshot_id == null ? undefined : String(args.screenshot_id),
            window_name: args?.window_name == null ? undefined : String(args.window_name),
            window_handle: args?.window_handle == null ? undefined : Number(args.window_handle),
            ...mod.parseDesktopPointerMonitorArgs(args),
          }, 'desktop_scroll');
          result = !resolved.ok
            ? `ERROR: ${resolved.message}`
            : await mod.desktopScroll(
                dir === 'up' || dir === 'left' ? dir as 'up' | 'left' : (dir === 'right' ? 'right' : 'down'),
                Number(args?.amount || 3),
                resolved.point.x,
                resolved.point.y,
                horizontal,
                undefined,
                resolved.point.sourceNote,
                {
                  mode: args?.verify,
                  coordinateSpace: resolved.point.coordinateSpace,
                },
              );
        }
      } else {
        result = await mod.desktopScroll(
          dir === 'up' || dir === 'left' ? dir as 'up' | 'left' : (dir === 'right' ? 'right' : 'down'),
          Number(args?.amount || 3),
          undefined,
          undefined,
          horizontal,
          undefined,
          undefined,
          {
            mode: args?.verify,
          },
        );
      }
      return wrapResult(result);
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopWaitTool: Tool = {
  name: 'desktop_wait',
  description: 'Pause execution for a given number of milliseconds.',
  schema: {
    ms: 'Milliseconds to wait (50–30000, default 500)',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      ms: { type: 'number', description: 'Milliseconds to wait' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopWait } = await dt();
      return ok(await desktopWait(Number(args?.ms || 500)));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopTypeTool: Tool = {
  name: 'desktop_type',
  description:
    'Type text into the currently focused desktop window via clipboard paste. ' +
    'Focus the target window first with desktop_focus_window.',
  schema: {
    text: 'Text to type into the focused window',
  },
  jsonSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', description: 'Text to type' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopType } = await dt();
      return wrapResult(await desktopType(String(args?.text || '')));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopTypeRawTool: Tool = {
  name: 'desktop_type_raw',
  description:
    'Type text character-by-character using raw key events. ' +
    'Use when desktop_type clipboard paste is blocked by the app.',
  schema: {
    text: 'Text to type via raw key input',
  },
  jsonSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', description: 'Text to type (max 2000 chars)' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopTypeRaw } = await dt();
      return wrapResult(await desktopTypeRaw(String(args?.text || '')));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopPressKeyTool: Tool = {
  name: 'desktop_press_key',
  description:
    'Press a key or key combination in the focused window. ' +
    'Examples: Enter, Escape, Tab, Ctrl+C, Ctrl+V, Alt+Tab, F5.',
  schema: {
    key: 'Key or combo string, e.g. Enter, Ctrl+S, Alt+F4',
  },
  jsonSchema: {
    type: 'object',
    required: ['key'],
    properties: {
      key: { type: 'string', description: 'Key or combo string' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopPressKey } = await dt();
      return wrapResult(await desktopPressKey(String(args?.key || 'Enter')));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopGetClipboardTool: Tool = {
  name: 'desktop_get_clipboard',
  description: 'Read the current clipboard text content.',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  execute: async (): Promise<ToolResult> => {
    try {
      const { desktopGetClipboard } = await dt();
      return ok(await desktopGetClipboard());
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopSetClipboardTool: Tool = {
  name: 'desktop_set_clipboard',
  description: 'Write text, an image file, or a file list to the clipboard.',
  schema: {
    text: 'Text to place in clipboard',
    file_path: 'Single file path to place on clipboard. For a single image file in auto/image mode, native image data is copied.',
    file_paths: 'Array of file paths to place on clipboard as a Windows file-drop list',
    mode: 'auto | text | image | files. auto chooses image for one image file, otherwise files.',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Clipboard text' },
      file_path: { type: 'string', description: 'Single file path to copy to clipboard' },
      file_paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Multiple file paths to copy as a file-drop list',
      },
      mode: { type: 'string', enum: ['auto', 'text', 'image', 'files'] },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopSetClipboard } = await dt();
      return wrapResult(await desktopSetClipboard(args || {}));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

// ─── Phase 4: App launch / process control ────────────────────────────────────

export const desktopListInstalledAppsTool: Tool = {
  name: 'desktop_list_installed_apps',
  description:
    'List installed apps discovered from Start Menu shortcuts, Get-StartApps, App Paths, and common install paths. ' +
    'Returns stable app_id values for deterministic launches.',
  schema: {
    filter: 'Optional substring filter across app names, aliases, process hints, and window hints',
    limit: 'Max apps to return (default 40, max 200)',
    refresh: 'true to force a fresh Windows scan before listing',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: 'Optional filter string' },
      limit: { type: 'number', description: 'Max apps to return (default 40)' },
      refresh: { type: 'boolean', description: 'Force a fresh scan before listing' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopListInstalledApps } = await dt();
      return ok(await desktopListInstalledApps(
        String(args?.filter || ''),
        Number(args?.limit || 40),
        args?.refresh === true,
      ));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopFindInstalledAppTool: Tool = {
  name: 'desktop_find_installed_app',
  description:
    'Search installed apps by fuzzy name and return ranked matches with app_id values. ' +
    'Use this before desktop_launch_app for exact targeting.',
  schema: {
    query: 'Fuzzy app query such as claude, codex, vscode, or cursor',
    limit: 'Max ranked matches to return (default 10, max 50)',
    refresh: 'true to force a fresh Windows scan before searching',
  },
  jsonSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Fuzzy app query' },
      limit: { type: 'number', description: 'Max matches to return (default 10)' },
      refresh: { type: 'boolean', description: 'Force a fresh scan before searching' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopFindInstalledApp } = await dt();
      return wrapResult(await desktopFindInstalledApp(
        String(args?.query || ''),
        Number(args?.limit || 10),
        args?.refresh === true,
      ));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopLaunchAppTool: Tool = {
  name: 'desktop_launch_app',
  description:
    'Launch a desktop application and wait for its window to appear. ' +
    'Prefer app_id from desktop_find_installed_app or desktop_list_installed_apps for deterministic launches; app still accepts raw names and paths.',
  schema: {
    app_id: 'Stable installed-app ID returned by desktop_find_installed_app or desktop_list_installed_apps',
    app: 'Application name or full path (e.g. notepad, "C:\\\\path\\\\to\\\\app.exe")',
    args: 'Optional command-line arguments string',
    wait_ms: 'Max milliseconds to wait for window to appear (default 6000)',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      app_id: { type: 'string', description: 'Installed app ID' },
      app: { type: 'string', description: 'App name or path' },
      args: { type: 'string', description: 'Command-line arguments' },
      wait_ms: { type: 'number', description: 'Max wait ms for window (default 6000)' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopLaunchApp } = await dt();
      return wrapResult(
        await desktopLaunchApp(
          String(args?.app || ''),
          String(args?.args || ''),
          Number(args?.wait_ms || 6000),
          String(args?.app_id || ''),
        ),
      );
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopCloseAppTool: Tool = {
  name: 'desktop_close_app',
  description: 'Close a window or application by title/process name match.',
  schema: {
    name: 'Partial window title or process name to close',
    force: 'true to force-kill the process instead of graceful close',
  },
  jsonSchema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'Partial window title or process name' },
      force: { type: 'boolean', description: 'Force-kill the process' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopCloseApp } = await dt();
      return wrapResult(await desktopCloseApp(String(args?.name || ''), args?.force === true));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopGetProcessListTool: Tool = {
  name: 'desktop_get_process_list',
  description:
    'List all running processes that have visible windows, including their ' +
    'titles, process names, PIDs, and window handles.',
  schema: {
    filter: 'Optional partial name filter to narrow results',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: 'Optional partial name/title filter' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopGetProcessList } = await dt();
      return ok(await desktopGetProcessList(String(args?.filter || '')));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

// ─── Phase 3: Screenshot diffing ─────────────────────────────────────────────

export const desktopWaitForChangeTool: Tool = {
  name: 'desktop_wait_for_change',
  description:
    'Take a screenshot, then poll until the screen content changes or timeout is reached. ' +
    'Useful for waiting for a loading spinner to disappear or a dialog to appear.',
  schema: {
    timeout_ms: 'Max milliseconds to wait for any screen change (default 10000)',
    poll_ms: 'Polling interval in milliseconds (default 800)',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      timeout_ms: { type: 'number', description: 'Timeout in ms (default 10000)' },
      poll_ms: { type: 'number', description: 'Poll interval in ms (default 800)' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopWaitForChange } = await dt();
      return ok(
        await desktopWaitForChange(
          DESKTOP_SESSION,
          Number(args?.timeout_ms || 10000),
          Number(args?.poll_ms || 800),
        ),
      );
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopDiffScreenshotTool: Tool = {
  name: 'desktop_diff_screenshot',
  description:
    'Return a description of what changed between the last two desktop screenshots. ' +
    'Compares OCR text and window state. Call desktop_screenshot first to ensure a fresh snapshot.',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  execute: async (): Promise<ToolResult> => {
    try {
      const { desktopDiffScreenshot } = await dt();
      return ok(await desktopDiffScreenshot(DESKTOP_SESSION));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};


// ─── Exports ──────────────────────────────────────────────────────────────────

export const allDesktopTools: Tool[] = [
  // Core (Phase 2)
  desktopScreenshotTool,
  desktopGetMonitorsTool,
  desktopWindowScreenshotTool,
  desktopFindWindowTool,
  desktopFocusWindowTool,
  desktopClickTool,
  desktopDragTool,
  desktopScrollTool,
  desktopWaitTool,
  desktopTypeTool,
  desktopTypeRawTool,
  desktopPressKeyTool,
  desktopGetClipboardTool,
  desktopSetClipboardTool,
  desktopListInstalledAppsTool,
  desktopFindInstalledAppTool,
  // App launch / process control (Phase 4)
  desktopLaunchAppTool,
  desktopCloseAppTool,
  desktopGetProcessListTool,
  // Screenshot diffing (Phase 3)
  desktopWaitForChangeTool,
  desktopDiffScreenshotTool,
];
