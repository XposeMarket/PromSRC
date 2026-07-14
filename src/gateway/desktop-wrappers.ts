/**
 * Canonical model-facing desktop wrapper contract.
 *
 * Prometheus keeps granular desktop_* handlers for compatibility, macros, and
 * internal dispatch, but models should see only the six wrappers defined here.
 * Keep schemas, wrapper normalization, and public-name discovery in this file
 * so the main gateway, Reactor, voice adapters, and tests cannot drift.
 */

export const DESKTOP_WRAPPER_TOOL_NAMES = [
  'desktop_screen',
  'desktop_apps',
  'desktop_window',
  'desktop_input',
  'desktop_macro',
  'desktop_background',
] as const;

export type DesktopWrapperToolName = typeof DESKTOP_WRAPPER_TOOL_NAMES[number];

export const DESKTOP_WRAPPER_TOOL_NAME_SET = new Set<string>(DESKTOP_WRAPPER_TOOL_NAMES);

export const DESKTOP_WRAPPER_ACTION_MAP: Record<DesktopWrapperToolName, Record<string, string>> = {
  desktop_screen: {
    doctor: 'desktop_doctor',
    screenshot: 'desktop_screenshot',
    region_screenshot: 'desktop_screenshot',
    window_screenshot: 'desktop_window_screenshot',
    monitors: 'desktop_get_monitors',
    get_monitors: 'desktop_get_monitors',
    wait_for_change: 'desktop_wait_for_change',
    diff_screenshot: 'desktop_diff_screenshot',
    diff: 'desktop_diff_screenshot',
    pixel_watch: 'desktop_pixel_watch',
  },
  desktop_apps: {
    list_apps: 'desktop_list_apps',
    list_windows: 'desktop_list_windows',
    list_installed_apps: 'desktop_list_installed_apps',
    find_installed_app: 'desktop_find_installed_app',
    launch_app: 'desktop_launch_app',
    launch: 'desktop_launch_app',
    close_app: 'desktop_close_app',
    close: 'desktop_close_app',
    process_list: 'desktop_get_process_list',
    get_process_list: 'desktop_get_process_list',
  },
  desktop_window: {
    find: 'desktop_find_window',
    focus: 'desktop_focus_window',
    control: 'desktop_window_control',
    state: 'desktop_get_window_state',
    screenshot: 'desktop_window_screenshot',
    region_screenshot: 'desktop_window_screenshot',
    text: 'desktop_get_window_text',
    accessibility_tree: 'desktop_get_accessibility_tree',
    accessibility: 'desktop_get_accessibility_tree',
    accessibility_state: 'desktop_get_accessibility_state',
    invoke: 'desktop_accessibility_action',
    set_value: 'desktop_accessibility_action',
    select: 'desktop_accessibility_action',
    toggle: 'desktop_accessibility_action',
    expand: 'desktop_accessibility_action',
    collapse: 'desktop_accessibility_action',
    focus_element: 'desktop_accessibility_action',
    secondary_action: 'desktop_accessibility_action',
    find_and_act: 'desktop_accessibility_action',
    locate_text: 'desktop_locate_text',
    click_text: 'desktop_click_text',
    click: 'desktop_window_click',
    type: 'desktop_window_type',
    key: 'desktop_window_press_key',
    press_key: 'desktop_window_press_key',
    scroll: 'desktop_window_scroll',
    drag: 'desktop_window_drag',
  },
  desktop_input: {
    click: 'desktop_click',
    drag: 'desktop_drag',
    scroll: 'desktop_scroll',
    type: 'desktop_type',
    type_raw: 'desktop_type_raw',
    key: 'desktop_press_key',
    press_key: 'desktop_press_key',
    wait: 'desktop_wait',
    clipboard_get: 'desktop_get_clipboard',
    get_clipboard: 'desktop_get_clipboard',
    clipboard_set: 'desktop_set_clipboard',
    set_clipboard: 'desktop_set_clipboard',
  },
  desktop_macro: {
    record: 'desktop_record_macro',
    stop: 'desktop_stop_macro',
    replay: 'desktop_replay_macro',
    list: 'desktop_list_macros',
  },
  desktop_background: {
    status: 'desktop_background_status',
    prepare_sandbox: 'desktop_background_prepare_sandbox',
    command: 'desktop_background_command',
  },
};

