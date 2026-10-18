
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
import os from 'os';
import { formatShortcutsForUrl } from './site-shortcuts';
import {
  type BrowserKnowledgeExtractionField,
  type BrowserKnowledgeExtractionSchema,
  formatNamedBrowserElementsForUrl,
  listNamedBrowserElementsForUrl,
  listNamedBrowserExtractionSchemasForUrl,
  listNamedBrowserItemRootsForUrl,
  matchNamedBrowserElementForUrl,
  matchNamedBrowserExtractionSchemaForUrl,
  matchNamedBrowserItemRootForUrl,
  saveNamedBrowserElementForUrl,
  saveNamedBrowserExtractionSchemaForUrl,
  saveNamedBrowserItemRootForUrl,
  type BrowserKnowledgeElement,
  type BrowserKnowledgeItemRoot,
  type BrowserSiteKnowledge,
} from './browser-site-knowledge.js';
import { getConfig } from '../config/config.js';
import { getActiveWorkspace } from '../tools/workspace-context.js';
import { broadcastWS } from './comms/broadcaster';
import { normalizeScreenshotBuffer } from './screenshot-normalize.js';
import { createUserChromePage, UserChromePage } from './user-chrome-transport.js';
import { getUserChromeExtensionOnboarding, getUserChromeRelay } from './user-chrome-relay.js';
import { getResourceStore, redactResourceText } from './resources/resource-store';
import { normalizeBrowserSessionId } from './browser-session-identity';
import { BrowserSessionRestoreHint, BrowserInteractionMode, BrowserSession, BrowserObserveMode, BrowserProfileKind, BrowserPerformanceObserver, markBrowserPerformance, classifyBrowserLifecycleError, BrowserFeedItem, BrowserScrollSnapshotDelta, BrowserPageType, BrowserAdvisorPacket, BrowserUserAction, BrowserTeachStepSnapshot, BrowserTeachVerificationResult, BrowserSessionInfo, BrowserSessionListEntry, PwPage } from './browser/types.js';
import { BrowserLiveStreamFocus, buildBrowserSessionRestoreRecord, isRestorableBrowserUrl, getOrCreateBrowserInteractionState, resolveBrowserInteractionStateId, normalizeBrowserRestoreUrl, browserLiveStreams, emitBrowserAgentCursor, stopBrowserLiveStream, resolveSelectorViewportCenter, resolveActiveElementViewportCenter, removePersistedBrowserSessionRecord, getBrowserViewportSize, normalizeBrowserInteractionMode, browserHasEditableFocus, setBrowserControlCaptureState, recordBrowserUserAction, normalizeBrowserTeachRisk, getBrowserTeachSessionSnapshot } from './browser/streaming.js';
import { resolveSessionId, parseSnapshotElementCount, pressKey, stableHash, extractStructuredFromPage, buildAdvisorPacketForSession, BrowserSelectorPack, buildBrowserSelectorPack } from './browser/extraction.js';
import { getInHouseSession, normalizeInHouseProfileId, isInHouseBrowserAvailable, callInHouseBrowser, inHouseUnsupportedToolMessage, normalizeInHouseTabs } from './browser/inhouse.js';
import { shouldUseInHouseBrowser, clearInHouseSession, recoverInHouseSessionMapping, upsertInHouseSession, broadcastInHouseBrowserStatus } from './browser/inhouse-sessions.js';
import { browserOpenInHouse, browserSnapshotInHouse, browserClickInHouse, browserFillInHouse, BrowserKeyOptions, browserPressKeyInHouse, browserTypeInHouse, browserRunJsInHouse, browserVisionScreenshotInHouse } from './browser/inhouse-actions.js';
import { browserKnowledgeHostFromUrl, rememberPageMetadata, resolveBrowserObserveMode, BrowserCompactState, shouldUseCompactObservation, captureCompactBrowserState, syncPageMetadata, shouldReturnSnapshot, rememberSnapshot, attachShortcutsContext, buildCompactBrowserObservation, buildMinimalBrowserAck, shouldUseFastBrowserAck } from './browser/observation.js';
import { getOrCreateSession, isSessionAlive, replaceDetachedBrowserSession } from './browser/profiles.js';
import { buildBrowserSessionMetadataPayload, getBrowserSessionMetadata, releaseUserChromeTabLocks, registerBrowserSessionMetadata, formatBrowserSessionOriginLabel } from './browser/sessions.js';
import { normalizeBrowserProfileKind, getBrowserProfileLabel, terminateLaunchedChrome, findChromeProcessesByProfilePrefix, killProcessTree } from './browser/chrome.js';
import { getPersistentBrowserProfileRoot } from './browser/profiles.js';
import { inHouseProfilePreferences, inHouseOptOutSessions, inHouseTargetSessions, sessions, browserLinkNavigationInFlight, browserSessionMetadata, browserSessionInitInFlight, setLastBrowserScreenshot, getLastBrowserScreenshot, inHouseSessions, browserTeachSessions, browserInteractionStates } from './browser/state.js';
import { browserSetProfileTarget } from './browser/tabs.js';
import { getMainBrowserTarget } from './browser/target.js';
import { takeSnapshot, clickBySelector, resolveViewportPointFromTarget, clickByRef, fillBySelector, fillByRef, INTERACTIVE_SELECTOR } from './browser/snapshot.js';
import { clearBrowserSessionEphemeralState, setBrowserLiveSelectionTracker } from './browser/selection.js';
import { toUploadPaths, persistBrowserDownload } from './browser/downloads.js';
import { buildBrowserRunJsEnvelopeSource, formatBrowserRunJsEnvelope } from './browser/diagnostics.js';
export type { BrowserProfileKind, BrowserSessionMetadata, BrowserPerformanceObserver, BrowserInteractionMode, BrowserUserAction, BrowserSessionInfo, BrowserSessionListEntry, BrowserTeachPhase, BrowserTeachStepSnapshot, BrowserTeachVerificationResult, BrowserTeachSessionSnapshot, BrowserPageType, BrowserFeedItem, BrowserAdvisorPacket, BrowserObserveMode } from './browser/types.js';
export { resolveBrowserObserveMode } from './browser/observation.js';
export { setLastBrowserScreenshot, getLastBrowserScreenshot, clearLastBrowserScreenshot, getLastBrowserDownload } from './browser/state.js';
export type { BrowserVisionScreenshotCacheEntry } from './browser/state.js';
export { registerBrowserSessionMetadata, getBrowserRefLabel, getBrowserSessionMetadata } from './browser/sessions.js';
export { saveBrowserTeachSessionSnapshot, clearBrowserTeachSessionSnapshot, getBrowserTeachSessionSnapshot, setBrowserInteractionModeState, setBrowserControlCaptureState, waitForBrowserControlRelease, formatBrowserInteractionContextBlock, stopBrowserLiveStream } from './browser/streaming.js';
export { SHARED_SUBAGENT_BROWSER_PROFILE } from './browser/inhouse.js';
export { syncInHouseBrowserState, setInHouseBrowserProfilePreference, resolveAgentBrowserProfileSetting } from './browser/inhouse-sessions.js';
export { resolveSessionId } from './browser/extraction.js';
export type { BrowserSelectorPack } from './browser/extraction.js';
export { clearBrowserLiveSelectionTracker, setBrowserLiveSelectionFromPack, browserGetInteractableMap } from './browser/selection.js';
export { browserLoginHandoffView, browserLoginHandoffState, browserLoginHandoffNavigate, browserLoginImportFromChrome, browserLoginChromePaired, browserLoginHandoffFrame } from './browser/inhouse-actions.js';
export type { BrowserKeyOptions } from './browser/inhouse-actions.js';
export { getBrowserToolDefinitions } from './browser/definitions.js';
export { browserInspectConsole, browserInterceptNetwork } from './browser/diagnostics.js';
export { browserPreviewScreenshot } from './browser/preview.js';
export type { PreviewChunk } from './browser/preview.js';
export { browserSetProfileTarget, browserListTabs, browserSelectTab, browserNewTab, browserCloseTab } from './browser/tabs.js';
export { startBrowserLiveStream, browserDoctor } from './browser/stream-control.js';
export { browserElementWatch, browserSnapshotDelta } from './browser/watch.js';


export async function browserReopenSession(
  sessionId: string,
  restoreHint?: BrowserSessionRestoreHint,
): Promise<null | {
  sessionId: string;
  url: string;
  site: string;
  title: string;
  active: boolean;
  mode: BrowserInteractionMode;
  captured: boolean;
  controlOwner: 'agent' | 'user';
  streamActive: boolean;
  streamTransport: 'cdp' | 'snapshot' | '';
  streamFocus: BrowserLiveStreamFocus;
  frameBase64: string;
  frameWidth: number;
  frameHeight: number;
  elements: BrowserKnowledgeElement[];
  itemRoots: BrowserKnowledgeItemRoot[];
  extractionSchemas: BrowserKnowledgeExtractionSchema[];
}> {
  const resolved = resolveSessionId(sessionId);
  if (getInHouseSession(resolved) || shouldUseInHouseBrowser(resolved)) {
    const hintedUrl = String(restoreHint?.url || '').trim();
    const persisted = buildBrowserSessionRestoreRecord(resolved, restoreHint);
    const targetUrl = isRestorableBrowserUrl(hintedUrl) ? hintedUrl : String(persisted?.url || '').trim();
    if (!isRestorableBrowserUrl(targetUrl)) return null;
    await browserOpenInHouse(resolved, targetUrl, { observe: 'none' });
    const inHouse = getInHouseSession(resolved);
    const url = String(inHouse?.url || targetUrl);
    const interactionState = getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved));
    return {
      sessionId: resolved,
      url,
      site: browserKnowledgeHostFromUrl(url),
      title: String(inHouse?.title || restoreHint?.title || ''),
      active: true,
      mode: interactionState.mode,
      captured: interactionState.captured,
      controlOwner: interactionState.controlOwner,
      streamActive: false,
      streamTransport: '',
      streamFocus: 'interactive',
      frameBase64: '',
      frameWidth: 0,
      frameHeight: 0,
      elements: listNamedBrowserElementsForUrl(url),
      itemRoots: listNamedBrowserItemRootsForUrl(url),
      extractionSchemas: listNamedBrowserExtractionSchemasForUrl(url),
    };
  }
  const session = await getOrCreateSession(resolved, restoreHint).catch(() => null);
  if (!session) return null;
  const hintedUrl = String(restoreHint?.url || '').trim();
  const persisted = buildBrowserSessionRestoreRecord(resolved, restoreHint);
  const targetUrl = isRestorableBrowserUrl(hintedUrl) ? hintedUrl : String(persisted?.url || '').trim();
  if (isRestorableBrowserUrl(targetUrl)) {
    const currentUrl = String(session.page.url?.() || '').trim();
    if (normalizeBrowserRestoreUrl(currentUrl) !== normalizeBrowserRestoreUrl(targetUrl)) {
      await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await session.page.waitForTimeout(350).catch(() => {});
    }
    rememberPageMetadata(session, {
      url: targetUrl,
      title: String(await session.page.title().catch(() => restoreHint?.title || '') || restoreHint?.title || '').trim(),
    });
  }
  return getBrowserNamedElementsForSession(resolved, restoreHint);
}

async function broadcastBrowserViewportUpdate(
  sessionId: string,
  session: BrowserSession,
  tool: string,
  statusLabel: string,
): Promise<void> {
  try {
    const shot = await browserVisionScreenshot(sessionId);
    const title = await session.page.title().catch(() => '');
    const interactionState = getOrCreateBrowserInteractionState(sessionId);
    const liveStream = browserLiveStreams.get(resolveSessionId(sessionId));
    broadcastWS({
      type: 'browser:status',
      sessionId,
      tool,
      active: true,
      url: String(session.page.url() || ''),
      title: String(title || ''),
      statusLabel,
      mode: interactionState.mode,
      captured: interactionState.captured,
      controlOwner: interactionState.controlOwner,
      streamActive: liveStream?.active === true,
      streamTransport: liveStream?.transport || '',
      streamFocus: liveStream?.focus || 'passive',
      frameBase64: shot?.base64 || '',
      frameWidth: Number(shot?.width || 0),
      frameHeight: Number(shot?.height || 0),
      frameFormat: shot?.base64 ? 'png' : '',
      timestamp: Date.now(),
      ...buildBrowserSessionMetadataPayload(sessionId),
    });
  } catch {}
}

export async function browserOpen(
  sessionId: string,
  url: string,
  options?: { observe?: BrowserObserveMode; target?: BrowserProfileKind | string; profile?: BrowserProfileKind | string; inhouseProfile?: unknown; profileDirectory?: unknown; onPerformanceStage?: BrowserPerformanceObserver },
): Promise<string> {
  // -- URL sanity guard ------------------------------------------------------
  // When called from inside the node_call<> VM sandbox the URL may arrive as
  // undefined / null / a stringified object if the model emitted bad code.
  // CDP rejects all of these with "Cannot navigate to invalid URL" and the
  // reactor retries indefinitely � producing the 29-step loop seen in logs.
  const rawUrl = String(url ?? '').trim();
  if (!rawUrl || rawUrl === 'undefined' || rawUrl === 'null' || rawUrl === 'object') {
    return 'ERROR: browser_open requires a valid URL string. Received: ' + JSON.stringify(url);
  }

  const resolvedSessionId = resolveSessionId(sessionId);
  const requestedTarget = options?.target ?? options?.profile;
  const requestedInHouseProfile = normalizeInHouseProfileId(options?.inhouseProfile);
  const requestedTargetKind = requestedTarget != null ? normalizeBrowserProfileKind(requestedTarget) : null;
  if (requestedTarget != null || options?.profileDirectory != null) {
    const metadata = getBrowserSessionMetadata(resolvedSessionId);
    if (metadata.ownerType === 'main') {
      // Record the chosen in-house profile before flipping the target so the
      // first open lands on the right partition.
      if (requestedTargetKind === 'inhouse' && requestedInHouseProfile) {
        inHouseProfilePreferences.set(resolvedSessionId, requestedInHouseProfile);
      }
      const targetResult = await browserSetProfileTarget(resolvedSessionId, requestedTarget || getMainBrowserTarget(resolvedSessionId), {
        closeExisting: true,
        profileDirectory: options?.profileDirectory,
        inhouseProfile: requestedInHouseProfile,
      });
      if (targetResult.startsWith('ERROR')) return targetResult;
    } else if (requestedTargetKind === 'inhouse') {
      // Subagents/tasks may opt into the in-house browser with their own isolated
      // profile (default) or an explicit shared one via inhouse_profile.
      if (!isInHouseBrowserAvailable()) {
        return 'ERROR: Prometheus in-house browser is only available in the Electron desktop app. Use the regular Prometheus Chrome profile instead.';
      }
      if (requestedInHouseProfile) inHouseProfilePreferences.set(resolvedSessionId, requestedInHouseProfile);
      inHouseOptOutSessions.delete(resolvedSessionId);
      inHouseTargetSessions.add(resolvedSessionId);
    } else if (requestedTargetKind) {
      // Switching a subagent back off the in-house lane (prometheus / user_chrome).
      inHouseTargetSessions.delete(resolvedSessionId);
      inHouseOptOutSessions.add(resolvedSessionId);
      if (getInHouseSession(resolvedSessionId)) {
        clearInHouseSession(resolvedSessionId);
        await callInHouseBrowser('hide', { sessionId: resolvedSessionId }).catch(() => {});
      }
    }
  }
  if (shouldUseInHouseBrowser(resolvedSessionId)) {
    return browserOpenInHouse(resolvedSessionId, rawUrl, options);
  }
  let session: BrowserSession;
  try {
    session = await getOrCreateSession(resolvedSessionId, undefined, options?.onPerformanceStage);
  } catch (err: any) {
    return `ERROR: ${err.message}`;
  }

  const observeMode = options?.observe || resolveBrowserObserveMode('browser_open');
  let compactBefore: BrowserCompactState | null = null;
  try {
    let targetUrl = rawUrl;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
    const navigationStartedAt = Date.now();
    markBrowserPerformance(options?.onPerformanceStage, 'navigation_start', { observeMode });
    compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;

    await emitBrowserAgentCursor(sessionId, { kind: 'navigate', phase: 'start', label: targetUrl });
    await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Observation-aware settle: compact/none opens should be quick metadata acks;
    // snapshot/screenshot opens still wait for SPA hydration before returning proof.
    const needsSettledObservation = observeMode === 'snapshot' || observeMode === 'screenshot';
    if (needsSettledObservation) {
      await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await session.page.waitForTimeout(1200);
    } else if (shouldUseCompactObservation(observeMode)) {
      await session.page.waitForTimeout(100);
    }
    await syncPageMetadata(session).catch(() => {});
    await emitBrowserAgentCursor(sessionId, { kind: 'navigate', phase: 'end', label: session.page.url() });

    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      // Attach per-site shortcut context on open and keep it host-driven (no site hardcoding).
      return attachShortcutsContext(snapshot, session.page.url(), sessionId);
    }
    if (compactBefore) {
      markBrowserPerformance(options?.onPerformanceStage, 'navigation_done', {
        observeMode,
        durationMs: Math.max(0, Date.now() - navigationStartedAt),
      });
      return buildCompactBrowserObservation(session, 'Browser opened.', compactBefore);
    }
    markBrowserPerformance(options?.onPerformanceStage, 'navigation_done', {
      observeMode,
      durationMs: Math.max(0, Date.now() - navigationStartedAt),
    });
    return buildMinimalBrowserAck(session, 'Browser opened.');
  } catch (err: any) {
    const errorCode = classifyBrowserLifecycleError(err);
    markBrowserPerformance(options?.onPerformanceStage, 'navigation_error', { errorCode });
    if (errorCode === 'session_closed') {
      // A CDP target can disappear after the liveness check but before goto.
      // Recreate the session once, then retry the same read/navigation request.
      markBrowserPerformance(options?.onPerformanceStage, 'session_reconnect_start', { reason: 'navigation_target_closed' });
      await stopBrowserLiveStream(resolvedSessionId, 'Live browser stream stopped before browser-session recovery.').catch(() => {});
      clearBrowserSessionEphemeralState(resolvedSessionId, session);
      sessions.delete(resolvedSessionId);
      if (session.transport === 'extension') releaseUserChromeTabLocks(session.sessionId);
      try { await session.page.close(); } catch {}
      try { await session.browser.close(); } catch {}
      try {
        session = await getOrCreateSession(resolvedSessionId, undefined, options?.onPerformanceStage);
        let retryUrl = rawUrl;
        if (!/^[a-z][a-z0-9+.-]*:/i.test(retryUrl)) retryUrl = 'https://' + retryUrl;
        await session.page.goto(retryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        if (observeMode === 'snapshot' || observeMode === 'screenshot') {
          await session.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          await session.page.waitForTimeout(1200);
        } else if (shouldUseCompactObservation(observeMode)) {
          await session.page.waitForTimeout(100);
        }
        await syncPageMetadata(session).catch(() => {});
        markBrowserPerformance(options?.onPerformanceStage, 'navigation_retry_done', { observeMode });
        if (shouldReturnSnapshot(observeMode)) {
          const snapshot = await takeSnapshot(session.page);
          rememberSnapshot(session, snapshot);
          return attachShortcutsContext(snapshot, session.page.url(), sessionId);
        }
        if (compactBefore) return buildCompactBrowserObservation(session, 'Browser opened.', compactBefore);
        return buildMinimalBrowserAck(session, 'Browser opened.');
      } catch (retryError: any) {
        markBrowserPerformance(options?.onPerformanceStage, 'navigation_retry_error', {
          errorCode: classifyBrowserLifecycleError(retryError),
        });
      }
    }
    return `ERROR: Navigation failed: ${err.message}`;
  }
}

export async function browserSnapshot(
  sessionId: string,
  options?: { onPerformanceStage?: BrowserPerformanceObserver },
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) {
    const snapshot = await browserSnapshotInHouse(resolved);
    if (snapshot.startsWith('ERROR') || !recovery?.recovered) return snapshot;
    return `Recovered the existing in-house browser mapping for session=${resolved}.\n${snapshot}`;
  }
  let session = sessions.get(resolved);
  const aliveStartedAt = session ? Date.now() : 0;
  if (session && !(await isSessionAlive(session))) {
    markBrowserPerformance(options?.onPerformanceStage, 'session_alive_check', {
      alive: false,
      durationMs: Math.max(0, Date.now() - aliveStartedAt),
    });
    console.log(`[Browser] browserSnapshot: session dead, evicting.`);
    await stopBrowserLiveStream(resolved, 'Live browser stream stopped before browser-session recovery.').catch(() => {});
    clearBrowserSessionEphemeralState(resolved, session);
    sessions.delete(resolved);
    if (session.transport === 'extension') releaseUserChromeTabLocks(session.sessionId);
    try { await session.page.close(); } catch {}
    try { await session.browser.close(); } catch {}
    session = undefined;
  }
  if (!session) {
    // Snapshot is commonly the first recovery call after a lost/aborted open.
    // Restore a persisted regular Chrome session when possible instead of
    // turning the follow-up into a second, misleading "no session" failure.
    if (!shouldUseInHouseBrowser(resolved)) {
      try {
        session = await getOrCreateSession(resolved, undefined, options?.onPerformanceStage);
      } catch (err: any) {
        markBrowserPerformance(options?.onPerformanceStage, 'snapshot_session_error', {
          errorCode: classifyBrowserLifecycleError(err),
        });
      }
    }
  }
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    // Wait for the DOM to settle before snapshotting � SPAs (like x.com) may still
    // be hydrating after domcontentloaded, leaving querySelectorAll with 0 results.
    // Keep this bounded so routine snapshots don't become a multi-second tax.
    await session.page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    await session.page.waitForTimeout(250);
    const snapshot = await takeSnapshot(session.page);
    rememberSnapshot(session, snapshot);
    markBrowserPerformance(options?.onPerformanceStage, 'snapshot_done', { resultBytes: Buffer.byteLength(snapshot, 'utf8') });
    return attachShortcutsContext(snapshot, session.page.url(), sessionId);
  } catch (err: any) {
    markBrowserPerformance(options?.onPerformanceStage, 'snapshot_error', { errorCode: classifyBrowserLifecycleError(err) });
    if (classifyBrowserLifecycleError(err) === 'session_closed') {
      await stopBrowserLiveStream(resolved, 'Live browser stream stopped after the browser session closed.').catch(() => {});
      clearBrowserSessionEphemeralState(resolved, session);
      sessions.delete(resolved);
      try { await session.page.close(); } catch {}
      try { await session.browser.close(); } catch {}
    }
    return `ERROR: Snapshot failed: ${err.message}`;
  }
}

