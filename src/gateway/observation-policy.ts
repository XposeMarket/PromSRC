import type {
  BrowserAdvisorPacket,
  BrowserObserveMode,
} from './browser-tools';
import type { DesktopAdvisorPacket } from './desktop-tools';

export type PostActionObserveMode = BrowserObserveMode;

export interface BrowserObservationPageState {
  url?: string;
  title?: string;
  pageType?: string;
  contentHash?: string;
  snapshotElements?: number;
  modalOpen?: boolean;
  isGenerating?: boolean;
}

export interface DesktopObservationPacketState {
  activeWindowTitle?: string;
  activeWindowProcessName?: string;
  activeWindowHandle?: number;
  activeMonitorIndex?: number | null;
  contentHash?: string;
  captureMode?: 'all' | 'primary' | 'monitor';
  captureMonitorIndex?: number;
}

export interface PostActionObservationInput {
  toolName: string;
  args?: Record<string, any>;
  requestedMode?: BrowserObserveMode;
  hasObserveOverride?: boolean;
  error?: boolean;
  resultText?: string;
  recentRepeats?: number;
  recentFailures?: number;
  browser?: {
    before?: BrowserObservationPageState | null;
    after?: BrowserObservationPageState | null;
  };
  desktop?: {
    before?: DesktopObservationPacketState | null;
    after?: DesktopObservationPacketState | null;
  };
}

export interface PostActionObservationDecision {
  mode: PostActionObserveMode;
  reason: string;
  shouldRunAdvisor: boolean;
}

const MODE_RANK: Record<PostActionObserveMode, number> = {
  none: 0,
  compact: 1,
  delta: 2,
  snapshot: 3,
  screenshot: 4,
};

const LOW_RISK_BROWSER_KEYS = new Set(['j', 'k']);
const ROUTINE_BROWSER_KEYS = new Set([
  'tab',
  'arrowdown',
  'arrowup',
  'arrowleft',
  'arrowright',
  'home',
  'end',
]);
const LIKELY_SUBMIT_BROWSER_KEYS = new Set([
  'enter',
  'return',
  'escape',
  'esc',
  'ctrl+enter',
  'meta+enter',
  'command+enter',
]);
const RISKY_ACTION_RE = /\b(submit|post|delete|pay|send|upload|publish|checkout|purchase|confirm)\b/i;
const BROWSER_POST_RESULT_RE = /\b(clicked post button|posted successfully|submitted successfully|payment submitted|sent successfully)\b/i;
const DESKTOP_LIKELY_SUBMIT_KEY_RE = /\b(enter|return|escape|esc|ctrl\+enter|meta\+enter|command\+enter|alt\+f4)\b/i;
const OBSERVATION_TOOL_REASONS: Record<string, PostActionObservationDecision> = {
  browser_snapshot: {
    mode: 'snapshot',
    reason: 'explicit DOM snapshot requested',
    shouldRunAdvisor: true,
  },
  browser_snapshot_delta: {
    mode: 'delta',
    reason: 'explicit DOM delta requested',
    shouldRunAdvisor: true,
  },
  browser_vision_screenshot: {
    mode: 'screenshot',
    reason: 'explicit browser screenshot requested',
    shouldRunAdvisor: true,
  },
  desktop_screenshot: {
    mode: 'screenshot',
    reason: 'explicit desktop screenshot requested',
    shouldRunAdvisor: true,
  },
  desktop_window_screenshot: {
    mode: 'screenshot',
    reason: 'explicit desktop window screenshot requested',
    shouldRunAdvisor: true,
  },
  desktop_wait_for_change: {
    mode: 'screenshot',
    reason: 'change-watcher already captures screen state',
    shouldRunAdvisor: true,
  },
};

