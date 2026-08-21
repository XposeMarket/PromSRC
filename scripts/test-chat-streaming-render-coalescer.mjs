import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'web-ui/src/features/chat/streaming/render-coalescer.js');
const generatedPath = path.join(root, 'generated/public-web-ui/static/features/chat/streaming/render-coalescer.js');

assert.equal(
  fs.readFileSync(sourcePath, 'utf8'),
  fs.readFileSync(generatedPath, 'utf8'),
  'stream coalescer source must match its public mirror',
);

const mod = await import(`${pathToFileURL(sourcePath).href}?test=${Date.now()}`);
assert.equal(mod.STREAM_RENDER_THROTTLE_MS, 180);

let immediate = 0;
mod.scheduleStreamingRenderFor('', () => { immediate += 1; });
assert.equal(immediate, 1, 'invalid session ids should preserve the existing immediate-render fallback');

let scheduled = 0;
mod.scheduleStreamingRenderFor('session-a', () => { scheduled += 1; });
mod.scheduleStreamingRenderFor('session-a', () => { scheduled += 10; });
await new Promise((resolve) => setTimeout(resolve, mod.STREAM_RENDER_THROTTLE_MS + 80));
assert.equal(scheduled, 1, 'multiple renders for one session inside the throttle window should coalesce');

let flushed = 0;
mod.scheduleStreamingRenderFor('session-b', () => { flushed += 100; });
mod.flushStreamingRenderFor('session-b', () => { flushed += 1; });
assert.equal(flushed, 1, 'flush should cancel the pending cosmetic render and paint final state immediately');
await new Promise((resolve) => setTimeout(resolve, mod.STREAM_RENDER_THROTTLE_MS + 80));
assert.equal(flushed, 1, 'a flushed pending render must not fire later');

console.log('Chat streaming render coalescer contract passed.');
