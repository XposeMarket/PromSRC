// A raw ~12 MB phone screenshot sent inline used to reach Anthropic untouched
// and the whole turn died with "image exceeds 10 MB maximum" (and every later
// turn too, because the image stayed in history). Inline/steer attachments are
// now resized, and the adapter drops any straggler instead of failing.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { normalizeRuntimeVisionAttachments } from './attachment-context';

async function main() {
  const noise = Buffer.alloc(3000 * 2200 * 3);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) >>> 24;
  const huge = await sharp(noise, { raw: { width: 3000, height: 2200, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(huge.length > 10 * 1024 * 1024, `fixture should exceed 10 MB, got ${huge.length}`);
  const [out] = await normalizeRuntimeVisionAttachments([{ base64: huge.toString('base64'), mimeType: 'image/png', name: 'IMG.png' }]);
  assert.ok(out, 'attachment kept');
  assert.ok(out.base64.length < 5 * 1024 * 1024, `normalized base64 under 5 MB, got ${out.base64.length}`);
  assert.equal(out.name, 'IMG.png');
  const meta = await sharp(Buffer.from(out.base64, 'base64')).metadata();
  assert.ok(Math.max(meta.width || 0, meta.height || 0) <= 2000, 'long edge capped');

  const small = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#f00' } }).png().toBuffer();
  const [same] = await normalizeRuntimeVisionAttachments([{ base64: `data:image/png;base64,${small.toString('base64')}`, mimeType: 'image/png' }]);
  assert.equal(same.base64, small.toString('base64'), 'small images pass through (data: prefix stripped)');
  assert.equal((await normalizeRuntimeVisionAttachments([{ base64: '', mimeType: 'image/png' }])).length, 0, 'empty dropped');

  const { AnthropicAdapter } = await import('../../providers/anthropic-adapter') as any;
  if (AnthropicAdapter) {
    const adapter = Object.create(AnthropicAdapter.prototype);
    const built = adapter.buildMessages.call(adapter, [
      { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(6 * 1024 * 1024) } }] },
    ], true);
    const parts = built.messages[0].content;
    assert.ok(!parts.some((p: any) => p.type === 'image'), 'oversized image dropped by adapter');
    assert.ok(parts.some((p: any) => /Image omitted/.test(p.text || '')), 'adapter leaves a note');
  }
  console.log('runtime vision attachments regression: ok');
}

main().catch((error) => { console.error(error); process.exit(1); });
