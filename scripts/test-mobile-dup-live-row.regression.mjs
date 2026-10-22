import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Regression: session mobile_mvj22x2p_5ywavq rendered [ghost assistant, user, live assistant]
// after gateway restarts during one long turn. The server checkpoint for the same request came
// back with a new stream id and re-serialized trace ids, so the recovery merge treated it as a
// new row and inserted it before its next anchor (the user prompt) -> index 0.
const source = ts.createSourceFile('mobile-pages.js', fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(['_mobileRecoveredLiveTraceTarget', '_mergeMobileHistoryRecords']);
const functions = source.statements.filter((s) => ts.isFunctionDeclaration(s) && names.has(s.name?.text)).map((s) => s.getText(source));
assert.equal(functions.length, 2);
const ctx = vm.createContext({
  _mergeMobileUserTurnDetails: () => {},
  _mergeMobileMediaIntoMessage: () => {},
  _collectMessageMedia: () => [],
  _mergeMobileProductCarouselIntoMessage: () => {},
  _mobileMessageCopyText: (m) => String(m?.body?.text || m?.content || ''),
  _mobileCanonicalTextIsTrailingFragment: () => false,
  // Same identity rules the real helper uses for these shapes: equal messageId, or the same object.
  _mobileHistoryTurnsRepresentSameTurn: (a, b) => a === b || (!!a.messageId && a.messageId === b.messageId),
  _mergeMobileAssistantTurnDetails: (target, candidate) => {
    target.liveTraceEntries = [...new Map([...(target.liveTraceEntries || []), ...(candidate.liveTraceEntries || [])].map((e) => [e.id, e])).values()];
    if (candidate.richArtifacts) target.richArtifacts = [...(target.richArtifacts || []), ...candidate.richArtifacts];
  },
});
vm.runInContext(functions.join('\n'), ctx);

const R = 'mobile_mvj22x2p_5ywavq_mvj22x6j_c17lrsgi';
const makeLocal = (liveOverrides = {}) => {
  const user = { role: 'user', messageId: 'u1', _clientRequestId: R, content: 'Build it' };
  const live = { role: 'ai', messageId: 'live', streaming: true, _clientRequestId: R, _streamId: 'S1', liveTraceEntries: [{ id: 'memory-1' }], ...liveOverrides };
  return { user, live };
};
const checkpoint = (overrides = {}) => ({
  role: 'ai', messageId: 'server-ckpt', _clientRequestId: R, _streamId: 'S2',
  liveTraceEntries: [{ id: 'srv-1' }, { id: 'srv-2' }],
  richArtifacts: [{ kind: 'image', path: 'out.png' }],
  ...overrides,
});
const run = (local, incoming) => ctx._mergeMobileHistoryRecords(local, incoming, { appendOnlyNewer: true, serverAuthoritativeText: true });

// Positive: post-restart checkpoint (new stream id, different trace ids, artifact) listed before the user.
{
  const { user, live } = makeLocal();
  const merged = run([user, live], [checkpoint(), { ...user }]);
  assert.deepEqual([...merged].map((m) => m.messageId), ['u1', 'live'], 'same-request checkpoint merges into the live row, no ghost above the prompt');
  assert.equal(live.richArtifacts?.length, 1, 'artifact from the checkpoint lands on the live row');
}
// Positive: the live row was frozen by the restart (not streaming, not final) -> still the same turn.
{
  const { user, live } = makeLocal({ streaming: false });
  const merged = run([user, live], [checkpoint(), { ...user }]);
  assert.deepEqual([...merged].map((m) => m.messageId), ['u1', 'live']);
}
// Invariant: a same-request assistant that cannot merge (live already final) is never placed before its user.
{
  const { user, live } = makeLocal({ streaming: false, _pmFinalReceived: true });
  const merged = run([user, live], [checkpoint(), { ...user }]);
  assert.ok(merged.findIndex((m) => m.messageId === 'server-ckpt') > merged.indexOf(user), 'assistant never precedes the user sharing its request id');
}
// Negative polarity: genuinely different turns stay separate.
{
  const { user, live } = makeLocal();
  const merged = run([user, live], [checkpoint({ _clientRequestId: 'other-request', messageId: 'older' }), { ...user }]);
  assert.equal(merged.filter((m) => m.role === 'ai').length, 2, 'different request id is a different turn');
  assert.equal(merged[0].messageId, 'older', 'unrelated older turn keeps its page position');
}
{
  const { user, live } = makeLocal();
  const merged = run([user, live], [{ ...user }, checkpoint({ workflowPart: 'before_interruption', workflowGroupId: 'chat_steer_1' })]);
  assert.equal(merged.filter((m) => m.role === 'ai').length, 2, 'before_interruption row stays separate');
}
{
  const { user, live } = makeLocal({ workflowGroupId: 'chat_steer_1', workflowPart: 'continuation' });
  const merged = run([user, live], [{ ...user }, checkpoint({ workflowGroupId: 'chat_steer_1', workflowPart: 'source' })]);
  assert.equal(merged.filter((m) => m.role === 'ai').length, 2, 'different steer workflow part stays separate');
}
console.log('PASS mobile dup live row: post-restart same-request checkpoint merges into the live row; distinct turns stay separate');
