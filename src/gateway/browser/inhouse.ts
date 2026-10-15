
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

import { getInHouseBrowserRpcConfig } from './chrome.js';
import { InHouseBrowserSession, BrowserSessionMetadata } from './types.js';
import { inHouseSessions, mainBrowserProfileDirectoryPreferences } from './state.js';
import { resolveSessionId } from './extraction.js';


export function isInHouseBrowserAvailable(): boolean {
  return !!getInHouseBrowserRpcConfig();
}

export async function callInHouseBrowser<T = any>(route: string, payload: Record<string, any> = {}): Promise<T> {
  const cfg = getInHouseBrowserRpcConfig();
  if (!cfg) {
    throw new Error('Prometheus in-house browser is only available in the Electron desktop app.');
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 12_000) : null;
  let resp: any;
  try {
    resp = await fetch(`${cfg.url}/${String(route || '').replace(/^\/+/, '')}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(payload || {}),
      signal: controller?.signal,
    } as any);
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Timed out connecting to the Prometheus in-house browser.');
    throw new Error(`Could not connect to the Prometheus in-house browser: ${error?.message || error}`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  let data: any;
  try {
    data = await resp.json();
  } catch {
    throw new Error(`Invalid JSON from in-house browser (${route}); session=${String(payload.sessionId || '')}.`);
  }
  if (!resp.ok || data?.ok === false || data?.error) {
    throw new Error(String(data?.error || `In-house browser RPC failed (${resp.status}).`));
  }
  if (data?.ok !== true || !Object.prototype.hasOwnProperty.call(data, 'result')) {
    throw new Error(`Invalid response from in-house browser (${route}); session=${String(payload.sessionId || '')}: missing success result.`);
  }
  return data?.result as T;
}

export function getInHouseSession(sessionId: string): InHouseBrowserSession | undefined {
  return inHouseSessions.get(resolveSessionId(sessionId));
}

export function normalizeInHouseTabs(tabs: unknown): InHouseBrowserSession['tabs'] {
  if (!Array.isArray(tabs)) return [];
  return tabs.map((tab: any, index) => ({
    id: String(tab?.id || tab?.tabId || `native-tab-${index + 1}`).trim(),
    index: Number.isFinite(Number(tab?.index)) ? Number(tab.index) : index,
    title: String(tab?.title || '').trim() || 'New Tab',
    url: String(tab?.url || 'about:blank').trim() || 'about:blank',
    loading: tab?.loading === true,
    active: tab?.active === true,
    canGoBack: tab?.canGoBack === true,
    canGoForward: tab?.canGoForward === true,
  })).filter((tab) => tab.id);
}

export function normalizeInHouseProfileId(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Default in-house profile for agent-owned (non-main) browser sessions.
 *
 * Resolution order: the agent's own `browser_profile` setting, then the global
 * `subagent_browser_profile` setting, then the shared "main" Prometheus
 * profile. The value "isolated" (or "agent"/"own") gives the agent its own
 * persistent partition derived from its stable owner identity; any other value
 * is used as a profile id ("main" = the same logins as main chat).
 */
export const SHARED_SUBAGENT_BROWSER_PROFILE = 'main';

/** Agent-owned sessions that default onto the in-house lane (verifiers/scrapers stay on Playwright). */
export function isAgentOwnedBrowserSession(metadata: BrowserSessionMetadata): boolean {
  return metadata.ownerType === 'background' || metadata.ownerType === 'task' || metadata.ownerType === 'team-agent';
}

// Clear, actionable message for tools not yet ported to the in-house browser, so
// the agent gets guidance instead of a misleading "No browser session" error.
export function inHouseUnsupportedToolMessage(tool: string, alternative: string): string {
  return `NOTE: ${tool} is not yet available in the Prometheus in-house browser. ${alternative} (Or switch this session to the regular Chrome lane with browser_open target="prometheus".)`;
}

export function normalizeChromeProfileDirectory(value: unknown): string {
  return String(value || '').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
}

export function getUserChromeProfileDirectory(sessionId: string): string {
  const resolved = resolveSessionId(sessionId);
  return mainBrowserProfileDirectoryPreferences.get(resolved)
    || normalizeChromeProfileDirectory(process.env.USER_CHROME_PROFILE_DIRECTORY || process.env.CHROME_USER_PROFILE_DIRECTORY || '');
}
