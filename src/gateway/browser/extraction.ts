
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

import { normalizeBrowserSessionId } from '../browser-session-identity';
import { PwPage, BrowserFeedItem, BrowserPageType, BrowserSession, BrowserAdvisorPacket } from './types.js';
import { takeSnapshot } from './snapshot.js';

// Press a key (e.g. Enter, Tab)
export function normalizeBrowserKey(key: string): string {
  const aliases: Record<string, string> = {
    left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
    esc: 'Escape', del: 'Delete', cmd: 'Meta', command: 'Meta', return: 'Enter',
  };
  return String(key || '').split('+').map((part) => aliases[part.trim().toLowerCase()] || part.trim()).join('+');
}

export async function pressKey(page: PwPage, key: string, options?: { settleMs?: number }): Promise<void> {
  const settleMs = Math.max(0, Number(options?.settleMs ?? 1500) || 0);
  await page.keyboard.press(normalizeBrowserKey(key));
  // Allow page navigation / React state updates to settle
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}

export function parseSnapshotElementCount(snapshot: string): number {
  const m = String(snapshot || '').match(/Elements\s*\((\d+)\):/i);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

export function stableHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return `h${(hash >>> 0).toString(16)}`;
}

export function normalizeFeedItemText(item: BrowserFeedItem): string {
  return [
    item.id || '',
    item.author || '',
    item.handle || '',
    item.time || '',
    item.text || '',
    item.link || '',
    item.title || '',
    item.snippet || '',
    item.source || '',
  ].join('|');
}