function normalizeDesktopBrowserLinkUrl(rawUrl: unknown): string {
  const raw = String(rawUrl || '').trim();
  if (!raw) throw new Error('Browser link URL is required.');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try { parsed = new URL(withScheme); } catch { throw new Error('Browser link URL is invalid.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS links can open in the Prometheus Browser.');
  if (parsed.username || parsed.password) throw new Error('Browser links cannot contain embedded credentials.');
  return parsed.href;
}

function resolveDesktopBrowserLinkSession(sessionId: string): { requestedSessionId: string; linkSessionId: string; lane: BrowserProfileKind } {
  const requestedSessionId = resolveSessionId(sessionId);
  const metadata = getBrowserSessionMetadata(requestedSessionId);
  if (metadata.ownerType !== 'main') {
    return { requestedSessionId, linkSessionId: requestedSessionId, lane: 'prometheus' };
  }
  const target = getMainBrowserTarget(requestedSessionId);
  // A link click must never claim a personal Chrome tab. Use a stable, non-
  // persisted main-owned alias that still attaches to the Prometheus CDP
  // profile/debug port. Existing user-Chrome sessions remain untouched.
  if (target === 'user' || (target === 'inhouse' && !getInHouseSession(requestedSessionId))) {
    const linkSessionId = `${requestedSessionId}::prometheus-link`;
    registerBrowserSessionMetadata(linkSessionId, {
      ownerType: 'main',
      ownerId: requestedSessionId,
      label: 'Prometheus Browser links',
      spawnerSessionId: requestedSessionId,
    });
    return { requestedSessionId, linkSessionId, lane: 'prometheus' };
  }
  return { requestedSessionId, linkSessionId: requestedSessionId, lane: target };
}

export function browserOpenUiLink(sessionId: string, rawUrl: string): Promise<any> {
  const url = normalizeDesktopBrowserLinkUrl(rawUrl);
  const resolved = resolveDesktopBrowserLinkSession(sessionId);
  const previous = browserLinkNavigationInFlight.get(resolved.linkSessionId);
  const run = (previous || Promise.resolve()).catch(() => null).then(async () => {
    const status = await browserNavigateControl(resolved.linkSessionId, { action: 'open', url });
    return {
      ...status,
      requestedSessionId: resolved.requestedSessionId,
      linkSessionId: resolved.linkSessionId,
      linkNavigation: true,
      linkLane: resolved.lane,
      source: 'system',
      tool: 'browser_link',
    };
  });
  const tracked = run.finally(() => {
    if (browserLinkNavigationInFlight.get(resolved.linkSessionId) === tracked) browserLinkNavigationInFlight.delete(resolved.linkSessionId);
  });
  browserLinkNavigationInFlight.set(resolved.linkSessionId, tracked);
  return tracked;
}

export async function browserNavigateControl(
  sessionId: string,
  payload: { action?: 'back' | 'forward' | 'reload' | 'open'; url?: string },
): Promise<{
  sessionId: string;
  active: boolean;
  url: string;
  title: string;
  browserTarget: BrowserProfileKind;
  profileKind: BrowserProfileKind;
  profileLabel: string;
  profileDir: string;
  debugPort: number;
  mode: BrowserInteractionMode;
  captured: boolean;
  controlOwner: 'agent' | 'user';
  streamActive: boolean;
  streamTransport: 'cdp' | 'snapshot' | '';
  streamFocus: BrowserLiveStreamFocus;
  source: 'user';
  statusLabel: string;
  frameBase64: string;
  frameWidth: number;
  frameHeight: number;
  frameFormat: 'png';
  timestamp: number;
}> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) throw new Error(recovery.error);
  if (getInHouseSession(resolved)) {
    const nav: any = await callInHouseBrowser('navigate', {
      sessionId: resolved,
      action: payload?.action,
      url: String(payload?.url || '').trim(),
    });
    const inHouse = upsertInHouseSession(resolved, nav);
    const interactionState = getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved));
    return {
      sessionId: resolved,
      active: true,
      url: inHouse.url,
      title: inHouse.title,
      browserTarget: 'inhouse',
      profileKind: 'inhouse',
      profileLabel: getBrowserProfileLabel('inhouse'),
      profileDir: 'Electron persistent partition: persist:prometheus-inhouse-browser',
      debugPort: 0,
      mode: interactionState.mode,
      captured: interactionState.captured,
      controlOwner: interactionState.controlOwner,
      streamActive: false,
      streamTransport: '',
      streamFocus: 'interactive',
      source: 'user',
      statusLabel: 'Navigated in Prometheus in-house browser.',
      frameBase64: '',
      frameWidth: 0,
      frameHeight: 0,
      frameFormat: 'png',
      timestamp: Date.now(),
    };
  }
  const session = await getOrCreateSession(resolved, {
    url: String(payload?.url || '').trim(),
  });
  const action = String(payload?.action || '').trim().toLowerCase();
  const liveStream = browserLiveStreams.get(resolved);
  const actionLabel = action === 'back'
    ? 'Went back'
    : action === 'forward'
      ? 'Went forward'
      : action === 'reload'
        ? 'Reloaded page'
        : 'Opened page';
  if (!['back', 'forward', 'reload', 'open'].includes(action)) {
    throw new Error(`Unsupported browser navigation action "${action || 'unknown'}".`);
  }
  await emitBrowserAgentCursor(resolved, { kind: 'navigate', phase: 'start', label: actionLabel });
  if (action === 'back') {
    await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);
  } else if (action === 'forward') {
    await session.page.goForward({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);
  } else if (action === 'reload') {
    await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
  } else {
    let targetUrl = String(payload?.url || '').trim();
    if (!targetUrl) throw new Error('Open requires a URL.');
    if (!/^[a-z][a-z0-9+.-]*:/i.test(targetUrl)) targetUrl = `https://${targetUrl}`;
    await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  }
  await session.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await session.page.waitForTimeout(350).catch(() => {});
  const meta = await syncPageMetadata(session).catch(() => ({ url: session.page.url(), title: '' } as any));
  await emitBrowserAgentCursor(resolved, { kind: 'navigate', phase: 'end', label: meta?.url || session.page.url() });
  const shot = await browserVisionScreenshot(resolved).catch(() => null);
  const interactionState = getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved));
  return {
    sessionId: resolved,
    active: true,
    url: String(meta?.url || session.page.url() || ''),
    title: String(meta?.title || await session.page.title().catch(() => '') || ''),
    browserTarget: session.browserTarget,
    profileKind: session.profileKind,
    profileLabel: getBrowserProfileLabel(session.profileKind),
    profileDir: session.profileDir || '',
    debugPort: Number(session.debugPort || 0),
    mode: interactionState.mode,
    captured: interactionState.captured,
    controlOwner: interactionState.controlOwner,
    streamActive: liveStream?.active === true,
    streamTransport: liveStream?.transport || '',
    streamFocus: liveStream?.focus || 'passive',
    source: 'user',
    statusLabel: `${actionLabel}.`,
    frameBase64: String(shot?.base64 || ''),
    frameWidth: Number(shot?.width || 0),
    frameHeight: Number(shot?.height || 0),
    frameFormat: 'png',
    timestamp: Date.now(),
  };
}

export async function browserClick(
  sessionId: string,
  target: number | { ref?: number; element?: string; selector?: string },
  options?: { observe?: BrowserObserveMode; onPerformanceStage?: BrowserPerformanceObserver },
): Promise<string> {
  const recovery = await recoverInHouseSessionMapping(sessionId);
  if (recovery?.error) return recovery.error;
  if (recovery?.recovered) {
    return 'ERROR: Recovered the in-house browser mapping, but this action needs a fresh browser_observe first. No action was sent.';
  }
  if (getInHouseSession(sessionId)) return browserClickInHouse(sessionId, target, options);
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const requestedElement = typeof target === 'object' && target !== null ? String(target.element || '').trim() : '';
  const requestedSelector = typeof target === 'object' && target !== null ? String(target.selector || '').trim() : '';
  const requestedRef = typeof target === 'number'
    ? Number(target)
    : Number((target && typeof target === 'object' ? target.ref : 0) || 0);
  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_click');
    const fastAck = shouldUseFastBrowserAck(observeMode);
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    if (requestedSelector) {
      const cursorPoint = fastAck ? null : await resolveSelectorViewportCenter(session.page, requestedSelector, `selector "${requestedSelector}"`);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'click', phase: 'start' });
      const el = await clickBySelector(session.page, requestedSelector, { settleMs: fastAck ? 0 : 1500 });
      if (!fastAck) await session.page.waitForTimeout(500);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'click', phase: 'end', label: cursorPoint?.label || `Clicked selector "${requestedSelector}"` });
      if (shouldReturnSnapshot(observeMode)) {
        const snapshot = await takeSnapshot(session.page);
        rememberSnapshot(session, snapshot);
        return attachShortcutsContext(
          `Clicked selector "${requestedSelector}" (${el.role}: "${el.name}")\n\n${snapshot}`,
          session.page.url(),
          sessionId,
        );
      }
      if (compactBefore) {
        return buildCompactBrowserObservation(
          session,
          `Clicked selector "${requestedSelector}" (${el.role}: "${el.name}").`,
          compactBefore,
        );
      }
      return buildMinimalBrowserAck(session, `Clicked selector "${requestedSelector}" (${el.role}: "${el.name}").`, { syncMetadata: !fastAck });
    }
    if (requestedElement) {
      const resolvedElement = await resolveNamedBrowserElement(sessionId, requestedElement);
      if (!resolvedElement) {
        const available = listNamedBrowserElementsForUrl(session.page.url()).map((entry) => entry.name).slice(0, 12);
        const suffix = available.length
          ? ` Available saved elements for this site: ${available.join(', ')}.`
          : ' No saved elements exist for this site yet.';
        return attachShortcutsContext(
          `ERROR: Could not resolve a saved browser element named "${requestedElement}".${suffix}`,
          session.page.url(),
          sessionId,
        );
      }
      const cursorPoint = fastAck ? null : await resolveSelectorViewportCenter(session.page, resolvedElement.selector, `saved element "${resolvedElement.entry.name}"`);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'click', phase: 'start' });
      const el = await clickBySelector(session.page, resolvedElement.selector, { settleMs: fastAck ? 0 : 1500 });
      if (!fastAck) await session.page.waitForTimeout(500);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'click', phase: 'end', label: cursorPoint?.label || `Clicked saved element "${resolvedElement.entry.name}"` });
      if (shouldReturnSnapshot(observeMode)) {
        const snapshot = await takeSnapshot(session.page);
        rememberSnapshot(session, snapshot);
        return attachShortcutsContext(
          `Clicked saved element "${resolvedElement.entry.name}" (${el.role}: "${el.name}")\n\n${snapshot}`,
          session.page.url(),
          sessionId,
        );
      }
      if (compactBefore) {
        return buildCompactBrowserObservation(
          session,
          `Clicked saved element "${resolvedElement.entry.name}" (${el.role}: "${el.name}").`,
          compactBefore,
        );
      }
      return buildMinimalBrowserAck(session, `Clicked saved element "${resolvedElement.entry.name}" (${el.role}: "${el.name}").`, { syncMetadata: !fastAck });
    }
    if (!Number.isFinite(requestedRef) || requestedRef <= 0) {
      return 'ERROR: browser_click requires ref, element, or selector.';
    }
    const cursorPoint = fastAck ? null : await resolveViewportPointFromTarget(session.page, { ref: requestedRef }, 'browser_click').catch(() => null);
    if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'click', phase: 'start' });
    const el = await clickByRef(session.page, requestedRef, { settleMs: fastAck ? 0 : 1500 });
    // Extra settle before snapshot/delta � dialogs / dropdowns / navigation need time.
    if (!fastAck) await session.page.waitForTimeout(500);
    if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'click', phase: 'end', label: cursorPoint?.label || `Clicked @${requestedRef}` });
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      return attachShortcutsContext(`Clicked @${requestedRef} (${el.role}: "${el.name}")\n\n${snapshot}`, session.page.url(), sessionId);
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Clicked @${requestedRef} (${el.role}: "${el.name}").`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Clicked @${requestedRef} (${el.role}: "${el.name}").`, { syncMetadata: !fastAck });
  } catch (err: any) {
    if (requestedSelector) {
      return attachShortcutsContext(`ERROR: Click selector "${requestedSelector}" failed: ${err.message}`, session.page.url(), sessionId);
    }
    return requestedElement
      ? attachShortcutsContext(`ERROR: Click "${requestedElement}" failed: ${err.message}`, session.page.url(), sessionId)
      : `ERROR: Click @${requestedRef} failed: ${err.message}`;
  }
}

export async function browserFill(
  sessionId: string,
  target: number | { ref?: number; element?: string; selector?: string },
  text: string,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const recovery = await recoverInHouseSessionMapping(sessionId);
  if (recovery?.error) return recovery.error;
  if (recovery?.recovered) {
    return 'ERROR: Recovered the in-house browser mapping, but this action needs a fresh browser_observe first. No action was sent.';
  }
  if (getInHouseSession(sessionId)) return browserFillInHouse(sessionId, target, text, options);
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const requestedElement = typeof target === 'object' && target !== null ? String(target.element || '').trim() : '';
  const requestedSelector = typeof target === 'object' && target !== null ? String(target.selector || '').trim() : '';
  const requestedRef = typeof target === 'number'
    ? Number(target)
    : Number((target && typeof target === 'object' ? target.ref : 0) || 0);
  try {
    let el: { role: string; name: string; needsNativeType?: boolean };
    let submitHint: { ref: number; label: string; strategy: string } | null = null;
    let resultLabel = '';
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_fill');
    const fastAck = shouldUseFastBrowserAck(observeMode);
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;

    if (requestedSelector) {
      const cursorPoint = fastAck ? null : await resolveSelectorViewportCenter(session.page, requestedSelector, `selector "${requestedSelector}"`);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'fill', phase: 'start' });
      el = await fillBySelector(session.page, requestedSelector, text);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'fill', phase: 'end', label: cursorPoint?.label || `Filled selector "${requestedSelector}"` });
      resultLabel = `selector "${requestedSelector}"`;
    } else if (requestedElement) {
      const resolvedElement = await resolveNamedBrowserElement(sessionId, requestedElement);
      if (!resolvedElement) {
        const available = listNamedBrowserElementsForUrl(session.page.url()).map((entry) => entry.name).slice(0, 12);
        const suffix = available.length
          ? ` Available saved elements for this site: ${available.join(', ')}.`
          : ' No saved elements exist for this site yet.';
        return attachShortcutsContext(
          `ERROR: Could not resolve a saved browser element named "${requestedElement}".${suffix}`,
          session.page.url(),
          sessionId,
        );
      }
      const cursorPoint = fastAck ? null : await resolveSelectorViewportCenter(session.page, resolvedElement.selector, `saved element "${resolvedElement.entry.name}"`);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'fill', phase: 'start' });
      el = await fillBySelector(session.page, resolvedElement.selector, text);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'fill', phase: 'end', label: cursorPoint?.label || `Filled saved element "${resolvedElement.entry.name}"` });
      resultLabel = `saved element "${resolvedElement.entry.name}"`;
    } else {
      if (!Number.isFinite(requestedRef) || requestedRef <= 0) {
        return 'ERROR: browser_fill requires ref, element, or selector, plus text.';
      }
      const cursorPoint = fastAck ? null : await resolveViewportPointFromTarget(session.page, { ref: requestedRef }, 'browser_fill').catch(() => null);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'fill', phase: 'start' });
      el = await fillByRef(session.page, requestedRef, text);
      if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'fill', phase: 'end', label: cursorPoint?.label || `Filled @${requestedRef}` });
      resultLabel = `@${requestedRef}`;

      // After filling, find the submit button closest to the filled element in the DOM.
      // This lets us annotate the snapshot so the model clicks the RIGHT Post button
      // (the composer's) and not a Post button elsewhere on the page (e.g. in the feed).
      // Find the Post/Tweet submit button ref after filling.
      // Strategy: use X.com's stable data-testid first, then fall back to DOM walk.
      // We recount refs using the same filter logic as takeSnapshot to get the correct number.
      submitHint = fastAck ? null : await session.page.evaluate((args: { ref: number; sel: string }) => {
        const doc = (globalThis as any).document as any;
        const openModal: any = (
          doc.querySelector('[role="dialog"][aria-modal="true"]')
          || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])')
          || doc.querySelector('dialog[open]')
          || doc.querySelector('[data-testid="Dropdown"]')
          || doc.querySelector('[role="menu"]')
          || null
        );
        const searchRoot: any = openModal || doc.documentElement;

        // Build the same visible-element list as takeSnapshot so ref numbers match exactly
        const isVisible = (e: any): boolean => {
          const r = typeof e.getBoundingClientRect === 'function' ? e.getBoundingClientRect() : null;
          if (!r || (r.width === 0 && r.height === 0)) return false;
          const style = typeof (globalThis as any).getComputedStyle === 'function' ? (globalThis as any).getComputedStyle(e) : null;
          if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
          return true;
        };
        const seen = new Set<any>();
        const all: any[] = [];
        for (const e of Array.from(searchRoot.querySelectorAll(args.sel))) {
          if (!seen.has(e)) { seen.add(e); all.push(e); }
        }
        // Filter same way as takeSnapshot
        const visible = all.filter((e: any) => {
          const tag = e.tagName.toLowerCase();
          const role = (e.getAttribute('role') || '').toLowerCase();
          const ce = e.getAttribute('contenteditable') === 'true';
          const isInput = ['input', 'textarea', 'select'].includes(tag) || ce || ['textbox', 'searchbox', 'combobox'].includes(role);
          const name = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || e.getAttribute('data-testid') || '').trim().slice(0, 80) || (ce ? 'editable' : '');
          if (!name && !isInput) return false;
          return isVisible(e);
        });

        // Strategy 1: X.com stable testid � tweetButtonInline is the in-timeline composer Post button
        const xPostBtn = doc.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
        if (xPostBtn && isVisible(xPostBtn)) {
          const btnRef = visible.indexOf(xPostBtn) + 1;
          if (btnRef > 0) {
            const label = (xPostBtn.getAttribute('aria-label') || xPostBtn.innerText || 'Post').trim();
            return { ref: btnRef, label, strategy: 'testid' };
          }
        }

        // Strategy 2: Find filled element, walk up DOM to find Post/Tweet button ancestor
        let filledEl: any = null;
        for (let i = 0; i < visible.length; i++) {
          if (i + 1 === args.ref) { filledEl = visible[i]; break; }
        }
        if (!filledEl) return null;

        let ancestor: any = filledEl.parentElement;
        const MAX_DEPTH = 14;
        for (let d = 0; d < MAX_DEPTH && ancestor; d++) {
          const buttons = Array.from(ancestor.querySelectorAll('button, [role="button"]')) as any[];
          for (const btn of buttons) {
            const label = (btn.getAttribute('aria-label') || btn.innerText || '').trim();
            if (/^(post|tweet)$/i.test(label) && isVisible(btn)) {
              const btnRef = visible.indexOf(btn) + 1;
              if (btnRef > 0) return { ref: btnRef, label, strategy: 'walk' };
            }
          }
          ancestor = ancestor.parentElement;
        }
        return null;
      }, { ref: requestedRef, sel: INTERACTIVE_SELECTOR }).catch(() => null);
    }

    if (!fastAck) {
      await broadcastBrowserViewportUpdate(
        sessionId,
        session,
        'browser_fill',
        `Filled ${el.role}: "${String(el.name || '').slice(0, 60)}"`,
      );
    }

    // -- X.com composer: click Post button directly after a contenteditable fill --
    // The ref-based hint is unreliable because X renders multiple "Post"-labelled
    // buttons (inline composer + toolbar) and the wrong one gets picked.
    // Strategy: try stable testids in order, fall back to text match.
    // We do this HERE so the model never has to guess the ref.
    if ((el as any).needsNativeType === true) {
      // Only auto-submit for contenteditable fills (the X.com composer case)
      const xPostSelectors = [
        '[data-testid="tweetButtonInline"]',   // home feed inline composer
        '[data-testid="tweetButton"]',          // full /compose modal
      ];
      let clicked = false;
      for (const sel of xPostSelectors) {
        try {
          const btn = session.page.locator(sel).first();
          if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
            await btn.click();
            clicked = true;
            console.log(`[Browser] Auto-clicked Post button via ${sel}`);
            break;
          }
        } catch { /* try next */ }
      }
      if (clicked) {
        // Wait for post to submit and feed to update
        await session.page.waitForTimeout(2000);
        await session.page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        if (shouldReturnSnapshot(observeMode)) {
          const afterSnapshot = await takeSnapshot(session.page);
          rememberSnapshot(session, afterSnapshot);
          return attachShortcutsContext(
            `Filled composer and clicked Post button. Tweet has been posted successfully. Snapshot refreshed (${parseSnapshotElementCount(afterSnapshot)} elements).`,
            session.page.url(),
            sessionId,
          );
        }
        if (compactBefore) {
          return buildCompactBrowserObservation(session, 'Filled composer and clicked Post button.', compactBefore);
        }
        return buildMinimalBrowserAck(session, 'Filled composer and clicked Post button.');
      }
    }

    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      let snapshotResult = `Filled ${resultLabel} (${el.role}: "${el.name}") with "${text.slice(0, 50)}". Snapshot refreshed (${parseSnapshotElementCount(snapshot)} elements).`;
      if (submitHint) {
        snapshotResult += ` Submit hint: click @${submitHint.ref} ("${submitHint.label}").`;
      }
      return attachShortcutsContext(snapshotResult, session.page.url(), sessionId);
    }

    let result = `Filled ${resultLabel} (${el.role}: "${el.name}") with "${text.slice(0, 50)}".`;
    if (submitHint) {
      result += ` Submit hint: click @${submitHint.ref} ("${submitHint.label}").`;
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, result, compactBefore);
    }
    return buildMinimalBrowserAck(session, result, { syncMetadata: !fastAck });
  } catch (err: any) {
    if (requestedSelector) {
      return attachShortcutsContext(`ERROR: Fill selector "${requestedSelector}" failed: ${err.message}`, session.page.url(), sessionId);
    }
    return requestedElement
      ? attachShortcutsContext(`ERROR: Fill "${requestedElement}" failed: ${err.message}`, session.page.url(), sessionId)
      : `ERROR: Fill @${requestedRef} failed: ${err.message}`;
  }
}

export async function browserUploadFile(
  sessionId: string,
  options: {
    ref?: number;
    selector?: string;
    file_path?: string;
    file_paths?: string[];
    observe?: BrowserObserveMode;
  },
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  try {
    const observeMode = options.observe || resolveBrowserObserveMode('browser_upload_file');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    const uploadPaths = toUploadPaths(options.file_path, options.file_paths);
    if (!uploadPaths.length) return 'ERROR: file_path or file_paths is required.';
    for (const uploadPath of uploadPaths) {
      if (!fs.existsSync(uploadPath)) return `ERROR: Upload file not found: ${uploadPath}`;
    }

    let target: any = null;
    if (options.selector) {
      target = session.page.locator(String(options.selector)).first();
      if (!(await target.count())) {
        return `ERROR: No file input found for selector "${options.selector}".`;
      }
    } else if (Number.isFinite(Number(options.ref)) && Number(options.ref) > 0) {
      const handle = await session.page.evaluateHandle((args: { ref: number; sel: string }) => {
        const doc = (globalThis as any).document;
        const direct = doc.querySelector(`[data-sc-ref="${args.ref}"]`);
        if (direct) return direct;
        const openModal = doc.querySelector('[role="dialog"][aria-modal="true"]')
          || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])')
          || doc.querySelector('dialog[open]')
          || doc.querySelector('[role="menu"]')
          || null;
        const searchRoot = openModal || doc;
        let counter = 0;
        for (const el of Array.from(searchRoot.querySelectorAll(args.sel)) as any[]) {
          const tag = el.tagName.toLowerCase();
          const role = (el.getAttribute('role') || '').toLowerCase();
          const isInput = ['input', 'textarea', 'select'].includes(tag) || ['textbox', 'searchbox', 'combobox'].includes(role);
          const name = (el.getAttribute('aria-label') || (el.innerText || '').trim() || el.getAttribute('placeholder') || el.getAttribute('data-testid') || '').slice(0, 80);
          if (!name && !isInput) continue;
          const rect = el.getBoundingClientRect?.();
          if ((el.offsetWidth === 0 && el.offsetHeight === 0) || (rect && rect.width === 0 && rect.height === 0)) continue;
          const style = (globalThis as any).getComputedStyle?.(el);
          if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
          counter += 1;
          if (counter === args.ref) return el;
        }
        return null;
      }, { ref: Number(options.ref), sel: INTERACTIVE_SELECTOR });
      const element = handle.asElement();
      if (!element) return `ERROR: Element @${options.ref} not found.`;
      const nestedInput = await element.$('input[type="file"]');
      target = nestedInput || element;
    } else {
      return 'ERROR: browser_upload_file requires ref or selector.';
    }

    const typeAttr = String((await target.getAttribute('type').catch(() => '')) || '').toLowerCase();
    const tagName = String((await target.evaluate((el: any) => el.tagName.toLowerCase()).catch(() => '')) || '').toLowerCase();
    if (!(tagName === 'input' && typeAttr === 'file')) {
      const nested = await target.locator('input[type="file"]').first();
      if (await nested.count()) {
        target = nested;
      } else {
        return 'ERROR: Target element is not an <input type="file">. Pass the file input selector directly.';
      }
    }

    await target.setInputFiles(uploadPaths);
    await session.page.waitForTimeout(700);
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      return attachShortcutsContext(
        `Uploaded ${uploadPaths.length} file(s): ${uploadPaths.map((p) => path.basename(p)).join(', ')}.\n\n${snapshot}`,
        session.page.url(),
        sessionId,
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(
        session,
        `Uploaded ${uploadPaths.length} file(s): ${uploadPaths.map((p) => path.basename(p)).join(', ')}.`,
        compactBefore,
      );
    }
    return buildMinimalBrowserAck(session, `Uploaded ${uploadPaths.length} file(s): ${uploadPaths.map((p) => path.basename(p)).join(', ')}.`);
  } catch (err: any) {
    return `ERROR: browser_upload_file failed: ${err.message}`;
  }
}

export async function browserClickAndDownload(
  sessionId: string,
  ref: number,
  options?: { timeout_ms?: number; filename_hint?: string; output_dir?: string; observe?: BrowserObserveMode },
): Promise<string> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (session.transport === 'extension') {
    try {
      await clickByRef(session.page, ref);
      await session.page.waitForTimeout(500);
      const downloads = await getUserChromeRelay().request('downloads.search', { query: { limit: 1, orderBy: ['-startTime'] } });
      const download = Array.isArray(downloads) ? downloads[0] : null;
      return download
        ? `Download started in Personal Chrome: ${String(download.filename || download.url || 'unknown file')} (state: ${String(download.state || 'unknown')}). Chrome owns the destination file; Prometheus cannot copy it from the real profile.`
        : 'Click completed in Personal Chrome. No download record appeared yet; inspect Chrome downloads if the site delays it.';
    } catch (err: any) {
      return `ERROR: Personal Chrome download click failed: ${String(err?.message || err)}`;
    }
  }
  let downloadPromise: Promise<any> | null = null;
  try {
    const timeoutMs = Math.min(Math.max(Number(options?.timeout_ms || 15000), 1000), 120000);
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_click_and_download');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    downloadPromise = session.page.waitForEvent('download', { timeout: timeoutMs });
    const clicked = await clickByRef(session.page, ref);
    const download = await downloadPromise;
    const saved = await persistBrowserDownload(sessionId, download, options);
    if (shouldReturnSnapshot(observeMode)) {
      await session.page.waitForTimeout(400).catch(() => {});
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      return attachShortcutsContext(
        `Clicked @${ref} (${clicked.role}: "${clicked.name}") and saved download to ${saved.relPath} (${saved.sizeBytes} bytes).\n\n${snapshot}`,
        session.page.url(),
        sessionId,
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(
        session,
        `Clicked @${ref} (${clicked.role}: "${clicked.name}") and saved download to ${saved.relPath} (${saved.sizeBytes} bytes).`,
        compactBefore,
      );
    }
    return buildMinimalBrowserAck(session, `Clicked @${ref} (${clicked.role}: "${clicked.name}") and saved download to ${saved.relPath} (${saved.sizeBytes} bytes).`);
  } catch (err: any) {
    downloadPromise?.catch(() => {});
    return `ERROR: browser_click_and_download failed: ${err.message}`;
  }
}

