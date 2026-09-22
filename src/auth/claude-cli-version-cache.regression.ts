import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { detectClaudeCliVersion, invalidateClaudeCliVersionCache, isClaudeCodeVersionTooOldError } from './anthropic-oauth';

// Regression (2026-09-22): the detected Claude Code CLI version was memoized
// for the gateway lifetime, so `claude update` had no effect until a restart.

assert.equal(isClaudeCodeVersionTooOldError('{"error":{"details":{"error_code":"claude_code_version_too_old"}}}'), true);
assert.equal(isClaudeCodeVersionTooOldError('Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required.'), true);
assert.equal(isClaudeCodeVersionTooOldError('rate_limit_error'), false);

// Cache honors a TTL instead of living forever.
const t0 = 1_000_000;
const first = detectClaudeCliVersion(t0);
assert.ok(first.length > 0);
assert.equal(detectClaudeCliVersion(t0 + 1000), first, 'within TTL returns the cached value');
invalidateClaudeCliVersionCache();
assert.ok(detectClaudeCliVersion(t0 + 2000).length > 0, 'invalidation forces re-detection');

const src = readFileSync(path.join(__dirname, 'anthropic-oauth.ts'), 'utf8');
assert.match(src, /CLAUDE_CLI_VERSION_TTL_MS/, 'version cache must have a TTL');
const adapter = readFileSync(path.join(__dirname, '..', 'providers', 'anthropic-adapter.ts'), 'utf8');
assert.match(adapter, /isClaudeCodeVersionTooOldError\(raw\)[\s\S]{0,400}invalidateClaudeCliVersionCache\(\)/, 'adapter must invalidate on version_too_old');

console.log('claude-cli-version-cache regression: ok');
