const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const pages = fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8');
const runtime = fs.readFileSync('web-ui/src/mobile/mobile-chat-page-runtime.js', 'utf8');
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n(?:  )?(?:async )?function /);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}
const context = vm.createContext({ console, Date, Math, Set,
  _nowTime: () => 'now', sideState: {},
  backgroundAgentText: (...values) => String(values.find(Boolean) || ''),
  _mobileBackgroundAgentDetailPrompt: () => '',
  _mobileBackgroundAgentDetailEvents: record => record.processEntries || [],
  _isMobileTransientReasoningTraceEntry: () => false,
  _isMobileReasoningSummaryTraceEntry: () => false,
  _mobileRecoveredTraceInference: () => null,
  _dedupeMobileTraceProseText: text => text,
  _mobileVisionPreviewKey: () => '',
  _mergeMobileWorkflowTraceFromProcessEntries: () => {},
  _flushMobileTraceThoughtProbe: () => {},
  _appendMobileStreamingText: (a, b) => a + b,
});
for (const name of ['_mobileCompactionStatusFromText', '_normalizeMobileRecoveredTraceEntry',
  '_setMobileLiveProgressNarration', '_appendMobileCompactionTrace']) {
  vm.runInContext(extract(pages, name), context);
}
vm.runInContext(extract(runtime, '_mobileBackgroundAgentDetailMessage'), context);
const triple = [
  { id: 'trace_stream_1357', seq: 1357, type: 'tool_call', action: 'context_compaction', text: 'Compacting context' },
  { id: 'trace_stream_1358', seq: 1358, type: 'tool_result', action: 'context_compaction', text: 'Thread compacted mid-workflow...', extra: { summary: 'Saved workflow' } },
  { id: 'trace_stream_1359', seq: 1359, type: 'info', text: 'Context compacted. Continuing the active workflow...' },
];
const before = { id: 'before', type: 'info', text: 'Before work' };
const after = { id: 'after', type: 'info', text: 'After work' };
const record = { status: 'running', processEntries: triple,
  liveTraceEntries: [before, ...triple, after], message: {
    liveTraceEntries: triple.map((entry, index) => ({ ...entry, id: `mtrace_compact_${index}` })),
  } };
const result = context._mobileBackgroundAgentDetailMessage(record).liveTraceEntries;
assert.equal(result.filter(entry => entry.type === 'compaction').length, 1);
assert.equal(result[0].id, 'before');
assert.equal(result[1].status, 'compacted');
assert.equal(result[1].summary, 'Saved workflow');
assert.equal(result[2].id, 'after');
const separate = context._mobileBackgroundAgentDetailMessage({ ...record,
  liveTraceEntries: [...record.liveTraceEntries, ...triple.map(e => ({ ...e, id: e.id + '_second' }))],
}).liveTraceEntries;
assert.equal(separate.filter(e => e.type === 'compaction').length, 2);
const message = {};
for (const delta of ['wait for the', ' `sync:web-ui` run to', ' finish.']) {
  context._setMobileLiveProgressNarration(message, delta);
}
assert.equal(message.liveTraceEntries[0].text, 'wait for the `sync:web-ui` run to finish.');
const trailing = {};
for (const delta of ['by ', 'this ', 'root cause']) context._setMobileLiveProgressNarration(trailing, delta);
assert.equal(trailing.liveTraceEntries[0].text, 'by this root cause');
const live = {};
context._appendMobileCompactionTrace(live, 'compacting');
live.liveTraceEntries.push({ type: 'info', text: 'Processing...' });
context._appendMobileCompactionTrace(live, 'compacted', 'Saved');
context._appendMobileCompactionTrace(live, 'compacting');
assert.equal(live.liveTraceEntries.filter(e => e.type === 'compaction').length, 1);
assert.equal(live.liveTraceEntries[0].status, 'compacted');
console.log('PASS mobile bg compaction triple, chronology, separate events, status and delta spacing');
