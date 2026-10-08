// ─── Background dispatch for window-scoped desktop actions (Windows) ─────────
//
// Default dispatch is "background": the native helper drives the exact target
// window through UI Automation patterns first, then posted window messages, and
// never calls SetForegroundWindow / SetCursorPos / SendInput. When an app cannot
// be driven that way (Firefox content, modifier shortcuts, drags) the action fails with BACKGROUND_UNAVAILABLE instead of silently taking
// over the user's mouse and keyboard. dispatch="foreground" is the explicit
// opt-in for real input; it waits for the user to pause and then restores their
// foreground window and cursor afterwards.
//
// Kill switch: PROMETHEUS_DESKTOP_DISPATCH=foreground restores the legacy default.

import { getWin32DesktopHelperClient, type Win32BackgroundResult } from './desktop-platform-win32-helper';

export type DesktopDispatchMode = 'background' | 'foreground';

export const BACKGROUND_HELPER_PROTOCOL = 6;

export function normalizeDesktopDispatch(value: unknown): DesktopDispatchMode | undefined {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'background' || raw === 'bg') return 'background';
  if (raw === 'foreground' || raw === 'fg' || raw === 'real_input') return 'foreground';
  return undefined;
}

/** Configured default dispatch mode (env override, default background). */
export function defaultDesktopDispatch(env: NodeJS.ProcessEnv = process.env): DesktopDispatchMode {
  return normalizeDesktopDispatch(env.PROMETHEUS_DESKTOP_DISPATCH) || 'background';
}

/** The helper client when it supports background input; otherwise null. */
export async function backgroundHelper(): Promise<ReturnType<typeof getWin32DesktopHelperClient> | null> {
  if (process.platform !== 'win32') return null;
  const helper = getWin32DesktopHelperClient();
  if (!helper.available) return null;
  try {
    return (await helper.protocolVersion()) >= BACKGROUND_HELPER_PROTOCOL ? helper : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the effective mode for one action. An explicit request wins. When the
 * default is background but the helper is too old (or not Windows), we fall back
 * to foreground and say so, so behavior never changes silently.
 */
export async function resolveDesktopDispatch(requested: unknown): Promise<{ mode: DesktopDispatchMode; note?: string }> {
  const explicit = normalizeDesktopDispatch(requested);
  const wanted = explicit || defaultDesktopDispatch();
  if (wanted === 'foreground') return { mode: 'foreground' };
  if (await backgroundHelper()) return { mode: 'background' };
  if (process.platform !== 'win32') return { mode: 'foreground' };
  return {
    mode: 'foreground',
    note: `Background dispatch needs desktop helper protocol v${BACKGROUND_HELPER_PROTOCOL}; this helper is older, so real foreground input was used.`,
  };
}

/** Parse "Ctrl+Shift+S" style combos into a key and modifier flags. */
export function parseKeyCombo(input: string): { key: string; ctrl: boolean; shift: boolean; alt: boolean; win: boolean } {
  const parts = String(input || 'Enter').split('+').map((part) => part.trim()).filter(Boolean);
  const result = { key: 'enter', ctrl: false, shift: false, alt: false, win: false };
  const keys: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'command') result.ctrl = true;
    else if (lower === 'shift') result.shift = true;
    else if (lower === 'alt' || lower === 'option') result.alt = true;
    else if (lower === 'win' || lower === 'windows' || lower === 'meta' || lower === 'super') result.win = true;
    else keys.push(part);
  }
  // "Ctrl++" splits into empty parts; treat a trailing '+' as the plus key.
  if (!keys.length && /\+\s*\+\s*$/.test(String(input || ''))) keys.push('+');
  if (keys.length) result.key = keys[keys.length - 1];
  return result;
}

export interface UserInputSnapshot { idleMs: number; cursor: { x: number; y: number }; foreground: number }

/**
 * Foreground arbitration: wait (bounded) until the user has not touched the
 * mouse/keyboard for `quietMs`, so real input never fights a person mid-gesture.
 */
export async function waitForUserQuiet(
  quietMs: number = Number(process.env.PROMETHEUS_DESKTOP_USER_QUIET_MS || 1200),
  maxWaitMs: number = Number(process.env.PROMETHEUS_DESKTOP_USER_WAIT_MS || 8000),
  signal?: AbortSignal,
): Promise<{ ok: boolean; snapshot?: UserInputSnapshot; waitedMs: number }> {
  const helper = await backgroundHelper();
  if (!helper) return { ok: true, waitedMs: 0 };
  const started = Date.now();
  for (;;) {
    let snapshot: UserInputSnapshot;
    try {
      snapshot = await helper.userInputState(signal);
    } catch {
      return { ok: true, waitedMs: Date.now() - started };
    }
    if (Number(snapshot.idleMs) >= quietMs) return { ok: true, snapshot, waitedMs: Date.now() - started };
    if (Date.now() - started >= maxWaitMs) return { ok: false, snapshot, waitedMs: Date.now() - started };
    if (signal?.aborted) return { ok: false, snapshot, waitedMs: Date.now() - started };
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(50, quietMs - Number(snapshot.idleMs)))));
  }
}

