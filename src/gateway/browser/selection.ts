
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

import { BrowserSession, InHouseBrowserSession } from './types.js';
import { resolveSessionId, BrowserSelectorPack, buildBrowserSelectorPack } from './extraction.js';
import { sessions, _networkInterceptHandlers, _networkInterceptLog, _lastBrowserScreenshot, _lastBrowserDownload, _snapshotHashCache, browserLiveSelectionTrackers, browserTeachSessions, browserSessionInitInFlight } from './state.js';
import { clearBrowserInteractionState } from './streaming.js';
import { releaseUserChromeTabLocks } from './sessions.js';
import { normalizeInHouseTabs } from './inhouse.js';

/**
 * Drop state whose lifetime should match the browser session rather than the
 * chat session. In-house sessions do not have a Playwright BrowserSession
 * object, so callers may omit the second argument.
 */
export function clearBrowserSessionEphemeralState(sessionId: string, session?: BrowserSession): void {
  const resolved = resolveSessionId(sessionId);
  const activeSession = session || sessions.get(resolved);
  const networkHandler = _networkInterceptHandlers.get(resolved);
  if (networkHandler && activeSession) {
    try { activeSession.context.off('response', networkHandler); } catch {}
  }
  _networkInterceptHandlers.delete(resolved);
  _networkInterceptLog.delete(resolved);
  _lastBrowserScreenshot.delete(resolved);
  _lastBrowserDownload.delete(resolved);
  _snapshotHashCache.delete(resolved);
  browserLiveSelectionTrackers.delete(resolved);
  browserTeachSessions.delete(resolved);
  browserSessionInitInFlight.delete(resolved);
  clearBrowserInteractionState(resolved);
  releaseUserChromeTabLocks(resolved);
}

export function setBrowserLiveSelectionTracker(sessionId: string, pack: BrowserSelectorPack | null): void {
  const resolved = resolveSessionId(sessionId);
  if (!pack) { browserLiveSelectionTrackers.delete(resolved); return; }
  const fingerprint = `${pack.testid}|${pack.attrSelector}|${pack.role}|${pack.name}|${pack.css}|${pack.xpath}`;
  browserLiveSelectionTrackers.set(resolved, { pack, fingerprint });
}

export function clearBrowserLiveSelectionTracker(sessionId: string): void {
  setBrowserLiveSelectionTracker(sessionId, null);
}

export function setBrowserLiveSelectionFromPack(
  sessionId: string,
  pack: Partial<BrowserSelectorPack> | null,
): BrowserSelectorPack | null {
  if (!pack) { clearBrowserLiveSelectionTracker(sessionId); return null; }
  const normalized: BrowserSelectorPack = {
    css: String(pack.css || '').trim(),
    xpath: String(pack.xpath || '').trim(),
    testid: String(pack.testid || '').trim(),
    role: String(pack.role || '').trim().toLowerCase(),
    name: String(pack.name || '').trim(),
    text: String(pack.text || '').trim(),
    attrSelector: String(pack.attrSelector || '').trim(),
  };
  if (!normalized.css && !normalized.xpath && !normalized.testid && !normalized.attrSelector && !normalized.role) {
    clearBrowserLiveSelectionTracker(sessionId);
    return null;
  }
  setBrowserLiveSelectionTracker(sessionId, normalized);
  return normalized;
}

