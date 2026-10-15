
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

import { createUserChromePage, UserChromePage } from '../user-chrome-transport.js';
import { getUserChromeRelay } from '../user-chrome-relay.js';

import { BrowserSessionMetadata, BrowserPerformanceObserver, BrowserProfileKind, BrowserSession, BrowserSessionRestoreHint, markBrowserPerformance, classifyBrowserLifecycleError } from './types.js';
import { lookupTaskSummary, releaseUserChromeTabLocks, inferBrowserOwnerType, registerBrowserSessionMetadata, claimUserChromeTab, attachBrowserConsoleCollector } from './sessions.js';
import { getMainChromeDebugPort, getUserChromeDebugPort, isPortOpen, connectOverCDPWithRetry, getBrowserProfileLabel, recoverStuckPrometheusChrome, findBrowserExecutableForPlaywright, connectOverCDPWithTimeout, getPW } from './chrome.js';
import { getMainBrowserTarget } from './target.js';
import { getUserChromeProfileDirectory } from './inhouse.js';
import { resolveSessionId } from './extraction.js';
import { browserSessionInitInFlight, sessions } from './state.js';
import { stopBrowserLiveStream, persistBrowserSessionRecord, buildBrowserSessionRestoreRecord, findRestorableBrowserPage, isRestorableBrowserUrl, clearBrowserInteractionState, clearBrowserTeachSessionSnapshot } from './streaming.js';
import { clearBrowserSessionEphemeralState } from './selection.js';
import { attachUserChromeRelayObservers } from './relay-observers.js';
import { syncPageMetadata, rememberPageMetadata } from './observation.js';


