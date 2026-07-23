import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTurnTimingRecorder } from './turn-timing';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-turn-timing-'));
  try {
    const logPath = path.join(root, 'turn-timing.log');
    const first = createTurnTimingRecorder('session-a', {
      enabled: true,
      startedAt: Date.now() - 10,
      turnId: 'turn-a',
      phase: 'admission',
      logPath,
    });
    const second = createTurnTimingRecorder('session-b', {
      enabled: true,
      turnId: 'turn-b',
      phase: 'admission',
      logPath,
    });
    first.mark('lease_wait_start');
    second.mark('lease_wait_start');
    first.mark('lease_acquired', { waitMs: 4 });
    second.mark('lease_acquired', { waitMs: 9 });
    await Promise.all([first.flush(), second.flush()]);

    const rows = fs.readFileSync(logPath, 'utf-8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(rows.length, 4);
    assert.deepEqual(new Set(rows.map((row) => row.turnId)), new Set(['turn-a', 'turn-b']));
    assert.ok(rows.every((row) => row.sessionId === (row.turnId === 'turn-a' ? 'session-a' : 'session-b')));
    assert.ok(rows.every((row) => Number.isFinite(row.elapsedMs)));

    const defaultPath = path.join(root, 'enabled-by-default.log');
    const enabledByDefault = createTurnTimingRecorder('session-default', { logPath: defaultPath });
    assert.equal(enabledByDefault.enabled, true, 'turn telemetry must be enabled without an environment opt-in');
    enabledByDefault.mark('default_enabled');
    await enabledByDefault.flush();
    assert.equal(fs.existsSync(defaultPath), true, 'default telemetry must write a timing row');

    const ttftPath = path.join(root, 'ttft-stages.log');
    const ttft = createTurnTimingRecorder('session-ttft', { logPath: ttftPath });
    ttft.mark('provider_request_start', { provider: 'test', model: 'test-model' });
    ttft.mark('first_provider_event', { latencyElapsedMs: 12, eventKind: 'assistant_delta' });
    ttft.mark('first_visible_token', { latencyElapsedMs: 14, providerWaitMs: 2, providerTtftMs: 14 });
    await ttft.flush();
    const ttftRows = fs.readFileSync(ttftPath, 'utf-8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.deepEqual(ttftRows.map((row) => row.label), ['provider_request_start', 'first_provider_event', 'first_visible_token'], 'durable telemetry must preserve TTFT stage labels');
    assert.equal(ttftRows[2].latencyElapsedMs, 14, 'TTFT must retain end-to-end elapsed time');
    assert.equal(ttftRows[2].providerTtftMs, 14, 'TTFT must retain provider-only first-visible-token time');
    const chatRouterSource = fs.readFileSync(path.join(process.cwd(), 'src', 'gateway', 'routes', 'chat.router.ts'), 'utf8');
    assert.match(chatRouterSource, /turnTiming\.mark\(stage, \{ latencyElapsedMs: elapsedMs, \.\.\.extra \}\)/, 'latency SSE stages must also be persisted');
    assert.match(chatRouterSource, /markLatency\('first_visible_token',[\s\S]{0,500}providerTtftMs,/, 'first visible token telemetry must include provider-only TTFT');

    const rotationPath = path.join(root, 'rotated.log');
    const oversizedLegacyPath = path.join(root, 'oversized-legacy.log');
    fs.writeFileSync(oversizedLegacyPath, 'x'.repeat(900), 'utf8');
    const rotationOptions = { enabled: true, maxLogBytes: 512, maxRotatedLogs: 2 };
    const legacy = createTurnTimingRecorder('session-legacy', { ...rotationOptions, logPath: oversizedLegacyPath });
    legacy.mark('after_legacy_log');
    await legacy.flush();
    assert.ok(fs.statSync(oversizedLegacyPath).size <= 512, 'an oversized legacy log must be bounded on first append');

    for (let index = 0; index < 8; index += 1) {
      const recorder = createTurnTimingRecorder(`session-rotation-${index}`, { ...rotationOptions, logPath: rotationPath });
      recorder.mark(`rotation_${index}`, { detail: 'x'.repeat(120) });
      await recorder.flush();
    }
    const retainedPaths = [rotationPath, `${rotationPath}.1`, `${rotationPath}.2`].filter((filePath) => fs.existsSync(filePath));
    assert.equal(retainedPaths.length, 3, 'active log plus the configured rotated logs should be retained');
    assert.ok(retainedPaths.every((filePath) => fs.statSync(filePath).size <= 512), 'each retained log must stay bounded');
    assert.equal(fs.existsSync(`${rotationPath}.3`), false, 'logs beyond retention must be discarded');

    const oversizedMarkPath = path.join(root, 'oversized-mark.log');
    const oversizedMark = createTurnTimingRecorder('session-oversized-mark', { enabled: true, logPath: oversizedMarkPath, maxLogBytes: 512 });
    oversizedMark.mark('large_extra', { untrustedDiagnostic: 'x'.repeat(10_000) });
    await oversizedMark.flush();
    const oversizedMarkRow = JSON.parse(fs.readFileSync(oversizedMarkPath, 'utf8'));
    assert.equal(oversizedMarkRow.label, 'large_extra', 'truncation must retain the timing stage label');
    assert.equal(oversizedMarkRow.telemetryTruncated, true, 'oversized timing extras must be compacted');
    assert.ok(fs.statSync(oversizedMarkPath).size <= 512, 'an individual timing row must not exceed its log bound');

    const disabledPath = path.join(root, 'disabled.log');
    const disabled = createTurnTimingRecorder('session-disabled', { enabled: false, logPath: disabledPath });
    disabled.mark('must_not_write');
    await disabled.flush();
    assert.equal(fs.existsSync(disabledPath), false, 'disabled telemetry must not touch disk');

    console.log('turn-timing regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
