// Regression: iOS "Save video" must be able to call navigator.share inside the
// tap. That requires the file to be fetched once ahead of time (warm cache),
// concurrent warm + tap requests to share one download, and NotAllowedError to
// become a "tap again" outcome instead of a red error.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'web-ui/src/share-file-cache.js'), 'utf8');
const tmp = path.join(os.tmpdir(), `share-file-cache-${process.pid}.mjs`);
fs.writeFileSync(tmp, src);
const mod = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

class FakeFile { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts?.type; } }
let fetches = 0;
const fetchImpl = async (url) => {
  fetches += 1;
  await new Promise((r) => setTimeout(r, 5));
  if (url.includes('missing')) return { ok: false, status: 404, headers: { get: () => null } };
  if (url.includes('huge')) return { ok: true, status: 200, headers: { get: () => String(500 * 1024 * 1024) }, blob: async () => ({ type: 'video/mp4' }) };
  return { ok: true, status: 200, headers: { get: () => '10' }, blob: async () => ({ type: url.includes('octet') ? 'application/octet-stream' : 'video/mp4' }) };
};
const cache = mod.createShareFileCache({ fetchImpl, FileCtor: FakeFile, max: 2 });

// Cold: nothing cached, so the tap path must not find a file.
assert.equal(cache.get('/a.mp4'), null);
assert.equal(cache.has('/a.mp4'), false);

// Warm + tap at the same time share one download.
const [f1, f2] = await Promise.all([cache.load('/a.mp4', 'a.mp4'), cache.load('/a.mp4', 'a.mp4')]);
assert.equal(fetches, 1, 'concurrent loads dedupe');
assert.equal(f1, f2);
assert.equal(cache.get('/a.mp4'), f1, 'warmed file is available synchronously');
assert.equal(f1.type, 'video/mp4');

// Generic octet-stream falls back to the caller's type.
const f3 = await cache.load('/octet.mp4', 'o.mp4', 'video/mp4');
assert.equal(f3.type, 'video/mp4');

// LRU cap: oldest entry evicted.
await cache.load('/c.mp4', 'c.mp4');
assert.equal(cache.size(), 2);
assert.equal(cache.has('/a.mp4'), false, 'oldest evicted');

// Failures do not poison the cache and can be retried.
await assert.rejects(cache.load('/missing.mp4', 'm.mp4'), /404/);
assert.equal(cache.has('/missing.mp4'), false);
await assert.rejects(cache.load('/huge.mp4', 'h.mp4'), (e) => e.name === 'TooLargeError');

// shareOrDownloadFile outcomes.
const file = new FakeFile([], 'x.mp4', { type: 'video/mp4' });
const setNav = (nav) => Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
let shared = null;
setNav({ canShare: () => true, share: async (data) => { shared = data; } });
assert.equal(await mod.shareOrDownloadFile(file, { download: () => assert.fail('no download') }), 'shared');
assert.deepEqual(Object.keys(shared), ['files'], 'no title/text: iOS hides Save Video otherwise');

setNav({ canShare: () => true, share: async () => { const e = new Error('not allowed'); e.name = 'NotAllowedError'; throw e; } });
assert.equal(await mod.shareOrDownloadFile(file, { download: () => assert.fail('no download') }), 'needs-tap');

setNav({ canShare: () => true, share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } });
assert.equal(await mod.shareOrDownloadFile(file), 'cancelled');

let downloaded = 0;
setNav({});
assert.equal(await mod.shareOrDownloadFile(file, { download: () => { downloaded += 1; } }), 'downloaded');
assert.equal(downloaded, 1, 'desktop falls back to download');

// Wiring: both save surfaces use the shared cache, and the old pre-share
// download-then-share path is gone from the canvas sheet.
const shell = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-shell.js'), 'utf8');
const utils = fs.readFileSync(path.join(root, 'web-ui/src/utils.js'), 'utf8');
assert.match(shell, /shareFileCache\.get\(href\)/);
assert.match(utils, /shareFileCache\.get\(src\)/);
assert.doesNotMatch(shell, /navigator\.share\(\{ files: \[file\], title: filename \}\)/);

console.log('test-inline-video-save: ok');

// Regression (behavioral): inline video warms on play only. loadedmetadata must
// clear a stale failure state and must NOT warm or touch retries; play warms once.
{
  const utilsSrc = fs.readFileSync(path.join(root, 'web-ui/src/utils.js'), 'utf8');
  const start = utilsSrc.indexOf('  const isPhone = ()');
  const end = utilsSrc.indexOf("  document.addEventListener('loadedmetadata', onVideoReady, true);");
  assert.ok(start > 0 && end > start, 'inline video handler block found in utils.js');
  class FakeVideo {}
  let loads = 0;
  const cache = { has: () => false, load: () => { loads += 1; return Promise.resolve(); } };
  const onVideoReady = new Function(
    'document', 'navigator', 'HTMLVideoElement', 'shareFileCache',
    `${utilsSrc.slice(start, end)}\nreturn onVideoReady;`,
  )({ body: { classList: { contains: () => true } } }, { userAgent: 'iPhone' }, FakeVideo, cache);
  let failedCleared = false;
  const btn = { getAttribute: (k) => (k === 'data-save-src' ? '/api/clip.mp4' : k === 'data-workspace-path' ? 'clip.mp4' : null), classList: { add() {} } };
  const figure = { classList: { remove() { failedCleared = true; } }, querySelector: () => btn };
  const video = Object.assign(Object.create(FakeVideo.prototype), {
    classList: { contains: () => true },
    closest: () => figure,
    dataset: { retries: '1' },
  });
  onVideoReady({ type: 'loadedmetadata', target: video });
  assert.equal(loads, 0, 'metadata does not warm');
  assert.equal(failedCleared, true, 'metadata clears failure state');
  assert.equal(video.dataset.retries, '1', 'metadata does not reset retries');
  onVideoReady({ type: 'play', target: video });
  assert.equal(loads, 1, 'play warms exactly once');
  console.log('PASS inline video warms on play only (metadata: 0 warm, play: 1 warm)');
}

// Regression: oversize body rejected even without Content-Length (chunked/Funnel).
{
  const big = mod.createShareFileCache({
    fetchImpl: async () => ({ ok: true, headers: new Map(), blob: async () => ({ size: 200, type: 'video/mp4' }) }),
    FileCtor: FakeFile,
    maxBytes: 100,
  });
  await assert.rejects(big.load('/api/big.mp4', 'big.mp4'), (err) => err.name === 'TooLargeError');
  assert.equal(big.has('/api/big.mp4'), false, 'oversize file is not cached');
  console.log('PASS oversize blob without Content-Length rejected as TooLargeError');
}
