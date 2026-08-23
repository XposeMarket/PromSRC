import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildBrainThoughtActivityIndex,
  clearBrainThoughtRun,
  executeBrainThoughtTool,
  isBrainThoughtRunActive,
  registerBrainThoughtRun,
} from './brain-thought-runtime.js';
import type { ActivityPackage } from './activity-package.js';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-thought-runtime-'));
fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'USER.md'), '# USER\nBuilds Galaxy Drift.\n');
fs.writeFileSync(path.join(workspace, 'MEMORY.md'), '# MEMORY\n\n## Projects\n- Creative Mode image editor is a long-running project.\n- Unrelated old fact.\n');
fs.writeFileSync(path.join(workspace, 'SOUL.md'), '# SOUL\nPrometheus should be concise.\n');
fs.writeFileSync(path.join(workspace, 'memory', '2026-08-22-intraday-notes.md'), '# notes\nCreative Mode work resumed today.\n');

const activityPackage: ActivityPackage = {
  schemaVersion: 'prometheus.thoughts.activity-package.v1',
  packageId: 'ap_test', correlationId: 'run_test', authority: 'canonical_runtime_stores',
  window: { start: '2026-08-22T12:00:00.000Z', end: '2026-08-22T18:00:00.000Z', startMs: 1, endMs: 2, durationMs: 1, timezone: 'UTC', boundary: '[start,end)' },
  eventLedger: { complete: true, inline: [{ id: 'evt_1', timestamp: '2026-08-22T13:00:00.000Z', timestampMs: 1, type: 'chat_sessions.message', actor: 'user', entity: { sessionId: 's1' }, summary: 'User asked to improve Creative Mode.', provenance: [{ source: 'chat_sessions', store: 'sessions', ref: 's1' }], redacted: true }], inlineSelection: 'all', totalEvents: 1, omittedFromInline: 0, continuations: [] },
  counts: { chat_sessions: 1 }, sourceCoverage: [], unresolvedWork: [],
  redaction: { applied: true, policy: 'secret-key-and-payload-redaction-v1', rawPayloadsIncluded: false, rawPayloadRefsIncluded: false, note: 'test' },
  completeness: { status: 'complete', omissions: [], continuationRequired: false, directContextRule: 'do_not_search_covered_activity' },
  observability: { searchCallsAtAssembly: 0 },
  metrics: { assemblyStartedAt: new Date().toISOString(), assemblyCompletedAt: new Date().toISOString(), assemblyLatencyMs: 0, filesVisited: 0, filesParsed: 0, recordsScanned: 1, eventsDiscovered: 1, eventsIncluded: 1, duplicateEvents: 0, inlineEventCount: 1, continuationEventCount: 0, inlineChars: 1, fullLedgerChars: 1, packageChars: 1, estimatedPackageTokens: 1, continuationWriteFailures: 0, sourceFailures: 0, sourcePartial: 0 },
};

const index = buildBrainThoughtActivityIndex(activityPackage, 4000);
assert(index.includes('ap_test'));
assert(index.includes('evt_1'));
assert(index.length <= 4000);

const sessionId = 'brain_thought_test';
assert.equal(isBrainThoughtRunActive(sessionId), false);
registerBrainThoughtRun({ sessionId, workspacePath: workspace, dateStr: '2026-08-22', thoughtNumber: 1, windowStart: '2026-08-22T12:00:00Z', windowEnd: '2026-08-22T18:00:00Z', activityPackage, thoughtFile: 'Brain/thoughts/2026-08-22/test-thought.md', capsuleFile: 'Brain/context-capsules/2026-08-22/test-capsules.json', activeWorkFile: 'Brain/active-work.jsonl', businessCandidatesFile: 'Brain/business-candidates/2026-08-22/candidates.jsonl' });
assert.equal(isBrainThoughtRunActive(sessionId), true);
const ctx = executeBrainThoughtTool(sessionId, 'brain_context_search', { query: 'Creative Mode', sources: ['memory','notes'] });
assert(ctx.includes('atom=matom_'));
assert(ctx.includes('Creative Mode'));
assert(!ctx.includes('Prometheus should be concise'));
const exact = executeBrainThoughtTool(sessionId, 'brain_activity_read', { event_ids: ['evt_1'] });
const exactJson = JSON.parse(exact);
assert.equal(exactJson.events[0].id, 'evt_1');
assert(exact.length <= 24000);

