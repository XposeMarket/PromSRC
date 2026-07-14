const assert = require('assert');

const {
  normalizeCreativeCommandTimeoutMs,
  sendCreativeCommand,
  markCreativeBridgeReady,
  getCreativeBridgeReadiness,
} = require('../dist/gateway/creative/command-bus.js');

(async () => {
  assert.strictEqual(normalizeCreativeCommandTimeoutMs(undefined), 8000);
  assert.strictEqual(normalizeCreativeCommandTimeoutMs(120000), 120000);
  assert.strictEqual(normalizeCreativeCommandTimeoutMs(999999), 720000);
  assert.strictEqual(normalizeCreativeCommandTimeoutMs(1), 500);

  let broadcasted = false;
  const result = await sendCreativeCommand(
    () => {
      broadcasted = true;
    },
    {
      sessionId: 'telegram_test_session',
      mode: 'video',
      command: 'export',
      timeoutMs: 120000,
    },
  );

  assert.strictEqual(broadcasted, false, 'should not broadcast when no creative editor client is connected');
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.code, 'CREATIVE_EDITOR_UNAVAILABLE');
  assert.strictEqual(result.readiness, 'unavailable');
  assert.match(String(result.error || ''), /registered the Creative editor command handler/i);
  assert.match(String(result.error || ''), /CLI HyperFrames tools remain available/i);

  markCreativeBridgeReady({ sessionId: 'telegram_test_session', creativeMode: 'video', surface: 'chat-page' });
  assert.strictEqual(getCreativeBridgeReadiness().ready, true);
  const timedOut = await sendCreativeCommand(() => { broadcasted = true; }, {
    sessionId: 'telegram_test_session', mode: 'video', command: 'get_state', timeoutMs: 500,
  });
  assert.strictEqual(broadcasted, true, 'registered creative handler should receive command broadcasts');
  assert.strictEqual(timedOut.code, 'CREATIVE_EDITOR_TIMEOUT');

  console.log('creative command bus tests passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
