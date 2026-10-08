// Instagram Content Publishing flow (official API):
//   1. POST /{ig-id}/media            -> container id (Meta cURLs the media URL)
//   2. GET  /{container}?fields=status_code until FINISHED (videos/reels)
//   3. POST /{ig-id}/media_publish     -> published media id
// Local files are exposed through a short-lived public-media share on the
// gateway's Funnel origin, then revoked. Images must be JPEG; png/webp/gif
// are converted with ffmpeg first.
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { InstagramConnector } from './instagram.js';
import { mimeForFile, revokePublicMedia, sharePublicMedia } from '../public-media-share.js';
import { resolveRuntimeBinary } from '../../runtime/dependencies.js';

export type IgPostType = 'image' | 'reel' | 'story' | 'carousel';

export interface IgMediaInput { path?: string; url?: string; alt_text?: string }

export interface IgPublishOptions {
  type: IgPostType;
  media: IgMediaInput[];
  caption?: string;
  share_to_feed?: boolean;
  cover?: IgMediaInput;
  thumb_offset_ms?: number;
  location_id?: string;
  collaborators?: string[];
  user_tags?: Array<{ username: string; x?: number; y?: number }>;
  audio_name?: string;
  /** Resolve relative paths against this directory (workspace root). */
  baseDir?: string;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface IgPublishResult { media_id: string; permalink?: string; container_id: string; type: IgPostType; children?: string[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isVideo(input: IgMediaInput): boolean {
  const ref = input.path || input.url || '';
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(ref);
}

async function toJpeg(filePath: string): Promise<string> {
  const out = path.join(os.tmpdir(), `prom-ig-${crypto.randomBytes(6).toString('hex')}.jpg`);
  const ffmpeg = resolveRuntimeBinary('ffmpeg', { allowPathFallback: true });
  await new Promise<void>((resolve, reject) => {
    execFile(ffmpeg, ['-y', '-loglevel', 'error', '-i', filePath, '-frames:v', '1', '-q:v', '2', out], { timeout: 60_000 }, (err) => (err ? reject(new Error(`Could not convert ${path.basename(filePath)} to JPEG for Instagram: ${err.message}`)) : resolve()));
  });
  return out;
}

class MediaResolver {
  private tokens: string[] = [];
  private temps: string[] = [];
  constructor(private baseDir?: string) {}

  async url(input: IgMediaInput): Promise<string> {
    if (input.url) {
      if (!/^https:\/\//i.test(input.url)) throw new Error(`Media URL must be public https: ${input.url}`);
      return input.url;
    }
    if (!input.path) throw new Error('Each media item needs a path or url.');
    let filePath = path.isAbsolute(input.path) ? input.path : path.resolve(this.baseDir || process.cwd(), input.path);
    if (!fs.existsSync(filePath)) throw new Error(`Media file not found: ${input.path}`);
    const mime = mimeForFile(filePath);
    if (mime.startsWith('image/') && mime !== 'image/jpeg') {
      filePath = await toJpeg(filePath);
      this.temps.push(filePath);
    }
    const share = sharePublicMedia(filePath, 60 * 60 * 1000);
    this.tokens.push(share.token);
    return share.url;
  }

  cleanup(): void {
    for (const t of this.tokens) revokePublicMedia(t);
    for (const f of this.temps) { try { fs.unlinkSync(f); } catch { /* best effort */ } }
  }
}

export async function waitForContainer(c: InstagramConnector, containerId: string, timeoutMs = 10 * 60_000, intervalMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await c.graph('GET', `/${containerId}`, { fields: 'status_code,status' });
    const code = String(s?.status_code || '');
    if (code === 'FINISHED' || code === 'PUBLISHED') return;
    if (code === 'ERROR' || code === 'EXPIRED') throw new Error(`Instagram could not process the media (${code}): ${s?.status || 'no detail'}. Check format: JPEG images; MP4/MOV H.264 video, 3-90s reels, 9:16 recommended.`);
    if (Date.now() > deadline) throw new Error(`Instagram is still processing container ${containerId}. Publish later with connector_instagram_api_request POST /${'{ig-id}'}/media_publish creation_id=${containerId}.`);
    await sleep(intervalMs);
  }
}

export async function publishInstagram(c: InstagramConnector, opts: IgPublishOptions): Promise<IgPublishResult> {
  const igId = c.igUserId();
  const media = Array.isArray(opts.media) ? opts.media.filter(Boolean) : [];
  if (!media.length) throw new Error('media is required (at least one {path} or {url}).');
  if (opts.type !== 'carousel' && media.length > 1) throw new Error(`type "${opts.type}" takes exactly one media item; use type "carousel" for 2-10.`);
  if (opts.type === 'carousel' && (media.length < 2 || media.length > 10)) throw new Error('Carousels need 2-10 media items.');
  if (opts.type === 'reel' && !isVideo(media[0])) throw new Error('Reels need a video file (mp4/mov).');
  if (opts.type === 'image' && isVideo(media[0])) throw new Error('Use type "reel" for video posts (Instagram publishes feed videos as Reels).');
  if ((opts.caption || '').length > 2200) throw new Error('Caption exceeds Instagram\'s 2,200 character limit.');

  const resolver = new MediaResolver(opts.baseDir);
  const poll = (id: string) => waitForContainer(c, id, opts.pollTimeoutMs, opts.pollIntervalMs);
  try {
    const common = {
      caption: opts.type === 'story' ? undefined : opts.caption,
      location_id: opts.location_id,
      collaborators: opts.collaborators?.length ? opts.collaborators : undefined,
    };
    let containerId: string;
    let children: string[] | undefined;

    if (opts.type === 'carousel') {
      children = [];
      for (const item of media) {
        const url = await resolver.url(item);
        const child = await c.graph('POST', `/${igId}/media`, isVideo(item)
          ? { media_type: 'VIDEO', video_url: url, is_carousel_item: true }
          : { image_url: url, is_carousel_item: true, alt_text: item.alt_text });
        children.push(child.id);
      }
      for (const id of children) await poll(id);
      containerId = (await c.graph('POST', `/${igId}/media`, { ...common, media_type: 'CAROUSEL', children: children.join(',') })).id;
    } else if (opts.type === 'reel') {
      containerId = (await c.graph('POST', `/${igId}/media`, {
        ...common,
        media_type: 'REELS',
        video_url: await resolver.url(media[0]),
        share_to_feed: opts.share_to_feed ?? true,
        cover_url: opts.cover ? await resolver.url(opts.cover) : undefined,
        thumb_offset: opts.thumb_offset_ms,
        audio_name: opts.audio_name,
        user_tags: opts.user_tags?.length ? opts.user_tags : undefined,
      })).id;
    } else if (opts.type === 'story') {
      const url = await resolver.url(media[0]);
      containerId = (await c.graph('POST', `/${igId}/media`, isVideo(media[0])
        ? { media_type: 'STORIES', video_url: url }
        : { media_type: 'STORIES', image_url: url })).id;
    } else {
      containerId = (await c.graph('POST', `/${igId}/media`, {
        ...common,
        image_url: await resolver.url(media[0]),
        alt_text: media[0].alt_text,
        user_tags: opts.user_tags?.length ? opts.user_tags.map((t) => ({ username: t.username, x: t.x ?? 0.5, y: t.y ?? 0.5 })) : undefined,
      })).id;
    }

    await poll(containerId);
    const published = await c.graph('POST', `/${igId}/media_publish`, { creation_id: containerId });
    let permalink: string | undefined;
    try { permalink = (await c.graph('GET', `/${published.id}`, { fields: 'permalink' }))?.permalink; } catch { /* stories have no permalink */ }
    return { media_id: String(published.id), permalink, container_id: containerId, type: opts.type, children };
  } finally {
    resolver.cleanup();
  }
}
