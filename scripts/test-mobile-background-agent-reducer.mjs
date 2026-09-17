import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  findBackgroundAgentWork,
  persistBackgroundAgentWork,
  readBackgroundAgentWork,
  resolveBackgroundAgentIdentity,
  backgroundAgentRecordToMessage,
} from '../web-ui/src/features/chat/core/background-agent-work.js';

const { window } = parseHTML('<!doctype html><html><head></head><body><div id="pm-background-spawn-dock"></div></body></html>');
const storage = {
  data: new Map(),
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; },
  setItem(key, value) { this.data.set(key, String(value)); },
  removeItem(key) { this.data.delete(key); },
};
window.localStorage = storage;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = storage;
globalThis.CustomEvent ||= class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};

const { createMobileChatRendererRuntime } = await import('../web-ui/src/mobile/mobile-chat-renderer-runtime.js');

const sessionId = 'mobile_test_session';
const chat = {
  activeSessionId: sessionId,
  backgroundSpawnLanes: {},
  backgroundSpawnClearedIds: {},
  backgroundSpawnDockOpen: {},
  pendingApprovals: {},
  threads: { [sessionId]: [] },
};
const noop = () => {};
const runtime = createMobileChatRendererRuntime({
  __pmChat: chat,
  __pmVoice: {},
  MOBILE_CHAT_SESSION_ID: 'mobile_default',
  PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE: 24,
  _activeMobileThread: () => chat.threads[sessionId],
  _appendMobileProcess: noop,
  _appendMobileLiveTrace: (message, type, text, options = {}) => {
    if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
    message.liveTraceEntries.push({ type, text, extra: options.extra || null });
  },
  _appendMobileCompactionTrace: noop,
  _appendMobileVisionTrace: noop,
  _applyMobileToolActivity: noop,
  _collectMediaFromToolEvent: noop,
  _findMobileVoiceWorkerByTaskId: () => null,
  _isMobileAssistantMessage: (message) => message?.role === 'ai' || message?.role === 'assistant',
  _isMobileUserVisibleReasoningTraceEntry: () => true,
  _mobileBackgroundSpawnIdFromSessionId: (value) => String(value || '').startsWith('background_')
    ? String(value).slice('background_'.length)
    : '',
  _mobileBackgroundStoredProcessEntries: (record) => Array.isArray(record?.events) ? record.events.slice() : [],
  _mobileWorkflowTraceEntriesForMessage: (message) => Array.isArray(message?.liveTraceEntries) ? message.liveTraceEntries : [],
  _mobileApprovalVisibleSessionId: () => sessionId,
  _mobileGoalStepStatus: noop,
  _normalizeMobileApproval: (value) => value,
  _upsertMobilePendingApproval: noop,
  _updateMobilePendingApproval: noop,
  _linkMobileApprovalToBackgroundLane: () => null,
  _renderMobileSourceList: noop,
  _renderMobileGoalPill: noop,
  _nowTime: () => '9:00 AM',
  _renderMobileMarkdown: (value) => String(value || ''),
  _renderMobileApprovalCard: noop,
  _renderMobileWorkTimer: noop,
  _formatMobileWorkDuration: (value) => `${Number(value || 0)}ms`,
  _formatMobileGoalElapsed: noop,
  _renderMobileLiveTracePreview: noop,
  _renderMobileProcess: noop,
  _pmCssEscape: (value) => String(value || ''),
  _reconcileMobileThreadOrder: (value) => value,
  _isMobileProgressNarration: () => false,
  _setMobileLiveProgressNarration: noop,
  _maybeFlushMobileThinkingBeforeEvent: noop,
  _handleMobileCleanThought: (message, evt) => {
    if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
    message.liveTraceEntries.push({ type: 'think', text: String(evt?.text || '') });
  },
  _handleMobileReasoningSummaryDelta: noop,
  _handleMobileThinkingDelta: noop,
  _mergeMobileRichArtifacts: noop,
  _mergeMobileProcessEntries: (message, entries) => {
    if (!Array.isArray(message.processEntries)) message.processEntries = [];
    message.processEntries.push(...(Array.isArray(entries) ? entries : []));
  },
  _refreshMobileSourcesForSession: noop,
  _normalizeMobileFileChanges: (value) => value,
  _captureMobileApprovalDetailsState: noop,
  _captureMobileQuestionDraftState: noop,
  _captureMobileWorkerDeckViewState: noop,
  _getPendingApprovalsForSession: () => [],
  _mobileAssistantWorkStartedAt: () => Date.now(),
  _mobileFileExt: noop,
  _mobileTimelineEntries: () => [],
  _mobileToolEventName: noop,
  _dedupeMobileTraceProseText: noop,
  _isMobileBareThinkingTraceText: () => false,
  _isMobileImageGenerationStreamEntry: () => false,
  _isMobileTraceReasoningSummaryType: () => false,
  _isMobileTraceThoughtFragmentText: () => false,
  _isMobileTraceThoughtType: () => false,
  _isMobileVisionInjectionStatusText: () => false,
  _mobileTraceComparableText: noop,
  _mobileTraceJsonPayload: noop,
  _mobileTraceThoughtTextsSimilar: () => false,
  _mobileVoiceWorkgroupStatus: noop,
  _normalizeMobileMedia: noop,
  _normalizeMobileMediaList: () => [],
  _normalizeMobileQuestion: noop,
  _normalizeMobileVoiceWorkgroup: noop,
  _pmApprovalTitle: noop,
  _renderBrowseCard: noop,
  _renderMobileApprovalSheet: noop,
  _renderMobileChatErrorPresentation: noop,
  _renderMobileFileChanges: noop,
  _renderMobileGeneratedImageLoadingCard: noop,
  _renderMobileMediaGallery: noop,
  _renderMobileMessageActions: noop,
  _renderMobileProductCarousel: noop,
  _renderMobileRichArtifacts: noop,
  _renderMobileSkillReferencedMarkdown: noop,
  _renderMobileThreadLinkArtifacts: noop,
  _renderMobileUserEditComposer: noop,
  _renderMobileVoiceLyrics: noop,
  _renderMobileVoiceWorkgroup: noop,
  _wireMobileApprovalActionButton: noop,
  _restoreMobileApprovalDetailsState: noop,
  _restoreMobileQuestionDraftState: noop,
  _safeJsonPreview: (value) => String(value || ''),
  _scheduleMobileThreadCacheSave: noop,
  _syncMobileQuestionComposerPopover: noop,
  _wireMobileChatEnhancements: noop,
  _wireMobileProcessRunActions: noop,
  captureKeyedScrollState: noop,
  chatTimelineRowSignature: noop,
  escapeHtml: (value) => String(value || ''),
  loadBgTaskDetail: noop,
  mobileChatRuntimeAdapter: {},
  mobileGatewayFetch: noop,
  mobileStreamRenderScheduler: {},
  mobileTimelineController: {},
  pmHaptic: noop,
  pmToast: noop,
  reconcileKeyedTimelineRows: noop,
  setInnerHTMLPreservingVisuals: noop,
  uploadMobileBinaryFile: noop,
  uploadMobileTextFile: noop,
  wsEventBus: { on: noop, off: noop },
  __pmRealtimeAgent: {},
  _getMobileGoalForSession: noop,
  _mobileGoalStepStatus: noop,
  _renderMobileGoalPill: noop,
  _mobileBackgroundSpawnIsVoiceWorker: () => false,
  mobileSourceState: {},
  persistBackgroundAgentWork,
  findBackgroundAgentWork,
  loadMobileBackgroundStatus: noop,
  resolveBackgroundAgentIdentity,
  appendFinalResponseDelta: (existing, chunk) => `${existing || ''}${chunk || ''}`,
  beginFinalResponse: (message) => { message.finalResponseStarted = true; },
  reconcileFinalResponse: (_live, canonical) => String(canonical || ''),
});