const now = new Date();
const capsule = { id: 'cap_1', threadKey: 'project:creative-mode', kind: 'active_work', priority: 'high', status: 'in_progress', createdAt: now.toISOString(), expiresAt: new Date(now.getTime()+6*60*60*1000).toISOString(), summary: 'Creative Mode work is active.', facts: ['User requested improvements.'], nextUsefulAction: 'Verify current editor state.', relevance: { projects: ['Prometheus'], triggers: ['creative mode'], surfaces: ['coding'] }, evidence: ['evt_1'], lastValidatedAt: now.toISOString(), verificationRequired: true, supersedes: [] };
const submitArgs = {
  summary: 'Creative Mode work dominated the window and deserves a verified follow-up.',
  pulse_cards: [1,2,3].map((n) => ({ title: `Creative follow-up ${n}`, body: 'Review the current editor and choose the next useful improvement.', prompt: 'Review the current Creative Mode editor state and recommend the next grounded improvement.' })),
  capsules: [capsule], activity_summary: ['Creative Mode improvement requested.'], behavior_quality: { went_well: [], stalled: [], tool_usage: [], user_corrections: [] },
  business_candidates: [{ summary: 'Creative Mode remains an active project.', action: 'append_event', confidence: 'high', entityType: 'project', entityId: 'creative-mode', displayName: 'Creative Mode', evidence: ['evt_1'] }],
  active_work: [{ id: 'creative-mode', title: 'Creative Mode', origin: 'evt_1', status: 'in_progress', lastVerified: '2026-08-22', currentState: 'Active', research: [], evidence: ['evt_1'] }],
  verdict: { active: true, signal_quality: 'high', summary: 'Active window.', wonderings: ['the next editor pass should prioritize current-state verification.'] },
};
assert.throws(() => executeBrainThoughtTool(sessionId, 'brain_thought_submit', { ...submitArgs, pulse_cards: [{ ...submitArgs.pulse_cards[0], extra: true }, submitArgs.pulse_cards[1], submitArgs.pulse_cards[2]] }));
assert.throws(() => executeBrainThoughtTool(sessionId, 'brain_thought_submit', { ...submitArgs, active_work: [{ id: 'bad', title: 'Bad', status: 'unknown', currentState: 'x', evidence: [] }] }));
const submit = executeBrainThoughtTool(sessionId, 'brain_thought_submit', submitArgs);
assert(submit.includes('submission accepted'));
assert(fs.existsSync(path.join(workspace, 'Brain/thoughts/2026-08-22/test-thought.md')));
assert(fs.existsSync(path.join(workspace, 'Brain/context-capsules/2026-08-22/test-capsules.json')));
const businessLines = fs.readFileSync(path.join(workspace, 'Brain/business-candidates/2026-08-22/candidates.jsonl'), 'utf8').trim().split(/\r?\n/);
assert.equal(businessLines.length, 1);
assert(JSON.parse(businessLines[0]).id.startsWith('bc_'));
assert.throws(() => executeBrainThoughtTool(sessionId, 'brain_thought_submit', submitArgs));
clearBrainThoughtRun(sessionId);
assert.equal(isBrainThoughtRunActive(sessionId), false);
assert.throws(() => executeBrainThoughtTool(sessionId, 'brain_context_search', { query: 'Creative Mode' }));
fs.rmSync(workspace, { recursive: true, force: true });
console.log('brain-thought-runtime regression: ok');
