import assert from 'node:assert/strict';
import sharpModule from 'sharp';
import { normalizeVisionImageBuffer, VISION_MAX_EDGE_PX } from './vision-image-normalize';

const sharp: any = (sharpModule as any)?.default || sharpModule;

async function main() {
  // Full-res iPhone portrait photo dimensions that broke Anthropic (limit 8000px).
  const phone = await sharp({ create: { width: 4536, height: 8064, channels: 3, background: '#3a6ea5' } }).jpeg({ quality: 90 }).toBuffer();
  const out = await normalizeVisionImageBuffer(phone, 'image/jpeg');
  assert.equal(out.resized, true);
  assert.ok((out.height || 0) <= VISION_MAX_EDGE_PX && (out.width || 0) <= VISION_MAX_EDGE_PX, `got ${out.width}x${out.height}`);
  assert.equal(out.height, VISION_MAX_EDGE_PX);
  assert.equal(out.mimeType, 'image/jpeg');
  const meta = await sharp(Buffer.from(out.base64, 'base64')).metadata();
  assert.equal(meta.height, VISION_MAX_EDGE_PX);

  // Small screenshot passes through byte-identical.
  const small = await sharp({ create: { width: 390, height: 844, channels: 3, background: '#000' } }).png().toBuffer();
  const smallOut = await normalizeVisionImageBuffer(small, 'image/png');
  assert.equal(smallOut.reencoded, false);
  assert.equal(smallOut.base64, small.toString('base64'));

  // Wide PNG with alpha stays PNG after downscale.
  const wide = await sharp({ create: { width: 9000, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const wideOut = await normalizeVisionImageBuffer(wide, 'image/png');
  assert.equal(wideOut.mimeType, 'image/png');
  assert.equal(wideOut.width, VISION_MAX_EDGE_PX);

  // Garbage input is returned unchanged instead of throwing.
  const junk = Buffer.from('not an image');
  const junkOut = await normalizeVisionImageBuffer(junk, 'image/png');
  assert.equal(junkOut.base64, junk.toString('base64'));

  console.log('vision-image-normalize regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
