
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

import { resolveSessionId, resolveBrowserLocator } from './extraction.js';
import { browserLiveSelectionTrackers, sessions } from './state.js';


export async function readBrowserLiveSelectionBounds(
  sessionId: string,
): Promise<null | { fingerprint: string; bounds: { x: number; y: number; width: number; height: number } }> {
  const resolved = resolveSessionId(sessionId);
  const tracker = browserLiveSelectionTrackers.get(resolved);
  if (!tracker) return null;
  const session = sessions.get(resolved);
  if (!session) return null;
  try {
    const locator = await resolveBrowserLocator(session.page, tracker.pack);
    if (!locator) return null;
    const box = await locator.boundingBox().catch(() => null);
    if (!box) return null;
    return {
      fingerprint: tracker.fingerprint,
      bounds: {
        x: Number(box.x) || 0,
        y: Number(box.y) || 0,
        width: Number(box.width) || 0,
        height: Number(box.height) || 0,
      },
    };
  } catch {
    return null;
  }
}
