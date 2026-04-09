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
    'Optional capture=all|primary or monitor_index for one display. Always call first for desktop tasks.',
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
    'Select by name, handle, or active=true. Optional focus_first and padding.',
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
    'Click at Windows virtual-screen coordinates; optional monitor_relative + monitor_index for per-display coords.',
  schema: {
    x: 'Screen X coordinate in pixels',
    y: 'Screen Y coordinate in pixels',
    button: 'Mouse button: left or right (default left)',
    double_click: 'true to double-click instead of single-click',
  },
  jsonSchema: {
    type: 'object',
    required: ['x', 'y'],
    properties: {
      x: { type: 'number', description: 'Screen X coordinate' },
      y: { type: 'number', description: 'Screen Y coordinate' },
      button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button (default left)' },
      double_click: { type: 'boolean', description: 'Double-click flag' },
      modifier: { type: 'string', enum: ['shift', 'ctrl', 'alt'], description: 'Optional modifier key held during click' },
      monitor_relative: { type: 'boolean' },
      monitor_index: { type: 'integer' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopClick, parseDesktopPointerMonitorArgs } = await dt();
      const result = await desktopClick(
        Number(args?.x),
        Number(args?.y),
        String(args?.button || 'left').toLowerCase() === 'right' ? 'right' : 'left',
        args?.double_click === true,
        parseDesktopPointerMonitorArgs(args),
        args?.modifier === 'shift' || args?.modifier === 'ctrl' || args?.modifier === 'alt'
          ? args.modifier
          : undefined,
      );
      return wrapResult(result);
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

export const desktopDragTool: Tool = {
  name: 'desktop_drag',
  description: 'Drag the mouse from one screen coordinate to another.',
  schema: {
    from_x: 'Start X coordinate',
    from_y: 'Start Y coordinate',
    to_x: 'End X coordinate',
    to_y: 'End Y coordinate',
    steps: 'Interpolation steps (default 20)',
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
      monitor_relative: { type: 'boolean' },
      monitor_index: { type: 'integer' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopDrag, parseDesktopPointerMonitorArgs } = await dt();
      return wrapResult(
        await desktopDrag(
          Number(args?.from_x),
          Number(args?.from_y),
          Number(args?.to_x),
          Number(args?.to_y),
          Number(args?.steps || 20),
          parseDesktopPointerMonitorArgs(args),
        ),
      );
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
  description: 'Write text to the clipboard.',
  schema: {
    text: 'Text to place in clipboard',
  },
  jsonSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', description: 'Clipboard text' },
    },
    additionalProperties: false,
  },
  execute: async (args: any): Promise<ToolResult> => {
    try {
      const { desktopSetClipboard } = await dt();
      return wrapResult(await desktopSetClipboard(String(args?.text || '')));
    } catch (e: any) {
      return fail(String(e?.message || e));
    }
  },
};

// ─── Phase 4: App launch / process control ────────────────────────────────────

export const desktopLaunchAppTool: Tool = {
  name: 'desktop_launch_app',
  description:
    'Launch a desktop application by name or path and wait for its window to appear. ' +
    'Returns the window handle once visible. Examples: notepad, code, explorer, calc.',
  schema: {
    app: 'Application name or full path (e.g. notepad, "C:\\\\path\\\\to\\\\app.exe")',
    args: 'Optional command-line arguments string',
    wait_ms: 'Max milliseconds to wait for window to appear (default 6000)',
  },
  jsonSchema: {
    type: 'object',
    required: ['app'],
    properties: {
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
  desktopWaitTool,
  desktopTypeTool,
  desktopPressKeyTool,
  desktopGetClipboardTool,
  desktopSetClipboardTool,
  // App launch / process control (Phase 4)
  desktopLaunchAppTool,
  desktopCloseAppTool,
  desktopGetProcessListTool,
  // Screenshot diffing (Phase 3)
  desktopWaitForChangeTool,
  desktopDiffScreenshotTool,
];
