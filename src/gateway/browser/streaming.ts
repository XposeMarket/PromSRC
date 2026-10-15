import { browserLiveStreams, browserGeometryCache } from './state.js';
export { browserLiveStreams, browserGeometryCache } from './state.js';

/**
 * browser-tools.ts - Browser Automation for Prometheus
 *
 * Strategy: use the Electron in-house browser by default in the desktop app.
 * The Prometheus-owned Chrome/CDP lane and the user's Chrome extension remain
 * available as explicit secondary targets.
 * Background agents, tasks, and team agents get isolated persistent profiles
 * and CDP ports derived from their stable owner identity.
 *
 * Snapshot: DOM-based element scraping (reliable across all Playwright versions).
 * No dependency on deprecated page.accessibility or page.ariaSnapshot APIs.
 */

import fs from 'fs';
import path from 'path';

import { getConfig } from '../../config/config.js';

import { broadcastWS } from '../comms/broadcaster';

import { PersistedBrowserSessionRecord, BrowserInteractionMode, BrowserSessionRestoreHint, BrowserSession, BrowserTeachPhase, BrowserTeachStepSnapshot, BrowserTeachVerificationResult, BrowserTeachSessionSnapshot, BrowserInteractionState, BrowserUserAction, PwPage } from './types.js';
import { resolveSessionId } from './extraction.js';
import { browserTeachSessions, browserInteractionStates, sessions, browserControlWaiters } from './state.js';
import { buildBrowserSessionMetadataPayload } from './sessions.js';
import { readBrowserLiveSelectionBounds } from './selection-bounds.js';
import { describeLocator } from './snapshot.js';

export let browserSessionRegistryCache: Map<string, PersistedBrowserSessionRecord> | null = null;
export type BrowserLiveStreamFocus = 'passive' | 'interactive';
export type BrowserLiveStreamTransport = 'cdp' | 'snapshot';
export interface BrowserLiveStreamState {
  sessionId: string;
  active: boolean;
  focus: BrowserLiveStreamFocus;
  transport: BrowserLiveStreamTransport | null;
  status: string;
  startedAt: number;
  lastFrameAt: number;
  loopToken: number;
  leaseTimer: any;
  cdpSession: any | null;
  cdpFrameHandler: ((payload: any) => void) | null;
}
export const BROWSER_LIVE_STREAM_LEASE_MS = 20_000;
export const BROWSER_STREAM_HEARTBEAT_STATUS = 'Live browser stream ready.';
export function readBrowserLiveStreamNumberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}
export const BROWSER_LIVE_STREAM_JPEG_QUALITY_INTERACTIVE = readBrowserLiveStreamNumberEnv('PROMETHEUS_BROWSER_LIVE_STREAM_JPEG_QUALITY_INTERACTIVE', 88, 1, 100);
export const BROWSER_LIVE_STREAM_JPEG_QUALITY_PASSIVE = readBrowserLiveStreamNumberEnv('PROMETHEUS_BROWSER_LIVE_STREAM_JPEG_QUALITY_PASSIVE', 92, 1, 100);
export const BROWSER_LIVE_STREAM_CDP_SCALE = readBrowserLiveStreamNumberEnv('PROMETHEUS_BROWSER_LIVE_STREAM_CDP_SCALE', 1.35, 1, 2);

export function normalizeBrowserInteractionMode(mode: unknown): BrowserInteractionMode {
  const value = String(mode || '').trim().toLowerCase();
  if (value === 'copilot' || value === 'teach') return value;
  return 'agent';
}

export function getBrowserSessionRegistryPath(): string {
  return path.join(getConfig().getConfigDir(), 'browser-sessions.json');
}

export function shouldPersistBrowserSessionId(sessionId: string): boolean {
  const value = String(sessionId || '').trim();
  if (!value) return false;
  if (value.startsWith('__preview_internal__')) return false;
  if (value.startsWith('task_')) return false;
  if (value.includes('::')) return false;
  return true;
}

export function isRestorableBrowserUrl(rawUrl: string): boolean {
  const value = String(rawUrl || '').trim();
  if (!value) return false;
  if (/^about:/i.test(value)) return false;
  if (/^chrome:/i.test(value)) return false;
  if (/^devtools:/i.test(value)) return false;
  return true;
}

export function loadBrowserSessionRegistry(): Map<string, PersistedBrowserSessionRecord> {
  if (browserSessionRegistryCache) return browserSessionRegistryCache;
  const registry = new Map<string, PersistedBrowserSessionRecord>();
  const registryPath = getBrowserSessionRegistryPath();
  try {
    if (fs.existsSync(registryPath)) {
      const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      const entries = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
      for (const entry of entries) {
        const sessionId = String(entry?.sessionId || '').trim();
        if (!shouldPersistBrowserSessionId(sessionId)) continue;
        registry.set(sessionId, {
          sessionId,
          url: String(entry?.url || '').trim(),
          title: String(entry?.title || '').trim(),
          updatedAt: Number(entry?.updatedAt || 0) || 0,
        });
      }
    }
  } catch (err: any) {
    console.warn(`[Browser] Could not load persisted browser session registry: ${String(err?.message || err)}`);
  }
  browserSessionRegistryCache = registry;
  return registry;
}

