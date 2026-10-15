
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

import { getConfig } from '../../config/config.js';
import { getActiveWorkspace } from '../../tools/workspace-context.js';

import { getResourceStore, redactResourceText } from '../resources/resource-store';

import { getBrowserSessionMetadata } from './sessions.js';


export function recordBrowserHistoryResource(sessionId: string, url: string, title?: string, metadata?: Record<string, unknown>): void {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl || /^(?:about:blank|data:|chrome:|devtools:)/i.test(normalizedUrl)) return;
  try {
    const sessionMetadata = getBrowserSessionMetadata(sessionId);
    const workspacePath = sessionMetadata.workspacePath || getActiveWorkspace(getConfig().getWorkspacePath());
    getResourceStore(workspacePath).recordBrowserVisit({
      url: normalizedUrl,
      title,
      browserSessionId: sessionId,
      metadata,
    });
  } catch (error: any) {
    console.warn('[Resources] Browser history registration skipped:', redactResourceText(error?.message || error));
  }
}
