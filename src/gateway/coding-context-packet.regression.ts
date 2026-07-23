import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getCodingContextPacketTelemetry,
  observeCodingContext,
  reloadCodingContextPacketsForTest,
  resetCodingContextPacketsForTest,
  seedDevEditCodingContext,
  selectCodingContextPacket,
} from './coding-context-packet';

const packetStore = path.join(os.tmpdir(), `prometheus-coding-context-${process.pid}.json`);
process.env.PROMETHEUS_CODING_CONTEXT_PACKET_STORE = packetStore;
try { fs.rmSync(packetStore, { force: true }); } catch {}

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
assert.match(warm.block, /CODING_CONTEXT_PACKET_V3/);
assert.match(warm.block, /src\/gateway\/prompt-builder\.ts/);
assert.match(warm.block, /buildPrompt/);
assert.match(warm.block, /observed_snapshot_sha256/);
assert.doesNotMatch(warm.block, /authoritative_content_sha256/);
assert.match(warm.block, /npx tsc --noEmit/);
assert.match(warm.block, /recent_run_commands/);
assert.match(warm.block, /"kind": "verification"/);
assert.doesNotMatch(warm.block, /DO_NOT_REINJECT_RAW_RESULT|raw verification prose/);
assert.ok(warm.block.length <= 6_000);

observeCodingContext({
  sessionId: 'command-ledger-session',
  objective: 'Continue the packet command ledger work in src/gateway/coding-context-packet.ts',
  projectRoot: root,
  toolName: 'workspace_read',
  args: { action: 'read', path: 'src/gateway/coding-context-packet.ts' },
  result: 'focused target snapshot',
  now: baseTime,
});
observeCodingContext({
  sessionId: 'command-ledger-session',
  objective: 'continue',
  projectRoot: root,
  toolName: 'workspace_run',
  args: { action: 'run', command: 'node scripts/inspect-packet.mjs --token=super-secret' },
  result: 'inspection completed without raw output injection',
  error: false,
  artifacts: [{ path: 'artifacts/packet-inspection.json' }],
  extra: { exitCode: 0, durationMs: 321 },
  now: baseTime + 100,
});
observeCodingContext({
  sessionId: 'command-ledger-session',
  objective: 'continue',
  projectRoot: root,
  toolName: 'workspace_run',
  args: { action: 'run', command: 'node scripts/verify-packet.mjs' },
  result: 'Error: command timed out after 10 seconds',
  error: true,
  extra: { exitCode: 124, durationMs: 10_000 },
  now: baseTime + 200,
});
const commandLedger = selectCodingContextPacket({
  enabled: true,
  sessionId: 'command-ledger-session',
  message: 'Continue the coding-context-packet.ts command ledger work.',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 300,
});
assert.equal(commandLedger.status, 'injected');
assert.match(commandLedger.block, /node scripts\/inspect-packet\.mjs --token=\*\*\*/);
assert.match(commandLedger.block, /artifacts\/packet-inspection\.json/);
assert.match(commandLedger.block, /"exit_code": 0/);
assert.match(commandLedger.block, /"failure_kind": "timed_out"/);
assert.doesNotMatch(commandLedger.block, /super-secret|inspection completed without raw output injection/);

observeCodingContext({
  sessionId: 'dev-edit-session',
  objective: 'Continue the coding context packet dev edit.',
  projectRoot: root,
  toolName: 'request_dev_source_edit',
  args: {
    files: ['src/gateway/coding-context-packet.ts', 'src/gateway/coding-context-packet.regression.ts'],
    verification_profiles: ['backend_build'],
  },
  data: { dev_edit_id: 'dev_edit_packet_test' },
  result: 'approved dev edit with a raw plan that must not be injected',
  now: baseTime + 400,
});
observeCodingContext({
  sessionId: 'dev-edit-session',
  objective: 'continue',
  projectRoot: root,
  toolName: 'dev_source_edit',
  args: {
    action: 'apply_live',
    dev_edit_id: 'dev_edit_packet_test',
    affected_files: ['src/gateway/coding-context-packet.ts'],
    changed_surfaces: ['backend'],
    verification_profiles: ['backend_build'],
  },
  result: 'apply succeeded; do not inject raw coordinator response',
  now: baseTime + 500,
});
reloadCodingContextPacketsForTest();
const devEditLedger = selectCodingContextPacket({
  enabled: true,
  sessionId: 'dev-edit-session',
  message: 'Continue the coding context packet dev edit.',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 600,
});
assert.equal(devEditLedger.status, 'injected');
assert.match(devEditLedger.block, /recent_dev_edits/);
assert.match(devEditLedger.block, /dev_edit_packet_test/);
assert.match(devEditLedger.block, /"stage": "apply_live"/);
assert.match(devEditLedger.block, /coding-context-packet\.ts/);
assert.match(devEditLedger.block, /coding-context-packet\.regression\.ts/);
assert.match(devEditLedger.block, /backend_build/);
assert.match(devEditLedger.block, /"restart_expected": true/);
assert.doesNotMatch(devEditLedger.block, /raw plan that must not be injected|raw coordinator response/);