export async function browserPressKey(
  sessionId: string,
  key: string,
  options?: BrowserKeyOptions,
): Promise<string> {
  const recovery = await recoverInHouseSessionMapping(sessionId);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(sessionId)) return browserPressKeyInHouse(sessionId, key, options);
  if (options?.hold_ms !== undefined || options?.keys !== undefined || options?.sequence !== undefined || options?.tab_id !== undefined) {
    return 'ERROR: hold_ms, keys, sequence, and tab_id require the in-house browser target; no input sent.';
  }
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_press_key');
    const fastAck = shouldUseFastBrowserAck(observeMode);
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    const cursorPoint = fastAck ? null : await resolveActiveElementViewportCenter(session.page).catch(() => null);
    if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'key', phase: 'start', label: key });
    await pressKey(session.page, key, { settleMs: fastAck ? 0 : 1500 });
    // Best-effort networkidle after potentially navigational keypresses, but do not
    // charge low-latency observe:none keyboard shortcuts for a 4s idle probe.
    if (!fastAck || /^(enter|return)$/i.test(String(key || '').trim())) {
      await session.page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    }
    if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'key', phase: 'end', label: key });
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const count = parseSnapshotElementCount(snapshot);
      return attachShortcutsContext(`Pressed "${key}". Snapshot refreshed (${count} elements).`, session.page.url(), sessionId);
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Pressed "${key}".`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Pressed "${key}".`, { syncMetadata: !fastAck });
  } catch (err: any) {
    return attachShortcutsContext(`ERROR: Key press failed: ${err.message}`, session.page.url(), sessionId);
  }
}

/**
 * Type text into whatever element currently has keyboard focus.
 * Unlike browserFill (which needs a @ref), this just sends keystrokes � works for
 * contenteditable divs (e.g. X/Twitter compose box) where fill by ref often fails.
 */
export async function browserType(
  sessionId: string,
  text: string,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const recovery = await recoverInHouseSessionMapping(sessionId);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(sessionId)) return browserTypeInHouse(sessionId, text, options);
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_type');
    const fastAck = shouldUseFastBrowserAck(observeMode);
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    const cursorPoint = fastAck ? null : await resolveActiveElementViewportCenter(session.page).catch(() => null);
    if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'type', phase: 'start', label: `Typing ${String(text || '').length} characters` });
    await session.page.keyboard.type(String(text || ''), { delay: fastAck ? 0 : 25 });
    if (!fastAck) await session.page.waitForTimeout(400);
    if (cursorPoint) await emitBrowserAgentCursor(sessionId, { ...cursorPoint, kind: 'type', phase: 'end', label: `Typed ${String(text || '').length} characters` });
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const count = parseSnapshotElementCount(snapshot);
      return attachShortcutsContext(`Typed ${String(text).length} chars into focused element. Snapshot refreshed (${count} elements).`, session.page.url(), sessionId);
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Typed ${String(text).length} chars into focused element.`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Typed ${String(text).length} chars into focused element.`, { syncMetadata: !fastAck });
  } catch (err: any) {
    return `ERROR: browser_type failed: ${err.message}`;
  }
}

export async function browserWait(
  sessionId: string,
  ms: number,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const recovery = await recoverInHouseSessionMapping(sessionId);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(sessionId)) {
    const clampedNative = Math.min(Math.max(ms || 1000, 500), 8000);
    await new Promise((resolve) => setTimeout(resolve, clampedNative));
    if (shouldReturnSnapshot(options?.observe || resolveBrowserObserveMode('browser_wait'))) {
      return browserSnapshotInHouse(sessionId);
    }
    return `Waited ${clampedNative}ms in Prometheus in-house browser.`;
  }
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const clamped = Math.min(Math.max(ms || 1000, 500), 8000);
  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_wait');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    await session.page.waitForTimeout(clamped);
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const count = parseSnapshotElementCount(snapshot);
      return attachShortcutsContext(`Waited ${clamped}ms. Snapshot refreshed (${count} elements).`, session.page.url(), sessionId);
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Waited ${clamped}ms.`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Waited ${clamped}ms.`);
  } catch (err: any) {
    return `ERROR: Wait failed: ${err.message}`;
  }
}

/**
 * Returns info about the currently keyboard-focused element on the page.
 * Critical for navigation shortcuts (j/k on X.com) � tells the AI which tweet/item
 * is currently selected so it knows how many more presses are needed.
 */
export async function browserGetFocusedItem(sessionId: string): Promise<string> {
  const resolvedFocus = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolvedFocus);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolvedFocus)) {
    try {
      const info = await callInHouseBrowser<any>('run-js', {
        sessionId: resolvedFocus,
        code: `(() => { const el = document.activeElement; if (!el || el === document.body) return null; return { tag: (el.tagName||'').toLowerCase(), role: el.getAttribute('role')||'', label: el.getAttribute('aria-label')||'', text: String(el.innerText||el.value||'').replace(/\\s+/g,' ').trim().slice(0,300) }; })()`,
      });
      if (!info) return 'No element is currently focused in the in-house browser.';
      return `Focused element: [${info.role || info.tag}] ${info.label || info.text || ''}`.trim();
    } catch (err: any) {
      return `ERROR: In-house get-focused-item failed: ${err.message}`;
    }
  }
  const session = sessions.get(resolvedFocus);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  try {
    const info = await session.page.evaluate(() => {
      const doc = (globalThis as any).document;
      const focused = doc.activeElement;
      const isX = /(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(String((globalThis as any).location?.hostname || ''));
      if ((!focused || focused === doc.body) && isX) {
        // On X.com, keyboard-focused tweet has data-testid="tweet" and a CSS highlight class
        // Check for X.com highlighted/focused tweet (has outline or aria-selected)
        const highlighted = doc.querySelector(
          'article[data-testid="tweet"][tabindex="0"], article[data-testid="tweet"]:focus-within'
        );
        if (highlighted) {
          const tweetText = (highlighted.querySelector('[data-testid="tweetText"]') as any)?.innerText?.trim()?.slice(0, 120) || '';
          const author = (highlighted.querySelector('[data-testid="User-Name"]') as any)?.innerText?.trim()?.replace(/\n/g, ' ')?.slice(0, 60) || '';
          const link = (highlighted.querySelector('a[href*="/status/"]') as any)?.href || '';
          const idMatch = link.match(/\/status\/(\d+)/);
          // Count position in feed
          const allTweets = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'));
          const idx = allTweets.indexOf(highlighted);
          return {
            type: 'tweet',
            position: idx + 1,
            totalVisible: allTweets.length,
            author,
            text: tweetText,
            tweetId: idMatch ? idMatch[1] : '',
            link,
          };
        }
        return { type: 'element', tag: 'body', role: '', ariaLabel: '', text: '', testId: '', focused: true };
      }

      if (!focused) return { type: 'none', focused: false };

      const tag = focused.tagName?.toLowerCase() || 'unknown';
      const role = focused.getAttribute('role') || '';
      const ariaLabel = focused.getAttribute('aria-label') || '';
      const text = (focused.innerText || '').trim().slice(0, 120);
      const testId = focused.getAttribute('data-testid') || '';

      // Check if this focused element is inside a tweet � find the ancestor article
      let article: any = focused;
      while (article && article.tagName?.toLowerCase() !== 'article') {
        article = article.parentElement;
      }
      if (article && article.getAttribute('data-testid') === 'tweet') {
        const tweetText = (article.querySelector('[data-testid="tweetText"]') as any)?.innerText?.trim()?.slice(0, 120) || '';
        const author = (article.querySelector('[data-testid="User-Name"]') as any)?.innerText?.trim()?.replace(/\n/g, ' ')?.slice(0, 60) || '';
        const link = (article.querySelector('a[href*="/status/"]') as any)?.href || '';
        const idMatch = link.match(/\/status\/(\d+)/);
        const allTweets = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'));
        const idx = allTweets.indexOf(article);
        return {
          type: 'tweet',
          position: idx + 1,
          totalVisible: allTweets.length,
          author,
          text: tweetText,
          tweetId: idMatch ? idMatch[1] : '',
          link,
          focusedElement: { tag, role, ariaLabel, testId },
        };
      }

      return {
        type: 'element',
        tag,
        role,
        ariaLabel,
        text,
        testId,
      };
    });

    if (info.type === 'tweet') {
      const lines = [
        `?? KEYBOARD FOCUS: Tweet #${info.position} of ${info.totalVisible} visible`,
        `   Author: ${info.author || '(unknown)'}`,
        `   Text: ${info.text ? info.text.slice(0, 100) : '(no text)'}`,
        info.tweetId ? `   Tweet ID: ${info.tweetId}` : '',
        info.link ? `   Link: ${info.link}` : '',
        ``,
        `NAVIGATION HINT: To reach tweet #N, press j a total of N times from no selection, or adjust from current position.`,
        `Current position is #${info.position}. Press j to go forward, k to go back.`,
      ].filter(Boolean);
      return lines.join('\n');
    }

    return JSON.stringify({ tag: info.tag || null, role: info.role || null, name: info.ariaLabel || null, text: info.text || '', test_id: info.testId || null, focused: info.focused !== false, ...(info.type === 'tweet' ? { x_context: info } : {}) }, null, 2);
  } catch (err: any) {
    return `ERROR: getFocusedItem failed: ${err.message}`;
  }
}

export async function browserClose(sessionId: string): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  // Native close is authoritative and idempotent. Call it even when the
  // gateway map is missing so stale Electron tabs are reclaimed during test
  // teardown instead of being mistaken for an already-closed session.
  const targetIsKnownInHouse = shouldUseInHouseBrowser(resolved) || !!getInHouseSession(resolved);
  const mayHaveOrphanedNativeSession = !sessions.has(resolved) && isInHouseBrowserAvailable();
  if (targetIsKnownInHouse || mayHaveOrphanedNativeSession) {
    try {
      const result: any = await callInHouseBrowser('close', { sessionId: resolved });
      const closedTabs = Number(result?.closedTabs || 0);
      if (targetIsKnownInHouse || closedTabs > 0) {
        clearInHouseSession(resolved);
        browserSessionMetadata.delete(resolved);
        removePersistedBrowserSessionRecord(resolved);
        return closedTabs > 0
          ? `Closed Prometheus in-house browser session (${closedTabs} tab${closedTabs === 1 ? '' : 's'}).`
          : 'Prometheus in-house browser session was already closed.';
      }
    } catch (err: any) {
      if (!targetIsKnownInHouse && !getInHouseSession(resolved)) {
        // The fallback probe is best-effort for a session whose lane was lost;
        // continue to the ordinary session bookkeeping below.
      } else {
        if (!getInHouseSession(resolved)) return `ERROR: In-house browser close failed: ${err.message}`;
        // If Electron is already shutting down, still clear the gateway's
        // mapping and report the transport warning instead of claiming that a
        // regular browser session was closed.
        clearInHouseSession(resolved);
        browserSessionMetadata.delete(resolved);
        removePersistedBrowserSessionRecord(resolved);
        return `Prometheus in-house browser close requested, but the native target disconnected: ${err.message}`;
      }
    }
  }
  const pendingInit = browserSessionInitInFlight.get(resolved);
  if (pendingInit) await pendingInit.catch(() => {});
  const session = sessions.get(resolved);
  if (!session) return 'No browser session to close.';
  const persistedSessionId = String(session.sessionId || resolved || '').trim();
  try {
    await stopBrowserLiveStream(resolved, 'Live browser stream stopped because the browser tab closed.').catch(() => {});
    await session.page.close();
    if (session.ownsBrowser) {
      // browser.close() only disconnects from a CDP-attached Chrome, so an
      // isolated Chrome we launched must be shut down explicitly or it leaks
      // as a stray window. Never kill the main Prometheus Chrome here, and
      // never kill a Chrome another live session is still using.
      const sharedPort = !!session.debugPort && Array.from(sessions.entries())
        .some(([id, other]) => id !== resolved && other !== session && other.debugPort === session.debugPort);
      if (session.isolated && session.transport !== 'extension' && !sharedPort) {
        await terminateLaunchedChrome(session.browser, session.debugPort, session.profileDir).catch(() => false);
      }
      try { await session.browser.close(); } catch {}
    }
    clearBrowserSessionEphemeralState(resolved, session);
    sessions.delete(resolved);
    if (resolved !== sessionId) sessions.delete(sessionId);
    browserSessionMetadata.delete(resolved);
    removePersistedBrowserSessionRecord(persistedSessionId);
    console.log(`[Browser] Session closed for ${sessionId}`);
    return 'Browser tab closed.';
  } catch (err: any) {
    await stopBrowserLiveStream(resolved, 'Live browser stream stopped because the browser tab closed.').catch(() => {});
    clearBrowserSessionEphemeralState(resolved, session);
    sessions.delete(resolved);
    if (resolved !== sessionId) sessions.delete(sessionId);
    browserSessionMetadata.delete(resolved);
    removePersistedBrowserSessionRecord(persistedSessionId);
    return `Browser closed (with warning: ${err.message})`;
  }
}

export async function browserScroll(
  sessionId: string,
  direction: 'down' | 'up',
  multiplier?: number,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const recovery = await recoverInHouseSessionMapping(sessionId);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(sessionId)) {
    const resolved = resolveSessionId(sessionId);
    const amount = Math.min(Math.max(Number(multiplier || 1) || 1, 0.25), 5);
    const deltaY = (direction === 'up' ? -1 : 1) * Math.round(640 * amount);
    const wheel: any = await callInHouseBrowser('input', { sessionId: resolved, action: 'wheel', deltaY, deltaX: 0 });
    // Older Electron builds return only { ok }; treat unknown as moved.
    const moved = wheel?.moved !== false;
    const where = wheel?.after && typeof wheel.after.y === 'number' ? ` (scrollY ${wheel.before?.y ?? '?'} -> ${wheel.after.y})` : '';
    const summary = moved
      ? `Scrolled ${direction} in Prometheus in-house browser${where}.`
      : `Scroll ${direction} had no effect: the page is already at the ${direction === 'down' ? 'bottom' : 'top'} or is not scrollable${where}.`;
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_scroll');
    if (shouldReturnSnapshot(observeMode)) return `${summary}\n\n${await browserSnapshotInHouse(resolved)}`;
    broadcastInHouseBrowserStatus(resolved, 'browser_scroll', summary, { active: true });
    return summary;
  }
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  const clampedMult = Math.min(Math.max(multiplier || 1.0, 0.5), 4.0);

  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_scroll');
    const fastAck = shouldUseFastBrowserAck(observeMode);
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    const viewport = getBrowserViewportSize(session);
    if (!fastAck) {
      await emitBrowserAgentCursor(sessionId, {
        x: Math.round(viewport.width / 2),
        y: Math.round(viewport.height * 0.72),
        kind: 'scroll',
        phase: 'start',
        label: `Scroll ${direction}`,
      });
    }
    await session.page.evaluate((mult: number) => {
      const pageGlobal = globalThis as any;
      pageGlobal.scrollBy(0, pageGlobal.innerHeight * mult);
    }, direction === 'up' ? -clampedMult : clampedMult);

    if (!fastAck) await session.page.waitForTimeout(1200); // X/Twitter needs ~1s for new articles to mount before observation.
    if (!fastAck) {
      await emitBrowserAgentCursor(sessionId, {
        x: Math.round(viewport.width / 2),
        y: Math.round(viewport.height * 0.72),
        kind: 'scroll',
        phase: 'end',
        label: `Scrolled ${direction}`,
      });
    }

    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const elementCount = parseSnapshotElementCount(snapshot);
      return attachShortcutsContext(
        `Scrolled ${direction} ${clampedMult}x viewport. ` +
        `Snapshot refreshed (${elementCount} elements). ` +
        `Use browser_snapshot only if you need fresh @ref interactions.`,
        session.page.url(),
        sessionId,
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Scrolled ${direction} ${clampedMult}x viewport.`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Scrolled ${direction} ${clampedMult}x viewport.`);
  } catch (err: any) {
    return `ERROR: Scroll failed: ${err.message}`;
  }
}

function browserFeedItemKey(item: BrowserFeedItem): string {
  return String(
    item.id
    || item.link
    || `${item.source || ''}|${item.handle || ''}|${item.author || ''}|${item.title || ''}|${item.text || item.snippet || ''}`,
  ).replace(/\s+/g, ' ').trim().toLowerCase();
}

function textBlockKey(text: string): string {
  return stableHash(String(text || '').replace(/\s+/g, ' ').trim().slice(0, 900));
}

function appendUniqueBrowserFeedItems(
  target: BrowserFeedItem[],
  seen: Set<string>,
  items: BrowserFeedItem[],
  limit: number,
): number {
  let added = 0;
  for (const item of items) {
    const key = browserFeedItemKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(item);
    added += 1;
    if (target.length >= limit) break;
  }
  return added;
}

