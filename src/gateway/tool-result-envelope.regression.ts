import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-tool-result-envelope-'));
process.env.PROMETHEUS_DATA_DIR = tempRoot;

async function main(): Promise<void> {
  const {
    GATEWAY_TOOL_RESULT_INLINE_MAX_CHARS,
    envelopeOversizedToolResult,
    readRawToolResult,
    readRawToolResultRange,
  } = await import('./tool-result-envelope');
  const { createToolObservation } = await import('./tool-observations');

  for (const size of [100_000, 600_000, 1_000_000]) {
    const secret = `secret-${size}`;
    const raw = JSON.stringify({
      api_key: secret,
      rows: 'x'.repeat(size),
      tail: `tail-${size}`,
    });
    const original = {
      name: 'connector_fixture',
      args: { page: 1 },
      result: raw,
      error: false,
      extra: { keep: true, telemetry: { resultChars: raw.length, resultBytes: Buffer.byteLength(raw) } },
      data: { cursor: 'next' },
      artifacts: [{ type: 'file', path: `fixture-${size}.json` }],
    };
    const bounded = await envelopeOversizedToolResult(original, { sessionId: 'session/envelope', toolName: original.name });
    const metadata = bounded.extra?.toolResultEnvelope;

    assert.equal(metadata?.bounded, true);
    assert.equal(metadata?.rawPersistence, 'stored');
    assert.equal(metadata?.originalChars, raw.length);
    assert.equal(metadata?.originalBytes, Buffer.byteLength(raw));
    assert.equal(metadata?.sha256, crypto.createHash('sha256').update(raw).digest('hex'));
    assert.match(String(metadata?.rawRef || ''), /^tool-result-raw:session_envelope-[a-f0-9]{16}\//);
    assert.ok(bounded.result.length <= GATEWAY_TOOL_RESULT_INLINE_MAX_CHARS);
    assert.ok(!bounded.result.includes(secret), 'bounded preview must scrub secret-shaped values');
    assert.deepEqual(bounded.data, original.data);
    assert.deepEqual(bounded.artifacts, original.artifacts);
    assert.equal(bounded.extra.keep, true);
    assert.equal(bounded.extra.telemetry.resultChars, raw.length);
    assert.equal(await readRawToolResult(String(metadata.rawRef)), raw);
    const firstRange = await readRawToolResultRange({
      rawRef: String(metadata.rawRef),
      sessionId: 'session/envelope',
      maxChars: 1_000,
    });
    assert.ok(firstRange.content.length <= 1_000);
    assert.ok(Number(firstRange.nextOffsetBytes) > 0);
    assert.equal(firstRange.totalBytes, Buffer.byteLength(raw));
    await assert.rejects(() => readRawToolResultRange({
      rawRef: String(metadata.rawRef),
      sessionId: 'different/session',
    }), /does not belong to the current session/);
    const observation = createToolObservation({
      sessionId: 'session/envelope',
      turnId: 'turn-envelope',
      stepNum: 1,
      toolName: original.name,
      result: bounded.result,
      extra: bounded.extra,
    });
    assert.equal(observation.resultRawRef, metadata.rawRef, 'observation persistence must reuse the early raw reference');
    assert.equal(observation.tokenEstimate?.resultChars, raw.length, 'original telemetry must survive early bounding');
  }

  const skillText = 's'.repeat(100_000);
  const skill = { name: 'skill_read', args: {}, result: skillText, error: false };
  assert.strictEqual(await envelopeOversizedToolResult(skill, { sessionId: 'skill', toolName: 'skill_read' }), skill);

  const small = { name: 'small_tool', args: {}, result: 'small', error: false };
  assert.strictEqual(await envelopeOversizedToolResult(small, { sessionId: 'small' }), small);

  const { getConfig } = await import('../config/config');
  const rawParent = path.join(getConfig().getConfigDir(), 'tool-results');
  fs.rmSync(rawParent, { recursive: true, force: true });
  fs.writeFileSync(rawParent, 'intentional regression fixture', 'utf8');
  try {
    const validResult = { name: 'persistence_failure_fixture', args: {}, result: 'z'.repeat(100_000), error: false };
    const degraded = await envelopeOversizedToolResult(validResult, { sessionId: 'failure-fixture' });
    assert.equal(degraded.error, false, 'raw persistence failure must not fail a valid source tool');
    assert.equal(degraded.extra?.toolResultEnvelope?.rawPersistence, 'failed');
    assert.equal(degraded.extra?.toolResultEnvelope?.rawRef, undefined);
    assert.ok(degraded.result.includes('raw_ref=unavailable'));
    assert.ok(degraded.result.length <= GATEWAY_TOOL_RESULT_INLINE_MAX_CHARS);
  } finally {
    fs.rmSync(rawParent, { force: true });
  }

  await assert.rejects(() => readRawToolResult('tool-result-raw:../escape.txt'));
  console.log('tool-result envelope regression: ok');
}

main()
  .finally(() => fs.rmSync(tempRoot, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
