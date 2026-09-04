import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeRecoveredTraceEntries,
  normalizeRecoveredTraceEntry,
} from '../web-ui/src/features/chat/runtime/recovered-trace.js';
import { coalesceToolActivityEntries } from '../web-ui/src/tool-activity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const desktop = read('web-ui/src/pages/ChatPage.js');

assert.match(desktop, /features\/chat\/runtime\/recovered-trace\.js/, 'desktop must use the recovered trace normalizer');
assert.match(desktop, /normalizeRecoveredTraceEntries\(message\?\.liveTraceEntries\)/, 'desktop must normalize recovered live trace rows');
assert.match(desktop, /\['user', 'summary', 'visible'\]\.includes\(visibility\)/, 'desktop must retain user-visible reasoning summaries');
assert.match(desktop, /params\.set\('fullProcess', '1'\)/, 'desktop recovery must request the complete per-message process trace');
assert.match(desktop, /mergeTraceField\('liveTraceEntries', 500\)/, 'desktop server/local merges must preserve recovered live traces');
assert.match(desktop, /const historyRef = Array\.isArray\(sess\.history\) \? sess\.history : \[\]/, 'recovery must retain the in-flight history array identity');
assert.match(desktop, /historyRef\.splice\(0, historyRef\.length, \.\.\.mergedHistory\)/, 'recovery must commit history merges in place');
assert.match(desktop, /const processLogRef = Array\.isArray\(sess\.processLog\) \? sess\.processLog : \[\]/, 'recovery must retain the in-flight process log identity');

const recovered = [
  {
    type: 'info',
    content: 'Planning the workspace read',
    extra: { event: 'reasoning_summary_delta', source: 'reasoning_summary' },
  },
  {
    type: 'info',
    content: ' and keeping the result compact',
    extra: { event: 'reasoning_summary_delta', source: 'reasoning_summary' },
  },
  {
    type: 'info',
    content: 'Preparing workspace_read',
    extra: { event: 'tool_call', args: { path: 'README.md' } },
  },
  {
    type: 'info',
    content: 'README contents',
    extra: { event: 'tool_result' },
  },
  {
    type: 'info',
    content: 'Checking the next step',
    extra: { event: 'token_narration_boundary' },
  },
];

const normalized = normalizeRecoveredTraceEntries(recovered);
assert.deepEqual(normalized.map((entry) => entry.type), ['think', 'tool', 'result', 'preamble']);
assert.equal(normalized[0].text, 'Planning the workspace read and keeping the result compact');
assert.equal(normalized[0].extra.source, 'reasoning_summary');
assert.equal(normalized[0].extra.visibility, 'user');
assert.equal(normalized[1].extra.action, 'workspace_read');
assert.equal(normalized[2].type, 'result');
assert.equal(normalized[3].extra.source, 'agent_progress');
assert.equal(normalized[3].extra.visibility, 'user');

const sourceOnlySummary = normalizeRecoveredTraceEntry({
  type: 'info',
  content: 'A summary restored without an explicit event name',
  extra: { source: 'reasoning_summary' },
});
assert.equal(sourceOnlySummary.type, 'think', 'legacy reasoning source metadata must be enough to recover a thought');

const privateThought = normalizeRecoveredTraceEntry({
  type: 'thinking',
  text: 'provider-private thought',
  extra: { visibility: 'private' },
});
assert.equal(privateThought, null, 'private provider thinking must stay hidden during desktop recovery');

const rich = coalesceToolActivityEntries(normalized);
const operation = rich.find((entry) => entry?.activity?.kind === 'operation');
const result = rich.find((entry) => entry?.activity?.kind === 'result');
assert.ok(operation, 'recovered legacy tool calls must become operation cards');
assert.ok(result, 'recovered legacy tool results must become result cards');
assert.equal(operation.activity.action, 'workspace_read');
assert.equal(result.activity.action, 'workspace_read', 'unnamed recovered results must attach to the preceding operation');
assert.equal(rich.filter((entry) => entry?.type === 'info').length, 0, 'legacy event rows must not fall through as raw info blocks');

console.log('[desktop-chat-recovery] legacy tool/reasoning normalization, rich coalescing, privacy filtering, and recovery contracts passed');