function appendUniqueTextBlocks(
  target: string[],
  seen: Set<string>,
  blocks: string[],
  limit: number,
): number {
  let added = 0;
  for (const block of blocks) {
    const text = String(block || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = textBlockKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(text);
    added += 1;
    if (target.length >= limit) break;
  }
  return added;
}

function buildBrowserSnapshotDelta(
  prevSnapshot: string,
  newSnapshot: string,
  pass: number,
  scrollY: number,
): BrowserScrollSnapshotDelta {
  const toElemSet = (snap: string) => new Set(
    String(snap || '').split('\n').filter((line) => /@\d+/.test(line)).slice(0, 400),
  );
  const prevSet = toElemSet(prevSnapshot);
  const newSet = toElemSet(newSnapshot);
  return {
    pass,
    scrollY,
    added: [...newSet].filter((line) => !prevSet.has(line)).slice(0, 80),
    removed: [...prevSet].filter((line) => !newSet.has(line)).slice(0, 80),
    totalElements: newSet.size,
  };
}

export async function browserDrag(
  sessionId: string,
  options: {
    from_ref?: number;
    to_ref?: number;
    from_x?: number;
    from_y?: number;
    to_x?: number;
    to_y?: number;
    steps?: number;
    observe?: BrowserObserveMode;
  } = {},
): Promise<string> {
  if (getInHouseSession(sessionId)) {
    return inHouseUnsupportedToolMessage('browser_drag', 'Use browser_click / browser_fill / browser_scroll for in-house browser interactions.');
  }
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  try {
    const observeMode = options.observe || resolveBrowserObserveMode('browser_drag');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    const start = await resolveViewportPointFromTarget(session.page, {
      ref: options.from_ref,
      x: options.from_x,
      y: options.from_y,
    }, 'browser_drag start');
    const end = await resolveViewportPointFromTarget(session.page, {
      ref: options.to_ref,
      x: options.to_x,
      y: options.to_y,
    }, 'browser_drag end');
    const steps = Math.max(2, Math.min(80, Math.floor(Number(options.steps) || 20)));

    await session.page.mouse.move(start.x, start.y);
    await session.page.mouse.down();
    await session.page.mouse.move(end.x, end.y, { steps });
    await session.page.mouse.up();
    await session.page.waitForTimeout(700);

    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const elementCount = parseSnapshotElementCount(snapshot);
      return attachShortcutsContext(
        `Dragged from ${start.label} to ${end.label} in ${steps} step(s). Snapshot refreshed (${elementCount} elements).`,
        session.page.url(),
        sessionId,
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Dragged from ${start.label} to ${end.label} in ${steps} step(s).`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Dragged from ${start.label} to ${end.label} in ${steps} step(s).`);
  } catch (err: any) {
    return `ERROR: browser_drag failed: ${err.message}`;
  }
}

function buildInHouseScrollCollectionScript(characterBudget: number): string {
  const budget = Math.max(0, Math.min(100_000, Math.floor(Number(characterBudget) || 0)));
  return `(() => {
    const doc = globalThis.document;
    const normalize = (value, maxLen = 1000) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, maxLen);
    const toAbs = (href) => { try { return new URL(href, globalThis.location.href).toString(); } catch { return String(href || '').trim(); } };
    const tweets = Array.from(doc?.querySelectorAll?.('article[data-testid="tweet"]') || []).map((el) => {
      const statusLink = Array.from(el.querySelectorAll('a[href*="/status/"]')).map((a) => toAbs(a.getAttribute('href') || a.href || '')).find((href) => /\\/status\\/\\d+/i.test(href)) || '';
      const idMatch = statusLink.match(/\\/status\\/(\\d+)/i);
      const nameBlock = normalize(el.querySelector('[data-testid="User-Name"]')?.innerText, 240);
      const handle = (nameBlock.match(/@[a-z0-9_]{1,30}/i) || [''])[0];
      const text = normalize(el.querySelector('[data-testid="tweetText"]')?.innerText, 1800);
      const time = String(el.querySelector('time')?.dateTime || normalize(el.querySelector('time')?.textContent, 80));
      const replies = normalize(el.querySelector('[data-testid="reply"]')?.textContent, 40);
      const reposts = normalize(el.querySelector('[data-testid="retweet"]')?.textContent, 40);
      const likes = normalize(el.querySelector('[data-testid="like"]')?.textContent, 40);
      const views = normalize(el.querySelector('a[href$="/analytics"], [data-testid="viewCount"]')?.textContent, 40);
      const imageUrls = Array.from(el.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]')).map((img) => toAbs(img.currentSrc || img.src || img.getAttribute('src') || '')).filter(Boolean);
      const video = el.querySelector('[data-testid="videoPlayer"] video, video');
      const videoUrl = String(video?.currentSrc || video?.src || '').trim();
      return {
        id: idMatch ? idMatch[1] : '', author: nameBlock, handle, time, text,
        link: statusLink, hasImage: imageUrls.length > 0, hasVideo: !!videoUrl,
        media: [...imageUrls.map((url) => ({ type: 'image', url })), ...(videoUrl ? [{ type: 'video', url: videoUrl }] : [])],
        metrics: { replies, reposts, likes, views },
      };
    });
    const tweetText = tweets.map((item) => [
      item.id ? 'Tweet ID: ' + item.id : '', item.author ? 'Author: ' + item.author : '',
      item.time ? 'Time: ' + item.time : '', item.link ? 'Link: ' + item.link : '',
      item.text ? 'Text:\\n' + item.text : 'Text: (no visible text)',
      'Metrics: replies ' + (item.metrics.replies || '0') + ' | reposts ' + (item.metrics.reposts || '0') + ' | likes ' + (item.metrics.likes || '0') + (item.metrics.views ? ' | views ' + item.metrics.views : ''),
    ].filter(Boolean).join('\\n')).join('\\n---TWEET---\\n');
    const bodyText = String(doc?.body?.innerText || '').replace(/[^\\S\\n]{3,}/g, ' ').replace(/\\n{4,}/g, '\\n\\n').trim();
    const text = (tweetText || bodyText).slice(0, ${budget});
    const scrollY = Number(globalThis.scrollY || 0);
    const innerHeight = Number(globalThis.innerHeight || 0);
    const scrollHeight = Number(doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight || 0);
    return {
      url: String(globalThis.location?.href || ''), title: String(doc?.title || ''), text,
      pageText: bodyText.slice(0, ${budget}), tweets, textBlocks: bodyText ? [bodyText.slice(0, 4000)] : [],
      scrollY, innerHeight, scrollHeight, bottom: scrollHeight <= scrollY + innerHeight + 4,
    };
  })()`;
}

async function readInHouseScrollCollectionPage(sessionId: string, characterBudget: number): Promise<any> {
  const state = await callInHouseBrowser('run-js', {
    sessionId: resolveSessionId(sessionId),
    code: buildInHouseScrollCollectionScript(characterBudget),
  });
  return state && typeof state === 'object' ? state : {};
}

async function browserScrollCollectInHouse(
  sessionId: string,
  options: {
    scrolls?: number;
    direction?: 'down' | 'up';
    multiplier?: number;
    delay_ms?: number;
    stop_text?: string;
    max_chars?: number;
    include_initial?: boolean;
    max_seconds?: number;
    stop_after_no_new?: number;
    include_snapshots?: boolean;
    include_structured?: boolean;
  } = {},
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const scrolls = Math.min(Math.max(Number(options.scrolls || 5) || 5, 1), 30);
  const direction = options.direction === 'up' ? 'up' : 'down';
  const mult = Math.min(Math.max(Number(options.multiplier || 1.5) || 1.5, 0.5), 4.0);
  const delayMs = Math.min(Math.max(Number(options.delay_ms || 1500) || 1500, 250), 5000);
  const stopText = String(options.stop_text || '');
  const maxChars = Math.min(Math.max(Number(options.max_chars || 50000) || 50000, 5000), 100000);
  const includeInitial = options.include_initial !== false;
  const maxSeconds = Math.min(Math.max(Number(options.max_seconds || 45) || 45, 5), 180);
  const stopAfterNoNew = Math.min(Math.max(Number(options.stop_after_no_new || 3) || 3, 1), 10);
  const includeSnapshots = options.include_snapshots !== false;
  const includeStructured = options.include_structured !== false;
  const seenLines = new Set<string>();
  const allNewText: string[] = [];
  const scrollLog: string[] = [];
  const structuredItems: BrowserFeedItem[] = [];
  const structuredTextBlocks: string[] = [];
  const snapshotDeltas: BrowserScrollSnapshotDelta[] = [];
  const seenStructuredItems = new Set<string>();
  const seenTextBlocks = new Set<string>();
  let totalChars = 0;
  let stopReason = 'completed all scrolls';
  let consecutiveNoNew = 0;
  const startedAt = Date.now();
  try {
    const totalPasses = includeInitial ? scrolls + 1 : scrolls;
    let previousSnapshot = includeSnapshots ? await browserSnapshotInHouse(resolved).catch(() => '') : '';
    for (let pass = 0; pass < totalPasses; pass++) {
      const isInitialPass = includeInitial && pass === 0;
      const previousState = pass > 0 ? await readInHouseScrollCollectionPage(resolved, 200).catch(() => ({})) : null;
      const previousScrollY = Number(previousState?.scrollY || 0);
      if (!isInitialPass) {
        const deltaY = (direction === 'up' ? -1 : 1) * Math.round(640 * mult);
        await callInHouseBrowser('input', { sessionId: resolved, action: 'wheel', deltaY, deltaX: 0 });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const state = await readInHouseScrollCollectionPage(resolved, Math.max(0, maxChars - totalChars));
      const pageText = String(state?.text || '');
      const currentScrollY = Number(state?.scrollY || 0);
      let structuredAdded = 0;
      let textBlockAdded = 0;
      if (includeStructured) {
        structuredAdded = appendUniqueBrowserFeedItems(structuredItems, seenStructuredItems, Array.isArray(state?.tweets) ? state.tweets : [], 300);
        textBlockAdded = appendUniqueTextBlocks(structuredTextBlocks, seenTextBlocks, Array.isArray(state?.textBlocks) ? state.textBlocks : [], 300);
      }
      if (includeSnapshots) {
        const nextSnapshot = await browserSnapshotInHouse(resolved).catch(() => '');
        if (nextSnapshot) {
          if (previousSnapshot) snapshotDeltas.push(buildBrowserSnapshotDelta(previousSnapshot, nextSnapshot, pass + 1, currentScrollY));
          previousSnapshot = nextSnapshot;
        }
      }
      const isStructuredTweets = pageText.includes('\\n---TWEET---\\n');
      const chunks = isStructuredTweets
        ? pageText.split('\\n---TWEET---\\n')
        : pageText.split('\\n').map((line) => line.trim()).filter(Boolean);
      const newLines: string[] = [];
      for (const chunk of chunks) {
        const normalized = String(chunk || '').replace(/\\s+/g, ' ').trim();
        if (!normalized) continue;
        const link = String(chunk).match(/^Link:\\s*(.+)$/im)?.[1];
        const id = String(chunk).match(/^Tweet ID:\\s*(\\S+)/im)?.[1];
        const key = isStructuredTweets ? (id ? 'tweet:' + id : link ? 'link:' + link.trim() : normalized.slice(0, 400)) : normalized.slice(0, 220);
        if (!seenLines.has(key)) { seenLines.add(key); newLines.push(chunk); }
      }
      const remaining = Math.max(0, maxChars - totalChars);
      const newText = (isStructuredTweets ? newLines.join('\\n---TWEET---\\n') : newLines.join('\\n')).slice(0, remaining);
      const newChars = newText.length;
      const newSignals = newChars + structuredAdded + textBlockAdded;
      consecutiveNoNew = newSignals > 0 ? 0 : consecutiveNoNew + 1;
      scrollLog.push(isInitialPass
        ? `  #${pass + 1}: initial viewport +${newChars.toLocaleString()} chars, +${structuredAdded} item(s), +${textBlockAdded} block(s), scrollY=${currentScrollY}`
        : `  #${pass + 1}: scrolled ${direction} ${mult}x +${newChars.toLocaleString()} chars, +${structuredAdded} item(s), +${textBlockAdded} block(s), scrollY=${currentScrollY}`);
      if (newChars > 0) { allNewText.push(newText); totalChars += newChars; }
      try {
        broadcastWS({ type: 'browser:collect:progress', sessionId: resolved, mode: isStructuredTweets ? 'x_text' : 'text', collected: seenLines.size, structuredItems: structuredItems.length, textBlocks: structuredTextBlocks.length, chars: totalChars, pass: pass + 1, maxPasses: totalPasses, stopReason, timestamp: Date.now() });
      } catch {}
      if (totalChars >= maxChars) { stopReason = 'max_chars reached'; break; }
      if (Date.now() - startedAt >= maxSeconds * 1000) { stopReason = 'max_seconds reached'; break; }
      if (!isInitialPass && direction === 'down' && (state?.bottom === true || currentScrollY === previousScrollY)) { scrollLog[scrollLog.length - 1] += ' � page bottom reached, stopping'; stopReason = 'reached bottom'; break; }
      if (!isInitialPass && consecutiveNoNew >= stopAfterNoNew) { stopReason = `no new text after ${consecutiveNoNew} pass(es)`; break; }
      if (stopText && pageText.includes(stopText)) { stopReason = `stop_text "${stopText}" found`; break; }
    }
    const collectedText = allNewText.join('\\n\\n').slice(0, maxChars);
    const scrollActions = includeInitial ? Math.max(0, scrollLog.length - 1) : scrollLog.length;
    const structuredPayload = { mode: 'browser_scroll_collect', url: getInHouseSession(resolved)?.url || '', quality: { uniqueTextLines: seenLines.size, textChars: totalChars, structuredItems: structuredItems.length, textBlocks: structuredTextBlocks.length, snapshotDeltas: snapshotDeltas.length }, items: structuredItems.slice(0, 120), textBlocks: structuredTextBlocks.slice(0, 80), snapshot_deltas: snapshotDeltas.slice(-12) };
    return [
      `browser_scroll_collect: ${scrollLog.length} collection pass(es), ${scrollActions} scroll action(s) ${direction} (stopped: ${stopReason})`,
      `Total text collected: ${totalChars.toLocaleString()} chars | Unique lines: ${seenLines.size} | Structured items: ${structuredItems.length} | Text blocks: ${structuredTextBlocks.length}`,
      '', '=== STRUCTURED COLLECTION (native in-house browser) ===', JSON.stringify(structuredPayload, null, 2),
      '', '=== COLLECTED TEXT (deduplicated) ===', collectedText, '', '=== SCROLL LOG ===', ...scrollLog,
    ].join('\\n');
  } catch (err: any) {
    return `ERROR: browser_scroll_collect failed: ${err.message}`;
  }
}

async function browserScrollCollectV2InHouse(sessionId: string, options: Record<string, any> = {}): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const inHouse = getInHouseSession(resolved);
  if (!inHouse) return 'ERROR: No in-house browser session. Use browser_open with target="inhouse" first.';
  const maxScrolls = Math.min(Math.max(Number(options.max_scrolls ?? options.scrolls ?? 8) || 8, 0), 40);
  const limit = Math.min(Math.max(Number(options.limit || 50) || 50, 1), 500);
  const direction: 'down' | 'up' = String(options.direction || 'down').toLowerCase() === 'up' ? 'up' : 'down';
  const multiplier = Math.min(Math.max(Number(options.multiplier || 1.5) || 1.5, 0.5), 4.0);
  const delayMs = Math.min(Math.max(Number(options.delay_ms || 1200) || 1200, 250), 5000);
  const maxSeconds = Math.min(Math.max(Number(options.max_seconds || 30) || 30, 5), 180);
  const stopText = String(options.stop_text || '').trim();
  try {
    const schemaInput = options.schema && typeof options.schema === 'object' ? { ...options.schema, ...options } : { ...options };
    const resolvedSchema = resolveBrowserExtractionSchemaForUrl(inHouse.url, schemaInput, 'browser_scroll_collect_v2');
    if (!resolvedSchema.schema) return `ERROR: ${resolvedSchema.error || 'Could not resolve extraction schema.'}`;
    const schema = resolvedSchema.schema;
    const perPassLimit = Math.min(Math.max(Number(options.per_pass_limit || schema.limit || 80) || 80, 1), 500);
    const seenKeys = new Set<string>();
    const items: Array<Record<string, any>> = [];
    const scrollLog: string[] = [];
    let deduped = 0;
    let missingRequiredFields = 0;
    let stopReason = 'completed all passes';
    const startedAt = Date.now();
    for (let pass = 0; pass <= maxScrolls; pass++) {
      const before = pass > 0 ? await readInHouseScrollCollectionPage(resolved, 200).catch(() => ({})) : {};
      const previousScrollY = Number(before?.scrollY || 0);
      if (pass > 0) {
        const deltaY = (direction === 'up' ? -1 : 1) * Math.round(640 * multiplier);
        await callInHouseBrowser('input', { sessionId: resolved, action: 'wheel', deltaY, deltaX: 0 });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const state = await readInHouseScrollCollectionPage(resolved, 200);
      const extracted = await extractStructuredItemsFromInHousePage(resolved, schema, { limit: perPassLimit });
      let addedThisPass = 0;
      for (const entry of extracted) {
        const item = entry.item || {};
        if (!Object.values(item).some((value) => value != null && String(value).trim() !== '')) continue;
        const dedupeValue = schema.dedupeKey ? item[schema.dedupeKey] : null;
        const source = dedupeValue != null && String(dedupeValue).trim()
          ? `${schema.dedupeKey}:${String(dedupeValue).trim().slice(0, 500)}`
          : entry.meta?.dedupeSource || JSON.stringify(item);
        const hash = stableHash(String(source).slice(0, 1200));
        if (seenKeys.has(hash)) { deduped += 1; continue; }
        seenKeys.add(hash);
        items.push(item);
        missingRequiredFields += Number(entry.meta?.requiredMissing || 0) || 0;
        addedThisPass += 1;
        if (items.length >= limit) { stopReason = 'limit reached'; break; }
      }
      const currentScrollY = Number(state?.scrollY || 0);
      scrollLog.push(pass === 0
        ? `#${pass + 1}: initial viewport -> +${addedThisPass} items (scrollY=${currentScrollY})`
        : `#${pass + 1}: scrolled ${direction} ${multiplier}x -> +${addedThisPass} items (scrollY=${currentScrollY})`);
      try { broadcastWS({ type: 'browser:collect:progress', sessionId: resolved, mode: 'structured', schemaName: schema.requestedSchemaName || schema.saveAs || schema.name || '', itemRoot: schema.itemRootName || '', collected: items.length, deduped, pass: pass + 1, maxPasses: maxScrolls + 1, stopReason, timestamp: Date.now() }); } catch {}
      if (items.length >= limit) break;
      if (Date.now() - startedAt >= maxSeconds * 1000) { stopReason = 'max_seconds reached'; break; }
      if (pass > 0 && direction === 'down' && (state?.bottom === true || currentScrollY === previousScrollY)) { stopReason = 'reached bottom'; break; }
      if (stopText && String(state?.pageText || state?.text || '').includes(stopText)) { stopReason = `stop_text "${stopText}" found`; break; }
    }
    const saveName = String(schema.saveAs || '').trim();
    if (saveName) {
      const savedResult = saveNamedBrowserExtractionSchemaForUrl(inHouse.url, {
        name: saveName,
        aliases: schema.aliases,
        itemRoot: schema.itemRootName,
        containerSelector: schema.containerSelector,
        dedupeKey: schema.dedupeKey,
        limit: schema.limit,
        fields: schema.fields,
        url: inHouse.url,
      });
      broadcastBrowserKnowledgeSnapshot(resolved, inHouse.url, savedResult.site, {
        action: 'saved_schema',
        savedKind: 'schema',
        saved: savedResult.saved,
      });
    }
    const requiredFieldCount = Object.values(schema.fields).filter((field) => field?.required === true).length;
    const completeness = requiredFieldCount > 0 && items.length > 0 ? Math.max(0, 1 - (missingRequiredFields / Math.max(1, items.length * requiredFieldCount))) : (items.length > 0 ? 1 : 0);
    const retrieval = Math.min(1, items.length / Math.max(1, limit));
    const confidence = Number(((completeness * 0.7 + retrieval * 0.3) || 0).toFixed(2));
    return JSON.stringify({
      mode: 'browser_scroll_collect_v2',
      site: (() => { try { return String(new URL(inHouse.url).hostname || '').replace(/^www\./i, '').toLowerCase(); } catch { return ''; } })(),
      schema: { requested: schema.requestedSchemaName || '', source: schema.source, item_root: schema.itemRootName || '', container_selector: schema.containerSelector, dedupe_key: schema.dedupeKey || '', fields: Object.keys(schema.fields) },
      quality: { requested: limit, found: items.length, returned: items.length, missingRequiredFields, deduped, confidence },
      scrollsPerformed: Math.max(0, scrollLog.length - 1), passesPerformed: scrollLog.length, stopReason, durationMs: Date.now() - startedAt, scrollLog, items,
    }, null, 2);
  } catch (err: any) {
    return `ERROR: browser_scroll_collect_v2 failed: ${err.message}`;
  }
}

export async function browserScrollCollect(
  sessionId: string,
  options: {
    scrolls?: number;
    direction?: 'down' | 'up';
    multiplier?: number;
    delay_ms?: number;
    stop_text?: string;
    max_chars?: number;
    include_initial?: boolean;
    max_seconds?: number;
    stop_after_no_new?: number;
    include_snapshots?: boolean;
    include_structured?: boolean;
  } = {}
): Promise<string> {
  const resolvedSessionId = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolvedSessionId);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolvedSessionId)) return browserScrollCollectInHouse(resolvedSessionId, options);
  const session = sessions.get(resolvedSessionId);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  const scrolls   = Math.min(Math.max(options.scrolls || 5, 1), 30);
  const direction  = options.direction || 'down';
  const mult       = Math.min(Math.max(options.multiplier || 1.5, 0.5), 4.0);
  const delayMs    = Math.min(Math.max(options.delay_ms || 1500, 500), 5000);
  const stopText   = options.stop_text || '';
  const maxChars   = Math.min(Math.max(options.max_chars || 50000, 5000), 100000);
  const includeInitial = options.include_initial !== false;
  const maxSeconds = Math.min(Math.max(Number(options.max_seconds || 45) || 45, 5), 180);
  const stopAfterNoNew = Math.min(Math.max(Number(options.stop_after_no_new || 3) || 3, 1), 10);
  const includeSnapshots = options.include_snapshots !== false;
  const includeStructured = options.include_structured !== false;

  const seenLines  = new Set<string>();
  const allNewText: string[] = [];
  const scrollLog: string[]  = [];
  const structuredItems: BrowserFeedItem[] = [];
  const structuredTextBlocks: string[] = [];
  const snapshotDeltas: BrowserScrollSnapshotDelta[] = [];
  const seenStructuredItems = new Set<string>();
  const seenTextBlocks = new Set<string>();
  let totalChars   = 0;
  let stopReason   = 'completed all scrolls';
  let consecutiveNoNew = 0;
  const startedAt = Date.now();

  try {
    const totalPasses = includeInitial ? scrolls + 1 : scrolls;
    let previousSnapshot = includeSnapshots ? await takeSnapshot(session.page, 120).catch(() => '') : '';
    if (previousSnapshot) rememberSnapshot(session, previousSnapshot);
    for (let pass = 0; pass < totalPasses; pass++) {
      const isInitialPass = includeInitial && pass === 0;
      const prevScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
      if (!isInitialPass) {
        // Scroll
        await session.page.evaluate((m: number) => {
          (globalThis as any).scrollBy(0, (globalThis as any).innerHeight * m);
        }, direction === 'up' ? -mult : mult);

        // Wait for content to load
        await session.page.waitForTimeout(delayMs);
      }

      // Read visible text � with structured extraction for X.com/Twitter
      const pageText = await session.page.evaluate((characterBudget: number) => {
        const doc = (globalThis as any).document;
        const normalize = (value: any, maxLen: number = 1000) =>
          String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
        const toAbs = (href: string) => {
          try { return new URL(href, (globalThis as any).location.href).toString(); } catch { return String(href || '').trim(); }
        };
        // X.com structured tweet extraction
        const tweetEls = doc.querySelectorAll('article[data-testid="tweet"]');
        if (tweetEls.length > 0) {
          return Array.from(tweetEls).map((el: any) => {
            const nameBlock = normalize(el.querySelector('[data-testid="User-Name"]')?.innerText, 240);
            const text = String(el.querySelector('[data-testid="tweetText"]')?.innerText || '').trim();
            const statusLink = Array.from(el.querySelectorAll('a[href*="/status/"]'))
              .map((a: any) => toAbs(a.getAttribute('href') || a.href || ''))
              .find((href: string) => /\/status\/\d+/i.test(href)) || '';
            const time = (el.querySelector('time') as any)?.dateTime || normalize(el.querySelector('time')?.textContent, 80);
            const replies = normalize(el.querySelector('[data-testid="reply"]')?.textContent, 40);
            const reposts = normalize(el.querySelector('[data-testid="retweet"]')?.textContent, 40);
            const likes = normalize(el.querySelector('[data-testid="like"]')?.textContent, 40);
            const views = normalize(el.querySelector('a[href$="/analytics"]')?.textContent, 40);
            const idMatch = statusLink.match(/\/status\/(\d+)/i);
            const lines = [
              idMatch ? `Tweet ID: ${idMatch[1]}` : '',
              nameBlock ? `Author: ${nameBlock}` : '',
              time ? `Time: ${time}` : '',
              statusLink ? `Link: ${statusLink}` : '',
              text ? `Text:\n${text}` : 'Text: (no visible text)',
              `Metrics: replies ${replies || '0'} | reposts ${reposts || '0'} | likes ${likes || '0'}${views ? ` | views ${views}` : ''}`,
            ].filter(Boolean);
            return lines.join('\n');
          }).join('\n---TWEET---\n').slice(0, characterBudget);
        }
        // General fallback � use live body.innerText (not a detached clone)
        const body = doc.body;
        if (!body) return '';
        return (body.innerText || '')
          .replace(/[^\S\n]{3,}/g, ' ')
          .replace(/\n{4,}/g, '\n\n')
          .trim().slice(0, characterBudget);
      }, Math.max(0, maxChars - totalChars));

      const currentScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
      let structuredPageType: BrowserPageType | '' = '';
      let structuredAdded = 0;
      let textBlockAdded = 0;
      if (includeStructured) {
        const structured = await extractStructuredFromPage(session.page, 60).catch(() => null);
        if (structured) {
          structuredPageType = structured.pageType;
          structuredAdded = appendUniqueBrowserFeedItems(structuredItems, seenStructuredItems, structured.extractedFeed || [], 300);
          textBlockAdded = appendUniqueTextBlocks(structuredTextBlocks, seenTextBlocks, structured.textBlocks || [], 300);
          const fallbackPageText = String(structured.pageText || '').replace(/\s+/g, ' ').trim();
          if (fallbackPageText && fallbackPageText.length >= 80) {
            textBlockAdded += appendUniqueTextBlocks(structuredTextBlocks, seenTextBlocks, [fallbackPageText], 300);
          }
        }
      }

      if (includeSnapshots) {
        const nextSnapshot = await takeSnapshot(session.page, 120).catch(() => '');
        if (nextSnapshot) {
          if (previousSnapshot) {
            snapshotDeltas.push(buildBrowserSnapshotDelta(previousSnapshot, nextSnapshot, pass + 1, currentScrollY));
          }
          previousSnapshot = nextSnapshot;
          rememberSnapshot(session, nextSnapshot);
        }
      }

      // Deduplicate � structured tweets vs general lines
      const isStructuredTweets = pageText.includes('\n---TWEET---\n');
      const chunks = isStructuredTweets
        ? pageText.split('\n---TWEET---\n')
        : pageText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      const newLines: string[] = [];
      for (const chunk of chunks) {
        // For tweets, dedup by tweet text content; for lines, by first 200 chars
        const normalizedChunk = chunk.replace(/\s+/g, ' ').trim();
        const linkMatch = chunk.match(/^Link:\s*(.+)$/im);
        const idMatch = chunk.match(/^Tweet ID:\s*(\S+)/im);
        const key = isStructuredTweets
          ? (idMatch?.[1] ? `tweet:${idMatch[1]}` : linkMatch?.[1] ? `link:${linkMatch[1].trim()}` : normalizedChunk.slice(0, 400))
          : normalizedChunk.slice(0, 220);
        if (!seenLines.has(key)) {
          seenLines.add(key);
          newLines.push(chunk);
        }
      }

      const remainingChars = Math.max(0, maxChars - totalChars);
      const newText = (isStructuredTweets ? newLines.join('\n---TWEET---\n') : newLines.join('\n')).slice(0, remainingChars);
      const newChars = newText.length;

      const newSignals = newChars + structuredAdded + textBlockAdded;
      consecutiveNoNew = newSignals > 0 ? 0 : consecutiveNoNew + 1;
      scrollLog.push(
        isInitialPass
          ? `  #${pass + 1}: initial viewport +${newChars.toLocaleString()} chars, +${structuredAdded} item(s), +${textBlockAdded} block(s)${structuredPageType ? `, type=${structuredPageType}` : ''}, scrollY=${currentScrollY}`
          : `  #${pass + 1}: scrolled ${direction} ${mult}x +${newChars.toLocaleString()} chars, +${structuredAdded} item(s), +${textBlockAdded} block(s)${structuredPageType ? `, type=${structuredPageType}` : ''}, scrollY=${currentScrollY}`
      );

      if (newChars > 0) {
        allNewText.push(newText);
        totalChars += newChars;
      }

      try {
        broadcastWS({
          type: 'browser:collect:progress',
          sessionId: resolvedSessionId,
          mode: isStructuredTweets ? 'x_text' : 'text',
          collected: seenLines.size,
          structuredItems: structuredItems.length,
          textBlocks: structuredTextBlocks.length,
          chars: totalChars,
          pass: pass + 1,
          maxPasses: totalPasses,
          stopReason,
          timestamp: Date.now(),
        });
      } catch {
        // Best-effort progress signal only.
      }

      // Early stop: max chars reached
      if (totalChars >= maxChars) {
        stopReason = 'max_chars reached';
        break;
      }

      if (Date.now() - startedAt >= maxSeconds * 1000) {
        stopReason = 'max_seconds reached';
        break;
      }

      // Early stop: page bottom (scroll position didn't change)
      if (!isInitialPass && currentScrollY === prevScrollY && direction === 'down') {
        scrollLog[scrollLog.length - 1] += ' � page bottom reached, stopping';
        stopReason = 'reached bottom';
        break;
      }

      if (!isInitialPass && consecutiveNoNew >= stopAfterNoNew) {
        stopReason = `no new text after ${consecutiveNoNew} pass(es)`;
        break;
      }

      // Early stop: sentinel text found
      if (stopText && pageText.includes(stopText)) {
        stopReason = `stop_text "${stopText}" found`;
        break;
      }
    }

    // Build result
    const collectedText = allNewText.join('\n\n').slice(0, maxChars);
    const scrollActions = includeInitial ? Math.max(0, scrollLog.length - 1) : scrollLog.length;
    const structuredPayload = {
      mode: 'browser_scroll_collect',
      url: session.page.url(),
      quality: {
        uniqueTextLines: seenLines.size,
        textChars: totalChars,
        structuredItems: structuredItems.length,
        textBlocks: structuredTextBlocks.length,
        snapshotDeltas: snapshotDeltas.length,
      },
      items: structuredItems.slice(0, 120),
      textBlocks: structuredTextBlocks.slice(0, 80),
      snapshot_deltas: snapshotDeltas.slice(-12),
    };
    const header = [
      `browser_scroll_collect: ${scrollLog.length} collection pass(es), ${scrollActions} scroll action(s) ${direction} (stopped: ${stopReason})`,
      `Total text collected: ${totalChars.toLocaleString()} chars | Unique lines: ${seenLines.size} | Structured items: ${structuredItems.length} | Text blocks: ${structuredTextBlocks.length}`,
      '',
    ].join('\n');

    const result = [
      header,
      '=== STRUCTURED COLLECTION (generic extractor) ===',
      JSON.stringify(structuredPayload, null, 2),
      '',
      '=== COLLECTED TEXT (deduplicated) ===',
      collectedText,
      '',
      '=== SCROLL LOG ===',
      ...scrollLog,
    ].join('\n');

    return result;

  } catch (err: any) {
    return `ERROR: browser_scroll_collect failed: ${err.message}`;
  }
}

