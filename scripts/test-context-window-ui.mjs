import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const page = read('web-ui/src/pages/ChatPage.js');
const router = read('src/gateway/routes/chat.router.ts');
const mobile = read('web-ui/src/mobile/mobile-context-window.js');
const performance = read('web-ui/src/performance.js');
const liveTracking = read('web-ui/src/context-window-live-tracking.js');

assert.match(router, /deriveContextWindowUsage\(currentStateTokens, contextLimitTokens\)/, 'the API must derive one authoritative context usage contract');
assert.match(router, /router\.get\('\/api\/sessions\/:id\/context-window'/, 'the same contract must be available for every session id, including agent/subagent sessions');
assert.match(router, /contextUsage,\s*\n\s*nextCallEstimateTokens/, 'the API must expose the contract to every session consumer');
assert.match(page, /function getChatContextWindowUsage\(/, 'the UI must retain overflow-aware fallback semantics');
assert.match(page, /\$\{base\} · \$\{formatContextTokenCount\(usage\.overflowTokens\)\} over/, 'the UI must state overflow beside the real percentage');
assert.doesNotMatch(page, /currentStateTokens:\s*Math\.max\(0, Number\(currentState\.currentStateTokens[^\n]+\+ liveTokens/, 'the authoritative desktop snapshot must not be mutated by transient tool payloads');
assert.doesNotMatch(page, /id: 'live_tool_results'/, 'transient tool payloads must stay visually separate from the authoritative breakdown');
assert.match(page, /usage\.progressPercent/, 'only the visual progress bar may clamp to 100%');
assert.match(page, /Side chat context is inherited from the parent chat\./, 'side-chat variants must continue to use their parent context metric rather than a second counter');
assert.match(router, /id: 'cached', label: 'Cached'/, 'the API must expose the cached-token metric');
assert.match(router, /id: 'total_thread_tokens', label: 'Total thread tokens'/, 'the API must expose aggregate stored-thread tokens separately from active context');
assert.doesNotMatch(router, /label: 'MCP tools \(deferred\)'/, 'obsolete MCP rows must not be exposed in the breakdown');
assert.match(mobile, /function _scheduleFreshnessRefresh\(/, 'mobile must refresh the authoritative context snapshot while the chat is visible');

assert.match(performance, /import '\.\/context-window-live-tracking\.js';/, 'the shared live tracker must load on both desktop and mobile entry paths');
assert.match(performance, /prometheus:client-performance-mark/, 'desktop tool telemetry must be published to the live tracker without exposing message content');
assert.match(liveTracking, /const SEMANTIC_LABEL = 'Active context'/, 'the UI must distinguish active next-call context from cumulative thread storage');
assert.match(liveTracking, /Next model call · stored thread tracked separately/, 'the popover must explain what the primary meter represents');
assert.match(liveTracking, /chat_tool_result_received/, 'desktop tool-result telemetry must advance the live estimate');
assert.match(liveTracking, /__pmMobileContextStreamEvent/, 'mobile tool-result telemetry must advance the same live estimate');
assert.match(liveTracking, /Math\.max\(\s*state\.authoritativeTokens,\s*state\.baselineTokens \+ state\.liveToolTokens/s, 'live estimates must never move backward or double-add an authoritative server snapshot');
assert.match(liveTracking, /\+\$\{formatTokens\(unreflectedTokens\)\} live est/, 'the UI must mark unreflected live tokens as an estimate instead of presenting them as authoritative');

console.log('context-window UI contract: ok');
