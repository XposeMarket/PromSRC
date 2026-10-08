import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveCast } from './library.js';
import { characterRefs, refLimitFor, OPENAI_REF_LIMIT, DEFAULT_REF_LIMIT } from './refs.js';

const ws = mkdtempSync(path.join(tmpdir(), 'cast-refs-'));
try {
  const src = path.join(ws, 'pack'); mkdirSync(src, { recursive: true });
  const names = ['face.png', ...Array.from({ length: 15 }, (_, i) => `ref${String(i + 1).padStart(2, '0')}.png`)];
  for (const n of names) writeFileSync(path.join(src, n), 'x');
  const cast = saveCast(ws, { name: 'Edna', anchors: ['pack/face.png'], refs: names.slice(1).map((n) => `pack/${n}`) });

  // Cast-linked project character: the live pack wins over the project's stale single copy.
  const projChar = { anchors: ['pack/face.png'], refs: [] as string[], castId: cast.id };
  const all = characterRefs(ws, projChar);
  assert.equal(all.length, 16, 'anchor + all 15 pack refs');
  assert.equal(all[0], cast.anchors[0], 'anchor first');
  assert.ok(!all.includes('pack/face.png'), 'stale project copy does not waste a slot');
  assert.equal(new Set(all).size, all.length, 'deduped');

  // Limits: OpenAI gets 16, everything else 5.
  assert.equal(refLimitFor({ provider: 'openai', id: 'openai/gpt-image' } as any), OPENAI_REF_LIMIT);
  assert.equal(refLimitFor({ provider: 'xai', id: 'xai/grok-imagine-image-2.0' } as any), DEFAULT_REF_LIMIT);
  assert.equal(characterRefs(ws, projChar, 5).length, 5);

  // Unlinked character: anchors + refs, missing files dropped.
  const loose = characterRefs(ws, { anchors: ['pack/face.png'], refs: ['pack/ref01.png', 'pack/missing.png'] });
  assert.deepEqual(loose, ['pack/face.png', 'pack/ref01.png']);

  // Pack updates reach linked characters without touching the project.
  saveCast(ws, { id: cast.id, name: 'Edna', refs: [...cast.refs, 'pack/face.png'] });
  assert.equal(characterRefs(ws, projChar).length, 16);
  console.log('cast-refs regression: ok');
} finally {
  rmSync(ws, { recursive: true, force: true });
}