export async function browserScrollCollectV2(
  sessionId: string,
  options: Record<string, any> = {},
): Promise<string> {
  const resolvedSessionId = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolvedSessionId);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolvedSessionId)) {
    return browserScrollCollectV2InHouse(resolvedSessionId, options);
  }
  const session = sessions.get(resolvedSessionId);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  const maxScrolls = Math.min(Math.max(Number(options.max_scrolls ?? options.scrolls ?? 8) || 8, 0), 40);
  const limit = Math.min(Math.max(Number(options.limit || 50) || 50, 1), 500);
  const direction: 'down' | 'up' = String(options.direction || 'down').trim().toLowerCase() === 'up' ? 'up' : 'down';
  const multiplier = Math.min(Math.max(Number(options.multiplier || 1.5) || 1.5, 0.5), 4.0);
  const delayMs = Math.min(Math.max(Number(options.delay_ms || 1200) || 1200, 250), 5000);
  const maxSeconds = Math.min(Math.max(Number(options.max_seconds || 30) || 30, 5), 180);
  const stopText = String(options.stop_text || '').trim();

  try {
    const schemaInput = options.schema && typeof options.schema === 'object'
      ? { ...(options.schema || {}), ...options }
      : { ...options };
    const resolved = resolveBrowserExtractionSchemaForUrl(
      session.page.url(),
      schemaInput,
      'browser_scroll_collect_v2',
    );
    if (!resolved.schema) return `ERROR: ${resolved.error || 'Could not resolve extraction schema.'}`;

    const perPassLimit = Math.min(
      Math.max(
        Number(options.per_pass_limit || Math.max(resolved.schema.limit, Math.min(limit * 2, 120))) || Math.max(limit, 40),
        1,
      ),
      500,
    );

    const seenKeys = new Set<string>();
    const scrollLog: string[] = [];
    const items: Array<Record<string, any>> = [];
    let deduped = 0;
    let missingRequiredFields = 0;
    let stopReason = 'completed all passes';
    const startedAt = Date.now();

    for (let pass = 0; pass <= maxScrolls; pass++) {
      let prevScrollY = 0;
      if (pass > 0) {
        prevScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
        await session.page.evaluate(
          ({ dir, mult }: { dir: 'down' | 'up'; mult: number }) => {
            const pageGlobal = globalThis as any;
            const distance = Number(pageGlobal.innerHeight || 0) * mult;
            pageGlobal.scrollBy(0, dir === 'up' ? -distance : distance);
          },
          { dir: direction, mult: multiplier },
        );
        await session.page.waitForTimeout(delayMs);
      }

      const currentScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
      const extracted = await extractStructuredItemsFromCurrentPage(session.page, resolved.schema, { limit: perPassLimit });
      let addedThisPass = 0;

      for (const entry of extracted) {
        const item = entry.item || {};
        const hasAnyValue = Object.values(item).some((value) => value != null && String(value).trim() !== '');
        if (!hasAnyValue) continue;

        const dedupeValue = resolved.schema.dedupeKey
          ? item[resolved.schema.dedupeKey]
          : null;
        const dedupeSource = dedupeValue != null && String(dedupeValue).trim() !== ''
          ? `${resolved.schema.dedupeKey}:${String(dedupeValue).trim().slice(0, 500)}`
          : entry.meta?.dedupeSource || JSON.stringify(item);
        const dedupeHash = stableHash(String(dedupeSource || '').slice(0, 1200));
        if (seenKeys.has(dedupeHash)) {
          deduped += 1;
          continue;
        }

        seenKeys.add(dedupeHash);
        items.push(item);
        missingRequiredFields += Number(entry.meta?.requiredMissing || 0) || 0;
        addedThisPass += 1;
        if (items.length >= limit) {
          stopReason = 'limit reached';
          break;
        }
      }

      scrollLog.push(
        pass === 0
          ? `#${pass + 1}: initial viewport -> +${addedThisPass} items (scrollY=${currentScrollY})`
          : `#${pass + 1}: scrolled ${direction} ${multiplier}x -> +${addedThisPass} items (scrollY=${currentScrollY})`,
      );

      try {
        broadcastWS({
          type: 'browser:collect:progress',
          sessionId: resolvedSessionId,
          mode: 'structured',
          schemaName: resolved.schema.requestedSchemaName || resolved.schema.saveAs || resolved.schema.name || '',
          itemRoot: resolved.schema.itemRootName || '',
          collected: items.length,
          deduped,
          pass: pass + 1,
          maxPasses: maxScrolls + 1,
          stopReason,
          timestamp: Date.now(),
        });
      } catch {
        // Best-effort progress signal only.
      }

      if (items.length >= limit) break;

      if (Date.now() - startedAt >= maxSeconds * 1000) {
        stopReason = 'max_seconds reached';
        break;
      }

      if (pass > 0 && direction === 'down' && currentScrollY === prevScrollY) {
        stopReason = 'reached bottom';
        break;
      }

      if (stopText) {
        const pageText = await session.page.evaluate(() => String((globalThis as any).document?.body?.innerText || ''));
        if (pageText.includes(stopText)) {
          stopReason = `stop_text "${stopText}" found`;
          break;
        }
      }
    }

    const saveName = String(resolved.schema.saveAs || '').trim();
    if (saveName) {
      const savedResult = saveNamedBrowserExtractionSchemaForUrl(session.page.url(), {
        name: saveName,
        aliases: resolved.schema.aliases,
        itemRoot: resolved.schema.itemRootName,
        containerSelector: resolved.schema.containerSelector,
        dedupeKey: resolved.schema.dedupeKey,
        limit: resolved.schema.limit,
        fields: resolved.schema.fields,
        url: session.page.url(),
      });
      broadcastBrowserKnowledgeSnapshot(resolvedSessionId, session.page.url(), savedResult.site, {
        action: 'saved_schema',
        savedKind: 'schema',
        saved: savedResult.saved,
      });
    }

    const requiredFieldCount = Object.values(resolved.schema.fields).filter((field) => field?.required === true).length;
    const completeness = requiredFieldCount > 0 && items.length > 0
      ? Math.max(0, 1 - (missingRequiredFields / Math.max(1, items.length * requiredFieldCount)))
      : (items.length > 0 ? 1 : 0);
    const retrieval = Math.min(1, items.length / Math.max(1, limit));
    const confidence = Number((((completeness * 0.7) + (retrieval * 0.3)) || 0).toFixed(2));

    const payload = {
      mode: 'browser_scroll_collect_v2',
      site: (() => {
        try {
          return String(new URL(session.page.url()).hostname || '').replace(/^www\./i, '').toLowerCase();
        } catch {
          return '';
        }
      })(),
      schema: {
        requested: resolved.schema.requestedSchemaName || '',
        source: resolved.schema.source,
        item_root: resolved.schema.itemRootName || '',
        container_selector: resolved.schema.containerSelector,
        dedupe_key: resolved.schema.dedupeKey || '',
        fields: Object.keys(resolved.schema.fields),
      },
      quality: {
        requested: limit,
        found: items.length,
        returned: items.length,
        missingRequiredFields,
        deduped,
        confidence,
      },
      scrollsPerformed: Math.max(0, scrollLog.length - 1),
      passesPerformed: scrollLog.length,
      stopReason,
      durationMs: Date.now() - startedAt,
      scrollLog,
      items,
    };

    return JSON.stringify(payload, null, 2);
  } catch (err: any) {
    return `ERROR: browser_scroll_collect_v2 failed: ${err.message}`;
  }
}

export function hasBrowserStructuredCollectionInput(options: Record<string, any> = {}): boolean {
  const schema = options.schema && typeof options.schema === 'object' && !Array.isArray(options.schema)
    ? options.schema
    : {};
  const hasSavedSchema = !!String(options.schema_name || options.use_schema || schema.schema_name || schema.use_schema || '').trim();
  const hasFields = !!(options.fields && typeof options.fields === 'object' && !Array.isArray(options.fields))
    || !!(schema.fields && typeof schema.fields === 'object' && !Array.isArray(schema.fields));
  const hasContainer = !!String(
    options.container_selector || options.item_root || options.root_name || options.container_name
    || schema.container_selector || schema.item_root || schema.root_name || schema.container_name
    || '',
  ).trim();
  return hasSavedSchema || (hasFields && hasContainer);
}

export async function getBrowserAdvisorPacket(
  sessionId: string,
  options?: { maxItems?: number; snapshotElements?: number },
): Promise<BrowserAdvisorPacket | null> {
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return null;
  try {
    return await buildAdvisorPacketForSession(session, options);
  } catch {
    return null;
  }
}

export async function browserGetPageText(
  sessionId: string,
  options?: { element?: string; query?: string; maxChars?: number; maxLines?: number },
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) {
    try {
      const sel = String(options?.element || '').trim();
      const code = sel
        ? `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? (el.innerText || el.textContent || '') : ''; })()`
        : `(() => (document.body && (document.body.innerText || document.body.textContent)) || '')()`;
      const text = await callInHouseBrowser<string>('run-js', { sessionId: resolved, code });
      const inHouse = getInHouseSession(resolved);
      return `Page: ${inHouse?.title || inHouse?.url || ''}\nURL: ${inHouse?.url || ''}\n\n${String(text || '').slice(0, 12000)}`;
    } catch (err: any) {
      return `ERROR: In-house browser get-page-text failed: ${err.message}`;
    }
  }
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  try {
    const url = session.page.url();
    const title = await session.page.title();
    const requestedElement = String(options?.element || '').trim();

    if (requestedElement) {
      const resolvedElement = await resolveNamedBrowserElement(sessionId, requestedElement);
      if (!resolvedElement) {
        const available = listNamedBrowserElementsForUrl(url).map((entry) => entry.name).slice(0, 12);
        const suffix = available.length
          ? ` Available saved elements for this site: ${available.join(', ')}.`
          : ' No saved elements exist for this site yet.';
        return attachShortcutsContext(
          `ERROR: Could not resolve a saved browser element named "${requestedElement}".${suffix}`,
          url,
          sessionId,
        );
      }
      const details = await session.page.locator(resolvedElement.selector).first().evaluate((node: any) => ({
        text: String((node?.innerText || node?.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 1200),
        value: String(node?.value || '').trim().slice(0, 400),
        placeholder: String(node?.getAttribute?.('placeholder') || '').trim().slice(0, 240),
        ariaLabel: String(node?.getAttribute?.('aria-label') || '').trim().slice(0, 240),
        href: String(node?.href || node?.getAttribute?.('href') || '').trim().slice(0, 400),
        src: String(node?.src || node?.getAttribute?.('src') || '').trim().slice(0, 400),
        htmlSnippet: String(node?.outerHTML || '').slice(0, 800),
      })).catch(() => null);
      const lines = [
        `Named Element: ${resolvedElement.entry.name}`,
        `Page: ${title}`,
        `URL: ${url}`,
        `Selector: ${resolvedElement.selector}`,
        `Tag: ${resolvedElement.tagName || resolvedElement.entry.tagName || 'unknown'}`,
      ];
      if (resolvedElement.id || resolvedElement.entry.id) lines.push(`ID: ${resolvedElement.id || resolvedElement.entry.id}`);
      if (details?.ariaLabel) lines.push(`Aria Label: ${details.ariaLabel}`);
      if (details?.placeholder) lines.push(`Placeholder: ${details.placeholder}`);
      if (details?.value) lines.push(`Value: ${details.value}`);
      if (details?.href) lines.push(`Href: ${details.href}`);
      if (details?.src) lines.push(`Src: ${details.src}`);
      lines.push('');
      if (details?.text) lines.push(`=== ELEMENT TEXT ===\n${details.text}`);
      else if (resolvedElement.text || resolvedElement.entry.text) lines.push(`=== ELEMENT TEXT ===\n${resolvedElement.text || resolvedElement.entry.text}`);
      if (details?.htmlSnippet) lines.push(`\n=== HTML SNIPPET ===\n${details.htmlSnippet}`);
      return attachShortcutsContext(lines.join('\n'), url, sessionId);
    }

    // 1. Main document visible text
    const mainText = await session.page.evaluate(() => {
      const body = (globalThis as any).document.body;
      if (!body) return '';
      // Strip scripts and styles before reading innerText
      const clone = body.cloneNode(true) as any;
      for (const el of clone.querySelectorAll('script,style,noscript')) el.remove();
      return (clone.innerText || clone.textContent || '')
        .replace(/[^\S\n]{3,}/g, ' ')
        .replace(/\n{4,}/g, '\n\n')
        .trim()
        .slice(0, 6000);
    });

    // 2. Detect iframes � report their src URLs so AI can navigate to them
    const iframes = await session.page.evaluate(() => {
      return Array.from((globalThis as any).document.querySelectorAll('iframe'))
        .map((f: any) => ({
          src: f.src || f.getAttribute('src') || '',
          id: f.id || '',
          title: f.getAttribute('title') || f.name || '',
          w: f.offsetWidth,
          h: f.offsetHeight,
        }))
        .filter((f: any) => f.src && !f.src.startsWith('javascript') && f.w > 80 && f.h > 80);
    }) as Array<{ src: string; id: string; title: string; w: number; h: number }>;

    // 3. Try to read same-origin iframes directly via Playwright frames API
    const iframeTexts: string[] = [];
    for (const frameHandle of session.page.frames()) {
      try {
        const frameUrl = frameHandle.url();
        if (!frameUrl || frameUrl === 'about:blank' || frameUrl === url) continue;
        const fText = await frameHandle.evaluate(() => {
          const body = (globalThis as any).document.body;
          if (!body) return '';
          const clone = body.cloneNode(true) as any;
          for (const el of clone.querySelectorAll('script,style,noscript')) el.remove();
          return (clone.innerText || clone.textContent || '')
            .replace(/[^\S\n]{3,}/g, ' ')
            .replace(/\n{4,}/g, '\n\n')
            .trim()
            .slice(0, 4000);
        }).catch(() => '');
        if (fText && fText.length > 80) {
          iframeTexts.push(`--- IFRAME (${frameUrl.slice(0, 120)}) ---\n${fText}`);
        }
      } catch { /* cross-origin iframe � skip text, will be listed in iframe URLs */ }
    }

    const parts: string[] = [
      `Page: ${title}`,
      `URL: ${url}`,
      '',
    ];

    if (mainText) {
      parts.push('=== MAIN PAGE TEXT ===');
      parts.push(mainText);
    }

    if (iframeTexts.length > 0) {
      parts.push('');
      parts.push('=== IFRAME CONTENT (same-origin) ===');
      parts.push(...iframeTexts);
    }

    // Cross-origin iframes � can't read text but list the URLs
    const crossOriginIframes = iframes.filter(f => {
      try {
        const fHost = new URL(f.src).hostname;
        const pHost = new URL(url).hostname;
        return fHost !== pHost;
      } catch { return true; }
    });
    if (crossOriginIframes.length > 0) {
      parts.push('');
      parts.push('=== CROSS-ORIGIN IFRAMES (navigate to these with browser_open) ===');
      for (const f of crossOriginIframes) {
        const label = f.title || f.id || 'iframe';
        parts.push(`  ${label}: ${f.src}`);
      }
      parts.push('');
      parts.push('TIP: Use browser_open({url: "<iframe src above>"}) to navigate directly into the embedded menu/widget.');
    }

    let result = parts.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    const query = String(options?.query || '').trim().toLowerCase();
    if (query) {
      const lines = result.split('\n');
      const matched = lines.filter((line, index) => line.toLowerCase().includes(query) || lines[Math.max(0, index - 1)]?.toLowerCase().includes(query));
      result = [`Page: ${title}`, `URL: ${url}`, '', ...matched].join('\n');
    }
    const maxLines = Math.max(1, Math.min(1000, Math.floor(Number(options?.maxLines || 200))));
    const maxChars = Math.max(200, Math.min(50000, Math.floor(Number(options?.maxChars || 6000))));
    const bounded = result.split('\n').slice(0, maxLines).join('\n').slice(0, maxChars);
    return bounded.length > 20 ? bounded : 'No readable text found on this page.';
  } catch (err: any) {
    return `ERROR: browser_get_page_text failed: ${err.message}`;
  }
}

export { INTERACTIVE_SELECTOR };

// --- browser_run_js -----------------------------------------------------------

/**
 * Execute arbitrary JavaScript in the current page context and return the result.
 * Wraps in an async IIFE so top-level await works. Result is JSON-serialized.
 * Playwright's page.evaluate() passes a serializable return value back to Node.
 */
export async function browserRunJs(
  sessionId: string,
  code: string,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) return browserRunJsInHouse(resolved, code);
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (!code || !code.trim()) return 'ERROR: code parameter is required.';
  try {
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_run_js');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    const result = await session.page.evaluate(buildBrowserRunJsEnvelopeSource(code));
    const resultText = formatBrowserRunJsEnvelope(result);
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      return attachShortcutsContext(`${resultText}\n\nSnapshot refreshed (${parseSnapshotElementCount(snapshot)} elements):\n\n${snapshot}`, session.page.url(), sessionId);
    }
    if (compactBefore) {
      return `${resultText}\n\n${await buildCompactBrowserObservation(session, 'browser_run_js completed.', compactBefore)}`;
    }
    if (observeMode === 'screenshot') {
      await browserVisionScreenshot(sessionId).catch(() => null);
    }
    return resultText;
  } catch (err: any) {
    return `ERROR: JS execution failed: ${err.message}`;
  }
}

async function browserRunSmokeStepsInHouse(sessionId: string, steps: any[] = []): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const results: Array<{ index: number; action: string; ok: boolean; details: any }> = [];
  for (const [index, raw] of steps.entries()) {
    const incoming = raw && typeof raw === 'object' ? raw : {};
    const actionName = String(incoming.action || incoming.type || '').trim();
    const step = actionName
      ? { ...incoming, [actionName]: incoming[actionName] ?? incoming }
      : incoming;
    let action = 'unsupported';
    let ok = false;
    let details: any = null;
    try {
      if (step.click) {
        action = 'click';
        const value = typeof step.click === 'object' ? step.click : { selector: step.click };
        const result = await browserClick(resolved, { selector: String(value.selector || '') }, { observe: 'none' });
        ok = !result.startsWith('ERROR'); details = result;
      } else if (step.fill) {
        action = 'fill';
        const value = typeof step.fill === 'object' ? step.fill : {};
        const result = await browserFill(resolved, { selector: String(value.selector || '') }, String(value.text || ''), { observe: 'none' });
        ok = !result.startsWith('ERROR'); details = result;
      } else if (step.key) {
        action = 'key';
        const value = typeof step.key === 'object' ? step.key.key : step.key;
        const result = await browserPressKey(resolved, String(value || 'Enter'), { observe: 'none' });
        ok = !result.startsWith('ERROR'); details = result;
      } else if (step.assertText) {
        action = 'assertText';
        const value = typeof step.assertText === 'object' ? step.assertText : {};
        const selector = String(value.selector || 'body');
        const expected = value.contains ?? value.equals ?? value.text ?? '';
        const state: any = await callInHouseBrowser('run-js', {
          sessionId: resolved,
          code: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return { present: !!el, actual: String(el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim() }; })()`,
        });
        const actual = String(state?.actual || '');
        ok = value.contains != null || value.text != null
          ? actual.includes(String(expected))
          : actual === String(expected);
        details = { selector, expected, actual, present: state?.present === true };
      } else if (step.assertVisible) {
        action = 'assertVisible';
        const value = typeof step.assertVisible === 'object' ? step.assertVisible : { selector: step.assertVisible };
        const selector = String(value.selector || '');
        const state: any = await callInHouseBrowser('run-js', {
          sessionId: resolved,
          code: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const rect = el?.getBoundingClientRect?.(); const style = el ? getComputedStyle(el) : null; return { present: !!el, visible: !!el && !!rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden' && Number(style?.opacity || 1) !== 0 }; })()`,
        });
        ok = state?.visible === true;
        details = { selector, present: state?.present === true, visible: state?.visible === true };
      }
    } catch (err: any) {
      details = `ERROR: ${err?.message || err}`;
    }
    results.push({ index, action, ok, details });
    if (!ok) break;
  }
  return JSON.stringify({ ok: results.every((result) => result.ok), executed: results.length, results }, null, 2);
}

export async function browserRunSmokeSteps(sessionId: string, steps: any[] = []): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) return browserRunSmokeStepsInHouse(resolved, steps);
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  const results: Array<{ index: number; action: string; ok: boolean; details: any }> = [];
  for (const [index, raw] of steps.entries()) {
    const incoming = raw && typeof raw === 'object' ? raw : {};
    const actionName = String(incoming.action || incoming.type || '').trim();
    const step = actionName
      ? { ...incoming, [actionName]: incoming[actionName] ?? incoming }
      : incoming;
    let action = 'unsupported';
    let ok = false;
    let details: any = null;
    if (step.click) {
      action = 'click';
      const value = typeof step.click === 'object' ? step.click : { selector: step.click };
      const result = await browserClick(sessionId, { selector: String(value.selector || '') }, { observe: 'none' });
      ok = !result.startsWith('ERROR'); details = result;
    } else if (step.fill) {
      action = 'fill';
      const value = typeof step.fill === 'object' ? step.fill : {};
      const result = await browserFill(sessionId, { selector: String(value.selector || '') }, String(value.text || ''), { observe: 'none' });
      ok = !result.startsWith('ERROR'); details = result;
    } else if (step.key) {
      action = 'key';
      const value = typeof step.key === 'object' ? step.key.key : step.key;
      const result = await browserPressKey(sessionId, String(value || 'Enter'), { observe: 'none' });
      ok = !result.startsWith('ERROR'); details = result;
    } else if (step.assertText) {
      action = 'assertText';
      const value = typeof step.assertText === 'object' ? step.assertText : {};
      const selector = String(value.selector || 'body');
      const expected = value.contains ?? value.equals ?? value.text ?? '';
      const actual = await session.page.locator(selector).first().textContent().catch(() => null);
      const normalized = String(actual || '').trim();
      ok = value.contains != null || value.text != null ? normalized.includes(String(expected)) : normalized === String(expected);
      details = { selector, expected, actual: normalized };
    } else if (step.assertVisible) {
      action = 'assertVisible';
      const value = typeof step.assertVisible === 'object' ? step.assertVisible : { selector: step.assertVisible };
      ok = await session.page.locator(String(value.selector || '')).first().isVisible().catch(() => false);
      details = { selector: value.selector };
    }
    results.push({ index, action, ok, details });
    if (!ok) break;
  }
  return JSON.stringify({ ok: results.every((result) => result.ok), executed: results.length, results }, null, 2);
}

// --- browser_extract_structured -----------------------------------------------

/**
 * Extract structured data from the current page by describing a schema.
 * Schema format:
 *   container_selector: CSS selector for repeated items (e.g. ".product-card")
 *   limit: max items to return (default 50)
 *   fields: { fieldName: { selector: CSS, type: "text"|"href"|"src"|"attr", attribute?: string } }
 *
 * Example schema to scrape products:
 *   { "container_selector": ".product", "fields": {
 *       "name":  { "selector": "h2" },
 *       "price": { "selector": ".price" },
 *       "link":  { "selector": "a", "type": "href" },
 *       "imageUrl": { "selector": "img", "type": "src" }
 *   }}
 *
 * `src` resolves current/lazy/srcset/zoom/Amazon dynamic images to absolute URLs.
 * Returns JSON array of matched items. Fields not found return null.
 */
export async function browserExtractStructured(
  sessionId: string,
  schema: Record<string, any>,
): Promise<string> {
  const resolvedSessionId = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolvedSessionId);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolvedSessionId)) {
    if (!schema || typeof schema !== 'object') return 'ERROR: schema must be an object with container_selector, item_root, or schema_name plus fields.';
    const inHouse = getInHouseSession(resolvedSessionId)!;
    const url = String(inHouse.url || '').trim();
    try {
      const resolved = resolveBrowserExtractionSchemaForUrl(url, schema || {});
      if (!resolved.schema) return `ERROR: ${resolved.error || 'Could not resolve extraction schema.'}`;
      const resultWithMeta = await extractStructuredItemsFromInHousePage(resolvedSessionId, resolved.schema);
      const result = resultWithMeta
        .map((entry) => entry.item)
        .filter((item) => Object.values(item).some((value) => value != null && String(value).trim() !== ''));
      if (!result.length) {
        const targetLabel = resolved.schema.itemRootName
          ? `item_root "${resolved.schema.itemRootName}" (${resolved.schema.containerSelector})`
          : `container_selector "${resolved.schema.containerSelector || 'body'}"`;
        return `No items found matching ${targetLabel}.`;
      }
      const prefixLines: string[] = [];
      if (resolved.schema.requestedSchemaName) prefixLines.push(`Resolved schema_name "${resolved.schema.requestedSchemaName}" (${resolved.schema.source})`);
      if (resolved.schema.itemRootName) prefixLines.push(`Resolved item_root "${resolved.schema.itemRootName}" -> ${resolved.schema.containerSelector}`);
      const saveName = String(resolved.schema.saveAs || '').trim();
      if (saveName) {
        const savedResult = saveNamedBrowserExtractionSchemaForUrl(url, {
          name: saveName,
          aliases: resolved.schema.aliases,
          itemRoot: resolved.schema.itemRootName,
          containerSelector: resolved.schema.containerSelector,
          dedupeKey: resolved.schema.dedupeKey,
          limit: resolved.schema.limit,
          fields: resolved.schema.fields,
          url,
        });
        broadcastBrowserKnowledgeSnapshot(resolvedSessionId, url, savedResult.site, { action: 'saved_schema', savedKind: 'schema', saved: savedResult.saved });
        let schemaHost = 'this site';
        try { schemaHost = new URL(url).hostname; } catch {}
        prefixLines.push(`Saved extraction schema "${savedResult.saved.name}" for ${schemaHost} (domain-scoped).`);
      }
      return `${prefixLines.length ? `${prefixLines.join('\n')}\n\n` : ''}${JSON.stringify(result, null, 2)}`;
    } catch (err: any) {
      return `ERROR: browser_extract_structured failed: ${err.message}`;
    }
  }
  const session = sessions.get(resolvedSessionId);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (!schema || typeof schema !== 'object') return 'ERROR: schema must be an object with container_selector, item_root, or schema_name plus fields.';

  try {
    const resolved = resolveBrowserExtractionSchemaForUrl(session.page.url(), schema || {});
    if (!resolved.schema) {
      return `ERROR: ${resolved.error || 'Could not resolve extraction schema.'}`;
    }

    const resultWithMeta = await extractStructuredItemsFromCurrentPage(session.page, resolved.schema);
    const result = resultWithMeta
      .map((entry) => entry.item)
      .filter((item) => Object.values(item).some((value) => value != null && String(value).trim() !== ''));

    if (!Array.isArray(result) || result.length === 0) {
      const targetLabel = resolved.schema.itemRootName
        ? `item_root "${resolved.schema.itemRootName}" (${resolved.schema.containerSelector})`
        : `container_selector "${resolved.schema.containerSelector || 'body'}"`;
      return `No items found matching ${targetLabel}.`;
    }

    const prefixLines: string[] = [];
    if (resolved.schema.requestedSchemaName) {
      prefixLines.push(`Resolved schema_name "${resolved.schema.requestedSchemaName}" (${resolved.schema.source})`);
    }
    if (resolved.schema.itemRootName) {
      prefixLines.push(`Resolved item_root "${resolved.schema.itemRootName}" -> ${resolved.schema.containerSelector}`);
    }

    const saveName = String(resolved.schema.saveAs || '').trim();
    if (saveName) {
      const savedResult = saveNamedBrowserExtractionSchemaForUrl(session.page.url(), {
        name: saveName,
        aliases: resolved.schema.aliases,
        itemRoot: resolved.schema.itemRootName,
        containerSelector: resolved.schema.containerSelector,
        dedupeKey: resolved.schema.dedupeKey,
        limit: resolved.schema.limit,
        fields: resolved.schema.fields,
        url: session.page.url(),
      });
      broadcastBrowserKnowledgeSnapshot(resolveSessionId(sessionId), session.page.url(), savedResult.site, {
        action: 'saved_schema',
        savedKind: 'schema',
        saved: savedResult.saved,
      });
      let schemaHost = 'this site';
      try { schemaHost = new URL(session.page.url()).hostname; } catch {}
      prefixLines.push(`Saved extraction schema "${savedResult.saved.name}" for ${schemaHost} (domain-scoped).`);
    }

    return `${prefixLines.length ? `${prefixLines.join('\n')}\n\n` : ''}${JSON.stringify(result, null, 2)}`;
  } catch (err: any) {
    return `ERROR: browser_extract_structured failed: ${err.message}`;
  }
}