export function writeBrowserSessionRegistry(registry: Map<string, PersistedBrowserSessionRecord> = loadBrowserSessionRegistry()): void {
  const registryPath = getBrowserSessionRegistryPath();
  try {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        sessions: [...registry.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
      }, null, 2),
      'utf-8',
    );
  } catch (err: any) {
    console.warn(`[Browser] Could not persist browser session registry: ${String(err?.message || err)}`);
  }
}

export function getPersistedBrowserSessionRecord(sessionId: string): PersistedBrowserSessionRecord | null {
  const resolved = String(sessionId || '').trim();
  if (!shouldPersistBrowserSessionId(resolved)) return null;
  return loadBrowserSessionRegistry().get(resolved) || null;
}

export function buildBrowserSessionRestoreRecord(
  sessionId: string,
  hint?: BrowserSessionRestoreHint | null,
): PersistedBrowserSessionRecord | null {
  const resolved = String(sessionId || '').trim();
  if (!shouldPersistBrowserSessionId(resolved)) return null;
  const persisted = getPersistedBrowserSessionRecord(resolved);
  if (persisted && isRestorableBrowserUrl(persisted.url)) return persisted;
  const hintedUrl = String(hint?.url || '').trim();
  if (isRestorableBrowserUrl(hintedUrl)) {
    return {
      sessionId: resolved,
      url: hintedUrl,
      title: String(hint?.title || '').trim(),
      updatedAt: Date.now(),
    };
  }
  return persisted;
}

export function upsertPersistedBrowserSessionRecord(record: PersistedBrowserSessionRecord): void {
  const sessionId = String(record?.sessionId || '').trim();
  if (!shouldPersistBrowserSessionId(sessionId)) return;
  const url = String(record?.url || '').trim();
  const title = String(record?.title || '').trim();
  if (!isRestorableBrowserUrl(url)) return;
  if (!url && !title) return;
  const registry = loadBrowserSessionRegistry();
  const previous = registry.get(sessionId);
  if (previous && previous.url === url && previous.title === title) return;
  registry.set(sessionId, {
    sessionId,
    url,
    title,
    updatedAt: Date.now(),
  });
  writeBrowserSessionRegistry(registry);
}

export function removePersistedBrowserSessionRecord(sessionId: string): void {
  const resolved = String(sessionId || '').trim();
  if (!shouldPersistBrowserSessionId(resolved)) return;
  const registry = loadBrowserSessionRegistry();
  if (!registry.delete(resolved)) return;
  writeBrowserSessionRegistry(registry);
}

export function normalizeBrowserRestoreUrl(rawUrl: string): string {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value.replace(/#.*$/, '');
  }
}

export async function findRestorableBrowserPage(
  pages: any[],
  record: PersistedBrowserSessionRecord | null,
): Promise<any | null> {
  if (!record || !Array.isArray(pages) || !pages.length) return null;
  const targetUrl = normalizeBrowserRestoreUrl(record.url);
  const targetTitle = String(record.title || '').trim();
  let bestPage: any | null = null;
  let bestScore = 0;
  for (const page of pages) {
    let pageUrl = '';
    let pageTitle = '';
    try { pageUrl = String(page?.url?.() || '').trim(); } catch {}
    try { pageTitle = String(await page?.title?.()).trim(); } catch {}
    let score = 0;
    if (targetUrl && normalizeBrowserRestoreUrl(pageUrl) === targetUrl) score += 4;
    if (targetTitle && pageTitle === targetTitle) score += 2;
    if (!targetUrl && targetTitle && pageTitle === targetTitle) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestPage = page;
    }
  }
  return bestScore > 0 ? bestPage : null;
}

export function persistBrowserSessionRecord(session: BrowserSession): void {
  const sessionId = String(session?.sessionId || '').trim();
  if (!shouldPersistBrowserSessionId(sessionId)) return;
  upsertPersistedBrowserSessionRecord({
    sessionId,
    url: String(session?.lastPageUrl || session?.page?.url?.() || '').trim(),
    title: String(session?.lastPageTitle || '').trim(),
    updatedAt: Date.now(),
  });
}

export function normalizeBrowserTeachPhase(phase: unknown): BrowserTeachPhase {
  const value = String(phase || '').trim().toLowerCase();
  if (value === 'recording' || value === 'approval_pending' || value === 'verifying' || value === 'verified') return value;
  return 'idle';
}

export function normalizeBrowserTeachRisk(risk: unknown): 'none' | 'high' {
  return String(risk || '').trim().toLowerCase() === 'high' ? 'high' : 'none';
}

