/**
 * Provider transports for the media engine.
 *
 * fal and Higgsfield share one "queue REST" protocol:
 *   submit  POST <base>/<endpoint>            -> { request_id, status_url?, response_url? }
 *   status  GET  <status_url>                 -> { status }
 *   result  GET  <response_url> | status body -> payload with video/images
 * Auth is `Authorization: Key <key>` on both. Only the base URLs, status
 * vocab and result location differ, so one adapter handles both.
 *
 * xAI and OpenAI reuse the existing, battle-tested generateVideo/generateImage
 * registries so their auth (OAuth, Codex, vault) keeps working unchanged.
 */
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config.js';
import { getVault } from '../security/vault.js';
import { resolveVideoInput } from '../video-generation/utils.js';
import { generateVideo } from '../video-generation/registry.js';
import { generateImage } from '../image-generation/registry.js';
import { clampDuration, toPrometheusAspect, toRatio, type MediaModelManifest, type NeutralField } from './catalog.js';
import { hydrateFalModelSchema } from './fal-catalog.js';

export interface ShotInput {
  prompt: string;
  negativePrompt?: string;
  startImage?: string;
  endImage?: string;
  referenceImages?: string[];
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
  count?: number;
  /** Existing clip for video-to-video endpoints (absolute path, URL or data URI). */
  sourceVideo?: string;
  /** Driving audio for lip-sync / talking photo. */
  audio?: string;
  extra?: Record<string, unknown>;
}

export interface SubmitResult {
  /** 'done' when the transport ran synchronously (xAI/OpenAI wrappers). */
  state: 'submitted' | 'done';
  requestId?: string;
  statusUrl?: string;
  responseUrl?: string;
  outputs?: MediaOutput[];
  raw?: unknown;
}

// Only accept explicit USD amounts from fal's result/billing payload. Never infer cost from usage counts.
export function falBilledUsd(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const body = payload as Record<string, unknown>;
  for (const source of [body.billing, body] as unknown[]) {
    if (!source || typeof source !== 'object') continue;
    const row = source as Record<string, unknown>;
    for (const field of ['cost_usd', 'total_cost_usd', 'amount_usd']) {
      const amount = row[field];
      if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) return amount;
    }
  }
  return undefined;
}

export interface MediaOutput {
  url?: string;
  /** Absolute local path when the transport already saved the file. */
  localPath?: string;
  mimeType?: string;
}

export type PollState =
  | { state: 'pending'; progress?: number; raw?: unknown }
  | { state: 'done'; outputs: MediaOutput[]; raw?: unknown }
  | { state: 'failed'; error: string; errorType: string; raw?: unknown };

// ── credentials ─────────────────────────────────────────────────────────

const KEY_SPECS: Record<'fal' | 'higgsfield', { vaultKey: string; env: string[]; hint: string }> = {
  fal: { vaultKey: 'media.fal.api_key', env: ['FAL_KEY', 'FAL_API_KEY'], hint: 'Create one at fal.ai/dashboard/keys.' },
  higgsfield: {
    vaultKey: 'media.higgsfield.api_key',
    env: ['HIGGSFIELD_API_KEY', 'HF_KEY'],
    hint: 'Create one at open.higgsfield.ai/api-keys (format "<key_id>:<key_secret>").',
  },
};

function vault() {
  return getVault(getConfig().getConfigDir());
}

export function getProviderKey(provider: 'fal' | 'higgsfield'): string | undefined {
  const spec = KEY_SPECS[provider];
  try {
    const stored = vault().get(spec.vaultKey, `media-engine:${provider}`);
    const value = stored ? String(stored.expose() || '').trim() : '';
    if (value) return value;
  } catch { /* vault unavailable -> fall through */ }
  const cfg = (getConfig().getConfig() as any)?.media_engine?.providers?.[provider];
  const fromCfg = cfg?.api_key ? String(getConfig().resolveSecret(String(cfg.api_key)) || '').trim() : '';
  if (fromCfg) return fromCfg;
  if (provider === 'higgsfield' && process.env.HIGGSFIELD_API_KEY_ID && process.env.HIGGSFIELD_API_KEY_SECRET) {
    return `${process.env.HIGGSFIELD_API_KEY_ID}:${process.env.HIGGSFIELD_API_KEY_SECRET}`;
  }
  for (const name of spec.env) {
    const v = String(process.env[name] || '').trim();
    if (v) return v;
  }
  return undefined;
}

