import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const pressureModel = read('src/gateway/context/context-window-pressure.ts');
const pressureRouter = read('src/gateway/routes/context-window-pressure.router.ts');
const chatRouter = read('src/gateway/routes/chat.router.ts');
const processesRouter = read('src/gateway/routes/processes.router.ts');
const performance = read('web-ui/src/performance.js');
const generatedPerformance = read('generated/public-web-ui/static/performance.js');
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

// Thread usage must come from the bounded/lifetime observation snapshot. Keep
// this contract separate from the pressure meter so a future context-window
// refactor cannot accidentally reintroduce an unbounded JSONL read or a
// misleading last-turn-only usage row.
assert.match(chatRouter, /readToolObservationSnapshot/, 'context-window route must use the bounded observation snapshot');
assert.match(chatRouter, /const observationSnapshot = readToolObservationSnapshot\(id, 512, profile\.tokenizer\)/, 'context-window route must share one bounded snapshot for stored footprint and totals');
assert.match(chatRouter, /const toolUsage = observationSnapshot\.usage/, 'context-window route must expose lifetime tool usage totals');
assert.doesNotMatch(chatRouter, /readToolObservations\(sessionId,\s*100(?:_?0){3,}\)/, 'context-window footprint must not read an unbounded observation corpus');
assert.doesNotMatch(chatRouter, /getLastTurnUsageTelemetry|turnTelemetry/, 'context-window usage must not regress to last-turn telemetry');

// If an older session lacks the persisted estimate, reconstruction must still
// use the entire active transcript (or summary + everything since checkpoint).
assert.match(pressureModel, /history\.reduce\(\(total, message\) => total \+ estimateSessionMessageTokens\(message\), 0\)/, 'uncompacted fallback must count the full active session history');
assert.match(pressureModel, /const activeHistory = history\.slice\(start\)/, 'compacted fallback must count every message after the summary checkpoint');
assert.match(pressureModel, /if \(Number\.isFinite\(persistedEstimate\) && persistedEstimate >= 0\)/, 'persisted session pressure should remain authoritative when available');

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
assert.match(live, /Effective context pressure · compaction starts before the hard limit/, 'the UI must explain why compaction can occur before 100%');
assert.match(live, /\/context-pressure`/, 'desktop and mobile must refresh persisted thread pressure');
assert.match(live, /Math\.max\(state\.authoritativeTokens, state\.pressureTokens\)/, 'a bounded model slice may never pull the gauge below full active-thread pressure');
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

assert.match(live, /context_compaction/, 'compaction events must update thread pressure immediately');
assert.match(live, /chat_tool_result_received/, 'desktop tool-result telemetry must feed the current-turn projection');
assert.match(live, /__pmMobileContextStreamEvent/, 'mobile tool-result telemetry must feed the same projection');
assert.match(live, /import\('\.\/mobile\/mobile-api\.js'\)/, 'mobile pressure reads must preserve remote gateway routing and pairing credentials');
assert.match(live, /refreshChatContextWindow\?\.\(\{ force: true \}\)/, 'desktop must reconcile with a fresh server snapshot after settle');
assert.match(live, /__pmMobileRefreshContextWindow\?\.\(\{ sessionId: state\.sessionId \}\)/, 'mobile must reconcile with a fresh server snapshot after settle');

console.log('context-window full-thread UI contract: ok');
