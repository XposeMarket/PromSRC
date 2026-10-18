import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = ts.createSourceFile('mobile-pages.js', fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(['_mobileRecoveredLiveTraceTarget', '_mergeMobileHistoryRecords']);
const functions = source.statements.filter((s) => ts.isFunctionDeclaration(s) && names.has(s.name?.text)).map((s) => s.getText(source));
assert.equal(functions.length, 2);
const ctx = vm.createContext({
  _mergeMobileUserTurnDetails: () => {},
  _mergeMobileMediaIntoMessage: () => {},
  _collectMessageMedia: () => [],
  _mergeMobileProductCarouselIntoMessage: () => {},
  _mobileHistoryTurnsRepresentSameTurn: (a, b) => !!a.messageId && a.messageId === b.messageId,
  _mergeMobileAssistantTurnDetails: (target, candidate) => {
    target.liveTraceEntries = [...new Map([...(target.liveTraceEntries || []), ...(candidate.liveTraceEntries || [])].map((e) => [e.id, e])).values()];
  },
});
vm.runInContext(functions.join('\n'), ctx);
const user = { role: 'user', messageId: 'prompt', content: 'Work' };
const live = { role: 'ai', messageId: 'local', streaming: true, _streamId: 'run-1', liveTraceEntries: [{ id: 'tool-1' }] };
const recovered = { role: 'ai', messageId: 'recovered', _streamId: 'run-1', liveTraceEntries: [{ id: 'tool-1' }, { id: 'tool-2' }] };
// The server row precedes its first matched neighbor: the old merge inserted it
// at index zero, above the first user, while retaining the live row at the tail.
let merged = ctx._mergeMobileHistoryRecords([user, live], [recovered, user], { appendOnlyNewer: true });
assert.equal(merged.length, 2);
assert.equal(merged[0], user);
assert.equal(merged[1], live);
assert.equal(live.liveTraceEntries.length, 2);
assert.equal(merged.filter((row) => row.role === 'ai').length, 1);
assert.equal(ctx._mobileRecoveredLiveTraceTarget([user, live], { ...recovered, _streamId: 'another' }), null);
assert.equal(ctx._mobileRecoveredLiveTraceTarget([user, live], { ...recovered, _clientRequestId: 'other' }), live);
live._clientRequestId = 'request-1';
assert.equal(ctx._mobileRecoveredLiveTraceTarget([user, live], { ...recovered, _clientRequestId: 'other' }), null);
assert.equal(ctx._mobileRecoveredLiveTraceTarget([user, live], { ...recovered, workflowPart: 'before_interruption' }), null);
const stripped = { role: 'ai', liveTraceEntries: [{ id: 'tool-1' }] };
assert.equal(ctx._mobileRecoveredLiveTraceTarget([user, live], stripped), live, 'trace event identity survives stripped row identity');
assert.equal(ctx._mobileRecoveredLiveTraceTarget([user, live], { role: 'ai', liveTraceEntries: [{ id: 'unrelated' }] }), null);
console.log('PASS single live tool stream: recovery next-anchor merge retains one bottom assistant and rejects unrelated runs');