export function sanitizeBrowserTeachStep(raw: any): BrowserTeachStepSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const toolName = String(raw.toolName || '').trim();
  if (!toolName) return null;
  const selection = raw.selection && typeof raw.selection === 'object'
    ? {
        selector: String(raw.selection.selector || '').trim(),
        tagName: String(raw.selection.tagName || '').trim(),
        id: String(raw.selection.id || '').trim(),
        text: String(raw.selection.text || '').trim(),
        bounds: raw.selection.bounds && typeof raw.selection.bounds === 'object'
          ? {
              x: Number(raw.selection.bounds.x || 0) || 0,
              y: Number(raw.selection.bounds.y || 0) || 0,
              width: Number(raw.selection.bounds.width || 0) || 0,
              height: Number(raw.selection.bounds.height || 0) || 0,
            }
          : null,
      }
    : null;
  return {
    id: String(raw.id || '').trim() || `teach-step-${Date.now()}`,
    kind: String(raw.kind || '').trim(),
    toolName,
    title: String(raw.title || '').trim(),
    summary: String(raw.summary || '').trim(),
    toolPreview: String(raw.toolPreview || '').trim(),
    targetName: String(raw.targetName || '').trim(),
    risk: normalizeBrowserTeachRisk(raw.risk),
    status: String(raw.status || '').trim() || 'recorded',
    createdAt: Number(raw.createdAt || 0) || 0,
    executedAt: Number(raw.executedAt || 0) || 0,
    pageUrl: String(raw.pageUrl || '').trim(),
    pageTitle: String(raw.pageTitle || '').trim(),
    resultSummary: String(raw.resultSummary || '').trim(),
    selection,
    input: raw.input && typeof raw.input === 'object' ? { ...raw.input } : {},
    args: raw.args && typeof raw.args === 'object' ? { ...raw.args } : {},
  };
}

export function sanitizeBrowserTeachVerification(raw: any): BrowserTeachVerificationResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const status = String(raw.status || '').trim().toLowerCase();
  const mode = String(raw.mode || '').trim().toLowerCase();
  return {
    status: status === 'failed' ? 'failed' : (status === 'partial' ? 'partial' : 'passed'),
    mode: mode === 'safe' ? 'safe' : (mode === 'step' ? 'step' : 'full'),
    boundaryLabel: String(raw.boundaryLabel || '').trim(),
    stopBeforeStep: Math.max(0, Number(raw.stopBeforeStep || 0) || 0),
    verifierSessionId: String(raw.verifierSessionId || '').trim(),
    executedCount: Math.max(0, Number(raw.executedCount || 0) || 0),
    totalRecordedSteps: Math.max(0, Number(raw.totalRecordedSteps || 0) || 0),
    riskyStepIndexes: Array.isArray(raw.riskyStepIndexes)
      ? raw.riskyStepIndexes.map((value: any) => Math.max(0, Number(value || 0) || 0)).filter(Boolean)
      : [],
    failedStep: Math.max(0, Number(raw.failedStep || 0) || 0) || undefined,
    failureSummary: String(raw.failureSummary || '').trim() || undefined,
    finalUrl: String(raw.finalUrl || '').trim(),
    finalTitle: String(raw.finalTitle || '').trim(),
    startedAt: Number(raw.startedAt || 0) || 0,
    completedAt: Number(raw.completedAt || 0) || 0,
  };
}

export function sanitizeBrowserTeachSession(raw: any): BrowserTeachSessionSnapshot {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    active: source.active === true,
    phase: normalizeBrowserTeachPhase(source.phase),
    startedAt: Number(source.startedAt || 0) || 0,
    completedAt: Number(source.completedAt || 0) || 0,
    approvalRequestedAt: Number(source.approvalRequestedAt || 0) || 0,
    reviewRequestedAt: Number(source.reviewRequestedAt || 0) || 0,
    startUrl: String(source.startUrl || '').trim(),
    startTitle: String(source.startTitle || '').trim(),
    executingStepId: String(source.executingStepId || '').trim(),
    steps: Array.isArray(source.steps)
      ? source.steps.map((step: any) => sanitizeBrowserTeachStep(step)).filter(Boolean) as BrowserTeachStepSnapshot[]
      : [],
    pendingStep: sanitizeBrowserTeachStep(source.pendingStep),
    verification: sanitizeBrowserTeachVerification(source.verification),
  };
}

export function saveBrowserTeachSessionSnapshot(sessionId: string, payload: any): BrowserTeachSessionSnapshot {
  const resolved = resolveSessionId(sessionId);
  const sanitized = sanitizeBrowserTeachSession(payload);
  browserTeachSessions.set(resolved, sanitized);
  return sanitized;
}

export function clearBrowserTeachSessionSnapshot(sessionId: string): void {
  browserTeachSessions.delete(resolveSessionId(sessionId));
}

export function getBrowserTeachSessionSnapshot(sessionId: string): BrowserTeachSessionSnapshot | null {
  return browserTeachSessions.get(resolveSessionId(sessionId)) || null;
}

export function resolveBrowserInteractionStateId(sessionId: string): string {
  const resolved = resolveSessionId(sessionId);
  if (String(sessionId || '').startsWith('task_')) {
    try {
      const taskId = String(sessionId || '').slice('task_'.length);
      const { loadTask } = require('../tasks/task-store') as typeof import('../tasks/task-store');
      const task = loadTask(taskId);
      const parentId = String(task?.sessionId || '').trim();
      if (parentId && (browserInteractionStates.has(parentId) || sessions.has(parentId))) {
        return parentId;
      }
    } catch {
      // Fall back to the resolved session id below.
    }
  }
  return resolved;
}