function upgradeMode(
  current: PostActionObserveMode,
  next: PostActionObserveMode,
): PostActionObserveMode {
  return MODE_RANK[next] > MODE_RANK[current] ? next : current;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function browserModalOpen(snapshot?: string): boolean | undefined {
  if (!snapshot) return undefined;
  return /\[MODAL OPEN\]/i.test(snapshot);
}

function toScrollMultiplier(args?: Record<string, any>): number {
  const n = Number(args?.multiplier);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function toDesktopScrollAmount(args?: Record<string, any>): number {
  const n = Number(args?.amount);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

function browserKey(args?: Record<string, any>): string {
  return normalizeText(args?.key);
}

function desktopKey(args?: Record<string, any>): string {
  return normalizeText(args?.key);
}

function browserTargetLabel(args?: Record<string, any>, resultText?: string): string {
  const raw = [
    args?.element,
    args?.element_name,
    args?.selector,
    resultText,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  return raw.toLowerCase();
}

function isBrowserNavigationChange(
  before?: BrowserObservationPageState | null,
  after?: BrowserObservationPageState | null,
): boolean {
  if (!before?.url || !after?.url) return false;
  return normalizeText(before.url) !== normalizeText(after.url);
}

function isBrowserPageTypeChange(
  before?: BrowserObservationPageState | null,
  after?: BrowserObservationPageState | null,
): boolean {
  if (!before?.pageType || !after?.pageType) return false;
  return normalizeText(before.pageType) !== normalizeText(after.pageType);
}

function isBrowserModalChange(
  before?: BrowserObservationPageState | null,
  after?: BrowserObservationPageState | null,
): boolean {
  if (before?.modalOpen === undefined || after?.modalOpen === undefined) return false;
  return before.modalOpen !== after.modalOpen;
}

function isStableBrowserPage(
  before?: BrowserObservationPageState | null,
  after?: BrowserObservationPageState | null,
): boolean {
  if (!before || !after) return false;
  if (normalizeText(before.url) !== normalizeText(after.url)) return false;
  if (normalizeText(before.pageType) !== normalizeText(after.pageType)) return false;
  if (Boolean(before.modalOpen) !== Boolean(after.modalOpen)) return false;
  if (before.contentHash && after.contentHash) {
    return before.contentHash === after.contentHash;
  }
  return true;
}

function isStableDesktopPacket(
  before?: DesktopObservationPacketState | null,
  after?: DesktopObservationPacketState | null,
): boolean {
  if (!before || !after) return false;
  if ((before.activeWindowHandle || 0) !== (after.activeWindowHandle || 0)) return false;
  if (before.contentHash && after.contentHash) {
    return before.contentHash === after.contentHash;
  }
  return normalizeText(before.activeWindowTitle) === normalizeText(after.activeWindowTitle)
    && normalizeText(before.activeWindowProcessName) === normalizeText(after.activeWindowProcessName);
}

function isRiskyBrowserAction(
  toolName: string,
  args?: Record<string, any>,
  resultText?: string,
): { risky: boolean; reason: string } {
  if (toolName === 'browser_upload_file') {
    return { risky: true, reason: 'upload needs visual confirmation' };
  }
  if (toolName === 'browser_run_js') {
    return { risky: true, reason: 'browser_run_js may mutate SPA state' };
  }
  if (toolName === 'browser_vision_click') {
    return { risky: true, reason: 'coordinate click is visually ambiguous' };
  }
  const key = browserKey(args);
  if (toolName === 'browser_press_key' || toolName === 'browser_key') {
    if (LIKELY_SUBMIT_BROWSER_KEYS.has(key)) {
      return { risky: true, reason: `keypress "${key}" often submits or closes UI` };
    }
    return { risky: false, reason: '' };
  }
  const targetLabel = browserTargetLabel(args, resultText);
  if (
    (toolName === 'browser_click' || toolName === 'browser_fill' || toolName === 'browser_click_and_download')
    && RISKY_ACTION_RE.test(targetLabel)
  ) {
    return { risky: true, reason: 'target label looks like submit/post/delete/pay/send' };
  }
  if (toolName === 'browser_fill' && BROWSER_POST_RESULT_RE.test(String(resultText || ''))) {
    return { risky: true, reason: 'fill result indicates a submit/post happened' };
  }
  return { risky: false, reason: '' };
}

function isAmbiguousBrowserClick(
  toolName: string,
  args?: Record<string, any>,
  before?: BrowserObservationPageState | null,
): boolean {
  if (toolName !== 'browser_click') return false;
  if (String(args?.element || args?.element_name || '').trim()) return false;
  const ref = Number(args?.ref);
  if (!Number.isFinite(ref) || ref <= 0) return true;
  return (before?.snapshotElements || 0) > 0 && (before?.snapshotElements || 0) < 10;
}

function decideBrowserObservation(
  input: PostActionObservationInput,
): PostActionObservationDecision {
  const requestedMode = input.requestedMode || 'none';
  const hasOverride = input.hasObserveOverride === true;
  const toolName = String(input.toolName || '').trim();
  const repeats = Math.max(1, Math.floor(Number(input.recentRepeats || 1)));
  const failures = Math.max(0, Math.floor(Number(input.recentFailures || 0)));
  const before = input.browser?.before || null;
  const after = input.browser?.after || null;

  if (OBSERVATION_TOOL_REASONS[toolName]) {
    return OBSERVATION_TOOL_REASONS[toolName];
  }
  if (toolName === 'browser_close') {
    return { mode: 'none', reason: 'browser close does not need post-action inspection', shouldRunAdvisor: false };
  }
  if (input.error) {
    return { mode: 'screenshot', reason: 'browser action failed; capture fresh visual state', shouldRunAdvisor: true };
  }
  if (hasOverride && (requestedMode === 'none' || requestedMode === 'compact')) {
    return {
      mode: requestedMode,
      reason: `explicit observe=${requestedMode}`,
      shouldRunAdvisor: false,
    };
  }
  if (toolName === 'browser_open' || isBrowserNavigationChange(before, after)) {
    return { mode: 'screenshot', reason: 'navigation changed the page URL', shouldRunAdvisor: true };
  }
  if (isBrowserModalChange(before, after)) {
    return { mode: 'screenshot', reason: 'modal state changed', shouldRunAdvisor: true };
  }
  if (isBrowserPageTypeChange(before, after)) {
    return { mode: 'screenshot', reason: 'page type changed', shouldRunAdvisor: true };
  }
  if (failures > 0) {
    return { mode: 'screenshot', reason: 'same browser action has failed recently', shouldRunAdvisor: true };
  }
  const risky = isRiskyBrowserAction(toolName, input.args, input.resultText);
  if (risky.risky) {
    return { mode: 'screenshot', reason: risky.reason, shouldRunAdvisor: true };
  }
  if (!hasOverride && isAmbiguousBrowserClick(toolName, input.args, before)) {
    return { mode: 'screenshot', reason: 'click target is still ambiguous', shouldRunAdvisor: true };
  }
  if (!hasOverride && toolName === 'browser_wait') {
    return { mode: 'none', reason: 'timing-only wait on a stable page', shouldRunAdvisor: false };
  }
  if (!hasOverride && (toolName === 'browser_press_key' || toolName === 'browser_key')) {
    const key = browserKey(input.args);
    if (LOW_RISK_BROWSER_KEYS.has(key)) {
      return { mode: 'none', reason: `low-risk "${key}" keyboard navigation`, shouldRunAdvisor: false };
    }
  }
  if (!hasOverride && toolName === 'browser_scroll') {
    const multiplier = toScrollMultiplier(input.args);
    if (multiplier <= 1.1) {
      return { mode: 'none', reason: 'small browser scroll', shouldRunAdvisor: false };
    }
  }
  if (
    !hasOverride
    && repeats >= 2
    && isStableBrowserPage(before, after)
    && (toolName === 'browser_press_key' || toolName === 'browser_key' || toolName === 'browser_scroll')
  ) {
    return { mode: 'none', reason: 'repeated low-risk action on a stable page', shouldRunAdvisor: false };
  }

  let mode = requestedMode;
  let reason = hasOverride
    ? `explicit observe=${requestedMode}`
    : `tool default observe=${requestedMode}`;

  if (!hasOverride && (toolName === 'browser_press_key' || toolName === 'browser_key')) {
    const key = browserKey(input.args);
    if (key && ROUTINE_BROWSER_KEYS.has(key)) {
      mode = upgradeMode(mode, 'delta');
      reason = `routine key "${key}" merits DOM delta`;
    } else if (key) {
      mode = upgradeMode(mode, 'delta');
      reason = `keypress "${key}" may mutate page state`;
    }
  } else if (!hasOverride && toolName === 'browser_scroll') {
    mode = upgradeMode(mode, 'delta');
    reason = 'medium browser scroll merits DOM delta';
  } else if (
    !hasOverride
    && (
      toolName === 'browser_click'
      || toolName === 'browser_fill'
      || toolName === 'browser_click_and_download'
      || toolName === 'browser_scroll_collect'
      || toolName === 'browser_vision_type'
    )
  ) {
    mode = upgradeMode(mode, 'delta');
    reason = `${toolName} is an interactive browser mutation`;
  }

  return {
    mode,
    reason,
    shouldRunAdvisor: mode !== 'none' && mode !== 'compact',
  };
}

function decideDesktopObservation(
  input: PostActionObservationInput,
): PostActionObservationDecision {
  const toolName = String(input.toolName || '').trim();
  const repeats = Math.max(1, Math.floor(Number(input.recentRepeats || 1)));
  const failures = Math.max(0, Math.floor(Number(input.recentFailures || 0)));
  const before = input.desktop?.before || null;
  const after = input.desktop?.after || null;

  if (OBSERVATION_TOOL_REASONS[toolName]) {
    return OBSERVATION_TOOL_REASONS[toolName];
  }
  if (input.error) {
    return { mode: 'screenshot', reason: 'desktop action failed; capture current UI state', shouldRunAdvisor: true };
  }
  if (toolName === 'desktop_wait') {
    return { mode: 'none', reason: 'timing-only desktop wait', shouldRunAdvisor: false };
  }
  if (
    toolName === 'desktop_get_monitors'
    || toolName === 'desktop_list_installed_apps'
    || toolName === 'desktop_find_installed_app'
    || toolName === 'desktop_find_window'
    || toolName === 'desktop_get_process_list'
    || toolName === 'desktop_get_clipboard'
    || toolName === 'desktop_diff_screenshot'
    || toolName === 'desktop_get_window_text'
  ) {
    return { mode: 'none', reason: 'read-only desktop inspection tool', shouldRunAdvisor: false };
  }
  if (toolName === 'desktop_scroll' && toDesktopScrollAmount(input.args) <= 3) {
    return { mode: 'none', reason: 'small desktop scroll', shouldRunAdvisor: false };
  }
  if (
    toolName === 'desktop_click'
    && failures === 0
    && repeats >= 2
    && before?.activeWindowHandle
    && isStableDesktopPacket(before, after)
  ) {
    return { mode: 'none', reason: 'repeated click in the same confirmed window', shouldRunAdvisor: false };
  }
  if (failures > 0) {
    return { mode: 'screenshot', reason: 'same desktop action has failed recently', shouldRunAdvisor: true };
  }
  if (toolName === 'desktop_focus_window') {
    return { mode: 'screenshot', reason: 'focusing a window changes the active UI', shouldRunAdvisor: true };
  }
  if (toolName === 'desktop_drag') {
    return { mode: 'screenshot', reason: 'drag-and-drop needs post-action verification', shouldRunAdvisor: true };
  }
  if (toolName === 'desktop_launch_app' || toolName === 'desktop_close_app') {
    return { mode: 'screenshot', reason: 'app/window lifecycle changed', shouldRunAdvisor: true };
  }
  if (toolName === 'desktop_scroll') {
    return { mode: 'screenshot', reason: 'large desktop scroll should be verified visually', shouldRunAdvisor: true };
  }
  if (toolName === 'desktop_press_key' && DESKTOP_LIKELY_SUBMIT_KEY_RE.test(desktopKey(input.args))) {
    return { mode: 'screenshot', reason: 'desktop keypress likely submitted or closed UI', shouldRunAdvisor: true };
  }
  if (toolName === 'desktop_press_key') {
    return { mode: 'screenshot', reason: 'desktop keypress may have changed focused UI state', shouldRunAdvisor: true };
  }
  if (toolName === 'desktop_click') {
    return { mode: 'screenshot', reason: 'coordinate click is ambiguous without fresh visual verification', shouldRunAdvisor: true };
  }
  if (
    toolName === 'desktop_type'
    || toolName === 'desktop_type_raw'
    || toolName === 'desktop_set_clipboard'
  ) {
    return { mode: 'screenshot', reason: 'desktop text entry likely changed UI state', shouldRunAdvisor: true };
  }
  return { mode: 'none', reason: 'desktop action is low-risk and does not need inspection', shouldRunAdvisor: false };
}

export function summarizeBrowserObservationState(
  packet?: BrowserAdvisorPacket | null,
  fallback?: { url?: string; title?: string } | null,
): BrowserObservationPageState | null {
  if (!packet && !fallback?.url && !fallback?.title) return null;
  return {
    url: packet?.page?.url || fallback?.url,
    title: packet?.page?.title || fallback?.title,
    pageType: packet?.page?.pageType,
    contentHash: packet?.contentHash,
    snapshotElements: packet?.snapshotElements,
    modalOpen: packet ? browserModalOpen(packet.snapshot) : undefined,
    isGenerating: packet?.isGenerating,
  };
}

export function summarizeDesktopObservationState(
  packet?: DesktopAdvisorPacket | null,
): DesktopObservationPacketState | null {
  if (!packet) return null;
  return {
    activeWindowTitle: packet.activeWindow?.title,
    activeWindowProcessName: packet.activeWindow?.processName,
    activeWindowHandle: packet.activeWindow?.handle,
    activeMonitorIndex: packet.activeMonitorIndex,
    contentHash: packet.contentHash,
    captureMode: packet.captureMode,
    captureMonitorIndex: packet.captureMonitorIndex,
  };
}

export function decidePostActionObservation(
  input: PostActionObservationInput,
): PostActionObservationDecision {
  const toolName = String(input.toolName || '').trim();
  if (toolName.startsWith('browser_')) {
    return decideBrowserObservation(input);
  }
  if (toolName.startsWith('desktop_')) {
    return decideDesktopObservation(input);
  }
  return {
    mode: 'none',
    reason: 'non-visual tool',
    shouldRunAdvisor: false,
  };
}