export function setProviderKey(provider: 'fal' | 'higgsfield', key: string): void {
  const value = String(key || '').trim();
  if (!value) throw new Error('API key is empty.');
  if (provider === 'higgsfield' && !value.includes(':')) {
    throw new Error('Higgsfield keys use "<key_id>:<key_secret>".');
  }
  vault().set(KEY_SPECS[provider].vaultKey, value, 'media-engine:set_key');
}

export function providerKeyHint(provider: 'fal' | 'higgsfield'): string {
  return KEY_SPECS[provider].hint;
}

export async function providerStatus(): Promise<Record<string, { configured: boolean; note?: string }>> {
  const { listVideoGenerationProviders } = await import('../video-generation/registry.js');
  const { listImageGenerationProviders } = await import('../image-generation/registry.js');
  const xai = listVideoGenerationProviders().find((p) => p.id === 'xai');
  const openaiProviders = listImageGenerationProviders().filter((p) => p.id === 'openai' || p.id === 'openai_codex');
  let openaiReady = false;
  for (const p of openaiProviders) {
    try { if (await p.isAvailable()) { openaiReady = true; break; } } catch { /* ignore */ }
  }
  return {
    xai: { configured: xai ? await xai.isAvailable().catch(() => false) : false },
    openai: { configured: openaiReady },
    fal: { configured: Boolean(getProviderKey('fal')), note: getProviderKey('fal') ? undefined : KEY_SPECS.fal.hint },
    higgsfield: { configured: Boolean(getProviderKey('higgsfield')), note: getProviderKey('higgsfield') ? undefined : KEY_SPECS.higgsfield.hint },
  };
}

// ── input mapping ───────────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
};

/** http(s)/data URLs pass through; absolute local files become data URIs. */
export async function toRemoteMedia(ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  if (/^(https?:|data:)/i.test(ref)) return ref;
  if (path.isAbsolute(ref) && fs.existsSync(ref)) {
    const bytes = fs.readFileSync(ref);
    if (bytes.length > 20 * 1024 * 1024) throw new Error(`Input media ${path.basename(ref)} is over 20MB.`);
    const mime = MIME_BY_EXT[path.extname(ref).toLowerCase()] || 'application/octet-stream';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }
  // Fallback: workspace-relative to the active global workspace.
  const resolved = await resolveVideoInput(ref);
  return resolved.url;
}

async function inlineInputs(input: ShotInput): Promise<ShotInput> {
  const refs: string[] = [];
  for (const r of input.referenceImages || []) { const u = await toRemoteMedia(r); if (u) refs.push(u); }
  return {
    ...input,
    startImage: await toRemoteMedia(input.startImage),
    endImage: await toRemoteMedia(input.endImage),
    referenceImages: input.referenceImages ? refs : undefined,
    sourceVideo: await toRemoteMedia(input.sourceVideo),
    audio: await toRemoteMedia(input.audio),
  };
}

/** Pick an exact endpoint enum value, preserving casing; numeric choices use the nearest supported value. */
export function matchEndpointEnum(requested: string | number, allowed: Array<string | number>): string | number | undefined {
  if (!allowed.length) return undefined;
  const exact = allowed.find((value) => String(value).toLowerCase() === String(requested).toLowerCase());
  if (exact !== undefined) return exact;
  const want = Number(String(requested).match(/\d+(?:\.\d+)?/)?.[0] ?? NaN);
  const numeric = allowed.map((value) => ({ value, size: Number(String(value).match(/\d+(?:\.\d+)?/)?.[0] ?? NaN) }))
    .filter((entry) => Number.isFinite(entry.size));
  if (!Number.isFinite(want) || !numeric.length) return undefined;
  return numeric.reduce((best, entry) => Math.abs(entry.size - want) < Math.abs(best.size - want) ? entry : best).value;
}