const naturalPacketFollowUp = selectCodingContextPacket({
  enabled: true,
  sessionId: 'dev-edit-session',
  message: 'Context packet now?',
  projectRoot: root,
  executionMode: 'interactive',
  history: [{ role: 'assistant', content: 'The dev edit completed and backend build passed.' }],
  now: baseTime + 650,
});
assert.equal(naturalPacketFollowUp.status, 'injected');
assert.equal(naturalPacketFollowUp.reason, 'explicit_context_packet_follow_up');
assert.match(naturalPacketFollowUp.block, /dev_edit_packet_test/);
assert.match(naturalPacketFollowUp.block, /"stage": "apply_live"/);

const unrelatedAfterDevEdit = selectCodingContextPacket({
  enabled: true,
  sessionId: 'dev-edit-session',
  message: 'What is the weather tomorrow?',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 675,
});
assert.deepEqual(
  { status: unrelatedAfterDevEdit.status, reason: unrelatedAfterDevEdit.reason },
  { status: 'omitted', reason: 'ambiguous_continuation' },
);



const authoritativePath = path.join(root, 'src', 'gateway', 'coding-context-packet.ts');
const authoritativeContent = fs.readFileSync(authoritativePath);
const authoritativeHash = crypto.createHash('sha256').update(authoritativeContent).digest('hex');
observeCodingContext({
  sessionId: 'structured-evidence-session',
  objective: 'Continue improving src/gateway/coding-context-packet.ts',
  projectRoot: root,
  toolName: 'workspace_edit',
  args: { action: 'find_replace', path: 'src/gateway/coding-context-packet.ts' },
  result: 'structured tool result',
  extra: {
    codeEvidence: {
      version: 1,
      kind: 'code_evidence',
      tool_name: 'workspace_edit',
      operation: 'mutation',
      generated_at: new Date(baseTime + 2_100).toISOString(),
      generation_ms: 1,
      truncated: false,
      files: [{
        path: 'src/gateway/coding-context-packet.ts',
        operation: 'update',
        exists_after: true,
        authoritative_content_sha256: authoritativeHash,
        size_bytes: authoritativeContent.length,
        line_count: 700,
        changed_ranges: [{ before_start_line: 10, before_end_line: 10, after_start_line: 10, after_end_line: 10 }],
        post_edit_windows: [{ start_line: 8, end_line: 12, changed_start_line: 10, changed_end_line: 10, content: '  8: before\n> 10: updated\n  12: after', truncated: false }],
        evidence_complete: true,
        observed_at: new Date(baseTime + 2_100).toISOString(),
        provenance: 'tool:workspace_edit:workspace_snapshot',
      }],
    },
  },
  now: baseTime + 2_100,
});
const structured = selectCodingContextPacket({
  enabled: true,
  sessionId: 'structured-evidence-session',
  message: 'Continue with coding-context-packet.ts.',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 2_200,
});
assert.equal(structured.status, 'injected');
assert.match(structured.block, /state_matches_evidence": true/);
assert.match(structured.block, /post_edit_windows/);
assert.match(structured.block, /> 10: updated/);
assert.doesNotMatch(structured.block, /"required_action"\s*:/);
const shadowed = selectCodingContextPacket({
  enabled: true,
  shadowMode: true,
  sessionId: 'structured-evidence-session',
  message: 'Continue with coding-context-packet.ts.',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 2_300,
});
assert.equal(shadowed.status, 'shadowed');
assert.equal(shadowed.block, '');
const legacyFallback = selectCodingContextPacket({
  enabled: true,
  packetVersion: 2,
  sessionId: 'structured-evidence-session',
  message: 'Continue with coding-context-packet.ts.',
  projectRoot: root,
  executionMode: 'interactive',
  now: baseTime + 2_350,
});
assert.equal(legacyFallback.status, 'injected');
assert.match(legacyFallback.block, /CODING_CONTEXT_PACKET_V2/);
assert.doesNotMatch(legacyFallback.block, /post_edit_windows/);

observeCodingContext({
  sessionId: 'packet-cap-session', objective: 'Continue capped packet target', projectRoot: root,
  toolName: 'workspace_edit', args: { action: 'find_replace', path: 'src/gateway/coding-context-packet.ts' }, result: 'ok', now: baseTime + 2_360,
  extra: { codeEvidence: {
    version: 1, kind: 'code_evidence', tool_name: 'workspace_edit', operation: 'mutation', generated_at: new Date(baseTime + 2_360).toISOString(), generation_ms: 1, truncated: false,
    files: [{ path: 'src/gateway/coding-context-packet.ts', operation: 'update', exists_after: true, authoritative_content_sha256: authoritativeHash, changed_ranges: [], post_edit_windows: [{ start_line: 1, end_line: 10, changed_start_line: 1, changed_end_line: 10, content: 'x'.repeat(2_500), truncated: false }], evidence_complete: true, observed_at: new Date(baseTime + 2_360).toISOString(), provenance: 'test' }],
  } },
});
const capped = selectCodingContextPacket({ enabled: true, sessionId: 'packet-cap-session', message: 'Continue capped packet target.', projectRoot: root, executionMode: 'interactive', maxChars: 2_000, now: baseTime + 2_370 });
assert.deepEqual({ status: capped.status, reason: capped.reason }, { status: 'omitted', reason: 'packet_hard_cap' });

const mismatchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-coding-mismatch-'));
const mismatchFile = path.join(mismatchRoot, 'target.ts');
fs.writeFileSync(mismatchFile, 'export const state = 1;\n', 'utf8');
const mismatchHash = crypto.createHash('sha256').update(fs.readFileSync(mismatchFile)).digest('hex');
observeCodingContext({
  sessionId: 'hash-mismatch-session', objective: 'Continue target.ts editing', projectRoot: mismatchRoot,
  toolName: 'workspace_edit', args: { action: 'find_replace', path: 'target.ts' }, result: 'ok', now: baseTime + 2_400,
  extra: { codeEvidence: {
    version: 1, kind: 'code_evidence', tool_name: 'workspace_edit', operation: 'mutation', generated_at: new Date(baseTime + 2_400).toISOString(), generation_ms: 1, truncated: false,
    files: [{ path: 'target.ts', operation: 'update', exists_after: true, authoritative_content_sha256: mismatchHash, changed_ranges: [], post_edit_windows: [{ start_line: 1, end_line: 1, changed_start_line: 1, changed_end_line: 1, content: '> 1: stale window', truncated: false }], evidence_complete: true, observed_at: new Date(baseTime + 2_400).toISOString(), provenance: 'test' }],
  } },
});
fs.writeFileSync(mismatchFile, 'export const state = 2;\n', 'utf8');
const mismatch = selectCodingContextPacket({ enabled: true, sessionId: 'hash-mismatch-session', message: 'Continue target.ts.', projectRoot: mismatchRoot, executionMode: 'interactive', now: baseTime + 2_500 });
assert.equal(mismatch.status, 'injected');
assert.match(mismatch.block, /state_matches_evidence": false/);
assert.match(mismatch.block, /on-disk state changed/);
assert.doesNotMatch(mismatch.block, /stale window/);
fs.rmSync(mismatchRoot, { recursive: true, force: true });

const configuredFresh = selectCodingContextPacket({
  enabled: true,
  sessionId: 'coding-session',
  message: 'Continue the prompt-builder.ts fix.',
  projectRoot: root,
  executionMode: 'interactive',
  maxAgeMs: 14 * 24 * 60 * 60_000,
  now: baseTime + 31 * 60_000,
});
assert.equal(configuredFresh.status, 'injected');

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
assert.equal(invalidated.status, 'injected');
assert.match(invalidated.block, /dirty_unverified|required_action/);

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

const creativeCoding = selectCodingContextPacket({
  enabled: true,
  sessionId: 'source-wrapper-session',
  message: '[Continuing toward active main-chat goal]\nGoal: finish the Creative video source edit.',
  projectRoot: root,
  executionMode: 'interactive',
  creativeMode: 'video',
  allowCreativeCoding: true,
  now: baseTime + 1_100,
});
assert.equal(creativeCoding.status, 'injected');
assert.match(creativeCoding.block, /source-wrapper\.ts/);
const creativeVisual = selectCodingContextPacket({
  enabled: true,
  sessionId: 'source-wrapper-session',
  message: 'Render another frame of the timeline.',
  projectRoot: root,
  executionMode: 'interactive',
  creativeMode: 'video',
  allowCreativeCoding: true,
  now: baseTime + 1_100,
});
assert.equal(creativeVisual.status, 'omitted');
assert.equal(creativeVisual.reason, 'ambiguous_continuation');

observeCodingContext({
  sessionId: 'subagent-task-one-session',
  scopeId: 'agent:dante',
  actorId: 'dante',
  runtimeTaskId: 'task-one',
  objective: 'Improve the PS Vita driving game road geometry',
  projectRoot: root,
  toolName: 'workspace_edit',
  args: { action: 'find_replace', path: 'games/figure-8-drift-vita/src/main.cpp', find: 'old', replace: 'new' },
  result: 'edit applied',
  now: baseTime + 3_000,
});
reloadCodingContextPacketsForTest();
const nextAgentTask = selectCodingContextPacket({
  enabled: true,
  sessionId: 'subagent-task-two-session',
  scopeId: 'agent:dante',
  actorId: 'dante',
  runtimeTaskId: 'task-two',
  message: 'Audit and improve vehicle handling on the current Vita project.',
  projectRoot: root,
  executionMode: 'background_agent',
  now: baseTime + 4_000,
});
assert.deepEqual(
  { status: nextAgentTask.status, reason: nextAgentTask.reason },
  { status: 'injected', reason: 'persistent_agent_task_handoff' },
);
assert.match(nextAgentTask.block, /figure-8-drift-vita\/src\/main\.cpp/);
assert.match(nextAgentTask.block, /previous_runtime_task_id/);
assert.match(nextAgentTask.block, /Reread this file/);

observeCodingContext({
  sessionId: 'subagent-task-two-session', scopeId: 'agent:dante', actorId: 'dante', runtimeTaskId: 'task-two',
  objective: 'Build a completely unrelated parser utility', projectRoot: root, toolName: 'workspace_edit',
  args: { action: 'find_replace', path: 'src/parser-utility.ts' }, result: 'edit applied', now: baseTime + 5_000,
});
const isolatedAgentTask = selectCodingContextPacket({
  enabled: true, sessionId: 'subagent-task-three-session', scopeId: 'agent:dante', actorId: 'dante', runtimeTaskId: 'task-three',
  message: 'Continue the parser utility work.', projectRoot: root, executionMode: 'background_agent', now: baseTime + 6_000,
});
assert.equal(isolatedAgentTask.status, 'injected');
assert.match(isolatedAgentTask.block, /src\/parser-utility\.ts/);
assert.doesNotMatch(isolatedAgentTask.block, /figure-8-drift-vita/);

seedDevEditCodingContext({
  id: 'dev-persist-regression',
  sessionId: 'dev-persist-session',
  status: 'approved',
  allowedFiles: ['src/gateway/coding-context-packet.ts'],
  changedSurfaces: ['backend'],
  verificationProfiles: ['backend_build'],
  objective: 'Persist Prometheus self-edit context across a live restart.',
  projectRoot: root,
});
seedDevEditCodingContext({
  id: 'dev-persist-regression',
  sessionId: 'dev-persist-session',
  status: 'complete',
  allowedFiles: ['src/gateway/coding-context-packet.ts'],
  affectedFiles: ['src/gateway/coding-context-packet.ts'],
  changedSurfaces: ['backend'],
  verificationProfiles: ['backend_build'],
  verificationSummary: 'backend build passed; gateway restarted successfully.',
  objective: 'Persist Prometheus self-edit context across a live restart.',
  projectRoot: root,
});
reloadCodingContextPacketsForTest();
const persistedDevEdit = selectCodingContextPacket({
  enabled: true,
  sessionId: 'dev-persist-session',
  message: '[Continuing toward active main-chat goal]',
  projectRoot: root,
  executionMode: 'interactive',
  now: Date.now(),
});
assert.equal(persistedDevEdit.status, 'injected');
assert.match(persistedDevEdit.block, /dev-persist-regression/);
assert.match(persistedDevEdit.block, /"stage": "live"/);
assert.match(persistedDevEdit.block, /coding-context-packet\.ts/);

assert.deepEqual(getCodingContextPacketTelemetry(), { injected: 16, shadowed: 1, omitted: 5, rejected_stale: 1 });
try { fs.rmSync(packetStore, { force: true }); } catch {}
console.log('coding-context-packet regression: ok');
