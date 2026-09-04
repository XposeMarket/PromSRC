import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const pressureModel = read('src/gateway/context/context-window-pressure.ts');
const pressureRouter = read('src/gateway/routes/context-window-pressure.router.ts');
const processesRouter = read('src/gateway/routes/processes.router.ts');
const performance = read('web-ui/src/performance.js');
const generatedPerformance = read('generated/public-web-ui/static/performance.js');
const desktopChat = read('web-ui/src/pages/ChatPage.js');
const live = read('web-ui/src/context-window-live-tracking.js');
const generatedLive = read('generated/public-web-ui/static/context-window-live-tracking.js');

// The visible meter is thread-level active context pressure. It is deliberately
// sourced from the same persisted estimate / rolling-summary boundary used by
// session compaction, not from a per-turn or fixed recent-message slice.
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

// The desktop gauge and server pressure snapshot must share the same active
// thread contract. The bounded current-call rows remain a separate detail
// view, but they can never overwrite the headline total.
assert.match(desktopChat, /context-pressure`/, 'desktop must read full active-thread pressure');
assert.match(desktopChat, /pressureData/, 'desktop must retain the pressure snapshot per session');
assert.match(desktopChat, /hasActivePressure/, 'desktop must prefer a valid active pressure snapshot');
assert.match(desktopChat, /pressure\.pressureTokens/, 'desktop gauge must use pressure tokens for its headline');
assert.match(desktopChat, /current model-call composition/, 'current-call detail rows must be identified separately from active pressure');

// performance.js is shared by desktop and mobile. The browser-level
// performance-foundation test exercises both effects: mobile never requests
// this owner, while desktop Chat activation does. Keep only the feature-owner
// boundary here instead of locking the dynamic import to one source location.
assert.match(performance, /const shouldBootMobile = window\.__PROM_SHOULD_BOOT_MOBILE\?\.\(\) === true;/, 'the shared entry must resolve the mobile predicate before feature loading');
assert.match(performance, /startDesktopFeature\('Context Window', \(\) => import\('\.\/context-window-live-tracking\.js'\)\)/, 'desktop Chat activation must lazily request the shared context meter');
assert.doesNotMatch(performance, /^import ['"]\.\/context-window-live-tracking\.js['"];?$/m, 'mobile-safe shared boot must not statically import the context meter');
assert.match(performance, /new CustomEvent\('prometheus:client-performance-mark', \{ detail: entry \}\)/, 'only scrubbed telemetry may be published to the live estimator');
assert.equal(performance, generatedPerformance, 'performance source/generated mirrors must stay byte-identical');
assert.equal(live, generatedLive, 'live-context source/generated mirrors must stay byte-identical');

assert.match(live, /const SEMANTIC_LABEL = 'Context window';/, 'the visible gauge must remain the context-window meter');
assert.doesNotMatch(live, /Effective context pressure/, 'the obsolete effective-pressure annotation must not be rendered');
assert.doesNotMatch(live, /className = 'context-window-semantic-note'/, 'the live tracker must not inject a second visible annotation row');
assert.match(live, /\/context-pressure`/, 'desktop and mobile must refresh persisted thread pressure');
assert.match(live, /hasPressureSnapshot/, 'the live tracker must distinguish a pressure snapshot from the bounded model slice');
assert.match(live, /const authoritativePressure = hasPressureSnapshot[\s\S]*?state\.pressureTokens[\s\S]*?state\.authoritativeTokens/, 'a pressure snapshot must replace the bounded model slice as the active baseline');
assert.match(live, /Math\.max\(authoritativePressure, liveProjection\)/, 'unpersisted current-turn tool pressure must layer on top of the thread baseline');
assert.match(live, /model slice \$\{formatTokens\(state\.authoritativeTokens\)\}/, 'the smaller next-call/model slice must be secondary information when it differs');
assert.match(live, /compaction at \$\{formatTokens\(state\.pressureTriggerTokens\)\}/, 'the tooltip must expose the compaction trigger');

// Starting or settling a new turn may reset only per-turn telemetry. The thread
// pressure itself must persist until an authoritative session refresh or real
// context compaction changes it.
const newTurnBlock = live.match(/else if \(startsNewTurn\) \{([\s\S]*?)\n  \} else if \(requestId/);
assert.ok(newTurnBlock, 'the new-turn state transition must remain explicit');
assert.match(newTurnBlock[1], /state\.baselineTokens = 0;/, 'new turns should clear the old per-turn baseline');
assert.match(newTurnBlock[1], /state\.liveToolTokens = 0;/, 'new turns should clear only unpersisted live tool tokens');
assert.doesNotMatch(newTurnBlock[1], /pressureTokens\s*=\s*0|pressureWindowTokens\s*=\s*0|pressureTriggerTokens\s*=\s*0/, 'new turns must never reset thread-level pressure');

const settleBlock = live.match(/function settleLive\([\s\S]*?\n\}/)?.[0] || '';
assert.match(settleBlock, /state\.liveToolTokens = 0;/, 'turn settle should clear per-turn live telemetry');
assert.doesNotMatch(settleBlock, /pressureTokens\s*=\s*0|pressureWindowTokens\s*=\s*0|pressureTriggerTokens\s*=\s*0/, 'turn settle must never reset thread-level pressure');
assert.match(settleBlock, /requestAuthoritativeRefresh\(state\)/, 'turn settle must reconcile the persistent thread pressure with the server');
assert.match(live, /state\.authoritativeTokens = after;/, 'a completed compaction must clear the old bounded peak immediately');
assert.match(live, /state\.baselineTokens = after;/, 'a completed compaction must restart live projection from the compacted baseline');

assert.match(live, /context_compaction/, 'compaction events must update thread pressure immediately');
assert.match(live, /chat_tool_result_received/, 'desktop tool-result telemetry must feed the current-turn projection');
assert.match(live, /__pmMobileContextStreamEvent/, 'mobile tool-result telemetry must feed the same projection');
assert.match(live, /import\('\.\/mobile\/mobile-api\.js'\)/, 'mobile pressure reads must preserve remote gateway routing and pairing credentials');
assert.match(live, /refreshChatContextWindow\?\.\(\{ force: true \}\)/, 'desktop must reconcile with a fresh server snapshot after settle');
assert.match(live, /__pmMobileRefreshContextWindow\?\.\(\{ sessionId: state\.sessionId \}\)/, 'mobile must reconcile with a fresh server snapshot after settle');

console.log('context-window full-thread UI contract: ok');