export function getOrCreateBrowserInteractionState(sessionId: string): BrowserInteractionState {
  const resolved = resolveBrowserInteractionStateId(sessionId);
  const existing = browserInteractionStates.get(resolved);
  if (existing) return existing;
  const created: BrowserInteractionState = {
    mode: 'agent',
    captured: false,
    controlOwner: 'agent',
    lastInputAt: 0,
    recentUserActions: [],
    lastActor: 'system',
    lastActorSummary: 'Browser session ready.',
    updatedAt: Date.now(),
  };
  browserInteractionStates.set(resolved, created);
  return created;
}

export function recordBrowserUserAction(sessionId: string, action: BrowserUserAction): BrowserInteractionState {
  const state = getOrCreateBrowserInteractionState(sessionId);
  state.captured = true;
  state.controlOwner = 'user';
  state.lastInputAt = Number(action.timestamp || Date.now()) || Date.now();
  state.lastActor = 'user';
  state.lastActorSummary = action.summary;
  state.updatedAt = Number(action.timestamp || Date.now()) || Date.now();
  state.recentUserActions = [action, ...state.recentUserActions]
    .slice(0, 6)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  return state;
}

export function clearBrowserInteractionState(sessionId: string): void {
  const resolved = resolveBrowserInteractionStateId(sessionId);
  browserInteractionStates.delete(resolved);
  browserControlWaiters.delete(resolved);
  if (resolved !== sessionId) browserInteractionStates.delete(sessionId);
}

export function releaseBrowserControlWaiters(sessionId: string): void {
  const resolved = resolveBrowserInteractionStateId(sessionId);
  const waiters = browserControlWaiters.get(resolved) || [];
  browserControlWaiters.delete(resolved);
  for (const resolve of waiters) {
    try { resolve(); } catch {}
  }
}

export function setBrowserInteractionModeState(sessionId: string, mode: unknown): BrowserInteractionState {
  const state = getOrCreateBrowserInteractionState(sessionId);
  state.mode = normalizeBrowserInteractionMode(mode);
  if (state.mode === 'agent') {
    state.captured = false;
    state.controlOwner = 'agent';
    releaseBrowserControlWaiters(sessionId);
  }
  state.lastActor = 'system';
  state.lastActorSummary = `Browser interaction mode is now ${state.mode}.`;
  state.updatedAt = Date.now();
  return state;
}

export function setBrowserControlCaptureState(
  sessionId: string,
  options: { captured: boolean; owner?: 'agent' | 'user'; reason?: string },
): BrowserInteractionState {
  const state = getOrCreateBrowserInteractionState(sessionId);
  state.captured = options.captured === true;
  state.controlOwner = state.captured ? (options.owner === 'agent' ? 'agent' : 'user') : 'agent';
  state.updatedAt = Date.now();
  if (!state.captured) {
    state.lastActor = 'system';
    state.lastActorSummary = String(options.reason || 'Browser control returned to Prometheus.').trim();
    releaseBrowserControlWaiters(sessionId);
  } else {
    state.lastActor = 'user';
    state.lastActorSummary = String(options.reason || 'User is controlling the browser in Co-pilot mode.').trim();
    state.lastInputAt = state.updatedAt;
  }
  return state;
}

export async function waitForBrowserControlRelease(
  sessionId: string,
  toolName: string,
  timeoutMs = 120_000,
): Promise<void> {
  const resolved = resolveBrowserInteractionStateId(sessionId);
  const state = browserInteractionStates.get(resolved);
  if (!state || !state.captured || state.controlOwner !== 'user') return;
  if (state.mode !== 'copilot' && state.mode !== 'teach') return;
  try {
    broadcastWS({
      type: 'browser:control',
      sessionId: resolveSessionId(sessionId),
      mode: state.mode,
      captured: true,
      controlOwner: 'user',
      statusLabel: `Waiting for you to release browser control before ${toolName}.`,
      waitingTool: toolName,
      timestamp: Date.now(),
    });
  } catch {
    // Best effort UI cue only.
  }
  await new Promise<void>((resolve, reject) => {
    const waiters = browserControlWaiters.get(resolved) || [];
    const onRelease = () => {
      clearTimeout(timeoutHandle);
      resolve();
    };
    const timeoutHandle = setTimeout(() => {
      const current = browserControlWaiters.get(resolved) || [];
      browserControlWaiters.set(resolved, current.filter((entry) => entry !== onRelease));
      reject(new Error(`Browser tool "${toolName}" paused for user Co-pilot control and timed out waiting for release.`));
    }, Math.max(5_000, Math.min(timeoutMs, 300_000)));
    waiters.push(onRelease);
    browserControlWaiters.set(resolved, waiters);
  });
}

