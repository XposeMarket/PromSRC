
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
import os from 'os';

import { UserChromePage } from '../user-chrome-transport.js';
import { getUserChromeExtensionOnboarding, getUserChromeRelay } from '../user-chrome-relay.js';

import { resolveSessionId } from './extraction.js';
import { getBrowserSessionMetadata, releaseUserChromeTabLocks, claimUserChromeTab, attachBrowserConsoleCollector } from './sessions.js';
import { normalizeBrowserProfileKind, getBrowserProfileLabel, getMainChromeDebugPort } from './chrome.js';
import { isInHouseBrowserAvailable, normalizeChromeProfileDirectory, normalizeInHouseProfileId, getInHouseSession, callInHouseBrowser } from './inhouse.js';
import { getMainBrowserTarget } from './target.js';
import { mainBrowserTargetPreferences, mainBrowserProfileDirectoryPreferences, inHouseProfilePreferences, browserSessionInitInFlight, sessions, userChromeTabLocks } from './state.js';
import { stopBrowserLiveStream, persistBrowserSessionRecord } from './streaming.js';
import { clearBrowserSessionEphemeralState, formatInHouseTabs } from './selection.js';
import { clearInHouseSession, recoverInHouseSessionMapping, upsertInHouseSession } from './inhouse-sessions.js';
import { formatBrowserTabs } from './snapshot-format.js';
import { syncPageMetadata, rememberPageMetadata } from './observation.js';
import { getOrCreateSession } from './profiles.js';


export async function browserSetProfileTarget(
  sessionId: string,
  target: unknown,
  options?: { closeExisting?: boolean; profileDirectory?: unknown; inhouseProfile?: unknown },
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const metadata = getBrowserSessionMetadata(resolved);
  if (metadata.ownerType !== 'main') {
    return 'ERROR: browser profile target selection is only available in main chat sessions. Subagents keep isolated Prometheus browser profiles.';
  }
  const nextTarget = normalizeBrowserProfileKind(target);
  if (nextTarget === 'inhouse' && !isInHouseBrowserAvailable()) {
    return 'ERROR: Prometheus in-house browser is only available in the Electron desktop app. Use target="prometheus" for the regular Chrome/CDP browser.';
  }
  const profileDirectory = normalizeChromeProfileDirectory(options?.profileDirectory);
  const inhouseProfile = normalizeInHouseProfileId(options?.inhouseProfile);
  const currentTarget = getMainBrowserTarget(resolved);
  const wasUsingInHouse = currentTarget === 'inhouse' || !!getInHouseSession(resolved);
  mainBrowserTargetPreferences.set(resolved, nextTarget);
  if (profileDirectory) mainBrowserProfileDirectoryPreferences.set(resolved, profileDirectory);
  if (nextTarget === 'inhouse' && inhouseProfile) inHouseProfilePreferences.set(resolved, inhouseProfile);
  const pendingInit = browserSessionInitInFlight.get(resolved);
  if (pendingInit && options?.closeExisting !== false) await pendingInit.catch(() => {});
  const existing = sessions.get(resolved);
  if (existing && existing.browserTarget !== nextTarget && options?.closeExisting !== false) {
    await stopBrowserLiveStream(resolved, `Browser profile target changed to ${getBrowserProfileLabel(nextTarget)}.`).catch(() => {});
    clearBrowserSessionEphemeralState(resolved, existing);
    sessions.delete(resolved);
    if (existing.transport === 'extension') releaseUserChromeTabLocks(existing.sessionId);
    try { await existing.page.close(); } catch {}
    try { await existing.browser.close(); } catch {}
  }
  if (nextTarget !== 'inhouse' && wasUsingInHouse && options?.closeExisting !== false) {
    clearInHouseSession(resolved);
    await callInHouseBrowser('close', { sessionId: resolved }).catch(() => callInHouseBrowser('hide', { sessionId: resolved }).catch(() => {}));
  }
  const active = sessions.get(resolved);
  const activeInHouse = getInHouseSession(resolved);
  return [
    `Browser target set to ${getBrowserProfileLabel(nextTarget)}.`,
    nextTarget === 'user'
      ? getUserChromeExtensionOnboarding()
      : (nextTarget === 'inhouse'
        ? 'Prometheus in-house browser uses the embedded Electron browser surface. The current screenshot stream remains available only as fallback.'
        : `Prometheus target uses CDP port ${getMainChromeDebugPort()} and profile ${process.env.CHROME_PROFILE || path.join(os.homedir(), '.prometheus', 'chrome-debug-profile')}.`),
    active
      ? `Current active session already uses ${getBrowserProfileLabel(active.profileKind)}.`
      : (activeInHouse
        ? 'Current active session already uses the Prometheus in-house browser.'
        : (currentTarget !== nextTarget ? 'The next browser_open will create a fresh browser session for this target.' : 'No active browser session is open yet.')),
  ].join('\n');
}

