const assert = require('assert');

const {
  normalizeCreativeCommandTimeoutMs,
  sendCreativeCommand,
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
  assert.match(String(result.error || ''), /No connected creative editor client/i);

  console.log('creative command bus tests passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
