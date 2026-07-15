import assert from 'assert';
import crypto from 'crypto';
import {
  boundTurnDeliveryFrame,
  boundTurnDeliveryFrameAsync,
  ByteBoundedReplayBuffer,
  jsonUtf8Bytes,
  truncateUtf8,
  truncateUtf8WithSuffix,
  utf8ByteLength,
} from './index';

function testUtf8Truncation(): void {
  const value = 'alpha🙂bravo🧠charlie';
  for (let budget = 0; budget <= utf8ByteLength(value); budget += 1) {
    const truncated = truncateUtf8(value, budget);
    assert.ok(utf8ByteLength(truncated) <= budget, `UTF-8 truncation exceeded ${budget} bytes`);
    assert.ok(!truncated.includes('\uFFFD'), 'UTF-8 truncation introduced a replacement character');
    if (truncated.length > 0) {
      const last = truncated.charCodeAt(truncated.length - 1);
      assert.ok(!(last >= 0xd800 && last <= 0xdbff), 'UTF-8 truncation split a surrogate pair');
    }
  }
  const withSuffix = truncateUtf8WithSuffix('🙂'.repeat(100), 31, '…done');
  assert.ok(utf8ByteLength(withSuffix) <= 31);
  assert.ok(withSuffix.endsWith('…done'));
}

function testNormalPayloadShapeIsPreserved(): void {
  const data = {
    reply: 'Finished normally.',
    mode: 'execute',
    sections: [{ type: 'tool_results', content: 'Finished normally.' }],
    results: [{ name: 'read_file', result: 'small output', error: false }],
    artifacts: [{ path: 'report.txt', kind: 'file' }],
  };
  const bounded = boundTurnDeliveryFrame('done', data);
  assert.equal(bounded.changed, false);
  assert.deepEqual(bounded.data, data);
  assert.deepEqual(bounded.frame, { type: 'done', ...data });
  assert.equal(bounded.replacements.length, 0);
}

function testOversizedToolResultsAndReferences(): void {
  const large = `BEGIN:${'🙂tool-output/'.repeat(12_000)}:END`;
  const refs: string[] = [];
  const bounded = boundTurnDeliveryFrame('done', {
    reply: 'The task is complete.',
    mode: 'execute',
    results: [{ name: 'shell_command', result: large, error: false }],
  }, {
    limits: { doneBytes: 48 * 1024, maxToolResultBytes: 4 * 1024, previewBytes: 512 },
    createReference: (candidate) => {
      const ref = `blob:test/${candidate.sha256}`;
      refs.push(ref);
      return ref;
    },
  });
  assert.ok(bounded.changed);
  assert.ok(bounded.bytes <= 48 * 1024);
  const results = bounded.data.results as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(results));
  assert.equal(results[0].name, 'shell_command');
  assert.equal(typeof results[0].result, 'string', 'tool result string shape must remain compatible');
  assert.ok(String(results[0].result).includes('delivery truncated'));
  assert.ok(String(results[0].result).includes('ref=blob:test/'));
  assert.ok(!String(results[0].result).endsWith(':END'));
  assert.ok(refs.length >= 1);
  assert.ok(bounded.replacements.some((entry) => entry.kind === 'tool_result' && entry.ref?.startsWith('blob:test/')));
}