export function stableBrowserHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash * 31) + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function sanitizeBrowserProfileSegment(value: string, fallback: string): string {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

export function getStableBrowserIdentity(sessionId: string, metadata: BrowserSessionMetadata): string {
  const ownerId = String(metadata.ownerId || '').trim();
  const teamId = String(metadata.spawnerSessionId || '').trim();
  const sid = String(sessionId || '').trim();
  if (metadata.ownerType === 'team-agent') {
    if (teamId && ownerId) return `team-${teamId}-${ownerId}`;
    if (ownerId) return `team-${ownerId}`;
    const roomMatch = sid.match(/^team_room_member_(.+)___AGENT___(.+)$/);
    if (roomMatch?.[1] && roomMatch?.[2]) return `team-${roomMatch[1]}-${roomMatch[2]}`;
    const dispatchMatch = sid.match(/^team_dispatch_(.+)_\d+$/);
    if (dispatchMatch?.[1]) return `team-${dispatchMatch[1]}`;
  }
  if (metadata.ownerType === 'background' && ownerId) return `background-${ownerId}`;
  if (metadata.ownerType === 'task' && ownerId) {
    const task = lookupTaskSummary(ownerId || sid.replace(/^task_/, ''));
    if (task.teamId && task.teamAgentId) return `team-${task.teamId}-${task.teamAgentId}`;
    if (task.teamAgentId) return `team-${task.teamAgentId}`;
    return `task-${ownerId}`;
  }
  if (ownerId && ownerId !== sid) return `${metadata.ownerType}-${ownerId}`;
  return `${metadata.ownerType}-${sid || 'default'}`;
}

export function getPersistentBrowserProfileRoot(): string {
  return process.env.CHROME_PROFILES_DIR
    || path.join(os.homedir(), '.prometheus', 'chrome-profiles');
}

export function getPersistentBrowserProfileDir(identity: string): string {
  return path.join(getPersistentBrowserProfileRoot(), sanitizeBrowserProfileSegment(identity, 'default'));
}

export function getLegacyBrowserIdentities(sessionId: string, metadata: BrowserSessionMetadata): string[] {
  const ownerId = String(metadata.ownerId || '').trim();
  const sid = String(sessionId || '').trim();
  const identities: string[] = [];
  if (metadata.ownerType === 'team-agent') {
    if (ownerId) identities.push(`team-${ownerId}`, `team-agent-${ownerId}`);
    const teamId = String(metadata.spawnerSessionId || '').trim();
    if (teamId && ownerId) identities.push(`team-${teamId}-${ownerId}`);
    const dispatchMatch = sid.match(/^team_dispatch_(.+)_\d+$/);
    if (dispatchMatch?.[1]) identities.push(`team-${dispatchMatch[1]}`);
  }
  if (metadata.ownerType === 'task') {
    const task = lookupTaskSummary(ownerId || sid.replace(/^task_/, ''));
    if (task.teamAgentId) identities.push(`team-${task.teamAgentId}`, `team-agent-${task.teamAgentId}`);
    if (task.teamId && task.teamAgentId) identities.push(`team-${task.teamId}-${task.teamAgentId}`);
  }
  return Array.from(new Set(identities.filter(Boolean)));
}

export function resolvePersistentBrowserProfileDir(identity: string, sessionId: string, metadata: BrowserSessionMetadata): string {
  const root = process.env.CHROME_PROFILES_DIR
    || path.join(os.homedir(), '.prometheus', 'chrome-profiles');
  const primary = path.join(root, sanitizeBrowserProfileSegment(identity, 'default'));
  if (fs.existsSync(primary)) return primary;
  for (const legacyIdentity of getLegacyBrowserIdentities(sessionId, metadata)) {
    const legacy = path.join(root, sanitizeBrowserProfileSegment(legacyIdentity, 'default'));
    if (legacy !== primary && fs.existsSync(legacy)) {
      console.log(`[Browser] Reusing legacy persistent profile ${legacy} for stable identity ${identity}`);
      return legacy;
    }
  }
  return primary;
}

export function getPersistentBrowserPort(identity: string): number {
  const mainPort = getMainChromeDebugPort();
  const base = Number(process.env.CHROME_BACKGROUND_DEBUG_PORT_BASE || String(mainPort + 100));
  const span = Math.max(1, Number(process.env.CHROME_BACKGROUND_DEBUG_PORT_SPAN || '1000'));
  return base + (stableBrowserHash(identity) % span);
}

export async function connectOrLaunchPersistentChrome(
  pw: any,
  sessionId: string,
  metadata: BrowserSessionMetadata,
  onPerformanceStage?: BrowserPerformanceObserver,
): Promise<{ browser: any; debugPort: number; profileDir: string; ownsBrowser: boolean; profileKind: BrowserProfileKind; browserTarget: BrowserProfileKind }> {
  const identity = getStableBrowserIdentity(sessionId, metadata);
  const mainTarget = metadata.ownerType === 'main' ? getMainBrowserTarget(sessionId) : 'prometheus';
  const debugPort = metadata.ownerType === 'main'
    ? (mainTarget === 'user' ? getUserChromeDebugPort() : getMainChromeDebugPort())
    : getPersistentBrowserPort(identity);
  const profileDir = metadata.ownerType === 'main'
    ? (mainTarget === 'user'
      ? getRealChromeProfileDir()
      : (process.env.CHROME_PROFILE || path.join(os.homedir(), '.prometheus', 'chrome-debug-profile')))
    : resolvePersistentBrowserProfileDir(identity, sessionId, metadata);
  const profileKind: BrowserProfileKind = metadata.ownerType === 'main' ? mainTarget : 'prometheus';
  const chromeProfileDirectory = metadata.ownerType === 'main' && mainTarget === 'user'
    ? getUserChromeProfileDirectory(sessionId)
    : '';

  if (mainTarget === 'user') {
    throw new Error('Personal Chrome must use the Prometheus extension relay. The real Chrome profile is never launched with --remote-debugging-port.');
  }

  if (await isPortOpen(debugPort)) {
    try {
      const browser = await connectOverCDPWithRetry(pw, debugPort, onPerformanceStage);
      console.log(`[Browser] Connected to Chrome on port ${debugPort} (${metadata.ownerType}, ${getBrowserProfileLabel(profileKind)}, profile: ${profileDir})`);
      return { browser, debugPort, profileDir, ownsBrowser: false, profileKind, browserTarget: profileKind };
    } catch (e: any) {
      const message = String(e?.message || e);
      console.warn(`[Browser] Port ${debugPort} responded but CDP connect failed: ${message}`);
      const recovered = await recoverStuckPrometheusChrome(debugPort, profileDir);
      if (recovered) {
        console.warn(`[Browser] Reclaimed wedged Prometheus Chrome on port ${debugPort}; launching a fresh debugger target.`);
      } else {
      throw new Error(
        `Chrome debug port ${debugPort} is responding but Playwright could not attach within 5s. ` +
        `This usually means the existing ${getBrowserProfileLabel(profileKind)} process is wedged. ` +
        `Close Chrome for profile ${profileDir} or restart the browser target, then try browser_open again. ` +
        `Details: ${message.split('\n')[0] || message}`
      );
      }
    }
  }

  const chromePath = await findBrowserExecutableForPlaywright();
  if (!chromePath) {
    throw new Error('No Chrome/Chromium executable found. Configure CHROME_PATH or install Chrome at the app/runtime level.');
  }

  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
  const { spawn } = await import('child_process');
  console.log(`[Browser] Launching Chrome with --remote-debugging-port=${debugPort} and ${getBrowserProfileLabel(profileKind)} ${profileDir}...`);
  const launchArgs = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    ...(chromeProfileDirectory ? [`--profile-directory=${chromeProfileDirectory}`] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
  ];
  spawn(chromePath, launchArgs, { detached: true, stdio: 'ignore' }).unref();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (!await isPortOpen(debugPort)) continue;
    try {
      const browser = await connectOverCDPWithTimeout(pw, debugPort);
      console.log(`[Browser] Launched and connected to Chrome on port ${debugPort} (${metadata.ownerType}, ${getBrowserProfileLabel(profileKind)})`);
      return { browser, debugPort, profileDir, ownsBrowser: true, profileKind, browserTarget: profileKind };
    } catch {
      // Chrome may expose /json/version a moment before CDP is ready.
    }
  }

  const profileHint = chromeProfileDirectory ? `, profile-directory ${chromeProfileDirectory}` : '';
  throw new Error(
    `Chrome launched but did not respond on port ${debugPort} after 15s using profile ${profileDir}${profileHint}. ` +
    `If normal Chrome is already open with that user profile, close it first, then try again so Prometheus can launch a fresh debugger-enabled Chrome.`
  );
}

