from pathlib import Path
p=Path('web-ui/src/components/creative/editor/preview/renderer.js')
text=p.read_text(encoding='utf-8')
old="""const VIDEO_CACHE = new Map(); // src -> HTMLVideoElement

const IMG_CACHE = new Map(); // src → HTMLImageElement

function loadImage(src, markDirty) {
  src = normalizeMediaSrc(src);
  if (IMG_CACHE.has(src)) return IMG_CACHE.get(src);
  const img = new Image();
"""
new="""const VIDEO_CACHE = new Map(); // src -> HTMLVideoElement, insertion order is LRU order
const IMG_CACHE = new Map(); // src → HTMLImageElement, insertion order is LRU order
const VIDEO_CACHE_LIMIT = 10;
const IMG_CACHE_LIMIT = 64;

function touchMediaCache(cache, key) {
  const value = cache.get(key);
  if (!value) return null;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function pruneImageCache() {
  while (IMG_CACHE.size > IMG_CACHE_LIMIT) {
    const oldest = IMG_CACHE.keys().next().value;
    if (!oldest) break;
    IMG_CACHE.delete(oldest);
  }
}

function releaseVideo(video) {
  try { video.pause(); } catch {}
  try {
    video.removeAttribute('src');
    video.load();
  } catch {}
}

function pruneVideoCache() {
  while (VIDEO_CACHE.size > VIDEO_CACHE_LIMIT) {
    const oldest = VIDEO_CACHE.keys().next().value;
    if (!oldest) break;
    const video = VIDEO_CACHE.get(oldest);
    VIDEO_CACHE.delete(oldest);
    if (video) releaseVideo(video);
  }
}

export function clearPreviewMediaCache() {
  IMG_CACHE.clear();
  for (const video of VIDEO_CACHE.values()) releaseVideo(video);
  VIDEO_CACHE.clear();
}

function loadImage(src, markDirty) {
  src = normalizeMediaSrc(src);
  const cached = touchMediaCache(IMG_CACHE, src);
  if (cached) return cached;
  const img = new Image();
"""
if old not in text: raise SystemExit('media cache declaration anchor not found')
text=text.replace(old,new,1)
old_img="""  IMG_CACHE.set(src, img);
  return img;
}

function loadVideo(src, markDirty) {
  src = normalizeMediaSrc(src);
  if (VIDEO_CACHE.has(src)) return VIDEO_CACHE.get(src);
  const video = document.createElement('video');
"""
new_img="""  IMG_CACHE.set(src, img);
  pruneImageCache();
  return img;
}

function loadVideo(src, markDirty) {
  src = normalizeMediaSrc(src);
  const cached = touchMediaCache(VIDEO_CACHE, src);
  if (cached) return cached;
  const video = document.createElement('video');
"""
if old_img not in text: raise SystemExit('image/video loader anchor not found')
text=text.replace(old_img,new_img,1)
old_vid="""  VIDEO_CACHE.set(src, video);
  return video;
}
"""
new_vid="""  VIDEO_CACHE.set(src, video);
  pruneVideoCache();
  return video;
}
"""
if old_vid not in text: raise SystemExit('video cache set anchor not found')
text=text.replace(old_vid,new_vid,1)
p.write_text(text,encoding='utf-8')

reg=Path('scripts/test-creative-preview-media-cache.mjs')
reg.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('web-ui/src/components/creative/editor/preview/renderer.js','utf8');
assert.match(source,/const VIDEO_CACHE_LIMIT = 10/);
assert.match(source,/const IMG_CACHE_LIMIT = 64/);
assert.match(source,/function touchMediaCache\(cache, key\)/,'cache hits must refresh LRU order');
assert.match(source,/while \(VIDEO_CACHE\.size > VIDEO_CACHE_LIMIT\)/);
assert.match(source,/video\.removeAttribute\('src'\)/,'evicted video elements must release their media resource');
assert.match(source,/export function clearPreviewMediaCache\(\)/,'editor teardown must have an explicit full-cache release primitive');
console.log('creative preview media cache contract regression: ok');
''',encoding='utf-8')
print('creative preview media cache patch applied')