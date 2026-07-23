import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const api = read('web-ui/src/mobile/mobile-api.js');
const pages = read('web-ui/src/mobile/mobile-pages.js');
const shell = read('web-ui/src/mobile/mobile-shell.js');
const ws = read('web-ui/src/ws.js');
const index = read('web-ui/index.html');
const router = read('src/gateway/routes/chat.router.ts');
const historyReconciliation = read('src/gateway/history-reconciliation.ts');
const settingsRouter = read('src/gateway/routes/settings.router.ts');
const gatewayServer = read('src/gateway/core/server.ts');
const broadcaster = read('src/gateway/comms/broadcaster.ts');
const auditMaterializer = read('src/gateway/audit/materializer.ts');
const sessionStore = read('src/gateway/session.ts');
const webPush = read('src/gateway/notifications/web-push.ts');

const composerRafDeclaration = pages.indexOf('let chatComposerSpaceRaf = 0;');
const composerShiftDeclaration = pages.indexOf('let chatComposerShiftAnimation = null;');
const firstComposerSpaceCall = pages.indexOf('updateChatComposerSpace();');
assert.ok(composerRafDeclaration >= 0, 'mobile chat must declare its composer RAF state');
assert.ok(composerShiftDeclaration >= 0, 'mobile chat must declare its composer animation state');
assert.ok(firstComposerSpaceCall >= 0, 'mobile chat must size its composer during startup');
assert.match(api, /reconcileMobileChatPushNotifications/, 'mobile push must reconcile a stale browser subscription with the gateway');
assert.match(api, /_sameApplicationServerKey/, 'a VAPID key rotation must replace the old browser subscription');
assert.match(pages, /wsEventBus\.on\('task_notification'/, 'task completion must surface as a mobile in-app notification');
assert.match(pages, /wsEventBus\.on\('bg_agent_done'/, 'background agent completion must surface as a mobile in-app notification');
assert.match(pages, /_showMobileCompletionToast/, 'mobile completion notifications must render as tappable top toasts');
assert.match(webPush, /\^\(\?:mailto:\|https:\\\/\\\/\)/, 'VAPID contact subjects must not use an invalid http gateway URL');
assert.ok(
  composerRafDeclaration < firstComposerSpaceCall && composerShiftDeclaration < firstComposerSpaceCall,
  'composer animation state must initialize before startup can call updateChatComposerSpace',
);

assert.match(api, /const _sessionRequests = new Map\(\)/, 'session hydration requests must be coalesced');
assert.match(api, /const fullProcess = options\.fullProcess === undefined \? force : options\.fullProcess === true/, 'forced recovery hydration must request complete process entries by default');
assert.match(api, /\$\{fullProcess \? '&fullProcess=1' : ''\}\$\{force \? '&_fresh=1' : ''\}/, 'session hydration must independently encode fresh and full-process modes');
assert.match(pages, /const PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE = 20/, 'mobile chat history must use bounded 20-message pages');
assert.match(pages, /\.slice\(firstRenderedIndex\)/, 'mobile chat must only render the active message window');
assert.match(pages, /if \(isUpwardScroll && scrollTop <= 80\) loadOlderMobileMessages\(\)/, 'scrolling to the top must load the next history page');
assert.match(router, /const fullProcess = full \|\| req\.query\.fullProcess/, 'session API must support full process recovery');
assert.match(router, /processEntries: checkpointProcessEntries/, 'active runtime status must expose its durable tool checkpoint');
assert.match(router, /clientRequestId: runtime\?\.clientRequestId/, 'active runtime status must expose stable turn identity across reconnects');
assert.match(router, /router\.post\('\/api\/mobile\/chat\/reconcile\/:sessionId'/, 'mobile must have an explicit server reconciliation action');
assert.match(router, /mergeHistoryWithExistingMessageMetadata\(existingHistory, rawHistory, \{[\s\S]{0,100}preserveAllExisting: isMobileHistorySyncRequest\(req\)/, 'mobile history sync must merge into durable server history rather than replacing it');
assert.match(historyReconciliation, /options\.preserveAllExisting \|\| serverOnly/, 'truncated mobile history must preserve ordinary server messages as well as system metadata');
assert.match(historyReconciliation, /incomingByKey/, 'reconnect retries must dedupe stable client message identities');
assert.match(router, /MAIN_CHAT_ORPHAN_GRACE_MS/, 'ownerless stream/lease state must expire instead of blocking indefinitely');
assert.match(router, /mainChatTurnCoordinator\.discard\(sid\)/, 'reconciliation must discard both a stale lease and queued stale work');

assert.match(pages, /let mobileRecoveryInFlight = null/, 'mobile recovery must be single-flight');
assert.match(
  pages,
  /async function _reconcileMobilePendingApprovals\(\{ retry = true \} = \{\}\)/,
  'mobile must have one authoritative pending-approval reconciler',
);
assert.match(
  pages,
  /bus\.on\('ws:open', reconcile\)[\s\S]{0,260}addEventListener\('pageshow', reconcile\)[\s\S]{0,220}visibilitychange', reconcileWhenVisible/,
  'approval reconciliation must run after websocket recovery, bfcache restore, and foregrounding',
);
assert.match(
  pages,
  /const delay = \[400, 1200, 3000\]/,
  'a transient approval hydration failure must retry with bounded backoff',
);
assert.match(
  pages,
  /const reconcile = \(\) => \{\s*if \(!getDeviceToken\(\)\) return;/,
  'approval recovery must not poll protected APIs before a phone is paired',
);
assert.match(
  pages,
  /_getPendingApprovalsForSession\(activeSessionId\)[\s\S]{0,420}!node\.closest\('#pm-global-approval-host'\)/,
  'pending approvals without an inline render host must use the standalone mobile sheet',
);
assert.match(
  pages,
  /const voiceRoute = String\(window\.location\?\.hash \|\| ''\)\.startsWith\('#mobile\/voice'\)[\s\S]{0,180}__pmVoice\?\.targetSessionId/,
  'the standalone approval surface must follow the selected voice target on the voice route',
);
assert.match(
  pages,
  /pending\.map\(\(approval\) => _renderMobileApprovalCard\(approval\)\)\.join\(''\)/,
  'the standalone recovery sheet must expose every pending approval for the active session',
);
assert.doesNotMatch(
  pages,
  /__pmChat\.pendingApprovals\[sid\] = list\.slice\(-8\)/,
  'unresolved approvals must not be silently discarded by a client-side card cap',
);
assert.doesNotMatch(
  pages,
  /if \(_mobileBackgroundSpawnIdFromSessionId\(sid\)\) \{[\s\S]{0,220}return activeSid/,
  'an orphaned background approval must not be attached to whichever chat happens to be open',
);
assert.match(
  pages,
  /_scheduleMobileThreadCacheSave\(sid\);\s*_renderMobileApprovalSheet\(\);/,
  'every full chat repaint must restore the standalone approval fallback when needed',
);
assert.match(
  pages,
  /_reconcileMobilePendingApprovals\(\{ retry: true \}\)\.catch\(\(\) => \[\]\)/,
  'main-chat recovery must use the retrying approval reconciler instead of a one-shot silent fetch',
);
assert.match(
  pages,
  /wsEventBus\?\.on\?\.\('internal_watch_sse', onInternalWatchSse\)/,
  'mobile chat must consume the dedicated internal-watch stream immediately',
);
assert.match(
  pages,
  /if \(event === 'runtime_registered'\) \{[\s\S]{0,420}source: 'internal_watch'/,
  'an internal-watch runtime registration must immediately create a visible mobile working turn',
);
assert.match(
  pages,
  /scheduleMobileRunRecovery\(event === 'runtime_registered' \? 0 : 120, \{ force: true, fullRefresh: false \}\)/,
  'internal-watch events must recover through the durable main-chat stream instead of racing duplicate tool envelopes',
);
assert.match(
  pages,
  /\['voice_foreground_worker', 'internal_watch_review'\]\.includes/,
  'an internal-watch trace-only turn must not be folded into the prior assistant reply',
);
assert.match(
  router,
  /watchRuntime = reconciledTurn\.runtime\?\.source === 'internal_watch'/,
  'a message racing a server-started watch review must be admitted as a steer',
);
assert.match(
  router,
  /workflowLabel: 'Message during internal watch review'/,
  'watch-race steers must be persisted as visible durable user messages',
);
assert.match(pages, /reconcileMobileChatTurn\(busySessionId\)/, 'composer gating must consult authoritative server state before queueing behind local cache');
assert.match(api, /recoveryRetried = true/, 'a stale active-turn response may be recovered at most once');
assert.match(api, /reconcileMobileChatTurn\(sessionId\)/, 'stream transport must reconcile a stale 409 before retrying the idempotent request');
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
assert.match(
  pages,
  /_clientRequestId: String\(m\?\._clientRequestId \|\| m\?\.clientRequestId \|\| ''\)\.trim\(\) \|\| undefined/,
  'server history hydration must preserve the request identity of steer continuations',
);
assert.match(
  pages,
  /function _findMobileRecoverableAssistantTurn[\s\S]{0,700}messageKind \|\| ''\)\.trim\(\) === 'steer_continuation'/,
  'recovery must resolve the durable post-steer assistant before creating another bubble',
);
assert.match(
  pages,
  /messageKind: 'steer_continuation'[\s\S]{0,360}_clientRequestId: latestAi\._clientRequestId/,
  'a steer must create a durable request-owned continuation turn',
);
const sameTurnStart = pages.indexOf('function _mobileMessagesRepresentSameTurn');
const workflowIdentityCheck = pages.indexOf('const aWorkflowPart = String(a.workflowPart', sameTurnStart);
const requestIdentityCheck = pages.indexOf('if (aRequest || bRequest)', sameTurnStart);
assert.ok(
  sameTurnStart >= 0 && workflowIdentityCheck > sameTurnStart && requestIdentityCheck > workflowIdentityCheck,
  'workflow segment identity must be checked before a shared runtime request ID',
);
assert.match(
  pages,
  /String\(msg\._clientRequestId \|\| ''\)\.trim\(\) === candidateRequestId\s*&& _mobileMessagesRepresentSameTurn\(msg, candidate\)/,
  'a completed pre-steer assistant must not evict a pending continuation with the same request ID',
);
assert.match(
  pages,
  /_clearRecoveredMobileChatError\(aiTurn\);\s*aiTurn\.streaming = true/,
  'live frames must clear the connection placeholder and revive the existing continuation in place',
);
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
const fullThreadRenderStart = pages.indexOf('function _renderThread');
const fullThreadImageCapture = pages.indexOf("threadEl.querySelectorAll('img[src]')", fullThreadRenderStart);
const fullThreadHtmlReplace = pages.indexOf('threadEl.innerHTML = ', fullThreadImageCapture);
const fullThreadImageRestore = pages.indexOf('node.replaceWith(stable)', fullThreadHtmlReplace);
assert.ok(
  fullThreadRenderStart >= 0
    && fullThreadImageCapture > fullThreadRenderStart
    && fullThreadHtmlReplace > fullThreadImageCapture
    && fullThreadImageRestore > fullThreadHtmlReplace,
  'full thread renders must retain decoded images from completed turns',
);
assert.match(
  pages,
  /if \(restartSessionId === MOBILE_CHAT_SESSION_ID\) \{[\s\S]{0,320}_ensureDurableMobileVoiceSession/,
  'mobile slash restart must promote the draft to a durable session first',
);
assert.match(api, /pinnedAt: Number\(s\?\.pinnedAt \|\| 0\) \|\| null/, 'mobile session summaries must retain the durable pinnedAt field');
assert.match(shell, /_migrateLegacyPinnedSessionsToServer[\s\S]{0,900}body: JSON\.stringify\(\{ pinned: true \}\)/, 'legacy local mobile pins must migrate to durable session pins');
assert.match(shell, /async function _togglePin[\s\S]{0,900}method: 'PATCH'[\s\S]{0,180}pinned: nextPinned/, 'mobile pin toggles must persist through the session PATCH endpoint');
assert.match(sessionStore, /if \(!!aPinned !== !!bPinned\) return bPinned \? 1 : -1/, 'durable pinned sessions must sort ahead of ordinary session pagination');
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
