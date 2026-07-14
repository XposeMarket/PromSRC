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
import {
  getDesktopWrapperToolDefinitions,
  normalizeDesktopWrapperTool,
} from '../gateway/desktop-wrappers.js';

// ─── Lazy imports ─────────────────────────────────────────────────────────────
// Desktop tools import heavy PS/OCR machinery; we import lazily so the
// registry can be constructed on any platform without hard-failing at import
// time.  Individual tool calls will throw an informative error on non-Windows.

async function dt() {
  return import('../gateway/desktop-tools.js');
}

async function bg() {
  return import('../gateway/desktop-background.js');
}

// ─── Helper ───────────────────────────────────────────────────────────────────

const DESKTOP_SESSION = '__reactor__';

function ok(stdout: string): ToolResult {
  return { success: true, stdout };
}

function okData(stdout: string, data: any): ToolResult {
  return { success: true, stdout, data };
}

function fail(error: string): ToolResult {
  return { success: false, error };
}

function wrapResult(raw: string): ToolResult {
  return raw.startsWith('ERROR') ? fail(raw) : ok(raw);
}

function windowSelector(args: any) {
  return {
    window_token: args?.window_token == null ? undefined : String(args.window_token),
    window_id: args?.window_id == null ? undefined : String(args.window_id),
    window_handle: args?.window_handle == null ? undefined : Number(args.window_handle),
    app_id: args?.app_id == null ? undefined : String(args.app_id),
    title: args?.title == null ? undefined : String(args.title),
  };
}

const windowSelectorSchema = {
  window_token: { type: 'string', description: 'Strong HWND+PID+process-start identity from fresh state; preferred.' },
  window_id: { type: 'string', description: 'Compatibility window id (win_<handle>).' },
  window_handle: { type: 'number', description: 'Exact native window handle.' },
  app_id: { type: 'string', description: 'Target app_id.' },
  title: { type: 'string', description: 'Partial window title/process name.' },
};

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
      region: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: 'Virtual-desktop crop [x1,y1,x2,y2], applied before normalization.' },
      mode: { type: 'string', enum: ['normal', 'som'], description: 'Use som to overlay numbered UI Automation elements and enable desktop_click(element=N).' },
      som: { type: 'boolean', description: 'Alias for mode="som".' },
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

