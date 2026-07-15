import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TurnJobBlobStore } from './blob-store.js';

function nextImmediate(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

async function observeRawStagingSizes<T>(root: string, operation: Promise<T>): Promise<{ result: T; sizes: Set<number> }> {
  const sizes = new Set<number>();
  let settled = false;
  void operation.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  const stagingDir = path.join(root, '.staging');
  while (!settled) {
    try {
      for (const name of fs.readdirSync(stagingDir)) {
        if (!name.endsWith('.raw.tmp')) continue;
        try {
          const size = fs.statSync(path.join(stagingDir, name)).size;
          if (size > 0) sizes.add(size);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT' && code !== 'EPERM') throw error;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await nextImmediate();
  }
  return { result: await operation, sizes };
}

class ObservedUint8Array extends Uint8Array {
  subarrayCalls = 0;
  yieldedBetweenSlices = false;
  private firstSliceYielded = false;

  override subarray(begin?: number, end?: number): Uint8Array {
    this.subarrayCalls += 1;
    if (this.subarrayCalls === 1) {
      setImmediate(() => { this.firstSliceYielded = true; });
    } else if (this.firstSliceYielded) {
      this.yieldedBetweenSlices = true;
    }
    return super.subarray(begin, end);
  }
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-turn-blob-'));
  try {
    const store = new TurnJobBlobStore(root, { compressionThresholdBytes: 1_024 });
    const payload = {
      z: 'tail',
      // Exercise escaping inside one huge scalar, including a surrogate pair
      // that straddles the serializer's nominal chunk boundary and a lone
      // surrogate that JSON.stringify must escape.
      a: `${'q'.repeat((32 * 1024) - 1)}😀\ud800\u0000\n${'x"\\\n😀'.repeat(400_000)}`,
    };

    const jsonObservation = await observeRawStagingSizes(
      root,
      store.putJsonAsync(payload, { compress: false }),
    );
    const asyncDescriptor = jsonObservation.result;
    assert.ok(
      jsonObservation.sizes.size >= 2,
      'one huge JSON string must be escaped and staged across event-loop turns',
    );
    assert.deepEqual(store.getJson(asyncDescriptor.ref), payload);

    const syncDescriptor = store.putJson(payload, { compress: false });
    assert.equal(syncDescriptor.ref, asyncDescriptor.ref, 'sync and async canonical JSON must be content-identical');

    const text = `${'plain😀'.repeat(400_000)}\ud800`;
    const textObservation = await observeRawStagingSizes(
      root,
      store.putTextAsync(text, { compress: false }),
    );
    assert.ok(textObservation.sizes.size >= 2, 'large plain text must be UTF-8 encoded cooperatively');
    assert.equal(textObservation.result.ref, store.putText(text, { compress: false }).ref);
    assert.equal(store.getText(textObservation.result.ref), `${'plain😀'.repeat(400_000)}�`);

    const bytes = new ObservedUint8Array(8 * 1024 * 1024);
    bytes.fill(7);
    const bufferObservation = await observeRawStagingSizes(
      root,
      store.putBufferAsync(bytes, { compress: false }),
    );
    const first = bufferObservation.result;
    assert.ok(bufferObservation.sizes.size >= 2, 'large buffers must be copied and hashed across event-loop turns');
    assert.ok(bytes.subarrayCalls > 2, 'large buffers must be consumed in bounded slices');
    assert.equal(bytes.yieldedBetweenSlices, true, 'the event loop must tick between source buffer slices');
    const originalGetBuffer = store.getBuffer;
    (store as any).getBuffer = () => {
      throw new Error('immutable reuse must not reread the complete body');
    };
    const reused = store.putBuffer(bytes, { compress: false });
    assert.equal(reused.ref, first.ref);
    (store as any).getBuffer = originalGetBuffer;
    assert.deepEqual(store.getBuffer(first.ref), Buffer.from(bytes));

    const raceBytes = Buffer.alloc(3 * 1024 * 1024, 11);
    const raceDescriptors = await Promise.all(
      Array.from({ length: 6 }, () => store.putBufferAsync(raceBytes)),
    );
    assert.equal(new Set(raceDescriptors.map((entry) => entry.ref)).size, 1);
    assert.equal(raceDescriptors[0].encoding, 'gzip');
    assert.deepEqual(store.getBuffer(raceDescriptors[0].ref), raceBytes);

    const boundedStore = new TurnJobBlobStore(path.join(root, 'bounded'), { maxBlobBytes: 1_024 });
    await assert.rejects(
      boundedStore.putTextAsync('x'.repeat(2_048), { compress: false }),
      /exceeds 1024 byte limit/,
    );

    for (const stagingRoot of [path.join(root, '.staging'), path.join(root, 'bounded', '.staging')]) {
      assert.deepEqual(fs.readdirSync(stagingRoot), [], 'successful, racing, and rejected writes must clean staging files');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log('turn blob-store async-boundary regression: ok');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
