import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { applyToolActivityEvent, coalesceToolActivityEntries, renderToolActivityEntry } from '../web-ui/src/tool-activity.js';

const pages = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-pages.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-chat-page-runtime.js', import.meta.url), 'utf8');
const context = vm.createContext({
  _isMobileReasoningSummaryTraceEntry: () => false,
  _mobileRecoveredTraceInference: () => null,
  _isMobileHiddenRuntimeProcessEntry: () => false,
  _formatChatTime: () => '',
  presentChatError: (error) => error.chatPresentation,
  _appendMobileProcess: (message, type, text) => message.processEntries.push({ type, text }),
  clearMobileRecoveryPlaceholder: () => false,
});
for (const name of ['_normalizeMobileRecoveredTraceEntry', '_normalizeMobileProcessEntry', '_recordMobileChatError', '_clearRecoveredMobileChatError']) {
  const start = pages.indexOf(`function ${name}(`);
  const end = pages.indexOf('\nfunction ', start + 1);
  vm.runInContext(pages.slice(start, end), context);
}
const payload = {
  action: 'workspace_run', args: { action: 'run', command: 'rg -n example web-ui' },
  tool_call_id: 'call_1', runId: 'run_1', result: 'found example\n', exitCode: 0, durationMs: 9300,
};
const live = [];
applyToolActivityEvent(live, 'call', payload);
applyToolActivityEvent(live, 'result', payload);
const recovered = ['tool_call', 'tool_result'].map((event) => context._normalizeMobileProcessEntry({
  type: event, text: event === 'tool_call' ? 'Running command' : 'Ran command · rg -n example web-ui',
  extra: { event, extra: { ...payload } },
}));
const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const classify = (entries) => coalesceToolActivityEntries(entries).map((entry) => ({
  type: entry.type, family: entry.activity?.family, kind: entry.activity?.kind,
  args: entry.activity?.args, result: entry.activity?.result,
  terminal: !!entry.activity?.terminal,
  completed: entry.activity?.terminal?.completed,
}));
assert.deepEqual(classify(recovered), classify(live), 'checkpoint payloads must classify exactly like live tool events');
const merged = coalesceToolActivityEntries([...live.slice(0, 1), ...recovered]);
assert.equal(merged.length, coalesceToolActivityEntries(live).length, 'replayed call/result pairs must not duplicate rows');
const result = merged.find((entry) => entry.activity?.kind === 'result');
const html = renderToolActivityEntry(result, esc);
assert.match(html, /Terminal output/);
assert.match(html, /completed/);
assert.match(html, /found example/);
assert.doesNotMatch(html, /Live terminal|streaming/);
const rich = context._normalizeMobileProcessEntry(live[1]);
assert.equal(rich.activity, live[1].activity, 'normalizing cache entries preserves their structured activity');
const message = { processEntries: [] };
context._recordMobileChatError(message, { mobileStreamDisconnected: true, chatPresentation: { key: 'chat-connection-dropped' } });
assert.equal(message.processEntries.length, 0, 'transport disconnect is never a tool error');
message.errorPresentation = { key: 'chat-connection-dropped' };
message.processEntries.push({ type: 'error', text: 'Connection dropped: Recovery is checking whether Prometheus is still working.' });
message.processEntries.push({ type: 'error', text: 'Real command failure' });
assert.equal(context._clearRecoveredMobileChatError(message), true);
assert.equal(message.processEntries.length, 1);
assert.equal(message.processEntries[0].text, 'Real command failure');
const disconnectBranch = runtime.slice(runtime.indexOf('if (err?.mobileStreamDisconnected) {'), runtime.indexOf('const sourcePresentation = err?.chatPresentation'));
assert.doesNotMatch(disconnectBranch, /_recordMobileChatError|_appendMobileProcess|pmToast/);
console.log('PASS mobile recovery stream shape, terminal completion, deduplication and disconnect status');

