/**
 * Media model catalog.
 *
 * Models are data, not code. Each manifest describes one generation endpoint:
 * which provider transport runs it, how Prometheus' neutral shot fields map
 * onto the endpoint's input schema, where the output lives in the response,
 * and an approximate price used by the cost gate.
 *
 * Built-in manifests ship below. User manifests live in
 * <configDir>/media-models/*.json and can be generated from a provider's
 * published OpenAPI schema with importModelManifest().
 */
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config.js';
import { priceForModel } from './fal-catalog.js';

export type MediaKind = 'video' | 'image' | 'audio';
export type MediaTransport = 'xai' | 'openai' | 'fal' | 'higgsfield';

/** Neutral input fields the engine can supply for a shot. */
export type NeutralField =
  | 'prompt'
  | 'negativePrompt'
  | 'startImage'
  | 'endImage'
  | 'referenceImages'
  | 'durationSec'
  | 'aspectRatio'
  | 'resolution'
  | 'count'
  /** Existing clip to edit / lip-sync / upscale / recast (workspace path or take ref). */
  | 'sourceVideo'
  /** Driving audio (lip-sync, talking photo). */
  | 'audio';

export interface MediaModelManifest {
  /** Stable id, conventionally "<provider>/<slug>". */
  id: string;
  label: string;
  provider: MediaTransport;
  kind: MediaKind;
  /** Provider endpoint/model path (fal endpoint id, Higgsfield path, xAI/OpenAI model id). */
  endpoint: string;
  /** Neutral field -> provider input key. Unmapped fields are not sent. */
  map: Partial<Record<NeutralField, string>>;
  /** Fields the endpoint requires. */
  requires?: NeutralField[];
  /** Constant params merged into every request. */
  defaults?: Record<string, unknown>;
  /** xAI registry mode for video-to-video endpoints (edit = restyle/recast, extend = continue the clip). */
  mode?: 'edit' | 'extend';
  limits?: {
    durations?: number[];
    minDurationSec?: number;
    maxDurationSec?: number;
    aspects?: string[];
    resolutions?: string[];
  };
  /** How to express aspect ratios for this endpoint. */
  aspectFormat?: 'ratio' | 'prometheus';
  /** Duration value type expected by the endpoint. */
  durationFormat?: 'number' | 'string';
  /** Exact duration enum strings (when an OpenAPI enum uses labels instead of numbers). */
  durationValues?: Array<string | number>;
  pricing?: {
    perSecondUsd?: number;
    perImageUsd?: number;
    perRequestUsd?: number;
    /** Raw fal billing unit/price (not interchangeable with per-second). */
    unit?: string;
    unitPriceUsd?: number;
    fetchedAt?: string;
    /** 'live' is fetched from fal's platform API. */
    source?: 'published' | 'estimate' | 'live';
  };
  /** Dot path to the output URL in the completed payload. */
  output?: string;
  tags?: string[];
  notes?: string;
  builtin?: boolean;
  source?: 'fal-sync';
  /** Runtime-only flag indicating this synced model's OpenAPI fields were inspected. */
  schemaLoaded?: boolean;
}

const RATIO_BY_PROMETHEUS: Record<string, string> = { landscape: '16:9', portrait: '9:16', square: '1:1' };

export function toRatio(aspect: string | undefined): string {
  const raw = String(aspect || '').trim();
  return RATIO_BY_PROMETHEUS[raw] || raw || '16:9';
}

export function toPrometheusAspect(aspect: string | undefined): string {
  const ratio = toRatio(aspect);
  if (ratio === '9:16' || ratio === '3:4' || ratio === '2:3' || ratio === '4:5') return 'portrait';
  if (ratio === '1:1') return 'square';
  return 'landscape';
}

