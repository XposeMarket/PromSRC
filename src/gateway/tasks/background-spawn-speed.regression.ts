import assert from 'node:assert/strict';
import { resolveBackgroundSpawnSpeed } from './task-runner';

assert.equal(resolveBackgroundSpawnSpeed('openai_codex', 'gpt-6-sol', 'fast'), 'fast');
assert.equal(resolveBackgroundSpawnSpeed('anthropic', 'claude-opus-5', 'fast'), 'fast');
assert.equal(resolveBackgroundSpawnSpeed('openai_codex', 'gpt-6-sol', undefined), undefined);
assert.equal(resolveBackgroundSpawnSpeed('openai_codex', 'gpt-6-sol', 'standard'), 'standard');
assert.throws(() => resolveBackgroundSpawnSpeed('anthropic', 'claude-sonnet-4-6', 'fast'), /not supported/);
assert.throws(() => resolveBackgroundSpawnSpeed('openai_codex', 'gpt-6-sol', 'turbo'), /Unsupported spawn speed/);
console.log('background-spawn-speed regression: PASS');