/** Map neutral shot fields to the endpoint's input body using the manifest. */
export async function buildRequestBody(model: MediaModelManifest, input: ShotInput): Promise<Record<string, unknown>> {
  if (model.source === 'fal-sync') {
    await hydrateFalModelSchema(model);
    if (!model.schemaLoaded) throw new Error(`fal input schema unavailable for ${model.endpoint}; refusing to send unvalidated fields.`);
  }
  const body: Record<string, unknown> = model.source === 'fal-sync' ? {} : { ...(model.defaults || {}) };
  const set = (field: NeutralField, value: unknown) => {
    const key = model.map[field];
    if (!key || value === undefined || value === null || value === '') return;
    body[key] = value;
  };
  set('prompt', input.prompt);
  set('negativePrompt', input.negativePrompt);
  set('startImage', await toRemoteMedia(input.startImage));
  set('endImage', await toRemoteMedia(input.endImage));
  set('sourceVideo', await toRemoteMedia(input.sourceVideo));
  set('audio', await toRemoteMedia(input.audio));
  if (input.referenceImages?.length && model.map.referenceImages) {
    const refs: string[] = [];
    for (const r of input.referenceImages.slice(0, 7)) {
      const url = await toRemoteMedia(r);
      if (url) refs.push(url);
    }
    set('referenceImages', refs);
  }
  if (model.kind !== 'image' && model.map.durationSec) {
    const d = clampDuration(model, input.durationSec);
    const value = model.durationValues?.length ? matchEndpointEnum(d, model.durationValues) : model.durationFormat === 'string' ? String(d) : d;
    if (value !== undefined) set('durationSec', value);
  }
  if (input.aspectRatio) {
    const ratio = toRatio(input.aspectRatio);
    const allowed = model.limits?.aspects;
    if (allowed?.length) {
      const value = allowed.find((entry) => entry.toLowerCase() === ratio.toLowerCase())
        ?? allowed.find((entry) => entry.toLowerCase() === toPrometheusAspect(ratio).toLowerCase());
      if (value !== undefined) set('aspectRatio', value);
    } else if (model.source !== 'fal-sync' || !allowed) {
      set('aspectRatio', model.aspectFormat === 'prometheus' ? toPrometheusAspect(ratio) : ratio);
    }
  }
  if (input.resolution) {
    const allowed = model.limits?.resolutions;
    if (allowed?.length) {
      const value = matchEndpointEnum(input.resolution, allowed);
      if (value !== undefined) set('resolution', value);
    } else if (model.source !== 'fal-sync' && !allowed) set('resolution', input.resolution);
  }
  if (input.count && input.count > 1) set('count', input.count);
  // Extra fields are only safe for curated models; synced models have not validated them against OpenAPI.
  if (model.source !== 'fal-sync') Object.assign(body, input.extra || {});
  return body;
}

export function missingRequiredFields(model: MediaModelManifest, input: ShotInput): NeutralField[] {
  return (model.requires || []).filter((f) => {
    const v = (input as any)[f];
    return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  });
}

// ── queue REST (fal + Higgsfield) ───────────────────────────────────────

const QUEUE_BASE: Record<'fal' | 'higgsfield', string> = {
  fal: 'https://queue.fal.run',
  higgsfield: 'https://api.higgsfield.ai',
};

function queueHeaders(provider: 'fal' | 'higgsfield'): Record<string, string> {
  const key = getProviderKey(provider);
  if (!key) throw Object.assign(new Error(`${provider} API key is not configured. ${providerKeyHint(provider)} Then run video_project set_key.`), { errorType: 'auth_required' });
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text.slice(0, 500) }; }
}

