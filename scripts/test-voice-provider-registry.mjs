import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual registry with isolated credentials, including custom-only installs.
const source = fs.readFileSync('src/gateway/voice/voice-provider-registry.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const config = { voice: { providers: {
  'custom:local': { baseUrl: 'http://localhost:8000', model: 'local-realtime', voices: ['local'], apiKeyRef: 'vault:local-key' },
} } };
let openai = false, xai = false;
const box = vm.createContext({ exports: {}, URL, process: { env: {} }, require: name => {
  if (name.includes('config/config')) return { getConfig: () => ({ getConfig: () => config, resolveSecret: () => openai ? 'test-key' : '', getConfigDir: () => '' }) };
  if (name.includes('security/vault')) return { getVault: () => ({ has: key => key === 'local-key' }) };
  if (name.includes('xai-account-pool')) return { getConfiguredXaiCredentialSummary: () => ({ configured: xai }) };
  if (name.includes('openai-oauth')) return { isConnected: () => false };
  throw new Error(`Unexpected registry dependency: ${name}`);
} });
vm.runInContext(js, box);
const registry = value => box.exports.getVoiceProviderRegistry(value || config);
assert.equal(registry().defaults.provider, 'custom:local', 'custom-only installs select their connected provider');
assert.equal(registry().defaults.model, 'local-realtime');
assert.equal(registry().defaults.voice, 'local');
assert.equal(registry({ ...config, voice: { ...config.voice, defaults: { provider: 'custom:missing' } } }).defaults.provider, 'custom:local', 'invalid saved default uses connected custom');
assert.equal(registry({ voice: {} }).defaults.provider, 'openai', 'no connections retain disconnected default');
xai = true;
assert.equal(registry().defaults.provider, 'xai', 'connected built-ins precede custom fallback');
openai = true;
assert.equal(registry().defaults.provider, 'openai', 'OpenAI remains first built-in');
assert.equal(registry({ ...config, voice: { ...config.voice, defaults: { provider: 'custom:local' } } }).defaults.provider, 'custom:local', 'connected saved default wins');
console.log('voice provider registry fallback regression: ok');
