// FxTwitter (public, keyless) recovery helpers for X status fetches.
// Split out of web.ts to keep it under its file-size budget (scripts/file-budgets.json).
import type { XFetchPayload } from './web.js';

/**
 * X's oEmbed HTML clips long-form ("note") posts at ~280 chars and ends the
 * paragraph with an ellipsis. Treat that as truncated so callers can recover
 * the full text instead of reporting a clipped post as complete.
 */
export function isLikelyTruncatedXText(text: string): boolean {
  const value = String(text || '').trim();
  if (value.length < 240) return false;
  return /(?:\u2026|\.\.\.)$/.test(value);
}

/** FxTwitter lookup result. 'unavailable' = HTTP/network/identity failure (degrade); 'ok' = identity-checked tweet. */
export type FxLookup = { state: 'ok'; tweet: any } | { state: 'unavailable' };

/**
 * Keyless FxTwitter status lookup (8 s). The returned tweet id must equal the
 * requested id; any mismatch or failure is 'unavailable', never a guess.
 */
async function fetchXStatusFx(url: string, id: string): Promise<FxLookup> {
  try {
    const handle = String(url || '').match(/(?:x\.com|twitter\.com)\/([^/?#]+)\/status\//i)?.[1] || 'i';
    const response = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}/status/${id}`, {
      headers: { accept: 'application/json', 'user-agent': 'Prometheus/1.0 (+web_fetch)' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { state: 'unavailable' };
    const data: any = await response.json();
    const tweet = data?.tweet;
    if (!tweet || String(tweet.id || '') !== id) return { state: 'unavailable' };
    return { state: 'ok', tweet };
  } catch {
    return { state: 'unavailable' };
  }
}

/** Per-call memoized FxTwitter lookup: at most one request per web_fetch call, shared by text and media. */
export function createFxLookup(url: string, id: string): () => Promise<FxLookup> {
  let request: Promise<FxLookup> | null = null;
  return () => {
    request ??= id ? fetchXStatusFx(url, id) : Promise.resolve({ state: 'unavailable' as const });
    return request;
  };
}

/** Target-post media hints from an identity-checked FxTwitter tweet. The quoted post is never read. */
export function fxTweetMediaHints(tweet: any): any[] {
  const photos: any[] = Array.isArray(tweet?.media?.photos) ? tweet.media.photos : [];
  const videos: any[] = Array.isArray(tweet?.media?.videos) ? tweet.media.videos : [];
  const hints: any[] = photos
    .map(photo => ({ type: 'image', url: String(photo?.url || '') }))
    .filter(item => item.url);
  if (videos.length) hints.push({ type: 'video' });
  return hints;
}

/** Only used to disclose that quoted-post media was deliberately not analyzed. */
export function fxTweetQuoteHasMedia(tweet: any): boolean {
  const quote = tweet?.quote;
  return !!quote && (
    (Array.isArray(quote?.media?.photos) && quote.media.photos.length > 0)
    || (Array.isArray(quote?.media?.videos) && quote.media.videos.length > 0));
}

export function hasXMediaHints(tweet: any): boolean {
  return (Array.isArray(tweet?.media) && tweet.media.length > 0) || tweet?.hasImage === true || tweet?.hasVideo === true;
}

/** Target post from an identity-checked FxTwitter tweet. Text may be empty for media-only posts. */
export type FxRecoveryReason = 'truncated' | 'oembed_unavailable' | 'target_synthesized';
const FX_RECOVERY_MESSAGES: Record<FxRecoveryReason, string> = {
  truncated: 'Captured full long-form X status (oEmbed text was truncated; full text via public FxTwitter API)',
  oembed_unavailable: 'oEmbed unavailable; target post recovered via public FxTwitter API',
  target_synthesized: 'Target post synthesized via public FxTwitter API; browser and oEmbed did not return it',
};
export function fxTweetToPayload(tweet: any, url: string, id: string, reason: FxRecoveryReason): XFetchPayload | null {
  if (!tweet || String(tweet.id || '') !== id) return null;
  const text = String(tweet?.raw_text?.text || tweet?.text || '').trim();
  const screenName = String(tweet?.author?.screen_name || '').trim();
  const metrics: Record<string, number> = {};
  for (const key of ['replies', 'retweets', 'likes', 'bookmarks', 'quotes', 'views']) {
    if (Number.isFinite(Number(tweet[key]))) metrics[key] = Number(tweet[key]);
  }
  return {
    success: true,
    url,
    tweets: [{
      id,
      link: String(tweet.url || url),
      author: String(tweet?.author?.name || '').trim(),
      handle: screenName ? `@${screenName}` : '',
      timestamp: tweet.created_at ? new Date(Number(tweet.created_timestamp) * 1000 || tweet.created_at).toISOString() : undefined,
      text,
      rawRef: id,
      ...(Object.keys(metrics).length ? { metrics } : {}),
    } as any],
    count: 1,
    message: FX_RECOVERY_MESSAGES[reason],
  };
}
