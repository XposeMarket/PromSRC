import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { mobileReplayFrameAfterSteer } from '../web-ui/src/mobile/mobile-chat-page-runtime.js';

const file = 'web-ui/src/mobile/mobile-pages.js';
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(['_appendMobileQueuedSteerTurn', '_settleMobileChatSteerWorkflow', '_isMobileMessagePersistable']);
const functions = [];
for (const statement of source.statements) {
  if (ts.isFunctionDeclaration(statement) && names.has(statement.name?.text)) functions.push(statement.getText(source));
}
assert.equal(functions.length, names.size);
const original = { role: 'ai', streaming: true, _clientRequestId: 'request_1',
  workStartedAt: 1000, timestamp: 1000, body: { text: '' }, content: '', processEntries: [], liveTraceEntries: [{ type: 'tool', text: 'Earlier call' }] };
const thread = [original];
const sandbox = {
  __pmChat: { threads: { session: thread }, activeSessionId: 'other' },
  _findLatestAssistantTurn: (items) => [...items].reverse().find((item) => item.role === 'ai'),
  _appendMobileProcess: (item, type, text) => item.processEntries.push({ type, text }),
  _nowTime: () => '11:00',
  _mobileAssistantWorkStartedAt: (item) => item.workStartedAt,
  _saveMobileThreadCache: () => {},
  _persistMobileChatSteerSnapshot: () => Promise.resolve(true),
  _setMobileChatSteerContinuationTurn: (sourceTurn, continuation) => { sourceTurn._steerContinuationTurn = continuation; },
  _isMobileChatSteerWorkflowGroup: (value) => /^chat_steer_/.test(value),
  _mobileAssistantHasVisibleAnswer: () => false,
  document: { getElementById: () => null },
};
vm.createContext(sandbox);
vm.runInContext(functions.join('\n'), sandbox);
assert.equal(sandbox._appendMobileQueuedSteerTurn('session', 'Continue building', {
  workflowGroupId: 'chat_steer_1', workflowBoundarySeq: 12, workflowStreamId: 'stream_1', timestamp: 2000,
}), true);
assert.deepEqual(thread.map((item) => item.workflowPart), ['before_interruption', 'interruption', 'interruption_response']);
assert.equal(original.streaming, false, 'the earlier stream stops at the steer');
assert.equal(original.liveTraceEntries.length, 1, 'the earlier trace stays fixed');
assert.equal(thread[1].workflowBoundarySeq, 12);
assert.equal(thread[2].workflowStreamId, 'stream_1');
assert.equal(sandbox._isMobileMessagePersistable(thread[2]), true, 'empty continuation survives the snapshot');
assert.equal(sandbox._settleMobileChatSteerWorkflow(thread, thread[2]), false);
assert.equal(thread.length, 3, 'finalization keeps the split');

const steer = thread[1];
assert.equal(mobileReplayFrameAfterSteer({ streamId: 'stream_1', seq: 12, at: 1999 }, steer), false);
assert.equal(mobileReplayFrameAfterSteer({ streamId: 'stream_1', seq: 13, at: 1999 }, steer), true);
assert.equal(mobileReplayFrameAfterSteer({ streamId: 'stream_2', seq: 1, at: 1999 }, steer), true,
  'a new stream is the post-steer continuation even when the phone and gateway clocks differ');
assert.equal(mobileReplayFrameAfterSteer({ streamId: 'stream_2', seq: 1, at: 2001 }, steer), true);
// The server's before-row id becomes the frozen row's identity so history
// merges dedupe it, and the continuation id survives serialization.
const thread2 = [{ role: 'ai', streaming: true, _clientRequestId: 'r2', workStartedAt: 1, timestamp: 1, body: { text: '' }, content: '', processEntries: [], liveTraceEntries: [] }];
sandbox.__pmChat.threads.s2 = thread2;
assert.equal(sandbox._appendMobileQueuedSteerTurn('s2', 'Go left', {
  workflowGroupId: 'chat_steer_9', messageId: 'chat-steer:9', beforeMessageId: 'chat_steer_9:before', workflowBoundarySeq: 40, workflowStreamId: 's', timestamp: 3000,
}), true);
assert.equal(thread2[0].messageId, 'chat_steer_9:before');
assert.equal(JSON.parse(JSON.stringify(thread2[0])).steerContinuationMessageId, 'chat_steer_9:continuation', 'link survives a JSON round trip');
// The WS echo of the same steer must not split twice.
assert.equal(sandbox._appendMobileQueuedSteerTurn('s2', 'Go left', { workflowGroupId: 'chat_steer_9', messageId: 'chat-steer:9' }), true);
assert.equal(thread2.length, 3, 'duplicate steer (WS + POST) is idempotent');
console.log('[mobile steer boundary] durable split, frozen prefix and replay filtering passed');

// Restart recovery can be waiting on an agent: neither WS acknowledgement nor
// POST reconciliation may depend on a subsequent stream/tool frame.
const restartThread = [{ role: 'ai', streaming: true, body: { text: '' }, liveTraceEntries: [] }];
sandbox.__pmChat.threads.restart = restartThread;
sandbox.__pmChat.activeSessionId = 'restart';
let paints = 0;
sandbox.document.getElementById = (id) => id === 'pm-chat-thread' ? {} : null;
sandbox._commitMobileTranscriptCache = () => {};
sandbox._renderThread = () => { paints += 1; };
sandbox._scrollChat = () => {};
const preview = { kind: 'image', name: 'phone.png', workspacePath: 'uploads/phone.png', mimeType: 'image/png' };
sandbox._appendMobileQueuedSteerTurn('restart', 'Look at this', {
  clientSteerId: 'queue-image', messageId: 'pending-steer:queue-image',
  workflowGroupId: 'chat_steer_pending_queue-image', attachmentPreviews: [preview],
});
assert.equal(paints, 1, 'optimistic steer paints without a tool event');
sandbox._appendMobileQueuedSteerTurn('restart', 'Look at this', {
  clientSteerId: 'queue-image', messageId: 'durable-image', workflowGroupId: 'chat_steer_image',
  beforeMessageId: 'chat_steer_image:before', workflowBoundarySeq: 9, attachmentPreviews: [preview],
});
assert.equal(restartThread.length, 3, 'WS-before-POST acknowledgement adopts optimistic split');
assert.equal(restartThread[1].messageId, 'durable-image');
assert.equal(restartThread[1].body.attachments[0].workspacePath, preview.workspacePath);
assert.equal(restartThread[2].messageId, 'chat_steer_image:continuation');
assert.equal(restartThread[0].steerContinuationMessageId, 'chat_steer_image:continuation');
assert.equal(paints, 2, 'acknowledgement immediately repaints');
const mobileSource = fs.readFileSync(file, 'utf8');
const listener = mobileSource.slice(mobileSource.indexOf("wsEventBus.on('chat_steer'"), mobileSource.indexOf("wsEventBus.on('main_chat_stream_event'"));
assert.doesNotMatch(listener, /activeRuns|_readMobileActiveRun/, 'accepted steer must survive a cleared restart busy marker');
assert.match(mobileSource, /attachments: uploadResults\.filter/, 'mobile steers transmit image payloads as well as previews');
assert.match(fs.readFileSync('src/gateway/routes/chat/steer.ts', 'utf8'), /clientSteerId: clientSteerId \|\| undefined,[\s\S]*displayMessage:/, 'broadcast correlates the optimistic steer');
console.log('[mobile steer boundary] immediate restart paint, image preview and acknowledgement race passed');
