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
assert.equal(mobileReplayFrameAfterSteer({ streamId: 'stream_2', seq: 1, at: 1999 }, steer), false);
assert.equal(mobileReplayFrameAfterSteer({ streamId: 'stream_2', seq: 1, at: 2001 }, steer), true);
console.log('[mobile steer boundary] durable split, frozen prefix and replay filtering passed');