export async function browserGetInteractableMap(
  sessionId: string,
  options: { limit?: number; includeStatic?: boolean } = {},
): Promise<null | {
  sessionId: string;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
  devicePixelRatio: number;
  items: Array<{
    selector: string;
    pack: BrowserSelectorPack;
    tagName: string;
    role: string;
    text: string;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  capturedAt: number;
}> {
  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  if (!session) return null;
  const limit = Math.min(Math.max(Number(options.limit) || 240, 16), 600);
  const includeStatic = options.includeStatic === true;
  try {
    const payload = await session.page.evaluate((cfg: { limit: number; includeStatic: boolean }) => {
      const doc = (globalThis as any).document as any;
      const win: any = (globalThis as any);
      const viewportWidth = Math.round(Number(win.innerWidth || 0));
      const viewportHeight = Math.round(Number(win.innerHeight || 0));
      const dpr = Number(win.devicePixelRatio || 1) || 1;
      const scrollX = Math.round(Number(win.scrollX || win.pageXOffset || 0));
      const scrollY = Math.round(Number(win.scrollY || win.pageYOffset || 0));
      const interactiveTags = new Set(['a', 'button', 'input', 'textarea', 'select', 'option', 'label', 'summary', 'details']);
      const interactiveRoles = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'slider']);
      const candidates: any[] = Array.from(doc.querySelectorAll('*'));
      const out: any[] = [];
      const dedupe = new Set<string>();
      const readText = (node: any) => String((node?.innerText || node?.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 80);
      const readClassList = (node: any) => Array.from(node?.classList || []).map((v: any) => String(v || '').trim()).filter(Boolean).slice(0, 4);
      const readSiblingIndex = (node: any) => {
        const tagName = String(node?.tagName || '').toLowerCase();
        if (!node?.parentElement || !tagName) return 0;
        const siblings = Array.from(node.parentElement.children || []).filter((c: any) => String(c?.tagName || '').toLowerCase() === tagName);
        const idx = siblings.indexOf(node);
        return idx >= 0 ? idx + 1 : 0;
      };
      const buildXPath = (node: any) => {
        if (!node || node.nodeType !== 1) return '';
        const parts: string[] = [];
        let cursor = node;
        while (cursor && cursor.nodeType === 1 && parts.length < 12) {
          const tag = String(cursor.tagName || '').toLowerCase();
          if (!tag) break;
          if (cursor.id) { parts.unshift(`${tag}[@id="${cursor.id}"]`); break; }
          let nth = 1;
          let sib = cursor.previousElementSibling;
          while (sib) {
            if (String(sib.tagName || '').toLowerCase() === tag) nth += 1;
            sib = sib.previousElementSibling;
          }
          parts.unshift(`${tag}[${nth}]`);
          cursor = cursor.parentElement;
          if (!cursor || String(cursor.tagName || '').toLowerCase() === 'html') break;
        }
        return parts.length ? `//${parts.join('/')}` : '';
      };
      const buildSelectorParts = (node: any) => {
        const tagName = String(node?.tagName || '').toLowerCase();
        const id = String(node?.id || '').trim();
        const classList = readClassList(node);
        const siblingIndex = readSiblingIndex(node);
        const parentChain: any[] = [];
        let parentCursor = node.parentElement;
        while (parentCursor && parentChain.length < 4) {
          const pTag = String(parentCursor.tagName || '').toLowerCase();
          if (!pTag || pTag === 'body' || pTag === 'html') break;
          parentChain.unshift({
            tagName: pTag,
            id: String(parentCursor.id || '').trim(),
            classList: readClassList(parentCursor),
            siblingIndex: readSiblingIndex(parentCursor),
          });
          if (parentCursor.id) break;
          parentCursor = parentCursor.parentElement;
        }
        return { tagName, id, classList, siblingIndex, parentChain };
      };
      for (const node of candidates) {
        if (out.length >= cfg.limit) break;
        const tag = String(node?.tagName || '').toLowerCase();
        if (!tag) continue;
        const role = String(node?.getAttribute?.('role') || '').trim().toLowerCase();
        const isInteractive = interactiveTags.has(tag) || interactiveRoles.has(role) || node?.isContentEditable === true || (tag === 'div' && node?.onclick);
        if (!isInteractive && !cfg.includeStatic) continue;
        const rect = node.getBoundingClientRect();
        const w = Math.round(Number(rect?.width || 0));
        const h = Math.round(Number(rect?.height || 0));
        if (w < 6 || h < 6) continue;
        if (rect.bottom < 0 || rect.right < 0 || rect.left > viewportWidth || rect.top > viewportHeight) continue;
        const style = win.getComputedStyle ? win.getComputedStyle(node) : null;
        if (style && (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || '1') < 0.05)) continue;
        const parts = buildSelectorParts(node);
        const fingerprint = `${tag}|${parts.id}|${(parts.classList || []).join('.')}|${Math.round(rect.left)},${Math.round(rect.top)},${w},${h}`;
        if (dedupe.has(fingerprint)) continue;
        dedupe.add(fingerprint);
        const testid = String(node?.getAttribute?.('data-testid') || '').trim();
        const ariaLabel = String(node?.getAttribute?.('aria-label') || '').trim();
        const placeholder = String(node?.getAttribute?.('placeholder') || '').trim();
        const title = String(node?.getAttribute?.('title') || '').trim();
        const name = String(node?.getAttribute?.('name') || '').trim();
        const text = readText(node);
        out.push({
          parts,
          xpath: buildXPath(node),
          testid,
          role,
          ariaLabel,
          placeholder,
          title,
          name,
          text,
          tagName: tag,
          bounds: {
            x: Number(rect.left) || 0,
            y: Number(rect.top) || 0,
            width: Number(rect.width) || 0,
            height: Number(rect.height) || 0,
          },
        });
      }
      return {
        viewport: { width: viewportWidth, height: viewportHeight },
        scroll: { x: scrollX, y: scrollY },
        devicePixelRatio: dpr,
        raw: out,
      };
    }, { limit, includeStatic });
    if (!payload) return null;
    const items = (Array.isArray(payload.raw) ? payload.raw : []).map((entry: any) => {
      const pack = buildBrowserSelectorPack({
        ...entry.parts,
        xpath: entry.xpath,
        testid: entry.testid,
        role: entry.role,
        ariaLabel: entry.ariaLabel,
        name: entry.name,
        placeholder: entry.placeholder,
        title: entry.title,
        text: entry.text,
      });
      return {
        selector: pack.css,
        pack,
        tagName: String(entry.tagName || ''),
        role: String(entry.role || ''),
        text: String(entry.text || ''),
        bounds: entry.bounds,
      };
    });
    return {
      sessionId: resolved,
      viewport: payload.viewport,
      scroll: payload.scroll,
      devicePixelRatio: payload.devicePixelRatio,
      items,
      capturedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export function formatInHouseTabs(session: InHouseBrowserSession): string {
  const tabs = normalizeInHouseTabs(session.tabs);
  if (!tabs.length) return 'No tabs are open in the Prometheus in-house browser.';
  return [
    `Browser tabs for Prometheus in-house browser (${tabs.length}):`,
    ...tabs.map((tab) => `${tab.id === session.activeTabId || tab.active ? '*' : ' '} [${tab.index}] ${tab.title || '(untitled)'} ${tab.url || ''}`),
  ].join('\n');
}
