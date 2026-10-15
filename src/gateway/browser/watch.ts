
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

import { resolveSessionId } from './extraction.js';
import { recoverInHouseSessionMapping } from './inhouse-sessions.js';
import { getInHouseSession, callInHouseBrowser } from './inhouse.js';
import { browserSnapshotInHouse } from './inhouse-actions.js';
import { sessions } from './state.js';
import { takeSnapshot } from './snapshot.js';
import { attachShortcutsContext, rememberSnapshot } from './observation.js';

// --- browser_element_watch ----------------------------------------------------

/**
 * Wait until a DOM element appears, disappears, or contains specific text.
 * Uses Playwright's native waitForSelector for appear/disappear � efficient,
 * no polling overhead. Returns a fresh snapshot when condition is met.
 */
export async function browserElementWatch(
  sessionId: string,
  selector: string,
  waitFor: 'appear' | 'disappear' | 'text_contains',
  text?: string,
  timeoutMs = 15000,
): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) {
    if (!selector) return 'ERROR: selector is required.';
    if (waitFor === 'text_contains' && !text) return 'ERROR: text_contains requires a "text" parameter.';
    const safeTimeout = Math.min(Math.max(Number(timeoutMs) || 15000, 500), 120_000);
    const deadline = Date.now() + safeTimeout;
    const expectedText = String(text || '');
    const probe = `(() => {
      try {
        const selector = ${JSON.stringify(String(selector))};
        const el = document.querySelector(selector);
        const rect = el?.getBoundingClientRect?.();
        const style = el ? getComputedStyle(el) : null;
        const visible = !!el && !!rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden' && Number(style?.opacity || 1) !== 0;
        return { present: !!el, visible, text: String(el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 4000) };
      } catch (error) { return { error: String(error?.message || error) }; }
    })()`;
    try {
      while (Date.now() < deadline) {
        const state: any = await callInHouseBrowser('run-js', { sessionId: resolved, code: probe });
        if (state?.error) return `ERROR: browser_element_watch failed: ${state.error}`;
        const matched = waitFor === 'appear'
          ? state?.visible === true
          : waitFor === 'disappear'
            ? state?.visible !== true
            : state?.visible === true && String(state?.text || '').includes(expectedText);
        if (matched) {
          const snapshot = await browserSnapshotInHouse(resolved);
          if (snapshot.startsWith('ERROR')) return `ERROR: Element condition matched, but observation failed.\n${snapshot}`;
          const description = waitFor === 'appear'
            ? `Element "${selector}" appeared.`
            : waitFor === 'disappear'
              ? `Element "${selector}" disappeared.`
              : `Element "${selector}" contains text "${expectedText}".`;
          return `${description}\n\n${snapshot}`;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return waitFor === 'text_contains'
        ? `ERROR: Timed out after ${safeTimeout}ms waiting for "${selector}" to contain text "${expectedText}".`
        : `ERROR: Timed out after ${safeTimeout}ms waiting for element "${selector}" to ${waitFor}.`;
    } catch (err: any) {
      return `ERROR: browser_element_watch failed: ${err.message}`;
    }
  }
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';
  if (!selector) return 'ERROR: selector is required.';
  const safeTimeout = Math.min(Math.max(Number(timeoutMs) || 15000, 500), 120_000);

  const freshSnapshot = async () => {
    const snap = await takeSnapshot(session.page);
    session.lastSnapshot = snap;
    session.lastSnapshotAt = Date.now();
    return attachShortcutsContext(snap, session.page.url(), sessionId);
  };

  try {
    if (waitFor === 'appear') {
      await session.page.waitForSelector(selector, { state: 'visible', timeout: safeTimeout });
      return `Element "${selector}" appeared.\n\n${await freshSnapshot()}`;
    }
    if (waitFor === 'disappear') {
      await session.page.waitForSelector(selector, { state: 'hidden', timeout: safeTimeout });
      return `Element "${selector}" disappeared.\n\n${await freshSnapshot()}`;
    }
    if (waitFor === 'text_contains') {
      if (!text) return 'ERROR: text_contains requires a "text" parameter.';
      const deadline = Date.now() + safeTimeout;
      while (Date.now() < deadline) {
        try {
          const el = session.page.locator(selector).first();
          const elText = await el.innerText({ timeout: 1000 }).catch(() => '');
          if (elText.includes(text)) {
            return `Element "${selector}" contains text "${text}".\n\n${await freshSnapshot()}`;
          }
        } catch { /* element not present yet � keep polling */ }
        await session.page.waitForTimeout(500);
      }
      return `ERROR: Timed out after ${safeTimeout}ms waiting for "${selector}" to contain text "${text}".`;
    }
    return 'ERROR: waitFor must be "appear", "disappear", or "text_contains".';
  } catch (err: any) {
    return `ERROR: browser_element_watch failed: ${err.message}`;
  }
}

// --- browser_snapshot_delta ---------------------------------------------------

/**
 * Re-scan the page and return ONLY what changed since the last snapshot.
 * Compares element lines (each line containing @ref text) between snapshots.
 * Dramatically reduces token cost on heavy SPAs where most elements stay stable.
 * Falls back to full snapshot if no previous snapshot exists.
 */
export async function browserSnapshotDelta(sessionId: string): Promise<string> {
  const resolved = resolveSessionId(sessionId);
  const recovery = await recoverInHouseSessionMapping(resolved);
  if (recovery?.error) return recovery.error;
  if (getInHouseSession(resolved)) return browserSnapshotInHouse(resolved);
  const session = sessions.get(resolved);
  if (!session) return 'ERROR: No browser session. Use browser_open first.';

  const prevSnapshot = session.lastSnapshot;
  const newSnapshot = await takeSnapshot(session.page);
  rememberSnapshot(session, newSnapshot);
  const url = session.page.url();

  if (!prevSnapshot) {
    const elemCount = (newSnapshot.match(/@\d+/g) || []).length;
    return attachShortcutsContext(
      `No previous snapshot to diff � returning full snapshot (${elemCount} elements):\n\n${newSnapshot}`,
      url,
    );
  }

  // Compare element lines (lines containing @ref numbers)
  const toElemSet = (snap: string) => new Set(snap.split('\n').filter(l => l.includes('@')));
  const prevSet = toElemSet(prevSnapshot);
  const newSet = toElemSet(newSnapshot);
  const added = [...newSet].filter(l => !prevSet.has(l));
  const removed = [...prevSet].filter(l => !newSet.has(l));

  // Check for page-level changes even if element lines are identical
  const prevTitle = (prevSnapshot.match(/^Page:\s*(.+)$/m) || [])[1] || '';
  const newTitle = (newSnapshot.match(/^Page:\s*(.+)$/m) || [])[1] || '';
  const prevUrl = (prevSnapshot.match(/^URL:\s*(.+)$/m) || [])[1] || '';
  const newUrl = (newSnapshot.match(/^URL:\s*(.+)$/m) || [])[1] || '';

  if (added.length === 0 && removed.length === 0 && prevTitle === newTitle && prevUrl === newUrl) {
    return attachShortcutsContext(
      `No DOM changes detected (${newSet.size} elements unchanged).`,
      url,
    );
  }

  const parts: string[] = [`DOM delta � +${added.length} added, -${removed.length} removed (${newSet.size} total)`];
  if (prevTitle !== newTitle) parts.push(`Page title: "${prevTitle}" ? "${newTitle}"`);
  if (prevUrl !== newUrl) parts.push(`URL: ${prevUrl} ? ${newUrl}`);
  if (added.length > 0) { parts.push('\n=== ADDED ==='); parts.push(...added.slice(0, 60)); }
  if (removed.length > 0) { parts.push('\n=== REMOVED ==='); parts.push(...removed.slice(0, 60)); }
  if (added.length > 60 || removed.length > 60) parts.push('\n�(truncated � use browser_snapshot for full view)');

  return attachShortcutsContext(parts.join('\n'), url, sessionId);
}