export async function browserListTabs(sessionId: string): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) {
    const result: any = await callInHouseBrowser('tabs', { sessionId: resolved });
    const inHouse = upsertInHouseSession(resolved, result);
    return formatInHouseTabs(inHouse);
  }
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (session.transport === 'extension') {
    const tabs = await getUserChromeRelay().request('tabs.list');
    const activeId = (session.page as UserChromePage).tabId();
    return [`Browser tabs for user Chrome via Personal Chrome extension (${tabs.length}):`, ...tabs.map((tab: any, index: number) => `${tab.id === activeId ? '*' : ' '} [${index}] ${tab.title || '(untitled)'} ${tab.url || ''}`)].join('\n');
  }
  return formatBrowserTabs(session);
}

export async function browserSelectTab(sessionId: string, index: number): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) {
    const result: any = await callInHouseBrowser('select-tab', { sessionId: resolved, index: Number(index) });
    const inHouse = upsertInHouseSession(resolved, result);
    return `Selected Prometheus in-house browser tab [${index}].\n${formatInHouseTabs(inHouse)}`;
  }
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (session.transport === 'extension') {
    const tabs = await getUserChromeRelay().request('tabs.list');
    const tab = tabs[Math.max(0, Math.min(tabs.length - 1, Number(index)))];
    if (!tab) return `ERROR: No browser tab at index ${index}.`;
    await getUserChromeRelay().request('tabs.activate', { tabId: tab.id, windowId: tab.windowId });
    const nextPage = new UserChromePage(tab);
    claimUserChromeTab(session.sessionId, nextPage);
    session.page = nextPage;
    await (session.page as UserChromePage).cdp('Runtime.enable').catch(() => {});
    await (session.page as UserChromePage).cdp('Network.enable').catch(() => {});
    await syncPageMetadata(session).catch(() => {});
    persistBrowserSessionRecord(session);
    return `Selected Personal Chrome tab [${index}].\n${await browserListTabs(sessionId)}`;
  }
  const pages = session.context.pages();
  const idx = Math.max(0, Math.min(pages.length - 1, Number(index)));
  const page = pages[idx];
  if (!page) return `ERROR: No browser tab at index ${index}.`;
  session.page = page;
  attachBrowserConsoleCollector(session, page);
  await syncPageMetadata(session).catch(() => {});
  await Promise.resolve(page.bringToFront?.()).catch(() => {});
  persistBrowserSessionRecord(session);
  return `Selected browser tab [${idx}] in ${getBrowserProfileLabel(session.profileKind)}.\n${formatBrowserTabs(session)}`;
}