export function dedupeFeedItems(items: BrowserFeedItem[]): BrowserFeedItem[] {
  const out: BrowserFeedItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.id
      ? `id:${item.id}`
      : item.link
        ? `link:${item.link}`
        : stableHash(normalizeFeedItemText(item).slice(0, 500));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function buildPacketHash(input: {
  url: string;
  pageType: BrowserPageType;
  snapshot: string;
  extractedFeed: BrowserFeedItem[];
  textBlocks: string[];
  pageText?: string;
}): string {
  const compact = [
    input.url,
    input.pageType,
    input.snapshot.slice(0, 1800),
    ...input.extractedFeed.slice(0, 40).map((i) => normalizeFeedItemText(i)),
    ...input.textBlocks.slice(0, 20),
    (input.pageText || '').slice(0, 800),
  ].join('\n');
  return stableHash(compact);
}

export async function extractStructuredFromPage(
  page: PwPage,
  maxItems: number,
): Promise<{
  pageType: BrowserPageType;
  extractedFeed: BrowserFeedItem[];
  textBlocks: string[];
  pageText: string;
  isGenerating: boolean;
}> {
  const extracted = await page.evaluate((max: number) => {
    const doc = (globalThis as any).document;
    const normalize = (v: any, maxLen: number = 400) =>
      String(v || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
    const toAbs = (href: string) => {
      try { return new URL(href, (globalThis as any).location.href).toString(); } catch { return String(href || '').trim(); }
    };
    const host = String((globalThis as any).location.hostname || '').toLowerCase();
    const url = String((globalThis as any).location.href || '').toLowerCase();
    const title = normalize((globalThis as any).document.title || '', 180);
    const out: { pageType: any; extractedFeed: any[]; textBlocks: string[]; pageText: string; isGenerating: boolean } = {
      pageType: 'generic',
      extractedFeed: [],
      textBlocks: [],
      pageText: '',
      isGenerating: false,
    };

    // -- Chat interface detection (ChatGPT, Claude, Gemini, etc.) ----------------
    const isChatInterface = /(^|\.)chatgpt\.com$/.test(host)
      || /(^|\.)claude\.ai$/.test(host)
      || /(^|\.)gemini\.google\.com$/.test(host)
      || /(^|\.)chat\.openai\.com$/.test(host)
      || /\/c\/[a-f0-9-]{8,}/.test(url);   // generic /c/<uuid> conversation URL pattern

    if (isChatInterface) {
      out.pageType = 'chat_interface';

      // Detect if the AI is still generating � look for stop/streaming indicators
      const bodyText = normalize(doc.body?.innerText || '', 200);
      const stopBtn = doc.querySelector(
        'button[aria-label*="Stop"], button[data-testid*="stop"], [aria-label*="Stop generating"], .stop-button',
      );
      const streamingIndicator = doc.querySelector(
        '[data-testid="streaming-indicator"], .result-streaming, [class*="streaming"], [class*="generating"]',
      );
      // Heuristic: page title "ChatGPT" (not yet renamed to conversation topic) + very few response nodes
      const stillOnDefaultTitle = /^chatgpt$/i.test(title.trim());
      out.isGenerating = !!(stopBtn || streamingIndicator);

      // Extract the last assistant message � ChatGPT uses [data-message-author-role="assistant"]
      // Claude.ai uses [data-is-streaming], Gemini uses .model-response-text
      const assistantMsgSelectors = [
        '[data-message-author-role="assistant"]',
        '[data-testid*="conversation-turn"]:last-of-type',
        '.agent-turn',
        '.model-response-text',
        '[class*="AssistantMessage"]',
        '[class*="response-text"]',
      ];
      let lastMsgText = '';
      for (const sel of assistantMsgSelectors) {
        const nodes = Array.from(doc.querySelectorAll(sel)) as any[];
        if (!nodes.length) continue;
        const last = nodes[nodes.length - 1];
        const txt = normalize(last?.innerText || last?.textContent || '', 3000);
        if (txt.length > 60) { lastMsgText = txt; break; }
      }

      // Fallback: grab all paragraph text from main content area
      if (!lastMsgText) {
        const mainArea = doc.querySelector('main, [role="main"], #__next > div:nth-child(2)');
        if (mainArea) lastMsgText = normalize(mainArea?.innerText || '', 3000);
      }

      out.pageText = lastMsgText;
      // Put a short excerpt in textBlocks so existing advisor prompts that read textBlocks also work
      if (lastMsgText) out.textBlocks = [lastMsgText.slice(0, 1200)];
      return out;
    }

    const isX = /(^|\.)x\.com$/.test(host) || /(^|\.)twitter\.com$/.test(host);
    const isSearch = /(search|results|q=)/.test(url) || /(google|bing|duckduckgo|brave|yahoo)\./.test(host);

    if (isX) {
      // Smarter X.com page type detection � not all x.com pages are feed pages.
      // Compose, settings, notifications, and other interactive pages should be 'generic'
      // so the browser advisor treats them as interaction targets, not feed collectors.
      const xPathname = String((globalThis as any).location?.pathname || '');
      const isXComposePage = /^\/(compose|intent)/.test(xPathname);
      const isXSettingsPage = xPathname.startsWith('/settings') || xPathname.startsWith('/i/');
      const isXNotifications = xPathname.startsWith('/notifications');
      const isXHomeFeed = xPathname === '/' || xPathname === '/home' || xPathname === '';
      const isXProfileOrThread = /^\/[a-z0-9_]+(\/(status\/\d+)?)?$/i.test(xPathname) && !isXComposePage && !isXSettingsPage && !isXNotifications;

      if (isXComposePage || isXSettingsPage || isXNotifications) {
        // Interactive page � treat as generic so advisor uses ref-based interaction mode
        out.pageType = 'generic';
        return out;
      } else if (isXHomeFeed || isXProfileOrThread) {
        // Home feed has a composer at the top � if the composer textarea is present
        // in the DOM, treat as generic so the scroll-before-act gate fires and forces
        // the model to interact with the composer rather than scrolling past it.
        const composerPresent = !!doc.querySelector(
          '[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea"], '
          + 'div[contenteditable="true"][aria-label], '
          + 'div[role="textbox"][data-testid]'
        );
        out.pageType = composerPresent ? 'generic' : 'x_feed';
      } else {
        // Unknown x.com path � fall back to generic (safer for interaction)
        out.pageType = 'generic';
        return out;
      }

      const seen = new Set<string>();
      const tweets = Array.from(doc.querySelectorAll('article[data-testid="tweet"]')) as any[];
      for (const tw of tweets) {
        const text = normalize(
          Array.from(tw.querySelectorAll('[data-testid="tweetText"]'))
            .map((n: any) => n.innerText || n.textContent || '')
            .join(' '),
          1800,
        );
        const statusLink = tw.querySelector('a[href*="/status/"]') as any;
        const link = statusLink ? toAbs(statusLink.getAttribute('href') || '') : '';
        const idMatch = link.match(/\/status\/(\d+)/);
        const tweetId = idMatch ? idMatch[1] : '';
        const userNameNode = tw.querySelector('[data-testid="User-Name"]') as any;
        const author = normalize(
          userNameNode?.querySelector('span')?.textContent
            || tw.querySelector('a[role="link"] span')?.textContent
            || '',
          120,
        );
        let handle = '';
        const spans = userNameNode ? Array.from(userNameNode.querySelectorAll('span')) : [];
        for (const sp of spans) {
          const val = normalize((sp as any).textContent || '', 80);
          if (/^@[a-z0-9_]{1,30}$/i.test(val)) { handle = val; break; }
        }
        if (!handle) {
          const m = normalize(tw.innerText || '', 500).match(/@[a-z0-9_]{1,30}/i);
          handle = m ? m[0] : '';
        }

        const time = normalize((tw.querySelector('time') as any)?.getAttribute('datetime') || '', 80);
        const replies = normalize((tw.querySelector('[data-testid="reply"]') as any)?.innerText || '', 30);
        const reposts = normalize((tw.querySelector('[data-testid="retweet"]') as any)?.innerText || '', 30);
        const likes = normalize((tw.querySelector('[data-testid="like"]') as any)?.innerText || '', 30);
        const views = normalize((tw.querySelector('[data-testid="viewCount"]') as any)?.innerText || '', 30);
        const imageUrls = Array.from(
          tw.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]')
        )
          .map((node: any) => normalize(node.currentSrc || node.src || node.getAttribute('src') || '', 1200))
          .filter(Boolean)
          .map((src: string) => toAbs(src));
        const uniqueImageUrls = Array.from(new Set(imageUrls));
        const videoNode = tw.querySelector('[data-testid="videoPlayer"] video, video') as any;
        const rawVideoSrc = normalize(videoNode?.currentSrc || videoNode?.src || '', 1200);
        const videoSrc = rawVideoSrc ? toAbs(rawVideoSrc) : '';  // Keep blob: URLs for downstream processing
        const videoPoster = normalize(
          videoNode?.getAttribute?.('poster')
            || (tw.querySelector('[data-testid="videoPlayer"] img') as any)?.currentSrc
            || (tw.querySelector('[data-testid="videoPlayer"] img') as any)?.src
            || '',
          1200,
        );
        const hasVideo = !!(tw.querySelector('[data-testid="videoPlayer"]') || tw.querySelector('video'));
        const media = [
          ...uniqueImageUrls.map((mediaUrl: string) => ({ type: 'image' as const, url: mediaUrl })),
          ...(hasVideo ? [{ type: 'video' as const, url: videoSrc || videoPoster || undefined, previewUrl: videoPoster || undefined }] : []),
        ];
        const hasImage = uniqueImageUrls.length > 0 || hasVideo;

        if (!text && !link) continue;
        const key = tweetId || link || `${handle}|${text.slice(0, 120)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        out.extractedFeed.push({
          id: tweetId || undefined,
          author: author || undefined,
          handle: handle || undefined,
          time: time || undefined,
          text: text || undefined,
          link: link || undefined,
          source: 'x',
          hasImage: hasImage || undefined,
          hasVideo: hasVideo || undefined,
          media: media.length ? media : undefined,
          metrics: {
            replies: replies || undefined,
            reposts: reposts || undefined,
            likes: likes || undefined,
            views: views || undefined,
          },
        });
        if (out.extractedFeed.length >= max) break;
      }
      return out;
    }

    if (isSearch) {
      out.pageType = 'search_results';
      const cards = Array.from(
        doc.querySelectorAll(
          'div.g, div[data-sokoban-container], li.b_algo, .result, .search-result, article, main section',
        ),
      ) as any[];
      const seen = new Set<string>();
      for (const card of cards) {
        const titleEl = card.querySelector('h3, h2');
        const linkEl = card.querySelector('a[href]');
        const snippetEl = card.querySelector('.VwiC3b, .IsZvec, p, span');
        const imageEl = card.querySelector('img[src], img[data-src], img[srcset]') as any;
        const publisherEl = card.querySelector('cite, [data-testid*="source"], [class*="source"], [class*="publisher"]') as any;
        const timeEl = card.querySelector('time, [datetime]') as any;
        const titleText = normalize(titleEl?.textContent || '', 220);
        const link = normalize(linkEl ? toAbs(linkEl.getAttribute('href') || '') : '', 500);
        const snippet = normalize(snippetEl?.textContent || '', 500);
        const srcset = normalize(imageEl?.getAttribute?.('srcset') || '', 2000);
        const srcsetUrl = srcset
          ? srcset.split(',').map((entry: string) => entry.trim().split(/\s+/)[0]).filter(Boolean).pop()
          : '';
        const imageUrl = normalize(
          imageEl ? toAbs(srcsetUrl || imageEl.currentSrc || imageEl.getAttribute('data-src') || imageEl.src || '') : '',
          1200,
        );
        const publisher = normalize(publisherEl?.textContent || '', 120);
        const publishedAt = normalize(timeEl?.getAttribute?.('datetime') || timeEl?.textContent || '', 100);
        if (!titleText && !snippet) continue;
        const key = link || `${titleText}|${snippet.slice(0, 120)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.extractedFeed.push({
          title: titleText || undefined,
          link: link || undefined,
          snippet: snippet || undefined,
          imageUrl: imageUrl || undefined,
          publisher: publisher || undefined,
          publishedAt: publishedAt || undefined,
          source: host,
        });
        if (out.extractedFeed.length >= max) break;
      }
      return out;
    }

    // Generic article-ish content for research pages.
    const paras = Array.from(doc.querySelectorAll('article p, main p, p')) as any[];
    const blocks: string[] = [];
    for (const p of paras) {
      const text = normalize(p.innerText || p.textContent || '', 700);
      if (text.length < 80) continue;
      blocks.push(text);
      if (blocks.length >= max) break;
    }
    out.textBlocks = blocks;
    out.pageText = blocks.slice(0, 6).join(' ');
    if (
      /article|news|blog|post|story/i.test(title)
      || /(news|blog|substack|medium)\./.test(host)
      || blocks.length >= 4
    ) {
      out.pageType = 'article';
    }
    return out;
  }, Math.max(4, Math.min(maxItems, 60)));

  return {
    pageType: extracted.pageType,
    extractedFeed: dedupeFeedItems((extracted.extractedFeed || []) as BrowserFeedItem[]).slice(0, maxItems),
    textBlocks: (Array.isArray(extracted.textBlocks) ? extracted.textBlocks : []).map((s: any) => String(s || '')).filter(Boolean).slice(0, maxItems),
    pageText: String(extracted.pageText || ''),
    isGenerating: !!extracted.isGenerating,
  };
}

// How stale a cached snapshot is allowed to be before we re-scrape for the advisor.
// browser_open / click / fill / scroll all update session.lastSnapshot immediately, so
// in those flows the snapshot is always < 500 ms old. Only browser_wait paths might
// produce a snapshot that drifts, hence the 4-second ceiling.
export const SNAPSHOT_CACHE_TTL_MS = 4000;

export async function buildAdvisorPacketForSession(
  session: BrowserSession,
  options?: { maxItems?: number; snapshotElements?: number; cachedSnapshotMs?: number },
): Promise<BrowserAdvisorPacket> {
  const maxItems = Math.max(6, Math.min(Number(options?.maxItems || 24), 60));
  const snapshotElements = Math.max(80, Math.min(Number(options?.snapshotElements || 140), 280));

  const title = await session.page.title();
  const url = session.page.url();

  // Reuse the snapshot the tool handler already captured if it's fresh enough.
  // This avoids a second full DOM scrape immediately after browser_open / click / fill / scroll.
  const cacheAgeMs = options?.cachedSnapshotMs ?? SNAPSHOT_CACHE_TTL_MS;
  const snapshotAge = session.lastSnapshotAt ? Date.now() - session.lastSnapshotAt : Infinity;
  let snapshot: string;
  if (session.lastSnapshot && snapshotAge < cacheAgeMs) {
    snapshot = session.lastSnapshot;
  } else {
    snapshot = await takeSnapshot(session.page, snapshotElements);
    session.lastSnapshot = snapshot;
    session.lastSnapshotAt = Date.now();
  }

  // extractStructuredFromPage is a separate page.evaluate that does its own DOM walk.
  // We still need it for feed/article extraction which the compact snapshot doesn't capture.
  const structured = await extractStructuredFromPage(session.page, maxItems);

  const packet: BrowserAdvisorPacket = {
    page: {
      title: String(title || '').trim(),
      url: String(url || '').trim(),
      pageType: structured.pageType,
    },
    snapshot,
    snapshotElements: parseSnapshotElementCount(snapshot),
    extractedFeed: structured.extractedFeed,
    textBlocks: structured.textBlocks,
    pageText: structured.pageText,
    isGenerating: structured.isGenerating,
    contentHash: buildPacketHash({
      url,
      pageType: structured.pageType,
      snapshot,
      extractedFeed: structured.extractedFeed,
      textBlocks: structured.textBlocks,
      pageText: structured.pageText,
    }),
  };
  return packet;
}

// --- Exported Tool Handlers ----------------------------------------------------

// --- Shared browser session alias --------------------------------------------
// Browser sessions are keyed directly by runtime session ID. Main chat may use
// the selected main target, while task/background/team sessions intentionally
// stay isolated so each worker gets its own profile and CDP port.
export function resolveSessionId(sessionId: string): string {
  return normalizeBrowserSessionId(sessionId);
}

export function buildBrowserElementSelector(parts: {
  id?: string;
  tagName?: string;
  classList?: string[];
  siblingIndex?: number;
  parentChain?: Array<{ tagName?: string; id?: string; classList?: string[]; siblingIndex?: number }>;
}): string {
  const buildSegment = (node: { tagName?: string; id?: string; classList?: string[]; siblingIndex?: number }) => {
    const tag = String(node?.tagName || '').toLowerCase();
    if (!tag) return '';
    if (node?.id) return `#${node.id}`;
    let segment = tag;
    const classList = Array.isArray(node?.classList) ? node.classList.filter(Boolean).slice(0, 3) : [];
    if (classList.length) segment += `.${classList.join('.')}`;
    if (Number.isFinite(Number(node?.siblingIndex)) && Number(node.siblingIndex) > 0) {
      segment += `:nth-of-type(${Number(node.siblingIndex)})`;
    }
    return segment;
  };
  const chain = Array.isArray(parts.parentChain) ? parts.parentChain.map(buildSegment).filter(Boolean) : [];
  const current = buildSegment(parts);
  if (current) chain.push(current);
  return chain.join(' > ');
}

export interface BrowserSelectorPack {
  css: string;
  xpath: string;
  testid: string;
  role: string;
  name: string;
  text: string;
  attrSelector: string;
}

export function buildBrowserSelectorPack(parts: {
  id?: string;
  tagName?: string;
  classList?: string[];
  siblingIndex?: number;
  parentChain?: Array<{ tagName?: string; id?: string; classList?: string[]; siblingIndex?: number }>;
  xpath?: string;
  testid?: string;
  role?: string;
  ariaLabel?: string;
  name?: string;
  placeholder?: string;
  title?: string;
  text?: string;
}): BrowserSelectorPack {
  const css = buildBrowserElementSelector(parts);
  const tag = String(parts.tagName || '').toLowerCase();
  const testid = String(parts.testid || '').trim();
  const role = String(parts.role || '').trim().toLowerCase();
  const ariaLabel = String(parts.ariaLabel || '').trim();
  const name = String(parts.name || '').trim();
  const placeholder = String(parts.placeholder || '').trim();
  const title = String(parts.title || '').trim();
  const accessibleName = ariaLabel || name || placeholder || title || '';
  const rawText = String(parts.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const id = String(parts.id || '').trim();
  let attrSelector = '';
  if (testid) attrSelector = `${tag || '*'}[data-testid="${testid.replace(/"/g, '\\"')}"]`;
  else if (id) attrSelector = `#${id}`;
  else if (ariaLabel) attrSelector = `${tag || '*'}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
  else if (name && (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button')) {
    attrSelector = `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
  } else if (placeholder) attrSelector = `${tag || '*'}[placeholder="${placeholder.replace(/"/g, '\\"')}"]`;
  return {
    css,
    xpath: String(parts.xpath || '').trim(),
    testid,
    role,
    name: accessibleName,
    text: rawText,
    attrSelector,
  };
}

export const ATTR_SELECTOR_RX = /^[*a-z0-9_-]+\[[^\]]+\]$|^#[A-Za-z][\w-]*$/;

export async function resolveBrowserLocator(page: PwPage, pack: Partial<BrowserSelectorPack> | null | undefined): Promise<any | null> {
  if (!pack) return null;
  const tryLocator = (locator: any) => locator;
  // Priority: testid attr selector ? aria/name attr selector ? role+name ? css ? xpath
  if (pack.testid) {
    try {
      const loc = page.locator(`[data-testid="${pack.testid.replace(/"/g, '\\"')}"]`).first();
      if (await loc.count().catch(() => 0)) return tryLocator(loc);
    } catch {}
  }
  if (pack.attrSelector && ATTR_SELECTOR_RX.test(pack.attrSelector)) {
    try {
      const loc = page.locator(pack.attrSelector).first();
      if (await loc.count().catch(() => 0)) return tryLocator(loc);
    } catch {}
  }
  if (pack.role && pack.name) {
    try {
      const loc = (page as any).getByRole?.(pack.role, { name: pack.name, exact: false })?.first?.();
      if (loc && await loc.count().catch(() => 0)) return tryLocator(loc);
    } catch {}
  }
  if (pack.css) {
    try {
      const loc = page.locator(pack.css).first();
      if (await loc.count().catch(() => 0)) return tryLocator(loc);
    } catch {}
  }
  if (pack.xpath) {
    try {
      const xp = pack.xpath.startsWith('//') || pack.xpath.startsWith('xpath=')
        ? pack.xpath
        : `xpath=${pack.xpath}`;
      const loc = page.locator(xp).first();
      if (await loc.count().catch(() => 0)) return tryLocator(loc);
    } catch {}
  }
  return null;
}
