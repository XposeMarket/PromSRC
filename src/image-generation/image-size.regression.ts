import assert from 'node:assert/strict';
import sharp from 'sharp';
import { cropImageToRequestedSize, resolveOpenAIImageSize } from './utils.js';

async function main() {
  for (const [input, aspect, apiSize, target] of [
    ['1024x1024', 'square', '1024x1024', [1024, 1024]],
    ['1024x1536', 'portrait', '1024x1536', [1024, 1536]],
    ['1536x1024', 'landscape', '1536x1024', [1536, 1024]],
    ['9:16', 'portrait', '1024x1536', [1024, 1536]],
    ['16:9', 'landscape', '1536x1024', [1536, 1024]],
    ['800x1200', 'portrait', '1024x1536', [800, 1200]],
  ] as const) {
    assert.deepEqual(resolveOpenAIImageSize(input, aspect), { apiSize, target: { width: target[0], height: target[1] } });
  }
  assert.deepEqual(resolveOpenAIImageSize('auto', 'landscape'), { apiSize: 'auto' });

  // A portrait source must be cropped to landscape rather than mislabeled or stretched.
  const source = await sharp({ create: { width: 1086, height: 1448, channels: 3, background: '#327acc' } }).png().toBuffer();
  const output = await cropImageToRequestedSize(source, { width: 1536, height: 1024 });
  const metadata = await sharp(output).metadata();
  assert.deepEqual([metadata.width, metadata.height], [1536, 1024]);
  assert.strictEqual(await cropImageToRequestedSize(output, { width: 1536, height: 1024 }), output);
  const vertical = await cropImageToRequestedSize(source, { width: 1024, height: 1536 });
  assert.deepEqual([ (await sharp(vertical).metadata()).width, (await sharp(vertical).metadata()).height ], [1024, 1536]);
  console.log('PASS OpenAI image size mapping, auto, centered cover crop, and exact-size preservation');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