export interface NormalizedDesktopWrapperCall {
  name: string;
  args: Record<string, any>;
  error?: string;
}

function normalizeModifier(args: Record<string, any>): void {
  const modifier = String(args.modifier || '').trim().toLowerCase();
  if (modifier === 'shift' || modifier === 'ctrl' || modifier === 'alt') args.modifier = modifier;
  else delete args.modifier;
}

/** Convert one model-facing wrapper call to a granular compatibility handler. */
export function normalizeDesktopWrapperTool(
  name: string,
  rawArgs: any,
): NormalizedDesktopWrapperCall | null {
  if (!DESKTOP_WRAPPER_TOOL_NAME_SET.has(name)) return null;
  const wrapperName = name as DesktopWrapperToolName;
  const args: Record<string, any> = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? { ...rawArgs }
    : {};
  const action = String(args.action || '').trim().toLowerCase();
  if (!action) return { name, args, error: `${name} requires action` };
  delete args.action;

  const mappedName = DESKTOP_WRAPPER_ACTION_MAP[wrapperName][action];
  if (!mappedName) return { name, args: rawArgs || {}, error: `Unsupported ${name} action "${action}".` };
  // Strict-schema clients can fill every optional array with tiny placeholder
  // coordinates. For an ordinary screenshot, a degenerate or 1x1 region means
  // "not supplied", not an intentional crop. Explicit region_screenshot keeps
  // its exact caller-provided region and validates it below.
  if (Array.isArray(args.region) && args.region.length === 4) {
    const region = args.region.map(Number);
    const width = region[2] - region[0];
    const height = region[3] - region[1];
    if (region.every(Number.isFinite) && (width <= 1 || height <= 1) && action !== 'region_screenshot') {
      delete args.region;
    }
  }
  if (action === 'region_screenshot' && (!Array.isArray(args.region) || args.region.length !== 4 || !args.region.every((value: any) => Number.isFinite(Number(value))))) {
    return { name, args, error: `${name}(action="region_screenshot") requires region=[x1,y1,x2,y2].` };
  }
  if ((action === 'locate_text' || action === 'click_text') && (!String(args.screenshot_id || '').trim() || !String(args.query || '').trim())) {
    return { name, args, error: `${name}(action="${action}") requires screenshot_id from a fresh exact-window crop and query.` };
  }
  // Model-facing vision screenshots stay on the fast path. Structured text
  // comes from the dedicated text/accessibility actions rather than OCR.
  if (mappedName === 'desktop_screenshot' || mappedName === 'desktop_window_screenshot') {
    args.skip_ocr = true;
    delete args.ocr;
  }
  // Strict-schema clients routinely populate verify:"auto" even when the
  // model did not request verification. Keep ordinary wrapper pointer actions
  // on the fast path; strict remains an explicit opt-in contract.
  if (['desktop_window_click', 'desktop_click', 'desktop_window_scroll', 'desktop_scroll', 'desktop_window_drag', 'desktop_drag'].includes(mappedName)
    && String(args.verify || '').toLowerCase() === 'auto') {
    args.verify = 'off';
  }

  if (wrapperName === 'desktop_window') {
    if (args.title != null && args.name == null) args.name = args.title;
    if (args.name != null && args.title == null) args.title = args.name;
    if (args.window_handle != null && args.handle == null) args.handle = args.window_handle;
    if (args.handle != null && args.window_handle == null) args.window_handle = args.handle;
    if (args.window_id != null && args.handle == null) {
      const match = String(args.window_id || '').trim().match(/^win_(\d+)$/i);
      if (match) args.handle = Number(match[1]);
    }
    normalizeModifier(args);
    if (mappedName === 'desktop_window_control') {
      if (args.control_action != null && args.action == null) args.action = args.control_action;
      delete args.control_action;
    }
    if ((mappedName === 'desktop_get_window_text' || mappedName === 'desktop_get_accessibility_tree') && args.name != null && args.window_name == null) {
      args.window_name = args.name;
    }
    if (mappedName === 'desktop_accessibility_action') {
      if (action === 'find_and_act') args.atomic = true;
      else args.semantic_action = action === 'focus_element' ? 'focus' : action;
    }
  }

  if (wrapperName === 'desktop_apps') {
    if (mappedName === 'desktop_close_app') {
      args.name = args.name ?? args.app ?? args.title ?? args.query;
    }
  }

  if (wrapperName === 'desktop_input') normalizeModifier(args);

  if (wrapperName === 'desktop_background' && mappedName === 'desktop_background_command') {
    if (args.command_action != null && args.action == null) args.action = args.command_action;
    delete args.command_action;
  }

  return { name: mappedName, args };
}

