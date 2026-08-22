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
const generatedPerformance = read('generated/public-web-ui/static/performance.js');
const live = read('web-ui/src/context-window-live-tracking.js');
const generatedLive = read('generated/public-web-ui/static/context-window-live-tracking.js');

assert.match(router, /deriveContextWindowUsage\(currentStateTokens, contextLimitTokens\)/, 'the API must derive one authoritative context usage contract');
assert.match(router, /router\.get\('\/api\/sessions\/:id\/context-window'/, 'the same contract must be available for every session id, including agent/subagent sessions');
assert.match(router, /contextUsage,\s*\n\s*nextCallEstimateTokens/, 'the API must expose the authoritative contract to every session consumer');
assert.match(page, /function getChatContextWindowUsage\(/, 'desktop must retain the authoritative context-window contract');
assert.doesNotMatch(page, /currentStateTokens:\s*Math\.max\(0, Number\(currentState\.currentStateTokens[^\n]+\+ liveTokens/, 'desktop live tool payloads must not mutate the authoritative numerator');
assert.doesNotMatch(page, /id: 'live_tool_results'/, 'desktop live tool payloads must not enter the authoritative breakdown');
assert.match(mobile, /function _applyLiveOverlay\(data\) \{\s*\/\/ Live tool events schedule an authoritative server refresh; do not add\s*\/\/ speculative tokens to the bar or breakdown between snapshots\.\s*return data;/s, 'mobile authoritative snapshots must remain unmodified');
assert.match(router, /id: 'total_thread_tokens', label: 'Total thread tokens'/, 'stored/lifetime thread usage must remain a separate out-of-band metric');

assert.match(performance, /import '\.\/context-window-live-tracking\.js';/, 'desktop/mobile entry must load the shared live estimator');
assert.match(performance, /new CustomEvent\('prometheus:client-performance-mark', \{ detail: entry \}\)/, 'only scrubbed telemetry may be published to the estimator');
assert.equal(performance, generatedPerformance, 'performance source/generated mirrors must stay byte-identical');
assert.equal(live, generatedLive, 'live-context source/generated mirrors must stay byte-identical');

assert.match(live, /const SEMANTIC_LABEL = 'Active context';/, 'the gauge must describe active next-call context');
assert.match(live, /Next model-call context · stored thread tracked separately/, 'the UI must explain active context versus stored thread usage');
assert.doesNotMatch(live, /SEMANTIC_LABEL = 'Thread context'|Whole thread · prior dynamic context/, 'the live estimator must never relabel the authoritative gauge as whole-thread usage');
assert.match(live, /Math\.max\(state\.authoritativeTokens, state\.baselineTokens \+ state\.liveToolTokens\)/, 'the live estimate must be monotonic and reconcile against authoritative snapshots');
assert.match(live, /\+\$\{formatTokens\(unreflectedTokens\)\} live est/, 'unreflected current-turn tokens must be explicitly labeled as an estimate');
assert.match(live, /chat_tool_result_received/, 'desktop tool-result telemetry must feed the estimator');
assert.match(live, /__pmMobileContextStreamEvent/, 'mobile tool-result telemetry must feed the same estimator');
assert.match(live, /refreshChatContextWindow\?\.\(\{ force: true \}\)/, 'desktop must reconcile with a fresh authoritative snapshot after settle');
assert.match(live, /__pmMobileRefreshContextWindow\?\.\(\{ sessionId: state\.sessionId \}\)/, 'mobile must reconcile with a fresh authoritative snapshot after settle');

console.log('context-window UI contract: ok');