export async function isSessionAlive(session: BrowserSession): Promise<boolean> {
  try {
    if (session.transport === 'extension') {
      const page = session.page as UserChromePage;
      const tab = await getUserChromeRelay().request('tabs.get', { tabId: page.tabId() }, 2_000);
      page.updateTab(tab);
      return true;
    }
    // A closed page will throw on .url() or return 'about:blank' after CDP disconnect
    if (typeof (session.page as any).isClosed === 'function' && (session.page as any).isClosed()) return false;
    const url = session.page.url();
    if (!url && url !== 'about:blank') return false;
    if (session.ownsBrowser && !session.debugPort) return true;
    // Also ping the debug port to confirm the underlying Chrome process is still up.
    const debugPort = session.debugPort || getMainChromeDebugPort();
    const alive = await isPortOpen(debugPort);
    return alive;
  } catch {
    return false;
  }
}

/**
 * Returns the path to the user's real Chrome profile directory.
 * Used only when main chat explicitly selects target="user_chrome".
 * WARNING: Chrome must be fully closed before connecting, or CDP will reject it.
 */
export function getRealChromeProfileDir(): string {
  const os = require('os') as typeof import('os');
  const home = os.homedir();
  if (process.platform === 'win32') {
    return `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\User Data`;
  } else if (process.platform === 'darwin') {
    return `${home}/Library/Application Support/Google/Chrome`;
  }
  return `${home}/.config/google-chrome`;
}

export async function getOrCreateSession(
  sessionId: string,
  restoreHint?: BrowserSessionRestoreHint,
  onPerformanceStage?: BrowserPerformanceObserver,
): Promise<BrowserSession> {
  const resolved = resolveSessionId(sessionId);
  const pending = browserSessionInitInFlight.get(resolved);
  if (pending) {
    markBrowserPerformance(onPerformanceStage, 'session_init_join', { pending: true });
    return pending;
  }
  const startedAt = Date.now();
  markBrowserPerformance(onPerformanceStage, 'session_lookup', { existing: sessions.has(resolved) });
  const promise = getOrCreateSessionUncoalesced(resolved, restoreHint, onPerformanceStage)
    .then((session) => {
      markBrowserPerformance(onPerformanceStage, 'session_ready', {
        durationMs: Math.max(0, Date.now() - startedAt),
        reused: session.createdAt < startedAt,
        transport: session.transport || 'cdp',
      });
      return session;
    })
    .catch((error) => {
      markBrowserPerformance(onPerformanceStage, 'session_init_error', {
        durationMs: Math.max(0, Date.now() - startedAt),
        errorCode: classifyBrowserLifecycleError(error),
      });
      throw error;
    })
    .finally(() => {
      if (browserSessionInitInFlight.get(resolved) === promise) browserSessionInitInFlight.delete(resolved);
    });
  browserSessionInitInFlight.set(resolved, promise);
  return promise;
}

