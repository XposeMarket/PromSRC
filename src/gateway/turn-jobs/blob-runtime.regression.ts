import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DeliveryReferenceCandidate } from '../turn-delivery/bounded-payload.js';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-turn-data-uri-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  try {
    const {
      createTurnDeliveryReferenceAsync,
      readTurnBlobByHash,
    } = await import('./blob-runtime.js');
    const body = Buffer.alloc(10 * 1024 * 1024, 0x5a);
    const value = `data:image/png;base64,${body.toString('base64')}`;
    const candidate: DeliveryReferenceCandidate = {
      kind: 'base64',
      path: '$.generatedImages[0].dataUrl',
      bytes: Buffer.byteLength(value, 'utf8'),
      sha256: crypto.createHash('sha256').update(value).digest('hex'),
      mediaType: 'image/png',
      value,
    };

    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 0);
    let ref: string | null = null;
    try {
      ref = await createTurnDeliveryReferenceAsync(candidate);
    } finally {
      clearInterval(timer);
    }
    assert.ok(ticks > 2, 'base64 decoding, hashing, and persistence must yield to gateway timers');
    assert.match(String(ref), /^\/api\/turn-blobs\/[a-f0-9]{64}\?/);
    const hash = String(ref).match(/\/api\/turn-blobs\/([a-f0-9]{64})/)?.[1] || '';
    assert.equal(hash, crypto.createHash('sha256').update(body).digest('hex'));
    const stored = readTurnBlobByHash(hash);
    assert.equal(stored.descriptor.contentType, 'image/png');
    assert.deepEqual(stored.body, body);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log('turn blob-runtime streamed-data-uri regression: ok');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