function testBinaryAndBase64AreNotInlined(): void {
  const base64 = Buffer.alloc(80 * 1024, 7).toString('base64');
  const bounded = boundTurnDeliveryFrame('final', {
    text: 'Image generated.',
    generatedImages: [{ dataUrl: `data:image/png;base64,${base64}` }],
    raw: Buffer.alloc(10 * 1024, 3),
  }, {
    limits: { finalBytes: 40 * 1024, maxInlineBinaryBytes: 1024 },
  });
  const serialized = JSON.stringify(bounded.frame);
  assert.ok(bounded.changed);
  assert.ok(!serialized.includes(base64.slice(0, 1024)), 'base64 body leaked into bounded frame');
  assert.ok(serialized.includes('delivery omitted image/png content'));
  assert.ok(serialized.includes('binary_omitted'));
  assert.ok(bounded.replacements.some((entry) => entry.kind === 'base64' && entry.mediaType === 'image/png'));
  assert.ok(bounded.replacements.some((entry) => entry.kind === 'binary'));

  const referenced = boundTurnDeliveryFrame('final', {
    text: 'Image generated.',
    generatedImages: [{ dataUrl: `data:image/png;base64,${base64}` }],
  }, {
    limits: { finalBytes: 40 * 1024, maxInlineBinaryBytes: 1024 },
    createReference: (candidate) => candidate.mediaType === 'image/png'
      ? `/api/turn-blobs/${candidate.sha256}`
      : null,
  });
  assert.equal(
    ((referenced.data.generatedImages as Array<Record<string, unknown>>)[0]).dataUrl,
    `/api/turn-blobs/${referenced.replacements.find((entry) => entry.kind === 'base64')?.sha256}`,
    'persisted media should remain URL-compatible for existing clients',
  );

  const internalReference = boundTurnDeliveryFrame('final', {
    generatedImages: [{ dataUrl: `data:image/svg+xml;base64,${base64}` }],
  }, {
    limits: { finalBytes: 40 * 1024, maxInlineBinaryBytes: 1024 },
    createReference: () => 'turnblob:sha256:deadbeef',
  });
  assert.match(
    String(((internalReference.data.generatedImages as Array<Record<string, unknown>>)[0]).dataUrl),
    /delivery omitted image\/svg\+xml content/,
    'an internal content reference must not be substituted into a client URL field',
  );
}

function testConfiguredFrameLimits(): void {
  const hugeUnicode = '🧪'.repeat(100_000);
  const cases: Array<{ type: string; key: string; limit: number }> = [
    { type: 'tool_progress', key: 'message', limit: 8 * 1024 },
    { type: 'final', key: 'text', limit: 12 * 1024 },
    { type: 'done', key: 'reply', limit: 10 * 1024 },
  ];
  for (const entry of cases) {
    const bounded = boundTurnDeliveryFrame(entry.type, {
      [entry.key]: hugeUnicode,
      results: Array.from({ length: 40 }, (_, index) => ({ index, result: hugeUnicode })),
    }, {
      limits: {
        progressBytes: entry.limit,
        finalBytes: entry.limit,
        doneBytes: entry.limit,
        maxStringBytes: 64 * 1024,
        maxToolResultBytes: 8 * 1024,
      },
    });
    assert.ok(bounded.bytes <= entry.limit, `${entry.type} exceeded configured frame limit`);
    assert.equal(bounded.bytes, jsonUtf8Bytes(bounded.frame));
    const serialized = JSON.stringify(bounded.frame);
    assert.ok(!serialized.includes('\uFFFD'));
  }
}

function testCyclesBecomeBoundedMetadata(): void {
  const cycle: Record<string, unknown> = { label: 'cycle' };
  cycle.self = cycle;
  const bounded = boundTurnDeliveryFrame('tool_progress', { state: cycle });
  assert.ok(bounded.changed);
  assert.deepEqual((bounded.data.state as Record<string, unknown>).self, { $prometheusDelivery: 'cycle_omitted' });
  assert.ok(bounded.replacements.some((entry) => entry.kind === 'cycle'));
}