// Missing process metadata still has a terminal card from the durable output.
const noRun = coalesceToolActivityEntries([{ type: 'result', text: 'Ran command', extra: { ...payload, runId: undefined } }]);
assert.equal(noRun[0].activity.terminal.completed, true);
assert.match(renderToolActivityEntry(noRun[0], esc), /Terminal output/);
// A start acknowledgement is not process completion.
const started = [];
applyToolActivityEvent(started, 'call', { ...payload, exitCode: undefined, args: { ...payload.args, action: 'start' } });
applyToolActivityEvent(started, 'result', { ...payload, exitCode: undefined, args: { ...payload.args, action: 'start' } });
assert.notEqual(started.find((entry) => entry.activity.kind === 'result').activity.terminal.completed, true);

// Exercise the actual mobile timeline merge, not just the tool classifier.
Object.assign(context, {
  _nowTime: () => '10:00',
  _isMobileTransientReasoningTraceEntry: () => false,
  _dedupeMobileTraceProseText: (text) => String(text || '').trim(),
  _isMobileTraceThoughtType: (type) => ['think', 'preamble', 'assistant'].includes(type),
  _isMobileUserVisibleReasoningTraceEntry: () => true,
  _mobileTraceThoughtKind: (entry) => entry.extra?.reasoningKind || 'summary',
  _isMobileStartupStatusText: () => false,
  _isMobileVisionInjectionStatusText: () => false,
  _isMobileBareThinkingTraceText: () => false,
  _mobileTraceTextLooksLikeFinalAnswer: () => false,
  _mobileVisionPreviewKey: () => '',
  _mobileTraceThoughtTextsSimilar: (a, b) => a === b,
});
for (const name of ['_mobileWorkflowTraceEntriesForMessage', '_mergeMobileWorkflowTraceFromProcessEntries']) {
  const start = pages.indexOf(`function ${name}(`);
  const end = pages.indexOf('\nfunction ', start + 1);
  vm.runInContext(pages.slice(start, end), context);
}
const thought = (text) => ({ type: 'think', text, extra: { source: 'reasoning_summary', reasoningKind: 'summary' } });
const second = recovered.map((entry) => ({ ...entry, extra: { ...entry.extra, tool_call_id: 'call_2', runId: 'run_2' } }));
const cold = { processEntries: [thought('Inspect the source'), ...recovered, thought('Now verify the change'), ...second], liveTraceEntries: [] };
assert.equal(context._mergeMobileWorkflowTraceFromProcessEntries(cold), true);
const coldShape = coalesceToolActivityEntries(cold.liveTraceEntries);
assert.deepEqual(coldShape.map((entry) => entry.activity ? 'tool' : entry.type), ['think', 'tool', 'think', 'tool'], 'cold recovery preserves both reasoning/tool segments, including repeated commands');
assert.deepEqual(coldShape.filter((entry) => entry.activity).map((entry) => entry.activity.callId), ['call_1', 'call_2']);
assert.equal(context._mergeMobileWorkflowTraceFromProcessEntries(cold), false, 'merging the checkpoint twice is idempotent');
const interrupted = { liveTraceEntries: [thought('Inspect the source'), live[0]], processEntries: cold.processEntries };
context._mergeMobileWorkflowTraceFromProcessEntries(interrupted);
const continued = coalesceToolActivityEntries(context._mobileWorkflowTraceEntriesForMessage(interrupted));
assert.deepEqual(continued.map((entry) => entry.activity ? 'tool' : entry.type), ['think', 'tool', 'think', 'tool'], 'warm recovery keeps the normal segmented stream');
assert.ok(continued.filter((entry) => entry.activity).every((entry) => entry.activity.terminal.completed), 'recovered results settle in-flight terminal cards');
const failure = { processEntries: [] };
context._recordMobileChatError(failure, { chatPresentation: { key: 'real-tool-error', title: 'Command failed', message: 'exit 1' } });
assert.equal(failure.processEntries.length, 1, 'real tool failures remain visible');
console.log('mobile recovery stream shape: timeline segmentation, reconnect status, terminal settlement PASS');
