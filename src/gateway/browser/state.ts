
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

import { BrowserSession, InHouseBrowserSession, BrowserProfileKind, BrowserSessionMetadata, BrowserInteractionState, BrowserTeachSessionSnapshot } from './types.js';
import { BrowserLiveSelectionTracker } from './snapshot-format.js';

// --- Session Management --------------------------------------------------------

export const sessions: Map<string, BrowserSession> = new Map();
export const browserSessionInitInFlight: Map<string, Promise<BrowserSession>> = new Map();
export const browserLinkNavigationInFlight: Map<string, Promise<any>> = new Map();
export const inHouseSessions: Map<string, InHouseBrowserSession> = new Map();
export const mainBrowserTargetPreferences: Map<string, BrowserProfileKind> = new Map();
export const mainBrowserProfileDirectoryPreferences: Map<string, string> = new Map();
export const browserSessionMetadata: Map<string, BrowserSessionMetadata> = new Map();
export const browserInteractionStates: Map<string, BrowserInteractionState> = new Map();
export const browserControlWaiters: Map<string, Array<() => void>> = new Map();
export const browserTeachSessions: Map<string, BrowserTeachSessionSnapshot> = new Map();
export const browserConsolePageSessions: WeakMap<any, Set<BrowserSession>> = new WeakMap();
export const browserConsoleAttachedPages: WeakSet<any> = new WeakSet();
export const userChromeRelayUnsubscribers: Map<string, () => void> = new Map();
export const userChromeTabLocks: Map<number, string> = new Map();

// --- Browser Vision Screenshot Cache -----------------------------------------
// Stores the last browser_vision_screenshot result per session so chat.router.ts
// can inject it as a role:'user' vision message (OpenAI doesn't support images in tool messages).
export interface BrowserVisionScreenshotCacheEntry {
  base64: string;
  width: number;
  height: number;
  mimeType?: 'image/png' | 'image/jpeg';
  viewportWidth?: number;
  viewportHeight?: number;
  coordinateScale?: { x: number; y: number };
  normalized?: boolean;
  originalBytes?: number;
  bytes?: number;
  ts?: number;
}

export const _lastBrowserScreenshot: Map<string, BrowserVisionScreenshotCacheEntry & { ts: number }> = new Map();

export function setLastBrowserScreenshot(sessionId: string, data: BrowserVisionScreenshotCacheEntry): void {
  _lastBrowserScreenshot.set(sessionId, { ...data, ts: Date.now() });
}

export function getLastBrowserScreenshot(sessionId: string): BrowserVisionScreenshotCacheEntry | null {
  const entry = _lastBrowserScreenshot.get(sessionId);
  if (!entry) return null;
  // Expire after 60 seconds � stale screenshots are useless
  if (Date.now() - entry.ts > 60_000) {
    _lastBrowserScreenshot.delete(sessionId);
    return null;
  }
  const { ts, ...rest } = entry;
  return rest;
}

export function clearLastBrowserScreenshot(sessionId: string): void {
  _lastBrowserScreenshot.delete(sessionId);
}

export interface BrowserDownloadRecord {
  savedPath: string;
  relPath: string;
  suggestedFilename: string;
  url: string;
  sizeBytes: number;
  ts: number;
}

export const _lastBrowserDownload: Map<string, BrowserDownloadRecord> = new Map();

export function getLastBrowserDownload(sessionId: string): BrowserDownloadRecord | null {
  const entry = _lastBrowserDownload.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.ts > 10 * 60_000) {
    _lastBrowserDownload.delete(sessionId);
    return null;
  }
  return entry;
}

// --- Network Intercept Store ---------------------------------------------------
export interface NetworkLogEntry {
  url: string;
  method: string;
  status: number;
  contentType: string;
  body?: string;
  ts: number;
}
export const _networkInterceptLog: Map<string, NetworkLogEntry[]> = new Map();
export const _networkInterceptHandlers: Map<string, (response: any) => void> = new Map();

// --- Macro Recording Store (browser-side: element watch state) ----------------
// Per-session snapshot hash stored for delta computation
export const _snapshotHashCache: Map<string, string> = new Map();

// Per-session in-house browser profile selection. Each profile id maps to an
// isolated, persistent Electron partition (its own cookies/logins) on the main
// process. Main chat defaults to the shared "main" profile; subagents/tasks get
// an isolated profile derived from their stable owner identity so two agents
// driving two accounts never collide. Either side can override via inhouse_profile.
export const inHouseProfilePreferences: Map<string, string> = new Map();
export const inHouseTargetSessions: Set<string> = new Set();
// Agent sessions that explicitly switched back to a Chrome lane; they must not
// be pulled onto the in-house default again until they ask for it.
export const inHouseOptOutSessions: Set<string> = new Set();
export const browserLiveSelectionTrackers = new Map<string, BrowserLiveSelectionTracker>();

import type { BrowserLiveStreamState, BrowserPageGeometry } from './streaming.js';

export const browserLiveStreams: Map<string, BrowserLiveStreamState> = new Map();

export const browserGeometryCache = new Map<string, BrowserPageGeometry>();