const BUILTIN: MediaModelManifest[] = [
  // ── xAI (existing provider path, updated to current models) ──
  {
    id: 'xai/grok-imagine-video-1.5', label: 'Grok Imagine Video 1.5', provider: 'xai', kind: 'video',
    endpoint: 'grok-imagine-video-1.5',
    map: { prompt: 'prompt', startImage: 'image', referenceImages: 'reference_images', durationSec: 'duration', aspectRatio: 'aspect_ratio', resolution: 'resolution' },
    limits: { minDurationSec: 1, maxDurationSec: 15, aspects: ['16:9', '9:16', '1:1'], resolutions: ['480p', '720p', '1080p'] },
    pricing: { perSecondUsd: 0.08, source: 'published' },
    tags: ['text-to-video', 'image-to-video', 'reference-to-video', 'cheap-draft'],
  },
  {
    id: 'xai/grok-imagine-video-1.5-edit', label: 'Grok Imagine Video 1.5 Edit (recast)', provider: 'xai', kind: 'video',
    endpoint: 'grok-imagine-video-1.5', mode: 'edit',
    map: { prompt: 'prompt', sourceVideo: 'video' },
    requires: ['prompt', 'sourceVideo'],
    pricing: { perSecondUsd: 0.08, source: 'estimate' },
    tags: ['recast', 'video-to-video'],
  },
  {
    id: 'xai/grok-imagine-video-1.5-extend', label: 'Grok Imagine Video 1.5 Extend', provider: 'xai', kind: 'video',
    endpoint: 'grok-imagine-video-1.5', mode: 'extend',
    map: { prompt: 'prompt', sourceVideo: 'video', durationSec: 'duration' },
    requires: ['sourceVideo'],
    limits: { minDurationSec: 2, maxDurationSec: 10 },
    pricing: { perSecondUsd: 0.08, source: 'estimate' },
    tags: ['extend', 'recast', 'video-to-video'],
  },
  {
    id: 'xai/grok-imagine-video', label: 'Grok Imagine Video', provider: 'xai', kind: 'video',
    endpoint: 'grok-imagine-video',
    map: { prompt: 'prompt', startImage: 'image', referenceImages: 'reference_images', durationSec: 'duration', aspectRatio: 'aspect_ratio', resolution: 'resolution' },
    limits: { minDurationSec: 1, maxDurationSec: 15, aspects: ['16:9', '9:16', '1:1'], resolutions: ['480p', '720p'] },
    pricing: { perSecondUsd: 0.06, source: 'estimate' },
    tags: ['text-to-video', 'image-to-video', 'cheap-draft'],
  },
  {
    id: 'xai/grok-imagine-image-2.0', label: 'Grok Imagine Image 2.0', provider: 'xai', kind: 'image',
    endpoint: 'grok-imagine-image-2.0',
    map: { prompt: 'prompt', referenceImages: 'reference_images', aspectRatio: 'aspect_ratio', count: 'count' },
    pricing: { perImageUsd: 0.04, source: 'estimate' },
    tags: ['anchor', 'character', 'reference-edit'],
  },
  // ── OpenAI images (existing provider path) ──
  {
    id: 'openai/gpt-image', label: 'OpenAI GPT Image 2.5 Flare', provider: 'openai', kind: 'image',
    endpoint: 'gpt-image-2.5-flare-medium',
    map: { prompt: 'prompt', referenceImages: 'reference_images', aspectRatio: 'aspect_ratio', count: 'count' },
    pricing: { perImageUsd: 0.07, source: 'estimate' },
    tags: ['anchor', 'character', 'text-rendering', 'reference-edit'],
  },
  {
    id: 'openai/gpt-image-sunburst', label: 'OpenAI GPT Image 2.5 Sunburst (precise)', provider: 'openai', kind: 'image',
    endpoint: 'gpt-image-2.5-sunburst-high',
    map: { prompt: 'prompt', referenceImages: 'reference_images', aspectRatio: 'aspect_ratio', count: 'count' },
    pricing: { perImageUsd: 0.1, source: 'estimate' },
    tags: ['anchor', 'character', 'product', 'reference-edit', 'precise'],
  },
  // ── fal queue ──
  {
    id: 'fal/kling-v2.1-master-i2v', label: 'Kling 2.1 Master (image→video) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/kling-video/v2.1/master/image-to-video',
    map: { prompt: 'prompt', startImage: 'image_url', durationSec: 'duration', negativePrompt: 'negative_prompt' },
    requires: ['prompt', 'startImage'], durationFormat: 'string',
    limits: { durations: [5, 10] },
    pricing: { perSecondUsd: 0.28, source: 'estimate' }, output: 'video.url',
    tags: ['image-to-video', 'premium-motion'],
  },
  {
    id: 'fal/kling-v2.1-master-t2v', label: 'Kling 2.1 Master (text→video) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/kling-video/v2.1/master/text-to-video',
    map: { prompt: 'prompt', durationSec: 'duration', aspectRatio: 'aspect_ratio', negativePrompt: 'negative_prompt' },
    requires: ['prompt'], durationFormat: 'string', aspectFormat: 'ratio',
    limits: { durations: [5, 10], aspects: ['16:9', '9:16', '1:1'] },
    pricing: { perSecondUsd: 0.28, source: 'estimate' }, output: 'video.url',
    tags: ['text-to-video', 'premium-motion'],
  },
  {
    id: 'fal/seedance-v1-pro-i2v', label: 'Seedance 1 Pro (image→video) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/bytedance/seedance/v1/pro/image-to-video',
    map: { prompt: 'prompt', startImage: 'image_url', endImage: 'end_image_url', durationSec: 'duration', aspectRatio: 'aspect_ratio', resolution: 'resolution' },
    requires: ['prompt', 'startImage'], durationFormat: 'string', aspectFormat: 'ratio',
    limits: { minDurationSec: 3, maxDurationSec: 12, resolutions: ['480p', '720p', '1080p'] },
    pricing: { perSecondUsd: 0.03, source: 'estimate' }, output: 'video.url',
    tags: ['image-to-video', 'start-end-frame', 'consistency'],
  },
  {
    id: 'fal/veo3-fast-i2v', label: 'Veo 3 Fast (image→video) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/veo3/fast/image-to-video',
    map: { prompt: 'prompt', startImage: 'image_url', durationSec: 'duration', resolution: 'resolution' },
    requires: ['prompt', 'startImage'], durationFormat: 'string', defaults: { generate_audio: true },
    limits: { durations: [8] },
    pricing: { perSecondUsd: 0.4, source: 'estimate' }, output: 'video.url',
    tags: ['image-to-video', 'native-audio'],
  },
  {
    id: 'fal/veo3-fast-t2v', label: 'Veo 3 Fast (text→video) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/veo3/fast',
    map: { prompt: 'prompt', durationSec: 'duration', aspectRatio: 'aspect_ratio', resolution: 'resolution', negativePrompt: 'negative_prompt' },
    requires: ['prompt'], durationFormat: 'string', aspectFormat: 'ratio', defaults: { generate_audio: true },
    limits: { durations: [8], aspects: ['16:9', '9:16'] },
    pricing: { perSecondUsd: 0.4, source: 'estimate' }, output: 'video.url',
    tags: ['text-to-video', 'native-audio'],
  },
  {
    id: 'fal/wan-2.2-i2v', label: 'Wan 2.2 A14B (image→video) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/wan/v2.2-a14b/image-to-video',
    map: { prompt: 'prompt', startImage: 'image_url', resolution: 'resolution', aspectRatio: 'aspect_ratio', negativePrompt: 'negative_prompt' },
    requires: ['prompt', 'startImage'], aspectFormat: 'ratio',
    limits: { durations: [5] },
    pricing: { perSecondUsd: 0.08, source: 'estimate' }, output: 'video.url',
    tags: ['image-to-video', 'cheap-draft'],
  },
  {
    id: 'fal/flux-kontext-pro', label: 'FLUX Kontext Pro (image edit) via fal', provider: 'fal', kind: 'image',
    endpoint: 'fal-ai/flux-pro/kontext',
    map: { prompt: 'prompt', startImage: 'image_url', aspectRatio: 'aspect_ratio', count: 'num_images' },
    requires: ['prompt', 'startImage'], aspectFormat: 'ratio',
    pricing: { perImageUsd: 0.04, source: 'estimate' }, output: 'images.0.url',
    tags: ['anchor', 'reference-edit', 'consistency'],
  },
  {
    id: 'fal/flux-pro-ultra', label: 'FLUX 1.1 Pro Ultra via fal', provider: 'fal', kind: 'image',
    endpoint: 'fal-ai/flux-pro/v1.1-ultra',
    map: { prompt: 'prompt', aspectRatio: 'aspect_ratio', count: 'num_images' },
    requires: ['prompt'], aspectFormat: 'ratio',
    pricing: { perImageUsd: 0.06, source: 'estimate' }, output: 'images.0.url',
    tags: ['anchor', 'photoreal'],
  },
  // ── fal video-to-video / audio (schemas from fal OpenAPI) ──
  {
    id: 'fal/sync-lipsync-v2', label: 'Sync LipSync 2 via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/sync-lipsync/v2',
    map: { sourceVideo: 'video_url', audio: 'audio_url' }, requires: ['sourceVideo', 'audio'],
    pricing: { perSecondUsd: 0.05, source: 'estimate' }, output: 'video.url', tags: ['lipsync'],
  },
  {
    id: 'fal/kling-lipsync', label: 'Kling LipSync (audio→video) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/kling-video/lipsync/audio-to-video',
    map: { sourceVideo: 'video_url', audio: 'audio_url' }, requires: ['sourceVideo', 'audio'],
    pricing: { perSecondUsd: 0.03, source: 'estimate' }, output: 'video.url', tags: ['lipsync'],
  },
  {
    id: 'fal/omnihuman-v1.5', label: 'OmniHuman 1.5 talking photo via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/bytedance/omnihuman/v1.5',
    map: { prompt: 'prompt', startImage: 'image_url', audio: 'audio_url', resolution: 'resolution' }, requires: ['startImage', 'audio'],
    limits: { resolutions: ['720p', '1080p'] },
    pricing: { perSecondUsd: 0.16, source: 'estimate' }, output: 'video.url', tags: ['talking-photo'],
  },
  {
    id: 'fal/kling-ai-avatar-pro', label: 'Kling AI Avatar Pro (talking photo) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/kling-video/v1/pro/ai-avatar',
    map: { prompt: 'prompt', startImage: 'image_url', audio: 'audio_url' }, requires: ['startImage', 'audio'],
    pricing: { perSecondUsd: 0.115, source: 'estimate' }, output: 'video.url', tags: ['talking-photo'],
  },
  {
    id: 'fal/kling-o1-edit', label: 'Kling O1 video edit (recast / element swap) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/kling-video/o1/video-to-video/edit',
    map: { prompt: 'prompt', sourceVideo: 'video_url', referenceImages: 'image_urls' }, requires: ['prompt', 'sourceVideo'],
    defaults: { keep_audio: true },
    pricing: { perSecondUsd: 0.168, source: 'estimate' }, output: 'video.url', tags: ['recast', 'swap'],
  },
  {
    id: 'fal/lucy-edit-pro', label: 'Decart Lucy Edit Pro (recast) via fal', provider: 'fal', kind: 'video',
    endpoint: 'decart/lucy-edit/pro',
    map: { prompt: 'prompt', sourceVideo: 'video_url' }, requires: ['prompt', 'sourceVideo'],
    pricing: { perSecondUsd: 0.1, source: 'estimate' }, output: 'video.url', tags: ['recast'],
  },
  {
    id: 'fal/wan-vace-pose', label: 'Wan VACE 14B pose (prompt-driven restyle, keeps identity weakly) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/wan-vace-14b/pose',
    map: { prompt: 'prompt', sourceVideo: 'video_url', referenceImages: 'ref_image_urls' }, requires: ['prompt', 'sourceVideo'],
    pricing: { perSecondUsd: 0.08, source: 'estimate' }, output: 'video.url', tags: ['restyle'],
  },
  {
    // Puts the character from image_url INTO the source clip (keeps its background, lighting and camera).
    id: 'fal/wan-animate-replace', label: 'Wan 2.2 Animate Replace (character swap into a clip) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/wan/v2.2-14b/animate/replace',
    map: { sourceVideo: 'video_url', startImage: 'image_url', resolution: 'resolution' }, requires: ['sourceVideo', 'startImage'],
    pricing: { perSecondUsd: 0.08, source: 'published' }, output: 'video.url', tags: ['motion-transfer', 'swap'],
  },
  {
    // Animates the still in image_url (its own background) with the source clip's motion.
    id: 'fal/wan-animate-move', label: 'Wan 2.2 Animate Move (animate a still with a clip\'s motion) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/wan/v2.2-14b/animate/move',
    map: { sourceVideo: 'video_url', startImage: 'image_url', resolution: 'resolution' }, requires: ['sourceVideo', 'startImage'],
    pricing: { perSecondUsd: 0.08, source: 'published' }, output: 'video.url', tags: ['motion-transfer'],
  },
  {
    id: 'fal/luma-ray2-modify', label: 'Luma Ray 2 Modify via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/luma-dream-machine/ray-2/modify',
    map: { prompt: 'prompt', sourceVideo: 'video_url', startImage: 'image_url' }, requires: ['sourceVideo'],
    pricing: { perSecondUsd: 0.12, source: 'estimate' }, output: 'video.url', tags: ['recast'],
  },
  {
    id: 'fal/topaz-upscale-video', label: 'Topaz video upscale via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/topaz/upscale/video',
    map: { sourceVideo: 'video_url' }, requires: ['sourceVideo'],
    defaults: { upscale_factor: 2 },
    pricing: { perSecondUsd: 0.08, source: 'estimate' }, output: 'video.url', tags: ['upscale'],
  },
  {
    id: 'fal/mmaudio-v2', label: 'MMAudio v2 (foley / SFX for a clip) via fal', provider: 'fal', kind: 'video',
    endpoint: 'fal-ai/mmaudio-v2',
    map: { prompt: 'prompt', sourceVideo: 'video_url' }, requires: ['prompt', 'sourceVideo'],
    pricing: { perSecondUsd: 0.001, perRequestUsd: 0.01, source: 'estimate' }, output: 'video.url', tags: ['foley'],
  },
  {
    id: 'fal/stable-audio', label: 'Stable Audio (music / SFX) via fal', provider: 'fal', kind: 'audio',
    endpoint: 'fal-ai/stable-audio',
    map: { prompt: 'prompt', durationSec: 'seconds_total' }, requires: ['prompt'],
    limits: { minDurationSec: 1, maxDurationSec: 47 },
    pricing: { perRequestUsd: 0.02, source: 'estimate' }, output: 'audio_file.url', tags: ['music', 'foley'],
  },
  // ── Higgsfield REST (api.higgsfield.ai, schema from docs.higgsfield.ai/docs/openapi.json) ──
  {
    id: 'higgsfield/soul-standard', label: 'Higgsfield Soul', provider: 'higgsfield', kind: 'image',
    endpoint: 'higgsfield-ai/soul/standard',
    map: { prompt: 'prompt', aspectRatio: 'aspect_ratio', count: 'num_images' },
    requires: ['prompt'], aspectFormat: 'ratio', defaults: { resolution: '2K' },
    limits: { aspects: ['1:1', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '16:9', '9:16', '21:9'] },
    pricing: { perImageUsd: 0.06, source: 'estimate' }, output: 'images.0.url',
    tags: ['anchor', 'character', 'fashion', 'photoreal'],
  },
  {
    id: 'higgsfield/kling-v2.5-turbo-pro-i2v', label: 'Kling 2.5 Turbo Pro (image→video) via Higgsfield', provider: 'higgsfield', kind: 'video',
    endpoint: 'kling-video/v2.5-turbo/pro/image-to-video',
    map: { prompt: 'prompt', startImage: 'image_url', durationSec: 'duration', negativePrompt: 'negative_prompt' },
    requires: ['prompt', 'startImage'],
    limits: { durations: [5, 10] },
    pricing: { perSecondUsd: 0.14, source: 'estimate' }, output: 'video.url',
    tags: ['image-to-video', 'premium-motion'],
  },
  {
    id: 'higgsfield/kling-v2.5-turbo-pro-t2v', label: 'Kling 2.5 Turbo Pro (text→video) via Higgsfield', provider: 'higgsfield', kind: 'video',
    endpoint: 'kling-video/v2.5-turbo/pro/text-to-video',
    map: { prompt: 'prompt', durationSec: 'duration', negativePrompt: 'negative_prompt' },
    requires: ['prompt'],
    limits: { durations: [5, 10] },
    pricing: { perSecondUsd: 0.14, source: 'estimate' }, output: 'video.url',
    tags: ['text-to-video', 'premium-motion'],
  },
  {
    id: 'higgsfield/kling-v2.5-turbo-std-i2v', label: 'Kling 2.5 Turbo Standard (image→video) via Higgsfield', provider: 'higgsfield', kind: 'video',
    endpoint: 'kling-video/v2.5-turbo/standard/image-to-video',
    map: { prompt: 'prompt', startImage: 'image_url', durationSec: 'duration', negativePrompt: 'negative_prompt' },
    requires: ['prompt', 'startImage'],
    limits: { durations: [5, 10] },
    pricing: { perSecondUsd: 0.08, source: 'estimate' }, output: 'video.url',
    tags: ['image-to-video'],
  },
  {
    id: 'higgsfield/hailuo-2.3-i2v', label: 'MiniMax Hailuo 2.3 (image→video) via Higgsfield', provider: 'higgsfield', kind: 'video',
    endpoint: 'minimax/hailuo-2.3/standard/image-to-video',
    map: { prompt: 'prompt', startImage: 'image_url', durationSec: 'duration' },
    requires: ['prompt', 'startImage'], defaults: { prompt_optimizer: true },
    limits: { durations: [6, 10] },
    pricing: { perSecondUsd: 0.07, source: 'estimate' }, output: 'video.url',
    tags: ['image-to-video', 'cheap-draft'],
  },
  {
    id: 'higgsfield/hailuo-2.3-t2v', label: 'MiniMax Hailuo 2.3 (text→video) via Higgsfield', provider: 'higgsfield', kind: 'video',
    endpoint: 'minimax/hailuo-2.3/standard/text-to-video',
    map: { prompt: 'prompt', durationSec: 'duration' },
    requires: ['prompt'], defaults: { prompt_optimizer: true },
    limits: { durations: [6, 10] },
    pricing: { perSecondUsd: 0.07, source: 'estimate' }, output: 'video.url',
    tags: ['text-to-video', 'cheap-draft'],
  },
].map((m) => ({ ...m, builtin: true }) as MediaModelManifest);

