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
  assert.match(content[2].text, /image omitted/i, 'a corrupt image should become an omission note instead of failing the turn');

  assert.strictEqual(await normalizeAnthropicImage(`data:image/png;base64,${jpeg.toString('base64')}`), normalizedJpeg,
    'data URLs and raw bytes must reuse the same cached normalization');
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff000080' } }).png().toBuffer();
  const image = (data: string, media_type: string) => ({ type: 'image', source: { type: 'base64', media_type, data } });
  const history: any[] = [
    { role: 'user', content: [image(png.toString('base64'), 'image/jpeg')] },
    { role: 'assistant', content: 'Inspecting.', tool_calls: [{ id: 'vision_1', type: 'function', function: { name: 'vision', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'vision_1', content: [
      { type: 'text', text: 'Captured image' }, image(jpeg.toString('base64'), 'image/png'),
      image('garbage', 'image/png'), image(`data:image/jpeg;base64,${png.toString('base64')}`, 'image/jpeg'),
    ] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'native-history', content: [image(jpeg.toString('base64'), 'image/png')] },
      { type: 'image_url', image_url: { url: 'https://example.invalid/expired.png' } },
      { type: 'image', source: { type: 'url', url: 'https://example.invalid/oversized.jpg' } },
      { type: 'text', text: 'Continue from stored history' },
    ] },
  ];
  const assistantReplay = await (adapter as any).buildMessages([
    { role: 'assistant', content: [image(jpeg.toString('base64'), 'image/png')], tool_calls: [{ id: 'assistant_vision', type: 'function', function: { name: 'vision', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'assistant_vision', content: 'Done' },
  ]);
  assert.equal(assistantReplay.messages[0].content[0].source.media_type, 'image/jpeg', 'assistant tool-use history must normalize too');
  const originalHistory = JSON.stringify(history);
  for (const replayAdapter of [adapter, new AnthropicAdapter({ providerId: 'compatible', apiKey: 'test', baseUrl: 'https://example.invalid' }), new AnthropicAdapter({ configDir: '.' })]) {
    for (let replay = 0; replay < 2; replay++) {
      const request = await (replayAdapter as any).buildMessages(history);
      assert.equal(request.messages[2].content[0].type, 'tool_result', 'tool_result must remain first');
      assert.equal(request.messages[2].content[0].content[0].text, 'Captured image', 'tool text and block order must survive');
      let imageCount = 0;
      let omissions = 0;
      const check = async (blocks: any[]) => {
        for (const block of blocks) {
          if (block.type === 'image') {
            imageCount++;
            assert.equal(block.source.type, 'base64');
            assert.equal(block.source.media_type, 'image/jpeg');
            const bytes = Buffer.from(block.source.data, 'base64');
            assert.equal(bytes.toString('base64'), block.source.data);
            assert.ok(bytes.length < 5 * 1024 * 1024);
            assert.equal((await sharp(bytes).metadata()).format, 'jpeg');
          }
          if (block.type === 'text' && /image omitted/i.test(block.text)) omissions++;
          if (Array.isArray(block.content)) await check(block.content);
        }
      };
      for (const message of request.messages) if (Array.isArray(message.content)) await check(message.content);
      assert.equal(imageCount, 4, 'user, tool result, data URI and nested stored result must all survive as JPEG');
      assert.equal(omissions, 3, 'garbage and both unchecked remote URL formats must become placeholders');
    }
  }
  assert.equal(JSON.stringify(history), originalHistory, 'replay must not mutate stored history');
  const concurrent = await Promise.all([normalizeAnthropicImage(png.toString('base64')), normalizeAnthropicImage(png.toString('base64'))]);
  assert.ok(concurrent[0]);
  assert.strictEqual(concurrent[0], concurrent[1], 'concurrent callers reuse cached normalized objects');

  console.log('Anthropic image normalization regression tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