function testOmittedStructuresAreNotFullyReadOrStringified(): void {
  let arrayReads = 0;
  const largeArray: unknown[] = [];
  largeArray.length = 2_000;
  for (let index = 0; index < largeArray.length; index += 1) {
    Object.defineProperty(largeArray, index, {
      enumerable: true,
      configurable: true,
      get: () => {
        arrayReads += 1;
        return { index };
      },
    });
  }
  const boundedArray = boundTurnDeliveryFrame('done', { results: largeArray }, {
    limits: { maxArrayItems: 16 },
  });
  assert.ok(boundedArray.changed);
  assert.equal(arrayReads, 16, 'omitted array entries must never be read by byte estimation');

  let objectReads = 0;
  const largeObject: Record<string, unknown> = {};
  for (let index = 0; index < 6_000; index += 1) {
    Object.defineProperty(largeObject, `key_${index}`, {
      enumerable: true,
      configurable: true,
      get: () => {
        objectReads += 1;
        return index;
      },
    });
  }
  const boundedObject = boundTurnDeliveryFrame('done', { result: largeObject }, {
    limits: { maxObjectKeys: 16 },
  });
  assert.ok(boundedObject.changed);
  assert.equal(objectReads, 16, 'omitted object getters must never run during bounded scanning');
  assert.equal(
    ((boundedObject.data.result as Record<string, any>).$prometheusDelivery as Record<string, unknown>).countIsLowerBound,
    true,
    'a capped key scan must not claim an exact omitted-key count',
  );
}

function testGlobalValueVisitBudget(): void {
  const nested = Array.from({ length: 40 }, (_, outer) => (
    Array.from({ length: 40 }, (_, inner) => ({ outer, inner, text: 'small' }))
  ));
  const bounded = boundTurnDeliveryFrame('done', { results: nested }, {
    limits: { maxVisitedValues: 25, maxArrayItems: 40 },
  });
  assert.ok(bounded.changed);
  assert.ok(
    bounded.replacements.some((entry) => entry.kind === 'structure'),
    'the global visit budget must replace the unvisited tail with bounded metadata',
  );
}

function testSynchronousHugeValuesUseBoundedPreviews(): void {
  const hugeText = 'x'.repeat(8 * 1024 * 1024);
  let referenceCalls = 0;
  const visitedOut = boundTurnDeliveryFrame('tool_progress', { first: true, hugeText }, {
    limits: { maxVisitedValues: 2 },
    createReference: () => {
      referenceCalls += 1;
      return 'turnblob:sha256:unexpected';
    },
  });
  assert.equal(referenceCalls, 0, 'visit-budget diagnostics must not hash or reference a giant unvisited string');
  assert.ok(visitedOut.changed);
  assert.ok(visitedOut.bytes <= visitedOut.limitBytes);
  assert.ok(visitedOut.replacements.some((entry) => entry.bytes === hugeText.length));

  const hugeKey = `key_${'k'.repeat(2 * 1024 * 1024)}`;
  let hugeKeyGetterReads = 0;
  const hugeKeyObject: Record<string, unknown> = {};
  Object.defineProperty(hugeKeyObject, hugeKey, {
    enumerable: true,
    get: () => {
      hugeKeyGetterReads += 1;
      return 'must not be read';
    },
  });
  const keyed = boundTurnDeliveryFrame('done', { nested: hugeKeyObject });
  const nestedKeys = Object.keys(keyed.data.nested as Record<string, unknown>);
  assert.equal(nestedKeys.length, 1);
  assert.ok(nestedKeys[0].length <= 512, 'transport keys must be summarized before JSON fitting');
  assert.match(nestedKeys[0], /prometheusKeyOmitted/);
  assert.ok(keyed.replacements.some((entry) => entry.path.includes('$key')));
  assert.equal(hugeKeyGetterReads, 0, 'a giant omitted-key getter must never be invoked');

  const hugeBase64 = Buffer.alloc(6 * 1024 * 1024, 5).toString('base64');
  const media = boundTurnDeliveryFrame('final', {
    generatedImages: [{ dataUrl: `data:image/png;base64,${hugeBase64}` }],
    raw: Buffer.alloc(2 * 1024 * 1024, 9),
  }, {
    createReference: () => {
      referenceCalls += 1;
      return 'turnblob:sha256:unexpected';
    },
  });
  assert.equal(referenceCalls, 0, 'synchronous delivery must not derive refs for giant media/buffers');
  assert.ok(media.replacements.some((entry) => entry.kind === 'base64' && !entry.sha256));
  assert.ok(media.replacements.some((entry) => entry.kind === 'binary' && !entry.sha256));
  assert.ok(media.bytes <= media.limitBytes);
}

