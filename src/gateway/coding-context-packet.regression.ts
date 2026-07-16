import assert from 'node:assert/strict';
import {
  getCodingContextPacketTelemetry,
  observeCodingContext,
  resetCodingContextPacketsForTest,
  selectCodingContextPacket,
} from './coding-context-packet';

const root = process.cwd();
const baseTime = Date.UTC(2026, 6, 16, 12, 0, 0);

resetCodingContextPacketsForTest();
observeCodingContext({
  sessionId: 'coding-session',
  objective: 'Fix packet selection in src/gateway/prompt-builder.ts',
  projectRoot: root,
  toolName: 'workspace_read',
  args: { action: 'read', path: 'src/gateway/prompt-builder.ts', startLine: 40, endLine: 80, symbol: 'buildPrompt' },
  result: 'trusted file contents\nDO_NOT_REINJECT_RAW_RESULT',
  now: baseTime,
});
observeCodingContext({
  sessionId: 'coding-session',
  objective: 'continue',
  projectRoot: root,
  toolName: 'workspace_run',
  args: { action: 'typecheck', command: 'npx tsc --noEmit' },
  result: 'raw verification prose that must not be stored',
  error: false,
  artifacts: [{ path: 'artifacts/typecheck.json' }],
  now: baseTime + 1_000,
});

const warm = selectCodingContextPacket({
  enabled: true,
  sessionId: 'coding-session',
  message: 'Continue the prompt-builder.ts fix.',
  projectRoot: root,
  executionMode: 'interactive',
  history: [{ role: 'assistant', content: 'I found the selection seam and am still working.' }],
  now: baseTime + 2_000,
});
assert.equal(warm.status, 'injected');
assert.match(warm.block, /CODING_CONTEXT_PACKET_V2/);
assert.match(warm.block, /src\/gateway\/prompt-builder\.ts/);
assert.match(warm.block, /buildPrompt/);
assert.match(warm.block, /observed_snapshot_sha256/);
assert.doesNotMatch(warm.block, /authoritative_content_sha256/);
assert.match(warm.block, /npx tsc --noEmit/);
assert.doesNotMatch(warm.block, /DO_NOT_REINJECT_RAW_RESULT|raw verification prose/);
assert.ok(warm.block.length <= 6_000);

const ambiguous = selectCodingContextPacket({
  enabled: true,
  sessionId: 'coding-session',
  message: 'Can you help me write some code?',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 3_000,
});
assert.deepEqual({ status: ambiguous.status, reason: ambiguous.reason }, { status: 'omitted', reason: 'ambiguous_continuation' });

const stale = selectCodingContextPacket({
  enabled: true,
  sessionId: 'coding-session',
  message: 'Continue the prompt-builder.ts fix.',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 31 * 60_000,
});
assert.deepEqual({ status: stale.status, reason: stale.reason }, { status: 'rejected_stale', reason: 'stale_targeted_evidence' });

const cold = selectCodingContextPacket({
  enabled: true,
  sessionId: 'cold-session',
  message: 'Continue',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime,
});
assert.equal(cold.status, 'omitted');

observeCodingContext({
  sessionId: 'task-boundary',
  objective: 'Fix the legacy parser in src/legacy-parser.ts',
  projectRoot: root,
  toolName: 'read_file',
  args: { path: 'src/legacy-parser.ts' },
  result: 'legacy parser content',
  now: baseTime,
});
observeCodingContext({
  sessionId: 'task-boundary',
  objective: 'Add retry accounting to src/retry-counter.ts',
  projectRoot: root,
  toolName: 'read_file',
  args: { path: 'src/retry-counter.ts' },
  result: 'retry counter content',
  now: baseTime + 500,
});
const replacedTask = selectCodingContextPacket({
  enabled: true,
  sessionId: 'task-boundary',
  message: 'Continue the retry-counter.ts work.',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 1_000,
});
assert.equal(replacedTask.status, 'injected');
assert.match(replacedTask.block, /src\/retry-counter\.ts/);
assert.doesNotMatch(replacedTask.block, /legacy-parser/);

observeCodingContext({
  sessionId: 'mutation-session',
  objective: 'Update src/wrapper.ts safely',
  projectRoot: root,
  toolName: 'workspace_read',
  args: { action: 'read', path: 'src/wrapper.ts' },
  result: 'before mutation',
  now: baseTime,
});
observeCodingContext({
  sessionId: 'mutation-session',
  objective: 'Update src/wrapper.ts safely',
  projectRoot: root,
  toolName: 'workspace_read',
  args: { action: 'read', path: 'src/other-target.ts' },
  result: 'another fresh target before mutation',
  now: baseTime + 250,
});
observeCodingContext({
  sessionId: 'mutation-session',
  objective: 'Update src/wrapper.ts safely',
  projectRoot: root,
  toolName: 'workspace_edit',
  args: { action: 'find_replace', path: 'src/wrapper.ts', find: 'before', replace: 'after' },
  result: 'edit succeeded but returned no authoritative content hash',
  now: baseTime + 500,
});
const invalidated = selectCodingContextPacket({
  enabled: true,
  sessionId: 'mutation-session',
  message: 'Continue with src/other-target.ts.',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 1_000,
});
assert.deepEqual({ status: invalidated.status, reason: invalidated.reason }, { status: 'rejected_stale', reason: 'stale_targeted_evidence' });

observeCodingContext({
  sessionId: 'mutation-session',
  objective: 'Update src/wrapper.ts safely',
  projectRoot: root,
  toolName: 'workspace_read',
  args: { action: 'read', path: 'src/wrapper.ts' },
  result: 'after mutation focused snapshot',
  now: baseTime + 1_500,
});
const refreshed = selectCodingContextPacket({
  enabled: true,
  sessionId: 'mutation-session',
  message: 'Continue the src/wrapper.ts update.',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 2_000,
});
assert.equal(refreshed.status, 'injected');

observeCodingContext({
  sessionId: 'source-wrapper-session',
  objective: 'Inspect the source wrapper in src/gateway/source-wrapper.ts',
  projectRoot: root,
  toolName: 'dev_source_read',
  args: { action: 'read', surface: 'src', file: 'gateway/source-wrapper.ts' },
  result: 'focused source wrapper snapshot',
  now: baseTime,
});
const sourceWrapper = selectCodingContextPacket({
  enabled: true,
  sessionId: 'source-wrapper-session',
  message: 'Continue with source-wrapper.ts.',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 1_000,
});
assert.equal(sourceWrapper.status, 'injected');
assert.match(sourceWrapper.block, /src\/gateway\/source-wrapper\.ts/);

assert.deepEqual(getCodingContextPacketTelemetry(), { injected: 4, omitted: 2, rejected_stale: 2 });
console.log('coding-context-packet regression: ok');
