import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Regression: a stale `auth_mode: "api_key"` with an empty key used to hide a
// connected OAuth account from media generation. Grok chat and x_search still
// worked (they use the full account pool), but media_generate reported
// `Image generation provider "xai" is not available.`

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-xai-media-'));
const configDir = path.join(root, '.prometheus');

function writeConfig(xai: Record<string, unknown>): void {
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
    llm: { provider: 'anthropic', providers: { xai } },
  }), 'utf8');
}

async function run(): Promise<void> {
  fs.mkdirSync(configDir, { recursive: true });
  process.env.PROMETHEUS_DATA_DIR = root;
  delete process.env.PROMETHEUS_WORKSPACE_DIR;
  delete process.env.XAI_API_KEY;

  writeConfig({
    api_key: '',
    endpoint: 'https://api.x.ai/v1',
    auth_mode: 'api_key',
    defaultAccountId: 'keyless',
    accounts: {
      default: { id: 'default', label: 'xAI account', authType: 'oauth', status: 'connected' },
      keyless: { id: 'keyless', label: 'New xAI account', authType: 'api_key', status: 'disconnected' },
    },
  });

  const { getVault } = await import('../security/vault');
  getVault(configDir).set('xai.oauth_tokens.default', JSON.stringify({
    access_token: 'oauth-access-token',
    refresh_token: 'oauth-refresh-token',
    token_type: 'Bearer',
    base_url: 'https://api.x.ai/v1',
    expires_at: Date.now() + 60 * 60 * 1000,
  }), 'xai-media-regression');

  const { resolveXAIMediaRuntime } = await import('./xai-runtime');
  const { XAIImageGenerationProvider } = await import('../image-generation/providers/xai') as any;

  const runtime = await resolveXAIMediaRuntime('https://api.x.ai/v1');
  assert.equal(runtime.auth, 'oauth', 'connected OAuth account must be used when the api_key preference has no key');
  assert.equal(runtime.bearerToken, 'oauth-access-token');
  assert.equal(runtime.accountId, 'default');

  if (typeof XAIImageGenerationProvider === 'function') {
    assert.equal(await new XAIImageGenerationProvider().isAvailable(), true, 'xAI image provider must report available');
  }

  // OAuth stays preferred even when an API key is also present.
  process.env.XAI_API_KEY = 'xai-env-key';
  const both = await resolveXAIMediaRuntime('https://api.x.ai/v1');
  assert.equal(both.auth, 'oauth', 'OAuth must beat an API key for media generation');

  // With no OAuth login, the API key is the fallback.
  getVault(configDir).delete('xai.oauth_tokens.default', 'xai-media-regression');
  const keyed = await resolveXAIMediaRuntime('https://api.x.ai/v1');
  assert.equal(keyed.auth, 'api_key');
  assert.equal(keyed.bearerToken, 'xai-env-key');
  delete process.env.XAI_API_KEY;

  console.log('xAI media runtime regression passed');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  });
