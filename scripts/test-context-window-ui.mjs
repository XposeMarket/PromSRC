import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const page = read('web-ui/src/pages/ChatPage.js');
const router = read('src/gateway/routes/chat.router.ts');
const pressureRouter = read('src/gateway/routes/context-window-pressure.router.ts');
const processesRouter = read('src/gateway/routes/processes.router.ts');
const mobile = read('web-ui/src/mobile/mobile-context-window.js');
const performance = read('web-ui/src/performance.js');
const generatedPerformance = read('generated/public-web-ui/static/performance.js');
const live = read('web-ui/src/context-window-live-tracking.js');
const generatedLive = read('generated/public-web-ui/static/context-window-live-tracking.js');

// Keep the existing next-model-call contract intact for the detailed breakdown.
assert.match(router, /deriveContextWindowUsage\(currentStateTokens, contextLimitTokens\)/, 'the API must retain the authoritative next-call context usage contract');
assert.match(router, /router\.get\('\/api\/sessions\/:id\/context-window'/, 'the detailed contract must remain available for every session id');
assert.match(router, /contextUsage,\s*\n\s*nextCallEstimateTokens/, 'the API must continue exposing next-call telemetry');
assert.match(page, /function getChatContextWindowUsage\(/, 'desktop must retain the detailed context-window contract');
assert.doesNotMatch(page, /currentStateTokens:\s*Math\.max\(0, Number\(currentState\.currentStateTokens[^\n]+\+ liveTokens/, 'desktop live tool payloads must not mutate the backend breakdown');
assert.doesNotMatch(page, /id: 'live_tool_results'/, 'desktop live tool payloads must not enter the backend breakdown');
assert.match(mobile, /function _applyLiveOverlay\(data\) \{\s*\/\/ Live tool events schedule an authoritative server refresh; do not add\s*\/\/ speculative tokens to the bar or breakdown between snapshots\.\s*return data;/s, 'mobile backend breakdown snapshots must remain unmodified');
assert.match(router, /id: 'total_thread_tokens', label: 'Total thread tokens'/, 'stored/lifetime thread usage remains a separate storage metric');

// The gauge must additionally receive the pressure that can actually trigger
// compaction, rather than silently showing only the legacy bounded history slice.
assert.match(pressureRouter, /router\.get\('\/api\/sessions\/:id\/context-pressure'/, 'the compaction-pressure endpoint must exist');
assert.match(pressureRouter, /contextTokenEstimate: session\.contextTokenEstimate/, 'pressure must use the session estimator used by the pre-turn compaction gate');
assert.match(pressureRouter, /calibrationFactor: calibration\.factor/, 'pressure must use the same provider calibration family as compaction');
assert.match(pressureRouter, /effectiveCompactionTriggerTokens/, 'pressure response must expose the trigger that explains early compaction');
assert.match(processesRouter, /router\.use\(contextWindowPressureRouter\)/, 'the authenticated gateway must mount the pressure endpoint');

assert.match(performance, /import '\.\/context-window-live-tracking\.js';/, 'desktop/mobile entry must load the shared context meter');
assert.match(performance, /new CustomEvent\('prometheus:client-performance-mark', \{ detail: entry \}\)/, 'only scrubbed telemetry may be published to the estimator');
assert.equal(performance, generatedPerformance, 'performance source/generated mirrors must stay byte-identical');
assert.equal(live, generatedLive, 'live-context source/generated mirrors must stay byte-identical');

assert.match(live, /const SEMANTIC_LABEL = 'Context window';/, 'the visible gauge must describe the actual context window');
assert.match(live, /Effective context pressure · compaction starts before the hard limit/, 'the UI must explain why compaction can occur before 100%');
assert.match(live, /\/context-pressure`/, 'desktop and mobile must refresh real compaction pressure');
assert.match(live, /Math\.max\(state\.authoritativeTokens, state\.pressureTokens\)/, 'the gauge must not fall below the pressure that can trigger compaction');
assert.match(live, /Math\.max\(authoritativePressure, liveProjection\)/, 'current-turn live tool pressure must remain monotonic above server snapshots');
assert.match(live, /model slice \$\{formatTokens\(state\.authoritativeTokens\)\}/, 'when pressure exceeds the bounded model slice the UI must make that distinction visible');
assert.match(live, /compaction at \$\{formatTokens\(state\.pressureTriggerTokens\)\}/, 'the tooltip must expose the compaction trigger');
assert.match(live, /context_compaction/, 'mobile SSE compaction events must update pressure immediately');
assert.match(live, /chat_tool_result_received/, 'desktop tool-result telemetry must still feed the live projection');
assert.match(live, /__pmMobileContextStreamEvent/, 'mobile tool-result telemetry must feed the same projection');
assert.match(live, /import\('\.\/mobile\/mobile-api\.js'\)/, 'mobile pressure reads must preserve remote gateway routing and pairing credentials');
assert.match(live, /refreshChatContextWindow\?\.\(\{ force: true \}\)/, 'desktop must reconcile with a fresh detailed snapshot after settle');
assert.match(live, /__pmMobileRefreshContextWindow\?\.\(\{ sessionId: state\.sessionId \}\)/, 'mobile must reconcile with a fresh detailed snapshot after settle');
assert.doesNotMatch(live, /!state \|\| state\.active \|\|/, 'an active turn must not replace its live state on every tool result');
assert.match(live, /Tool\s*\n\s*\/\/ result events during the same active request must accumulate/, 'live tool-result estimates must accumulate within one active request');

console.log('context-window UI contract: ok');