export function formatBrowserInteractionContextBlock(sessionId: string): string {
  const resolved = resolveBrowserInteractionStateId(sessionId);
  const state = browserInteractionStates.get(resolved);
  if (!state) return '';
  const mode = normalizeBrowserInteractionMode(state.mode);
  const actions = Array.isArray(state.recentUserActions) ? state.recentUserActions.slice(0, 3) : [];
  if (mode === 'agent' && !actions.length && state.lastActor !== 'user') return '';
  const lines: string[] = [
    '[BROWSER CONTROL]',
    `mode=${mode}`,
    `captured=${state.captured ? 'yes' : 'no'}`,
    `control_owner=${state.controlOwner}`,
  ];
  if (state.lastActorSummary) {
    lines.push(`last_event=${state.lastActorSummary}`);
  }
  if (actions.length) {
    lines.push('recent_user_actions:');
    for (const action of actions) {
      const timeLabel = new Date(Number(action.timestamp || Date.now())).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      });
      lines.push(`- ${timeLabel}: ${action.summary}`);
    }
  }
  if (state.captured && state.controlOwner === 'user') {
    lines.push('The user currently has the browser captured. Agent browser actions should wait until release.');
  }
  if (mode === 'copilot' || mode === 'teach' || actions.length) {
    lines.push('If the page changed without a browser tool call, assume the user changed it in Co-pilot/Teach mode and continue from the current page state.');
  }
  return lines.join('\n');
}

export function normalizeBrowserLiveStreamFocus(focus: unknown): BrowserLiveStreamFocus {
  return String(focus || '').trim().toLowerCase() === 'interactive' ? 'interactive' : 'passive';
}

export function getBrowserViewportSize(session: BrowserSession): { width: number; height: number } {
  const viewport = session.page.viewportSize?.() || null;
  return {
    width: Number(viewport?.width || 1280),
    height: Number(viewport?.height || 720),
  };
}

export interface BrowserPageGeometry {
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
  bitmapWidth: number;
  bitmapHeight: number;
  capturedAt: number;
}

export async function readBrowserPageGeometry(
  sessionId: string,
  options: { maxAgeMs?: number } = {},
): Promise<BrowserPageGeometry> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  const fallbackViewport = session ? getBrowserViewportSize(session) : { width: 1280, height: 720 };
  const fallback: BrowserPageGeometry = {
    viewportWidth: fallbackViewport.width,
    viewportHeight: fallbackViewport.height,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 1,
    bitmapWidth: fallbackViewport.width,
    bitmapHeight: fallbackViewport.height,
    capturedAt: 0,
  };
  if (!session) return fallback;
  const cached = browserGeometryCache.get(resolved);
  const maxAge = Number(options.maxAgeMs ?? 250);
  if (cached && (Date.now() - cached.capturedAt) < maxAge) return cached;
  try {
    const geom = await session.page.evaluate(() => {
      const w: any = (globalThis as any);
      return {
        viewportWidth: Math.round(Number(w?.innerWidth || 0)),
        viewportHeight: Math.round(Number(w?.innerHeight || 0)),
        scrollX: Math.round(Number(w?.scrollX || w?.pageXOffset || 0)),
        scrollY: Math.round(Number(w?.scrollY || w?.pageYOffset || 0)),
        devicePixelRatio: Number(w?.devicePixelRatio || 1) || 1,
      };
    });
    const vw = Number(geom?.viewportWidth) || fallback.viewportWidth;
    const vh = Number(geom?.viewportHeight) || fallback.viewportHeight;
    const dpr = Number(geom?.devicePixelRatio) || 1;
    const next: BrowserPageGeometry = {
      viewportWidth: vw,
      viewportHeight: vh,
      scrollX: Math.max(0, Number(geom?.scrollX) || 0),
      scrollY: Math.max(0, Number(geom?.scrollY) || 0),
      devicePixelRatio: dpr,
      bitmapWidth: Math.max(1, Math.round(vw * dpr)),
      bitmapHeight: Math.max(1, Math.round(vh * dpr)),
      capturedAt: Date.now(),
    };
    browserGeometryCache.set(resolved, next);
    return next;
  } catch {
    return cached || fallback;
  }
}

export function invalidateBrowserGeometryCache(sessionId: string): void {
  try { browserGeometryCache.delete(resolveSessionId(sessionId)); } catch {}
}

export function clearBrowserLiveStreamLease(stream: BrowserLiveStreamState | null | undefined): void {
  if (!stream?.leaseTimer) return;
  try { clearTimeout(stream.leaseTimer); } catch {}
  stream.leaseTimer = null;
}

export async function broadcastBrowserLiveStreamStatus(
  sessionId: string,
  stream: BrowserLiveStreamState | null,
  overrides?: Partial<{
    active: boolean;
    transport: BrowserLiveStreamTransport | '';
    focus: BrowserLiveStreamFocus;
    status: string;
  }>,
): Promise<void> {
  try {
    const resolved = resolveSessionId(sessionId);
    const session = sessions.get(resolved);
    const interactionState = getOrCreateBrowserInteractionState(resolved);
    broadcastWS({
      type: 'browser:stream_status',
      sessionId: resolved,
      active: overrides?.active ?? (stream?.active === true),
      transport: overrides?.transport ?? (stream?.transport || ''),
      focus: overrides?.focus ?? (stream?.focus || 'passive'),
      status: String(overrides?.status || stream?.status || '').trim(),
      url: String(session?.lastPageUrl || session?.page?.url?.() || ''),
      title: String(session?.lastPageTitle || ''),
      mode: interactionState.mode,
      captured: interactionState.captured,
      controlOwner: interactionState.controlOwner,
      timestamp: Date.now(),
      ...buildBrowserSessionMetadataPayload(resolved),
    });
  } catch {
    // Best-effort UI status only.
  }
}