function errorMessage(parsed: any, res: Response): string {
  const detail = parsed?.detail;
  const msg = typeof detail === 'string' ? detail
    : Array.isArray(detail) ? detail.map((d: any) => d?.msg || JSON.stringify(d)).join('; ')
    : parsed?.error?.message || parsed?.error || parsed?.message || parsed?.raw || res.statusText;
  return String(msg || `HTTP ${res.status}`).slice(0, 400);
}

function getPath(obj: any, dotted: string): any {
  return dotted.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

/** Pull media URLs out of a completed payload (manifest path first, then common shapes). */
export function extractOutputs(model: MediaModelManifest, payload: any): MediaOutput[] {
  const urls: string[] = [];
  const push = (v: any) => {
    const u = typeof v === 'string' ? v : v?.url;
    if (typeof u === 'string' && /^https?:|^data:/.test(u) && !urls.includes(u)) urls.push(u);
  };
  if (model.output) push(getPath(payload, model.output));
  push(payload?.video);
  for (const img of Array.isArray(payload?.images) ? payload.images : []) push(img);
  push(payload?.image);
  push(payload?.audio_file);
  push(payload?.audio);
  for (const v of Array.isArray(payload?.videos) ? payload.videos : []) push(v);
  return urls.map((url) => ({ url }));
}

async function submitQueue(model: MediaModelManifest, input: ShotInput): Promise<SubmitResult> {
  const provider = model.provider as 'fal' | 'higgsfield';
  const body = await buildRequestBody(model, input);
  const url = `${QUEUE_BASE[provider]}/${model.endpoint.replace(/^\/+/, '')}`;
  const res = await fetch(url, { method: 'POST', headers: queueHeaders(provider), body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const parsed = await readJson(res);
  if (!res.ok) {
    throw Object.assign(new Error(`${provider} submit failed (${res.status}): ${errorMessage(parsed, res)}`), {
      errorType: res.status === 401 || res.status === 403 ? 'auth_required' : res.status === 422 ? 'invalid_argument' : 'api_error',
    });
  }
  const requestId = String(parsed.request_id || parsed.id || '').trim();
  if (!requestId) throw Object.assign(new Error(`${provider} returned no request_id.`), { errorType: 'empty_response' });
  return {
    state: 'submitted',
    requestId,
    statusUrl: parsed.status_url || (provider === 'higgsfield' ? `${QUEUE_BASE.higgsfield}/requests/${requestId}/status` : undefined),
    responseUrl: parsed.response_url,
    raw: parsed,
  };
}

function falModelRoot(endpoint: string): string {
  // fal status URLs live under the app root: "<owner>/<app>" (first two segments).
  return endpoint.split('/').slice(0, 2).join('/');
}

async function pollQueue(model: MediaModelManifest, job: { requestId: string; statusUrl?: string; responseUrl?: string }): Promise<PollState> {
  const provider = model.provider as 'fal' | 'higgsfield';
  const headers = queueHeaders(provider);
  const statusUrl = job.statusUrl
    || (provider === 'fal'
      ? `${QUEUE_BASE.fal}/${falModelRoot(model.endpoint)}/requests/${job.requestId}/status`
      : `${QUEUE_BASE.higgsfield}/requests/${job.requestId}/status`);
  const res = await fetch(statusUrl, { headers, signal: AbortSignal.timeout(60_000) });
  const parsed = await readJson(res);
  if (!res.ok && res.status !== 202) {
    return { state: 'failed', error: `${provider} status failed (${res.status}): ${errorMessage(parsed, res)}`, errorType: res.status === 401 ? 'auth_required' : 'api_error', raw: parsed };
  }
  const status = String(parsed.status || '').toLowerCase();
  if (provider === 'higgsfield') {
    if (status === 'completed') return { state: 'done', outputs: extractOutputs(model, parsed), raw: parsed };
    if (status === 'nsfw') return { state: 'failed', error: 'Higgsfield flagged the output as NSFW.', errorType: 'moderation', raw: parsed };
    if (status === 'failed' || status === 'canceled') return { state: 'failed', error: String(parsed.error || `Request ${status}.`), errorType: status === 'canceled' ? 'canceled' : 'api_error', raw: parsed };
    return { state: 'pending', raw: parsed };
  }
  // fal: IN_QUEUE | IN_PROGRESS | COMPLETED (errors surface on the response URL)
  if (status === 'completed') {
    const responseUrl = job.responseUrl || parsed.response_url || `${QUEUE_BASE.fal}/${falModelRoot(model.endpoint)}/requests/${job.requestId}`;
    const out = await fetch(responseUrl, { headers, signal: AbortSignal.timeout(60_000) });
    const payload = await readJson(out);
    if (!out.ok) {
      return { state: 'failed', error: `fal result failed (${out.status}): ${errorMessage(payload, out)}`, errorType: out.status === 422 ? 'moderation_or_input' : 'api_error', raw: payload };
    }
    const outputs = extractOutputs(model, payload);
    if (!outputs.length) return { state: 'failed', error: 'fal completed without a media URL.', errorType: 'empty_response', raw: payload };
    return { state: 'done', outputs, raw: payload };
  }
  if (parsed.error) return { state: 'failed', error: String(parsed.error).slice(0, 400), errorType: 'api_error', raw: parsed };
  const queuePos = Number(parsed.queue_position);
  return { state: 'pending', progress: Number.isFinite(queuePos) ? undefined : undefined, raw: parsed };
}

async function cancelQueue(model: MediaModelManifest, job: { requestId: string }): Promise<void> {
  const provider = model.provider as 'fal' | 'higgsfield';
  const url = provider === 'fal'
    ? `${QUEUE_BASE.fal}/${falModelRoot(model.endpoint)}/requests/${job.requestId}/cancel`
    : `${QUEUE_BASE.higgsfield}/requests/${job.requestId}/cancel`;
  await fetch(url, { method: provider === 'fal' ? 'PUT' : 'POST', headers: queueHeaders(provider), signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
}

// ── xAI / OpenAI via existing registries (synchronous from the engine's view) ──

/** Registry request for an xAI video manifest (exported for tests: edit/extend mapping). */
export function registryVideoRequest(model: MediaModelManifest, input: ShotInput, outputDir: string): any {
  const mode = model.mode || (model.defaults?.mode as 'edit' | 'extend' | undefined);
  if (mode) {
    if (!input.sourceVideo) throw Object.assign(new Error(`${model.id} needs sourceVideo (set shot.sourceVideo to a workspace clip or "shotId:takeId").`), { errorType: 'invalid_argument' });
    return {
      prompt: input.prompt || (mode === 'extend' ? 'Continue the shot naturally.' : ''),
      mode, video: input.sourceVideo,
      duration: mode === 'extend' ? clampDuration(model, input.durationSec) : undefined,
      provider: 'xai', model: model.endpoint, output_dir: outputDir,
    };
  }
  return {
    prompt: input.prompt,
    image: input.startImage,
    reference_images: input.startImage ? undefined : input.referenceImages,
    aspect_ratio: toPrometheusAspect(input.aspectRatio),
    duration: clampDuration(model, input.durationSec),
    resolution: input.resolution,
    provider: 'xai',
    model: model.endpoint,
    output_dir: outputDir,
  };
}

async function runViaRegistry(model: MediaModelManifest, input: ShotInput, outputDir: string): Promise<SubmitResult> {
  if (model.kind === 'audio') throw Object.assign(new Error(`${model.provider} has no audio transport.`), { errorType: 'invalid_provider' });
  if (model.kind === 'video') {
    if (model.provider !== 'xai') throw Object.assign(new Error(`${model.provider} has no video transport.`), { errorType: 'invalid_provider' });
    const result = await generateVideo(registryVideoRequest(model, input, outputDir));
    if (!result.success) throw Object.assign(new Error(result.error), { errorType: result.error_type, requestId: result.request_id });
    return { state: 'done', requestId: result.request_id, outputs: [{ localPath: result.video.path, url: result.video_url, mimeType: result.video.mime_type }], raw: { model: result.model } };
  }
  const result = await generateImage({
    prompt: input.prompt,
    reference_images: [input.startImage, ...(input.referenceImages || [])].filter(Boolean) as string[],
    aspect_ratio: toPrometheusAspect(input.aspectRatio),
    size: model.provider === 'openai'
      ? ({ portrait: '1024x1536', landscape: '1536x1024', square: '1024x1024' } as const)[toPrometheusAspect(input.aspectRatio) as 'portrait' | 'landscape' | 'square']
      : undefined,
    count: input.count,
    provider: model.provider === 'openai' ? 'openai_codex' : 'xai',
    model: model.endpoint,
    output_dir: outputDir,
  } as any);
  if (!result.success) throw Object.assign(new Error((result as any).error), { errorType: (result as any).error_type || 'api_error' });
  const images = (result as any).images?.length ? (result as any).images : [(result as any).image];
  return { state: 'done', outputs: images.map((img: any) => ({ localPath: img.path, mimeType: img.mime_type })), raw: { model: (result as any).model, provider: (result as any).provider } };
}

// ── public transport API ────────────────────────────────────────────────

export async function submit(model: MediaModelManifest, input: ShotInput, opts: { outputDir: string }): Promise<SubmitResult> {
  const inlined = await inlineInputs(input);
  if (model.provider === 'fal' || model.provider === 'higgsfield') return submitQueue(model, inlined);
  return runViaRegistry(model, inlined, opts.outputDir);
}

export async function poll(model: MediaModelManifest, job: { requestId: string; statusUrl?: string; responseUrl?: string }): Promise<PollState> {
  if (model.provider === 'fal' || model.provider === 'higgsfield') return pollQueue(model, job);
  return { state: 'failed', error: `${model.provider} jobs run synchronously and cannot be resumed after a restart.`, errorType: 'not_resumable' };
}

export async function cancel(model: MediaModelManifest, job: { requestId: string }): Promise<void> {
  if (model.provider === 'fal' || model.provider === 'higgsfield') await cancelQueue(model, job);
}

/** Download a remote output into the project media folder. */
export async function downloadOutput(output: MediaOutput, destDir: string, baseName: string, kind: 'video' | 'image' | 'audio'): Promise<string> {
  const fallbackExt = kind === 'video' ? '.mp4' : kind === 'audio' ? '.mp3' : '.png';
  if (output.localPath && fs.existsSync(output.localPath)) {
    fs.mkdirSync(destDir, { recursive: true });
    const target = path.join(destDir, `${baseName}${path.extname(output.localPath) || fallbackExt}`);
    fs.copyFileSync(output.localPath, target);
    return target;
  }
  if (!output.url) throw new Error('Output has neither a URL nor a local file.');
  let bytes: Buffer;
  let mime = output.mimeType || '';
  if (output.url.startsWith('data:')) {
    mime = output.url.slice(5, output.url.indexOf(';'));
    bytes = Buffer.from(output.url.slice(output.url.indexOf(',') + 1), 'base64');
  } else {
    const res = await fetch(output.url, { signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok) throw new Error(`Output download failed (${res.status}).`);
    mime = mime || String(res.headers.get('content-type') || '');
    bytes = Buffer.from(await res.arrayBuffer());
  }
  const extFromUrl = output.url.startsWith('data:') ? '' : path.extname(new URL(output.url).pathname);
  const ext = /video\/webm/.test(mime) ? '.webm'
    : /video\//.test(mime) ? '.mp4'
    : /image\/jpe?g/.test(mime) ? '.jpg'
    : /image\/webp/.test(mime) ? '.webp'
    : /image\//.test(mime) ? '.png'
    : /audio\/(wav|x-wav)/.test(mime) ? '.wav'
    : /audio\//.test(mime) ? '.mp3'
    : (extFromUrl || fallbackExt);
  fs.mkdirSync(destDir, { recursive: true });
  const target = path.join(destDir, `${baseName}${ext}`);
  fs.writeFileSync(target, bytes);
  return target;
}