export const desktopDoctorTool: Tool = {
  name: 'desktop_doctor',
  description: 'Fast desktop health check by default; pass deep=true for live screenshot, OCR, and UI Automation probes.',
  schema: { deep: 'Run expensive live screenshot/OCR/UI Automation probes (default false)' },
  jsonSchema: {
    type: 'object',
    properties: { deep: { type: 'boolean' } },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopDoctor } = await dt();
      return ok(await desktopDoctor(DESKTOP_SESSION, { deep: args?.deep === true }));
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
      ...windowSelectorSchema,
      name: { type: 'string' },
      handle: { type: 'number' },
      active: { type: 'boolean' },
      focus_first: { type: 'boolean' },
      padding: { type: 'number' },
      region: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: 'Window-relative crop [x1,y1,x2,y2], applied to the native window capture before normalization.' },
      mode: { type: 'string', enum: ['normal', 'som'] },
      som: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopWindowScreenshot } = await dt();
      return wrapResult(
        await desktopWindowScreenshot(DESKTOP_SESSION, {
          ...windowSelector(args),
          name: args?.name == null ? undefined : String(args.name),
          handle: args?.handle == null ? undefined : Number(args.handle),
          active: args?.active === true,
          focus_first: args?.focus_first == null ? undefined : args.focus_first === true,
          padding: args?.padding == null ? undefined : Number(args.padding),
          region: Array.isArray(args?.region) && args.region.length === 4
            ? args.region.map(Number) as [number, number, number, number]
            : undefined,
          mode: String(args?.mode || '').toLowerCase() === 'som' || args?.som === true ? 'som' : 'normal',
          som: args?.som === true || String(args?.mode || '').toLowerCase() === 'som',
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
    properties: {
      name: { type: 'string', description: 'Partial window title or process name' },
      title: { type: 'string' },
      app: { type: 'string' },
      query: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopFindWindow } = await dt();
      return wrapResult(await desktopFindWindow(String(args?.name || args?.title || args?.app || args?.query || '')));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopFocusWindowTool: Tool = {
  name: 'desktop_focus_window',
  description:
    'Bring a matching window to foreground/focus and verify the active window afterward. ' +
    'Returns focused window title, process name, monitor, requested-app-active boolean, and a screenshot_id/path when capture is enabled.',
  schema: {
    name: 'Partial window title or process name to focus',
    include_screenshot: 'Capture a verification screenshot after focus (default true)',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      ...windowSelectorSchema,
      name: { type: 'string', description: 'Partial window title or process name' },
      include_screenshot: { type: 'boolean', description: 'Capture a verification screenshot after focus (default true)' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopFocusWindowVerified, desktopFocusWindowCanonical } = await dt();
      if (args?.window_token || args?.window_id || args?.window_handle || args?.app_id || args?.title) {
        return wrapResult(await desktopFocusWindowCanonical(DESKTOP_SESSION, windowSelector(args), args?.include_screenshot !== false));
      }
      const verification = await desktopFocusWindowVerified(DESKTOP_SESSION, String(args?.name || ''), {
        includeScreenshot: args?.include_screenshot !== false,
      });
      if (!verification.ok) return fail(verification.message);
      return okData(verification.verification.summary, verification.verification);
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
    element: 'Numbered UI element from a SOM screenshot. Requires screenshot_id.',
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
    properties: {
      x: { type: 'number', description: 'X coordinate for the mouse click. Omit when using element.' },
      y: { type: 'number', description: 'Y coordinate for the mouse click. Omit when using element.' },
      element: { type: 'number', description: 'Numbered UI element from desktop_screenshot(mode="som") or desktop_window_screenshot(mode="som"). Requires screenshot_id.' },
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
        element: args?.element == null ? undefined : Number(args.element),
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
  description: 'Read bounded current clipboard text content, optionally filtered or metadata-only.',
  schema: { query: 'Optional matching-line query', max_chars: 'Maximum returned characters', head: 'First N characters', tail: 'Last N characters', metadata_only: 'Return presence/length only', include_length: 'Include total length' },
  jsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' }, max_chars: { type: 'integer' }, head: { type: 'integer' }, tail: { type: 'integer' },
      metadata_only: { type: 'boolean' }, include_length: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  execute: async (args): Promise<ToolResult> => {
    try {
      const { desktopGetClipboard } = await dt();
      return ok(await desktopGetClipboard(args || {}));
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
        args?.exact === true,
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
    properties: {
      name: { type: 'string', description: 'Partial window title or process name' },
      app: { type: 'string' },
      title: { type: 'string' },
      query: { type: 'string' },
      force: { type: 'boolean', description: 'Force-kill the process' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopCloseApp } = await dt();
      return wrapResult(await desktopCloseApp(String(args?.name || args?.app || args?.title || args?.query || ''), args?.force === true));
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

export const desktopBackgroundStatusTool: Tool = {
  name: 'desktop_background_status',
  description:
    'Explain whether non-interrupting background desktop automation is available on this machine. ' +
    'Checks the sandbox/VM bridge and reports why normal host desktop tools are foreground-only.',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  execute: async (): Promise<ToolResult> => {
    try {
      const { desktopBackgroundStatus } = await bg();
      return ok(await desktopBackgroundStatus());
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopBackgroundPrepareSandboxTool: Tool = {
  name: 'desktop_background_prepare_sandbox',
  description:
    'Create a Windows Sandbox profile and folder bridge for an isolated Prometheus desktop worker. ' +
    'Use launch=true to open the sandbox. Once the worker is running, desktop_background_command can drive that isolated desktop without stealing host mouse/keyboard focus.',
  schema: {
    launch: 'true to open the generated .wsb sandbox profile after preparing it',
    networking: 'enable | disable | default',
    vgpu: 'enable | disable | default',
    memory_mb: 'Memory assigned to Windows Sandbox in MB',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      launch: { type: 'boolean', description: 'Open Windows Sandbox after generating the profile.' },
      networking: { type: 'string', enum: ['enable', 'disable', 'default'] },
      vgpu: { type: 'string', enum: ['enable', 'disable', 'default'] },
      memory_mb: { type: 'number', description: 'Sandbox memory in MB (default 4096).' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopBackgroundPrepareSandbox } = await bg();
      return wrapResult(await desktopBackgroundPrepareSandbox({
        launch: args?.launch === true,
        networking: args?.networking,
        vgpu: args?.vgpu,
        memory_mb: args?.memory_mb == null ? undefined : Number(args.memory_mb),
      }));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopBackgroundCommandTool: Tool = {
  name: 'desktop_background_command',
  description:
    'Send a command to the isolated background desktop worker through the bridge. ' +
    'Supports window discovery/state/accessibility plus global or window-scoped input. This targets the sandbox/VM worker, not the host desktop.',
  schema: {
    action: 'screenshot | list_windows | get_window_state | accessibility_tree | click | window_click | type | window_type | key | window_key | run | wait',
    x: 'X coordinate for click inside the background desktop',
    y: 'Y coordinate for click inside the background desktop',
    text: 'Text for type action',
    key: 'SendKeys key string for key action, e.g. {ENTER} or ^s',
    command: 'Shell command for run action inside the background desktop',
    ms: 'Milliseconds for wait action',
    timeout_ms: 'Milliseconds to wait for worker response',
  },
  jsonSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['screenshot', 'list_windows', 'get_window_state', 'accessibility_tree', 'click', 'window_click', 'type', 'window_type', 'key', 'window_key', 'run', 'wait'] },
      window_id: { type: 'string' },
      title: { type: 'string' },
      filter: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      text: { type: 'string' },
      key: { type: 'string', description: 'PowerShell SendKeys syntax, e.g. {ENTER}, {TAB}, ^s.' },
      command: { type: 'string' },
      ms: { type: 'number' },
      timeout_ms: { type: 'number' },
      include_screenshot: { type: 'boolean' },
      include_text: { type: 'boolean' },
      max_depth: { type: 'integer' },
      max_nodes: { type: 'integer' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopBackgroundCommand } = await bg();
      return wrapResult(await desktopBackgroundCommand({
        action: args?.action,
        window_id: args?.window_id == null ? undefined : String(args.window_id),
        title: args?.title == null ? undefined : String(args.title),
        x: args?.x == null ? undefined : Number(args.x),
        y: args?.y == null ? undefined : Number(args.y),
        text: args?.text == null ? undefined : String(args.text),
        key: args?.key == null ? undefined : String(args.key),
        command: args?.command == null ? undefined : String(args.command),
        ms: args?.ms == null ? undefined : Number(args.ms),
        timeout_ms: args?.timeout_ms == null ? undefined : Number(args.timeout_ms),
        include_screenshot: args?.include_screenshot !== false,
        include_text: args?.include_text === true,
        max_depth: args?.max_depth == null ? undefined : Number(args.max_depth),
        max_nodes: args?.max_nodes == null ? undefined : Number(args.max_nodes),
      } as any));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};


// ─── Window control + introspection (registry sync) ───────────────────────────

export const desktopWindowControlTool: Tool = {
  name: 'desktop_window_control',
  description: 'Safely minimize, maximize, restore, or close a window via native Windows APIs. Prefer over clicking title-bar chrome.',
  schema: {},
  jsonSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      ...windowSelectorSchema,
      action: { type: 'string', enum: ['minimize', 'maximize', 'restore', 'close'] },
      name: { type: 'string', description: 'Partial window title or process name.' },
      handle: { type: 'number', description: 'Exact window handle (HWND).' },
      active: { type: 'boolean', description: 'Use the active window when no name/handle is supplied.' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopWindowControl } = await dt();
      const actionRaw = String(args?.action || '').toLowerCase();
      const action = actionRaw === 'minimize' || actionRaw === 'maximize' || actionRaw === 'restore' || actionRaw === 'close' ? actionRaw : 'restore';
      return wrapResult(await desktopWindowControl(action, {
        ...windowSelector(args),
        name: args?.name == null ? undefined : String(args.name),
        handle: args?.handle == null ? undefined : Number(args.handle),
        active: args?.active === true,
      }));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopGetWindowTextTool: Tool = {
  name: 'desktop_get_window_text',
  description: 'Extract readable text from a window via Windows UI Automation. More reliable than OCR for text-based UIs. Omit window_name for the active window.',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: { ...windowSelectorSchema, window_name: { type: 'string' } },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopGetWindowText, resolveCanonicalWindow } = await dt();
      let windowName = args?.window_name == null ? undefined : String(args.window_name);
      if (args?.window_token || args?.window_id || args?.window_handle || args?.app_id || args?.title) {
        const resolved = await resolveCanonicalWindow(windowSelector(args));
        if (!resolved.ok) return fail(`[${resolved.code}] ${resolved.message}`);
        windowName = resolved.window.title;
      }
      return wrapResult(await desktopGetWindowText(windowName));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopGetAccessibilityTreeTool: Tool = {
  name: 'desktop_get_accessibility_tree',
  description: 'Return the Windows UI Automation accessibility tree for a window (roles, names, enabled/focused state, bounds). Omit window_name for the active window.',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: {
      ...windowSelectorSchema,
      window_name: { type: 'string' },
      max_depth: { type: 'integer', description: '1-10, default 5.' },
      max_nodes: { type: 'integer', description: '10-1000, default 300.' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopGetAccessibilityTree, resolveCanonicalWindow } = await dt();
      let windowName = args?.window_name == null ? undefined : String(args.window_name);
      if (args?.window_token || args?.window_id || args?.window_handle || args?.app_id || args?.title) {
        const resolved = await resolveCanonicalWindow(windowSelector(args));
        if (!resolved.ok) return fail(`[${resolved.code}] ${resolved.message}`);
        windowName = resolved.window.title;
      }
      return wrapResult(await desktopGetAccessibilityTree(
        windowName,
        args?.max_depth == null ? undefined : Number(args.max_depth),
        args?.max_nodes == null ? undefined : Number(args.max_nodes),
      ));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopPixelWatchTool: Tool = {
  name: 'desktop_pixel_watch',
  description: 'Poll a virtual-screen pixel until its color changes (or matches target_color). Cheap alternative to polling full screenshots.',
  schema: {},
  jsonSchema: {
    type: 'object',
    required: ['x', 'y'],
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      target_color: { type: 'string', description: 'Optional hex color to wait FOR, e.g. "#00FF00".' },
      timeout_ms: { type: 'number' },
      poll_ms: { type: 'number' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopPixelWatch } = await dt();
      return wrapResult(await desktopPixelWatch(
        Number(args?.x),
        Number(args?.y),
        args?.target_color == null ? undefined : String(args.target_color),
        args?.timeout_ms == null ? undefined : Number(args.timeout_ms),
        args?.poll_ms == null ? undefined : Number(args.poll_ms),
      ));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopRecordMacroTool: Tool = {
  name: 'desktop_record_macro',
  description: 'Start recording a desktop macro. Subsequent click/type/press_key/scroll calls are captured. Call desktop_stop_macro to save.',
  schema: {},
  jsonSchema: {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' } },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopRecordMacro } = await dt();
      return wrapResult(desktopRecordMacro(String(args?.name || '')));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopStopMacroTool: Tool = {
  name: 'desktop_stop_macro',
  description: 'Stop the active macro recording and save it.',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Optional override name.' } },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopStopMacro } = await dt();
      return wrapResult(desktopStopMacro(args?.name == null ? undefined : String(args.name)));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopReplayMacroTool: Tool = {
  name: 'desktop_replay_macro',
  description: 'Replay a saved desktop macro. speed_multiplier scales playback speed (default 1.0).',
  schema: {},
  jsonSchema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      speed_multiplier: { type: 'number' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopReplayMacro } = await dt();
      return wrapResult(await desktopReplayMacro(String(args?.name || ''), args?.speed_multiplier == null ? undefined : Number(args.speed_multiplier)));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopListMacrosTool: Tool = {
  name: 'desktop_list_macros',
  description: 'List all saved desktop macros and their action counts.',
  schema: {},
  jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: async (): Promise<ToolResult> => {
    try {
      const { desktopListMacros } = await dt();
      return wrapResult(desktopListMacros());
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

// ─── Canonical app / window / state model (Phase 1) ───────────────────────────

export const desktopListAppsTool: Tool = {
  name: 'desktop_list_apps',
  description: 'List installed and running apps in the canonical model. Running apps first, each with open windows (window_id, handle, bounds, is_active). Returns app_id values for launches and window_id values for window-scoped tools.',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: {
      filter: { type: 'string' },
      include_windows: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopListApps } = await dt();
      return wrapResult(await desktopListApps(String(args?.filter || ''), args?.include_windows !== false, {
        scope: args?.scope,
        compact: args?.compact !== false,
        limit: args?.limit,
        cursor: args?.cursor,
      }));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopListWindowsTool: Tool = {
  name: 'desktop_list_windows',
  description: 'Flat list of open windows in the canonical model (window_id, handle, app_id, process_name, title, bounds, monitor_index, is_active).',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: {
      app_id: { type: 'string' },
      process_name: { type: 'string' },
      title: { type: 'string' },
      filter: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopListWindowsCanonical } = await dt();
      return wrapResult(await desktopListWindowsCanonical({
        app_id: args?.app_id == null ? undefined : String(args.app_id),
        process_name: args?.process_name == null ? undefined : String(args.process_name),
        title: args?.title == null ? undefined : String(args.title),
        filter: args?.filter == null ? undefined : String(args.filter),
      }));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopGetWindowStateTool: Tool = {
  name: 'desktop_get_window_state',
  description: 'Canonical snapshot of one window: metadata + optional screenshot (with reusable screenshot_id) + optional accessibility text. Identify by window_id (preferred), window_handle, app_id, or title.',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: {
      window_token: { type: 'string' },
      window_id: { type: 'string' },
      window_handle: { type: 'number' },
      app_id: { type: 'string' },
      title: { type: 'string' },
      include_screenshot: { type: 'boolean' },
      include_text: { type: 'boolean' },
      focus_first: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopGetWindowState } = await dt();
      return wrapResult(await desktopGetWindowState(DESKTOP_SESSION, {
        window_token: args?.window_token == null ? undefined : String(args.window_token),
        window_id: args?.window_id == null ? undefined : String(args.window_id),
        window_handle: args?.window_handle == null ? undefined : Number(args.window_handle),
        app_id: args?.app_id == null ? undefined : String(args.app_id),
        title: args?.title == null ? undefined : String(args.title),
        include_screenshot: args?.include_screenshot !== false,
        include_text: args?.include_text === true,
        focus_first: args?.focus_first === true,
      }));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopGetAccessibilityStateTool: Tool = {
  name: 'desktop_get_accessibility_state',
  description: 'Structured UIA snapshot with state_id, element_id values, bounds, and supported semantic patterns.',
  schema: {},
  jsonSchema: {
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
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopGetAccessibilityState } = await dt();
      return wrapResult(await desktopGetAccessibilityState(windowSelector(args), Number(args?.max_depth || 7), Number(args?.max_nodes || 500), undefined, { limit: args?.limit, cursor: args?.cursor, compact: args?.compact !== false }));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopAccessibilityActionTool: Tool = {
  name: 'desktop_accessibility_action',
  description: 'Perform a semantic UIA action against an element from a fresh accessibility snapshot.',
  schema: {},
  jsonSchema: {
    type: 'object',
    properties: {
      state_id: { type: 'string' },
      element_id: { type: 'string' },
      semantic_action: { type: 'string', enum: ['invoke', 'set_value', 'select', 'toggle', 'expand', 'collapse', 'focus', 'secondary_action'] },
      value: { type: 'string' },
      window_token: { type: 'string' },
      window_id: { type: 'string' },
      window_handle: { type: 'number' },
      app_id: { type: 'string' },
      title: { type: 'string' },
      element_name: { type: 'string' },
      automation_id: { type: 'string' },
      role: { type: 'string' },
      match_mode: { type: 'string', enum: ['exact', 'contains'] },
      atomic: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopAccessibilityAction, desktopAccessibilityFindAndAct } = await dt();
      if (args?.atomic === true || (args?.state_id == null && (args?.element_name != null || args?.automation_id != null))) {
        return wrapResult(await desktopAccessibilityFindAndAct({ selector: windowSelector(args), name: args?.element_name, automation_id: args?.automation_id, role: args?.role, match_mode: args?.match_mode, action: args?.semantic_action || 'invoke', value: args?.value }));
      }
      return wrapResult(await desktopAccessibilityAction({
        state_id: String(args?.state_id || ''),
        element_id: String(args?.element_id || ''),
        action: String(args?.semantic_action || '') as any,
        value: args?.value == null ? undefined : String(args.value),
      }));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

// ─── Window-scoped input (Phase 2) ─────────────────────────────────────────────

export const desktopLocateTextTool: Tool = {
  name: 'desktop_locate_text',
  description: 'Locate visible text within a fresh exact-window screenshot crop and return a confidence-scored capture-relative box.',
  schema: {},
  jsonSchema: {
    type: 'object',
    required: ['screenshot_id', 'query'],
    properties: {
      screenshot_id: { type: 'string' },
      query: { type: 'string' },
      min_confidence: { type: 'number', minimum: 0.5, maximum: 0.98 },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopLocateText } = await dt();
      return wrapResult(await desktopLocateText(DESKTOP_SESSION, {
        screenshot_id: String(args?.screenshot_id || ''),
        query: String(args?.query || ''),
        min_confidence: args?.min_confidence == null ? undefined : Number(args.min_confidence),
      }));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopClickTextTool: Tool = {
  name: 'desktop_click_text',
  description: 'Locate and click high-confidence visible text from an exact-window crop, then capture full-window verification evidence.',
  schema: {},
  jsonSchema: {
    type: 'object',
    required: ['screenshot_id', 'query'],
    properties: {
      screenshot_id: { type: 'string' },
      query: { type: 'string' },
      min_confidence: { type: 'number', minimum: 0.5, maximum: 0.98 },
      button: { type: 'string', enum: ['left', 'right'] },
      verify: { type: 'string', enum: ['off', 'auto', 'strict'] },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopClickText } = await dt();
      return wrapResult(await desktopClickText(DESKTOP_SESSION, {
        screenshot_id: String(args?.screenshot_id || ''),
        query: String(args?.query || ''),
        min_confidence: args?.min_confidence == null ? undefined : Number(args.min_confidence),
        button: String(args?.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
        verify: args?.verify,
      }));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopWindowClickTool: Tool = {
  name: 'desktop_window_click',
  description: 'Click inside a specific window (window_id preferred). Focuses the window first; coordinates default to window-space.',
  schema: {},
  jsonSchema: {
    type: 'object',
    required: ['x', 'y'],
    properties: {
      ...windowSelectorSchema,
      x: { type: 'number' },
      y: { type: 'number' },
      coordinate_space: { type: 'string', enum: ['window', 'capture', 'virtual', 'monitor'] },
      screenshot_id: { type: 'string' },
      button: { type: 'string', enum: ['left', 'right'] },
      double_click: { type: 'boolean' },
      modifier: { type: 'string', enum: ['shift', 'ctrl', 'alt'] },
      verify: { type: 'string', enum: ['off', 'auto', 'strict'] },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopWindowClick } = await dt();
      return wrapResult(await desktopWindowClick(
        windowSelector(args),
        {
          x: Number(args?.x),
          y: Number(args?.y),
          coordinate_space: args?.coordinate_space,
          screenshot_id: args?.screenshot_id == null ? undefined : String(args.screenshot_id),
        },
        {
          button: String(args?.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
          double_click: args?.double_click === true,
          modifier: args?.modifier === 'shift' || args?.modifier === 'ctrl' || args?.modifier === 'alt' ? args.modifier : undefined,
          verify: args?.verify,
        },
        DESKTOP_SESSION,
      ));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopWindowTypeTool: Tool = {
  name: 'desktop_window_type',
  description: 'Type text into a specific window (window_id preferred). Focuses first, then types via clipboard paste (raw=true for key events).',
  schema: {},
  jsonSchema: {
    type: 'object',
    required: ['text'],
    properties: { ...windowSelectorSchema, text: { type: 'string' }, raw: { type: 'boolean' } },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopWindowType } = await dt();
      return wrapResult(await desktopWindowType(windowSelector(args), String(args?.text || ''), args?.raw === true));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopWindowPressKeyTool: Tool = {
  name: 'desktop_window_press_key',
  description: 'Press a key/combo in a specific window (window_id preferred). Focuses first. Examples: Enter, Ctrl+S, Alt+Tab.',
  schema: {},
  jsonSchema: {
    type: 'object',
    required: ['key'],
    properties: { ...windowSelectorSchema, key: { type: 'string' } },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopWindowPressKey } = await dt();
      return wrapResult(await desktopWindowPressKey(windowSelector(args), String(args?.key || 'Enter')));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopWindowScrollTool: Tool = {
  name: 'desktop_window_scroll',
  description: 'Scroll inside a specific window (window_id preferred). Focuses first; provide x/y to position the cursor over the pane.',
  schema: {},
  jsonSchema: {
    type: 'object',
    required: ['direction'],
    properties: {
      ...windowSelectorSchema,
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
      amount: { type: 'number' },
      x: { type: 'number' },
      y: { type: 'number' },
      coordinate_space: { type: 'string', enum: ['window', 'capture', 'virtual', 'monitor'] },
      screenshot_id: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopWindowScroll } = await dt();
      const dir = String(args?.direction || 'down').toLowerCase();
      return wrapResult(await desktopWindowScroll(
        windowSelector(args),
        {
          direction: (dir === 'up' || dir === 'left' || dir === 'right' ? dir : 'down') as 'up' | 'down' | 'left' | 'right',
          amount: args?.amount == null ? undefined : Number(args.amount),
          x: args?.x == null ? undefined : Number(args.x),
          y: args?.y == null ? undefined : Number(args.y),
          coordinate_space: args?.coordinate_space,
          screenshot_id: args?.screenshot_id == null ? undefined : String(args.screenshot_id),
        },
        DESKTOP_SESSION,
      ));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopWindowDragTool: Tool = {
  name: 'desktop_window_drag',
  description: 'Drag between two points inside a specific window (window_id preferred). Focuses first; endpoints default to window-space.',
  schema: {},
  jsonSchema: {
    type: 'object',
    required: ['from_x', 'from_y', 'to_x', 'to_y'],
    properties: {
      ...windowSelectorSchema,
      from_x: { type: 'number' },
      from_y: { type: 'number' },
      to_x: { type: 'number' },
      to_y: { type: 'number' },
      steps: { type: 'number' },
      coordinate_space: { type: 'string', enum: ['window', 'capture', 'virtual', 'monitor'] },
      screenshot_id: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopWindowDrag } = await dt();
      return wrapResult(await desktopWindowDrag(
        windowSelector(args),
        {
          from_x: Number(args?.from_x),
          from_y: Number(args?.from_y),
          to_x: Number(args?.to_x),
          to_y: Number(args?.to_y),
          steps: args?.steps == null ? undefined : Number(args.steps),
          coordinate_space: args?.coordinate_space,
          screenshot_id: args?.screenshot_id == null ? undefined : String(args.screenshot_id),
        },
        DESKTOP_SESSION,
      ));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

// ─── Exports ──────────────────────────────────────────────────────────────────

export const allDesktopTools: Tool[] = [
  // Core (Phase 2)
  desktopDoctorTool,
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
  // Background desktop target (sandbox/VM bridge)
  desktopBackgroundStatusTool,
  desktopBackgroundPrepareSandboxTool,
  desktopBackgroundCommandTool,
  // Window control + introspection (registry sync)
  desktopWindowControlTool,
  desktopGetWindowTextTool,
  desktopGetAccessibilityTreeTool,
  desktopGetAccessibilityStateTool,
  desktopAccessibilityActionTool,
  desktopPixelWatchTool,
  desktopRecordMacroTool,
  desktopStopMacroTool,
  desktopReplayMacroTool,
  desktopListMacrosTool,
  // Canonical app / window / state model (Phase 1)
  desktopListAppsTool,
  desktopListWindowsTool,
  desktopGetWindowStateTool,
  desktopLocateTextTool,
  desktopClickTextTool,
  // Window-scoped input (Phase 2)
  desktopWindowClickTool,
  desktopWindowTypeTool,
  desktopWindowPressKeyTool,
  desktopWindowScrollTool,
  desktopWindowDragTool,
];

/**
 * Model-facing Reactor tools. These delegate to the granular compatibility
 * tools above, so Reactor/background agents use the same six-tool dialect as
 * the main gateway without duplicating desktop behavior.
 */
export const desktopWrapperTools: Tool[] = getDesktopWrapperToolDefinitions().map((definition: any) => {
  const fn = definition.function || {};
  const properties = fn.parameters?.properties || {};
  const schema = Object.fromEntries(
    Object.entries(properties).map(([key, value]: [string, any]) => [
      key,
      String(value?.description || (Array.isArray(value?.enum) ? value.enum.join(' | ') : value?.type || 'value')),
    ]),
  );
  return {
    name: String(fn.name || ''),
    description: String(fn.description || ''),
    schema,
    jsonSchema: fn.parameters || { type: 'object', properties: {} },
    execute: async (args: any): Promise<ToolResult> => {
      const normalized = normalizeDesktopWrapperTool(String(fn.name || ''), args);
      if (!normalized) return fail(`Unknown desktop wrapper: ${String(fn.name || '')}`);
      if (normalized.error) return fail(normalized.error);
      const target = allDesktopTools.find((tool) => tool.name === normalized.name);
      if (!target) return fail(`Desktop wrapper target is unavailable: ${normalized.name}`);
      return target.execute(normalized.args);
    },
  } satisfies Tool;
});