export function userCatalogDir(): string {
  return path.join(getConfig().getConfigDir(), 'media-models');
}

function isManifest(value: any): value is MediaModelManifest {
  return Boolean(value && typeof value === 'object'
    && typeof value.id === 'string' && value.id.includes('/')
    && ['xai', 'openai', 'fal', 'higgsfield'].includes(value.provider)
    && (value.kind === 'video' || value.kind === 'image' || value.kind === 'audio')
    && typeof value.endpoint === 'string' && value.endpoint.trim()
    && value.map && typeof value.map === 'object');
}

function readUserManifests(): MediaModelManifest[] {
  const dir = userCatalogDir();
  if (!fs.existsSync(dir)) return [];
  const out: MediaModelManifest[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (isManifest(item)) out.push({ ...item, builtin: false });
      }
    } catch { /* skip unreadable manifests */ }
  }
  return out;
}

/** Built-ins merged with user manifests; user manifests override by id. */
export function listModels(filter: { kind?: MediaKind; provider?: string; tag?: string } = {}): MediaModelManifest[] {
  const byId = new Map<string, MediaModelManifest>();
  for (const m of BUILTIN) byId.set(m.id, m);
  for (const m of readUserManifests()) byId.set(m.id, m);
  const endpoints = new Set([...byId.values()].filter((m) => m.provider === 'fal').map((m) => m.endpoint));
  for (const m of syncedFalModels) if (!byId.has(m.id) && !endpoints.has(m.endpoint)) byId.set(m.id, m);
  return [...byId.values()].filter((m) =>
    (!filter.kind || m.kind === filter.kind)
    && (!filter.provider || m.provider === filter.provider)
    && (!filter.tag || (m.tags || []).includes(filter.tag)));
}

