import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const api = read('web-ui/src/mobile/mobile-api.js');
const pages = read('web-ui/src/mobile/mobile-pages.js');
const ws = read('web-ui/src/ws.js');
const index = read('web-ui/index.html');
const router = read('src/gateway/routes/chat.router.ts');
const settingsRouter = read('src/gateway/routes/settings.router.ts');
const gatewayServer = read('src/gateway/core/server.ts');
const broadcaster = read('src/gateway/comms/broadcaster.ts');
const auditMaterializer = read('src/gateway/audit/materializer.ts');

assert.match(api, /const _sessionRequests = new Map\(\)/, 'session hydration requests must be coalesced');
assert.match(api, /fullProcess=1&_fresh=1/, 'forced recovery hydration must request complete process entries');
assert.match(router, /const fullProcess = full \|\| req\.query\.fullProcess/, 'session API must support full process recovery');
assert.match(router, /processEntries: checkpointProcessEntries/, 'active runtime status must expose its durable tool checkpoint');
assert.match(router, /clientRequestId: runtime\?\.clientRequestId/, 'active runtime status must expose stable turn identity across reconnects');

assert.match(pages, /let mobileRecoveryInFlight = null/, 'mobile recovery must be single-flight');
assert.match(pages, /aiTurn\._pmFinalReceived = true/, 'a displayed final response must become a monotonic recovery boundary');
assert.match(
  pages,
  /if \(targetAiTurn\?\._pmFinalReceived && _mobileAssistantHasVisibleAnswer\(targetAiTurn\)\)/,
  'a late disconnect callback must not replace an already-received final response',
);
assert.match(
  pages,
  /const active = msg\?\.streaming === true && msg\?\._pmFinalReceived !== true/,
  'the final frame must switch the work timer to its completed expandable state before transport cleanup',
);
assert.match(
  pages,
  /const completedTraceEntries = \(!m\.streaming \|\| finalFrameReceived\) \? _mobileWorkflowTraceEntriesForMessage\(m\) : \[\]/,
  'a final response must expose its preserved tool trace in the completed disclosure immediately',
);
assert.match(
  pages,
  /aiTurn\._pmFinalReceived = true;[\s\S]{0,180}aiTurn\.workEndedAt = Number\(aiTurn\.workEndedAt \|\| Date\.now\(\)\)/,
  'the final frame must freeze the displayed work duration',
);
assert.match(
  pages,
  /if \(aiTurn\?\._pmFinalReceived && _mobileAssistantHasVisibleAnswer\(aiTurn\)\)/,
  'foreground recovery must preserve and finalize an already-received response',
);
assert.doesNotMatch(
  pages,
  /run\?\.busy \|\| run\?\.lastSeq > 0/,
  'hiding the app must not resurrect a completed run solely because it has an old stream sequence',
);
assert.match(
  api,
  /if \(!gotFinal\) cb\('onError', toChatStreamError\(err\)\)/,
  'SSE teardown after a final frame must not be reported as a disconnect',
);
assert.match(pages, /if \(!initialSessionLoadPending\)/, 'cold hydration and recovery must not start as competing loads');
assert.match(
  pages,
  /const canPreserveLocalTimeline = hasLocalLiveHistory && !localRunIdentityConflicts/,
  'recovery must recognize a richer local timeline that belongs to the active turn',
);
assert.match(
  pages,
  /let shouldResetForReplay = !canPreserveLocalTimeline\s*&& \(fullRefresh \|\| isColdReopen \|\| force \|\| !hasLocalLiveHistory\)/,
  'foreground/full recovery must not destructively reset a valid local timeline',
);
assert.match(
  pages,
  /shouldResetForReplay = !canPreserveLocalTimeline;[\s\S]{0,180}replayAfter = 0/,
  'a replacement stream or replay gap must reset the sequence cursor without necessarily erasing visible history',
);
assert.match(
  router,
  /appendRuntimeNarrationBoundary\(runtimeProcessEntries, runtimeNarrationTail\)/,
  'durable runtime checkpoints must retain narration boundaries between tool groups',
);
assert.match(
  pages,
  /event === 'runner_idle'\s*&& status !== 'restarting'/,
  'runner idle must reconcile stale mobile activity without clearing a legitimate planned restart',
);
assert.match(
  pages,
  /_clearMobileLiveRunForSession\(requestedSession\);[\s\S]{0,240}const history = Array\.isArray\(session\?\.history\)/,
  'inactive run recovery must clear the cached streaming turn before merging persisted history',
);
assert.match(pages, /addEventListener\('pageshow', runRecoveryOnReturn\)/, 'bfcache/app resume must trigger recovery');
assert.match(pages, /_saveMobileThreadCache\(requestedSession, _activeMobileThread\(\)\)/, 'recovered live trace must survive a hard reload');
assert.match(pages, /\.filter\(_isMobileMessageCacheable\)/, 'in-progress trace messages must be cacheable');
assert.doesNotMatch(
  pages,
  /activeSessionId \|\| ''\) === sid \|\| location\.hash\.startsWith\('#mobile\/chat'\)/,
  'background delivery notifications must not select their source session',
);
assert.match(
  pages,
  /sid === requestedSession && sid === activeSid/,
  'voice and tool updates must render only for the still-active session',
);
assert.doesNotMatch(
  pages,
  /if \(detail\?\.force === true\) \{[\s\S]{0,240}activeSessionId = sid/,
  'forced background renders must not change the selected chat',
);
assert.match(
  pages,
  /if \(sid === MOBILE_CHAT_SESSION_ID\) \{[\s\S]{0,320}startup_notification_ack[\s\S]{0,120}return;/,
  'legacy mobile_default restart notifications must be acknowledged without hydrating hidden history',
);
assert.match(
  pages,
  /const preserveActiveTurn = isDevApply && hasActiveTurn;[\s\S]{0,100}if \(!preserveActiveTurn\) _clearMobileLiveRunForSession\(sid\)/,
  'a no-restart dev apply notification must not finalize an active mobile turn',
);
assert.match(
  pages,
  /if \(liveIndex >= 0\) __pmChat\.threads\[sid\]\.splice\(liveIndex, 0, statusMessage\)/,
  'a dev apply status must render immediately before its continuing tool-stream turn',
);
assert.match(
  pages,
  /currentBubble\.querySelectorAll\('img\[src\]'\)[\s\S]{0,320}stableImageNodes\.set\(src, nodes\)/,
  'streaming bubble patches must retain already-decoded image nodes',
);
assert.match(
  pages,
  /stable\.isConnected === false\) node\.replaceWith\(stable\)/,
  'stable image nodes must be restored synchronously after a streaming repaint',
);
assert.match(
  pages,
  /if \(restartSessionId === MOBILE_CHAT_SESSION_ID\) \{[\s\S]{0,320}_ensureDurableMobileVoiceSession/,
  'mobile slash restart must promote the draft to a durable session first',
);
assert.match(
  settingsRouter,
  /if \(previousSessionId === 'mobile_default'\) \{[\s\S]{0,360}touchSession\(previousSessionId, \{ channel: 'mobile'/,
  'the gateway must rotate legacy mobile_default restart targets to real mobile sessions',
);
assert.match(
  settingsRouter,
  /sessionId: previousSessionId/,
  'the restart endpoint must report the effective durable target session',
);

assert.match(ws, /pm_reload_pending_until/, 'explicit reload must coordinate with service-worker takeover');
assert.match(index, /pendingUntil > Date\.now\(\)/, 'controllerchange must suppress a duplicate pending reload');
assert.match(gatewayServer, /type: 'gateway_heartbeat'/, 'gateway must send application-level WebSocket heartbeats');
assert.match(ws, /_WS_STALE_AFTER_MS/, 'client must track an inbound-silence threshold');
assert.match(ws, /type: 'ws:stale'/, 'client must report and replace an OPEN-but-silent WebSocket');
assert.match(ws, /connectWS\(\{ force: true, timeoutMs: 6000, reconnectDelayMs: 0 \}\)/, 'stale sockets must reconnect immediately');
assert.match(broadcaster, /gateway-event-loop-stalls\.ndjson/, 'gateway must retain event-loop stall diagnostics');
assert.match(auditMaterializer, /new Worker\(__filename/, 'audit materialization must run outside the gateway event loop');
assert.match(auditMaterializer, /prometheus_audit_materializer/, 'audit worker must have an explicit worker entrypoint');

console.log('[mobile-chat-recovery] recovery/replay/reload contract passed');
