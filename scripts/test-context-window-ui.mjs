import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const pressureModel = read('src/gateway/context/context-window-pressure.ts');
const pressureRouter = read('src/gateway/routes/context-window-pressure.router.ts');
const processesRouter = read('src/gateway/routes/processes.router.ts');
const chatRouter = read('src/gateway/routes/chat.router.ts');
const performance = read('web-ui/src/performance.js');
const generatedPerformance = read('generated/public-web-ui/static/performance.js');
const desktopChat = read('web-ui/src/pages/ChatPage.js');
const desktopShell = read('web-ui/index.html');
const mobileContext = read('web-ui/src/mobile/mobile-context-window.js');
const generatedMobileContext = read('generated/public-web-ui/static/mobile/mobile-context-window.js');

// The visible meter is the active model context. It must use the full active
// transcript, while cumulative provider/tool usage is exposed separately.
assert.match(pressureRouter, /router\.get\('\/api\/sessions\/:id\/context-pressure'/, 'the thread-context pressure endpoint must exist');
assert.match(pressureRouter, /contextTokenEstimate: session\.contextTokenEstimate/, 'thread pressure must use the persisted session active-context estimate');
assert.match(pressureRouter, /latestContextSummary: session\.latestContextSummary/, 'thread pressure must honor the rolling compaction summary');
assert.match(pressureRouter, /contextStartIndex: session\.contextStartIndex/, 'thread pressure must honor the compaction checkpoint');
assert.match(pressureRouter, /calibrationFactor: calibration\.factor/, 'thread pressure must use provider/model calibration');
assert.match(pressureRouter, /effectiveCompactionTriggerTokens/, 'the API must expose the effective compaction trigger');
assert.match(processesRouter, /router\.use\(contextWindowPressureRouter\)/, 'the authenticated gateway must mount the pressure endpoint');

// If an older session lacks the persisted estimate, reconstruction must still
// use the entire active transcript (or summary + everything since checkpoint).
assert.match(pressureModel, /history\.reduce\(\(total, message\) => total \+ estimateSessionMessageTokens\(message\), 0\)/, 'uncompacted fallback must count the full active session history');
assert.match(pressureModel, /const activeHistory = history\.slice\(start\)/, 'compacted fallback must count every message after the summary checkpoint');
assert.match(pressureModel, /if \(Number\.isFinite\(persistedEstimate\) && persistedEstimate >= 0\)/, 'persisted session pressure should remain authoritative when available');
assert.match(chatRouter, /const history = getActiveHistoryForApiCall\(id\)/, 'the context-window endpoint must use the full active transcript');
assert.match(chatRouter, /const observationSnapshot = readToolObservationSnapshot\(id, 100_000\)/, 'context-window must read one cached observation snapshot');
assert.match(chatRouter, /estimateStoredThreadFootprint\(id, session, profile, observationSnapshot\.observations\)/, 'stored footprint must reuse the observation snapshot');
assert.match(chatRouter, /const toolUsage = observationSnapshot\.usage/, 'context-window response must include cached cumulative tool usage');
assert.match(chatRouter, /Model usage · thread total/, 'provider usage must be exposed as a thread total');
assert.match(chatRouter, /Tool I\/O · thread total/, 'tool input/output must be exposed as a thread total');
assert.doesNotMatch(chatRouter, /getLastTurnUsageTelemetry|last_turn_usage/, 'the context-window response must not be driven by last-turn telemetry');

// performance.js is shared by desktop and mobile. The browser-level
// performance-foundation test exercises the remaining optional desktop effects.
// Context-window numbers are server-authoritative on both surfaces and must
// not be overlaid by a desktop-only per-turn tracker.
assert.match(performance, /const shouldBootMobile = window\.__PROM_SHOULD_BOOT_MOBILE\?\.\(\) === true;/, 'the shared entry must resolve the mobile predicate before feature loading');
assert.doesNotMatch(performance, /context-window-live-tracking/, 'desktop must not load the per-turn context overlay');
assert.doesNotMatch(performance, /^import ['"]\.\/context-window-live-tracking\.js['"];?$/m, 'mobile-safe shared boot must not statically import the context meter');
assert.match(performance, /new CustomEvent\('prometheus:client-performance-mark', \{ detail: entry \}\)/, 'only scrubbed telemetry may be published to the performance stream');
assert.equal(performance, generatedPerformance, 'performance source/generated mirrors must stay byte-identical');
assert.doesNotMatch(desktopChat, /Estimated drill-down; parent total is authoritative/, 'desktop must not show the extra estimated drill-down copy');
assert.doesNotMatch(desktopChat, /applyChatContextWindowLiveOverlay/, 'desktop must not apply a per-turn live overlay');
assert.match(desktopShell, /<div class="chat-context-window-metrics" id="chat-context-window-breakdown" hidden><\/div>/, 'desktop shell must leave the breakdown to the shared renderer');
assert.doesNotMatch(desktopShell, /chat-context-window-(trigger|cached|thread-total)/, 'desktop shell must not contain legacy desktop-only context rows');
assert.doesNotMatch(mobileContext, /_liveTurn|_applyLiveOverlay/, 'mobile context UI must not maintain a per-turn token overlay');
assert.equal(mobileContext, generatedMobileContext, 'mobile context source/generated mirrors must stay byte-identical');

console.log('context-window full-thread UI contract: ok');
