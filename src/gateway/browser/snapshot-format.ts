
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

import path from 'path';

import { getConfig } from '../../config/config.js';
import { getActiveWorkspace } from '../../tools/workspace-context.js';

import { BrowserSelectorPack } from './extraction.js';
import { BrowserSession } from './types.js';
import { getBrowserProfileLabel } from './chrome.js';

// Tracks the user-selected element per session so we can re-resolve its bounds
// on every frame and keep the overlay glued to the element through scroll/layout shifts.
export interface BrowserLiveSelectionTracker {
  pack: BrowserSelectorPack;
  fingerprint: string;
}

export const MAX_CACHED_BROWSER_SNAPSHOT_CHARS = 120_000;
export const MAX_NETWORK_INTERCEPT_ENTRIES = 500;

export function boundedBrowserSnapshot(value: unknown): string {
  const snapshot = String(value || '');
  if (snapshot.length <= MAX_CACHED_BROWSER_SNAPSHOT_CHARS) return snapshot;
  return `${snapshot.slice(0, MAX_CACHED_BROWSER_SNAPSHOT_CHARS)}\n[Snapshot truncated to the gateway cache limit.]`;
}

export function browserWorkspaceRoot(): string {
  const globalWorkspace = getConfig().getConfig().workspace.path;
  return getActiveWorkspace(globalWorkspace);
}

export function formatBrowserTabs(session: BrowserSession): string {
  const pages = session.context.pages();
  if (!pages.length) return 'No tabs are open in this browser context.';
  const lines = pages.map((page: any, index: number) => {
    const active = page === session.page ? '*' : ' ';
    const title = String(session.lastPageTitle && page === session.page ? session.lastPageTitle : '').trim();
    const url = String(page.url?.() || '').trim();
    return `${active} [${index}] ${title || '(untitled)'} ${url}`;
  });
  return [
    `Browser tabs for ${getBrowserProfileLabel(session.profileKind)} (${pages.length}):`,
    ...lines,
  ].join('\n');
}
