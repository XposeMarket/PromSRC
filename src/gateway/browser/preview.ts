
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

import { normalizeScreenshotBuffer } from '../screenshot-normalize.js';

import { getOrCreateSession } from './profiles.js';
import { PwPage } from './types.js';

// --- Preview Screenshot -------------------------------------------------------
// Used by the Telegram file browser to render a visual preview of any workspace
// file. Completely isolated from the main chat browser session � opens a fresh
// page, screenshots it in chunks, then immediately closes the page.
// Chrome is auto-launched if it isn't running (same path as normal browser tools).

export interface PreviewChunk {
  index: number;       // 0-based chunk number
  total: number;       // total number of chunks
  base64: string;      // PNG encoded as base64
  width: number;
  height: number;      // actual height of this chunk (last chunk may be smaller)
  mimeType?: 'image/png' | 'image/jpeg';
}

/**
 * Take a full-page screenshot of a URL and return it as an array of vertical
 * chunks so long pages can be sent as a Telegram photo album.
 *
 * @param url         The URL to screenshot (typically the /preview route)
 * @param chunkHeight Height in px of each chunk (default 1200)
 * @param maxChunks   Maximum chunks to return (default 10 = up to ~12000px)
 */
export async function browserPreviewScreenshot(
  url: string,
  chunkHeight = 1200,
  maxChunks = 10,
  options: { requestHeaders?: Record<string, string> } = {},
): Promise<PreviewChunk[]> {
  // Get (or launch) Chrome using the same logic as normal browser tools.
  // Using a dedicated session ID keeps this page completely separate from
  // any active user browser session.
  const PREVIEW_SESSION = '__preview_internal__';
  const session = await getOrCreateSession(PREVIEW_SESSION);

  // Always open a BRAND NEW page � never reuse the session's shared page.
  // This ensures zero interference with the user's active browsing session.
  const page: PwPage = await session.context.newPage();

  try {
    const requestHeaders = options.requestHeaders && typeof options.requestHeaders === 'object'
      ? options.requestHeaders
      : {};
    if (Object.keys(requestHeaders).length) {
      await page.route(url, async (route: any) => {
        await route.continue({ headers: { ...route.request().headers(), ...requestHeaders } });
      });
    }
    // Clean 1280px viewport � matches a standard desktop browser width.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    // Brief settle to let fonts/images render fully
    await page.waitForTimeout(400);

    // Get the full rendered page height � use the maximum of several measures
    // because some pages (e.g. 100vh layouts) return a small scrollHeight.
    const fullHeight: number = await page.evaluate(`
      Math.max(
        document.documentElement.scrollHeight || 0,
        document.documentElement.clientHeight || 0,
        document.body ? document.body.scrollHeight : 0,
        document.body ? document.body.offsetHeight : 0
      )
    `);
    const viewportWidth = 1280;
    const viewportHeight = 900;
    // Clamp: if the page reports a tiny or zero height, fall back to viewport height
    const effectiveHeight = Math.max(fullHeight, viewportHeight);
    const safeChunkHeight = Math.max(200, Math.min(2000, chunkHeight));
    const totalChunks = Math.min(maxChunks, Math.ceil(effectiveHeight / safeChunkHeight));

    const chunks: PreviewChunk[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const scrollY = i * safeChunkHeight;
      // Never let the chunk extend past the effective page height
      const thisChunkHeight = Math.min(safeChunkHeight, effectiveHeight - scrollY);
      if (thisChunkHeight <= 0) break;

      // Scroll so the chunk we want is at the TOP of the viewport
      await page.evaluate(`window.scrollTo(0, ${scrollY})`);
      await page.waitForTimeout(80);

      // Resize viewport to exactly the chunk height so the screenshot
      // captures only this slice � clip coords are always viewport-relative
      // so we set the viewport to match the chunk height instead of clipping
      await page.setViewportSize({ width: viewportWidth, height: thisChunkHeight });

      const buf: Buffer = await page.screenshot({ type: 'png' });
      const normalized = await normalizeScreenshotBuffer(buf, {
        maxSide: Number(process.env.PROMETHEUS_PREVIEW_SCREENSHOT_MAX_SIDE || process.env.PROMETHEUS_SCREENSHOT_MAX_SIDE || 1800),
        maxBytes: Number(process.env.PROMETHEUS_PREVIEW_SCREENSHOT_MAX_BYTES || process.env.PROMETHEUS_SCREENSHOT_MAX_BYTES || 4 * 1024 * 1024),
        preferJpeg: true,
      }).catch(() => null);
      const finalBuffer = normalized?.buffer || buf;

      // Restore viewport for next iteration
      await page.setViewportSize({ width: viewportWidth, height: safeChunkHeight });

      chunks.push({
        index: i,
        total: totalChunks,
        base64: finalBuffer.toString('base64'),
        width: normalized?.width || viewportWidth,
        height: normalized?.height || thisChunkHeight,
        mimeType: normalized?.mimeType || 'image/png',
      });
    }

    return chunks;
  } finally {
    // Always close this temporary page � never leave it open in Chrome
    try { await page.close(); } catch {}
  }
}
