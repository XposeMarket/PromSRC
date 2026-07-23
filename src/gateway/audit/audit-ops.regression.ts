import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-audit-ops-'));
process.env.PROMETHEUS_DATA_DIR = path.join(root, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });
const auditRoot = path.join(process.env.PROMETHEUS_WORKSPACE_DIR, 'audit');
const write = (relative: string, value: string) => { const file = path.join(auditRoot, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };

async function main(): Promise<void> {
  const continuity = await import('./continuity');
  const audit = await import('./audit-ops');
  const observations = await import('../tool-observations');
  const defs = await import('../tools/defs/agent-team-schedule');
  const executor = await import('../agents-runtime/capabilities/automation-executor');
  const sessionId = 'audit_interrupted_1';

  // Missing index is explicit, not silently presented as fresh.
  let recent = audit.executePrometheusAuditOps('owner', { action: 'recent_sessions' });
  assert.equal(recent.provenance.mirror.status, 'unavailable');
  write('_index/global.json', JSON.stringify({ generatedAt: new Date(Date.now() - 20_000).toISOString(), artifactRole: 'redacted_snapshot', sourceOfTruth: false, provenance: 'materialized_mirror', freshness: { status: 'fresh', expectedIntervalMs: 1000 }, materializer: { errors: 2 } }));
  write('_index/sessions-preview.json', JSON.stringify([{ id: sessionId, title: 'Interrupted recovery', channel: 'web', lastActiveAt: 123, messageCount: 2, goalStatus: 'restarting', mtimeMs: 123 }]));

  continuity.appendContinuityMessage(sessionId, { role: 'user', timestamp: 100, content: 'Implement the recovery feature. api_key=supersecret-value' });
  observations.persistToolObservations(sessionId, [{ sessionId, id: 'obs_ok', turnId: 'turn1', stepNum: 1, toolName: 'apply_patch', category: 'file', status: 'ok', argsPreview: '{"path":"src/a.ts"}', resultPreview: 'changed src/a.ts', pathsTouched: ['src/a.ts'], createdAt: 200 } as any]);
  // Actual materialized observation/raw pair: only this observation can issue a raw ref.
  write(`chats/tool-observations/${sessionId}.jsonl`, `${JSON.stringify({ id: 'raw_obs', sessionId, toolName: 'terminal', status: 'stored', resultRawRef: `tool-observation-raw:${sessionId}/raw_obs.txt`, resultPreview: 'raw result saved', createdAt: 205 })}\n`);
  write(`chats/tool-observations/raw/${sessionId}/raw_obs.txt`, '0123456789'.repeat(4000));
  continuity.appendContinuityToolObservation({ sessionId, id: 'obs_running', turnId: 'turn2', stepNum: 2, toolName: 'terminal', category: 'shell_process', status: 'error', argsPreview: '{}', resultPreview: 'gateway interrupted during command', createdAt: 300 });
  continuity.appendContinuityEvent(sessionId, 'goal_state', { timestamp: 310, goal: 'Finish planned restart verification', status: 'restarting', currentIteration: 2, restartCheckpoint: { phase: 'interrupted', recoveryKind: 'planned' }, turnPlans: [{ id: 'plan', activeIndex: 1, steps: [{ text: 'apply', status: 'done' }, { text: 'verify', status: 'in_progress' }] }] });

  const brief = audit.executePrometheusAuditOps('owner', { action: 'recovery_brief', session_id: sessionId });
  assert.match(String(brief.lastSuccessfulTool?.toolName), /apply_patch/); // crash after success before reply
  assert.equal(brief.lastAssistantResponse, null);
  assert.equal(brief.goalState.status, 'restarting');
  assert.equal(brief.goalState.restartCheckpoint.recoveryKind, 'planned');
  assert.equal(brief.goalState.activeStep.text, 'verify');
  assert.equal(brief.requestState.inspected, false, 'unavailable request mirror is explicit');
  assert.deepEqual(brief.pathsTouched, ['src/a.ts']);
  assert.equal(brief.provenance.mirror.stale, true);

  const similar = 'audit_interrupted_2';
  continuity.appendContinuityMessage(similar, { role: 'user', timestamp: 150, content: 'Implement the recovery feature.' });
  continuity.appendContinuityMessage(similar, { role: 'assistant', timestamp: 500, content: 'Completed response.' });
  const candidates = audit.executePrometheusAuditOps('owner', { action: 'recovery_candidates' });
  assert.equal(candidates.candidates[0].sessionId, sessionId, 'interrupted/error session ranks above a similar completed one');
  assert.ok(candidates.candidates[0].score >= 65);
  assert.equal(candidates.candidates[0].session.title, 'Interrupted recovery');

  const timeline = audit.executePrometheusAuditOps('owner', { action: 'session_timeline', session_id: sessionId, limit: 20 });
  assert.equal(timeline.events.some((event: any) => /supersecret/.test(JSON.stringify(event))), false, 'secrets are redacted');
  const raw = timeline.events.find((event: any) => event.rawResult?.state === 'available')?.rawResult?.artifactRef;
  assert.ok(raw, 'only a real materialized observation emits an exact raw ref');
  const rawPage = audit.executePrometheusAuditOps('owner', { action: 'read_artifact', artifact_ref: raw, max_chars: 24_000 });
  assert.equal(rawPage.kind, 'raw'); assert.ok(rawPage.nextOffset); assert.equal(rawPage.content.length, 24_000);
  const rawNext = audit.executePrometheusAuditOps('owner', { action: 'read_artifact', artifact_ref: raw, offset: rawPage.nextOffset, max_chars: 24_000 });
  assert.equal(rawNext.content.length, 16_000);

  // Ordinary (non-raw) artifacts page losslessly: the cursor must not advance
  // past content hidden by a generic value-preview truncation.
  const pagedSession = 'paged_artifact';
  const pagedContent = Array.from({ length: 20_500 }, (_, index) => String(index % 10)).join('');
  write(`chats/transcripts/${pagedSession}.jsonl`, pagedContent);
  const pagedRef = `audit:${Buffer.from(`chats/transcripts/${pagedSession}.jsonl`).toString('base64url')}`;
  const pagedParts: string[] = [];
  const pagedOffsets: number[] = [];
  let pagedOffset: number | null = 0;
  while (pagedOffset !== null) {
    pagedOffsets.push(pagedOffset);
    const page = audit.executePrometheusAuditOps('owner', { action: 'read_artifact', artifact_ref: pagedRef, offset: pagedOffset, max_chars: 8_000 });
    pagedParts.push(page.content);
    pagedOffset = page.nextOffset;
  }
  assert.deepEqual(pagedOffsets, [0, 8_000, 16_000]);
  assert.equal(pagedParts.join(''), pagedContent, 'ordinary artifact pages contain no gaps or truncation');
  assert.throws(() => audit.executePrometheusAuditOps('owner', { action: 'read_artifact', artifact_ref: 'auditraw:eyJzZXNzaW9uSWQiOiJhZGRpdF9pbnRlcnJ1cHRlZF8xIiwib2JzZXJ2YXRpb25JZCI6Imd1ZXNzIiwicmF3UmVmIjoidG9vbC1vYnNlcnZhdGlvbi1yYXc6YWRkaXRfaW50ZXJydXB0ZWRfMS9ndWVzcy50eHQifQ' }));
  assert.throws(() => audit.executePrometheusAuditOps('owner', { action: 'read_artifact', artifact_ref: 'audit:Li4vLi4vc2VjcmV0' }));
  assert.throws(() => audit.executePrometheusAuditOps('owner', { action: 'read_artifact', artifact_ref: `audit:${Buffer.from(`chats/tool-observations/raw/${sessionId}/raw_obs.txt`).toString('base64url')}` }));
  assert.throws(() => audit.executePrometheusAuditOps('owner', { action: 'recover', session_id: sessionId }));

  const continuityFile = path.join(auditRoot, 'chats', 'continuity', `${sessionId}.jsonl`);
  fs.appendFileSync(continuityFile, '{ malformed json\n'); fs.appendFileSync(continuityFile, 'x'.repeat(700_000)); fs.appendFileSync(continuityFile, `\n${JSON.stringify({ timestamp: 400, type: 'message', role: 'assistant', content: 'large tail remains readable' })}\n`);
  const searched = audit.executePrometheusAuditOps('owner', { action: 'search', query: 'large tail', limit: 10 });
  assert.equal(searched.hits.length, 1, 'malformed and huge journals are bounded and tolerated');

  // 80 recent journals plus transcript mirrors exhaust the 2MiB scan budget;
  // recovery stays partial rather than scanning the audit corpus.
  for (let i = 0; i < 80; i++) { const id = `load_${String(i).padStart(3, '0')}`; continuity.appendContinuityEvent(id, 'message', { timestamp: 1000 + i, role: 'user', content: 'budget probe' }); write(`chats/continuity/${id}.jsonl`, `${JSON.stringify({ timestamp: 1000 + i, role: 'user', content: 'budget probe' })}\n${'x'.repeat(30_000)}`); write(`chats/transcripts/${id}.jsonl`, `${JSON.stringify({ timestamp: 1000 + i, role: 'user', content: 'budget probe' })}\n${'x'.repeat(30_000)}`); }
  const budgeted = audit.executePrometheusAuditOps('owner', { action: 'recovery_candidates', limit: 100 });
  assert.equal(budgeted.partial, true, 'candidate recovery reports scan budget exhaustion');

  const auditDef = defs.getAgentTeamScheduleTools().find((tool: any) => tool.function?.name === 'prometheus_audit_ops');
  assert.ok(auditDef); assert.equal(auditDef.function.parameters.properties.action.enum.includes('recover'), false);
  assert.equal(executor.automationCapabilityExecutor.canHandle('prometheus_audit_ops'), true);
  const dispatched = await executor.automationCapabilityExecutor.execute({ name: 'prometheus_audit_ops', args: { action: 'recent_sessions' }, sessionId: 'owner', workspacePath: process.env.PROMETHEUS_WORKSPACE_DIR!, deps: {} as any });
  assert.equal(dispatched.error, false);
  console.log('audit ops regression: ok');
}

main().finally(() => fs.rmSync(root, { recursive: true, force: true }));
