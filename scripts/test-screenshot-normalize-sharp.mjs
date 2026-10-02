// sharp fast path must match the jimp fallback contract (dimensions, scale,
// mime, byte budget) and be meaningfully faster on a desktop-sized frame.
// Run: npx tsx scripts/test-screenshot-normalize-sharp.mjs
import assert from 'node:assert/strict';
import Jimp from 'jimp';

const mod = await import('../src/gateway/screenshot-normalize.ts');
const { normalizeScreenshotBuffer, readImageSize, cropImageBuffer, loadSharp } = mod;

const W = 3440, H = 1440;
const img = new Jimp(W, H, 0xffffffff);
for (let y = 0; y < H; y += 40) for (let x = 0; x < W; x += 3) img.setPixelColor(Jimp.rgbaToInt((x * 7 + y) & 0xff, 0x66, 0x99, 0xff), x, y);
const png = await img.getBufferAsync(Jimp.MIME_PNG);

assert.deepEqual(await readImageSize(png), { width: W, height: H });
const cropped = await cropImageBuffer(png, 100, 50, 640, 360);
assert.deepEqual(await readImageSize(cropped), { width: 640, height: 360 });

const opts = { maxSide: 2400, maxBytes: 5 * 1024 * 1024, preferJpeg: true, jpegQualityStart: 82, jpegQualityMin: 55 };
assert.ok(loadSharp(), 'sharp should load in this install');
let t = performance.now();
const fast = await normalizeScreenshotBuffer(png, opts);
const fastMs = performance.now() - t;

process.env.PROMETHEUS_SCREENSHOT_SHARP = '0';
const fresh = await import(`../src/gateway/screenshot-normalize.ts?nosharp=${Date.now()}`);
t = performance.now();
const slow = await fresh.normalizeScreenshotBuffer(png, opts);
const slowMs = performance.now() - t;

for (const r of [fast, slow]) {
  assert.equal(r.width, 2400);
  assert.equal(r.height, Math.round(H * 2400 / W));
  assert.ok(Math.abs(r.scaleX - W / 2400) < 0.01 && Math.abs(r.scaleY - H / r.height) < 0.01);
  assert.ok(r.mimeType === 'image/jpeg' || r.mimeType === 'image/png');
  assert.ok(r.bytes <= opts.maxBytes);
  assert.ok(r.normalized === true);
  assert.deepEqual(await readImageSize(r.buffer), { width: r.width, height: r.height });
}
assert.ok(fastMs < slowMs, `sharp ${fastMs.toFixed(0)}ms should beat jimp ${slowMs.toFixed(0)}ms`);
console.log(`screenshot normalize tests passed (sharp ${fastMs.toFixed(0)}ms vs jimp ${slowMs.toFixed(0)}ms).`);
