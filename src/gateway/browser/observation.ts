
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

import { formatShortcutsForUrl } from '../site-shortcuts';
import { formatNamedBrowserElementsForUrl } from '../browser-site-knowledge.js';

import { BrowserObserveMode, BrowserSession, PwPage } from './types.js';
import { resolveSessionId, stableHash } from './extraction.js';
import { sessions, browserInteractionStates } from './state.js';
import { resolveBrowserInteractionStateId, normalizeBrowserInteractionMode, formatBrowserInteractionContextBlock, persistBrowserSessionRecord } from './streaming.js';
import { boundedBrowserSnapshot } from './snapshot-format.js';
import { recordBrowserHistoryResource } from './history.js';
import { INTERACTIVE_SELECTOR } from './snapshot.js';


export const OBSERVE_MODE_ENUM: BrowserObserveMode[] = ['none', 'compact', 'delta', 'snapshot', 'screenshot'];

export const BROWSER_TOOL_DEFAULT_OBSERVE_MODE: Record<string, BrowserObserveMode> = {
  browser_wait: 'none',
  browser_get_page_text: 'none',
  browser_get_focused_item: 'none',
  // Cheap action tools default to the fast ack path. Callers can still request
  // compact/delta/snapshot/screenshot observation explicitly when they need refs
  // or visual confirmation after the action.
  browser_click: 'none',
  browser_fill: 'none',
  browser_upload_file: 'screenshot',
  browser_press_key: 'none',
  browser_key: 'none',
  browser_type: 'none',
  browser_drag: 'none',
  browser_click_and_download: 'none',
  browser_scroll_collect: 'none',
  browser_scroll: 'none',
  browser_open: 'screenshot',
  browser_vision_click: 'screenshot',
  browser_snapshot: 'snapshot',
  browser_snapshot_delta: 'none',
  browser_vision_screenshot: 'screenshot',
  browser_vision_type: 'none',
  browser_send_to_telegram: 'none',
  browser_run_js: 'screenshot',
};

export function normalizeBrowserObserveMode(mode: unknown): BrowserObserveMode | undefined {
  const value = String(mode || '').trim().toLowerCase();
  return value === 'none' || value === 'compact' || value === 'delta' || value === 'snapshot' || value === 'screenshot'
    ? value
    : undefined;
}

export function resolveBrowserObserveMode(toolName: string, observe?: unknown): BrowserObserveMode {
  return normalizeBrowserObserveMode(observe)
    || BROWSER_TOOL_DEFAULT_OBSERVE_MODE[String(toolName || '').trim()]
    || 'none';
}

