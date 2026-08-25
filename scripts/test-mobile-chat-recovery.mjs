import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { createTimelineEntries, createWeightedTimelineController } from '../web-ui/src/features/chat/timeline/weighted-timeline.js';
import { reconcileKeyedTimelineRows } from '../web-ui/src/features/chat/timeline/keyed-dom.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const api = read('web-ui/src/mobile/mobile-api.js');
const pages = read('web-ui/src/mobile/mobile-pages.js');
const toolActivityRuntime = read('web-ui/src/features/chat/optional/tool-activity-runtime.js');
const desktop = read('web-ui/src/pages/ChatPage.js');
const shell = read('web-ui/src/mobile/mobile-shell.js');
const mobileBadge = read('web-ui/src/mobile/mobile-model-badge.js');
const mobileRouter = read('web-ui/src/mobile/mobile-router.js');
const desktopEntry = read('web-ui/src/desktop-entry.js');
const settingsReturn = read('web-ui/src/settings-return.js');
const mobileFeedback = read('web-ui/src/mobile/mobile-feedback.js');
const mobileCss = read('web-ui/src/styles/mobile.css');
const ws = read('web-ui/src/ws.js');
const index = read('web-ui/index.html');
const router = read('src/gateway/routes/chat.router.ts');
const durableTrace = read('src/gateway/durable-chat-trace.ts');
const runtimeRecovery = read('src/gateway/runtime-recovery.ts');
const historyReconciliation = read('src/gateway/history-reconciliation.ts');
const settingsRouter = read('src/gateway/routes/settings.router.ts');
const gatewayServer = read('src/gateway/core/server.ts');
const broadcaster = read('src/gateway/comms/broadcaster.ts');
const auditMaterializer = read('src/gateway/audit/materializer.ts');
const sessionStore = read('src/gateway/session.ts');
const webPush = read('src/gateway/notifications/web-push.ts');