export async function getOrCreateSessionUncoalesced(
  sessionId: string,
  restoreHint?: BrowserSessionRestoreHint,
  onPerformanceStage?: BrowserPerformanceObserver,
): Promise<BrowserSession> {
  const startedAt = Date.now();
  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId)!;
    // Verify the session is still usable � if Chrome was closed externally the
    // page/browser objects are dead and every tool call will fail with
    // "Target page, context or browser has been closed". Evict and recreate.
    const aliveStartedAt = Date.now();
    const alive = await isSessionAlive(existing);
    markBrowserPerformance(onPerformanceStage, 'session_alive_check', {
      alive,
      durationMs: Math.max(0, Date.now() - aliveStartedAt),
    });
    if (alive) return existing;
    markBrowserPerformance(onPerformanceStage, 'session_reconnect_start', { reason: 'session_not_alive' });
    console.log(`[Browser] Session "${sessionId}" is dead (Chrome was closed). Evicting and relaunching...`);
    await stopBrowserLiveStream(sessionId, 'Live browser stream stopped because the Chrome session ended.').catch(() => {});
    clearBrowserSessionEphemeralState(sessionId, existing);
    sessions.delete(sessionId);
    if (existing.transport === 'extension') releaseUserChromeTabLocks(existing.sessionId);
    try { await existing.page.close(); } catch {}
    try { await existing.browser.close(); } catch {}
  }

  markBrowserPerformance(onPerformanceStage, 'session_create_start', { ownerType: inferBrowserOwnerType(sessionId) });
  const metadata = registerBrowserSessionMetadata(sessionId);
  const targetKind = metadata.ownerType === 'main' ? getMainBrowserTarget(sessionId) : 'prometheus';
  markBrowserPerformance(onPerformanceStage, 'session_target_selected', {
    ownerType: metadata.ownerType,
    profileKind: targetKind,
  });
  if (metadata.ownerType === 'main' && targetKind === 'inhouse') {
    throw new Error('The current browser target is Prometheus in-house browser. Use browser_open with target="prometheus" to switch back to regular Chrome/CDP.');
  }

  // Personal Chrome is not and must never become a CDP launch target. The
  // extension has chrome.debugger permission and supplies a page-shaped CDP
  // adapter over an authenticated loopback relay instead.
  if (metadata.ownerType === 'main' && targetKind === 'user') {
    markBrowserPerformance(onPerformanceStage, 'extension_session_create_start', { profileKind: targetKind });
    const page = await createUserChromePage();
    claimUserChromeTab(sessionId, page);
    await page.cdp('Runtime.enable').catch(() => {});
    await page.cdp('Network.enable').catch(() => {});
    const context: any = {
      pages: () => [page],
      newPage: async () => {
        const created = await getUserChromeRelay().request('tabs.create', { url: 'about:blank', active: true });
        const next = new UserChromePage(created);
        claimUserChromeTab(sessionId, next);
        session.page = next;
        return next;
      },
      on: () => context,
      off: () => context,
      newCDPSession: undefined,
    };
    const browser: any = { contexts: () => [context], close: async () => {} };
    const session: BrowserSession = {
      sessionId, browser, context, page, ownsBrowser: false, isolated: false,
      debugPort: undefined, profileDir: getRealChromeProfileDir(), profileKind: 'user', browserTarget: 'user', transport: 'extension',
      lastSnapshot: '', lastSnapshotAt: 0, lastPageUrl: page.url(), lastPageTitle: '', consoleEntries: [], injectedStaticContext: {}, createdAt: Date.now(),
    };
    sessions.set(sessionId, session);
    attachUserChromeRelayObservers(session);
    await syncPageMetadata(session).catch(() => {});
    persistBrowserSessionRecord(session);
    markBrowserPerformance(onPerformanceStage, 'session_create_done', {
      durationMs: Math.max(0, Date.now() - startedAt),
      transport: 'extension',
    });
    return session;
  }

  const pw = await getPW();
  if (!pw) throw new Error('Playwright not installed. Run: npm install playwright && npx playwright install chromium');

  const browserConnection = await connectOrLaunchPersistentChrome(pw, sessionId, metadata, onPerformanceStage);
  const browser = browserConnection.browser;

  // Get or create a context, then a page
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pages = context.pages();
  const persistedRecord = buildBrowserSessionRestoreRecord(sessionId, restoreHint);
  const restoredPage = await findRestorableBrowserPage(pages, persistedRecord);
  const page =
    restoredPage
    || pages.find((p: any) => p.url() === 'about:blank')
    || await context.newPage();

  // tsx compiles with keepNames:true (esbuild), which injects __name() helper calls into
  // page.evaluate() callbacks. __name is only defined in Node.js scope, not in the browser,
  // causing "ReferenceError: __name is not defined". Define a stub so evaluate calls don't crash.
  const __nameStub = `if(typeof globalThis.__name==='undefined'){globalThis.__name=function(t,v){try{Object.defineProperty(t,'name',{value:v,configurable:true});}catch(e){}return t;};}`;
  await page.addInitScript(__nameStub).catch(() => {});
  await page.evaluate(__nameStub).catch(() => {});

  const session: BrowserSession = {
    sessionId,
    browser,
    context,
    page,
    ownsBrowser: browserConnection.ownsBrowser,
    isolated: metadata.ownerType !== 'main',
    debugPort: browserConnection.debugPort,
    profileDir: browserConnection.profileDir,
    profileKind: browserConnection.profileKind,
    browserTarget: browserConnection.browserTarget,
    lastSnapshot: '',
    lastSnapshotAt: 0,
    lastPageUrl: '',
    lastPageTitle: '',
    consoleEntries: [],
    injectedStaticContext: {},
    createdAt: Date.now(),
  };
  sessions.set(sessionId, session);
  for (const trackedPage of context.pages()) attachBrowserConsoleCollector(session, trackedPage);
  console.log(`[Browser] Session created for ${sessionId}`);
  if (!restoredPage && persistedRecord && isRestorableBrowserUrl(persistedRecord.url)) {
    try {
      await page.goto(persistedRecord.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(350).catch(() => {});
      rememberPageMetadata(session, {
        url: persistedRecord.url,
        title: String(await page.title().catch(() => persistedRecord.title) || persistedRecord.title || '').trim(),
      });
      console.log(`[Browser] Restored session "${sessionId}" to ${persistedRecord.url}`);
    } catch (err: any) {
      console.warn(`[Browser] Could not restore session "${sessionId}" to ${persistedRecord.url}: ${String(err?.message || err)}`);
    }
  }
  await syncPageMetadata(session).catch(() => {});
  persistBrowserSessionRecord(session);

  // Auto-handle OAuth popups (e.g. "Continue as <name>" Google sign-in dialog).
  // These appear as new pages in the context and are invisible to the DOM snapshot.
  // We click the primary confirm button automatically so the agent doesn't get stuck.
  context.on('page', async (popup: any) => {
    try {
      attachBrowserConsoleCollector(session, popup);
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      const popupUrl = popup.url();
      console.log(`[Browser] Popup opened: ${popupUrl}`);
      // Google OAuth confirm page: click the blue continue/confirm button
      const confirmSelectors = [
        'button[id="submit_approve_access"]',  // Google OAuth approve
        'button:has-text("Continue")',
        'button:has-text("Allow")',
        'button:has-text("Confirm")',
        'button:has-text("Accept")',
        '#submit_approve_access',
      ];
      for (const sel of confirmSelectors) {
        try {
          const btn = popup.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click();
            console.log(`[Browser] Auto-clicked popup confirm: ${sel}`);
            break;
          }
        } catch { /* try next selector */ }
      }
    } catch (err: any) {
      console.warn(`[Browser] Popup handler error: ${err.message}`);
    }
  });

  markBrowserPerformance(onPerformanceStage, 'session_create_done', {
    durationMs: Math.max(0, Date.now() - startedAt),
    transport: session.transport || 'cdp',
  });
  return session;
}

