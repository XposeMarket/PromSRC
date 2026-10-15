
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

import { UserChromePage } from '../user-chrome-transport.js';
import { getUserChromeRelay } from '../user-chrome-relay.js';

import { BrowserSession } from './types.js';
import { userChromeRelayUnsubscribers, sessions, _networkInterceptLog } from './state.js';
import { releaseUserChromeTabLocks, pushBrowserConsoleEntry } from './sessions.js';
import { clearBrowserSessionEphemeralState } from './selection.js';
import { MAX_NETWORK_INTERCEPT_ENTRIES } from './snapshot-format.js';


export function attachUserChromeRelayObservers(session: BrowserSession): void {
  if (session.transport !== 'extension' || userChromeRelayUnsubscribers.has(session.sessionId)) return;
  const unsubscribe = getUserChromeRelay().onEvent((event) => {
    if (Number(event?.tabId) !== (session.page as UserChromePage).tabId()) return;
    if (event?.event === 'tab_removed' || event?.event === 'debugger_detach') {
      releaseUserChromeTabLocks(session.sessionId);
      clearBrowserSessionEphemeralState(session.sessionId, session);
      sessions.delete(session.sessionId);
      return;
    }
    if (event?.event !== 'cdp') return;
    const method = String(event.method || '');
    const params = event.params || {};
    if (method === 'Runtime.consoleAPICalled' || method === 'Runtime.exceptionThrown') {
      const args = Array.isArray(params.args) ? params.args : [];
      const message = method === 'Runtime.exceptionThrown'
        ? String(params.exceptionDetails?.text || params.exceptionDetails?.exception?.description || 'page exception')
        : args.map((arg: any) => String(arg?.value ?? arg?.description ?? arg?.type ?? '')).join(' ');
      pushBrowserConsoleEntry(session, { source: 'playwright_console', level: String(params.type || 'error'), message, ts: Date.now(), url: session.page.url() });
    } else if (method === 'Network.responseReceived') {
      const response = params.response || {};
      const entries = _networkInterceptLog.get(session.sessionId) || [];
      entries.push({ url: String(response.url || ''), method: String(params.type || 'GET'), status: Number(response.status || 0), contentType: String(response.mimeType || ''), ts: Date.now() });
      if (entries.length > MAX_NETWORK_INTERCEPT_ENTRIES) entries.splice(0, entries.length - MAX_NETWORK_INTERCEPT_ENTRIES);
      _networkInterceptLog.set(session.sessionId, entries);
    }
  });
  userChromeRelayUnsubscribers.set(session.sessionId, unsubscribe);
}