const id = 'bg_reducer_fixture';
const event = (eventType, seq, data = {}) => ({
  type: 'bg_agent_event',
  bgId: id,
  sessionId,
  spawnerSessionId: sessionId,
  backgroundSessionId: `background_${id}`,
  eventType,
  streamId: 'stream_fixture',
  seq,
  at: Date.now() + seq,
  data,
  prompt: 'Inspect the repository and report the result.',
});

assert.equal(runtime._pushMobileBackgroundSpawnEvent(event('status', 1, { state: 'in_progress', message: 'Background agent started.' }), sessionId), true);
assert.equal(runtime._pushMobileBackgroundSpawnEvent(event('tool_call', 2, { name: 'Read', args: { path: 'src/example.ts' } }), sessionId), true);
assert.equal(runtime._pushMobileBackgroundSpawnEvent(event('tool_result', 3, { name: 'Read', result: 'Read src/example.ts' }), sessionId), true);
assert.equal(runtime._pushMobileBackgroundSpawnEvent(event('agent_thought', 4, { text: 'I found the relevant implementation.' }), sessionId), true);
let lane = chat.backgroundSpawnLanes[id];
assert.ok(lane.message.processEntries.length >= 2, 'tool activity must be retained in the live lane');
assert.ok(lane.message.liveTraceEntries.length >= 1, 'live trace/thoughts must be retained in the live lane');

