import assert from 'node:assert/strict';
import sharp from 'sharp';
import { normalizeAnthropicImage } from './anthropic-image';

import { AnthropicAdapter } from './anthropic-adapter';

async function main() {
  const jpeg = await sharp({ create: { width: 2500, height: 1400, channels: 3, background: '#386fa4' } })
    .jpeg({ quality: 92 }).toBuffer();
  const normalizedJpeg = await normalizeAnthropicImage(jpeg.toString('base64'), 'image/png');
  assert.ok(normalizedJpeg, 'valid JPEG bytes should be retained');
  assert.equal(normalizedJpeg.media_type, 'image/jpeg', 'magic bytes must override a mismatched declaration');
  assert.deepEqual(
    [ (await sharp(Buffer.from(normalizedJpeg.data, 'base64')).metadata()).width, (await sharp(Buffer.from(normalizedJpeg.data, 'base64')).metadata()).height ],
    [2000, 1120],
    'images should be scaled to a 2000px longest side',
  );

  const largePng = await sharp({ create: { width: 1300, height: 1300, channels: 3, background: '#e8c942' } })
    .png({ compressionLevel: 0 }).toBuffer();
  assert.ok(largePng.toString('base64').length > 4 * 1024 * 1024, 'fixture should exceed the outbound image budget');
  const normalizedPng = await normalizeAnthropicImage(largePng.toString('base64'), 'image/jpeg');
  assert.ok(normalizedPng, 'oversized valid image should be re-encoded, not dropped');
  assert.equal(normalizedPng.media_type, 'image/jpeg', 'large images should be transcoded to compact JPEG');
  assert.ok(normalizedPng.data.length <= 4 * 1024 * 1024, 'normalized base64 must fit below Anthropic limit');
  assert.equal(await normalizeAnthropicImage('', 'image/jpeg'), null, 'empty images should be rejected safely');
  assert.equal(await normalizeAnthropicImage('not base64', 'image/png'), null, 'corrupt images should be rejected safely');

  const adapter = new AnthropicAdapter({ providerId: 'anthropic', apiKey: 'test' });
  const built = await (adapter as any).buildMessages([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: jpeg.toString('base64') } },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${jpeg.toString('base64')}` } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'bad' } },
    ],
  }]);
  const content = built.messages[0].content;
  assert.equal(content[0].source.media_type, 'image/jpeg', 'native image blocks should be normalized before sending');
  assert.equal(content[1].source.media_type, 'image/jpeg', 'data URLs should also be magic-byte checked');
  assert.match(content[2].text, /Image omitted/, 'a corrupt image should become an omission note instead of failing the turn');

  console.log('Anthropic image normalization regression tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
