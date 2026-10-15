// hasActiveModelCredential: real credentials count as "model connected" even
// when the onboarding model step was skipped.
import assert from 'node:assert/strict';
import { hasActiveModelCredential } from './model-connected';

const cfg = (provider: string, entry: any = {}) => ({ llm: { provider, providers: { [provider]: entry } } });
const never = () => false;

assert.equal(hasActiveModelCredential({ config: { llm: {} }, configDir: 'x', oauthConnected: never }), false, 'no provider');
assert.equal(hasActiveModelCredential({ config: cfg('xai', {}), configDir: 'x', oauthConnected: never }), false, 'api provider without key');
assert.equal(hasActiveModelCredential({ config: cfg('xai', { api_key: 'vault:xai' }), configDir: 'x', oauthConnected: never }), true, 'api_key');
assert.equal(hasActiveModelCredential({ config: cfg('openai', { apiKey: 'k' }), configDir: 'x', oauthConnected: never }), true, 'apiKey');

const seen: any[] = [];
const anthropicOk = (p: string, _d: string, a?: string) => { seen.push([p, a]); return p === 'anthropic' && a === 'default'; };
assert.equal(hasActiveModelCredential({ config: cfg('anthropic', { defaultAccountId: 'default' }), configDir: 'x', oauthConnected: anthropicOk }), true, 'anthropic oauth default account');
assert.deepEqual(seen[0], ['anthropic', 'default']);

assert.equal(hasActiveModelCredential({ config: cfg('openai_codex', {}), configDir: 'x', oauthConnected: (p) => p === 'openai_codex' }), true, 'codex oauth');
assert.equal(hasActiveModelCredential({ config: cfg('anthropic', {}), configDir: 'x', oauthConnected: never }), false, 'anthropic not logged in');
assert.equal(hasActiveModelCredential({ config: cfg('anthropic', {}), configDir: 'x', oauthConnected: () => { throw new Error('vault'); } }), false, 'errors never throw');

console.log('model-connected regression passed (9 checks)');