const windowSelectorProperties = {
  window_token: { type: 'string', description: 'Strong HWND+PID+process-start identity from a fresh state/list_windows response; preferred for actions.' },
  window_id: { type: 'string', description: 'Stable window id from desktop_apps(action="list_windows").' },
  window_handle: { type: 'number', description: 'Exact native window handle.' },
  app_id: { type: 'string', description: 'Stable app id from desktop_apps(action="list_apps").' },
  title: { type: 'string', description: 'Partial window title/process name; least precise selector.' },
};

/** The only six desktop schemas that should be presented to general models. */
export function getDesktopWrapperToolDefinitions(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'desktop_screen',
        description: 'Unified desktop screen/state wrapper for diagnostics, screenshots, native-resolution region crops, monitor geometry, change waits, diffs, and pixel watches. Prefer region_screenshot when small text, icons, loading indicators, or dense controls matter.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['doctor', 'screenshot', 'region_screenshot', 'window_screenshot', 'monitors', 'wait_for_change', 'diff_screenshot', 'pixel_watch'] },
            deep: { type: 'boolean', description: 'Doctor only: run expensive live screenshot, OCR, and UI Automation probes. Defaults false.' },
            capture: { type: 'string', enum: ['all', 'primary'] },
            monitor_index: { type: 'integer' },
            region: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: 'For region_screenshot/screenshot: [x1,y1,x2,y2] in virtual-desktop coordinates. The crop is taken before transport normalization, preserving native detail when under the screenshot size budget.' },
            mode: { type: 'string', enum: ['normal', 'som'] },
            som: { type: 'boolean' },
            name: { type: 'string' },
            handle: { type: 'number' },
            active: { type: 'boolean' },
            focus_first: { type: 'boolean' },
            padding: { type: 'number' },
            timeout_ms: { type: 'number' },
            poll_ms: { type: 'number' },
            x: { type: 'number' },
            y: { type: 'number' },
            target_color: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_apps',
        description: 'Unified desktop app/process/window discovery and lifecycle wrapper. Prefer list_apps/list_windows before targeting a window.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['list_apps', 'list_windows', 'list_installed_apps', 'find_installed_app', 'launch_app', 'close_app', 'process_list'] },
            filter: { type: 'string' },
            include_windows: { type: 'boolean' },
            scope: { type: 'string', enum: ['running', 'installed', 'all'], description: 'Defaults to running unless a filter is supplied.' },
            compact: { type: 'boolean', description: 'Compact output defaults to true.' },
            cursor: { type: 'number' },
            app_id: { type: 'string' },
            process_name: { type: 'string' },
            title: { type: 'string' },
            query: { type: 'string' },
            limit: { type: 'number' },
            refresh: { type: 'boolean' },
            exact: { type: 'boolean', description: 'Require an exact app name, alias, or app_id match.' },
            app: { type: 'string' },
            args: { type: 'string' },
            wait_ms: { type: 'number' },
            name: { type: 'string' },
            force: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_window',
        description: 'Unified exact-window wrapper for discovery, state, whole-window or native-resolution region screenshots, accessibility, native window control, and window-scoped input. For tiny UI details, use region_screenshot with a window-relative region before clicking.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['find', 'focus', 'control', 'state', 'screenshot', 'region_screenshot', 'text', 'accessibility_tree', 'accessibility_state', 'invoke', 'set_value', 'select', 'toggle', 'expand', 'collapse', 'focus_element', 'secondary_action', 'find_and_act', 'locate_text', 'click_text', 'click', 'type', 'key', 'press_key', 'scroll', 'drag'] },
            ...windowSelectorProperties,
            name: { type: 'string' },
            handle: { type: 'number' },
            control_action: { type: 'string', enum: ['minimize', 'maximize', 'restore', 'close'] },
            active: { type: 'boolean' },
            include_screenshot: { type: 'boolean' },
            include_text: { type: 'boolean' },
            focus_first: { type: 'boolean' },
            padding: { type: 'number' },
            region: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: 'For region_screenshot/screenshot: [x1,y1,x2,y2] relative to the target window top-left. Cropped from the native window image before scaling/OCR.' },
            mode: { type: 'string', enum: ['normal', 'som'] },
            som: { type: 'boolean' },
            x: { type: 'number' },
            y: { type: 'number' },
            from_x: { type: 'number' },
            from_y: { type: 'number' },
            to_x: { type: 'number' },
            to_y: { type: 'number' },
            text: { type: 'string' },
            key: { type: 'string' },
            raw: { type: 'boolean' },
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
            amount: { type: 'number' },
            coordinate_space: { type: 'string', enum: ['window', 'capture', 'virtual', 'monitor'], description: 'For x/y selected from a screenshot, use capture. Window means independently known logical coordinates relative to the window top-left.' },
            screenshot_id: { type: 'string', description: 'Fresh screenshot anchor. When present and coordinate_space is omitted, clicks default to capture space.' },
            query: { type: 'string', description: 'Visible text query. For text, filters returned lines; for locate_text/click_text, matches inside the exact screenshot crop.' },
            max_chars: { type: 'integer', description: 'Text only: maximum returned characters (default 4000).' },
            max_lines: { type: 'integer', description: 'Text only: maximum returned lines (default 200).' },
            min_confidence: { type: 'number', minimum: 0.5, maximum: 0.98, description: 'Minimum combined OCR/match confidence. Defaults to 0.72; low-confidence targets are never clicked.' },
            button: { type: 'string', enum: ['left', 'right'] },
            double_click: { type: 'boolean' },
            modifier: { type: 'string', enum: ['none', 'shift', 'ctrl', 'alt'], default: 'none' },
            verify: { type: 'string', enum: ['off', 'auto', 'strict'] },
            final_action_approval_id: { type: 'string' },
            max_depth: { type: 'integer' },
            max_nodes: { type: 'integer' },
            limit: { type: 'integer', description: 'Accessibility nodes returned per page.' },
            cursor: { type: 'integer', description: 'Accessibility node page offset.' },
            compact: { type: 'boolean' },
            state_id: { type: 'string', description: 'Fresh state_id returned by accessibility_state.' },
            element_id: { type: 'string', description: 'Snapshot-scoped element_id returned by accessibility_state.' },
            automation_id: { type: 'string' },
            element_name: { type: 'string' },
            role: { type: 'string' },
            match_mode: { type: 'string', enum: ['exact', 'contains'], description: 'Semantic text matching mode. Use contains for truncated visible labels such as chat titles.' },
            semantic_action: { type: 'string', enum: ['invoke', 'set_value', 'select', 'toggle', 'expand', 'collapse', 'focus', 'secondary_action'] },
            atomic: { type: 'boolean', description: 'Internal normalized marker for find_and_act.' },
            value: { type: 'string', description: 'Value for set_value.' },
            steps: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_input',
        description: 'Unified host-desktop/global-coordinate fallback for input, waits, and clipboard actions. Prefer desktop_window for a known app window.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['click', 'drag', 'scroll', 'type', 'type_raw', 'key', 'press_key', 'wait', 'clipboard_get', 'clipboard_set'] },
            x: { type: 'number' },
            y: { type: 'number' },
            from_x: { type: 'number' },
            from_y: { type: 'number' },
            to_x: { type: 'number' },
            to_y: { type: 'number' },
            element: { type: 'number' },
            text: { type: 'string' },
            key: { type: 'string' },
            file_path: { type: 'string' },
            file_paths: { type: 'array', items: { type: 'string' } },
            mode: { type: 'string', enum: ['auto', 'text', 'image', 'files'] },
            button: { type: 'string', enum: ['left', 'right'] },
            double_click: { type: 'boolean' },
            modifier: { type: 'string', enum: ['none', 'shift', 'ctrl', 'alt'], default: 'none' },
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
            amount: { type: 'number' },
            axis: { type: 'string', enum: ['vertical', 'horizontal'] },
            coordinate_space: { type: 'string', enum: ['virtual', 'monitor', 'capture', 'window'] },
            screenshot_id: { type: 'string' },
            window_name: { type: 'string' },
            window_handle: { type: 'number' },
            monitor_relative: { type: 'boolean' },
            monitor_index: { type: 'integer' },
            verify: { type: 'string', enum: ['off', 'auto', 'strict'] },
            final_action_approval_id: { type: 'string' },
            capture_after: { type: 'boolean' },
            steps: { type: 'number' },
            ms: { type: 'number' },
            query: { type: 'string', description: 'Clipboard get only: return matching lines.' },
            max_chars: { type: 'integer', description: 'Clipboard get only: maximum returned text characters (default 1000).' },
            head: { type: 'integer', description: 'Clipboard get only: select the first N characters before max_chars.' },
            tail: { type: 'integer', description: 'Clipboard get only: select the last N characters before max_chars.' },
            metadata_only: { type: 'boolean', description: 'Clipboard get only: return presence and length without content.' },
            include_length: { type: 'boolean', description: 'Clipboard get only: include total character count. Defaults true.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_macro',
        description: 'Unified desktop macro wrapper for recording, stopping, replaying, and listing saved host-desktop macros.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['record', 'stop', 'replay', 'list'] },
            name: { type: 'string' },
            speed_multiplier: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'desktop_background',
        description: 'Unified isolated background-desktop wrapper targeting the sandbox/VM worker rather than the host input desktop.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['status', 'prepare_sandbox', 'command'] },
            command_action: { type: 'string', enum: ['screenshot', 'list_windows', 'get_window_state', 'accessibility_tree', 'click', 'window_click', 'type', 'window_type', 'key', 'window_key', 'wait', 'run'] },
            launch: { type: 'boolean' },
            networking: { type: 'string', enum: ['enable', 'disable', 'default'] },
            vgpu: { type: 'string', enum: ['enable', 'disable', 'default'] },
            memory_mb: { type: 'number' },
            window_id: { type: 'string' },
            title: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            text: { type: 'string' },
            key: { type: 'string' },
            command: { type: 'string' },
            include_screenshot: { type: 'boolean' },
            include_text: { type: 'boolean' },
            max_depth: { type: 'integer' },
            max_nodes: { type: 'integer' },
            ms: { type: 'number' },
            timeout_ms: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
  ];
}

export function getDesktopWrapperToolNames(): string[] {
  return [...DESKTOP_WRAPPER_TOOL_NAMES];
}
