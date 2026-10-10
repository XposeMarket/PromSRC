/**
 * fal catalog completeness: dotted endpoint ids (seedance-2.5, veo3.1, kling v2.6, wan-3.0) must sync,
 * and reference-style array inputs (image_urls / video_urls) must map from the real OpenAPI schema.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncFalModels, hydrateFalModelSchema } from './fal-catalog.js';
import { getModel, isVerifiedModel } from './catalog.js';
import { buildRequestBody } from './providers.js';
import { refLimitFor } from './refs.js';

// Run with PROMETHEUS_DATA_DIR pointed at a temp dir (the test only writes the fal catalog cache).
const dataDir = process.env.PROMETHEUS_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'fal-full-catalog-'));
process.env.PROMETHEUS_DATA_DIR = dataDir;

const SEEDANCE = 'bytedance/seedance-2.5/reference-to-video';
const listing = {
  models: [
    { endpoint_id: SEEDANCE, metadata: { category: 'image-to-video', display_name: 'Seedance 2.5 Reference', status: 'active' } },
    { endpoint_id: 'fal-ai/veo3.1/fast/image-to-video', metadata: { category: 'image-to-video', display_name: 'Veo 3.1 Fast', status: 'active' } },
    { endpoint_id: 'fal-ai/kling-video/v2.6/pro/motion-control', metadata: { category: 'video-to-video', display_name: 'Kling 2.6', status: 'active' } },
    { endpoint_id: 'evil/../escape', metadata: { category: 'text-to-video', status: 'active' } },
  ],
  has_more: false,
};
const openapi = {
  paths: { [`/${SEEDANCE}`]: { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/In' } } } } } } },
  components: { schemas: { In: { properties: {
    prompt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    image_urls: { type: 'array', items: { type: 'string' }, maxItems: 9 },
    video_urls: { type: 'array', items: { type: 'string' } },
    audio_urls: { type: 'array', items: { type: 'string' } },
    resolution: { type: 'string', enum: ['480p', '720p', '1080p'] },
    aspect_ratio: { type: 'string', enum: ['auto', '16:9', '9:16'] },
    duration: { type: 'string', enum: ['auto', '4', '5', '6', '8', '10'] },
  } } } },
};

let listingCalls = 0;
globalThis.fetch = (async (input: any) => {
  const url = String(input instanceof URL ? input.href : input);
  if (url.includes('/v1/models/pricing')) return new Response(JSON.stringify({ prices: [] }), { status: 200 });
  if (url.includes('/v1/models')) {
    listingCalls++;
    if (listingCalls === 1) return new Response('{"error":"Too Many Requests"}', { status: 429 });
    return new Response(JSON.stringify(listing), { status: 200 });
  }
  if (url.includes('openapi.json')) return new Response(JSON.stringify(openapi), { status: 200 });
  return new Response('not found', { status: 404 });
}) as typeof fetch;

async function main() {

  const res = await syncFalModels(true);
  assert.ok(!res.stale, `sync failed: ${res.error}`);
  assert.ok(listingCalls >= 2, '429 must be retried, not treated as a failed category');

  // 1. dotted ids sync; path traversal still rejected
  const sd = getModel(`fal/${SEEDANCE}`);
  assert.ok(sd, 'Seedance 2.5 (dotted id) must be in the catalog');
  assert.ok(getModel('fal/fal-ai/veo3.1/fast/image-to-video'), 'Veo 3.1 must be in the catalog');
  assert.ok(getModel('fal/fal-ai/kling-video/v2.6/pro/motion-control'), 'Kling 2.6 must be in the catalog');
  assert.equal(getModel('fal/evil/../escape'), undefined, 'path traversal ids stay rejected');

  // 2. schema hydration maps reference arrays and makes the model verified
  assert.equal(isVerifiedModel(sd), false, 'unverified until schema is loaded');
  await hydrateFalModelSchema(sd!);
  assert.equal(sd!.map.referenceImages, 'image_urls');
  assert.equal(sd!.map.sourceVideo, 'video_urls');
  assert.equal(sd!.map.audio, 'audio_urls');
  assert.equal(sd!.map.startImage, undefined, 'image_url does not exist on this endpoint');
  assert.equal(sd!.limits?.maxRefs, 9);
  assert.deepEqual(sd!.requires, ['prompt']);
  assert.equal(isVerifiedModel(sd), true, 'schema-backed synced model is verified');
  assert.equal(refLimitFor(sd), 9);

  // 3. request body wraps single media into arrays and caps refs at maxItems
  const refs = Array.from({ length: 15 }, (_, i) => `https://cdn.example/ref${i}.png`);
  const body = await buildRequestBody(sd!, {
    prompt: 'Edna does the reel', referenceImages: refs, sourceVideo: 'https://cdn.example/reel.mp4',
    durationSec: 5, resolution: '720p', aspectRatio: '9:16',
  });
  assert.deepEqual(body.video_urls, ['https://cdn.example/reel.mp4']);
  assert.equal((body.image_urls as string[]).length, 9);
  assert.equal(body.resolution, '720p');
  assert.equal(body.aspect_ratio, '9:16');
  assert.equal(body.duration, '5');
  assert.equal(body.image_url, undefined);
  assert.equal(body.video_url, undefined);

  // 4. cache carries a version so pre-fix caches (missing every dotted model) are rebuilt
  const cache = JSON.parse(fs.readFileSync(path.join(process.env.PROMETHEUS_DATA_DIR!, '.prometheus', 'cache', 'fal-video-catalog.json'), 'utf8'));
  assert.equal(cache.version, 2);

  console.log('fal-full-catalog regression: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