// --- Vision Tools (Component 1 + 3) ------------------------------------------
//
// These tools capture the Playwright viewport as a PNG (not via PowerShell/desktop)
// and allow coordinate-based click/type when the DOM snapshot has too few elements.
// Used by the vision fallback system when stabilization is exhausted.

/**
 * Capture the current browser tab viewport as a base64 PNG.
 * Much faster than desktop_screenshot because it uses Playwright's CDP directly.
 * Returns null if no session exists.
 */
export async function browserVisionScreenshot(sessionId: string): Promise<{
  base64: string;
  width: number;
  height: number;
  mimeType?: 'image/png' | 'image/jpeg';
  viewportWidth?: number;
  viewportHeight?: number;
  coordinateScale?: { x: number; y: number };
  normalized?: boolean;
} | null> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return null;
  if (getInHouseSession(resolved)) return browserVisionScreenshotInHouse(resolved);
  const session = sessions.get(resolved);
  if (!session) return null;
  try {
    const viewport = session.page.viewportSize() || { width: 1280, height: 720 };
    const buf: Buffer = await session.page.screenshot({ type: 'png', fullPage: false });
    const normalized = await normalizeScreenshotBuffer(buf, {
      maxSide: Number(process.env.PROMETHEUS_BROWSER_SCREENSHOT_MAX_SIDE || process.env.PROMETHEUS_SCREENSHOT_MAX_SIDE || 1800),
      maxBytes: Number(process.env.PROMETHEUS_BROWSER_SCREENSHOT_MAX_BYTES || process.env.PROMETHEUS_SCREENSHOT_MAX_BYTES || 4 * 1024 * 1024),
      preferJpeg: true,
    }).catch(() => null);
    const finalBuffer = normalized?.buffer || buf;
    const finalWidth = normalized?.width || viewport.width;
    const finalHeight = normalized?.height || viewport.height;
    const out = {
      base64: finalBuffer.toString('base64'),
      width: finalWidth,
      height: finalHeight,
      mimeType: normalized?.mimeType || 'image/png' as const,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      coordinateScale: {
        x: viewport.width / Math.max(1, finalWidth),
        y: viewport.height / Math.max(1, finalHeight),
      },
      normalized: normalized?.normalized === true,
      originalBytes: normalized?.originalBytes || buf.byteLength,
      bytes: normalized?.bytes || finalBuffer.byteLength,
    };
    // Keep the latest browser screenshot available for primary vision injection.
    setLastBrowserScreenshot(sessionId, out);
    return out;
  } catch (err: any) {
    console.warn('[Browser] browserVisionScreenshot failed:', err.message);
    return null;
  }
}

/**
 * Capture a browser tab screenshot and send it to Telegram.
 * Takes a fresh screenshot via Playwright, then sends it to all allowed Telegram users.
 */
export async function browserSendToTelegram(
  sessionId: string,
  caption: string = 'Browser screenshot',
  telegramChannel?: any,
): Promise<string> {
  if (!telegramChannel) {
    return 'ERROR: Telegram channel not available.';
  }
  const session = sessions.get(resolveSessionId(sessionId));
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  try {
    const viewport = session.page.viewportSize() || { width: 1280, height: 720 };
    const buf: Buffer = await session.page.screenshot({ type: 'png', fullPage: false });
    const normalized = await normalizeScreenshotBuffer(buf, {
      maxSide: Number(process.env.PROMETHEUS_BROWSER_SCREENSHOT_MAX_SIDE || process.env.PROMETHEUS_SCREENSHOT_MAX_SIDE || 1800),
      maxBytes: Number(process.env.PROMETHEUS_BROWSER_SCREENSHOT_MAX_BYTES || process.env.PROMETHEUS_SCREENSHOT_MAX_BYTES || 4 * 1024 * 1024),
      preferJpeg: true,
    }).catch(() => null);
    const finalBuffer = normalized?.buffer || buf;
    const finalWidth = normalized?.width || viewport.width;
    const finalHeight = normalized?.height || viewport.height;
    // Also expose this screenshot to the model so it's not "send-only".
    setLastBrowserScreenshot(sessionId, {
      base64: finalBuffer.toString('base64'),
      width: finalWidth,
      height: finalHeight,
      mimeType: normalized?.mimeType || 'image/png',
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      coordinateScale: {
        x: viewport.width / Math.max(1, finalWidth),
        y: viewport.height / Math.max(1, finalHeight),
      },
      normalized: normalized?.normalized === true,
      originalBytes: normalized?.originalBytes || buf.byteLength,
      bytes: normalized?.bytes || finalBuffer.byteLength,
    });
    await telegramChannel.sendPhotoToAllowed(finalBuffer, caption);
    const normalizedNote = normalized?.normalized
      ? ` normalized to ${finalWidth}x${finalHeight} ${normalized.mimeType} for transport`
      : ' original resolution';
    return `Browser screenshot sent to Telegram (${viewport.width}x${viewport.height} viewport;${normalizedNote}). Caption: "${caption}"`;
  } catch (err: any) {
    return `ERROR: Failed to send browser screenshot to Telegram: ${err?.message || err}`;
  }
}

/**
 * Click at viewport coordinates (pixels). Uses Playwright CDP mouse API.
 * More precise than DOM refs � works on canvas/SVG/WebGL pages.
 * Returns a fresh DOM snapshot after clicking so the model can check if DOM recovered.
 */
export async function browserVisionClick(
  sessionId: string,
  x: number,
  y: number,
  button: 'left' | 'right' = 'left',
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const resolvedVision = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolvedVision);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolvedVision)) {
    let px = Math.round(Number(x) || 0);
    let py = Math.round(Number(y) || 0);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return 'ERROR: x and y must be valid numbers.';
    const lastShot = getLastBrowserScreenshot(resolvedVision);
    if (lastShot?.normalized === true && lastShot.coordinateScale) {
      px = Math.round(px * lastShot.coordinateScale.x);
      py = Math.round(py * lastShot.coordinateScale.y);
    }
    try {
      await callInHouseBrowser('input', { sessionId: resolvedVision, action: 'click', x: px, y: py, button });
      await new Promise((r) => setTimeout(r, 500));
      const observeMode = options?.observe || resolveBrowserObserveMode('browser_vision_click');
      if (shouldReturnSnapshot(observeMode)) {
        return `Vision-clicked (${px}, ${py}) in Prometheus in-house browser.\n\n${await browserSnapshotInHouse(resolvedVision)}`;
      }
      broadcastInHouseBrowserStatus(resolvedVision, 'browser_vision_click', `Vision-clicked (${px}, ${py}) in Prometheus in-house browser.`, { active: true });
      return `Vision-clicked (${px}, ${py}) in Prometheus in-house browser.`;
    } catch (err: any) {
      return `ERROR: In-house vision click failed: ${err.message}`;
    }
  }
  const session = sessions.get(resolvedVision);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  let px = Math.round(Number(x) || 0);
  let py = Math.round(Number(y) || 0);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return 'ERROR: x and y must be valid numbers.';
  }
  try {
    const lastShot = getLastBrowserScreenshot(sessionId);
    if (lastShot?.normalized === true && lastShot.coordinateScale) {
      px = Math.round(px * lastShot.coordinateScale.x);
      py = Math.round(py * lastShot.coordinateScale.y);
    }
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_vision_click');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    await session.page.mouse.click(px, py, { button });
    await session.page.waitForTimeout(600);
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const elemCount = (snapshot.match(/@\d+/g) || []).length;
      return (
        `Vision-clicked (${px}, ${py}). Post-click snapshot (${elemCount} elements):\n\n` +
        attachShortcutsContext(snapshot, session.page.url(), sessionId)
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Vision-clicked (${px}, ${py}).`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Vision-clicked (${px}, ${py}).`);
  } catch (err: any) {
    return `ERROR: Vision click at (${px}, ${py}) failed: ${err.message}`;
  }
}

/**
 * Click at viewport coordinates then type text. Uses Playwright mouse + keyboard APIs.
 * Works on canvas/input overlays that don't have DOM refs.
 * Returns a fresh snapshot.
 */
export async function browserVisionType(
  sessionId: string,
  x: number,
  y: number,
  text: string,
  options?: { observe?: BrowserObserveMode },
): Promise<string> {
  const resolvedVType = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolvedVType);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolvedVType)) {
    let px = Math.round(Number(x) || 0);
    let py = Math.round(Number(y) || 0);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return 'ERROR: x and y must be valid numbers.';
    const lastShot = getLastBrowserScreenshot(resolvedVType);
    if (lastShot?.normalized === true && lastShot.coordinateScale) {
      px = Math.round(px * lastShot.coordinateScale.x);
      py = Math.round(py * lastShot.coordinateScale.y);
    }
    try {
      await callInHouseBrowser('input', { sessionId: resolvedVType, action: 'click', x: px, y: py });
      await new Promise((r) => setTimeout(r, 200));
      await callInHouseBrowser('input', { sessionId: resolvedVType, action: 'text', text: String(text || '') });
      const observeMode = options?.observe || resolveBrowserObserveMode('browser_vision_type');
      if (shouldReturnSnapshot(observeMode)) {
        return `Typed at (${px}, ${py}) in Prometheus in-house browser.\n\n${await browserSnapshotInHouse(resolvedVType)}`;
      }
      broadcastInHouseBrowserStatus(resolvedVType, 'browser_vision_type', `Typed at (${px}, ${py}) in Prometheus in-house browser.`, { active: true });
      return `Typed at (${px}, ${py}) in Prometheus in-house browser.`;
    } catch (err: any) {
      return `ERROR: In-house vision type failed: ${err.message}`;
    }
  }
  const session = sessions.get(resolvedVType);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  let px = Math.round(Number(x) || 0);
  let py = Math.round(Number(y) || 0);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return 'ERROR: x and y must be valid numbers.';
  }
  const payload = String(text || '');
  try {
    const lastShot = getLastBrowserScreenshot(sessionId);
    if (lastShot?.normalized === true && lastShot.coordinateScale) {
      px = Math.round(px * lastShot.coordinateScale.x);
      py = Math.round(py * lastShot.coordinateScale.y);
    }
    const observeMode = options?.observe || resolveBrowserObserveMode('browser_vision_type');
    const compactBefore = shouldUseCompactObservation(observeMode)
      ? await captureCompactBrowserState(session.page)
      : null;
    await session.page.mouse.click(px, py);
    await session.page.waitForTimeout(200);
    await session.page.keyboard.type(payload, { delay: 25 });
    await session.page.waitForTimeout(500);
    if (shouldReturnSnapshot(observeMode)) {
      const snapshot = await takeSnapshot(session.page);
      rememberSnapshot(session, snapshot);
      const elemCount = (snapshot.match(/@\d+/g) || []).length;
      return (
        `Vision-typed ${payload.length} chars at (${px}, ${py}). Post-type snapshot (${elemCount} elements):\n\n` +
        attachShortcutsContext(snapshot, session.page.url(), sessionId)
      );
    }
    if (compactBefore) {
      return buildCompactBrowserObservation(session, `Vision-typed ${payload.length} chars at (${px}, ${py}).`, compactBefore);
    }
    return buildMinimalBrowserAck(session, `Vision-typed ${payload.length} chars at (${px}, ${py}).`);
  } catch (err: any) {
    return `ERROR: Vision type at (${px}, ${py}) failed: ${err.message}`;
  }
}

// --- Session State Helpers (for system prompt injection) -----------------------

export function hasBrowserSession(sessionId: string): boolean {
  const resolved = resolveSessionId(sessionId);
  return sessions.has(resolved) || inHouseSessions.has(resolved);
}

export async function browserHandleUserInput(
  sessionId: string,
  payload: {
    action?: string;
    x?: number;
    y?: number;
    button?: 'left' | 'middle' | 'right';
    deltaX?: number;
    deltaY?: number;
    key?: string;
    text?: string;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  },
): Promise<{
  sessionId: string;
  active: boolean;
  url: string;
  title: string;
  mode: BrowserInteractionMode;
  captured: boolean;
  controlOwner: 'agent' | 'user';
  streamActive: boolean;
  streamTransport: 'cdp' | 'snapshot' | '';
  streamFocus: BrowserLiveStreamFocus;
  source: 'user';
  statusLabel: string;
  frameBase64: string;
  frameWidth: number;
  frameHeight: number;
  frameFormat: 'png';
  timestamp: number;
  userAction: BrowserUserAction;
  clickHighlight: null | {
    selector: string;
    tagName: string;
    id: string;
    text: string;
    bounds: { x: number; y: number; width: number; height: number };
  };
}> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) throw new Error(recovery.error);
  if (getInHouseSession(resolved)) {
    await callInHouseBrowser('input', { sessionId: resolved, ...payload });
    const state: any = await callInHouseBrowser('state', { sessionId: resolved }).catch(() => ({}));
    const inHouse = upsertInHouseSession(resolved, state);
    const interactionState = getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved));
    const action = String(payload?.action || 'key').trim().toLowerCase();
    const userActionKind = (['click', 'wheel', 'key', 'text'].includes(action) ? action : 'key') as BrowserUserAction['kind'];
    return {
      sessionId: resolved,
      active: true,
      url: inHouse.url,
      title: inHouse.title,
      source: 'user',
      mode: interactionState.mode,
      captured: interactionState.captured,
      controlOwner: interactionState.controlOwner,
      statusLabel: `User ${String(payload?.action || 'input')} sent to Prometheus in-house browser.`,
      streamActive: false,
      streamTransport: '',
      streamFocus: 'interactive',
      frameBase64: '',
      frameWidth: 0,
      frameHeight: 0,
      frameFormat: 'png',
      timestamp: Date.now(),
      userAction: {
        kind: userActionKind,
        x: Number(payload?.x || 0),
        y: Number(payload?.y || 0),
        mode: interactionState.mode,
        url: inHouse.url,
        title: inHouse.title,
        summary: `User ${String(payload?.action || 'input')} in in-house browser`,
        timestamp: Date.now(),
      },
      clickHighlight: null,
    };
  }
  const session = sessions.get(resolved);
  if (!session) throw new Error('No browser session. Use browser_open first.');
  const action = String(payload?.action || '').trim().toLowerCase();
  if (!['click', 'wheel', 'key', 'text'].includes(action)) {
    throw new Error(`Unsupported browser input action "${action || 'unknown'}".`);
  }
  const interactionState = getOrCreateBrowserInteractionState(resolved);
  const mode = normalizeBrowserInteractionMode(interactionState.mode);
  const liveStream = browserLiveStreams.get(resolved);
  if (mode !== 'copilot' && mode !== 'teach') {
    throw new Error(`Browser input is only enabled in Co-pilot or Teach mode. Current mode: ${mode}.`);
  }
  const px = Math.round(Number(payload?.x || 0));
  const py = Math.round(Number(payload?.y || 0));
  const requiresPoint = action === 'click' || action === 'wheel';
  if (requiresPoint && (!Number.isFinite(px) || !Number.isFinite(py))) {
    throw new Error('Browser input requires valid viewport coordinates.');
  }
  const beforeUrl = String(session.lastPageUrl || session.page.url() || '').trim();
  const beforeTitle = String(session.lastPageTitle || await session.page.title().catch(() => '') || '').trim();
  let clickHighlight = null as null | Awaited<ReturnType<typeof browserInspectPoint>>;
  let summary = '';
  if (action === 'click') {
    const button: 'left' | 'middle' | 'right' = payload?.button === 'middle' || payload?.button === 'right'
      ? payload.button
      : 'left';
    clickHighlight = await browserInspectPoint(resolved, px, py).catch(() => null);
    await session.page.mouse.click(px, py, { button });
    await session.page.waitForTimeout(350).catch(() => {});
    summary = `User clicked at (${px}, ${py}) in ${mode} mode.`;
  } else if (action === 'wheel') {
    const deltaX = Number(payload?.deltaX || 0);
    const deltaY = Number(payload?.deltaY || 0);
    await session.page.mouse.move(px, py);
    await session.page.mouse.wheel(deltaX, deltaY);
    await session.page.waitForTimeout(250).catch(() => {});
    summary = `User scrolled the browser in ${mode} mode (delta ${Math.round(deltaX)}, ${Math.round(deltaY)}).`;
  } else if (action === 'text') {
    const text = String(payload?.text || '');
    if (!text) throw new Error('Browser text input requires text.');
    await session.page.keyboard.insertText(text);
    await session.page.waitForTimeout(120).catch(() => {});
    summary = `User typed "${text.replace(/\s+/g, ' ').slice(0, 40)}" in ${mode} mode.`;
  } else if (action === 'key') {
    const key = String(payload?.key || '').trim();
    if (!key) throw new Error('Browser key input requires key.');
    const modifiers = [
      payload?.ctrlKey ? 'Control' : '',
      payload?.altKey ? 'Alt' : '',
      payload?.metaKey ? 'Meta' : '',
      payload?.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    const combo = [...modifiers, key].join('+');
    const plainSpace = key === 'Space' && !payload?.ctrlKey && !payload?.altKey && !payload?.metaKey && !payload?.shiftKey;
    if (plainSpace && await browserHasEditableFocus(session.page)) {
      await session.page.keyboard.insertText(' ');
      await session.page.waitForTimeout(120).catch(() => {});
      summary = `User typed a space in ${mode} mode.`;
    } else {
      await session.page.keyboard.press(combo);
      await session.page.waitForTimeout(120).catch(() => {});
      summary = `User pressed ${combo} in ${mode} mode.`;
    }
  }
  const captureState = setBrowserControlCaptureState(resolved, {
    captured: true,
    owner: 'user',
    reason: mode === 'teach'
      ? 'User is confirming a recorded Teach step.'
      : 'User is controlling the browser in Co-pilot mode.',
  });
  const meta = await syncPageMetadata(session);
  const timestamp = Date.now();
  const currentUrl = String(meta.url || beforeUrl || session.page.url() || '').trim();
  const currentTitle = String(meta.title || beforeTitle || '').trim();
  if ((meta.urlChanged || meta.titleChanged) && (currentTitle || currentUrl)) {
    summary += ` The page changed to ${currentTitle ? `"${currentTitle}"` : currentUrl}${currentUrl ? ` (${currentUrl})` : ''}.`;
  }
  const userAction: BrowserUserAction = {
    kind: action as BrowserUserAction['kind'],
    ...(requiresPoint ? { x: px, y: py } : {}),
    ...(action === 'click'
      ? { button: payload?.button === 'middle' || payload?.button === 'right' ? payload.button : 'left' }
      : {}),
    ...(action === 'wheel' ? { deltaX: Number(payload?.deltaX || 0), deltaY: Number(payload?.deltaY || 0) } : {}),
    ...(action === 'key' ? { key: String(payload?.key || '').trim() } : {}),
    ...(action === 'text' ? { text: String(payload?.text || '') } : {}),
    mode,
    url: currentUrl,
    title: currentTitle,
    summary,
    timestamp,
  };
  recordBrowserUserAction(resolved, userAction);
  const shot = await browserVisionScreenshot(resolved).catch(() => null);
  return {
    sessionId: resolved,
    active: true,
    url: currentUrl,
    title: currentTitle,
    mode,
    captured: captureState.captured,
    controlOwner: captureState.controlOwner,
    streamActive: liveStream?.active === true,
    streamTransport: liveStream?.transport || '',
    streamFocus: liveStream?.focus || 'passive',
    source: 'user',
    statusLabel: mode === 'teach' ? 'Teach step executed.' : 'You are controlling the browser.',
    frameBase64: String(shot?.base64 || ''),
    frameWidth: Number(shot?.width || 0),
    frameHeight: Number(shot?.height || 0),
    frameFormat: 'png',
    timestamp,
    userAction,
    clickHighlight: clickHighlight?.bounds
      ? {
          selector: String(clickHighlight.selector || '').trim(),
          tagName: String(clickHighlight.tagName || '').trim(),
          id: String(clickHighlight.id || '').trim(),
          text: String(clickHighlight.text || '').trim(),
          bounds: clickHighlight.bounds,
        }
      : null,
  };
}

function summarizeTeachVerificationResult(result: string): string {
  const text = String(result || '').trim();
  if (!text) return '';
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  return firstLine.slice(0, 220);
}

function isTeachVerificationError(result: string): boolean {
  return /^ERROR:/i.test(String(result || '').trim());
}

function findFinalRiskyTeachStepIndex(steps: BrowserTeachStepSnapshot[]): number {
  let found = 0;
  for (let index = 0; index < steps.length; index += 1) {
    if (normalizeBrowserTeachRisk(steps[index]?.risk) === 'high') found = index + 1;
  }
  return found;
}

