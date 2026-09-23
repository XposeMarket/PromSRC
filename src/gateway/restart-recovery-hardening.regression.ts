import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isPlannedRestartCheckpointAwaitingBoot } from './live-runtime-registry';

// ── 1. A planned-restart checkpoint must always carry a restartEpoch ─────────
//
// Observed 2026-09-22 21:05: a planned gateway_restart turn was recovered as
// `recovery: 'chat_checkpointed'`, but the durable ledger record had no
// `restartEpoch` (the shutdown-side stamp is persisted asynchronously and was
// lost when the old process exited). BOOT only resumes checkpoints that carry
// an epoch, so the continuation turn silently never ran and the user saw only
// the pre-restart tool stream.

const recoveredWithoutEpoch = {
  id: 'r1', kind: 'main_chat', sessionId: 'mobile_x', status: 'interrupted',
  recoveryData: { recovery: 'chat_checkpointed', recoveredAt: Date.now() },
} as any;
assert.equal(
  isPlannedRestartCheckpointAwaitingBoot(recoveredWithoutEpoch),
  false,
  'precondition: a checkpoint without restartEpoch is invisible to BOOT',
);
const recoveredWithEpoch = {
  ...recoveredWithoutEpoch,
  recoveryData: { ...recoveredWithoutEpoch.recoveryData, restartEpoch: Date.now() },
};
assert.equal(isPlannedRestartCheckpointAwaitingBoot(recoveredWithEpoch), true, 'a stamped checkpoint is resumable by BOOT');

const recoverySource = readFileSync(path.join(__dirname, 'runtime-recovery.ts'), 'utf8');
assert.ok(
  /recovery === 'chat_checkpointed' \? \{ restartEpoch \} : \{\}/.test(recoverySource),
  'runtime-recovery must stamp restartEpoch whenever it records chat_checkpointed',
);

// ── 2. Mobile trace merge must match on any shared identity ─────────────────
//
// The live copy of a tool entry carries a stream event key; the durable copy
// restored after reconnect/restart does not. Matching on a single "best" key
// meant the two copies never matched and the tool stream was duplicated.

const pages = readFileSync(path.join(__dirname, '..', '..', 'web-ui', 'src', 'mobile', 'mobile-pages.js'), 'utf8');
const start = pages.indexOf('function _mergeMobileAssistantTurnDetails(');
assert.ok(start > 0, 'merge function must exist');
const mergeListStart = pages.indexOf('const mergeList = (key) => {', start);
const mergeListEnd = pages.indexOf("if (!preserveTargetTrace) {", mergeListStart);
const body = pages.slice(mergeListStart, mergeListEnd);
// eslint-disable-next-line no-new-func
const mergeList = new Function('target', 'source', `const targetRequest = String(target._clientRequestId || '').trim();\n${body}\n mergeList('liveTraceEntries'); return target;`) as (t: any, s: any) => any;

const live = { type: 'tool', callId: 'call_1', action: 'workspace_run', text: 'Running command', extra: { streamId: 's1', seq: 7 } };
const durable = { type: 'tool', callId: 'call_1', action: 'workspace_run', text: 'Running command' };
const merged = mergeList({ liveTraceEntries: [live] }, { liveTraceEntries: [durable] });
assert.equal(merged.liveTraceEntries.length, 1, 'durable copy of a live entry must merge, not duplicate');

const liveNoCall = { type: 'info', text: 'Checking state', extra: { streamId: 's1', seq: 8 } };
const durableNoCall = { type: 'info', text: 'Checking state', extra: { streamId: 's2', seq: 1 } };
const merged2 = mergeList({ liveTraceEntries: [liveNoCall] }, { liveTraceEntries: [durableNoCall] });
assert.equal(merged2.liveTraceEntries.length, 1, 'same entry replayed under a new stream id must not duplicate');

const distinct = mergeList(
  { liveTraceEntries: [{ type: 'tool', callId: 'a', text: 'x' }] },
  { liveTraceEntries: [{ type: 'tool', callId: 'b', text: 'y' }] },
);
assert.equal(distinct.liveTraceEntries.length, 2, 'distinct entries must still both be kept');

console.log('restart-recovery-hardening regression: ok');
