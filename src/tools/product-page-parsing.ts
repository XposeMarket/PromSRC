// Pure page-parsing helpers for product-carousel and news-card previews:
// HTML entity/meta-tag readers, Amazon product-page fields, bot-wall
// detection and a partial-body reader. Split out of web.ts (file budget);
// web.ts re-exports the public names, so existing imports keep working.

export type PagePreviewMetadata = {
  url: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  publisher?: string;
  publishedAt?: string;
  imageUrl?: string;
  iconUrl?: string;
  price?: string;
  rating?: number;
  reviews?: number;
  reviewCount?: number;
  availability?: string;
  seller?: string;
  sku?: string;
};

export function htmlDecodeLite(input: string): string {
  return String(input || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function amazonAsinFromUrl(url: string): string | undefined {
  return String(url || '').match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase();
}

export function parseHtmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(String(tag || ''))) !== null) {
    const name = String(match[1] || '').toLowerCase();
    if (!name || name.startsWith('<')) continue;
    attrs[name] = htmlDecodeLite(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

export function extractMetaTag(html: string, property: string): string | undefined {
  const wanted = String(property || '').toLowerCase();
  for (const tag of String(html || '').match(/<meta\b[^>]*>/gi) || []) {
    const attrs = parseHtmlAttributes(tag);
    if (String(attrs.property || attrs.name || attrs.itemprop || '').toLowerCase() !== wanted) continue;
    const value = htmlDecodeLite(attrs.content || attrs.value || '');
    if (value) return value;
  }
  return undefined;
}

export const DESKTOP_PREVIEW_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Prometheus/1.0';
// Amazon answers server-side desktop fetches with a captcha wall almost every
// time, but serves its mobile product page (/gp/aw/d/<ASIN>) to a phone UA.
// That page carries the main image (data-a-hires) and the buy-box price.
export const AMAZON_MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Mobile product-page URL for an Amazon product link, or undefined for anything else. */
export function amazonMobileProductUrl(url: string): string | undefined {
  try {
    const u = new URL(String(url || ''));
    if (!/(?:^|\.)amazon\.(?:com|ca|co\.uk|de|fr|it|es|co\.jp|com\.au|com\.mx|com\.br|in|nl|se|pl|sg|ae|sa|com\.tr|com\.be)$/i.test(u.hostname)) return undefined;
    const asin = amazonAsinFromUrl(u.href) || String(u.searchParams.get('asin') || u.searchParams.get('ASIN') || '').toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) return undefined;
    const host = u.hostname.toLowerCase().replace(/^(?:us|smile|m|www)\./, '');
    return `https://www.${host}/gp/aw/d/${asin}`;
  } catch {
    return undefined;
  }
}

/** Amazon thumbnails ("._AC_SR150,150_.jpg") upscaled to a card-sized rendition. */
export function upscaleAmazonImageUrl(url: string): string {
  const m = /^(https:\/\/(?:m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\/images\/I\/[A-Za-z0-9+%-]+)\._[^/|]*_\.(jpe?g|png|webp)$/i.exec(String(url || ''));
  return m ? `${m[1]}._AC_SL1000_.${m[2]}` : String(url || '');
}

/** Captcha / bot-challenge interstitials. These are short pages and must never be cached as "no preview". */
export function isBotWallHtml(html: string): boolean {
  const text = String(html || '');
  if (!text || text.length > 60_000) return false;
  return /validateCaptcha|api-services-support@amazon\.com|<title>\s*(?:Robot Check|Just a moment|Attention Required|Access Denied|Are you a robot)|cf-browser-verification|px-captcha|g-recaptcha/i.test(text);
}

/** Main image, buy-box price and availability from an Amazon product page (mobile or desktop). */
export function extractAmazonProductFields(html: string): Pick<PagePreviewMetadata, 'imageUrl' | 'price' | 'availability'> {
  const text = String(html || '');
  // The landing image tag (#main-image on mobile, #landingImage on desktop)
  // is the product photo; fall back to the first hires attribute / JSON.
  const mainTag = /<img\b[^>]*\bid="(?:main-image|landingImage|imgBlkFront)"[^>]*>/i.exec(text)?.[0] || '';
  const mainAttr = (name: string) => new RegExp(`\\b${name}="(https:[^"]+)"`, 'i').exec(mainTag)?.[1];
  const imageUrl = mainAttr('data-a-hires') || mainAttr('data-old-hires') || mainAttr('src')
    || /<img\b[^>]*\bdata-a-hires="(https:[^"]+)"/i.exec(text)?.[1]
    || /<img\b[^>]*\bdata-old-hires="(https:[^"]+)"/i.exec(text)?.[1]
    || /"hiRes":"(https:[^"]+)"/.exec(text)?.[1];
  // The first a-offscreen price on the page is often a sponsored listing, so
  // only read prices from the buy box / twister data that belong to this ASIN.
  const buyBoxPrice = (marker: string) => {
    const at = text.indexOf(marker);
    if (at < 0) return undefined;
    return /class="a-offscreen">\s*(\$[0-9][0-9,]*(?:\.[0-9]{2})?)/.exec(text.slice(at, at + 8000))?.[1];
  };
  const twister = /id="twister-plus-price-data-price"\s+value="([0-9][0-9,]*(?:\.[0-9]{1,2})?)"/.exec(text)?.[1];
  const price = buyBoxPrice('apex_mobile_feature_div')
    || buyBoxPrice('corePriceDisplay_desktop_feature_div')
    || buyBoxPrice('corePrice_feature_div')
    || (twister ? `$${Number(twister.replace(/,/g, '')).toFixed(2)}` : undefined);
  const availabilityRaw = /id="availability"[\s\S]{0,400}?<span[^>]*>\s*([^<]{3,80})/.exec(text)?.[1];
  const availability = availabilityRaw ? htmlDecodeLite(availabilityRaw).replace(/\s+/g, ' ').trim().replace(/\.$/, '') : undefined;
  return {
    imageUrl: imageUrl ? upscaleAmazonImageUrl(htmlDecodeLite(imageUrl)) : undefined,
    price,
    availability,
  };
}

/**
 * Read a response body until maxChars or the deadline, keeping whatever has
 * arrived. Heavy product/news pages (0.6-2 MB) used to lose an image that was
 * already downloaded because the whole read was aborted at the timeout.
 */
export async function readResponseTextWithBudget(
  res: Response,
  opts: { maxChars: number; deadlineAt: number },
): Promise<{ text: string; complete: boolean }> {
  const body = res.body;
  if (!body) return { text: '', complete: true };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let complete = false;
  try {
    while (text.length < opts.maxChars) {
      const remaining = opts.deadlineAt - Date.now();
      if (remaining <= 0) break;
      let timer: NodeJS.Timeout | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), remaining); }),
      ]).finally(() => { if (timer) clearTimeout(timer); });
      if (!next) break;
      if (next.done) { complete = true; break; }
      text += decoder.decode(next.value, { stream: true });
    }
  } catch {
    // Aborted mid-body: keep the partial HTML.
  } finally {
    reader.cancel().catch(() => {});
  }
  return { text: text.slice(0, opts.maxChars), complete };
}