export async function browserTeachVerify(
  sessionId: string,
  options?: {
    mode?: 'full' | 'safe' | 'step';
    stop_before_step?: number;
    stopBeforeStep?: number;
  },
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const teach = getBrowserTeachSessionSnapshot(resolved);
  if (!teach || !teach.active || !Array.isArray(teach.steps) || !teach.steps.length) {
    return 'ERROR: No recorded Teach workflow is available for this session yet.';
  }
  if (!String(teach.startUrl || '').trim()) {
    return 'ERROR: The recorded Teach workflow is missing its start URL.';
  }

  const requestedMode = String(options?.mode || '').trim().toLowerCase();
  const mode: 'full' | 'safe' | 'step' = requestedMode === 'safe'
    ? 'safe'
    : (requestedMode === 'step' ? 'step' : 'full');
  let stopBeforeStep = Math.max(
    0,
    Number(options?.stop_before_step || options?.stopBeforeStep || 0) || 0,
  );
  const totalRecordedSteps = teach.steps.length;
  const riskyStepIndexes = teach.steps
    .map((step, index) => (normalizeBrowserTeachRisk(step?.risk) === 'high' ? index + 1 : 0))
    .filter(Boolean);
  if (mode === 'safe' && stopBeforeStep <= 0) {
    stopBeforeStep = findFinalRiskyTeachStepIndex(teach.steps);
  }
  if (stopBeforeStep > totalRecordedSteps) stopBeforeStep = totalRecordedSteps;
  const stepsToReplay = stopBeforeStep > 0 ? teach.steps.slice(0, Math.max(0, stopBeforeStep - 1)) : teach.steps.slice();
  const boundaryLabel = stopBeforeStep > 0
    ? `Stop before step ${stopBeforeStep}`
    : (mode === 'safe' ? 'Run the full workflow (no risky step found)' : 'Run the full workflow');

  const startedAt = Date.now();
  browserTeachSessions.set(resolved, {
    ...teach,
    phase: 'verifying',
    verification: null,
  });

  // -- In-house browser verify ----------------------------------------------
  // The Playwright detached-tab verifier can't run in-house (no Playwright
  // session). Replay the recorded steps in the SAME in-house view instead � it
  // shares the live login. (v1: this disturbs the visible page rather than using
  // a hidden tab; a same-partition detached view is a future enhancement.)
  if (getInHouseSession(resolved)) {
    try {
      broadcastWS({
        type: 'browser:teach:verification_started',
        sessionId: resolved,
        verifierSessionId: resolved,
        phase: 'verifying',
        url: teach.startUrl,
        title: teach.startTitle || '',
        statusLabel: 'Replaying the Teach workflow in the Prometheus in-house browser.',
        timestamp: Date.now(),
      });
    } catch {}
    const inHouseOpenResult = await browserOpenInHouse(resolved, teach.startUrl, { observe: 'none' });
    if (inHouseOpenResult.startsWith('ERROR')) {
      return `ERROR: Teach verification could not return to the recorded start URL: ${summarizeTeachVerificationResult(inHouseOpenResult)}`;
    }
    const executionLines: string[] = [];
    let failedStep = 0;
    let failureSummary = '';
    for (let index = 0; index < stepsToReplay.length; index += 1) {
      const step = teach.steps[index];
      const stepNumber = index + 1;
      let result = '';
      switch (String(step?.toolName || '').trim()) {
        case 'browser_click': result = await browserClick(resolved, step.args || {}, { observe: 'none' }); break;
        case 'browser_fill': result = await browserFill(resolved, step.args || {}, String(step?.args?.text || ''), { observe: 'none' }); break;
        case 'browser_type': result = await browserType(resolved, String(step?.args?.text || '')); break;
        case 'browser_press_key': result = await browserPressKey(resolved, String(step?.args?.key || ''), { observe: 'none' }); break;
        case 'browser_scroll': result = await browserScroll(resolved, String(step?.args?.direction || '').trim().toLowerCase() === 'up' ? 'up' : 'down', Number(step?.args?.multiplier || 1) || 1, { observe: 'none' }); break;
        default: result = `ERROR: Unsupported Teach step tool "${String(step?.toolName || 'unknown').trim()}".`; break;
      }
      const resultSummary = summarizeTeachVerificationResult(result);
      executionLines.push(`${stepNumber}. ${String(step?.toolPreview || step?.summary || step?.toolName || 'browser step').trim()} -> ${resultSummary || 'Done.'}`);
      if (isTeachVerificationError(result)) {
        failedStep = stepNumber;
        failureSummary = resultSummary || `Step ${stepNumber} failed.`;
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    const inHouseAfter = getInHouseSession(resolved);
    const finalUrl = String(inHouseAfter?.url || teach.startUrl || '').trim();
    const finalTitle = String(inHouseAfter?.title || '').trim();
    const completedAt = Date.now();
    const executedCount = failedStep > 0 ? Math.max(0, failedStep - 1) : stepsToReplay.length;
    const verification: BrowserTeachVerificationResult = {
      status: failedStep > 0 ? (executedCount > 0 ? 'partial' : 'failed') : 'passed',
      mode,
      boundaryLabel,
      stopBeforeStep,
      verifierSessionId: resolved,
      executedCount,
      totalRecordedSteps,
      riskyStepIndexes,
      ...(failedStep > 0 ? { failedStep, failureSummary } : {}),
      finalUrl,
      finalTitle,
      startedAt,
      completedAt,
    };
    browserTeachSessions.set(resolved, { ...teach, phase: 'verified', verification });
    try {
      broadcastWS({ type: 'browser:teach:verification', sessionId: resolved, phase: 'verified', verification, timestamp: completedAt });
    } catch {}
    return [
      `Teach verification ${verification.status === 'passed' ? 'passed' : (verification.status === 'partial' ? 'completed with issues' : 'failed')}.`,
      `Boundary: ${boundaryLabel}.`,
      `Start URL: ${teach.startUrl}`,
      `Verifier: Prometheus in-house browser (same view).`,
      `Executed ${executedCount} of ${totalRecordedSteps} recorded step${totalRecordedSteps === 1 ? '' : 's'}.`,
      verification.stopBeforeStep > 0 ? `Stopped before step ${verification.stopBeforeStep}.` : 'Ran the recorded workflow through the approved boundary.',
      riskyStepIndexes.length ? `Risky steps in the recorded workflow: ${riskyStepIndexes.join(', ')}.` : 'Risky steps in the recorded workflow: none.',
      executionLines.length ? `Step log:\n${executionLines.join('\n')}` : '',
      failedStep > 0 ? `Failure: ${failureSummary}` : '',
      finalTitle || finalUrl ? `Final page: ${finalTitle ? `"${finalTitle}"` : finalUrl}${finalUrl ? ` (${finalUrl})` : ''}` : '',
    ].filter(Boolean).join('\n');
  }

  const detached = await replaceDetachedBrowserSession(resolved, 'teach-verify');
  const verifierSessionId = detached.sessionId;

  const openResult = await browserOpen(verifierSessionId, teach.startUrl, { observe: 'none' });
  if (isTeachVerificationError(openResult)) {
    return `ERROR: Teach verification could not return to the recorded start URL: ${summarizeTeachVerificationResult(openResult)}`;
  }
  const verifierSession = sessions.get(verifierSessionId) || detached.session;
  const verifierTitle = String(await verifierSession.page.title().catch(() => '') || '').trim();
  try {
    broadcastWS({
      type: 'browser:teach:verification_started',
      sessionId: resolved,
      verifierSessionId,
      phase: 'verifying',
      url: String(verifierSession.page.url?.() || teach.startUrl || '').trim(),
      title: verifierTitle,
      statusLabel: 'Watching the detached Teach verifier tab.',
      timestamp: Date.now(),
    });
  } catch {
    // Best-effort UI sync only.
  }
  await broadcastBrowserViewportUpdate(
    verifierSessionId,
    verifierSession,
    'browser_teach_verify',
    'Teach verifier returned to the recorded start URL.',
  ).catch(() => {});

  const executionLines: string[] = [];
  let failedStep = 0;
  let failureSummary = '';

  for (let index = 0; index < stepsToReplay.length; index += 1) {
    const step = teach.steps[index];
    const stepNumber = index + 1;
    let result = '';
    switch (String(step?.toolName || '').trim()) {
      case 'browser_click':
        result = await browserClick(verifierSessionId, step.args || {}, { observe: 'none' });
        break;
      case 'browser_fill':
        result = await browserFill(
          verifierSessionId,
          step.args || {},
          String(step?.args?.text || ''),
          { observe: 'none' },
        );
        break;
      case 'browser_type':
        result = await browserType(verifierSessionId, String(step?.args?.text || ''));
        break;
      case 'browser_press_key':
        result = await browserPressKey(verifierSessionId, String(step?.args?.key || ''), { observe: 'none' });
        break;
      case 'browser_scroll':
        result = await browserScroll(
          verifierSessionId,
          String(step?.args?.direction || '').trim().toLowerCase() === 'up' ? 'up' : 'down',
          Number(step?.args?.multiplier || 1) || 1,
          { observe: 'none' },
        );
        break;
      default:
        result = `ERROR: Unsupported Teach step tool "${String(step?.toolName || 'unknown').trim()}".`;
        break;
    }
    const resultSummary = summarizeTeachVerificationResult(result);
    executionLines.push(`${stepNumber}. ${String(step?.toolPreview || step?.summary || step?.toolName || 'browser step').trim()} -> ${resultSummary || 'Done.'}`);
    await broadcastBrowserViewportUpdate(
      verifierSessionId,
      verifierSession,
      'browser_teach_verify',
      isTeachVerificationError(result)
        ? `Teach verifier stopped at step ${stepNumber}: ${resultSummary || 'step failed.'}`
        : `Teach verifier replayed step ${stepNumber} of ${stepsToReplay.length}.`,
    ).catch(() => {});
    if (isTeachVerificationError(result)) {
      failedStep = stepNumber;
      failureSummary = resultSummary || `Step ${stepNumber} failed.`;
      break;
    }
  }

  const finalUrl = String(verifierSession?.page?.url?.() || teach.startUrl || '').trim();
  const finalTitle = String(await verifierSession.page.title().catch(() => '') || '').trim();
  const completedAt = Date.now();
  const executedCount = failedStep > 0 ? Math.max(0, failedStep - 1) : stepsToReplay.length;
  const verification: BrowserTeachVerificationResult = {
    status: failedStep > 0
      ? (executedCount > 0 ? 'partial' : 'failed')
      : 'passed',
    mode,
    boundaryLabel,
    stopBeforeStep,
    verifierSessionId,
    executedCount,
    totalRecordedSteps,
    riskyStepIndexes,
    ...(failedStep > 0 ? { failedStep, failureSummary } : {}),
    finalUrl,
    finalTitle,
    startedAt,
    completedAt,
  };
  browserTeachSessions.set(resolved, {
    ...teach,
    phase: 'verified',
    verification,
  });
  await broadcastBrowserViewportUpdate(
    verifierSessionId,
    verifierSession,
    'browser_teach_verify',
    verification.status === 'passed'
      ? 'Teach verifier completed the approved replay.'
      : (verification.status === 'partial'
        ? 'Teach verifier reached an issue after partial progress.'
        : 'Teach verifier failed before completing the approved replay.'),
  ).catch(() => {});
  try {
    broadcastWS({
      type: 'browser:teach:verification',
      sessionId: resolved,
      phase: 'verified',
      verification,
      timestamp: completedAt,
    });
  } catch {
    // Best-effort UI sync only.
  }

  const lines = [
    `Teach verification ${verification.status === 'passed' ? 'passed' : (verification.status === 'partial' ? 'completed with issues' : 'failed')}.`,
    `Boundary: ${boundaryLabel}.`,
    `Start URL: ${teach.startUrl}`,
    `Verifier session: ${verifierSessionId}`,
    `Executed ${executedCount} of ${totalRecordedSteps} recorded step${totalRecordedSteps === 1 ? '' : 's'}.`,
    verification.stopBeforeStep > 0
      ? `Stopped before step ${verification.stopBeforeStep}.`
      : 'Ran the recorded workflow through the approved boundary.',
    riskyStepIndexes.length ? `Risky steps in the recorded workflow: ${riskyStepIndexes.join(', ')}.` : 'Risky steps in the recorded workflow: none.',
    executionLines.length ? `Step log:\n${executionLines.join('\n')}` : '',
    failedStep > 0 ? `Failure: ${failureSummary}` : '',
    finalTitle || finalUrl ? `Final page: ${finalTitle ? `"${finalTitle}"` : finalUrl}${finalUrl ? ` (${finalUrl})` : ''}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export function getBrowserSessionInfo(sessionId: string): BrowserSessionInfo {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  const inHouse = inHouseSessions.get(resolved);
  const metadata = getBrowserSessionMetadata(resolved);
  const originLabel = formatBrowserSessionOriginLabel(resolved, metadata);
  const interactionState = browserInteractionStates.get(resolveBrowserInteractionStateId(sessionId));
  const liveStream = browserLiveStreams.get(resolved);
  if (inHouse) {
    return {
      active: true,
      sessionId: resolved,
      originLabel,
      url: inHouse.url,
      title: inHouse.title,
      debugPort: 0,
      profileDir: 'Electron persistent partition: persist:prometheus-inhouse-browser',
      profileKind: 'inhouse',
      browserTarget: 'inhouse',
      profileLabel: inHouse.profileId === 'main' ? getBrowserProfileLabel('inhouse') : `In-house profile ${inHouse.profileId}`,
      inhouseProfile: inHouse.profileId,
      activeTabId: inHouse.activeTabId,
      tabs: normalizeInHouseTabs(inHouse.tabs),
      mode: interactionState?.mode,
      captured: interactionState?.captured,
      controlOwner: interactionState?.controlOwner,
      streamActive: false,
      streamTransport: '',
      streamFocus: 'interactive',
      lastActor: interactionState?.lastActor,
      lastActorSummary: interactionState?.lastActorSummary,
      recentUserActions: interactionState?.recentUserActions ? [...interactionState.recentUserActions] : [],
    };
  }
  if (!session) {
    return {
      active: false,
      sessionId: resolved,
      originLabel,
      browserTarget: metadata.ownerType === 'main' ? getMainBrowserTarget(resolved) : 'prometheus',
      profileKind: metadata.ownerType === 'main' ? getMainBrowserTarget(resolved) : 'prometheus',
      profileLabel: getBrowserProfileLabel(metadata.ownerType === 'main' ? getMainBrowserTarget(resolved) : 'prometheus'),
      mode: interactionState?.mode,
      captured: interactionState?.captured,
      controlOwner: interactionState?.controlOwner,
      streamActive: liveStream?.active === true,
      streamTransport: liveStream?.transport || '',
      streamFocus: liveStream?.focus || 'passive',
      lastActor: interactionState?.lastActor,
      lastActorSummary: interactionState?.lastActorSummary,
      recentUserActions: interactionState?.recentUserActions ? [...interactionState.recentUserActions] : [],
    };
  }
  try {
    const url = session.lastPageUrl || session.page.url();
    const title = session.lastPageTitle || undefined;
    return {
      active: true,
      sessionId: resolved,
      originLabel,
      url,
      title,
      debugPort: session.debugPort,
      profileDir: session.profileDir,
      profileKind: session.profileKind,
      browserTarget: session.browserTarget,
      profileLabel: getBrowserProfileLabel(session.profileKind),
      mode: interactionState?.mode,
      captured: interactionState?.captured,
      controlOwner: interactionState?.controlOwner,
      streamActive: liveStream?.active === true,
      streamTransport: liveStream?.transport || '',
      streamFocus: liveStream?.focus || 'passive',
      lastActor: interactionState?.lastActor,
      lastActorSummary: interactionState?.lastActorSummary,
      recentUserActions: interactionState?.recentUserActions ? [...interactionState.recentUserActions] : [],
    };
  } catch {
    return {
      active: true,
      sessionId: resolved,
      originLabel,
      debugPort: session.debugPort,
      profileDir: session.profileDir,
      profileKind: session.profileKind,
      browserTarget: session.browserTarget,
      profileLabel: getBrowserProfileLabel(session.profileKind),
      mode: interactionState?.mode,
      captured: interactionState?.captured,
      controlOwner: interactionState?.controlOwner,
      streamActive: liveStream?.active === true,
      streamTransport: liveStream?.transport || '',
      streamFocus: liveStream?.focus || 'passive',
      lastActor: interactionState?.lastActor,
      lastActorSummary: interactionState?.lastActorSummary,
      recentUserActions: interactionState?.recentUserActions ? [...interactionState.recentUserActions] : [],
    };
  }
}

export function listBrowserSessions(): BrowserSessionListEntry[] {
  const entries: BrowserSessionListEntry[] = [];
  const seen = new Set<string>();
  const seenSessionObjects = new Set<BrowserSession>();
  for (const [sessionId, session] of sessions.entries()) {
    if (seen.has(sessionId)) continue;
    if (seenSessionObjects.has(session)) continue;
    seen.add(sessionId);
    seenSessionObjects.add(session);
    const metadata = getBrowserSessionMetadata(sessionId);
    const info = getBrowserSessionInfo(sessionId);
    entries.push({
      ...info,
      active: true,
      sessionId,
      ownerType: metadata.ownerType,
      ownerId: metadata.ownerId || '',
      label: metadata.label || '',
      originLabel: info.originLabel || formatBrowserSessionOriginLabel(sessionId, metadata),
      taskPrompt: metadata.taskPrompt || '',
      spawnerSessionId: metadata.spawnerSessionId || '',
      createdAt: session.createdAt || metadata.createdAt || 0,
      updatedAt: metadata.updatedAt || session.createdAt || 0,
      debugPort: session.debugPort,
      profileDir: session.profileDir,
      profileKind: session.profileKind,
      browserTarget: session.browserTarget,
      profileLabel: getBrowserProfileLabel(session.profileKind),
    });
  }
  for (const [sessionId, session] of inHouseSessions.entries()) {
    if (seen.has(sessionId)) continue;
    seen.add(sessionId);
    const metadata = getBrowserSessionMetadata(sessionId);
    const info = getBrowserSessionInfo(sessionId);
    entries.push({
      ...info,
      active: true,
      sessionId,
      ownerType: metadata.ownerType,
      ownerId: metadata.ownerId || '',
      label: metadata.label || '',
      originLabel: info.originLabel || formatBrowserSessionOriginLabel(sessionId, metadata),
      taskPrompt: metadata.taskPrompt || '',
      spawnerSessionId: metadata.spawnerSessionId || '',
      createdAt: session.createdAt || metadata.createdAt || 0,
      updatedAt: session.updatedAt || metadata.updatedAt || 0,
      debugPort: 0,
      profileDir: 'Electron persistent partition: persist:prometheus-inhouse-browser',
      profileKind: 'inhouse',
      browserTarget: 'inhouse',
      profileLabel: getBrowserProfileLabel('inhouse'),
    });
  }
  return entries.sort((a, b) => {
    const weight = (entry: BrowserSessionListEntry) => {
      if (entry.ownerType === 'main') return 0;
      if (entry.ownerType === 'background') return 1;
      if (entry.ownerType === 'task') return 2;
      if (entry.ownerType === 'team-agent') return 3;
      return 4;
    };
    return weight(a) - weight(b) || (b.createdAt || 0) - (a.createdAt || 0);
  });
}

async function resolveNamedBrowserElement(
  sessionId: string,
  name: string,
): Promise<null | {
  entry: BrowserKnowledgeElement;
  selector: string;
  tagName: string;
  id: string;
  text: string;
  bounds: { x: number; y: number; width: number; height: number } | null;
}> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) return null;
  const url = String(session.page.url() || '').trim();
  const entry = matchNamedBrowserElementForUrl(url, name);
  if (!entry) return null;
  const selectors = Array.from(new Set([
    String(entry.selector || '').trim(),
    ...(Array.isArray(entry.selectors) ? entry.selectors.map((value) => String(value || '').trim()) : []),
    entry.id ? `#${entry.id}` : '',
  ].filter(Boolean)));

  for (const selector of selectors) {
    try {
      const locator = session.page.locator(selector).first();
      const count = await locator.count();
      if (!count) continue;
      const meta = await locator.evaluate((node: any) => {
        const rect = typeof node?.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
        return {
          tagName: String(node?.tagName || '').toLowerCase(),
          id: String(node?.id || '').trim(),
          text: String((node?.innerText || node?.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 240),
          bounds: rect
            ? {
                x: Math.round(Number(rect.left || 0)),
                y: Math.round(Number(rect.top || 0)),
                width: Math.round(Number(rect.width || 0)),
                height: Math.round(Number(rect.height || 0)),
              }
            : null,
        };
      });
      return {
        entry,
        selector,
        tagName: String(meta?.tagName || entry.tagName || '').trim(),
        id: String(meta?.id || entry.id || '').trim(),
        text: String(meta?.text || entry.text || '').trim(),
        bounds: meta?.bounds || null,
      };
    } catch {
      // Try the next selector candidate.
    }
  }

  return null;
}

interface ResolvedBrowserExtractionSchema {
  name: string;
  requestedSchemaName: string;
  saveAs: string;
  aliases: string[];
  source: 'inline' | 'saved' | 'saved+override';
  itemRootName: string;
  containerSelector: string;
  dedupeKey: string;
  limit: number;
  fields: Record<string, BrowserKnowledgeExtractionField>;
}

function normalizeExtractionFieldInput(raw: any): BrowserKnowledgeExtractionField | null {
  if (!raw || typeof raw !== 'object') return null;
  const selector = String(raw.selector || '').trim();
  if (!selector) return null;
  const typeRaw = String(raw.type || 'text').trim().toLowerCase();
  const type = typeRaw === 'href' || typeRaw === 'src' || typeRaw === 'attr' || typeRaw === 'html' ? typeRaw : 'text';
  const field: BrowserKnowledgeExtractionField = { selector, type };
  const attribute = String(raw.attribute || '').trim();
  if (attribute) field.attribute = attribute;
  if (raw.required != null) field.required = raw.required === true;
  return field;
}

function normalizeExtractionFieldsInput(raw: any): Record<string, BrowserKnowledgeExtractionField> {
  const fields: Record<string, BrowserKnowledgeExtractionField> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fields;
  for (const [fieldName, value] of Object.entries(raw)) {
    const cleanName = String(fieldName || '').trim();
    if (!cleanName) continue;
    const normalized = normalizeExtractionFieldInput(value);
    if (!normalized) continue;
    fields[cleanName] = normalized;
  }
  return fields;
}

export function resolveBrowserExtractionSchemaForUrl(
  url: string,
  schemaInput: Record<string, any>,
  caller = 'browser_extract_structured',
): { schema?: ResolvedBrowserExtractionSchema; error?: string } {
  const input = schemaInput && typeof schemaInput === 'object' ? { ...schemaInput } : {};
  const example = JSON.stringify({ container_selector: '#content', fields: { title: { selector: 'h1', type: 'text' } } }, null, 2);
  const requestedSchemaName = String(input.schema_name || input.use_schema || input.schemaName || '').trim();
  const savedSchema = requestedSchemaName ? matchNamedBrowserExtractionSchemaForUrl(url, requestedSchemaName) : null;
  if (requestedSchemaName && !savedSchema) {
    const available = listNamedBrowserExtractionSchemasForUrl(url).map((entry) => entry.name).slice(0, 12);
    const suffix = available.length
      ? ` Available saved extraction schemas for this site: ${available.join(', ')}.`
      : ' No saved extraction schemas exist for this site yet.';
    return { error: `Could not resolve a saved extraction schema named "${requestedSchemaName}".${suffix}` };
  }

  const inlineFields = normalizeExtractionFieldsInput(input.fields);
  if (input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields)) {
    const supported = new Set(['text', 'href', 'src', 'attr', 'html']);
    const invalid = Object.entries(input.fields).flatMap(([name, raw]: [string, any]) => {
      const type = String(raw?.type || 'text').trim().toLowerCase();
      return supported.has(type) ? [] : [`${name}.type="${type}"`];
    });
    if (invalid.length) return { error: `Unsupported extraction field type(s): ${invalid.join(', ')}. Supported: text, href, src, attr, html. For lists, use one container per item or run_js. Minimum valid schema:\n${example}` };
  }
  const fields = Object.keys(inlineFields).length ? inlineFields : { ...(savedSchema?.fields || {}) };
  if (!Object.keys(fields).length) {
    return { error: `${caller} requires both a container selector (or saved item root) and fields, unless schema_name resolves both. Minimum valid schema:\n${example}` };
  }

  const itemRootName = String(
    input.item_root
    || input.root_name
    || input.container_name
    || savedSchema?.itemRoot
    || '',
  ).trim();
  let containerSelector = String(
    input.container_selector
    || input.containerSelector
    || savedSchema?.containerSelector
    || '',
  ).trim();

  if (!containerSelector && itemRootName) {
    const root = matchNamedBrowserItemRootForUrl(url, itemRootName);
    if (!root) {
      const available = listNamedBrowserItemRootsForUrl(url).map((entry) => entry.name).slice(0, 12);
      const suffix = available.length
        ? ` Available saved item roots for this site: ${available.join(', ')}.`
        : ' No saved item roots exist for this site yet.';
      return { error: `Could not resolve a saved item root named "${itemRootName}".${suffix}` };
    }
    containerSelector = String(root.selector || '').trim();
  }

  if (!containerSelector) {
    return { error: `${caller} requires both a container selector (or saved item root) and fields. Minimum valid schema:\n${example}` };
  }

  const overridesUsed = Object.keys(inlineFields).length > 0
    || !!String(input.item_root || input.root_name || input.container_name || input.container_selector || input.containerSelector || '').trim()
    || input.limit != null
    || input.dedupe_key != null
    || input.dedupeKey != null;

  return {
    schema: {
      name: String(input.name || requestedSchemaName || savedSchema?.name || '').trim(),
      requestedSchemaName,
      saveAs: String(input.save_as || input.remember_as || '').trim(),
      aliases: Array.isArray(input.aliases) ? input.aliases.map((value: any) => String(value || '').trim()).filter(Boolean) : [],
      source: savedSchema ? (overridesUsed ? 'saved+override' : 'saved') : 'inline',
      itemRootName,
      containerSelector,
      dedupeKey: String(input.dedupe_key || input.dedupeKey || savedSchema?.dedupeKey || '').trim(),
      limit: Math.min(Math.max(Number(input.limit || savedSchema?.limit || 50) || 50, 1), 500),
      fields,
    },
  };
}

async function extractStructuredItemsFromCurrentPage(
  page: PwPage,
  schema: ResolvedBrowserExtractionSchema,
  options: { limit?: number } = {},
): Promise<Array<{
  item: Record<string, any>;
  meta: { requiredMissing: number; containerText: string; dedupeSource: string };
}>> {
  const payload = {
    containerSelector: schema.containerSelector,
    fields: schema.fields,
    limit: Math.min(Math.max(Number(options.limit || schema.limit || 50) || 50, 1), 500),
  };

  return page.evaluate((s: any) => {
    const doc = (globalThis as any).document;
    const containerSel: string = s.containerSelector || 'body';
    const fields: Record<string, any> = s.fields || {};
    const limitNum = Math.min(Number(s.limit) || 50, 500);
    const containers = Array.from(doc.querySelectorAll(containerSel)).slice(0, limitNum);

    return containers.map((container: any) => {
      const item: Record<string, any> = {};
      let requiredMissing = 0;
      const dedupeParts: string[] = [];
      for (const [fieldName, def] of Object.entries(fields)) {
        const fieldDef = def as any;
        const sel: string = String(fieldDef?.selector || '').trim();
        if (!sel) {
          item[fieldName] = null;
          if (fieldDef?.required) requiredMissing += 1;
          continue;
        }
        try {
          const el: any = container.querySelector(sel);
          if (!el) {
            item[fieldName] = null;
            if (fieldDef?.required) requiredMissing += 1;
            continue;
          }
          const extractType: string = String(fieldDef?.type || 'text').trim().toLowerCase();
          let value: any = null;
          if (extractType === 'href') value = el.href || el.getAttribute('href') || null;
          else if (extractType === 'src') {
            const dynamicRaw = el.getAttribute?.('data-a-dynamic-image') || '';
            let dynamicUrl = '';
            if (dynamicRaw) {
              try {
                const dynamic = JSON.parse(dynamicRaw) as Record<string, unknown>;
                dynamicUrl = Object.entries(dynamic).sort((a, b) => {
                  const area = (entry: [string, unknown]) => Array.isArray(entry[1])
                    ? Number(entry[1][0] || 0) * Number(entry[1][1] || 0)
                    : 0;
                  return area(b) - area(a);
                })[0]?.[0] || '';
              } catch {}
            }
            const srcset = String(el.getAttribute?.('srcset') || el.getAttribute?.('data-srcset') || '');
            const srcsetUrl = srcset.split(',').map((entry: string) => {
              const parts = entry.trim().split(/\s+/);
              return { url: parts[0], size: Number(String(parts[1] || '').replace(/[^0-9.]/g, '')) || 0 };
            }).filter((entry: any) => entry.url).sort((a: any, b: any) => b.size - a.size)[0]?.url || '';
            const rawSrc = dynamicUrl || el.getAttribute?.('data-old-hires') || el.getAttribute?.('data-zoom-hires')
              || srcsetUrl || el.currentSrc || el.getAttribute?.('data-src') || el.getAttribute?.('data-lazy-src')
              || el.src || el.getAttribute?.('src') || '';
            try { value = rawSrc ? new URL(rawSrc, (globalThis as any).location?.href || '').href : null; }
            catch { value = rawSrc || null; }
          }
          else if (extractType === 'attr') value = el.getAttribute(fieldDef.attribute || 'value') || null;
          else if (extractType === 'html') value = (el.innerHTML || '').trim().slice(0, 1000);
          else value = ((el.innerText || el.textContent || '').trim()).slice(0, 500);
          if ((value == null || String(value).trim() === '') && fieldDef?.required) requiredMissing += 1;
          item[fieldName] = value;
          if (value != null && String(value).trim()) {
            dedupeParts.push(`${fieldName}:${String(value).replace(/\s+/g, ' ').trim().slice(0, 240)}`);
          }
        } catch {
          item[fieldName] = null;
          if (fieldDef?.required) requiredMissing += 1;
        }
      }
      const containerText = String(container?.innerText || container?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1000);
      return {
        item,
        meta: {
          requiredMissing,
          containerText,
          dedupeSource: dedupeParts.join('|') || containerText.slice(0, 500),
        },
      };
    });
  }, payload);
}

