import assert from 'assert';
import {
  clearTokens,
  refreshTokens,
  saveTokens,
} from '../../auth/openai-oauth.js';
import {
  clearXAITokens,
  refreshXAITokens,
} from '../../auth/xai-oauth.js';

async function main(): Promise<void> {
  const prior = process.env.PROMETHEUS_RUNTIME_WORKER;
  process.env.PROMETHEUS_RUNTIME_WORKER = '1';
  try {
    assert.throws(() => saveTokens('unused-worker-config', {
      access_token: 'not-a-real-token',
      refresh_token: 'not-a-real-refresh-token',
      expires_at: Date.now() + 60_000,
    }), /read-only OAuth credential consumers/);
    assert.throws(() => clearTokens('unused-worker-config'), /read-only OAuth credential consumers/);
    await assert.rejects(refreshTokens('unused-worker-config'), /gateway preflight must refresh credentials/);
    assert.throws(() => clearXAITokens('unused-worker-config'), /read-only OAuth credential consumers/);
    await assert.rejects(refreshXAITokens('unused-worker-config'), /gateway preflight must refresh credentials/);
  } finally {
    if (prior === undefined) delete process.env.PROMETHEUS_RUNTIME_WORKER;
    else process.env.PROMETHEUS_RUNTIME_WORKER = prior;
  }
  console.log('model-worker credential ownership regression passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