/**
 * Run a background action and give the user's foreground window back if the
 * target app activated itself meanwhile (UWP Settings/Calculator do this from
 * their own invoke handlers). Activation lands asynchronously, so we poll for a
 * short window after the action returns.
 */
export async function guardUserForeground<T>(
  targetHandle: number,
  act: () => Promise<T>,
  focusWindow: (handle: number) => Promise<boolean>,
  options: { settleMs?: number; signal?: AbortSignal } = {},
): Promise<{ result: T; focusRestored?: boolean }> {
  const helper = await backgroundHelper();
  let before = 0;
  if (helper) {
    try { before = Number((await helper.foregroundWindow(options.signal))?.handle) || 0; } catch { before = 0; }
  }
  const result = await act();
  if (!helper || !before || before === targetHandle) return { result };
  const settleMs = Math.max(0, options.settleMs ?? 200);
  const deadline = Date.now() + settleMs;
  let stolen = false;
  for (;;) {
    let now = 0;
    try { now = Number((await helper.foregroundWindow())?.handle) || 0; } catch { now = 0; }
    if (now && now !== before) { stolen = true; break; }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!stolen) return { result };
  let restored = false;
  for (let i = 0; i < 4 && !restored; i += 1) {
    restored = await focusWindow(before).catch(() => false);
    if (!restored) await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return { result, focusRestored: restored };
}

/** After a foreground action, hand the user's window and cursor back. */
export async function restoreUserFocus(
  before: UserInputSnapshot | undefined,
  targetHandle: number,
  focusWindow: (handle: number) => Promise<boolean>,
): Promise<string> {
  if (!before) return '';
  const helper = await backgroundHelper();
  if (!helper) return '';
  const notes: string[] = [];
  try {
    if (before.foreground && before.foreground !== targetHandle) {
      const restored = await focusWindow(before.foreground).catch(() => false);
      notes.push(restored ? 'restored your previous foreground window' : 'could not restore your previous foreground window');
    }
    await helper.movePointer(before.cursor.x, before.cursor.y);
    notes.push('returned the cursor');
  } catch {
    // Best effort only.
  }
  return notes.length ? `Foreground dispatch: ${notes.join(', ')}.` : '';
}

/** Background methods that post into a Chromium render widget (verify the effect). */
export function isChromiumBackgroundMethod(method: string | undefined): boolean {
  return /_chromium$/.test(String(method || ''));
}

export function describeBackgroundResult(result: Win32BackgroundResult): string {
  const parts = [`method=${result.method || 'unknown'}`];
  if (isChromiumBackgroundMethod(result.method)) parts.push('chromium_render_widget=true (posted input; confirm the effect with a screenshot)');
  if (result.element?.name || result.element?.automationId) {
    parts.push(`element="${result.element.name || result.element.automationId}"`);
  }
  if (result.targetClass) parts.push(`target_class=${result.targetClass}`);
  if (result.pending) parts.push('pending=true (UIA call still running, often a modal dialog opened)');
  return parts.join(', ');
}

/** Suggested next step for each background_unavailable reason. */
export function backgroundUnavailableHint(reason: string | undefined): string {
  switch (reason) {
    case 'web_content':
      return 'For web pages use browser tools. Chromium/Electron apps take background input through their render widget (helper protocol 7+); for others try desktop_window(action="find_and_act") with an accessibility selector, or retry with dispatch="foreground" (takes the real mouse/keyboard).';
    case 'modern_app':
      return 'Use desktop_window(action="find_and_act" / "invoke" / "set_value") on an accessibility element, or retry with dispatch="foreground".';
    case 'modifier_combo':
      return 'Use an accessibility action for the command (menu item invoke) or retry with dispatch="foreground".';
    case 'no_focus_target':
      return 'Focus a field first (desktop_window action="focus_element" or a background click on it), or use set_value.';
    case 'point_outside_window':
      return 'Capture a fresh window screenshot and use its screenshot_id/coordinates.';
    case 'drag':
      return 'Drags need real input. Retry with dispatch="foreground".';
    default:
      return 'Retry with an accessibility action or dispatch="foreground".';
  }
}
