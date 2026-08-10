import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const page = read('web-ui/src/pages/ChatPage.js');
const router = read('src/gateway/routes/chat.router.ts');
const mobile = read('web-ui/src/mobile/mobile-context-window.js');

assert.match(router, /deriveContextWindowUsage\(currentStateTokens, contextLimitTokens\)/, 'the API must derive one authoritative context usage contract');
assert.match(router, /router\.get\('\/api\/sessions\/:id\/context-window'/, 'the same contract must be available for every session id, including agent/subagent sessions');
assert.match(router, /contextUsage,\s*\n\s*nextCallEstimateTokens/, 'the API must expose the contract to every session consumer');
assert.match(page, /function getChatContextWindowUsage\(/, 'the UI must retain overflow-aware fallback semantics');
assert.match(page, /\$\{base\} · \$\{formatContextTokenCount\(usage\.overflowTokens\)\} over/, 'the UI must state overflow beside the real percentage');
assert.doesNotMatch(page, /currentStateTokens:\s*Math\.max\(0, Number\(currentState\.currentStateTokens[^\n]+\+ liveTokens/, 'live tool payloads must not inflate the authoritative context numerator');
assert.doesNotMatch(page, /id: 'live_tool_results'/, 'live tool payloads must not add a transient breakdown row');
assert.match(page, /usage\.progressPercent/, 'only the visual progress bar may clamp to 100%');
assert.match(page, /Side chat context is inherited from the parent chat\./, 'side-chat variants must continue to use their parent context metric rather than a second counter');
assert.match(router, /id: 'cached', label: 'Cached'/, 'the API must expose the cached-token metric');
assert.match(router, /id: 'total_thread_tokens', label: 'Total thread tokens'/, 'the API must expose aggregate thread tokens');
assert.doesNotMatch(router, /label: 'MCP tools \(deferred\)'/, 'obsolete MCP rows must not be exposed in the breakdown');
assert.match(mobile, /function _scheduleFreshnessRefresh\(/, 'mobile must refresh the context chip while the chat is visible');

console.log('context-window UI contract: ok');