export async function replaceDetachedBrowserSession(parentSessionId: string, suffix: string): Promise<{ sessionId: string; session: BrowserSession }> {
  const parentResolved = resolveSessionId(parentSessionId);
  const parent = await getOrCreateSession(parentResolved);
  const detachedSessionId = `${parentResolved}::${String(suffix || 'detached').trim() || 'detached'}`;
  const existing = sessions.get(detachedSessionId);
  if (existing) {
    try { await stopBrowserLiveStream(detachedSessionId, 'Detached browser session reset.'); } catch {}
    clearBrowserSessionEphemeralState(detachedSessionId, existing);
    try { await existing.page.close(); } catch {}
    sessions.delete(detachedSessionId);
    clearBrowserInteractionState(detachedSessionId);
    clearBrowserTeachSessionSnapshot(detachedSessionId);
  }
  const page = await parent.context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
  const detached: BrowserSession = {
    sessionId: detachedSessionId,
    browser: parent.browser,
    context: parent.context,
    page,
    ownsBrowser: false,
    isolated: parent.isolated === true,
    debugPort: parent.debugPort,
    profileDir: parent.profileDir,
    profileKind: parent.profileKind,
    browserTarget: parent.browserTarget,
    lastSnapshot: '',
    lastSnapshotAt: 0,
    lastPageUrl: '',
    lastPageTitle: '',
    consoleEntries: [],
    injectedStaticContext: {},
    createdAt: Date.now(),
  };
  sessions.set(detachedSessionId, detached);
  attachBrowserConsoleCollector(detached, page);
  return { sessionId: detachedSessionId, session: detached };
}
