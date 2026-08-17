import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('web-ui/src/components/creative/editor/preview/renderer.js','utf8');
assert.match(source,/const VIDEO_CACHE_LIMIT = 10/);
assert.match(source,/const IMG_CACHE_LIMIT = 64/);
assert.match(source,/function touchMediaCache\(cache, key\)/,'cache hits must refresh LRU order');
assert.match(source,/while \(VIDEO_CACHE\.size > VIDEO_CACHE_LIMIT\)/);
assert.match(source,/video\.removeAttribute\('src'\)/,'evicted video elements must release their media resource');
assert.match(source,/export function clearPreviewMediaCache\(\)/,'editor teardown must have an explicit full-cache release primitive');
console.log('creative preview media cache contract regression: ok');

const editor=fs.readFileSync('web-ui/src/components/creative/editor/index.js','utf8');
assert.match(editor,/clearPreviewMediaCache, createRenderer/,'editor must import media-cache teardown');
assert.match(editor,/clearPreviewMediaCache\(\);\s*layout\.dispose\(\)/,'unmount must release cached media');