assert.equal(runtime._completeMobileBackgroundSpawnLane({
  type: 'bg_agent_done',
  bgId: id,
  sessionId,
  spawnerSessionId: sessionId,
  state: 'completed',
  data: { result: { text: 'The final background answer survived the nested done envelope.' } },
}, sessionId), true);

lane = chat.backgroundSpawnLanes[id];
const detail = runtime.backgroundDetailRecord(id, sessionId, (entry) => entry, (record) => record.message);
assert.equal(lane.status, 'completed');
assert.equal(lane.message.streaming, false);
assert.match(lane.result, /final background answer survived/);
assert.match(lane.message.content, /final background answer survived/);
assert.match(detail.result, /final background answer survived/);

assert.equal(runtime._pushMobileBackgroundSpawnEvent(event('final', 5, {
  result: { output: 'A replayed final result alias is reduced as assistant text.' },
}), sessionId), true);
lane = chat.backgroundSpawnLanes[id];
assert.match(lane.message.content, /replayed final result alias/);

const finalOnlyId = 'bg_final_only_fixture';
assert.equal(runtime._pushMobileBackgroundSpawnEvent({
  ...event('final', 1, { text: 'A final stream frame is terminal even if its done notification is missed.' }),
  bgId: finalOnlyId,
  backgroundId: finalOnlyId,
}, sessionId), true);
const finalOnlyLane = chat.backgroundSpawnLanes[finalOnlyId];
assert.equal(finalOnlyLane.status, 'completed');
assert.match(finalOnlyLane.message.content, /final stream frame is terminal/);

const coldRecord = {
  id: 'bg_cold_fixture',
  sessionId,
  status: 'completed',
  finalResult: { content: 'Cold cached result alias is recoverable.' },
};
persistBackgroundAgentWork(coldRecord, { immediate: true });
const normalizedCold = findBackgroundAgentWork(coldRecord.id, sessionId);
assert.match(normalizedCold.result, /Cold cached result alias/);
assert.match(backgroundAgentRecordToMessage(normalizedCold).content, /Cold cached result alias/);
assert.ok(readBackgroundAgentWork().some((record) => record.id === coldRecord.id));

// A completed run with no textual result must still have a visible terminal
// answer instead of the screenshot's empty bubble.
const emptyMessage = backgroundAgentRecordToMessage({ id: 'bg_empty_fixture', sessionId, status: 'completed' });
assert.equal(emptyMessage.content, 'Background task completed with no textual output.');

const promptOnlyId = 'bg_prompt_only_fixture';
runtime._upsertMobileBackgroundSpawnLane({
  bgId: promptOnlyId,
  sessionId,
  spawnerSessionId: sessionId,
  state: 'running',
  prompt: 'This task prompt must not be shown as the answer.',
  message: {
    role: 'ai',
    content: 'This task prompt must not be shown as the answer.',
    body: { text: 'This task prompt must not be shown as the answer.' },
    processEntries: [],
    liveTraceEntries: [],
    streaming: true,
  },
}, sessionId);
runtime._completeMobileBackgroundSpawnLane({
  type: 'bg_agent_done',
  bgId: promptOnlyId,
  sessionId,
  spawnerSessionId: sessionId,
  state: 'completed',
}, sessionId);
const promptOnlyRecord = runtime.backgroundDetailRecord(promptOnlyId, sessionId, (entry) => entry, (record) => record.message);
assert.equal(promptOnlyRecord.result, '', 'the original task prompt must never become the terminal answer');

console.log('mobile background-agent reducer: ok');