function buildInHouseStructuredExtractionScript(
  schema: ResolvedBrowserExtractionSchema,
  options: { limit?: number } = {},
): string {
  const payload = {
    containerSelector: schema.containerSelector || 'body',
    fields: schema.fields || {},
    limit: Math.min(Math.max(Number(options.limit || schema.limit || 50) || 50, 1), 500),
  };
  return `(() => {
    const s = ${JSON.stringify(payload)};
    const doc = globalThis.document;
    const containers = Array.from(doc.querySelectorAll(s.containerSelector || 'body')).slice(0, Math.min(Number(s.limit) || 50, 500));
    const toAbs = (value) => { try { return value ? new URL(value, globalThis.location.href).href : null; } catch { return value || null; } };
    return containers.map((container) => {
      const item = {};
      let requiredMissing = 0;
      const dedupeParts = [];
      for (const [fieldName, fieldDef] of Object.entries(s.fields || {})) {
        const def = fieldDef || {};
        const selector = String(def.selector || '').trim();
        let value = null;
        try {
          const el = selector ? container.querySelector(selector) : null;
          if (el) {
            const type = String(def.type || 'text').toLowerCase();
            if (type === 'href') value = el.href || el.getAttribute('href') || null;
            else if (type === 'src') {
              const raw = el.currentSrc || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('src') || '';
              value = toAbs(raw);
            } else if (type === 'attr') value = el.getAttribute(def.attribute || 'value') || null;
            else if (type === 'html') value = String(el.innerHTML || '').trim().slice(0, 1000);
            else value = String(el.innerText || el.textContent || '').trim().slice(0, 500);
          }
        } catch {}
        if ((value == null || String(value).trim() === '') && def.required === true) requiredMissing += 1;
        item[fieldName] = value;
        if (value != null && String(value).trim()) dedupeParts.push(fieldName + ':' + String(value).replace(/\\s+/g, ' ').trim().slice(0, 240));
      }
      const containerText = String(container.innerText || container.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 1000);
      return { item, meta: { requiredMissing, containerText, dedupeSource: dedupeParts.join('|') || containerText.slice(0, 500) } };
    });
  })()`;
}

async function extractStructuredItemsFromInHousePage(
  sessionId: string,
  schema: ResolvedBrowserExtractionSchema,
  options: { limit?: number } = {},
): Promise<Array<{ item: Record<string, any>; meta: { requiredMissing: number; containerText: string; dedupeSource: string } }>> {
  const result = await callInHouseBrowser('run-js', {
    sessionId: resolveSessionId(sessionId),
    code: buildInHouseStructuredExtractionScript(schema, options),
  });
  return Array.isArray(result) ? result as any : [];
}

function broadcastBrowserKnowledgeSnapshot(
  sessionId: string,
  url: string,
  site: BrowserSiteKnowledge,
  payload: { action: string; savedKind?: 'element' | 'item_root' | 'schema'; saved?: any },
): void {
  try {
    broadcastWS({
      type: 'browser:knowledge',
      action: payload.action,
      sessionId,
      url,
      site: site.hostname,
      savedKind: payload.savedKind,
      saved: payload.saved,
      elements: site.elements,
      itemRoots: site.itemRoots,
      extractionSchemas: site.extractionSchemas,
      timestamp: Date.now(),
    });
  } catch {
    // Best-effort UI sync only.
  }
}

export async function getBrowserNamedElementsForSession(sessionId: string, restoreHint?: BrowserSessionRestoreHint): Promise<null | {
  sessionId: string;
  url: string;
  site: string;
  title: string;
  active: boolean;
  mode: BrowserInteractionMode;
  captured: boolean;
  controlOwner: 'agent' | 'user';
  streamActive: boolean;
  streamTransport: 'cdp' | 'snapshot' | '';
  streamFocus: BrowserLiveStreamFocus;
  frameBase64: string;
  frameWidth: number;
  frameHeight: number;
  elements: BrowserKnowledgeElement[];
  itemRoots: BrowserKnowledgeItemRoot[];
  extractionSchemas: BrowserKnowledgeExtractionSchema[];
}> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error && !getInHouseSession(resolved)) return null;
  const inHouse = getInHouseSession(resolved);
  if (inHouse) {
    const liveStream = browserLiveStreams.get(resolved);
    const url = String(inHouse.url || '').trim();
    const shot = getLastBrowserScreenshot(resolved) || await browserVisionScreenshot(resolved).catch(() => null);
    const interactionState = getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved));
    return {
      sessionId: resolved,
      url,
      site: (() => {
        try {
          return String(new URL(url).hostname || '').replace(/^www\./i, '').toLowerCase();
        } catch {
          return '';
        }
      })(),
      title: String(inHouse.title || ''),
      active: true,
      mode: interactionState.mode,
      captured: interactionState.captured,
      controlOwner: interactionState.controlOwner,
      streamActive: liveStream?.active === true,
      streamTransport: liveStream?.transport || '',
      streamFocus: liveStream?.focus || 'passive',
      frameBase64: String(shot?.base64 || ''),
      frameWidth: Number(shot?.width || 0),
      frameHeight: Number(shot?.height || 0),
      elements: listNamedBrowserElementsForUrl(url),
      itemRoots: listNamedBrowserItemRootsForUrl(url),
      extractionSchemas: listNamedBrowserExtractionSchemasForUrl(url),
    };
  }
  const session = sessions.get(resolved) || await getOrCreateSession(resolved, restoreHint).catch(() => null);
  if (!session) return null;
  const liveStream = browserLiveStreams.get(resolved);
  const url = String(session.page.url() || '').trim();
  const shot = getLastBrowserScreenshot(resolved) || await browserVisionScreenshot(resolved).catch(() => null);
  const title = await session.page.title().catch(() => '');
  return {
    sessionId: resolved,
    url,
    site: (() => {
      try {
        return String(new URL(url).hostname || '').replace(/^www\./i, '').toLowerCase();
      } catch {
        return '';
      }
    })(),
    title: String(title || ''),
    active: true,
    mode: getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved)).mode,
    captured: getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved)).captured,
    controlOwner: getOrCreateBrowserInteractionState(resolveBrowserInteractionStateId(resolved)).controlOwner,
    streamActive: liveStream?.active === true,
    streamTransport: liveStream?.transport || '',
    streamFocus: liveStream?.focus || 'passive',
    frameBase64: String(shot?.base64 || ''),
    frameWidth: Number(shot?.width || 0),
    frameHeight: Number(shot?.height || 0),
    elements: listNamedBrowserElementsForUrl(url),
    itemRoots: listNamedBrowserItemRootsForUrl(url),
    extractionSchemas: listNamedBrowserExtractionSchemasForUrl(url),
  };
}

export async function saveBrowserNamedElement(
  sessionId: string,
  payload: { name?: string; selector?: string; tagName?: string; id?: string; text?: string; url?: string; kind?: 'element' | 'item_root' },
): Promise<{
  sessionId: string;
  url: string;
  site: string;
  kind: 'element' | 'item_root';
  elements: BrowserKnowledgeElement[];
  itemRoots: BrowserKnowledgeItemRoot[];
  extractionSchemas: BrowserKnowledgeExtractionSchema[];
  saved: BrowserKnowledgeElement | BrowserKnowledgeItemRoot;
}> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) throw new Error('No browser session. Use browser_open first.');
  const url = String(session.page.url() || payload?.url || '').trim();
  const kind = String(payload?.kind || 'element').trim().toLowerCase() === 'item_root' ? 'item_root' : 'element';
  const { site, saved } = (() => {
    const saveFn = kind === 'item_root' ? saveNamedBrowserItemRootForUrl : saveNamedBrowserElementForUrl;
    const result = saveFn(url, {
      name: String(payload?.name || '').trim(),
      selector: String(payload?.selector || '').trim(),
      tagName: String(payload?.tagName || '').trim(),
      id: String(payload?.id || '').trim(),
      text: String(payload?.text || '').trim(),
      url,
    });
    return { site: result.site, saved: result.saved };
  })();
  return {
    sessionId: resolved,
    url,
    site: site.hostname,
    kind,
    elements: site.elements,
    itemRoots: site.itemRoots,
    extractionSchemas: site.extractionSchemas,
    saved,
  };
}

export async function browserInspectPoint(
  sessionId: string,
  x: number,
  y: number,
  options: { trackSelection?: boolean } = {},
): Promise<null | {
  sessionId: string;
  url: string;
  title: string;
  selector: string;
  pack: BrowserSelectorPack;
  tagName: string;
  id: string;
  classList: string[];
  role: string;
  text: string;
  htmlSnippet: string;
  bounds: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
}> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return null;
  if (getInHouseSession(resolved)) {
    const inHouse = getInHouseSession(resolved)!;
    const inspected: any = await callInHouseBrowser('inspect', { sessionId: resolved, x, y });
    if (!inspected || !inspected.tagName) return null;
    const pack = buildBrowserSelectorPack({
      tagName: inspected.tagName,
      id: inspected.id,
      role: inspected.role,
      text: inspected.text,
      name: inspected.text,
      xpath: '',
      testid: '',
      ariaLabel: '',
      placeholder: '',
      title: '',
      classList: [],
      siblingIndex: 0,
      parentChain: [],
    } as any);
    const selection = {
      sessionId: resolved,
      url: inHouse.url,
      title: inHouse.title,
      selector: String(inspected.selector || pack.css || ''),
      pack,
      tagName: String(inspected.tagName || ''),
      id: String(inspected.id || ''),
      classList: [],
      role: String(inspected.role || ''),
      text: String(inspected.text || ''),
      htmlSnippet: '',
      bounds: inspected.bounds,
      viewport: inspected.viewport,
    };
    if (options.trackSelection) {
      broadcastWS({
        type: 'browser:selection',
        sessionId: resolved,
        selection,
        timestamp: Date.now(),
      });
    }
    return selection;
  }
  const session = sessions.get(resolved);
  if (!session) return null;
  const px = Math.round(Number(x) || 0);
  const py = Math.round(Number(y) || 0);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  try {
    const inspected = await session.page.evaluate((point: { x: number; y: number }) => {
      const pointX = Number(point?.x || 0);
      const pointY = Number(point?.y || 0);
      const doc = (globalThis as any).document as any;
      const raw = doc.elementFromPoint(pointX, pointY) as any;
      if (!raw) return null;
      const viewportWidth = Math.round((globalThis as any).innerWidth || 0);
      const viewportHeight = Math.round((globalThis as any).innerHeight || 0);
      const readRole = (node: any) => String(node?.getAttribute?.('role') || '').trim().toLowerCase();
      const readText = (node: any) => String((node?.innerText || node?.textContent || '')).replace(/\s+/g, ' ').trim();
      const readRect = (node: any) => {
        const rect = typeof node?.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
        return {
          left: Math.round(Number(rect?.left || 0)),
          top: Math.round(Number(rect?.top || 0)),
          width: Math.max(0, Math.round(Number(rect?.width || 0))),
          height: Math.max(0, Math.round(Number(rect?.height || 0))),
        };
      };
      const hasStableAttrs = (node: any) => {
        if (!node || typeof node !== 'object') return false;
        return Boolean(
          String(node.id || '').trim()
          || String(node.getAttribute?.('data-testid') || '').trim()
          || String(node.getAttribute?.('aria-label') || '').trim()
          || String(node.getAttribute?.('name') || '').trim()
          || String(node.getAttribute?.('placeholder') || '').trim()
          || String(node.getAttribute?.('title') || '').trim()
        );
      };
      const isInteractive = (node: any) => {
        const tagName = String(node?.tagName || '').toLowerCase();
        const role = readRole(node);
        if (!tagName) return false;
        if (node?.isContentEditable) return true;
        if (['button', 'a', 'input', 'textarea', 'select', 'option', 'label', 'summary'].includes(tagName)) return true;
        return ['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem'].includes(role);
      };
      const noisyLeafTags = new Set(['path', 'svg', 'use', 'g', 'circle', 'rect', 'polygon', 'span', 'strong', 'em', 'b', 'i', 'small', 'time']);
      const isReasonableBox = (node: any, rawRect: { width: number; height: number }) => {
        const rect = readRect(node);
        if (rect.width < 8 || rect.height < 8) return false;
        if (rect.width > viewportWidth * 0.94 || rect.height > viewportHeight * 0.72) return false;
        const rawArea = Math.max(1, rawRect.width * rawRect.height);
        const area = rect.width * rect.height;
        if (area > rawArea * 36 && area > 160000) return false;
        return true;
      };
      const rawRect = readRect(raw);
      const lineage: any[] = [];
      let cursor = raw;
      let depth = 0;
      while (cursor && depth < 7) {
        const tagName = String(cursor?.tagName || '').toLowerCase();
        if (!tagName || tagName === 'body' || tagName === 'html') break;
        lineage.push(cursor);
        cursor = cursor.parentElement;
        depth += 1;
      }
      const semantic = lineage.find((node) => isInteractive(node) && isReasonableBox(node, rawRect));
      const stable = lineage.find((node, idx) => idx <= 3 && hasStableAttrs(node) && isReasonableBox(node, rawRect));
      const structural = lineage.find((node, idx) => {
        if (idx === 0) return false;
        const tagName = String(node?.tagName || '').toLowerCase();
        if (!tagName || noisyLeafTags.has(tagName)) return false;
        return isReasonableBox(node, rawRect);
      });
      const el = (semantic || stable || structural || raw) as any;
      const rect = el.getBoundingClientRect();
      const readNode = (node: any) => {
        if (!node || typeof node !== 'object') return null;
        const tagName = String(node.tagName || '').toLowerCase();
        if (!tagName) return null;
        const id = String(node.id || '').trim();
        const classList = Array.from(node.classList || []).map((value) => String(value || '').trim()).filter(Boolean);
        let siblingIndex = 0;
        if (node.parentElement) {
          const siblings = Array.from(node.parentElement.children || []).filter((candidate: any) => String(candidate?.tagName || '').toLowerCase() === tagName);
          const idx = siblings.indexOf(node);
          siblingIndex = idx >= 0 ? idx + 1 : 0;
        }
        return { tagName, id, classList, siblingIndex };
      };
      const parentChain: Array<{ tagName: string; id: string; classList: string[]; siblingIndex: number }> = [];
      let parentCursor = el.parentElement;
      while (parentCursor && parentChain.length < 4) {
        const entry = readNode(parentCursor);
        if (!entry) break;
        parentChain.unshift(entry);
        if (entry.id) break;
        parentCursor = parentCursor.parentElement;
      }
      const current = readNode(el);
      const text = String((el.innerText || el.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 240);
      const elRole = readRole(el);
      const buildXPath = (node: any) => {
        if (!node || node.nodeType !== 1) return '';
        const parts: string[] = [];
        let cursor = node;
        while (cursor && cursor.nodeType === 1 && parts.length < 12) {
          const tag = String(cursor.tagName || '').toLowerCase();
          if (!tag) break;
          if (cursor.id) { parts.unshift(`${tag}[@id="${cursor.id}"]`); break; }
          let nth = 1;
          let sib = cursor.previousElementSibling;
          while (sib) {
            if (String(sib.tagName || '').toLowerCase() === tag) nth += 1;
            sib = sib.previousElementSibling;
          }
          parts.unshift(`${tag}[${nth}]`);
          cursor = cursor.parentElement;
          if (!cursor || String(cursor.tagName || '').toLowerCase() === 'html') break;
        }
        return parts.length ? `//${parts.join('/')}` : '';
      };
      return {
        ...current,
        parentChain,
        text,
        htmlSnippet: String(el.outerHTML || '').slice(0, 800),
        role: elRole,
        testid: String(el.getAttribute?.('data-testid') || '').trim(),
        ariaLabel: String(el.getAttribute?.('aria-label') || '').trim(),
        name: String(el.getAttribute?.('name') || '').trim(),
        placeholder: String(el.getAttribute?.('placeholder') || '').trim(),
        title: String(el.getAttribute?.('title') || '').trim(),
        xpath: buildXPath(el),
        bounds: {
          x: Number(rect.left) || 0,
          y: Number(rect.top) || 0,
          width: Number(rect.width) || 0,
          height: Number(rect.height) || 0,
        },
        viewport: {
          width: viewportWidth,
          height: viewportHeight,
        },
      };
    }, { x: px, y: py });
    if (!inspected || !inspected.tagName) return null;
    const pack = buildBrowserSelectorPack({
      ...inspected,
      xpath: inspected.xpath,
      testid: inspected.testid,
      role: inspected.role,
      ariaLabel: inspected.ariaLabel,
      name: inspected.name,
      placeholder: inspected.placeholder,
      title: inspected.title,
      text: inspected.text,
    });
    if (options.trackSelection) {
      setBrowserLiveSelectionTracker(resolved, pack);
    }
    return {
      sessionId: resolved,
      url: String(session.page.url() || ''),
      title: String((await session.page.title().catch(() => '')) || ''),
      selector: pack.css,
      pack,
      tagName: String(inspected.tagName || ''),
      id: String(inspected.id || ''),
      classList: Array.isArray(inspected.classList) ? inspected.classList : [],
      role: String(inspected.role || ''),
      text: String(inspected.text || ''),
      htmlSnippet: String(inspected.htmlSnippet || ''),
      bounds: inspected.bounds,
      viewport: inspected.viewport,
    };
  } catch {
    return null;
  }
}

// Cleanup on process exit
process.on('exit', () => {
  for (const [, session] of sessions) {
    try { session.page.close(); } catch {}
  }
});

// --- X/Twitter Thread Scraper -------------------------------------------------
// Detects X URLs and scrapes tweet thread data using snapshots + deltas.

interface ExtractedTweet {
  text?: string;
  author?: string;
  handle?: string;
  timestamp?: string;
  metrics?: {
    likes?: string;
    replies?: string;
    reposts?: string;
    views?: string;
  };
  hasImage?: boolean;
  hasVideo?: boolean;
  media?: Array<{
    type: 'image' | 'video';
    url?: string;
    previewUrl?: string;
  }>;
  id?: string;
  link?: string;
  inReplyTo?: string;
  rawRef?: string;
}

interface XSnapshotDelta {
  pass: number;
  scrollY: number;
  added: string[];
  removed: string[];
  totalElements: number;
}

function mapBrowserFeedToExtractedTweets(feed: BrowserFeedItem[]): ExtractedTweet[] {
  return feed
    .filter((item) => item.source === 'x' && (item.text || item.link))
    .map((item) => ({
      id: item.id,
      link: item.link,
      author: item.author,
      handle: item.handle,
      timestamp: item.time,
      text: item.text,
      hasImage: item.hasImage,
      hasVideo: item.hasVideo,
      media: item.media,
      rawRef: item.id || item.link,
      metrics: item.metrics
        ? {
            likes: item.metrics.likes,
            replies: item.metrics.replies,
            reposts: item.metrics.reposts,
            views: item.metrics.views,
          }
        : undefined,
    }));
}

function buildSnapshotDelta(prevSnapshot: string, newSnapshot: string, pass: number, scrollY: number): XSnapshotDelta {
  const toElemSet = (snap: string) => new Set(snap.split('\n').filter(line => line.includes('@')));
  const prevSet = toElemSet(prevSnapshot);
  const newSet = toElemSet(newSnapshot);
  return {
    pass,
    scrollY,
    added: [...newSet].filter(line => !prevSet.has(line)).slice(0, 80),
    removed: [...prevSet].filter(line => !newSet.has(line)).slice(0, 80),
    totalElements: newSet.size,
  };
}

const X_SCRAPE_PROFILE_PREFIX = 'detached-x_scrape_';
let xScrapeOrphanSweep: Promise<{ killed: number; removedProfiles: number }> | undefined;

function isLiveXScrapeProfile(profileDir: string, debugPort?: number, pid?: number): boolean {
  const resolved = path.resolve(profileDir).toLowerCase();
  return Array.from(sessions.values()).some((session) =>
    (session.profileDir && path.resolve(session.profileDir).toLowerCase() === resolved)
    || (debugPort && session.debugPort === debugPort)
    || (pid && session.browser?.process?.()?.pid === pid),
  );
}

async function removeXScrapeProfileDir(profileDir: string): Promise<boolean> {
  const root = path.resolve(getPersistentBrowserProfileRoot());
  const resolved = path.resolve(profileDir);
  if (path.dirname(resolved).toLowerCase() !== root.toLowerCase()) return false;
  if (!path.basename(resolved).startsWith(X_SCRAPE_PROFILE_PREFIX)) return false;
  if (isLiveXScrapeProfile(resolved)) return false;
  try {
    await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill X-scrape Chromes left behind by earlier gateway runs (each scrape used to
 * leak one visible Chrome window) and delete their throwaway profiles. Only
 * touches `detached-x_scrape_*` profiles under the Prometheus profile root that
 * no live session in this gateway owns.
 */
export function sweepOrphanedXScrapeChromes(): Promise<{ killed: number; removedProfiles: number }> {
  // Publish the shared promise before enumeration starts; every scraper waits.
  return xScrapeOrphanSweep ??= Promise.resolve().then(runXScrapeOrphanSweep);
}

async function runXScrapeOrphanSweep(): Promise<{ killed: number; removedProfiles: number }> {
  const root = getPersistentBrowserProfileRoot();
  let killed = 0;
  const procs = await findChromeProcessesByProfilePrefix(root, X_SCRAPE_PROFILE_PREFIX);
  for (const proc of procs) {
    if (isLiveXScrapeProfile(proc.profileDir, proc.debugPort, proc.pid)) continue;
    if (await killProcessTree(proc.pid)) killed += 1;
  }
  let removedProfiles = 0;
  try {
    if (killed) await new Promise((r) => setTimeout(r, 750));
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(X_SCRAPE_PROFILE_PREFIX)) continue;
      const dir = path.join(root, entry.name);
      if (isLiveXScrapeProfile(dir)) continue;
      if (await removeXScrapeProfileDir(dir)) removedProfiles += 1;
    }
  } catch {}
  if (killed || removedProfiles) {
    console.log(`[Browser] X scrape sweep: killed ${killed} orphaned Chrome(s), removed ${removedProfiles} stale profile(s).`);
  }
  return { killed, removedProfiles };
}

export async function fetchXThread(sessionId: string, url: string): Promise<string> {
  // Normalize /video/N direct links to base tweet URL for proper extraction
  const normalizedUrl = url.replace(/\/video\/\d+(\?|$)/, '$1');
  await sweepOrphanedXScrapeChromes().catch(() => null);
  // Use unique session ID for X scraping, isolated from main session
  const xSessionId = `x_scrape_${Date.now()}`;
  let xProfileDir = '';
  const resolvedXSessionId = resolveSessionId(xSessionId);
  const tweets: ExtractedTweet[] = [];
  const snapshotDeltas: XSnapshotDelta[] = [];
  const seen = new Set<string>();
  const tweetKey = (tweet: ExtractedTweet): string => String(
    tweet.id || tweet.link || `${tweet.handle || ''}|${tweet.text || ''}`,
  ).replace(/\s+/g, ' ').trim().toLowerCase();
  const appendNewTweets = (items: ExtractedTweet[]): number => {
    let added = 0;
    for (const tweet of items) {
      const key = tweetKey(tweet);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      tweets.push(tweet);
      added += 1;
    }
    return added;
  };

  try {
    const session = await getOrCreateSession(resolvedXSessionId);
    xProfileDir = String(session.profileDir || '');
    await session.page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await Promise.race([
      session.page.waitForSelector('article[data-testid="tweet"]', { timeout: 2500 }).catch(() => null),
      session.page.waitForTimeout(900),
    ]);

    const captureTweets = async (): Promise<ExtractedTweet[]> => {
      const structured = await extractStructuredFromPage(session.page, 40);
      return mapBrowserFeedToExtractedTweets(structured.extractedFeed || []);
    };

    // Initial structured extraction
    appendNewTweets(await captureTweets());
    let previousSnapshot = await takeSnapshot(session.page, 80);
    rememberSnapshot(session, previousSnapshot);

    // Scroll and capture deltas (max 4 scrolls). Stop once scrolling stops
    // producing new unique tweets; X virtualizes old articles, so raw visible
    // tweet count alone is not a useful progress signal.
    let emptyPasses = 0;
    for (let i = 0; i < 4; i++) {
      const prevScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
      await session.page.evaluate(() => {
        const pageGlobal = globalThis as any;
        pageGlobal.scrollBy(0, Number(pageGlobal.innerHeight || 0) * 1.2);
      });
      await session.page.waitForTimeout(i === 0 ? 900 : 650);

      const newTweets = await captureTweets();
      const added = appendNewTweets(newTweets);
      const currentScrollY = await session.page.evaluate(() => Number((globalThis as any).scrollY || 0));
      const nextSnapshot = await takeSnapshot(session.page, 80);
      snapshotDeltas.push(buildSnapshotDelta(previousSnapshot, nextSnapshot, i + 1, currentScrollY));
      previousSnapshot = nextSnapshot;
      rememberSnapshot(session, nextSnapshot);

      if (added === 0) emptyPasses += 1;
      else emptyPasses = 0;

      if (emptyPasses >= 2 || currentScrollY === prevScrollY) {
        break;
      }
    }

    return JSON.stringify({
      success: true,
      url,
      tweets,
      count: tweets.length,
      snapshot_deltas: snapshotDeltas,
      message: `Captured ${tweets.length} tweets from X thread`,
    });
  } catch (err: any) {
    return JSON.stringify({
      success: false,
      url,
      error: err?.message || String(err),
    });
  } finally {
    // ALWAYS close the browser session, even on error
    try {
      await browserClose(xSessionId);
    } catch {
      // Silent fail: browser may have already closed
    }
    // Each scrape gets a throwaway profile; don't let hundreds pile up on disk.
    if (xProfileDir) removeXScrapeProfileDir(xProfileDir);
  }
}
