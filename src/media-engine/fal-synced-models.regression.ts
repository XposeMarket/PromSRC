import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { estimateCostUsd, setSyncedFalModels, type MediaModelManifest } from './catalog.js';
import { buildRequestBody, falBilledUsd, matchEndpointEnum } from './providers.js';
import { createProject, loadProject, mutateProject, type Job } from './project.js';
import { estimate, generateShots, reconcileProjectSpend } from './engine.js';

async function main(): Promise<void> {
const model: MediaModelManifest = {
  id: 'fal/minimax/h3-max/text-to-video', label: 'MiniMax H3 Max', provider: 'fal',
  endpoint: 'fal-ai/minimax/h3-max/text-to-video', kind: 'video', source: 'fal-sync',
  map: { prompt: 'prompt', durationSec: 'duration', resolution: 'resolution' }, requires: ['prompt'],
  pricing: { unit: 'seconds', unitPriceUsd: 0.03, source: 'live' },
};
assert.equal(matchEndpointEnum('480p', ['480P', '768P', '1080P']), '480P');
assert.equal(matchEndpointEnum('720p', ['480P', '768P', '1080P']), '768P');
assert.equal(matchEndpointEnum('small', ['480P', '768P']), undefined);
assert.equal(matchEndpointEnum(7, [5, 10]), 5);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = (async (url: string | URL | Request) => {
    assert.match(String(url), /endpoint_id=minimax%2Fh3-max%2Ftext-to-video/);
    return new Response(JSON.stringify({
      paths: { '/minimax/h3-max/text-to-video': { post: {
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Input' } } } },
      } } },
      components: { schemas: { Input: { properties: {
        prompt: { type: 'string' }, resolution: { $ref: '#/components/schemas/Resolution' },
        aspect_ratio: { enum: ['Landscape', 'Portrait', 'Square'] },
        duration: { anyOf: [{ enum: ['5', '10'] }, { type: 'null' }] },
      } }, Resolution: { enum: ['480P', '768P', '1080P'] } } },
    }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await buildRequestBody(model, { prompt: 'shot', resolution: '480p', durationSec: 7 }),
    { prompt: 'shot', resolution: '480P', duration: '5' });
  assert.equal((await buildRequestBody(model, { prompt: 'shot', resolution: '720p', durationSec: 10 })).resolution, '768P');
  assert.deepEqual(await buildRequestBody({ ...model, map: { ...model.map, aspectRatio: 'aspect_ratio', endImage: 'end_image_url' }, schemaLoaded: false },
    { prompt: 'shot', resolution: '480p', aspectRatio: 'portrait', endImage: 'https://example.test/end.png', extra: { surprise: 1 } }),
    { prompt: 'shot', resolution: '480P', duration: '5', aspect_ratio: 'Portrait' });
  assert.equal((await buildRequestBody({ ...model, limits: { resolutions: [] }, schemaLoaded: true }, { prompt: 'shot', resolution: '480p' })).resolution, undefined);
} finally { globalThis.fetch = originalFetch; }

assert.equal(falBilledUsd({ billing: { cost_usd: 0.11 } }), 0.11);
assert.equal(falBilledUsd({ cost_usd: 0 }), 0);
assert.equal(falBilledUsd({ usage: { seconds: 5 } }), undefined);
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fal-synced-reg-'));
try {
  const project = await createProject(ws, { title: 'fal pricing', target: { resolution: '480p' }, defaults: { videoModel: model.id }, budget: { autoApproveUsd: 1 } });
  const now = Date.now();
  const job = (id: string, state: Job['state'], estimateUsd: number): Job => ({
    id, target: { shotId: 'shot_1' }, modelId: model.id,
    input: { prompt: 'shot', durationSec: 5, resolution: '480p' }, count: 1,
    state, estimateUsd, takeIds: [], createdAt: now, updatedAt: now,
  });
  await mutateProject(ws, project.id, 'regression.fixture', (p) => {
    p.shots.push({ id: 'shot_1', title: 'Shot 1', prompt: 'shot', durationSec: 5,
      characterIds: [], styleIds: [], takes: [], status: 'planned' } as any);
    p.jobs.push(job('failed_1', 'failed', 7.92), job('done_1', 'done', 7.92),
      { ...job('billed_1', 'done', 7.92), billedUsd: 0.11 });
    p.budget.spentUsd = 7.92;
  });
  setSyncedFalModels([model]);
  const repaired = await reconcileProjectSpend(ws, project.id);
  assert.equal(repaired.budget.spentUsd, 0.26);
  assert.equal(repaired.jobs.find((j) => j.id === 'done_1')?.actualUsd, 0.15);
  assert.equal(repaired.jobs.find((j) => j.id === 'billed_1')?.actualUsd, 0.11);
  assert.equal(repaired.jobs.find((j) => j.id === 'failed_1')?.actualUsd, undefined);
  assert.equal((await estimate(ws, project.id, { modelId: model.id })).shots[0].usd, 0.15);
  assert.equal(loadProject(ws, project.id).budget.spentUsd, 0.26);
  assert.equal(estimateCostUsd(model, { durationSec: 5 }), 0.15);
  const unknown = { ...model, id: 'fal/unknown-test', endpoint: 'fal-ai/unknown-test', pricing: { source: 'estimate' as const } };
  setSyncedFalModels([model, unknown]);
  await mutateProject(ws, project.id, 'regression.unknown', (p) => { p.shots[0].modelId = unknown.id; });
  const approval = await generateShots(ws, project.id, {});
  assert.equal(approval.needsApproval, true);
  assert.match(approval.reason || '', /unknown pricing/);
} finally { fs.rmSync(ws, { recursive: true, force: true }); }
console.log('fal synced model schema, enum, quote, billed cost, approval, and budget regression passed');
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
