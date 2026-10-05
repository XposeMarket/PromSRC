import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config/config.js';
import { getProviderKey } from './providers.js';
import { listCuratedModels, listModels, setSyncedFalModels, type MediaModelManifest } from './catalog.js';

const TTL_MS = 24 * 60 * 60 * 1000;
const CATEGORIES = ['text-to-video', 'image-to-video', 'video-to-video', 'video-upscaling', 'lip-sync', 'lipsync', 'audio-to-video'];
const pricing = new Map<string, MediaModelManifest['pricing']>();
let cacheLoaded = false;
let lastSync = 0;
let pending: Promise<FalSyncResult> | undefined;
export interface FalSyncResult { count: number; fetchedAt?: string; stale?: boolean; error?: string; examples: string[] }

function cacheFile(): string { return path.join(getConfig().getConfigDir(), 'cache', 'fal-video-catalog.json'); }
function validEndpoint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z\d][a-z\d-]*\/[a-z\d][a-z\d/_-]*$/i.test(value) && !value.includes('..');
}
function loadCache(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    lastSync = Number(cache.fetchedAt) || 0;
    for (const item of cache.prices || []) if (validEndpoint(item[0]) && item[1]?.source === 'live') pricing.set(item[0], item[1]);
    setSyncedFalModels((cache.models || []).filter((m: MediaModelManifest) => validEndpoint(m.endpoint) && m.kind !== 'image'));
  } catch { /* missing/corrupt cache: retry API */ }
}
async function api(url: URL, key?: string): Promise<any> {
  const response = await fetch(url, { headers: key ? { Authorization: `Key ${key}` } : {}, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`fal ${url.pathname} returned HTTP ${response.status}`);
  return response.json();
}

/** Convert fal's raw billing units without ever treating a video/token as a second. */
export function falUnitCost(unitPrice: number, unit: string, input: { durationSec?: number; resolution?: string; aspectRatio?: string }): number | undefined {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return undefined;
  const label = unit.toLowerCase().replace(/[_-]/g, ' ');
  if (/\b(audio|compute|gpu|credit)\b/.test(label)) return undefined;
  if (/\bimages?\b/.test(label) && !/\b(video )?tokens?\b/.test(label)) return unitPrice;
  const duration = Math.max(1, Number(input.durationSec) || 5);
  const height = Number(String(input.resolution || '720p').match(/(\d{3,4})/)?.[1]) || 720;
  const aspect = String(input.aspectRatio || '16:9');
  const ratio = aspect === '9:16' || aspect === 'portrait' ? 9 / 16 : aspect === '1:1' || aspect === 'square' ? 1 : 16 / 9;
  const width = Math.round(height * ratio);
  const frames = duration * 24;
  const megapixels = height * width / 1_000_000;
  if (/million.*(video )?tokens?|\b1m\s*(video )?tokens?|\bm\s*(video )?tokens?|tokens?.*million/.test(label)) return unitPrice * (height * width * frames / 1024) / 1_000_000;
  if (/\b(video )?tokens?\b/.test(label)) return unitPrice * (height * width * frames / 1024);
  if (/million.*pixels?|megapixels?|\bmp\b/.test(label)) return unitPrice * megapixels * frames;
  if (/\bframe\b/.test(label)) return unitPrice * frames;
  if (/\b(seconds?|secs?|s)\b/.test(label)) return unitPrice * duration;
  if (/\b(minute|min)\b/.test(label)) return unitPrice * duration / 60;
  if (/\b(videos?|requests?|generations?|outputs?|calls?)\b/.test(label)) return unitPrice;
  return undefined; // unknown billing units must not turn into a made-up per-second price
}

export function priceForModel(model: MediaModelManifest, input: { durationSec?: number; resolution?: string; aspectRatio?: string }): number | undefined {
  loadCache();
  const live = pricing.get(model.endpoint) || (model.pricing?.source === 'live' ? model.pricing : undefined);
  if (!live?.unit || live.unitPriceUsd == null) return undefined;
  return falUnitCost(live.unitPriceUsd, live.unit, input);
}
export function liveFalPrice(model: MediaModelManifest): MediaModelManifest['pricing'] | undefined {
  loadCache();
  return pricing.get(model.endpoint) || (model.pricing?.source === 'live' ? model.pricing : undefined);
}

const schemaPending = new Map<string, Promise<void>>();
/** Hydrate only the requested synced endpoint; listing hundreds of models must not fetch hundreds of OpenAPI documents. */
export async function hydrateFalModelSchema(model: MediaModelManifest): Promise<void> {
  if (model.source !== 'fal-sync' || model.schemaLoaded) return;
  let pendingSchema = schemaPending.get(model.endpoint);
  if (!pendingSchema) {
    pendingSchema = (async () => {
      try {
        const schemaEndpoint = model.endpoint.replace(/^fal-ai\//, '');
        const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(schemaEndpoint)}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return;
        const root: any = await response.json();
        const post = root.paths?.[`/${schemaEndpoint}`]?.post;
        if (!post) return;
        const schema = schemaRef(root, post.requestBody?.content?.['application/json']?.schema);
        const props = schema?.properties || {};
        const limits = { ...(model.limits || {}) };
        // The sync advertises common fields, not the endpoint's actual request schema.
        for (const field of Object.keys(model.map) as Array<keyof typeof model.map>) {
          if (model.map[field] && !Object.hasOwn(props, model.map[field]!)) model.map[field] = undefined;
        }
        for (const field of ['durationSec', 'resolution', 'aspectRatio'] as const) {
          const prop = props[model.map[field] || ''];
          if (!prop) { model.map[field] = undefined; continue; }
          const def = schemaRef(root, prop);
          const values: unknown[] = def.enum || def.anyOf?.flatMap((entry: any) => schemaRef(root, entry)?.enum || []) || [];
          if (field === 'resolution') {
            limits.resolutions = values.map(String).filter(Boolean);
            // An unconstrained property is not an enum: omit guessed resolution rather than send an invalid value.
          } else if (field === 'aspectRatio') {
            limits.aspects = values.map(String).filter(Boolean);
          } else if (values.length) {
            model.durationValues = values.filter((value): value is string | number => typeof value === 'string' || typeof value === 'number');
            limits.durations = values.map(Number).filter(Number.isFinite);
            model.durationFormat = typeof values[0] === 'string' ? 'string' : 'number';
          }
        }
        model.limits = limits;
        model.schemaLoaded = true;
      } catch { /* Schema unavailable: preserve existing model, but do not guess an enum. */ }
    })().finally(() => schemaPending.delete(model.endpoint));
    schemaPending.set(model.endpoint, pendingSchema);
  }
  await pendingSchema;
}

function schemaRef(root: any, value: any): any {
  let result = value;
  for (let i = 0; i < 6 && result?.$ref; i++) {
    result = String(result.$ref).replace(/^#\//, '').split('/').reduce((node: any, key: string) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
  }
  return result || {};
}

function toManifest(item: any): MediaModelManifest | undefined {
  const endpoint = item?.endpoint_id;
  if (!validEndpoint(endpoint)) return undefined;
  const metadata = item.metadata || {};
  const category = String(metadata.category || '').toLowerCase();
  if (!CATEGORIES.includes(category) || metadata.status === 'deprecated') return undefined;
  const i2v = category === 'image-to-video';
  const v2v = category === 'video-to-video' || category === 'video-upscaling' || /upscal/.test(endpoint);
  const audio = category === 'audio-to-video' || /lip.?sync/.test(category);
  const map: MediaModelManifest['map'] = {
    prompt: 'prompt', durationSec: 'duration', resolution: 'resolution', aspectRatio: 'aspect_ratio',
    ...(i2v ? { startImage: 'image_url' } : {}),
    ...(v2v ? { sourceVideo: 'video_url' } : {}),
    ...(audio ? { audio: 'audio_url', startImage: 'image_url' } : {}),
  };
  return {
    id: `fal/${endpoint}`, label: String(metadata.display_name || endpoint), provider: 'fal', kind: 'video', endpoint,
    map, requires: i2v ? ['prompt', 'startImage'] : v2v ? ['sourceVideo'] : audio ? ['audio'] : ['prompt'],
    output: 'video.url', aspectFormat: 'ratio', tags: [category, ...(Array.isArray(metadata.tags) ? metadata.tags.filter((tag: unknown) => typeof tag === 'string') : [])],
    pricing: pricing.get(endpoint) || { source: 'estimate' }, source: 'fal-sync',
  };
}

/** Read-only fal discovery; cache persists across restarts. Never queries image categories. */
export async function syncFalModels(force = false): Promise<FalSyncResult> {
  loadCache();
  if (pending) return pending;
  const previous = listModels({ provider: 'fal' }).filter((m) => m.source === 'fal-sync');
  const key = getProviderKey('fal');
  // A read-only CLI may have cached public models without the OS-sealed fal key.
  // Once the gateway has its key, refresh missing live prices immediately.
  if (!force && Date.now() - lastSync < TTL_MS && (!key || pricing.has('fal-ai/bytedance/seedance/v1/pro/image-to-video')))
    return { count: previous.length, fetchedAt: new Date(lastSync).toISOString(), examples: previous.slice(0, 5).map((m) => m.id) };
  pending = (async () => {
    try {
      const found = new Map<string, MediaModelManifest>();
      let categoriesSucceeded = 0;
      for (const category of CATEGORIES) {
        let cursor: string | undefined;
        try {
        for (let page = 0; page < 30; page++) {
          const url = new URL('https://api.fal.ai/v1/models');
          url.searchParams.set('category', category); url.searchParams.set('status', 'active'); url.searchParams.set('limit', '100');
          if (cursor) url.searchParams.set('cursor', cursor);
          const body = await api(url, key);
          for (const item of body.models || []) {
            const model = toManifest(item);
            if (model) found.set(model.endpoint, model);
          }
          cursor = body.next_cursor || undefined;
          if (!body.has_more || !cursor) break;
        }
        categoriesSucceeded++;
        } catch { /* fal may not support a category; keep the successful ones */ }
      }
      if (!categoriesSucceeded) throw new Error('fal model listing failed for all video categories');
      const endpoints = [...new Set([...found.keys(), ...listCuratedModels().filter((m) => m.provider === 'fal' && m.kind !== 'image').map((m) => m.endpoint)])].filter(validEndpoint);
      let priceFailed = false;
      for (let i = 0; key && i < endpoints.length; i += 50) {
        const url = new URL('https://api.fal.ai/v1/models/pricing');
        for (const endpoint of endpoints.slice(i, i + 50)) url.searchParams.append('endpoint_id', endpoint);
        try {
          const body = await api(url, key);
          for (const row of body.prices || []) {
            if (!validEndpoint(row.endpoint_id) || row.currency !== 'USD' || !Number.isFinite(Number(row.unit_price)) || Number(row.unit_price) < 0) continue;
            pricing.set(row.endpoint_id, { unit: String(row.unit), unitPriceUsd: Number(row.unit_price), source: 'live', fetchedAt: new Date().toISOString() });
          }
        } catch { priceFailed = true; /* retain previous prices for individual failed batches */ }
      }
      for (const model of found.values()) model.pricing = pricing.get(model.endpoint) || model.pricing;
      const models = [...found.values()];
      setSyncedFalModels(models);
      lastSync = Date.now();
      const file = cacheFile(); fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: lastSync, models, prices: [...pricing] })); fs.renameSync(tmp, file);
      const visible = listModels({ provider: 'fal' }).filter((m) => m.source === 'fal-sync');
      return { count: visible.length, fetchedAt: new Date(lastSync).toISOString(), ...(!key || priceFailed ? { error: !key ? 'fal pricing requires a vault key; model listing is public and uses static estimates' : 'Some fal pricing batches failed; retained cached prices or static estimates' } : {}), examples: visible.slice(0, 5).map((m) => m.id) };
    } catch (error: any) {
      return { count: previous.length, stale: true, error: String(error?.message || error), examples: previous.slice(0, 5).map((m) => m.id) };
    }
  })();
  try { return await pending; } finally { pending = undefined; }
}