assert.match(mobileRouter, /document\.getElementById\('settings-modal'\)/, 'mobile settings must reuse the full desktop settings modal when it is present');
assert.match(mobileRouter, /buildMobileSettingsHandoffUrl\(window\.location, tab\)/, 'the lightweight mobile document must boot canonical Settings with a safe return route');
assert.match(settingsReturn, /desktop: '1',[\s\S]{0,120}settings: '1'/, 'the Settings handoff must explicitly boot the desktop document');
assert.match(settingsReturn, /query\.set\(MOBILE_SETTINGS_SOURCE_PARAM, 'pwa'\)/, 'the Settings handoff must remember PWA mode without sending source=pwa to the desktop request');
assert.match(mobileRouter, /page === 'settings' && !document\.getElementById\('settings-modal'\)[\s\S]{0,180}return Promise\.resolve\(\)/, 'a lightweight settings deep link must redirect before rendering the retired mobile owner');
assert.match(desktopEntry, /settingsParams\.get\('settings'\) === '1'[\s\S]{0,900}window\.openSettings\(requestedSettingsTab \|\| undefined\)/, 'desktop boot must open the settings modal requested by the mobile handoff');
assert.match(mobileFeedback, /font-family:var\(--pm-font\),system-ui,-apple-system,sans-serif/, 'mobile status toasts must use the mobile system font');
assert.match(mobileCss, /\.pm-completion-toast\s*\{[\s\S]{0,560}font-family:\s*var\(--pm-font\)/, 'completion toasts must use the mobile system font');
assert.match(mobileCss, /\.pm-msheet\s*\{[\s\S]{0,360}font-family:\s*var\(--pm-font\)/, 'mobile model and reasoning sheets must use the mobile system font');
assert.match(mobileCss, /\.pm-project-row \.pm-session-title\s*\{[\s\S]{0,100}font-family:\s*var\(--pm-font\)/, 'drawer project titles must use the same mobile font as chat sessions');
assert.match(mobileCss, /\.pm-tab\s*\{[\s\S]{0,320}color:\s*rgba\(34,26,20,\.68\)/, 'resting light tab icons must remain muted');
assert.match(mobileCss, /:root\[data-theme="dark"\] \.pm-tab\s*\{\s*color:\s*rgba\(242,238,231,\.66\)/, 'resting dark tab icons must remain muted');
assert.match(mobileCss, /\.pm-tab-magnify-cell svg\s*\{[\s\S]{0,100}color:\s*#fff/, 'only the icon clone beneath the liquid slider should be white');
assert.match(mobileCss, /body\.pm-mobile-active \.pm-tab,[\s\S]{0,180}color:\s*rgba\(34,26,20,\.68\)/, 'the final mobile cascade must keep light tab icons muted');
assert.match(mobileCss, /:root\[data-theme="dark"\] body\.pm-mobile-active \.pm-tab,[\s\S]{0,180}color:\s*rgba\(242,238,231,\.66\)/, 'the final mobile cascade must keep dark tab icons muted');
assert.match(mobileCss, /body\.pm-mobile-active \.pm-tab svg\s*\{\s*color:\s*currentColor/, 'resting tab SVGs must inherit the muted tab color');
assert.match(mobileCss, /\.pm-new-project-popover\s*\{[^}]*--pm-new-project-available-height[^}]*box-sizing:\s*border-box[^}]*overflow-y:\s*auto/, 'new-project modal must fit and scroll within the visual viewport');
assert.match(pages, /syncNewProjectPopoverToKeyboard\(false, Number\(window\.visualViewport\?\.height/, 'new-project modal must size itself as soon as it opens');

const composerRafDeclaration = pages.indexOf('let chatComposerSpaceRaf = 0;');
const composerShiftDeclaration = pages.indexOf('let chatComposerShiftAnimation = null;');
const firstComposerSpaceCall = pages.indexOf('updateChatComposerSpace();');
assert.ok(composerRafDeclaration >= 0, 'mobile chat must declare its composer RAF state');
assert.ok(composerShiftDeclaration >= 0, 'mobile chat must declare its composer animation state');
assert.ok(firstComposerSpaceCall >= 0, 'mobile chat must size its composer during startup');
assert.match(api, /reconcileMobileChatPushNotifications/, 'mobile push must reconcile a stale browser subscription with the gateway');
assert.match(api, /originReason/, 'mobile history writes must support a source-specific origin reason');
assert.match(pages, /originReason: 'visual_state'/, 'visual state persistence must not look like a normal history refresh');
assert.match(pages, /mobile_visual_state/, 'mobile must ignore the visual-state history acknowledgement locally');
assert.match(router, /historyChangeSource: isMobileVisualStateSyncRequest/, 'the gateway must label visual-state history writes separately');
assert.match(desktop, /DESKTOP_ACTIVE_CHAT_RUNS_KEY/, 'desktop must persist the active chat run across reloads');
assert.match(desktop, /recoverDesktopMainChatSession/, 'desktop must have a foreground stream recovery path');
assert.match(desktop, /const rememberedSessionId = recallActiveChatSessionId\(\)/, 'desktop startup must reconsider the last active session');
assert.match(desktop, /forgetLocalMainChatRequest\(thisSessionId, clientRequestId, \{ immediate: true \}\)/, 'a dropped desktop SSE request must re-enter replay ownership');
assert.match(desktop, /addEventListener\('pagehide', \(\) => \{[\s\S]{0,420}rememberDesktopActiveChatRun/, 'desktop must persist an active turn before a page lifecycle disconnect');
assert.match(desktop, /stream ended before completion/, 'desktop must treat an incomplete SSE body as recoverable');
assert.doesNotMatch(desktop, /events\.slice\(-MAIN_CHAT_STREAM_CATCHUP_EVENT_CAP\)/, 'desktop replay must not discard the beginning of a retained tool stream');
assert.match(api, /_sameApplicationServerKey/, 'a VAPID key rotation must replace the old browser subscription');
assert.match(pages, /wsEventBus\.on\('task_notification'/, 'task completion must surface as a mobile in-app notification');
assert.match(pages, /wsEventBus\.on\('bg_agent_done'/, 'background agent completion must surface as a mobile in-app notification');
assert.match(pages, /_showMobileCompletionToast/, 'mobile completion notifications must render as tappable top toasts');
assert.match(
  pages,
  /resetChatDictationComposerState = \(\) => \{[\s\S]{0,560}chatSpeechEnabled = false;[\s\S]{0,560}micBtn\?\.classList\.remove\('listening'\)/,
  'sending a main-chat message must end transcription mode and clear its active mic state',
);
assert.doesNotMatch(
  pages,
  /resetChatDictationComposerState = \(\) => \{[\s\S]{0,720}scheduleChatDictationCycle\(/,
  'sending a main-chat message must not restart transcription after clearing the composer',
);
assert.match(webPush, /\^\(\?:mailto:\|https:\\\/\\\/\)/, 'VAPID contact subjects must not use an invalid http gateway URL');
assert.ok(
  composerRafDeclaration < firstComposerSpaceCall && composerShiftDeclaration < firstComposerSpaceCall,
  'composer animation state must initialize before startup can call updateChatComposerSpace',
);
assert.match(
  pages,
  /_pmVisualViewport\.addEventListener\('scroll', _onVvScroll, \{ passive: true \}\)/,
  'the keyboard composer must follow iOS visual-viewport pans while chat history scrolls',
);
assert.match(
  pages,
  /_pmVisualViewport\.removeEventListener\('scroll', _onVvScroll\)/,
  'the keyboard visual-viewport scroll listener must be removed during chat cleanup',
);

assert.match(api, /const _sessionRequests = new Map\(\)/, 'session hydration requests must be coalesced');
assert.match(api, /const _mobileHistoryWriteQueues = new Map\(\)/, 'mobile history writes must be serialized per session');
assert.match(api, /const previous = _mobileHistoryWriteQueues\.get\(queueKey\) \|\| Promise\.resolve\(\)/, 'mobile history writes must wait for the prior snapshot');
assert.match(api, /if \(_mobileHistoryWriteQueues\.get\(queueKey\) === write\) _mobileHistoryWriteQueues\.delete\(queueKey\)/, 'mobile history write queues must release only their own settled write');
assert.match(api, /const fullProcess = options\.fullProcess === undefined \? force : options\.fullProcess === true/, 'forced recovery hydration must request complete process entries by default');
assert.match(api, /\$\{fullProcess \? '&fullProcess=1' : ''\}\$\{force \? '&_fresh=1' : ''\}/, 'session hydration must independently encode fresh and full-process modes');
assert.match(pages, /const PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE = 20/, 'mobile chat history must use bounded 20-message pages');
{
  const entries = createTimelineEntries(Array.from({ length: 500 }, (_, index) => ({
    messageId: `recovery-window-${index}`, role: index % 2 ? 'assistant' : 'user', content: `turn ${index}`, timestamp: index + 1,
  })));
  const timeline = createWeightedTimelineController({ surface: 'mobile' }).select('recovery', entries, { followTail: true });
  assert.equal(timeline.paintEntries.length, 52, 'mobile chat must retain a bounded active paint window');
  assert.equal(timeline.lastPaintIndex, 499, 'the active mobile window must include the latest message');
  assert.equal(timeline.omittedBefore, 448, 'older loaded messages must remain available outside the DOM window');
}
assert.match(pages, /if \(isUpwardScroll && scrollTop <= 80\) loadOlderMobileMessages\(\)/, 'scrolling to the top must load the next history page');
assert.match(router, /const fullProcess = full \|\| req\.query\.fullProcess/, 'session API must support full process recovery');
assert.match(router, /processEntries: checkpointProcessEntries/, 'active runtime status must expose its durable tool checkpoint');
assert.match(router, /buildDurableChatTraceFromFrames\(stream\.events/, 'completed turns must use the shared durable trace adapter');
assert.match(durableTrace, /return entries\.length \? entries : undefined/, 'ordinary tool traces must not depend on a vision event');
assert.match(durableTrace, /reasoning_summary_delta/, 'durable recovery must retain explicit user-visible reasoning summaries');
assert.match(runtimeRecovery, /liveTraceEntries = buildDurableChatTraceFromProcessEntries/, 'restart checkpoints must persist the structured recovery trace');
assert.match(pages, /_normalizeMobileRecoveredTraceEntry/, 'mobile recovery must normalize legacy raw process rows before rendering');
assert.match(toolActivityRuntime, /entry\?\.extra\?\.action \|\| entry\?\.extra\?\.toolName/, 'cold recovery rows must load the existing tool activity renderer');
assert.match(toolActivityRuntime, /normalizeLegacyToolActivityEntry/, 'legacy tool event-shaped rows must be normalized before rich coalescing');
assert.match(pages, /rawType = String\(entry\.type \|\| entry\.kind \|\| ''\)\.toLowerCase\(\)/, 'mobile recovery must inspect legacy event-shaped trace types');
assert.match(pages, /rawType === 'tool_result'/, 'mobile recovery must convert legacy tool_result rows into result rows');
assert.match(pages, /__pmMobileBackgroundAgentDetailRender/, 'background detail recovery must repaint after the rich renderer loads');

// The rich tool renderer is deliberately lazy. Recovered mobile history must
// still be compact during that import window, then converge to the same
// operation/result records used by live streaming once the chunk is ready.
globalThis.__PROM_TOOL_ACTIVITY_IMPORT_FOR_TESTS = () => new Promise((resolve) => {
  setTimeout(() => import('../web-ui/src/tool-activity.js').then(resolve), 20);
});
const recoveryRuntime = await import('../web-ui/src/features/chat/optional/tool-activity-runtime.js?mobile-recovery-race=1');
const recoveredLegacyTrace = [
  {
    type: 'tool_call',
    text: 'Preparing browser_scroll_collect',
    extra: { event: 'tool_call', toolName: 'browser_scroll_collect', args: { direction: 'down' } },
  },
  {
    type: 'tool_result',
    text: 'Page: https://x.com/search?q=Hermes',
    extra: { event: 'tool_result' },
  },
];
const coldTrace = recoveryRuntime.coalesceToolActivityEntries(recoveredLegacyTrace);
assert.ok(coldTrace.some((entry) => entry.activity?.kind === 'operation'), 'cold recovery must not paint a raw tool_call block');
assert.ok(coldTrace.some((entry) => entry.activity?.kind === 'result'), 'cold recovery must not paint a raw tool_result block');
assert.ok(coldTrace.every((entry) => String(entry.text || '').length < 180), 'cold recovery placeholders must stay compact');
await recoveryRuntime.loadToolActivityFeature();
const readyTrace = recoveryRuntime.coalesceToolActivityEntries(recoveredLegacyTrace);
assert.ok(readyTrace.some((entry) => entry.activity?.kind === 'operation'), 'ready recovery must use the live operation renderer');
assert.ok(readyTrace.some((entry) => entry.activity?.kind === 'result'), 'ready recovery must use the live result renderer');
assert.equal(readyTrace.find((entry) => entry.activity?.kind === 'result')?.activity?.action, 'browser_scroll_collect', 'unnamed recovered results must attach to the preceding operation');
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
assert.ok(
  pages.indexOf('__pmChat.lastMobileSendAttempt = { key: sendAttemptKey, at: Date.now() };')
    < pages.indexOf('selectedGateway = await probeGateway(selectedGateway);'),
  'mobile send admission must be claimed before the awaited gateway probe',
);
assert.match(pages, /const sendAttemptKey = `\$\{msg\}\|\$\{files\.map/, 'duplicate-send admission must remain stable while a draft session is promoted');
assert.match(pages, /previousSendAttempt\?\.key === sendAttemptKey[\s\S]{0,100}< 8000/, 'one physical iOS send must remain suppressed through session promotion');
assert.match(
  pages,
  /Commit and paint the user row before camera summarization[\s\S]{0,900}activeThread\.push\(optimisticUserTurn\)[\s\S]{0,160}renderThreadNow\(\)[\s\S]{0,500}_clearMobileBackgroundSpawnDockForSession/,
  'the optimistic user row must paint before optional mobile send preflight',
);
assert.match(router, /const assistantRequestIdentity =[\s\S]{0,260}clientRequestId:[\s\S]{0,9000}role: 'assistant',[\s\S]{0,100}\.\.\.assistantRequestIdentity/, 'canonical assistant history must retain the mobile request identity');
assert.match(
  pages,
  /const isPendingUser = msg\.role === 'user'[\s\S]{0,260}msg\._pmOptimistic === true[\s\S]{0,180}pendingUserAge < 45_000/,
  'recovery hydration must retain a recent optimistic user turn while server history catches up',
);
assert.match(
  pages,
  /const seenRequests = new Map\(\)[\s\S]{0,900}_mergeMobileAssistantTurnDetails/,
  'assistant recovery dedupe must collapse duplicate bubbles by stable request identity across user boundaries',
);
assert.match(
  pages,
  /const separatedByUser = list\.slice\(prevIndex \+ 1, i\)[\s\S]{0,420}Math\.abs\(currentAt - previousAt\) < 30_000/,
  'recent identical responses from duplicate admissions must collapse even when recovery placed the user turn between them',
);
assert.match(
  pages,
  /restore user -> assistant ordering[\s\S]{0,620}list\.splice\(assistantIndex, 0, user\)/,
  'recovery must restore a request-owned user turn before its assistant response',
);
assert.match(
  mobileBadge,
  /onLostPointerCapture[\s\S]{0,360}onVisibilityChange/,
  'the tabbar gesture must cancel when pointer capture or page lifecycle state is lost',
);
assert.match(
  mobileCss,
  /\.pm-drawer\s*\{[\s\S]{0,220}width: var\(--pm-drawer-width\);[\s\S]{0,120}box-sizing: border-box;/,
  'drawer padding must remain inside the same width used to shift the app shell',
);
assert.match(
  mobileCss,
  /\.pm-msg\s*\{[\s\S]{0,160}width: fit-content;[\s\S]{0,120}max-width: min\(86%, calc\(100vw - 28px\)\)/,
  'the shared message row must retain the proven bounded fit-content sizing',
);
assert.match(
  mobileCss,
  /\.pm-msg\.from-user \.pm-bubble\s*\{[\s\S]{0,180}width: fit-content;[\s\S]{0,180}overflow-wrap: anywhere;/,
  'the user bubble must use the prior fit-content sizing and wrap within the row bound',
);
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
  /const completedTraceEntries = \(!m\.streaming \|\| finalFrameReceived \|\| traceFrozenForSteer\) \? _mobileWorkflowTraceEntriesForMessage\(m\) : \[\]/,
  'a final response or frozen pre-steer trace must expose its preserved tool trace immediately',
);
assert.match(
  pages,
  /aiTurn\._pmFinalReceived = true;[\s\S]{0,420}aiTurn\.workEndedAt = Number\(evt\.workEndedAt \|\| aiTurn\.workEndedAt \|\| Date\.now\(\)\)/,
  'the final frame must freeze the authoritative displayed work duration',
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
assert.match(pages, /mobileRecoveryOwners/, 'mobile recovery ownership must survive page rerenders within a tab');
assert.match(pages, /const isMobileRecoveryOwner = \(\) => !mobileRecoveryDisposed[\s\S]{0,160}mobileRecoveryOwners/, 'a stale page recovery must stop mutating the current chat');
assert.match(pages, /function scheduleMobileRunRecovery\([\s\S]{0,260}if \(!isMobileRecoveryOwner\(\)\) return;/, 'a stale page recovery must not replace the current page timer');
assert.match(pages, /const startingWasBusy = startingRun\.busy === true \|\| !!remembered/, 'recovery must detect a new run that started while an older recovery request was awaiting');
assert.match(pages, /function _adoptMobileActiveRunState/, 'a tab observing another tab must adopt the server run identity before replay');
assert.match(pages, /const rememberedBusyRun = _readMobileActiveRun\(busySessionId\)/, 'composer admission must honor an active run remembered by another tab');
assert.match(pages, /const requeueRejectedAdmission = \(\) =>/, 'a duplicate-tab admission race must return the speculative prompt to the queue');
assert.match(pages, /const queueKey = String\(clientRequestId \|\| ''\)\.trim\(\)/, 'duplicate-tab queue dedupe must use request identity rather than prompt text');
assert.match(pages, /const canonicalStreamAdopted = aiTurn && aiTurn\._pmAdmissionPending !== true/, 'a late canonical stream must protect its adopted assistant trace from 409 cleanup');
assert.doesNotMatch(pages, /title: 'Restoring active request'/, 'duplicate-tab admission must not render a second restoring assistant bubble');
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
  /const replay = await loadMobileChatStreamReplay\(requestedSession, 0\)/,
  'inactive recovery must request the canonical stream replay before deciding what to clear',
);
const inactiveReplayIndex = pages.indexOf('const replay = await loadMobileChatStreamReplay(requestedSession, 0)');
const inactiveClearIndex = pages.indexOf('_clearMobileLiveRunForSession(requestedSession);', inactiveReplayIndex);
assert.ok(inactiveReplayIndex >= 0 && inactiveClearIndex > inactiveReplayIndex, 'inactive recovery must inspect replay/history before clearing a cached streaming turn');
assert.match(
  pages,
  /if \(replayStillActive \|\| \(localAiTurn\?\.streaming && !completedDurableTurn && status\?\.recovered !== true\)\)/,
  'a transient inactive read must preserve the visible turn while another tab or the gateway may still be working',
);
assert.match(pages, /const recoveryStartedAt = Number\([\s\S]{0,260}localAiTurn\?\.timestamp/, 'inactive recovery must scope durable-history completion to the recovered turn boundary');
assert.match(router, /stream: reconciliation\.stream \? \{[\s\S]{0,300}lastSeq:/, 'run status must expose the canonical stream cursor for cross-tab recovery');
assert.match(pages, /addEventListener\('pageshow', runRecoveryOnReturn\)/, 'bfcache/app resume must trigger recovery');
assert.match(pages, /_saveMobileThreadCache\(requestedSession, _activeMobileThread\(\)\)/, 'recovered live trace must survive a hard reload');
assert.match(
  pages,
  /_clientRequestId: String\(m\?\._clientRequestId \|\| m\?\.clientRequestId \|\| ''\)\.trim\(\) \|\| undefined/,
  'server history hydration must preserve the request identity of steer continuations',
);
assert.match(pages, /function _mobileHistoryPageIsPartial\(session, history = \[\]\)/, 'mobile recovery must recognize bounded gateway history pages');
assert.match(pages, /preserveLocalHistory: _mobileHistoryPageIsPartial\(session, history\)/, 'bounded recovery pages must preserve the existing local transcript');
assert.match(pages, /mergeOlderHistory: _mergeMobileHistoryPageWithCurrent/, 'mobile older paging must use a non-destructive prepend merge');
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
{
  const { document } = parseHTML('<!doctype html><html><body><main id="thread"><article data-pm-row-key="settled" data-pm-row-signature="1"><img src="stable.png"></article><article data-pm-row-key="active" data-pm-row-signature="1">working</article></main></body></html>');
  const thread = document.getElementById('thread');
  const settledRow = thread.children[0];
  const decodedImage = settledRow.querySelector('img');
  const stats = reconcileKeyedTimelineRows(thread, '<article data-pm-row-key="settled" data-pm-row-signature="1"><img src="stable.png"></article><article data-pm-row-key="active" data-pm-row-signature="2">done</article>');
  assert.equal(thread.children[0], settledRow, 'settled keyed rows must survive an active-row commit');
  assert.equal(thread.querySelector('img'), decodedImage, 'decoded images in settled rows must retain DOM identity');
  assert.equal(stats.updated, 1, 'a terminal transition must update only the active row');
}
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