/** Updated by fal's read-only catalog sync; curated models always take precedence. */
let syncedFalModels: MediaModelManifest[] = [];
export function setSyncedFalModels(models: MediaModelManifest[]): void { syncedFalModels = models.filter((m) => m.provider === 'fal' && m.kind !== 'image'); }

/** Built-ins and user manifests have priority over synced endpoints. */
export function listCuratedModels(): MediaModelManifest[] {
  return [...BUILTIN, ...readUserManifests()];
}

export function getModel(id: string): MediaModelManifest | undefined {
  const wanted = String(id || '').trim();
  return listModels().find((m) => m.id === wanted);
}

export function saveUserManifest(manifest: MediaModelManifest): string {
  if (!isManifest(manifest)) throw new Error('Invalid model manifest: needs id "<provider>/<slug>", provider, kind, endpoint and map.');
  const dir = userCatalogDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${manifest.id.replace(/[^a-z0-9._-]+/gi, '_')}.json`);
  const { builtin: _b, ...clean } = manifest;
  fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf-8');
  return file;
}

export function removeUserManifest(id: string): boolean {
  const file = path.join(userCatalogDir(), `${String(id).replace(/[^a-z0-9._-]+/gi, '_')}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function estimateCostUsd(model: MediaModelManifest, input: { durationSec?: number; count?: number; resolution?: string; aspectRatio?: string }): number {
  const live = model.provider === 'fal' ? priceForModel(model, input) : undefined;
  if (live !== undefined) return Math.round(live * Math.max(1, Number(input.count) || 1) * 1000) / 1000;
  const p = model.pricing || {};
  const count = Math.max(1, Number(input.count) || 1);
  let usd = Number(p.perRequestUsd || 0);
  if (model.kind !== 'image') {
    const base = Number(p.perSecondUsd || 0) * Math.max(1, Number(input.durationSec) || 5);
    // Seedance's 480p fallback is anchored to observed fal spend; higher resolutions scale by pixel area.
    const pixels = model.endpoint === 'fal-ai/bytedance/seedance/v1/pro/image-to-video'
      ? Math.pow((Number(input.resolution?.match(/\d+/)?.[0]) || 480) / 480, 2) : 1;
    usd += base * pixels;
  }
  else usd += Number(p.perImageUsd || 0);
  return Math.round(usd * count * 1000) / 1000;
}

/** Snap a requested duration onto what the model accepts. */
export function clampDuration(model: MediaModelManifest, requested: number | undefined): number {
  const want = Number(requested) || 5;
  const l = model.limits || {};
  if (l.durations?.length) {
    return l.durations.reduce((best, d) => (Math.abs(d - want) < Math.abs(best - want) ? d : best), l.durations[0]);
  }
  const min = l.minDurationSec ?? 1;
  const max = l.maxDurationSec ?? 15;
  return Math.min(max, Math.max(min, Math.round(want)));
}

// ── Import from published provider schemas ─────────────────────────────

const FIELD_GUESSES: Array<[NeutralField, RegExp]> = [
  ['prompt', /^prompt$/],
  ['negativePrompt', /^negative_prompt$/],
  ['startImage', /^(image_url|start_image_url|first_frame_url|image|input_image)$/],
  ['endImage', /^(end_image_url|last_frame_url|tail_image_url|end_image)$/],
  ['referenceImages', /^(reference_image_urls|image_urls|reference_images)$/],
  ['durationSec', /^duration$/],
  ['aspectRatio', /^aspect_ratio$/],
  ['resolution', /^resolution$/],
  ['count', /^num_images$/],
];

function deref(root: any, schema: any): any {
  let s = schema;
  for (let i = 0; i < 5 && s && s.$ref; i++) {
    const parts = String(s.$ref).replace(/^#\//, '').split('/');
    s = parts.reduce((acc: any, key: string) => acc?.[key], root);
  }
  return s || {};
}

function manifestFromSchema(args: {
  id: string; label?: string; provider: 'fal' | 'higgsfield'; endpoint: string;
  schema: any; root: any; kind?: MediaKind; pricing?: MediaModelManifest['pricing'];
}): MediaModelManifest {
  const props = args.schema.properties || {};
  const required: string[] = args.schema.required || [];
  const map: MediaModelManifest['map'] = {};
  const requires: NeutralField[] = [];
  const limits: NonNullable<MediaModelManifest['limits']> = {};
  let durationFormat: 'number' | 'string' | undefined;
  let durationValues: Array<string | number> | undefined;
  for (const [key, raw] of Object.entries<any>(props)) {
    const field = FIELD_GUESSES.find(([, re]) => re.test(key))?.[0];
    if (!field || map[field]) continue;
    map[field] = key;
    if (required.includes(key)) requires.push(field);
    const def = deref(args.root, raw);
    const enumValues: any[] | undefined = def.enum || def.anyOf?.flatMap((x: any) => deref(args.root, x).enum || []).filter((x: unknown) => x != null);
    if (field === 'durationSec' && enumValues) {
      limits.durations = enumValues.map(Number).filter(Number.isFinite);
      durationFormat = typeof enumValues[0] === 'string' ? 'string' : 'number';
      durationValues = enumValues.filter((value: unknown) => typeof value === 'string' || typeof value === 'number');
    }
    if (field === 'aspectRatio' && enumValues) limits.aspects = enumValues.map(String);
    if (field === 'resolution' && enumValues) limits.resolutions = enumValues.map(String);
  }
  const lowered = `${args.endpoint} ${args.label || ''}`.toLowerCase();
  const kind: MediaKind = args.kind || (/video|i2v|t2v/.test(lowered) ? 'video' : 'image');
  return {
    id: args.id,
    label: args.label || args.endpoint,
    provider: args.provider,
    kind,
    endpoint: args.endpoint,
    map,
    requires,
    limits,
    durationFormat,
    durationValues,
    aspectFormat: 'ratio',
    pricing: args.pricing || { source: 'estimate' },
    output: kind === 'video' ? 'video.url' : 'images.0.url',
    tags: [kind === 'video' ? (map.startImage ? 'image-to-video' : 'text-to-video') : 'image', 'imported'],
    notes: 'Imported from the provider OpenAPI schema. Review pricing before relying on the cost gate.',
  };
}

/**
 * Build (and optionally save) manifests from a provider's published schema.
 * - fal: endpoint id like "fal-ai/kling-video/v2.1/master/image-to-video"
 * - higgsfield: imports every generation path from docs.higgsfield.ai/docs/openapi.json
 *   (pass endpoint to import one path only)
 */
export async function importModelManifests(args: {
  provider: 'fal' | 'higgsfield';
  endpoint?: string;
  save?: boolean;
  pricing?: MediaModelManifest['pricing'];
}): Promise<MediaModelManifest[]> {
  const out: MediaModelManifest[] = [];
  if (args.provider === 'fal') {
    const endpoint = String(args.endpoint || '').trim().replace(/^\/+/, '');
    if (!endpoint) throw new Error('fal import needs endpoint, e.g. fal-ai/kling-video/v2.1/master/image-to-video');
    const schemaEndpoint = endpoint.replace(/^fal-ai\//, '');
    const res = await fetch(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(schemaEndpoint)}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`fal schema fetch failed (${res.status}) for ${endpoint}`);
    const root: any = await res.json();
    const post = root.paths?.[`/${schemaEndpoint}`]?.post;
    if (!post) throw new Error(`fal schema has no submit path for ${endpoint}`);
    const schema = deref(root, post.requestBody?.content?.['application/json']?.schema);
    const slug = endpoint.replace(/^fal-ai\//, '').replace(/\//g, '-');
    out.push(manifestFromSchema({ id: `fal/${slug}`, provider: 'fal', endpoint, schema, root, label: `${endpoint} via fal`, pricing: args.pricing }));
  } else {
    const res = await fetch('https://docs.higgsfield.ai/docs/openapi.json', { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Higgsfield schema fetch failed (${res.status})`);
    const root: any = await res.json();
    for (const [p, def] of Object.entries<any>(root.paths || {})) {
      if (!def.post || p.startsWith('/requests') || p.startsWith('/files')) continue;
      const endpoint = p.replace(/^\/+/, '');
      if (args.endpoint && endpoint !== String(args.endpoint).replace(/^\/+/, '')) continue;
      const schema = deref(root, def.post.requestBody?.content?.['application/json']?.schema);
      out.push(manifestFromSchema({
        id: `higgsfield/${endpoint.replace(/^higgsfield-ai\//, '').replace(/\//g, '-')}`,
        provider: 'higgsfield', endpoint, schema, root,
        label: `${def.post.summary || endpoint} via Higgsfield`, pricing: args.pricing,
      }));
    }
    if (!out.length) throw new Error(`No Higgsfield generation path matched ${args.endpoint || '(all)'}`);
  }
  if (args.save) for (const m of out) saveUserManifest(m);
  return out;
}