async function testAsyncLargeStringMaterializationYields(): Promise<void> {
  const value = `${'large-final-😀'.repeat(500_000)}tail`;
  const expectedDigest = crypto.createHash('sha256').update(value).digest('hex');
  let candidateDigest = '';
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 0);
  try {
    const bounded = await boundTurnDeliveryFrameAsync('done', { reply: value }, {
      limits: { doneBytes: 32 * 1024, maxStringBytes: 8 * 1024, previewBytes: 512 },
      createReference: async (candidate) => {
        candidateDigest = candidate.sha256;
        await new Promise<void>((resolve) => setImmediate(resolve));
        return `turnblob:sha256:${candidate.sha256}`;
      },
    });
    assert.ok(ticks > 2, 'large terminal strings must yield to socket/heartbeat timers while hashing');
    assert.equal(candidateDigest, expectedDigest, 'chunked UTF-8 hashing must retain the canonical digest');
    assert.ok(bounded.changed);
    assert.ok(bounded.bytes <= bounded.limitBytes);
    assert.match(String(bounded.data.reply), /ref=turnblob:sha256:/);
  } finally {
    clearInterval(timer);
  }
}

function testByteBoundedReplayBuffer(): void {
  const buffer = new ByteBoundedReplayBuffer<{ type: string; text: string }>({
    maxBytes: 360,
    maxEntries: 3,
    initialSequence: 7,
  });
  const first = buffer.append({ type: 'progress', text: 'a'.repeat(70) }, 100);
  const second = buffer.append({ type: 'progress', text: 'b'.repeat(70) }, 101);
  const third = buffer.append({ type: 'progress', text: 'c'.repeat(70) }, 102);
  const fourth = buffer.append({ type: 'done', text: 'd'.repeat(70) }, 103);
  assert.deepEqual([first.seq, second.seq, third.seq, fourth.seq], [7, 8, 9, 10]);
  const stats = buffer.stats();
  assert.ok(stats.bytes <= stats.maxBytes);
  assert.ok(stats.entries <= 3);
  assert.ok(stats.droppedThroughSeq >= 7);
  assert.deepEqual(buffer.after(8).map((record) => record.seq), buffer.snapshot().filter((record) => record.seq > 8).map((record) => record.seq));

  const snap = buffer.snapshot();
  if (snap.length) snap[0].data.text = 'caller mutation';
  assert.notEqual(buffer.snapshot()[0]?.data.text, 'caller mutation', 'stored byte accounting must be mutation-safe');

  const beforeClearNext = buffer.stats().nextSeq;
  buffer.clear();
  const afterClear = buffer.append({ type: 'done', text: 'after clear' }, 104);
  assert.equal(afterClear.seq, beforeClearNext, 'clear must not reset monotonic sequence numbers');
  assert.throws(
    () => buffer.append({ type: 'done', text: 'x'.repeat(1000) }),
    /exceeding the 360-byte buffer limit/,
  );
}

async function main(): Promise<void> {
  testUtf8Truncation();
  testNormalPayloadShapeIsPreserved();
  testOversizedToolResultsAndReferences();
  testBinaryAndBase64AreNotInlined();
  testConfiguredFrameLimits();
  testCyclesBecomeBoundedMetadata();
  testOmittedStructuresAreNotFullyReadOrStringified();
  testGlobalValueVisitBudget();
  testSynchronousHugeValuesUseBoundedPreviews();
  await testAsyncLargeStringMaterializationYields();
  testByteBoundedReplayBuffer();
  console.log('turn-delivery regression: ok');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