export function browserKnowledgeHostFromUrl(url: string): string {
  try {
    return String(new URL(String(url || '').startsWith('http') ? String(url || '') : `https://${String(url || '')}`).hostname || '')
      .replace(/^www\./i, '')
      .toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

export function attachShortcutsContext(
  output: string,
  url: string,
  sessionId?: string,
  options?: { forceStatic?: boolean },
): string {
  const text = String(output || '');
  const extras: string[] = [];
  const resolvedSessionId = sessionId ? resolveSessionId(sessionId) : '';
  const session = resolvedSessionId ? sessions.get(resolvedSessionId) || null : null;
  const interactionState = sessionId
    ? browserInteractionStates.get(resolveBrowserInteractionStateId(sessionId))
    : null;
  const interactionMode = normalizeBrowserInteractionMode(interactionState?.mode);
  const forceStaticRefresh = !!options?.forceStatic
    || /\berror\b|\bfailed\b|\bnot found\b|\bcould not\b|\brecover(?:y|ing)?\b/i.test(text);
  const forceRefreshCooldownMs = 15_000;
  const contextHost = (() => {
    try {
      const parsed = new URL(String(url || '').startsWith('http') ? String(url || '') : `https://${String(url || '')}`);
      return parsed.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return String(url || '').trim().toLowerCase();
    }
  })();
  const shouldAppendStaticContext = (
    kind: 'shortcuts' | 'knowledge' | 'control',
    key: string,
    block: string,
  ): boolean => {
    if (!block) return false;
    if (!session) return true;
    if (!session.injectedStaticContext) session.injectedStaticContext = {};
    const entry = session.injectedStaticContext?.[kind];
    const hash = stableHash(block);
    const changed = !entry || entry.key !== key || entry.hash !== hash;
    const withinForceCooldown = !!entry
      && entry.key === key
      && entry.hash === hash
      && (Date.now() - Number(entry.shownAt || 0)) < forceRefreshCooldownMs;
    if (!changed && (!forceStaticRefresh || withinForceCooldown)) return false;
    session.injectedStaticContext[kind] = { key, hash, shownAt: Date.now() };
    return true;
  };
  if (!text.includes('SITE SHORTCUTS FOR')) {
    const shortcutsBlock = formatShortcutsForUrl(url);
    if (shouldAppendStaticContext('shortcuts', `${contextHost}|mode=${interactionMode}`, shortcutsBlock)) {
      extras.push(shortcutsBlock);
    }
  }
  if (!text.includes('BROWSER MEMORY FOR')) {
    const knowledgeBlock = formatNamedBrowserElementsForUrl(url);
    if (shouldAppendStaticContext('knowledge', contextHost, knowledgeBlock)) {
      extras.push(knowledgeBlock);
    }
  }
  if (sessionId && !text.includes('[BROWSER CONTROL]')) {
    const interactionBlock = formatBrowserInteractionContextBlock(sessionId);
    if (shouldAppendStaticContext('control', `${contextHost}|mode=${interactionMode}`, interactionBlock)) {
      extras.push(interactionBlock);
    }
  }
  if (!extras.length) return text;
  return text ? `${text}\n\n${extras.join('\n\n')}` : extras.join('\n\n');
}

export function rememberSnapshot(session: BrowserSession, snapshot: string): void {
  const previousUrl = session.lastPageUrl || '';
  const previousTitle = session.lastPageTitle || '';
  session.lastSnapshot = boundedBrowserSnapshot(snapshot);
  session.lastSnapshotAt = Date.now();
  const titleMatch = session.lastSnapshot.match(/^Page:\s*(.+)$/m);
  const urlMatch = session.lastSnapshot.match(/^URL:\s*(.+)$/m);
  if (titleMatch?.[1]) session.lastPageTitle = titleMatch[1].trim();
  if (urlMatch?.[1]) session.lastPageUrl = urlMatch[1].trim();
  if (session.lastPageUrl !== previousUrl || session.lastPageTitle !== previousTitle) {
    persistBrowserSessionRecord(session);
  }
}

export async function syncPageMetadata(session: BrowserSession): Promise<{
  url: string;
  title: string;
  urlChanged: boolean;
  titleChanged: boolean;
}> {
  const previousUrl = session.lastPageUrl || '';
  const previousTitle = session.lastPageTitle || '';
  const url = String(session.page.url?.() || '').trim();
  let title = '';
  try {
    title = String(await session.page.title()).trim();
  } catch {
    title = previousTitle;
  }
  const urlChanged = !!url && url !== previousUrl;
  const titleChanged = !!title && title !== previousTitle;
  if (url) session.lastPageUrl = url;
  if (title) session.lastPageTitle = title;
  if (session.lastPageUrl !== previousUrl || session.lastPageTitle !== previousTitle) {
    persistBrowserSessionRecord(session);
  }
  if (urlChanged || (!previousUrl && session.lastPageUrl)) {
    recordBrowserHistoryResource(session.sessionId, session.lastPageUrl, session.lastPageTitle, { source: 'browser_metadata_sync' });
  }
  return {
    url: session.lastPageUrl,
    title: session.lastPageTitle,
    urlChanged,
    titleChanged,
  };
}

export function rememberPageMetadata(session: BrowserSession, state: { url?: string; title?: string }): void {
  const previousUrl = session.lastPageUrl || '';
  const previousTitle = session.lastPageTitle || '';
  const url = String(state?.url || '').trim();
  const title = String(state?.title || '').trim();
  if (url) session.lastPageUrl = url;
  if (title) session.lastPageTitle = title;
  if (session.lastPageUrl !== previousUrl || session.lastPageTitle !== previousTitle) {
    persistBrowserSessionRecord(session);
  }
  if (url && url !== previousUrl) {
    recordBrowserHistoryResource(session.sessionId, session.lastPageUrl, session.lastPageTitle, { source: 'browser_metadata' });
  }
}

export function truncateCompactValue(value: string, max: number = 90): string {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean;
}

export type BrowserCompactState = {
  url: string;
  title: string;
  elementCount: number;
  focusSignature: string;
  focusSummary: string;
};

export async function captureCompactBrowserState(page: PwPage): Promise<BrowserCompactState> {
  const url = String(page.url?.() || '').trim();
  let title = '';
  try {
    title = String(await page.title()).trim();
  } catch {}
  const compactData = await page.evaluate((selector: string) => {
    const doc = (globalThis as any).document;
    const openModal = (
      doc.querySelector('[role="dialog"][aria-modal="true"]')
      || doc.querySelector('[role="dialog"]:not([aria-hidden="true"])')
      || doc.querySelector('[data-testid="sheetDialog"], [data-testid="confirmationSheetDialog"], [data-testid="keyboardShortcutModal"]')
      || doc.querySelector('dialog[open]')
      || doc.querySelector('[data-testid="Dropdown"]')
      || doc.querySelector('[role="menu"]')
      || null
    );
    const searchRoot = openModal || doc;
    const seen = new Set<any>();
    const nodes: any[] = [];
    for (const el of Array.from(searchRoot.querySelectorAll(selector))) {
      if (!seen.has(el)) {
        seen.add(el);
        nodes.push(el);
      }
    }
    const isVisible = (el: any) => {
      const rect = typeof el?.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
      const hiddenByBox =
        (el?.offsetWidth === 0 && el?.offsetHeight === 0)
        || (rect ? (rect.width === 0 && rect.height === 0) : false);
      const style = typeof (globalThis as any).getComputedStyle === 'function'
        ? (globalThis as any).getComputedStyle(el)
        : null;
      const hiddenByStyle =
        !!style
        && (style.display === 'none' || style.visibility === 'hidden');
      return !(hiddenByBox || hiddenByStyle);
    };
    let elementCount = 0;
    for (const el of nodes) {
      const tag = String(el?.tagName || '').toLowerCase();
      const role = String(el?.getAttribute?.('role') || '').toLowerCase();
      const isContentEditable = el?.getAttribute?.('contenteditable') === 'true';
      const inputLikeTag = ['input', 'textarea', 'select'].includes(tag) || isContentEditable;
      const name = String(
        el?.getAttribute?.('aria-label')
        || (el?.innerText || '').trim()
        || el?.getAttribute?.('placeholder')
        || el?.getAttribute?.('data-testid')
        || ''
      ).trim();
      if (!name && !inputLikeTag) continue;
      if (!isVisible(el)) continue;
      elementCount += 1;
    }

    const describeTweet = (tweetEl: any) => {
      if (!tweetEl) return null;
      const tweetText = String((tweetEl.querySelector?.('[data-testid="tweetText"]') as any)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      const author = String((tweetEl.querySelector?.('[data-testid="User-Name"]') as any)?.innerText || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
      const link = String((tweetEl.querySelector?.('a[href*="/status/"]') as any)?.href || '').trim();
      const idMatch = link.match(/\/status\/(\d+)/);
      const allTweets = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'));
      const idx = allTweets.indexOf(tweetEl);
      const position = idx >= 0 ? idx + 1 : 0;
      const totalVisible = allTweets.length;
      const pieces = [`tweet #${position || '?'}/${totalVisible || '?'}`];
      if (author) pieces.push(author);
      if (tweetText) pieces.push(`"${tweetText}"`);
      return {
        focusSignature: `tweet:${idMatch?.[1] || `${position}:${author}:${tweetText.slice(0, 40)}`}`,
        focusSummary: pieces.join(' '),
      };
    };

    const focused = doc.activeElement;
    if (!focused || focused === doc.body) {
      const highlighted = doc.querySelector(
        'article[data-testid="tweet"][tabindex="0"], article[data-testid="tweet"]:focus-within'
      );
      const tweet = describeTweet(highlighted);
      if (tweet) return { elementCount, ...tweet };
      return {
        elementCount,
        focusSignature: 'none',
        focusSummary: 'none',
      };
    }

    let article: any = focused;
    while (article && article.tagName?.toLowerCase() !== 'article') {
      article = article.parentElement;
    }
    if (article && article.getAttribute?.('data-testid') === 'tweet') {
      const tweet = describeTweet(article);
      if (tweet) return { elementCount, ...tweet };
    }

    const tag = String(focused.tagName || '').toLowerCase() || 'element';
    const role = String(focused.getAttribute?.('role') || '').toLowerCase() || tag;
    const ariaLabel = String(focused.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const placeholder = String(focused.getAttribute?.('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const text = String(focused.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const testId = String(focused.getAttribute?.('data-testid') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const label = ariaLabel || text || placeholder || testId || tag;
    return {
      elementCount,
      focusSignature: `element:${tag}:${role}:${ariaLabel}:${placeholder}:${testId}:${text.slice(0, 40)}`,
      focusSummary: `${tag}${role && role !== tag ? ` role=${role}` : ''} "${label}"`,
    };
  }, INTERACTIVE_SELECTOR).catch(() => ({
    elementCount: 0,
    focusSignature: 'unknown',
    focusSummary: 'unknown',
  }));
  return {
    url,
    title,
    elementCount: Number(compactData?.elementCount || 0),
    focusSignature: String(compactData?.focusSignature || 'unknown'),
    focusSummary: String(compactData?.focusSummary || 'unknown'),
  };
}

export async function buildCompactBrowserObservation(
  session: BrowserSession,
  action: string,
  before: BrowserCompactState,
): Promise<string> {
  const after = await captureCompactBrowserState(session.page);
  rememberPageMetadata(session, after);
  const urlChanged = before.url !== after.url;
  const titleChanged = before.title !== after.title;
  const focusChanged = before.focusSignature !== after.focusSignature;
  const lines = [
    action,
    urlChanged
      ? `URL changed: ${truncateCompactValue(before.url) || '(blank)'} -> ${truncateCompactValue(after.url) || '(blank)'}.`
      : 'URL unchanged.',
    titleChanged
      ? `Title changed: ${truncateCompactValue(before.title) || '(blank)'} -> ${truncateCompactValue(after.title) || '(blank)'}.`
      : 'Title unchanged.',
    `Focused element changed: ${focusChanged ? 'yes' : 'no'}.`,
    `DOM count: ${before.elementCount} -> ${after.elementCount}.`,
  ];
  const focusSummary = truncateCompactValue(after.focusSummary, 120);
  if (focusSummary && focusSummary !== 'unknown') {
    lines.push(`Focused element: ${focusSummary}.`);
  }
  return lines.join('\n');
}

export async function buildMinimalBrowserAck(
  session: BrowserSession,
  base: string,
  options?: { syncMetadata?: boolean },
): Promise<string> {
  if (options?.syncMetadata === false) return base;
  const meta = await syncPageMetadata(session);
  const extras: string[] = [];
  if (meta.urlChanged && meta.url) extras.push(`URL: ${meta.url}`);
  if (meta.titleChanged && meta.title) extras.push(`Title: ${meta.title}`);
  return extras.length ? `${base}\n${extras.join('\n')}` : base;
}

export function shouldReturnSnapshot(mode: BrowserObserveMode): boolean {
  return mode === 'snapshot';
}

export function shouldUseCompactObservation(mode: BrowserObserveMode): boolean {
  return mode === 'compact';
}

export function shouldUseFastBrowserAck(mode: BrowserObserveMode): boolean {
  return mode === 'none';
}