export function refreshBrowserLiveStreamLease(sessionId: string): void {
  const resolved = resolveSessionId(sessionId);
  const stream = browserLiveStreams.get(resolved);
  if (!stream) return;
  clearBrowserLiveStreamLease(stream);
  stream.leaseTimer = setTimeout(() => {
    stopBrowserLiveStream(resolved, 'Live browser stream stopped after inactivity.').catch(() => {});
  }, BROWSER_LIVE_STREAM_LEASE_MS);
}

export async function emitBrowserLiveFrame(
  sessionId: string,
  transport: BrowserLiveStreamTransport,
  frameBase64: string,
  width: number,
  height: number,
  frameFormat: 'jpeg' | 'png',
  geometry?: BrowserPageGeometry | null,
): Promise<void> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session || !frameBase64) return;
  const stream = browserLiveStreams.get(resolved);
  if (stream) stream.lastFrameAt = Date.now();
  const interactionState = getOrCreateBrowserInteractionState(resolved);
  const geom = geometry || await readBrowserPageGeometry(resolved, { maxAgeMs: 500 }).catch(() => null);
  const liveSelection = await readBrowserLiveSelectionBounds(resolved).catch(() => null);
  broadcastWS({
    type: 'browser:frame',
    sessionId: resolved,
    active: true,
    transport,
    focus: stream?.focus || 'passive',
    mode: interactionState.mode,
    captured: interactionState.captured,
    controlOwner: interactionState.controlOwner,
    url: String(session.lastPageUrl || session.page.url?.() || ''),
    title: String(session.lastPageTitle || ''),
    frameBase64,
    frameWidth: width,
    frameHeight: height,
    frameFormat,
    bitmapWidth: Number(geom?.bitmapWidth || width || 0),
    bitmapHeight: Number(geom?.bitmapHeight || height || 0),
    viewportWidth: Number(geom?.viewportWidth || width || 0),
    viewportHeight: Number(geom?.viewportHeight || height || 0),
    scrollX: Number(geom?.scrollX || 0),
    scrollY: Number(geom?.scrollY || 0),
    devicePixelRatio: Number(geom?.devicePixelRatio || 1),
    liveSelection,
    timestamp: Date.now(),
    ...buildBrowserSessionMetadataPayload(resolved),
  });
}

export async function emitBrowserAgentCursor(
  sessionId: string,
  payload: {
    x?: number;
    y?: number;
    kind?: 'move' | 'click' | 'fill' | 'type' | 'key' | 'scroll' | 'navigate' | 'wait';
    phase?: 'start' | 'active' | 'end';
    label?: string;
  } = {},
): Promise<void> {
  try {
    const resolved = resolveSessionId(sessionId);
    const session = sessions.get(resolved);
    if (!session) return;
    const viewport = getBrowserViewportSize(session);
    const rawX = Number(payload.x);
    const rawY = Number(payload.y);
    const hasPoint = Number.isFinite(rawX) && Number.isFinite(rawY);
    broadcastWS({
      type: 'browser:agent_cursor',
      sessionId: resolved,
      x: hasPoint ? Math.round(rawX) : Math.round(viewport.width / 2),
      y: hasPoint ? Math.round(rawY) : Math.round(viewport.height / 2),
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      kind: payload.kind || 'move',
      phase: payload.phase || 'active',
      label: String(payload.label || '').trim(),
      url: String(session.lastPageUrl || session.page.url?.() || ''),
      title: String(session.lastPageTitle || ''),
      timestamp: Date.now(),
    });
  } catch {
    // Cursor telemetry is visual-only.
  }
}

export async function resolveSelectorViewportCenter(
  page: PwPage,
  selector: string,
  labelPrefix: string,
): Promise<null | { x: number; y: number; label: string }> {
  const value = String(selector || '').trim();
  if (!value) return null;
  try {
    const locator = page.locator(value).first();
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const meta = await describeLocator(locator);
    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) return null;
    return {
      x: Math.round(box.x + (box.width / 2)),
      y: Math.round(box.y + (box.height / 2)),
      label: `${labelPrefix} (${meta.role}: "${meta.name}")`,
    };
  } catch {
    return null;
  }
}

export async function resolveActiveElementViewportCenter(
  page: PwPage,
): Promise<null | { x: number; y: number; label: string }> {
  try {
    return await page.evaluate(() => {
      const doc = (globalThis as any).document as any;
      const active = doc?.activeElement as any;
      const rect = active && typeof active.getBoundingClientRect === 'function'
        ? active.getBoundingClientRect()
        : null;
      const viewportWidth = Math.round((globalThis as any).innerWidth || 0);
      const viewportHeight = Math.round((globalThis as any).innerHeight || 0);
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { x: Math.round(viewportWidth / 2), y: Math.round(viewportHeight / 2), label: 'focused page' };
      }
      const label = String(
        active?.getAttribute?.('aria-label')
        || active?.getAttribute?.('placeholder')
        || active?.innerText
        || active?.tagName
        || 'focused element',
      ).replace(/\s+/g, ' ').trim().slice(0, 80);
      return {
        x: Math.round(rect.left + (rect.width / 2)),
        y: Math.round(rect.top + (rect.height / 2)),
        label: label || 'focused element',
      };
    });
  } catch {
    return null;
  }
}

