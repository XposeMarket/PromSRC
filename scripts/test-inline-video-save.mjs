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