export async function browserNewTab(sessionId: string, url?: string): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) {
    const before = getInHouseSession(resolved);
    const beforeIds = new Set((before?.tabs || []).map((tab) => tab.id));
    const requestedUrl = String(url || '').trim();
    try {
      const result: any = await callInHouseBrowser('new-tab', { sessionId: resolved, url: requestedUrl });
      const inHouse = upsertInHouseSession(resolved, result);
      const warning = String(result?.operationWarning || '').trim();
      return `Opened new Prometheus in-house browser tab.${warning ? `\nWARNING: ${warning}` : ''}\n${formatInHouseTabs(inHouse)}`;
    } catch (err: any) {
      // Electron may have created the WebContents before a late loadURL error
      // or response race surfaced. Re-read authoritative tab state before
      // reporting failure so callers do not retry and create a duplicate tab.
      try {
        const state: any = await callInHouseBrowser('tabs', { sessionId: resolved });
        const inHouse = upsertInHouseSession(resolved, state);
        const created = inHouse.tabs.find((tab) => !beforeIds.has(tab.id)) || inHouse.tabs.find((tab) => tab.active && tab.id !== before?.activeTabId);
        if (created) {
          return `Opened new Prometheus in-house browser tab with a navigation warning: ${err.message}\n${formatInHouseTabs(inHouse)}`;
        }
      } catch {}
      return `ERROR: In-house browser new-tab failed. The tab may have been created; refresh with browser_list_tabs before retrying. ${err.message}`;
    }
  }
  const session = await getOrCreateSession(resolved);
  if (session.transport === 'extension') {
    const raw = String(url || '').trim();
    const targetUrl = raw && !/^[a-z][a-z0-9+.-]*:/i.test(raw) ? `https://${raw}` : (raw || 'about:blank');
    const tab = await getUserChromeRelay().request('tabs.create', { url: targetUrl, active: true });
    const nextPage = new UserChromePage(tab);
    claimUserChromeTab(session.sessionId, nextPage);
    session.page = nextPage;
    await (session.page as UserChromePage).cdp('Runtime.enable').catch(() => {});
    await (session.page as UserChromePage).cdp('Network.enable').catch(() => {});
    await syncPageMetadata(session).catch(() => {});
    persistBrowserSessionRecord(session);
    return `Opened new Personal Chrome tab.\n${await browserListTabs(sessionId)}`;
  }
  const page = await session.context.newPage();
  session.page = page;
  attachBrowserConsoleCollector(session, page);
  const targetUrl = String(url || '').trim();
  if (targetUrl) {
    const normalizedUrl = /^[a-z][a-z0-9+.-]*:/i.test(targetUrl) ? targetUrl : `https://${targetUrl}`;
    const response = await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
    await Promise.race([
      page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => null),
      page.waitForFunction(() => {
        const doc = (globalThis as any).document;
        return doc.readyState !== 'loading' && !!(doc.title || doc.body?.innerText?.trim() || doc.body?.children?.length);
      }, { timeout: 3000 }).catch(() => null),
    ]);
    const state = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      return { url: String((globalThis as any).location?.href || ''), title: String(doc.title || ''), readyState: String(doc.readyState || ''), bodyChars: String(doc.body?.innerText || '').trim().length };
    }).catch(() => ({ url: String(page.url?.() || ''), title: '', readyState: 'unknown', bodyChars: 0 }));
    rememberPageMetadata(session, state);
    persistBrowserSessionRecord(session);
    return JSON.stringify({ ok: true, tab_index: session.context.pages().indexOf(page), navigation_generation: Date.now(), response_status: response?.status?.() ?? null, ...state }, null, 2);
  }
  await syncPageMetadata(session).catch(() => {});
  persistBrowserSessionRecord(session);
  return `Opened new browser tab in ${getBrowserProfileLabel(session.profileKind)}.\n${formatBrowserTabs(session)}`;
}

export async function browserCloseTab(sessionId: string, index?: number): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) {
    const result: any = await callInHouseBrowser('close-tab', {
      sessionId: resolved,
      index: index == null ? undefined : Number(index),
    });
    if (result?.attached === false) {
      clearInHouseSession(resolved);
      return 'Closed the last Prometheus in-house browser tab; browser session is now inactive.';
    }
    const inHouse = upsertInHouseSession(resolved, result);
    return `Closed Prometheus in-house browser tab.\n${formatInHouseTabs(inHouse)}`;
  }
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (session.transport === 'extension') {
    const tabs = await getUserChromeRelay().request('tabs.list');
    const activeId = (session.page as UserChromePage).tabId();
    const idx = index == null ? tabs.findIndex((tab: any) => tab.id === activeId) : Math.max(0, Math.min(tabs.length - 1, Number(index)));
    const tab = tabs[idx];
    if (!tab) return `ERROR: No browser tab at index ${index}.`;
    await getUserChromeRelay().request('tabs.remove', { tabId: tab.id });
    userChromeTabLocks.delete(tab.id);
    const remaining = await getUserChromeRelay().request('tabs.list');
    if (!remaining.length) {
      clearBrowserSessionEphemeralState(resolved, session);
      sessions.delete(resolved);
      return 'Closed the last Chrome tab; Personal Chrome session is now inactive.';
    }
    session.page = new UserChromePage(remaining.find((item: any) => item.active) || remaining[Math.min(idx, remaining.length - 1)]);
    await syncPageMetadata(session).catch(() => {});
    return `Closed Personal Chrome tab [${idx}].\n${await browserListTabs(sessionId)}`;
  }
  const pages = session.context.pages();
  const idx = index == null ? pages.indexOf(session.page) : Math.max(0, Math.min(pages.length - 1, Number(index)));
  const page = pages[idx];
  if (!page) return `ERROR: No browser tab at index ${index}.`;
  await page.close().catch(() => {});
  const remaining = session.context.pages();
  if (!remaining.length) {
    clearBrowserSessionEphemeralState(resolved, session);
    sessions.delete(resolved);
    await stopBrowserLiveStream(resolved, 'Live browser stream stopped because the last browser tab closed.').catch(() => {});
    try { await session.browser.close(); } catch {}
    return 'Closed the last browser tab; browser session is now inactive.';
  }
  session.page = remaining[Math.max(0, Math.min(idx, remaining.length - 1))];
  attachBrowserConsoleCollector(session, session.page);
  await syncPageMetadata(session).catch(() => {});
  persistBrowserSessionRecord(session);
  return `Closed browser tab [${idx}].\n${formatBrowserTabs(session)}`;
}