export async function browserHasEditableFocus(page: PwPage): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const active = doc?.activeElement as any;
      if (!active || active === doc?.body) return false;
      const tag = String(active.tagName || '').toLowerCase();
      const role = String(active.getAttribute?.('role') || '').toLowerCase();
      const type = String(active.getAttribute?.('type') || '').toLowerCase();
      if (active.isContentEditable || active.getAttribute?.('contenteditable') === 'true') return true;
      if (tag === 'textarea') return true;
      if (tag === 'input') {
        return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'].includes(type);
      }
      return role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton';
    });
  } catch {
    return false;
  }
}

export async function startBrowserSnapshotStreamLoop(
  sessionId: string,
  stream: BrowserLiveStreamState,
): Promise<void> {
  const resolved = resolveSessionId(sessionId);
  const token = (stream.loopToken += 1);
  stream.transport = 'snapshot';
  stream.status = 'Live screenshot stream active.';
  browserLiveStreams.set(resolved, stream);
  await broadcastBrowserLiveStreamStatus(resolved, stream, { active: true });
  void (async () => {
    while (true) {
      const current = browserLiveStreams.get(resolved);
      if (!current || !current.active || current.loopToken !== token || current.transport !== 'snapshot') break;
      const session = sessions.get(resolved);
      if (!session) break;
      const viewport = getBrowserViewportSize(session);
      try {
        const buf: Buffer = await session.page.screenshot({
          type: 'jpeg',
          quality: current.focus === 'interactive'
            ? BROWSER_LIVE_STREAM_JPEG_QUALITY_INTERACTIVE
            : BROWSER_LIVE_STREAM_JPEG_QUALITY_PASSIVE,
          fullPage: false,
        });
        const geom = await readBrowserPageGeometry(resolved, { maxAgeMs: 400 }).catch(() => null);
        await emitBrowserLiveFrame(resolved, 'snapshot', buf.toString('base64'), viewport.width, viewport.height, 'jpeg', geom);
      } catch (err: any) {
        const message = String(err?.message || err || '').toLowerCase();
        if (message.includes('closed') || message.includes('target page') || message.includes('context')) {
          await stopBrowserLiveStream(resolved, 'Live browser stream ended because the page closed.');
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, current.focus === 'interactive' ? 90 : 220));
    }
  })().catch(() => {});
}

