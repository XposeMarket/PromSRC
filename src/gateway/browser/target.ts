
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

import { BrowserProfileKind } from './types.js';
import { resolveSessionId } from './extraction.js';
import { mainBrowserTargetPreferences } from './state.js';
import { isInHouseBrowserAvailable } from './inhouse.js';


export function getMainBrowserTarget(sessionId: string): BrowserProfileKind {
  const resolved = resolveSessionId(sessionId);
  // Electron desktop sessions use the embedded browser unless the user
  // explicitly selects a secondary Chrome lane. Web deployments retain the
  // regular Prometheus lane because there is no native RPC surface there.
  return mainBrowserTargetPreferences.get(resolved) || (isInHouseBrowserAvailable() ? 'inhouse' : 'prometheus');
}
