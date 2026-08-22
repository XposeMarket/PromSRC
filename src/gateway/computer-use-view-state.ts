export type ComputerUseSource = 'browser' | 'desktop';
export type ComputerUseDesktopMode = 'host' | 'sandbox';

export interface ComputerUseToolClassification {
  source: ComputerUseSource;
  desktopMode?: ComputerUseDesktopMode;
  hostControl: boolean;
  pointerAction: boolean;
  frameRecommended: boolean;
}

export interface ComputerUseCursor {
  x: number;
  y: number;
  kind: 'pointer' | 'drag-end';
  updatedAt: number;
}

export interface ComputerUseToolState {
  callId: string;
  name: string;
  hostControl: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface ComputerUseSurfaceState {
  source: ComputerUseSource;
  active: boolean;
  desktopMode?: ComputerUseDesktopMode;
  hostControl: boolean;
  activeCalls: ComputerUseToolState[];
  cursor?: ComputerUseCursor;
  lastTool?: ComputerUseToolState;
  updatedAt: number;
}

export interface ComputerUseSessionViewState {
  sessionId: string;
  active: boolean;
  preferredSource?: ComputerUseSource;
  browser?: ComputerUseSurfaceState;
  desktop?: ComputerUseSurfaceState;
  updatedAt: number;
}

const BROWSER_TOOL_NAMES = new Set([
  'browser_open',
  'browser_snapshot',
  'browser_click',
  'browser_fill',
  'browser_upload_file',
  'browser_press_key',
  'browser_wait',
  'browser_scroll',
  'browser_scroll_collect',
  'browser_click_and_download',
  'browser_close',
  'browser_get_focused_item',
  'browser_get_page_text',
  'browser_vision_screenshot',
  'browser_vision_click',
  'browser_vision_type',
  'browser_send_to_telegram',
]);

const DESKTOP_POINTER_NAMES = new Set([
  'desktop_click',
  'desktop_drag',
  'desktop_click_text',
]);

const DESKTOP_HOST_CONTROL_NAMES = new Set([
  'desktop_click',
  'desktop_drag',
  'desktop_type',
  'desktop_press_key',
  'desktop_focus_window',
  'desktop_window_control',
  'desktop_launch_app',
  'desktop_close_app',
  'desktop_set_clipboard',
  'desktop_click_text',
]);

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function finiteCoordinate(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function desktopWrapperAction(name: string, args: Record<string, any>): string {
  if (!['desktop_screen', 'desktop_window', 'desktop_input', 'desktop_apps', 'desktop_macro', 'desktop_background'].includes(name)) {
    return '';
  }
  return normalized(args?.action || args?.mode);
}

function isDesktopPointerAction(name: string, args: Record<string, any>): boolean {
  if (DESKTOP_POINTER_NAMES.has(name)) return true;
  if (name === 'desktop_input') {
    const action = desktopWrapperAction(name, args);
    return action === 'click' || action === 'drag' || action === 'click_text';
  }
  if (name === 'desktop_window') {
    return desktopWrapperAction(name, args) === 'click_text';
  }
  if (name === 'desktop_macro') {
    const action = desktopWrapperAction(name, args);
    return action === 'click' || action === 'drag';
  }
  return false;
}

function isDesktopHostControl(name: string, args: Record<string, any>): boolean {
  if (DESKTOP_HOST_CONTROL_NAMES.has(name)) return true;

  const action = desktopWrapperAction(name, args);
  if (name === 'desktop_input') {
    return ['click', 'drag', 'type', 'press_key', 'key', 'click_text', 'set_clipboard'].includes(action);
  }
  if (name === 'desktop_window') {
    return ['focus', 'control', 'click_text'].includes(action);
  }
  if (name === 'desktop_apps') {
    return ['launch', 'close'].includes(action);
  }
  if (name === 'desktop_macro') {
    return action !== '' && !['screenshot', 'inspect'].includes(action);
  }
  return false;
}

function isFrameRecommended(name: string, args: Record<string, any>): boolean {
  if (name.startsWith('browser_')) return name !== 'browser_wait';
  if (!name.startsWith('desktop_')) return false;
  if (name === 'desktop_wait') return false;
  if (name === 'desktop_background') return true;
  return desktopWrapperAction(name, args) !== 'wait';
}

export function classifyComputerUseTool(
  toolName: string,
  args: Record<string, any> = {},
): ComputerUseToolClassification | null {
  const name = normalized(toolName);
  if (BROWSER_TOOL_NAMES.has(name)) {
    return {
      source: 'browser',
      hostControl: false,
      pointerAction: name === 'browser_click' || name === 'browser_vision_click' || name === 'browser_vision_type',
      frameRecommended: isFrameRecommended(name, args),
    };
  }

  if (!name.startsWith('desktop_')) return null;
  const desktopMode: ComputerUseDesktopMode = name === 'desktop_background' || name.startsWith('desktop_background_')
    ? 'sandbox'
    : 'host';
  return {
    source: 'desktop',
    desktopMode,
    hostControl: desktopMode === 'host' && isDesktopHostControl(name, args),
    pointerAction: isDesktopPointerAction(name, args),
    frameRecommended: isFrameRecommended(name, args),
  };
}

function readCoordinatePair(args: Record<string, any>): { x: number; y: number; kind: ComputerUseCursor['kind'] } | null {
  const candidates: Array<[unknown, unknown, ComputerUseCursor['kind']]> = [
    [args?.x, args?.y, 'pointer'],
    [args?.to_x, args?.to_y, 'drag-end'],
    [args?.end_x, args?.end_y, 'drag-end'],
    [args?.to?.x, args?.to?.y, 'drag-end'],
    [Array.isArray(args?.coordinate) ? args.coordinate[0] : null, Array.isArray(args?.coordinate) ? args.coordinate[1] : null, 'pointer'],
    [Array.isArray(args?.coordinates) ? args.coordinates[0] : null, Array.isArray(args?.coordinates) ? args.coordinates[1] : null, 'pointer'],
    [Array.isArray(args?.to_coordinate) ? args.to_coordinate[0] : null, Array.isArray(args?.to_coordinate) ? args.to_coordinate[1] : null, 'drag-end'],
  ];

  for (const [rawX, rawY, kind] of candidates) {
    const x = finiteCoordinate(rawX);
    const y = finiteCoordinate(rawY);
    if (x == null || y == null) continue;
    return { x, y, kind };
  }
  return null;
}

export function extractComputerUseCursor(
  toolName: string,
  args: Record<string, any> = {},
  now = Date.now(),
): ComputerUseCursor | null {
  const classification = classifyComputerUseTool(toolName, args);
  if (!classification?.pointerAction) return null;
  const pair = readCoordinatePair(args);
  if (!pair) return null;
  return { ...pair, updatedAt: now };
}

function cloneToolState(tool: ComputerUseToolState): ComputerUseToolState {
  return { ...tool };
}

function cloneSurface(surface: ComputerUseSurfaceState | undefined): ComputerUseSurfaceState | undefined {
  if (!surface) return undefined;
  return {
    ...surface,
    activeCalls: surface.activeCalls.map(cloneToolState),
    cursor: surface.cursor ? { ...surface.cursor } : undefined,
    lastTool: surface.lastTool ? cloneToolState(surface.lastTool) : undefined,
  };
}

function cloneSession(state: ComputerUseSessionViewState): ComputerUseSessionViewState {
  return {
    ...state,
    browser: cloneSurface(state.browser),
    desktop: cloneSurface(state.desktop),
  };
}

export class ComputerUseViewTracker {
  private readonly sessions = new Map<string, ComputerUseSessionViewState>();

  get(sessionId: string): ComputerUseSessionViewState | null {
    const state = this.sessions.get(String(sessionId || '').trim());
    return state ? cloneSession(state) : null;
  }

  beginToolCall(input: {
    sessionId: string;
    callId: string;
    toolName: string;
    args?: Record<string, any>;
    now?: number;
  }): ComputerUseSessionViewState | null {
    const sessionId = String(input.sessionId || '').trim();
    const callId = String(input.callId || '').trim();
    if (!sessionId || !callId) return null;

    const args = input.args || {};
    const classification = classifyComputerUseTool(input.toolName, args);
    if (!classification) return null;

    const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();
    const state = this.sessions.get(sessionId) || {
      sessionId,
      active: false,
      updatedAt: now,
    };
    const previous = classification.source === 'browser' ? state.browser : state.desktop;
    const tool: ComputerUseToolState = {
      callId,
      name: normalized(input.toolName),
      hostControl: classification.hostControl,
      startedAt: now,
      updatedAt: now,
    };
    const activeCalls = (previous?.activeCalls || []).filter((item) => item.callId !== callId);
    activeCalls.push(tool);
    const cursor = extractComputerUseCursor(input.toolName, args, now) || previous?.cursor;
    const nextSurface: ComputerUseSurfaceState = {
      source: classification.source,
      active: true,
      desktopMode: classification.desktopMode,
      hostControl: activeCalls.some((item) => item.hostControl),
      activeCalls,
      cursor: cursor ? { ...cursor } : undefined,
      lastTool: tool,
      updatedAt: now,
    };

    if (classification.source === 'browser') state.browser = nextSurface;
    else state.desktop = nextSurface;
    state.active = true;
    state.preferredSource = classification.source;
    state.updatedAt = now;
    this.sessions.set(sessionId, state);
    return cloneSession(state);
  }

  finishToolCall(input: {
    sessionId: string;
    callId: string;
    now?: number;
  }): ComputerUseSessionViewState | null {
    const sessionId = String(input.sessionId || '').trim();
    const callId = String(input.callId || '').trim();
    const state = this.sessions.get(sessionId);
    if (!state || !callId) return state ? cloneSession(state) : null;
    const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();

    for (const source of ['browser', 'desktop'] as const) {
      const surface = state[source];
      if (!surface) continue;
      const activeCalls = surface.activeCalls.filter((item) => item.callId !== callId);
      if (activeCalls.length === surface.activeCalls.length) continue;
      surface.activeCalls = activeCalls;
      surface.active = activeCalls.length > 0;
      surface.hostControl = activeCalls.some((item) => item.hostControl);
      surface.updatedAt = now;
    }

    state.active = state.browser?.active === true || state.desktop?.active === true;
    state.updatedAt = now;
    this.sessions.set(sessionId, state);
    return cloneSession(state);
  }

  settleSession(sessionId: string, now = Date.now()): ComputerUseSessionViewState | null {
    const key = String(sessionId || '').trim();
    const state = this.sessions.get(key);
    if (!state) return null;
    for (const surface of [state.browser, state.desktop]) {
      if (!surface) continue;
      surface.active = false;
      surface.hostControl = false;
      surface.activeCalls = [];
      surface.updatedAt = now;
    }
    state.active = false;
    state.updatedAt = now;
    this.sessions.set(key, state);
    return cloneSession(state);
  }

  resetSession(sessionId: string): void {
    this.sessions.delete(String(sessionId || '').trim());
  }
}