export async function tryStartBrowserCDPStream(
  sessionId: string,
  stream: BrowserLiveStreamState,
): Promise<boolean> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session?.context?.newCDPSession || !session?.page) return false;
  const viewport = getBrowserViewportSize(session);
  const token = (stream.loopToken += 1);
  try {
    const cdp = await session.context.newCDPSession(session.page);
    const onFrame = (payload: any) => {
      const current = browserLiveStreams.get(resolved);
      const shotData = String(payload?.data || '');
      if (!shotData) {
        void cdp.send('Page.screencastFrameAck', { sessionId: payload?.sessionId }).catch(() => {});
        return;
      }
      if (!current || !current.active || current.loopToken !== token || current.transport !== 'cdp') {
        void cdp.send('Page.screencastFrameAck', { sessionId: payload?.sessionId }).catch(() => {});
        return;
      }
      const minIntervalMs = current.focus === 'interactive' ? 60 : 140;
      if (current.lastFrameAt > 0 && (Date.now() - current.lastFrameAt) < minIntervalMs) {
        void cdp.send('Page.screencastFrameAck', { sessionId: payload?.sessionId }).catch(() => {});
        return;
      }
      void cdp.send('Page.screencastFrameAck', { sessionId: payload?.sessionId }).catch(() => {});
      // CDP includes per-frame metadata: deviceWidth/Height (CSS-px viewport), pageScaleFactor,
      // and scrollOffsetX/Y. Prefer these over a cached page.evaluate when present.
      const meta = payload?.metadata || {};
      const cdpGeom: BrowserPageGeometry | null = (Number(meta?.deviceWidth) > 0 && Number(meta?.deviceHeight) > 0)
        ? {
            viewportWidth: Math.round(Number(meta.deviceWidth) || viewport.width),
            viewportHeight: Math.round(Number(meta.deviceHeight) || viewport.height),
            scrollX: Math.max(0, Math.round(Number(meta?.scrollOffsetX) || 0)),
            scrollY: Math.max(0, Math.round(Number(meta?.scrollOffsetY) || 0)),
            devicePixelRatio: Number(meta?.pageScaleFactor) || 1,
            bitmapWidth: Math.max(1, Math.round((Number(meta.deviceWidth) || viewport.width) * (Number(meta?.pageScaleFactor) || 1))),
            bitmapHeight: Math.max(1, Math.round((Number(meta.deviceHeight) || viewport.height) * (Number(meta?.pageScaleFactor) || 1))),
            capturedAt: Date.now(),
          }
        : null;
      void (async () => {
        const geom = cdpGeom || await readBrowserPageGeometry(resolved, { maxAgeMs: 500 }).catch(() => null);
        await emitBrowserLiveFrame(
          resolved,
          'cdp',
          shotData,
          viewport.width,
          viewport.height,
          'jpeg',
          geom,
        );
      })().catch(() => {});
    };
    stream.transport = 'cdp';
    stream.status = 'Live CDP stream active.';
    stream.cdpSession = cdp;
    stream.cdpFrameHandler = onFrame;
    browserLiveStreams.set(resolved, stream);
    cdp.on?.('Page.screencastFrame', onFrame);
    await cdp.send('Page.enable');
    const cdpMaxWidth = Math.max(viewport.width, Math.round(viewport.width * BROWSER_LIVE_STREAM_CDP_SCALE));
    const cdpMaxHeight = Math.max(viewport.height, Math.round(viewport.height * BROWSER_LIVE_STREAM_CDP_SCALE));
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: stream.focus === 'interactive'
        ? BROWSER_LIVE_STREAM_JPEG_QUALITY_INTERACTIVE
        : BROWSER_LIVE_STREAM_JPEG_QUALITY_PASSIVE,
      maxWidth: cdpMaxWidth,
      maxHeight: cdpMaxHeight,
      everyNthFrame: stream.focus === 'interactive' ? 1 : 2,
    });
    await broadcastBrowserLiveStreamStatus(resolved, stream, { active: true });
    setTimeout(() => {
      const current = browserLiveStreams.get(resolved);
      if (!current || !current.active || current.loopToken !== token || current.transport !== 'cdp' || current.lastFrameAt > 0) return;
      void (async () => {
        try {
          const currentCdp = current.cdpSession;
          const currentHandler = current.cdpFrameHandler;
          if (currentCdp && currentHandler) {
            if (typeof currentCdp.off === 'function') currentCdp.off('Page.screencastFrame', currentHandler);
            else if (typeof currentCdp.removeListener === 'function') currentCdp.removeListener('Page.screencastFrame', currentHandler);
          }
          await currentCdp?.send?.('Page.stopScreencast').catch(() => {});
          await currentCdp?.detach?.().catch(() => {});
        } catch {}
        current.cdpSession = null;
        current.cdpFrameHandler = null;
        current.transport = null;
        current.status = 'CDP stream stalled. Falling back to screenshot stream.';
        browserLiveStreams.set(resolved, current);
        await broadcastBrowserLiveStreamStatus(resolved, current, {
          active: true,
          transport: '',
          status: current.status,
        });
        await startBrowserSnapshotStreamLoop(resolved, current);
      })().catch(() => {});
    }, 1500);
    return true;
  } catch (err: any) {
    try {
      const cdp = stream.cdpSession;
      const handler = stream.cdpFrameHandler;
      if (cdp && handler) {
        if (typeof cdp.off === 'function') cdp.off('Page.screencastFrame', handler);
        else if (typeof cdp.removeListener === 'function') cdp.removeListener('Page.screencastFrame', handler);
      }
      await cdp?.send?.('Page.stopScreencast').catch(() => {});
      await cdp?.detach?.().catch(() => {});
    } catch {}
    stream.cdpSession = null;
    stream.cdpFrameHandler = null;
    stream.transport = null;
    stream.status = `CDP live stream unavailable: ${String(err?.message || err || 'unknown error')}`;
    browserLiveStreams.set(resolved, stream);
    await broadcastBrowserLiveStreamStatus(resolved, stream, {
      active: true,
      transport: '',
      status: 'CDP live stream unavailable. Falling back to screenshot stream.',
    });
    return false;
  }
}

export async function stopBrowserLiveStream(
  sessionId: string,
  reason: string = 'Live browser stream stopped.',
): Promise<void> {
  const resolved = resolveSessionId(sessionId);
  const stream = browserLiveStreams.get(resolved);
  if (!stream) return;
  browserLiveStreams.delete(resolved);
  clearBrowserLiveStreamLease(stream);
  stream.active = false;
  stream.status = String(reason || 'Live browser stream stopped.').trim();
  stream.loopToken += 1;
  try {
    const cdp = stream.cdpSession;
    const handler = stream.cdpFrameHandler;
    if (cdp && handler) {
      if (typeof cdp.off === 'function') cdp.off('Page.screencastFrame', handler);
      else if (typeof cdp.removeListener === 'function') cdp.removeListener('Page.screencastFrame', handler);
    }
    await cdp?.send?.('Page.stopScreencast').catch(() => {});
    await cdp?.detach?.().catch(() => {});
  } catch {}
  stream.cdpSession = null;
  stream.cdpFrameHandler = null;
  await broadcastBrowserLiveStreamStatus(resolved, stream, {
    active: false,
    transport: stream.transport || '',
    focus: stream.focus,
    status: stream.status,
  });
}
